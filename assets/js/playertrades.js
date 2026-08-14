/*
 * Per-player trade ads - /playertrades/?id=<userId>
 *
 * Every trade ad one person has posted, rather than the whole board. The
 * filters, the card and the storage are all the core's, shared with /trades;
 * the only thing this page adds is the player header and the creator filter.
 */
(() => {
  'use strict';

  const API = window.WanwoodAPI;
  const CORE = window.WolimonsTradeAds;

  const PAGE_SIZE = 10;
  const SEARCH_DEBOUNCE_MS = 300;
  const AVATAR_SIZE = 150;

  const {
    el, loadAds, relativeTime, adCard,
    items, creators, resolveItems, resolveCreators, itemIdsIn,
    createFilterPanel,
  } = CORE;

  /* ------------------------------------------------------------------ */
  /* Page state                                                          */
  /* ------------------------------------------------------------------ */

  const state = {
    /* Only this player's ads, newest first. */
    ads: [],
    page: 0,
    userId: null,
    /* The name as posted on the ads until the API confirms it. */
    name: '',
  };

  const dom = {};

  const panel = createFilterPanel({
    onChange: () => { state.page = 0; renderBoard(); },
    debounceMs: SEARCH_DEBOUNCE_MS,
  });

  function cacheDom() {
    dom.list = document.getElementById('trade_ads_list');
    dom.empty = document.getElementById('trade_ads_empty_state');
    dom.paginationTop = document.getElementById('pagination_control_top');
    dom.paginationBottom = document.getElementById('pagination_control_bottom');
    dom.title = document.getElementById('player_trades_name');
    dom.offsite = document.getElementById('player_trades_offsite_link');
    dom.avatar = document.getElementById('player_trades_avatar');
    dom.summary = document.getElementById('player_trades_summary');
    dom.profileLink = document.getElementById('player_trades_profile_link');
  }

  /* ------------------------------------------------------------------ */
  /* Header                                                              */
  /* ------------------------------------------------------------------ */

  function renderHeader() {
    const name = state.name || (state.userId ? `Player ${state.userId}` : 'Player');

    if (dom.title) dom.title.textContent = state.userId ? name : 'Player Trade Ads';

    if (dom.offsite && state.userId) {
      dom.offsite.href = `${window.WOLIMONS_CONFIG.siteBase}/users/${state.userId}/profile`;
      dom.offsite.title = `View ${name} on Wanwood`;
      dom.offsite.setAttribute('aria-label', `View ${name} on Wanwood`);
      dom.offsite.classList.remove('d-none');
    }

    if (dom.profileLink && state.userId) {
      dom.profileLink.href = `/player/?id=${state.userId}`;
      dom.profileLink.classList.remove('d-none');
    }

    if (dom.avatar) {
      dom.avatar.alt = `${name} avatar`;
      const known = creators.get(state.userId);
      if (known) dom.avatar.src = known;
    }
  }

  function renderSummary() {
    if (!dom.summary) return;

    if (!state.userId) {
      dom.summary.textContent =
        'No player was given. Open this page from a profile, or from a trade ad, to see that player\u2019s ads.';
      return;
    }

    const total = state.ads.length;
    const shown = panel.apply(state.ads).length;

    if (!total) {
      dom.summary.textContent = `${state.name || 'This player'} has no trade ads.`;
      return;
    }

    const newest = state.ads[0];
    dom.summary.textContent = shown === total
      ? `${total} trade ad${total === 1 ? '' : 's'}, most recent ${relativeTime(newest.createdAt)}.`
      : `${shown} of ${total} trade ad${total === 1 ? '' : 's'} match the filters.`;
  }

  /* ------------------------------------------------------------------ */
  /* Board                                                               */
  /* ------------------------------------------------------------------ */

  /* Same pager as the main board: plain numbered buttons. */
  function renderPagination(container, pageCount) {
    if (!container) return;
    container.textContent = '';
    if (pageCount < 2) {
      container.classList.add('d-none');
      return;
    }
    container.classList.remove('d-none');
    const nav = el('div', 'd-flex justify-content-center flex-wrap');
    for (let page = 0; page < pageCount; page += 1) {
      const button = el('input',
        `btn ${page === state.page ? 'btn-flat-light-blue' : 'btn-flat-dark-gray'} shadow-none mx-1 my-1`);
      button.type = 'submit';
      button.value = String(page + 1);
      const target = page;
      button.addEventListener('click', () => {
        state.page = target;
        renderBoard();
        container.scrollIntoView({ block: 'start' });
      });
      nav.appendChild(button);
    }
    container.appendChild(nav);
  }

  function renderBoard() {
    const ads = panel.apply(state.ads);
    const pageCount = Math.ceil(ads.length / PAGE_SIZE);
    if (state.page >= pageCount) state.page = Math.max(0, pageCount - 1);

    dom.list.textContent = '';
    renderSummary();

    if (!ads.length) {
      dom.empty.classList.remove('d-none');
      renderPagination(dom.paginationTop, 0);
      renderPagination(dom.paginationBottom, 0);
      return;
    }
    dom.empty.classList.add('d-none');

    const start = state.page * PAGE_SIZE;
    /* No delete button here: ads are removed from the board that owns them. */
    ads.slice(start, start + PAGE_SIZE).forEach(ad => dom.list.appendChild(adCard(ad)));
    renderPagination(dom.paginationTop, pageCount);
    renderPagination(dom.paginationBottom, pageCount);
  }

  /* ------------------------------------------------------------------ */
  /* Load                                                                */
  /* ------------------------------------------------------------------ */

  function readUserId() {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('id') || params.get('userId');
    const id = Number(raw);
    if (Number.isSafeInteger(id) && id > 0) return id;

    /* No id in the URL: fall back to the linked account, so "My Trade Ads"
     * can be a bare /playertrades/ link. */
    const linked = window.WolimonsAccount && window.WolimonsAccount.get();
    return linked ? linked.id : null;
  }

  async function load() {
    state.userId = readUserId();

    if (!state.userId) {
      state.ads = [];
      renderHeader();
      renderBoard();
      return;
    }

    /* One creator's ads, newest first - loadAds() already holds every ad in
     * this browser, so this is a filter rather than a second read. */
    state.ads = loadAds().filter(ad => Number(ad.creatorId) === state.userId);

    /* The ads carry the name they were posted under; the API is asked for the
     * current one, but the page never waits on it to draw. */
    const fromAd = state.ads.find(ad => ad.creatorName);
    state.name = fromAd ? fromAd.creatorName : '';

    renderHeader();
    renderBoard();

    const itemIds = itemIdsIn(state.ads);
    const creatorIds = state.ads.map(ad => ad.creatorId);
    creatorIds.push(state.userId);

    await Promise.all([
      resolveItems(itemIds),
      resolveCreators(creatorIds),
      refreshIdentity(),
    ]);

    renderHeader();
    renderBoard();
  }

  /* The player may have no ads at all, in which case nothing on the page
   * knows their name or face - so both are fetched directly. */
  async function refreshIdentity() {
    try {
      const [user, avatar] = await Promise.all([
        API.getUserById(state.userId),
        API.fetchUserAvatar(state.userId, { size: AVATAR_SIZE }),
      ]);
      if (user && user.name) state.name = user.name;
      if (avatar && dom.avatar) dom.avatar.src = avatar;
    } catch (error) {
      /* An unreachable API leaves the posted name in place; it is not worth
       * blanking a header the visitor can already read. */
    }
  }

  /* ------------------------------------------------------------------ */
  /* Boot                                                                */
  /* ------------------------------------------------------------------ */

  let booted = false;

  function init() {
    if (booted) return;
    if (!document.body.classList.contains('page-playertrades')) return;
    cacheDom();
    if (!dom.list) return;
    booted = true;
    panel.wire();
    load();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
