/*
 * Wolimons - the tracked player roster.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 * ---------------------------------------------------------------------------
 * Two pages need the same list of players: /leaderboard ranks it, and
 * /players lets you browse and search it. The scan that produces that list is
 * the expensive part of both pages, so it lives here once instead of being
 * copied into each of them, and both pages share a single cache entry - so
 * arriving at one of them after the other is instant.
 *
 * ---------------------------------------------------------------------------
 * WHERE THE ROSTER COMES FROM
 * ---------------------------------------------------------------------------
 * Wanwood has no user-search endpoint and no leaderboard endpoint, so the
 * roster has to be derived. It is built from the *items* side rather than the
 * users side:
 *
 *     GET /apisite/catalog/v1/search/items?category=Collectibles&...
 *         -> every collectible on the site (a few dozen, 1-2 requests)
 *
 *     GET /apisite/inventory/v2/assets/{assetId}/owners?limit=100&cursor=N
 *         -> { data: [ { serialNumber, owner: { id, name } | null } ] }
 *            one row per copy, and each row already carries the owner's
 *            *name* - so nothing needs a follow-up user lookup
 *
 *     GET /apisite/economy/v1/assets/{assetId}/resale-data
 *         -> recentAveragePrice, fetched once per asset and reused for every
 *            holder of it
 *
 * Anyone who owns a collectible shows up in some asset's owners list, so the
 * union of those lists *is* the set of known players - no id guessing. The
 * cost is bounded by the catalog, not by the size of the user base: roughly
 * two requests per collectible, independent of how many accounts exist.
 *
 * Rows whose `owner` is null - private inventories, terminated accounts - are
 * skipped, so a hidden inventory keeps its owner out of the roster entirely.
 *
 * ---------------------------------------------------------------------------
 * VALUE vs RAP
 * ---------------------------------------------------------------------------
 * Value is community-set and lives in values.js - it is never a price and it
 * is never fetched. Every item is 0 until somebody fills that table in, so a
 * player's Value here is the sum of the hand-set values of their collectibles
 * and reads 0 for everyone until values exist.
 */
(() => {
  'use strict';

  const API = window.WanwoodAPI;
  const VALUES = window.WolimonsValues;

  /* Assets whose owners are being walked at once. Kept low on purpose: the
   * scan should leave proxy capacity for the rest of the site, and the
   * catalog is small enough that this still finishes quickly. */
  const ASSET_CONCURRENCY = 4;
  /* Owners rows per request - the backend's maximum. */
  const OWNERS_PAGE_SIZE = 100;

  const AVATAR_SIZE = 150;

  /* Building the roster costs a request or two per collectible, so the
   * finished result is parked in sessionStorage. Navigating between the
   * pages that use it is then instant, and the numbers still refresh often
   * enough to stay honest. */
  const CACHE_KEY = 'wolimons_roster_v1';
  const CACHE_TTL_MS = 10 * 60 * 1000;

  /* In-flight scan, so two callers on one page cannot start two scans. */
  let pending = null;

  /* Terminated-limiteds holding accounts, listed in config.js. They own real
   * items but were never traded with, so they are not ranked. */
  function isHoldingAccount(name) {
    const CONFIG = window.WOLIMONS_CONFIG;
    return Boolean(CONFIG && CONFIG.isHoldingAccount && CONFIG.isHoldingAccount(name));
  }

  /* ------------------------------------------------------------------ */
  /* Cache                                                               */
  /* ------------------------------------------------------------------ */

  function readCache() {
    try {
      const raw = window.sessionStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const saved = JSON.parse(raw);
      if (!saved || !Array.isArray(saved.players) || !saved.at) return null;
      if (Date.now() - saved.at > CACHE_TTL_MS) return null;
      /* Filtered on the way out as well: a cache written before an account
       * was added to the list would otherwise keep it on the board until it
       * expired. */
      return saved.players.filter(player => !isHoldingAccount(player.name));
    } catch (error) {
      return null;
    }
  }

  function writeCache(players) {
    try {
      /* The verified flags are left out on purpose. Pages fill them in for
       * the rows actually on screen, so most of them are still false when
       * the roster is cached - saving that would hide a tick for the ten
       * minutes the cache lives. Dropping the field makes the next visit
       * look them up again. Ranks are left out for the same reason: they
       * belong to whichever ordering a page chose, not to the roster. */
      const saved = players.map(({ verified, rank, ...player }) => player);
      window.sessionStorage.setItem(CACHE_KEY,
        JSON.stringify({ at: Date.now(), players: saved }));
    } catch (error) {
      /* Private mode or a full quota - the roster just rebuilds next time. */
    }
  }

  function clearCache() {
    try {
      window.sessionStorage.removeItem(CACHE_KEY);
    } catch (error) {
      /* Nothing to do - a stale entry simply expires on its own. */
    }
  }

  /* ------------------------------------------------------------------ */
  /* The scan                                                            */
  /* ------------------------------------------------------------------ */

  /*
   * For each collectible: page through its owners and fetch its RAP once.
   * Every owner row contributes one copy of that asset to its holder, so a
   * player's RAP is the sum of the RAP of each copy they hold and their Value
   * is the same sum over the hand-set values in values.js. That mirrors how
   * the backend computes a player's own totalRap (a straight SUM over
   * user_asset rows), so the two agree.
   *
   * `onProgress` is handed the partial roster after every asset so a page can
   * show itself filling in rather than a long blank wait.
   */
  async function scan(onProgress) {
    const assetIds = await API.listAllCollectibles();
    if (!assetIds.length) return [];

    /* userId -> player row, accumulated across every asset. */
    const players = new Map();
    let done = 0;

    await API.mapLimit(assetIds, ASSET_CONCURRENCY, async assetId => {
      /* Owners and RAP in parallel - fetchRap memoises per asset, so this is
       * one resale-data call no matter how many holders come back. */
      const [owners, rap] = await Promise.all([
        API.getAssetOwners(assetId, { pageLimit: OWNERS_PAGE_SIZE }),
        API.fetchRap(assetId),
      ]);

      const assetRap = Number(rap) || 0;
      const assetValue = Number(VALUES && VALUES.get ? VALUES.get(assetId) : 0) || 0;

      owners.forEach(owner => {
        let player = players.get(owner.userId);
        if (!player) {
          player = {
            id: owner.userId,
            name: owner.name || '',
            rap: 0,
            value: 0,
            items: 0,
            avatar: '',
          };
          players.set(owner.userId, player);
        }
        /* The owners feed carries names, but a row can arrive without one. */
        if (!player.name && owner.name) player.name = owner.name;
        player.rap += assetRap;
        player.value += assetValue;
        player.items += 1;
      });

      done += 1;

      if (players.size && typeof onProgress === 'function') {
        /* Filtered here too, otherwise a holding account would flash onto the
         * board while the scan runs and vanish when it finishes. Rows without
         * a name yet cannot match, but those are backfilled and re-filtered
         * once the scan completes. */
        onProgress(
          [...players.values()].filter(player => !isHoldingAccount(player.name)),
          { done, total: assetIds.length },
        );
      }
    });

    let roster = [...players.values()];

    /* Names normally come free with the owners rows, so this is usually a
     * no-op. Anyone still missing one gets filled in by a single batched
     * multi-get; that endpoint is a POST and this backend gates every POST
     * behind a CSRF token, so if it is refused we fall back to per-id GETs
     * for the handful of players involved. */
    let unnamed = roster.filter(player => !player.name);
    if (unnamed.length) {
      const names = await API.getUsersByIds(unnamed.map(player => player.id));
      unnamed.forEach(player => {
        player.name = names.get(player.id) || '';
      });
      unnamed = roster.filter(player => !player.name);
    }
    if (unnamed.length) {
      const fetched = await API.mapLimit(unnamed, 4, player => API.getUserById(player.id));
      unnamed.forEach((player, index) => {
        const user = fetched[index];
        player.name = (user && user.name) || `User ${player.id}`;
      });
    }

    /* Holding accounts come out here rather than in each page, so the
     * leaderboard, /players and the Lucky Cat draw all agree. It has to be
     * after the name backfill above - the match is on username, and a row
     * that arrived without a name would slip through otherwise. */
    roster = roster.filter(player => !isHoldingAccount(player.name));

    return roster;
  }

  async function attachAvatars(players, size = AVATAR_SIZE) {
    if (!players || !players.length || !API) return players || [];
    const map = await API.fetchUserThumbnails(players.map(player => player.id), size);
    players.forEach(player => { player.avatar = map.get(player.id) || ''; });
    return players;
  }

  /* ------------------------------------------------------------------ */
  /* Public entry point                                                  */
  /* ------------------------------------------------------------------ */

  /*
   * Resolves to the roster. A warm cache answers immediately and skips the
   * progress callback entirely; otherwise the scan runs, reports progress,
   * fetches avatars and caches the result.
   *
   * `cached` in the callback tells a page whether it is looking at a finished
   * roster (avatars included) or a partial one still being scanned.
   */
  function load({ onProgress, force = false } = {}) {
    if (!API) return Promise.reject(new Error('The Wanwood API client failed to load.'));

    if (!force) {
      const cached = readCache();
      if (cached) return Promise.resolve(cached);
      if (pending) return pending;
    }

    pending = (async () => {
      const players = await scan(onProgress);
      /* Avatars come last: the cards are readable without them, and this way
       * a slow thumbnail service never holds up the list. */
      await attachAvatars(players);
      writeCache(players);
      return players;
    })();

    pending.catch(() => {}).then(() => { pending = null; });
    return pending;
  }

  window.WolimonsRoster = {
    load,
    attachAvatars,
    clearCache,
    AVATAR_SIZE,
    CACHE_KEY,
    CACHE_TTL_MS,
  };
})();
