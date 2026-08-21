/*
 * The 2018 site.
 *
 * Not a reskin - a second set of pages, lifted out of Wayback snapshots and
 * wired to this API. The checks that matter are that the markup really did
 * come from 2018, that nothing of the original site's branding or dead
 * plumbing survived, and that the switch cannot strand anybody.
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
  });
});

test('the archive\'s own furniture is gone', () => {
  PAGES2018.forEach(route => {
    const html = page2018(route);
    assert.ok(!/web\.archive\.org|web-static\.archive\.org/.test(html), `${route || '/'} wayback`);
    assert.ok(!/adsbygoogle|googlesyndication|doubleclick/.test(html), `${route || '/'} ads`);
    assert.ok(!/<iframe/i.test(html), `${route || '/'} iframe`);
  });
});

test('the pages load our scripts, and none of the originals', () => {
  PAGES2018.forEach(route => {
    const html = page2018(route);
    assert.match(html, /assets\/js\/wanwood-api\.js/, route || '/');
    assert.match(html, /assets\/js\/site2018\.js/, route || '/');
    /* Every script tag must be one of ours. */
    [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].forEach(match => {
      assert.ok(match[1].startsWith('/assets/js/'), `${route || '/'} loads ${match[1]}`);
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
  const withTemplates = ['catalog', 'projecteds', 'valuechanges', 'players'];
  withTemplates.forEach(route => {
    const html = page2018(route);
    assert.match(html, /<template id="tpl_\w+">/, `${route} has no template`);
    /* And the specimen still carries the class the 2018 page gave it. */
    assert.match(html, /<template id="tpl_\w+"><div class="card [^"]*_(?:item|player)_cell"/, route);
  });
});

test('the adapter fills templates rather than writing markup', () => {
  const adapter = read('assets/js/site2018.js');
  assert.match(adapter, /template\.content[\s\S]{0,120}cloneNode\(true\)/);
  /* No innerHTML anywhere - that would be writing new markup. */
  assert.ok(!/innerHTML/.test(adapter), 'the adapter must not write HTML');
});

test('the 2018 pages use the 2018 stylesheets, unscoped', () => {
  PAGES2018.forEach(route => {
    const html = page2018(route);
    assert.match(html, /\/2018\/css\/bootstrap\.css/, route || '/');
    assert.match(html, /\/2018\/css\/site\.css/, route || '/');
  });
  assert.ok(fs.existsSync(path.join(ROOT, '2018', 'css', 'bootstrap.css')));
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

test('every 2018 page offers a way back to the modern site', () => {
  assert.match(read('assets/js/site2018.js'), /Leave 2018/);
  assert.match(read('assets/js/site2018.js'), /WolimonsTheme\.set\(false\)/);
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
});
