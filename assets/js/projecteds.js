/*
 * Wolimons projected items (/projecteds).
 *
 * ---------------------------------------------------------------------------
 * WHAT GETS ON THIS PAGE, AND WHAT DOES NOT
 * ---------------------------------------------------------------------------
 * Only items a human has marked as projected, in the admin panel. "Projected"
 * is one of the community categories in values.js, exactly like rare or
 * hoarded, and this page is the list of everything carrying it.
 *
 * It would be easy - and wrong - to guess instead. A page that flagged every
 * item whose RAP sat some distance above its value would look busy and mean
 * nothing: an item can be genuinely worth more than it was last valued at,
 * and a projection can sit quietly at a modest multiple. Calling an item
 * projected is an accusation about somebody's trading, so it is made by a
 * person and recorded, not inferred from arithmetic. An empty page here means
 * nobody has flagged anything yet, and it says so.
 *
 * ---------------------------------------------------------------------------
 * HOW IT IS BUILT
 * ---------------------------------------------------------------------------
 * The category list is local (values.js), so the ids are known immediately;
 * only the names, thumbnails and RAP have to be fetched, in one batch. The
 * cards are assets/js/catalog-card.js - the same card /catalog draws - so
 * this page contributes no card markup of its own.
 */
(() => {
  'use strict';

  const API = window.WanwoodAPI;
  const VALUES = window.WolimonsValues;
  const CARDS = window.WolimonsItemCard;

  const grid = document.getElementById('projecteds_mix_container');
  const statusBox = document.getElementById('projecteds_status');
  const sortLabel = document.getElementById('sort-type-dropdown-text');
  const sortItems = [...document.querySelectorAll('[data-dropdown="sort_type"]')];

  /* Every projected item, already fetched. */
  let items = [];
  let sort = 'rap_descending';

  const text = (tag, className, value) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined) node.textContent = value;
    return node;
  };

  function setStatus(message, { spinner = false } = {}) {
    if (!statusBox) return;
    statusBox.textContent = '';
    if (!message) {
      statusBox.classList.add('d-none');
      return;
    }
    statusBox.classList.remove('d-none');
    const box = text('div', 'text-center py-4 small');
    box.style.color = '#9aa3aa';
    box.textContent = message;
    if (spinner) box.classList.add('lb_loading');
    statusBox.appendChild(box);
  }

  /* ------------------------------------------------------------------ */
  /* Sorting                                                             */
  /* ------------------------------------------------------------------ */

  /*
   * Unvalued items sort as 0 and items with no RAP as nothing at all, which
   * would bunch them at one end and read like a bug. They go to the back of
   * both directions instead, so "Lowest RAP" shows the cheapest item that
   * actually has a RAP rather than a screen of blanks. This is the same rule
   * the catalog sorts by, so the two pages agree.
   */
  function missingLast(a, b, key, direction) {
    const left = a[key];
    const right = b[key];
    const leftMissing = left === null || left === undefined || left === 0;
    const rightMissing = right === null || right === undefined || right === 0;
    if (leftMissing && rightMissing) return a.name.localeCompare(b.name);
    if (leftMissing) return 1;
    if (rightMissing) return -1;
    return direction * (left - right);
  }

  const COMPARATORS = {
    rap_descending: (a, b) => missingLast(a, b, 'rap', -1),
    rap_ascending: (a, b) => missingLast(a, b, 'rap', 1),
    value_descending: (a, b) => missingLast(a, b, 'value', -1),
    value_ascending: (a, b) => missingLast(a, b, 'value', 1),
    name_ascending: (a, b) => a.name.localeCompare(b.name),
    name_descending: (a, b) => b.name.localeCompare(a.name),
  };

  /* ------------------------------------------------------------------ */
  /* Rendering                                                           */
  /* ------------------------------------------------------------------ */

  function render() {
    if (!grid) return;
    grid.replaceChildren();

    if (!items.length) {
      /* The honest empty state. Nothing lands here without a person putting
       * it here, so a site with no flags genuinely has no projected items. */
      setStatus('No items have been marked as projected. '
        + 'An item appears here once it is given the Projected category in the admin panel.');
      return;
    }

    setStatus('');
    const ordered = [...items].sort(COMPARATORS[sort] || COMPARATORS.rap_descending);
    ordered.forEach(item => {
      grid.appendChild(CARDS.itemCard(item, {
        stats: [
          ['Value', item.value, { cell: 'value' }],
          ['RAP', item.rap, { cell: 'rap' }],
        ],
      }));
    });
  }

  function initSort() {
    sortItems.forEach(entry => {
      entry.addEventListener('click', event => {
        event.preventDefault();
        const field = entry.dataset.field;
        if (!COMPARATORS[field]) return;
        sort = field;
        if (sortLabel) sortLabel.textContent = entry.textContent.trim();
        render();
      });
    });
  }

  /* ------------------------------------------------------------------ */
  /* Loading                                                             */
  /* ------------------------------------------------------------------ */

  /* Every asset id carrying the "projected" category, read out of the value
   * table rather than searched for. */
  function projectedIds() {
    if (!VALUES || !VALUES.all) return [];
    return Object.keys(VALUES.all)
      .map(Number)
      .filter(id => Number.isSafeInteger(id) && id > 0)
      .filter(id => VALUES.categories(id).includes('projected'));
  }

  async function load() {
    if (!VALUES || !CARDS) {
      setStatus('The Wolimons value table failed to load.');
      return;
    }

    setStatus('Loading projected items\u2026', { spinner: true });

    /* The categories come from the backend, so wait for the table before
     * deciding the page is empty - otherwise a slow API reads as "nothing is
     * projected". */
    if (VALUES.ready && typeof VALUES.ready.then === 'function') {
      try {
        await VALUES.ready;
      } catch (error) {
        /* Fall through: the fallback table is still worth rendering. */
      }
    }

    const ids = projectedIds();
    if (!ids.length) {
      items = [];
      render();
      return;
    }

    if (!API || !API.getItemDetails) {
      setStatus('The Wanwood API client failed to load.');
      return;
    }

    let details = [];
    try {
      details = await API.getItemDetails(ids, { includePrice: false });
    } catch (error) {
      setStatus('Could not reach Wanwood for these items. Try again shortly.');
      return;
    }

    items = details
      .filter(detail => detail && detail.name)
      .map(detail => {
        const id = Number(detail.id ?? detail.assetId);
        const categories = VALUES.categories(id);
        const restrictions = Array.isArray(detail.itemRestrictions) ? detail.itemRestrictions : [];
        return {
          id,
          name: String(detail.name).trim(),
          thumbnail: detail.thumbnail || API.thumbnailUrl(id),
          /* Ours, never fetched - and its RAP until somebody sets one. */
          value: typeof VALUES.valueOf === 'function'
            ? VALUES.valueOf(id, Number.isFinite(detail.rap) ? detail.rap : null)
            : VALUES.get(id),
          rap: Number.isFinite(detail.rap) ? detail.rap : null,
          rare: categories.includes('rare'),
          /* Always true here - this is the list of them - but the card reads
           * the flag rather than assuming, so the icon logic stays in one
           * place. */
          projected: categories.includes('projected'),
          limitedUnique: restrictions.includes('LimitedUnique'),
          limited: restrictions.includes('Limited') || restrictions.includes('LimitedUnique'),
        };
      });

    render();
  }

  /* An admin flagging or unflagging an item while this page is open should be
   * reflected without a reload. The first, synchronous callback fires before
   * anything has loaded and is skipped - load() waits for the table itself. */
  let settled = false;
  if (VALUES && typeof VALUES.subscribe === 'function') {
    VALUES.subscribe(() => {
      if (!settled) return;
      load();
    });
  }

  async function boot() {
    initSort();
    await load();
    settled = true;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
