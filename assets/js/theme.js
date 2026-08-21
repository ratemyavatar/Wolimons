/*
 * Wolimons - the 2018 switch.
 *
 * The 2018 theme is not a restyle. Turning it on serves genuinely different
 * pages: the actual 2018 pages, rebuilt from snapshots and wired to this
 * site's API, which live under /2018 and are served in place of the modern
 * ones for a reader who has asked for them.
 *
 * That decision has to be made on the server, before any HTML is sent, so the
 * preference is mirrored into a cookie. localStorage stays the source of
 * truth - it is what /preferences reads and writes - and this keeps the two
 * in step on every page load.
 *
 * Loaded in <head> so the cookie is in place before anything else runs.
 */
(() => {
  'use strict';

  const KEY = 'wolimons_prefs_v1';
  const COOKIE = 'wolimons_theme';
  const YEAR = 60 * 60 * 24 * 365;

  function wanted() {
    try {
      const raw = window.localStorage.getItem(KEY);
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      return Boolean(parsed && parsed.theme2018 === true);
    } catch (error) {
      /* Private mode, disabled storage, hand-edited nonsense - the modern
       * site is the one that should survive any of that. */
      return false;
    }
  }

  function cookieSaysOn() {
    return /(?:^|;\s*)wolimons_theme=2018(?:;|$)/.test(document.cookie || '');
  }

  function writeCookie(on) {
    /* Lax rather than Strict: somebody following a link to the site from
     * Discord should still land on the version they chose. */
    document.cookie = on
      ? `${COOKIE}=2018; path=/; max-age=${YEAR}; samesite=lax`
      : `${COOKIE}=; path=/; max-age=0; samesite=lax`;
  }

  /*
   * Bring the cookie into line with the preference, and reload when that
   * changes which page should have been served.
   *
   * The reload only ever happens on the load where the setting changed - the
   * cookie matches from then on - so this cannot loop.
   */
  function sync({ allowReload = true } = {}) {
    const on = wanted();
    const was = cookieSaysOn();
    document.documentElement.classList.toggle('theme-2018', on);
    if (on === was) return;

    writeCookie(on);
    /* A page built for 2018 is already the 2018 page; only the modern pages
     * need fetching again. */
    const already2018 = document.body && document.body.hasAttribute('data-page-2018');
    if (allowReload && on !== already2018) window.location.reload();
  }

  sync();

  /* Changed in another tab, or on /preferences in this one. */
  window.addEventListener('storage', event => {
    if (event.key === KEY) sync();
  });
  window.addEventListener('wolimons:theme', () => sync());

  window.WolimonsTheme = {
    isOn: () => wanted(),
    set(on) {
      try {
        const raw = window.localStorage.getItem(KEY);
        const parsed = raw ? JSON.parse(raw) : {};
        parsed.theme2018 = Boolean(on);
        window.localStorage.setItem(KEY, JSON.stringify(parsed));
      } catch (error) {
        /* Nothing to do - the preference simply will not stick. */
      }
      sync();
    },
  };
})();
