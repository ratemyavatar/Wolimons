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
    keyword: '',
    sort: 'newest',
    assetType: null,
    /* Sets of the selected data-filter-value strings, one per group. */
    filters: { demand: new Set(), trend: new Set(), category: new Set() },
    /* Every collectible on Wanwood, fetched once. See loadCatalog(). */
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
   * The whole catalog is fetched once, then sorted, filtered and paginated in
   * the browser.
   *
   * That sounds wasteful and isn't: Wanwood has around 39 collectibles in
   * total, so "everything" is one or two requests. Doing it per-page was the
   * bug behind the sort buttons - a page-at-a-time fetch can only sort the
   * thirty items already on screen, so "Highest Value" reordered the current
   * page instead of finding the highest-valued items in the game. Value and
   * demand aren't Wanwood's fields anyway, so it could never sort by them.
   */
  function searchCatalog() {
    /* Walks the cursor until Wanwood runs out, so nothing is missed if the
     * catalog ever grows past one page. */
    return API.listAllCollectibles();
  }

  function normalizeItem(item, index) {
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
      /* Where Wanwood put it when asked for newest-first. Kept so the Newest
       * sort has something to sort by - there is no date on these rows. */
      order: index,
      /* Value, demand, trend and categories are community-assigned, never
       * fetched - Wanwood reports none of them. Unset reads 0 / null / []. */
      value: VALUES.get(item.id),
      demand: VALUES.demand(item.id),
      trend: VALUES.trend(item.id),
      categories: VALUES.categories(item.id),
      rap: item.rap,
      thumbnail: item.thumbnail,
      /* Community categories, surfaced as the two tag icons on the card. */
      rare: VALUES.categories(item.id).includes('rare'),
      projected: VALUES.categories(item.id).includes('projected'),
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
      const ids = await searchCatalog();
      if (request !== state.request) return;

      if (!ids.length) {
        state.items = [];
        render();
        return;
      }

      const details = await API.getItemDetails(ids, { includePrice: false });
      if (request !== state.request) return;

      const byId = new Map(details.map(item => [item.id, item]));
      const ordered = ids
        .map(id => byId.get(id))
        .filter(item => item && item.name);

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
    const keyword = state.keyword.toLowerCase();
    const items = state.items.filter(item => {
      /* Item type is checked here and only here. It used to be sent to
       * Wanwood as a subcategory *and* re-checked locally, and the two
       * disagreed - Wanwood's subcategory names don't line up with the
       * assetType numbers on the buttons, so picking a type could empty the
       * grid even though matching items existed. */
      if (state.assetType && item.assetType !== state.assetType) return false;
      if (keyword && !item.name.toLowerCase().includes(keyword)) return false;
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

    /*
     * Every sort runs over the whole catalog, not the visible page.
     *
     * Unvalued items sort as 0 and unpriced ones as no-RAP, which would bunch
     * them at one end and look like a bug. They're pushed to the back of both
     * directions instead, so "Lowest Value" shows the cheapest *valued* item
     * rather than thirty blanks.
     */
    const missingLast = (a, b, key, direction) => {
      const left = a[key];
      const right = b[key];
      const leftMissing = left === null || left === undefined || left === 0;
      const rightMissing = right === null || right === undefined || right === 0;
      if (leftMissing && rightMissing) return a.order - b.order;
      if (leftMissing) return 1;
      if (rightMissing) return -1;
      return direction * (left - right);
    };

    const comparators = {
      newest: (a, b) => a.order - b.order,
      value_descending: (a, b) => missingLast(a, b, 'value', -1),
      value_ascending: (a, b) => missingLast(a, b, 'value', 1),
      rap_descending: (a, b) => missingLast(a, b, 'rap', -1),
      rap_ascending: (a, b) => missingLast(a, b, 'rap', 1),
      name_ascending: (a, b) => a.name.localeCompare(b.name),
      name_descending: (a, b) => b.name.localeCompare(a.name),
    };
    const compare = comparators[state.sort] || comparators.newest;
    return items.sort(compare);
  }

  /* The slice of the filtered list that belongs on the current page. */
  function pageItems(items) {
    const start = (state.page - 1) * PAGE_SIZE;
    return items.slice(start, start + PAGE_SIZE);
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

  /*
   * The card itself is assets/js/catalog-card.js, shared with /projecteds so
   * both pages draw the identical thing. This only decides which figures a
   * catalog card carries: Value, RAP and how many are still on sale. Never a
   * price - see the note at the top of that file.
   */
  const CARDS = window.WolimonsItemCard;

  function createCard(item) {
    return CARDS.itemCard(item, {
      stats: [
        ['Value', item.value, { cell: 'value' }],
        ['RAP', item.rap, { cell: 'rap' }],
        ['Available', item.available, { cell: 'available' }],
      ],
    });
  }

  function renderPagination(container, totalPages) {
    /*
     * Clear first. This function appends a widget, and render() runs on every
     * filter click - so without this the Prev/1/2/Next strip stacked up, a
     * fresh copy each time you touched a filter.
     */
    container.replaceChildren();
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
          /* Everything is already in memory, so turning a page is a re-render,
           * not another trip to Wanwood. */
          render();
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
    const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));

    /* A filter that shrinks the list can strand us past the last page. */
    if (state.page > totalPages) state.page = totalPages;

    const visible = pageItems(items);
    if (visible.length) {
      grid.replaceChildren(...visible.map(createCard));
    } else {
      const message = document.createElement('div');
      message.className = 'text-center text-muted py-5 w-100';
      message.textContent = state.items.length
        ? 'No items match these filters.'
        : 'No items found.';
      grid.replaceChildren(message);
    }

    status.textContent = `LIVE · ${items.length}/${state.items.length}`;
    renderPagination(topPagination, totalPages);
    renderPagination(bottomPagination, totalPages);
  }

  /*
   * From here on every control just re-renders. The catalog is already in
   * memory, so searching and sorting are instant and work offline-ish - and,
   * more to the point, they act on all 39 items instead of the visible page.
   */
  let searchTimer;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.keyword = searchInput.value.trim();
      state.page = 1;
      render();
    }, 200);
  });

  document.querySelectorAll('[data-dropdown="sort_type"]').forEach(option => {
    option.addEventListener('click', event => {
      event.preventDefault();
      state.sort = option.dataset.field;
      state.page = 1;
      sortLabel.textContent = option.textContent;
      option.closest('.dropdown-menu')?.classList.remove('show');
      render();
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
      render();
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
      state.page = 1;
      render();
    });
  });

  /* Its own timer - sharing one with the search box meant typing in a range
   * box cancelled a pending search, and vice versa. */
  let rangeTimer;
  rangeInputs.forEach(input => {
    input?.addEventListener('input', () => {
      clearTimeout(rangeTimer);
      rangeTimer = setTimeout(() => {
        state.page = 1;
        render();
      }, 200);
    });
  });

  /*
   * Values arrive from the backend after the grid has already been drawn, so
   * re-read them onto the items we're holding and redraw. Without this the
   * catalog would show every item at value 0 until the next reload, and the
   * Value sort and Valued filter would have nothing to work with.
   */
  if (window.WolimonsValues && typeof window.WolimonsValues.subscribe === 'function') {
    let first = true;
    window.WolimonsValues.subscribe(() => {
      /* subscribe() fires immediately; at that point there is nothing to
       * update and loadCatalog() has not run yet. */
      if (first) {
        first = false;
        return;
      }
      if (!state.items.length) return;
      state.items.forEach(item => {
        item.value = VALUES.get(item.id);
        item.demand = VALUES.demand(item.id);
        item.trend = VALUES.trend(item.id);
        item.categories = VALUES.categories(item.id);
      });
      render();
    });
  }

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
