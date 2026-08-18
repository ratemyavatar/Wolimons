/*
 * Shared Wanwood API client.
 *
 * Wanwood runs the BubbaBlox v2 source, which is a fork of the
 * "economy-simulator" Roblox revival codebase. That backend mounts every
 * Roblox-style service under a single origin using an /apisite/<service>/v1
 * path prefix, e.g.
 *
 *     Roblox : https://catalog.roblox.com/v1/search/items
 *     Wanwood: https://wanwoo.xyz/apisite/catalog/v1/search/items
 *
 * Two things about that backend drive the design of this file:
 *
 * 1. CSRF. A middleware rejects every non-GET/OPTIONS/HEAD request that does
 *    not carry a matching `rbxcsrf4` cookie AND `x-csrf-token` header. It
 *    answers with 403 + "Token Validation Failed". That is why the old
 *    POST /apisite/catalog/v1/catalog/items/details call always failed.
 *
 * 2. Unknown paths return the SPA HTML shell ("<!doctype html>...") with a
 *    200 status instead of a 404, so a bad path shows up as a JSON parse
 *    error rather than an HTTP error. The old fallback,
 *    GET /apisite/catalog/v1/items/details, does not exist and hit exactly
 *    this trap.
 *
 * So: prefer batched GET endpoints, which need no CSRF token at all. The
 * POST batch endpoint is still tried first because it returns everything in
 * one round trip, and the bundled proxy can perform the CSRF handshake on
 * our behalf - but we never depend on it.
 */
(() => {
  'use strict';

  const CONFIG = window.WOLIMONS_CONFIG || {};
  const API_BASE = CONFIG.apiBase || 'https://wanwoo.xyz';
  const SITE_BASE = CONFIG.siteBase || 'https://wanwoo.xyz';

  /* Wanwood only has a few dozen limiteds, so caching aggressively in-tab
   * keeps the proxy (and Render's free tier) from being hammered. */
  const detailCache = new Map();
  const rapCache = new Map();
  const thumbCache = new Map();

  /* Concurrency cap for the per-item GET fan-out. */
  const CONCURRENCY = 8;

  const isPlainObject = value =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

  async function fetchJson(url, options) {
    const response = await fetch(url, { mode: 'cors', ...options });
    if (!response.ok) throw new Error(`Wanwood API returned ${response.status}`);
    const body = await response.text();
    if (!body.trim()) throw new Error('Wanwood API returned an empty response');

    /* An unknown path on this backend serves the SPA shell with a 200.
     * Treat that as the "no such endpoint" error it really is. */
    const head = body.trimStart().slice(0, 9).toLowerCase();
    if (head.startsWith('<!doctype') || head.startsWith('<html')) {
      throw new Error('Wanwood API returned HTML instead of JSON');
    }
    return JSON.parse(body);
  }

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

  const toNumber = value => {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  };

  /* ------------------------------------------------------------------ */
  /* Search                                                              */
  /* ------------------------------------------------------------------ */

  /*
   * GET /apisite/catalog/v1/search/items
   *
   * Verified live. `cursor` is a plain numeric offset as a string and
   * `_total` carries the unpaginated count. Returns bare {itemType, id}
   * stubs - names and prices need a second call.
   */
  async function searchItems({
    category = 'Collectibles',
    subcategory = 'Collectibles',
    sortType = '3',
    keyword = '',
    limit = 30,
    cursor = 0,
  } = {}) {
    const query = new URLSearchParams({
      category,
      subcategory,
      sortType: String(sortType),
      limit: String(limit),
      cursor: String(cursor),
    });
    if (keyword) query.set('keyword', keyword);

    const result = await fetchJson(`${API_BASE}/apisite/catalog/v1/search/items?${query}`);
    const rows = Array.isArray(result.data) ? result.data : [];
    const ids = rows
      .map(item => Number(item.id ?? item.assetId))
      .filter(Number.isSafeInteger);

    return {
      ids,
      total: toNumber(result._total ?? result.total) ?? ids.length,
      nextCursor: result.nextPageCursor ?? null,
    };
  }

  /* ------------------------------------------------------------------ */
  /* Item details                                                        */
  /* ------------------------------------------------------------------ */

  function normalizeDetail(raw) {
    const id = Number(raw.id ?? raw.assetId ?? raw.AssetId ?? raw.TargetId);

    /* Whatever the payload happens to carry. Wanwood reports the two
     * booleans; the Roblox-shaped array is accepted for completeness. Both
     * are provisional - getItemDetails overwrites them with the answer from
     * api/v1/items/restrictions, which is the authoritative source. */
    const restrictions = Array.isArray(raw.itemRestrictions) ? raw.itemRestrictions.slice() : [];
    const isLimitedUnique = raw.isLimitedUnique === true
      || restrictions.includes('LimitedUnique');
    const isLimited = isLimitedUnique
      || raw.isLimited === true
      || restrictions.includes('Limited');
    if (isLimitedUnique && !restrictions.includes('LimitedUnique')) {
      restrictions.push('LimitedUnique');
    } else if (isLimited && !restrictions.length) {
      restrictions.push('Limited');
    }

    return {
      id,
      name: String(raw.name ?? raw.Name ?? '').trim(),
      /* Only productinfo carries these two; the POST batch omits them, so
       * they are empty rather than absent. The item page uses them, the
       * cards do not. */
      description: String(raw.description ?? raw.Description ?? '').trim(),
      creatorName: String(raw.Creator?.Name ?? raw.creator?.name ?? '').trim(),
      assetType: toNumber(raw.assetType ?? raw.AssetTypeId),
      /* Three views of the same fact, kept in sync by applyRestrictions. */
      isLimited,
      isLimitedUnique,
      itemRestrictions: restrictions,
      isForSale: Boolean(raw.isForSale ?? raw.IsForSale),
      price: toNumber(raw.price ?? raw.priceRobux),
      lowestPrice: toNumber(raw.lowestPrice),
      serialCount: toNumber(raw.serialCount),
      saleCount: toNumber(raw.saleCount),
      unitsAvailableForConsumption: toNumber(raw.unitsAvailableForConsumption),
      rap: null,
      thumbnail: '',
    };
  }

  /*
   * POST /apisite/catalog/v1/catalog/items/details - the fast path.
   * Blocked by the CSRF middleware unless something upstream performs the
   * token handshake, so failure here is expected and non-fatal.
   */
  async function tryBatchDetails(ids) {
    const result = await fetchJson(`${API_BASE}/apisite/catalog/v1/catalog/items/details`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: ids.map(id => ({ itemType: 'Asset', id })) }),
    });
    const rows = Array.isArray(result.data) ? result.data : [];
    if (!rows.length) throw new Error('Empty details batch');
    return rows.map(normalizeDetail);
  }

  /*
   * GET /apisite/api/v1/items/restrictions?assetIds=1,2,3
   *
   * -> [ { assetId, isLimited, isLimitedUnique } ]
   *
   * This is the ONLY authoritative answer to "is this Limited or Limited U".
   * It reads asset.is_limited / asset.is_limited_unique directly, so nothing
   * in this codebase may infer the distinction some other way (a serial
   * number, for instance, is not a reliable stand-in). Every surface that
   * draws a ribbon routes through here.
   *
   * The endpoint caps at 200 ids per call, so longer lists are chunked.
   * Answers are cached for the life of the page - an item does not change
   * between Limited and Limited U.
   */
  const RESTRICTION_CHUNK = 200;
  const restrictionCache = new Map();

  async function getItemRestrictions(ids) {
    const unique = [...new Set(ids.map(Number).filter(Number.isSafeInteger))];
    const missing = unique.filter(id => !restrictionCache.has(id));

    for (let index = 0; index < missing.length; index += RESTRICTION_CHUNK) {
      const chunk = missing.slice(index, index + RESTRICTION_CHUNK);
      try {
        const query = new URLSearchParams({ assetIds: chunk.join(',') });
        const result = await fetchJson(
          `${API_BASE}/apisite/api/v1/items/restrictions?${query}`);
        const rows = Array.isArray(result) ? result : (result.data || []);
        rows.forEach(row => {
          const id = Number(row.assetId ?? row.id);
          if (!Number.isSafeInteger(id)) return;
          /* Two shapes are in the wild: a pair of booleans, or the array form
           * the catalog endpoints use. Reading both means a page gets the
           * right ribbon whichever one this deployment happens to answer
           * with, instead of quietly falling back to "not limited". */
          const list = Array.isArray(row.itemRestrictions) ? row.itemRestrictions : [];
          const isLimitedUnique = Boolean(row.isLimitedUnique) || list.includes('LimitedUnique');
          restrictionCache.set(id, {
            isLimited: Boolean(row.isLimited) || isLimitedUnique || list.includes('Limited'),
            isLimitedUnique,
          });
        });
      } catch (error) {
        /* Ribbons are cosmetic - never fail a page over them. Leaving the
         * id uncached lets a later call retry it. */
      }
    }

    const map = new Map();
    unique.forEach(id => {
      const flags = restrictionCache.get(id);
      if (flags) map.set(id, flags);
    });
    return map;
  }

  /* Stamp the flags onto a detail record, in both shapes: the booleans the
   * backend actually reports, and the Roblox-style itemRestrictions array. */
  function applyRestrictions(detail, flags) {
    if (!detail || !flags) return detail;
    detail.isLimited = flags.isLimited;
    detail.isLimitedUnique = flags.isLimitedUnique;
    detail.itemRestrictions = flags.isLimitedUnique
      ? ['LimitedUnique']
      : (flags.isLimited ? ['Limited'] : []);
    return detail;
  }

  /*
   * GET /apisite/api/marketplace/productinfo?assetId=N
   * The GET twin of the CSRF-protected details endpoint. One asset per
   * call, so this is the expensive part of the fallback path.
   */
  async function fetchProductInfo(id) {
    return fetchJson(`${API_BASE}/apisite/api/marketplace/productinfo?assetId=${id}`);
  }

  /*
   * GET /apisite/economy/v1/assets/{id}/resellers?limit=1
   *
   * The cheapest copy currently listed for sale. This is a *price*, not a
   * value: it is what one seller is asking today, and it has nothing to do
   * with the community's valuation of the item. It is deliberately absent
   * from every item card for exactly that reason.
   *
   * No page on the site calls it at present. It stays here because it is a
   * real endpoint of the API this client wraps, but anything that does start
   * using it must label the number "Price" and never pass it off as a value.
   *
   * Returns null when nothing is listed, which is the normal case for most
   * collectibles.
   */
  async function fetchLowestPrice(id) {
    try {
      const result = await fetchJson(
        `${API_BASE}/apisite/economy/v1/assets/${id}/resellers?limit=1`);
      const rows = Array.isArray(result.data) ? result.data : [];
      return rows.length ? toNumber(rows[0].price) : null;
    } catch (error) {
      return null;
    }
  }

  /*
   * The cheapest listing for a batch of assets, as a Map of id -> price.
   *
   * One request per asset, so this is only ever called with the catalog's few
   * dozen collectibles and never with anything unbounded. Assets with nothing
   * for sale are simply absent from the map.
   */
  async function fetchLowestPrices(ids) {
    const wanted = [...new Set((ids || [])
      .map(Number)
      .filter(id => Number.isSafeInteger(id) && id > 0))];

    const prices = new Map();
    await mapLimit(wanted, CONCURRENCY, async id => {
      const price = await fetchLowestPrice(id);
      if (price !== null && price > 0) prices.set(id, price);
    });
    return prices;
  }

  /*
   * RAP is one request per asset and every page wants the same few dozen
   * numbers, so the in-tab memo above is backed by sessionStorage. The
   * catalog, the item page and the leaderboard then share one set of
   * resale-data calls instead of each paying for its own.
   */
  const RAP_STORE_KEY = 'wolimons_rap_v1';
  const RAP_TTL_MS = 10 * 60 * 1000;

  function readRapStore() {
    try {
      const raw = sessionStorage.getItem(RAP_STORE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (!isPlainObject(parsed) || !isPlainObject(parsed.rap)) return {};
      if (!(Date.now() - Number(parsed.at) < RAP_TTL_MS)) return {};
      return parsed.rap;
    } catch (error) {
      return {};
    }
  }

  function writeRapStore(id, value) {
    try {
      const rap = readRapStore();
      rap[id] = value;
      sessionStorage.setItem(RAP_STORE_KEY, JSON.stringify({ at: Date.now(), rap }));
    } catch (error) {
      /* Private mode or a full quota - the in-memory memo still applies. */
    }
  }

  /*
   * GET /apisite/economy/v1/assets/{id}/resale-data -> recentAveragePrice.
   */
  function fetchRap(id) {
    const key = Number(id);
    if (!rapCache.has(key)) {
      const stored = readRapStore()[key];
      if (typeof stored === 'number') {
        rapCache.set(key, Promise.resolve(stored));
      } else {
        /* A Cloudflare blip here is not "this item is worth nothing" - and
         * because the result is memoised, one failure would zero the item out
         * for every holder on the leaderboard. So retry before giving up. */
        rapCache.set(key, (async () => {
          for (let attempt = 0; attempt <= 2; attempt += 1) {
            try {
              const data = await fetchJson(`${API_BASE}/apisite/economy/v1/assets/${key}/resale-data`);
              const rap = toNumber(data.recentAveragePrice);
              if (rap !== null) writeRapStore(key, rap);
              return rap;
            } catch (error) {
              if (attempt === 2) return null;
              await new Promise(resolve => setTimeout(resolve, 300 * (attempt + 1)));
            }
          }
          return null;
        })());
      }
    }
    return rapCache.get(key);
  }

  /*
   * The same resale-data document that fetchRap reads also carries the daily
   * price/volume series the player page charts. fetchRap throws the rest away,
   * so the chart would re-request every asset a second time - this keeps the
   * whole envelope instead, under its own key so the two caches can expire
   * independently.
   */
  const RESALE_STORE_KEY = 'wolimons_resale_v1';
  const RESALE_TTL_MS = 10 * 60 * 1000;
  const resaleCache = new Map();

  function readResaleStore() {
    try {
      const raw = sessionStorage.getItem(RESALE_STORE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (!isPlainObject(parsed) || !isPlainObject(parsed.resale)) return {};
      if (!(Date.now() - Number(parsed.at) < RESALE_TTL_MS)) return {};
      return parsed.resale;
    } catch (error) {
      return {};
    }
  }

  function writeResaleStore(id, value) {
    try {
      const resale = readResaleStore();
      resale[id] = value;
      sessionStorage.setItem(RESALE_STORE_KEY,
        JSON.stringify({ at: Date.now(), resale }));
    } catch (error) {
      /* The series can be large; a quota error just means no warm cache. */
    }
  }

  /* Only the fields the chart needs, so a big inventory does not blow the
   * sessionStorage quota storing sale logs nobody reads. */
  function normalizeResale(data) {
    const points = Array.isArray(data.priceDataPoints) ? data.priceDataPoints : [];
    const volume = Array.isArray(data.volumeDataPoints) ? data.volumeDataPoints : [];
    const clean = rows => rows
      .map(row => {
        if (!isPlainObject(row)) return null;
        const value = toNumber(row.value);
        const date = typeof row.date === 'string' ? row.date : null;
        if (value === null || !date) return null;
        const time = Date.parse(date);
        if (!Number.isFinite(time)) return null;
        return { time, value };
      })
      .filter(Boolean)
      .sort((a, b) => a.time - b.time);
    return {
      recentAveragePrice: toNumber(data.recentAveragePrice),
      originalPrice: toNumber(data.originalPrice),
      assetStock: toNumber(data.assetStock),
      numberRemaining: toNumber(data.numberRemaining),
      sales: toNumber(data.sales),
      priceDataPoints: clean(points),
      volumeDataPoints: clean(volume),
    };
  }

  /*
   * GET /apisite/economy/v1/assets/{id}/resale-data
   * -> {sales, recentAveragePrice, priceDataPoints[], volumeDataPoints[], ...}
   * Same retry-before-caching rule as fetchRap: a memoised transient failure
   * would silently flatten this asset out of the player's history chart.
   */
  function fetchResaleData(id) {
    const key = Number(id);
    if (!Number.isSafeInteger(key) || key <= 0) return Promise.resolve(null);
    if (!resaleCache.has(key)) {
      const stored = readResaleStore()[key];
      if (isPlainObject(stored)) {
        resaleCache.set(key, Promise.resolve(stored));
      } else {
        resaleCache.set(key, (async () => {
          for (let attempt = 0; attempt <= 2; attempt += 1) {
            try {
              const data = await fetchJson(
                `${API_BASE}/apisite/economy/v1/assets/${key}/resale-data`);
              if (!isPlainObject(data)) return null;
              const clean = normalizeResale(data);
              writeResaleStore(key, clean);
              /* Feed the RAP memo too - same document, one round trip. */
              if (clean.recentAveragePrice !== null && !rapCache.has(key)) {
                rapCache.set(key, Promise.resolve(clean.recentAveragePrice));
              }
              return clean;
            } catch (error) {
              if (attempt === 2) return null;
              await new Promise(resolve => setTimeout(resolve, 300 * (attempt + 1)));
            }
          }
          return null;
        })());
      }
    }
    return resaleCache.get(key);
  }

  /*
   * GET /apisite/thumbnails/v1/assets?assetIds=1,2,3
   * Batched, and returns real CDN URLs. Those URLs point at the Wanwood
   * origin, so they are rewritten through the proxy for consistency with
   * everything else the page loads.
   */
  async function fetchThumbnails(ids) {
    const wanted = ids.map(Number).filter(id => !thumbCache.has(id));
    if (wanted.length) {
      try {
        const query = new URLSearchParams({ assetIds: wanted.join(',') });
        const result = await fetchJson(`${API_BASE}/apisite/thumbnails/v1/assets?${query}`);
        const rows = Array.isArray(result.data) ? result.data : [];
        rows.forEach(row => {
          const id = Number(row.targetId ?? row.assetId);
          if (!Number.isSafeInteger(id)) return;
          const url = typeof row.imageUrl === 'string' ? row.imageUrl : '';
          thumbCache.set(id, url ? proxied(url) : thumbnailUrl(id));
        });
      } catch (error) {
        /* Fall through to the redirect endpoint below. */
      }
    }
    const map = new Map();
    ids.map(Number).forEach(id => map.set(id, thumbCache.get(id) || thumbnailUrl(id)));
    return map;
  }

  /*
   * GET /apisite/thumbnails/v1/users/avatar
   * GET /apisite/thumbnails/v1/users/avatar-headshot
   *
   * The player-side twin of fetchThumbnails. Batched, and it answers with
   * absolute Wanwood CDN URLs, so the results get rewritten through the
   * proxy the same way item thumbnails are.
   *
   * Both routes are declared in the backend as
   * GetUserThumbnails(string userIds) / GetUserHeadshots(string userIds):
   * `userIds` is the only bound parameter, so size and format are accepted
   * by the URL but ignored by the server - the render is whatever was
   * already produced for that avatar. The renders land side by side, e.g.
   * .../images/thumbnails/<hash>.png and <hash>_headshot.png.
   *
   * The controller rejects more than 200 ids in one call; the chunk below
   * is far under that so one dead id cannot take out a whole board.
   *
   * Returns a Map of userId -> url. Ids the backend has no render for are
   * simply absent from the map; callers decide what to show instead.
   */
  async function fetchUserRenders(ids, route, size) {
    const wanted = [...new Set(ids.map(Number).filter(Number.isSafeInteger))];
    const map = new Map();
    if (!wanted.length) return map;

    const CHUNK = 25;
    const chunks = [];
    for (let at = 0; at < wanted.length; at += CHUNK) {
      chunks.push(wanted.slice(at, at + CHUNK));
    }

    await mapLimit(chunks, 4, async chunk => {
      try {
        const query = new URLSearchParams({
          userIds: chunk.join(','),
          size: `${size}x${size}`,
          format: 'Png',
        });
        const result = await fetchJson(
          `${API_BASE}/apisite/thumbnails/v1/users/${route}?${query}`);
        const rows = Array.isArray(result.data) ? result.data : [];
        rows.forEach(row => {
          const id = Number(row.targetId ?? row.userId);
          const url = typeof row.imageUrl === 'string' ? row.imageUrl : '';
          /* A blocked avatar comes back as a real row pointing at the
           * backend's placeholder; treat it as "no render" so the caller
           * shows its own fallback instead of a broken-looking image. */
          if (!Number.isSafeInteger(id) || !url) return;
          if (url.endsWith('/img/blocked.png')) return;
          map.set(id, proxied(url));
        });
      } catch (error) {
        /* Leave this chunk out of the map - the caller falls back. */
      }
    });

    return map;
  }

  /* Full-body avatar renders. */
  function fetchUserThumbnails(ids, size = 150) {
    return fetchUserRenders(ids, 'avatar', size);
  }

  /* Head-and-shoulders renders - what a small circular profile picture
   * wants, since a full body shrunk to 24px is mostly empty space. */
  function fetchUserHeadshots(ids, size = 150) {
    return fetchUserRenders(ids, 'avatar-headshot', size);
  }

  /*
   * A headshot with a full-body fallback, for the single-avatar case.
   *
   * Not every account has a headshot render even when it has a body one,
   * so this asks for both and prefers the headshot. Returns null when the
   * backend has neither.
   */
  async function fetchUserAvatar(id, { size = 150, preferHeadshot = true } = {}) {
    const userId = Number(id);
    if (!Number.isSafeInteger(userId) || userId <= 0) return null;
    const [headshots, bodies] = await Promise.all([
      preferHeadshot ? fetchUserHeadshots([userId], size) : Promise.resolve(new Map()),
      fetchUserThumbnails([userId], size),
    ]);
    return headshots.get(userId) || bodies.get(userId) || null;
  }

  /*
   * GET /apisite/api/users/{id}
   *
   * Returns {Id, Username, ...}. A missing account answers with
   * {"errors":[...]} and a 200, so the shape has to be checked rather than
   * the status code. Resolves to null for anything that is not a real user.
   */
  async function getUserById(id, { retries = 2 } = {}) {
    const userId = Number(id);
    if (!Number.isSafeInteger(userId) || userId <= 0) return null;

    /* Retried for the same reason as getCollectiblesSummary: a Cloudflare 502
     * is not evidence that the account is missing. */
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const result = await fetchJson(`${API_BASE}/apisite/api/users/${userId}`);
        if (!isPlainObject(result) || Array.isArray(result.errors)) return null;
        const name = String(result.Username ?? result.username ?? '').trim();
        /* Deleted/never-created ids come back with a literal "?" username. */
        if (!name || name === '?') return null;
        return { id: userId, name };
      } catch (error) {
        if (attempt === retries) return null;
        await new Promise(resolve => setTimeout(resolve, 400 * (attempt + 1)));
      }
    }
    return null;
  }

  /*
   * GET /apisite/users/v1/users/{id} -> the account's own verified flag.
   *
   * This is the only endpoint that reports it. The batch calls
   * (POST users/v1/users, api/users/{id}) leave the field out entirely, so a
   * verified badge costs one request per player and there is no way around
   * it - hence the cache, which makes paging back and forth free.
   *
   * Anything that fails answers false. A badge is never shown on a guess.
   */
  const verifiedCache = new Map();

  async function isUserVerified(id) {
    const userId = Number(id);
    if (!Number.isSafeInteger(userId) || userId <= 0) return false;
    if (verifiedCache.has(userId)) return verifiedCache.get(userId);

    let verified = false;
    try {
      const result = await fetchJson(`${API_BASE}/apisite/users/v1/users/${userId}`);
      verified = isPlainObject(result) && result.isVerified === true;
    } catch (error) {
      verified = false;
    }

    verifiedCache.set(userId, verified);
    return verified;
  }

  /*
   * GET /apisite/users/v1/users/{id} -> the account's profile document, the
   * same one the server reads when it confirms a commenter's name. Carries
   * .name and .isVerified. getUserById's api/users/{id} route occasionally
   * comes back empty for real accounts, so anything that must not be wrong -
   * the item-page creator, for one - resolves through this endpoint instead.
   */
  async function getProfileById(id) {
    const userId = Number(id);
    if (!Number.isSafeInteger(userId) || userId <= 0) return null;
    try {
      const result = await fetchJson(`${API_BASE}/apisite/users/v1/users/${userId}`);
      if (!isPlainObject(result)) return null;
      const name = String(result.name ?? result.Name ?? result.username ?? '').trim();
      if (!name || name === '?') return null;
      return { id: userId, name, verified: result.isVerified === true };
    } catch (error) {
      return null;
    }
  }

  /* The same thing for a handful of ids at once. Only ever call this with the
   * players actually on screen - it is one request each. */
  async function fetchVerifiedFlags(ids) {
    const wanted = [...new Set((ids || [])
      .map(Number)
      .filter(id => Number.isSafeInteger(id) && id > 0))];

    const flags = new Map();
    await mapLimit(wanted, CONCURRENCY, async id => {
      flags.set(id, await isUserVerified(id));
    });
    return flags;
  }

  /* Rewrite an absolute Wanwood URL so it travels through the proxy. */
  function proxied(url) {
    try {
      const parsed = new URL(url, SITE_BASE);
      return `${API_BASE}${parsed.pathname}${parsed.search}`;
    } catch (error) {
      return url;
    }
  }

  /* GET /asset-thumbnail/image?assetId=N - 302s to the real image. */
  function thumbnailUrl(id, size = 420) {
    return `${API_BASE}/asset-thumbnail/image?assetId=${id}&width=${size}&height=${size}&format=png`;
  }

  /*
   * Resolve full detail records for a list of asset ids, in the order given.
   * Tries the single-request POST batch, then falls back to composing the
   * same information out of GET endpoints.
   *
   * `includePrice` is off by default: the cards show Value (community-set,
   * see values.js) and RAP, never the live shop price, so paying for a
   * per-item resellers lookup would be wasted round trips.
   */
  async function getItemDetails(ids, { includePrice = false, includeRap = true } = {}) {
    const unique = [...new Set(ids.map(Number).filter(Number.isSafeInteger))];
    if (!unique.length) return [];

    const missing = unique.filter(id => !detailCache.has(id));

    if (missing.length) {
      let resolved = null;
      try {
        resolved = await tryBatchDetails(missing);
      } catch (batchError) {
        resolved = null;
      }

      /* The Limited / Limited U distinction comes from the API, never from
       * a guess, so ask for it on BOTH paths. productinfo omits the flags
       * entirely and the details batch has been seen to drop them, which is
       * how Limited U items used to render a plain Limited ribbon. */
      const restrictions = await getItemRestrictions(missing);

      if (resolved) {
        resolved.forEach(item => {
          applyRestrictions(item, restrictions.get(item.id));
          detailCache.set(item.id, item);
        });
      } else {
        const built = await mapLimit(missing, CONCURRENCY, async id => {
          try {
            const detail = normalizeDetail({ ...(await fetchProductInfo(id)), id });
            return applyRestrictions(detail, restrictions.get(id));
          } catch (error) {
            return null;
          }
        });
        built.forEach(item => {
          if (item && item.name) detailCache.set(item.id, item);
        });
      }
    }

    const found = unique.map(id => detailCache.get(id)).filter(Boolean);
    if (!found.length) {
      throw new Error('Wanwood returned no item details');
    }

    /* Enrich with the numbers the cards display. Both are per-item GETs, so
     * they run against the same concurrency cap and are cached. */
    if (includeRap) {
      const raps = await Promise.all(found.map(item => fetchRap(item.id)));
      found.forEach((item, index) => { item.rap = raps[index]; });
    }
    if (includePrice) {
      const needPrice = found.filter(item => item.lowestPrice === null && item.price === null);
      const prices = await mapLimit(needPrice, CONCURRENCY, item => fetchLowestPrice(item.id));
      needPrice.forEach((item, index) => { item.lowestPrice = prices[index]; });
    }

    const thumbs = await fetchThumbnails(found.map(item => item.id));
    found.forEach(item => { item.thumbnail = thumbs.get(item.id) || thumbnailUrl(item.id); });

    return found;
  }

  /* ------------------------------------------------------------------ */
  /* Users / inventory                                                   */
  /* ------------------------------------------------------------------ */

  /*
   * GET /apisite/api/users/get-by-username?username=NAME
   * The GET alternative to POST /apisite/users/v1/usernames/users, which is
   * CSRF-protected. Returns {Id, Username, ...}.
   */
  async function getUserByUsername(username) {
    const query = new URLSearchParams({ username });
    const result = await fetchJson(`${API_BASE}/apisite/api/users/get-by-username?${query}`);
    const id = Number(result.Id ?? result.id);
    if (!Number.isSafeInteger(id) || id <= 0) {
      throw new Error(`No Wanwood player named "${username}"`);
    }
    return { id, name: String(result.Username ?? result.name ?? username) };
  }

  /*
   * GET /apisite/groups/v1/groups/search?keyword=&limit=
   *
   * -> { keyword, previousPageCursor, nextPageCursor,
   *      data: [ { id, name, description, created, updated, memberCount,
   *                publicEntryAllowed } ] }
   *
   * Wanwood really does expose group search (GroupsControllerV1.SearchGroups),
   * unlike player search, which has no endpoint at all. It can be switched off
   * server-side by the GroupsEnabled feature flag, in which case this throws
   * and the caller reports it rather than inventing results.
   */
  async function searchGroups(keyword, { limit = 12 } = {}) {
    const term = String(keyword || '').trim();
    if (!term) return [];
    const query = new URLSearchParams({ keyword: term, limit: String(limit) });
    const result = await fetchJson(`${API_BASE}/apisite/groups/v1/groups/search?${query}`);
    const rows = Array.isArray(result && result.data) ? result.data : [];
    return rows
      .map(raw => {
        if (!isPlainObject(raw)) return null;
        const id = Number(raw.id);
        const name = String(raw.name ?? '').trim();
        if (!Number.isSafeInteger(id) || id <= 0 || !name) return null;
        return {
          id,
          name,
          description: String(raw.description ?? '').trim(),
          memberCount: toNumber(raw.memberCount),
        };
      })
      .filter(Boolean);
  }

  /*
   * GET /apisite/thumbnails/v1/groups/icons?groupIds=1,2&size=150x150
   * Same shape as the user and asset thumbnail endpoints.
   */
  async function fetchGroupIcons(ids, size = 150) {
    const wanted = [...new Set(ids.map(Number).filter(Number.isSafeInteger))];
    const icons = new Map();
    if (!wanted.length) return icons;
    try {
      const query = new URLSearchParams({
        groupIds: wanted.join(','),
        size: `${size}x${size}`,
        format: 'Png',
      });
      const result = await fetchJson(`${API_BASE}/apisite/thumbnails/v1/groups/icons?${query}`);
      const rows = Array.isArray(result && result.data) ? result.data : [];
      rows.forEach(row => {
        const id = Number(row.targetId);
        const url = typeof row.imageUrl === 'string' ? row.imageUrl : '';
        if (Number.isSafeInteger(id) && url) icons.set(id, proxied(url));
      });
    } catch (error) {
      /* An icon is decoration - the cards render fine without one. */
    }
    return icons;
  }

  /*
   * GET /apisite/inventory/v1/users/{id}/assets/collectibles
   * Paginated with a numeric-offset cursor. Rows already carry name,
   * assetId and recentAveragePrice.
   */
  async function getCollectibles(userId, { pageLimit = 100, maxPages = 20 } = {}) {
    const collected = [];
    let cursor = '';
    for (let page = 0; page < maxPages; page += 1) {
      const query = new URLSearchParams({ limit: String(pageLimit), sortOrder: 'Asc' });
      if (cursor) query.set('cursor', cursor);
      const result = await fetchJson(
        `${API_BASE}/apisite/inventory/v1/users/${userId}/assets/collectibles?${query}`);
      const rows = Array.isArray(result.data) ? result.data : [];
      collected.push(...rows);
      cursor = result.nextPageCursor || '';
      if (!cursor) break;
    }
    return collected;
  }

  /*
   * One page of the same collectibles endpoint, kept for callers that need
   * the envelope rather than the rows - notably `totalRap`, which
   * getCollectibles() throws away.
   *
   * Deliberately a single request: this is for showing one player's headline
   * numbers, not for paging through a whole inventory.
   *
   * Resolves to null when the player does not exist or has nothing.
   */
  async function getCollectiblesSummary(userId, { pageLimit = 100, retries = 2 } = {}) {
    const id = Number(userId);
    if (!Number.isSafeInteger(id) || id <= 0) return null;

    const query = new URLSearchParams({ limit: String(pageLimit), sortOrder: 'Asc' });
    const url = `${API_BASE}/apisite/inventory/v1/users/${id}/assets/collectibles?${query}`;

    /* Wanwood sits behind Cloudflare and throws the occasional 502 under
     * load. A caller scanning the whole user range would read that as "this
     * player does not exist" and quietly drop them, so transport failures get
     * a couple of backed-off retries. A well-formed error body is a real
     * answer and returns null immediately. */
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const result = await fetchJson(url);
        if (!isPlainObject(result) || Array.isArray(result.errors)) return null;
        const rows = Array.isArray(result.data) ? result.data : [];
        return {
          id,
          rows,
          itemCount: rows.length,
          totalRap: toNumber(result.totalRap) ?? 0,
          hasMore: Boolean(result.nextPageCursor),
        };
      } catch (error) {
        if (attempt === retries) return null;
        await new Promise(resolve => setTimeout(resolve, 400 * (attempt + 1)));
      }
    }
    return null;
  }

  /* ------------------------------------------------------------------ */
  /* Ownership                                                           */
  /* ------------------------------------------------------------------ */

  /*
   * Every collectible on the site, as a flat list of asset ids.
   *
   * searchItems() is capped at 100 rows per call by the backend
   * (catalog/v1/search/items clamps limit to 1..100), so this pages until the
   * cursor runs out. Wanwood has a few dozen limiteds total, which means one
   * or two requests in practice.
   */
  async function listAllCollectibles({ pageLimit = 100, maxPages = 10 } = {}) {
    const ids = [];
    const seen = new Set();
    let cursor = 0;

    for (let page = 0; page < maxPages; page += 1) {
      const result = await searchItems({ limit: pageLimit, cursor });
      result.ids.forEach(id => {
        if (seen.has(id)) return;
        seen.add(id);
        ids.push(id);
      });

      /* The cursor is a numeric offset. A short page is the last page. */
      if (!result.nextCursor || result.ids.length < pageLimit) break;
      const next = toNumber(result.nextCursor);
      if (next === null || next <= cursor) break;
      cursor = next;
    }

    return ids;
  }

  /*
   * GET /apisite/inventory/v2/assets/{assetId}/owners
   *     ?limit=<1..100>&cursor=<offset>&sortOrder=asc|desc
   *
   * -> { previousPageCursor, nextPageCursor, data: [ {
   *        id, serialNumber, created, updated,
   *        owner: { id, type: "User", name } | null
   *      } ] }
   *
   * `id` on the row is the UserAssetId - the identity of that one copy, not
   * of the item - which is the thing /luckycat is about.
   *
   * One row per *copy*, so a player holding three of an item appears three
   * times. `owner` is nulled out when that player's inventory is private or
   * their account is gone - those rows are skipped rather than counted.
   *
   * `nextPageCursor` is a plain integer offset (offset + limit) and goes null
   * on the last page, so the walk is a straight offset loop.
   */
  async function getAssetOwners(assetId, { pageLimit = 100, maxPages = 40, retries = 2 } = {}) {
    const id = Number(assetId);
    if (!Number.isSafeInteger(id) || id <= 0) return [];

    const owners = [];
    let cursor = 0;

    for (let page = 0; page < maxPages; page += 1) {
      const query = new URLSearchParams({
        limit: String(pageLimit),
        cursor: String(cursor),
        sortOrder: 'asc',
      });
      const url = `${API_BASE}/apisite/inventory/v2/assets/${id}/owners?${query}`;

      let result = null;
      /* Cloudflare in front of Wanwood throws the occasional 502. Dropping a
       * whole asset on one blip would silently understate every holder of it,
       * so transport failures get a couple of backed-off retries. */
      for (let attempt = 0; attempt <= retries; attempt += 1) {
        try {
          result = await fetchJson(url);
          break;
        } catch (error) {
          if (attempt === retries) return owners;
          await new Promise(resolve => setTimeout(resolve, 400 * (attempt + 1)));
        }
      }

      if (!isPlainObject(result) || Array.isArray(result.errors)) break;
      const rows = Array.isArray(result.data) ? result.data : [];

      rows.forEach(row => {
        const owner = isPlainObject(row) ? row.owner : null;
        if (!isPlainObject(owner)) return;
        const ownerId = Number(owner.id);
        if (!Number.isSafeInteger(ownerId) || ownerId <= 0) return;
        owners.push({
          userId: ownerId,
          name: typeof owner.name === 'string' ? owner.name : '',
          serialNumber: toNumber(row.serialNumber),
          /* The row id IS the copy's UAID, and the two timestamps say when
           * that copy was created and when it last moved. The leaderboard
           * only counts holders and ignores all three, but /luckycat has to
           * name one exact copy, so they are carried through rather than
           * dropped. */
          userAssetId: toNumber(row.id),
          created: typeof row.created === 'string' ? row.created : null,
          updated: typeof row.updated === 'string' ? row.updated : null,
        });
      });

      if (result.nextPageCursor === null || result.nextPageCursor === undefined) break;
      const next = toNumber(result.nextPageCursor);
      if (next === null || next <= cursor) break;
      cursor = next;
    }

    return owners;
  }

  /*
   * POST /apisite/users/v1/users  {"userIds":[...]}  ->  {data:[{id,name,...}]}
   *
   * Accepts up to 200 ids per call. This backend gates every non-GET request
   * behind a CSRF token, so the call can legitimately fail with a 403 - it is
   * only ever used to fill in names the owners walk did not already provide,
   * and callers treat a failure as "no extra names".
   */
  async function getUsersByIds(userIds, { chunkSize = 100 } = {}) {
    const names = new Map();
    const ids = [...new Set(
      (userIds || []).map(Number).filter(id => Number.isSafeInteger(id) && id > 0),
    )];
    if (!ids.length) return names;

    const chunks = [];
    for (let index = 0; index < ids.length; index += chunkSize) {
      chunks.push(ids.slice(index, index + chunkSize));
    }

    await mapLimit(chunks, 2, async chunk => {
      try {
        const result = await fetchJson(`${API_BASE}/apisite/users/v1/users`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userIds: chunk }),
        });
        const rows = Array.isArray(result && result.data) ? result.data : [];
        rows.forEach(row => {
          if (!isPlainObject(row)) return;
          const id = Number(row.id);
          const name = row.name ?? row.username ?? row.Username;
          if (Number.isSafeInteger(id) && typeof name === 'string' && name) {
            names.set(id, name);
          }
        });
      } catch (error) {
        /* CSRF-gated or unreachable - callers fall back to per-id GETs. */
      }
    });

    return names;
  }

  window.WanwoodAPI = {
    API_BASE,
    SITE_BASE,
    fetchJson,
    searchItems,
    listAllCollectibles,
    getAssetOwners,
    getUsersByIds,
    getItemDetails,
    getItemRestrictions,
    fetchRap,
    fetchResaleData,
    fetchLowestPrice,
    fetchLowestPrices,
    fetchThumbnails,
    fetchUserThumbnails,
    fetchUserHeadshots,
    fetchUserAvatar,
    thumbnailUrl,
    proxied,
    getUserById,
    getUserByUsername,
    getProfileById,
    isUserVerified,
    fetchVerifiedFlags,
    searchGroups,
    fetchGroupIcons,
    getCollectibles,
    getCollectiblesSummary,
    mapLimit,
    isPlainObject,
  };
})();
