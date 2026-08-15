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
   * Limited holder accounts - kept off the player rankings.
   *
   * When someone is terminated their limiteds are moved onto a holding
   * account rather than destroyed, so these accounts accumulate items they
   * never traded for. Ranking them against real players is misleading - the
   * RAP is not a record of anything anyone did - so they are left out of the
   * leaderboard, the player list and the Lucky Cat draw.
   *
   * They are not hidden: the profile still opens from a direct link and still
   * reads live from Wanwood. It just says what the account is, and blurs the
   * avatar so it does not read as somebody's profile.
   *
   * Matched case-insensitively against the Wanwood username, same as the two
   * lists above. There is no endpoint that flags these - the backend has no
   * concept of a holding account - so the list is kept here by hand.
   */
  const HOLDING_ACCOUNTS = [
    'baddecisions',
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

  /*
   * Where the API actually is, in order of precedence:
   *
   *   1. localStorage 'wolimons_api_base'  - a manual override for testing.
   *   2. window.WOLIMONS_API_BASE          - set by the server when the site
   *                                          is self-hosted (see /proxy). The
   *                                          API is then on the same origin as
   *                                          the page, whatever address was
   *                                          used to reach it, so it cannot be
   *                                          written down here in advance.
   *   3. DEFAULT_API_BASE                  - the hosted Render proxy.
   */
  let apiBase = DEFAULT_API_BASE;
  if (typeof window.WOLIMONS_API_BASE === 'string' && window.WOLIMONS_API_BASE) {
    apiBase = window.WOLIMONS_API_BASE;
  }
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

  const holding = new Set(
    HOLDING_ACCOUNTS.map(name => String(name).trim().toLowerCase()).filter(Boolean),
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
    holdingAccounts: HOLDING_ACCOUNTS,
    /* True for a terminated-limiteds holding account. Keeps them off the
     * rankings and puts the notice on their profile. */
    isHoldingAccount(name) {
      return holding.has(String(name || '').trim().toLowerCase());
    },
  };
})();
