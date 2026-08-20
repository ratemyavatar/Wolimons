/*
 * Wolimons recent value changes (/valuechanges).
 *
 * ---------------------------------------------------------------------------
 * WHERE THE FEED COMES FROM
 * ---------------------------------------------------------------------------
 * The site's own backend, and nowhere else. Value, demand and trend are
 * community figures set by hand in the admin panel - Wanwood has never heard
 * of them - so the only honest history is the one the backend records as
 * those edits are made:
 *
 *     GET /api/changes?limit=  ->  { ok, changes: [ { id, field, old, new,
 *                                                     by, at } ] }
 *
 * Newest first. `old` is null when a field was never set before, which is how
 * a first valuation appears. Nothing here is inferred, back-filled or
 * estimated: an item that has never been edited simply has no entries, and a
 * fresh install shows an empty feed rather than a fabricated one.
 *
 * ---------------------------------------------------------------------------
 * WHAT A CARD SHOWS
 * ---------------------------------------------------------------------------
 * The item, what changed, the old and new figures with an arrow coloured by
 * direction, and when. Item names and thumbnails are the one thing that does
 * come from Wanwood - the log stores ids, and the names are looked up in a
 * single batched call for the ids on screen.
 */
(() => {
  'use strict';

  const API = window.WanwoodAPI;
  const CONFIG = window.WOLIMONS_CONFIG || {};
  const API_BASE = CONFIG.apiBase || '';

  const PAGE_SIZE = 30;
  /* How much history to pull. The backend keeps a bounded log, and this is
   * comfortably more than anyone pages through. */
  const FEED_LIMIT = 500;

  const grid = document.getElementById('changes_mix_container');
  const statusBox = document.getElementById('changes_status');
  const searchBox = document.getElementById('search_textbox');
  const searchClear = document.getElementById('search_textbox_clear');
  const paginationTop = document.getElementById('pagination_control_top');
  const paginationBottom = document.getElementById('pagination_control_bottom');
  const fieldButtons = [...document.querySelectorAll('[data-change-field]')];

  /* Every change the backend gave us, newest first. */
  let changes = [];
  /* The rows currently on screen (all of them, or the filtered subset). */
  let visible = [];
  let page = 1;
  /* Which field filters are switched on. Empty means "all of them". */
  const fields = new Set();
  /* assetId -> { name, thumbnail }, filled in as pages are drawn. */
  const items = new Map();

  const formatNumber = number => Number(number || 0).toLocaleString('en-US');

  const text = (tag, className, value) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined) node.textContent = value;
    return node;
  };

  const slugify = value => String(value || 'unnamed')
    .replace(/'/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unnamed';

  function setStatus(message, { spinner = false } = {}) {
    if (!statusBox) return;
    statusBox.textContent = '';
    if (!message) {
      statusBox.classList.add('d-none');
      return;
    }
    statusBox.classList.remove('d-none');
    const box = text('div', 'text-center py-4 small');
    box.style.color = '#9aa3aa';
    box.textContent = message;
    if (spinner) box.classList.add('lb_loading');
    statusBox.appendChild(box);
  }

  /* ------------------------------------------------------------------ */
  /* Time                                                                */
  /* ------------------------------------------------------------------ */

  const MINUTE = 60 * 1000;
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;

  /* "6 hours ago". Deliberately coarse - the exact stamp is on the line
   * below it, so this only has to give the sense of how fresh a change is. */
  function relativeTime(at) {
    const gap = Date.now() - Number(at || 0);
    if (gap < MINUTE) return 'just now';
    const plural = (count, unit) => `${count} ${unit}${count === 1 ? '' : 's'} ago`;
    if (gap < HOUR) return plural(Math.floor(gap / MINUTE), 'minute');
    if (gap < DAY) return plural(Math.floor(gap / HOUR), 'hour');
    if (gap < 30 * DAY) return plural(Math.floor(gap / DAY), 'day');
    if (gap < 365 * DAY) return plural(Math.floor(gap / (30 * DAY)), 'month');
    return plural(Math.floor(gap / (365 * DAY)), 'year');
  }

  /* The exact moment, in UTC, so a reader anywhere reads the same string as
   * everyone else rather than one shifted into their own timezone. */
  function utcStamp(at) {
    const when = new Date(Number(at || 0));
    if (Number.isNaN(when.getTime())) return '';
    const pad = number => String(number).padStart(2, '0');
    const hours = when.getUTCHours();
    const suffix = hours < 12 ? 'AM' : 'PM';
    const hour12 = hours % 12 === 0 ? 12 : hours % 12;
    return `${when.getUTCFullYear()}-${pad(when.getUTCMonth() + 1)}-${pad(when.getUTCDate())} `
      + `${pad(hour12)}:${pad(when.getUTCMinutes())}:${pad(when.getUTCSeconds())} ${suffix} UTC`;
  }

  /* ------------------------------------------------------------------ */
  /* Cards                                                               */
  /* ------------------------------------------------------------------ */

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const ARROW_UP = 'M15 20H9v-8H4.161L12 4.161 19.839 12H15v8z';
  const ARROW_DOWN = 'M9 4h6v8h4.839L12 19.839 4.161 12H9V4z';

  const FIELD_TITLES = {
    value: 'Value Changed',
    demand: 'Demand Changed',
    trend: 'Trend Changed',
  };

  /*
   * Demand and trend are words, not numbers, so "up" and "down" have to come
   * from their running order rather than from arithmetic. Both lists run best
   * to worst, which is the order the admin panel offers them in.
   */
  const DEMAND_ORDER = ['High', 'Decent', 'Low', 'Terrible'];
  const TREND_ORDER = ['Raising', 'Stable', 'Fluctuating', 'Unstable', 'Lowering'];

  /*
   * Which way a change went: 1 up, -1 down, 0 when it cannot be said. A first
   * valuation has nothing to compare against, so it gets no arrow at all
   * rather than a misleading green one.
   */
  function direction(change) {
    if (change.old === null || change.old === undefined) return 0;
    if (change.new === null || change.new === undefined) return 0;
    if (change.field === 'value') {
      const before = Number(change.old) || 0;
      const after = Number(change.new) || 0;
      if (after === before) return 0;
      return after > before ? 1 : -1;
    }
    const order = change.field === 'demand' ? DEMAND_ORDER : TREND_ORDER;
    const before = order.indexOf(change.old);
    const after = order.indexOf(change.new);
    if (before < 0 || after < 0 || before === after) return 0;
    /* Earlier in the list is better, so a smaller index is a move upwards. */
    return after < before ? 1 : -1;
  }

  function arrowNode(way) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('xmlns', SVG_NS);
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('width', '1em');
    svg.setAttribute('height', '1em');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.style.verticalAlign = '-0.125em';
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', way > 0 ? ARROW_UP : ARROW_DOWN);
    path.setAttribute('fill', way > 0 ? 'lime' : 'red');
    svg.appendChild(path);
    return svg;
  }

  /* A field's value as it should read on a card. Numbers are grouped; a field
   * that was never set says so rather than showing a bare dash. */
  function readable(change, which) {
    const raw = change[which];
    if (raw === null || raw === undefined || raw === '') {
      return change.field === 'value' ? 'Unvalued' : 'Unassigned';
    }
    return change.field === 'value' ? formatNumber(raw) : String(raw);
  }

  function statRow(label, build) {
    const row = text('div', 'd-flex justify-content-between');
    const left = text('div');
    left.appendChild(text('small', 'text-muted', label));
    const right = text('div');
    build(right);
    row.append(left, right);
    return row;
  }

  function changeCard(change) {
    const item = items.get(change.id) || {};
    const name = item.name || `Item ${change.id}`;

    const card = text('div', 'pb-2 mb-3 shadow_md_35 shift_up_md mix_item');
    card.dataset.changeId = `${change.id}-${change.field}-${change.at}`;
    card.style.backgroundColor = '#30363c';

    const link = document.createElement('a');
    link.href = `/item/?id=${change.id}&name=${slugify(item.name)}`;

    const headingWrap = document.createElement('div');
    const heading = text('h6', 'change_item_name px-2 text-light my-1 text-truncate', name);
    heading.title = name;
    headingWrap.appendChild(heading);

    const imageWrap = text('div',
      'std_item_card_img_bkgnd_gradient text-center border-top border-bottom border-dark');
    const image = document.createElement('img');
    image.className = 'd-block-inline my-1';
    image.src = item.thumbnail || (API ? API.thumbnailUrl(change.id) : '');
    image.width = 100;
    image.height = 100;
    image.alt = `${name} thumbnail`;
    image.loading = 'lazy';
    imageWrap.appendChild(image);

    const body = text('div', 'px-2 pt-1');

    const titleRow = text('div', 'd-flex justify-content-between');
    const titleCell = text('div');
    const title = text('span', 'change_title text-truncate',
      FIELD_TITLES[change.field] || 'Changed');
    title.style.color = '#1aa3e3';
    titleCell.appendChild(title);
    titleRow.appendChild(titleCell);
    body.appendChild(titleRow);

    body.appendChild(statRow('Old', cell => {
      cell.appendChild(text('span', 'change_stat text-light text-truncate',
        readable(change, 'old')));
    }));

    body.appendChild(statRow('New', cell => {
      const span = text('span', 'change_stat text-light text-truncate');
      const way = direction(change);
      if (way !== 0) {
        span.appendChild(arrowNode(way));
        span.appendChild(document.createTextNode(' '));
      }
      span.appendChild(document.createTextNode(readable(change, 'new')));
      cell.appendChild(span);
    }));

    const relativeRow = text('div', 'd-flex mt-2 justify-content-between');
    relativeRow.appendChild(text('span',
      'change_timestamp_relative text-success text-truncate', relativeTime(change.at)));
    body.appendChild(relativeRow);

    const stampRow = text('div', 'd-flex justify-content-between');
    stampRow.appendChild(text('span',
      'change_timestamp_utc text-muted text-light text-truncate', utcStamp(change.at)));
    body.appendChild(stampRow);

    /* Who made the change. The backend records it on every entry, and saying
     * so is the point of a public log - but a row written before anyone was
     * named simply omits the line rather than inventing an author. */
    if (change.by) {
      const byRow = text('div', 'd-flex justify-content-between');
      byRow.appendChild(text('span',
        'change_timestamp_utc text-muted text-truncate', `by ${change.by}`));
      body.appendChild(byRow);
    }

    link.append(headingWrap, imageWrap, body);
    card.appendChild(link);
    return card;
  }

  /* ------------------------------------------------------------------ */
  /* Pagination                                                          */
  /* ------------------------------------------------------------------ */

  const ARROW_PREV = 'm4.431 12.822 13 9A1 1 0 0 0 19 21V3a1 1 0 0 0-1.569-.823l-13 9a1.003 1.003 0 0 0 0 1.645z';
  const ARROW_NEXT = 'M5.536 21.886a1.004 1.004 0 0 0 1.033-.064l13-9a1 1 0 0 0 0-1.644l-13-9A1 1 0 0 0 5 3v18a1 1 0 0 0 .536.886z';

  /* The markup .simple-pagination.dark-theme already knows how to paint, so
   * no new CSS is involved. Windows to five pages with the last one pinned. */
  function pageNumbers(current, total) {
    if (total <= 7) {
      return Array.from({ length: total }, (unused, index) => index + 1);
    }
    const shown = new Set([1, total, current]);
    for (let offset = -1; offset <= 1; offset += 1) {
      const near = current + offset;
      if (near > 1 && near < total) shown.add(near);
    }
    [2, 3, 4, 5].forEach(early => { if (current <= 4 && early < total) shown.add(early); });

    const sorted = [...shown].filter(n => n >= 1 && n <= total).sort((a, b) => a - b);
    const out = [];
    sorted.forEach((number, index) => {
      if (index && number - sorted[index - 1] > 1) out.push('...');
      out.push(number);
    });
    return out;
  }

  function arrow(pathData) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('xmlns', SVG_NS);
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('viewBox', '0 2 25 25');
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('fill', 'currentColor');
    path.setAttribute('d', pathData);
    svg.appendChild(path);
    return svg;
  }

  function renderPagination(host, total) {
    if (!host) return;
    /* Clear first: this appends a widget and renderPage() runs on every
     * keystroke, so without it the strip would stack up copy after copy. */
    host.replaceChildren();
    if (total <= 1) return;

    const shell = text('div', 'simple-pagination dark-theme');
    const list = document.createElement('ul');

    const linkTo = (target, className, content) => {
      const item = document.createElement('li');
      const anchor = document.createElement('a');
      anchor.href = '#';
      anchor.className = className;
      anchor.dataset.page = String(target);
      if (typeof content === 'string') anchor.textContent = content;
      else anchor.appendChild(content);
      anchor.addEventListener('click', event => {
        event.preventDefault();
        if (anchor.classList.contains('disabled')) return;
        goToPage(target);
      });
      item.appendChild(anchor);
      return item;
    };

    list.appendChild(linkTo(Math.max(1, page - 1),
      `page-link-woli prev${page === 1 ? ' disabled' : ''}`, arrow(ARROW_PREV)));

    pageNumbers(page, total).forEach(entry => {
      const item = document.createElement('li');
      if (entry === '...') {
        item.appendChild(text('span', 'ellipse', '\u2026'));
        list.appendChild(item);
      } else if (entry === page) {
        item.appendChild(text('span', 'current', String(entry)));
        list.appendChild(item);
      } else {
        list.appendChild(linkTo(entry, 'page-link-woli ', String(entry)));
      }
    });

    list.appendChild(linkTo(Math.min(total, page + 1),
      `page-link-woli next${page === total ? ' disabled' : ''}`, arrow(ARROW_NEXT)));

    shell.appendChild(list);
    host.appendChild(shell);
  }

  /* ------------------------------------------------------------------ */
  /* Rendering                                                           */
  /* ------------------------------------------------------------------ */

  function renderPage() {
    if (!grid) return;
    grid.replaceChildren();

    const total = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
    if (page > total) page = total;

    if (!visible.length) {
      renderPagination(paginationTop, 0);
      renderPagination(paginationBottom, 0);
      const term = searchBox ? searchBox.value.trim() : '';
      if (term) {
        setStatus(`No change matches "${term}".`);
      } else if (fields.size) {
        setStatus('No changes of that kind have been made yet.');
      } else if (changes.length) {
        setStatus('No changes to show.');
      } else {
        /* The honest empty state. Values are set by hand, so a site whose
         * table has never been touched genuinely has no history. */
        setStatus('No value changes have been recorded yet. '
          + 'Changes appear here as soon as an item\u2019s value, demand or trend is set.');
      }
      return;
    }

    setStatus('');
    const start = (page - 1) * PAGE_SIZE;
    const shown = visible.slice(start, start + PAGE_SIZE);
    shown.forEach(change => grid.appendChild(changeCard(change)));

    renderPagination(paginationTop, total);
    renderPagination(paginationBottom, total);

    /* Deliberately not awaited: the cards are already up, and the real names
     * and thumbnails drop in a moment later. */
    ensureItems(shown);
  }

  function goToPage(target) {
    page = Math.max(1, target);
    renderPage();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /*
   * Item names and thumbnails for the page being looked at.
   *
   * The log stores ids only, so the names have to come from Wanwood. Asking
   * for the whole feed's worth at once would be a large request for rows
   * nobody has scrolled to, so each page fetches its own in one batched call
   * and the answers are kept for the rest of the visit.
   */
  async function ensureItems(shown) {
    if (!API || !API.getItemDetails) return;
    const missing = [...new Set(shown.map(change => change.id))]
      .filter(id => !items.has(id));
    if (!missing.length) return;

    /* Mark them first so a second render cannot queue the same lookups. */
    missing.forEach(id => items.set(id, {}));

    let details = [];
    try {
      details = await API.getItemDetails(missing, { includePrice: false });
    } catch (error) {
      /* Leave the placeholder ids on screen rather than blanking the feed. */
      return;
    }

    let changed = false;
    details.forEach(detail => {
      const id = Number(detail.id ?? detail.assetId);
      const name = String(detail.name || '').trim();
      if (!Number.isSafeInteger(id) || !name) return;
      items.set(id, { name, thumbnail: detail.thumbnail || API.thumbnailUrl(id) });
      changed = true;
    });

    /* Only redraw if the reader is still on the page these belong to. */
    if (changed && shown.some(change => visible.includes(change))) renderPage();
  }

  /* ------------------------------------------------------------------ */
  /* Filtering                                                           */
  /* ------------------------------------------------------------------ */

  function applyFilter({ keepPage = false } = {}) {
    const term = searchBox ? searchBox.value.trim().toLowerCase() : '';
    visible = changes.filter(change => {
      if (fields.size && !fields.has(change.field)) return false;
      if (!term) return true;
      /* Match the item's name once it is known, and its id either way, so a
       * search works before the names have been fetched. */
      const item = items.get(change.id);
      const name = item && item.name ? item.name.toLowerCase() : '';
      return name.includes(term) || String(change.id).includes(term);
    });
    if (!keepPage) page = 1;
    renderPage();
  }

  function initFilters() {
    if (searchBox) {
      let timer = 0;
      searchBox.addEventListener('input', () => {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => applyFilter(), 200);
      });
    }
    if (searchClear && searchBox) {
      searchClear.addEventListener('click', event => {
        event.preventDefault();
        searchBox.value = '';
        applyFilter();
        searchBox.focus();
      });
    }

    /* The chips are the catalog's .filter-button, toggled the same way, so
     * they look and behave identically to the ones over there. */
    fieldButtons.forEach(button => {
      button.addEventListener('click', event => {
        event.preventDefault();
        const field = button.dataset.changeField;
        const on = !fields.has(field);
        if (on) fields.add(field);
        else fields.delete(field);
        button.setAttribute('aria-pressed', on ? 'true' : 'false');
        button.classList.toggle('active', on);
        applyFilter();
      });
    });
  }

  /* ------------------------------------------------------------------ */
  /* Boot                                                                */
  /* ------------------------------------------------------------------ */

  async function load() {
    setStatus('Loading recent changes\u2026', { spinner: true });

    let payload = null;
    try {
      const response = await fetch(`${API_BASE}/api/changes?limit=${FEED_LIMIT}`, {
        headers: { Accept: 'application/json' },
      });
      const body = await response.text();
      /* A cold free-tier instance answers with an HTML holding page, which
       * would otherwise blow up in JSON.parse with a useless message. */
      try {
        payload = JSON.parse(body);
      } catch (error) {
        throw new Error('The Wolimons API is still waking up. Try again in a moment.');
      }
      if (!response.ok || !payload || payload.ok !== true) {
        throw new Error((payload && payload.error) || `The API answered ${response.status}.`);
      }
    } catch (error) {
      setStatus(error.message || 'Could not reach the Wolimons API for the change log.');
      return;
    }

    changes = (Array.isArray(payload.changes) ? payload.changes : [])
      .filter(change => change && Number.isFinite(Number(change.at)))
      .sort((a, b) => b.at - a.at);

    applyFilter();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { initFilters(); load(); });
  } else {
    initFilters();
    load();
  }
})();
