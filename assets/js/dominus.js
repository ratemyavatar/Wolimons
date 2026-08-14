/*
 * Wolimons item detail page.
 *
 * ---------------------------------------------------------------------------
 * THIS PAGE IS A TEMPLATE
 * ---------------------------------------------------------------------------
 * /dominus/index.html contains no item-specific text at all. Every value comes
 * from here, written into the placeholders marked with data-item-field="...".
 * Which item is shown is decided by the URL:
 *
 *     /dominus/?id=1581            <- the normal form used by every card link
 *     /dominus/1581                <- also works if the host rewrites pretty URLs
 *     /dominus/1581/Cthulhu
 *
 * ---------------------------------------------------------------------------
 * WHERE THE NUMBERS COME FROM
 * ---------------------------------------------------------------------------
 *   api/marketplace/productinfo   name, description, type, creator, for sale
 *   economy/v1/assets/N/resale-data   RAP, total copies, sales, remaining,
 *                                     and the sparse price/volume history
 *   economy/v1/assets/N/resellers     the live sale listings -> best price,
 *                                     seller count, the "Copies For Sale" table
 *   api/v1/items/restrictions         Limited / Limited U flag
 *   thumbnails/v1/assets              the image
 *   values.js                         Value and Demand. Community-set by hand,
 *                                     never fetched.
 *
 * Wanwood has no source for Demand or an acronym, so Demand comes from
 * values.js when a maintainer has set it and stays blank otherwise - it is
 * never faked out of a price field. There is nowhere to get an acronym at all.
 */
(() => {
  'use strict';

  const CONFIG = window.WOLIMONS_CONFIG || {};
  const SITE_BASE = CONFIG.siteBase || 'https://wanwoo.xyz';
  const API = window.WanwoodAPI;
  const VALUES = window.WolimonsValues;

  /* Same table the catalog uses - kept identical so labels never drift. */
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

  const EMPTY = '\u2014';
  const RESELLER_LIMIT = 100;

  const formatNumber = value => Number(value).toLocaleString('en-US');
  const slugify = value => String(value || 'unnamed')
    .replace(/'/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unnamed';

  const fields = name => [...document.querySelectorAll(`[data-item-field="${name}"]`)];

  /* Write plain text into every placeholder with this name. */
  function setText(name, value) {
    const text = (value === null || value === undefined || value === '') ? EMPTY : String(value);
    fields(name).forEach(element => { element.textContent = text; });
  }

  /* Same, but formats numbers and falls back to the dash when unknown. */
  function setNumber(name, value) {
    setText(name, Number.isFinite(value) ? formatNumber(value) : null);
  }

  function show(name, visible) {
    fields(name).forEach(element => { element.hidden = !visible; });
  }

  const toNumber = value => {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  };

  /* ------------------------------------------------------------------ */
  /* Which item?                                                         */
  /* ------------------------------------------------------------------ */

  /*
   * Accepts /dominus/?id=N, /dominus/N and /dominus/N/any-slug. The query
   * string is the form the cards link to, because the site is served as
   * plain static files and pretty paths would need a rewrite rule.
   */
  function readAssetId() {
    const params = new URLSearchParams(window.location.search);
    const fromQuery = toNumber(params.get('id') || params.get('assetId'));
    if (fromQuery && fromQuery > 0) return fromQuery;

    const segments = window.location.pathname.split('/').filter(Boolean);
    const index = segments.indexOf('dominus');
    const fromPath = index === -1 ? null : toNumber(segments[index + 1]);
    return fromPath && fromPath > 0 ? fromPath : null;
  }

  /* ------------------------------------------------------------------ */
  /* Tabs                                                                */
  /* ------------------------------------------------------------------ */

  /*
   * The snapshot drove its tabs with Bootstrap's JS bundle, which this site
   * does not ship. Twelve lines replace it: show the pane the clicked link
   * points at, hide its siblings.
   */
  function initTabs() {
    document.querySelectorAll('[data-tabs]').forEach(group => {
      const links = [...group.querySelectorAll('.nav-link[data-toggle="tab"]')];
      const panes = [...group.querySelectorAll('.tab-content > .tab-pane')];
      links.forEach(link => {
        link.addEventListener('click', event => {
          event.preventDefault();
          const target = group.querySelector(link.getAttribute('href'));
          if (!target) return;
          links.forEach(other => other.classList.toggle('active', other === link));
          panes.forEach(pane => pane.classList.toggle('active', pane === target));
        });
      });
    });
  }

  /* ------------------------------------------------------------------ */
  /* Copy-to-clipboard buttons                                           */
  /* ------------------------------------------------------------------ */

  function initCopyButtons() {
    document.querySelectorAll('.copy-id-button').forEach(button => {
      button.addEventListener('click', async () => {
        const value = button.dataset.copyValue;
        if (!value) return;
        try {
          await navigator.clipboard.writeText(value);
        } catch (error) {
          return; /* Clipboard needs a secure context - nothing to do. */
        }
        const label = button.querySelector('.copy-id-value');
        if (!label) return;
        const original = label.textContent;
        label.textContent = 'Copied';
        setTimeout(() => { label.textContent = original; }, 1200);
      });
    });
  }

  function setCopyValue(name, value) {
    fields(name).forEach(button => { button.dataset.copyValue = value; });
  }

  /* ------------------------------------------------------------------ */
  /* Fetching                                                            */
  /* ------------------------------------------------------------------ */

  /* Every request is optional: one dead endpoint must not blank the page. */
  const optional = promise => promise.catch(() => null);

  async function loadItem(id) {
    const [detail, info, resale, resellers, thumbs] = await Promise.all([
      /* Name, type and the Limited flags, with the module's own fallbacks. */
      optional(API.getItemDetails([id], { includePrice: false, includeRap: false })
        .then(rows => rows[0] || null)),
      /* Description and creator. getItemDetails only carries these when it
       * takes the productinfo fallback path, and this page always wants
       * them, so ask for them outright. */
      optional(API.fetchJson(`${API.API_BASE}/apisite/api/marketplace/productinfo?assetId=${id}`)),
      optional(API.fetchJson(`${API.API_BASE}/apisite/economy/v1/assets/${id}/resale-data`)),
      optional(API.fetchJson(
        `${API.API_BASE}/apisite/economy/v1/assets/${id}/resellers?limit=${RESELLER_LIMIT}`)),
      optional(API.fetchThumbnails([id])),
    ]);

    const merged = detail ? { ...detail } : null;
    if (merged && info) {
      merged.name = merged.name || String(info.Name || '').trim();
      merged.description = merged.description || String(info.Description || '').trim();
      merged.creatorName = merged.creatorName || String(info.Creator?.Name || '').trim();
      if (merged.assetType === null) merged.assetType = toNumber(info.AssetTypeId);
    }

    return {
      detail: merged,
      resale,
      listings: Array.isArray(resellers?.data) ? resellers.data : [],
      thumbnail: thumbs?.get(id) || API.thumbnailUrl(id),
    };
  }

  /* ------------------------------------------------------------------ */
  /* Rendering                                                           */
  /* ------------------------------------------------------------------ */

  function renderSellers(listings) {
    const body = fields('sellers-table')[0];
    if (!body) return;
    body.textContent = '';

    if (!listings.length) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 4;
      cell.className = 'text-center py-4';
      cell.style.color = '#7a8288';
      cell.textContent = 'Nobody is selling a copy of this item right now.';
      row.append(cell);
      body.append(row);
      return;
    }

    listings
      .slice()
      .sort((a, b) => (toNumber(a.price) ?? Infinity) - (toNumber(b.price) ?? Infinity))
      .forEach(listing => {
        const row = document.createElement('tr');

        const sellerCell = document.createElement('td');
        const sellerName = String(listing.seller?.name || 'Unknown');
        const sellerId = toNumber(listing.seller?.id);
        if (sellerId) {
          const link = document.createElement('a');
          link.href = `${SITE_BASE}/users/${sellerId}/profile`;
          link.target = '_blank';
          link.rel = 'noopener';
          link.textContent = sellerName;
          sellerCell.append(link);
        } else {
          sellerCell.textContent = sellerName;
        }

        const serialCell = document.createElement('td');
        const serial = toNumber(listing.serialNumber);
        serialCell.textContent = serial ? `#${formatNumber(serial)}` : EMPTY;

        const priceCell = document.createElement('td');
        priceCell.className = 'text-right';
        const price = toNumber(listing.price);
        priceCell.textContent = price === null ? EMPTY : formatNumber(price);

        const uaidCell = document.createElement('td');
        uaidCell.textContent = toNumber(listing.userAssetId) ?? EMPTY;

        row.append(sellerCell, serialCell, priceCell, uaidCell);
        body.append(row);
      });
  }

  /*
   * Wanwood's resale-data carries only a handful of points - far too few for
   * a chart to say anything - so the history is rendered as a short table
   * instead, and hidden entirely when there is nothing to show.
   */
  function renderHistory(resale) {
    const body = fields('history-table')[0];
    if (!body) return;
    const prices = Array.isArray(resale?.priceDataPoints) ? resale.priceDataPoints : [];
    const volumes = Array.isArray(resale?.volumeDataPoints) ? resale.volumeDataPoints : [];
    if (!prices.length && !volumes.length) {
      show('history-section', false);
      return;
    }

    const byDate = new Map();
    const dayOf = point => String(point.date || '').slice(0, 10);
    prices.forEach(point => {
      byDate.set(dayOf(point), { price: toNumber(point.value), volume: null });
    });
    volumes.forEach(point => {
      const day = dayOf(point);
      const entry = byDate.get(day) || { price: null, volume: null };
      entry.volume = toNumber(point.value);
      byDate.set(day, entry);
    });

    body.textContent = '';
    [...byDate.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .forEach(([day, entry]) => {
        const row = document.createElement('tr');
        const dateCell = document.createElement('td');
        dateCell.textContent = day || EMPTY;
        const priceCell = document.createElement('td');
        priceCell.className = 'text-right';
        priceCell.textContent = entry.price === null ? EMPTY : formatNumber(entry.price);
        const volumeCell = document.createElement('td');
        volumeCell.className = 'text-right';
        volumeCell.textContent = entry.volume === null ? EMPTY : formatNumber(entry.volume);
        row.append(dateCell, priceCell, volumeCell);
        body.append(row);
      });

    show('history-section', true);
  }

  function renderFlag(isLimited, isLimitedUnique) {
    const holder = fields('flag')[0];
    if (!holder) return;
    holder.textContent = '';
    if (!isLimited) {
      holder.hidden = true;
      return;
    }
    const ribbon = document.createElement('img');
    ribbon.src = isLimitedUnique ? '/img/limitedu.svg' : '/img/limited.svg';
    ribbon.alt = isLimitedUnique ? 'Limited U' : 'Limited';
    ribbon.width = isLimitedUnique ? 75 : 56;
    ribbon.height = 15;
    holder.append(ribbon);
    holder.hidden = false;
  }

  function renderValueVsRap(value, rap) {
    const target = fields('value-vs-rap')[0];
    if (!target) return;
    if (!value || !Number.isFinite(rap) || rap <= 0) {
      target.textContent = EMPTY;
      target.style.color = '';
      return;
    }
    const delta = Math.round(((value - rap) / rap) * 100);
    target.textContent = `${delta > 0 ? '+' : ''}${formatNumber(delta)}%`;
    target.style.color = delta > 0 ? '#8fe6a0' : (delta < 0 ? '#ff8585' : '#bfc7cd');
  }

  function render(id, data) {
    const { detail, resale, listings, thumbnail } = data;

    const name = detail?.name || `Item ${id}`;
    const restrictions = detail?.itemRestrictions || [];
    const isLimitedUnique = restrictions.includes('LimitedUnique');
    const isLimited = isLimitedUnique || restrictions.includes('Limited');

    const rap = toNumber(resale?.recentAveragePrice);
    const value = VALUES.get(id);
    const prices = listings.map(listing => toNumber(listing.price)).filter(price => price !== null);
    const bestPrice = prices.length ? Math.min(...prices) : null;
    const highestAsk = prices.length ? Math.max(...prices) : null;
    const distinctSellers = new Set(listings.map(listing => listing.seller?.id).filter(Boolean)).size;

    /* Head + title -------------------------------------------------- */
    document.title = `${name} - Wolimons`;
    setText('name', name);
    renderFlag(isLimited, isLimitedUnique);
    setText('subtitle', isLimitedUnique
      ? 'Wanwood Limited U'
      : (isLimited ? 'Wanwood Limited' : 'Wanwood Item'));
    fields('wanwood-link').forEach(link => {
      link.href = `${SITE_BASE}/catalog/${id}/${slugify(name)}`;
    });
    fields('thumbnail').forEach(image => {
      image.src = thumbnail;
      image.alt = `${name} thumbnail`;
    });

    /* Overview ------------------------------------------------------ */
    setText('type', TYPE_NAMES[detail?.assetType] || null);
    setNumber('total-copies', toNumber(resale?.assetStock));
    setNumber('total-copies-2', toNumber(resale?.assetStock));
    setNumber('remaining', toNumber(resale?.numberRemaining));
    setNumber('remaining-2', toNumber(resale?.numberRemaining));
    setNumber('sales', toNumber(resale?.sales));
    setNumber('sales-2', toNumber(resale?.sales));
    setNumber('sellers', listings.length);
    setNumber('sellers-2', listings.length);
    setNumber('distinct-sellers', distinctSellers);
    setText('creator', detail?.creatorName || null);

    /* Valuation ----------------------------------------------------- */
    setNumber('rap', rap);
    setNumber('rap-2', rap);
    setNumber('value', value);
    setNumber('value-2', value);
    /* No Wanwood endpoint reports demand. It is shown only when somebody has
     * set it by hand in values.js, and left blank otherwise. */
    const demand = VALUES.demand(id);
    setText('demand', demand);
    setText('demand-2', demand);
    renderValueVsRap(value, rap);

    /* More info ----------------------------------------------------- */
    setText('id', id);
    setCopyValue('copy-id', String(id));
    setText('for-sale', detail ? (detail.isForSale ? 'Yes' : 'No') : null);
    setNumber('best-price', bestPrice);
    setNumber('best-price-2', bestPrice);
    setNumber('highest-ask', highestAsk);

    const pageLink = `${window.location.origin}/dominus/?id=${id}`;
    setText('page-link', `/dominus/?id=${id}`);
    setCopyValue('copy-link', pageLink);

    /* Tables -------------------------------------------------------- */
    renderSellers(listings);
    renderHistory(resale);

    /* About --------------------------------------------------------- */
    const kind = [
      isLimitedUnique ? 'limited unique' : (isLimited ? 'limited' : ''),
      (TYPE_NAMES[detail?.assetType] || 'item').toLowerCase(),
    ].filter(Boolean).join(' ');
    const sentences = [`${name} is a Wanwood ${kind}.`];
    sentences.push(`Its value is ${formatNumber(value)}${value ? '' : ' (not set yet)'}.`);
    if (Number.isFinite(rap)) sentences.push(`Its RAP is ${formatNumber(rap)}.`);
    if (bestPrice !== null) {
      sentences.push(`${listings.length} ${listings.length === 1 ? 'copy is' : 'copies are'} listed for sale, from ${formatNumber(bestPrice)}.`);
    } else {
      sentences.push('No copies are listed for sale right now.');
    }
    setText('about-overview', sentences.join(' '));

    const description = String(detail?.description || '').trim();
    if (description) {
      setText('about-description', description);
      show('about-description', true);
      show('about-description-kicker', true);
      show('about-description-divider', true);
    }
  }

  function renderError(message) {
    fields('error').forEach(box => {
      box.textContent = message;
      box.hidden = false;
    });
  }

  /* ------------------------------------------------------------------ */
  /* Boot                                                                */
  /* ------------------------------------------------------------------ */

  initTabs();
  initCopyButtons();

  const assetId = readAssetId();
  if (!assetId) {
    setText('name', 'No item selected');
    renderError('Add an item id to the address, for example /dominus/?id=1581 - or pick an item from the catalog.');
  } else {
    setText('name', 'Loading\u2026');
    setText('id', assetId);
    loadItem(assetId)
      .then(data => {
        if (!data.detail && !data.resale && !data.listings.length) {
          setText('name', `Item ${assetId}`);
          renderError('Wanwood returned nothing for this item. It may not exist, or the API may be unavailable.');
          return;
        }
        render(assetId, data);
      })
      .catch(error => {
        console.error('Could not load the item:', error);
        setText('name', `Item ${assetId}`);
        renderError('This item could not be loaded from Wanwood.');
      });
  }
})();
