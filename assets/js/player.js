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
 * player's RAP is the sum of every owned item's last known daily price, and
 * the value is the sum of what those items were worth on that day according
 * to our own value change log. That is the only real history this backend
 * exposes - there is no per-player snapshot endpoint - so it is
 * reconstructed here rather than faked.
 */
(() => {
  'use strict';

  const API = window.WanwoodAPI;
  const VALUES = window.WolimonsValues;
  const BADGES = window.WolimonsBadges;
  const NAME_BADGES = window.WolimonsNameBadges;
  const CHART = window.WolimonsHistoryChart;
  /* The leaderboard's own roster, so the Rank field is the real rank rather
   * than a separate calculation that could disagree with the board. */
  const ROSTER = window.WolimonsRoster;
  /* Badges the site owner has handed out. Arrives from the backend shortly
   * after the page, so both badge rows are redrawn when it lands. */
  const GRANTED = window.WolimonsGrantedBadges;

  /* Resale-data is one request per unique item. Inventories are small on this
   * revival, but a whale with 100+ uniques should not open 100 sockets. */
  const ITEM_CONCURRENCY = 4;

  const el = id => document.getElementById(id);

  const nameHeading = el('player_name');
  const cardNameBar = el('player_card_name_bar');
  const cardName = el('player_card_name');
  const offsiteLink = el('player_offsite_link');
  const tradeAdsLink = el('player_trade_ads_link');
  const avatarImage = el('player_avatar');
  const statusBox = el('player_status');
  const inventoryStatus = el('inventory_status');
  const grid = el('mix_container');
  const sortSelect = el('inventory_sort');
  const stackToggle = el('stackHoardsToggle');
  const chartBox = el('player_history_chart_container');
  const holdingNotice = el('player_holding_notice');

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
      const node = icon || text('span', 'woli_badge');
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

  /* Whether the account verified in this browser is the profile on screen.
   * Verification is per-browser, so this can only ever light up the badge on
   * your own profile - it never claims anything about someone else. */
  function isLinkedAccount(userId) {
    const linked = window.WolimonsAccount?.get();
    return Boolean(linked && Number(linked.id) === Number(userId));
  }

  /*
   * Has this player verified on Wolimons? Verification is recorded on the
   * server the moment somebody proves ownership through /verify, so it is a
   * fact about the player rather than something only their own browser
   * knows - which is why the badge used to be invisible to everyone else.
   */
  async function loadSiteVerified(userId) {
    const base = (window.WOLIMONS_CONFIG && window.WOLIMONS_CONFIG.apiBase) || '';
    try {
      const response = await fetch(`${base}/api/verified?id=${encodeURIComponent(userId)}`);
      const payload = await response.json();
      if (!payload || payload.ok === false) return;
      if (payload.verified === state.siteVerified) return;
      state.siteVerified = payload.verified === true;
      renderNameBadges();
      refreshBadges();
    } catch (error) {
      /* Keep whatever the local link said. */
    }
  }

  /* Does this player hold the copy the Lucky Cat picked today? */
  async function loadLuckyCat(userId) {
    const base = (window.WOLIMONS_CONFIG && window.WOLIMONS_CONFIG.apiBase) || '';
    try {
      const response = await fetch(`${base}/api/luckycat`);
      const payload = await response.json();
      const choice = payload && payload.choice;
      const won = Boolean(choice && Number(choice.ownerId) === Number(userId));
      if (won === state.luckyCat) return;
      state.luckyCat = won;
      refreshBadges();
    } catch (error) {
      /* No draw, no badge - nothing else changes. */
    }
  }

  /*
   * What this player has gained and lost.
   *
   * Read from the server's ownership log, which is the only place the answer
   * exists - Wanwood reports who owns a copy now and has never reported who
   * owned it before. The log only covers the period since the server started
   * watching, and the note says so rather than letting a short list pass for
   * a complete one.
   */
  const itemHistory = { events: [], filter: 'all', status: null };

  async function loadItemHistory(userId) {
    const list = el('player_item_history_list');
    if (!list) return;

    list.replaceChildren();
    const loading = text('div', 'small py-2', 'Reading the ownership log\u2026');
    loading.style.color = '#7a8288';
    list.appendChild(loading);

    try {
      const base = (window.WOLIMONS_CONFIG && window.WOLIMONS_CONFIG.apiBase) || '';
      const response = await fetch(`${base}/api/ownership/player?id=${userId}&limit=200`);
      const payload = await response.json();
      if (!payload || payload.ok === false) throw new Error('refused');
      itemHistory.events = Array.isArray(payload.events) ? payload.events : [];
      itemHistory.status = payload.status || null;
    } catch (error) {
      list.replaceChildren();
      const failed = text('div', 'small py-2', 'The ownership log could not be read.');
      failed.style.color = '#7a8288';
      list.appendChild(failed);
      return;
    }
    renderItemHistory();
  }

  function renderItemHistory() {
    const list = el('player_item_history_list');
    const note = el('player_item_history_note');
    if (!list) return;

    const status = itemHistory.status || {};
    if (note) {
      const back = status.reachesBackTo
        ? new Date(status.reachesBackTo).toISOString().slice(0, 10)
        : null;
      note.textContent = status.tracking
        ? (back ? `History from ${back}` : 'History from the first reading')
        : 'Tracking has not taken its first reading yet';
    }

    const rows = itemHistory.filter === 'all'
      ? itemHistory.events
      : itemHistory.events.filter(event => event.direction === itemHistory.filter);

    list.replaceChildren();
    if (!rows.length) {
      const empty = text('div', 'small py-2', itemHistory.events.length
        ? `Nothing ${itemHistory.filter} in the recorded history.`
        : 'Nothing is recorded for this player yet.');
      empty.style.color = '#7a8288';
      list.appendChild(empty);
      return;
    }
    rows.forEach(event => list.appendChild(historyRow(event)));
  }

  /* One line: the item, which way it went, and who the other side was. */
  function historyRow(event) {
    const row = text('div', 'trade_ad_picker_row');

    const image = document.createElement('img');
    image.width = 44;
    image.height = 44;
    image.loading = 'lazy';
    image.alt = '';
    image.src = API.thumbnailUrl(event.assetId);
    row.appendChild(image);

    const body = text('div', 'flex-grow-1');
    const head = text('div', 'd-flex align-items-center flex-wrap');

    const gained = event.direction === 'gained';
    const arrow = text('span', 'mr-2', gained ? '\u2192' : '\u2190');
    arrow.style.color = gained ? '#81c784' : '#e57373';
    arrow.style.fontWeight = '700';
    head.appendChild(arrow);

    const link = document.createElement('a');
    link.href = `/item/?id=${event.assetId}`;
    link.className = 'text-truncate';
    link.style.color = '#e9ecef';
    link.textContent = event.serial
      ? `Item ${event.assetId} #${formatNumber(event.serial)}`
      : `Item ${event.assetId}`;
    head.appendChild(link);
    body.appendChild(head);

    const other = gained
      ? { id: event.from, name: event.fromName }
      : { id: event.to, name: event.toName };
    const stamp = `${new Date(event.at).toISOString().replace('T', ' ').slice(0, 16)} UTC`;

    /* Where the copy came from, when that is knowable. A mint has no other
     * side at all, and a move that predates tracking has one Wanwood does
     * not remember - both say so rather than naming nobody as somebody. */
    let detail;
    if (event.kind === 'minted') detail = `minted \u00b7 ${stamp}`;
    else if (!other.id) detail = `${gained ? 'from' : 'to'} someone \u00b7 ${stamp}`;
    else detail = `${gained ? 'from' : 'to'} ${other.name || `User ${other.id}`} \u00b7 ${stamp}`;

    const sub = text('div', 'small', detail);
    sub.style.color = '#7a8288';
    body.appendChild(sub);
    row.appendChild(body);

    return row;
  }

  /* Re-scores the current inventory and redraws the row. Safe to call more
   * than once - the profile does, because the item supply figures only
   * arrive with resale-data, after the inventory has already rendered. */
  function refreshBadges() {
    if (!BADGES) return;
    renderBadges(BADGES.evaluate({
      items: state.items,
      verified: state.verified,
      siteVerified: state.siteVerified,
      /* The badges the owner awarded this player, if the table has arrived.
       * Read fresh each time rather than stored: it lands a moment after the
       * page does, and the subscription below re-runs this when it lands. */
      granted: [
        ...(GRANTED ? GRANTED.of(state.name) : []),
        /* Holding the copy the Lucky Cat picked today earns the badge for as
         * long as they hold it. Which copy that is comes from the server, so
         * every visitor agrees and the profile does not have to redo the
         * draw itself. */
        ...(state.luckyCat ? ['lucky-cat'] : []),
      ],
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
    appendSerials(stats, item, stacked);

    link.appendChild(headingWrap);
    link.appendChild(imageWrap);
    link.appendChild(stats);
    card.appendChild(link);
    return card;
  }

  /*
   * Which copies of this item the player actually holds.
   *
   * Serial numbers are the interesting part of owning a limited, so they are
   * always on the card rather than only when hoards are unstacked. One copy
   * reads "Serial  #12"; a hoard lists them, and says "+3 more" once the row
   * would get too long to read. An item minted without serials says so
   * instead of showing a blank.
   */
  const SERIALS_SHOWN = 4;

  function appendSerials(target, item, stacked) {
    const serials = Array.isArray(item.serials) ? item.serials.filter(Boolean) : [];

    /* Unstacked cards are one copy each and carry their own serial. */
    if (!stacked) {
      if (item.serialNumber) appendSerialRow(target, 'Serial', `#${formatNumber(item.serialNumber)}`);
      return;
    }

    if (!serials.length) {
      appendSerialRow(target, item.copies > 1 ? 'Serials' : 'Serial', 'None');
      return;
    }

    const sorted = serials.slice().sort((a, b) => a - b);
    const shown = sorted.slice(0, SERIALS_SHOWN).map(n => `#${formatNumber(n)}`).join(', ');
    const rest = sorted.length - SERIALS_SHOWN;
    appendSerialRow(
      target,
      sorted.length > 1 ? 'Serials' : 'Serial',
      rest > 0 ? `${shown} +${rest} more` : shown,
      sorted.map(n => `#${formatNumber(n)}`).join(', '),
    );
  }

  function appendSerialRow(target, label, value, title) {
    const row = text('div', 'd-flex justify-content-between');
    const left = text('div');
    left.appendChild(text('small', 'text-muted', label));
    const right = text('div', 'text-truncate', value);
    right.style.color = '#c9a227';
    if (title) right.title = title;
    row.append(left, right);
    target.appendChild(row);
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
    /* The Wanwood username, as the API spells it. Owner-granted badges are
     * keyed by name rather than id, so the badge row needs it. */
    name: '',
    verified: false,
    /* True when this profile is the account linked in this browser, i.e.
     * the person proved they own it through /verify. That earns the
     * "Verified" WoliBadge, which is separate from the Verified Checkmark
     * handed to notable people. */
    siteVerified: false,
    luckyCat: false,
    joinedAt: 0,
    /* Null until the roster has been ranked. Null means "no trophy" and no
     * number, never a guessed rank. */
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

  /*
   * The drawing is history-chart.js's job - it loads Highcharts Stock and
   * applies the snapshot's theme. What belongs here is the one thing that is
   * specific to a player: turning a pile of per-item price series into a
   * single daily Value/RAP series for the whole inventory.
   */

  const DAY_MS = 24 * 60 * 60 * 1000;

  /*
   * Turn the per-item daily price points into one player-level daily series.
   *
   * Each item only has points on days it actually sold, so a plain sum would
   * make the total lurch every time an item goes quiet. Instead every item
   * carries its last known price forward, which is what RAP does anyway, and
   * the day's total is the sum of those carried values times copies owned.
   *
   * The value line is real history too, not a flat line at today's figure.
   * The backend logs every value edit to /api/changes, so replaying that log
   * gives what each item was worth on each day, and summing those gives the
   * player's value as it actually stood back then. An item nobody has
   * re-valued simply holds one figure the whole way across, which is the
   * truth about it.
   */
  function buildSeries(items, changes) {
    const dayKeys = new Set();
    items.forEach(item => {
      item.history.forEach(point => dayKeys.add(Math.floor(point.time / DAY_MS)));
    });

    /* Value edits, oldest first, grouped by the item they belong to. Days a
     * value moved are days the chart must have a point for, even if nothing
     * sold that day. */
    const editsFor = new Map();
    (Array.isArray(changes) ? changes : []).forEach(change => {
      if (!change || change.field !== 'value' || !Number.isFinite(change.at)) return;
      const id = Number(change.id);
      if (!editsFor.has(id)) editsFor.set(id, []);
      editsFor.get(id).push(change);
      dayKeys.add(Math.floor(change.at / DAY_MS));
    });
    editsFor.forEach(list => list.sort((a, b) => a.at - b.at));

    if (!dayKeys.size) return [];

    /* Today anchors the right-hand end, so the line runs to now rather than
     * stopping at whenever the last sale happened to be. */
    dayKeys.add(Math.floor(Date.now() / DAY_MS));

    const days = [...dayKeys].sort((a, b) => a - b);
    /* Walk each item's points in step with the shared day axis. */
    const cursors = items.map(() => 0);
    const carried = items.map(() => null);
    const series = [];

    /* What an item was worth at a given moment: the value the last edit on or
     * before that moment set, or - before any edit - whatever the first edit
     * replaced. With no edits at all the current curated figure stands. */
    const valueAt = (item, when) => {
      const edits = editsFor.get(Number(item.id));
      if (!edits || !edits.length) return Number(item.value) || 0;
      let current = Number(edits[0].old) || 0;
      edits.forEach(edit => {
        if (edit.at <= when) current = Number(edit.new) || 0;
      });
      return current;
    };

    days.forEach(day => {
      /* Measure each day at its end, so an edit made during that day is
       * already reflected in the point drawn for it. */
      const when = day * DAY_MS + (DAY_MS - 1);
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
        value += valueAt(item, when) * item.copies;
      });
      series.push({ time: day * DAY_MS, rap, value });
    });

    return series;
  }

  function renderChart(rows) {
    if (!chartBox) return;
    if (!CHART) {
      chartBox.textContent = '';
      const failed = text('div', 'd-flex align-items-center justify-content-center text-muted h-100',
        'The chart script failed to load.');
      failed.style.minHeight = '220px';
      chartBox.appendChild(failed);
      return;
    }
    CHART.render(chartBox, rows, { since: state.joinedAt || 0 });
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

  /*
   * The player's real position on the leaderboard.
   *
   * This used to read a 'wolimons_leaderboard_v1' sessionStorage entry that
   * nothing has ever written, so the answer was always null and every profile
   * read "Unranked". Now it asks the roster - the same scan the leaderboard
   * is built from, ordered by the same key - so the number here is the number
   * on the board, and opening a profile first gives the same answer as
   * opening the leaderboard first.
   *
   * The roster is cached for ten minutes and shared between the pages, so
   * arriving from /leaderboard or /players costs nothing. Arriving cold means
   * the scan runs, which is why this is done in the background and the field
   * is filled in when it lands rather than holding the whole page up.
   *
   * Null is a real answer, not a failure: a player who owns no collectibles
   * is not on the board, and holding accounts are kept off it on purpose.
   * Both are shown as "Unranked" rather than being given a made-up number.
   */
  async function loadRank(userId) {
    if (!ROSTER || typeof ROSTER.rankOf !== 'function') return;

    setText('player_rank', 'Ranking\u2026');
    let rank = null;
    try {
      rank = await ROSTER.rankOf(userId);
    } catch (error) {
      /* Wanwood unreachable. The rest of the profile still loaded from its
       * own requests, so say the rank is unknown rather than "Unranked",
       * which would read as a claim that they are not on the board. */
      setText('player_rank', '-');
      return;
    }

    setText('player_rank', rank ? `#${rank}` : 'Unranked');
    state.rank = rank;
    /* The rank-#1 trophy is one of the name badges, so the row is rebuilt
     * once the real number is in. */
    renderNameBadges();
  }

  async function load() {
    const userId = readUserId();
    if (!userId) {
      setStatus(statusBox, 'No player selected. Open a profile from the leaderboard.');
      renderName('Unknown player');
      return;
    }
    state.userId = userId;

    /* Comments only need the player id, so they mount immediately - before
     * the profile and inventory fetches, which can be slow. The section is
     * therefore on screen even while the rest of the page is still loading. */
    if (window.WolimonsComments) {
      window.WolimonsComments.mount({
        target: `player:${userId}`,
        listId: 'player_comments_list',
        boxId: 'player_comments_box',
      });
    }

    if (offsiteLink) {
      offsiteLink.href = `${API.SITE_BASE}/users/${userId}/profile`;
      offsiteLink.classList.remove('d-none');
    }

    /* Their trade ads, once there is a player to point the link at. */
    if (tradeAdsLink) {
      tradeAdsLink.href = `/playertrades/?id=${userId}`;
      tradeAdsLink.classList.remove('d-none');
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

    state.name = name;
    renderName(name);
    document.title = `${name} - Wanwood Player Profile - Wolimons`;

    /* Terminated players' limiteds are moved onto a holding account. It is
     * left out of the rankings (see player-roster.js) and says so here, with
     * the avatar blurred so the page does not read as somebody's profile.
     * Everything else on the page is left alone - the items really are on
     * this account, and that is the useful part. */
    const CONFIG = window.WOLIMONS_CONFIG;
    const holding = Boolean(CONFIG) && (
      (CONFIG.isHoldingAccountId && CONFIG.isHoldingAccountId(userId))
      || (CONFIG.isHoldingAccount && CONFIG.isHoldingAccount(name))
    );
    if (holding) {
      if (holdingNotice) holdingNotice.hidden = false;
      if (avatarImage) avatarImage.classList.add('holding_account_avatar');
    }

    /* Fed to the badge rules once the inventory is in. Verified is strictly
     * what the API reports - nothing here is granted for existing. */
    state.verified = Boolean(profile && profile.isVerified === true);
    /* Local link first so the badge is instant for whoever is signed in,
     * then the server's record, which is what makes it show to everybody
     * else too. */
    state.siteVerified = isLinkedAccount(userId);
    renderNameBadges();
    loadSiteVerified(userId);
    loadLuckyCat(userId);
    loadItemHistory(userId);

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
      /* The chart's x-axis starts the day this player joined. */
      state.joinedAt = Date.parse(profile.created) || 0;
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

    /* Deliberately not awaited: building the roster from scratch takes a
     * couple of seconds, and the inventory below is the reason people opened
     * the page. The Rank field fills itself in when the answer arrives. */
    loadRank(userId);

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

    /* Our own value change log, for the Value line on the chart. Every value
     * edit is recorded with its date, so the chart can show what this
     * inventory was worth over time instead of drawing today's figure flat
     * across the whole history. A backend that cannot answer just means the
     * value line holds steady, so this never blocks the chart. */
    const changes = await fetch(`${API.API_BASE}/api/changes?limit=1000`)
      .then(response => response.json())
      .then(payload => (payload && payload.ok ? payload.changes : []))
      .catch(() => []);

    renderChart(buildSeries(state.items, changes));
    renderInventory();

    /* Re-run now that supply figures are real. */
    refreshBadges();
  }

  document.querySelectorAll('[data-history-filter]').forEach(button => {
    button.addEventListener('click', () => {
      itemHistory.filter = button.dataset.historyFilter;
      document.querySelectorAll('[data-history-filter]').forEach(other => {
        const on = other === button;
        other.setAttribute('aria-pressed', on ? 'true' : 'false');
        other.classList.toggle('active', on);
      });
      renderItemHistory();
    });
  });

  if (sortSelect) sortSelect.addEventListener('change', renderInventory);
  if (stackToggle) stackToggle.addEventListener('change', renderInventory);

  /* ------------------------------------------------------------------ */
  /* Share inventory                                                     */
  /* ------------------------------------------------------------------ */

  /*
   * The Share inventory button opens a popup, says Loading, and when the
   * style sheet is drawn and uploaded the popup reports success in green
   * with the share link. The drawing itself lives in inventory-art.js, the
   * same renderer the /inventoryshare page uses.
   */
  const STYLE_ART = window.WolimonsInventoryArt;

  function showShareModal(open) {
    const modal = document.getElementById('share_inventory_modal');
    if (!modal) return;
    modal.classList.toggle('show', open);
    modal.style.display = open ? 'block' : 'none';
    modal.setAttribute('aria-hidden', open ? 'false' : 'true');
    document.body.classList.toggle('modal-open', open);
  }

  function shareModalStatus(message, tone) {
    const box = document.getElementById('share_modal_status');
    if (!box) return;
    box.textContent = message;
    box.style.color = tone === 'good' ? '#81c784'
      : tone === 'bad' ? '#e57373'
        : '#adb5bd';
  }

  async function shareInventory() {
    const result = document.getElementById('share_modal_result');
    const urlBox = document.getElementById('share_modal_url');
    if (!STYLE_ART) return;

    showShareModal(true);
    if (result) result.classList.add('d-none');
    if (urlBox) urlBox.value = '';

    if (!state.items || !state.items.length) {
      shareModalStatus('This player owns no collectibles to picture.', 'bad');
      return;
    }

    shareModalStatus('Loading\u2026');
    try {
      const top = state.items.slice()
        .sort((a, b) => (b.value - a.value) || (b.rap - a.rap) || a.name.localeCompare(b.name));

      /* The grid loads its thumbnails lazily, so a share clicked early would
       * draw blanks. Resolve them all first - the call is memoised, so when
       * they have already landed this costs nothing. */
      if (API) {
        try {
          const map = await API.fetchThumbnails(top.map(item => item.id));
          top.forEach(item => {
            const url = map && map.get ? map.get(item.id) : null;
            if (url) item.thumbnail = url;
          });
        } catch (error) {
          /* Missing thumbnails leave blank tiles, not a broken share. */
        }
      }

      const canvas = await STYLE_ART.render({
        name: state.name || 'Player',
        items: top.map(item => ({
          name: item.name,
          value: item.value,
          rap: item.rap,
          copies: item.copies,
          src: item.thumbnail || (API ? API.thumbnailUrl(item.id) : ''),
        })),
        totals: {
          value: state.items.reduce((sum, item) => sum + item.value * item.copies, 0),
          rap: state.items.reduce((sum, item) => sum + item.rap * item.copies, 0),
          copies: state.items.reduce((sum, item) => sum + item.copies, 0),
        },
      });

      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85));
      if (!blob) throw new Error('The browser refused to export the image.');

      shareModalStatus('Uploading\u2026');
      const response = await fetch(
        `${API && API.API_BASE ? API.API_BASE : ''}/api/inventory-card`
        + `?id=${Number(state.userId) || 0}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'image/jpeg' },
          body: blob,
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || `The upload failed (${response.status}).`);
      }

      shareModalStatus('Done - your style sheet is ready!', 'good');
      if (result && urlBox) {
        urlBox.value = `${window.location.origin}${payload.url}`;
        result.classList.remove('d-none');
      }
    } catch (error) {
      shareModalStatus(error.message, 'bad');
    }
  }

  const shareButton = document.getElementById('player_share_inventory');
  if (shareButton) shareButton.addEventListener('click', shareInventory);

  /* Popup wiring - the manual show/hide the site's other modals use. */
  ['share_modal_close', 'share_modal_close_x'].forEach(id => {
    const button = document.getElementById(id);
    if (button) button.addEventListener('click', () => showShareModal(false));
  });
  const shareModal = document.getElementById('share_inventory_modal');
  if (shareModal) {
    shareModal.addEventListener('click', event => {
      if (event.target === shareModal) showShareModal(false);
    });
  }
  const shareModalCopy = document.getElementById('share_modal_copy');
  if (shareModalCopy) {
    shareModalCopy.addEventListener('click', () => {
      const box = document.getElementById('share_modal_url');
      if (!box || !box.value) return;
      box.select();
      box.setSelectionRange(0, box.value.length);
      try { document.execCommand('copy'); } catch (error) { /* user can Ctrl+C */ }
      const original = shareModalCopy.textContent;
      shareModalCopy.textContent = 'Copied';
      window.setTimeout(() => { shareModalCopy.textContent = original; }, 1200);
    });
  }

  const badgeExpand = el('badges_expand');
  if (badgeExpand) {
    badgeExpand.addEventListener('click', toggleBadgeRow);
    badgeExpand.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      toggleBadgeRow();
    });
  }

  /* Verifying or signing out while the profile is open should settle the
   * badge immediately rather than waiting for a reload. */
  window.WolimonsAccount?.subscribe(() => {
    if (state.userId === null) return;
    const linked = isLinkedAccount(state.userId);
    if (linked === state.siteVerified) return;
    state.siteVerified = linked;
    refreshBadges();
  });

  /*
   * The owner's badge grants land a moment after the page does, so both rows
   * that can show one are rebuilt when they arrive: the WoliBadges strip
   * below the stats, and the icons beside the name on the profile card,
   * where Certified Wanwoodian appears.
   *
   * Guarded on the name being known - the subscription fires immediately on
   * subscribe, before the profile has loaded, and there is nothing to draw
   * for a player nobody has looked up yet.
   */
  GRANTED?.subscribe(() => {
    if (!state.name) return;
    refreshBadges();
    renderNameBadges();
  });

  load();
})();
