/*
 * Wolimons player leaderboard.
 *
 * ---------------------------------------------------------------------------
 * WHERE THE RANKING COMES FROM
 * ---------------------------------------------------------------------------
 * Wanwood has no leaderboard endpoint, and no user-search endpoint either -
 * the only way to enumerate players is to walk the user id space directly.
 * Verified live:
 *
 *     GET /apisite/api/users/{id}
 *         -> {Id, Username, ...}
 *         -> real-but-empty ids answer with Username "?"
 *         -> ids past the end answer {"errors":[{"message":"NotFound"}]}
 *
 *     GET /apisite/inventory/v1/users/{id}/assets/collectibles?limit=100
 *         -> {totalRap, data:[...]}   <- the number the board ranks on
 *
 * The registered user base is small (ids run out in the mid-60s at the time
 * of writing), so scanning it is cheap and the board stays correct on its own
 * as accounts are added. SCAN_MAX_ID leaves generous headroom above the
 * current end of the range; the scan stops early once it has walked past a
 * long unbroken run of missing ids, so raising it costs nothing.
 *
 * ---------------------------------------------------------------------------
 * VALUE vs RAP
 * ---------------------------------------------------------------------------
 * Value is community-set and lives in values.js - it is never a price and it
 * is never fetched. Every item is 0 until somebody fills that table in, so a
 * player's Value here is the sum of the hand-set values of their collectibles
 * and reads 0 for everyone on a fresh checkout.
 *
 * A board where every row ties at 0 would be useless, so ordering is by RAP
 * while values are unset. Fill in values.js and the board re-sorts itself by
 * Value automatically - see rankKey() below.
 */
(() => {
  'use strict';

  const API = window.WanwoodAPI;
  const VALUES = window.WolimonsValues;

  /* Highest user id the scan will probe. */
  const SCAN_MAX_ID = 200;
  /* Stop once this many consecutive ids in a row turn up nothing. */
  const SCAN_GIVE_UP_AFTER = 40;
  /* Ids probed per batch, and batches in flight at once. */
  const SCAN_BATCH = 20;
  const SCAN_CONCURRENCY = 6;

  const PAGE_SIZE = 25;
  const AVATAR_SIZE = 150;

  /* Building the board costs ~100 proxied requests, so the finished result is
   * parked in sessionStorage. Navigating away and back is then instant, and
   * the numbers still refresh often enough to stay honest. */
  const CACHE_KEY = 'wolimons_leaderboard_v1';
  const CACHE_TTL_MS = 10 * 60 * 1000;

  const cards = document.getElementById('lb_cards');
  const statusBox = document.getElementById('lb_status');
  const searchBox = document.getElementById('lb_search');
  const updatedBox = document.getElementById('lb_updated');
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
   * Ported from the Colimons leaderboard: a 20px inline SVG next to the
   * name, with a tooltip that appears on hover. The markup there was one
   * hand-written copy per player with the styling inlined on every element;
   * here it is a single table plus a builder, and the presentation moved to
   * .lb_badge / .badge-tt in koromons.css.
   *
   * Only rank-derived badges are awarded - they are the ones the site can
   * work out for itself. `test` receives the player's 1-based position.
   *
   * These are tiers of one achievement, not three separate ones, so the
   * order matters: badgesFor() awards the first match only, and #1 wears the
   * champion trophy rather than the trophy plus both medals behind it.
   */
  const BADGES = [
    {
      id: 'champion',
      label: 'Rank #1 Champion',
      color: '#00e5ff',
      test: rank => rank === 1,
      path: 'M19 3h-2V2h-2v1H9V2H7v1H5c-1.1 0-2 .9-2 2v3c0 2.21 1.79 4 4 4h.14c.48 1.48 1.68 2.65 3.2 3.06L9 18H7v2h10v-2h-2l-1.34-2.94c1.52-.41 2.72-1.58 3.2-3.06H17c2.21 0 4-1.79 4-4V5c0-1.1-.9-2-2-2zm-2 5h-1.68C14.77 9.8 13.5 11 12 11s-2.77-1.2-3.32-3H7V5h10v3z',
    },
    {
      id: 'top10',
      label: 'Top 10 Leaderboard',
      color: '#ffd700',
      test: rank => rank <= 10,
      path: 'M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5zm14 3c0 .6-.4 1-1 1H6c-.6 0-1-.4-1-1v-1h14v1z',
    },
    {
      id: 'top50',
      label: 'Top 50 Leaderboard',
      color: '#c0c0c0',
      test: rank => rank <= 50,
      path: 'M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 2.18l7 3.12v4.7c0 4.67-3.13 8.89-7 10.02-3.87-1.13-7-5.35-7-10.02v-4.7l7-3.12z',
    },
  ];

  const SVG_NS = 'http://www.w3.org/2000/svg';

  function badgeNode(badge) {
    const wrap = text('span', 'lb_badge');
    wrap.style.color = badge.color;

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'currentColor');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', badge.path);
    svg.appendChild(path);

    const tip = text('span', 'badge-tt', badge.label);

    wrap.appendChild(svg);
    wrap.appendChild(tip);
    wrap.setAttribute('title', badge.label);
    return wrap;
  }

  function badgesFor(rank) {
    const earned = BADGES.find(badge => badge.test(rank));
    return earned ? [earned] : [];
  }

  /* ------------------------------------------------------------------ */
  /* Cards                                                               */
  /* ------------------------------------------------------------------ */

  /*
   * The card shape is the Koromon's one: name header, avatar on a gradient,
   * then Rank / Value / RAP rows. The badge row inside the header is the
   * Colimons addition.
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
    badgesFor(player.rank).forEach(badge => name.appendChild(badgeNode(badge)));
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
      `page-link-koro prev${page === 1 ? ' disabled' : ''}`, arrow(ARROW_PREV)));

    pageNumbers(page, total).forEach(entry => {
      const item = document.createElement('li');
      if (entry === '...') {
        item.appendChild(text('span', 'ellipse', '\u2026'));
        list.appendChild(item);
      } else if (entry === page) {
        item.appendChild(text('span', 'current', String(entry)));
        list.appendChild(item);
      } else {
        list.appendChild(linkTo(entry, 'page-link-koro ', String(entry)));
      }
    });

    list.appendChild(linkTo(Math.min(total, page + 1),
      `page-link-koro next${page === total ? ' disabled' : ''}`, arrow(ARROW_NEXT)));

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
    visible.slice(start, start + PAGE_SIZE)
      .forEach(player => cards.appendChild(playerCard(player)));

    renderPagination(paginationTop, total);
    renderPagination(paginationBottom, total);
  }

  function goToPage(target) {
    page = Math.max(1, target);
    renderPage();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ------------------------------------------------------------------ */
  /* Scan + ranking                                                      */
  /* ------------------------------------------------------------------ */

  /*
   * Sum the hand-set values of a player's collectibles. Rows carry assetId,
   * so this is a pure lookup against values.js - nothing is fetched and no
   * price ever stands in for a value.
   */
  function valueOf(rows) {
    if (!VALUES || !Array.isArray(rows)) return 0;
    return rows.reduce((sum, row) => sum + VALUES.get(row.assetId), 0);
  }

  /*
   * Ranking key. Value leads, RAP breaks ties - so while values.js is empty
   * every player scores 0 on value and the board is ordered by RAP, and it
   * turns into a real value board the moment values are filled in.
   */
  const rankKey = player => [player.value, player.rap];

  function byRank(a, b) {
    const [aValue, aRap] = rankKey(a);
    const [bValue, bRap] = rankKey(b);
    if (bValue !== aValue) return bValue - aValue;
    if (bRap !== aRap) return bRap - aRap;
    return a.id - b.id;
  }

  /*
   * Walk the user id space in batches, keeping anyone who owns at least one
   * collectible. Gives up after a long enough unbroken run of dead ids, so
   * the cost tracks the real size of the user base rather than SCAN_MAX_ID.
   */
  async function scanPlayers() {
    const found = [];
    let missStreak = 0;

    for (let start = 1; start <= SCAN_MAX_ID; start += SCAN_BATCH) {
      const ids = [];
      for (let id = start; id < start + SCAN_BATCH && id <= SCAN_MAX_ID; id += 1) {
        ids.push(id);
      }

      const batch = await API.mapLimit(ids, SCAN_CONCURRENCY, async id => {
        const summary = await API.getCollectiblesSummary(id);
        /* No inventory at all means nothing to rank - skip the name lookup. */
        if (!summary || !summary.itemCount) return null;
        const user = await API.getUserById(id);
        if (!user) return null;
        return {
          id,
          name: user.name,
          rap: summary.totalRap,
          value: valueOf(summary.rows),
          items: summary.itemCount,
          avatar: '',
        };
      });

      const hits = batch.filter(Boolean);
      found.push(...hits);

      missStreak = hits.length ? 0 : missStreak + ids.length;
      if (missStreak >= SCAN_GIVE_UP_AFTER) break;

      /* Show the board filling in rather than a long blank wait. */
      if (found.length) {
        ranked = [...found].sort(byRank);
        ranked.forEach((player, index) => { player.rank = index + 1; });
        applyFilter({ keepPage: true });
        setStatus(`Scanning Wanwood players\u2026 ${found.length} found so far.`);
      }
    }

    return found;
  }

  async function attachAvatars(players) {
    if (!players.length) return;
    const map = await API.fetchUserThumbnails(players.map(p => p.id), AVATAR_SIZE);
    players.forEach(player => { player.avatar = map.get(player.id) || ''; });
  }

  /* ------------------------------------------------------------------ */
  /* Cache                                                               */
  /* ------------------------------------------------------------------ */

  function readCache() {
    try {
      const raw = window.sessionStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const saved = JSON.parse(raw);
      if (!saved || !Array.isArray(saved.players) || !saved.at) return null;
      if (Date.now() - saved.at > CACHE_TTL_MS) return null;
      return saved;
    } catch (error) {
      return null;
    }
  }

  function writeCache(players) {
    try {
      window.sessionStorage.setItem(CACHE_KEY,
        JSON.stringify({ at: Date.now(), players }));
    } catch (error) {
      /* Private mode or a full quota - the board just rebuilds next time. */
    }
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
    if (!API) {
      setStatus('The Wanwood API client failed to load.');
      return;
    }

    const cached = readCache();
    if (cached) {
      publish(cached.players, cached.at);
      return;
    }

    setStatus('Scanning Wanwood players\u2026', { spinner: true });

    let players = [];
    try {
      players = await scanPlayers();
    } catch (error) {
      setStatus('Could not reach Wanwood to build the leaderboard. Try again shortly.');
      return;
    }

    publish(players, Date.now());

    /* Avatars come last: the board is readable without them, and this way a
     * slow thumbnail service never holds up the rankings. */
    await attachAvatars(ranked);
    renderPage();
    writeCache(ranked);
  }

  /* Sort, number, draw, and stamp - shared by the live scan and the cache. */
  function publish(players, at) {
    ranked = [...players].sort(byRank);
    ranked.forEach((player, index) => { player.rank = index + 1; });
    applyFilter();

    if (updatedBox) {
      const stamp = new Date(at).toLocaleString('en-US',
        { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
      updatedBox.textContent = `Last update: ${stamp}.`;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { initSearch(); load(); });
  } else {
    initSearch();
    load();
  }
})();
