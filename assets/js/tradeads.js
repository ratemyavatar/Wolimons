/*
 * Trade ads board - /trades
 *
 * The board: filters, the ad list, paging and the inline composer. Where the
 * ads live, how they are stored and how a card is drawn are in
 * tradeads-core.js, which the single-ad page (/tradead) shares - see the
 * comment at the top of that file for the storage story.
 */
(() => {
  'use strict';

  const API = window.WanwoodAPI;
  const ACCOUNT = window.WolimonsAccount;
  const CORE = window.WolimonsTradeAds;

  const PAGE_SIZE = 10;
  const SEARCH_LIMIT = 24;
  const SEARCH_DEBOUNCE_MS = 300;

  /* Everything below is the core's - the board and the single-ad page must
   * agree on the tag list, the storage format and how a card is drawn. */
  const {
    TAGS, TAG_BY_SLUG, tagArt, VALUES, el, formatNumber,
    relativeTime, loadAds, saveAds, normalizeAd,
    items, creators, resolveItems, resolveCreators, itemIdsIn,
    sideTotals, adCard, showModal, debounce, createFilterPanel,
  } = CORE;

  /* Filters live in the core so /trades and /playertrades behave alike. */
  const panel = createFilterPanel({
    onChange: () => { state.page = 0; renderBoard(); },
    debounceMs: SEARCH_DEBOUNCE_MS,
  });

  /* ------------------------------------------------------------------ */
  /* Page state                                                          */
  /* ------------------------------------------------------------------ */

  const state = {
    ads: [],
    page: 0,
    composer: { offer: [null, null, null, null], request: [null, null, null, null] },
    picker: { side: null, slot: null, sequence: 0 },
  };

  const dom = {};

  function cacheDom() {
    dom.list = document.getElementById('trade_ads_list');
    dom.empty = document.getElementById('trade_ads_empty_state');
    dom.paginationTop = document.getElementById('pagination_control_top');
    dom.paginationBottom = document.getElementById('pagination_control_bottom');
    dom.lockedNotice = document.getElementById('create_ad_locked');
    dom.createPanel = document.getElementById('create_ad_panel');
    dom.createIdentity = document.getElementById('create_ad_identity');
    dom.createNotice = document.getElementById('create_ad_notice');
    dom.postButton = document.getElementById('post_trade_ad_button');
    dom.clearButton = document.getElementById('clear_trade_ad_button');
    dom.createAdButton = document.getElementById('create_ad_button');
    dom.refreshButton = document.getElementById('refresh_ads_button');
    dom.composerTagRow = document.getElementById('composer_tag_row');
    dom.pickerModal = document.getElementById('item_select_modal');
    dom.pickerTitle = document.getElementById('item_select_modal_title');
    dom.pickerSearch = document.getElementById('item_select_search_textbox');
    dom.pickerResults = document.getElementById('item_select_results');
    dom.pickerClear = document.getElementById('item_select_clear_button');
    dom.composerStats = {
      offer: {
        value: document.getElementById('composer_offer_value'),
        rap: document.getElementById('composer_offer_rap'),
      },
      request: {
        value: document.getElementById('composer_request_value'),
        rap: document.getElementById('composer_request_rap'),
      },
    };
  }

  /* ------------------------------------------------------------------ */
  /* Rendering a card                                                    */
  /*                                                                     */
  /* The two sides come from the core - the single-ad page draws exactly */
  /* the same card. Only the header bar differs: the board's carries the */
  /* Details / Send Trade / Delete controls.                             */
  /* ------------------------------------------------------------------ */

  /* ------------------------------------------------------------------ */
  /* Filtering, paging, board render                                     */
  /* ------------------------------------------------------------------ */

  function renderPagination(container, pageCount) {
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
    if (!ads.length) {
      dom.empty.classList.remove('d-none');
      renderPagination(dom.paginationTop, 0);
      renderPagination(dom.paginationBottom, 0);
      return;
    }
    dom.empty.classList.add('d-none');

    const start = state.page * PAGE_SIZE;
    ads.slice(start, start + PAGE_SIZE)
      .forEach(ad => dom.list.appendChild(adCard(ad, { onDelete: deleteAd })));
    renderPagination(dom.paginationTop, pageCount);
    renderPagination(dom.paginationBottom, pageCount);
  }

  /* ------------------------------------------------------------------ */
  /* Composer                                                            */
  /* ------------------------------------------------------------------ */

  function renderComposerSlot(side, index) {
    const node = document.querySelector(
      `#composer_${side}_slots [data-side="${side}"][data-slot="${index + 1}"]`);
    if (!node) return;
    const slot = state.composer[side][index];

    node.textContent = '';
    node.classList.remove('ad_item_slot_empty');
    node.style.backgroundImage = '';
    node.removeAttribute('title');

    if (!slot) {
      node.classList.add('ad_item_slot_empty');
      node.textContent = '+';
      node.setAttribute('aria-label', `Choose an item for slot ${index + 1}`);
      return;
    }

    if (slot.kind === 'tag') {
      const tag = TAG_BY_SLUG.get(slot.slug);
      node.style.backgroundImage = `url(${tagArt(slot.slug)})`;
      node.style.backgroundSize = 'cover';
      node.setAttribute('title', tag ? tag.label : slot.slug);
      node.setAttribute('aria-label', `${tag ? tag.label : slot.slug} - click to change`);
      return;
    }

    const known = items.get(slot.id);
    const name = (known && known.name) || slot.name || `Item ${slot.id}`;
    node.style.backgroundImage = `url(${(known && known.thumbnail) || API.thumbnailUrl(slot.id)})`;
    node.style.backgroundSize = 'cover';
    node.setAttribute('title', name);
    node.setAttribute('aria-label', `${name} - click to change`);
  }

  function renderComposer() {
    ['offer', 'request'].forEach(side => {
      [0, 1, 2, 3].forEach(index => renderComposerSlot(side, index));
      const totals = sideTotals(state.composer[side]);
      const stats = dom.composerStats[side];
      if (stats.value) stats.value.textContent = totals.value === null ? '-' : formatNumber(totals.value);
      if (stats.rap) stats.rap.textContent = totals.rap === null ? '-' : formatNumber(totals.rap);
    });

    /* A tag chip is "selected" when that tag occupies a request slot. */
    const chosen = new Set(state.composer.request
      .filter(slot => slot && slot.kind === 'tag')
      .map(slot => slot.slug));
    if (dom.composerTagRow) {
      dom.composerTagRow.querySelectorAll('[data-tag]').forEach(button => {
        const on = chosen.has(button.dataset.tag);
        button.classList.toggle('selected', on);
        button.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    }
  }

  function firstFreeSlot(side) {
    return state.composer[side].findIndex(slot => slot === null);
  }

  function toggleComposerTag(slug) {
    if (!TAG_BY_SLUG.has(slug)) return;
    const request = state.composer.request;
    const at = request.findIndex(slot => slot && slot.kind === 'tag' && slot.slug === slug);
    if (at >= 0) {
      request[at] = null;
    } else {
      const free = firstFreeSlot('request');
      if (free < 0) {
        notice('All four request slots are full. Clear one first.');
        return;
      }
      request[free] = { kind: 'tag', slug };
      notice('');
    }
    renderComposer();
  }

  function notice(message) {
    if (dom.createNotice) dom.createNotice.textContent = message || '';
  }

  function clearComposer() {
    state.composer.offer = [null, null, null, null];
    state.composer.request = [null, null, null, null];
    notice('');
    renderComposer();
  }

  async function postAd() {
    const account = ACCOUNT.get();
    if (!account) {
      notice('Link your Wanwood account first.');
      return;
    }
    if (!state.composer.offer.some(Boolean)) {
      notice('Add at least one item to the offering side.');
      return;
    }
    if (!state.composer.request.some(Boolean)) {
      notice('Say what you want - add an item or a request tag.');
      return;
    }

    const ad = normalizeAd({
      id: `${account.id}-${Date.now()}`,
      creatorId: account.id,
      creatorName: account.name,
      createdAt: Date.now(),
      offer: state.composer.offer,
      request: state.composer.request,
    });
    if (!ad) {
      notice('That ad could not be saved.');
      return;
    }

    state.ads.unshift(ad);
    if (!saveAds(state.ads)) {
      state.ads.shift();
      notice('This browser refused to save the ad - storage may be full or blocked.');
      return;
    }

    clearComposer();
    state.page = 0;
    await resolveCreators([ad.creatorId]);
    renderBoard();
  }

  function deleteAd(adId) {
    const account = ACCOUNT.get();
    const ad = state.ads.find(row => row.id === adId);
    if (!ad || !account || account.id !== ad.creatorId) return;
    state.ads = state.ads.filter(row => row.id !== adId);
    saveAds(state.ads);
    renderBoard();
  }

  /* ------------------------------------------------------------------ */
  /* Item picker                                                         */
  /* ------------------------------------------------------------------ */

  function openPicker(side, index) {
    state.picker.side = side;
    state.picker.slot = index;
    if (dom.pickerTitle) {
      dom.pickerTitle.textContent = side === 'offer'
        ? `Offering - slot ${index + 1}`
        : `Requesting - slot ${index + 1}`;
    }
    if (dom.pickerSearch) dom.pickerSearch.value = '';
    showPicker(true);
    runPickerSearch('');
    if (dom.pickerSearch) dom.pickerSearch.focus();
  }

  /* Bootstrap's JS is not loaded on this site, so modals are shown by hand
   * the same way the rest of the pages do it. */
  function showPicker(open) {
    showModal(dom.pickerModal, open);
  }

  function pickerRow(item) {
    const row = el('div', 'trade_ad_picker_row');
    const img = el('img');
    img.width = 44;
    img.height = 44;
    img.loading = 'lazy';
    img.alt = '';
    img.src = item.thumbnail || API.thumbnailUrl(item.id);
    row.appendChild(img);

    const text = el('div', 'flex-grow-1');
    text.appendChild(el('div', 'text-truncate', item.name));
    const value = VALUES.get(item.id);
    const stats = el('div', 'small', `Value ${value ? formatNumber(value) : '-'} `
      + `\u00b7 RAP ${Number.isFinite(item.rap) ? formatNumber(item.rap) : '-'}`);
    stats.style.color = '#7a8288';
    text.appendChild(stats);
    row.appendChild(text);

    row.addEventListener('click', () => {
      const { side, slot } = state.picker;
      if (side === null || slot === null) return;
      state.composer[side][slot] = { kind: 'item', id: item.id, name: item.name };
      showPicker(false);
      renderComposer();
      notice('');
    });
    return row;
  }

  async function runPickerSearch(keyword) {
    const sequence = (state.picker.sequence += 1);
    dom.pickerResults.textContent = '';
    const loading = el('div', 'text-center py-4 small', 'Loading items...');
    loading.style.color = '#7a8288';
    dom.pickerResults.appendChild(loading);

    let items = [];
    try {
      const search = await API.searchItems({
        category: 'Collectibles',
        subcategory: 'Collectibles',
        sortType: '3',
        keyword,
        limit: SEARCH_LIMIT,
        cursor: 0,
      });
      if (search.ids.length) {
        const details = await API.getItemDetails(search.ids, { includePrice: false });
        items = details.filter(item => item && item.name);
        items.forEach(item => {
          const id = Number(item.id ?? item.assetId);
          if (!Number.isSafeInteger(id)) return;
          items.set(id, {
            id,
            name: (item.name || '').trim(),
            thumbnail: item.thumbnail || API.thumbnailUrl(id),
            rap: Number.isFinite(item.rap) ? item.rap : null,
          });
        });
      }
    } catch (error) {
      if (sequence !== state.picker.sequence) return;
      dom.pickerResults.textContent = '';
      const failed = el('div', 'text-center py-4 small', 'Could not reach the item catalog.');
      failed.style.color = '#e9806e';
      dom.pickerResults.appendChild(failed);
      return;
    }

    if (sequence !== state.picker.sequence) return;
    dom.pickerResults.textContent = '';
    if (!items.length) {
      const none = el('div', 'text-center py-4 small', 'No items matched.');
      none.style.color = '#7a8288';
      dom.pickerResults.appendChild(none);
      return;
    }
    items.forEach(item => dom.pickerResults.appendChild(pickerRow({
      id: Number(item.id ?? item.assetId),
      name: (item.name || '').trim(),
      thumbnail: item.thumbnail,
      rap: item.rap,
    })));
  }

  /* ------------------------------------------------------------------ */
  /* Filter chips                                                        */
  /* ------------------------------------------------------------------ */

  /*
   * The snapshot's chips are already in the page - one hidden pair per tag,
   * plus a min/max pair per side - and turning a filter on just unhides the
   * matching pair. That is why the markup ships fourteen .filter-remove-button
   * elements: they belong to chips, not to a list built at runtime.
   */
  /* ------------------------------------------------------------------ */
  /* Account gate                                                        */
  /* ------------------------------------------------------------------ */

  function renderAccountGate() {
    const account = ACCOUNT.get();
    const linked = account !== null;
    if (dom.lockedNotice) dom.lockedNotice.classList.toggle('d-none', linked);
    if (dom.createPanel) dom.createPanel.classList.toggle('d-none', !linked);
    if (dom.createIdentity) {
      dom.createIdentity.textContent = linked ? `Posting as ${account.name}` : '';
      dom.createIdentity.style.color = '#7a8288';
    }
  }

  /* ------------------------------------------------------------------ */
  /* Wiring                                                              */
  /* ------------------------------------------------------------------ */

  function wire() {
    /* Filters are the core's shared panel - the same markup and behaviour as
     * the per-player board. It calls back here whenever a filter moves. */
    panel.wire();

    if (dom.composerTagRow) {
      dom.composerTagRow.addEventListener('click', event => {
        const button = event.target.closest('[data-tag]');
        if (button) toggleComposerTag(button.dataset.tag);
      });
    }

    document.querySelectorAll('[data-side][data-slot]').forEach(node => {
      const side = node.dataset.side;
      const index = Number(node.dataset.slot) - 1;
      const open = () => openPicker(side, index);
      node.addEventListener('click', open);
      node.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          open();
        }
      });
    });

    if (dom.pickerSearch) {
      dom.pickerSearch.addEventListener('input', debounce(
        () => runPickerSearch(dom.pickerSearch.value.trim()), SEARCH_DEBOUNCE_MS));
    }
    if (dom.pickerClear) {
      dom.pickerClear.addEventListener('click', () => {
        const { side, slot } = state.picker;
        if (side !== null && slot !== null) state.composer[side][slot] = null;
        showPicker(false);
        renderComposer();
      });
    }
    if (dom.pickerModal) {
      dom.pickerModal.addEventListener('click', event => {
        if (event.target === dom.pickerModal) showPicker(false);
      });
      dom.pickerModal.querySelectorAll('[data-dismiss="modal"]').forEach(button => {
        button.addEventListener('click', () => showPicker(false));
      });
    }
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') showPicker(false);
    });

    if (dom.postButton) dom.postButton.addEventListener('click', postAd);
    if (dom.clearButton) dom.clearButton.addEventListener('click', clearComposer);

    if (dom.createAdButton) {
      dom.createAdButton.addEventListener('click', event => {
        event.preventDefault();
        const target = document.getElementById('create_trade_ad');
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
    if (dom.refreshButton) {
      dom.refreshButton.addEventListener('click', event => {
        event.preventDefault();
        reload();
      });
    }

    /* Verifying or signing out in another tab flips the composer gate. */
    if (typeof ACCOUNT.subscribe === 'function') {
      ACCOUNT.subscribe(() => {
        renderAccountGate();
        renderBoard();
      });
    }
  }

  /* ------------------------------------------------------------------ */
  /* Boot                                                                */
  /* ------------------------------------------------------------------ */

  async function reload() {
    state.ads = loadAds();
    renderBoard();

    const itemIds = itemIdsIn(state.ads);
    const creatorIds = state.ads.map(ad => ad.creatorId);
    state.composer.offer.concat(state.composer.request).forEach(slot => {
      if (slot && slot.kind === 'item') itemIds.push(slot.id);
    });

    await Promise.all([resolveItems(itemIds), resolveCreators(creatorIds)]);
    renderBoard();
    renderComposer();
  }

  let booted = false;

  function init() {
    if (booted) return;
    if (!document.body.classList.contains('page-trades')) return;
    cacheDom();
    if (!dom.list) return;
    booted = true;
    wire();
    renderAccountGate();
    renderComposer();
    reload();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
