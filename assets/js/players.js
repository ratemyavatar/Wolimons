/*
 * Wolimons player search (/players).
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS PAGE IS
 * ---------------------------------------------------------------------------
 * The browsable directory of every player Wolimons knows about, and the way
 * into a profile when you already know a name. The leaderboard ranks the same
 * roster; this page just lists it and lets you filter it, so both share
 * assets/js/player-roster.js and its single cache entry - arriving here after
 * the leaderboard (or the other way round) draws instantly.
 *
 * ---------------------------------------------------------------------------
 * TWO WAYS TO FIND SOMEONE, AND WHY
 * ---------------------------------------------------------------------------
 * 1. Filtering the list. The roster is derived from collectible ownership, so
 *    it holds exactly the players who own at least one collectible. Typing in
 *    the search box narrows those cards down; it is a local substring match,
 *    with no request behind it.
 *
 * 2. Exact-name lookup, behind the "Look Up Player" button. Wanwood has no
 *    user-search endpoint - the only name-based call it offers is
 *    users/v1/usernames/users, which resolves one exact username and nothing
 *    else. So partial names, prefixes and suggestions are impossible against
 *    this backend, and rather than fake them the modal is honest about what
 *    it does: give it the exact username and it opens that profile.
 *
 * Nobody is ever "added to the site" - the source page this layout came from
 * kept a database of players and this one does not. Every profile is read
 * live from Wanwood, so a player who is not in the list below is still
 * perfectly reachable by name.
 */
(() => {
  'use strict';

  const API = window.WanwoodAPI;
  const VALUES = window.WolimonsValues;
  const ROSTER = window.WolimonsRoster;
  /* Built by assets/js/name-badges.js, which the leaderboard and the profile
   * page share so the same award renders identically everywhere. */
  const NAME_BADGES = window.WolimonsNameBadges;

  const PAGE_SIZE = 30;
  const AVATAR_SIZE = 150;

  const grid = document.getElementById('players_mix_container');
  const statusBox = document.getElementById('players_status');
  const searchBox = document.getElementById('player_search_textbox');
  const searchClear = document.getElementById('player_search_textbox_clear');
  const paginationTop = document.getElementById('pagination_control_top');
  const paginationBottom = document.getElementById('pagination_control_bottom');

  const lookupButton = document.getElementById('add_player_button');
  const lookupModal = document.getElementById('add_player_modal');
  const lookupInput = document.getElementById('player_add_textbox');
  const lookupSubmit = document.getElementById('player_add_button');
  const lookupNotice = document.getElementById('player_add_notice');
  const lookupResults = document.getElementById('player_add_results');
  const lookupClose = document.getElementById('player_add_close_button');

  /* Everyone the scan found, ordered. Never mutated after load. */
  let players = [];
  /* The rows currently on screen (all of them, or the search subset). */
  let visible = [];
  let page = 1;

  const formatNumber = number => Number(number || 0).toLocaleString('en-US');

  const text = (tag, className, value) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined) node.textContent = value;
    return node;
  };

  function setStatus(message, { spinner = false } = {}) {
    if (!statusBox) return;
    statusBox.textContent = '';
    if (!message) {
      statusBox.classList.add('d-none');
      return;
    }
    statusBox.classList.remove('d-none');
    const box = text('div', 'text-center py-4 small');
    box.style.color = '#9aa3aa';
    box.textContent = message;
    if (spinner) box.classList.add('lb_loading');
    statusBox.appendChild(box);
  }

  /* ------------------------------------------------------------------ */
  /* Cards                                                               */
  /* ------------------------------------------------------------------ */

  /*
   * One card per player, in the .mix_item shape the catalog grid already
   * uses, with the leaderboard's name header, avatar-on-a-gradient and stat
   * rows inside it. Value leads and RAP follows, the same order and the same
   * colours as everywhere else on the site - Value is the community figure
   * from values.js, or the item's RAP until somebody sets one.
   */
  function playerCard(player) {
    const card = text('div', 'shadow_md_35 shift_up_md pb-2 mb-3 mix_item');
    card.dataset.playerId = String(player.id);
    card.style.backgroundColor = '#30363c';

    const link = document.createElement('a');
    link.href = `/player/?id=${player.id}`;

    const headingWrap = document.createElement('div');
    const heading = text('h6', 'my-0 px-2 text-light py-1 d-flex align-items-center');
    heading.style.backgroundColor = '#30363c';
    heading.title = player.name;
    heading.appendChild(text('span', 'text-truncate', player.name));
    if (NAME_BADGES) {
      NAME_BADGES.badgeNodes(player).forEach(node => heading.appendChild(node));
    }
    headingWrap.appendChild(heading);

    const imageWrap = text('div',
      'position-relative std_item_card_img_bkgnd_gradient text-center border-top border-bottom border-dark py-2');
    const image = document.createElement('img');
    image.className = 'mx-auto player-thumbnail';
    image.width = AVATAR_SIZE;
    image.height = AVATAR_SIZE;
    image.alt = `${player.name} thumbnail`;
    image.loading = 'lazy';
    image.style.maxWidth = `${AVATAR_SIZE}px`;
    if (player.avatar) image.src = player.avatar;
    /* A player with no render should not leave a broken-image glyph. */
    image.addEventListener('error', () => { image.style.visibility = 'hidden'; });
    imageWrap.appendChild(image);

    const stats = text('div', 'px-2 pt-1');
    stats.appendChild(statRow('Value', `R$ ${formatNumber(player.value)}`, 'text-info'));
    stats.appendChild(statRow('RAP', `R$ ${formatNumber(player.rap)}`, 'text-success'));
    stats.appendChild(statRow('Items', formatNumber(player.items), 'text-light'));

    link.append(headingWrap, imageWrap, stats);
    card.appendChild(link);
    return card;
  }

  function statRow(label, value, valueClass) {
    const row = text('div', 'd-flex justify-content-between');
    const left = text('div');
    left.appendChild(text('small', 'text-muted', label));
    const right = text('div');
    right.appendChild(text('span', `${valueClass} text-truncate`, value));
    row.appendChild(left);
    row.appendChild(right);
    return row;
  }

  /* ------------------------------------------------------------------ */
  /* Pagination                                                          */
  /* ------------------------------------------------------------------ */

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const ARROW_PREV = 'm4.431 12.822 13 9A1 1 0 0 0 19 21V3a1 1 0 0 0-1.569-.823l-13 9a1.003 1.003 0 0 0 0 1.645z';
  const ARROW_NEXT = 'M5.536 21.886a1.004 1.004 0 0 0 1.033-.064l13-9a1 1 0 0 0 0-1.644l-13-9A1 1 0 0 0 5 3v18a1 1 0 0 0 .536.886z';

  /*
   * The markup .simple-pagination.dark-theme in css/simplepagination.min.css
   * already knows how to paint, so no new CSS is involved. Windows to five
   * pages around the current one with an ellipsis and the last page pinned.
   */
  function pageNumbers(current, total) {
    if (total <= 7) {
      return Array.from({ length: total }, (unused, index) => index + 1);
    }
    const shown = new Set([1, total, current]);
    for (let offset = -1; offset <= 1; offset += 1) {
      const near = current + offset;
      if (near > 1 && near < total) shown.add(near);
    }
    /* Always show the first few so the control does not jump around. */
    [2, 3, 4, 5].forEach(early => { if (current <= 4 && early < total) shown.add(early); });

    const sorted = [...shown].filter(n => n >= 1 && n <= total).sort((a, b) => a - b);
    const out = [];
    sorted.forEach((number, index) => {
      if (index && number - sorted[index - 1] > 1) out.push('...');
      out.push(number);
    });
    return out;
  }

  function arrow(pathData) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('xmlns', SVG_NS);
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('viewBox', '0 2 25 25');
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('fill', 'currentColor');
    path.setAttribute('d', pathData);
    svg.appendChild(path);
    return svg;
  }

  function renderPagination(host, total) {
    if (!host) return;
    /* Clear first: this appends a widget and renderPage() runs on every
     * keystroke, so without it the strip would stack up copy after copy. */
    host.replaceChildren();
    if (total <= 1) return;

    const shell = text('div', 'simple-pagination dark-theme');
    const list = document.createElement('ul');

    const linkTo = (target, className, content) => {
      const item = document.createElement('li');
      const anchor = document.createElement('a');
      anchor.href = '#';
      anchor.className = className;
      anchor.dataset.page = String(target);
      if (typeof content === 'string') anchor.textContent = content;
      else anchor.appendChild(content);
      anchor.addEventListener('click', event => {
        event.preventDefault();
        if (anchor.classList.contains('disabled')) return;
        goToPage(target);
      });
      item.appendChild(anchor);
      return item;
    };

    list.appendChild(linkTo(Math.max(1, page - 1),
      `page-link-woli prev${page === 1 ? ' disabled' : ''}`, arrow(ARROW_PREV)));

    pageNumbers(page, total).forEach(entry => {
      const item = document.createElement('li');
      if (entry === '...') {
        item.appendChild(text('span', 'ellipse', '\u2026'));
        list.appendChild(item);
      } else if (entry === page) {
        item.appendChild(text('span', 'current', String(entry)));
        list.appendChild(item);
      } else {
        list.appendChild(linkTo(entry, 'page-link-woli ', String(entry)));
      }
    });

    list.appendChild(linkTo(Math.min(total, page + 1),
      `page-link-woli next${page === total ? ' disabled' : ''}`, arrow(ARROW_NEXT)));

    shell.appendChild(list);
    host.appendChild(shell);
  }

  /* ------------------------------------------------------------------ */
  /* Rendering                                                           */
  /* ------------------------------------------------------------------ */

  function renderPage() {
    if (!grid) return;
    grid.replaceChildren();

    const total = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
    if (page > total) page = total;

    if (!visible.length) {
      renderPagination(paginationTop, 0);
      renderPagination(paginationBottom, 0);
      const term = searchBox ? searchBox.value.trim() : '';
      setStatus(term
        ? `No player in the list matches "${term}". Use Look Up Player to open an exact username.`
        : 'No players with collectibles were found on Wanwood.');
      return;
    }

    setStatus('');
    const start = (page - 1) * PAGE_SIZE;
    const shown = visible.slice(start, start + PAGE_SIZE);
    shown.forEach(player => grid.appendChild(playerCard(player)));

    renderPagination(paginationTop, total);
    renderPagination(paginationBottom, total);

    /* Deliberately not awaited: the cards are already up, and the verified
     * ticks appear a moment later on the ones that earn them. */
    ensureVerified(shown);
  }

  function goToPage(target) {
    page = Math.max(1, target);
    renderPage();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /*
   * The verified flag, for the page being looked at and nothing more.
   *
   * Only users/v1/users/{id} carries it, one request per player, so fetching
   * it for the whole roster would mean a request per account for a page that
   * shows thirty at a time. Each page asks for its own after it has been
   * drawn, then redraws if any came back verified. The API client memoises
   * the answers, so revisiting a page costs nothing.
   */
  async function ensureVerified(shown) {
    const pending = shown.filter(player => player.verified === undefined);
    if (!pending.length || !API || !API.fetchVerifiedFlags) return;

    /* Mark them first so a second render cannot queue the same lookups. */
    pending.forEach(player => { player.verified = false; });

    const flags = await API.fetchVerifiedFlags(pending.map(player => player.id));

    let changed = false;
    pending.forEach(player => {
      if (flags.get(player.id) === true) {
        player.verified = true;
        changed = true;
      }
    });

    /* Only the players still on screen matter - if the reader has paged on or
     * typed in the search box, their new page will fetch its own. */
    if (changed && pending.some(player => visible.includes(player))) renderPage();
  }

  /* ------------------------------------------------------------------ */
  /* Ordering + filtering                                                */
  /* ------------------------------------------------------------------ */

  /*
   * Wealthiest first, Value leading and RAP breaking ties - the same key the
   * leaderboard ranks by, so the two pages agree about who is above whom.
   * While values.js is empty every player scores 0 on value and the order is
   * by RAP, and it becomes a value ordering the moment values are filled in.
   *
   * The comparison itself is in player-roster.js, shared with the leaderboard
   * and with the rank a profile prints, so there is one definition of "above"
   * on the whole site instead of three that could drift.
   */
  const byWorth = (a, b) => ROSTER.byRank(a, b);

  function applyFilter({ keepPage = false } = {}) {
    const term = searchBox ? searchBox.value.trim().toLowerCase() : '';
    visible = term
      ? players.filter(player => player.name.toLowerCase().includes(term))
      : players;
    if (!keepPage) page = 1;
    renderPage();
  }

  function initSearch() {
    if (searchBox) {
      let timer = 0;
      searchBox.addEventListener('input', () => {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => applyFilter(), 200);
      });
    }
    if (searchClear && searchBox) {
      searchClear.addEventListener('click', event => {
        event.preventDefault();
        searchBox.value = '';
        applyFilter();
        searchBox.focus();
      });
    }
  }

  /* ------------------------------------------------------------------ */
  /* Exact-name lookup                                                   */
  /* ------------------------------------------------------------------ */

  /* Bootstrap's JS is not loaded on this site, so modals are shown by hand
   * the same way the rest of the pages do it. */
  function showModal(modal, open) {
    if (!modal) return;
    modal.classList.toggle('show', open);
    modal.style.display = open ? 'block' : 'none';
    modal.setAttribute('aria-hidden', open ? 'false' : 'true');
    document.body.classList.toggle('modal-open', open);
  }

  function setNotice(message, colour) {
    if (!lookupNotice) return;
    lookupNotice.textContent = message || '';
    lookupNotice.style.color = colour || '#adadad';
    lookupNotice.classList.toggle('d-none', !message);
  }

  /*
   * The found player, drawn as the same .search-player-card the navbar's
   * search and /verify already use - so a lookup result looks like a search
   * result everywhere on the site, and no new card CSS is introduced.
   */
  function resultCard({ id, name, avatar }) {
    const wrapper = text('div', 'shadow_md_35 shift_up_md pb-2 search-player-card');
    wrapper.style.backgroundColor = '#30363c';

    const link = document.createElement('a');
    link.href = `/player/?id=${id}`;

    const imageWrap = text('div',
      'std_item_card_img_bkgnd_gradient text-center border-bottom border-dark');
    const image = document.createElement('img');
    image.className = 'd-block-inline my-1';
    image.src = avatar || '/assets/Wolimonslogoo.png';
    image.width = 100;
    image.height = 100;
    image.alt = `${name} thumbnail`;
    image.loading = 'lazy';
    imageWrap.appendChild(image);

    const title = text('div', 'px-2 pt-1 text-light text-truncate', name);
    title.style.fontSize = '0.85em';
    title.style.fontWeight = '600';
    title.title = name;

    link.append(imageWrap, title, text('div', 'px-2 text-truncate small text-muted', `ID ${id}`));
    wrapper.appendChild(link);
    return wrapper;
  }

  function showResult(player) {
    if (!lookupResults) return;
    if (!player) {
      lookupResults.replaceChildren();
      return;
    }
    /* One card, centred. The .search-player-card-grid the navbar search uses
     * is sized off the viewport, so inside a 500px dialog it would squeeze a
     * lone card down to a thumbnail; a single centred column is the same card
     * at the size it was drawn for. */
    const holder = text('div', 'mx-auto');
    holder.style.maxWidth = '160px';
    holder.appendChild(resultCard(player));
    lookupResults.replaceChildren(holder);
  }

  async function runLookup() {
    if (!lookupInput || !lookupSubmit) return;
    const name = lookupInput.value.trim();
    if (!name) return;

    showResult(null);

    /* A name already on this page needs no request at all. */
    const known = players.find(player => player.name.toLowerCase() === name.toLowerCase());
    if (known) {
      setNotice('Already in the list below.', '#9aa3aa');
      showResult(known);
      return;
    }

    if (!API || !API.getUserByUsername) {
      setNotice('The Wanwood API client failed to load.', '#ff6b6b');
      return;
    }

    lookupSubmit.disabled = true;
    setNotice('Looking up\u2026');

    /* A bare number is treated as a user id, the same shortcut the navbar's
     * player search offers. */
    let user = null;
    try {
      user = /^\d+$/.test(name)
        ? await API.getUserById(Number(name))
        : await API.getUserByUsername(name);
    } catch (error) {
      /* Thrown for "no such user" as well as for a network failure; the two
       * are indistinguishable from here, so the message covers both. */
      user = null;
    }

    lookupSubmit.disabled = false;

    if (!user || !user.id) {
      setNotice(`No Wanwood player is named "${name}". `
        + 'This lookup needs the exact username - Wanwood has no partial name search.', '#ff6b6b');
      return;
    }

    let avatar = '';
    if (API.fetchUserThumbnails) {
      try {
        const thumbs = await API.fetchUserThumbnails([user.id], AVATAR_SIZE);
        avatar = thumbs.get(user.id) || '';
      } catch (error) {
        /* A missing render is cosmetic - the card falls back to the logo. */
      }
    }

    setNotice('Found. Open the profile below.', '#9aa3aa');
    showResult({ id: user.id, name: user.name, avatar });
  }

  function initLookup() {
    if (lookupButton) {
      lookupButton.addEventListener('click', event => {
        event.preventDefault();
        setNotice('');
        showResult(null);
        showModal(lookupModal, true);
        if (lookupInput) {
          /* Carry whatever was typed in the page search over, so a fruitless
           * filter turns into a lookup without retyping the name. */
          if (searchBox && searchBox.value.trim() && !lookupInput.value.trim()) {
            lookupInput.value = searchBox.value.trim();
          }
          lookupInput.focus();
          if (lookupSubmit) lookupSubmit.disabled = !lookupInput.value.trim();
        }
      });
    }

    if (lookupInput && lookupSubmit) {
      lookupInput.addEventListener('input', () => {
        lookupSubmit.disabled = !lookupInput.value.trim();
        setNotice('');
        showResult(null);
      });
      lookupInput.addEventListener('keydown', event => {
        if (event.key === 'Enter' && lookupInput.value.trim()) {
          event.preventDefault();
          runLookup();
        }
      });
      lookupSubmit.addEventListener('click', event => {
        event.preventDefault();
        runLookup();
      });
    }

    const dismiss = event => {
      event.preventDefault();
      showModal(lookupModal, false);
    };
    if (lookupClose) lookupClose.addEventListener('click', dismiss);
    if (lookupModal) {
      lookupModal.querySelectorAll('[data-dismiss="modal"]')
        .forEach(node => node.addEventListener('click', dismiss));
      /* Clicking the backdrop closes it, as it does elsewhere on the site. */
      lookupModal.addEventListener('click', event => {
        if (event.target === lookupModal) showModal(lookupModal, false);
      });
    }
  }

  /* ------------------------------------------------------------------ */
  /* Boot                                                                */
  /* ------------------------------------------------------------------ */

  /* Sort and draw - shared by the live scan and the cache. */
  function publish(roster) {
    players = [...roster].sort(byWorth);
    applyFilter({ keepPage: true });
  }

  async function load() {
    if (!ROSTER) {
      setStatus('The player roster script failed to load.');
      return;
    }

    setStatus('Finding players\u2026', { spinner: true });

    /* A player's Value is the sum of the values of their collectibles, so the
     * value table has to be in hand before the roster is totalled - otherwise
     * every row would read 0 until something else forced a rebuild. Waiting
     * costs nothing: values.js is already in flight by the time this runs. */
    if (VALUES && VALUES.ready && typeof VALUES.ready.then === 'function') {
      try {
        await VALUES.ready;
      } catch (error) {
        /* No values is a legitimate state - everyone simply scores 0. */
      }
    }

    let roster = [];
    try {
      roster = await ROSTER.load({
        onProgress: (partial, progress) => {
          publish(partial);
          setStatus(`Finding players\u2026 ${progress.done}/${progress.total} items, `
            + `${partial.length} players so far.`);
        },
      });
    } catch (error) {
      setStatus('Could not reach Wanwood to list players. Try again shortly.');
      settled = true;
      return;
    }

    publish(roster);
    settled = true;
  }

  /* The admin panel can change values while this page is open, and a
   * player's Value is the sum of the values of their collectibles - so a
   * change means the roster has to be totalled again. Dropping the cache is
   * enough: the owner lists are already memoised by the API client, so the
   * rebuild is cheap. Callbacks before the first load has finished are
   * ignored, since load() waits for the initial table itself. */
  let settled = false;
  if (VALUES && typeof VALUES.subscribe === 'function') {
    VALUES.subscribe(() => {
      if (!settled) return;
      ROSTER.clearCache();
      load();
    });
  }

  /* Owner-granted badges arrive from the backend a moment after the page, so
   * the cards on screen are repainted when they land. Ordering is unaffected
   * - a badge is not part of the ranking key. */
  window.WolimonsGrantedBadges?.subscribe(() => {
    if (players.length) renderPage();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { initSearch(); initLookup(); load(); });
  } else {
    initSearch();
    initLookup();
    load();
  }
})();
