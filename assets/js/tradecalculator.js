(() => {
  'use strict';

  const CONFIG = window.WOLIMONS_CONFIG || {};
  const SITE_BASE = CONFIG.siteBase || 'https://wanwoo.xyz';
  const PAGE_SIZE = 42;
  const STORAGE_KEY = 'wolimons_tradecalculator';

  const offerContainer = document.getElementById('offer_items');
  const requestContainer = document.getElementById('request_items');
  const grid = document.getElementById('trade_calculator_mix_container');
  if (!offerContainer || !requestContainer || !grid) return;

  const searchInput = document.getElementById('trade_calculator_page_search_textbox');
  const searchClear = document.getElementById('trade_calculator_page_search_textbox_clear');
  const topPagination = document.getElementById('pagination_control_top');
  const bottomPagination = document.getElementById('pagination_control_bottom');
  const sourceSelect = document.getElementById('inventory-source-select');
  const otherControls = document.getElementById('other-player-controls');
  const usernameInput = document.getElementById('hide-player-items-username');
  const usernameClear = document.getElementById('hide-player-items-username-clear');
  const scanButton = document.getElementById('hide-player-items-scan');
  const statusMessage = document.getElementById('inventory-filter-status-message');
  const deltaCard = document.getElementById('trade_delta_card');
  const multiplierInput = document.getElementById('robux_multiplier_textbox');
  const offerSlotsInput = document.getElementById('offer_slots_textbox');
  const requestSlotsInput = document.getElementById('request_slots_textbox');
  const gainLossBarCheckbox = document.getElementById('show_gain_loss_bar_checkbox');
  const gainLossRapCheckbox = document.getElementById('show_gain_loss_rap_checkbox');
  const optionsDialog = document.getElementById('trade_options_dialog');

  const ROBUX_TO_VALUE = 1;

  const state = {
    page: 1,
    total: 0,
    keyword: '',
    items: [],
    sequence: 0,
    source: 'all',
    inventory: null,
    offerSlots: 4,
    requestSlots: 4,
    multiplier: 1,
    offer: [],
    request: [],
    activeSlot: null,
  };

  const formatNumber = value => Number(value || 0).toLocaleString('en-US');

  /* ------------------------------------------------------------------ */
  /* Persisted options                                                   */
  /* ------------------------------------------------------------------ */

  function readOptions() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch (error) {
      return {};
    }
  }

  function writeOptions(patch) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readOptions(), ...patch }));
    } catch (error) {
      /* storage is optional */
    }
  }

  /* ------------------------------------------------------------------ */
  /* Wanwood API                                                         */
  /* ------------------------------------------------------------------ */

  const API = window.WanwoodAPI;

  function searchCatalog() {
    return API.searchItems({
      category: 'Collectibles',
      subcategory: 'Collectibles',
      sortType: '3',
      keyword: state.keyword,
      limit: PAGE_SIZE,
      cursor: (state.page - 1) * PAGE_SIZE,
    });
  }

  async function fetchUserId(username) {
    try {
      return await API.getUserByUsername(username);
    } catch (error) {
      return null;
    }
  }

  const VALUES = window.WolimonsValues;

  const fetchCollectibles = userId => API.getCollectibles(userId);

  /* ------------------------------------------------------------------ */
  /* Item normalisation                                                  */
  /* ------------------------------------------------------------------ */

  function normalizeItem(item, rap) {
    const id = Number(item.id ?? item.assetId);
    const restrictions = Array.isArray(item.itemRestrictions) ? item.itemRestrictions : [];
    return {
      id,
      name: String(item.name || '').trim(),
      rare: restrictions.includes('LimitedUnique') || item.isLimitedUnique === true,
      rap: Number.isFinite(Number(rap)) ? Number(rap) : null,
      /* Value is community-assigned and lives in values.js - it is not a
       * price and it is not RAP. Unset items are worth 0, which is exactly
       * how they should be totalled in a trade. */
      value: VALUES.get(id),
      thumbnail: item.thumbnail || API.thumbnailUrl(id),
    };
  }

  function setStatus(message, busy = false) {
    if (!statusMessage) return;
    statusMessage.classList.toggle('d-none', !message);
    statusMessage.replaceChildren();
    if (!message) return;
    if (busy) {
      const spinner = document.createElement('span');
      spinner.className = 'spinner-border mr-2';
      spinner.setAttribute('role', 'status');
      statusMessage.append(spinner);
    }
    const text = document.createElement('span');
    text.className = 'inventory-status-text';
    text.textContent = message;
    statusMessage.append(text);
  }

  /* ------------------------------------------------------------------ */
  /* Item picker                                                         */
  /* ------------------------------------------------------------------ */

  async function loadItems() {
    const sequence = ++state.sequence;
    grid.replaceChildren();
    topPagination.replaceChildren();
    bottomPagination.replaceChildren();

    try {
      let ordered;
      if (state.source === 'all' || !state.inventory) {
        const search = await searchCatalog();
        if (sequence !== state.sequence) return;
        ordered = search.ids.length
          ? await API.getItemDetails(search.ids, { includePrice: false })
          : [];
        const byId = new Map(ordered.map(item => [item.id, item]));
        ordered = search.ids.map(id => byId.get(id)).filter(item => item && item.name);
        state.total = Number.isFinite(search.total) && search.total > 0
          ? search.total
          : ordered.length;
      } else {
        /* Inventory rows already carry name + recentAveragePrice; they only
         * need thumbnails resolving. */
        const keyword = state.keyword.toLowerCase();
        const matching = state.inventory.filter(item => !keyword
          || String(item.name || '').toLowerCase().includes(keyword));
        state.total = matching.length;
        const start = (state.page - 1) * PAGE_SIZE;
        const page = matching.slice(start, start + PAGE_SIZE);
        const thumbs = await API.fetchThumbnails(page.map(item => Number(item.assetId ?? item.id)));
        ordered = page.map(item => {
          const id = Number(item.assetId ?? item.id);
          return {
            ...item,
            id,
            rap: Number(item.recentAveragePrice),
            thumbnail: thumbs.get(id),
          };
        });
      }
      if (sequence !== state.sequence) return;

      state.items = ordered.map(item => normalizeItem(item, item.rap));
      renderGrid();
    } catch (error) {
      if (sequence !== state.sequence) return;
      console.error('Could not load Wanwood items:', error);
      const message = document.createElement('div');
      message.className = 'text-center text-muted py-5 w-100';
      message.textContent = 'The Wanwood item list could not be loaded.';
      grid.replaceChildren(message);
    }
  }

  function statRow(label, value, color, tight) {
    const row = document.createElement('div');
    row.className = 'd-flex justify-content-between';
    if (tight) row.style.lineHeight = '0.8em';
    const labelWrap = document.createElement('div');
    const small = document.createElement('small');
    small.className = tight ? 'text-muted stat-header' : 'text-muted';
    small.textContent = label;
    labelWrap.append(small);
    const amount = document.createElement('div');
    const span = document.createElement('span');
    span.className = 'stat-data text-truncate';
    span.style.color = color;
    span.textContent = value === null ? '-' : formatNumber(value);
    amount.append(span);
    row.append(labelWrap, amount);
    return row;
  }

  function createCard(item) {
    const card = document.createElement('div');
    card.className = 'px-0 mb-3 shadow_md_35 shift_up_sm mix_item border_md';
    card.style.paddingBottom = '2px';
    card.style.backgroundColor = '#30363c';
    card.dataset.ref = 'item';
    card.dataset.itemId = String(item.id);

    const headingWrap = document.createElement('div');
    const heading = document.createElement('h6');
    heading.className = 'item-card-title text-truncate px-1';
    heading.style.color = '#dcdfe2';
    heading.title = item.name;
    heading.textContent = item.name;
    headingWrap.append(heading);

    const imageWrap = document.createElement('div');
    imageWrap.className = 'position-relative std_item_card_img_bkgnd_gradient text-center border border-left-0 border-right-0 border-dark';
    const image = document.createElement('img');
    image.className = 'd-block-inline item_thumbnail';
    image.src = item.thumbnail;
    image.width = 100;
    image.height = 100;
    image.loading = 'lazy';
    image.alt = `${item.name} thumbnail`;
    const tagContainer = document.createElement('div');
    tagContainer.className = 'system_item_tag_container';
    if (item.rare) {
      const tag = document.createElement('div');
      tag.className = 'system_item_tag_icon rare_tag_icon';
      tag.title = 'Rare';
      tagContainer.append(tag);
    }
    imageWrap.append(image, tagContainer);

    const stats = document.createElement('div');
    stats.className = 'px-1 pt-1';
    stats.append(statRow('RAP', item.rap, '#bfbebe', true));
    stats.append(statRow('Value', item.value, '#4db7d6', false));

    card.append(headingWrap, imageWrap, stats);
    card.addEventListener('click', () => addItemToTrade(item));
    return card;
  }

  function renderGrid() {
    if (!state.items.length) {
      const message = document.createElement('div');
      message.className = 'text-center text-muted py-5 w-100';
      message.textContent = 'No items matched this search.';
      grid.replaceChildren(message);
    } else {
      grid.replaceChildren(...state.items.map(createCard));
    }
    renderPagination(topPagination);
    renderPagination(bottomPagination);
  }

  const PREV_ARROW = 'm4.431 12.822 13 9A1 1 0 0 0 19 21V3a1 1 0 0 0-1.569-.823l-13 9a1.003 1.003 0 0 0 0 1.645z';
  const NEXT_ARROW = 'M5.536 21.886a1.004 1.004 0 0 0 1.033-.064l13-9a1 1 0 0 0 0-1.644l-13-9A1 1 0 0 0 5 3v18a1 1 0 0 0 .536.886z';

  function arrowIcon(path) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('viewBox', '0 2 25 25');
    const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    shape.setAttribute('fill', 'currentColor');
    shape.setAttribute('d', path);
    svg.append(shape);
    return svg;
  }

  function goToPage(page) {
    state.page = page;
    loadItems();
    grid.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function paginationItem(list, content, page, { disabled = false, current = false, extra = '' } = {}) {
    const item = document.createElement('li');
    if (disabled) item.className = 'disabled';
    else if (current) item.className = 'active';
    if (disabled || current) {
      const span = document.createElement('span');
      span.className = `current${extra ? ` ${extra}` : ''}`;
      span.append(content);
      item.append(span);
    } else {
      const link = document.createElement('a');
      link.className = `page-link${extra ? ` ${extra}` : ''}`;
      link.href = `#page-${page}`;
      link.append(content);
      link.addEventListener('click', event => {
        event.preventDefault();
        goToPage(page);
      });
      item.append(link);
    }
    list.append(item);
  }

  function renderPagination(container) {
    container.replaceChildren();
    const totalPages = Math.max(1, Math.ceil(state.total / PAGE_SIZE));
    if (totalPages < 2) return;

    const list = document.createElement('ul');
    paginationItem(list, arrowIcon(PREV_ARROW), state.page - 1,
      { disabled: state.page === 1, extra: 'prev' });

    const start = Math.max(1, Math.min(state.page - 2, totalPages - 4));
    const nearby = [];
    for (let page = start; page < start + 5 && page <= totalPages; page += 1) nearby.push(page);
    const pages = [...new Set([1, ...nearby, totalPages])].sort((a, b) => a - b);

    let prior = 0;
    for (const page of pages) {
      if (prior && page - prior > 1) {
        const gap = document.createElement('li');
        const span = document.createElement('span');
        span.className = 'ellipse';
        span.textContent = '…';
        gap.append(span);
        list.append(gap);
      }
      paginationItem(list, document.createTextNode(String(page)), page,
        { current: page === state.page });
      prior = page;
    }

    paginationItem(list, arrowIcon(NEXT_ARROW), state.page + 1,
      { disabled: state.page === totalPages, extra: 'next' });
    container.append(list);
  }

  /* ------------------------------------------------------------------ */
  /* Trade slots                                                         */
  /* ------------------------------------------------------------------ */

  function slotElements(index) {
    return {
      image: document.getElementById(`item_img_${index}`),
      select: document.getElementById(`item_select_${index}`),
      remove: document.getElementById(`item_remove_${index}`),
    };
  }

  function buildSlot(index) {
    const slot = document.createElement('div');
    slot.className = 'trade-item';
    slot.dataset.itemSlot = String(index);
    for (const [suffix, className, src, alt] of [
      ['img', 'shadow-sm trade-item-img m-0', '/img/empty_trade_slot.png', 'Empty trade slot'],
      ['select', 'trade-item-img m-0 trade-btn-shadow d-none', '/img/item_select.png', ''],
      ['remove', 'trade-item-img m-0 trade-btn-shadow d-none', '/img/item_remove.png', ''],
    ]) {
      const image = document.createElement('img');
      image.id = `item_${suffix}_${index}`;
      image.className = className;
      image.src = src;
      image.width = 150;
      image.height = 150;
      image.alt = alt;
      slot.append(image);
    }
    return slot;
  }

  function slotIndexes(side) {
    return side === 'offer'
      ? [...Array(state.offerSlots).keys()]
      : [...Array(state.requestSlots).keys()].map(index => index + state.offerSlots);
  }

  function sideSlots(side) {
    return side === 'offer' ? state.offer : state.request;
  }

  function slotAt(side, position) {
    return sideSlots(side)[position] || null;
  }

  function rebuildSlots() {
    state.offer.length = state.offerSlots;
    state.request.length = state.requestSlots;
    for (const [side, container] of [['offer', offerContainer], ['request', requestContainer]]) {
      container.replaceChildren(...slotIndexes(side).map((index, position) => {
        const slot = buildSlot(index);
        slot.dataset.side = side;
        slot.dataset.position = String(position);
        return slot;
      }));
    }
    if (state.activeSlot && state.activeSlot.position >= sideSlots(state.activeSlot.side).length) {
      state.activeSlot = null;
    }
    bindSlots();
    renderSlots();
  }

  function bindSlots() {
    document.querySelectorAll('.trade-item[data-item-slot]').forEach(element => {
      const side = element.dataset.side;
      const position = Number(element.dataset.position);
      element.addEventListener('click', () => {
        if (slotAt(side, position)) {
          sideSlots(side)[position] = null;
          renderSlots();
          updateTotals();
          return;
        }
        const active = state.activeSlot;
        state.activeSlot = active && active.side === side && active.position === position
          ? null
          : { side, position };
        renderSlots();
      });
    });
  }

  function renderSlots() {
    for (const side of ['offer', 'request']) {
      slotIndexes(side).forEach((index, position) => {
        const { image, select, remove } = slotElements(index);
        if (!image) return;
        const item = slotAt(side, position);
        if (item) {
          image.src = item.thumbnail;
          image.alt = item.name;
          image.title = `${item.name} — Value ${formatNumber(item.value)} / RAP ${formatNumber(item.rap)}`;
          remove.classList.remove('d-none');
          select.classList.add('d-none');
        } else {
          image.src = '/img/empty_trade_slot.png';
          image.alt = 'Empty trade slot';
          image.removeAttribute('title');
          remove.classList.add('d-none');
          const active = state.activeSlot;
          const isActive = Boolean(active) && active.side === side && active.position === position;
          select.classList.toggle('d-none', !isActive);
        }
      });
    }
  }

  function firstEmptySlot() {
    for (const side of ['offer', 'request']) {
      const slots = sideSlots(side);
      for (let position = 0; position < slots.length; position += 1) {
        if (!slots[position]) return { side, position };
      }
    }
    return null;
  }

  function addItemToTrade(item) {
    let target = state.activeSlot;
    if (!target || slotAt(target.side, target.position)) target = firstEmptySlot();
    if (!target) return;
    sideSlots(target.side)[target.position] = item;
    state.activeSlot = null;
    renderSlots();
    updateTotals();
  }

  /* ------------------------------------------------------------------ */
  /* Totals and gain/loss                                                */
  /* ------------------------------------------------------------------ */

  function robuxOf(side) {
    const input = document.getElementById(`${side}_robux_textbox`);
    const digits = String(input?.value || '').replace(/[^0-9]/g, '');
    return digits ? Number(digits) : 0;
  }

  function sideTotals(side) {
    let value = 0;
    let rap = 0;
    for (const item of sideSlots(side)) {
      if (!item) continue;
      value += Number(item.value || 0);
      rap += Number(item.rap || 0);
    }
    const robux = robuxOf(side) * state.multiplier * ROBUX_TO_VALUE;
    return { value: value + robux, rap: rap + robux, robux: robuxOf(side) };
  }

  const ARROW_UP = 'M12 4l8 12H4z';
  const ARROW_DOWN = 'M12 20L4 8h16z';

  function renderDelta(kind, difference) {
    const row = document.getElementById(`${kind}_delta_row`);
    const badge = document.getElementById(`${kind}_delta_badge`);
    const amount = document.getElementById(`${kind}_delta_amount`);
    if (!row || !badge || !amount) return;

    row.classList.remove('trade-delta-even', 'trade-delta-underpay', 'trade-delta-overpay');
    if (difference === 0) {
      row.classList.add('trade-delta-even');
      badge.textContent = 'Even';
    } else if (difference > 0) {
      row.classList.add('trade-delta-underpay');
      badge.textContent = 'Gain';
    } else {
      row.classList.add('trade-delta-overpay');
      badge.textContent = 'Loss';
    }

    const arrow = amount.querySelector('.trade-delta-arrow');
    const value = amount.querySelector('.trade-delta-value');
    arrow.replaceChildren();
    if (difference !== 0) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', difference > 0 ? ARROW_UP : ARROW_DOWN);
      svg.append(path);
      arrow.append(svg);
    }
    value.textContent = formatNumber(Math.abs(difference));
  }

  function updateTotals() {
    const offer = sideTotals('offer');
    const request = sideTotals('request');

    document.getElementById('offer_value_total_textbox').textContent = formatNumber(offer.value);
    document.getElementById('offer_rap_total_textbox').textContent = formatNumber(offer.rap);
    document.getElementById('request_value_total_textbox').textContent = formatNumber(request.value);
    document.getElementById('request_rap_total_textbox').textContent = formatNumber(request.rap);

    for (const side of ['offer', 'request']) {
      const label = document.getElementById(`${side}_robux_multiplier_text`);
      const robux = side === 'offer' ? offer.robux : request.robux;
      label.textContent = robux && state.multiplier !== 1
        ? `×${state.multiplier} = ${formatNumber(Math.round(robux * state.multiplier))}`
        : '';
    }

    const hasItems = [...state.offer, ...state.request].some(Boolean);
    const empty = !hasItems && !offer.robux && !request.robux;
    deltaCard.classList.toggle('trade-delta-empty', empty);
    renderDelta('value', Math.round(request.value - offer.value));
    renderDelta('rap', Math.round(request.rap - offer.rap));
  }

  /* ------------------------------------------------------------------ */
  /* Inventory sources                                                   */
  /* ------------------------------------------------------------------ */

  async function scanUsername(username) {
    if (!username) {
      setStatus('Enter a username to scan.');
      return;
    }
    setStatus(`Looking up ${username}…`, true);
    scanButton.disabled = true;
    try {
      const user = await fetchUserId(username);
      if (!user) {
        setStatus(`No Wanwood player named ${username}.`);
        return;
      }
      setStatus(`Loading ${user.name}'s inventory…`, true);
      const collectibles = await fetchCollectibles(user.id);
      state.inventory = collectibles.map(row => ({
        id: Number(row.assetId ?? row.id),
        name: row.name,
        recentAveragePrice: Number.isFinite(Number(row.recentAveragePrice))
          ? Number(row.recentAveragePrice)
          : null,
      })).filter(item => Number.isSafeInteger(item.id) && item.name);
      state.page = 1;
      setStatus(`${user.name} · ${formatNumber(state.inventory.length)} limiteds`);
      writeOptions({ username: user.name });
      loadItems();
    } catch (error) {
      console.error('Could not scan the inventory:', error);
      setStatus('That inventory could not be loaded.');
    } finally {
      scanButton.disabled = false;
    }
  }

  function syncSourceControls() {
    const needsUsername = state.source !== 'all';
    otherControls.classList.toggle('d-none', !needsUsername);
    if (!needsUsername) {
      state.inventory = null;
      setStatus('');
      state.page = 1;
      loadItems();
      return;
    }
    const saved = readOptions().username || '';
    if (state.source === 'mine' && saved) {
      usernameInput.value = saved;
      syncUsernameClear();
      scanUsername(saved);
    } else {
      setStatus(state.source === 'mine'
        ? 'Enter your username and scan to load your inventory.'
        : 'Enter a username and scan to browse their inventory.');
    }
  }

  function syncUsernameClear() {
    usernameClear.classList.toggle('is-visible', Boolean(usernameInput.value));
  }

  /* ------------------------------------------------------------------ */
  /* Options modal                                                       */
  /* ------------------------------------------------------------------ */

  function openOptions() {
    optionsDialog.style.display = 'block';
    optionsDialog.classList.add('show');
    optionsDialog.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
  }

  function closeOptions() {
    optionsDialog.classList.remove('show');
    optionsDialog.style.display = 'none';
    optionsDialog.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-open');
  }

  document.querySelectorAll('[data-target="#trade_options_dialog"]').forEach(trigger => {
    trigger.addEventListener('click', event => {
      event.preventDefault();
      openOptions();
    });
  });
  optionsDialog.querySelectorAll('[data-dismiss="modal"]').forEach(button => {
    button.addEventListener('click', closeOptions);
  });
  optionsDialog.addEventListener('click', event => {
    if (event.target === optionsDialog) closeOptions();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeOptions();
  });

  function applyGainLossOptions() {
    document.documentElement.classList.toggle(
      'trade-gain-loss-bar-hidden', !gainLossBarCheckbox.checked);
    document.documentElement.classList.toggle(
      'trade-gain-loss-rap-hidden', !gainLossRapCheckbox.checked);
  }

  /* ------------------------------------------------------------------ */
  /* Wiring                                                              */
  /* ------------------------------------------------------------------ */

  const saved = readOptions();
  state.offerSlots = Number(saved.offerSlots) >= 4 ? Number(saved.offerSlots) : 4;
  state.requestSlots = Number(saved.requestSlots) >= 4 ? Number(saved.requestSlots) : 4;
  state.multiplier = Number(saved.multiplier) > 0 ? Number(saved.multiplier) : 1;
  offerSlotsInput.value = String(state.offerSlots);
  requestSlotsInput.value = String(state.requestSlots);
  multiplierInput.value = String(state.multiplier);
  gainLossBarCheckbox.checked = saved.gainLossBar !== false;
  gainLossRapCheckbox.checked = saved.gainLossRap !== false;
  applyGainLossOptions();

  multiplierInput.addEventListener('change', () => {
    const value = Number(multiplierInput.value);
    state.multiplier = Number.isFinite(value) && value > 0 ? value : 1;
    multiplierInput.value = String(state.multiplier);
    writeOptions({ multiplier: state.multiplier });
    updateTotals();
  });

  for (const [input, key] of [[offerSlotsInput, 'offerSlots'], [requestSlotsInput, 'requestSlots']]) {
    input.addEventListener('change', () => {
      const value = Math.min(100, Math.max(4, Math.round(Number(input.value) || 4)));
      input.value = String(value);
      state[key] = value;
      writeOptions({ [key]: value });
      rebuildSlots();
      updateTotals();
    });
  }

  for (const checkbox of [gainLossBarCheckbox, gainLossRapCheckbox]) {
    checkbox.addEventListener('change', () => {
      applyGainLossOptions();
      writeOptions({
        gainLossBar: gainLossBarCheckbox.checked,
        gainLossRap: gainLossRapCheckbox.checked,
      });
    });
  }

  for (const side of ['offer', 'request']) {
    const input = document.getElementById(`${side}_robux_textbox`);
    input.addEventListener('input', () => {
      input.value = input.value.replace(/[^0-9]/g, '');
      updateTotals();
    });
  }

  let searchTimer;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.keyword = searchInput.value.trim();
      state.page = 1;
      loadItems();
    }, 300);
  });

  searchClear.addEventListener('click', event => {
    event.preventDefault();
    searchInput.value = '';
    state.keyword = '';
    state.page = 1;
    loadItems();
  });

  sourceSelect.addEventListener('change', () => {
    state.source = sourceSelect.value;
    syncSourceControls();
  });

  usernameInput.addEventListener('input', syncUsernameClear);
  usernameInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      scanUsername(usernameInput.value.trim());
    }
  });
  usernameClear.addEventListener('click', () => {
    usernameInput.value = '';
    syncUsernameClear();
    usernameInput.focus();
  });
  scanButton.addEventListener('click', () => scanUsername(usernameInput.value.trim()));

  rebuildSlots();
  updateTotals();
  loadItems();
})();
