/*
 * Wolimons item values.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE IS
 * ---------------------------------------------------------------------------
 * "Value", "Demand" and "Trend" are NOT prices and NOT RAP. They are the
 * community-assigned figures, set by hand - exactly like Rolimon's does it.
 * Nothing on Wanwood reports any of them, so they can never be fetched from
 * the game API. They come from the value team instead.
 *
 * Every item starts unset: value 0, demand and trend blank, no categories.
 * Nothing is guessed and nothing is filled in automatically.
 *
 * ---------------------------------------------------------------------------
 * HOW ITEMS GET SET
 * ---------------------------------------------------------------------------
 * Through the admin panel, by someone on the value team. This file fetches the
 * result from the site's own backend at <apiBase>/api/values and hands it to
 * every page that asks.
 *
 * The ITEMS table below is the fallback used before that reply arrives, and if
 * it never arrives. Leaving it empty is correct: an item nobody has valued
 * shows as unset, which is the honest answer.
 *
 * ---------------------------------------------------------------------------
 * WHY THE ACCESSORS ARE STILL SYNCHRONOUS
 * ---------------------------------------------------------------------------
 * Every page calls VALUES.get(id) inline while building its markup, and none
 * of them can wait. So loading changes nothing about the shape of this API:
 * the answers are simply unset until the data lands, then pages re-render.
 *
 * Two hooks exist for that:
 *
 *     VALUES.ready.then(...)     resolves once, after the first load attempt
 *     VALUES.subscribe(fn)       runs fn now and again on every later change
 *
 * A page that renders from values should use subscribe() and redraw. One that
 * only needs them once can await ready.
 */
(() => {
  'use strict';

  /*
   * The fallback table, used until the backend answers. Normally empty - the
   * real values live on the server, where the value team can edit them without
   * anyone having to touch the code.
   *
   *     1581: 4500,                     // value only
   *     4031: { value: 12000, demand: 'High', trend: 'Raising',
   *             categories: ['rare'] }, // the long form
   */
  const ITEMS = {
    /* assetId: value,          // Item name */
  };

  /* The only spellings the filters recognise. Anything else reads as unset. */
  const DEMANDS = ['High', 'Decent', 'Low', 'Terrible'];
  const TRENDS = ['Raising', 'Stable', 'Lowering', 'Unstable', 'Fluctuating'];
  const CATEGORIES = ['rare', 'projected', 'tablet', 'unobtainable', 'hoarded'];
  /* Proof-based or RAP-based, the two ways an item gets its value. */
  const METHODS = ['proof', 'rap'];

  const row = id => {
    const entry = ITEMS[Number(id)];
    if (entry === null || entry === undefined) return {};
    return typeof entry === 'object' ? entry : { value: entry };
  };

  const toValue = raw => {
    const number = Number(raw);
    return Number.isFinite(number) && number > 0 ? number : 0;
  };

  /* Case-insensitive match against the allowed list, so 'high' still works. */
  const oneOf = (raw, allowed) => {
    if (typeof raw !== 'string') return null;
    const match = allowed.find(name => name.toLowerCase() === raw.trim().toLowerCase());
    return match || null;
  };

  /*
   * Everyone who wants to know when the values change.
   *
   * Pages render before the fetch lands, so they need a nudge afterwards. One
   * subscriber throwing must not stop the rest, hence the try/catch.
   */
  const listeners = new Set();

  const notify = () => {
    listeners.forEach(fn => {
      try {
        fn(window.WolimonsValues);
      } catch (error) {
        console.error('[values] a subscriber failed:', error);
      }
    });
  };

  /*
   * Fold the server's reply into ITEMS.
   *
   * Rows arrive as { value, demand, trend, categories, method, note,
   * updatedBy, updatedAt } and are stored whole, so every accessor above -
   * including method() and note(), which the item page's Valuation tab
   * reads - sees exactly what the server holds. updatedBy is worth keeping
   * so the admin panel can show who set what.
   */
  const absorb = payload => {
    const values = payload && payload.values;
    if (!values || typeof values !== 'object') return false;

    /* Replace rather than merge: an item cleared on the server has to
     * disappear here too, and merging would keep it alive forever. */
    Object.keys(ITEMS).forEach(key => delete ITEMS[key]);

    Object.entries(values).forEach(([id, entry]) => {
      const key = Number(id);
      if (!Number.isFinite(key) || key <= 0) return;
      ITEMS[key] = entry && typeof entry === 'object' ? entry : { value: entry };
    });
    return true;
  };

  const apiBase = () => {
    const config = window.WOLIMONS_CONFIG;
    return config && config.apiBase ? config.apiBase : '';
  };

  /*
   * Fetch the table once.
   *
   * A failure here is not fatal and not worth shouting about: the site falls
   * back to "nothing is valued yet", which is exactly what it shows on a fresh
   * install anyway. The free-tier backend also sleeps, so the first call after
   * a quiet spell can simply time out.
   */
  const loadOnce = async () => {
    const base = apiBase();
    if (!base) return false;
    try {
      const response = await fetch(`${base}/api/values`, {
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) return false;

      /* An unknown path on some hosts returns the HTML shell with status 200,
       * so check we really got JSON before trusting it. */
      const text = await response.text();
      if (/^\s*</.test(text)) return false;

      const payload = JSON.parse(text);
      const changed = absorb(payload);

      /* The table's version, straight from the server: every edit bumps it.
       * Anything that bakes these numbers into a cache of its own (the
       * roster, the Lucky Cat draw) stamps the cache with this and rebuilds
       * the moment it changes - a reverted value must not keep inflating
       * everybody's totals from a stale cache. 0 means "no table landed". */
      const stamp = Number(payload && payload.updatedAt) || 0;
      if (window.WolimonsValues.updatedAt !== stamp) {
        window.WolimonsValues.updatedAt = stamp;
      }

      if (changed) notify();
      return changed;
    } catch (error) {
      return false;
    }
  };

  /*
   * Resolves after the first attempt, whether or not it worked.
   *
   * Built as a deferred rather than by calling loadOnce() here, so the fetch
   * can be kicked off *after* window.WolimonsValues exists - notify() reaches
   * for it, and a fast reply must not find it half-built.
   */
  let markReady;
  const ready = new Promise(resolve => { markReady = resolve; });

  window.WolimonsValues = {
    /* The raw table, in case something wants to iterate it. */
    all: ITEMS,

    /* True once the backend's copy is in hand. False means these are the
     * fallbacks, which is worth distinguishing from "everything is 0". */
    loaded: false,

    /* The server's stamp on the table it last served - every value edit
     * bumps it. Caches that bake these numbers in compare themselves
     * against it; 0 until the first reply lands. */
    updatedAt: 0,

    /* Resolves once, after the first load attempt. */
    ready,

    /*
     * Run fn now, and again whenever the values change. Returns a function
     * that stops it. Calling it immediately means a page can use this as its
     * only render path instead of rendering once and subscribing separately.
     */
    subscribe(fn) {
      if (typeof fn !== 'function') return () => {};
      listeners.add(fn);
      try {
        fn(this);
      } catch (error) {
        console.error('[values] a subscriber failed:', error);
      }
      return () => listeners.delete(fn);
    },

    /* Re-read from the backend. The admin panel calls this after saving so the
     * rest of the site catches up without a reload. */
    refresh() {
      return loadOnce();
    },

    /* The vocabularies, so the catalog never has to repeat them. */
    DEMANDS,
    TRENDS,
    CATEGORIES,
    METHODS,

    /* Value for an asset id. Always a number; 0 when unset. */
    get(id) {
      return toValue(row(id).value);
    },

    /* True only when a real, non-zero value has been set by hand. */
    isSet(id) {
      return toValue(row(id).value) > 0;
    },

    /* Hand-set demand, or null. Never inferred from anything. */
    demand(id) {
      return oneOf(row(id).demand, DEMANDS);
    },

    /* Hand-set trend, or null. */
    trend(id) {
      return oneOf(row(id).trend, TRENDS);
    },

    /*
     * How the item was valued: 'proof' when its price comes from real trades
     * and offers, 'rap' when it simply tracks RAP. Null until the value team
     * says which - the item page then prints neither claim rather than
     * guessing one.
     */
    method(id) {
      return oneOf(row(id).method, METHODS);
    },

    /*
     * The value team's note about this item, shown on the item page under the
     * valuation method. Empty string when nobody has written one.
     */
    note(id) {
      const raw = row(id).note;
      return typeof raw === 'string' ? raw.trim() : '';
    },

    /*
     * Hand-set categories, plus "valued" for anything with a value. Always an
     * array, empty when the item has been left alone.
     */
    categories(id) {
      const raw = row(id).categories;
      const list = (Array.isArray(raw) ? raw : [raw])
        .map(name => oneOf(name, CATEGORIES))
        .filter(Boolean);
      if (this.isSet(id)) list.push('valued');
      return [...new Set(list)];
    },
  };

  /* Safe to start now that the object above exists for notify() to hand out. */
  loadOnce().then(loaded => {
    window.WolimonsValues.loaded = loaded;
    markReady(window.WolimonsValues);
  });
})();
