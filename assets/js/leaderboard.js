/*
 * Wolimons player leaderboard.
 *
 * ---------------------------------------------------------------------------
 * WHERE THE RANKING COMES FROM
 * ---------------------------------------------------------------------------
 * Wanwood has no leaderboard endpoint and no user-search endpoint, so the
 * roster has to be derived. The board builds it from the *items* side rather
 * than the users side:
 *
 *     GET /apisite/catalog/v1/search/items?category=Collectibles&...
 *         -> every collectible on the site (a few dozen, 1-2 requests)
 *
 *     GET /apisite/inventory/v2/assets/{assetId}/owners?limit=100&cursor=N
 *         -> { data: [ { serialNumber, owner: { id, name } | null } ] }
 *            one row per copy, and each row already carries the owner's
 *            *name* - so nothing needs a follow-up user lookup
 *
 *     GET /apisite/economy/v1/assets/{assetId}/resale-data
 *         -> recentAveragePrice, fetched once per asset and reused for every
 *            holder of it
 *
 * Anyone who owns a collectible shows up in some asset's owners list, so the
 * union of those lists *is* the set of rankable players - no id guessing.
 *
 * The cost is bounded by the catalog, not by the size of the user base:
 * roughly two requests per collectible (one owners page plus one resale-data
 * call), independent of how many accounts exist. The previous version walked
 * the user id space one account at a time and issued well over a hundred
 * requests, which starved the rest of the site of proxy capacity.
 *
 * Rows whose `owner` is null - private inventories, terminated accounts - are
 * skipped, so a hidden inventory keeps its owner off the board entirely.
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
  const CONFIG = window.WOLIMONS_CONFIG || {};

  /* Assets whose owners are being walked at once. Kept low on purpose: the
   * whole point of this rewrite is to leave proxy capacity for the other
   * pages, and the catalog is small enough that this still finishes quickly. */
  const ASSET_CONCURRENCY = 4;
  /* Owners rows per request - the backend's maximum. */
  const OWNERS_PAGE_SIZE = 100;

  const PAGE_SIZE = 25;
  const AVATAR_SIZE = 150;

  /* Building the board still costs a request or two per collectible, so the
   * finished result is parked in sessionStorage. Navigating away and back is
   * then instant, and the numbers still refresh often enough to stay honest. */
  const CACHE_KEY = 'wolimons_leaderboard_v1';
  const CACHE_TTL_MS = 10 * 60 * 1000;

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
   * .badge-tt in koromons.css.
   */
  const TROPHY_PATH = 'M19 3h-2V2h-2v1H9V2H7v1H5c-1.1 0-2 .9-2 2v3c0 2.21 1.79 4 4 4h.14c.48 1.48 1.68 2.65 3.2 3.06L9 18H7v2h10v-2h-2l-1.34-2.94c1.52-.41 2.72-1.58 3.2-3.06H17c2.21 0 4-1.79 4-4V5c0-1.1-.9-2-2-2zm-2 5h-1.68C14.77 9.8 13.5 11 12 11s-2.77-1.2-3.32-3H7V5h10v3z';

  const SVG_NS = 'http://www.w3.org/2000/svg';

  /* The shell every icon sits in: fixed size, with a hover tooltip. */
  function badgeWrap(label, child) {
    const wrap = text('span', 'lb_badge');
    wrap.appendChild(child);
    wrap.appendChild(text('span', 'badge-tt', label));
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
   * The icons for one player, in a fixed order so the row never reshuffles.
   * Anyone who is not #1, not verified and not on the list gets nothing at
   * all - an empty row is the normal case.
   */
  function badgeNodes(player) {
    const nodes = [];
    if (player.rank === 1) nodes.push(trophyNode());
    if (player.verified === true) {
      nodes.push(imageBadge('Verified', '/img/badges/verified-checkmark.png'));
    }
    if (CONFIG.isCertifiedWanwoodian && CONFIG.isCertifiedWanwoodian(player.name)) {
      nodes.push(imageBadge('Certified Wanwoodian', '/img/badges/certified-wanwoodian.png'));
    }
    return nodes;
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
   * Build the roster from the catalog.
   *
   * For each collectible: page through its owners and fetch its RAP once.
   * Every owner row contributes one copy of that asset to its holder, so a
   * player's RAP is the sum of the RAP of each copy they hold and their Value
   * is the same sum over the hand-set values in values.js. That mirrors how
   * the backend computes a player's own totalRap (a straight SUM over
   * user_asset rows), so the two agree.
   */
  async function buildRoster() {
    const assetIds = await API.listAllCollectibles();
    if (!assetIds.length) return [];

    /* userId -> player row, accumulated across every asset. */
    const players = new Map();
    let done = 0;

    await API.mapLimit(assetIds, ASSET_CONCURRENCY, async assetId => {
      /* Owners and RAP in parallel - fetchRap memoises per asset, so this is
       * one resale-data call no matter how many holders come back. */
      const [owners, rap] = await Promise.all([
        API.getAssetOwners(assetId, { pageLimit: OWNERS_PAGE_SIZE }),
        API.fetchRap(assetId),
      ]);

      const assetRap = Number(rap) || 0;
      const assetValue = Number(VALUES && VALUES.get ? VALUES.get(assetId) : 0) || 0;

      owners.forEach(owner => {
        let player = players.get(owner.userId);
        if (!player) {
          player = {
            id: owner.userId,
            name: owner.name || '',
            rap: 0,
            value: 0,
            items: 0,
            avatar: '',
          };
          players.set(owner.userId, player);
        }
        /* The owners feed carries names, but a row can arrive without one. */
        if (!player.name && owner.name) player.name = owner.name;
        player.rap += assetRap;
        player.value += assetValue;
        player.items += 1;
      });

      done += 1;

      /* Show the board filling in rather than a long blank wait. */
      if (players.size) {
        ranked = [...players.values()].sort(byRank);
        ranked.forEach((player, index) => { player.rank = index + 1; });
        applyFilter({ keepPage: true });
        setStatus(
          `Building the leaderboard\u2026 ${done}/${assetIds.length} items, `
          + `${players.size} players so far.`);
      }
    });

    const roster = [...players.values()];

    /* Names normally come free with the owners rows, so this is usually a
     * no-op. Anyone still missing one gets filled in by a single batched
     * multi-get; that endpoint is a POST and this backend gates every POST
     * behind a CSRF token, so if it is refused we fall back to per-id GETs
     * for the handful of players involved. */
    let unnamed = roster.filter(player => !player.name);
    if (unnamed.length) {
      const names = await API.getUsersByIds(unnamed.map(player => player.id));
      unnamed.forEach(player => {
        player.name = names.get(player.id) || '';
      });
      unnamed = roster.filter(player => !player.name);
    }
    if (unnamed.length) {
      const fetched = await API.mapLimit(unnamed, 4, player => API.getUserById(player.id));
      unnamed.forEach((player, index) => {
        const user = fetched[index];
        player.name = (user && user.name) || `User ${player.id}`;
      });
    }

    return roster;
  }

  async function attachAvatars(players) {
    if (!players.length) return;
    const map = await API.fetchUserThumbnails(players.map(p => p.id), AVATAR_SIZE);
    players.forEach(player => { player.avatar = map.get(player.id) || ''; });
  }

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
      /* The verified flags are left out on purpose. They are filled in per
       * page after the cards are drawn, so most of them are still false when
       * the board is cached - saving that would hide a tick for the ten
       * minutes the cache lives. Dropping the field makes the next visit look
       * them up again. */
      const saved = players.map(({ verified, ...player }) => player);
      window.sessionStorage.setItem(CACHE_KEY,
        JSON.stringify({ at: Date.now(), players: saved }));
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
      publish(cached.players);
      return;
    }

    setStatus('Building the leaderboard\u2026', { spinner: true });

    let players = [];
    try {
      players = await buildRoster();
    } catch (error) {
      setStatus('Could not reach Wanwood to build the leaderboard. Try again shortly.');
      return;
    }

    publish(players);

    /* Avatars come last: the board is readable without them, and this way a
     * slow thumbnail service never holds up the rankings. */
    await attachAvatars(ranked);
    renderPage();
    writeCache(ranked);
  }

  /* Sort, number, and draw - shared by the live scan and the cache. */
  function publish(players) {
    ranked = [...players].sort(byRank);
    ranked.forEach((player, index) => { player.rank = index + 1; });
    applyFilter();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { initSearch(); load(); });
  } else {
    initSearch();
    load();
  }
})();
