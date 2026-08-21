/*
 * The 2018 site.
 *
 * Not a reskin - a second set of pages, lifted out of archived copies and
 * wired to this API. The checks that matter are that the markup really did
 * come from the old site, that nothing of its branding, its dead links or its
 * data survived, and that the switch cannot strand anybody.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, read, sitePages } = require('./helpers.js');

const PAGES2018 = ['', 'catalog', 'itemtable', 'leaderboard', 'players', 'item',
  'preferences', 'projecteds', 'player', 'valuechanges', 'tradecalculator'];

const page2018 = route => read(path.join('2018', route, 'index.html'));
const navOf = html => (html.match(/<nav class="navbar[\s\S]*?<\/nav>/) || [''])[0];
const footerOf = html => (html.match(/<footer[\s\S]*?<\/footer>/) || [''])[0];

test('every route has a 2018 page', () => {
  PAGES2018.forEach(route => {
    assert.ok(fs.existsSync(path.join(ROOT, '2018', route, 'index.html')), route || '/');
  });
});

test('the 2018 pages carry no trace of the site they came from', () => {
  PAGES2018.forEach(route => {
    const html = page2018(route);
    assert.ok(!/rolimon/i.test(html), `${route || '/'} mentions Rolimon's`);
    assert.ok(!/roblox/i.test(html), `${route || '/'} mentions Roblox`);
    /* Builders Club is not a thing on Wanwood, so no page may offer it. */
    assert.ok(!/\bBC (?:Copies|Owners)\b/.test(html), `${route || '/'} still offers BC figures`);
  });
});

test('the archive\'s own furniture is gone', () => {
  PAGES2018.forEach(route => {
    const html = page2018(route);
    assert.ok(!/web\.archive\.org|web-static\.archive\.org/.test(html), `${route || '/'} wayback`);
    assert.ok(!/FILE ARCHIVED ON|playback timings/.test(html), `${route || '/'} archive comment`);
    assert.ok(!/adsbygoogle|googlesyndication|doubleclick/.test(html), `${route || '/'} ads`);
    assert.ok(!/<iframe/i.test(html), `${route || '/'} iframe`);
    /* The toolbar's comment used to leave its closing marker on the page,
     * printing "-->" above the first heading. */
    assert.ok(!/<body[^>]*>\s*-->/.test(html), `${route || '/'} stray comment marker`);
  });
});

test('the old data went with it', () => {
  /* The copies were saved with a day of somebody else\'s numbers in them.
   * Keeping those would mean a reader seeing another site\'s items until the
   * adapter finished - and forever if a fetch failed. */
  const item = page2018('item');
  assert.ok(!/Playful Vampire/.test(item), 'the item page still shows the archived item');
  assert.ok(!/>3771</.test(item), 'the item page still shows the archived RAP');
  assert.ok(!/>7000</.test(item), 'the item page still shows the archived value');
  assert.ok(!/Dominus/.test(page2018('itemtable')), 'the item table still lists archived items');
});

test('every page has the same navbar, and every entry goes somewhere real', () => {
  const routes = ['catalog', 'itemtable', 'leaderboard', 'players', 'item', 'preferences',
    'projecteds', 'player', 'valuechanges', 'tradecalculator'];
  const canonical = navOf(page2018('')).replace(/ active"/g, '"');
  assert.ok(canonical.length > 500, 'no navbar on the home page');

  routes.forEach(route => {
    const nav = navOf(page2018(route)).replace(/ active"/g, '"');
    assert.strictEqual(nav, canonical, `${route} has a different navbar`);
  });

  /* The archived copies were taken ten months apart and their navbars
   * disagreed: some offered Leaks, Videos, Hall of Fame - pages this site
   * does not have. Nothing may link to one. */
  const served = new Set(['/', '/catalog', '/itemtable', '/leaderboard', '/players',
    '/preferences', '/projecteds', '/valuechanges', '/tradecalculator', '/item/', '/player/']);
  [...canonical.matchAll(/href="([^"]+)"/g)].map(match => match[1]).forEach(href => {
    if (href.startsWith('https://discord.gg/')) return;
    if (href === '#') return;
    assert.ok(served.has(href), `the navbar links to ${href}, which this site does not serve`);
  });
  assert.ok(!/data-dead-link/.test(page2018('')), 'a dead link survived the build');
});

test('the navbar works without a plugin: dropdowns and the phone menu', () => {
  PAGES2018.forEach(route => {
    const html = page2018(route);
    /* navbar.js is the site\'s own; it drives exactly this markup. */
    assert.match(html, /assets\/js\/navbar\.js/, `${route || '/'} does not load navbar.js`);
    assert.match(html, /class="navbar-toggler"[^>]*data-target="#navbarSupportedContent"/,
      `${route || '/'} has no phone toggle`);
    assert.match(html, /id="navbarSupportedContent"/, route || '/');
    assert.match(html, /data-toggle="dropdown"/, `${route || '/'} has no dropdown`);
  });
  const navbar = read('assets/js/navbar.js');
  assert.match(navbar, /navbar-toggler\[data-target="#navbarSupportedContent"\]/);
  assert.match(navbar, /\[data-toggle="dropdown"\]/);
});

test('the footer is one footer, and it names nobody but us', () => {
  const canonical = footerOf(page2018(''));
  assert.match(canonical, /Wolimons is the official values and trading site for Wanwood\./);
  PAGES2018.forEach(route => {
    assert.strictEqual(footerOf(page2018(route)), canonical, `${route || '/'} footer differs`);
  });
});

test('the pages load our scripts, and none of the originals', () => {
  PAGES2018.forEach(route => {
    const html = page2018(route);
    assert.match(html, /assets\/js\/wanwood-api\.js/, route || '/');
    assert.match(html, /assets\/js\/site2018\.js/, route || '/');
    [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].forEach(match => {
      const src = match[1].split('?')[0];
      assert.ok(src.startsWith('/assets/js/'), `${route || '/'} loads ${src}`);
      assert.ok(fs.existsSync(path.join(ROOT, src.slice(1))), `${route || '/'} loads missing ${src}`);
    });
  });
});

test('links point at our routes', () => {
  PAGES2018.forEach(route => {
    const html = page2018(route);
    [...html.matchAll(/href="([^"]+)"/g)]
      .map(match => match[1])
      .filter(href => href.startsWith('http'))
      .forEach(href => {
        assert.ok(!/rolimons|roblox/i.test(href), `${route || '/'} links out to ${href}`);
      });
  });
});

test('the repeating elements are kept as templates of real 2018 markup', () => {
  /* This is what makes the pages 2018 rather than an imitation: the adapter
   * clones these, it does not build markup of its own. */
  const cells = {
    catalog: 'catpg_item_cell',
    projecteds: 'projectionspg_item_cell',
    valuechanges: 'valuechangespg_item_cell',
    players: 'playerspg_player_cell',
    leaderboard: 'item_cell',
    player: 'playerpg_item_cell',
    tradecalculator: 'mix_item',
  };
  Object.entries(cells).forEach(([route, className]) => {
    const html = page2018(route);
    assert.match(html, /<template id="tpl_\w+">/, `${route} has no template`);
    assert.ok(html.includes(className), `${route}'s template lost its 2018 class`);
    /* And the container it was taken out of is marked for the adapter. */
    assert.match(html, /data-2018-container="/, `${route} has no container`);
  });
  assert.match(page2018('itemtable'), /<template id="tpl_row"><tr/);
  /* The item page's owner lists were drawn by a plugin, so the build lends
   * it a real table from the item table page rather than inventing one. */
  assert.match(page2018('item'), /<template id="tpl_table">/);
});

test('the adapter fills templates rather than writing markup', () => {
  const adapter = read('assets/js/site2018.js');
  assert.match(adapter, /template\.content[\s\S]{0,120}cloneNode\(true\)/);
  /* No innerHTML anywhere - that would be writing new markup. */
  assert.ok(!/innerHTML/.test(adapter), 'the adapter must not write HTML');
});

test('every 2018 page is wired to real data, not left as a shell', () => {
  const adapter = read('assets/js/site2018.js');
  ['catalog', 'projecteds', 'valuechanges', 'players', 'leaderboard',
    'itemtable', 'item', 'player', 'tradecalculator'].forEach(name => {
    assert.match(adapter, new RegExp(`page === '${name}'`), `${name} is not wired up`);
  });
  /* And it asks the same places the modern pages do. */
  assert.match(adapter, /API\.listAllCollectibles\(\)/);
  assert.match(adapter, /API\.getAssetOwners\(id\)/);
  assert.match(adapter, /API\.getCollectibles\(id\)/);
  assert.match(adapter, /\/api\/v1\/valuechanges/);
  assert.match(adapter, /\/api\/playerstats\?id=/);
});

test('the 2018 pages use the 2018 stylesheets, unscoped', () => {
  PAGES2018.forEach(route => {
    const html = page2018(route);
    assert.match(html, /\/2018\/css\/bootstrap\.css/, route || '/');
    assert.match(html, /\/2018\/css\/site\.css/, route || '/');
  });
  ['bootstrap.css', 'site.css', 'simplepagination.css', 'datatables.css'].forEach(name => {
    assert.ok(fs.existsSync(path.join(ROOT, '2018', 'css', name)), name);
  });
  /* The item table and the item page's owner lists are DataTables markup,
   * and were unstyled until its stylesheet came along too. */
  assert.match(page2018('itemtable'), /\/2018\/css\/datatables\.css/);
  assert.ok(!fs.existsSync(path.join(ROOT, 'css', 'theme2018.css')),
    'the reskin stylesheet should be gone - these are real pages now');
});

test('the switch is a cookie the server can read before it sends HTML', () => {
  const theme = read('assets/js/theme.js');
  assert.match(theme, /wolimons_theme=2018/);
  assert.match(theme, /parsed\.theme2018 === true/, 'only an explicit true counts');
  assert.match(theme, /catch \(error\) \{[\s\S]{0,200}return false/, 'bad storage falls back');

  const server = read('proxy/server.js');
  assert.match(server, /function wants2018\(req\)/);
  assert.match(server, /path\.join\(SITE_ROOT, '2018'/);
});

test('the switch cannot loop', () => {
  /* It reloads only when the cookie disagreed with the preference, and the
   * cookie is written first - so the next load agrees. */
  const theme = read('assets/js/theme.js');
  assert.match(theme, /if \(on === was\) return;/);
  assert.match(theme, /writeCookie\(on\);[\s\S]{0,400}location\.reload\(\)/);
});

test('pages 2018 never had stay modern', () => {
  ['admin', 'thuglolboi', 'inbox', 'staff'].forEach(route => {
    assert.ok(!fs.existsSync(path.join(ROOT, '2018', route, 'index.html')),
      `${route} should not have a 2018 version`);
  });
});

test('the way back is the preferences page, not a button bolted to the navbar', () => {
  const adapter = read('assets/js/site2018.js');
  assert.ok(!/Leave 2018/.test(adapter), 'the bolted-on exit button is back');
  PAGES2018.forEach(route => {
    assert.ok(!/Leave 2018/.test(page2018(route)), `${route || '/'} has an exit button`);
  });

  /* The 2018 preferences page drives the same setting, through the same
   * editor the modern one uses. */
  const prefs = page2018('preferences');
  assert.match(prefs, /id="theme-2018-checkbox"[^>]*data-pref="theme2018"|data-pref="theme2018"/);
  assert.match(prefs, /data-pref="hideTablets"/);
  assert.match(prefs, /data-pref="hideUnobtainables"/);
  assert.match(prefs, /assets\/js\/preferences\.js/);
  /* Every page reaches it: the gear in the navbar. */
  PAGES2018.forEach(route => {
    assert.match(navOf(page2018(route)), /href="\/preferences"/, route || '/');
  });
});

test('the Discord panel is on the 2018 home page and nowhere else', () => {
  /* It is 2018 furniture - the modern front page never had it. */
  assert.match(read('assets/js/site2018.js'), /function loadDiscord/);
  assert.match(read('assets/js/site2018.js'), /if \(page === 'home'\) loadDiscord\(\)/);
  sitePages().forEach(([name, html]) => {
    assert.ok(!html.includes('discord_widget'), `${name} should not carry the panel`);
    assert.ok(!html.includes('discord-widget.js'), `${name} should not load it`);
  });
});

test('the Discord panel still reads the invite already in the site', () => {
  assert.match(read('proxy/api.js'), /DISCORD_INVITE_CODE \|\| 'vCwRzWSMf'/);
  assert.match(read('proxy/api.js'), /DISCORD_GUILD_ID \|\| '1490444783435518013'/);
});

test('the 2018 build is reproducible from the tool', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'tools', 'build-2018.py')));
  const tool = read('tools/build-2018.py');
  /* The tool is what guarantees the pages above: one navbar, one footer, no
   * archived data, and the templates the adapter needs. */
  assert.match(tool, /def build_navbar/);
  assert.match(tool, /def build_footer/);
  assert.match(tool, /def blank_data/);
  assert.match(tool, /def extract_templates/);
});
