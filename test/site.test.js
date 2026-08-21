/*
 * Whole-site checks.
 *
 * Not features - the things that quietly break a page for everyone and are
 * invisible in a code review. Every one of these has actually gone wrong on
 * this site at least once.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { ROOT, read, sitePages, idsIn } = require('./helpers.js');

const pages = sitePages();
const scripts = fs.readdirSync(path.join(ROOT, 'assets', 'js')).filter(f => f.endsWith('.js'));

/* ---------------------------------------------------------------- */
/* Caching                                                           */
/* ---------------------------------------------------------------- */

/*
 * A rename once shipped fresh HTML against a cached stylesheet, the flex rule
 * vanished, and the item row collapsed into a column. Versioning every asset
 * is what stops HTML and CSS ever being from different builds.
 */
test('every stylesheet and script reference is version-stamped', () => {
  pages.forEach(([name, html]) => {
    const unversioned = [
      ...html.matchAll(/(?:href|src)="(\/(?:css|assets\/js)\/[^"?]+\.(?:css|js))"/g),
    ].map(match => match[1]);
    assert.deepStrictEqual(unversioned, [], `${name} has un-versioned assets`);
  });
});

test('the whole site is on one version, so nothing loads a mismatched pair', () => {
  const versions = new Set();
  pages.forEach(([, html]) => {
    [...html.matchAll(/[?&]v=(\d+)/g)].forEach(match => versions.add(match[1]));
  });
  assert.strictEqual(versions.size, 1, `pages disagree on version: ${[...versions].join(', ')}`);
});

/* ---------------------------------------------------------------- */
/* Markup                                                            */
/* ---------------------------------------------------------------- */

test('no page repeats an element id', () => {
  pages.forEach(([name, html]) => {
    const ids = idsIn(html);
    const seen = new Set();
    const duplicates = ids.filter(id => (seen.has(id) ? true : (seen.add(id), false)));
    assert.deepStrictEqual([...new Set(duplicates)], [], `${name} repeats ids`);
  });
});

/*
 * A script reaching for an id the page does not have fails silently: the
 * feature simply never happens, with nothing in the console.
 */
test('every id a page script reaches for exists in its page', () => {
  const checks = [
    ['admin/index.html', 'assets/js/admin.js'],
    ['thuglolboi/index.html', 'assets/js/vault.js'],
    ['player/index.html', 'assets/js/player.js'],
    ['item/index.html', 'assets/js/item.js'],
  ];
  checks.forEach(([page, script]) => {
    const html = read(page);
    const ids = new Set(idsIn(html));
    const wanted = [...new Set(
      [...read(script).matchAll(/getElementById\('([^']+)'\)/g)].map(m => m[1]),
    )];
    const missing = wanted.filter(id => !ids.has(id));
    assert.deepStrictEqual(missing, [], `${script} reaches for ids missing from ${page}`);
  });
});

test('every page script parses', () => {
  scripts.forEach(name => {
    assert.doesNotThrow(
      // eslint-disable-next-line no-new-func
      () => new Function(read(`assets/js/${name}`)),
      `assets/js/${name} does not parse`,
    );
  });
});

test('every backend module is valid and loads without side effects', () => {
  /* server.js binds a port the moment it is required, so it is syntax-checked
   * in a child rather than loaded here - a test run must not start a server. */
  const { execFileSync } = require('node:child_process');
  ['api.js', 'store.js', 'server.js', 'embed.js', 'playerstats.js'].forEach(name => {
    assert.doesNotThrow(
      () => execFileSync(process.execPath, ['--check', path.join(ROOT, 'proxy', name)]),
      `proxy/${name} does not parse`,
    );
  });

  /* The rest are safe to load, and loading them proves their requires resolve. */
  ['api.js', 'store.js', 'embed.js', 'playerstats.js'].forEach(name => {
    assert.doesNotThrow(() => require(path.join(ROOT, 'proxy', name)), `proxy/${name}`);
  });
});

/* ---------------------------------------------------------------- */
/* Branding                                                          */
/* ---------------------------------------------------------------- */

test('nothing on the site mentions the sites or the game it was modelled on', () => {
  /* Roblox is in here too: the footers used to disclaim a company that has
   * nothing to do with this site, which read as leftovers from the copy the
   * pages were built from - because that is what it was. */
  const banned = /rolimon|koromon|coromon|colimon|roblox/i;
  pages.forEach(([name, html]) => assert.ok(!banned.test(html), `${name} mentions another site`));
  scripts.forEach(name => {
    assert.ok(!banned.test(read(`assets/js/${name}`)), `assets/js/${name} mentions another site`);
  });
  ['wolimons.css', 'sitecombined2.css', 'snapshot.css', 'tradeads.css'].forEach(name => {
    assert.ok(!banned.test(read(`css/${name}`)), `css/${name} mentions another site`);
  });
  ['api.js', 'server.js', 'store.js'].forEach(name => {
    assert.ok(!banned.test(read(`proxy/${name}`)), `proxy/${name} mentions another site`);
  });
});

test('the footer says whose site this is, and disclaims nobody else', () => {
  pages
    .filter(([name]) => name !== 'admin/index.html' && read(name).includes('<footer'))
    .forEach(([name, html]) => {
      assert.ok(html.includes('official values and trading site for Wanwood'), `${name}`);
      assert.ok(!/not affiliated/i.test(html), `${name} still disclaims somebody`);
    });
});

/* ---------------------------------------------------------------- */
/* The private pages                                                 */
/* ---------------------------------------------------------------- */

test('the vault password is in nothing a browser downloads', () => {
  assert.ok(!read('thuglolboi/index.html').includes('ilovegod123'));
  assert.ok(!read('assets/js/vault.js').includes('ilovegod123'));
  /* It lives on the server, and can be overridden per machine. */
  assert.match(read('proxy/api.js'), /process\.env\.VAULT_PASSWORD/);
});

test('nothing public links to the private page', () => {
  pages
    .filter(([name]) => !name.startsWith('thuglolboi'))
    .forEach(([name, html]) => {
      if (name === 'admin/index.html') return;   /* the owner-only shortcut */
      assert.ok(!html.includes('thuglolboi'), `${name} links to the private page`);
    });
});

test('the drop watcher shortcut is website-owner only', () => {
  const admin = read('assets/js/admin.js');
  assert.match(admin, /id: 'vault'[\s\S]{0,160}need: 'website'/);
  assert.match(admin, /id: 'vault'[\s\S]{0,160}hidden: true/);
});

test('the server refuses to hand out its own directory', () => {
  const server = read('proxy/server.js');
  const denied = server.match(/DENIED = new Set\(\[([^\]]*)\]/);
  assert.ok(denied, 'no deny list found');
  ['.git', '.env', 'node_modules', 'proxy', 'cards'].forEach(entry => {
    assert.ok(denied[1].includes(`'${entry}'`), `${entry} is served to the public`);
  });
});

test('buying happens on the server, never cross-origin from the page', () => {
  const vault = read('assets/js/vault.js');
  assert.ok(!vault.includes("credentials: 'include'"), 'a browser cannot do this - CORS blocks it');
  assert.ok(!vault.includes('wanwoo.xyz'), 'the page must not call the game directly');
  assert.match(vault, /vaultCall\('\/api\/vault\/buy'/);
});

test('the stored game session is written owner-only and never returned', () => {
  const api = read('proxy/api.js');
  assert.match(api, /mode: 0o600/);
  assert.match(api, /function sessionHint/, 'only a hint of the cookie may leave the server');
});

/* ---------------------------------------------------------------- */
/* Charts                                                            */
/* ---------------------------------------------------------------- */

test('presence has three states, so a failed call is not printed as Offline', () => {
  const player = read('assets/js/player.js');
  assert.match(player, /function renderPresence\(online\)/);
  assert.match(player, /online === true \? 'Online' : online === false \? 'Offline' : 'Unknown'/);
  assert.match(player, /renderPresence\(legacy \? legacy\.IsOnline === true : null\)/,
    'a missing response means unknown, not offline');
  assert.match(player, /startPresencePolling/, 'presence must be re-read while the page is open');
  assert.match(player, /\?_=\$\{Date\.now\(\)\}/, 'and must defeat the one-minute GET cache');
});

test('a zero RAP from resale-data cannot wipe a real one', () => {
  /* Wanwood answers 0 for items the inventory prices at 345. Taking that
   * literally reported whole collections as worthless. */
  assert.match(read('assets/js/player.js'), /Number\.isFinite\(reportedRap\) && reportedRap > 0/);
});

test('the profile chart is drawn from recorded history, not a reconstruction', () => {
  const player = read('assets/js/player.js');
  assert.match(player, /\/api\/playerstats\?id=/);
  assert.match(player, /if \(recorded\.length < 2\)/, 'one reading is a dot, not a history');
  assert.match(player, /player_history_note/, 'and it must say so rather than fake a line');
  assert.ok(read('player/index.html').includes('id="player_history_note"'));
});

test('charts start at zero on day one, with no gap in front of the line', () => {
  /* An item has no RAP the day it is made and a player owns nothing the day
   * they join, so zero is the true starting figure - and it draws the line
   * from the beginning instead of leaving it hanging in mid-air. */
  const chart = read('assets/js/history-chart.js');
  assert.match(chart, /valueSeries\.unshift\(\[floor, 0\]\)/);
  assert.match(chart, /rapSeries\.unshift\(\[floor, 0\]\)/);
  assert.ok(!/unshift\(\[floor, null\]\)/.test(chart), 'a null point leaves the gap back');
});

test('a profile chart ends on the figures the page is showing', () => {
  /* The series is rebuilt from price points that lag, so without this the
   * chart could disagree with the RAP printed at the top of the same page. */
  const player = read('assets/js/player.js');
  assert.match(player, /const rapNow = items\.reduce/);
  assert.match(player, /const valueNow = items\.reduce/);
  assert.match(player, /series\.push\(\{ time: today, rap: rapNow, value: valueNow \}\)/);
});

test('the ownership history feature is fully gone, not half removed', () => {
  const fs2 = require('node:fs');
  assert.ok(!fs2.existsSync(path.join(ROOT, 'proxy', 'ownership.js')));
  ['assets/js/item.js', 'assets/js/player.js', 'proxy/api.js', 'proxy/server.js']
    .forEach(file => {
      assert.ok(!/ownership\.js|owner_history|player_item_history|startOwnershipTracking/.test(read(file)),
        `${file} still references the removed feature`);
    });
  assert.ok(!read('item/index.html').includes('owner_history'));
  assert.ok(!read('player/index.html').includes('player_item_history'));
  /* The Ownership *chart* tab is a different thing and stays. */
  assert.ok(read('item/index.html').includes('ownership_chart_tab'));
});

test('charts open on All and start where the subject started', () => {
  const chart = read('assets/js/history-chart.js');
  assert.match(chart, /selected:\s*5/, 'the range selector should open on All');
  assert.match(chart, /Number\(names\.since\)/, 'the floor comes from the page');
  assert.ok(!/fourMonthsAgo/.test(chart), 'the fixed four-month window should be gone');

  assert.match(read('assets/js/item.js'), /since: Number\.isFinite\(created\)/);
  assert.match(read('assets/js/player.js'), /since: state\.joinedAt/);
});

test('the announcement banner cannot cover the navbar menus', () => {
  /* The declaration is several concatenated strings and each one contains
   * semicolons, so the match has to run to the closing quote of the last
   * piece - stopping at the first ';' reads only the background colour and
   * would miss a z-index added at the end. */
  const banner = read('assets/js/navbar.js').match(/banner\.style\.cssText = ([\s\S]*?')\s*;/);
  assert.ok(banner, 'banner styling not found');
  assert.ok(/width: 100%/.test(banner[1]), 'the match did not reach the end of the declaration');
  assert.ok(!/z-index/.test(banner[1]), 'a z-index here paints it over the dropdowns');
  assert.ok(!/position:/.test(banner[1]));
});

/* ---------------------------------------------------------------- */
/* Deployment                                                        */
/* ---------------------------------------------------------------- */

test('the Windows pull script restarts the service and stays valid batch', () => {
  const cmd = read('windows/git-pull.cmd');

  assert.ok(cmd.split('\n').length - 1 === cmd.split('\r\n').length - 1,
    'batch files need CRLF line endings');

  const labels = new Set([...cmd.matchAll(/^:(\w+)/gm)].map(m => m[1]));
  [...cmd.matchAll(/goto\s+(\w+)/g)].forEach(match => {
    assert.ok(labels.has(match[1]), `goto ${match[1]} has no label`);
  });
  assert.strictEqual((cmd.match(/\(/g) || []).length, (cmd.match(/\)/g) || []).length,
    'unbalanced parentheses');

  assert.match(cmd, /sc query "%SERVICE%"/, 'should check the service exists');
  assert.match(cmd, /net session/, 'should check for administrator rights');
  assert.match(cmd, /find "RUNNING"/, 'should confirm the service came back up');
});
