/*
 * Wolimons site configuration.
 *
 * This file must load BEFORE the other scripts on the page.
 *
 * ---------------------------------------------------------------------------
 * API_BASE - where item/player data is fetched from.
 * ---------------------------------------------------------------------------
 * Wanwood blocks automated/cross-origin requests, so requests have to go
 * through a proxy that adds browser-like headers and CORS headers.
 *
 * Put your Render proxy URL here (no trailing slash), for example:
 *
 *     apiBase: 'https://wolimons-proxy.onrender.com',
 *
 * The proxy is expected to forward every path straight through to
 * https://wanwoo.xyz - so the site requesting
 *     <apiBase>/apisite/catalog/v1/search/items?...
 * should reach
 *     https://wanwoo.xyz/apisite/catalog/v1/search/items?...
 *
 * A ready-to-deploy proxy that does exactly this lives in /proxy of this repo.
 *
 * You can also override the value at runtime without editing this file, which
 * is handy for testing a new proxy. Run this in the browser console:
 *
 *     localStorage.setItem('wolimons_api_base', 'https://your-proxy.onrender.com')
 *     location.reload()
 *
 * ...and to go back to the built-in value:
 *
 *     localStorage.removeItem('wolimons_api_base')
 */
(() => {
  'use strict';

  const DEFAULT_API_BASE = 'https://wanwoo.xyz';

  // The real Wanwood site. Used for outbound links the user clicks
  // (item pages etc.) - these should never point at the proxy.
  const SITE_BASE = 'https://wanwoo.xyz';

  let apiBase = DEFAULT_API_BASE;
  try {
    const override = window.localStorage.getItem('wolimons_api_base');
    if (override) apiBase = override;
  } catch (error) {
    /* localStorage can be unavailable in private mode - ignore. */
  }

  window.WOLIMONS_CONFIG = {
    apiBase: String(apiBase).replace(/\/+$/, ''),
    siteBase: SITE_BASE.replace(/\/+$/, ''),
  };
})();
