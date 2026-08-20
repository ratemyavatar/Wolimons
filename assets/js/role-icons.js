/*
 * Wolimons - staff rank icons
 * ---------------------------
 * The little SVG that sits beside a staff member's name. Every one of them is
 * lifted from the original leaderboard snapshot, where the same icons mark the
 * same kind of thing - nothing here was drawn for Wolimons.
 *
 *   Website Owner   a teal gem, drawn for the rank above site owner
 *   Site Owner      the gold crown, the top-of-the-board icon
 *   Value Manager   the silver shield, its "Top 50 Leaderboard" icon
 *   Value Team      the purple star, its "Caelus Staff" icon
 *
 * The wrapper is the leaderboard's own .lb_badge / .badge-tt pair, so the
 * hover tooltip behaves exactly like the ones already on player names, and the
 * colours are the ones the snapshot ships with.
 *
 * Ranks are decided by the backend; this file only knows how to draw them.
 */
(function () {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';

  /* Straight out of /tmp/colb/f0.html - crown, shield and star, in that
   * snapshot's own colours. */
  const ROLES = {
    website_owner: {
      label: 'Website Owner',
      color: '#41e0d0',
      /* A cut gem: the crown belongs to the site owner, so the rank above it
       * gets its own shape rather than a second crown in another colour. */
      path: 'M6 2h12l4 6-10 14L2 8l4-6zm.24 2L4.4 6.8h3.2L9 4H6.24zm4.86 0L9.7 6.8h4.6L12.9 4h-1.8zm4.66 0-1.4 2.8h3.24L15.76 4zM4.6 8.8 10 17.3 7.9 8.8H4.6zm5.36 0L12 17.9l2.04-9.1H9.96zm6.14 0-2.1 8.5 5.4-8.5h-3.3z',
    },
    owner: {
      label: 'Site Owner',
      color: '#ffd700',
      path: 'M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5zm14 3c0 .6-.4 1-1 1H6c-.6 0-1-.4-1-1v-1h14v1z',
    },
    value_manager: {
      label: 'Value Manager',
      color: '#c0c0c0',
      path: 'M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 2.18l7 3.12v4.7c0 4.67-3.13 8.89-7 10.02-3.87-1.13-7-5.35-7-10.02v-4.7l7-3.12z',
    },
    staff: {
      label: 'Value Team',
      color: '#a259ff',
      path: 'M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z',
    },
  };

  /* The plain name for a rank, for places that want words rather than a
   * picture - the Permissions cell on the dashboard, for one. */
  function label(role) {
    return ROLES[role] ? ROLES[role].label : '';
  }

  /* An .lb_badge span for one rank, or null for a rank that has no icon.
   * Returning null rather than an empty span keeps callers from planting
   * invisible gaps in a name row. */
  function iconFor(role) {
    const spec = ROLES[role];
    if (!spec) return null;

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'currentColor');
    svg.setAttribute('aria-hidden', 'true');

    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', spec.path);
    svg.appendChild(path);

    const wrap = document.createElement('span');
    wrap.className = 'lb_badge';
    wrap.style.color = spec.color;
    wrap.appendChild(svg);

    const tip = document.createElement('span');
    tip.className = 'badge-tt';
    tip.textContent = spec.label;
    wrap.appendChild(tip);

    wrap.setAttribute('title', spec.label);
    return wrap;
  }

  window.WolimonsRoleIcons = {
    ROLES,
    label,
    iconFor,
  };
})();
