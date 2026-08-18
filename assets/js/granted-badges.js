/*
 * Wolimons - the badges the owner hands out.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE IS
 * ---------------------------------------------------------------------------
 * Most WoliBadges are earned. assets/js/badges.js works those out from the
 * player's own inventory, in the browser, and nobody can grant or withhold
 * one - own ten limiteds and you have Collector, whatever anybody thinks.
 *
 * Fifteen of them are not like that, because their requirement happens
 * somewhere no browser can check: winning a Discord tournament, contributing
 * artwork, being recognised as a Certified Wanwoodian. No endpoint reports
 * any of it, so somebody has to say so, and that somebody is the site owner
 * through the admin panel.
 *
 * This module is how the rest of the site finds out who they said. It reads
 * <apiBase>/api/badges, which is public - who holds what is already on the
 * profiles and the leaderboard, so there is nothing here to hide. Only
 * handing them out is restricted, and that happens on the server.
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS NOT IN CONFIG.JS ANY MORE
 * ---------------------------------------------------------------------------
 * Certified Wanwoodian used to be a hand-written list of names in config.js,
 * with one name on it. Awarding it to somebody meant editing the code and
 * redeploying the site, which is not something an owner should have to do to
 * congratulate a player. Now it is data, set in the panel, and it takes
 * effect on everybody's next page load.
 *
 * ---------------------------------------------------------------------------
 * WHY THE ACCESSORS ARE SYNCHRONOUS
 * ---------------------------------------------------------------------------
 * Same reason as values.js, and the same shape of answer. Pages call has()
 * inline while they build their markup and cannot wait for a fetch, so until
 * the table lands every answer is "no badge". That is the right default: a
 * badge that fails to load is simply not drawn, rather than the page hanging
 * or an icon appearing on the wrong person.
 *
 *     BADGES.ready.then(...)     resolves once, after the first load attempt
 *     BADGES.subscribe(fn)       runs fn now and again on every later change
 *
 * A page that renders from grants should subscribe and redraw.
 */
(() => {
  'use strict';

  /* username (lowercased) -> Set of badge ids. Empty until the fetch lands. */
  const GRANTS = new Map();

  const clean = name => String(name || '').trim().toLowerCase();

  /* ------------------------------------------------------------------ */
  /* Subscribers                                                         */
  /* ------------------------------------------------------------------ */

  const listeners = new Set();

  const notify = () => {
    listeners.forEach(fn => {
      try {
        fn(window.WolimonsGrantedBadges);
      } catch (error) {
        console.error('[granted-badges] a subscriber failed:', error);
      }
    });
  };

  /* ------------------------------------------------------------------ */
  /* Loading                                                             */
  /* ------------------------------------------------------------------ */

  const apiBase = () => {
    const config = window.WOLIMONS_CONFIG;
    return config && config.apiBase ? config.apiBase : '';
  };

  /* Fold the server's reply in. Rows arrive as { name, badges, grantedBy,
   * grantedAt }; only the name and the badge list matter out here. */
  const absorb = payload => {
    const rows = payload && payload.grants;
    if (!Array.isArray(rows)) return false;

    /* Replace rather than merge, so a badge taken back on the server really
     * does disappear here instead of living on until the tab is closed. */
    GRANTS.clear();

    rows.forEach(row => {
      if (!row || typeof row !== 'object') return;
      const id = clean(row.name);
      if (!id) return;
      const list = Array.isArray(row.badges) ? row.badges.filter(Boolean) : [];
      if (!list.length) return;
      GRANTS.set(id, new Set(list));
    });
    return true;
  };

  /*
   * Fetch the table once.
   *
   * A failure is not fatal and not worth shouting about: the site falls back
   * to "nobody has been given anything", which is what a fresh install looks
   * like anyway. The free-tier backend also sleeps, so the first call after a
   * quiet spell can simply time out.
   */
  const loadOnce = async () => {
    const base = apiBase();
    if (!base) return false;
    try {
      const response = await fetch(`${base}/api/badges`, {
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) return false;

      /* An unknown path on some hosts returns the HTML shell with status 200,
       * so check we really got JSON before trusting it. */
      const text = await response.text();
      if (/^\s*</.test(text)) return false;

      const changed = absorb(JSON.parse(text));
      if (changed) notify();
      return changed;
    } catch (error) {
      return false;
    }
  };

  /* Built as a deferred rather than by calling loadOnce() here, so the fetch
   * starts only after window.WolimonsGrantedBadges exists - notify() reaches
   * for it, and a fast reply must not find it half-built. */
  let markReady;
  const ready = new Promise(resolve => { markReady = resolve; });

  window.WolimonsGrantedBadges = {
    /* True once the backend's copy is in hand. False means "we do not know",
     * which is worth distinguishing from "nobody has any". */
    loaded: false,

    /* Resolves once, after the first load attempt. */
    ready,

    /* Run fn now, and again whenever the grants change. Returns a function
     * that stops it. */
    subscribe(fn) {
      if (typeof fn !== 'function') return () => {};
      listeners.add(fn);
      try {
        fn(this);
      } catch (error) {
        console.error('[granted-badges] a subscriber failed:', error);
      }
      return () => listeners.delete(fn);
    },

    /* Re-read from the backend. The admin panel calls this after awarding
     * one, so the rest of the site catches up without a reload. */
    refresh() {
      return loadOnce();
    },

    /* Does this player hold this badge? Matched on the Wanwood username,
     * case-insensitively, the same way roles are. */
    has(name, badge) {
      const held = GRANTS.get(clean(name));
      return Boolean(held && held.has(badge));
    },

    /* Every badge this player has been given, as ids. Always an array. */
    of(name) {
      const held = GRANTS.get(clean(name));
      return held ? [...held] : [];
    },

    /* Everyone who has been given anything, for the admin panel's list. */
    all() {
      return [...GRANTS.entries()].map(([id, held]) => ({ id, badges: [...held] }));
    },
  };

  /* Safe to start now that the object above exists for notify() to hand out. */
  loadOnce().then(loaded => {
    window.WolimonsGrantedBadges.loaded = loaded;
    markReady(window.WolimonsGrantedBadges);
  });
})();
