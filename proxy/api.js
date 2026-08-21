'use strict';

/*
 * Wolimons API - the site's own backend.
 *
 * Everything under /api/ is answered here rather than forwarded to Wanwood.
 * Wanwood serves items and players; this serves the things that are ours:
 * item values, staff roles, granted badges, trade ads - and the public API.
 *
 * ---------------------------------------------------------------------------
 * THE PUBLIC API  (for bots, tools and other sites - see /api for the index)
 * ---------------------------------------------------------------------------
 *   GET  /api                           index of every endpoint, as JSON
 *   GET  /api/v1/itemdetails            every tracked item: value, demand,
 *                                       trend, categories, RAP, lowest price
 *   GET  /api/v1/values                 the raw value table values.js uses
 *   GET  /api/v1/valuechanges           the value change log (?limit=&since=)
 *   GET  /api/v1/playerinfo/<userId>    one player: name, role, badges
 *   GET  /api/v1/getrecentads           the trade ad board (?limit=)
 *   GET  /api/v1/roles                  the staff roster
 *   GET  /api/v1/badges                 granted badges (?name= for one player)
 *
 * ---------------------------------------------------------------------------
 * THE SITE'S OWN ENDPOINTS  (what the pages read and write)
 * ---------------------------------------------------------------------------
 *   GET  /api/values                    the whole value table, for values.js
 *   GET  /api/changes?limit=&since=     the value change log, for /valuechanges
 *   GET  /api/roles                     the roster, so the site can show ranks
 *   GET  /api/badges?name=              badges the owner has handed out
 *   GET  /api/me?name=<username>        what one account is allowed to do
 *   GET  /api/status                    server health, for the admin panel
 *   POST /api/roles/set   { name, target, role }
 *   POST /api/badges/set  { name, target, badge, granted }
 *   POST /api/values/set  { name, id, value, ... }
 *   GET  /api/ads?creatorId=            the trade ad board, newest first
 *   GET  /api/ad?id=<adId>              one ad
 *   POST /api/identity    { userId, phrase }         -> player identity token
 *   POST /api/ads/post    { creatorName, offer, request }   identity token
 *   POST /api/ads/delete  { id }        identity token, author only
 *   POST /api/ads/moderate { id }       remove any ad, from the admin panel
 *
 * ---------------------------------------------------------------------------
 * HOW ACCESS IS DECIDED
 * ---------------------------------------------------------------------------
 * There is no admin key, but the panel is not open to everybody either.
 * Every write names the Wanwood account making it, and that name must be on
 * the staff roster: owners may rank people and hand out badges, any ranked
 * member may set values or moderate the board. The roster is the door now,
 * instead of a password, and it is checked here on the server - so editing
 * the panel in a browser cannot widen what a visitor may do.
 *
 * Trade ads keep their own proof. Posting and deleting your own ads still
 * requires an identity token from /verify, because the board is public and
 * "anyone may post as anyone" was never the model there.
 */

const crypto = require('crypto');
const path = require('path');
const fsp = require('fs/promises');
const store = require('./store');

/*
 * Which folder the pages are being served out of. Worked out the same way
 * server.js does it, so /api/status can report it.
 *
 * This is here to answer one specific question: "I updated the files but the
 * site still shows the old pages." Nearly always that means the service is
 * still pointed at the previous copy of the site, and this tells you which
 * folder it is actually reading instead of leaving you to guess.
 */
const SITE_ROOT = path.resolve(process.env.SITE_ROOT || path.join(__dirname, '..'));

const UPSTREAM = (process.env.UPSTREAM_ORIGIN || 'https://wanwoo.xyz').replace(/\/+$/, '');
const UPSTREAM_TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS || 20000);

const SERVER_STARTED_AT = Date.now();

/* ---------------------------------------------------------------------- */
/* Player identity, for trade ads                                          */
/* ---------------------------------------------------------------------- */

/*
 * Posting an ad is not a staff action - any player may do it - so what has to
 * be proven is narrow: that whoever is posting really is the Wanwood account
 * the ad will be signed with. Otherwise anyone could post ads as anyone.
 *
 * The proof is the one /verify already uses: a one-time phrase written into
 * the player's Wanwood profile description, which only that player can edit.
 * POST /api/identity re-reads the description here on the server, and if the
 * phrase is there, hands back a token that says "this browser is user N".
 *
 * The token is signed rather than remembered. A stored table would be emptied
 * by every restart, and /verify tells players to take the phrase back out of
 * their description once they are done - so they would have no way to get a
 * new token without going through the whole dance again. Signing means the
 * server can check a token it has never seen before, and nothing about a
 * player has to be kept on disk.
 */
const IDENTITY_TTL_MS = Number(process.env.IDENTITY_TTL_MS || 30 * 24 * 60 * 60 * 1000);

/*
 * The signing secret. ADMIN_KEY is reused as seed when an old .env still sets
 * one, so identity tokens survive a restart; the derivation means the key
 * itself is never recoverable from a token. With nothing set we fall back to
 * a random secret, which works but signs everyone out on restart - noted in
 * /api/status.
 */
const LEGACY_KEY = process.env.ADMIN_KEY || '';
const IDENTITY_SECRET = LEGACY_KEY
  ? crypto.createHash('sha256').update(`wolimons-identity:${LEGACY_KEY}`).digest()
  : crypto.randomBytes(32);

function signIdentity(userId, expiresAt) {
  const body = `${userId}.${expiresAt}`;
  const mac = crypto.createHmac('sha256', IDENTITY_SECRET).update(body).digest('base64url');
  return `${body}.${mac}`;
}

/*
 * Returns the user id a token vouches for, or 0. Never throws on a malformed
 * token - a bad token is simply not a token.
 */
function readIdentity(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return 0;

  const [rawId, rawExpiry, mac] = parts;
  const expected = crypto
    .createHmac('sha256', IDENTITY_SECRET)
    .update(`${rawId}.${rawExpiry}`)
    .digest('base64url');

  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return 0;
  if (!crypto.timingSafeEqual(a, b)) return 0;

  const expiresAt = Number(rawExpiry);
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return 0;

  const userId = Number(rawId);
  return Number.isSafeInteger(userId) && userId > 0 ? userId : 0;
}

/*
 * The player's Wanwood profile, read here rather than taken from the client.
 * users/v1/users/{id} is the only endpoint carrying the description.
 */
async function fetchProfile(userId) {
  return fetchUpstreamJson(`/apisite/users/v1/users/${userId}`);
}

function bearer(req) {
  const header = req.headers.authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1] : '';
}

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readJson(body) {
  if (!body || !body.length) return {};
  try {
    const parsed = JSON.parse(body.toString('utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    throw new Error('The request body was not valid JSON.');
  }
}

/*
 * Who is asking, and are they an admin?
 *
 * There is still no key - but "open" does not mean "anyone". Every write
 * carries the identity token from /verify, which proves the browser controls
 * the Wanwood account it claims. The server reads the account's real name
 * back from Wanwood itself - the name in the request body is never trusted -
 * and that name has to be on the staff roster: an owner for ranks and
 * badges, any ranked member for values, a ranked member for moderation. The
 * roster is the door now instead of a password, and the token is the proof
 * that the person walking through it is who the roster says.
 *
 * need: 'website'  - the website owner alone (server internals)
 *       'owner'    - site owners and up (ranks, badges, announcements)
 *       'valuer'   - anyone ranked: values are the value team's job
 *       'staff'    - anyone ranked at all (moderation)
 */
const ROLE_RANK = { website_owner: 4, owner: 3, value_manager: 2, staff: 1 };

/* What each rank is allowed to do, in one place so the panel and the server
 * can never disagree about it. */
function capabilities(role) {
  const rank = ROLE_RANK[role] || 0;
  return {
    role: role || null,
    rank,
    /* Values, demand, trend and categories - the value team's whole job. */
    canSetValues: rank >= 1,
    /* Deleting ads and comments. */
    canModerate: rank >= 1,
    /* Handing out ranks and badges, and writing the banner. */
    canGrantRoles: rank >= 3,
    canGrantBadges: rank >= 3,
    canAnnounce: rank >= 3,
    /* Looking players up in the panel. */
    canViewUsers: rank >= 1,
    /* Server internals and status. The website owner alone. */
    canViewServer: rank >= 4,
  };
}

/*
 * The Wanwood username an identity token stands for, confirmed upstream and
 * cached briefly - a write must not fan out to Wanwood every time, but a
 * rename must also not stay cached forever.
 */
async function verifiedName(userId) {
  const cacheKey = `identity-name:${userId}`;
  const cached = cacheRead(cacheKey);
  if (cached) return cached;

  const profile = await fetchProfile(userId);
  const name = profile ? String(profile.name || '').trim() : '';
  if (!name) return '';
  return cacheWrite(cacheKey, name, 5 * 60 * 1000);
}

async function authorize(req, payload, { need }) {
  const userId = readIdentity(bearer(req));
  if (!userId) {
    return {
      ok: false,
      status: 401,
      error: 'Link your Wanwood account on the verify page first.',
    };
  }

  const name = await verifiedName(userId);
  if (!name) {
    return {
      ok: false,
      status: 502,
      error: 'Wanwood could not be reached to confirm the account. Try again in a moment.',
    };
  }

  const role = await store.roleOf(name);
  if (!role) {
    return { ok: false, status: 403, error: `${name} is not a Wolimons admin.` };
  }

  const rank = ROLE_RANK[role] || 0;
  const floor = need === 'website' ? 4 : need === 'owner' ? 3 : 1;

  if (rank < floor) {
    return {
      ok: false,
      status: 403,
      error: need === 'website'
        ? `Only the website owner may do that, and ${name} is not them.`
        : need === 'owner'
          ? `Only a site owner may do that, and ${name} is not one.`
          : `${name} cannot do that.`,
    };
  }
  return { ok: true, name, role, rank, can: capabilities(role) };
}

/* ---------------------------------------------------------------------- */
/* Reading Wanwood from the server, for the public API                     */
/* ---------------------------------------------------------------------- */

/*
 * The public API answers with Wolimons data plus a little enrichment from
 * Wanwood - item names, RAP, lowest prices, player names. Everything fetched
 * upstream is cached, because itemdetails can mean a few dozen upstream GETs
 * and the point of a public API is that hammering it does not hammer Wanwood.
 */
const apiCache = new Map();

function cacheRead(key) {
  const hit = apiCache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expires) {
    apiCache.delete(key);
    return null;
  }
  return hit.value;
}

function cacheWrite(key, value, ttlMs) {
  if (apiCache.size > 300) apiCache.clear();
  apiCache.set(key, { value, expires: Date.now() + ttlMs });
  return value;
}

/* Same browser-like face the forwarding proxy wears - Wanwood refuses
 * anything that does not look like a page. */
const UPSTREAM_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
    'Chrome/125.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': `${UPSTREAM}/`,
  'Origin': UPSTREAM,
};

/*
 * GET one JSON document from Wanwood. Returns null on any failure - the
 * public API must degrade, not throw, when the upstream is down. Unknown
 * paths on this backend answer with the SPA shell and a 200, so anything
 * that parses as HTML counts as a failure too.
 */
async function fetchUpstreamJson(pathname) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const response = await fetch(`${UPSTREAM}${pathname}`, {
      headers: UPSTREAM_HEADERS,
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const text = await response.text();
    const head = text.trimStart().slice(0, 9).toLowerCase();
    if (!text.trim() || head.startsWith('<!doctype') || head.startsWith('<html')) return null;
    return JSON.parse(text);
  } catch (error) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/* Run an array through a worker a few at a time. */
async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    async () => {
      while (cursor < items.length) {
        const index = cursor++;
        results[index] = await worker(items[index], index);
      }
    });
  await Promise.all(runners);
  return results;
}

/*
 * Every limited id in the Wanwood catalog. The search endpoint returns bare
 * {itemType, id} stubs and clamps limit to 100, so this pages until the
 * cursor runs out - one or two requests in practice, Wanwood has a few dozen
 * limiteds total.
 */
async function listCatalogIds() {
  const ids = [];
  const seen = new Set();
  let cursor = 0;

  for (let page = 0; page < 10; page += 1) {
    const query = `category=Collectibles&subcategory=Collectibles&sortType=3`
      + `&limit=100&cursor=${cursor}`;
    const result = await fetchUpstreamJson(`/apisite/catalog/v1/search/items?${query}`);
    const rows = result && Array.isArray(result.data) ? result.data : [];
    rows.forEach(row => {
      const id = Number(row?.id ?? row?.assetId);
      if (!Number.isSafeInteger(id) || id <= 0 || seen.has(id)) return;
      seen.add(id);
      ids.push(id);
    });
    const next = Number(result?.nextPageCursor);
    if (!rows.length || !result?.nextPageCursor || rows.length < 100
      || !Number.isFinite(next) || next <= cursor) break;
    cursor = next;
  }

  return ids;
}

/*
 * One item's enrichment: name from productinfo, RAP from resale-data, lowest
 * ask from the reseller list. Three GETs, each of which may fail on its own;
 * whatever comes back is what the answer carries.
 */
async function enrichItem(id) {
  const [product, resale, resellers] = await Promise.all([
    fetchUpstreamJson(`/apisite/api/marketplace/productinfo?assetId=${id}`),
    fetchUpstreamJson(`/apisite/economy/v1/assets/${id}/resale-data`),
    fetchUpstreamJson(`/apisite/economy/v1/assets/${id}/resellers?limit=1`),
  ]);

  const rap = Number(resale?.recentAveragePrice);
  const lowest = Array.isArray(resellers?.data) && resellers.data[0]
    ? Number(resellers.data[0].price)
    : NaN;

  return {
    name: String(product?.Name ?? product?.name ?? '').trim() || null,
    rap: Number.isFinite(rap) && rap > 0 ? rap : null,
    lowestPrice: Number.isFinite(lowest) && lowest > 0 ? lowest : null,
  };
}

/*
 * The whole catalog, enriched, cached for ten minutes. Tracked item ids from
 * our own table are always present, whatever Wanwood says - a dead upstream
 * yields names of null rather than a missing catalog.
 */
const ITEM_DETAILS_TTL_MS = Number(process.env.ITEM_DETAILS_TTL_MS || 10 * 60 * 1000);

async function publicItemDetails() {
  const cached = cacheRead('itemdetails');
  if (cached) return cached;

  const snapshot = await store.snapshot();
  const tracked = Object.keys(snapshot.values).map(Number).filter(Number.isSafeInteger);

  const ids = [...new Set([...tracked, ...(await listCatalogIds())])];
  const enriched = await mapLimit(ids, 6, enrichItem);

  const items = {};
  ids.forEach((id, index) => {
    const row = snapshot.values[String(id)] || {};
    const extra = enriched[index] || {};
    items[String(id)] = {
      name: extra.name ?? null,
      value: Number(row.value) || 0,
      demand: row.demand ?? null,
      trend: row.trend ?? null,
      method: row.method ?? null,
      categories: Array.isArray(row.categories) ? [...row.categories] : [],
      rap: extra.rap ?? null,
      lowestPrice: extra.lowestPrice ?? null,
      updatedAt: Number(row.updatedAt) || 0,
      updatedBy: String(row.updatedBy || ''),
    };
  });

  const upstreamDown = ids.length > 0
    && Object.values(items).every(item => item.name === null && item.rap === null);

  return cacheWrite('itemdetails', {
    success: true,
    item_count: ids.length,
    upstream: UPSTREAM.replace(/^https?:\/\//, ''),
    partial: upstreamDown,
    refreshedAt: Date.now(),
    items,
  }, ITEM_DETAILS_TTL_MS);
}

/*
 * One player's public profile: the Wanwood account plus whatever Wolimons
 * adds - the staff role and the badges handed out here. Cached briefly per
 * player so a lookup loop does not become a profile fetch loop.
 */
const ROLE_LABELS = { website_owner: 'Website Owner', owner: 'Site Owner', value_manager: 'Value Manager', staff: 'Value Team' };

/*
 * The vault password. Overridable per-server so it never has to be the one in
 * the repository; the default is the one that was asked for.
 */
const VAULT_PASSWORD = String(process.env.VAULT_PASSWORD || 'ilovegod123');

/* Item ids the vault has already seen. Anything absent from this on a later
 * poll is a fresh release. */
const vaultSeen = new Set();

/*
 * One item, with the fields a purchase actually needs: the product id, the
 * asking price and who is selling it. productinfo is the only endpoint that
 * carries them.
 */
async function vaultItem(assetId) {
  const info = await fetchUpstreamJson(`/apisite/api/marketplace/productinfo?assetId=${assetId}`)
    .catch(() => null);
  if (!info) return null;
  const price = Number(info.PriceInRobux ?? info.priceInRobux);
  return {
    assetId,
    name: String(info.Name ?? info.name ?? `Item ${assetId}`),
    productId: Number(info.ProductId ?? info.productId) || null,
    price: Number.isFinite(price) ? price : null,
    sellerId: Number(info.Creator?.Id ?? info.Creator?.CreatorTargetId ?? 1) || 1,
    forSale: Boolean(info.IsForSale ?? info.isForSale),
    limited: Boolean(info.IsLimited ?? info.IsLimitedUnique),
    remaining: Number(info.Remaining ?? info.remaining) || null,
    created: info.Created || null,
  };
}

async function publicPlayerInfo(userId) {
  const cacheKey = `player:${userId}`;
  const cached = cacheRead(cacheKey);
  if (cached) return cached;

  const profile = await fetchProfile(userId);
  if (!profile) return null;

  const name = String(profile.name || '').trim();
  const role = await store.roleOf(name);

  return cacheWrite(cacheKey, {
    success: true,
    id: userId,
    name,
    description: String(profile.description || ''),
    role: role || null,
    roleLabel: role ? (ROLE_LABELS[role] || role) : null,
    badges: await store.badgesOf(name),
  }, 60 * 1000);
}

/* ---------------------------------------------------------------------- */
/* The endpoint index                                                      */
/* ---------------------------------------------------------------------- */

/*
 * Served at /api itself. A machine-readable table of everything this backend
 * answers, so a tool pointed at the domain can find its way around without a
 * separate docs page.
 */
function endpointIndex() {
  const v1 = '/api/v1';
  return {
    success: true,
    service: 'Wolimons API',
    about: 'Wolimons is the official item values and trading resource for Wanwood. '
      + 'Everything under /api/v1 is the public API - no key, no registration. '
      + 'Item names, RAP and lowest prices come from Wanwood and are cached for '
      + 'ten minutes; values, demand, trend and categories are set by hand on '
      + 'this site.',
    endpoints: [
      { path: `${v1}/itemdetails`, description: 'Every tracked item: name, value, demand, trend, valuation method, categories, RAP, lowest ask.' },
      { path: `${v1}/values`, description: 'The raw value table this site runs on, keyed by item id.' },
      { path: `${v1}/valuechanges?limit=&since=`, description: 'The value change log, newest first.' },
      { path: `${v1}/playerinfo/<userId>`, description: 'One Wanwood player: name, staff role, granted badges.' },
      { path: `${v1}/getrecentads?limit=`, description: 'The trade ad board, newest first.' },
      { path: `${v1}/roles`, description: 'The staff roster.' },
      { path: `${v1}/badges?name=`, description: 'Badges handed out by the site owner, for everyone or one player.' },
    ],
    notes: [
      'All public endpoints answer GET requests with JSON and send CORS headers, so a browser page on any domain may call them.',
      'Rate is unhindered for now; be gentle - every itemdetails refresh fans out over Wanwood.',
      'The site\'s own internal endpoints also live under /api - see the pages that use them.',
    ],
  };
}

/* ---------------------------------------------------------------------- */
/*
 * Every comment left on one user's own profile or trade ads, newest first.
 * Shared by /api/inbox and /api/inbox/count.
 */
async function inboxCommentsFor(userId) {
  const targets = new Set([`player:${userId}`]);
  const myAds = await store.ads({ creatorId: userId });
  myAds.forEach(ad => targets.add(`ad:${ad.id}`));
  const all = await store.allComments({ limit: 5000 });
  return all.filter(comment => targets.has(comment.target));
}

/* The router                                                              */
/* ---------------------------------------------------------------------- */

/*
 * Returns true when it handled the request. server.js calls this before it
 * forwards anything upstream.
 */
async function handle(req, res, url, readBody) {
  /* The index lives at /api itself - no trailing slash required. */
  if (url.pathname === '/api' || url.pathname === '/api/') {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      send(res, 405, { ok: false, error: 'Method not allowed' });
      return true;
    }
    send(res, 200, endpointIndex());
    return true;
  }

  if (!url.pathname.startsWith('/api/')) return false;

  const route = url.pathname.replace(/\/+$/, '');

  try {
    /* --------------------------------------------------------- public v1 */

    if (req.method === 'GET' && route === '/api/v1/itemdetails') {
      send(res, 200, await publicItemDetails());
      return true;
    }

    if (req.method === 'GET' && route === '/api/v1/values') {
      const snapshot = await store.snapshot();
      send(res, 200, {
        success: true,
        updatedAt: snapshot.updatedAt,
        values: snapshot.values,
      });
      return true;
    }

    if (req.method === 'GET' && route === '/api/v1/valuechanges') {
      const rows = await store.changes({
        limit: url.searchParams.get('limit') || 200,
        since: url.searchParams.get('since') || 0,
      });
      send(res, 200, { success: true, changes: rows });
      return true;
    }

    if (req.method === 'GET' && route.startsWith('/api/v1/playerinfo/')) {
      const userId = Number(route.split('/').pop());
      if (!Number.isSafeInteger(userId) || userId <= 0) {
        send(res, 400, { success: false, error: 'A Wanwood user id is required.' });
        return true;
      }
      const info = await publicPlayerInfo(userId);
      if (!info) {
        send(res, 502, {
          success: false,
          error: 'Wanwood could not be reached, or there is no such player.',
        });
        return true;
      }
      send(res, 200, info);
      return true;
    }

    if (req.method === 'GET' && route === '/api/v1/getrecentads') {
      const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 100, 1), 500);
      const ads = await store.ads({});
      send(res, 200, { success: true, ads: ads.slice(0, limit), limit: store.ADS_PER_USER });
      return true;
    }

    if (req.method === 'GET' && route === '/api/v1/roles') {
      const snapshot = await store.snapshot();
      send(res, 200, {
        success: true,
        roles: Object.values(snapshot.roles).sort((a, b) => a.name.localeCompare(b.name)),
      });
      return true;
    }

    if (req.method === 'GET' && route === '/api/v1/badges') {
      const name = String(url.searchParams.get('name') || '').trim();
      if (name) {
        send(res, 200, { success: true, name, badges: await store.badgesOf(name) });
        return true;
      }
      send(res, 200, {
        success: true,
        grants: await store.badgeGrants(),
        grantable: store.GRANTABLE_BADGES,
      });
      return true;
    }

    /* ------------------------------------------------------ internal reads */

    if (req.method === 'GET' && route === '/api/values') {
      const snapshot = await store.snapshot();
      send(res, 200, {
        ok: true,
        updatedAt: snapshot.updatedAt,
        values: snapshot.values,
      });
      return true;
    }

    if (req.method === 'GET' && route === '/api/changes') {
      /*
       * The value change log, newest first. This is the whole of
       * /valuechanges: the site records every edit made through the admin
       * panel, so the feed is a real history rather than a guess at one.
       */
      const rows = await store.changes({
        limit: url.searchParams.get('limit') || 200,
        since: url.searchParams.get('since') || 0,
      });
      send(res, 200, { ok: true, changes: rows });
      return true;
    }

    if (req.method === 'GET' && route === '/api/roles') {
      const snapshot = await store.snapshot();
      send(res, 200, {
        ok: true,
        roles: Object.values(snapshot.roles).sort((a, b) => a.name.localeCompare(b.name)),
      });
      return true;
    }

    /*
     * Owner-granted badges.
     *
     * ?name= asks about one player, which is what a profile does - the page
     * has to know whether the person being looked at holds Certified
     * Wanwoodian before it can draw the icon. With no name it returns the
     * whole table, which is the list the admin panel shows.
     */
    if (req.method === 'GET' && route === '/api/badges') {
      const name = String(url.searchParams.get('name') || '').trim();
      if (name) {
        send(res, 200, { ok: true, name, badges: await store.badgesOf(name) });
        return true;
      }
      send(res, 200, {
        ok: true,
        grants: await store.badgeGrants(),
        grantable: store.GRANTABLE_BADGES,
      });
      return true;
    }

    /*
     * One player, everything the panel knows about them in a single answer:
     * their Wanwood profile, their rank, their badges, the ads they have
     * posted, the comments they have written and the comments other people
     * have left on their profile. Any staff member may look somebody up.
     */
    if (req.method === 'GET' && route === '/api/admin/user') {
      const auth = await authorize(req, {}, { need: 'staff' });
      if (!auth.ok) {
        send(res, auth.status, { ok: false, error: auth.error });
        return true;
      }

      const query = String(url.searchParams.get('q') || '').trim();
      if (!query) {
        send(res, 400, { ok: false, error: 'Give a username or a user id to look up.' });
        return true;
      }

      /* A number is an id; anything else is a name we ask Wanwood to resolve. */
      let profile = null;
      if (/^\d+$/.test(query)) {
        profile = await fetchProfile(Number(query));
      } else {
        /* Wanwood has no user search, only this exact get-by-username
         * lookup - the same one the site's own search box uses. */
        const found = await fetchUpstreamJson(
          `/apisite/api/users/get-by-username?username=${encodeURIComponent(query)}`,
        ).catch(() => null);
        const id = Number(found?.Id ?? found?.id);
        if (Number.isSafeInteger(id) && id > 0) profile = await fetchProfile(id);
      }

      if (!profile || !profile.name) {
        send(res, 404, { ok: false, error: `Wanwood has no player called "${query}".` });
        return true;
      }

      const userId = Number(profile.id ?? profile.Id) || 0;
      const name = String(profile.name || '').trim();

      const [role, badges, allAds, comments] = await Promise.all([
        store.roleOf(name),
        store.badgesOf(name),
        store.ads({ creatorId: userId }),
        store.allComments({ limit: 500 }),
      ]);

      send(res, 200, {
        ok: true,
        user: {
          id: userId,
          name,
          displayName: String(profile.displayName || profile.name || '').trim(),
          description: String(profile.description || ''),
          created: profile.created || null,
          isBanned: Boolean(profile.isBanned),
          verified: Boolean(profile.hasVerifiedBadge || profile.isVerified),
        },
        role: role || null,
        roleLabel: role ? (ROLE_LABELS[role] || role) : null,
        badges,
        ads: allAds.slice(0, 25),
        adCount: allAds.length,
        /* Written by them, and left on their profile. */
        commentsBy: comments.filter(c => Number(c.userId) === userId).slice(0, 25),
        commentsOn: comments
          .filter(c => c.target === `player:${userId}`)
          .slice(0, 25),
        viewer: { name: auth.name, ...auth.can },
      });
      return true;
    }

    /* ------------------------------------------------------------------ */
    /* The vault - new item watch                                          */
    /* ------------------------------------------------------------------ */

    /*
     * A private page, gated twice: the caller must hold an identity token for
     * an account with the website owner rank, AND send the vault password.
     * The password is checked here rather than in the page so it is never in
     * anything a browser can view-source.
     */
    if (req.method === 'POST' && route === '/api/vault/unlock') {
      const payload = readJson(await readBody(req));
      const auth = await authorize(req, payload, { need: 'website' });
      if (!auth.ok) {
        send(res, auth.status, { ok: false, error: auth.error });
        return true;
      }
      if (String(payload.password || '') !== VAULT_PASSWORD) {
        send(res, 403, { ok: false, error: 'Wrong password.' });
        return true;
      }
      send(res, 200, { ok: true, name: auth.name });
      return true;
    }

    if (req.method === 'GET' && route === '/api/vault/feed') {
      const auth = await authorize(req, {}, { need: 'website' });
      if (!auth.ok) {
        send(res, auth.status, { ok: false, error: auth.error });
        return true;
      }
      if (String(req.headers['x-vault-password'] || '') !== VAULT_PASSWORD) {
        send(res, 403, { ok: false, error: 'Wrong password.' });
        return true;
      }

      try {
        const ids = await listCatalogIds();
        const first = vaultSeen.size === 0;

        /* The first call after a restart learns what already exists rather
         * than announcing the whole catalogue as brand new. */
        const fresh = first ? [] : ids.filter(id => !vaultSeen.has(id));
        ids.forEach(id => vaultSeen.add(id));

        /* ?recent=N also returns the newest N items already known, so the
         * page has something to show while nothing new has dropped. */
        const recent = Math.min(Math.max(Number(url.searchParams.get('recent')) || 0, 0), 12);
        const listed = fresh.length ? fresh : ids.slice(0, recent);

        const items = await Promise.all(listed.map(id => vaultItem(id)));
        send(res, 200, {
          ok: true,
          baseline: first,
          isNew: fresh.length > 0,
          watching: vaultSeen.size,
          items: items.filter(Boolean),
        });
      } catch (error) {
        send(res, 502, { ok: false, error: 'Wanwood could not be reached for the catalogue.' });
      }
      return true;
    }

    if (req.method === 'GET' && route === '/api/me') {
      const name = String(url.searchParams.get('name') || '').trim();
      const role = name ? await store.roleOf(name) : null;
      send(res, 200, { ok: true, name, ...capabilities(role) });
      return true;
    }

    if (req.method === 'GET' && route === '/api/announcement') {
      const snapshot = await store.snapshot();
      send(res, 200, { ok: true, announcement: snapshot.announcement });
      return true;
    }

    if (req.method === 'GET' && route === '/api/status') {
      /* Server internals belong to the website owner alone. Everyone else -
       * including a site owner - gets a bare "the server is up". */
      const auth = await authorize(req, {}, { need: 'website' });
      if (!auth.ok) {
        send(res, 200, { ok: true, restricted: true });
        return true;
      }
      const snapshot = await store.snapshot();
      const grants = Object.values(snapshot.badges || {})
        .filter(row => row.badges && row.badges.length);
      send(res, 200, {
        ok: true,
        auth: 'roster',
        protectSources: !/^(0|false|no|off)$/i.test(String(process.env.PROTECT_SOURCES || '1')),
        siteRoot: SITE_ROOT,
        upstream: UPSTREAM.replace(/^https?:\/\//, ''),
        canWrite: store.config.canWrite,
        storage: store.config.storage,
        location: store.config.location,
        repo: store.config.repo,
        branch: store.config.branch,
        node: process.version,
        port: Number(process.env.PORT) || 3000,
        uptime: Math.floor((Date.now() - SERVER_STARTED_AT) / 1000),
        items: Object.keys(snapshot.values).length,
        valued: Object.values(snapshot.values).filter(row => Number(row.value) > 0).length,
        staff: Object.keys(snapshot.roles).length,
        badges: grants.length,
        ads: (snapshot.ads || []).length,
        changes: (snapshot.changes || []).length,
      });
      return true;
    }

    /* --------------------------------------------------------------- writes */

    /*
     * Set or clear the global announcement. Owners only - it lands on every
     * page of the site. Empty text clears it.
     */
    if (req.method === 'POST' && route === '/api/announcement/set') {
      const payload = readJson(await readBody(req));
      const auth = await authorize(req, payload, { need: 'owner' });
      if (!auth.ok) {
        send(res, auth.status, { ok: false, error: auth.error });
        return true;
      }

      await store.setAnnouncement({
        text: payload.text,
        link: payload.link,
        updatedBy: auth.name,
      });
      const snapshot = await store.snapshot();
      send(res, 200, { ok: true, announcement: snapshot.announcement });
      return true;
    }

    if (req.method === 'POST' && route === '/api/roles/set') {
      const payload = readJson(await readBody(req));
      const auth = await authorize(req, payload, { need: 'owner' });
      if (!auth.ok) {
        send(res, auth.status, { ok: false, error: auth.error });
        return true;
      }

      const target = String(payload.target || '').trim();
      if (!target) {
        send(res, 400, { ok: false, error: 'Name the account you are ranking.' });
        return true;
      }
      /* An owner may not demote themselves out of the roster by accident -
       * with no key to fall back on, that would lock the panel entirely. */
      if (target.toLowerCase() === auth.name.toLowerCase()
        && (ROLE_RANK[String(payload.role || '')] || 0) < auth.rank) {
        send(res, 400, { ok: false, error: 'You cannot lower your own rank.' });
        return true;
      }
      /* Only the website owner may hand out or remove the website owner rank,
       * and a site owner may not promote anybody above themselves. */
      const wanted = ROLE_RANK[String(payload.role || '')] || 0;
      const existing = ROLE_RANK[await store.roleOf(target)] || 0;
      if ((wanted >= 4 || existing >= 4) && auth.rank < 4) {
        send(res, 403, { ok: false, error: 'Only the website owner may change the website owner rank.' });
        return true;
      }

      const updated = await store.setRole({
        name: target,
        role: String(payload.role || ''),
        grantedBy: auth.name,
      });
      send(res, 200, {
        ok: true,
        roles: Object.values(updated.roles).sort((a, b) => a.name.localeCompare(b.name)),
      });
      return true;
    }

    /* Give a player a badge, or take it back. Owners only. */
    if (req.method === 'POST' && route === '/api/badges/set') {
      const payload = readJson(await readBody(req));
      const auth = await authorize(req, payload, { need: 'owner' });
      if (!auth.ok) {
        send(res, auth.status, { ok: false, error: auth.error });
        return true;
      }

      const target = String(payload.target || '').trim();
      if (!target) {
        send(res, 400, { ok: false, error: 'Name the account you are awarding.' });
        return true;
      }

      await store.setBadge({
        name: target,
        badge: String(payload.badge || ''),
        /* Absent means "give it" - the panel sends false to take one back. */
        granted: payload.granted !== false,
        grantedBy: auth.name,
      });

      send(res, 200, {
        ok: true,
        name: target,
        badges: await store.badgesOf(target),
        grants: await store.badgeGrants(),
      });
      return true;
    }

    if (req.method === 'POST' && route === '/api/values/set') {
      const payload = readJson(await readBody(req));
      const auth = await authorize(req, payload, { need: 'valuer' });
      if (!auth.ok) {
        send(res, auth.status, { ok: false, error: auth.error });
        return true;
      }

      const updated = await store.setValue({
        id: payload.id,
        value: payload.value,
        demand: payload.demand,
        trend: payload.trend,
        categories: payload.categories,
        rare: payload.rare,
        /* The Valuation tab's two extra fields. Both are optional, so an
         * older client that never sends them leaves them untouched. */
        method: payload.method,
        note: payload.note,
        updatedBy: auth.name,
      });
      send(res, 200, {
        ok: true,
        id: Number(payload.id),
        item: updated.values[String(Number(payload.id))],
        updatedAt: updated.updatedAt,
      });
      return true;
    }

    /* ------------------------------------------------------- trade ads */

    if (req.method === 'GET' && route === '/api/ads') {
      /* The whole board, or one player's ads with ?creatorId=. Public: the
       * point of the board is that everybody sees the same one. */
      const rows = await store.ads({ creatorId: url.searchParams.get('creatorId') || 0 });
      send(res, 200, { ok: true, ads: rows, limit: store.ADS_PER_USER });
      return true;
    }

    if (req.method === 'GET' && route === '/api/ad') {
      const ad = await store.adById(url.searchParams.get('id') || '');
      if (!ad) {
        send(res, 404, { ok: false, error: 'That ad no longer exists.' });
        return true;
      }
      send(res, 200, { ok: true, ad });
      return true;
    }

    /*
     * Prove control of a Wanwood account and get an identity token back.
     * The phrase has to be in the profile description at the moment this is
     * called - the server reads it from Wanwood itself and does not take the
     * client's word for any of it.
     */
    if (req.method === 'POST' && route === '/api/identity') {
      const payload = readJson(await readBody(req));
      const userId = Number(payload.userId);
      const phrase = String(payload.phrase || '').trim();

      if (!Number.isSafeInteger(userId) || userId <= 0) {
        send(res, 400, { ok: false, error: 'A user id is required.' });
        return true;
      }
      /* Short phrases are not proof of anything - a two-character string
       * could be in a description by accident. */
      if (phrase.length < 8) {
        send(res, 400, { ok: false, error: 'A verification phrase is required.' });
        return true;
      }

      const profile = await fetchProfile(userId);
      if (!profile) {
        send(res, 502, { ok: false, error: 'Wanwood could not be reached. Try again.' });
        return true;
      }

      const description = String(profile.description || '');
      if (!description.toLowerCase().includes(phrase.toLowerCase())) {
        send(res, 403, {
          ok: false,
          error: 'That phrase is not in the profile description.',
        });
        return true;
      }

      const expiresAt = Date.now() + IDENTITY_TTL_MS;
      send(res, 200, {
        ok: true,
        userId,
        name: String(profile.name || '').trim(),
        token: signIdentity(userId, expiresAt),
        expiresAt,
      });
      return true;
    }

    if (req.method === 'POST' && route === '/api/ads/post') {
      const payload = readJson(await readBody(req));
      /* The creator is whoever the token says, never whoever the body says. */
      const creatorId = readIdentity(bearer(req));
      if (!creatorId) {
        send(res, 401, {
          ok: false,
          error: 'Verify your Wanwood account again before posting.',
        });
        return true;
      }

      const ad = await store.addAd({
        id: `${creatorId}-${Date.now()}`,
        creatorId,
        creatorName: payload.creatorName,
        offer: payload.offer,
        request: payload.request,
      });
      send(res, 200, { ok: true, ad });
      return true;
    }

    if (req.method === 'POST' && route === '/api/ads/delete') {
      const payload = readJson(await readBody(req));
      const creatorId = readIdentity(bearer(req));
      if (!creatorId) {
        send(res, 401, {
          ok: false,
          error: 'Verify your Wanwood account again before deleting.',
        });
        return true;
      }

      await store.removeAd({ id: payload.id, creatorId });
      send(res, 200, { ok: true, id: String(payload.id) });
      return true;
    }

    /*
     * Moderation: take any ad down, from the admin panel. The public board
     * still only lets an author delete their own ad (/api/ads/delete); this
     * path is for ranked members of the site, and the removal is recorded
     * with whoever made it.
     */
    if (req.method === 'POST' && route === '/api/ads/moderate') {
      const payload = readJson(await readBody(req));
      const auth = await authorize(req, payload, { need: 'staff' });
      if (!auth.ok) {
        send(res, auth.status, { ok: false, error: auth.error });
        return true;
      }
      const ad = await store.moderateAd({ id: payload.id, removedBy: auth.name });
      send(res, 200, { ok: true, id: ad.id });
      return true;
    }

    /*
     * Comments under profiles and trade ads.
     *
     * GET is public - the section is visible to everyone. Posting and
     * deleting your own use the same identity token as trade ads, so a
     * comment is always attached to an account the poster proved they
     * control. Moderation is a ranked write like the rest of the panel.
     */
    /* The newest comments across every page, for the panel's moderation
     * list. Comments are public anyway - this just saves asking per page. */
    if (req.method === 'GET' && route === '/api/comments/all') {
      const comments = await store.allComments({
        limit: url.searchParams.get('limit') || 200,
      });
      send(res, 200, { ok: true, comments });
      return true;
    }

    if (req.method === 'GET' && route === '/api/comments') {
      const target = String(url.searchParams.get('target') || '');
      if (!/^(player|ad):.+/.test(target)) {
        send(res, 400, { ok: false, error: 'A comment target is required.' });
        return true;
      }
      const comments = await store.commentsFor(target, {
        limit: url.searchParams.get('limit') || 200,
      });
      send(res, 200, { ok: true, target, comments });
      return true;
    }

    if (req.method === 'POST' && route === '/api/comments/post') {
      const payload = readJson(await readBody(req));
      const userId = readIdentity(bearer(req));
      if (!userId) {
        send(res, 401, {
          ok: false,
          error: 'Verify your Wanwood account again before commenting.',
        });
        return true;
      }

      /* The name is read back from Wanwood, not taken from the body - the
       * section must say who really posted. */
      const name = await verifiedName(userId);
      if (!name) {
        send(res, 502, {
          ok: false,
          error: 'Wanwood could not be reached to confirm the account. Try again.',
        });
        return true;
      }

      try {
        const comment = await store.addComment({
          target: payload.target,
          userId,
          name,
          text: payload.text,
        });
        send(res, 200, { ok: true, comment });
      } catch (error) {
        send(res, 400, { ok: false, error: error.message });
      }
      return true;
    }

    if (req.method === 'POST' && route === '/api/comments/delete') {
      const payload = readJson(await readBody(req));
      const userId = readIdentity(bearer(req));
      if (!userId) {
        send(res, 401, {
          ok: false,
          error: 'Verify your Wanwood account again before deleting.',
        });
        return true;
      }

      try {
        await store.removeComment({ id: payload.id, userId });
        send(res, 200, { ok: true, id: String(payload.id) });
      } catch (error) {
        send(res, 400, { ok: false, error: error.message });
      }
      return true;
    }

    /*
     * The inbox: every comment left on the requesting account's own profile
     * or trade ads, newest first. The account comes from the identity token,
     * never from a query parameter, so an inbox always belongs to whoever
     * proved they own it. The data itself is public - those pages show their
     * comments to everyone - this just gathers one person's in one place.
     */
    if (req.method === 'GET' && route === '/api/inbox') {
      const userId = readIdentity(bearer(req));
      if (!userId) {
        send(res, 401, {
          ok: false,
          error: 'Verify your Wanwood account to see your inbox.',
        });
        return true;
      }

      const mine = await inboxCommentsFor(userId);
      const cap = Math.min(Math.max(Number(url.searchParams.get('limit')) || 200, 1), 500);
      const lastRead = await store.getInboxRead(userId);
      const unread = mine.filter(comment => comment.at > lastRead).length;
      send(res, 200, { ok: true, comments: mine.slice(0, cap), unread, lastRead });
      return true;
    }

    /*
     * Just the unread count - cheap enough for the navbar to ask on every
     * page load so it can light the badge when something new has landed.
     */
    if (req.method === 'GET' && route === '/api/inbox/count') {
      const userId = readIdentity(bearer(req));
      if (!userId) {
        send(res, 200, { ok: true, unread: 0 });
        return true;
      }
      const mine = await inboxCommentsFor(userId);
      const lastRead = await store.getInboxRead(userId);
      const unread = mine.filter(comment => comment.at > lastRead).length;
      send(res, 200, { ok: true, unread });
      return true;
    }

    /*
     * Opening the inbox marks everything currently in it as read, so the
     * badge goes out. New comments that arrive afterwards light it again.
     */
    if (req.method === 'POST' && route === '/api/inbox/read') {
      const userId = readIdentity(bearer(req));
      if (!userId) {
        send(res, 401, {
          ok: false,
          error: 'Verify your Wanwood account to see your inbox.',
        });
        return true;
      }
      await store.setInboxRead(userId, Date.now());
      send(res, 200, { ok: true, readAt: Date.now() });
      return true;
    }

    if (req.method === 'POST' && route === '/api/comments/moderate') {
      const payload = readJson(await readBody(req));
      const auth = await authorize(req, payload, { need: 'staff' });
      if (!auth.ok) {
        send(res, auth.status, { ok: false, error: auth.error });
        return true;
      }

      try {
        await store.moderateComment({ id: payload.id, removedBy: auth.name });
        send(res, 200, { ok: true, id: String(payload.id) });
      } catch (error) {
        send(res, 400, { ok: false, error: error.message });
      }
      return true;
    }

    /*
     * Inventory share cards. The profile page draws the inventory to a canvas
     * and posts the JPEG here; we keep it under cards/ (which the static
     * server hands out like any other file) and answer with its path, so the
     * link pasted into Discord unfurls as a plain image.
     *
     * Inventories are public - the profile page already shows every copy - so
     * this is not gated. The checks are about shape and disk instead: it has
     * to be a real JPEG, it cannot be huge, and the folder is pruned so it
     * cannot grow without bound.
     */
    if (req.method === 'POST' && route === '/api/inventory-card') {
      const body = await readBody(req);
      if (!body || body.length < 1000) {
        send(res, 400, { ok: false, error: 'No image arrived.' });
        return true;
      }
      if (body.length > 3 * 1000 * 1000) {
        send(res, 400, { ok: false, error: 'That image is too large to keep.' });
        return true;
      }
      /* JPEG magic bytes - nothing else gets stored. */
      if (body[0] !== 0xff || body[1] !== 0xd8) {
        send(res, 400, { ok: false, error: 'Only JPEG images are accepted.' });
        return true;
      }

      const dir = path.join(SITE_ROOT, 'cards');
      await fsp.mkdir(dir, { recursive: true });

      /* Keep the newest four hundred; the rest are gone, oldest first. */
      const files = (await fsp.readdir(dir))
        .filter(name => name.endsWith('.jpg'))
        .map(name => ({ name, at: Number(name.split('-').pop()) || 0 }))
        .sort((a, b) => b.at - a.at);
      for (const stale of files.slice(400)) {
        await fsp.unlink(path.join(dir, stale.name)).catch(() => {});
      }

      const userId = Number(url.searchParams.get('id')) || 0;
      const name = `${userId > 0 ? userId : 'player'}-${Date.now()}.jpg`;
      await fsp.writeFile(path.join(dir, name), body);
      send(res, 200, { ok: true, url: `/cards/${name}` });
      return true;
    }

    send(res, 404, { ok: false, error: `No such endpoint: ${route}` });
    return true;
  } catch (error) {
    send(res, 400, { ok: false, error: error.message });
    return true;
  }
}

module.exports = { handle };
