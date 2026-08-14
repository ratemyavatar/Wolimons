(() => {
  'use strict';

  const PAGE_SIZE = 18;
  const sliderTrack = document.getElementById('latest_limiteds_track');
  const searchGrid = document.querySelector('#global_item_search_results .search-item-card-grid');
  const searchInput = document.getElementById('global_item_search_textbox');
  const searchClear = document.getElementById('global_item_search_textbox_clear');
  let searchSequence = 0;

  const formatNumber = value => Number(value).toLocaleString('en-US');
  const slugify = value => String(value || 'unnamed')
    .replace(/'/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unnamed';

  const API = window.WanwoodAPI;

  /* Read values.js defensively - a browser holding a stale cached copy, or
   * one that never loaded it at all, must not take the search cards down. */
  const VALUES = {
    get: id => {
      const table = window.WolimonsValues;
      return table && typeof table.get === 'function' ? Number(table.get(id)) || 0 : 0;
    },
  };

  async function getItems(keyword = '') {
    const search = await API.searchItems({
      category: 'Collectibles',
      subcategory: 'Collectibles',
      sortType: '3',
      keyword,
      limit: PAGE_SIZE,
      cursor: 0,
    });
    if (!search.ids.length) return [];
    const details = await API.getItemDetails(search.ids, { includePrice: false });
    const byId = new Map(details.map(item => [item.id, item]));
    return search.ids.map(id => byId.get(id)).filter(item => item && item.name);
  }

  function itemData(item) {
    const id = Number(item.id ?? item.assetId);
    const restrictions = Array.isArray(item.itemRestrictions) ? item.itemRestrictions : [];
    const isLimitedUnique = restrictions.includes('LimitedUnique') || item.isLimitedUnique === true;
    const isLimited = isLimitedUnique || restrictions.includes('Limited') || item.isLimited === true;
    return {
      id,
      name: item.name.trim(),
      /* Our own item page - /dominus/ reads the id from the query string. */
      href: `/dominus/?id=${id}&name=${slugify(item.name)}`,
      thumbnail: item.thumbnail || API.thumbnailUrl(id),
      ribbon: isLimitedUnique ? '/img/limitedu.svg' : (isLimited ? '/img/limited.svg' : ''),
      ribbonAlt: isLimitedUnique ? 'Limited U' : 'Limited',
      rap: Number.isFinite(item.rap) ? item.rap : null,
      /* Community-assigned, never fetched. 0 until set in values.js. */
      value: VALUES.get(id),
    };
  }

  function text(tag, className, value) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    element.textContent = value;
    return element;
  }

  function appendStat(parent, header, value, valueClass, color) {
    if (value === null || value === undefined) return;
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
      /* limitedu.svg is a wider banner (290x58) than limited.svg (215x58);
       * giving both the same width squashed the "U" wedge off the end. */
      ribbon.width = item.ribbonAlt === 'Limited U' ? 75 : 56;
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
    appendStat(info, 'Value', item.value, 'gen_items_slider_stat_data', '#4db7d6');
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
    if (item.ribbon) {
      const ribbon = document.createElement('img');
      ribbon.className = 'limited_ribbon';
      ribbon.src = item.ribbon;
      ribbon.alt = item.ribbonAlt;
      ribbon.width = item.ribbonAlt === 'Limited U' ? 75 : 56;
      ribbon.height = 15;
      ribbon.loading = 'lazy';
      imageWrap.append(ribbon);
    }
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
    for (const [label, value, color] of [['RAP', item.rap, ''], ['Value', item.value, '#4db7d6']]) {
      if (value === null || value === undefined) continue;
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

  if (searchGrid) {
    if (sliderTrack) loadLatest();
    else runSearch('');
  }
})();
