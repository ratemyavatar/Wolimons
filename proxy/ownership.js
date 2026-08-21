/*
 * Wolimons - ownership tracking
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS FOR
 * ---------------------------------------------------------------------------
 * Wanwood will tell you who owns a copy right now. It will not tell you who
 * owned it last week, and it has no endpoint that answers "what has this
 * player gained and lost". Neither question can be answered by asking harder -
 * the only way to know is to have been watching.
 *
 * So this watches. Every so often it walks the tracked catalogue, reads the
 * owner of every copy, and compares that against what it saw last time. A copy
 * whose owner changed is a transfer, and a transfer is written down. Two
 * different pages read the same log from opposite ends:
 *
 *   /item    - everything that ever happened to this item's copies
 *   /player  - everything this player has gained and lost
 *
 * ---------------------------------------------------------------------------
 * WHERE IT LIVES, AND WHY NOT WITH THE REST
 * ---------------------------------------------------------------------------
 * This is the only data on the site that grows on its own. The values file is
 * small, hand-edited and synced to GitHub; dropping tens of thousands of
 * ownership rows into it would make every value save push a huge diff, and
 * eventually make the file unusable. So it is kept in its own file, written
 * locally, and never synced anywhere.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT WILL NOT DO
 * ---------------------------------------------------------------------------
 * It cannot backfill. The log starts empty on the first run and only knows
 * what has happened since - the first scan is a baseline and records nothing,
 * because a copy being seen for the first time is not a transfer. Every page
 * that shows this says so, rather than presenting a short log as though it
 * were the whole history.
 */
'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const FILE = path.resolve(
  process.env.OWNERSHIP_FILE || path.join(__dirname, 'data', 'ownership.json'),
);

/* How often to walk the catalogue. Every copy of every limited is a lot of
 * requests, so this is deliberately not frequent. */
const SCAN_INTERVAL_MS = Number(process.env.OWNERSHIP_SCAN_MS || 30 * 60 * 1000);

/* The log is capped so the file cannot grow without limit. Oldest go first. */
const MAX_EVENTS = Number(process.env.OWNERSHIP_MAX_EVENTS || 20000);

/* A single scan will not read more items than this, so one pass cannot turn
 * into thousands of upstream requests. */
const MAX_ITEMS_PER_SCAN = Number(process.env.OWNERSHIP_MAX_ITEMS || 60);

const EMPTY = {
  version: 1,
  startedAt: 0,
  lastScanAt: 0,
  scans: 0,
  /* uaid -> the user id that held it when we last looked. */
  owners: {},
  /* uaid -> { assetId, serial } so an event can name the item without a
   * second lookup. */
  copies: {},
  /* Newest first: { at, uaid, assetId, serial, from, fromName, to, toName } */
  events: [],
};

let data = structuredClone(EMPTY);
let loaded = false;
let writing = null;
let timer = null;
let scanning = false;

function load() {
  if (loaded) return data;
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    data = {
      ...structuredClone(EMPTY),
      ...raw,
      owners: raw.owners && typeof raw.owners === 'object' ? raw.owners : {},
      copies: raw.copies && typeof raw.copies === 'object' ? raw.copies : {},
      events: Array.isArray(raw.events) ? raw.events : [],
    };
  } catch (error) {
    data = structuredClone(EMPTY);
  }
  loaded = true;
  return data;
}

/* Writes are serialised: a scan can finish while the last save is still in
 * flight, and two concurrent writers would interleave into broken JSON. */
async function save() {
  const run = async () => {
    await fsp.mkdir(path.dirname(FILE), { recursive: true });
    const temporary = `${FILE}.tmp`;
    await fsp.writeFile(temporary, JSON.stringify(data));
    await fsp.rename(temporary, FILE);
  };
  writing = (writing || Promise.resolve()).then(run, run);
  return writing;
}

/* ---------------------------------------------------------------------- */
/* Scanning                                                                */
/* ---------------------------------------------------------------------- */

/*
 * One pass over the catalogue.
 *
 * `listItems` returns the asset ids worth watching; `readOwners` returns
 * [{ userAssetId, serialNumber, userId, name }] for one of them. Both are
 * passed in rather than imported so this file never has to know how the
 * upstream is reached, and so a test can drive it without a network.
 */
async function scan({ listItems, readOwners }) {
  if (scanning) return { skipped: true };
  scanning = true;
  load();

  try {
    const ids = (await listItems()).slice(0, MAX_ITEMS_PER_SCAN);
    if (!ids.length) return { skipped: true };

    const first = data.scans === 0;
    const at = Date.now();
    const fresh = [];

    for (const assetId of ids) {
      const owners = await readOwners(assetId).catch(() => null);
      /* A failed read is not "nobody owns this any more" - skipping it keeps
       * one upstream hiccup from inventing a transfer for every copy. */
      if (!Array.isArray(owners) || !owners.length) continue;

      owners.forEach(row => {
        const uaid = Number(row.userAssetId);
        const to = Number(row.userId) || 0;
        if (!Number.isSafeInteger(uaid) || uaid <= 0 || !to) return;

        const key = String(uaid);
        const from = Number(data.owners[key]) || 0;

        data.copies[key] = {
          assetId,
          serial: Number.isFinite(Number(row.serialNumber)) ? Number(row.serialNumber) : null,
        };

        if (from === to) return;
        data.owners[key] = to;

        /* The very first sighting of a copy is not a transfer, and neither is
         * anything at all on the baseline pass. */
        if (first || !from) return;

        fresh.push({
          at,
          uaid,
          assetId,
          serial: data.copies[key].serial,
          from,
          fromName: String(data.names?.[String(from)] || ''),
          to,
          toName: String(row.name || ''),
        });
      });

      /* Remember display names as we see them, so an event can name the
       * player it took the copy from next time round. */
      if (!data.names) data.names = {};
      owners.forEach(row => {
        const id = Number(row.userId) || 0;
        if (id && row.name) data.names[String(id)] = String(row.name);
      });
    }

    if (fresh.length) {
      data.events = [...fresh.reverse(), ...data.events].slice(0, MAX_EVENTS);
    }
    data.lastScanAt = at;
    data.scans += 1;
    if (!data.startedAt) data.startedAt = at;

    await save();
    return { baseline: first, recorded: fresh.length, items: ids.length };
  } finally {
    scanning = false;
  }
}

/* Kick off a scan now and then every interval after that. */
function start(hooks) {
  if (timer) return;
  const run = () => scan(hooks).catch(() => {});
  /* Not immediately - let the server finish coming up first. */
  setTimeout(run, 15000).unref?.();
  timer = setInterval(run, SCAN_INTERVAL_MS);
  timer.unref?.();
}

/* ---------------------------------------------------------------------- */
/* Reading                                                                 */
/* ---------------------------------------------------------------------- */

function status() {
  load();
  return {
    tracking: data.scans > 0,
    startedAt: data.startedAt,
    lastScanAt: data.lastScanAt,
    scans: data.scans,
    copies: Object.keys(data.owners).length,
    events: data.events.length,
  };
}

/* Everything that happened to one item's copies, newest first. */
function itemHistory(assetId, { limit = 100 } = {}) {
  load();
  const id = Number(assetId);
  const cap = Math.min(Math.max(Number(limit) || 100, 1), 500);
  return data.events.filter(event => event.assetId === id).slice(0, cap);
}

/*
 * Everything one player gained and lost, newest first.
 *
 * `direction` says which side of the transfer they were on, which is what
 * turns one log into "gained" and "lost" lists on a profile.
 */
function playerHistory(userId, { limit = 100 } = {}) {
  load();
  const id = Number(userId);
  const cap = Math.min(Math.max(Number(limit) || 100, 1), 500);
  return data.events
    .filter(event => event.to === id || event.from === id)
    .slice(0, cap)
    .map(event => ({ ...event, direction: event.to === id ? 'gained' : 'lost' }));
}

/* Who holds a copy right now, as far as the last scan knows. */
function ownerOf(uaid) {
  load();
  return Number(data.owners[String(uaid)]) || 0;
}

module.exports = {
  FILE,
  SCAN_INTERVAL_MS,
  scan,
  start,
  status,
  itemHistory,
  playerHistory,
  ownerOf,
  /* For tests. */
  _reset() { data = structuredClone(EMPTY); loaded = true; },
  _data() { load(); return data; },
};
