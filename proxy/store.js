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
 * WHERE IT IS KEPT - TWO BACKENDS
 * ---------------------------------------------------------------------------
 * "file"    a JSON file on disk. This is the obvious way to store data and
 *           the right one whenever the disk survives a restart: your own VPS,
 *           a home server, a phone. No token, no network, no rate limit, and
 *           a save is instant.
 *
 * "github"  data/wolimons-data.json committed through the GitHub contents
 *           API. This exists for hosts that throw the disk away - Render's
 *           free tier wipes the container on every restart and deploy, so a
 *           file there would quietly lose every value ever set. A commit
 *           survives, is versioned, and records who changed what.
 *
 * Which one is used is decided by STORAGE (see below). Everything above the
 * backend is identical either way: the whole thing is read once at boot and
 * kept in memory, reads are served from memory, and a write updates memory
 * first then persists. If persisting fails the write is rolled back and the
 * caller is told, so the site never shows a value that was not saved.
 *
 * ---------------------------------------------------------------------------
 * CONFIGURATION
 * ---------------------------------------------------------------------------
 *   STORAGE        "file", "github", or "auto" (the default). Auto picks
 *                  github when GITHUB_TOKEN is set, and file otherwise.
 *
 *   file backend:
 *   DATA_FILE      where to keep it. Defaults to proxy/data/wolimons-data.json,
 *                  which is gitignored. On first run it is seeded from the
 *                  copy committed at data/wolimons-data.json, so the roles
 *                  and values already in the repo carry over.
 *
 *   github backend:
 *   GITHUB_TOKEN   a token with contents:write on the repo. Without it the
 *                  store still reads (over the public raw URL) but every
 *                  write is refused with a clear message rather than being
 *                  silently dropped.
 *   GITHUB_REPO    "owner/name". Defaults to this repo.
 *   GITHUB_BRANCH  branch to commit to. Defaults to main.
 *   DATA_PATH      path within the repo. Defaults to data/wolimons-data.json.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const GITHUB_REPO = process.env.GITHUB_REPO || 'ratemyavatar/Wolimons';
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';
const DATA_PATH = process.env.DATA_PATH || 'data/wolimons-data.json';

/* Overridable so the write path can be pointed at a stand-in server in tests. */
const GITHUB_API = process.env.GITHUB_API_ROOT
  || `https://api.github.com/repos/${GITHUB_REPO}/contents/${DATA_PATH}`;
const API_ROOT = GITHUB_API;

/*
 * Which backend.
 *
 * "auto" is the honest default: a GitHub token is only ever set deliberately,
 * and setting one is a clear statement that commits are wanted. With no token
 * the only thing that can possibly work is the disk - and on a normal server
 * the disk is also the better answer.
 */
const STORAGE = (() => {
  const asked = String(process.env.STORAGE || 'auto').trim().toLowerCase();
  if (asked === 'file' || asked === 'disk' || asked === 'local') return 'file';
  if (asked === 'github' || asked === 'git') return 'github';
  return GITHUB_TOKEN ? 'github' : 'file';
})();

/* Where the file backend keeps its copy. Deliberately NOT the checked-in
 * data/wolimons-data.json: live data would then show up as an uncommitted
 * change in the repo, and a `git pull` could clobber it. */
const DATA_FILE = path.resolve(
  process.env.DATA_FILE || path.join(__dirname, 'data', 'wolimons-data.json'),
);

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

/* Trade ads. The board is ours, not Wanwood's - Wanwood has no trade ad
 * service - so the ads live here with the values, in the same JSON file, and
 * every visitor reads the same list. How many to keep in total, and how many
 * any one player may have up at once so a single poster cannot fill it. */
const AD_LIMIT = Number(process.env.AD_LIMIT || 500);
const ADS_PER_USER = Number(process.env.ADS_PER_USER || 10);

/* The ten request tags. Kept in step with tradeads-core.js on the client -
 * the server has to know them to reject a slot that is neither a real item
 * nor a real tag. */
const AD_TAGS = ['any', 'demand', 'rares', 'rap', 'wishlist', 'robux',
  'upgrade', 'downgrade', 'adds', 'projecteds'];

/*
 * How an item was valued. The item page prints one of these beside the
 * explanation the snapshot carries: a proof-based item is priced off its
 * recent trades and offers, a RAP-based one simply tracks its RAP. Null means
 * nobody has said, which is the state every item starts in.
 */
const VALUATION_METHODS = ['proof', 'rap'];

/* The value team's free-text note about an item, shown in the Valuation tab.
 * Capped so one entry cannot bloat the file that is committed on every write. */
const NOTE_LIMIT = 500;

/*
 * Badges the owner hands out by hand.
 *
 * Most WoliBadges are earned: assets/js/badges.js works them out from the
 * player's own inventory, in the browser, and nobody can grant or withhold
 * one. These fifteen are the exceptions - the ones whose requirement happens
 * somewhere no browser can check. Winning a Discord tournament, contributing
 * artwork, being recognised as a Certified Wanwoodian: there is no endpoint
 * that reports any of it, and there never will be, so somebody has to say so.
 *
 * That somebody is the site owner, through the admin panel, and the answer is
 * stored here with the values and the roles. It used to be a list of names
 * written into assets/js/config.js, which meant awarding a badge was a code
 * change and a redeploy.
 *
 * The ids are the ones in assets/js/badges.js. tools/check-badges.mjs fails
 * if this list and that file ever stop agreeing, so a badge cannot be granted
 * here that the site does not know how to draw.
 */
const GRANTABLE_BADGES = [
  /* Community - earned in the Discord server */
  'contributor',
  'sword-fighting-champion',
  'woli-award-winner',
  'woli-award-nominee',
  'event-winner',
  'game-night-winner',
  'booster',
  'woligang',
  /* Website - recognition handed out on this site */
  'boundless-trader',
  'active-trader',
  'frequent-trader',
  'trade-advertiser',
  'verified-checkmark',
  'certified-wanwoodian',
  /* Trading - the one copy /luckycat has chosen, which is too expensive to
   * work out on every profile load */
  'lucky-cat',
];

const EMPTY = {
  version: 1,
  updatedAt: 0,
  roles: {},
  values: {},
  changes: [],
  ads: [],
  badges: {},
};

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

/*
 * The roles committed in data/wolimons-data.json are a floor, not a one-off
 * seed.
 *
 * They used to be copied in only when the live data file did not exist yet.
 * That looked fine on a fresh machine and then quietly broke every server
 * that had been running for a while: the moment anything was saved, the live
 * file existed, so on the next restart the seed was skipped and the roles it
 * carried were simply gone. The owner and the value team lost the admin panel
 * without touching anything, because saving a value is what took it away.
 *
 * So they are re-applied on every load instead. A name here always has at
 * least this rank. Anything granted in the panel is kept as-is, and a rank
 * granted there outranks the file only in the sense that it overwrites it -
 * the merge below never downgrades what is already stored.
 */
function applyBuiltinRoles(target) {
  const seed = readLocal();
  if (!seed || !seed.roles || typeof seed.roles !== 'object') return target;

  for (const [name, entry] of Object.entries(seed.roles)) {
    if (!entry || typeof entry !== 'object') continue;
    if (!ROLES.includes(entry.role)) continue;
    const id = key(name);
    /* Already has a rank from the live file - leave it, it is newer. */
    if (target.roles[id]) continue;
    target.roles[id] = {
      name: String(entry.name || name),
      role: entry.role,
      grantedBy: String(entry.grantedBy || ''),
      grantedAt: Number(entry.grantedAt) || 0,
    };
  }

  /*
   * The same floor for granted badges.
   *
   * "Certified Wanwoodian" used to be a name written into config.js, so it
   * survived every restart by virtue of being in the code. Now it is data,
   * and data on a fresh server starts empty - which would have quietly taken
   * the badge off the one account that had it. Seeding it from the committed
   * file keeps that from happening, on exactly the same terms as the roles
   * above: a name here always has at least these badges, anything granted in
   * the panel is kept as-is, and nothing is ever taken away.
   */
  if (seed.badges && typeof seed.badges === 'object') {
    for (const [name, entry] of Object.entries(seed.badges)) {
      if (!entry || typeof entry !== 'object') continue;
      const list = Array.isArray(entry.badges) ? entry.badges : [];
      const wanted = list.filter(badge => GRANTABLE_BADGES.includes(badge));
      if (!wanted.length) continue;

      const id = key(name);
      /*
       * The live file has an opinion about this player - leave it alone.
       *
       * This is what makes taking a badge back actually stick. Once the owner
       * has edited someone, their row exists in the live file, and it stays
       * authoritative even when it is empty (see normalize, which keeps an
       * emptied row rather than deleting it, precisely so this check can see
       * it). Merging the seed back in would put a revoked badge straight back
       * on the next restart, and the owner would never be able to remove one.
       */
      if (target.badges[id]) continue;

      target.badges[id] = {
        name: String(entry.name || name),
        badges: wanted,
        grantedBy: String(entry.grantedBy || ''),
        grantedAt: Number(entry.grantedAt) || 0,
      };
    }
  }

  return target;
}

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
        method: VALUATION_METHODS.includes(entry.method) ? entry.method : null,
        note: typeof entry.note === 'string' ? entry.note.slice(0, NOTE_LIMIT) : '',
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

  if (Array.isArray(raw.ads)) {
    out.ads = raw.ads
      .map(normalizeAd)
      .filter(Boolean)
      /* Newest first, which is the order the board wants. */
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, AD_LIMIT);
  }

  /*
   * Granted badges, keyed by lowercased username exactly like roles, so a
   * player found under any capitalisation gets the same answer. Ids the site
   * does not have a badge for are dropped rather than stored - a typo must
   * never reach a profile as an icon nobody can draw.
   */
  if (raw.badges && typeof raw.badges === 'object') {
    for (const [name, entry] of Object.entries(raw.badges)) {
      if (!entry || typeof entry !== 'object') continue;
      const id = key(name);
      if (!id) continue;

      const list = Array.isArray(entry.badges) ? entry.badges : [];
      const badges = [...new Set(list.filter(badge => GRANTABLE_BADGES.includes(badge)))];

      /*
       * An empty row is kept, not dropped.
       *
       * It reads like dead weight, and for the roles table it would be. Here
       * it is the record of a decision: "the owner has looked at this player
       * and they hold nothing". applyBuiltinRoles() checks for exactly that
       * before it seeds anyone, so an empty row is what stops a revoked badge
       * from being handed back on the next restart. Delete these and taking a
       * seeded badge away stops working.
       */
      out.badges[id] = {
        name: String(entry.name || name),
        badges,
        grantedBy: String(entry.grantedBy || ''),
        grantedAt: Number(entry.grantedAt) || 0,
      };
    }
  }

  return out;
}

/*
 * One slot of an ad: either a real catalog item or one of the request tags.
 * Anything else becomes an empty slot rather than being trusted through.
 */
function normalizeAdSlot(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.kind === 'tag') {
    return AD_TAGS.includes(raw.slug) ? { kind: 'tag', slug: raw.slug } : null;
  }
  const id = Number(raw.id);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  /* The name is only a label for the first paint; the client looks the real
   * one up. Capped so a long string cannot be smuggled into the file. */
  const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 120) : '';
  return { kind: 'item', id, name };
}

function normalizeAdSide(raw) {
  const list = Array.isArray(raw) ? raw : [];
  return [0, 1, 2, 3].map(index => normalizeAdSlot(list[index]));
}

function normalizeAd(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const id = String(raw.id || '').trim().slice(0, 64);
  const creatorId = Number(raw.creatorId);
  const creatorName = typeof raw.creatorName === 'string' ? raw.creatorName.trim() : '';
  if (!id) return null;
  if (!Number.isSafeInteger(creatorId) || creatorId <= 0) return null;
  if (!creatorName) return null;

  const offer = normalizeAdSide(raw.offer);
  const request = normalizeAdSide(raw.request);
  /* An ad with nothing on a side is not an ad. */
  if (!offer.some(Boolean) || !request.some(Boolean)) return null;

  const createdAt = Number(raw.createdAt) || 0;

  return {
    id,
    creatorId,
    creatorName: creatorName.slice(0, 60),
    createdAt: createdAt || Date.now(),
    offer,
    request,
  };
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
      if (STORAGE === 'file') {
        /*
         * Read our own file. If it is not there yet this is a first run, so
         * seed from the copy committed in the repo - that carries the roles
         * and values that already exist instead of starting empty.
         */
        let raw = null;
        try {
          raw = JSON.parse(await fsp.readFile(DATA_FILE, 'utf8'));
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
          raw = readLocal();
          console.log(`[store] ${DATA_FILE} does not exist yet - it will be created on the first save.`);
        }
        data = applyBuiltinRoles(normalize(raw));
        authoritative = true;
      } else if (GITHUB_TOKEN) {
        const response = await fetch(`${API_ROOT}?ref=${encodeURIComponent(GITHUB_BRANCH)}`, {
          headers: githubHeaders(),
        });
        if (response.ok) {
          const payload = await response.json();
          sha = payload.sha || null;
          const text = Buffer.from(payload.content || '', 'base64').toString('utf8');
          data = applyBuiltinRoles(normalize(JSON.parse(text)));
          authoritative = true;
        } else if (response.status === 404) {
          /* No file yet - the first write creates it. */
          data = applyBuiltinRoles(normalize(readLocal()));
          authoritative = true;
        } else {
          throw new Error(`GitHub read failed (${response.status})`);
        }
      } else {
        const raw = `https://raw.githubusercontent.com/${GITHUB_REPO}/`
          + `${GITHUB_BRANCH}/${DATA_PATH}`;
        const response = await fetch(raw, { headers: { 'User-Agent': 'wolimons-api' } });
        if (response.ok) {
          data = applyBuiltinRoles(normalize(await response.json()));
        } else {
          data = applyBuiltinRoles(normalize(readLocal()));
        }
        /* Read-only without a token anyway, so there is nothing to protect. */
        authoritative = true;
      }
      loaded = true;
    } catch (error) {
      /* Serve the checked-in copy rather than refuse to boot. Writes stay
       * blocked until a real load succeeds - see `authoritative`. */
      console.error('[store] load failed, using the checked-in copy:', error.message);
      data = applyBuiltinRoles(normalize(readLocal()));
      authoritative = false;
      loaded = true;
      if (STORAGE === 'file') {
        /* An unreadable data file is corruption, not a network blip, and
         * retrying will not fix it. Say so loudly - the alternative is an
         * admin who saves all evening into a store that refuses every write. */
        console.error(`[store] ${DATA_FILE} could not be read. Saving is blocked until it is `
          + 'fixed or removed. A backup is written alongside it on every save.');
      }
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

/*
 * Write the file, without ever leaving a half-written one behind.
 *
 * Write to a temporary file, then rename it over the real one - a rename is
 * atomic, so a crash or a pulled plug mid-save leaves either the old file or
 * the new one, never a truncated file that parses as nothing and reads back
 * as "no values were ever set".
 *
 * The previous contents are kept as .bak first, so even a corrupted save has
 * something to go back to.
 */
async function writeFile() {
  const text = `${JSON.stringify(data, null, 2)}\n`;
  await fsp.mkdir(path.dirname(DATA_FILE), { recursive: true });

  try {
    await fsp.copyFile(DATA_FILE, `${DATA_FILE}.bak`);
  } catch (error) {
    /* Nothing to back up on the first save. */
    if (error.code !== 'ENOENT') throw error;
  }

  const temp = `${DATA_FILE}.tmp`;
  await fsp.writeFile(temp, text, 'utf8');
  await fsp.rename(temp, DATA_FILE);
}

function commit(message) {
  const run = async () => {
    if (STORAGE === 'file') {
      if (!authoritative) {
        throw new Error('The saved data could not be read, so saving is blocked to avoid '
          + 'overwriting it. Check the server log.');
      }
      await writeFile();
      return;
    }

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

/* ---------------------------------------------------------------------- */
/* Granted badges                                                          */
/* ---------------------------------------------------------------------- */

/* Every badge one player has been given, or an empty array. Public - the
 * profile page asks this for whoever is being looked at. */
async function badgesOf(name) {
  await load();
  const row = data.badges[key(name)];
  return row ? [...row.badges] : [];
}

/* The whole table, for the admin panel's list of who has what. */
async function badgeGrants() {
  await load();
  return Object.values(data.badges)
    .map(row => ({ ...row, badges: [...row.badges] }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/*
 * Give one player one badge, or take it back.
 *
 * A single badge at a time rather than the whole set, so two owners editing
 * different players cannot overwrite each other, and so the panel never has
 * to send back a list it might have read before someone else changed it.
 */
async function setBadge({ name, badge, granted, grantedBy }) {
  const clean = String(name || '').trim();
  if (!clean) throw new Error('A username is required.');
  if (!GRANTABLE_BADGES.includes(badge)) {
    throw new Error('That badge is not one the owner hands out.');
  }

  const id = key(clean);
  const give = granted !== false;

  return mutate(
    give
      ? `Give ${clean} the ${badge} badge on Wolimons`
      : `Take the ${badge} badge back from ${clean}`,
    current => {
      const existing = current.badges[id];
      const held = new Set(existing ? existing.badges : []);

      if (give) held.add(badge);
      else held.delete(badge);

      /* Written even when it is now empty - see the note in normalize(). An
       * empty row is how "the owner took the last one back" is remembered,
       * and deleting it would let the committed seed re-grant it. */
      current.badges[id] = {
        /* Keep the capitalisation the owner typed, so the panel can show the
         * name back the way it is written on Wanwood. */
        name: clean,
        badges: [...held],
        grantedBy: String(grantedBy || ''),
        grantedAt: Date.now(),
      };
    },
  );
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

async function setValue({ id, value, demand, trend, categories, rare, method, note, updatedBy }) {
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
    method: existing?.method ?? null,
    note: existing?.note ?? '',
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

  /* Valuation method and note. Both are optional and both accept an explicit
   * clear - '' or null - so a value manager can take a note back down again. */
  if (method !== undefined) {
    next.method = VALUATION_METHODS.includes(method) ? method : null;
  }
  if (note !== undefined) {
    next.note = typeof note === 'string' ? note.trim().slice(0, NOTE_LIMIT) : '';
  }

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

/* ---------------------------------------------------------------------- */
/* Trade ads                                                               */
/* ---------------------------------------------------------------------- */

/*
 * Every ad on the board, newest first. `creatorId` narrows it to one player,
 * which is all /playertrades wants.
 */
async function ads({ creatorId = 0 } = {}) {
  await load();
  const wanted = Number(creatorId) || 0;
  return (data.ads || [])
    .filter(ad => !wanted || ad.creatorId === wanted)
    .map(ad => structuredClone(ad));
}

async function adById(adId) {
  await load();
  const wanted = String(adId || '');
  const found = (data.ads || []).find(ad => ad.id === wanted);
  return found ? structuredClone(found) : null;
}

/*
 * Post an ad. The caller has already proven it controls `creatorId` - see the
 * note on /api/ads in api.js - so the checks here are about the shape of the
 * ad and about one player not being able to bury the board.
 */
async function addAd(raw) {
  const ad = normalizeAd({ ...raw, createdAt: Date.now() });
  if (!ad) {
    throw new Error('An ad needs a creator, something offered and something wanted.');
  }

  await load();
  const mine = (data.ads || []).filter(row => row.creatorId === ad.creatorId);
  if (mine.length >= ADS_PER_USER) {
    throw new Error(`You already have ${ADS_PER_USER} ads up. Delete one first.`);
  }

  await mutate(`Add trade ad ${ad.id}`, current => {
    current.ads = [ad, ...(current.ads || [])].slice(0, AD_LIMIT);
  });
  return ad;
}

/*
 * Delete an ad. Only its author may, so the id of whoever is asking is
 * required and has to match.
 */
async function removeAd({ id, creatorId }) {
  const wanted = String(id || '');
  const asker = Number(creatorId) || 0;
  if (!wanted) throw new Error('Which ad?');

  await load();
  const ad = (data.ads || []).find(row => row.id === wanted);
  if (!ad) throw new Error('That ad no longer exists.');
  if (ad.creatorId !== asker) throw new Error('That is not your ad.');

  await mutate(`Delete trade ad ${wanted}`, current => {
    current.ads = (current.ads || []).filter(row => row.id !== wanted);
  });
  return ad;
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
  VALUATION_METHODS,
  ROLES,
  GRANTABLE_BADGES,
  load,
  snapshot,
  roleOf,
  setRole,
  badgesOf,
  badgeGrants,
  setBadge,
  setValue,
  changes,
  ads,
  adById,
  addAd,
  removeAd,
  AD_LIMIT,
  ADS_PER_USER,
  CHANGE_FIELDS,
  CHANGE_LIMIT,
  config: {
    storage: STORAGE,
    /* The file backend can always write; the GitHub one needs a token. */
    canWrite: STORAGE === 'file' ? true : Boolean(GITHUB_TOKEN),
    /* Where the data actually is, for /api/status and the log line at boot. */
    location: STORAGE === 'file' ? DATA_FILE : `${GITHUB_REPO}@${GITHUB_BRANCH}/${DATA_PATH}`,
    repo: GITHUB_REPO,
    branch: GITHUB_BRANCH,
    path: DATA_PATH,
    file: DATA_FILE,
  },
};
