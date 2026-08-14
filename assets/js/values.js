/*
 * Wolimons item values.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE IS
 * ---------------------------------------------------------------------------
 * "Value", "Demand" and "Trend" are NOT prices and NOT RAP. They are the
 * community-assigned figures, set by hand - exactly like Rolimon's does it.
 * Nothing on Wanwood reports any of them, so they can never be fetched from
 * the API. That is why they live in this file instead.
 *
 * Every item starts unset: value 0, demand and trend blank, no categories.
 * Nothing is guessed and nothing is filled in automatically.
 *
 * ---------------------------------------------------------------------------
 * HOW TO SET AN ITEM
 * ---------------------------------------------------------------------------
 * Add a line to the ITEMS table below, keyed by the Wanwood asset id. Save the
 * file and reload the site - that is the whole process. There are only 39
 * collectibles on Wanwood, so the whole list fits in this one file.
 *
 * The asset id is the number in a Wanwood catalog URL:
 *     https://wanwoo.xyz/catalog/1581/Cthulhu   ->   1581
 *
 * A row can be just a number (the value) or an object:
 *
 *     1581: 4500,                                  // value only
 *     4031: {                                      // the long form
 *       value: 12000,
 *       demand: 'High',        // High | Decent | Low | Terrible  (else unset)
 *       trend: 'Raising',      // Raising | Stable | Lowering | Unstable |
 *                              // Fluctuating                    (else unset)
 *       categories: ['rare'],  // rare | projected | tablet | unobtainable |
 *                              // hoarded
 *     },
 *
 * "valued" is not written by hand: an item counts as valued as soon as its
 * value is above 0.
 *
 * Anything left out shows as unset - 0 for value, blank for demand and trend -
 * and the catalog's Demand / Trend / Categories filters treat it as
 * "Unassigned".
 */
(() => {
  'use strict';

  const ITEMS = {
    /* assetId: value,          // Item name */

    // 4031: 0,                 // Panda Knit
    // 1581: 0,                 // Cthulhu
    // 848:  0,                 // (Limited U)
    // 6:    0,                 // The Classic ROBLOX Fedora
  };

  /* The only spellings the filters recognise. Anything else reads as unset. */
  const DEMANDS = ['High', 'Decent', 'Low', 'Terrible'];
  const TRENDS = ['Raising', 'Stable', 'Lowering', 'Unstable', 'Fluctuating'];
  const CATEGORIES = ['rare', 'projected', 'tablet', 'unobtainable', 'hoarded'];

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

  window.WolimonsValues = {
    /* The raw table, in case something wants to iterate it. */
    all: ITEMS,

    /* The vocabularies, so the catalog never has to repeat them. */
    DEMANDS,
    TRENDS,
    CATEGORIES,

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
})();
