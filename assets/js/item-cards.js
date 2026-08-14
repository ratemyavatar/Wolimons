(() => {
  'use strict';

  const API_BASE = 'https://wanwoo.xyz';
  const PAGE_SIZE = 18;
  const sliderTrack = document.getElementById('latest_limiteds_track');
  const searchGrid = document.querySelector('#global_item_search_results .search-item-card-grid');
  const searchInput = document.getElementById('global_item_search_textbox');
  const searchClear = document.getElementById('global_item_search_textbox_clear');
  const rapCache = new Map();
  let searchSequence = 0;

  const formatNumber = value => Number(value).toLocaleString('en-US');
  const slugify = value => String(value || 'unnamed')
    .replace(/'/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unnamed';

  async function fetchJson(url, options) {
    const response = await fetch(url, { mode: 'cors', ...options });
    if (!response.ok) throw new Error(`Wanwood API returned ${response.status}`);
    const text = await response.text();
    if (!text.trim()) throw new Error('Wanwood API returned an empty response');
    return JSON.parse(text);
  }

  async function searchItemIds(keyword = '') {
    const query = new URLSearchParams({
      category: 'Collectibles',
      subcategory: 'Collectibles',
      sortType: '3',
      limit: String(PAGE_SIZE),
    });
    if (keyword) query.set('keyword', keyword);

    try {
      const result = await fetchJson(`${API_BASE}/apisite/catalog/v1/search/items?${query}`);
      return (Array.isArray(result.data) ? result.data : [])
        .map(item => Number(item.id))
        .filter(Number.isSafeInteger);
    } catch (canonicalError) {
      const fallback = new URLSearchParams({ keyword, limit: String(PAGE_SIZE) });
      const result = await fetchJson(`${API_BASE}/apisite/catalog/v1/search?${fallback}`);
      const rows = Array.isArray(result) ? result : (result.data || result.items || []);
      const ids = rows.map(item => Number(item.id ?? item.assetId)).filter(Number.isSafeInteger);
      if (!ids.length) throw canonicalError;
      return ids;
    }
  }

  async function fetchItemDetails(ids) {
    if (!ids.length) return [];
    try {
      const result = await fetchJson(`${API_BASE}/apisite/catalog/v1/catalog/items/details`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: ids.map(id => ({ itemType: 'Asset', id })) }),
      });
      return Array.isArray(result.data) ? result.data : [];
    } catch (canonicalError) {
      const query = new URLSearchParams({ itemIds: ids.join(',') });
      const result = await fetchJson(`${API_BASE}/apisite/catalog/v1/items/details?${query}`);
      const rows = Array.isArray(result) ? result : (result.data || result.items || []);
      if (!rows.length) throw canonicalError;
      return rows;
    }
  }

  async function fetchRap(id) {
    if (!rapCache.has(id)) {
      rapCache.set(id, fetchJson(`${API_BASE}/apisite/economy/v1/assets/${id}/resale-data`)
        .then(data => Number.isFinite(Number(data.recentAveragePrice))
          ? Number(data.recentAveragePrice)
          : null)
        .catch(() => null));
    }
    return rapCache.get(id);
  }

  async function getItems(keyword = '') {
    const ids = await searchItemIds(keyword);
    const details = await fetchItemDetails(ids);
    const byId = new Map(details.map(item => [Number(item.id ?? item.assetId), item]));
    const ordered = ids.map(id => byId.get(id)).filter(item => {
      const itemId = Number(item?.id ?? item?.assetId);
      return item && Number.isSafeInteger(itemId) && typeof item.name === 'string' && item.name.trim();
    });
    const raps = await Promise.all(ordered.map(item => fetchRap(Number(item.id ?? item.assetId))));
    return ordered.map((item, index) => ({ ...item, rap: raps[index] }));
  }

  function itemData(item) {
    const id = Number(item.id ?? item.assetId);
    const restrictions = Array.isArray(item.itemRestrictions) ? item.itemRestrictions : [];
    const isLimitedUnique = restrictions.includes('LimitedUnique') || item.isLimitedUnique === true;
    const isLimited = isLimitedUnique || restrictions.includes('Limited') || item.isLimited === true;
    const priceValue = item.lowestPrice ?? item.price ?? item.priceRobux;
    return {
      id,
      name: item.name.trim(),
      href: `${API_BASE}/catalog/${id}/${slugify(item.name)}`,
      thumbnail: `${API_BASE}/asset-thumbnail/image?assetId=${id}&width=420&height=420&format=png`,
      ribbon: isLimitedUnique ? '/img/limitedu.svg' : (isLimited ? '/img/limited.svg' : ''),
      ribbonAlt: isLimitedUnique ? 'Limited U' : 'Limited',
      rap: Number.isFinite(item.rap) ? item.rap : null,
      price: priceValue !== null && priceValue !== undefined && Number.isFinite(Number(priceValue))
        ? Number(priceValue)
        : null,
    };
  }

  function text(tag, className, value) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    element.textContent = value;
    return element;
  }

  function appendStat(parent, header, value, valueClass, color) {
    if (value === null) return;
    const row = document.createElement('div');
    row.className = 'gen_items_slider_stat_row';
    row.append(text('span', 'gen_items_slider_stat_header', header));
    const amount = text('span', valueClass, formatNumber(value));
    if (color) amount.style.color = color;
    row.append(amount);
    parent.append(row);
  }

  function createSliderCard(rawItem) {
    const item = itemData(rawItem);
    const card = document.createElement('div');
    card.className = 'gen_items_slider_card';
    const link = document.createElement('a');
    link.href = item.href;
    const container = document.createElement('div');
    container.className = 'gen_items_slider_card_container shadow';
    const imageContainer = document.createElement('div');
    imageContainer.className = 'gen_items_slider_main_image_container';
    const image = document.createElement('img');
    image.className = 'gen_items_slider_card_main_image';
    image.src = item.thumbnail;
    image.loading = 'lazy';
    image.alt = `${item.name} thumbnail`;
    imageContainer.append(image);
    if (item.ribbon) {
      const ribbon = document.createElement('img');
      ribbon.className = 'limited_ribbon';
      ribbon.src = item.ribbon;
      ribbon.alt = item.ribbonAlt;
      ribbon.width = 75;
      ribbon.height = 15;
      ribbon.loading = 'lazy';
      imageContainer.append(ribbon);
    }
    const titleContainer = document.createElement('div');
    titleContainer.className = 'gen_items_slider_title_container';
    titleContainer.append(text('span', 'gen_items_slider_title', item.name));
    const info = document.createElement('div');
    info.className = 'gen_items_slider_info_section';
    appendStat(info, 'RAP', item.rap, 'gen_items_slider_stat_data');
    appendStat(info, 'Price', item.price, 'gen_items_slider_stat_data', '#4db7d6');
    container.append(imageContainer, titleContainer, info);
    link.append(container);
    card.append(link);
    return card;
  }

  function createSearchCard(rawItem) {
    const item = itemData(rawItem);
    const card = document.createElement('div');
    card.className = 'shadow_md_35 shift_up_md pb-2 search-item-card';
    card.style.backgroundColor = '#30363c';
    const link = document.createElement('a');
    link.href = item.href;

    const headingWrap = document.createElement('div');
    const heading = document.createElement('h6');
    heading.className = 'item_card_name px-2 text-light my-1 text-truncate';
    const name = text('div', 'text-truncate', item.name);
    name.title = item.name;
    heading.append(name);
    headingWrap.append(heading);

    const imageWrap = document.createElement('div');
    imageWrap.className = 'position-relative std_item_card_img_bkgnd_gradient text-center border-top border-bottom border-dark';
    imageWrap.append(text('div', 'system_item_tag_container', ''));
    const image = document.createElement('img');
    image.className = 'd-block-inline my-1';
    image.src = item.thumbnail;
    image.width = 100;
    image.height = 100;
    image.alt = `${item.name} thumbnail`;
    image.loading = 'lazy';
    imageWrap.append(image);

    const stats = document.createElement('div');
    stats.className = 'px-2 pt-1';
    for (const [label, value, color] of [['RAP', item.rap, ''], ['Price', item.price, '#4db7d6']]) {
      if (value === null) continue;
      const row = document.createElement('div');
      row.className = 'd-flex justify-content-between';
      const labelWrap = document.createElement('div');
      labelWrap.append(text('small', 'text-muted', label));
      const amount = text('div', label === 'RAP' ? 'text-light text-truncate ml-2' : 'text-truncate', formatNumber(value));
      if (color) amount.style.color = color;
      row.append(labelWrap, amount);
      stats.append(row);
    }
    link.append(headingWrap, imageWrap, stats);
    card.append(link);
    return card;
  }

  function renderItems(container, items, createCard) {
    container.replaceChildren(...items.map(createCard));
  }

  function renderError(container, message) {
    const error = text('div', 'text-center py-5 small', message);
    error.style.color = '#7a8288';
    container.replaceChildren(error);
  }

  async function loadLatest() {
    try {
      const items = await getItems();
      renderItems(sliderTrack, items, createSliderCard);
      renderItems(searchGrid, items, createSearchCard);
    } catch (error) {
      console.error('Could not load Wanwood item cards:', error);
      renderError(sliderTrack, 'Wanwood items could not be loaded.');
      renderError(searchGrid, 'Wanwood items could not be loaded.');
    }
  }

  async function runSearch(keyword) {
    const sequence = ++searchSequence;
    try {
      const items = await getItems(keyword.trim());
      if (sequence !== searchSequence) return;
      renderItems(searchGrid, items, createSearchCard);
    } catch (error) {
      if (sequence !== searchSequence) return;
      console.error('Could not search Wanwood items:', error);
      renderError(searchGrid, 'Wanwood item search could not be loaded.');
    }
  }

  let debounceTimer;
  searchInput?.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => runSearch(searchInput.value), 300);
  });
  searchClear?.addEventListener('click', () => {
    searchInput.value = '';
    runSearch('');
    searchInput.focus();
  });

  if (sliderTrack && searchGrid) loadLatest();
})();
