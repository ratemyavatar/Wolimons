/*
 * Links and assets.
 *
 * Every href and src the site ships is checked against what is actually on
 * disk. A page that links to a route nobody built, or loads a stylesheet that
 * was renamed, looks fine in a diff and is broken for every reader - and both
 * have happened here: the 2018 pages linked to Videos, Hall of Fame and
 * Market Activity, none of which this site has ever served.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { ROOT } = require('./helpers.js');

const SKIP = new Set(['.git', 'node_modules', 'snapshots', 'proxy', 'tools', 'test', 'cards']);

function htmlFiles(dir = ROOT, found = []) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach(entry => {
    if (SKIP.has(entry.name)) return;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) htmlFiles(full, found);
    else if (entry.name.endsWith('.html')) found.push(path.relative(ROOT, full));
  });
  return found;
}

const pages = htmlFiles();

/* A page exists at a route when there is an index.html for it - either the
 * modern one, or the 2018 one, which the server falls back to for routes only
 * that version has (the item table). */
function servesRoute(route) {
  const clean = route.replace(/^\/+|\/+$/g, '');
  return fs.existsSync(path.join(ROOT, clean, 'index.html'))
    || fs.existsSync(path.join(ROOT, '2018', clean, 'index.html'))
    || clean === '';
}

function localTargets(html, attribute) {
  const pattern = new RegExp(`${attribute}="(/[^"]*)"`, 'g');
  return [...html.matchAll(pattern)]
    .map(match => match[1].split('#')[0].split('?')[0])
    .filter(Boolean);
}

test('every page is somewhere', () => {
  assert.ok(pages.length > 20, `only found ${pages.length} pages`);
});

test('no page links to a route this site does not serve', () => {
  pages.forEach(page => {
    const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
    localTargets(html, 'href').forEach(target => {
      if (target.startsWith('/api')) return;
      /* A file - a stylesheet, an image, the logo. */
      if (fs.existsSync(path.join(ROOT, target))) return;
      assert.ok(servesRoute(target), `${page} links to ${target}, which nothing serves`);
    });
  });
});

test('no page loads a file that is not there', () => {
  pages.forEach(page => {
    const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
    ['src', 'href'].forEach(attribute => {
      localTargets(html, attribute)
        .filter(target => /\.(css|js|png|jpg|jpeg|svg|gif|webp|ico)$/i.test(target))
        .forEach(target => {
          assert.ok(fs.existsSync(path.join(ROOT, target)),
            `${page} loads ${target}, which is not in the repo`);
        });
    });
  });
});

test('nothing on the site still points at the proxy source or the captures', () => {
  pages.forEach(page => {
    const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
    ['src', 'href'].forEach(attribute => {
      localTargets(html, attribute).forEach(target => {
        assert.ok(!target.startsWith('/proxy/'), `${page} points at ${target}`);
        assert.ok(!target.startsWith('/snapshots/'), `${page} points at ${target}`);
      });
    });
  });
});

/*
 * The scripts a page loads have to exist, and be loaded in an order that
 * works: config.js and the API client come before anything that uses them.
 */
test('the page scripts are loaded in an order that works', () => {
  pages.forEach(page => {
    const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
    const scripts = [...html.matchAll(/<script[^>]*src="([^"]+)"/g)]
      .map(match => match[1].split('?')[0])
      .filter(src => src.startsWith('/assets/js/'));
    if (!scripts.length) return;

    const at = name => scripts.indexOf(`/assets/js/${name}`);
    const needsApi = ['catalog.js', 'item.js', 'player.js', 'players.js', 'leaderboard.js',
      'valuechanges.js', 'projecteds.js', 'tradecalculator.js', 'site2018.js', 'luckycat.js']
      .filter(name => at(name) !== -1);
    needsApi.forEach(name => {
      assert.ok(at('wanwood-api.js') !== -1 && at('wanwood-api.js') < at(name),
        `${page} loads ${name} without the API client in front of it`);
      assert.ok(at('config.js') !== -1 && at('config.js') < at(name),
        `${page} loads ${name} without config.js in front of it`);
    });

    /* The 2018 chart borrows the loader from history-chart.js. */
    if (at('chart2018.js') !== -1) {
      assert.ok(at('history-chart.js') !== -1 && at('history-chart.js') < at('chart2018.js'),
        `${page} loads chart2018.js without history-chart.js in front of it`);
    }
  });
});
