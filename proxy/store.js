'use strict';

/*
 * Wolimons data store.
 *
 * Holds the three things Wanwood does not know about and never will: the item
 * values (value / demand / trend / categories, all assigned by hand), the
 * staff roles (who is allowed to assign them), and the log of every value
 * change ever made, which is what /valuechanges reads.
 *
 * ---------------------------------------------------------------------------
 * WHERE IT IS KEPT
 * ---------------------------------------------------------------------------
 * In data/wolimons-data.json in the GitHub repo, written through the GitHub
 * contents API. Render's free tier throws away the container's disk on every
 * restart and every deploy, so a file on disk would quietly lose every value
 * ever set. A commit does not: it survives restarts, it is versioned, and the
 * history says who changed what and when.
 *
 * The whole file is read once at boot and kept in memory. Reads are served
 * from memory; a write updates memory first, then commits. If the commit
 * fails the write is rolled back and the caller is told, so the site never
 * shows a value that was not actually saved.
 *
 * ---------------------------------------------------------------------------
 * CONFIGURATION
 * ---------------------------------------------------------------------------
 *   GITHUB_TOKEN   a token with contents:write on the repo. Without it the
 *                  store still reads (over the public raw URL) but every
 *                  write is refused with a clear message rather than being
 *                  silently dropped.
 *   GITHUB_REPO    "owner/name". Defaults to this repo.
 *   GITHUB_BRANCH  branch to commit to. Defaults to main.
 *   DATA_PATH      path within the repo. Defaults to data/wolimons-data.json.
 */

const fs = require('fs');
const path = require('path');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const GITHUB_REPO = process.env.GITHUB_REPO || 'ratemyavatar/Wolimons';
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';
const DATA_PATH = process.env.DATA_PATH || 'data/wolimons-data.json';

/* Overridable so the write path can be pointed at a stand-in server in tests. */
const GITHUB_API = process.env.GITHUB_API_ROOT
  || `https://api.github.com/repos/${GITHUB_REPO}/contents/${DATA_PATH}`;
const API_ROOT = GITHUB_API;

/* The vocabularies. Anything outside them is dropped rather than stored, so a
 * typo can never reach the site as a filter value nobody can select. */
const DEMANDS = ['High', 'Decent', 'Low', 'Terrible'];
const TRENDS = ['Raising', 'Stable', 'Lowering', 'Unstable', 'Fluctuating'];
const CATEGORIES = ['rare', 'projected', 'tablet', 'unobtainable', 'hoarded'];
const ROLES = ['owner', 'value_manager', 'staff'];

/* The fields whose edits are worth telling the site about. Categories are
 * deliberately excluded: they are internal bookkeeping rather than news. */
const CHANGE_FIELDS = ['value', 'demand', 'trend'];

/* How many past changes to keep. The log lives in the same JSON file that is
 * committed on every write, so it cannot grow without bound - a few thousand
 * entries is a deep history for a site this size and still a small file. The
 * oldest fall off the end. */
const CHANGE_LIMIT = Number(process.env.CHANGE_LIMIT || 2000);

const EMPTY = { version: 1, updatedAt: 0, roles: {}, values: {}, changes: [] };

let data = structuredClone(EMPTY);
let sha = null;          /* blob sha of the file as we last saw it */
let loaded = false;
let loading = null;

/*
 * Whether the copy in memory is the real one from GitHub.
 *
 * If GitHub could not be reached at boot we still serve - the site shows the
 * checked-in file, or nothing - but we must never commit on top of that,
 * because committing a fallback would erase every value the real file holds.
 * Writes are refused until a load has actually succeeded.
 */
let authoritative = false;

/* The copy committed alongside the code. Used when GitHub is unreachable and
 * when running the site locally with no token, so the panel and the catalog
 * have something real to show. */
function readLocal() {
  try {
    const local = path.join(__dirname, '..', DATA_PATH);
    return JSON.parse(fs.readFileSync(local, 'utf8'));
  } catch (error) {
    return null;
  }
}

const key = name => String(name || '').trim().toLowerCase();

function githubHeaders(extra) {
  return {
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'wolimons-api',
    ...(GITHUB_TOKEN ? { Authorization: `Bearer ${GITHUB_TOKEN}` } : {}),
    ...extra,
  };
}

function normalize(raw) {
  const out = structuredClone(EMPTY);
  if (!raw || typeof raw !== 'object') return out;

  out.version = Number(raw.version) || 1;
  out.updatedAt = Number(raw.updatedAt) || 0;

  if (raw.roles && typeof raw.roles === 'object') {
    for (const [name, entry] of Object.entries(raw.roles)) {
      if (!entry || typeof entry !== 'object') continue;
      if (!ROLES.includes(entry.role)) continue;
      out.roles[key(name)] = {
        name: String(entry.name || name),
        role: entry.role,
        grantedBy: String(entry.grantedBy || ''),
        grantedAt: Number(entry.grantedAt) || 0,
      };
    }
  }

  if (raw.values && typeof raw.values === 'object') {
    for (const [id, entry] of Object.entries(raw.values)) {
      const assetId = Number(id);
      if (!Number.isSafeInteger(assetId) || assetId <= 0) continue;
      if (!entry || typeof entry !== 'object') continue;
      out.values[String(assetId)] = {
        value: Number(entry.value) > 0 ? Math.round(Number(entry.value)) : 0,
        demand: DEMANDS.includes(entry.demand) ? entry.demand : null,
        trend: TRENDS.includes(entry.trend) ? entry.trend : null,
        categories: Array.isArray(entry.categories)
          ? [...new Set(entry.categories.filter(name => CATEGORIES.includes(name)))]
          : [],
        updatedBy: String(entry.updatedBy || ''),
        updatedAt: Number(entry.updatedAt) || 0,
      };
    }
  }

  if (Array.isArray(raw.changes)) {
    out.changes = raw.changes
      .map(entry => {
        if (!entry || typeof entry !== 'object') return null;
        const assetId = Number(entry.id);
        if (!Number.isSafeInteger(assetId) || assetId <= 0) return null;
        if (!CHANGE_FIELDS.includes(entry.field)) return null;
        const at = Number(entry.at) || 0;
        if (!at) return null;
        return {
          id: assetId,
          field: entry.field,
          /* old/new are stored as-is: a number for value, a string for demand
           * and trend, null for "was not set". Their meaning depends on the
           * field, and the page renders each field in its own way. */
          old: entry.old === undefined ? null : entry.old,
          new: entry.new === undefined ? null : entry.new,
          by: String(entry.by || ''),
          at,
        };
      })
      .filter(Boolean)
      /* Newest first, which is the order /valuechanges wants and the order
       * the trim below assumes. */
      .sort((a, b) => b.at - a.at)
      .slice(0, CHANGE_LIMIT);
  }

  return out;
}

/*
 * Load once. The authenticated contents API is preferred because it hands
 * back the blob sha, which the next write needs; without a token we fall back
 * to the public raw file, and the first write will fetch the sha itself.
 */
async function load() {
  if (loaded) return data;
  if (loading) return loading;

  loading = (async () => {
    try {
      if (GITHUB_TOKEN) {
        const response = await fetch(`${API_ROOT}?ref=${encodeURIComponent(GITHUB_BRANCH)}`, {
          headers: githubHeaders(),
        });
        if (response.ok) {
          const payload = await response.json();
          sha = payload.sha || null;
          const text = Buffer.from(payload.content || '', 'base64').toString('utf8');
          data = normalize(JSON.parse(text));
          authoritative = true;
        } else if (response.status === 404) {
          /* No file yet - the first write creates it. */
          data = normalize(readLocal());
          authoritative = true;
        } else {
          throw new Error(`GitHub read failed (${response.status})`);
        }
      } else {
        const raw = `https://raw.githubusercontent.com/${GITHUB_REPO}/`
          + `${GITHUB_BRANCH}/${DATA_PATH}`;
        const response = await fetch(raw, { headers: { 'User-Agent': 'wolimons-api' } });
        if (response.ok) {
          data = normalize(await response.json());
        } else {
          data = normalize(readLocal());
        }
        /* Read-only without a token anyway, so there is nothing to protect. */
        authoritative = true;
      }
      loaded = true;
    } catch (error) {
      /* Serve the checked-in copy rather than refuse to boot. Writes stay
       * blocked until a real load succeeds - see `authoritative`. */
      console.error('[store] load failed, using the checked-in copy:', error.message);
      data = normalize(readLocal());
      authoritative = false;
      loaded = true;
    } finally {
      loading = null;
    }
    return data;
  })();

  return loading;
}

/* Read the current sha straight from GitHub. Needed when another commit has
 * landed since we loaded, which makes our cached sha stale. */
async function refreshSha() {
  const response = await fetch(`${API_ROOT}?ref=${encodeURIComponent(GITHUB_BRANCH)}`, {
    headers: githubHeaders(),
  });
  if (response.status === 404) {
    sha = null;
    return;
  }
  if (!response.ok) throw new Error(`GitHub read failed (${response.status})`);
  const payload = await response.json();
  sha = payload.sha || null;
}

/* One commit at a time, so two admins saving at once cannot race each other
 * into a 409 loop. */
let writeChain = Promise.resolve();

function commit(message) {
  const run = async () => {
    if (!GITHUB_TOKEN) {
      throw new Error('The server has no GitHub token, so nothing can be saved.');
    }
    if (!authoritative) {
      /* We never saw the real file, so committing now would overwrite it with
       * whatever we happen to be holding. Refuse and say why. */
      throw new Error('The saved data could not be read from GitHub, so saving is '
        + 'blocked to avoid overwriting it. Try again shortly.');
    }

    const body = () => JSON.stringify({
      message,
      content: Buffer.from(`${JSON.stringify(data, null, 2)}\n`, 'utf8').toString('base64'),
      branch: GITHUB_BRANCH,
      ...(sha ? { sha } : {}),
    });

    let response = await fetch(API_ROOT, {
      method: 'PUT',
      headers: githubHeaders({ 'Content-Type': 'application/json' }),
      body: body(),
    });

    /* 409/422 means our sha is behind. Re-read it and try once more. */
    if (response.status === 409 || response.status === 422) {
      await refreshSha();
      response = await fetch(API_ROOT, {
        method: 'PUT',
        headers: githubHeaders({ 'Content-Type': 'application/json' }),
        body: body(),
      });
    }

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`GitHub write failed (${response.status}): ${detail.slice(0, 200)}`);
    }

    const payload = await response.json();
    sha = payload.content?.sha || null;
  };

  writeChain = writeChain.then(run, run);
  return writeChain;
}

/* Every mutation goes through here: change memory, commit, and put memory
 * back the way it was if the commit did not land. */
async function mutate(message, apply) {
  await load();
  const before = structuredClone(data);
  apply(data);
  data.updatedAt = Date.now();
  try {
    await commit(message);
  } catch (error) {
    data = before;
    throw error;
  }
  return data;
}

async function snapshot() {
  await load();
  return structuredClone(data);
}

async function roleOf(name) {
  await load();
  return data.roles[key(name)]?.role || null;
}

async function setRole({ name, role, grantedBy }) {
  const clean = String(name || '').trim();
  if (!clean) throw new Error('A username is required.');
  if (role !== 'none' && !ROLES.includes(role)) throw new Error('Unknown role.');

  return mutate(
    role === 'none'
      ? `Remove ${clean}'s Wolimons role`
      : `Set ${clean} to ${role} on Wolimons`,
    current => {
      if (role === 'none') {
        delete current.roles[key(clean)];
        return;
      }
      current.roles[key(clean)] = {
        name: clean,
        role,
        grantedBy: String(grantedBy || ''),
        grantedAt: Date.now(),
      };
    },
  );
}

async function setValue({ id, value, demand, trend, categories, rare, updatedBy }) {
  const assetId = Number(id);
  if (!Number.isSafeInteger(assetId) || assetId <= 0) throw new Error('A valid item id is required.');

  await load();
  const existing = data.values[String(assetId)];

  /* Everything is optional: a request may set only the value, or only flip
   * the rare flag, and must leave the rest of the row alone. */
  const next = {
    value: existing?.value ?? 0,
    demand: existing?.demand ?? null,
    trend: existing?.trend ?? null,
    categories: existing?.categories ? [...existing.categories] : [],
    updatedBy: String(updatedBy || ''),
    updatedAt: Date.now(),
  };

  if (value !== undefined && value !== null && value !== '') {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) throw new Error('Value must be zero or more.');
    next.value = Math.round(number);
  }
  if (demand !== undefined) {
    next.demand = DEMANDS.includes(demand) ? demand : null;
  }
  if (trend !== undefined) {
    next.trend = TRENDS.includes(trend) ? trend : null;
  }
  if (Array.isArray(categories)) {
    next.categories = [...new Set(categories.filter(name => CATEGORIES.includes(name)))];
  }
  /* The rare flag is just the "rare" category, so the item page's existing
   * gem lights up with no extra plumbing. */
  if (rare === true && !next.categories.includes('rare')) next.categories.push('rare');
  if (rare === false) next.categories = next.categories.filter(name => name !== 'rare');

  /*
   * What actually changed, for /valuechanges.
   *
   * Only a real difference is logged - saving a row without touching the
   * value must not put "Value Changed: 500 -> 500" on the front of the feed.
   * A brand new row counts as a change from nothing, which is how a first
   * valuation shows up.
   */
  const at = Date.now();
  const entries = [];
  CHANGE_FIELDS.forEach(field => {
    const before = existing ? existing[field] ?? null : null;
    const after = next[field] ?? null;
    /* Value starts at 0 rather than null, so an untouched new row would
     * otherwise log a spurious 0 -> 0. */
    if (before === after) return;
    if (field === 'value' && !before && !after) return;
    entries.push({ id: assetId, field, old: before, new: after, by: next.updatedBy, at });
  });

  return mutate(`Update Wolimons values for item ${assetId}`, current => {
    current.values[String(assetId)] = next;
    /* Newest first, oldest off the end. */
    if (entries.length) {
      current.changes = [...entries, ...(current.changes || [])].slice(0, CHANGE_LIMIT);
    }
  });
}

/*
 * The change log, newest first.
 *
 * `since` filters to entries newer than a timestamp, so a page that is
 * already showing the feed can ask for just what it is missing.
 */
async function changes({ limit = 200, since = 0 } = {}) {
  await load();
  const cap = Math.min(Math.max(Number(limit) || 0, 1), CHANGE_LIMIT);
  const after = Number(since) || 0;
  return (data.changes || [])
    .filter(entry => entry.at > after)
    .slice(0, cap)
    .map(entry => ({ ...entry }));
}

module.exports = {
  DEMANDS,
  TRENDS,
  CATEGORIES,
  ROLES,
  load,
  snapshot,
  roleOf,
  setRole,
  setValue,
  changes,
  CHANGE_FIELDS,
  CHANGE_LIMIT,
  config: { repo: GITHUB_REPO, branch: GITHUB_BRANCH, path: DATA_PATH, canWrite: Boolean(GITHUB_TOKEN) },
};
