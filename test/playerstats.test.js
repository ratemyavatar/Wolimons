/*
 * Player value / RAP history.
 *
 * Wanwood publishes none, so this is the only record there is. If it writes
 * down a wrong number nothing else can correct it.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');

process.env.PLAYERSTATS_FILE = path.join(os.tmpdir(), `wolimons-stats-${process.pid}.json`);
const stats = require('../proxy/playerstats.js');

const rows = [
  { assetId: 2853, recentAveragePrice: 345 },
  { assetId: 3839, recentAveragePrice: 225 },
  { assetId: 4266, recentAveragePrice: 150 },
  { assetId: 4016, recentAveragePrice: 0 },
];
const valueOf = id => ({ 2853: 400, 3839: 250 }[id] || 0);

test('totals match what the inventory itself reports', () => {
  const totals = stats.totalsFrom(rows, valueOf);
  /* Wanwood's own totalRap for this inventory is 720. */
  assert.strictEqual(totals.rap, 720);
  assert.strictEqual(totals.value, 650);
  assert.strictEqual(totals.copies, 4, 'an item worth nothing is still a copy held');
});

test('a duplicate copy counts twice', () => {
  const doubled = stats.totalsFrom([...rows, { assetId: 2853, recentAveragePrice: 345 }], valueOf);
  assert.strictEqual(doubled.rap, 1065);
  assert.strictEqual(doubled.copies, 5);
});

test('rubbish rows are ignored rather than counted as zero-value items', () => {
  const totals = stats.totalsFrom([{ recentAveragePrice: 999 }, null, { assetId: 0 }], valueOf);
  assert.strictEqual(totals.copies, 0);
  assert.strictEqual(totals.rap, 0);
});

test('a reading is recorded and read back', async () => {
  stats._reset();
  const history = await stats.record(486, { rap: 720, value: 650, copies: 4 });
  assert.strictEqual(history.length, 1);
  assert.strictEqual(history[0].rap, 720);
  assert.deepStrictEqual(stats.history(486)[0].rap, 720);
});

test('opening a profile twice in a day leaves one row, with the newest figures', async () => {
  stats._reset();
  await stats.record(486, { rap: 720, value: 650, copies: 4 });
  await stats.record(486, { rap: 700, value: 650, copies: 4 });
  const history = stats.history(486);
  assert.strictEqual(history.length, 1, 'a refresh must not add a second point');
  assert.strictEqual(history[0].rap, 700, 'and must keep the newer figure');
});

test('an unchanged refresh does not rewrite anything', async () => {
  stats._reset();
  await stats.record(486, { rap: 720, value: 650, copies: 4 });
  const before = stats.history(486)[0].at;
  await stats.record(486, { rap: 720, value: 650, copies: 4 });
  assert.strictEqual(stats.history(486)[0].at, before);
});

test('a new day is a new point, so a drop is visible', async () => {
  stats._reset();
  await stats.record(486, { rap: 1000, value: 900, copies: 5 });

  /* Age yesterday's reading so the next one counts as a different day. */
  stats._data().players['486'][0].at -= 2 * stats.DAY_MS;

  await stats.record(486, { rap: 700, value: 650, copies: 4 });
  const history = stats.history(486);
  assert.strictEqual(history.length, 2, 'a later day must add a point');
  assert.strictEqual(history[0].rap, 1000, 'the peak is kept');
  assert.strictEqual(history[1].rap, 700, 'and the drop is recorded');
  assert.ok(history[0].at < history[1].at, 'oldest first');
});

test('each player is kept separately', async () => {
  stats._reset();
  await stats.record(486, { rap: 720, value: 0, copies: 1 });
  await stats.record(3, { rap: 50, value: 0, copies: 1 });
  assert.strictEqual(stats.history(486)[0].rap, 720);
  assert.strictEqual(stats.history(3)[0].rap, 50);
});

test('an unknown player has no history rather than an error', () => {
  stats._reset();
  assert.deepStrictEqual(stats.history(999999), []);
});

test('a bad id is refused', async () => {
  stats._reset();
  assert.deepStrictEqual(await stats.record(0, { rap: 1, value: 1, copies: 1 }), []);
  assert.deepStrictEqual(await stats.record(-5, { rap: 1, value: 1, copies: 1 }), []);
});

test('figures are computed on the server, never taken from the page', () => {
  const api = require('fs').readFileSync(require.resolve('../proxy/api.js'), 'utf8');
  const handler = api.slice(api.indexOf("route === '/api/playerstats'"));
  assert.ok(/playerstats\.totalsFrom\(rows, valueOf\)/.test(handler.slice(0, 2000)),
    'the totals must be worked out here');
  assert.ok(!/readJson\(await readBody/.test(handler.slice(0, 2000)),
    'nothing about the numbers may come from the request body');
});

test('a failed inventory read is not written down as owning nothing', () => {
  const api = require('fs').readFileSync(require.resolve('../proxy/api.js'), 'utf8');
  const handler = api.slice(api.indexOf("route === '/api/playerstats'"), api.indexOf("route === '/api/discord'"));
  assert.match(handler, /if \(!Array\.isArray\(rows\)\)/);
  assert.match(handler, /has not been recorded/);
});
