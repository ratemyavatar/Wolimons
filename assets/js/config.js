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

  const DEFAULT_API_BASE = 'https://wolimons.onrender.com';

  // The real Wanwood site. Used for outbound links the user clicks
  // (item pages etc.) - these should never point at the proxy.
  const SITE_BASE = 'https://wanwoo.xyz';

  /*
   * Certified Wanwoodian - the handpicked badge.
   *
   * There is no endpoint for this and there never will be: it is recognition
   * handed out by the site owner, so the list of recipients is written here
   * by hand. Names are matched case-insensitively against the Wanwood
   * username. Add a name to award it; nobody else receives it.
   *
   * Kept here rather than inside leaderboard.js so there is one place to
   * edit, and so anything else that needs to know can read the same list.
   */
  const CERTIFIED_WANWOODIANS = [
    'Nun',
  ];

  /*
   * Site owners - who the admin panel opens for.
   *
   * Same idea as the list above, and the same limits: it is a list of names
   * kept by hand, matched case-insensitively against the linked Wanwood
   * username. Add a name to grant access; nobody else gets in.
   *
   * IMPORTANT - what this is and is not:
   * this is a UI gate, not a security boundary. Wolimons is a static site
   * with no server of its own, so "being an owner" is decided in the
   * visitor's own browser and anyone who wants to can edit around it. It
   * keeps the panel out of the way of ordinary visitors; it cannot protect
   * anything, and nothing sensitive should ever be put behind it. Real
   * permissions need a backend that checks them, and there isn't one.
   */
  const OWNERS = [
    'Nun',
  ];

  let apiBase = DEFAULT_API_BASE;
  try {
    const override = window.localStorage.getItem('wolimons_api_base');
    if (override) apiBase = override;
  } catch (error) {
    /* localStorage can be unavailable in private mode - ignore. */
  }

  const certified = new Set(
    CERTIFIED_WANWOODIANS.map(name => String(name).trim().toLowerCase()).filter(Boolean),
  );

  const owners = new Set(
    OWNERS.map(name => String(name).trim().toLowerCase()).filter(Boolean),
  );

  window.WOLIMONS_CONFIG = {
    apiBase: String(apiBase).replace(/\/+$/, ''),
    siteBase: SITE_BASE.replace(/\/+$/, ''),
    certifiedWanwoodians: CERTIFIED_WANWOODIANS,
    /* True only for a name on the list above. */
    isCertifiedWanwoodian(name) {
      return certified.has(String(name || '').trim().toLowerCase());
    },
    owners: OWNERS,
    /* True only for a name on the owners list. See the warning above it. */
    isOwner(name) {
      return owners.has(String(name || '').trim().toLowerCase());
    },
  };
})();
