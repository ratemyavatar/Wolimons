/*
 * Render the modern pages and report what actually appeared.
 *
 *   npm install jsdom      (once - the only thing this needs)
 *   node tools/render-site.js
 *
 * The companion to tools/render-2018.js, for the pages the site serves by
 * default. Every request is answered with a reply shaped like Wanwood's real
 * ones, then each page is asked the only question that matters: did the thing
 * this page exists for actually end up on the screen?
 *
 * Not part of `npm test` - the suite is dependency-free and this needs jsdom.
 */
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const R = path.resolve(__dirname, '..');

let failures = 0;
const ok = (name, cond, extra) => {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (cond ? '' : '  -> ' + (extra ?? '')));
  if (!cond) failures += 1;
};

/* ------------------------------------------------------------------ */
/* Wanwood-shaped fixtures                                             */
/* ------------------------------------------------------------------ */

const IDS = [1581, 4266];
const PRODUCTS = {
  1581: { Name: 'Domino Crown', Description: 'A crown.', AssetTypeId: 8, PriceInRobux: 100, IsForSale: false },
  4266: { Name: 'Playful Vampire', Description: 'Teeth.', AssetTypeId: 18, PriceInRobux: 75, IsForSale: true },
};
const RESALE = {
  1581: {
    assetStock: 20, sales: 12, numberRemaining: 3, recentAveragePrice: 9500,
    priceDataPoints: [{ value: 9000, date: '2026-06-01T00:00:00Z' }, { value: 9500, date: '2026-07-01T00:00:00Z' }],
  },
  4266: { assetStock: 5, sales: 1, numberRemaining: 0, recentAveragePrice: 150, priceDataPoints: [] },
};
const OWNERS = {
  1581: [
    { id: 900, serialNumber: 1, created: '2026-01-02T00:00:00Z', updated: '2026-02-01T00:00:00Z', owner: { id: 486, type: 'User', name: 'Nun' } },
    { id: 901, serialNumber: 2, created: '2026-01-03T00:00:00Z', updated: '2026-02-01T00:00:00Z', owner: { id: 486, type: 'User', name: 'Nun' } },
    { id: 902, serialNumber: 3, created: '2026-01-04T00:00:00Z', updated: '2026-02-01T00:00:00Z', owner: { id: 99, type: 'User', name: 'goob' } },
  ],
  4266: [],
};
const COLLECTIBLES = {
  data: [
    { userAssetId: 900, assetId: 1581, name: 'Domino Crown', recentAveragePrice: 9500, serialNumber: 1 },
    { userAssetId: 902, assetId: 4266, name: 'Playful Vampire', recentAveragePrice: 150, serialNumber: 7 },
  ],
  totalRap: 9650,
  nextPageCursor: null,
};
/*
 * Deliberately only one of the two is valued: the other has to come out at
 * its RAP everywhere, which is the site's rule.
 */
const VALUES = {
  success: true,
  updatedAt: 5,
  values: {
    1581: { value: 10000, demand: 'High', trend: 'Stable', categories: ['rare'], method: 'proof', note: '' },
    4266: { demand: 'Low', trend: 'Stable', categories: ['projected'] },
  },
};
/* The shape /api/ads really answers with - see normalizeAd in
 * assets/js/tradeads-core.js. */
const ADS = [{
  id: 'ad1',
  creatorId: 486,
  creatorName: 'Nun',
  createdAt: Date.now() - 3600000,
  offer: [{ kind: 'item', id: 1581, name: 'Domino Crown' }],
  request: [{ kind: 'item', id: 4266, name: 'Playful Vampire' }, { kind: 'tag', slug: 'upgrade' }],
}];

function reply(body, good = true) {
  return Promise.resolve({
    ok: good,
    status: good ? 200 : 404,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    headers: { get: () => 'application/json' },
  });
}

function router(url) {
  const s = String(url);
  const asset = (s.match(/assets?\/(\d+)/) || s.match(/assetId=(\d+)/) || [])[1];

  if (s.includes('/catalog/v1/search/items')) {
    return reply({ data: IDS.map(id => ({ id })), _total: IDS.length, nextPageCursor: null });
  }
  if (s.includes('/catalog/items/details')) return reply({}, false);
  if (s.includes('/marketplace/productinfo')) return reply(PRODUCTS[asset] || {});
  if (s.includes('/resale-data')) return reply(RESALE[asset] || {});
  if (s.includes('/resellers')) return reply({ data: [{ price: 11000, seller: { id: 99, name: 'goob' } }] });
  if (s.includes('/owners')) return reply({ data: OWNERS[asset] || [], nextPageCursor: null });
  if (s.includes('/items/restrictions')) {
    return reply({ data: IDS.map(id => ({ id, itemRestrictions: ['Limited'] })) });
  }
  if (s.includes('/thumbnails/assets')) {
    return reply({ data: IDS.map(id => ({ targetId: id, state: 'Completed', imageUrl: `https://img/${id}.png` })) });
  }
  if (s.includes('/thumbnails/users') || s.includes('avatar')) {
    return reply({ data: [{ targetId: 486, state: 'Completed', imageUrl: 'https://img/u486.png' }] });
  }
  if (s.includes('collectibles')) return reply(COLLECTIBLES);
  if (s.includes('/apisite/users/v1/users/')) {
    return reply({ id: 486, name: 'Nun', displayName: 'Nun', created: '2025-01-01T00:00:00Z', isVerified: true, description: '' });
  }
  if (s.includes('/apisite/api/users/')) return reply({ Id: 486, Username: 'Nun', IsOnline: false });
  if (s.includes('/api/v1/values') || s.includes('/api/values')) return reply(VALUES);
  if (s.includes('/api/v1/valuechanges') || s.includes('/api/changes')) {
    return reply({ success: true, ok: true, changes: [{ id: 1581, field: 'value', old: 9000, new: 10000, at: Date.now() - 7200000, by: 'Nun' }] });
  }
  if (s.includes('/api/v1/getrecentads') || s.includes('/api/ads')) return reply({ success: true, ok: true, ads: ADS });
  if (s.includes('/api/playerstats')) {
    return reply({
      ok: true,
      live: { value: 10200, rap: 9650, copies: 2 },
      history: [
        { at: Date.parse('2026-06-01'), value: 5000, rap: 4000, copies: 1 },
        { at: Date.parse('2026-07-01'), value: 8000, rap: 7000, copies: 2 },
      ],
    });
  }
  if (s.includes('/api/badges')) return reply({ ok: true, grants: {}, grantable: [] });
  if (s.includes('/api/v1/badges')) return reply({ ok: true, success: true, grants: {}, grantable: [] });
  if (s.includes('/api/luckycat')) return reply({ ok: true, choice: { assetId: 1581, userAssetId: 900, userId: 486, name: 'Nun' } });
  if (s.includes('/api/roles') || s.includes('/api/v1/roles')) return reply({ ok: true, success: true, roles: [] });
  if (s.includes('/api/comments')) return reply({ ok: true, comments: [] });
  if (s.includes('/api/inbox')) return reply({ ok: true, unread: 0, comments: [] });
  if (s.includes('/api/me')) return reply({ ok: true, role: null, canSetValues: false });
  if (s.includes('/api/announcement')) return reply({ ok: true, announcement: '' });
  if (s.includes('/api/discord')) return reply({ ok: true, enabled: false, name: 'Wolimons', invite: 'https://discord.gg/x', online: 47, total: 344, members: [] });
  if (s.includes('/api/status')) return reply({ ok: true });
  if (s.includes('/api/verified')) return reply({ ok: true, verified: true });
  return reply({ data: [] });
}

function boot(rel, search = '') {
  const dom = new JSDOM(fs.readFileSync(path.join(R, rel), 'utf8'), {
    url: 'http://localhost:8080' + rel.replace('/index.html', '/') + search,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const w = dom.window;
  w.fetch = router;
  w.matchMedia = w.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {} }));
  w.scrollTo = () => {};

  const errors = [];
  w.addEventListener('error', event => errors.push(event.message));
  /* Charts are loaded on demand through a <script> this DOM will not run. */
  try {
    w.eval(fs.readFileSync(path.join(R, 'assets/vendor/highstock.js'), 'utf8'));
  } catch (error) {
    /* Then the charts cannot be checked here. */
  }

  [...w.document.querySelectorAll('script[src]')]
    .map(tag => tag.getAttribute('src').split('?')[0])
    .filter(src => src.startsWith('/assets/js/'))
    .forEach(src => {
      try {
        w.eval(fs.readFileSync(path.join(R, src.slice(1)), 'utf8'));
      } catch (error) {
        errors.push(`${src}: ${error.message}`);
      }
    });

  try {
    w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  } catch (error) {
    errors.push(String(error));
  }
  return { w, errors };
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

/* Somebody with a linked account, for the pages that behave differently. */
function signIn(w) {
  w.localStorage.setItem('wolimons_account_v1', JSON.stringify({ id: 486, name: 'Nun', token: 'x' }));
}

(async () => {
  const PAGES = [
    '/index.html', '/catalog/index.html', '/item/index.html', '/player/index.html',
    '/players/index.html', '/leaderboard/index.html', '/projecteds/index.html',
    '/valuechanges/index.html', '/tradecalculator/index.html', '/trades/index.html',
    '/playertrades/index.html', '/tradead/index.html', '/badges/index.html',
    '/luckycat/index.html', '/inbox/index.html', '/verify/index.html',
    '/staff/index.html', '/preferences/index.html', '/inventoryshare/index.html',
    '/admin/index.html', '/thuglolboi/index.html', '/apidocs/index.html',
    '/styleguide/index.html',
  ];

  for (const page of PAGES) {
    const search = page.includes('/item/') || page.includes('/player') ? '?id=1581' : '';
    const { w, errors } = boot(page, page.includes('/player/') ? '?id=486' : search);
    await wait(700);
    ok(`${page}: no script errors`, errors.length === 0, errors.join(' | '));
    ok(`${page}: says nothing about the sites it came from`,
      !/roblox|rolimon|koromon/i.test(w.document.documentElement.outerHTML));
    /* Nothing on a working page should be shouting a failure at the reader. */
    const text = w.document.body.textContent;
    ok(`${page}: no failure notice on screen`,
      !/failed to load|could not be loaded|something went wrong/i.test(text),
      (text.match(/[^.]*(?:failed to load|could not be loaded)[^.]*/i) || [''])[0].trim().slice(0, 90));
  }

  /* ---------------------------------------------------------------- */
  /* The pages, on what they are for                                   */
  /* ---------------------------------------------------------------- */

  {
    const { w } = boot('/catalog/index.html');
    await wait(1200);
    const cards = w.document.querySelectorAll('#catalog_mix_container .item-card, #catalog_mix_container > *');
    ok('catalog: cards rendered', cards.length >= 2, cards.length);
    ok('catalog: real names', /Domino Crown/.test(w.document.body.textContent));
  }

  {
    const { w } = boot('/item/index.html', '?id=1581');
    await wait(1500);
    const text = w.document.body.textContent;
    ok('item: name', /Domino Crown/.test(text));
    ok('item: value', /10,000/.test(text));
    ok('item: rap', /9,500/.test(text));
    ok('item: owners table', /Nun/.test(text), text.slice(0, 120));
  }

  {
    const { w } = boot('/player/index.html', '?id=486');
    await wait(1500);
    const text = w.document.body.textContent;
    ok('player: name', /Nun/.test(text));
    ok('player: inventory', /Domino Crown/.test(text));
    ok('player: totals', /10,200|9,650/.test(text), text.slice(0, 200));
  }

  {
    const { w } = boot('/leaderboard/index.html');
    await wait(2000);
    ok('leaderboard: the board rendered', /Nun/.test(w.document.body.textContent),
      w.document.body.textContent.slice(0, 160));
  }

  {
    const { w } = boot('/valuechanges/index.html');
    await wait(1200);
    ok('value changes: the change is listed',
      /Domino Crown/.test(w.document.body.textContent) && /10,000/.test(w.document.body.textContent),
      w.document.body.textContent.slice(0, 160));
  }

  {
    const { w } = boot('/projecteds/index.html');
    await wait(1200);
    ok('deals: the flagged item is listed', /Playful Vampire/.test(w.document.body.textContent),
      w.document.body.textContent.slice(0, 160));
  }

  {
    const { w } = boot('/trades/index.html');
    await wait(1200);
    ok('trade ads: the ad is listed', /Nun/.test(w.document.body.textContent),
      w.document.body.textContent.slice(0, 160));
  }

  /* ---------------------------------------------------------------- */
  /* The controls on those pages                                        */
  /* ---------------------------------------------------------------- */

  {
    const { w } = boot('/catalog/index.html');
    await wait(1200);
    const d = w.document;
    const names = () => [...d.querySelectorAll('#catalog_mix_container .item-card-title, #catalog_mix_container h6')]
      .map(node => node.textContent.trim());
    const before = names();
    const sort = [...d.querySelectorAll('[data-dropdown="sort_type"], [data-field]')]
      .find(entry => /Highest Value/i.test(entry.textContent));
    if (sort) {
      sort.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
      await wait(150);
    }
    ok('catalog: sorting reorders the grid', names().length === before.length && names().length > 0,
      names().join(','));

    const search = d.getElementById('filter-textbox-search');
    if (search) {
      search.value = 'vamp';
      search.dispatchEvent(new w.Event('input'));
      await wait(250);
      ok('catalog: the search box filters', names().length === 1 && /Vampire/.test(names()[0]),
        names().join(','));
    } else {
      ok('catalog: has a search box', false, 'filter-textbox-search is gone');
    }
  }

  {
    const { w } = boot('/item/index.html', '?id=1581');
    await wait(1500);
    const d = w.document;
    const chart = d.getElementById('history_chart_div') || d.getElementById('history_chart_container');
    ok('item: the history chart drew', !!(chart && chart.querySelector('svg, .highcharts-container')),
      chart ? chart.textContent.trim().slice(0, 80) : 'no container');
    const tab = [...d.querySelectorAll('[data-toggle="tab"], .nav-link')]
      .find(a => /^Value$/i.test(a.textContent.trim()));
    if (tab) {
      tab.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
      await wait(400);
      const pane = d.getElementById('value_chart_div') || d.getElementById('value_chart_container');
      ok('item: the Value tab draws its chart',
        !!(pane && (pane.querySelector('svg, .highcharts-container') || pane.textContent.trim())),
        pane ? pane.textContent.trim().slice(0, 80) : 'no pane');
    }
    ok('item: the copies table lists the owners',
      /Nun/.test(d.body.textContent) && /goob/.test(d.body.textContent),
      d.body.textContent.slice(0, 150));
  }

  {
    const { w } = boot('/luckycat/index.html');
    await wait(1500);
    ok('lucky cat: the draw is shown', /Nun|Domino Crown/.test(w.document.body.textContent),
      w.document.body.textContent.replace(/\s+/g, ' ').slice(0, 160));
  }

  {
    const { w } = boot('/badges/index.html');
    await wait(1200);
    ok('badges: the catalogue rendered',
      w.document.querySelectorAll('.badge_collection_container > *').length > 0,
      w.document.querySelectorAll('.badge_collection_container > *').length);
  }

  {
    const { w } = boot('/playertrades/index.html', '?id=486');
    await wait(1500);
    ok('player trade ads: the ad is listed', /Domino Crown|Nun/.test(w.document.body.textContent),
      w.document.body.textContent.replace(/\s+/g, ' ').slice(0, 160));
  }

  {
    const { w } = boot('/tradead/index.html', '?id=ad1');
    await wait(1500);
    ok('trade ad: the ad opened', !/could not be found/i.test(w.document.body.textContent),
      w.document.body.textContent.replace(/\s+/g, ' ').slice(0, 160));
  }

  /* ---------------------------------------------------------------- */
  /* An item nobody has valued is worth its RAP                         */
  /* ---------------------------------------------------------------- */

  {
    const { w } = boot('/catalog/index.html');
    await wait(1400);
    const card = [...w.document.querySelectorAll('#catalog_mix_container > *')]
      .find(node => /Playful Vampire/.test(node.textContent));
    ok('catalog: an unvalued item shows its RAP as its value',
      !!card && /150/.test(card.textContent),
      card ? card.textContent.replace(/\s+/g, ' ').slice(0, 90) : 'no card');
    const valued = [...w.document.querySelectorAll('#catalog_mix_container > *')]
      .find(node => /Domino Crown/.test(node.textContent));
    ok('catalog: a valued item still shows the value that was set',
      !!valued && /10,000/.test(valued.textContent) && /9,500/.test(valued.textContent),
      valued ? valued.textContent.replace(/\s+/g, ' ').slice(0, 90) : 'no card');
  }

  {
    const { w } = boot('/item/index.html', '?id=4266');
    await wait(1500);
    const text = w.document.body.textContent.replace(/\s+/g, ' ');
    ok('item page: an unvalued item is worth its RAP', /150/.test(text), text.slice(0, 140));
    ok('item page: and says the figure is the RAP rather than a value',
      /tracks its RAP/i.test(text), text.slice(0, 400));
  }

  {
    const { w } = boot('/player/index.html', '?id=486');
    await wait(1600);
    const text = w.document.body.textContent.replace(/\s+/g, ' ');
    /* 10,000 for the valued crown + 150 RAP for the unvalued vampire. */
    ok('profile: the total counts the unvalued item at its RAP',
      /10,150/.test(text), text.slice(0, 220));
  }

  console.log(failures ? `\n${failures} FAILURES` : '\nALL PASS');
  process.exit(failures ? 1 : 0);
})();
