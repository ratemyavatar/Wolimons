/*
 * Wolimons - player value and RAP snapshots.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS HAS TO EXIST
 * ---------------------------------------------------------------------------
 * The profile chart used to be reconstructed from each item's priceDataPoints.
 * That cannot work, for three separate reasons, and all three were making the
 * line wrong at once:
 *
 *   1. Wanwood mostly has no history. Ask resale-data for a typical item and
 *      priceDataPoints comes back as an empty array. There is nothing to plot.
 *   2. Where points do exist they are individual sale prices, not RAP. Summing
 *      them gives a number that is not the figure the profile prints.
 *   3. It can only see what a player holds now. A limited they owned last
 *      month and have since traded away leaves no trace at all - which is
 *      exactly why a peak of 1000 could vanish from the chart of somebody who
 *      remembers having it.
 *
 * No amount of arithmetic fixes a missing record. So the record is kept here:
 * one row per player per day, holding the totals the profile actually shows.
 * From the first time a profile is opened, its history is exact.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT DOES NOT DO
 * ---------------------------------------------------------------------------
 * It cannot fill in the past. Nothing recorded yesterday's RAP, so yesterday's
 * RAP is gone, and the chart says so rather than drawing a guess.
 *
 * The figures are computed here, from Wanwood's inventory endpoint and this
 * site's own value table - never taken from the browser. A number a visitor
 * could post is a number a visitor could invent, and this is meant to be the
 * trustworthy copy.
 */
'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const FILE = path.resolve(
  process.env.PLAYERSTATS_FILE || path.join(__dirname, 'data', 'playerstats.json'),
);

const DAY_MS = 24 * 60 * 60 * 1000;

/* Roughly a year per player. Long enough for any chart, short enough that the
 * file stays small however many profiles get looked at. */
const MAX_POINTS = Number(process.env.PLAYERSTATS_MAX_POINTS || 400);

/* A player looked up twice in a day is not measured twice. */
const MIN_GAP_MS = Number(process.env.PLAYERSTATS_MIN_GAP_MS || DAY_MS);

const EMPTY = { version: 1, players: {} };

let data = structuredClone(EMPTY);
let loaded = false;
let writing = null;

function load() {
  if (loaded) return data;
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    data = {
      version: 1,
      players: raw && typeof raw.players === 'object' ? raw.players : {},
    };
  } catch (error) {
    data = structuredClone(EMPTY);
  }
  loaded = true;
  return data;
}

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

/* Everything recorded for one player, oldest first. */
function history(userId) {
  load();
  const rows = data.players[String(Number(userId) || 0)];
  return Array.isArray(rows) ? rows.map(row => ({ ...row })) : [];
}

/*
 * Work out what a player is worth right now.
 *
 * `rows` is Wanwood's collectibles list: one row per copy, each carrying the
 * asset's recentAveragePrice. That is the same figure the inventory's own
 * totalRap adds up, and it is the one the profile prints - so the chart and
 * the page can never disagree about today.
 *
 * `valueOf` is this site's curated value for an asset id.
 */
function totalsFrom(rows, valueOf) {
  let rap = 0;
  let value = 0;
  let copies = 0;

  (Array.isArray(rows) ? rows : []).forEach(row => {
    /* Wanwood has been known to put a null in a data array; one of those must
     * not take the whole reading down. */
    if (!row || typeof row !== 'object') return;
    const assetId = Number(row.assetId ?? row.id);
    if (!Number.isSafeInteger(assetId) || assetId <= 0) return;
    copies += 1;
    rap += Number(row.recentAveragePrice) || 0;
    value += Number(valueOf(assetId)) || 0;
  });

  return { rap, value, copies };
}

/*
 * Record today's figures for a player, unless today is already recorded.
 *
 * Returns the whole history including today, so a caller reads and writes in
 * one round trip.
 */
async function record(userId, totals) {
  const id = Number(userId);
  if (!Number.isSafeInteger(id) || id <= 0) return [];
  load();

  const key = String(id);
  const rows = Array.isArray(data.players[key]) ? data.players[key] : [];
  const last = rows[rows.length - 1];
  const now = Date.now();

  /* Same day: keep the newest reading rather than adding a second point, so a
   * profile refreshed ten times leaves one row and the latest numbers. */
  if (last && now - last.at < MIN_GAP_MS) {
    if (last.rap === totals.rap && last.value === totals.value && last.copies === totals.copies) {
      return rows.map(row => ({ ...row }));
    }
    rows[rows.length - 1] = { at: last.at, ...totals };
  } else {
    rows.push({ at: now, ...totals });
  }

  data.players[key] = rows.slice(-MAX_POINTS);
  await save();
  return data.players[key].map(row => ({ ...row }));
}

function status() {
  load();
  const players = Object.keys(data.players).length;
  const points = Object.values(data.players).reduce((sum, rows) => sum + rows.length, 0);
  return { players, points };
}

module.exports = {
  FILE,
  DAY_MS,
  history,
  record,
  totalsFrom,
  status,
  /* For tests. */
  _reset() { data = structuredClone(EMPTY); loaded = true; },
  _data() { load(); return data; },
};
