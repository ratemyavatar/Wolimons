/*
 * Wolimons - the Discord panel on the front page.
 *
 * The 2018 site embedded Discord's own widget in an iframe. That iframe still
 * exists, but it only renders when the server owner has switched the widget
 * on in Server Settings, and when it is off it shows an error rather than
 * nothing - so the page would carry a broken box for anybody who saw it
 * before that switch was flipped.
 *
 * This draws the same panel from our own markup instead, using the class
 * names and stylesheet the original used. The numbers come from our backend,
 * which asks Discord once a minute and caches the answer:
 *
 *   widget on   - real faces, names, statuses and what people are playing
 *   widget off  - the online and member counts, which the invite always
 *                 reports, and an honest line instead of a fake member list
 *
 * So it works today, and gets better on its own the moment the widget is
 * enabled. Nothing here needs changing either way.
 */
(() => {
  'use strict';

  const CONFIG = window.WOLIMONS_CONFIG || {};
  const API_BASE = CONFIG.apiBase || '';

  const mount = document.getElementById('discord_widget');
  if (!mount) return;

  /* Discord's mark, the same path the navbar already draws. */
  const LOGO = 'M9.6 10.97c-.55 0-.98.48-.98 1.06 0 .57.44 1.05.97 1.05.54 0 .97-.48.97-1.05.01'
    + '-.58-.43-1.06-.97-1.06zm3.46 0c-.54 0-.97.48-.97 1.06 0 .57.44 1.05.97 1.05.54 0 .97-.48'
    + '.97-1.05 0-.58-.43-1.06-.97-1.06z';
  const LOGO_BODY = 'M17.68 3H4.95A1.95 1.95 0 0 0 3 4.96V17.8c0 1.08.87 1.96 1.95 1.96h10.77l-.5'
    + '-1.76 1.21 1.13 1.15 1.06L19.63 22V4.96A1.95 1.95 0 0 0 17.68 3zM14 15.4l-.63-.76c1.25-.36'
    + ' 1.72-1.13 1.72-1.13a5.5 5.5 0 0 1-1.09.56 6.68 6.68 0 0 1-3.84.4 7.94 7.94 0 0 1-1.4-.41'
    + ' 5.4 5.4 0 0 1-.69-.33L8 13.7a.12.12 0 0 1-.04-.03l-.27-.16s.46.76 1.67 1.12l-.64.79c-2.1'
    + '-.07-2.9-1.45-2.9-1.45 0-3.06 1.37-5.54 1.37-5.54 1.37-1.02 2.67-1 2.67-1l.1.12c-1.72.5-2.5'
    + ' 1.25-2.5 1.25l.56-.28a7.16 7.16 0 0 1 2.15-.6l.17-.02a7.76 7.76 0 0 1 4.77.9s-.75-.72-2.36'
    + '-1.21l.13-.15s1.3-.03 2.67 1c0 0 1.37 2.48 1.37 5.53 0 0-.81 1.38-2.91 1.45z';

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  const formatNumber = value => Number(value || 0).toLocaleString('en-US');

  function header(data) {
    const head = el('div', 'widget-header');

    const logo = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    logo.setAttribute('viewBox', '0 0 24 24');
    logo.setAttribute('class', 'widget-logo-svg');
    logo.setAttribute('aria-hidden', 'true');
    [LOGO, LOGO_BODY].forEach(d => {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', d);
      path.setAttribute('fill', 'currentColor');
      logo.appendChild(path);
    });
    head.appendChild(logo);

    const count = el('span', 'widget-header-count');
    if (data.online === null || data.online === undefined) {
      count.appendChild(el('span', null, 'Wolimons Discord'));
    } else {
      count.appendChild(el('strong', null, formatNumber(data.online)));
      count.appendChild(el('span', null, ' Members Online'));
    }
    head.appendChild(count);
    return head;
  }

  function memberRow(member) {
    const row = el('div', 'widget-member');

    const avatarWrap = el('div', 'widget-member-avatar');
    if (member.avatar) {
      const image = document.createElement('img');
      image.src = member.avatar;
      image.alt = '';
      image.loading = 'lazy';
      /* A deleted avatar should leave the dot, not a broken-image glyph. */
      image.addEventListener('error', () => { image.style.visibility = 'hidden'; });
      avatarWrap.appendChild(image);
    }
    avatarWrap.appendChild(el('span', `widget-member-status widget-member-status-${member.status}`));
    row.appendChild(avatarWrap);

    row.appendChild(el('span', 'widget-member-name', member.name));
    if (member.game) row.appendChild(el('span', 'widget-member-game', member.game));
    return row;
  }

  function join(data) {
    const link = el('a', 'widget-join', 'Join Server');
    link.href = data.invite;
    link.target = '_blank';
    link.rel = 'noopener';
    return link;
  }

  function render(data) {
    const widget = el('div', 'widget widget-theme-dark');
    widget.appendChild(header(data));

    const body = el('div', 'widget-body');

    if (data.enabled && data.members.length) {
      body.appendChild(el('div', 'widget-members-online', 'Members Online'));
      const list = el('div', 'widget-member-list');
      data.members.forEach(member => list.appendChild(memberRow(member)));
      body.appendChild(list);
    } else {
      /*
       * The widget is off, so Discord will not say who is online - only how
       * many. Saying that plainly beats inventing a member list, and beats
       * the empty grey box the real iframe renders in this situation.
       */
      const note = el('div', 'widget-note');
      if (data.total) {
        note.appendChild(el('div', 'widget-note-figure', formatNumber(data.total)));
        note.appendChild(el('div', 'widget-note-label', 'members'));
      }
      note.appendChild(el('p', 'widget-note-text',
        'Discord only lists who is online for servers with the widget switched on. '
        + 'The counts above are live either way.'));
      body.appendChild(note);
    }

    body.appendChild(join(data));
    widget.appendChild(body);

    mount.replaceChildren(widget);
  }

  function failed() {
    const widget = el('div', 'widget widget-theme-dark');
    widget.appendChild(header({ online: null }));
    const body = el('div', 'widget-body');
    body.appendChild(el('p', 'widget-note-text', 'Discord could not be reached just now.'));
    body.appendChild(join({ invite: 'https://discord.gg/vCwRzWSMf' }));
    widget.appendChild(body);
    mount.replaceChildren(widget);
  }

  (async function load() {
    try {
      const response = await fetch(`${API_BASE}/api/discord`, { headers: { Accept: 'application/json' } });
      const data = await response.json();
      if (!data || data.ok === false) {
        failed();
        return;
      }
      render(data);
    } catch (error) {
      failed();
    }
  })();
})();
