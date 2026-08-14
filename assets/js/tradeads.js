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
    sideTotals, sideNode,
  } = CORE;

  /* ------------------------------------------------------------------ */
  /* Page state                                                          */
  /* ------------------------------------------------------------------ */

  const state = {
    ads: [],
    page: 0,
    filters: {
      offerName: '',
      requestName: '',
      tags: new Set(),
      /* null means "no bound set", which is not the same as 0. */
      offer: { min: null, max: null },
      request: { min: null, max: null },
    },
    composer: { offer: [null, null, null, null], request: [null, null, null, null] },
    picker: { side: null, slot: null, sequence: 0 },
  };

  const dom = {};

  function cacheDom() {
    dom.list = document.getElementById('trade_ads_list');
    dom.empty = document.getElementById('trade_ads_empty_state');
    dom.paginationTop = document.getElementById('pagination_control_top');
    dom.paginationBottom = document.getElementById('pagination_control_bottom');
    dom.offerFilter = document.getElementById('filter_offer_side_item_name_search_textbox');
    dom.requestFilter = document.getElementById('filter_request_side_item_name_search_textbox');
    dom.tagFilterRow = document.getElementById('request_tag_filter_row');
    dom.tagFilterModal = document.getElementById('request_tag_filter_modal');
    dom.valueFilterModals = {
      offer: document.getElementById('offer_value_filter_modal'),
      request: document.getElementById('request_value_filter_modal'),
    };
    dom.valueFilterButtons = {
      offer: document.getElementById('trade_ads_offer_value_filter_button'),
      request: document.getElementById('trade_ads_request_value_filter_button'),
    };
    dom.tagFilterButton = document.getElementById('trade_ads_request_tags_filter_button');
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

  function adCard(ad) {
    const card = el('div', 'shadow_md_15 mix_item');
    card.style.backgroundColor = 'rgb(36, 38, 42)';
    card.dataset.adId = ad.id;

    const header = el('div', 'trade_ad_header d-flex flex-wrap');
    const bar = el('div', 'text-truncate w-100 py-0 pl-2 my-auto d-flex justify-content-between flex-wrap');

    const who = el('div', 'd-flex');
    const pfpWrap = el('div');
    const pfpLink = el('a');
    pfpLink.href = `/player/?id=${ad.creatorId}`;
    const pfp = el('img', 'ad_creator_pfp');
    pfp.width = 38;
    pfp.height = 38;
    pfp.decoding = 'async';
    pfp.loading = 'lazy';
    pfp.alt = 'Player thumbnail';
    const headshot = creators.get(ad.creatorId);
    if (headshot) pfp.src = headshot;
    pfpLink.appendChild(pfp);
    pfpWrap.appendChild(pfpLink);
    who.appendChild(pfpWrap);

    const names = el('div', 'ml-2');
    const nameRow = el('div');
    nameRow.style.marginTop = '3px';
    nameRow.style.lineHeight = '1.35em';
    const nameLink = el('a', 'ad_creator_name my-auto', ad.creatorName);
    nameLink.href = `/player/?id=${ad.creatorId}`;
    nameRow.appendChild(nameLink);
    const stampRow = el('div');
    stampRow.style.lineHeight = '1em';
    stampRow.style.paddingBottom = '3px';
    stampRow.appendChild(el('span', 'trade-ad-timestamp small text-truncate', relativeTime(ad.createdAt)));
    names.appendChild(nameRow);
    names.appendChild(stampRow);
    who.appendChild(names);

    const actions = el('div', 'py-1 my-auto ml-auto');
    /* Details opens this ad on its own page. */
    const details = el('a', 'trade_ad_page_link_button my-auto btn btn-flat-light-blue-sm shadow-none', 'Details');
    details.href = `/tradead/?id=${encodeURIComponent(ad.id)}`;
    details.setAttribute('role', 'button');
    actions.appendChild(details);

    /* "Send Trade" goes to the creator's Wanwood profile - trading happens on
     * Wanwood itself, Wolimons only advertises. */
    const send = el('a', 'send_trade_button my-auto btn btn-flat-light-blue-sm shadow-none', 'Send Trade');
    send.href = `${window.WOLIMONS_CONFIG.siteBase}/users/${ad.creatorId}/profile`;
    send.target = '_blank';
    send.rel = 'noopener';
    send.setAttribute('role', 'button');
    actions.appendChild(send);

    /* Only your own ads can be taken down, and only because they are yours -
     * they are sitting in your own browser. */
    const account = ACCOUNT.get();
    if (account && account.id === ad.creatorId) {
      const remove = el('input', 'delete_trade_ad_button my-auto btn btn-flat-dark-gray shadow-none mr-3');
      remove.type = 'submit';
      remove.value = 'Delete';
      remove.addEventListener('click', () => deleteAd(ad.id));
      actions.appendChild(remove);
    } else {
      send.classList.add('mr-3');
    }

    bar.appendChild(who);
    bar.appendChild(actions);
    header.appendChild(bar);
    card.appendChild(header);

    const sides = el('div', 'd-flex flex-nowrap');
    sides.appendChild(sideNode(ad, 'offer'));
    sides.appendChild(sideNode(ad, 'request'));
    card.appendChild(sides);
    return card;
  }

  /* ------------------------------------------------------------------ */
  /* Filtering, paging, board render                                     */
  /* ------------------------------------------------------------------ */

  function slotMatchesName(slot, needle) {
    if (!slot || slot.kind !== 'item') return false;
    const known = items.get(slot.id);
    const name = ((known && known.name) || slot.name || '').toLowerCase();
    return name.includes(needle);
  }

  /* A side passes a value filter when its total sits inside the bounds. A
   * tags-only side has no total at all, so any bound excludes it - there is
   * no number to compare, and guessing one would be inventing data. */
  function withinValueRange(side, bounds) {
    if (bounds.min === null && bounds.max === null) return true;
    const total = sideTotals(side).value;
    if (total === null) return false;
    if (bounds.min !== null && total < bounds.min) return false;
    if (bounds.max !== null && total > bounds.max) return false;
    return true;
  }

  function visibleAds() {
    const offerNeedle = state.filters.offerName.trim().toLowerCase();
    const requestNeedle = state.filters.requestName.trim().toLowerCase();
    const tags = state.filters.tags;

    return state.ads.filter(ad => {
      if (offerNeedle && !ad.offer.some(slot => slotMatchesName(slot, offerNeedle))) return false;
      if (requestNeedle && !ad.request.some(slot => slotMatchesName(slot, requestNeedle))) return false;
      if (!withinValueRange(ad.offer, state.filters.offer)) return false;
      if (!withinValueRange(ad.request, state.filters.request)) return false;
      if (tags.size) {
        const present = new Set(ad.request
          .filter(slot => slot && slot.kind === 'tag')
          .map(slot => slot.slug));
        /* Every selected tag must be on the ad. */
        for (const slug of tags) if (!present.has(slug)) return false;
      }
      return true;
    });
  }

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
    const ads = visibleAds();
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
    ads.slice(start, start + PAGE_SIZE).forEach(ad => dom.list.appendChild(adCard(ad)));
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
  function showModal(modal, open) {
    if (!modal) return;
    modal.classList.toggle('show', open);
    modal.style.display = open ? 'block' : 'none';
    modal.setAttribute('aria-hidden', open ? 'false' : 'true');
    document.body.classList.toggle('modal-open', open);
  }

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
  function renderFilterChips() {
    TAGS.forEach(({ slug }) => {
      const on = state.filters.tags.has(slug);
      const image = document.getElementById(`filter_display_request_tag_${slug}`);
      const remove = document.getElementById(`filter_display_request_tag_${slug}_remove_button`);
      if (image) image.classList.toggle('d-none', !on);
      /* .filter-remove-button is display:none in the stylesheet, so the
       * button has to be shown explicitly alongside its tag. */
      if (remove) remove.style.display = on ? 'block' : '';
    });

    ['offer', 'request'].forEach(side => {
      ['min', 'max'].forEach(bound => {
        const amount = state.filters[side][bound];
        const container = document.getElementById(`enabled_filter_${side}_value_${bound}_container`);
        const text = document.getElementById(`enabled_filter_${side}_value_${bound}`);
        if (container) container.classList.toggle('d-none', amount === null);
        if (text) text.textContent = amount === null ? '' : formatNumber(amount);
      });
    });
  }

  /* A tag in the picker grid reads as chosen by the same dimming the rest of
   * the site uses for an inactive thumbnail. */
  function syncTagFilterButtons() {
    if (!dom.tagFilterRow) return;
    dom.tagFilterRow.querySelectorAll('[data-tag]').forEach(button => {
      const on = state.filters.tags.has(button.dataset.tag);
      button.style.opacity = on ? '1' : '0.45';
      button.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function applyTagFilter(slug, on) {
    if (on) state.filters.tags.add(slug);
    else state.filters.tags.delete(slug);
    syncTagFilterButtons();
    renderFilterChips();
    state.page = 0;
    renderBoard();
  }

  function applyValueFilter(side, bound, amount) {
    state.filters[side][bound] = amount;
    const input = document.getElementById(`filter_${side}_value_${bound}`);
    if (input && amount === null) input.value = '';
    renderFilterChips();
    state.page = 0;
    renderBoard();
  }

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

  function debounce(fn, wait) {
    let timer = 0;
    return (...args) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => fn(...args), wait);
    };
  }

  function wire() {
    const applyFilters = debounce(() => {
      state.filters.offerName = dom.offerFilter ? dom.offerFilter.value : '';
      state.filters.requestName = dom.requestFilter ? dom.requestFilter.value : '';
      state.page = 0;
      renderBoard();
    }, SEARCH_DEBOUNCE_MS);

    if (dom.offerFilter) dom.offerFilter.addEventListener('input', applyFilters);
    if (dom.requestFilter) dom.requestFilter.addEventListener('input', applyFilters);

    /* Tag picking happens inside the tag modal, on the grid of tag art. */
    if (dom.tagFilterRow) {
      const pick = target => {
        const button = target.closest('[data-tag]');
        if (!button) return;
        applyTagFilter(button.dataset.tag, !state.filters.tags.has(button.dataset.tag));
      };
      dom.tagFilterRow.addEventListener('click', event => pick(event.target));
      dom.tagFilterRow.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        pick(event.target);
      });
    }

    /* The three icon buttons open their modal; the chips' red x buttons and
     * the modals' own clear buttons take a filter back off. */
    dom.valueFilterButtons.offer?.addEventListener('click',
      () => showModal(dom.valueFilterModals.offer, true));
    dom.valueFilterButtons.request?.addEventListener('click',
      () => showModal(dom.valueFilterModals.request, true));
    dom.tagFilterButton?.addEventListener('click',
      () => showModal(dom.tagFilterModal, true));

    ['offer', 'request'].forEach(side => {
      ['min', 'max'].forEach(bound => {
        const input = document.getElementById(`filter_${side}_value_${bound}`);
        input?.addEventListener('input', debounce(() => {
          const amount = Number(input.value);
          applyValueFilter(side, bound,
            input.value.trim() === '' || !Number.isFinite(amount) ? null : amount);
        }, SEARCH_DEBOUNCE_MS));

        document.getElementById(`clear_filter_${side}_value_${bound}_button`)
          ?.addEventListener('click', () => applyValueFilter(side, bound, null));
        document.getElementById(`filter_display_${side}_${bound}_value_remove_button`)
          ?.addEventListener('click', () => applyValueFilter(side, bound, null));
      });
    });

    TAGS.forEach(({ slug }) => {
      document.getElementById(`filter_display_request_tag_${slug}_remove_button`)
        ?.addEventListener('click', () => applyTagFilter(slug, false));
    });

    [dom.tagFilterModal, dom.valueFilterModals.offer, dom.valueFilterModals.request]
      .forEach(modal => {
        if (!modal) return;
        modal.addEventListener('click', event => {
          if (event.target === modal) showModal(modal, false);
        });
        modal.querySelectorAll('[data-dismiss="modal"]').forEach(button => {
          button.addEventListener('click', () => showModal(modal, false));
        });
      });

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
      if (event.key !== 'Escape') return;
      showPicker(false);
      showModal(dom.tagFilterModal, false);
      showModal(dom.valueFilterModals.offer, false);
      showModal(dom.valueFilterModals.request, false);
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
    syncTagFilterButtons();
    renderFilterChips();
    renderComposer();
    reload();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
