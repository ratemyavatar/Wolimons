(() => {
  'use strict';

  const CONFIG = window.WOLIMONS_CONFIG || {};
  const API_BASE = CONFIG.apiBase || 'https://wanwoo.xyz';
  const SITE_BASE = CONFIG.siteBase || 'https://wanwoo.xyz';
  const PAGE_SIZE = 30;
  const TYPE_NAMES = {
    8: 'Hat',
    18: 'Face',
    19: 'Gear',
    41: 'HairAccessory',
    42: 'FaceAccessory',
    43: 'NeckAccessory',
    44: 'ShoulderAccessory',
    45: 'FrontAccessory',
    46: 'BackAccessory',
    47: 'WaistAccessory',
  };

  const grid = document.getElementById('catalog_mix_container');
  const status = document.getElementById('live_status');
  const searchInput = document.getElementById('filter-textbox-search');
  const sortLabel = document.getElementById('sort-type-dropdown-text');
  const topPagination = document.getElementById('catpg_pagination_control_top');
  const bottomPagination = document.getElementById('catpg_pagination_control_bottom');
  const typeButtons = [...document.querySelectorAll('[data-filter-group="type"]')];
  const rangeInputs = ['filter-value-min', 'filter-value-max', 'filter-rap-min', 'filter-rap-max']
    .map(id => document.getElementById(id));

  if (!grid) return;

  const state = {
    page: 1,
    total: 0,
    keyword: '',
    sort: 'newest',
    assetType: null,
    items: [],
    request: 0,
  };
  const rapCache = new Map();

  const formatNumber = value => Number(value).toLocaleString('en-US');
  const slugify = value => String(value)
    .replace(/'/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unnamed';

  async function fetchJson(url, options) {
    const response = await fetch(url, { mode: 'cors', ...options });
    if (!response.ok) throw new Error(`Wanwood API returned ${response.status}`);
    const body = await response.text();
    if (!body.trim()) throw new Error('Wanwood API returned an empty response');
    return JSON.parse(body);
  }

  function apiSortType() {
    if (state.sort === 'price_ascending') return '4';
    if (state.sort === 'price_descending') return '5';
    return '3';
  }

  async function searchCatalog() {
    const query = new URLSearchParams({
      category: 'Collectibles',
      subcategory: state.assetType ? TYPE_NAMES[state.assetType] : 'Collectibles',
      sortType: apiSortType(),
      limit: String(PAGE_SIZE),
      cursor: String((state.page - 1) * PAGE_SIZE),
    });
    if (state.keyword) query.set('keyword', state.keyword);

    try {
      const result = await fetchJson(`${API_BASE}/apisite/catalog/v1/search/items?${query}`);
      return {
        ids: (Array.isArray(result.data) ? result.data : [])
          .map(item => Number(item.id))
          .filter(Number.isSafeInteger),
        total: Number(result._total ?? result.total ?? 0),
      };
    } catch (canonicalError) {
      const fallbackQuery = new URLSearchParams({
        keyword: state.keyword,
        limit: String(PAGE_SIZE),
        cursor: String((state.page - 1) * PAGE_SIZE),
      });
      const result = await fetchJson(`${API_BASE}/apisite/catalog/v1/search?${fallbackQuery}`);
      const rows = Array.isArray(result) ? result : (result.data || result.items || []);
      const ids = rows.map(item => Number(item.id ?? item.assetId)).filter(Number.isSafeInteger);
      if (!ids.length) throw canonicalError;
      return { ids, total: Number(result.total ?? result._total ?? ids.length) };
    }
  }

  async function fetchDetails(ids) {
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

  function fetchRap(id) {
    if (!rapCache.has(id)) {
      rapCache.set(id, fetchJson(`${API_BASE}/apisite/economy/v1/assets/${id}/resale-data`)
        .then(data => Number.isFinite(Number(data.recentAveragePrice))
          ? Number(data.recentAveragePrice)
          : null)
        .catch(() => null));
    }
    return rapCache.get(id);
  }

  function normalizeItem(item, rap) {
    const id = Number(item.id ?? item.assetId);
    const rawPrice = item.lowestPrice ?? item.price ?? item.priceRobux;
    const price = rawPrice !== null && rawPrice !== undefined && Number.isFinite(Number(rawPrice))
      ? Number(rawPrice)
      : null;
    let available = item.unitsAvailableForConsumption;
    if (available === null || available === undefined) {
      const stock = Number(item.serialCount);
      const sold = Number(item.saleCount);
      available = Number.isFinite(stock) && Number.isFinite(sold) && stock > 0
        ? Math.max(0, stock - sold)
        : null;
    }
    return {
      id,
      name: item.name.trim(),
      assetType: Number(item.assetType),
      price,
      rap,
      available: available !== null && Number.isFinite(Number(available)) ? Number(available) : null,
    };
  }

  async function loadCatalog() {
    const request = ++state.request;
    grid.replaceChildren();
    status.textContent = '';
    topPagination.replaceChildren();
    bottomPagination.replaceChildren();

    try {
      const search = await searchCatalog();
      const details = await fetchDetails(search.ids);
      const byId = new Map(details.map(item => [Number(item.id ?? item.assetId), item]));
      const ordered = search.ids.map(id => byId.get(id)).filter(item => {
        const id = Number(item?.id ?? item?.assetId);
        return item && Number.isSafeInteger(id) && typeof item.name === 'string' && item.name.trim();
      });
      const raps = await Promise.all(ordered.map(item => fetchRap(Number(item.id ?? item.assetId))));
      if (request !== state.request) return;

      state.total = Number.isFinite(search.total) ? search.total : ordered.length;
      state.items = ordered.map((item, index) => normalizeItem(item, raps[index]));
      render();
    } catch (error) {
      if (request !== state.request) return;
      console.error('Could not load the Wanwood catalog:', error);
      const message = document.createElement('div');
      message.className = 'text-center text-muted py-5 w-100';
      message.textContent = 'The Wanwood catalog could not be loaded.';
      grid.replaceChildren(message);
    }
  }

  function rangeValue(id) {
    const value = document.getElementById(id)?.value.replace(/,/g, '').trim();
    if (!value) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function visibleItems() {
    const priceMin = rangeValue('filter-value-min');
    const priceMax = rangeValue('filter-value-max');
    const rapMin = rangeValue('filter-rap-min');
    const rapMax = rangeValue('filter-rap-max');
    const items = state.items.filter(item => {
      if (state.assetType && item.assetType !== state.assetType) return false;
      if (priceMin !== null && (item.price === null || item.price < priceMin)) return false;
      if (priceMax !== null && (item.price === null || item.price > priceMax)) return false;
      if (rapMin !== null && (item.rap === null || item.rap < rapMin)) return false;
      if (rapMax !== null && (item.rap === null || item.rap > rapMax)) return false;
      return true;
    });

    const comparators = {
      rap_descending: (a, b) => (b.rap ?? -Infinity) - (a.rap ?? -Infinity),
      rap_ascending: (a, b) => (a.rap ?? Infinity) - (b.rap ?? Infinity),
      name_ascending: (a, b) => a.name.localeCompare(b.name),
      name_descending: (a, b) => b.name.localeCompare(a.name),
    };
    if (comparators[state.sort]) items.sort(comparators[state.sort]);
    return items;
  }

  function text(tag, className, value) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = value;
    return node;
  }

  function appendStat(parent, label, value, dataCell) {
    if (value === null) return;
    const row = document.createElement('div');
    row.className = 'd-flex justify-content-between';
    const labelWrap = document.createElement('div');
    labelWrap.append(text('small', 'text-muted', label));
    const amount = text('div', 'text-light text-truncate', formatNumber(value));
    if (dataCell) amount.dataset.cell = dataCell;
    row.append(labelWrap, amount);
    parent.append(row);
  }

  function createCard(item) {
    const card = document.createElement('div');
    card.className = 'shadow_md_35 shift_up_md pb-2 mb-3 mix_item';
    card.dataset.ref = 'item';
    card.dataset.itemKey = String(item.id);
    card.style.backgroundColor = '#30363c';

    const link = document.createElement('a');
    link.href = `${SITE_BASE}/catalog/${item.id}/${slugify(item.name)}`;
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
    image.src = `${API_BASE}/asset-thumbnail/image?assetId=${item.id}&width=420&height=420&format=png`;
    image.width = 100;
    image.height = 100;
    image.alt = `${item.name} thumbnail`;
    image.loading = 'lazy';
    imageWrap.append(image);

    const stats = document.createElement('div');
    stats.className = 'px-2 pt-1';
    appendStat(stats, 'Price', item.price, 'price');
    appendStat(stats, 'RAP', item.rap, 'rap');
    appendStat(stats, 'Available', item.available, 'available');
    link.append(headingWrap, imageWrap, stats);
    card.append(link);
    return card;
  }

  function renderPagination(container) {
    const totalPages = Math.max(1, Math.ceil(state.total / PAGE_SIZE));
    const wrapper = document.createElement('div');
    wrapper.className = 'simple-pagination dark-theme';
    const list = document.createElement('ul');

    const addLink = (label, page, disabled = false, current = false) => {
      const item = document.createElement('li');
      if (current) {
        item.append(text('span', 'current', label));
      } else {
        const link = text('a', `page-link-koro${disabled ? ' disabled' : ''}`, label);
        link.href = '#';
        link.dataset.page = String(page);
        if (!disabled) link.addEventListener('click', event => {
          event.preventDefault();
          state.page = page;
          loadCatalog();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        });
        item.append(link);
      }
      list.append(item);
    };

    addLink('Prev', state.page - 1, state.page === 1);
    const candidates = [...new Set([1, state.page - 1, state.page, state.page + 1, totalPages])]
      .filter(page => page >= 1 && page <= totalPages)
      .sort((a, b) => a - b);
    let prior = 0;
    for (const page of candidates) {
      if (prior && page - prior > 1) {
        const item = document.createElement('li');
        item.append(text('span', 'ellipse', '…'));
        list.append(item);
      }
      addLink(String(page), page, false, page === state.page);
      prior = page;
    }
    addLink('Next', state.page + 1, state.page === totalPages);
    wrapper.append(list);
    container.append(wrapper);
  }

  function render() {
    const items = visibleItems();
    grid.replaceChildren(...items.map(createCard));
    status.textContent = `LIVE · ${items.length}/${state.total}`;
    renderPagination(topPagination);
    renderPagination(bottomPagination);
  }

  let searchTimer;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.keyword = searchInput.value.trim();
      state.page = 1;
      loadCatalog();
    }, 300);
  });

  document.querySelectorAll('[data-dropdown="sort_type"]').forEach(option => {
    option.addEventListener('click', event => {
      event.preventDefault();
      state.sort = option.dataset.field;
      state.page = 1;
      sortLabel.textContent = option.textContent;
      option.closest('.dropdown-menu')?.classList.remove('show');
      loadCatalog();
    });
  });

  const sortButton = sortLabel.closest('button');
  sortButton?.addEventListener('click', event => {
    event.preventDefault();
    sortButton.nextElementSibling?.classList.toggle('show');
  });

  typeButtons.forEach(button => {
    button.addEventListener('click', () => {
      const type = Number(button.dataset.filterValue);
      const isSelected = state.assetType === type;
      state.assetType = isSelected ? null : type;
      state.page = 1;
      typeButtons.forEach(candidate => {
        const active = Number(candidate.dataset.filterValue) === state.assetType;
        candidate.classList.toggle('active', active);
        candidate.setAttribute('aria-pressed', String(active));
      });
      loadCatalog();
    });
  });

  rangeInputs.forEach(input => {
    input?.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(render, 200);
    });
  });

  document.querySelectorAll('.catalog_controls [data-toggle="collapse"]').forEach(control => {
    control.addEventListener('click', () => {
      const target = document.querySelector(control.dataset.target);
      if (!target) return;
      const open = target.classList.toggle('show');
      control.setAttribute('aria-expanded', String(open));
    });
  });

  loadCatalog();
})();
