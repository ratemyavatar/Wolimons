/*
 * Wolimons limited item deals (/deals).
 *
 * ---------------------------------------------------------------------------
 * WHAT A DEAL IS HERE
 * ---------------------------------------------------------------------------
 * A copy currently listed for sale below what the item is worth. That is the
 * one place on this site where a price legitimately appears: a deal is by
 * definition the gap between an asking price and a worth, so both numbers are
 * on the card and each is labelled as what it is. Nothing here treats the
 * price as the item's value - the "Price is not value" rule the rest of the
 * site follows is precisely why this page has to show them side by side.
 *
 * Two things can play the part of "worth", and the reader chooses:
 *
 *   RAP    what copies have actually been selling for lately. Objective, but
 *          gameable - a projected item has a RAP that means nothing, which is
 *          why projections are hidden by default.
 *   Value  the community's hand-set figure from values.js. Honest, but only
 *          exists for items somebody has valued; unvalued items simply cannot
 *          be scored this way and drop out of the list rather than being
 *          scored against 0 and appearing to be 100% off.
 *
 * ---------------------------------------------------------------------------
 * HOW IT IS BUILT
 * ---------------------------------------------------------------------------
 *   listAllCollectibles()   every collectible (one or two requests)
 *   getItemDetails()        names, thumbnails, RAP, restriction flags
 *   fetchLowestPrices()     the cheapest live listing for each, one call each
 *
 * The scan is bounded by the size of the catalog, which is a few dozen items,
 * and the result is cached briefly so paging back does not rescan. Items with
 * nothing listed are not deals and are dropped.
 */
(() => {
  'use strict';

  const API = window.WanwoodAPI;
  const VALUES = window.WolimonsValues;
  /* Per-browser display choices from /preferences. Optional: without the
   * script, deal links open in this tab. */
  const PREFS = window.WolimonsPrefs;

  /* A finished scan is good for this long. Listings do move, so this is much
   * shorter than the roster's - long enough to survive a page flick, short
   * enough that a sold-out listing does not linger. */
  const CACHE_KEY = 'wolimons_deals_v1';
  const CACHE_TTL_MS = 3 * 60 * 1000;

  const grid = document.getElementById('deals_mix_container');
  const statusBox = document.getElementById('deals_status');
  const statusDot = document.getElementById('status_indicator');
  const statusText = document.getElementById('deal_scanning_status_message');
  const sortLabel = document.getElementById('sort-type-dropdown-text');
  const sortItems = [...document.querySelectorAll('[data-dropdown="sort_type"]')];
  const thresholdLabel = document.getElementById('filter-category-dropdown-text');
  const thresholdItems = [...document.querySelectorAll('[data-dropdown="filter_category"]')];
  const projectionButtons = [...document.querySelectorAll('[data-projections]')];
  const basisButtons = [...document.querySelectorAll('[data-basis]')];

  /* Every listed collectible found by the scan, deal or not. */
  let listings = [];
  let sort = 'best_deal';
  let threshold = 10;
  let showProjections = false;
  /* 'rap' or 'value' - which figure the discount is measured against. */
  let basis = 'rap';

  const formatNumber = number => Number(number || 0).toLocaleString('en-US');

  const text = (tag, className, value) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined) node.textContent = value;
    return node;
  };

  const slugify = value => String(value || 'unnamed')
    .replace(/'/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unnamed';

  /* The little coloured dot and its caption, which is the whole of the
   * scanner's status display. */
  function setScanState(colour, message) {
    if (statusDot) statusDot.style.backgroundColor = colour;
    if (statusText) statusText.textContent = message;
  }

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
  /* Scoring                                                             */
  /* ------------------------------------------------------------------ */

  /*
   * The discount, as a whole percentage, or null when it cannot be worked
   * out. Null is the important case: an item with no RAP, or no value when
   * scoring by value, has nothing to be a discount *from*, and guessing
   * would put fictional bargains at the top of the page.
   */
  function discountOf(listing) {
    const worth = basis === 'value' ? listing.value : listing.rap;
    if (!worth || worth <= 0) return null;
    if (!listing.price || listing.price <= 0) return null;
    if (listing.price >= worth) return null;
    return Math.round(((worth - listing.price) / worth) * 100);
  }

  /*
   * The colour band, which is the snapshot's own scale. These class names and
   * the colours behind them already exist in koromons.css, so the bands are
   * simply chosen here rather than styled here.
   */
  function band(discount) {
    if (discount >= 50) return 'legendary';
    if (discount >= 40) return 'epic';
    if (discount >= 30) return 'rare';
    if (discount >= 20) return 'uncommon';
    return 'poor';
  }

  /* ------------------------------------------------------------------ */
  /* Cards                                                               */
  /* ------------------------------------------------------------------ */

  /*
   * The deal card is its own shape - a coloured title bar over a gradient,
   * with the image floated beside the stat rows - and every class it uses is
   * already in koromons.css from the snapshot import. Nothing new is styled.
   */
  function dealCard(listing) {
    const discount = listing.discount;
    const tone = band(discount);

    const card = text('div', 'px-0 py-0 mt-0 bg-primary shadow_md_30 shift_up_sm rounded mix_item');
    card.dataset.ref = 'item';
    card.dataset.itemKey = String(listing.id);

    const link = document.createElement('a');
    link.href = `/item/?id=${listing.id}&name=${slugify(listing.name)}`;
    /* A deal is worth chasing while the rest of the list is still on screen,
     * so /preferences offers to open these in a new tab. */
    if (PREFS && PREFS.get('dealsInNewTab')) {
      link.target = '_blank';
      link.rel = 'noopener';
    }

    const gradient = text('div', `pt-0 px-0 m-0 rounded-bottom deal_bg_gradient_${tone}`);
    /* The snapshot put a tooltip here; a plain title attribute says the same
     * thing without needing Bootstrap's JS, which this site does not load. */
    gradient.title = `${listing.name} - ${discount}% below `
      + `${basis === 'value' ? 'value' : 'RAP'}`;

    const bar = text('div', `deal_bg_color_${tone} rounded-top`);
    const heading = text('div', 'deal-title text-light px-1 text-truncate border-0', listing.name);
    heading.title = listing.name;
    bar.appendChild(heading);
    gradient.appendChild(bar);

    const imageWrap = text('div', 'float-left mt-1 pb-1');
    /* Rare and Projected use the same square sprites as every other card. */
    const tags = text('div', 'system_item_tag_container');
    if (listing.rare) {
      const icon = text('div', 'system_item_tag_icon rare_tag_icon');
      icon.setAttribute('title', 'Rare');
      tags.appendChild(icon);
    }
    if (listing.projected) {
      const icon = text('div', 'system_item_tag_icon projected_tag_icon');
      icon.setAttribute('title', 'Projected');
      tags.appendChild(icon);
    }
    imageWrap.appendChild(tags);

    const image = document.createElement('img');
    image.className = 'deal-image d-block rounded';
    image.src = listing.thumbnail || (API ? API.thumbnailUrl(listing.id) : '');
    image.alt = `${listing.name} thumbnail`;
    image.loading = 'lazy';
    imageWrap.appendChild(image);
    gradient.appendChild(imageWrap);

    const stats = text('div', 'mt-1 rounded-bottom');
    const statRow = (label, value) => {
      const row = text('div', 'd-flex justify-content-between');
      row.appendChild(text('div', 'stat-header text-muted', label));
      row.appendChild(text('div', 'stat-data text-light text-truncate', value));
      stats.appendChild(row);
    };

    /* Price first, because it is the thing being offered, then what it is
     * being judged against, then the gap. Both figures are always shown, so
     * the price is never mistaken for the item's worth. */
    statRow('Price', formatNumber(listing.price));
    statRow('RAP', listing.rap ? formatNumber(listing.rap) : '\u2014');
    statRow('Value', listing.value ? formatNumber(listing.value) : 'Unvalued');
    statRow('Deal', `${discount}% off ${basis === 'value' ? 'value' : 'RAP'}`);

    gradient.appendChild(stats);
    link.appendChild(gradient);
    card.appendChild(link);
    return card;
  }

  /* ------------------------------------------------------------------ */
  /* Rendering                                                           */
  /* ------------------------------------------------------------------ */

  function visibleDeals() {
    const deals = [];
    listings.forEach(listing => {
      if (!showProjections && listing.projected) return;
      const discount = discountOf(listing);
      if (discount === null || discount < threshold) return;
      deals.push({ ...listing, discount });
    });

    const comparators = {
      best_deal: (a, b) => b.discount - a.discount || a.price - b.price,
      lowest_price: (a, b) => a.price - b.price,
      highest_price: (a, b) => b.price - a.price,
      value_descending: (a, b) => (b.value || 0) - (a.value || 0),
      value_ascending: (a, b) => (a.value || 0) - (b.value || 0),
      rap_descending: (a, b) => (b.rap || 0) - (a.rap || 0),
      rap_ascending: (a, b) => (a.rap || 0) - (b.rap || 0),
    };
    return deals.sort(comparators[sort] || comparators.best_deal);
  }

  function render() {
    if (!grid) return;
    grid.replaceChildren();

    const deals = visibleDeals();

    if (!deals.length) {
      if (!listings.length) {
        setStatus('Nothing is listed for sale on Wanwood right now, '
          + 'so there are no deals to show.');
      } else if (basis === 'value') {
        /* Almost always the real reason when scoring by value: the table is
         * empty, so nothing has a worth to be discounted from. Say that
         * rather than letting the page look broken. */
        setStatus('No listing is below its value. Value is set by hand, so items that '
          + 'have not been valued yet cannot be scored this way \u2014 switch Deal '
          + 'Calculation to RAP to see everything currently listed below its RAP.');
      } else {
        setStatus(`Nothing is currently listed at ${threshold}% or more below its RAP.`);
      }
      return;
    }

    setStatus('');
    deals.forEach(listing => grid.appendChild(dealCard(listing)));
  }

  /* ------------------------------------------------------------------ */
  /* Controls                                                            */
  /* ------------------------------------------------------------------ */

  /* The two radio pairs are Bootstrap button groups, and Bootstrap's JS is
   * not loaded, so the active class is moved by hand the same way the rest of
   * the site does it. */
  function selectOne(buttons, chosen) {
    buttons.forEach(button => {
      const on = button === chosen;
      button.classList.toggle('active', on);
      const input = button.querySelector('input');
      if (input) input.checked = on;
    });
  }

  function initControls() {
    sortItems.forEach(entry => {
      entry.addEventListener('click', event => {
        event.preventDefault();
        sort = entry.dataset.field;
        if (sortLabel) sortLabel.textContent = entry.textContent.trim();
        render();
      });
    });

    thresholdItems.forEach(entry => {
      entry.addEventListener('click', event => {
        event.preventDefault();
        threshold = Number(entry.dataset.threshold) || 1;
        if (thresholdLabel) thresholdLabel.textContent = entry.textContent.trim();
        render();
      });
    });

    projectionButtons.forEach(button => {
      button.addEventListener('click', () => {
        showProjections = button.dataset.projections === 'show';
        selectOne(projectionButtons, button);
        render();
      });
    });

    basisButtons.forEach(button => {
      button.addEventListener('click', () => {
        basis = button.dataset.basis === 'value' ? 'value' : 'rap';
        selectOne(basisButtons, button);
        render();
      });
    });
  }

  /* ------------------------------------------------------------------ */
  /* Scanning                                                            */
  /* ------------------------------------------------------------------ */

  function readCache() {
    try {
      const raw = window.sessionStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const saved = JSON.parse(raw);
      if (!saved || !Array.isArray(saved.listings) || !saved.at) return null;
      if (Date.now() - saved.at > CACHE_TTL_MS) return null;
      return saved;
    } catch (error) {
      return null;
    }
  }

  function writeCache(rows) {
    try {
      window.sessionStorage.setItem(CACHE_KEY,
        JSON.stringify({ at: Date.now(), listings: rows }));
    } catch (error) {
      /* Private mode or a full quota - the next visit just rescans. */
    }
  }

  /* Values are local, so they are re-read at render time rather than baked
   * into the cache; only the fetched half is stored. */
  function withValues(rows) {
    return rows.map(row => {
      const categories = VALUES ? VALUES.categories(row.id) : [];
      return {
        ...row,
        value: VALUES ? VALUES.get(row.id) : 0,
        rare: categories.includes('rare'),
        projected: categories.includes('projected'),
      };
    });
  }

  async function scan() {
    const ids = await API.listAllCollectibles();
    if (!ids.length) return [];

    const details = await API.getItemDetails(ids, { includePrice: false });
    setScanState('#ffcc33', `Checking ${details.length} items for listings\u2026`);

    const prices = await API.fetchLowestPrices(details.map(detail => detail.id));

    return details
      .filter(detail => detail && detail.name && prices.has(detail.id))
      .map(detail => ({
        id: detail.id,
        name: String(detail.name).trim(),
        thumbnail: detail.thumbnail || API.thumbnailUrl(detail.id),
        /* The live asking price. A price, and labelled as one. */
        price: prices.get(detail.id),
        rap: Number.isFinite(detail.rap) ? detail.rap : null,
      }));
  }

  async function load() {
    if (!API) {
      setScanState('#dd3333', 'Offline');
      setStatus('The Wanwood API client failed to load.');
      return;
    }

    setScanState('#ffcc33', 'Scanning for deals\u2026');
    setStatus('Scanning Wanwood for listings\u2026', { spinner: true });

    /* Values decide both the Value column and which items count as projected,
     * so wait for the table before scoring anything. */
    if (VALUES && VALUES.ready && typeof VALUES.ready.then === 'function') {
      try {
        await VALUES.ready;
      } catch (error) {
        /* Scoring by RAP still works with no values at all. */
      }
    }

    const cached = readCache();
    if (cached) {
      listings = withValues(cached.listings);
      setScanState('#22dd22', `Monitoring ${listings.length} listings`);
      render();
      return;
    }

    let rows = [];
    try {
      rows = await scan();
    } catch (error) {
      setScanState('#dd3333', 'Scan failed');
      setStatus('Could not reach Wanwood to scan for deals. Try again shortly.');
      return;
    }

    writeCache(rows);
    listings = withValues(rows);
    setScanState('#22dd22', `Monitoring ${listings.length} listings`);
    render();
  }

  /* An admin setting a value or flagging a projection while this page is open
   * changes the scoring, so redraw - no rescan needed, the listings have not
   * moved. The first, synchronous callback fires before load() has run. */
  let settled = false;
  if (VALUES && typeof VALUES.subscribe === 'function') {
    VALUES.subscribe(() => {
      if (!settled) return;
      const cached = readCache();
      listings = withValues(cached ? cached.listings : listings);
      render();
    });
  }

  /* The new-tab preference only changes an attribute on links that are
   * already drawn, so a redraw is all it takes. */
  if (PREFS && typeof PREFS.subscribe === 'function') {
    let firstPrefsCallback = true;
    PREFS.subscribe(() => {
      if (firstPrefsCallback) {
        firstPrefsCallback = false;
        return;
      }
      if (listings.length) render();
    });
  }

  async function boot() {
    initControls();
    await load();
    settled = true;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
