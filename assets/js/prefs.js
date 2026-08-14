/*
 * Wolimons site preferences.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS
 * ---------------------------------------------------------------------------
 * A handful of per-browser display choices, held in localStorage. There is no
 * Wolimons account behind them and no server copy - they are settings for
 * this browser, exactly like the account link in account.js, and they follow
 * nobody around.
 *
 * The pages that honour a preference read it through this module and
 * subscribe to it, so a change made on /preferences reaches an already-open
 * catalog tab without a reload.
 *
 * ---------------------------------------------------------------------------
 * THE PREFERENCES
 * ---------------------------------------------------------------------------
 *   hideTablets         leave tablet items out of the catalog listing
 *   hideUnobtainables   leave unobtainable items out of the catalog listing
 *   dealsInNewTab       open a deal card in a new tab rather than this one
 *
 * The first two act on the community categories in values.js - the same
 * "tablet" and "unobtainable" flags the admin panel assigns - so they hide
 * exactly what a person marked, and nothing is inferred. An item nobody has
 * categorised is never hidden by either of them.
 *
 * They deliberately only apply to the catalog's browsing list. Hiding an item
 * everywhere would be a trap: a reader who had forgotten the setting would
 * see search return nothing for an item that plainly exists. Lookup, the
 * value feed and every direct link keep working regardless.
 */
(() => {
  'use strict';

  const KEY = 'wolimons_prefs_v1';

  /* The full set, with the answer for a browser that has never visited the
   * preferences page. Everything defaults to off: the site should behave the
   * same for a first-time reader as it does in a screenshot. */
  const DEFAULTS = {
    hideTablets: false,
    hideUnobtainables: false,
    dealsInNewTab: false,
  };

  const NAMES = Object.keys(DEFAULTS);

  let current = { ...DEFAULTS };

  function read() {
    try {
      const raw = window.localStorage.getItem(KEY);
      if (!raw) return { ...DEFAULTS };
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return { ...DEFAULTS };
      /* Only known names, only booleans - a hand-edited or outdated blob
       * must not be able to smuggle anything into the rest of the site. */
      const out = { ...DEFAULTS };
      NAMES.forEach(name => {
        if (typeof parsed[name] === 'boolean') out[name] = parsed[name];
      });
      return out;
    } catch (error) {
      /* Private mode, disabled storage, or garbage. Defaults are fine. */
      return { ...DEFAULTS };
    }
  }

  function write(next) {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(next));
      return true;
    } catch (error) {
      return false;
    }
  }

  current = read();

  /* ------------------------------------------------------------------ */
  /* Subscribers                                                         */
  /* ------------------------------------------------------------------ */

  const listeners = new Set();

  function notify() {
    listeners.forEach(fn => {
      try {
        fn({ ...current });
      } catch (error) {
        console.error('[prefs] a subscriber failed:', error);
      }
    });
  }

  /*
   * Run fn now, and again whenever a preference changes. Returns a function
   * that stops it. Calling immediately means a page can use this as its only
   * render path rather than reading once and subscribing separately - the
   * same contract values.js offers.
   */
  function subscribe(fn) {
    if (typeof fn !== 'function') return () => {};
    listeners.add(fn);
    try {
      fn({ ...current });
    } catch (error) {
      console.error('[prefs] a subscriber failed:', error);
    }
    return () => listeners.delete(fn);
  }

  /* Another tab changing a preference should reach this one too - that is the
   * whole point of them being per-browser rather than per-page. */
  window.addEventListener('storage', event => {
    if (event.key !== KEY) return;
    current = read();
    notify();
  });

  /* ------------------------------------------------------------------ */
  /* Reading and writing                                                 */
  /* ------------------------------------------------------------------ */

  function get(name) {
    return Object.prototype.hasOwnProperty.call(current, name)
      ? current[name]
      : undefined;
  }

  function all() {
    return { ...current };
  }

  function set(name, value) {
    if (!NAMES.includes(name)) return false;
    const next = { ...current, [name]: Boolean(value) };
    if (next[name] === current[name]) return true;
    current = next;
    write(current);
    notify();
    return true;
  }

  function reset() {
    current = { ...DEFAULTS };
    write(current);
    notify();
  }

  /*
   * Should this item be left out of a browsing list, given the current
   * preferences? Takes the item's community categories.
   *
   * Kept here rather than in each page so "hidden" means the same thing
   * everywhere it is honoured.
   */
  function hidesCategories(categories) {
    const list = Array.isArray(categories) ? categories : [];
    if (current.hideTablets && list.includes('tablet')) return true;
    if (current.hideUnobtainables && list.includes('unobtainable')) return true;
    return false;
  }

  window.WolimonsPrefs = {
    KEY,
    DEFAULTS,
    NAMES,
    get,
    all,
    set,
    reset,
    subscribe,
    hidesCategories,
  };
})();
