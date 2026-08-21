/*
 * Wolimons player leaderboard.
 *
 * ---------------------------------------------------------------------------
 * WHERE THE RANKING COMES FROM
 * ---------------------------------------------------------------------------
 * The roster itself - who exists, and what each of them holds - is built by
 * assets/js/player-roster.js, which /players shares. See the long comment at
 * the top of that file for how the scan works and why it walks the catalog's
 * owner lists instead of the user id space. Everything here is the *ranking*:
 * ordering that roster, numbering it, and drawing the board.
 *
 * ---------------------------------------------------------------------------
 * VALUE vs RAP
 * ---------------------------------------------------------------------------
 * Value is community-set and lives in values.js - it is never a price and it
 * is never fetched. An item nobody has valued is worth its RAP, so a player's
 * Value here is the sum of the hand-set values of their collectibles plus the
 * RAP of the ones still waiting for a figure.
 *
 * That means the board is never a column of zeros, even on a fresh checkout:
 * it starts out ordered by what the items have been selling for, and moves
 * towards the value team's own figures as they set them.
 */
(() => {
  'use strict';

  const API = window.WanwoodAPI;
  const VALUES = window.WolimonsValues;
  /* The scan, shared with /players so the two pages cost one roster between
   * them rather than one each. */
  const ROSTER = window.WolimonsRoster;

  const PAGE_SIZE = 25;
  const AVATAR_SIZE = 150;

  const cards = document.getElementById('lb_cards');
  const statusBox = document.getElementById('lb_status');
  const searchBox = document.getElementById('lb_search');
  const paginationTop = document.getElementById('pagination_control_top');
  const paginationBottom = document.getElementById('pagination_control_bottom');

  /* Every player found by the scan, ranked. Never mutated after load. */
  let ranked = [];
  /* The rows currently on screen (ranked, or the search subset). */
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
  /* Badges                                                              */
  /* ------------------------------------------------------------------ */

  /*
   * Exactly three icons can appear beside a name, and nothing else:
   *
   *   trophy      - the player sitting at rank #1, and only that one player.
   *                 It moves as the board re-sorts; it is not an award.
   *   verified    - the account's own isVerified flag from Wanwood
   *                 (users/v1/users/{id}). Never inferred from anything else.
   *   wanwoodian  - Certified Wanwoodian. Handpicked, so the recipients are
   *                 the hand-written list in config.js. No endpoint reports
   *                 it and none ever will.
   *
   * The tiered rank medals that used to live here (Top 10 / Top 50) are gone:
   * they were invented by this site rather than being real awards.
   *
   * The two picture badges reuse the artwork /badges and the profile row use,
   * so the same award looks the same everywhere. Presentation is .lb_badge /
   * .badge-tt in wolimons.css.
   */
  /* Built by assets/js/name-badges.js, which the profile page shares so the
   * same award renders identically in both places. */
  const NAME_BADGES = window.WolimonsNameBadges;

  const SVG_NS = 'http://www.w3.org/2000/svg';

  const badgeNodes = player => (NAME_BADGES ? NAME_BADGES.badgeNodes(player) : []);

  /* ------------------------------------------------------------------ */
  /* Cards                                                               */
  /* ------------------------------------------------------------------ */

  /*
   * The card shape is the Wolimons one: name header, avatar on a gradient,
   * then Rank / Value / RAP rows. The badge row inside the header is a
   * Wolimons addition.
   */
  function playerCard(player) {
    const cell = text('div', 'pb-2 mb-3 lb_cell shadow_md_35 shift_up_md mx-0');
    cell.style.backgroundColor = '#30363c';

    const link = document.createElement('a');
    link.href = `/player/?id=${player.id}`;

    const header = text('div');
    const name = text('h6', 'my-0 px-2 text-light py-1 d-flex align-items-center');
    name.style.backgroundColor = '#30363c';
    name.title = player.name;
    name.appendChild(text('span', 'text-truncate', player.name));
    badgeNodes(player).forEach(node => name.appendChild(node));
    header.appendChild(name);

    const imgWrap = text('div',
      'border-dark std_item_card_img_bkgnd_gradient border-top border-bottom text-center py-2');
    const img = document.createElement('img');
    img.className = 'mx-auto';
    img.width = AVATAR_SIZE;
    img.height = AVATAR_SIZE;
    img.alt = 'Player Thumbnail';
    img.loading = 'lazy';
    img.style.maxWidth = `${AVATAR_SIZE}px`;
    if (player.avatar) img.src = player.avatar;
    /* A player with no render should not leave a broken-image glyph. */
    img.addEventListener('error', () => { img.style.visibility = 'hidden'; });
    imgWrap.appendChild(img);

    const stats = text('div', 'px-2 pt-1');
    stats.appendChild(statRow('Rank', `#${player.rank}`, 'text-light font-weight-bold'));
    stats.appendChild(statRow('Value', `R$ ${formatNumber(player.value)}`, 'text-info'));
    stats.appendChild(statRow('RAP', `R$ ${formatNumber(player.rap)}`, 'text-success'));

    link.appendChild(header);
    link.appendChild(imgWrap);
    link.appendChild(stats);
    cell.appendChild(link);
    return cell;
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

  const ARROW_PREV = 'm4.431 12.822 13 9A1 1 0 0 0 19 21V3a1 1 0 0 0-1.569-.823l-13 9a1.003 1.003 0 0 0 0 1.645z';
  const ARROW_NEXT = 'M5.536 21.886a1.004 1.004 0 0 0 1.033-.064l13-9a1 1 0 0 0 0-1.644l-13-9A1 1 0 0 0 5 3v18a1 1 0 0 0 .536.886z';

  /*
   * Rebuilds the markup the .simple-pagination dark-theme stylesheet in
   * css/simplepagination.min.css already knows how to paint, so no new CSS
   * is involved. Windows to 5 pages around the current one with an ellipsis
   * and the last page pinned, exactly like the source page did.
   */
  function pageNumbers(current, total) {
    if (total <= 7) {
      return Array.from({ length: total }, (unused, index) => index + 1);
    }
    const window_ = new Set([1, total, current]);
    for (let offset = -1; offset <= 1; offset += 1) {
      const near = current + offset;
      if (near > 1 && near < total) window_.add(near);
    }
    /* Always show the first few so the control does not jump around. */
    [2, 3, 4, 5].forEach(early => { if (current <= 4 && early < total) window_.add(early); });

    const sorted = [...window_].filter(n => n >= 1 && n <= total).sort((a, b) => a - b);
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
    host.textContent = '';
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
    if (!cards) return;
    cards.textContent = '';

    const total = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
    if (page > total) page = total;

    if (!visible.length) {
      renderPagination(paginationTop, 0);
      renderPagination(paginationBottom, 0);
      setStatus(searchBox && searchBox.value.trim()
        ? `No player on the leaderboard matches "${searchBox.value.trim()}".`
        : 'No players with collectibles were found on Wanwood.');
      return;
    }

    setStatus('');
    const start = (page - 1) * PAGE_SIZE;
    const shown = visible.slice(start, start + PAGE_SIZE);
    shown.forEach(player => cards.appendChild(playerCard(player)));

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

  /* ------------------------------------------------------------------ */
  /* Roster + ranking                                                    */
  /* ------------------------------------------------------------------ */

  /*
   * Ranking key. Value leads, RAP breaks ties - so while values.js is empty
   * every player scores 0 on value and the board is ordered by RAP, and it
   * turns into a real value board the moment values are filled in.
   *
   * It lives in player-roster.js rather than here because the profile page
   * needs the identical answer to print a player's rank, and /players orders
   * its list by it. One definition, so the three pages cannot disagree.
   */
  const byRank = (a, b) => ROSTER.byRank(a, b);

  /*
   * The verified flag, for the page being looked at and nothing more.
   *
   * Only users/v1/users/{id} carries it, one request per player, so fetching
   * it for the whole roster would mean thousands of calls for a board that
   * shows 25 at a time. Instead each page asks for its own 25 after it has
   * already been drawn, then redraws if any came back verified. The API
   * client memoises the answers, so revisiting a page costs nothing.
   */
  async function ensureVerified(players) {
    const pending = players.filter(player => player.verified === undefined);
    if (!pending.length || !API.fetchVerifiedFlags) return;

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
    if (changed && players.some(player => visible.includes(player))) renderPage();
  }

  /* ------------------------------------------------------------------ */
  /* Search                                                              */
  /* ------------------------------------------------------------------ */

  function applyFilter({ keepPage = false } = {}) {
    const term = searchBox ? searchBox.value.trim().toLowerCase() : '';
    visible = term
      ? ranked.filter(player => player.name.toLowerCase().includes(term))
      : ranked;
    if (!keepPage) page = 1;
    renderPage();
  }

  function initSearch() {
    if (!searchBox) return;
    let timer = 0;
    searchBox.addEventListener('input', () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => applyFilter(), 200);
    });
  }

  /* ------------------------------------------------------------------ */
  /* Boot                                                                */
  /* ------------------------------------------------------------------ */

  async function load() {
    if (!ROSTER) {
      setStatus('The player roster script failed to load.');
      return;
    }

    setStatus('Building the leaderboard\u2026', { spinner: true });

    /* A player's Value is the sum of the values of their collectibles, so the
     * value table has to be in hand before the roster is totalled - otherwise
     * every row would rank on RAP alone until something forced a rebuild.
     * Waiting costs nothing: values.js is already in flight by the time this
     * runs. */
    if (VALUES && VALUES.ready && typeof VALUES.ready.then === 'function') {
      try {
        await VALUES.ready;
      } catch (error) {
        /* No values is a legitimate state - the board then ranks on RAP. */
      }
    }

    let players = [];
    try {
      players = await ROSTER.load({
        onProgress: (partial, progress) => {
          /* Show the board filling in rather than a long blank wait. */
          publish(partial, { keepPage: true });
          setStatus(
            `Building the leaderboard\u2026 ${progress.done}/${progress.total} items, `
            + `${partial.length} players so far.`);
        },
      });
    } catch (error) {
      setStatus('Could not reach Wanwood to build the leaderboard. Try again shortly.');
      return;
    }

    publish(players);
  }

  /* Sort, number, and draw - shared by the live scan and the cache. */
  function publish(players, { keepPage = false } = {}) {
    ranked = [...players].sort(byRank);
    ranked.forEach((player, index) => { player.rank = index + 1; });
    applyFilter({ keepPage });
  }

  /* Certified Wanwoodian is awarded by the owner and arrives from the backend
   * shortly after the page, so the cards on screen are redrawn when it lands
   * rather than waiting for a reload. Only a repaint - the ordering does not
   * depend on badges. */
  window.WolimonsGrantedBadges?.subscribe(() => {
    if (ranked.length) renderPage();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { initSearch(); load(); });
  } else {
    initSearch();
    load();
  }
})();
