(() => {
  'use strict';

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
  /* Demand / Trend / Categories - multi-select, applied in the browser. */
  const TAG_GROUPS = ['demand', 'trend', 'category'];
  const tagButtons = TAG_GROUPS.flatMap(group =>
    [...document.querySelectorAll(`[data-filter-group="${group}"]`)]);
  const rangeInputs = ['filter-value-min', 'filter-value-max', 'filter-rap-min', 'filter-rap-max']
    .map(id => document.getElementById(id));

  if (!grid) return;

  const state = {
    page: 1,
    total: 0,
    keyword: '',
    sort: 'newest',
    assetType: null,
    /* Sets of the selected data-filter-value strings, one per group. */
    filters: { demand: new Set(), trend: new Set(), category: new Set() },
    items: [],
    request: 0,
  };

  const formatNumber = value => Number(value).toLocaleString('en-US');
  const slugify = value => String(value)
    .replace(/'/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unnamed';

  const API = window.WanwoodAPI;

  /*
   * values.js, read defensively.
   *
   * A browser that has an older copy of values.js cached still exposes
   * WolimonsValues, but without demand/trend/categories on it - and a missing
   * accessor used to take the whole catalog down with "VALUES.demand is not a
   * function". Reading through this shim means a stale table costs the filters
   * their data and nothing else: the grid still renders.
   */
  const VALUES = (() => {
    const table = window.WolimonsValues || {};
    const call = (name, id, fallback) => (typeof table[name] === 'function'
      ? table[name](id)
      : fallback);
    return {
      get: id => Number(call('get', id, 0)) || 0,
      demand: id => call('demand', id, null),
      trend: id => call('trend', id, null),
      categories: id => {
        const list = call('categories', id, []);
        return Array.isArray(list) ? list : [];
      },
    };
  })();

  /*
   * The catalog only ever asks Wanwood for "newest". Value is ours, not
   * Wanwood's, and RAP/name are cheap to order client-side, so every other
   * sort is applied locally in visibleItems().
   */
  function apiSortType() {
    return '3';
  }

  function searchCatalog() {
    return API.searchItems({
      category: 'Collectibles',
      subcategory: state.assetType ? TYPE_NAMES[state.assetType] : 'Collectibles',
      sortType: apiSortType(),
      keyword: state.keyword,
      limit: PAGE_SIZE,
      cursor: (state.page - 1) * PAGE_SIZE,
    });
  }

  function normalizeItem(item) {
    let available = item.unitsAvailableForConsumption;
    if (available === null || available === undefined) {
      const stock = Number(item.serialCount);
      const sold = Number(item.saleCount);
      available = Number.isFinite(stock) && Number.isFinite(sold) && stock > 0
        ? Math.max(0, stock - sold)
        : null;
    }
    const restrictions = Array.isArray(item.itemRestrictions) ? item.itemRestrictions : [];
    return {
      id: item.id,
      name: item.name.trim(),
      assetType: Number(item.assetType),
      /* Value, demand, trend and categories are community-assigned, never
       * fetched - Wanwood reports none of them. Unset reads 0 / null / []. */
      value: VALUES.get(item.id),
      demand: VALUES.demand(item.id),
      trend: VALUES.trend(item.id),
      categories: VALUES.categories(item.id),
      rap: item.rap,
      thumbnail: item.thumbnail,
      limitedUnique: restrictions.includes('LimitedUnique'),
      limited: restrictions.includes('Limited') || restrictions.includes('LimitedUnique'),
      available: available !== null && Number.isFinite(Number(available)) ? Number(available) : null,
    };
  }

  async function loadCatalog() {
    const request = ++state.request;
    grid.replaceChildren();
    status.textContent = '';
    topPagination.replaceChildren();
    bottomPagination.replaceChildren();

    status.textContent = 'Loading the Wanwood catalog…';

    try {
      const search = await searchCatalog();
      if (request !== state.request) return;

      if (!search.ids.length) {
        state.total = 0;
        state.items = [];
        render();
        return;
      }

      const details = await API.getItemDetails(search.ids, { includePrice: false });
      if (request !== state.request) return;

      const byId = new Map(details.map(item => [item.id, item]));
      const ordered = search.ids
        .map(id => byId.get(id))
        .filter(item => item && item.name);

      state.total = Number.isFinite(search.total) ? search.total : ordered.length;
      state.items = ordered.map(normalizeItem);
      render();
    } catch (error) {
      if (request !== state.request) return;
      console.error('Could not load the Wanwood catalog:', error);
      status.textContent = '';
      const message = document.createElement('div');
      message.className = 'text-center text-muted py-5 w-100';
      message.textContent = `The Wanwood catalog could not be loaded. (${error.message})`;
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
    const valueMin = rangeValue('filter-value-min');
    const valueMax = rangeValue('filter-value-max');
    const rapMin = rangeValue('filter-rap-min');
    const rapMax = rangeValue('filter-rap-max');
    const { demand, trend, category } = state.filters;
    const items = state.items.filter(item => {
      if (state.assetType && item.assetType !== state.assetType) return false;
      /* "None" is the Unassigned button: it matches items left unset. */
      if (demand.size && !demand.has(item.demand ?? 'None')) return false;
      if (trend.size && !trend.has(item.trend ?? 'None')) return false;
      /* Categories are additive - an item matching any selected one shows. */
      if (category.size && !item.categories.some(name => category.has(name))) return false;
      if (valueMin !== null && item.value < valueMin) return false;
      if (valueMax !== null && item.value > valueMax) return false;
      if (rapMin !== null && (item.rap === null || item.rap < rapMin)) return false;
      if (rapMax !== null && (item.rap === null || item.rap > rapMax)) return false;
      return true;
    });

    const comparators = {
      value_descending: (a, b) => b.value - a.value,
      value_ascending: (a, b) => a.value - b.value,
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
    if (value === null || value === undefined) return;
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
    /* Cards open our own item page, not Wanwood's catalog. The slug is
     * cosmetic - /item/ reads the id out of the query string. */
    link.href = `/item/?id=${item.id}&name=${slugify(item.name)}`;
    const headingWrap = document.createElement('div');
    const heading = document.createElement('h6');
    heading.className = 'item_card_name px-2 text-light my-1 text-truncate';
    const name = text('div', 'text-truncate', item.name);
    name.title = item.name;
    heading.append(name);
    headingWrap.append(heading);

    const imageWrap = document.createElement('div');
    imageWrap.className = 'position-relative std_item_card_img_bkgnd_gradient text-center border-top border-bottom border-dark';
    if (item.limited) {
      /* limited.svg / limitedu.svg are wide banners (215x58 and 290x58), so
       * they need the .limited_ribbon box, not the square .system_item_tag_icon
       * one - squeezing them into 18x18 is what made them unreadable. */
      const ribbon = document.createElement('img');
      ribbon.className = 'limited_ribbon';
      ribbon.src = item.limitedUnique ? '/img/limitedu.svg' : '/img/limited.svg';
      ribbon.alt = item.limitedUnique ? 'Limited U' : 'Limited';
      ribbon.width = item.limitedUnique ? 75 : 56;
      ribbon.height = 15;
      ribbon.loading = 'lazy';
      imageWrap.append(ribbon);
    }
    const image = document.createElement('img');
    image.className = 'd-block-inline my-1';
    image.src = item.thumbnail || API.thumbnailUrl(item.id);
    image.width = 100;
    image.height = 100;
    image.alt = `${item.name} thumbnail`;
    image.loading = 'lazy';
    imageWrap.append(image);

    const stats = document.createElement('div');
    stats.className = 'px-2 pt-1';
    appendStat(stats, 'Value', item.value, 'value');
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

  /*
   * Demand / Trend / Categories toggle on and off freely and filter what has
   * already been fetched, so there is no need to go back to Wanwood.
   */
  tagButtons.forEach(button => {
    button.addEventListener('click', () => {
      const group = button.dataset.filterGroup;
      const value = button.dataset.filterValue;
      const selected = state.filters[group];
      if (!selected) return;
      const active = !selected.has(value);
      if (active) selected.add(value);
      else selected.delete(value);
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
      render();
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
