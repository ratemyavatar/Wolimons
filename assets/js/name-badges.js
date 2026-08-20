/*
 * Wolimons - name badges
 * ----------------------
 * The little icons that sit inline after a player's name. They were written
 * for the leaderboard cards first; the profile page needs the identical row
 * next to the name on its profile card, so the builders live here instead of
 * being duplicated with two sets of markup that could drift apart.
 *
 * The rules are exactly the ones already agreed for the leaderboard, and no
 * page may add to them:
 *
 *   trophy     rank #1 only, and only where a rank is actually known
 *   verified   the API's own isVerified flag, never granted for existing
 *   certified  Certified Wanwoodian, awarded by the site owner in the admin
 *              panel and read back through assets/js/granted-badges.js
 *
 * A player who is none of those gets an empty row, which is the normal case.
 * Nothing here is derived from value, RAP or inventory - those are WoliBadges
 * and belong in the separate strip further down the profile.
 */
(function () {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';

  const TROPHY_PATH = 'M19 3h-2V2h-2v1H9V2H7v1H5c-1.1 0-2 .9-2 2v3c0 2.21 1.79 4 4 4h.14c.48 1.48 1.68 2.65 3.2 3.06L9 18H7v2h10v-2h-2l-1.34-2.94c1.52-.41 2.72-1.58 3.2-3.06H17c2.21 0 4-1.79 4-4V5c0-1.1-.9-2-2-2zm-2 5h-1.68C14.77 9.8 13.5 11 12 11s-2.77-1.2-3.32-3H7V5h10v3z';

  const VERIFIED_ICON = '/img/badges/verified-checkmark.png';
  const CERTIFIED_ICON = '/img/badges/certified-wanwoodian.png';

  /* The hover tooltip is a child span rather than a title attribute so it
     matches the Wolimons styling; the title is kept as the accessible
     fallback for touch and screen readers. */
  function badgeWrap(label, child) {
    const wrap = document.createElement('span');
    wrap.className = 'lb_badge';
    wrap.appendChild(child);

    const tip = document.createElement('span');
    tip.className = 'badge-tt';
    tip.textContent = label;
    wrap.appendChild(tip);

    wrap.setAttribute('title', label);
    return wrap;
  }

  function trophyNode() {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'currentColor');
    svg.setAttribute('aria-hidden', 'true');

    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', TROPHY_PATH);
    svg.appendChild(path);

    const wrap = badgeWrap('Rank #1', svg);
    wrap.style.color = '#ffd700';
    return wrap;
  }

  function imageBadge(label, src) {
    const image = document.createElement('img');
    image.src = src;
    image.alt = label;
    image.loading = 'lazy';
    return badgeWrap(label, image);
  }

  /*
   * Certified Wanwoodian is one of the badges the owner hands out, so the
   * answer comes from the grants table rather than from a list in the code.
   *
   * It is read live on every call, not captured when this file loads: the
   * table arrives from the backend a moment after the page does, and pages
   * subscribe and redraw when it lands. Holding a reference to the module is
   * fine, but reading the *answer* early would freeze it at "no".
   */
  function isCertified(name) {
    const GRANTED = window.WolimonsGrantedBadges;
    return Boolean(GRANTED && GRANTED.has(name, 'certified-wanwoodian'));
  }

  /*
   * The icons for one player, in a fixed order so the row never reshuffles
   * between renders. `player` needs only { name, rank, verified }; a rank of
   * null (profile pages where the leaderboard cache is cold) simply means no
   * trophy rather than a wrong one.
   */
  function badgeNodes(player) {
    const nodes = [];
    if (!player) return nodes;

    if (Number(player.rank) === 1) nodes.push(trophyNode());
    if (player.verified === true) nodes.push(imageBadge('Verified', VERIFIED_ICON));
    if (isCertified(player.name)) {
      nodes.push(imageBadge('Certified Wanwoodian', CERTIFIED_ICON));
    }
    return nodes;
  }

  /* Convenience for callers that just want to refill a container. */
  function renderInto(target, player) {
    if (!target) return 0;
    target.querySelectorAll('.lb_badge').forEach(node => node.remove());
    const nodes = badgeNodes(player);
    nodes.forEach(node => target.appendChild(node));
    return nodes.length;
  }

  window.WolimonsNameBadges = {
    badgeWrap,
    trophyNode,
    imageBadge,
    badgeNodes,
    renderInto,
    TROPHY_PATH,
    VERIFIED_ICON,
    CERTIFIED_ICON,
  };
}());
