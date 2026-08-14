/*
 * Trade ads - /trades
 *
 * ---------------------------------------------------------------------------
 * WHERE THE ADS LIVE
 * ---------------------------------------------------------------------------
 * They live in this browser, in localStorage, and nowhere else.
 *
 * Wanwood has no trade ad service. There is no endpoint to post an ad to and
 * none to read other players' ads from - the backend simply does not have the
 * feature, so there is nothing for Wolimons to call. Rather than invent a
 * server that does not exist, or fill the board with made-up ads, the page is
 * honest about it: you can write ads, they persist on this device, and the
 * board shows exactly what you wrote. Nobody else's ads appear here, because
 * there is no way for them to arrive.
 *
 * If Wanwood ever grows the endpoints, `loadAds` and `saveAds` are the only
 * two functions that need to change.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS REAL
 * ---------------------------------------------------------------------------
 * Everything an ad is built from is real. Items come from the live catalog
 * search, thumbnails and RAP come from the API, the creator is the linked
 * Wanwood account, and Value is the hand-curated figure from values.js -
 * still 0 until someone sets it. No prices anywhere.
 */
(() => {
  'use strict';

  const API = window.WanwoodAPI;
  const ACCOUNT = window.WolimonsAccount;

  const STORAGE_KEY = 'wolimons_trade_ads_v1';
  const PAGE_SIZE = 10;
  const SEARCH_LIMIT = 24;
  const SEARCH_DEBOUNCE_MS = 300;
  const MAX_ADS = 200;

  /* The ten request tags, in the snapshot's order. A request slot holds
   * either an item or one of these. */
  const TAGS = [
    { slug: 'any', label: 'Any' },
    { slug: 'demand', label: 'Demand' },
    { slug: 'rares', label: 'Rares' },
    { slug: 'rap', label: 'RAP' },
    { slug: 'wishlist', label: 'Wishlist' },
    { slug: 'robux', label: 'Robux' },
    { slug: 'upgrade', label: 'Upgrade' },
    { slug: 'downgrade', label: 'Downgrade' },
    { slug: 'adds', label: 'Adds' },
    { slug: 'projecteds', label: 'Projecteds' },
  ];
  const TAG_BY_SLUG = new Map(TAGS.map(tag => [tag.slug, tag]));
  const tagArt = slug => `/img/tradetags/tradetag${slug}-420.png`;

  /* ------------------------------------------------------------------ */
  /* Small helpers                                                       */
  /* ------------------------------------------------------------------ */

  const formatNumber = value => Number(value).toLocaleString('en-US');

  const slugify = value => String(value || 'unnamed')
    .replace(/'/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unnamed';

  /* values.js read defensively, the same way item-cards.js reads it: a stale
   * or missing copy must not take the board down. Value is 0 until set. */
  const VALUES = {
    get(id) {
      const table = window.WolimonsValues;
      return table && typeof table.get === 'function' ? Number(table.get(id)) || 0 : 0;
    },
  };

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  /* "6 seconds ago" / "3 hours ago" - the snapshot's timestamp wording. */
  function relativeTime(timestamp) {
    const seconds = Math.max(0, Math.round((Date.now() - Number(timestamp)) / 1000));
    const steps = [
      [60, 'second'],
      [60, 'minute'],
      [24, 'hour'],
      [7, 'day'],
      [4.348, 'week'],
      [12, 'month'],
    ];
    let amount = seconds;
    let unit = 'second';
    for (let i = 0; i < steps.length; i += 1) {
      const [size, name] = steps[i];
      if (amount < size) { unit = name; break; }
      amount = Math.floor(amount / size);
      unit = steps[i + 1] ? steps[i + 1][1] : 'year';
    }
    const rounded = Math.max(1, Math.floor(amount));
    return `${rounded} ${unit}${rounded === 1 ? '' : 's'} ago`;
  }

  /* ------------------------------------------------------------------ */
  /* Storage                                                             */
  /* ------------------------------------------------------------------ */

  /*
   * An ad on disk:
   *   { id, creatorId, creatorName, createdAt,
   *     offer:   [ slot|null x4 ],
   *     request: [ slot|null x4 ] }
   *
   * A slot is either { kind:'item', id, name } or { kind:'tag', slug }.
   * Only ids and names are stored - thumbnails, RAP and Value are looked up
   * fresh on every render so the board never serves stale numbers.
   */
  function loadAds() {
    let raw = null;
    try {
      raw = window.localStorage.getItem(STORAGE_KEY);
    } catch (error) {
      return [];
    }
    if (!raw) return [];
    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      return [];
    }
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeAd).filter(Boolean);
  }

  function saveAds(ads) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ads.slice(0, MAX_ADS)));
      return true;
    } catch (error) {
      return false;
    }
  }

  function normalizeSlot(raw) {
    if (!raw || typeof raw !== 'object') return null;
    if (raw.kind === 'tag') {
      return TAG_BY_SLUG.has(raw.slug) ? { kind: 'tag', slug: raw.slug } : null;
    }
    const id = Number(raw.id);
    if (!Number.isSafeInteger(id) || id <= 0) return null;
    return { kind: 'item', id, name: typeof raw.name === 'string' ? raw.name : '' };
  }

  function normalizeSide(raw) {
    const list = Array.isArray(raw) ? raw : [];
    return [0, 1, 2, 3].map(index => normalizeSlot(list[index]));
  }

  function normalizeAd(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const creatorId = Number(raw.creatorId);
    const creatorName = typeof raw.creatorName === 'string' ? raw.creatorName.trim() : '';
    if (!Number.isSafeInteger(creatorId) || creatorId <= 0 || !creatorName) return null;
    const offer = normalizeSide(raw.offer);
    const request = normalizeSide(raw.request);
    if (!offer.some(Boolean)) return null;
    return {
      id: String(raw.id || `${creatorId}-${raw.createdAt || Date.now()}`),
      creatorId,
      creatorName,
      createdAt: Number(raw.createdAt) || Date.now(),
      offer,
      request,
    };
  }

  /* ------------------------------------------------------------------ */
  /* Page state                                                          */
  /* ------------------------------------------------------------------ */

  const state = {
    ads: [],
    page: 0,
    filters: { offerName: '', requestName: '', tags: new Set() },
    composer: { offer: [null, null, null, null], request: [null, null, null, null] },
    picker: { side: null, slot: null, sequence: 0 },
    /* id -> { name, thumbnail, rap } for every item the board mentions. */
    items: new Map(),
    creators: new Map(),
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
    dom.enabledTagFilters = document.getElementById('enabled_request_tag_filters');
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
  /* Item lookups                                                        */
  /* ------------------------------------------------------------------ */

  /* Fill state.items for every item id the given ads reference. One details
   * call covers the lot; a failure leaves the ids unresolved rather than
   * fabricating names or numbers. */
  async function resolveItems(ids) {
    const wanted = [...new Set(ids.map(Number).filter(id =>
      Number.isSafeInteger(id) && id > 0 && !state.items.has(id)))];
    if (!wanted.length) return;
    let details = [];
    try {
      details = await API.getItemDetails(wanted, { includePrice: false });
    } catch (error) {
      return;
    }
    details.forEach(item => {
      const id = Number(item.id ?? item.assetId);
      if (!Number.isSafeInteger(id)) return;
      state.items.set(id, {
        id,
        name: (item.name || '').trim(),
        thumbnail: item.thumbnail || API.thumbnailUrl(id),
        rap: Number.isFinite(item.rap) ? item.rap : null,
      });
    });
  }

  async function resolveCreators(ids) {
    const wanted = [...new Set(ids.map(Number).filter(id =>
      Number.isSafeInteger(id) && id > 0 && !state.creators.has(id)))];
    if (!wanted.length) return;
    let map = new Map();
    try {
      map = await API.fetchUserHeadshots(wanted, 150);
    } catch (error) {
      return;
    }
    wanted.forEach(id => state.creators.set(id, map.get(id) || ''));
  }

  /* ------------------------------------------------------------------ */
  /* Totals                                                              */
  /* ------------------------------------------------------------------ */

  /*
   * A side's Value and RAP are the sums over its item slots. Tag slots have
   * no numbers and contribute nothing. A side with no items at all shows "-",
   * which is what the snapshot does for a tags-only request side.
   *
   * Value is the curated figure and is 0 until set, so a side of unvalued
   * items legitimately totals 0 - that is not a missing number, it is the
   * honest answer.
   */
  function sideTotals(side) {
    const items = side.filter(slot => slot && slot.kind === 'item');
    if (!items.length) return { value: null, rap: null };
    let value = 0;
    let rap = 0;
    let sawRap = false;
    items.forEach(slot => {
      value += VALUES.get(slot.id);
      const known = state.items.get(slot.id);
      if (known && Number.isFinite(known.rap)) {
        rap += known.rap;
        sawRap = true;
      }
    });
    return { value, rap: sawRap ? rap : null };
  }

  /* ------------------------------------------------------------------ */
  /* Rendering a card                                                    */
  /* ------------------------------------------------------------------ */

  function slotImage(slot, index, side) {
    const wrap = el('div', 'position-relative');
    wrap.appendChild(el('div', `system_item_tag_container_${index + 1}`));

    if (!slot) {
      const blank = el('div', `ad_item_img ad_item_img_${index + 1} ad_item_slot_empty`);
      blank.setAttribute('aria-label', 'Empty slot');
      wrap.appendChild(blank);
      return wrap;
    }

    if (slot.kind === 'tag') {
      const tag = TAG_BY_SLUG.get(slot.slug);
      const img = el('img', `ad_item_img ad_item_img_${index + 1}`);
      img.width = 118;
      img.height = 118;
      img.decoding = 'async';
      img.loading = 'lazy';
      img.src = tagArt(slot.slug);
      img.alt = tag ? tag.label : slot.slug;
      img.title = tag ? tag.label : slot.slug;
      wrap.appendChild(img);
      return wrap;
    }

    const known = state.items.get(slot.id);
    const name = (known && known.name) || slot.name || `Item ${slot.id}`;
    const value = VALUES.get(slot.id);
    const rap = known && Number.isFinite(known.rap) ? known.rap : null;

    const link = el('a');
    link.href = `/item/?id=${slot.id}&name=${slugify(name)}`;
    const img = el('img', `ad_item_img hover_pointer ad_item_img_${index + 1}`);
    img.width = 118;
    img.height = 118;
    img.decoding = 'async';
    img.loading = 'lazy';
    img.src = (known && known.thumbnail) || API.thumbnailUrl(slot.id);
    img.alt = `${side} slot thumbnail`;
    /* Value and RAP only - never a price. */
    img.title = `${name}\nValue ${value ? formatNumber(value) : '-'}`
      + `\nRAP ${rap === null ? '-' : formatNumber(rap)}`;
    link.appendChild(img);
    wrap.appendChild(link);
    return wrap;
  }

  function sideNode(ad, which) {
    const slots = which === 'offer' ? ad.offer : ad.request;
    const side = el('div', which === 'offer' ? 'ad_side_left' : 'ad_side_right');
    side.appendChild(el('div', 'ad_side_header', which === 'offer' ? 'Offering' : 'Requesting'));

    const grid = el('div', 'd-flex flex-wrap flex-lg-nowrap justify-content-center');
    const rowA = el('div', 'd-flex');
    const rowB = el('div', 'd-flex');
    rowA.appendChild(slotImage(slots[0], 0, which));
    rowA.appendChild(slotImage(slots[1], 1, which));
    rowB.appendChild(slotImage(slots[2], 2, which));
    rowB.appendChild(slotImage(slots[3], 3, which));
    grid.appendChild(rowA);
    grid.appendChild(rowB);
    side.appendChild(grid);

    const totals = sideTotals(slots);
    const details = el('div', 'ad_side_details');
    details.appendChild(el('div', 'stat_title', 'Value'));
    details.appendChild(el('div', 'stat_value', totals.value === null ? '-' : formatNumber(totals.value)));
    details.appendChild(el('div', 'stat_title', 'RAP'));
    details.appendChild(el('div', 'stat_rap', totals.rap === null ? '-' : formatNumber(totals.rap)));
    side.appendChild(details);
    return side;
  }

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
    const headshot = state.creators.get(ad.creatorId);
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
    const profile = el('a', 'trade_ad_page_link_button my-auto btn btn-flat-light-blue-sm shadow-none', 'Details');
    profile.href = `/player/?id=${ad.creatorId}`;
    profile.setAttribute('role', 'button');
    actions.appendChild(profile);

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
    const known = state.items.get(slot.id);
    const name = ((known && known.name) || slot.name || '').toLowerCase();
    return name.includes(needle);
  }

  function visibleAds() {
    const offerNeedle = state.filters.offerName.trim().toLowerCase();
    const requestNeedle = state.filters.requestName.trim().toLowerCase();
    const tags = state.filters.tags;

    return state.ads.filter(ad => {
      if (offerNeedle && !ad.offer.some(slot => slotMatchesName(slot, offerNeedle))) return false;
      if (requestNeedle && !ad.request.some(slot => slotMatchesName(slot, requestNeedle))) return false;
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

    const known = state.items.get(slot.id);
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

  /* Bootstrap's JS is not loaded on this site, so the modal is shown by hand
   * the same way the rest of the pages do it. */
  function showPicker(open) {
    if (!dom.pickerModal) return;
    dom.pickerModal.classList.toggle('show', open);
    dom.pickerModal.style.display = open ? 'block' : 'none';
    dom.pickerModal.setAttribute('aria-hidden', open ? 'false' : 'true');
    document.body.classList.toggle('modal-open', open);
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
          state.items.set(id, {
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

  function renderTagFilterChips() {
    if (!dom.enabledTagFilters) return;
    dom.enabledTagFilters.textContent = '';
    state.filters.tags.forEach(slug => {
      const tag = TAG_BY_SLUG.get(slug);
      const container = el('div', 'filter_display_tag_container m-1');
      const img = el('img', 'filter_display_tag');
      img.src = tagArt(slug);
      img.width = 48;
      img.height = 48;
      img.alt = tag ? tag.label : slug;
      img.title = tag ? tag.label : slug;
      container.appendChild(img);

      const remove = el('div', 'filter-remove-button', '\u00d7');
      remove.style.display = 'block';
      remove.setAttribute('role', 'button');
      remove.setAttribute('aria-label', `Remove ${tag ? tag.label : slug} filter`);
      remove.addEventListener('click', () => {
        state.filters.tags.delete(slug);
        syncTagFilterButtons();
        renderTagFilterChips();
        state.page = 0;
        renderBoard();
      });
      container.appendChild(remove);
      dom.enabledTagFilters.appendChild(container);
    });
  }

  function syncTagFilterButtons() {
    if (!dom.tagFilterRow) return;
    dom.tagFilterRow.querySelectorAll('[data-tag]').forEach(button => {
      const on = state.filters.tags.has(button.dataset.tag);
      button.classList.toggle('btn-flat-light-blue', on);
      button.classList.toggle('btn-flat-dark-gray', !on);
      button.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
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

    if (dom.tagFilterRow) {
      dom.tagFilterRow.addEventListener('click', event => {
        const button = event.target.closest('[data-tag]');
        if (!button) return;
        const slug = button.dataset.tag;
        if (state.filters.tags.has(slug)) state.filters.tags.delete(slug);
        else state.filters.tags.add(slug);
        syncTagFilterButtons();
        renderTagFilterChips();
        state.page = 0;
        renderBoard();
      });
    }

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

    const itemIds = [];
    const creatorIds = [];
    state.ads.forEach(ad => {
      creatorIds.push(ad.creatorId);
      ad.offer.concat(ad.request).forEach(slot => {
        if (slot && slot.kind === 'item') itemIds.push(slot.id);
      });
    });
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
    renderTagFilterChips();
    renderComposer();
    reload();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
