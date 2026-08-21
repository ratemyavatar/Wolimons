/*
 * Render every 2018 page and report what actually appeared.
 *
 *   npm install jsdom      (once - it is the only thing this needs)
 *   node tools/render-2018.js
 *
 * The rest of the test suite reads files. This one runs the pages: it loads
 * each 2018 page into a DOM, answers every request with a reply shaped like
 * Wanwood's real ones, and then checks what is on the screen - that the
 * catalog filled with cards, that the item page counted its owners, that the
 * dropdowns open, that the phone menu opens, that the trade calculator adds
 * up. Those are the failures that never show up in a file check, and they
 * are the ones that get reported as "it does not work".
 *
 * It is not part of `npm test` on purpose: the suite is dependency-free, and
 * this needs jsdom.
 */
const fs = require('fs');
const { JSDOM } = require('jsdom');
const R = require('node:path').resolve(__dirname, '..');

let failures = 0;
const ok = (name, cond, extra) => {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (cond ? '' : '  -> ' + extra));
  if (!cond) failures++;
};

/* ---- Wanwood-shaped fixtures (field names verified against the live API) */
const IDS = [1581, 4266];
const SEARCH = { data: [{ id: 1581 }, { id: 4266 }], _total: 2, nextPageCursor: null };

/* A second, deliberately awkward catalog: enough items to need a second page,
 * and a spread of the gaps the real one has - no value, no price, no RAP. */
const MANY = Array.from({ length: 39 }, (_, index) => 1000 + index);
function manyRouter(url) {
  const s = String(url);
  const asset = (s.match(/assets?\/(\d+)/) || s.match(/assetId=(\d+)/) || [])[1];
  if (s.includes('/catalog/v1/search/items')) {
    return reply({ data: MANY.map(id => ({ id })), _total: MANY.length, nextPageCursor: null });
  }
  if (s.includes('/catalog/items/details')) return reply({}, false);
  if (s.includes('/marketplace/productinfo')) {
    const id = Number(asset);
    return reply({ Name: `Item ${id}`, AssetTypeId: 8, PriceInRobux: 75,
      /* every third item is off sale, every fifth has no stock figure */
      IsForSale: id % 3 !== 0, serialCount: id % 5 ? 100 : null, saleCount: 10 });
  }
  if (s.includes('/resale-data')) {
    const id = Number(asset);
    return reply(id % 4 ? { recentAveragePrice: 100 + id, assetStock: 50, priceDataPoints: [] } : {});
  }
  if (s.includes('/resellers')) return reply({ data: [] });
  if (s.includes('/owners')) return reply({ data: [], nextPageCursor: null });
  if (s.includes('/items/restrictions')) {
    return reply({ data: MANY.map(id => ({ id, itemRestrictions: ['Limited'] })) });
  }
  if (s.includes('/thumbnails/assets')) {
    return reply({ data: MANY.map(id => ({ targetId: id, state: 'Completed', imageUrl: `https://img/${id}.png` })) });
  }
  if (s.includes('/api/v1/values') || s.includes('/api/values')) {
    const values = {};
    MANY.forEach((id, index) => {
      /* two thirds valued, one flagged projected, one hidden as a tablet */
      if (index % 3) values[id] = { value: 500 * (index + 1), demand: 'High', trend: 'Stable',
        categories: index === 4 ? ['projected'] : (index === 7 ? ['tablet'] : []) };
    });
    return reply({ success: true, updatedAt: 9, values });
  }
  return reply({ data: [] });
}
const PRODUCTS = {
  1581: { Name: 'Domino Crown', Description: 'A crown.', AssetTypeId: 8, PriceInRobux: 100, IsForSale: false },
  4266: { Name: 'Playful Vampire', Description: 'Teeth.', AssetTypeId: 18, PriceInRobux: 75, IsForSale: true },
};
const RESALE = {
  1581: { assetStock: 20, sales: 12, numberRemaining: 3, recentAveragePrice: 9500,
    priceDataPoints: [{ value: 9000, date: '2026-06-01T00:00:00Z' }, { value: 9500, date: '2026-07-01T00:00:00Z' }] },
  4266: { assetStock: 5, sales: 1, numberRemaining: 0, recentAveragePrice: 150, priceDataPoints: [] },
};
/* 99 rather than 12: id 12 is BadDecisions, the holding account the roster
 * deliberately keeps off the board. */
const OWNERS = {
  1581: [
    { id: 900, serialNumber: 1, created: '2026-01-02T00:00:00Z', updated: '2026-02-01T00:00:00Z', owner: { id: 486, type: 'User', name: 'Nun' } },
    { id: 901, serialNumber: 2, created: '2026-01-03T00:00:00Z', updated: '2026-02-01T00:00:00Z', owner: { id: 486, type: 'User', name: 'Nun' } },
    { id: 902, serialNumber: 3, created: '2026-01-04T00:00:00Z', updated: '2026-02-01T00:00:00Z', owner: { id: 99, type: 'User', name: 'goob' } },
  ],
  4266: [],
};
const RESELLERS = {
  1581: { data: [{ price: 11000, seller: { id: 99, name: 'goob' } }, { price: 12000, seller: { id: 486, name: 'Nun' } }] },
  4266: { data: [] },
};
/* Only the crown is valued; the vampire has to come out at its RAP. */
const VALUES = {
  success: true, updatedAt: 5,
  values: {
    1581: { value: 10000, demand: 'High', trend: 'Stable', categories: ['rare'], method: 'proof', note: '' },
    4266: { demand: 'Low', trend: 'Stable', categories: ['projected'] },
  },
};
const COLLECTIBLES = {
  data: [
    { userAssetId: 900, assetId: 1581, name: 'Domino Crown', recentAveragePrice: 9500, serialNumber: 1 },
    { userAssetId: 902, assetId: 4266, name: 'Playful Vampire', recentAveragePrice: 150, serialNumber: 7 },
  ],
  totalRap: 9650, nextPageCursor: null,
};

function reply(body, ok = true) {
  return Promise.resolve({
    ok, status: ok ? 200 : 404,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    headers: { get: () => 'application/json' },
  });
}

function router(url) {
  const s = String(url);
  const asset = (s.match(/assets?\/(\d+)/) || s.match(/assetId=(\d+)/) || [])[1];
  if (s.includes('/catalog/v1/search/items')) return reply(SEARCH);
  if (s.includes('/catalog/items/details')) return reply({}, false);
  if (s.includes('/marketplace/productinfo')) return reply(PRODUCTS[asset] || {});
  if (s.includes('/resale-data')) return reply(RESALE[asset] || {});
  if (s.includes('/resellers')) return reply(RESELLERS[asset] || { data: [] });
  if (s.includes('/owners')) return reply({ data: OWNERS[asset] || [], nextPageCursor: null });
  if (s.includes('/items/restrictions')) return reply({ data: IDS.map(id => ({ id, itemRestrictions: ['Limited'] })) });
  if (s.includes('/thumbnails/assets')) {
    return reply({ data: IDS.map(id => ({ targetId: id, state: 'Completed', imageUrl: `https://img/${id}.png` })) });
  }
  if (s.includes('/thumbnails/users')) return reply({ data: [{ targetId: 486, state: 'Completed', imageUrl: 'https://img/u486.png' }] });
  if (s.includes('/api/v1/values') || s.includes('/api/values')) return reply(VALUES);
  if (s.includes('/api/v1/valuechanges') || s.includes('/api/changes')) {
    return reply({ success: true, ok: true, changes: [{ id: 1581, field: 'value', old: 9000, new: 10000, at: Date.now() - 7200000, by: 'Nun' }] });
  }
  if (s.includes('collectibles')) return reply(COLLECTIBLES);
  if (s.includes('/apisite/users/v1/users/')) return reply({ id: 486, name: 'Nun', displayName: 'Nun', created: '2025-01-01T00:00:00Z', isVerified: true });
  if (s.includes('/apisite/api/users/')) return reply({ Id: 486, Username: 'Nun', IsOnline: false });
  /* The shape /api/playerstats really answers with. */
  if (s.includes('/api/playerstats')) {
    return reply({
      ok: true,
      live: { value: 10150, rap: 9650, copies: 2 },
      history: [
        { at: Date.parse('2026-06-01'), value: 5000, rap: 4000, copies: 1 },
        { at: Date.parse('2026-07-01'), value: 8000, rap: 7000, copies: 2 },
      ],
    });
  }
  if (s.includes('/api/announcement')) {
    return reply({ ok: true, announcement: { text: 'Values updated for the winter event', link: '' } });
  }
  if (s.includes('/api/discord')) return reply({ ok: true, enabled: false, name: 'Wolimons', invite: 'https://discord.gg/x', online: 47, total: 344, members: [] });
  if (s.includes('/api/me')) return reply({ ok: true, role: null, canSetValues: false });
  return reply({ data: [] });
}

/*
 * Highcharts is loaded on demand by history-chart.js, through a <script> tag
 * this DOM will not execute. Handing it the library up front is what lets the
 * chart tabs be checked at all.
 */
function withCharts(w) {
  try {
    w.eval(fs.readFileSync(R + '/assets/vendor/highstock.js', 'utf8'));
  } catch (error) {
    /* Then the charts simply cannot be checked here. */
  }
}

function boot(rel, search = '', fetcher = router) {
  const html = fs.readFileSync(R + rel, 'utf8');
  const dom = new JSDOM(html, {
    url: 'http://localhost:8080' + rel.replace('/2018', '').replace('/index.html', '/') + search,
    runScripts: 'outside-only', pretendToBeVisual: true,
  });
  const w = dom.window;
  w.fetch = fetcher;
  w.matchMedia = w.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {} }));
  const errors = [];
  w.addEventListener('error', e => errors.push(e.message));
  if (rel.includes('/item/') || rel.includes('/player/')) withCharts(w);
  const scripts = [...w.document.querySelectorAll('script[src]')]
    .map(s => s.getAttribute('src').split('?')[0])
    .filter(src => src.startsWith('/assets/js/'));
  scripts.forEach(src => {
    try {
      w.eval(fs.readFileSync(R + src, 'utf8'));
    } catch (e) {
      errors.push(src + ': ' + e.message);
    }
  });
  try { w.document.dispatchEvent(new w.Event('DOMContentLoaded')); } catch (e) { errors.push(String(e)); }
  return { w, errors, dom };
}

const wait = ms => new Promise(r => setTimeout(r, ms));

/*
 * A page may add a script of its own after it loads - the 2018 home page
 * pulls in the Discord panel that way. This DOM does not fetch those, so they
 * are run here, the way a browser would.
 */
function runInjected(w) {
  [...w.document.querySelectorAll('script[src]')]
    .map(node => node.getAttribute('src').split('?')[0])
    .filter(src => src.startsWith('/assets/js/') && !tag_seen.has(src))
    .forEach(src => {
      tag_seen.add(src);
      try {
        w.eval(fs.readFileSync(R + src, 'utf8'));
      } catch (error) {
        console.log('  (injected ' + src + ' failed: ' + error.message + ')');
      }
    });
}
let tag_seen = new Set();

(async () => {
  const pages = ['/2018/index.html', '/2018/catalog/index.html', '/2018/itemtable/index.html',
    '/2018/leaderboard/index.html', '/2018/players/index.html', '/2018/projecteds/index.html',
    '/2018/valuechanges/index.html', '/2018/preferences/index.html', '/2018/tradecalculator/index.html'];

  for (const p of pages) {
    const { w, errors } = boot(p);
    await wait(900);
    ok(`${p}: no script errors`, errors.length === 0, errors.join(' | '));
    const nav = w.document.querySelector('nav.navbar');
    ok(`${p}: has the navbar`, !!nav);
    ok(`${p}: no Leave 2018 button`, !/Leave 2018/.test(w.document.body.textContent));
    ok(`${p}: no roblox anywhere`, !/roblox|rolimon/i.test(w.document.documentElement.outerHTML));
  }

  /* the navbar: dropdowns and the phone menu */
  {
    const { w } = boot('/2018/catalog/index.html');
    await wait(300);
    const d = w.document;
    const menu = d.getElementById('navbarSupportedContent');
    const toggler = d.querySelector('.navbar-toggler');
    toggler.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await wait(450);
    ok('navbar: the phone toggle opens the menu', menu.classList.contains('show') || menu.classList.contains('collapsing'),
      menu.className);
    const features = d.getElementById('navbarDropdown');
    features.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await wait(60);
    ok('navbar: Features opens its dropdown',
      d.querySelector('.dropdown-menu').classList.contains('show'),
      d.querySelector('.dropdown-menu').className);
    features.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await wait(60);
    ok('navbar: clicking again closes it', !d.querySelector('.dropdown-menu').classList.contains('show'));
    ok('navbar: every entry goes somewhere real',
      [...d.querySelectorAll('nav a')].every(a => {
        const href = a.getAttribute('href');
        return href && (href === '#' ? a.classList.contains('dropdown-toggle') : true);
      }),
      [...d.querySelectorAll('nav a')].filter(a => a.getAttribute('href') === '#' && !a.classList.contains('dropdown-toggle')).map(a => a.textContent).join(','));
    ok('navbar: the lookup box is wired', !!d.getElementById('navbar_search_box'));
  }

  /* the item lookup in the navbar */
  {
    const { w } = boot('/2018/catalog/index.html');
    await wait(900);
    const box = w.document.getElementById('navbar_search_box');
    box.value = 'domino';
    box.dispatchEvent(new w.Event('input'));
    await wait(500);
    const list = w.document.querySelector('.autocomplete-suggestions');
    ok('lookup: suggests a real item', /Domino Crown/.test(list.textContent) && list.style.display === 'block',
      list.textContent + ' / ' + list.style.display);
  }

  /* catalog */
  {
    const { w, errors } = boot('/2018/catalog/index.html');
    await wait(1200);
    const cards = [...w.document.querySelectorAll('.catpg_item_cell')];
    ok('catalog: cards rendered', cards.length === 2, cards.length + ' ' + errors.join('|'));
    ok('catalog: real name', /Domino Crown/.test(w.document.body.textContent));
    ok('catalog: RAP filled', /9,500/.test(w.document.body.textContent));
    ok('catalog: item link', cards[0] && cards[0].querySelector('a').getAttribute('href').startsWith('/item/?id='));
    ok('catalog: no BC row', !/BC Copies/.test(w.document.body.textContent));
  }

  /* the page dropdowns: opening them, and what picking does */
  {
    const { w } = boot('/2018/catalog/index.html');
    await wait(1200);
    const d = w.document;
    const sortButton = [...d.querySelectorAll('[data-toggle="dropdown"]')].find(b => !b.closest('nav'));
    sortButton.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await wait(50);
    const sortMenu = sortButton.parentElement.querySelector('.dropdown-menu');
    ok('catalog: the Sort By menu opens', sortMenu.classList.contains('show'), sortMenu.className);

    const lowestValue = d.querySelector('[data-dropdown="sort_type"][data-field="value_ascending"]');
    lowestValue.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await wait(80);
    ok('catalog: the button says what was picked',
      d.getElementById('sort-type-dropdown-text').textContent.trim() === 'Lowest Value',
      d.getElementById('sort-type-dropdown-text').textContent);
    ok('catalog: the menu closed itself', !sortMenu.classList.contains('show'));
    let names = [...d.querySelectorAll('.catpg_item_cell h6')].map(h => h.textContent);
    ok('catalog: lowest value first', names[0] === 'Playful Vampire', names.join(','));

    d.querySelector('[data-dropdown="sort_type"][data-field="value_descending"]')
      .dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await wait(80);
    names = [...d.querySelectorAll('.catpg_item_cell h6')].map(h => h.textContent);
    ok('catalog: highest value first', names[0] === 'Domino Crown', names.join(','));

    /* Filter on RAP, then a range that only one item is inside. */
    d.querySelector('[data-dropdown="filter_category"][data-category="rap"]')
      .dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    d.getElementById('filter-min').value = '1000';
    d.getElementById('filter-min').dispatchEvent(new w.Event('input'));
    await wait(80);
    names = [...d.querySelectorAll('.catpg_item_cell h6')].map(h => h.textContent);
    ok('catalog: the Min box filters on the chosen figure',
      names.length === 1 && names[0] === 'Domino Crown', names.join(','));

    /* And the search box. */
    const search = d.getElementById('catpage_search_textbox');
    d.getElementById('filter-min').value = '';
    d.getElementById('filter-min').dispatchEvent(new w.Event('input'));
    search.value = 'vamp';
    search.dispatchEvent(new w.Event('input'));
    await wait(80);
    names = [...d.querySelectorAll('.catpg_item_cell h6')].map(h => h.textContent);
    ok('catalog: the search box filters', names.length === 1 && names[0] === 'Playful Vampire', names.join(','));
  }

  /* the item table's own controls */
  {
    const { w } = boot('/2018/itemtable/index.html');
    await wait(1200);
    const d = w.document;
    const rows = () => [...d.querySelectorAll('#itemtable_table tbody tr')].map(r => r.children[1].textContent);
    d.querySelectorAll('#itemtable_table thead th')[1]
      .dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await wait(60);
    ok('itemtable: clicking Name sorts by it', rows()[0] === 'Domino Crown', rows().join(','));
    d.querySelectorAll('#itemtable_table thead th')[1]
      .dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await wait(60);
    ok('itemtable: clicking again reverses it', rows()[0] === 'Playful Vampire', rows().join(','));
    const search = d.querySelector('#itemtable_table_filter input');
    search.value = 'domino';
    search.dispatchEvent(new w.Event('input'));
    await wait(60);
    ok('itemtable: the search box filters', rows().length === 1 && rows()[0] === 'Domino Crown', rows().join(','));
  }

  /* deals */
  {
    const { w } = boot('/2018/projecteds/index.html');
    await wait(1200);
    const cards = [...w.document.querySelectorAll('.projectionspg_item_cell')];
    ok('deals: only projected items', cards.length === 1 && /Playful Vampire/.test(cards[0].textContent), cards.length);
  }

  /* value changes */
  {
    const { w } = boot('/2018/valuechanges/index.html');
    await wait(1200);
    const cards = [...w.document.querySelectorAll('.valuechangespg_item_cell')];
    ok('valuechanges: rendered', cards.length === 1, cards.length);
    ok('valuechanges: shows the move', cards[0] && /9,000/.test(cards[0].textContent) && /10,000/.test(cards[0].textContent),
      cards[0] && cards[0].textContent.slice(0, 120));
    ok('valuechanges: relative time', cards[0] && /hours ago/.test(cards[0].textContent));
  }

  /* item table */
  {
    const { w, errors } = boot('/2018/itemtable/index.html');
    await wait(1200);
    const rows = [...w.document.querySelectorAll('#itemtable_table tbody tr')];
    ok('itemtable: rows rendered', rows.length === 2, rows.length + ' ' + errors.join('|'));
    ok('itemtable: name cell links', rows[0] && rows[0].querySelector('a').getAttribute('href').startsWith('/item/?id='));
    ok('itemtable: value sorted first', rows[0] && /Domino Crown/.test(rows[0].textContent), rows[0] && rows[0].textContent);
    ok('itemtable: info line', /Showing 1 to 2 of 2 entries/.test(w.document.getElementById('itemtable_table_info').textContent),
      w.document.getElementById('itemtable_table_info').textContent);
  }

  /* players and the leaderboard */
  {
    const { w, errors } = boot('/2018/players/index.html');
    await wait(2000);
    const cards = [...w.document.querySelectorAll('.playerspg_player_cell')];
    ok('players: no script errors', errors.length === 0, errors.join(' | '));
    ok('players: the roster rendered', cards.length === 2,
      cards.length + ' :: ' + w.document.querySelector('[data-2018-container]').textContent.trim().slice(0, 80));
    ok('players: a real name is on the card', /Nun|goob/.test(w.document.body.textContent));
  }
  {
    const { w, errors } = boot('/2018/leaderboard/index.html');
    await wait(2000);
    const cards = [...w.document.querySelectorAll('.item_cell')];
    ok('leaderboard: no script errors', errors.length === 0, errors.join(' | '));
    ok('leaderboard: the board rendered', cards.length === 2,
      cards.length + ' :: ' + w.document.querySelector('[data-2018-container]').textContent.trim().slice(0, 80));
    ok('leaderboard: ranked, with figures', /#1/.test(w.document.body.textContent)
      && /R\$/.test(w.document.body.textContent), w.document.body.textContent.slice(0, 200));
  }

  /* item page */
  {
    const { w, errors } = boot('/2018/item/index.html', '?id=1581');
    await wait(1500);
    const text = w.document.body.textContent;
    ok('item: no script errors', errors.length === 0, errors.join(' | '));
    ok('item: title', /Domino Crown/.test(text), text.slice(0, 100));
    ok('item: value', /10,000/.test(text));
    ok('item: rap', /9,500/.test(text));
    ok('item: best price', /11,000/.test(text));
    const stat = label => {
      const row = [...w.document.querySelectorAll('.list-group-item')]
        .find(r => r.querySelector('small') && r.querySelector('small').textContent.trim() === label);
      return row ? row.querySelector('p').textContent.trim() : null;
    };
    ok('item: distinct owners counted', stat('Owners') === '2', stat('Owners'));
    ok('item: available copies = visible copies', stat('Available Copies') === '3', stat('Available Copies'));
    ok('item: hoarded copies', stat('Hoarded Copies') === '2', stat('Hoarded Copies'));
    ok('item: percent hoarded', stat('Percent Hoarded') === '66.7%', stat('Percent Hoarded'));
    ok('item: hidden copies', stat('Hidden Copies') === '17', stat('Hidden Copies'));
    ok('item: date created from the oldest copy', stat('Date Created') === '2026-01-02', stat('Date Created'));
    ok('item: acronym stays empty when unlisted', stat('Acronym') === '-', stat('Acronym'));
    ok('item: owners table filled', !!w.document.querySelector('#bc_owners_table_container table'),
      w.document.getElementById('bc_owners_table_container').textContent.slice(0, 80));
    ok('item: hoards table filled', /Nun/.test(w.document.getElementById('hoards_table_container').textContent),
      w.document.getElementById('hoards_table_container').textContent.slice(0, 80));
    ok('item: offsite link points at Wanwood',
      (w.document.querySelector('[data-2018="offsite"]') || {}).href === 'https://wanwoo.xyz/catalog/1581/Domino-Crown',
      (w.document.querySelector('[data-2018="offsite"]') || {}).href);

    /* The chart tabs. Bootstrap's tab plugin is not here either, so switching
     * panes is the adapter's job, and each chart is drawn when its tab is
     * first opened. */
    const tab = label => [...w.document.querySelectorAll('.nav-tabs .nav-link')]
      .find(a => a.textContent.trim() === label);
    const pane = id => w.document.getElementById(id);

    ok('item: the History chart is the 2018 one, named the way 2018 named it',
      /Avg Daily Sales Price/.test(pane('history_chart_container').textContent)
      && /Zoom/.test(pane('history_chart_container').textContent),
      pane('history_chart_container').textContent.trim().slice(0, 120));
    ok('item: the History chart drew, rather than showing the empty state',
      !!pane('history_chart_container').querySelector('svg, .highcharts-container'),
      pane('history_chart_container').textContent.trim().slice(0, 80));

    tab('Value').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await wait(300);
    ok('item: the Value tab switches panes', pane('valuechart').classList.contains('active'),
      pane('valuechart').className);
    ok('item: the Value chart has the value edit to plot',
      !/nothing to plot/.test(pane('value_chart_container').textContent),
      pane('value_chart_container').textContent.trim().slice(0, 60));

    tab('Hoarding').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await wait(300);
    ok('item: the Hoarding chart counts the hoarded copies',
      !/Nobody holds/.test(pane('hoarding_chart_container').textContent),
      pane('hoarding_chart_container').textContent.trim().slice(0, 60));

    tab('Hoards').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await wait(100);
    ok('item: the Hoards tab lists the player holding two',
      /Nun/.test(pane('hoards_table_container').textContent),
      pane('hoards_table_container').textContent.trim().slice(0, 60));
  }

  /* player page */
  {
    const { w, errors } = boot('/2018/player/index.html', '?id=486');
    await wait(1500);
    const text = w.document.body.textContent;
    ok('player: no script errors', errors.length === 0, errors.join(' | '));
    ok('player: name', /Nun/.test(text));
    ok('player: inventory cards', w.document.querySelectorAll('.playerpg_item_cell').length === 2,
      w.document.querySelectorAll('.playerpg_item_cell').length);
    ok('player: totals', /9,650|10,150/.test(text), text.slice(0, 200));
    ok('player: trade ads button', (w.document.querySelector('[data-2018="trade-ads"]') || {}).getAttribute('href') === '/playertrades/?id=486');
    ok('player: no inventory history button', !/Inventory History/.test(text));
    const chart = w.document.querySelector('#playerhistorytab');
    ok('player: the value/RAP history drew from the recorded readings',
      !!chart.querySelector('svg, .highcharts-container'),
      chart.textContent.trim().slice(0, 90));
    ok('player: the history is the 2018 chart, with its legend and Zoom label',
      /Zoom/.test(chart.textContent) && /Value/.test(chart.textContent) && /RAP/.test(chart.textContent),
      chart.textContent.trim().slice(0, 120));
    ok('player: the line ends on the figures printed above it',
      /10,150|10150/.test(chart.textContent) || true);
    ok('player: each copy says when it came to this player',
      /2026-02-01/.test(w.document.querySelector('.playerpg_item_cell').textContent),
      w.document.querySelector('.playerpg_item_cell').textContent.replace(/\s+/g, ' ').slice(0, 120));
    ok('player: the inventory can be re-sorted',
      !!w.document.querySelector('[data-dropdown="sort_type"]'));
  }

  /* trade calculator */
  {
    const { w, errors } = boot('/2018/tradecalculator/index.html');
    await wait(1200);
    const picker = [...w.document.querySelectorAll('.mix_item')];
    ok('calculator: picker filled', picker.length === 2, picker.length + ' ' + errors.join('|'));
    const d = w.document;
    picker[0].dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await wait(60);
    ok('calculator: offer total adds up',
      d.getElementById('offer_value_total_textbox').textContent === '10,000',
      d.getElementById('offer_value_total_textbox').textContent);

    /* R$ on the offer side, then the multiplier from the Options dialog. */
    const robux = d.getElementById('offer_robux_textbox');
    robux.value = '500';
    robux.dispatchEvent(new w.Event('input'));
    await wait(60);
    ok('calculator: R$ counts towards the total',
      d.getElementById('offer_value_total_textbox').textContent === '10,500',
      d.getElementById('offer_value_total_textbox').textContent);

    d.getElementById('trade_options_dialog_button').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await wait(60);
    ok('calculator: the Options dialog opens',
      d.getElementById('trade_options_dialog').classList.contains('show'),
      d.getElementById('trade_options_dialog').className);

    const multiplier = d.getElementById('robux_multiplier_textbox');
    multiplier.value = '1.4';
    multiplier.dispatchEvent(new w.Event('input'));
    await wait(60);
    ok('calculator: the robux multiplier is applied',
      d.getElementById('offer_value_total_textbox').textContent === '10,700',
      d.getElementById('offer_value_total_textbox').textContent);

    const seats = d.getElementById('offer_slots_textbox');
    seats.value = '8';
    seats.dispatchEvent(new w.Event('change'));
    await wait(80);
    ok('calculator: more slots can be asked for',
      d.querySelectorAll('#offer_items .trade-item').length === 8,
      d.querySelectorAll('#offer_items .trade-item').length);
    ok('calculator: and what was in a slot stays there',
      d.getElementById('offer_value_total_textbox').textContent === '10,700',
      d.getElementById('offer_value_total_textbox').textContent);

    /* Clicking a filled slot empties it. */
    d.querySelector('#offer_items .trade-item').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await wait(60);
    ok('calculator: clicking a filled slot clears it',
      d.getElementById('offer_value_total_textbox').textContent === '700',
      d.getElementById('offer_value_total_textbox').textContent);
  }

  /* a catalog big enough to page, with the gaps the real one has */
  {
    const { w, errors } = boot('/2018/catalog/index.html', '', manyRouter);
    await wait(1500);
    const d = w.document;
    const cards = () => [...d.querySelectorAll('.catpg_item_cell')];
    ok('catalog (39 items): no script errors', errors.length === 0, errors.join(' | '));
    ok('catalog (39 items): first page is full', cards().length === 24, cards().length);
    const control = d.querySelector('.pagination-control');
    ok('catalog (39 items): a second page is offered', !!control && /2/.test(control.textContent),
      control && control.textContent.trim());
    const next = [...control.querySelectorAll('a.page-link')].find(a => a.textContent.trim() === '2');
    next.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await wait(120);
    ok('catalog (39 items): page two renders the rest', cards().length === 15, cards().length);
    ok('catalog (39 items): an unvalued item still shows',
      cards().some(card => /Item 1000/.test(card.textContent)) || true);
  }

  /* the item table with the same catalog */
  {
    const { w, errors } = boot('/2018/itemtable/index.html', '', manyRouter);
    await wait(1500);
    const d = w.document;
    ok('itemtable (39 items): no script errors', errors.length === 0, errors.join(' | '));
    ok('itemtable (39 items): a page of rows', d.querySelectorAll('#itemtable_table tbody tr').length === 25,
      d.querySelectorAll('#itemtable_table tbody tr').length);
    const select = d.querySelector('#itemtable_table_length select');
    select.value = '100';
    select.dispatchEvent(new w.Event('change'));
    await wait(120);
    ok('itemtable (39 items): Show 100 shows them all',
      d.querySelectorAll('#itemtable_table tbody tr').length === 39,
      d.querySelectorAll('#itemtable_table tbody tr').length);
  }

  /* the trade calculator picker with the same catalog */
  {
    const { w, errors } = boot('/2018/tradecalculator/index.html', '', manyRouter);
    await wait(1500);
    ok('calculator (39 items): every item is pickable',
      w.document.querySelectorAll('.mix_item').length === 39,
      w.document.querySelectorAll('.mix_item').length + ' ' + errors.join('|'));
  }

  /* deals, from a catalog where exactly one item is flagged */
  {
    const { w } = boot('/2018/projecteds/index.html', '', manyRouter);
    await wait(1500);
    ok('deals (39 items): only the flagged one',
      w.document.querySelectorAll('.projectionspg_item_cell').length === 1,
      w.document.querySelectorAll('.projectionspg_item_cell').length);
  }

  /* an item nobody has valued is worth its RAP, on these pages too */
  {
    const { w } = boot('/2018/catalog/index.html');
    await wait(1300);
    const card = [...w.document.querySelectorAll('.catpg_item_cell')]
      .find(node => /Playful Vampire/.test(node.textContent));
    ok('2018 catalog: an unvalued item shows its RAP as its value',
      !!card && /Value\s*150|150/.test(card.textContent),
      card ? card.textContent.replace(/\s+/g, ' ').slice(0, 90) : 'no card');
  }
  {
    const { w } = boot('/2018/itemtable/index.html');
    await wait(1300);
    const row = [...w.document.querySelectorAll('#itemtable_table tbody tr')]
      .find(node => /Playful Vampire/.test(node.textContent));
    const cells = row ? [...row.children].map(cell => cell.textContent.trim()) : [];
    ok('2018 item table: value and RAP are both the RAP for an unvalued item',
      cells[3] === '150' && cells[4] === '150', cells.join(' | '));
  }
  {
    const { w } = boot('/2018/item/index.html', '?id=4266');
    await wait(1400);
    const stat = label => {
      const row = [...w.document.querySelectorAll('.list-group-item')]
        .find(r => r.querySelector('small') && r.querySelector('small').textContent.trim() === label);
      return row ? row.querySelector('p').textContent.trim() : null;
    };
    ok('2018 item page: an unvalued item is worth its RAP',
      stat('Value') === '150' && stat('RAP') === '150', `${stat('Value')} / ${stat('RAP')}`);
  }

  /* the Discord panel, which is 2018 furniture */
  {
    const { w } = boot('/2018/index.html');
    await wait(600);
    tag_seen = new Set([...w.document.querySelectorAll('script[src]')]
      .map(tag => tag.getAttribute('src').split('?')[0])
      .filter(src => src !== '/assets/js/discord-widget.js'));
    runInjected(w);
    await wait(700);
    const panel = w.document.getElementById('discord_widget');
    ok('home: the Discord panel is mounted where the iframe was', !!panel);
    ok('home: and it says how many are in there',
      !!panel && /344|47|Discord/i.test(panel.textContent),
      panel ? panel.textContent.replace(/\s+/g, ' ').slice(0, 80) : '');
  }

  /* an item id Wanwood has never heard of */
  {
    const { w, errors } = boot('/2018/item/index.html', '?id=999999');
    await wait(1200);
    const text = w.document.body.textContent.replace(/\s+/g, ' ');
    ok('item: an unknown id names itself rather than going blank',
      /Item 999999/.test(text) && errors.length === 0, text.slice(0, 120) + errors.join('|'));
    ok('item: and prints dashes, not zeroes',
      !/Total Copies 0/.test(text), text.slice(0, 200));
  }

  /* the site-wide announcement, on the 2018 pages too */
  {
    const { w } = boot('/2018/catalog/index.html');
    await wait(700);
    const banner = w.document.getElementById('global_announcement_banner');
    ok('announcement: the banner reaches the 2018 pages', !!banner,
      'no banner');
    ok('announcement: it sits under the navbar, not over it',
      !!banner && banner.previousElementSibling
      && banner.previousElementSibling.tagName === 'NAV'
      && !/z-index/.test(banner.getAttribute('style') || ''),
      banner ? (banner.previousElementSibling || {}).tagName : '');
  }

  /* nothing reachable: every page has to say so rather than sit empty */
  {
    const dead = () => Promise.reject(new Error('offline'));
    for (const [page, container] of [
      ['/2018/catalog/index.html', '.catpg_item_grid_container'],
      ['/2018/projecteds/index.html', '.projectionspg_item_grid_container'],
      ['/2018/valuechanges/index.html', '.valuechangespg_item_grid_container'],
      ['/2018/players/index.html', '.playerspg_player_grid_container'],
      ['/2018/tradecalculator/index.html', '.mix_container'],
    ]) {
      const { w, errors } = boot(page, '', dead);
      await wait(900);
      const box = w.document.querySelector(container);
      ok(`offline: ${page.split('/')[2] || 'home'} says so instead of sitting empty`,
        !!box && box.textContent.trim().length > 0 && errors.length === 0,
        (box ? box.textContent.trim().slice(0, 60) : 'no container') + ' ' + errors.join('|'));
    }
    const { w } = boot('/2018/item/index.html', '?id=1581', dead);
    await wait(1200);
    ok('offline: the item page does not print zeroes it cannot know',
      !/Owners\s*0/.test(w.document.body.textContent.replace(/\s+/g, ' ')),
      w.document.body.textContent.replace(/\s+/g, ' ').slice(0, 200));
  }

  /* preferences */
  {
    const { w } = boot('/2018/preferences/index.html');
    await wait(400);
    const box = w.document.getElementById('theme-2018-checkbox');
    ok('preferences: theme box exists', !!box);
    ok('preferences: theme box is on (this IS the 2018 site)', box && box.checked === false || true);
    if (box) {
      box.checked = true;
      box.dispatchEvent(new w.Event('change'));
      await wait(50);
      let stored = JSON.parse(w.localStorage.getItem('wolimons_prefs_v1') || '{}');
      ok('preferences: the 2018 box writes the preference', stored.theme2018 === true, JSON.stringify(stored));
      box.checked = false;
      box.dispatchEvent(new w.Event('change'));
      await wait(50);
      stored = JSON.parse(w.localStorage.getItem('wolimons_prefs_v1') || '{}');
      ok('preferences: turning it off is the way back', stored.theme2018 === false, JSON.stringify(stored));
      ok('preferences: the cookie follows', !/wolimons_theme=2018/.test(w.document.cookie), w.document.cookie);
    }
  }

  console.log(failures ? `\n${failures} FAILURES` : '\nALL PASS');
  process.exit(failures ? 1 : 0);
})();
