/*
 * Wolimons item detail page.
 *
 * ---------------------------------------------------------------------------
 * THIS PAGE IS A TEMPLATE
 * ---------------------------------------------------------------------------
 * /item/index.html contains no item-specific text at all. Every value comes
 * from here, written into the placeholders marked with data-item-field="...".
 * Which item is shown is decided by the URL:
 *
 *     /item/?id=1581            <- the normal form used by every card link
 *     /item/1581                <- also works if the host rewrites pretty URLs
 *     /item/1581/Cthulhu
 *
 * ---------------------------------------------------------------------------
 * WHERE THE NUMBERS COME FROM
 * ---------------------------------------------------------------------------
 *   api/marketplace/productinfo       name, description, type, creator,
 *                                     original price, for sale
 *   economy/v1/assets/N/resale-data   RAP, total copies, sales, remaining,
 *                                     and the price/volume history the charts
 *                                     are drawn from
 *   economy/v1/assets/N/resellers     the live sale listings -> best price,
 *                                     seller count, the Copies For Sale tab
 *   inventory/v2/assets/N/owners      every visible copy -> the All Copies and
 *                                     Hoards tabs, the Ownership boxes, and
 *                                     the Copies and Ownership charts
 *   api/v1/items/restrictions         Limited / Limited U flag
 *   thumbnails/v1/assets              the image
 *   values.js                         Value, Demand, Trend, valuation method
 *                                     and the value team's note. All hand-set,
 *                                     never fetched.
 *
 * Wanwood has no source for Demand or Trend, so those come from values.js
 * when a value manager has set them and stay blank otherwise - they are never
 * faked out of a price field. The acronym has no source either, but it is
 * simply the name abbreviated, so it is derived from the name rather than
 * left blank.
 *
 * ---------------------------------------------------------------------------
 * THE CHARTS
 * ---------------------------------------------------------------------------
 * All four use WolimonsHistoryChart - the same Highstock chart the player
 * profile draws, loaded from the same vendored copy of the library, themed the
 * same way. Nothing about the chart is re-implemented here; this file only
 * decides which two series each tab hands it.
 *
 * ---------------------------------------------------------------------------
 * EDITING VALUES FROM THIS PAGE
 * ---------------------------------------------------------------------------
 * A linked owner, value manager or staff member gets an editor inside the
 * Valuation tab. It posts to the same POST /api/values/set the admin panel
 * uses, carrying the identity token from /verify - the server confirms the
 * account behind the token and re-checks its rank before it saves. Everyone
 * else never sees it: the block stays hidden and the backend would refuse
 * the write anyway.
 */
(() => {
  'use strict';

  const CONFIG = window.WOLIMONS_CONFIG || {};
  const SITE_BASE = CONFIG.siteBase || 'https://wanwoo.xyz';
  const API = window.WanwoodAPI;
  const CHART = window.WolimonsHistoryChart;
  const TABLE = window.WolimonsTable;
  const ACCOUNT = window.WolimonsAccount;

  /* Read values.js defensively: a browser holding an older cached copy has no
   * demand() on it, and a missing accessor must not take the page down. */
  const RAW_VALUES = window.WolimonsValues || {};
  const VALUES = {
    get: id => (typeof RAW_VALUES.get === 'function' ? Number(RAW_VALUES.get(id)) || 0 : 0),
    demand: id => (typeof RAW_VALUES.demand === 'function' ? RAW_VALUES.demand(id) : null),
    trend: id => (typeof RAW_VALUES.trend === 'function' ? RAW_VALUES.trend(id) : null),
    method: id => (typeof RAW_VALUES.method === 'function' ? RAW_VALUES.method(id) : null),
    note: id => (typeof RAW_VALUES.note === 'function' ? RAW_VALUES.note(id) : ''),
    categories: id => (typeof RAW_VALUES.categories === 'function'
      ? (RAW_VALUES.categories(id) || [])
      : []),
    refresh: () => (typeof RAW_VALUES.refresh === 'function'
      ? RAW_VALUES.refresh()
      : Promise.resolve()),
    subscribe: fn => (typeof RAW_VALUES.subscribe === 'function'
      ? RAW_VALUES.subscribe(fn)
      : fn(RAW_VALUES)),
  };

  /* Same table the catalog uses - kept identical so labels never drift. */
  const TYPE_NAMES = {
    8: 'Hat',
    18: 'Face',
    19: 'Gear',
    41: 'HairAccessory',
    42: 'FaceAccessory',
    43: 'NeckAccessory',
    44: 'ShoulderAccessory',
    45: 'FrontAccessory',
    46: 'BackAccessory',
    47: 'WaistAccessory',
  };

  /* The two sentences the snapshot prints under the valuation method. Kept
   * word for word; only the Discord link is ours. */
  const METHOD_TEXT = {
    proof: {
      label: 'Proof-Based',
      blurb: 'Proof-based items are valued based on their recent completed trades, '
        + 'offers, and other factors.',
    },
    rap: {
      label: 'RAP-Based',
      blurb: 'RAP-based items are valued based on their recent RAP.',
    },
  };

  const EMPTY = '\u2014';
  const RESELLER_LIMIT = 100;

  const formatNumber = value => Number(value).toLocaleString('en-US');
  const slugify = value => String(value || 'unnamed')
    .replace(/'/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unnamed';

  /* The nicknames people actually use, keyed by the item's initials. Items
   * that aren't listed here just don't show one. */
  const ACRONYMS = {
    BHFBSP: 'Space hair',
    TBB: 'Bbh',
    BIBOUP: 'Bib',
    PI: 'Indy',
    P: 'Prank',
    RSTH: 'Rbad',
    TVS: 'Void',
    TCRF: 'Cf',
    U: 'Umad',
    SFC: 'Supa',
    FTVKC: 'Kawaii',
    PLBH: 'Legit',
    DP: 'Prae',
    FHOTN: 'Fiery',
    RBOSI: 'Sql',
    SDFC: 'Dupa',
    EL: 'Euro',
    DROTU: 'Deth',
    SGBES: 'Gamma',
    TDVOX: 'Xmax',
    TTOED: 'Epic duck',
    VH: 'Valk',
    C: 'Cth',
  };

  const deriveAcronym = value => String(value || '')
    .replace(/\([^)]*\)/g, ' ')
    .split(/[^A-Za-z0-9']+/)
    .map(word => word.replace(/^'+|'+$/g, '').charAt(0))
    .filter(Boolean)
    .join('')
    .toUpperCase();

  /* The acronym an item shows: its listed nickname, or nothing at all. */
  const acronymFor = value => ACRONYMS[deriveAcronym(value)] || '';

  const fields = name => [...document.querySelectorAll(`[data-item-field="${name}"]`)];
  const field = name => document.querySelector(`[data-item-field="${name}"]`);

  /* Write plain text into every placeholder with this name. */
  function setText(name, value) {
    const text = (value === null || value === undefined || value === '') ? EMPTY : String(value);
    fields(name).forEach(element => { element.textContent = text; });
  }

  /* Same, but formats numbers and falls back to the dash when unknown. */
  function setNumber(name, value) {
    setText(name, Number.isFinite(value) ? formatNumber(value) : null);
  }

  function show(name, visible) {
    fields(name).forEach(element => { element.hidden = !visible; });
  }

  const toNumber = value => {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  };

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  };

  /* ------------------------------------------------------------------ */
  /* Which item?                                                         */
  /* ------------------------------------------------------------------ */

  /*
   * Accepts /item/?id=N, /item/N and /item/N/any-slug. The query
   * string is the form the cards link to, because the site is served as
   * plain static files and pretty paths would need a rewrite rule.
   */
  function readAssetId() {
    const params = new URLSearchParams(window.location.search);
    const fromQuery = toNumber(params.get('id') || params.get('assetId'));
    if (fromQuery && fromQuery > 0) return fromQuery;

    const segments = window.location.pathname.split('/').filter(Boolean);
    const index = segments.indexOf('item');
    const fromPath = index === -1 ? null : toNumber(segments[index + 1]);
    return fromPath && fromPath > 0 ? fromPath : null;
  }

  /* ------------------------------------------------------------------ */
  /* Tabs                                                                */
  /* ------------------------------------------------------------------ */

  /*
   * The snapshot drove its tabs with Bootstrap's JS bundle, which this site
   * does not ship. A dozen lines replace it: show the pane the clicked link
   * points at, hide its siblings.
   *
   * A chart drawn into a hidden pane has no width to measure, so switching
   * tabs also tells the chart module to have another go - see drawCharts().
   */
  const tabListeners = new Set();

  function initTabs() {
    document.querySelectorAll('[data-tabs]').forEach(group => {
      const scope = group.matches('.nav-tabs') ? group.parentElement : group;
      const links = [...group.querySelectorAll('.nav-link[data-toggle="tab"]')];
      const panes = [...scope.querySelectorAll('.tab-content > .tab-pane')];
      links.forEach(link => {
        link.addEventListener('click', event => {
          event.preventDefault();
          const id = link.getAttribute('href');
          const target = scope.querySelector(id);
          if (!target) return;
          links.forEach(other => other.classList.toggle('active', other === link));
          panes.forEach(pane => pane.classList.toggle('active', pane === target));
          tabListeners.forEach(fn => fn(id.replace('#', '')));
        });
      });
    });
  }

  /* ------------------------------------------------------------------ */
  /* Copy-to-clipboard buttons                                           */
  /* ------------------------------------------------------------------ */

  /*
   * navigator.clipboard only exists in a secure context. The site is served
   * over plain HTTP on a LAN address for most of its life, so on the machines
   * this is actually used from that API is simply absent and every copy button
   * did nothing at all. The old textarea trick still works everywhere, so it
   * is used as the fallback rather than leaving the buttons dead.
   */
  async function copyText(value) {
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(value);
        return true;
      } catch (error) {
        /* Refused - fall through and try the old way. */
      }
    }

    const holder = document.createElement('textarea');
    holder.value = value;
    /* Off-screen but still focusable, and readonly so a phone does not throw
     * its keyboard up over the page. */
    holder.setAttribute('readonly', '');
    holder.style.position = 'fixed';
    holder.style.top = '-1000px';
    holder.style.opacity = '0';
    document.body.appendChild(holder);
    let copied = false;
    try {
      holder.select();
      holder.setSelectionRange(0, holder.value.length);
      copied = document.execCommand('copy');
    } catch (error) {
      copied = false;
    }
    holder.remove();
    return copied;
  }

  function initCopyButtons() {
    document.querySelectorAll('.copy-id-button').forEach(button => {
      button.addEventListener('click', async () => {
        const value = button.dataset.copyValue;
        if (!value) return;
        const copied = await copyText(value);

        /* Say something either way - a button that looks inert is worse than
         * one that admits it could not do it. */
        const label = button.querySelector('.copy-id-value');
        if (!label) return;
        const original = label.textContent;
        label.textContent = copied ? 'Copied' : 'Press Ctrl+C';
        setTimeout(() => { label.textContent = original; }, 1200);
      });
    });
  }

  function setCopyValue(name, value) {
    fields(name).forEach(button => { button.dataset.copyValue = value; });
  }

  /* ------------------------------------------------------------------ */
  /* Fetching                                                            */
  /* ------------------------------------------------------------------ */

  /* Every request is optional: one dead endpoint must not blank the page. */
  const optional = promise => promise.catch(() => null);

  async function loadItem(id) {
    const [detail, info, resale, resellers, thumbs, owners, changes] = await Promise.all([
      /* Name, type and the Limited flags, with the module's own fallbacks. */
      optional(API.getItemDetails([id], { includePrice: false, includeRap: false })
        .then(rows => rows[0] || null)),
      /* Description, creator and the original price. getItemDetails only
       * carries these when it takes the productinfo fallback path, and this
       * page always wants them, so ask for them outright. */
      optional(API.fetchJson(`${API.API_BASE}/apisite/api/marketplace/productinfo?assetId=${id}`)),
      optional(API.fetchJson(`${API.API_BASE}/apisite/economy/v1/assets/${id}/resale-data`)),
      optional(API.fetchJson(
        `${API.API_BASE}/apisite/economy/v1/assets/${id}/resellers?limit=${RESELLER_LIMIT}`)),
      optional(API.fetchThumbnails([id])),
      /* Every visible copy. This is what the Owner Lists, the Ownership boxes
       * and two of the four charts are built from. */
      optional(API.getAssetOwners(id)),
      /* Our own change log, for the Value chart. Every value edit is recorded
       * with its date, so the chart can show when the value actually moved
       * instead of drawing a flat line at today's figure. */
      optional(fetch(`${API.API_BASE}/api/changes?limit=500`)
        .then(response => response.json())
        .then(payload => (payload && payload.ok ? payload.changes : []))),
    ]);

    const merged = detail ? { ...detail } : null;
    if (merged && info) {
      merged.name = merged.name || String(info.Name || '').trim();
      merged.description = merged.description || String(info.Description || '').trim();
      merged.creatorName = merged.creatorName || String(info.Creator?.Name || '').trim();
      if (merged.assetType === null) merged.assetType = toNumber(info.AssetTypeId);
    }

    return {
      detail: merged,
      info,
      resale,
      listings: Array.isArray(resellers?.data) ? resellers.data : [],
      owners: Array.isArray(owners) ? owners : [],
      /* Only this item's edits matter to the Value chart. */
      changes: (Array.isArray(changes) ? changes : []).filter(c => Number(c?.id) === id),
      thumbnail: thumbs?.get(id) || API.thumbnailUrl(id),
    };
  }

  /* ------------------------------------------------------------------ */
  /* Owner lists                                                         */
  /* ------------------------------------------------------------------ */

  /* A player's headshot in the 38px column the capture reserves for it. */
  function avatarCell(userId, name) {
    const link = el('a');
    link.href = `/player/?id=${userId}`;
    const img = el('img');
    img.width = 30;
    img.height = 30;
    img.loading = 'lazy';
    img.alt = '';
    img.style.borderRadius = '33%';
    img.style.backgroundColor = '#23272b';
    img.dataset.playerHeadshot = String(userId);
    img.title = name || '';
    link.appendChild(img);
    return link;
  }

  function playerCell(userId, name) {
    const link = el('a', 'woli-dt-player', name || `User ${userId}`);
    link.href = `/player/?id=${userId}`;
    return link;
  }

  /* The capture's Trade button, pointed at Wanwood's trade window. */
  function tradeCell(userId) {
    const link = el('a', 'btn btn-sm woli-trade-btn', 'Trade');
    link.href = `${SITE_BASE}/Trade/TradeWindow.aspx?TradePartnerID=${userId}`;
    link.target = '_blank';
    link.rel = 'noopener';
    return link;
  }

  /* "24 days ago", with the exact stamp on hover - the capture's format. */
  function agoCell(iso) {
    if (!iso) return EMPTY;
    const when = Date.parse(iso);
    if (!Number.isFinite(when)) return EMPTY;
    const days = Math.floor((Date.now() - when) / 86400000);
    let words;
    if (days <= 0) words = 'today';
    else if (days === 1) words = 'yesterday';
    else if (days < 30) words = `${days} days ago`;
    else if (days < 365) {
      const months = Math.round(days / 30);
      words = months === 1 ? 'a month ago' : `${months} months ago`;
    } else {
      const years = Math.round(days / 365);
      words = years === 1 ? 'a year ago' : `${years} years ago`;
    }
    const span = el('span', null, words);
    span.title = new Date(when).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
    return span;
  }

  function uaidCell(uaid) {
    if (!uaid) return EMPTY;
    return el('span', 'text-light', formatNumber(uaid));
  }

  /*
   * Every headshot on the page in one batched request.
   *
   * The tables only keep one page of rows in the DOM at a time, so the <img>
   * tags are thrown away and rebuilt every time somebody sorts, searches or
   * turns the page. Resolved URLs are therefore remembered here and re-applied
   * to whatever rows currently exist, rather than being fetched once and lost
   * on the first click.
   */
  const headshots = new Map();

  function applyHeadshots() {
    document.querySelectorAll('img[data-player-headshot]').forEach(img => {
      const url = headshots.get(Number(img.dataset.playerHeadshot));
      if (url && img.getAttribute('src') !== url) img.src = url;
    });
  }

  async function paintHeadshots() {
    const images = [...document.querySelectorAll('img[data-player-headshot]')];
    const ids = [...new Set(images.map(img => Number(img.dataset.playerHeadshot)))]
      .filter(id => Number.isSafeInteger(id) && id > 0 && !headshots.has(id));

    if (ids.length) {
      try {
        (await API.fetchUserHeadshots(ids, 48)).forEach((url, id) => headshots.set(id, url));
      } catch (error) {
        /* No headshots is a cosmetic loss, not a failure. */
      }
    }
    applyHeadshots();
  }

  const tables = {};

  function buildTables() {
    if (!TABLE) return;

    tables.all = TABLE.attach(document.querySelector('[data-dt="all_copies_table"]'), {
      onRender: applyHeadshots,
      sort: { index: 2, direction: 'asc' },
      columns: [
        { className: 'woli-dt-avatar', cell: row => avatarCell(row.userId, row.name) },
        { cell: row => playerCell(row.userId, row.name), sort: row => row.name, search: row => row.name },
        { cell: row => (row.serialNumber ? formatNumber(row.serialNumber) : EMPTY), sort: row => row.serialNumber, search: row => row.serialNumber },
        { cell: row => agoCell(row.updated || row.created), sort: row => Date.parse(row.updated || row.created) || null },
        { cell: row => uaidCell(row.userAssetId), sort: row => row.userAssetId, search: row => row.userAssetId },
        { cell: row => tradeCell(row.userId) },
      ],
    });

    tables.forSale = TABLE.attach(document.querySelector('[data-dt="for_sale_table"]'), {
      onRender: applyHeadshots,
      sort: { index: 3, direction: 'asc' },
      columns: [
        { className: 'woli-dt-avatar', cell: row => avatarCell(row.userId, row.name) },
        { cell: row => playerCell(row.userId, row.name), sort: row => row.name, search: row => row.name },
        { cell: row => (row.serialNumber ? formatNumber(row.serialNumber) : EMPTY), sort: row => row.serialNumber, search: row => row.serialNumber },
        { cell: row => (row.price === null ? EMPTY : formatNumber(row.price)), sort: row => row.price, search: row => row.price },
        { cell: row => uaidCell(row.userAssetId), sort: row => row.userAssetId, search: row => row.userAssetId },
        { cell: row => tradeCell(row.userId) },
      ],
    });

    tables.hoards = TABLE.attach(document.querySelector('[data-dt="hoards_table"]'), {
      onRender: applyHeadshots,
      sort: { index: 2, direction: 'desc' },
      columns: [
        { className: 'woli-dt-avatar', cell: row => avatarCell(row.userId, row.name) },
        { cell: row => playerCell(row.userId, row.name), sort: row => row.name, search: row => row.name },
        { cell: row => formatNumber(row.copies), sort: row => row.copies, search: row => row.copies },
        { cell: row => row.serials, search: row => row.serials },
        { cell: row => tradeCell(row.userId) },
      ],
    });
  }

  /* One row per player holding two or more copies, which is what "hoarded"
   * means everywhere else on the site. */
  function hoardRows(owners) {
    const byPlayer = new Map();
    owners.forEach(owner => {
      const entry = byPlayer.get(owner.userId)
        || { userId: owner.userId, name: owner.name, copies: 0, list: [] };
      entry.copies += 1;
      if (owner.serialNumber) entry.list.push(owner.serialNumber);
      byPlayer.set(owner.userId, entry);
    });
    return [...byPlayer.values()]
      .filter(entry => entry.copies > 1)
      .map(entry => ({
        ...entry,
        serials: entry.list.length
          ? entry.list.sort((a, b) => a - b).map(n => `#${formatNumber(n)}`).join(', ')
          : EMPTY,
      }));
  }

  /* ------------------------------------------------------------------ */
  /* Charts                                                              */
  /* ------------------------------------------------------------------ */

  /*
   * Four tabs, all drawn by the profile page's chart module.
   *
   *   History     RAP over time against the value, the same pair of series
   *               the player page plots
   *   Value       the value alone, as a flat line at today's figure across the
   *               period RAP covers - the backend keeps a change log but not a
   *               dated value series, so this is the honest shape of it
   *   Copies      copies in circulation and copies listed for sale
   *   Ownership   owners against copies
   *
   * The module takes {time, value, rap} rows and plots two series. The last
   * two tabs re-use those two slots for their own pair of numbers and pass
   * their own series names, which is the one thing the module was taught to
   * accept - everything else about the chart is exactly what the profile page
   * draws, from the same file.
   */
  const charts = { drawn: new Set(), data: null };

  /*
   * Wanwood's price history is extremely thin: resale-data usually answers
   * with a single dated point, and often with none at all. The chart module
   * needs two points before it will draw anything, so building every tab out
   * of priceDataPoints left all four of them showing "Not enough sale history
   * yet" on every item on the site.
   *
   * Each tab is therefore built from whichever real, dated data actually
   * answers the question it asks. Nothing here invents a number: every point
   * is either something Wanwood reported or a count of rows it returned.
   */

  /* The recorded sale prices, plus today's RAP - which is a real figure the
   * API reports right now, so dating it today is accurate rather than made
   * up. That is what turns a lone historical point into a drawable line. */
  function historyRows(resale, value) {
    const points = Array.isArray(resale?.priceDataPoints) ? resale.priceDataPoints : [];
    const rows = points
      .map(point => {
        const time = Date.parse(point?.date);
        const rap = toNumber(point?.value);
        if (!Number.isFinite(time) || rap === null) return null;
        return { time, value, rap };
      })
      .filter(Boolean)
      .sort((a, b) => a.time - b.time);

    const today = toNumber(resale?.recentAveragePrice);
    if (today !== null) {
      const now = Date.now();
      /* Only if the series does not already end today, so a backend that does
       * keep a full history is left exactly as it reported it. */
      const last = rows[rows.length - 1];
      if (!last || now - last.time > 43200000) rows.push({ time: now, value, rap: today });
    }
    return rows;
  }

  /*
   * Copies in circulation over time.
   *
   * Every copy carries the date it was created, so counting them up in date
   * order is a real history of how the supply grew - far better than the flat
   * line the price points used to produce. Listings are only known as they
   * stand today, so that series is drawn flat and labelled as the current
   * count.
   */
  function copiesRows(resale, listings, owners) {
    const stamps = owners
      .map(owner => Date.parse(owner.created))
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    if (!stamps.length) return [];

    const rows = stamps.map((time, index) => ({
      time,
      value: index + 1,
      rap: listings.length,
    }));
    /* Carry the last known state to today so the line reaches the right edge
     * instead of stopping on the day the final copy was handed out. */
    rows.push({ time: Date.now(), value: stamps.length, rap: listings.length });
    return rows;
  }

  /* Owners against copies, counted up the same way. */
  function ownershipRows(resale, owners) {
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

  /*
   * The value over time, against the RAP on the same dates.
   *
   * This is real history rather than a flat line: the backend logs every value
   * edit to /api/changes, so replaying that log backwards from today's figure
   * gives the value as it stood on each date it moved. An item nobody has
   * re-valued yet has one step and draws as a straight line, which is the
   * truth about it.
   */
  function valueRows(resale, value, changes) {
    /* Value edits for this item, oldest first. */
    const edits = (Array.isArray(changes) ? changes : [])
      .filter(change => change && change.field === 'value' && Number.isFinite(change.at))
      .sort((a, b) => a.at - b.at);

    const valueAt = when => {
      /* Before the first recorded edit the item had whatever that edit
       * replaced - usually nothing, which is 0. */
      let current = Number(edits.length ? edits[0].old : value) || 0;
      edits.forEach(edit => {
        if (edit.at <= when) current = Number(edit.new) || 0;
      });
      return current;
    };

    /*
     * The dates worth plotting: every recorded sale, every value edit, and
     * today. Keying off the change log rather than the price series means an
     * item whose value has moved still draws its steps even when Wanwood has
     * no price history for it at all.
     */
    const points = Array.isArray(resale?.priceDataPoints) ? resale.priceDataPoints : [];
    const rapAt = new Map();
    points.forEach(point => {
      const time = Date.parse(point?.date);
      const rap = toNumber(point?.value);
      if (Number.isFinite(time) && rap !== null) rapAt.set(time, rap);
    });

    const today = Date.now();
    const currentRap = toNumber(resale?.recentAveragePrice);
    if (currentRap !== null) rapAt.set(today, currentRap);

    const stamps = new Set([...rapAt.keys(), ...edits.map(edit => edit.at)]);
    if (edits.length) stamps.add(today);
    if (stamps.size < 2) return [];

    /* Between recorded sales the RAP is simply the last one reported. */
    const sortedRap = [...rapAt.entries()].sort((a, b) => a[0] - b[0]);
    const rapFor = when => {
      let last = 0;
      sortedRap.forEach(([time, rap]) => { if (time <= when) last = rap; });
      return last;
    };

    return [...stamps]
      .sort((a, b) => a - b)
      .map(time => ({ time, value: valueAt(time), rap: rapFor(time) }));
  }

  const CHART_PANES = {
    history_chart_container: {
      div: 'history_chart_div',
      rows: d => historyRows(d.resale, d.value),
      empty: 'Wanwood has not recorded any sales of this item yet.',
    },
    value_chart_container: {
      div: 'value_chart_div',
      rows: d => valueRows(d.resale, d.value, d.changes),
      empty: 'This item\u2019s value has not been changed yet, so there is nothing to plot.',
    },
    copies_chart_container: {
      div: 'copies_chart_div',
      rows: d => copiesRows(d.resale, d.listings, d.owners),
      names: { value: 'Copies', rap: 'Listed for sale', axis: 'Copies' },
      empty: 'No copies of this item have a visible owner.',
    },
    ownership_chart_container: {
      div: 'ownership_chart_div',
      rows: d => ownershipRows(d.resale, d.owners),
      names: { value: 'Owners', rap: 'Copies held', axis: 'Players' },
      empty: 'No copies of this item have a visible owner.',
    },
  };

  /*
   * Draw one tab's chart, once. Highcharts measures its container, so a pane
   * that is display:none when the chart is created comes out zero-wide; the
   * three inactive tabs are therefore left until they are first opened.
   */
  /*
   * The Owner History tab.
   *
   * Not a chart - a list of who handed what to whom. It can only cover the
   * period since the server started watching, so the note above it says when
   * that was rather than letting a short list read as the whole story.
   */
  async function loadOwnerHistory(assetId) {
    const list = document.getElementById('owner_history_list');
    const note = document.getElementById('owner_history_note');
    if (!list) return;

    list.replaceChildren();
    const loading = el('div', 'small py-2', 'Reading the ownership log\u2026');
    loading.style.color = '#7a8288';
    list.appendChild(loading);

    let payload;
    try {
      const base = (window.WOLIMONS_CONFIG && window.WOLIMONS_CONFIG.apiBase) || '';
      const response = await fetch(`${base}/api/ownership/item?id=${assetId}&limit=200`);
      payload = await response.json();
      if (!payload || payload.ok === false) throw new Error('refused');
    } catch (error) {
      list.replaceChildren();
      const failed = el('div', 'small py-2', 'The ownership log could not be read.');
      failed.style.color = '#7a8288';
      list.appendChild(failed);
      return;
    }

    const events = Array.isArray(payload.events) ? payload.events : [];
    const status = payload.status || {};

    if (note) {
      note.textContent = status.tracking
        ? `Tracked since ${new Date(status.startedAt).toISOString().slice(0, 10)}. `
          + 'Trades made before then are not recorded anywhere and cannot be shown.'
        : 'Ownership tracking has not taken its first reading yet.';
    }

    list.replaceChildren();
    if (!events.length) {
      const empty = el('div', 'small py-2',
        'No copy of this item has changed hands since tracking began.');
      empty.style.color = '#7a8288';
      list.appendChild(empty);
      return;
    }

    events.forEach(event => list.appendChild(transferRow(event)));
  }

  /* One "#12  luke -> Nun" line. */
  function transferRow(event) {
    const row = el('div', 'trade_ad_picker_row');

    const serial = el('div', 'text-nowrap mr-2', event.serial ? `#${formatNumber(event.serial)}` : 'No serial');
    serial.style.color = event.serial ? '#c9a227' : '#7a8288';
    serial.style.minWidth = '78px';
    row.appendChild(serial);

    const body = el('div', 'flex-grow-1');
    const line = el('div', 'd-flex align-items-center flex-wrap');

    const from = el('a', null, event.fromName || `User ${event.from}`);
    from.href = `/player/?id=${event.from}`;
    from.style.color = '#e9ecef';
    line.appendChild(from);

    const arrow = el('span', 'mx-2', '\u2192');
    arrow.style.color = '#7a8288';
    line.appendChild(arrow);

    const to = el('a', null, event.toName || `User ${event.to}`);
    to.href = `/player/?id=${event.to}`;
    to.style.color = '#81c784';
    line.appendChild(to);

    body.appendChild(line);
    const when = el('div', 'small', utcStamp(event.at));
    when.style.color = '#7a8288';
    body.appendChild(when);
    row.appendChild(body);

    return row;
  }

  function utcStamp(timestamp) {
    const when = new Date(Number(timestamp));
    if (Number.isNaN(when.getTime())) return '';
    return when.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  }

  function drawChart(pane) {
    if (!CHART || charts.drawn.has(pane) || !charts.data) return;
    const spec = CHART_PANES[pane];
    if (!spec) return;
    const container = document.getElementById(spec.div);
    if (!container) return;
    charts.drawn.add(pane);
    CHART.render(container, spec.rows(charts.data), spec.names, spec.empty);
  }

  function initCharts(data) {
    charts.data = data;
    charts.drawn.clear();
    /* The open tab can be drawn straight away; the rest wait for their click. */
    drawChart('history_chart_container');
    tabListeners.add(pane => {
      if (pane === 'owner_history_container') {
        if (!charts.drawn.has(pane)) {
          charts.drawn.add(pane);
          loadOwnerHistory(data.id);
        }
        return;
      }
      drawChart(pane);
    });
  }

  /* ------------------------------------------------------------------ */
  /* Flags                                                               */
  /* ------------------------------------------------------------------ */

  /*
   * The flags beside the item name: the Limited / Limited U ribbon, which the
   * API decides, and the Rare gem, which it does not.
   *
   * Rare is a judgement call about an item, not a fact any endpoint reports,
   * so it is read from the "rare" category in values.js - the same hand-set
   * list the catalog filters on, and the same one the editor below writes.
   */
  function renderFlag(isLimited, isLimitedUnique, isRare) {
    const holder = field('flag');
    if (!holder) return;
    holder.textContent = '';

    if (isLimited) {
      const ribbon = document.createElement('img');
      ribbon.src = isLimitedUnique ? '/img/limitedu.svg' : '/img/limited.svg';
      ribbon.alt = isLimitedUnique ? 'Limited U' : 'Limited';
      ribbon.width = isLimitedUnique ? 75 : 56;
      ribbon.height = 15;
      holder.append(ribbon);
    }

    if (isRare) holder.append(rareFlag());

    /* Nothing to say about this item: the slot leaves the flow entirely so it
     * cannot push the name around. */
    holder.hidden = !holder.firstChild;
  }

  /* The gem plus its label, as one inline group. */
  function rareFlag() {
    const wrap = el('span', 'item_flag_rare');
    wrap.title = 'Rare - a hand-picked scarce item';

    const gem = document.createElement('img');
    gem.src = '/img/rare.svg';
    gem.alt = '';
    gem.width = 16;
    gem.height = 16;
    gem.setAttribute('aria-hidden', 'true');

    wrap.append(gem, el('span', null, 'Rare'));
    return wrap;
  }

  /* ------------------------------------------------------------------ */
  /* Value editor                                                        */
  /* ------------------------------------------------------------------ */

  /*
   * The editor mirrors the admin panel's Item values pane, reduced to the one
   * item this page is already showing. Same controls, same request, same
   * server-side rules about who may write - see proxy/api.js.
   *
   * Two things have to be true before it appears: the linked Wanwood account
   * has a rank that may set values, and the browser still holds the identity
   * token that proves it controls that account - the server checks both on
   * every save, so a hidden editor is a convenience rather than the security
   * boundary.
   */
  const editor = {
    id: null,
    demand: '',
    trend: '',
    method: '',
    categories: new Set(),
    can: false,
  };

  function notice(message, tone) {
    const box = field('editor-notice');
    if (!box) return;
    box.textContent = message || '';
    box.style.color = tone === 'bad' ? '#e57373' : tone === 'good' ? '#81c784' : '#7a8288';
  }

  /* Toggle one of the catalog's filter chips. */
  function setPressed(button, on) {
    button.setAttribute('aria-pressed', on ? 'true' : 'false');
    button.classList.toggle('active', Boolean(on));
  }

  /* A group of chips where exactly one may be lit, "None" standing for unset. */
  function initChoiceGroup(name, attribute, apply) {
    const group = field(name);
    if (!group) return;
    group.querySelectorAll(`[data-${attribute}-value]`).forEach(button => {
      button.addEventListener('click', () => {
        const raw = button.dataset[`${attribute}Value`];
        apply(raw === 'None' ? '' : raw);
      });
    });
  }

  function paintChoiceGroup(name, attribute, current) {
    const group = field(name);
    if (!group) return;
    group.querySelectorAll(`[data-${attribute}-value]`).forEach(button => {
      const value = button.dataset[`${attribute}Value`];
      setPressed(button, current ? value === current : value === 'None');
    });
  }

  function paintCategories() {
    const group = field('editor-categories');
    if (!group) return;
    group.querySelectorAll('[data-category-value]').forEach(button => {
      setPressed(button, editor.categories.has(button.dataset.categoryValue));
    });
  }

  function initEditorControls() {
    initChoiceGroup('editor-demand', 'demand', value => {
      editor.demand = value;
      paintChoiceGroup('editor-demand', 'demand', editor.demand);
    });
    initChoiceGroup('editor-trend', 'trend', value => {
      editor.trend = value;
      paintChoiceGroup('editor-trend', 'trend', editor.trend);
    });
    initChoiceGroup('editor-method', 'method', value => {
      editor.method = value;
      paintChoiceGroup('editor-method', 'method', editor.method);
    });

    const categories = field('editor-categories');
    if (categories) {
      categories.querySelectorAll('[data-category-value]').forEach(button => {
        button.addEventListener('click', () => {
          const name = button.dataset.categoryValue;
          if (editor.categories.has(name)) editor.categories.delete(name);
          else editor.categories.add(name);
          paintCategories();
        });
      });
    }

    const save = field('editor-save');
    if (save) save.addEventListener('click', saveValue);
  }

  /* Load the item's current figures into the controls. */
  function fillEditor(id) {
    editor.id = id;
    editor.demand = VALUES.demand(id) || '';
    editor.trend = VALUES.trend(id) || '';
    editor.method = VALUES.method(id) || '';
    editor.categories = new Set(VALUES.categories(id).filter(name => name !== 'valued'));

    const amount = field('editor-value');
    if (amount) {
      const value = VALUES.get(id);
      amount.value = value ? String(value) : '';
    }
    const note = field('editor-note');
    if (note) note.value = VALUES.note(id) || '';

    paintChoiceGroup('editor-demand', 'demand', editor.demand);
    paintChoiceGroup('editor-trend', 'trend', editor.trend);
    paintChoiceGroup('editor-method', 'method', editor.method);
    paintCategories();
    notice('');
  }

  async function saveValue() {
    if (!editor.id) return;
    const account = ACCOUNT ? ACCOUNT.get() : null;
    if (!account || !account.name) {
      notice('Link your Wanwood account first, on the Verify page.', 'bad');
      return;
    }
    const token = ACCOUNT && typeof ACCOUNT.getToken === 'function' ? ACCOUNT.getToken() : '';
    if (!token) {
      notice('Your verification has expired - link the account again on the Verify page.', 'bad');
      return;
    }

    const amountBox = field('editor-value');
    const raw = amountBox ? amountBox.value.trim() : '';
    const amount = raw === '' ? 0 : Number(raw.replace(/,/g, ''));
    if (!Number.isFinite(amount) || amount < 0) {
      notice('Value must be a number, zero or more.', 'bad');
      return;
    }

    /* The same economy guard the panel has: a seven-figure value moves every
     * holder's total, badges and rank the moment it lands, so it is worth a
     * deliberate pause. */
    if (amount >= 1000000) {
      const sure = window.confirm(
        `Set this item to ${formatNumber(amount)}?\n\n`
        + 'A value this large changes every holder\'s total, badges and '
        + 'leaderboard position as soon as it is saved.',
      );
      if (!sure) {
        notice('Not saved.');
        return;
      }
    }

    const noteBox = field('editor-note');
    notice('Saving...');
    try {
      const response = await fetch(`${API.API_BASE}/api/values/set`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: account.name,
          id: editor.id,
          value: amount,
          demand: editor.demand || null,
          trend: editor.trend || null,
          method: editor.method || null,
          note: noteBox ? noteBox.value : '',
          categories: [...editor.categories],
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || `The backend refused that (${response.status}).`);
      }
      /* Pull the table back so this page - and the rest of the site - agree
       * with what was actually stored. The subscribe() below redraws. */
      await VALUES.refresh();
      notice('Saved.', 'good');
    } catch (error) {
      notice(error.message, 'bad');
    }
  }

  /*
   * Decide whether this visitor may edit, and show or hide the block. Writes
   * are locked to the staff roster now, so the editor only appears when the
   * linked account is ranked and the browser still holds the identity token
   * to prove it - otherwise saving would just be refused.
   */
  async function refreshEditorAccess(id) {
    const account = ACCOUNT ? ACCOUNT.get() : null;
    editor.can = false;

    const token = ACCOUNT && typeof ACCOUNT.getToken === 'function' ? ACCOUNT.getToken() : '';
    if (account && account.name && token) {
      try {
        const response = await fetch(
          `${API.API_BASE}/api/me?name=${encodeURIComponent(account.name)}`);
        const payload = await response.json();
        /* The roster still decides - a ranked name gets the editor here, and
         * an unranked one gets it in the panel instead. If the backend cannot
         * be reached the editor stays hidden rather than guessing. */
        editor.can = Boolean(payload && payload.ok && payload.canSetValues);
      } catch (error) {
        editor.can = false;
      }
    }

    show('editor', editor.can);
    if (!editor.can) return;

    const who = field('editor-who');
    if (who && account) who.textContent = `Signed in as ${account.name}`;
    fillEditor(id);
  }

  /* ------------------------------------------------------------------ */
  /* Rendering                                                           */
  /* ------------------------------------------------------------------ */

  /*
   * Everything that comes out of values.js. Split from render() because it
   * runs again on its own whenever the values change - after a save here, or
   * after the backend's table lands a moment behind the page.
   */
  function renderValuation(id, rap) {
    const value = VALUES.get(id);
    setNumber('value', value);
    setText('demand', VALUES.demand(id));
    setText('trend', VALUES.trend(id));

    const method = VALUES.method(id);
    const text = METHOD_TEXT[method];
    setText('valuation-method', text ? text.label : null);
    const blurb = field('valuation-blurb');
    if (blurb) {
      blurb.textContent = text
        ? text.blurb
        : 'Nobody has recorded how this item is valued yet.';
    }

    const note = VALUES.note(id);
    setText('valuation-note', note);
    show('valuation-note-box', Boolean(note));

    const credit = field('valuation-credit');
    if (credit) {
      credit.textContent = value
        ? ''
        : 'This item has not been valued yet. Value stays at 0 until the value team sets it.';
    }

    /* The Rare gem is a category, so it moves with the values too. */
    const flagHolder = field('flag');
    if (flagHolder) {
      const ribbon = flagHolder.querySelector('img[src*="limited"]');
      renderFlag(Boolean(ribbon), Boolean(ribbon && /limitedu/.test(ribbon.src)),
        VALUES.categories(id).includes('rare'));
    }

    /*
     * Value vs RAP. Not in the snapshot, kept from the item page this one
     * replaces: it is the one figure that says whether the community thinks
     * an item is worth more or less than it has been selling for.
     */
    const target = field('value-vs-rap');
    if (target) {
      if (!value || !Number.isFinite(rap) || rap <= 0) {
        target.textContent = EMPTY;
        target.style.color = '';
      } else {
        const delta = Math.round(((value - rap) / rap) * 100);
        target.textContent = `${delta > 0 ? '+' : ''}${formatNumber(delta)}%`;
        target.style.color = delta > 0 ? '#8fe6a0' : (delta < 0 ? '#ff8585' : '#bfc7cd');
      }
    }
  }

  function render(id, data) {
    const { detail, info, resale, listings, owners, changes, thumbnail } = data;

    const name = detail?.name || `Item ${id}`;
    const restrictions = detail?.itemRestrictions || [];
    const isLimitedUnique = restrictions.includes('LimitedUnique');
    const isLimited = isLimitedUnique || restrictions.includes('Limited');

    const rap = toNumber(resale?.recentAveragePrice);
    const prices = listings.map(listing => toNumber(listing.price)).filter(price => price !== null);
    const bestPrice = prices.length ? Math.min(...prices) : null;
    const totalCopies = toNumber(resale?.assetStock);
    const available = owners.length;
    const distinctOwners = new Set(owners.map(owner => owner.userId)).size;
    const hoards = hoardRows(owners);
    const hoardedCopies = hoards.reduce((sum, entry) => sum + entry.copies, 0);
    const sales = toNumber(resale?.sales);

    /* Head + title -------------------------------------------------- */
    document.title = `${name} - Wolimons`;
    setText('name', name);
    /* The acronym chip beside the title and the Acronym cell in the grid are
     * the same figure; the chip hides itself when there is nothing to say. */
    const acronym = acronymFor(name);
    setText('acronym', acronym || null);
    setText('acronym-2', acronym || null);
    show('acronym', Boolean(acronym));
    setText('subtitle', isLimitedUnique
      ? 'Wanwood Limited U'
      : (isLimited ? 'Wanwood Limited' : 'Wanwood Item'));
    renderFlag(isLimited, isLimitedUnique, VALUES.categories(id).includes('rare'));
    fields('wanwood-link').forEach(link => {
      link.href = `${SITE_BASE}/catalog/${id}/${slugify(name)}`;
    });
    fields('thumbnail').forEach(image => {
      image.src = thumbnail;
      image.alt = `${name} thumbnail`;
    });
    /* The two buttons the snapshot filters to this item. */
    fields('value-changes-link').forEach(link => { link.href = `/valuechanges?item=${id}`; });
    fields('trade-ads-link').forEach(link => { link.href = `/trades?item=${id}`; });

    /* Overview ------------------------------------------------------ */
    setText('type', TYPE_NAMES[detail?.assetType] || null);
    setNumber('available-copies', available);
    setNumber('available-copies-2', available);
    setNumber('remaining', toNumber(resale?.numberRemaining));
    setNumber('total-copies', totalCopies);
    setNumber('total-copies-2', totalCopies);
    setNumber('owners', distinctOwners);
    setNumber('hoarded-copies', hoardedCopies);
    setNumber('sales', sales);
    setNumber('sellers', listings.length);
    setNumber('best-price', bestPrice);
    setNumber('best-price-2', bestPrice);
    setNumber('rap', rap);
    setText('creator', null);
    /*
     * The productinfo's Creator field is not to be trusted - it answers with
     * the asset's own name. Every limited is created by the account with user
     * id 1, so that account's real username is resolved instead. The
     * users/v1/users route is tried first (the one the server uses to confirm
     * a commenter's name, and the one that reliably answers), then the
     * api/users route. The productinfo figure is deliberately never used -
     * showing the item's own name as its creator is the exact bug this
     * replaces.
     */
    (async () => {
      let name = null;
      if (API) {
        if (typeof API.getProfileById === 'function') {
          const profile = await API.getProfileById(1);
          if (profile) name = profile.name;
        }
        if (!name && typeof API.getUserById === 'function') {
          const user = await API.getUserById(1);
          if (user) name = user.name;
        }
      }
      /* Never fall back to the productinfo figure (the asset's own name) -
       * if the username cannot be resolved, say "User 1" instead, which is
       * still true and still not the item name. */
      setText('creator', name || 'User 1');
    })();

    /* Two figures the snapshot does not carry, kept from the item page this
     * one replaces: how many different players are selling, and the top ask. */
    setNumber('distinct-sellers',
      new Set(listings.map(listing => listing.seller?.id).filter(Boolean)).size);
    setNumber('highest-ask', prices.length ? Math.max(...prices) : null);

    /* Copies that exist but have no visible owner: a private inventory, or a
     * deleted account. Only meaningful when the total is known. */
    setNumber('hidden-copies',
      totalCopies === null ? null : Math.max(0, totalCopies - available));

    /* Percent of visible copies held by someone with more than one. */
    const hoardedPct = available ? (hoardedCopies / available) * 100 : null;
    setText('hoarded-pct', hoardedPct === null ? null : `${hoardedPct.toFixed(1)}%`);
    setText('hoarded-pct-2', hoardedPct === null ? null : `${hoardedPct.toFixed(1)}%`);

    /*
     * Average daily sales. Wanwood reports a lifetime sale count and the item's
     * creation date, so this is sales spread over the item's whole life - not
     * the 30-day window a live feed would give. Blank when either half is
     * missing rather than shown as a zero that means "unknown".
     */
    /*
     * When the item came into existence.
     *
     * Wanwood's productinfo does not carry a created date - the backend's
     * marketplace/productinfo builds its reply by hand and simply leaves the
     * field out. Every copy does carry the date it was created, though, so
     * the oldest of those is when the item first entered circulation. That is
     * a real recorded date rather than a guess, and it is what makes Date
     * Created and Avg Daily Sales show something instead of a dash.
     */
    const ownerStamps = owners
      .map(owner => Date.parse(owner.created))
      .filter(Number.isFinite);
    const created = Date.parse(info?.Created || detail?.created || '')
      || (ownerStamps.length ? Math.min(...ownerStamps) : NaN);
    if (sales !== null && Number.isFinite(created)) {
      const days = Math.max(1, (Date.now() - created) / 86400000);
      setText('avg-daily-sales', (sales / days).toFixed(2));
    } else {
      setText('avg-daily-sales', null);
    }

    /*
     * RAP after sale. Wanwood's RAP is an average over the last ten sales, so
     * one more sale at the best price moves it by a tenth of the difference.
     * Blank unless both halves are known.
     */
    if (rap !== null && bestPrice !== null) {
      setNumber('rap-after-sale', Math.round(rap + (bestPrice - rap) / 10));
    } else {
      setText('rap-after-sale', null);
    }

    /* More info ----------------------------------------------------- */
    setText('id', id);
    setCopyValue('copy-id', String(id));
    setText('for-sale', detail ? (detail.isForSale ? 'Yes' : 'No') : null);
    setNumber('original-price', toNumber(info?.PriceInRobux));
    /* Wanwood dates its assets, so this one is real. The snapshot also lists a
     * "Date Discovered", which its own tooltip says is the same as the
     * creation date - printing the identical value twice adds nothing. */
    setText('date-created', Number.isFinite(created)
      ? new Date(created).toISOString().slice(0, 10)
      : null);

    const pageLink = `${window.location.origin}/item/?id=${id}`;
    setText('page-link', `/item/?id=${id}`);
    setCopyValue('copy-link', pageLink);

    /* Owner lists --------------------------------------------------- */
    if (tables.all) tables.all.setRows(owners);
    if (tables.hoards) tables.hoards.setRows(hoards);
    if (tables.forSale) {
      tables.forSale.setRows(listings.map(listing => ({
        userId: toNumber(listing.seller?.id) || 0,
        name: String(listing.seller?.name || 'Unknown'),
        serialNumber: toNumber(listing.serialNumber),
        price: toNumber(listing.price),
        userAssetId: toNumber(listing.userAssetId),
      })));
    }
    paintHeadshots();

    /* Charts -------------------------------------------------------- */
    initCharts({ id, resale, listings, owners, changes, value: VALUES.get(id) });

    /* About --------------------------------------------------------- */
    const kind = [
      isLimitedUnique ? 'limited unique' : (isLimited ? 'limited' : ''),
      (TYPE_NAMES[detail?.assetType] || 'item').toLowerCase(),
    ].filter(Boolean).join(' ');
    const value = VALUES.get(id);
    const demand = VALUES.demand(id);
    const sentences = [
      `${name} is a Wanwood ${kind}. Wolimons tracks its price, RAP, value, `
      + 'demand, sales history, ownership data, and value changes.',
    ];
    const facts = [];
    if (Number.isFinite(rap)) facts.push(`a RAP of ${formatNumber(rap)}`);
    facts.push(value ? `a Value of ${formatNumber(value)}` : 'no Value set yet');
    if (demand) facts.push(`a Demand rating of ${demand}`);
    sentences.push(`It currently has ${facts.join(', ')}.`);
    setText('about-overview', sentences.join(' '));

    const description = String(detail?.description || '').trim();
    if (description) {
      setText('about-description', description);
      show('about-description', true);
      show('about-description-kicker', true);
      show('about-description-divider', true);
    }

    /* Everything hand-set, and again on every later change. */
    VALUES.subscribe(() => renderValuation(id, rap));
  }

  function renderError(message) {
    fields('error').forEach(box => {
      box.textContent = message;
      box.hidden = false;
    });
  }

  /* ------------------------------------------------------------------ */
  /* Boot                                                                */
  /* ------------------------------------------------------------------ */

  initTabs();
  initCopyButtons();
  initEditorControls();
  buildTables();

  const assetId = readAssetId();
  if (!assetId) {
    setText('name', 'No item selected');
    renderError('Add an item id to the address, for example /item/?id=1581 - or pick an item from the catalog.');
  } else {
    setText('name', 'Loading\u2026');
    setText('id', assetId);
    refreshEditorAccess(assetId);
    if (ACCOUNT) ACCOUNT.subscribe(() => refreshEditorAccess(assetId));

    loadItem(assetId)
      .then(data => {
        if (!data.detail && !data.resale && !data.listings.length && !data.owners.length) {
          setText('name', `Item ${assetId}`);
          renderError('Wanwood returned nothing for this item. It may not exist, or the API may be unavailable.');
          return;
        }
        render(assetId, data);
      })
      .catch(error => {
        console.error('Could not load the item:', error);
        setText('name', `Item ${assetId}`);
        renderError('This item could not be loaded from Wanwood.');
      });
  }
})();
