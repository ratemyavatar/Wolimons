/*
 * What an item is worth.
 *
 * The site's rule, in one place: an item is worth the value the value team
 * set, and until they set one it is worth its RAP - what it has actually been
 * selling for. RAP stays RAP; the two are always printed separately.
 *
 * The rule is easy to half-apply. It has to hold on a catalog card, in a
 * player's total, on the leaderboard, in a trade calculation and in the API,
 * or two pages will disagree about the same item - so this checks the one
 * implementation everything reads, and that nothing has quietly gone back to
 * reading the raw table where it should be asking for the figure to show.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { loadBrowserScript, read } = require('./helpers.js');

const VALUES = loadBrowserScript('assets/js/values.js').WolimonsValues;

test('a hand-set value is the value', () => {
  /* Nothing is set in the shipped table, so this drives the accessor
   * directly: with no stored figure it must fall back, and the fallback is
   * the only thing this file can exercise without the backend. */
  assert.strictEqual(VALUES.get(1581), 0, 'the shipped table is empty on purpose');
});

test('an item nobody has valued is worth its RAP', () => {
  assert.strictEqual(VALUES.valueOf(1581, 9500), 9500);
  assert.strictEqual(VALUES.valueOf(1581, 150), 150);
  assert.strictEqual(VALUES.tracksRap(1581, 9500), true);
});

test('an item with neither is worth nothing, and says so', () => {
  assert.strictEqual(VALUES.valueOf(1581, 0), 0);
  assert.strictEqual(VALUES.valueOf(1581, null), 0);
  assert.strictEqual(VALUES.valueOf(1581, undefined), 0);
  assert.strictEqual(VALUES.tracksRap(1581, 0), false, 'no RAP is not "tracking RAP"');
});

test('a RAP is a whole number of robux', () => {
  assert.strictEqual(VALUES.valueOf(1581, 1234.6), 1235);
});

test('rubbish in place of a RAP is not a value', () => {
  assert.strictEqual(VALUES.valueOf(1581, 'lots'), 0);
  assert.strictEqual(VALUES.valueOf(1581, Infinity), 0);
  assert.strictEqual(VALUES.valueOf(1581, -400), 0, 'a negative RAP is not a price');
});

test('get() is still the raw table, so the admin panel edits the right thing', () => {
  /* The editor prefills from get(), not valueOf() - otherwise opening an
   * unvalued item and pressing save would freeze today's RAP into a value
   * nobody chose. */
  const admin = read('assets/js/admin.js');
  assert.match(admin, /dom\.valueAmount\.value = stored \? String\(stored\) : ''/);
  assert.match(admin, /const stored = VALUES \? VALUES\.get\(item\.id\) : 0/);
});

test('every page that prints a value asks for the figure to show', () => {
  /* A page reading VALUES.get() for display is a page that will print 0 for
   * an unvalued item while its neighbour prints the RAP. */
  const pages = {
    'catalog.js': /VALUES\.valueOf\(item\.id, item\.rap\)/,
    'item-cards.js': /VALUES\.valueOf\(id,/,
    'item.js': /VALUES\.valueOf\(id, rap\)/,
    'player.js': /VALUES\.valueOf\(id,/,
    'player-roster.js': /VALUES\.valueOf\(assetId, assetRap\)/,
    'projecteds.js': /VALUES\.valueOf\(id,/,
    'tradecalculator.js': /VALUES\.valueOf\(id,/,
    'tradeads-core.js': /valueOfSlot\(/,
    'inventoryshare.js': /VALUES\.valueOf\(id,/,
    'site2018.js': /VALUES\.valueOf\(/,
  };
  Object.entries(pages).forEach(([name, pattern]) => {
    assert.match(read(`assets/js/${name}`), pattern, `${name} does not use the rule`);
  });
});

test('the server totals a player the same way the page does', () => {
  const stats = read('proxy/playerstats.js');
  assert.match(stats, /value \+= set > 0 \? set : average/);
});

test('the public API says which figure it is handing out', () => {
  const api = read('proxy/api.js');
  assert.match(api, /value: setValue > 0 \? setValue : average/);
  assert.match(api, /valued: setValue > 0/);
  assert.match(api, /setValue,/);
  /* And the docs page describes the same rule rather than the old one. */
  const docs = read('apidocs/index.html');
  assert.match(docs, /an item nobody has valued is worth its RAP/i);
  assert.match(docs, /"valued": false/);
});

test('link previews rank players by the same rule', () => {
  assert.match(read('proxy/embed.js'), /setValue > 0 \? setValue : \(Number\(rap\) \|\| 0\)/);
});
