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
 * HOW IT REACHES BACK BEFORE IT WAS SWITCHED ON
 * ---------------------------------------------------------------------------
 * The owners endpoint carries two timestamps per copy: `created`, when that
 * copy was minted, and `updated`, when it last changed hands. Those are real
 * dates from Wanwood, so the first time a copy is seen the log can be seeded
 * with them - the mint, and the move that put it where it is now. That is why
 * an item's history starts at the day the item was made rather than the day
 * this started running.
 *
 * What cannot be recovered is the middle: if a copy was traded five times
 * before we ever looked, Wanwood only remembers the last one, and the players
 * on the far side of those trades are gone for good. Those entries say
 * "someone" rather than inventing a name, and everything observed live
 * afterwards names both sides.
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
  /*
   * uaid -> { assetId, serial, created, updated, firstOwner }
   *
   * created/updated/firstOwner are captured the first time a copy is seen and
   * never touched again: they are the record of what Wanwood knew about it
   * before we were watching, and live events take over from there.
   */
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
        const known = Object.prototype.hasOwnProperty.call(data.owners, key);
        const from = Number(data.owners[key]) || 0;
        const serial = Number.isFinite(Number(row.serialNumber)) ? Number(row.serialNumber) : null;

        if (!known) {
          /*
           * First sighting. Not a transfer - but Wanwood's own timestamps say
           * when this copy was minted and when it last moved, so the history
           * before we were watching is written down from those rather than
           * lost. Recorded once and never revised.
           */
          data.copies[key] = {
            assetId,
            serial,
            created: Date.parse(row.created) || 0,
            updated: Date.parse(row.updated) || 0,
            firstOwner: to,
          };
          data.owners[key] = to;
          return;
        }

        /* Keep the item and serial fresh without disturbing the history. */
        if (data.copies[key]) data.copies[key].serial = serial;
        else data.copies[key] = { assetId, serial, created: 0, updated: 0, firstOwner: to };

        if (from === to) return;
        data.owners[key] = to;
        if (!from) return;

        fresh.push({
          at,
          uaid,
          assetId,
          serial,
          from,
          fromName: String(data.names?.[String(from)] || ''),
          to,
          toName: String(row.name || ''),
          observed: true,
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
    /* The oldest thing the log can speak about: the earliest mint date it has
     * seen. Pages show this rather than the day tracking was switched on,
     * because the seeded entries genuinely reach back that far. */
    reachesBackTo: Object.values(data.copies)
      .map(copy => Number(copy && copy.created) || 0)
      .filter(Boolean)
      .reduce((oldest, at) => (oldest === 0 || at < oldest ? at : oldest), 0),
  };
}

/*
 * The entries Wanwood's own timestamps give us for one copy: when it was
 * minted, and - if it has moved since - when it last changed hands before we
 * started watching. The player it came from is genuinely unknown, so it is
 * left at 0 and the pages print "someone" rather than guessing.
 */
function seededFor(uaid, copy) {
  const out = [];
  if (!copy) return out;
  const uid = Number(uaid);
  const moved = copy.updated && copy.created && copy.updated > copy.created + 60000;

  if (copy.created) {
    out.push({
      at: copy.created,
      uaid: uid,
      assetId: copy.assetId,
      serial: copy.serial,
      from: 0,
      fromName: '',
      /* If it never moved, whoever holds it now has held it from the start. */
      to: moved ? 0 : copy.firstOwner,
      toName: '',
      kind: 'minted',
    });
  }
  if (moved) {
    out.push({
      at: copy.updated,
      uaid: uid,
      assetId: copy.assetId,
      serial: copy.serial,
      from: 0,
      fromName: '',
      to: copy.firstOwner,
      toName: '',
      kind: 'moved',
    });
  }
  return out;
}

const byNewest = (a, b) => b.at - a.at;

/*
 * Everything that happened to one item's copies, newest first - the transfers
 * seen live, plus the mint and last-move dates Wanwood remembers for every
 * copy, so the list runs back to the day the item was made.
 */
function itemHistory(assetId, { limit = 100 } = {}) {
  load();
  const id = Number(assetId);
  const cap = Math.min(Math.max(Number(limit) || 100, 1), 500);

  const seeded = [];
  for (const [uaid, copy] of Object.entries(data.copies)) {
    if (!copy || copy.assetId !== id) continue;
    seeded.push(...seededFor(uaid, copy));
  }

  return [
    ...data.events.filter(event => event.assetId === id).map(e => ({ ...e, kind: e.kind || 'transfer' })),
    ...seeded,
  ].sort(byNewest).slice(0, cap);
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

  /* Copies this player already held when we first looked: the date they got
   * them is real, even though who they got them from is not recoverable. */
  const seeded = [];
  for (const [uaid, copy] of Object.entries(data.copies)) {
    if (!copy || copy.firstOwner !== id) continue;
    seededFor(uaid, copy)
      .filter(entry => entry.to === id)
      .forEach(entry => seeded.push(entry));
  }

  return [
    ...data.events
      .filter(event => event.to === id || event.from === id)
      .map(e => ({ ...e, kind: e.kind || 'transfer' })),
    ...seeded,
  ]
    .sort(byNewest)
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
