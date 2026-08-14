/*
 * Player profile - /player/?id=N
 *
 * Everything on this page is read live from Wanwood in the browser; nothing
 * about any particular player is baked into the HTML. The pieces are:
 *
 *   users/v1/users/{id}            name, created date, isVerified
 *   api/users/{id}                 online flag + avatar (isVerified absent here)
 *   inventory/v1/.../collectibles  the item list and the RAP total
 *   economy/v1/assets/{id}/resale-data   per-item daily price series
 *
 * The history chart is summed from the per-item series: for each day, the
 * player's RAP is the sum of every owned item's last known daily price. That
 * is the only real history this backend exposes - there is no per-player
 * snapshot endpoint - so it is reconstructed here rather than faked.
 */
(() => {
  'use strict';

  const API = window.WanwoodAPI;
  const VALUES = window.WolimonsValues;
  const BADGES = window.WolimonsBadges;
  const NAME_BADGES = window.WolimonsNameBadges;

  /* Resale-data is one request per unique item. Inventories are small on this
   * revival, but a whale with 100+ uniques should not open 100 sockets. */
  const ITEM_CONCURRENCY = 4;
  const SVG_NS = 'http://www.w3.org/2000/svg';

  const el = id => document.getElementById(id);

  const nameHeading = el('player_name');
  const cardNameBar = el('player_card_name_bar');
  const cardName = el('player_card_name');
  const offsiteLink = el('player_offsite_link');
  const avatarImage = el('player_avatar');
  const statusBox = el('player_status');
  const inventoryStatus = el('inventory_status');
  const grid = el('mix_container');
  const sortSelect = el('inventory_sort');
  const stackToggle = el('stackHoardsToggle');
  const chartBox = el('player_history_chart_container');
  const rangeButtons = el('chart_range_buttons');

  const formatNumber = value => Number(value || 0).toLocaleString('en-US');

  const slugify = value => String(value || 'unnamed')
    .replace(/'/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unnamed';

  function text(tag, className, value) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined) node.textContent = value;
    return node;
  }

  function setText(id, value) {
    const node = el(id);
    if (node) node.textContent = value;
  }

  function setStatus(node, message, { spinner = false } = {}) {
    if (!node) return;
    node.textContent = '';
    if (!message) {
      node.classList.add('d-none');
      return;
    }
    node.classList.remove('d-none');
    const wrap = text('div', 'd-flex align-items-center text-muted');
    if (spinner) wrap.appendChild(text('span', 'lb_loading mr-2'));
    wrap.appendChild(text('span', null, message));
    node.appendChild(wrap);
  }

  /* ------------------------------------------------------------------ */
  /* Name                                                                */
  /* ------------------------------------------------------------------ */

  /*
   * Nothing is appended to the name. Badges are not decorations that come
   * with having an account - they live in the WoliBadges row below the
   * stats, and only appear once the player has actually earned them.
   */
  function renderName(name) {
    if (nameHeading) {
      nameHeading.textContent = '';
      nameHeading.appendChild(text('span', null, name));
    }
    if (cardName) cardName.textContent = name;
    renderNameBadges();
  }

  /*
   * The trophy / verified / Certified Wanwoodian icons that sit inline after
   * the name on the profile card. Same builder the leaderboard cards use, so
   * an award looks identical in both places. Called again whenever one of its
   * inputs lands, because the name, the verified flag and the rank all arrive
   * at different times.
   */
  function renderNameBadges() {
    if (!cardNameBar || !NAME_BADGES) return;
    NAME_BADGES.renderInto(cardNameBar, {
      name: cardName ? cardName.textContent : '',
      rank: state.rank,
      verified: state.verified,
    });
  }

  /* ------------------------------------------------------------------ */
  /* WoliBadges row                                                      */
  /* ------------------------------------------------------------------ */

  /*
   * The row is empty until the player meets a badge's requirement. The
   * catalog and the earning rules both live in assets/js/badges.js, which is
   * the same data /badges is documented from, so a badge can never appear
   * here that is not on that page.
   *
   * Layout mirrors the badge strip used elsewhere on the site: one clipped
   * 68px line by default, expanded to the full grid by the chevron when there
   * are more badges than fit.
   */
  const BADGE_ROW_HEIGHT = 68;

  function renderBadges(earned) {
    const section = el('badges_section');
    const container = el('badges_container');
    const expand = el('badges_expand');
    if (!section || !container) return;

    container.textContent = '';

    /* No badges earned: the whole section stays out of the document flow
     * rather than leaving an empty bar behind. */
    if (!earned.length) {
      section.classList.add('d-none');
      if (expand) expand.classList.add('d-none');
      return;
    }

    earned.forEach(badge => {
      const icon = BADGES && BADGES.iconNode ? BADGES.iconNode(badge.id) : null;
      const node = icon || text('span', 'roli_badge');
      node.setAttribute('title', badge.name);
      node.setAttribute('aria-label', badge.name);
      container.appendChild(node);
    });

    section.classList.remove('d-none');

    /* scrollHeight is only meaningful once the row is laid out, so the
     * chevron is offered only when the badges genuinely overflow one line. */
    if (!expand) return;
    const overflows = container.scrollHeight > BADGE_ROW_HEIGHT + 1;
    expand.classList.toggle('d-none', !overflows);
    if (!overflows) {
      expand.classList.remove('expanded');
      expand.setAttribute('aria-expanded', 'false');
      container.style.height = `${BADGE_ROW_HEIGHT}px`;
    }
  }

  /* Re-scores the current inventory and redraws the row. Safe to call more
   * than once - the profile does, because the item supply figures only
   * arrive with resale-data, after the inventory has already rendered. */
  function refreshBadges() {
    if (!BADGES) return;
    renderBadges(BADGES.evaluate({
      items: state.items,
      verified: state.verified,
    }));
  }

  function toggleBadgeRow() {
    const container = el('badges_container');
    const expand = el('badges_expand');
    if (!container || !expand) return;
    const expanded = expand.classList.toggle('expanded');
    expand.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    expand.setAttribute('aria-label', expanded ? 'Show fewer badges' : 'Show all badges');
    container.style.height = expanded ? 'auto' : `${BADGE_ROW_HEIGHT}px`;
  }

  /* ------------------------------------------------------------------ */
  /* Inventory cards                                                     */
  /* ------------------------------------------------------------------ */

  function appendStat(parent, label, value) {
    if (value === null || value === undefined) return;
    const row = text('div', 'd-flex justify-content-between');
    const labelWrap = document.createElement('div');
    labelWrap.appendChild(text('small', 'text-muted', label));
    row.appendChild(labelWrap);
    row.appendChild(text('div', 'text-light text-truncate', formatNumber(value)));
    parent.appendChild(row);
  }

  /* Same card shape as the catalog so the two pages stay visually identical.
   * Value first, then RAP - and never a price. */
  function itemCard(item, { stacked }) {
    const card = text('div', 'shadow_md_35 shift_up_md pb-2 mb-3 mix_item');
    card.dataset.ref = 'item';
    card.style.backgroundColor = '#30363c';

    const link = document.createElement('a');
    link.href = `/item/?id=${item.id}&name=${slugify(item.name)}`;

    const headingWrap = document.createElement('div');
    const heading = text('h6', 'item_card_name px-2 text-light my-1 text-truncate');
    const name = text('div', 'text-truncate', item.name);
    name.title = item.name;
    heading.appendChild(name);
    headingWrap.appendChild(heading);

    const imageWrap = text('div', 'position-relative std_item_card_img_bkgnd_gradient text-center border-top border-bottom border-dark');
    if (item.limited) {
      const ribbon = document.createElement('img');
      ribbon.className = 'limited_ribbon';
      ribbon.src = item.limitedUnique ? '/img/limitedu.svg' : '/img/limited.svg';
      ribbon.alt = item.limitedUnique ? 'Limited U' : 'Limited';
      ribbon.width = item.limitedUnique ? 75 : 56;
      ribbon.height = 15;
      ribbon.loading = 'lazy';
      imageWrap.appendChild(ribbon);
    }
    const image = document.createElement('img');
    image.className = 'd-block-inline my-1';
    image.src = item.thumbnail || API.thumbnailUrl(item.id);
    image.width = 100;
    image.height = 100;
    image.alt = `${item.name} thumbnail`;
    image.loading = 'lazy';
    imageWrap.appendChild(image);

    /* A hoard collapses into one card with a copy count; unstacked, each copy
     * gets its own card and shows the serial instead. */
    if (stacked && item.copies > 1) {
      const count = text('div', 'position-absolute px-2 text-light', `x${item.copies}`);
      count.style.cssText = 'top:4px;right:4px;background-color:rgba(0,0,0,.55);border-radius:10px;font-size:.8em;';
      imageWrap.appendChild(count);
    } else if (!stacked && item.serialNumber) {
      const serial = text('div', 'position-absolute px-2 text-light', `#${item.serialNumber}`);
      serial.style.cssText = 'top:4px;right:4px;background-color:rgba(0,0,0,.55);border-radius:10px;font-size:.8em;';
      imageWrap.appendChild(serial);
    }

    const stats = text('div', 'px-2 pt-1');
    appendStat(stats, 'Value', item.value);
    appendStat(stats, 'RAP', item.rap);
    if (stacked && item.copies > 1) {
      appendStat(stats, 'Total Value', item.value * item.copies);
      appendStat(stats, 'Total RAP', item.rap * item.copies);
    }

    link.appendChild(headingWrap);
    link.appendChild(imageWrap);
    link.appendChild(stats);
    card.appendChild(link);
    return card;
  }

  function sortItems(items, mode) {
    const rows = items.slice();
    const by = {
      value_descending: (a, b) => b.value - a.value,
      value_ascending: (a, b) => a.value - b.value,
      total_value_descending: (a, b) => (b.value * b.copies) - (a.value * a.copies),
      rap_descending: (a, b) => b.rap - a.rap,
      rap_ascending: (a, b) => a.rap - b.rap,
      total_rap_descending: (a, b) => (b.rap * b.copies) - (a.rap * a.copies),
      copies_owned_descending: (a, b) => b.copies - a.copies,
      name_ascending: (a, b) => a.name.localeCompare(b.name),
    };
    /* Ties fall back to RAP then name so the order is stable between renders. */
    rows.sort((a, b) => (by[mode] || by.value_descending)(a, b)
      || b.rap - a.rap
      || a.name.localeCompare(b.name));
    return rows;
  }

  const state = {
    items: [],
    userId: null,
    verified: false,
    /* null until the leaderboard cache answers; null means "no trophy",
     * never a guessed rank. */
    rank: null,
  };

  function renderInventory() {
    if (!grid) return;
    const stacked = stackToggle ? stackToggle.checked : true;
    grid.textContent = '';

    const rows = sortItems(state.items, sortSelect ? sortSelect.value : 'value_descending');
    if (!rows.length) {
      setStatus(inventoryStatus, 'This player owns no collectibles.');
      return;
    }
    setStatus(inventoryStatus, '');

    rows.forEach(item => {
      if (stacked) {
        grid.appendChild(itemCard(item, { stacked: true }));
        return;
      }
      /* Unstacked: one card per copy, carrying that copy's serial. */
      const serials = item.serials.length ? item.serials : new Array(item.copies).fill(null);
      serials.forEach(serial => {
        grid.appendChild(itemCard({ ...item, serialNumber: serial }, { stacked: false }));
      });
    });
  }

  /* ------------------------------------------------------------------ */
  /* History chart                                                       */
  /* ------------------------------------------------------------------ */

  const DAY_MS = 24 * 60 * 60 * 1000;

  const RANGES = [
    { id: '1m', label: '1M', days: 30 },
    { id: '3m', label: '3M', days: 90 },
    { id: '6m', label: '6M', days: 180 },
    { id: '1y', label: '1Y', days: 365 },
    { id: 'all', label: 'All', days: null },
  ];

  const chartState = {
    series: [],
    range: 'all',
  };

  /*
   * Turn the per-item daily price points into one player-level daily series.
   *
   * Each item only has points on days it actually sold, so a plain sum would
   * make the total lurch every time an item goes quiet. Instead every item
   * carries its last known price forward, which is what RAP does anyway, and
   * the day's total is the sum of those carried values times copies owned.
   */
  function buildSeries(items) {
    const dayKeys = new Set();
    items.forEach(item => {
      item.history.forEach(point => dayKeys.add(Math.floor(point.time / DAY_MS)));
    });
    if (!dayKeys.size) return [];

    const days = [...dayKeys].sort((a, b) => a - b);
    /* Walk each item's points in step with the shared day axis. */
    const cursors = items.map(() => 0);
    const carried = items.map(() => null);
    const series = [];

    days.forEach(day => {
      let rap = 0;
      let value = 0;
      items.forEach((item, index) => {
        while (cursors[index] < item.history.length
          && Math.floor(item.history[cursors[index]].time / DAY_MS) <= day) {
          carried[index] = item.history[cursors[index]].value;
          cursors[index] += 1;
        }
        if (carried[index] === null) return;
        rap += carried[index] * item.copies;
        /* Value is curated and has no history, so it is drawn flat at the
         * current figure for every day the player held the item. */
        value += item.value * item.copies;
      });
      series.push({ time: day * DAY_MS, rap, value });
    });

    return series;
  }

  function visibleSeries() {
    const range = RANGES.find(entry => entry.id === chartState.range) || RANGES[RANGES.length - 1];
    if (!range.days) return chartState.series;
    const cutoff = Date.now() - (range.days * DAY_MS);
    const rows = chartState.series.filter(point => point.time >= cutoff);
    /* Never show an empty chart just because the window is quiet - fall back
     * to the last handful of known points. */
    return rows.length >= 2 ? rows : chartState.series.slice(-2);
  }

  function svgNode(tag, attrs) {
    const node = document.createElementNS(SVG_NS, tag);
    Object.entries(attrs || {}).forEach(([key, value]) => {
      node.setAttribute(key, String(value));
    });
    return node;
  }

  function niceTicks(max) {
    if (max <= 0) return [0, 1];
    const rough = max / 4;
    const magnitude = 10 ** Math.floor(Math.log10(rough));
    const step = [1, 2, 2.5, 5, 10].map(m => m * magnitude)
      .find(candidate => candidate >= rough) || magnitude * 10;
    const ticks = [];
    for (let tick = 0; tick <= max + step / 2; tick += step) ticks.push(tick);
    return ticks;
  }

  const shortNumber = value => {
    const abs = Math.abs(value);
    if (abs >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
    if (abs >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
    if (abs >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
    return String(Math.round(value));
  };

  const formatDate = time => new Date(time).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  });

  function renderChart() {
    if (!chartBox) return;
    chartBox.textContent = '';

    const rows = visibleSeries();
    if (rows.length < 2) {
      const empty = text('div', 'd-flex align-items-center justify-content-center text-muted h-100');
      empty.style.minHeight = '280px';
      empty.textContent = chartState.series.length
        ? 'Not enough sale history in this range to draw a chart.'
        : 'No sale history recorded for this player\u2019s items yet.';
      chartBox.appendChild(empty);
      return;
    }

    /* The chart is drawn in real CSS pixels: the viewBox is set to the box the
     * container actually occupies, so one viewBox unit is one pixel on screen.
     *
     * It used to be a fixed 1000x380 viewBox stretched with
     * preserveAspectRatio="none", which squashed the horizontal and vertical
     * axes by different amounts - the profile card leaves the chart about
     * 368px wide but 468px tall, so glyphs were compressed to roughly a third
     * of their width and the axis text looked stretched. Measuring instead
     * keeps the aspect ratio at exactly 1:1, and observeChartResize() below
     * redraws when the box changes. */
    const box = chartBox.getBoundingClientRect();
    /* The legend is a sibling below the SVG, so its strip comes off the
     * height the plot may use or the two together overflow the container. */
    const LEGEND_RESERVE = 30;
    const width = Math.max(320, Math.round(box.width) || 640);
    const height = Math.max(200, (Math.round(box.height) || 380) - LEGEND_RESERVE);
    const pad = { top: 20, right: 20, bottom: 34, left: 62 };
    const plotWidth = width - pad.left - pad.right;
    const plotHeight = height - pad.top - pad.bottom;

    const minTime = rows[0].time;
    const maxTime = rows[rows.length - 1].time;
    const span = Math.max(1, maxTime - minTime);
    const maxY = Math.max(
      1,
      ...rows.map(point => Math.max(point.rap, point.value)),
    );
    const ticks = niceTicks(maxY);
    const top = ticks[ticks.length - 1];

    const xFor = time => pad.left + ((time - minTime) / span) * plotWidth;
    const yFor = value => pad.top + plotHeight - ((value / top) * plotHeight);

    const svg = svgNode('svg', {
      viewBox: `0 0 ${width} ${height}`,
      /* Uniform scaling; the viewBox already matches the box in pixels. */
      preserveAspectRatio: 'xMidYMid meet',
      width: '100%',
      height: String(height),
      role: 'img',
      'aria-label': 'Value and RAP history',
    });
    svg.style.display = 'block';
    svg.style.width = '100%';
    svg.style.height = `${height}px`;

    /* Gridlines + Y axis labels */
    ticks.forEach(tick => {
      const y = yFor(tick);
      svg.appendChild(svgNode('line', {
        x1: pad.left, x2: width - pad.right, y1: y, y2: y,
        stroke: '#454b52', 'stroke-width': 1,
      }));
      const label = svgNode('text', {
        x: pad.left - 10, y: y + 4, fill: '#9aa0a6',
        'font-size': 13, 'text-anchor': 'end',
      });
      label.textContent = shortNumber(tick);
      svg.appendChild(label);
    });

    /* X axis labels - first, middle, last */
    [0, Math.floor(rows.length / 2), rows.length - 1].forEach((index, position) => {
      const point = rows[index];
      const label = svgNode('text', {
        x: xFor(point.time), y: height - 10, fill: '#9aa0a6',
        'font-size': 13,
        'text-anchor': position === 0 ? 'start' : (position === 2 ? 'end' : 'middle'),
      });
      label.textContent = formatDate(point.time);
      svg.appendChild(label);
    });

    const linePath = key => rows
      .map((point, index) => `${index ? 'L' : 'M'}${xFor(point.time).toFixed(2)} ${yFor(point[key]).toFixed(2)}`)
      .join(' ');

    /* RAP is the meaningful moving line, so it gets a filled area under it.
     * Value is drawn on top as a flat reference. */
    const areaPath = `${linePath('rap')} L${xFor(maxTime).toFixed(2)} ${yFor(0).toFixed(2)} L${xFor(minTime).toFixed(2)} ${yFor(0).toFixed(2)} Z`;
    svg.appendChild(svgNode('path', {
      d: areaPath, fill: 'rgba(29,141,241,.18)', stroke: 'none',
    }));
    svg.appendChild(svgNode('path', {
      d: linePath('rap'), fill: 'none', stroke: '#1d8df1', 'stroke-width': 2.5,
      'stroke-linejoin': 'round', 'stroke-linecap': 'round',
    }));
    svg.appendChild(svgNode('path', {
      d: linePath('value'), fill: 'none', stroke: '#4db7d6', 'stroke-width': 2.5,
      'stroke-linejoin': 'round', 'stroke-linecap': 'round',
    }));

    /* Hover: a vertical rule plus two dots, positioned from the pointer's
     * x in viewBox units so it works at any rendered width. */
    const hoverLine = svgNode('line', {
      y1: pad.top, y2: pad.top + plotHeight, stroke: '#c8ccd0',
      'stroke-width': 1, 'stroke-dasharray': '4 3', opacity: 0,
    });
    const rapDot = svgNode('circle', { r: 4.5, fill: '#1d8df1', stroke: '#12161a', 'stroke-width': 2, opacity: 0 });
    const valueDot = svgNode('circle', { r: 4.5, fill: '#4db7d6', stroke: '#12161a', 'stroke-width': 2, opacity: 0 });
    svg.appendChild(hoverLine);
    svg.appendChild(rapDot);
    svg.appendChild(valueDot);

    chartBox.style.position = 'relative';
    chartBox.appendChild(svg);

    const legend = text('div', 'd-flex justify-content-center flex-wrap pb-2');
    [['RAP', '#1d8df1'], ['Value', '#4db7d6']].forEach(([label, color]) => {
      const entry = text('div', 'd-flex align-items-center mx-2');
      const swatch = text('span');
      swatch.style.cssText = `display:inline-block;width:12px;height:12px;border-radius:2px;margin-right:6px;background:${color};`;
      entry.appendChild(swatch);
      entry.appendChild(text('small', 'text-muted', label));
      legend.appendChild(entry);
    });
    chartBox.appendChild(legend);

    const tooltip = text('div');
    tooltip.style.cssText = 'position:absolute;pointer-events:none;opacity:0;transform:translate(-50%,-110%);'
      + 'background:#12161a;border:1px solid #454b52;border-radius:4px;padding:6px 9px;'
      + 'font-size:12px;color:#e6e6e6;white-space:nowrap;z-index:2;';
    chartBox.appendChild(tooltip);

    function hide() {
      hoverLine.setAttribute('opacity', 0);
      rapDot.setAttribute('opacity', 0);
      valueDot.setAttribute('opacity', 0);
      tooltip.style.opacity = 0;
    }

    function move(event) {
      const box = svg.getBoundingClientRect();
      if (!box.width || !box.height) return;
      const vx = ((event.clientX - box.left) / box.width) * width;
      const time = minTime + ((vx - pad.left) / plotWidth) * span;

      let nearest = rows[0];
      let best = Infinity;
      rows.forEach(point => {
        const distance = Math.abs(point.time - time);
        if (distance < best) { best = distance; nearest = point; }
      });

      const x = xFor(nearest.time);
      hoverLine.setAttribute('x1', x);
      hoverLine.setAttribute('x2', x);
      hoverLine.setAttribute('opacity', 1);
      rapDot.setAttribute('cx', x);
      rapDot.setAttribute('cy', yFor(nearest.rap));
      rapDot.setAttribute('opacity', 1);
      valueDot.setAttribute('cx', x);
      valueDot.setAttribute('cy', yFor(nearest.value));
      valueDot.setAttribute('opacity', 1);

      tooltip.textContent = '';
      tooltip.appendChild(text('div', null, formatDate(nearest.time)));
      tooltip.appendChild(text('div', null, `RAP ${formatNumber(nearest.rap)}`));
      tooltip.appendChild(text('div', null, `Value ${formatNumber(nearest.value)}`));
      /* The tooltip is absolutely positioned inside chartBox, but the
       * coordinates above are in the SVG's own space, and the SVG is only
       * part of chartBox (the legend sits below it). Convert through both
       * rects rather than assuming the two boxes line up. */
      const outer = chartBox.getBoundingClientRect();
      const scaleX = box.width / width;
      const scaleY = box.height / height;
      tooltip.style.left = `${(box.left - outer.left) + x * scaleX}px`;
      tooltip.style.top = `${(box.top - outer.top)
        + yFor(Math.max(nearest.rap, nearest.value)) * scaleY}px`;
      tooltip.style.opacity = 1;
    }

    svg.addEventListener('mousemove', move);
    svg.addEventListener('mouseleave', hide);
  }

  /*
   * renderChart() measures the container, so the drawing has to be redone when
   * that box changes size - a window resize, or a phone turning between
   * portrait and landscape, which swaps the grid between one and two columns.
   * The redraw is deferred to an animation frame so a drag resize coalesces
   * into one repaint instead of one per pixel.
   */
  function observeChartResize() {
    if (!chartBox) return;

    let pending = 0;
    let lastWidth = 0;
    let lastHeight = 0;

    const redraw = () => {
      pending = 0;
      const box = chartBox.getBoundingClientRect();
      const width = Math.round(box.width);
      const height = Math.round(box.height);
      /* Sub-pixel jitter shouldn't cost a full redraw. */
      if (Math.abs(width - lastWidth) < 2 && Math.abs(height - lastHeight) < 2) return;
      lastWidth = width;
      lastHeight = height;
      renderChart();
    };

    const schedule = () => {
      if (pending) return;
      pending = window.requestAnimationFrame(redraw);
    };

    if (typeof window.ResizeObserver === 'function') {
      new window.ResizeObserver(schedule).observe(chartBox);
    } else {
      window.addEventListener('resize', schedule);
      window.addEventListener('orientationchange', schedule);
    }
  }

  function renderRangeButtons() {
    if (!rangeButtons) return;
    rangeButtons.textContent = '';
    RANGES.forEach(range => {
      const button = text('button', 'btn btn-flat-light-blue-sm rounded-pill ml-2 mt-1', range.label);
      button.type = 'button';
      if (range.id === chartState.range) button.style.opacity = '1';
      else button.style.opacity = '.55';
      button.addEventListener('click', () => {
        chartState.range = range.id;
        renderRangeButtons();
        renderChart();
      });
      rangeButtons.appendChild(button);
    });
  }

  /* ------------------------------------------------------------------ */
  /* Load                                                                */
  /* ------------------------------------------------------------------ */

  function readUserId() {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('id') || params.get('userId');
    const id = Number(raw);
    if (Number.isSafeInteger(id) && id > 0) return id;

    /* No id in the URL: fall back to the account linked at /verify, so
     * "My Profile" can be a bare /player/ link. */
    const linked = window.WolimonsAccount?.get();
    return linked ? linked.id : null;
  }

  /* The leaderboard already ranks everyone and parks the result in
   * sessionStorage. If it is still warm, the rank is free; otherwise the
   * profile simply does not claim one rather than rebuilding the whole board. */
  function rankFromLeaderboard(userId) {
    try {
      const raw = window.sessionStorage.getItem('wolimons_leaderboard_v1');
      if (!raw) return null;
      const saved = JSON.parse(raw);
      if (!saved || !Array.isArray(saved.players)) return null;
      const found = saved.players.find(player => Number(player.id) === userId);
      return found && found.rank ? found.rank : null;
    } catch (error) {
      return null;
    }
  }

  async function load() {
    const userId = readUserId();
    if (!userId) {
      setStatus(statusBox, 'No player selected. Open a profile from the leaderboard.');
      renderName('Unknown player');
      return;
    }
    state.userId = userId;

    if (offsiteLink) {
      offsiteLink.href = `${API.SITE_BASE}/users/${userId}/profile`;
      offsiteLink.classList.remove('d-none');
    }

    setStatus(statusBox, 'Loading profile\u2026', { spinner: true });
    setStatus(inventoryStatus, 'Loading inventory\u2026', { spinner: true });

    /* The two user endpoints carry different fields, so both are needed:
     * users/v1/users/{id} has created + isVerified, api/users/{id} has the
     * online flag. getUserById() wraps the latter but drops everything except
     * the name, so the raw call is used here. Neither failing is fatal. */
    const [profile, legacy, avatars] = await Promise.all([
      API.fetchJson(`${API.API_BASE}/apisite/users/v1/users/${userId}`)
        .then(result => (result && !Array.isArray(result.errors) ? result : null))
        .catch(() => null),
      API.fetchJson(`${API.API_BASE}/apisite/api/users/${userId}`)
        .then(result => (result && !Array.isArray(result.errors) ? result : null))
        .catch(() => null),
      API.fetchUserThumbnails([userId]).catch(() => new Map()),
    ]);

    const rawName = (profile && profile.name)
      || (legacy && (legacy.Username || legacy.username))
      || '';
    const name = rawName && rawName !== '?' ? String(rawName).trim() : `User ${userId}`;

    renderName(name);
    document.title = `${name} - Wanwood Player Profile - Wolimons`;

    /* Fed to the badge rules once the inventory is in. Verified is strictly
     * what the API reports - nothing here is granted for existing. */
    state.verified = Boolean(profile && profile.isVerified === true);
    renderNameBadges();

    if (avatarImage) {
      const url = avatars && avatars.get ? avatars.get(userId) : null;
      if (url) avatarImage.src = url;
      avatarImage.alt = `${name} avatar`;
    }

    const online = legacy && legacy.IsOnline === true;
    setText('player_online_status', online ? 'Online' : 'Offline');
    const statusIcon = document.querySelector('.online_status_icon_path');
    if (statusIcon) statusIcon.setAttribute('fill', online ? '#00b06f' : '#7a8288');

    if (profile && profile.created) {
      const created = new Date(profile.created);
      setText('player_created', Number.isFinite(created.getTime())
        ? created.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
        : '-');
    }

    /* username-history is a real endpoint but frequently empty; a failure is
     * not worth surfacing anywhere on the page. */
    API.fetchJson(`${API.API_BASE}/apisite/users/v1/users/${userId}/username-history?limit=10&sortOrder=Asc`)
      .then(result => {
        const rows = Array.isArray(result && result.data) ? result.data : [];
        const names = rows.map(row => row && row.name).filter(Boolean);
        setText('known_previous_names', names.length ? names.join(', ') : 'None');
      })
      .catch(() => setText('known_previous_names', 'None'));

    const rank = rankFromLeaderboard(userId);
    setText('player_rank', rank ? `#${rank}` : 'Unranked');
    state.rank = rank;
    renderNameBadges();

    /* --- inventory ------------------------------------------------- */

    /* getCollectiblesSummary() is a single page but is the only thing that
     * reports the backend's own totalRap; it resolves null (never throws) when
     * the player is missing or unreachable. If the inventory spills past one
     * page, getCollectibles() pages through the rest. */
    const summary = await API.getCollectiblesSummary(userId);
    if (!summary) {
      setStatus(statusBox, 'Could not load this player from Wanwood. They may not exist, or the site is temporarily unreachable.');
      setStatus(inventoryStatus, '');
      if (chartBox) chartBox.textContent = '';
      return;
    }
    setStatus(statusBox, '');

    let rows = summary.rows;
    if (summary.hasMore) {
      const full = await API.getCollectibles(userId).catch(() => null);
      if (full && full.length > rows.length) rows = full;
    }

    /* Group copies of the same asset - the API returns one row per holding. */
    const grouped = new Map();
    rows.forEach(row => {
      const id = Number(row.assetId);
      if (!Number.isSafeInteger(id) || id <= 0) return;
      const existing = grouped.get(id);
      const copies = Math.max(1, Number(row.ownedCount) || 1);
      if (existing) {
        existing.copies += copies;
        if (row.serialNumber) existing.serials.push(Number(row.serialNumber));
        return;
      }
      grouped.set(id, {
        id,
        name: typeof row.name === 'string' ? row.name.trim() : `Item ${id}`,
        rap: Number(row.recentAveragePrice) || 0,
        value: VALUES.get(id),
        copies,
        serials: row.serialNumber ? [Number(row.serialNumber)] : [],
        /* The collectibles endpoint only returns limited items, so `limited`
         * is a given. Limited U is NOT inferable from the row - a serial
         * number is not the same thing - so both flags are overwritten below
         * with what api/v1/items/restrictions reports. */
        limited: true,
        limitedUnique: false,
        /* Both only matter to the badge rules: assetTypeId backs
         * Accessorized, and `available` (copies in existence) backs the
         * rarity and percentage-of-copies badges. serialCount is the
         * inventory row's own guess; resale-data overwrites it below with
         * the authoritative stock figure when it answers. */
        assetTypeId: Number.isFinite(Number(row.assetTypeId)) ? Number(row.assetTypeId) : null,
        available: Number(row.serialCount) || null,
        thumbnail: null,
        history: [],
      });
    });

    state.items = [...grouped.values()];

    const totalRap = state.items.reduce((sum, item) => sum + (item.rap * item.copies), 0);
    const totalValue = state.items.reduce((sum, item) => sum + (item.value * item.copies), 0);
    const totalCopies = state.items.reduce((sum, item) => sum + item.copies, 0);

    setText('player_rap', formatNumber(
      Number.isFinite(summary.totalRap) && summary.totalRap ? summary.totalRap : totalRap));
    setText('player_value', formatNumber(totalValue));
    setText('player_num_limiteds', formatNumber(totalCopies));
    setText('player_unique_items', formatNumber(state.items.length));

    const best = state.items.slice().sort((a, b) => (b.value - a.value) || (b.rap - a.rap))[0];
    const bestNode = el('player_best_item');
    if (bestNode) {
      bestNode.textContent = best ? best.name : '-';
      if (best) bestNode.title = best.name;
    }

    renderInventory();

    /* First pass, from the inventory alone. Rules that need each item's
     * total supply are still working with the row's serialCount here; the
     * pass after resale-data lands corrects them. */
    refreshBadges();

    /* Thumbnails are batched, so this is one request for the whole grid. */
    API.fetchThumbnails(state.items.map(item => item.id))
      .then(map => {
        state.items.forEach(item => {
          const url = map && map.get ? map.get(item.id) : null;
          if (url) item.thumbnail = url;
        });
        renderInventory();
      })
      .catch(() => {});

    /* Which ribbon each item gets is the API's call, not ours. One batched
     * request covers the whole inventory. */
    API.getItemRestrictions(state.items.map(item => item.id))
      .then(flags => {
        if (!flags || !flags.size) return;
        state.items.forEach(item => {
          const entry = flags.get(item.id);
          if (!entry) return;
          item.limited = entry.isLimited;
          item.limitedUnique = entry.isLimitedUnique;
        });
        renderInventory();
      })
      .catch(() => {});

    /* --- history --------------------------------------------------- */

    renderRangeButtons();
    if (chartBox) {
      const loading = text('div', 'd-flex align-items-center justify-content-center h-100');
      loading.style.minHeight = '280px';
      loading.appendChild(text('span', 'lb_loading mr-2'));
      loading.appendChild(text('span', 'text-muted', 'Building history\u2026'));
      chartBox.appendChild(loading);
    }

    const resale = await API.mapLimit(
      state.items,
      ITEM_CONCURRENCY,
      item => API.fetchResaleData(item.id).catch(() => null),
    );

    let sales = 0;
    state.items.forEach((item, index) => {
      const data = resale[index];
      if (!data) return;
      item.history = Array.isArray(data.priceDataPoints) ? data.priceDataPoints : [];
      if (Number.isFinite(data.sales)) sales += data.sales;
      /* resale-data is authoritative for RAP; the inventory row can lag. */
      if (Number.isFinite(data.recentAveragePrice) && data.recentAveragePrice !== null) {
        item.rap = data.recentAveragePrice;
      }
      /* assetStock is how many copies of the item exist, which is what the
       * rarity and percentage-of-copies badges are measured against. */
      const stock = Number.isFinite(data.assetStock) ? data.assetStock : null;
      if (stock !== null && stock > 0) item.available = stock;
    });

    setText('player_total_sales', formatNumber(sales));
    setText('player_rap', formatNumber(
      state.items.reduce((sum, item) => sum + (item.rap * item.copies), 0)));

    chartState.series = buildSeries(state.items);
    renderChart();
    renderInventory();

    /* Re-run now that supply figures are real. */
    refreshBadges();
  }

  if (sortSelect) sortSelect.addEventListener('change', renderInventory);
  if (stackToggle) stackToggle.addEventListener('change', renderInventory);

  const badgeExpand = el('badges_expand');
  if (badgeExpand) {
    badgeExpand.addEventListener('click', toggleBadgeRow);
    badgeExpand.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      toggleBadgeRow();
    });
  }

  observeChartResize();
  load();
})();
