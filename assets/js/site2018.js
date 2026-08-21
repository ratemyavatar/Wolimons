/*
 * Wolimons - the 2018 pages.
 *
 * These pages are the 2018 site: their markup came out of the snapshots and
 * was kept. Nothing here writes new HTML. Where a page repeats an element -
 * a catalog card, a player card, a table row - the build tool moved one real
 * 2018 element into a <template>, and this clones that and fills in the text.
 * Every node on screen is therefore 2018 markup carrying today's data.
 *
 * Which page it is on comes from data-page-2018 on <body>.
 */
(() => {
  'use strict';

  const API = window.WanwoodAPI;
  const VALUES = window.WolimonsValues;
  const CONFIG = window.WOLIMONS_CONFIG || {};
  const API_BASE = CONFIG.apiBase || '';

  const page = document.body ? document.body.getAttribute('data-page-2018') : '';
  if (!page) return;

  const money = value => Number(value || 0).toLocaleString('en-US');
  const byId = id => document.getElementById(id);

  /* A clone of one of the page's own 2018 elements. */
  function fromTemplate(name) {
    const template = byId(`tpl_${name}`);
    if (!template) return null;
    const node = template.content
      ? template.content.firstElementChild.cloneNode(true)
      : null;
    return node;
  }

  /*
   * Fill a cloned card.
   *
   * The 2018 cards are a title, a picture, and a column of
   * "<small>Label</small> ... <p>figure</p>" rows. Rather than depend on the
   * order those appear in, each row is found by the label it already carries
   * - so a card keeps working even where two snapshots differ.
   */
  function setRow(node, label, value) {
    const rows = [...node.querySelectorAll('.d-flex.justify-content-between')];
    const row = rows.find(candidate => {
      const small = candidate.querySelector('small');
      return small && small.textContent.trim().toLowerCase() === label.toLowerCase();
    });
    if (!row) return;
    const figure = row.querySelector('p, .card-text') || row.lastElementChild;
    if (figure) figure.textContent = value;
  }

  function setTitle(node, text) {
    const title = node.querySelector('.card-title, h6');
    if (!title) return;
    title.textContent = text;
    title.setAttribute('title', text);
  }

  function setImage(node, src, alt) {
    const image = node.querySelector('img');
    if (!image) return;
    image.src = src;
    image.alt = alt;
    image.loading = 'lazy';
  }

  function setLink(node, href) {
    const link = node.matches('a') ? node : node.querySelector('a');
    if (link) link.href = href;
  }

  function replaceChildren(container, nodes) {
    if (!container) return;
    container.textContent = '';
    nodes.forEach(node => container.appendChild(node));
  }

  function say(container, words) {
    if (!container) return;
    container.textContent = '';
    const note = document.createElement('p');
    note.className = 'text-center text-muted my-4';
    note.textContent = words;
    container.appendChild(note);
  }

  /* ------------------------------------------------------------------ */
  /* Catalog and projected items - both are grids of the same card       */
  /* ------------------------------------------------------------------ */

  /*
   * Each 2018 page names its grid after itself - catpg_, projectionspg_,
   * valuechangespg_, playerpg_ - so the container is found by the shape of
   * the name rather than by listing every one of them.
   */
  function findGrid() {
    return document.querySelector('[class*="_grid_container"], [data-ref$="_grid_container"]');
  }

  async function loadItemGrid({ onlyProjected = false } = {}) {
    const grid = findGrid();
    if (!grid || !fromTemplate('item')) return;

    say(grid, 'Loading items\u2026');
    let items;
    try {
      const response = await fetch(`${API_BASE}/api/v1/itemdetails`);
      const payload = await response.json();
      items = payload && payload.items ? payload.items : null;
    } catch (error) {
      items = null;
    }
    if (!items) {
      say(grid, 'The item list could not be loaded.');
      return;
    }

    const rows = Object.entries(items)
      .map(([id, item]) => ({ id: Number(id), ...item }))
      .filter(item => (onlyProjected ? item.projected : true))
      .sort((a, b) => (b.value || b.rap || 0) - (a.value || a.rap || 0));

    if (!rows.length) {
      say(grid, onlyProjected ? 'No items are marked as projected.' : 'No items are being tracked yet.');
      return;
    }

    replaceChildren(grid, rows.map(item => {
      const node = fromTemplate('item');
      setTitle(node, item.name || `Item ${item.id}`);
      setImage(node, API ? API.thumbnailUrl(item.id) : '', `${item.name || 'Item'} thumbnail`);
      setLink(node, `/item/?id=${item.id}`);
      setRow(node, 'Price', item.lowest_price ? money(item.lowest_price) : '-');
      setRow(node, 'RAP', money(item.rap));
      setRow(node, 'Value', item.value ? money(item.value) : '-');
      setRow(node, 'Available', item.available === undefined ? '-' : money(item.available));
      setRow(node, 'BC Copies', '-');
      return node;
    }));
  }

  /* ------------------------------------------------------------------ */
  /* Players and the leaderboard                                         */
  /* ------------------------------------------------------------------ */

  async function loadPlayers() {
    const grid = findGrid();
    if (!grid) return;

    const template = fromTemplate('player') || fromTemplate('item');
    if (!template) return;

    say(grid, 'Loading players\u2026');
    const roster = window.WolimonsRoster;
    let players = [];
    try {
      players = roster ? await roster.load() : [];
    } catch (error) {
      players = [];
    }
    if (!players.length) {
      say(grid, 'No tracked players yet.');
      return;
    }

    const top = players
      .slice()
      .sort((a, b) => (b.value || 0) - (a.value || 0))
      .slice(0, 60);

    const thumbs = API ? await API.fetchUserThumbnails(top.map(p => p.id), 150).catch(() => new Map())
      : new Map();

    replaceChildren(grid, top.map((player, index) => {
      const node = fromTemplate('player') || fromTemplate('item');
      setTitle(node, player.name || `User ${player.id}`);
      setImage(node, thumbs.get(player.id) || '/assets/Wolimonslogoo.png', `${player.name} thumbnail`);
      setLink(node, `/player/?id=${player.id}`);
      setRow(node, 'Rank', `#${index + 1}`);
      setRow(node, 'Value', money(player.value));
      setRow(node, 'RAP', money(player.rap));
      return node;
    }));
  }

  /* ------------------------------------------------------------------ */
  /* Recent value changes                                                */
  /* ------------------------------------------------------------------ */

  async function loadValueChanges() {
    const grid = findGrid();
    if (!grid || !fromTemplate('item')) return;

    say(grid, 'Loading changes\u2026');
    let changes = [];
    let items = {};
    try {
      const [feed, details] = await Promise.all([
        fetch(`${API_BASE}/api/v1/valuechanges?limit=60`).then(r => r.json()),
        fetch(`${API_BASE}/api/v1/itemdetails`).then(r => r.json()).catch(() => null),
      ]);
      changes = feed && Array.isArray(feed.changes) ? feed.changes : [];
      items = details && details.items ? details.items : {};
    } catch (error) {
      changes = [];
    }

    const valueChanges = changes.filter(change => change && change.field === 'value');
    if (!valueChanges.length) {
      say(grid, 'No values have been changed yet.');
      return;
    }

    /*
     * This card is its own shape: a coloured "Value Changed" line, then Old
     * and New. The New figure carries an arrow glyph beside it, so only the
     * text is replaced and the arrow is left where 2018 put it - turned to
     * point the way this change actually went.
     */
    replaceChildren(grid, valueChanges.map(change => {
      const item = items[String(change.id)] || {};
      const node = fromTemplate('item');
      const rose = Number(change.new) >= Number(change.old);

      setTitle(node, item.name || `Item ${change.id}`);
      setImage(node, API ? API.thumbnailUrl(change.id) : '', 'Item thumbnail');
      setLink(node, `/item/?id=${change.id}`);
      setRow(node, 'Old', money(change.old));

      /* Keep the arrow, replace the number beside it. */
      const rows = [...node.querySelectorAll('.d-flex.justify-content-between')];
      const newRow = rows.find(row => {
        const small = row.querySelector('small');
        return small && small.textContent.trim() === 'New';
      });
      if (newRow) {
        const figure = newRow.querySelector('p, .card-text');
        if (figure) {
          const arrow = figure.querySelector('svg');
          figure.textContent = '';
          if (arrow) {
            const glyph = arrow.querySelector('path');
            if (glyph) glyph.setAttribute('fill', rose ? 'lime' : '#ee5f5b');
            if (!rose) arrow.style.transform = 'rotate(180deg)';
            figure.appendChild(arrow);
            figure.appendChild(document.createTextNode(' '));
          }
          figure.appendChild(document.createTextNode(money(change.new)));
        }
      }

      /* The card's timestamp line, where 2018 put "2 hours ago". */
      const when = node.querySelector('.d-flex.mt-2 p, .d-flex.mt-2 small');
      if (when && change.at) when.textContent = new Date(change.at).toISOString().slice(0, 10);
      return node;
    }));
  }

  /* ------------------------------------------------------------------ */
  /* The Discord panel - 2018 only, which is where it came from          */
  /* ------------------------------------------------------------------ */

  async function loadDiscord() {
    /* The snapshot's own iframe was removed with the rest of the scripts and
     * frames; this puts the panel back in the box that held it. */
    const heading = [...document.querySelectorAll('h3')]
      .find(node => /discord/i.test(node.textContent || ''));
    if (!heading) return;
    const box = heading.parentElement && heading.parentElement.querySelector('div');
    if (!box) return;

    box.id = 'discord_widget';
    box.className = 'wolimons_discord';

    const sheet = document.createElement('link');
    sheet.rel = 'stylesheet';
    sheet.href = '/css/discord-widget.css';
    document.head.appendChild(sheet);

    const script = document.createElement('script');
    script.src = '/assets/js/discord-widget.js';
    document.body.appendChild(script);
  }

  /* ------------------------------------------------------------------ */
  /* Preferences - the 2018 page, driving the same settings              */
  /* ------------------------------------------------------------------ */

  function wirePreferences() {
    const PREFS = window.WolimonsPrefs;
    const THEME = window.WolimonsTheme;
    if (!THEME) return;

    /* The 2018 preferences page is a column of checkboxes. The first is
     * given to the theme, so a reader can get back to the modern site from
     * inside the old one without hunting for it. */
    const box = document.querySelector('input[type="checkbox"]');
    const label = box && (box.closest('.custom-control, .form-check, div') || {}).querySelector
      ? box.closest('.custom-control, .form-check, div').querySelector('label')
      : null;

    if (box) {
      box.checked = true;
      box.addEventListener('change', () => THEME.set(box.checked));
    }
    if (label) label.textContent = 'Use 2018 Theme';

    if (PREFS) {
      const others = [...document.querySelectorAll('input[type="checkbox"]')].slice(1);
      const names = ['hideTablets', 'hideUnobtainables'];
      others.slice(0, names.length).forEach((other, index) => {
        other.checked = Boolean(PREFS.get(names[index]));
        other.addEventListener('change', () => PREFS.set(names[index], other.checked));
      });
    }
  }

  /*
   * Every 2018 page gets a way back to the modern site. Built from a link the
   * navbar already contains, so it is the page's own markup.
   */
  function addExitLink() {
    const nav = document.querySelector('.navbar-nav');
    if (!nav) return;
    const sample = nav.querySelector('li.nav-item');
    if (!sample) return;

    const item = sample.cloneNode(true);
    const link = item.querySelector('a');
    if (!link) return;
    link.textContent = 'Leave 2018';
    link.href = '#';
    link.removeAttribute('data-toggle');
    link.addEventListener('click', event => {
      event.preventDefault();
      if (window.WolimonsTheme) window.WolimonsTheme.set(false);
    });
    /* Drop any dropdown the clone brought with it. */
    item.querySelectorAll('.dropdown-menu').forEach(menu => menu.remove());
    item.classList.remove('dropdown');
    nav.appendChild(item);
  }

  function start() {
    addExitLink();

    if (page === 'home') loadDiscord();
    if (page === 'catalog') loadItemGrid();
    if (page === 'projecteds') loadItemGrid({ onlyProjected: true });
    if (page === 'valuechanges') loadValueChanges();
    if (page === 'players' || page === 'leaderboard') loadPlayers();
    if (page === 'preferences') wirePreferences();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
