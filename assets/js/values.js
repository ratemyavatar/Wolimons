/*
 * Wolimons item values.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE IS
 * ---------------------------------------------------------------------------
 * "Value" is NOT a price and it is NOT RAP. It is the community-assigned worth
 * of a limited, set by hand - exactly like Rolimon's does it. Nothing on
 * Wanwood reports a value, so it can never be fetched from the API.
 *
 * Every item starts at 0 and stays at 0 until somebody sets it here.
 *
 * ---------------------------------------------------------------------------
 * HOW TO SET A VALUE
 * ---------------------------------------------------------------------------
 * Add a line to the VALUES table below: the Wanwood asset id, then the value.
 * Save the file and reload the site - that is the whole process. There are
 * only 39 collectibles on Wanwood, so the whole list fits in this one file.
 *
 * The asset id is the number in a Wanwood catalog URL:
 *     https://wanwoo.xyz/catalog/1581/Cthulhu   ->   1581
 *
 * Anything you leave out (or set to 0, null, or a non-number) shows as 0.
 */
(() => {
  'use strict';

  const VALUES = {
    /* assetId: value,          // Item name */

    // 4031: 0,                 // Panda Knit
    // 1581: 0,                 // Cthulhu
    // 848:  0,                 // (Limited U)
    // 6:    0,                 // The Classic ROBLOX Fedora
  };

  const toValue = raw => {
    const number = Number(raw);
    return Number.isFinite(number) && number > 0 ? number : 0;
  };

  window.WolimonsValues = {
    /* The raw table, in case something wants to iterate it. */
    all: VALUES,

    /* Value for an asset id. Always a number; 0 when unset. */
    get(id) {
      return toValue(VALUES[Number(id)]);
    },

    /* True only when a real, non-zero value has been set by hand. */
    isSet(id) {
      return toValue(VALUES[Number(id)]) > 0;
    },
  };
})();
