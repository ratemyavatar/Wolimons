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
   * GET /apisite/economy/v1/assets/{id}/resale-data -> recentAveragePrice.
   */
  function fetchRap(id) {
    const key = Number(id);
    if (!rapCache.has(key)) {
      rapCache.set(key, fetchJson(`${API_BASE}/apisite/economy/v1/assets/${key}/resale-data`)
        .then(data => toNumber(data.recentAveragePrice))
        .catch(() => null));
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

  window.WanwoodAPI = {
    API_BASE,
    SITE_BASE,
    fetchJson,
    searchItems,
    getItemDetails,
    fetchRap,
    fetchThumbnails,
    thumbnailUrl,
    proxied,
    getUserByUsername,
    getCollectibles,
    mapLimit,
    isPlainObject,
  };
})();
