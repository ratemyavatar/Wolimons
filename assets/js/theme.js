/*
 * Wolimons - theme switch.
 *
 * Deliberately tiny, and deliberately loaded in <head> before the page is
 * painted. Everything else on this site loads at the end of <body>, which is
 * right for behaviour and wrong for a theme: the reader would get a flash of
 * the modern site before the 2018 one replaced it.
 *
 * So this runs first, reads the one preference it cares about straight out of
 * localStorage rather than waiting for prefs.js, and marks the document. The
 * 2018 stylesheet is scoped entirely to html.theme-2018, so adding that class
 * is the whole switch.
 */
(() => {
  'use strict';

  const KEY = 'wolimons_prefs_v1';
  const CLASS = 'theme-2018';

  function wanted() {
    try {
      const raw = window.localStorage.getItem(KEY);
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      return Boolean(parsed && parsed.theme2018 === true);
    } catch (error) {
      /* Private mode, disabled storage, hand-edited nonsense - the modern
       * theme is the one that should survive any of that. */
      return false;
    }
  }

  function apply(on) {
    const root = document.documentElement;
    root.classList.toggle(CLASS, on);

    /* The stylesheet ships disabled so a browser never downloads and applies
     * it for a reader who has not asked for it. */
    const sheet = document.getElementById('theme_2018_stylesheet');
    if (sheet) sheet.disabled = !on;
  }

  apply(wanted());

  /*
   * Turning it on and off from /preferences takes effect on every open tab,
   * the same way the catalog filters already do - no reload, no half-applied
   * page. The storage event covers other tabs; prefs.js dispatches the custom
   * one for this tab, because storage does not fire in the tab that wrote it.
   */
  window.addEventListener('storage', event => {
    if (event.key === KEY) apply(wanted());
  });
  window.addEventListener('wolimons:theme', () => apply(wanted()));

  window.WolimonsTheme = { apply, isOn: () => document.documentElement.classList.contains(CLASS) };
})();
