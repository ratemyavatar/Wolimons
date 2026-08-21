/*
 * Wolimons - the 2018 pages.
 *
 * These pages are the 2018 site: their markup came out of the archived
 * copies and was kept. Nothing in here writes HTML of its own. Where a page
 * repeats an element - a catalog card, a player card, a table row - the build
 * tool moved one real 2018 element into a <template>, and this clones that
 * and fills in the text. Every node on screen is therefore 2018 markup
 * carrying today's data.
 *
 * The data comes from exactly the same places the modern pages use:
 * wanwood-api.js for anything Wanwood knows, values.js for anything only the
 * value team knows, and this site's own API for the change log and the
 * recorded player history. There is no second source of truth for the old
 * pages, so the two versions of the site can never disagree.
 *
 * Which page this is comes from data-page-2018 on <body>.
 */
(() => {
  'use strict';

  const API = window.WanwoodAPI;
  const CONFIG = window.WOLIMONS_CONFIG || {};
  const API_BASE = CONFIG.apiBase || '';
  const SITE_BASE = CONFIG.siteBase || 'https://wanwoo.xyz';
  const CHART = window.WolimonsHistoryChart;
  const PREFS = window.WolimonsPrefs;

  /* values.js, read defensively - a browser holding an older cached copy of
   * it still defines WolimonsValues, just without some of the accessors. */
  const VALUES = (() => {
    const table = window.WolimonsValues || {};
    const call = (name, id, fallback) => (typeof table[name] === 'function'
      ? table[name](id)
      : fallback);
    return {
      raw: table,
      ready: table.ready && typeof table.ready.then === 'function' ? table.ready : Promise.resolve(),
      all: () => table.all || {},
      get: id => Number(call('get', id, 0)) || 0,
      demand: id => call('demand', id, null),
      trend: id => call('trend', id, null),
      note: id => call('note', id, ''),
      categories: id => {
        const list = call('categories', id, []);
        return Array.isArray(list) ? list : [];
      },
    };
  })();

  const page = document.body ? document.body.getAttribute('data-page-2018') : '';
  if (!page) return;

  const EMPTY = '-';
  const PAGE_SIZE = 24;

  const TYPE_NAMES = {
    8: 'Hat', 18: 'Face', 19: 'Gear', 41: 'Hair Accessory', 42: 'Face Accessory',
    43: 'Neck Accessory', 44: 'Shoulder Accessory', 45: 'Front Accessory',
    46: 'Back Accessory', 47: 'Waist Accessory',
  };

  const number = value => (Number.isFinite(Number(value)) ? Number(value) : null);
  const money = value => (number(value) === null ? EMPTY : Number(value).toLocaleString('en-US'));
  const byId = id => document.getElementById(id);
  const query = () => new URLSearchParams(window.location.search);
  const slugify = value => String(value)
    .replace(/'/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unnamed';

  /* ------------------------------------------------------------------ */
  /* The page's own markup                                               */
  /* ------------------------------------------------------------------ */

  /* A fresh copy of one of this page's own 2018 elements. */
  function fromTemplate(name) {
    const template = byId(`tpl_${name}`);
    if (!template || !template.content) return null;
    const first = template.content.firstElementChild;
    return first ? first.cloneNode(true) : null;
  }

  /* The container the build tool emptied, ready to be filled again. */
  function container(name) {
    return document.querySelector(`[data-2018-container="${name}"]`);
  }

  /*
   * A note in place of content: loading, empty, or broken.
   *
   * The only element this file creates. Every page needs somewhere to say
   * "nothing here yet", the archived copies were all saved with data in them,
   * so none of them carries an empty state to borrow.
   */
  function say(box, words) {
    if (!box) return;
    box.textContent = '';
    const note = document.createElement('p');
    note.className = 'text-center text-muted my-4 w-100';
    note.textContent = words;
    box.appendChild(note);
  }

  function fill(box, nodes) {
    if (!box) return;
    box.textContent = '';
    nodes.forEach(node => box.appendChild(node));
  }

  /*
   * Fill one "<small>Label</small> ... <p>figure</p>" row.
   *
   * Rows are found by the label they already carry rather than by position,
   * so a card keeps working where two archived copies differ, and every copy
   * of a row is filled - the item page prints each figure twice, once in the
   * desktop layout and once in the phone one.
   */
  function setRow(node, label, value) {
    const wanted = String(label).toLowerCase();
    let found = false;
    node.querySelectorAll('small').forEach(small => {
      if (small.textContent.trim().toLowerCase() !== wanted) return;
      const row = small.closest('.d-flex, .list-group-item');
      if (!row) return;
      const figure = row.querySelector('p, .card-text');
      if (!figure) return;
      figure.textContent = value === null || value === undefined ? EMPTY : String(value);
      found = true;
    });
    return found;
  }

  function setTitle(node, text) {
    const title = node.querySelector('.card-title, h6');
    if (!title) return;
    title.textContent = text;
    title.setAttribute('title', text);
  }

  function setImage(node, src, alt) {
    const image = node.querySelector('img');
    if (!image) return;
    if (src) image.src = src;
    image.alt = alt || '';
    image.loading = 'lazy';
  }

  function setLink(node, href) {
    const link = node.matches('a') ? node : node.querySelector('a');
    if (link) link.href = href;
  }

  /* ------------------------------------------------------------------ */
  /* Items                                                               */
  /* ------------------------------------------------------------------ */

  /*
   * Every collectible on Wanwood, with the community's figures attached.
   *
   * Fetched once per page and shared by the catalog, the item table, the
   * deals page and the trade calculator - the same single fetch the modern
   * catalog does, for the same reason: Wanwood has a few dozen collectibles
   * in total, so "all of them" is a couple of requests.
   */
  let itemsPromise = null;

  function loadItems({ includePrice = false } = {}) {
    if (itemsPromise) return itemsPromise;
    itemsPromise = (async () => {
      await VALUES.ready;
      const ids = await API.listAllCollectibles();
      if (!ids.length) return [];
      const details = await API.getItemDetails(ids, { includePrice });
      const byIdMap = new Map(details.map(detail => [detail.id, detail]));
      return ids
        .map((id, index) => {
          const detail = byIdMap.get(id);
          if (!detail || !detail.name) return null;
          const categories = VALUES.categories(id);
          const restrictions = detail.itemRestrictions || [];
          let available = detail.unitsAvailableForConsumption;
          if (available === null || available === undefined) {
            const stock = number(detail.serialCount);
            const sold = number(detail.saleCount);
            available = stock !== null && sold !== null && stock > 0
              ? Math.max(0, stock - sold)
              : null;
          }
          return {
            id,
            order: index,
            name: detail.name.trim(),
            assetType: detail.assetType,
            rap: number(detail.rap),
            price: number(detail.lowestPrice ?? detail.price),
            value: VALUES.get(id),
            demand: VALUES.demand(id),
            trend: VALUES.trend(id),
            categories,
            rare: categories.includes('rare'),
            projected: categories.includes('projected'),
            limitedUnique: restrictions.includes('LimitedUnique'),
            available: number(available),
            thumbnail: detail.thumbnail || API.thumbnailUrl(id),
          };
        })
        .filter(Boolean);
    })();
    return itemsPromise;
  }

  /* Items this browser has asked not to see on the browsing pages. */
  function visible(items) {
    if (!PREFS || typeof PREFS.hidesCategories !== 'function') return items;
    return items.filter(item => !PREFS.hidesCategories(item.categories));
  }

  /* One catalog-style card, from this page's own template. */
  function itemCard(item, rows) {
    const node = fromTemplate('item');
    if (!node) return null;
    setTitle(node, item.name);
    setImage(node, item.thumbnail, `${item.name} thumbnail`);
    setLink(node, `/item/?id=${item.id}`);
    Object.entries(rows).forEach(([label, value]) => setRow(node, label, value));
    return node;
  }

  /* ------------------------------------------------------------------ */
  /* Pagination - the control the old pages already have                 */
  /* ------------------------------------------------------------------ */

  /*
   * simplePagination's markup, reused rather than redrawn: the first time a
   * control is touched its list is saved as a specimen, and every page of
   * results is built by cloning the <li>s out of that specimen.
   */
  const paginationSpecimens = new WeakMap();

  function paginate(control, pages, current, go) {
    if (!control) return;
    if (!paginationSpecimens.has(control)) {
      paginationSpecimens.set(control, control.cloneNode(true));
    }
    const specimen = paginationSpecimens.get(control);

    control.style.display = pages > 1 ? '' : 'none';
    if (pages <= 1) {
      control.textContent = '';
      return;
    }

    const sample = {
      prev: specimen.querySelector('li.disabled, li:first-child'),
      active: specimen.querySelector('li.active'),
      plain: [...specimen.querySelectorAll('li')].find(item => item.querySelector('a.page-link:not(.next):not(.prev)')),
      next: [...specimen.querySelectorAll('li')].find(item => item.querySelector('a.next')),
    };
    if (!sample.plain || !sample.active) return;

    const list = document.createElement('ul');
    const step = (item, label, target, enabled = true) => {
      const node = item.cloneNode(true);
      const cell = node.querySelector('a, span');
      if (cell) {
        cell.textContent = label;
        if (cell.tagName === 'A') cell.href = '#';
      }
      node.classList.toggle('disabled', !enabled);
      if (enabled && target) {
        node.addEventListener('click', event => {
          event.preventDefault();
          go(target);
        });
      }
      list.appendChild(node);
    };

    if (sample.prev) step(sample.prev, 'Prev', current > 1 ? current - 1 : 0, current > 1);
    for (let index = 1; index <= pages; index += 1) {
      if (index === current) {
        const node = sample.active.cloneNode(true);
        const cell = node.querySelector('a, span');
        if (cell) cell.textContent = String(index);
        list.appendChild(node);
      } else if (Math.abs(index - current) < 3 || index === 1 || index === pages) {
        step(sample.plain, String(index), index);
      }
    }
    if (sample.next) step(sample.next, 'Next', current < pages ? current + 1 : 0, current < pages);

    control.textContent = '';
    control.appendChild(list);
  }

  /* ------------------------------------------------------------------ */
  /* Dropdowns - the old pages' own filter menus                          */
  /* ------------------------------------------------------------------ */

  /*
   * The Sort By / Filter menus are Bootstrap dropdowns, and the plugin that
   * opened them is not here. navbar.js does that job for the navbar; these
   * are the ones on the page itself, so they are opened the same way: the
   * button's own .dropdown-menu gets the class Bootstrap would have given it.
   */
  function wireDropdowns() {
    const toggles = [...document.querySelectorAll('[data-toggle="dropdown"]')]
      .filter(toggle => !toggle.closest('nav'));

    const close = except => toggles.forEach(toggle => {
      const menu = toggle.parentElement && toggle.parentElement.querySelector('.dropdown-menu');
      if (!menu || menu === except) return;
      menu.classList.remove('show');
      toggle.setAttribute('aria-expanded', 'false');
    });

    toggles.forEach(toggle => {
      toggle.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        const menu = toggle.parentElement && toggle.parentElement.querySelector('.dropdown-menu');
        if (!menu) return;
        const open = !menu.classList.contains('show');
        close(menu);
        menu.classList.toggle('show', open);
        toggle.setAttribute('aria-expanded', String(open));
      });
    });

    document.addEventListener('click', () => close(null));
  }

  /*
   * Picking an entry out of one of those menus.
   *
   * The entries carry the old site's own hooks - data-dropdown names the
   * menu, data-field or data-category names the choice - so this listens for
   * those rather than for the words printed on them. The button's caption is
   * updated from the menu's aria-labelledby, which points straight at it.
   */
  function onPick(name, handler) {
    document.querySelectorAll(`[data-dropdown="${name}"]`).forEach(entry => {
      entry.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        const menu = entry.closest('.dropdown-menu');
        const label = menu ? byId(menu.getAttribute('aria-labelledby') || '') : null;
        if (label) label.textContent = entry.textContent.trim();
        if (menu) menu.classList.remove('show');
        handler(entry.dataset.field || entry.dataset.category || '', entry);
      });
    });
  }

  /*
   * A comparator for one of the old sort options, by the name the menu entry
   * carries. Missing figures sort to the back of both directions, so "Lowest
   * RAP" is the cheapest item that has one rather than a screen of blanks.
   */
  function comparator(field) {
    const missingLast = (key, direction) => (a, b) => {
      const left = a[key];
      const right = b[key];
      const leftGone = left === null || left === undefined || left === 0;
      const rightGone = right === null || right === undefined || right === 0;
      if (leftGone && rightGone) return String(a.name).localeCompare(String(b.name));
      if (leftGone) return 1;
      if (rightGone) return -1;
      return direction * (left - right);
    };
    const table = {
      value_descending: missingLast('value', -1),
      value_ascending: missingLast('value', 1),
      rap_descending: missingLast('rap', -1),
      rap_ascending: missingLast('rap', 1),
      rap_high_to_low: missingLast('rap', -1),
      rap_low_to_high: missingLast('rap', 1),
      best_price_descending: missingLast('price', -1),
      best_price_ascending: missingLast('price', 1),
      available_copies_descending: missingLast('available', -1),
      available_copies_ascending: missingLast('available', 1),
      copies_owned_descending: missingLast('copies', -1),
      time_owned_descending: (a, b) => (b.owned || 0) - (a.owned || 0),
      time_owned_ascending: (a, b) => (a.owned || 0) - (b.owned || 0),
      date_added_descending: (a, b) => a.order - b.order,
    };
    return table[field] || table.date_added_descending;
  }

  /* Which figure the Min / Max boxes are about. */
  const FIELDS = {
    best_price: 'price',
    rap: 'rap',
    value: 'value',
    available_copies: 'available',
  };

  function inRange(item, field, min, max) {
    if (min === null && max === null) return true;
    const figure = item[FIELDS[field] || 'value'];
    if (figure === null || figure === undefined) return false;
    if (min !== null && figure < min) return false;
    if (max !== null && figure > max) return false;
    return true;
  }

  const boxValue = id => {
    const raw = byId(id)?.value.replace(/,/g, '').trim();
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  };

  /* ------------------------------------------------------------------ */
  /* Catalog                                                             */
  /* ------------------------------------------------------------------ */

  async function loadCatalog() {
    const grid = container('item');
    if (!grid || !fromTemplate('item')) return;

    const state = { sort: 'date_added_descending', field: 'value', keyword: '', page: 1, items: [] };
    const controls = [...document.querySelectorAll('.pagination-control')];

    function render() {
      const keyword = state.keyword.toLowerCase();
      const min = boxValue('filter-min');
      const max = boxValue('filter-max');
      const rows = visible(state.items)
        .filter(item => !keyword || item.name.toLowerCase().includes(keyword))
        .filter(item => inRange(item, state.field, min, max))
        .sort(comparator(state.sort));

      const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
      state.page = Math.min(state.page, pages);
      const slice = rows.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE);

      if (!slice.length) {
        say(grid, rows.length ? 'Nothing on this page.' : 'No items match that.');
      } else {
        fill(grid, slice.map(item => itemCard(item, {
          Price: money(item.price),
          RAP: money(item.rap),
          Value: item.value ? money(item.value) : EMPTY,
          Available: money(item.available),
        })).filter(Boolean));
      }
      controls.forEach(control => paginate(control, pages, state.page, target => {
        state.page = target;
        render();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }));
    }

    const search = byId('catpage_search_textbox');
    if (search) {
      search.value = '';
      search.addEventListener('input', () => {
        state.keyword = search.value.trim();
        state.page = 1;
        render();
      });
    }
    ['filter-min', 'filter-max'].forEach(id => byId(id)?.addEventListener('input', () => {
      state.page = 1;
      render();
    }));
    onPick('sort_type', field => {
      state.sort = field;
      state.page = 1;
      render();
    });
    onPick('filter_category', field => {
      state.field = field;
      state.page = 1;
      render();
    });

    say(grid, 'Loading the Wanwood catalog\u2026');
    try {
      state.items = await loadItems({ includePrice: true });
    } catch (error) {
      say(grid, 'The Wanwood catalog could not be loaded.');
      return;
    }
    if (!state.items.length) {
      say(grid, 'Wanwood reported no collectible items.');
      return;
    }
    render();
  }

  /* ------------------------------------------------------------------ */
  /* Deals - the items somebody has marked as projected                  */
  /* ------------------------------------------------------------------ */

  async function loadProjecteds() {
    const grid = container('item');
    if (!grid || !fromTemplate('item')) return;

    const state = { sort: 'rap_high_to_low', items: [] };

    function render() {
      const rows = [...state.items].sort(comparator(state.sort));
      if (!rows.length) {
        /* Nothing lands here without a person putting it here, so an empty
         * page means nobody has flagged anything - not that a fetch failed. */
        say(grid, 'No items have been marked as projected. An item appears here '
          + 'once it is given the Projected category in the admin panel.');
        return;
      }
      fill(grid, rows.map(item => itemCard(item, {
        Price: money(item.price),
        RAP: money(item.rap),
        Value: item.value ? money(item.value) : EMPTY,
      })).filter(Boolean));
    }

    onPick('sort_type', field => {
      state.sort = field;
      render();
    });

    say(grid, 'Loading deals\u2026');
    try {
      state.items = (await loadItems({ includePrice: true })).filter(item => item.projected);
    } catch (error) {
      say(grid, 'Wanwood could not be reached for these items.');
      return;
    }
    render();
  }

  /* ------------------------------------------------------------------ */
  /* Recent value changes                                                */
  /* ------------------------------------------------------------------ */

  function ago(stamp) {
    const seconds = Math.max(0, Math.round((Date.now() - stamp) / 1000));
    const steps = [[31536000, 'year'], [2592000, 'month'], [86400, 'day'], [3600, 'hour'], [60, 'minute']];
    for (const [size, unit] of steps) {
      if (seconds >= size) {
        const count = Math.floor(seconds / size);
        return `${count} ${unit}${count === 1 ? '' : 's'} ago`;
      }
    }
    return 'just now';
  }

  async function loadValueChanges() {
    const grid = container('item');
    if (!grid || !fromTemplate('item')) return;

    say(grid, 'Loading changes\u2026');

    let changes = [];
    let names = new Map();
    try {
      const feed = await fetch(`${API_BASE}/api/v1/valuechanges?limit=60`).then(r => r.json());
      changes = Array.isArray(feed?.changes) ? feed.changes : [];
    } catch (error) {
      say(grid, 'The change log could not be loaded.');
      return;
    }

    const valueChanges = changes.filter(change => change && change.field === 'value');
    if (!valueChanges.length) {
      say(grid, 'No values have been changed yet.');
      return;
    }

    try {
      const details = await API.getItemDetails(
        [...new Set(valueChanges.map(change => Number(change.id)))], { includeRap: false });
      names = new Map(details.map(detail => [detail.id, detail]));
    } catch (error) {
      /* Names are a nicety; the change itself is the point. */
    }

    fill(grid, valueChanges.map(change => {
      const id = Number(change.id);
      const detail = names.get(id);
      const node = fromTemplate('item');
      const rose = Number(change.new) >= Number(change.old);

      setTitle(node, detail ? detail.name : `Item ${id}`);
      setImage(node, detail?.thumbnail || API.thumbnailUrl(id), 'Item thumbnail');
      setLink(node, `/item/?id=${id}`);
      setRow(node, 'Old', money(change.old));

      /* The New figure has an arrow glyph beside it: only the number is
       * replaced, and the arrow is turned to point the way this change went. */
      const rows = [...node.querySelectorAll('.d-flex.justify-content-between')];
      const newRow = rows.find(row => row.querySelector('small')?.textContent.trim() === 'New');
      const figure = newRow?.querySelector('p, .card-text');
      if (figure) {
        const arrow = figure.querySelector('svg');
        figure.textContent = '';
        if (arrow) {
          arrow.querySelector('path')?.setAttribute('fill', rose ? 'lime' : '#ee5f5b');
          if (!rose) arrow.style.transform = 'rotate(180deg)';
          figure.appendChild(arrow);
          figure.appendChild(document.createTextNode(' '));
        }
        figure.appendChild(document.createTextNode(money(change.new)));
      }

      /* The card's two timestamp lines: "2 hours ago", then the exact stamp. */
      const stamps = [...node.querySelectorAll('.d-flex .card-text')].slice(-2);
      const at = Number(change.at);
      if (Number.isFinite(at) && stamps.length === 2) {
        stamps[0].textContent = ago(at);
        stamps[1].textContent = `${new Date(at).toISOString().slice(0, 19).replace('T', ' ')} UTC`;
      }
      return node;
    }));
  }

  /* ------------------------------------------------------------------ */
  /* Players and the leaderboard                                         */
  /* ------------------------------------------------------------------ */

  async function loadPlayers() {
    const grid = container('player');
    if (!grid || !fromTemplate('player')) return;

    const roster = window.WolimonsRoster;
    if (!roster) {
      say(grid, 'The player list could not be loaded.');
      return;
    }

    const state = { players: [], page: 1, keyword: '' };
    const controls = [...document.querySelectorAll('.pagination-control')];
    const ranked = new Map();

    function render() {
      const keyword = state.keyword.toLowerCase();
      const rows = state.players.filter(player =>
        !keyword || String(player.name || '').toLowerCase().includes(keyword));
      const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
      state.page = Math.min(state.page, pages);
      const slice = rows.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE);

      if (!slice.length) {
        say(grid, state.players.length ? 'No player by that name.' : 'No tracked players yet.');
      } else {
        fill(grid, slice.map(player => {
          const node = fromTemplate('player');
          setTitle(node, player.name || `User ${player.id}`);
          setImage(node, player.avatar || '', `${player.name} thumbnail`);
          setLink(node, `/player/?id=${player.id}`);
          setRow(node, 'Rank', `#${ranked.get(player.id) || EMPTY}`);
          setRow(node, 'Value', `R$ ${money(player.value)}`);
          setRow(node, 'RAP', `R$ ${money(player.rap)}`);
          return node;
        }));
      }
      controls.forEach(control => paginate(control, pages, state.page, target => {
        state.page = target;
        render();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }));
    }

    const search = byId('player_search_textbox');
    if (search) {
      search.addEventListener('input', () => {
        state.keyword = search.value.trim();
        state.page = 1;
        render();
      });
    }

    say(grid, 'Loading players\u2026');
    let players = [];
    try {
      players = await roster.load();
    } catch (error) {
      players = [];
    }
    if (!players.length) {
      say(grid, 'No tracked players yet.');
      return;
    }

    /* The leaderboard is the same roster in rank order; /players is the same
     * list alphabetically, which is how 2018 had it. */
    const byValue = [...players].sort((a, b) => (b.value || 0) - (a.value || 0));
    byValue.forEach((player, index) => ranked.set(player.id, index + 1));
    state.players = page === 'leaderboard'
      ? byValue
      : [...players].sort((a, b) => String(a.name).localeCompare(String(b.name)));

    if (typeof roster.attachAvatars === 'function') {
      try {
        await roster.attachAvatars(state.players.slice(0, PAGE_SIZE * 2));
      } catch (error) {
        /* The card keeps the placeholder image. */
      }
    }
    render();
  }

  /* ------------------------------------------------------------------ */
  /* Item table                                                          */
  /* ------------------------------------------------------------------ */

  async function loadItemTable() {
    const body = container('row');
    const table = byId('itemtable_table');
    if (!body || !table || !fromTemplate('row')) return;

    const headers = [...table.querySelectorAll('thead th')];
    const KEYS = ['', 'name', 'price', 'rap', 'value', 'demand', 'trend', 'rare', 'projected', 'available'];
    const state = { items: [], sort: 'value', direction: -1, keyword: '', size: 25, page: 1, field: 'best_price' };

    const info = byId('itemtable_table_info');
    const pager = byId('itemtable_table_paginate');

    function compare(a, b) {
      const left = a[state.sort];
      const right = b[state.sort];
      if (typeof left === 'string' || typeof right === 'string') {
        return state.direction * String(left || '').localeCompare(String(right || ''));
      }
      const leftGone = left === null || left === undefined;
      const rightGone = right === null || right === undefined;
      if (leftGone && rightGone) return 0;
      if (leftGone) return 1;
      if (rightGone) return -1;
      return state.direction * (Number(left) - Number(right));
    }

    function matching() {
      const keyword = state.keyword.toLowerCase();
      const min = boxValue('filter-min');
      const max = boxValue('filter-max');
      return visible(state.items)
        .filter(item => !keyword || item.name.toLowerCase().includes(keyword))
        .filter(item => inRange(item, state.field, min, max))
        .sort(compare);
    }

    function render() {
      const rows = matching();
      const size = state.size === 0 ? rows.length || 1 : state.size;
      const pages = Math.max(1, Math.ceil(rows.length / size));
      state.page = Math.min(state.page, pages);
      const slice = rows.slice((state.page - 1) * size, state.page * size);

      body.textContent = '';
      slice.forEach(item => {
        const row = fromTemplate('row');
        const cells = [...row.children];
        const image = cells[0]?.querySelector('img');
        if (image) {
          image.src = item.thumbnail;
          image.alt = '';
          image.title = item.name;
        }
        const link = cells[1]?.querySelector('a');
        if (link) {
          link.href = `/item/?id=${item.id}`;
          link.textContent = item.name;
        }
        if (cells[2]) cells[2].textContent = money(item.price);
        if (cells[3]) cells[3].textContent = money(item.rap);
        if (cells[4]) cells[4].textContent = item.value ? money(item.value) : EMPTY;
        if (cells[5]) cells[5].textContent = item.demand || EMPTY;
        if (cells[6]) cells[6].textContent = item.trend || EMPTY;
        /* Rare is a gem glyph in the archived row: it stays for a rare item
         * and the cell is emptied for everything else. */
        if (cells[7] && !item.rare) cells[7].textContent = EMPTY;
        if (cells[8]) cells[8].textContent = item.projected ? 'Yes' : EMPTY;
        if (cells[9]) cells[9].textContent = money(item.available);
        row.className = body.children.length % 2 ? 'even' : 'odd';
        body.appendChild(row);
      });

      if (info) {
        const from = rows.length ? (state.page - 1) * size + 1 : 0;
        info.textContent = `Showing ${money(from)} to ${money(Math.min(rows.length, state.page * size))}`
          + ` of ${money(rows.length)} entries`;
      }
      paginate(pager, pages, state.page, target => {
        state.page = target;
        render();
      });
      headers.forEach((header, index) => {
        const key = KEYS[index];
        header.classList.remove('sorting_asc', 'sorting_desc');
        if (!key) return;
        header.classList.add(key === state.sort
          ? (state.direction === 1 ? 'sorting_asc' : 'sorting_desc')
          : 'sorting');
      });
    }

    headers.forEach((header, index) => {
      const key = KEYS[index];
      if (!key) return;
      header.style.cursor = 'pointer';
      header.addEventListener('click', () => {
        if (state.sort === key) {
          state.direction = -state.direction;
        } else {
          state.sort = key;
          state.direction = key === 'name' ? 1 : -1;
        }
        render();
      });
    });

    document.querySelector('#itemtable_table_filter input')?.addEventListener('input', event => {
      state.keyword = event.target.value.trim();
      state.page = 1;
      render();
    });
    document.querySelector('#itemtable_table_length select')?.addEventListener('change', event => {
      const picked = event.target.value;
      state.size = picked === 'All' || picked === '-1' ? 0 : Number(picked) || 25;
      state.page = 1;
      render();
    });
    ['filter-min', 'filter-max'].forEach(id => byId(id)?.addEventListener('input', () => {
      state.page = 1;
      render();
    }));
    onPick('filter_category', field => {
      state.field = field;
      state.page = 1;
      render();
    });

    body.textContent = '';
    if (info) info.textContent = 'Loading the Wanwood catalog\u2026';
    try {
      state.items = await loadItems({ includePrice: true });
    } catch (error) {
      if (info) info.textContent = 'The Wanwood catalog could not be loaded.';
      return;
    }
    render();
  }

  /* ------------------------------------------------------------------ */
  /* A table for the pages whose tables were drawn by a plugin            */
  /* ------------------------------------------------------------------ */

  /*
   * The item page's owner lists were built by DataTables after the page
   * loaded, so the archived copy saved two empty boxes. The build tool put a
   * real table from the Item Table page into a template; this fills it in.
   */
  function buildTable(box, columns, rows, empty) {
    if (!box) return;
    box.textContent = '';
    if (!rows.length) {
      say(box, empty);
      return;
    }
    const table = fromTemplate('table');
    const headCell = fromTemplate('table_head');
    const bodyCell = fromTemplate('table_cell');
    if (!table || !headCell || !bodyCell) return;

    const headRow = table.querySelector('thead tr');
    columns.forEach(name => {
      const cell = headCell.cloneNode(true);
      cell.textContent = name;
      headRow.appendChild(cell);
    });

    const tbody = table.querySelector('tbody');
    rows.forEach(values => {
      const row = document.createElement('tr');
      values.forEach(value => {
        const cell = bodyCell.cloneNode(true);
        if (value instanceof Node) {
          cell.appendChild(value);
        } else {
          cell.textContent = value === null || value === undefined ? EMPTY : String(value);
        }
        row.appendChild(cell);
      });
      tbody.appendChild(row);
    });

    box.appendChild(table);
  }

  function playerLink(userId, name) {
    const link = document.createElement('a');
    link.href = `/player/?id=${userId}`;
    link.textContent = name || `User ${userId}`;
    return link;
  }

  /* ------------------------------------------------------------------ */
  /* Item page                                                           */
  /* ------------------------------------------------------------------ */

  /* Every stat box on the page, filled by the label it carries. */
  function setStat(label, value) {
    let found = false;
    document.querySelectorAll('.list-group-item').forEach(row => {
      const small = row.querySelector('small');
      if (!small || small.textContent.trim().toLowerCase() !== String(label).toLowerCase()) return;
      const figure = row.querySelector('p');
      if (!figure) return;
      figure.textContent = value === null || value === undefined ? EMPTY : String(value);
      found = true;
    });
    return found;
  }

  /* The nickname an item goes by, from the one list both item pages read. */
  const acronymFor = name => (window.WolimonsAcronyms
    ? window.WolimonsAcronyms.for(name)
    : '');

  function hoardRows(owners) {
    const counts = new Map();
    owners.forEach(owner => {
      counts.set(owner.userId, (counts.get(owner.userId) || 0) + 1);
    });
    return [...counts.entries()]
      .filter(([, copies]) => copies > 1)
      .map(([userId, copies]) => ({
        userId,
        copies,
        name: owners.find(owner => owner.userId === userId)?.name || '',
      }))
      .sort((a, b) => b.copies - a.copies);
  }

  async function loadItemPage() {
    const id = Number(query().get('id'));
    const titleBox = document.querySelector('[data-2018="item-title"]');

    if (!Number.isSafeInteger(id) || id <= 0) {
      if (titleBox) titleBox.firstChild.textContent = 'No item selected ';
      return;
    }

    await VALUES.ready;

    const optional = promise => promise.catch(() => null);
    const [detail, info, resale, resellers, owners, changes] = await Promise.all([
      optional(API.getItemDetails([id], { includePrice: false, includeRap: false })
        .then(rows => rows[0] || null)),
      optional(API.fetchJson(`${API.API_BASE}/apisite/api/marketplace/productinfo?assetId=${id}`)),
      optional(API.fetchJson(`${API.API_BASE}/apisite/economy/v1/assets/${id}/resale-data`)),
      optional(API.fetchJson(`${API.API_BASE}/apisite/economy/v1/assets/${id}/resellers?limit=100`)),
      optional(API.getAssetOwners(id)),
      optional(fetch(`${API_BASE}/api/changes?limit=500`).then(r => r.json())
        .then(payload => (payload && payload.ok ? payload.changes : []))),
    ]);

    const name = detail?.name || String(info?.Name || '').trim() || `Item ${id}`;
    const listings = Array.isArray(resellers?.data) ? resellers.data : [];
    const holders = Array.isArray(owners) ? owners : [];
    const prices = listings.map(listing => number(listing.price)).filter(price => price !== null);
    const bestPrice = prices.length ? Math.min(...prices) : null;
    const rap = number(resale?.recentAveragePrice);
    const totalCopies = number(resale?.assetStock);
    const available = holders.length;
    const distinctOwners = new Set(holders.map(owner => owner.userId)).size;
    const hoards = hoardRows(holders);
    const hoardedCopies = hoards.reduce((sum, entry) => sum + entry.copies, 0);
    const value = VALUES.get(id);

    document.title = `${name} - Wolimons`;
    if (titleBox) {
      /* The name is the first text node of the heading; the chain-link icon
       * beside it is the archived copy's own markup and stays where it is. */
      const first = [...titleBox.childNodes].find(node => node.nodeType === 3);
      if (first) first.textContent = `${name} `;
    }
    const offsite = document.querySelector('[data-2018="offsite"]');
    if (offsite) {
      offsite.href = `${SITE_BASE}/catalog/${id}/${slugify(name)}`;
      offsite.target = '_blank';
      offsite.rel = 'noopener';
    }
    const thumbnail = API.thumbnailUrl(id);
    document.querySelectorAll('[data-2018="item-image"]').forEach(image => {
      image.src = thumbnail;
      image.alt = `${name} thumbnail`;
    });

    setStat('Value', value ? money(value) : EMPTY);
    setStat('Demand', VALUES.demand(id));
    setStat('Trend', VALUES.trend(id));
    setStat('RAP', money(rap));
    setStat('Best Price', money(bestPrice));
    setStat('Sellers', money(listings.length));
    setStat('Type', TYPE_NAMES[detail?.assetType] || null);
    setStat('Acronym', acronymFor(name) || null);
    setStat('Original Price', money(number(info?.PriceInRobux)));
    setStat('Owners', money(distinctOwners));
    setStat('Hoarded Copies', money(hoardedCopies));
    setStat('Percent Hoarded', available ? `${((hoardedCopies / available) * 100).toFixed(1)}%` : null);
    setStat('Total Copies', money(totalCopies));
    setStat('Available Copies', money(available));
    setStat('Hidden Copies', totalCopies === null ? null : money(Math.max(0, totalCopies - available)));

    /* Wanwood's productinfo has no creation date, but every copy carries the
     * date it was made, so the oldest copy is when the item first existed. */
    const stamps = holders.map(owner => Date.parse(owner.created)).filter(Number.isFinite);
    const created = Date.parse(info?.Created || '') || (stamps.length ? Math.min(...stamps) : NaN);
    setStat('Date Created', Number.isFinite(created)
      ? new Date(created).toISOString().slice(0, 10)
      : null);

    /* Owners, and the players holding more than one copy. */
    buildTable(byId('bc_owners_table_container'), ['Player', 'Serial', 'Copy created'],
      holders
        .slice()
        .sort((a, b) => (a.serialNumber || 0) - (b.serialNumber || 0))
        .map(owner => [
          playerLink(owner.userId, owner.name),
          owner.serialNumber === null ? EMPTY : `#${owner.serialNumber}`,
          owner.created ? owner.created.slice(0, 10) : EMPTY,
        ]),
      'No copies of this item have a visible owner.');
    buildTable(byId('hoards_table_container'), ['Player', 'Copies'],
      hoards.map(entry => [playerLink(entry.userId, entry.name), money(entry.copies)]),
      'Nobody holds more than one copy of this item.');

    drawItemCharts({ id, resale, listings, owners: holders, value, changes, created });
  }

  /* ------------------------------------------------------------------ */
  /* The item page's five charts                                         */
  /* ------------------------------------------------------------------ */

  function historyRows(resale) {
    const points = Array.isArray(resale?.priceDataPoints) ? resale.priceDataPoints : [];
    const rows = points
      .map(point => ({ time: Date.parse(point?.date), value: number(point?.value) }))
      .filter(row => Number.isFinite(row.time) && row.value !== null)
      .sort((a, b) => a.time - b.time)
      .map(row => ({ time: row.time, value: row.value, rap: row.value }));
    const rap = number(resale?.recentAveragePrice);
    if (rows.length && rap !== null) rows.push({ time: Date.now(), value: rap, rap });
    return rows;
  }

  function copiesRows(owners, listings) {
    const stamps = owners
      .map(owner => Date.parse(owner.created))
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    if (!stamps.length) return [];
    const rows = stamps.map((time, index) => ({ time, value: index + 1, rap: listings.length }));
    rows.push({ time: Date.now(), value: stamps.length, rap: listings.length });
    return rows;
  }

  function ownershipRows(owners) {
    const rows = owners
      .map(owner => ({ time: Date.parse(owner.created), userId: owner.userId }))
      .filter(row => Number.isFinite(row.time))
      .sort((a, b) => a.time - b.time);
    if (!rows.length) return [];
    const seen = new Set();
    const out = rows.map((row, index) => {
      seen.add(row.userId);
      return { time: row.time, value: seen.size, rap: index + 1 };
    });
    out.push({ time: Date.now(), value: seen.size, rap: rows.length });
    return out;
  }

  function hoardingRows(owners) {
    const rows = owners
      .map(owner => ({ time: Date.parse(owner.created), userId: owner.userId }))
      .filter(row => Number.isFinite(row.time))
      .sort((a, b) => a.time - b.time);
    if (!rows.length) return [];
    const held = new Map();
    let hoarded = 0;
    const out = rows.map(row => {
      const count = (held.get(row.userId) || 0) + 1;
      held.set(row.userId, count);
      /* The copy that turns a holder into a hoarder brings its first one
       * with it. */
      if (count === 2) hoarded += 2;
      else if (count > 2) hoarded += 1;
      return { time: row.time, value: hoarded, rap: held.size };
    });
    out.push({ time: Date.now(), value: hoarded, rap: held.size });
    return out;
  }

  function valueRows(resale, value, changes, id) {
    const edits = (Array.isArray(changes) ? changes : [])
      .filter(change => change && Number(change.id) === id && change.field === 'value'
        && Number.isFinite(Number(change.at)))
      .sort((a, b) => a.at - b.at);

    const valueAt = when => {
      let current = Number(edits.length ? edits[0].old : value) || 0;
      edits.forEach(edit => { if (edit.at <= when) current = Number(edit.new) || 0; });
      return current;
    };

    const points = Array.isArray(resale?.priceDataPoints) ? resale.priceDataPoints : [];
    const rapAt = new Map();
    points.forEach(point => {
      const time = Date.parse(point?.date);
      const rap = number(point?.value);
      if (Number.isFinite(time) && rap !== null) rapAt.set(time, rap);
    });
    const today = Date.now();
    const currentRap = number(resale?.recentAveragePrice);
    if (currentRap !== null) rapAt.set(today, currentRap);

    const stamps = new Set([...rapAt.keys(), ...edits.map(edit => Number(edit.at))]);
    if (edits.length) stamps.add(today);
    if (stamps.size < 2) return [];

    const sorted = [...rapAt.entries()].sort((a, b) => a[0] - b[0]);
    const rapFor = when => {
      let last = 0;
      sorted.forEach(([time, rap]) => { if (time <= when) last = rap; });
      return last;
    };

    return [...stamps].sort((a, b) => a - b)
      .map(time => ({ time, value: valueAt(time), rap: rapFor(time) }));
  }

  function drawItemCharts(data) {
    if (!CHART) return;
    const since = Number.isFinite(data.created) ? data.created : 0;
    const panes = {
      history_chart_container: {
        rows: () => historyRows(data.resale),
        empty: 'Wanwood has not recorded any sales of this item yet.',
      },
      value_chart_container: {
        rows: () => valueRows(data.resale, data.value, data.changes, data.id),
        empty: 'This item\u2019s value has not been changed yet, so there is nothing to plot.',
      },
      copies_chart_container: {
        rows: () => copiesRows(data.owners, data.listings),
        names: { value: 'Copies', rap: 'Listed for sale', axis: 'Copies' },
        empty: 'No copies of this item have a visible owner.',
      },
      ownership_chart_container: {
        rows: () => ownershipRows(data.owners),
        names: { value: 'Owners', rap: 'Copies held', axis: 'Players' },
        empty: 'No copies of this item have a visible owner.',
      },
      hoarding_chart_container: {
        rows: () => hoardingRows(data.owners),
        names: { value: 'Hoarded copies', rap: 'Holders', axis: 'Copies' },
        empty: 'Nobody holds more than one copy of this item.',
      },
    };

    const drawn = new Set();
    function draw(paneId) {
      const box = byId(paneId);
      const spec = panes[paneId];
      if (!box || !spec || drawn.has(paneId)) return;
      drawn.add(paneId);
      /* Highcharts measures its container, so a hidden tab would come out
       * zero-wide; each one is drawn the first time it is opened. */
      CHART.render(box, spec.rows(), { ...(spec.names || {}), since }, spec.empty);
    }

    draw('history_chart_container');
    wireTabs(paneId => draw(paneId));
  }

  /*
   * The chart and owner tabs.
   *
   * Bootstrap's tab plugin is not on these pages, so the anchors are wired
   * here: show the pane the anchor names, hide its siblings, and tell the
   * caller which chart container just became visible.
   */
  function wireTabs(onShow) {
    document.querySelectorAll('.nav-tabs .nav-link').forEach(tab => {
      tab.addEventListener('click', event => {
        event.preventDefault();
        const target = (tab.getAttribute('href') || '').split('#')[1];
        const pane = target ? byId(target) : null;
        if (!pane) return;
        const group = tab.closest('.nav-tabs');
        group?.querySelectorAll('.nav-link').forEach(other => {
          other.classList.toggle('active', other === tab);
          other.classList.toggle('show', other === tab);
        });
        pane.parentElement?.querySelectorAll(':scope > .tab-pane').forEach(other => {
          other.classList.toggle('active', other === pane);
          other.classList.toggle('show', other === pane);
        });
        const chart = pane.querySelector('.item_page_chart_container');
        if (chart && onShow) onShow(chart.id);
      });
    });
  }

  /* ------------------------------------------------------------------ */
  /* Player page                                                         */
  /* ------------------------------------------------------------------ */

  async function loadPlayerPage() {
    const grid = container('item');
    const titleBox = document.querySelector('[data-2018="player-title"]');
    const id = Number(query().get('id'));

    if (!Number.isSafeInteger(id) || id <= 0) {
      if (titleBox) titleBox.firstChild.textContent = 'No player selected ';
      say(grid, 'Open a player from the leaderboard, or search for one in the navbar.');
      return;
    }

    await VALUES.ready;
    say(grid, 'Loading this player\u2019s inventory\u2026');

    const optional = promise => promise.catch(() => null);
    const [profile, collectibles, stats] = await Promise.all([
      optional(API.getProfileById(id)),
      optional(API.getCollectibles(id)),
      optional(fetch(`${API_BASE}/api/playerstats?id=${id}`).then(r => r.json())),
    ]);

    const name = profile?.name || `User ${id}`;
    document.title = `${name} - Wolimons`;
    if (titleBox) {
      const first = [...titleBox.childNodes].find(node => node.nodeType === 3);
      if (first) first.textContent = `${name} `;
    }
    const offsite = document.querySelector('[data-2018="offsite"]');
    if (offsite) {
      offsite.href = `${SITE_BASE}/users/${id}/profile`;
      offsite.target = '_blank';
      offsite.rel = 'noopener';
    }
    const tradeAds = document.querySelector('[data-2018="trade-ads"]');
    if (tradeAds) tradeAds.href = `/playertrades/?id=${id}`;
    const sendTrade = document.querySelector('[data-2018="send-trade"]');
    if (sendTrade) {
      sendTrade.href = `${SITE_BASE}/Trade/TradeWindow.aspx?TradePartnerID=${id}`;
      sendTrade.target = '_blank';
      sendTrade.rel = 'noopener';
    }

    try {
      const avatar = await API.fetchUserAvatar(id, { size: 420, preferHeadshot: false });
      if (avatar) {
        document.querySelectorAll('[data-2018="player-image"]').forEach(image => {
          image.src = avatar;
          image.alt = `${name} avatar`;
        });
      }
    } catch (error) {
      /* The placeholder stays. */
    }

    const rows = Array.isArray(collectibles) ? collectibles : [];
    const totals = rows.reduce((sum, row) => {
      const value = VALUES.get(Number(row.assetId));
      return {
        value: sum.value + (value || number(row.recentAveragePrice) || 0),
        rap: sum.rap + (number(row.recentAveragePrice) || 0),
      };
    }, { value: 0, rap: 0 });

    /* The rank is the player's place in the tracked roster, which is the
     * same list the leaderboard draws. */
    let rank = null;
    const roster = window.WolimonsRoster;
    if (roster && typeof roster.rankOf === 'function') {
      try {
        rank = await roster.rankOf(id);
      } catch (error) {
        rank = null;
      }
    }

    setPlain('Rank', rank ? `#${money(rank)}` : EMPTY);
    setPlain('Value', `R$ ${money(totals.value)}`);
    setPlain('RAP', `R$ ${money(totals.rap)}`);
    setPlain('Collectibles', money(rows.length));
    setPlain('Known Previous Names', EMPTY);

    /*
     * The inventory: one card per copy, with the page's own Sort By, Filter,
     * Min / Max and pagination all driving it.
     */
    if (grid && fromTemplate('item')) {
      const held = rows.map((row, index) => {
        const assetId = Number(row.assetId);
        return {
          id: assetId,
          order: index,
          name: String(row.name || `Item ${assetId}`),
          value: VALUES.get(assetId),
          rap: number(row.recentAveragePrice),
          serial: number(row.serialNumber),
          owned: Date.parse(row.updated || row.created || '') || 0,
          copies: rows.filter(other => Number(other.assetId) === assetId).length,
        };
      });

      const state = { sort: 'value_descending', field: 'value', page: 1 };
      const controls = [...document.querySelectorAll('.pagination-control')];

      const paint = () => {
        const min = boxValue('filter-min');
        const max = boxValue('filter-max');
        const shown = held
          .filter(item => inRange(item, state.field, min, max))
          .sort(comparator(state.sort));

        const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
        state.page = Math.min(state.page, pages);
        const slice = shown.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE);

        if (!slice.length) {
          say(grid, held.length
            ? 'No items in that range.'
            : 'This player holds no collectibles, or their inventory is private.');
        } else {
          fill(grid, slice.map(item => {
            const node = fromTemplate('item');
            setTitle(node, item.name);
            setImage(node, API.thumbnailUrl(item.id), `${item.name} thumbnail`);
            setLink(node, `/item/?id=${item.id}`);
            setRow(node, 'Value', item.value ? money(item.value) : EMPTY);
            setRow(node, 'RAP', money(item.rap));
            setRow(node, 'Serial', item.serial === null ? EMPTY : `#${item.serial}`);
            setRow(node, 'Copies', money(item.copies));
            return node;
          }));
        }
        controls.forEach(control => paginate(control, pages, state.page, target => {
          state.page = target;
          paint();
        }));
      };

      onPick('sort_type', field => {
        state.sort = field;
        state.page = 1;
        paint();
      });
      onPick('filter_category', field => {
        state.field = field;
        state.page = 1;
        paint();
      });
      ['filter-min', 'filter-max'].forEach(id => byId(id)?.addEventListener('input', () => {
        state.page = 1;
        paint();
      }));

      paint();
    }

    drawPlayerChart(stats, totals);
  }

  /* The player page's stat rows have no <small> label - they are two plain
   * divs, so they are matched on the left-hand one's text. */
  function setPlain(label, value) {
    document.querySelectorAll('.list-group-item').forEach(row => {
      const cells = row.querySelectorAll(':scope > div');
      if (cells.length !== 2) return;
      if (cells[0].textContent.trim().toLowerCase() !== String(label).toLowerCase()) return;
      cells[1].textContent = value;
    });
  }

  function drawPlayerChart(stats, totals) {
    if (!CHART) return;
    const box = document.querySelector('#playerhistorytab .rounded, #playerhistorytab');
    if (!box) return;
    box.textContent = '';
    box.style.minHeight = '300px';

    const readings = Array.isArray(stats?.readings) ? stats.readings : [];
    const rows = readings
      .map(reading => ({
        time: Number(reading.at),
        value: Number(reading.value) || 0,
        rap: Number(reading.rap) || 0,
      }))
      .filter(row => Number.isFinite(row.time));
    rows.push({ time: Date.now(), value: totals.value, rap: totals.rap });

    CHART.render(box, rows, { since: Number(stats?.joined) || 0 },
      'Value and RAP history starts from the first time this profile is opened. '
      + 'Wanwood keeps no record of what a player owned in the past, so there is '
      + 'nothing earlier to show.');
  }

  /* ------------------------------------------------------------------ */
  /* Trade calculator                                                    */
  /* ------------------------------------------------------------------ */

  async function loadTradeCalculator() {
    const grid = container('item');
    if (!grid || !fromTemplate('item')) return;

    /* The eight slots the archived page already has: four offer, four
     * request, each a picture with a remove button behind it. */
    const slots = [...document.querySelectorAll('.trade-item')].map((slot, index) => ({
      index,
      node: slot,
      side: index < 4 ? 'offer' : 'request',
      image: slot.querySelector(`#item_img_${index}`) || slot.querySelector('img'),
      remove: slot.querySelector(`#item_remove_${index}`),
      /* The empty-slot picture the page already ships, so a cleared slot
       * looks the way it did rather than going blank. */
      empty: (slot.querySelector(`#item_img_${index}`) || slot.querySelector('img') || {})
        .getAttribute ? (slot.querySelector(`#item_img_${index}`) || slot.querySelector('img'))
          .getAttribute('src') : '',
      item: null,
    }));

    const state = { items: [], keyword: '' };

    function totalFor(side) {
      return slots
        .filter(slot => slot.side === side && slot.item)
        .reduce((sum, slot) => ({
          value: sum.value + (slot.item.value || slot.item.rap || 0),
          rap: sum.rap + (slot.item.rap || 0),
        }), { value: 0, rap: 0 });
    }

    function paintTotals() {
      const offer = totalFor('offer');
      const request = totalFor('request');
      const offerRobux = boxValue('offer_robux_textbox') || 0;
      const requestRobux = boxValue('request_robux_textbox') || 0;
      const set = (id, figure) => {
        const box = byId(id);
        if (box) box.textContent = money(figure);
      };
      set('offer_value_total_textbox', offer.value + offerRobux);
      set('offer_rap_total_textbox', offer.rap + offerRobux);
      set('request_value_total_textbox', request.value + requestRobux);
      set('request_rap_total_textbox', request.rap + requestRobux);
    }

    function paintSlot(slot) {
      if (!slot.image) return;
      slot.image.src = slot.item ? slot.item.thumbnail : slot.empty;
      slot.image.alt = slot.item ? slot.item.name : 'Empty slot';
      slot.image.title = slot.item ? slot.item.name : '';
      if (slot.remove) slot.remove.classList.toggle('d-none', !slot.item);
    }

    function add(item) {
      const slot = slots.find(candidate => !candidate.item);
      if (!slot) return;
      slot.item = item;
      paintSlot(slot);
      paintTotals();
    }

    slots.forEach(slot => {
      paintSlot(slot);
      const clear = () => {
        slot.item = null;
        paintSlot(slot);
        paintTotals();
      };
      slot.remove?.addEventListener('click', clear);
      slot.node.addEventListener('click', () => { if (slot.item) clear(); });
    });

    ['offer_robux_textbox', 'request_robux_textbox'].forEach(id => {
      byId(id)?.addEventListener('input', paintTotals);
    });

    function render() {
      const keyword = state.keyword.toLowerCase();
      const rows = visible(state.items)
        .filter(item => !keyword || item.name.toLowerCase().includes(keyword))
        .sort((a, b) => (b.value || b.rap || 0) - (a.value || a.rap || 0));
      if (!rows.length) {
        say(grid, 'No items match that.');
        return;
      }
      fill(grid, rows.map(item => {
        const node = fromTemplate('item');
        setTitle(node, item.name);
        setImage(node, item.thumbnail, `${item.name} thumbnail`);
        node.style.cursor = 'pointer';
        node.title = `Value ${money(item.value)}   RAP ${money(item.rap)}`;
        node.addEventListener('click', () => add(item));
        return node;
      }));
    }

    byId('trade_calculator_page_search_textbox')?.addEventListener('input', event => {
      state.keyword = event.target.value.trim();
      render();
    });

    say(grid, 'Loading items\u2026');
    try {
      state.items = await loadItems();
    } catch (error) {
      say(grid, 'The item list could not be loaded.');
      return;
    }
    render();
    paintTotals();
  }

  /* ------------------------------------------------------------------ */
  /* Item lookup, in the navbar of every page                            */
  /* ------------------------------------------------------------------ */

  /*
   * The old site's lookup dropped a list under the search box; the box and
   * the empty suggestions container are both still in the markup, so this
   * fills the container using its own suggestion classes.
   */
  function wireLookup() {
    const box = byId('navbar_search_box');
    const list = document.querySelector('.autocomplete-suggestions');
    if (!box || !list) return;

    const hide = () => { list.style.display = 'none'; };
    const place = () => {
      const rect = box.getBoundingClientRect();
      list.style.left = `${rect.left + window.scrollX}px`;
      list.style.top = `${rect.bottom + window.scrollY}px`;
      list.style.width = `${Math.max(rect.width, 220)}px`;
    };

    async function search() {
      const keyword = box.value.trim().toLowerCase();
      if (keyword.length < 2) return hide();

      let items = [];
      try {
        items = await loadItems();
      } catch (error) {
        return hide();
      }
      const matches = items
        .filter(item => item.name.toLowerCase().includes(keyword))
        .slice(0, 8);
      if (!matches.length) return hide();

      list.textContent = '';
      matches.forEach(item => {
        const row = document.createElement('div');
        row.className = 'autocomplete-suggestion';
        row.textContent = item.name;
        row.addEventListener('mousedown', event => {
          event.preventDefault();
          window.location.href = `/item/?id=${item.id}`;
        });
        list.appendChild(row);
      });
      place();
      list.style.display = 'block';
    }

    box.addEventListener('input', search);
    box.addEventListener('focus', search);
    box.addEventListener('blur', () => window.setTimeout(hide, 120));
    box.closest('form')?.addEventListener('submit', event => event.preventDefault());
    window.addEventListener('resize', () => {
      if (list.style.display === 'block') place();
    });
  }

  /* ------------------------------------------------------------------ */
  /* The Discord panel - 2018's home page had one, so it keeps it        */
  /* ------------------------------------------------------------------ */

  function loadDiscord() {
    const heading = [...document.querySelectorAll('h3')]
      .find(node => /discord/i.test(node.textContent || ''));
    if (!heading) return;
    const box = heading.parentElement && heading.parentElement.querySelector('div');
    if (!box) return;

    box.id = 'discord_widget';
    box.className = 'wolimons_discord';

    const sheet = document.createElement('link');
    sheet.rel = 'stylesheet';
    sheet.href = '/css/discord-widget.css';
    document.head.appendChild(sheet);

    const script = document.createElement('script');
    script.src = '/assets/js/discord-widget.js';
    document.body.appendChild(script);
  }

  /* ------------------------------------------------------------------ */

  function start() {
    wireLookup();
    wireDropdowns();
    /* The chart tabs on the item page are wired with the charts; every other
     * page's tabs only have to switch panes. */
    if (page !== 'item') wireTabs(null);

    if (page === 'home') loadDiscord();
    if (page === 'catalog') loadCatalog();
    if (page === 'projecteds') loadProjecteds();
    if (page === 'valuechanges') loadValueChanges();
    if (page === 'players' || page === 'leaderboard') loadPlayers();
    if (page === 'itemtable') loadItemTable();
    if (page === 'item') loadItemPage();
    if (page === 'player') loadPlayerPage();
    if (page === 'tradecalculator') loadTradeCalculator();
    /* /preferences is driven by assets/js/preferences.js, the same editor the
     * modern page uses - the checkboxes carry the same data-pref names. */
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
