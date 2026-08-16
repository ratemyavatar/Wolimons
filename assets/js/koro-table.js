/*
 * Wolimons - the owner-list table.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 * ---------------------------------------------------------------------------
 * The item page snapshot's Owner Lists section is a DataTables grid: a "Show N
 * entries" selector, a search box, sortable headers, and Bootstrap pagination
 * underneath. Every class in that markup - .koro-dt, .koro-dt-controls,
 * .koro-dt-length, .koro-dt-search, .sorting / .sorting_asc / .sorting_desc,
 * .koro-dt-footer, .koro-dt-info - is already styled in css/koromons.css,
 * because the whole block was ported when the site's CSS was taken from the
 * captures. What was missing is the behaviour behind it.
 *
 * DataTables itself is jQuery-based and this site loads no jQuery, so the
 * three or four hundred lines of it are not worth pulling in for one table.
 * This file drives the captured markup directly instead: it reads the controls
 * that are already in the HTML and fills in the <tbody>, the info line and the
 * pagination list. Nothing is created that the snapshot does not have.
 *
 * ---------------------------------------------------------------------------
 * HOW A CALLER USES IT
 * ---------------------------------------------------------------------------
 *     const table = WolimonsTable.attach(root, {
 *       columns: [
 *         { cell: row => ..., sort: row => ..., search: row => ... },
 *         ...
 *       ],
 *       sort: { index: 2, direction: 'asc' },
 *     });
 *     table.setRows(rows);
 *
 * `root` is the .koro-dt element. Column N in `columns` lines up with the Nth
 * <th>, and each column says how to draw a cell, what to sort it by and what
 * text the search box should match against. A column with no `sort` is not
 * sortable, which is how the avatar and Trading columns behave in the capture.
 *
 * The empty-state message is read from data-dt-empty on the <tbody>, so it
 * stays in the markup with the rest of the table's wording.
 */
(() => {
  'use strict';

  /* Which header classes DataTables uses, and therefore which ones the CSS in
   * koromons.css already draws arrows for. */
  const SORT_NONE = 'sorting';
  const SORT_ASC = 'sorting_asc';
  const SORT_DESC = 'sorting_desc';

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  };

  /*
   * Compare two sort keys. Numbers sort as numbers, everything else as
   * lower-cased text, and a missing key always sinks to the bottom whichever
   * direction is in force - an owner with no serial should not outrank #1.
   */
  function compare(a, b) {
    const aMissing = a === null || a === undefined || a === '';
    const bMissing = b === null || b === undefined || b === '';
    if (aMissing && bMissing) return 0;
    if (aMissing) return 1;
    if (bMissing) return -1;
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    return String(a).toLowerCase().localeCompare(String(b).toLowerCase());
  }

  function attach(root, options = {}) {
    if (!root) return null;

    const columns = Array.isArray(options.columns) ? options.columns : [];
    const body = root.querySelector('[data-dt-body]');
    const info = root.querySelector('[data-dt-info]');
    const pages = root.querySelector('[data-dt-pages]');
    const lengthBox = root.querySelector('[data-dt-length]');
    const searchBox = root.querySelector('[data-dt-search]');
    const headers = [...root.querySelectorAll('th[data-dt-col]')];
    const empty = body ? (body.dataset.dtEmpty || 'Nothing to show.') : '';

    const state = {
      rows: [],
      page: 1,
      perPage: lengthBox ? Number(lengthBox.value) || 10 : 10,
      search: '',
      /* The capture marks one header sorting_asc on load; honour whichever the
       * caller names, defaulting to no sort at all. */
      sortIndex: Number.isInteger(options.sort?.index) ? options.sort.index : -1,
      sortDirection: options.sort?.direction === 'desc' ? 'desc' : 'asc',
    };

    /* ---------------------------------------------------------------- */

    function visibleRows() {
      const needle = state.search.trim().toLowerCase();
      let rows = state.rows;

      if (needle) {
        rows = rows.filter(row => columns.some(column => {
          if (typeof column.search !== 'function') return false;
          const text = column.search(row);
          return text !== null && text !== undefined
            && String(text).toLowerCase().includes(needle);
        }));
      }

      const column = columns[state.sortIndex];
      if (column && typeof column.sort === 'function') {
        const direction = state.sortDirection === 'desc' ? -1 : 1;
        /* Copy first: sorting the caller's array in place would reorder the
         * data behind their back. */
        rows = [...rows].sort((a, b) => compare(column.sort(a), column.sort(b)) * direction);
      }

      return rows;
    }

    function renderHeaders() {
      headers.forEach(header => {
        const index = Number(header.dataset.dtCol);
        const column = columns[index];
        header.classList.remove(SORT_NONE, SORT_ASC, SORT_DESC);
        if (!column || typeof column.sort !== 'function') return;
        if (index === state.sortIndex) {
          header.classList.add(state.sortDirection === 'desc' ? SORT_DESC : SORT_ASC);
        } else {
          header.classList.add(SORT_NONE);
        }
      });
    }

    function renderPagination(total, pageCount) {
      if (!pages) return;
      pages.replaceChildren();
      if (!total) return;

      const add = (label, page, { active = false, disabled = false } = {}) => {
        const item = el('li', 'paginate_button page-item'
          + (active ? ' active' : '') + (disabled ? ' disabled' : ''));
        const link = el('a', 'page-link', label);
        link.href = '#';
        link.dataset.dtPage = String(page);
        link.addEventListener('click', event => {
          event.preventDefault();
          if (disabled || active) return;
          state.page = page;
          render();
        });
        item.appendChild(link);
        pages.appendChild(item);
      };

      add('Previous', state.page - 1, { disabled: state.page <= 1 });
      /* A long list would otherwise grow an unusable strip of numbers, so
       * only a window around the current page is drawn. */
      const first = Math.max(1, Math.min(state.page - 2, pageCount - 4));
      const last = Math.min(pageCount, Math.max(state.page + 2, 5));
      for (let page = first; page <= last; page += 1) {
        add(String(page), page, { active: page === state.page });
      }
      add('Next', state.page + 1, { disabled: state.page >= pageCount });
    }

    function render() {
      if (!body) return;
      const rows = visibleRows();
      const total = rows.length;
      const pageCount = Math.max(1, Math.ceil(total / state.perPage));
      if (state.page > pageCount) state.page = pageCount;

      const start = (state.page - 1) * state.perPage;
      const slice = rows.slice(start, start + state.perPage);

      body.replaceChildren();

      if (!total) {
        const row = el('tr');
        const cell = el('td', 'text-center py-4', state.search
          ? 'No rows match that search.'
          : empty);
        cell.colSpan = Math.max(1, root.querySelectorAll('thead th').length);
        cell.style.color = '#7a8288';
        row.appendChild(cell);
        body.appendChild(row);
      } else {
        slice.forEach(data => {
          const row = el('tr');
          columns.forEach(column => {
            const cell = el('td', column.className || '');
            const content = typeof column.cell === 'function' ? column.cell(data) : null;
            if (content instanceof Node) cell.appendChild(content);
            else if (content !== null && content !== undefined) cell.textContent = String(content);
            row.appendChild(cell);
          });
          body.appendChild(row);
        });
      }

      if (info) {
        info.textContent = total
          ? `Showing ${start + 1} to ${start + slice.length} of ${total} entries`
          : 'Showing 0 to 0 of 0 entries';
      }

      renderHeaders();
      renderPagination(total, pageCount);
    }

    /* ------------------------------------------------------------ wiring */

    headers.forEach(header => {
      const index = Number(header.dataset.dtCol);
      const column = columns[index];
      if (!column || typeof column.sort !== 'function') return;
      header.addEventListener('click', () => {
        if (state.sortIndex === index) {
          state.sortDirection = state.sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
          state.sortIndex = index;
          state.sortDirection = 'asc';
        }
        state.page = 1;
        render();
      });
    });

    if (lengthBox) {
      lengthBox.addEventListener('change', () => {
        state.perPage = Number(lengthBox.value) || 10;
        state.page = 1;
        render();
      });
    }

    if (searchBox) {
      searchBox.addEventListener('input', () => {
        state.search = searchBox.value || '';
        state.page = 1;
        render();
      });
    }

    render();

    return {
      setRows(rows) {
        state.rows = Array.isArray(rows) ? rows : [];
        state.page = 1;
        render();
      },
      redraw: render,
    };
  }

  window.WolimonsTable = { attach };
})();
