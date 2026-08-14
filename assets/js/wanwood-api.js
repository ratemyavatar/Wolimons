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
    const restrictions = Array.isArray(raw.itemRestrictions) ? raw.itemRestrictions.slice() : [];
    if (raw.isLimitedUnique === true && !restrictions.includes('LimitedUnique')) {
      restrictions.push('LimitedUnique');
    } else if (raw.isLimited === true && !restrictions.length) {
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
   * One request for the whole page. Returns isLimited / isLimitedUnique,
   * which is what drives the Limited / Limited-U ribbons.
   */
  async function fetchRestrictions(ids) {
    const map = new Map();
    try {
      const query = new URLSearchParams({ assetIds: ids.join(',') });
      const result = await fetchJson(`${API_BASE}/apisite/api/v1/items/restrictions?${query}`);
      const rows = Array.isArray(result) ? result : (result.data || []);
      rows.forEach(row => {
        const id = Number(row.assetId ?? row.id);
        if (Number.isSafeInteger(id)) map.set(id, row);
      });
    } catch (error) {
      /* Ribbons are cosmetic - never fail the page over them. */
    }
    return map;
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
   * Cheapest live listing. Not shown on cards - kept because it is the only
   * way to read a real sale price if something ever needs one.
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
   *
   * The player-side twin of fetchThumbnails. Batched, and it answers with
   * absolute Wanwood CDN URLs, so the results get rewritten through the
   * proxy the same way item thumbnails are.
   *
   * Returns a Map of userId -> url. Ids the backend has no render for are
   * simply absent from the map; callers decide what to show instead.
   */
  async function fetchUserThumbnails(ids, size = 150) {
    const wanted = [...new Set(ids.map(Number).filter(Number.isSafeInteger))];
    const map = new Map();
    if (!wanted.length) return map;

    /* The endpoint takes a comma list; chunk it so one dead id or an
     * over-long URL cannot take out the whole board. */
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
          `${API_BASE}/apisite/thumbnails/v1/users/avatar?${query}`);
        const rows = Array.isArray(result.data) ? result.data : [];
        rows.forEach(row => {
          const id = Number(row.targetId ?? row.userId);
          const url = typeof row.imageUrl === 'string' ? row.imageUrl : '';
          if (Number.isSafeInteger(id) && url) map.set(id, proxied(url));
        });
      } catch (error) {
        /* Leave this chunk out of the map - the caller falls back. */
      }
    });

    return map;
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

      if (resolved) {
        resolved.forEach(item => detailCache.set(item.id, item));
      } else {
        const restrictions = await fetchRestrictions(missing);
        const built = await mapLimit(missing, CONCURRENCY, async id => {
          try {
            const info = await fetchProductInfo(id);
            const detail = normalizeDetail({ ...info, id });
            const flags = restrictions.get(id);
            if (flags) {
              detail.itemRestrictions = flags.isLimitedUnique
                ? ['LimitedUnique']
                : (flags.isLimited ? ['Limited'] : []);
            }
            return detail;
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
    fetchRap,
    fetchThumbnails,
    fetchUserThumbnails,
    thumbnailUrl,
    proxied,
    getUserById,
    getUserByUsername,
    getCollectibles,
    getCollectiblesSummary,
    mapLimit,
    isPlainObject,
  };
})();
