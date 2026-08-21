/*
 * Ownership tracking.
 *
 * The tracker is the only part of the site that writes history nobody can
 * check afterwards - if it records a transfer that never happened, or names
 * the wrong player, there is no source to correct it against. So the rules it
 * must never break are pinned here.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const ownership = require('../proxy/ownership.js');

const copy = (uaid, serial, userId, name, created, updated) => ({
  userAssetId: uaid,
  serialNumber: serial,
  userId,
  name,
  created,
  updated,
});

const MINT = '2024-03-01T00:00:00Z';
const MOVE = '2025-06-10T00:00:00Z';

/* One item, two copies: #1 has changed hands since it was made, #2 has not. */
function fixture() {
  const owners = {
    1581: [
      copy(7001, 1, 2, 'luke', MINT, MOVE),
      copy(7002, 2, 3, 'x_x', MINT, MINT),
    ],
  };
  return {
    owners,
    hooks: {
      listItems: async () => Object.keys(owners).map(Number),
      readOwners: async id => owners[id] || [],
    },
  };
}

test('the first scan already carries history, back to the mint date', async () => {
  ownership._reset();
  const { hooks } = fixture();
  await ownership.scan(hooks);

  const history = ownership.itemHistory(1581);
  assert.strictEqual(history.length, 3, 'two mints and one earlier move');
  assert.strictEqual(
    new Date(ownership.status().reachesBackTo).toISOString().slice(0, 10),
    '2024-03-01',
  );
});

test('history is newest first', async () => {
  ownership._reset();
  await ownership.scan(fixture().hooks);
  const history = ownership.itemHistory(1581);
  history.forEach((event, index) => {
    if (index) assert.ok(history[index - 1].at >= event.at, 'out of order');
  });
});

test('a copy that never moved is minted straight to the player holding it', async () => {
  ownership._reset();
  await ownership.scan(fixture().hooks);
  const mint = ownership.itemHistory(1581).find(e => e.kind === 'minted' && e.uaid === 7002);
  assert.strictEqual(mint.to, 3);
});

test('a copy that has moved does not claim its current holder was the first', async () => {
  ownership._reset();
  await ownership.scan(fixture().hooks);
  const mint = ownership.itemHistory(1581).find(e => e.kind === 'minted' && e.uaid === 7001);
  assert.strictEqual(mint.to, 0, 'the original owner is unknown and must stay unknown');
});

test('an unknown counterparty is left blank rather than invented', async () => {
  ownership._reset();
  await ownership.scan(fixture().hooks);
  const moved = ownership.itemHistory(1581).find(e => e.kind === 'moved');
  assert.strictEqual(moved.from, 0);
  assert.strictEqual(moved.fromName, '');
  assert.strictEqual(moved.to, 2, 'but the receiving side is known');
});

test('a live transfer is recorded with both sides named', async () => {
  ownership._reset();
  const { owners, hooks } = fixture();
  await ownership.scan(hooks);

  owners[1581][0] = copy(7001, 1, 1, 'Nun', MINT, '2026-08-21T00:00:00Z');
  await ownership.scan(hooks);

  const newest = ownership.itemHistory(1581)[0];
  assert.strictEqual(newest.kind, 'transfer');
  assert.strictEqual(newest.from, 2);
  assert.strictEqual(newest.fromName, 'luke');
  assert.strictEqual(newest.to, 1);
  assert.strictEqual(newest.toName, 'Nun');
});

test('the same transfer is never recorded twice', async () => {
  ownership._reset();
  const { owners, hooks } = fixture();
  await ownership.scan(hooks);
  owners[1581][0] = copy(7001, 1, 1, 'Nun', MINT, '2026-08-21T00:00:00Z');
  await ownership.scan(hooks);

  const after = ownership.itemHistory(1581).length;
  await ownership.scan(hooks);
  await ownership.scan(hooks);
  assert.strictEqual(ownership.itemHistory(1581).length, after, 'rescanning duplicated history');
});

test('the record of what happened before we watched is never rewritten', async () => {
  ownership._reset();
  const { owners, hooks } = fixture();
  await ownership.scan(hooks);
  owners[1581][0] = copy(7001, 1, 1, 'Nun', MINT, '2026-08-21T00:00:00Z');
  await ownership.scan(hooks);

  const first = ownership._data().copies['7001'];
  assert.strictEqual(first.created, Date.parse(MINT));
  assert.strictEqual(first.firstOwner, 2, 'the player we first saw holding it');
});

test('an upstream failure is skipped, never read as "nobody owns this"', async () => {
  ownership._reset();
  const { hooks } = fixture();
  await ownership.scan(hooks);
  const before = ownership.itemHistory(1581).length;

  await ownership.scan({
    listItems: hooks.listItems,
    readOwners: async () => { throw new Error('502 from Cloudflare'); },
  });
  assert.strictEqual(ownership.itemHistory(1581).length, before,
    'a failed read invented transfers');

  await ownership.scan({ listItems: hooks.listItems, readOwners: async () => [] });
  assert.strictEqual(ownership.itemHistory(1581).length, before,
    'an empty read invented transfers');
});

test('a player sees what they gained and what they lost, correctly labelled', async () => {
  ownership._reset();
  const { owners, hooks } = fixture();
  await ownership.scan(hooks);
  owners[1581][0] = copy(7001, 1, 1, 'Nun', MINT, '2026-08-21T00:00:00Z');
  await ownership.scan(hooks);

  const luke = ownership.playerHistory(2);
  assert.ok(luke.some(e => e.direction === 'gained'), 'luke acquired it before we watched');
  assert.ok(luke.some(e => e.direction === 'lost'), 'and lost it to Nun');

  const nun = ownership.playerHistory(1);
  assert.ok(nun.every(e => e.direction === 'gained'));
  assert.ok(nun.some(e => e.kind === 'transfer' && e.from === 2));
});

test('nobody is credited with a copy they never held', async () => {
  ownership._reset();
  await ownership.scan(fixture().hooks);
  assert.strictEqual(ownership.playerHistory(1).length, 0);
  assert.strictEqual(ownership.playerHistory(9999).length, 0);
});

test('two scans cannot run over the top of each other', async () => {
  ownership._reset();
  const { hooks } = fixture();
  let running = 0;
  let overlapped = false;
  const slow = {
    listItems: hooks.listItems,
    readOwners: async id => {
      running += 1;
      if (running > 1) overlapped = true;
      await new Promise(resolve => setTimeout(resolve, 10));
      running -= 1;
      return hooks.readOwners(id);
    },
  };
  await Promise.all([ownership.scan(slow), ownership.scan(slow), ownership.scan(slow)]);
  assert.strictEqual(overlapped, false);
});

test('history is filtered to the item asked about', async () => {
  ownership._reset();
  const owners = {
    1581: [copy(7001, 1, 2, 'luke', MINT, MINT)],
    1582: [copy(8001, 5, 3, 'x_x', MINT, MINT)],
  };
  await ownership.scan({
    listItems: async () => [1581, 1582],
    readOwners: async id => owners[id] || [],
  });
  assert.ok(ownership.itemHistory(1581).every(e => e.assetId === 1581));
  assert.ok(ownership.itemHistory(1582).every(e => e.assetId === 1582));
});

test('the tracker never reaches for the network itself', () => {
  const source = require('fs').readFileSync(require.resolve('../proxy/ownership.js'), 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/fetch\(|require\('https?'\)|axios/.test(code),
    'ownership.js must be handed its data, so it can be tested without a network');
});
