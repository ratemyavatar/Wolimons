/*
 * Trade ads - shared core for /trades and /tradead
 *
 * ---------------------------------------------------------------------------
 * WHERE THE ADS LIVE
 * ---------------------------------------------------------------------------
 * They live in this browser, in localStorage, and nowhere else.
 *
 * Wanwood has no trade ad service. There is no endpoint to post an ad to and
 * none to read other players' ads from - the backend simply does not have the
 * feature, so there is nothing for Wolimons to call. Rather than invent a
 * server that does not exist, or fill the board with made-up ads, the pages
 * are honest about it: you can write ads, they persist on this device, and
 * the board shows exactly what you wrote. Nobody else's ads appear, because
 * there is no way for them to arrive. The detail page is the same story: an
 * ad only opens on the device that posted it.
 *
 * If Wanwood ever grows the endpoints, `loadAds` and `saveAds` below are the
 * only two functions that need to change - both pages read through them.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS IN HERE
 * ---------------------------------------------------------------------------
 * The parts the board and the single-ad page both need: the tag list, the
 * storage format, the item/creator lookups, and the ad card's two sides.
 * Page-specific things - the board's filters, composer and picker, the
 * detail page's header pane and component rows - stay in their own scripts.
 *
 * Everything an ad is built from is real. Items come from the live catalog
 * search, thumbnails and RAP come from the API, the creator is the linked
 * Wanwood account, and Value is the hand-curated figure from values.js -
 * still 0 until someone sets it. No prices anywhere.
 */
(() => {
  'use strict';

  const API = window.WanwoodAPI;

  const STORAGE_KEY = 'wolimons_trade_ads_v1';
  const MAX_ADS = 200;

  /* The ten request tags, in the snapshot's order. A request slot holds
   * either an item or one of these. */
  const TAGS = [
    { slug: 'any', label: 'Any' },
    { slug: 'demand', label: 'Demand' },
    { slug: 'rares', label: 'Rares' },
    { slug: 'rap', label: 'RAP' },
    { slug: 'wishlist', label: 'Wishlist' },
    { slug: 'robux', label: 'Robux' },
    { slug: 'upgrade', label: 'Upgrade' },
    { slug: 'downgrade', label: 'Downgrade' },
    { slug: 'adds', label: 'Adds' },
    { slug: 'projecteds', label: 'Projecteds' },
  ];
  const TAG_BY_SLUG = new Map(TAGS.map(tag => [tag.slug, tag]));
  const tagArt = slug => `/img/tradetags/tradetag${slug}-420.png`;

  /* The wording the snapshot's detail page puts under each request tag. */
  const TAG_DESCRIPTIONS = {
    any: 'Indicates the trader is interested in any type of items',
    demand: 'Items with relatively high demand for their value',
    rares: 'Items that are hard to come by',
    rap: 'Items that sell near or above their current RAP relatively often',
    wishlist: 'Items the trader is specifically hunting for',
    robux: 'Indicates the trader is interested in Robux',
    upgrade: 'Fewer, higher-valued items in exchange for several smaller ones',
    downgrade: 'Several lower-valued items in exchange for one larger one',
    adds: 'Indicates the trader wants items added on top of the trade',
    projecteds: 'Items whose RAP has been inflated by manipulated sales',
  };

  /* ------------------------------------------------------------------ */
  /* Small helpers                                                       */
  /* ------------------------------------------------------------------ */

  const formatNumber = value => Number(value).toLocaleString('en-US');

  const slugify = value => String(value || 'unnamed')
    .replace(/'/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unnamed';

  const itemHref = (id, name) => `/item/?id=${id}&name=${slugify(name)}`;

  /* values.js read defensively, the same way item-cards.js reads it: a stale
   * or missing copy must not take the page down. Value is 0 until set. */
  const VALUES = {
    get(id) {
      const table = window.WolimonsValues;
      return table && typeof table.get === 'function' ? Number(table.get(id)) || 0 : 0;
    },
    /* Demand is curated too, and null until someone sets it. */
    demand(id) {
      const table = window.WolimonsValues;
      return table && typeof table.demand === 'function' ? table.demand(id) : null;
    },
  };

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  /* "6 seconds ago" / "3 hours ago" - the snapshot's timestamp wording. */
  function relativeTime(timestamp) {
    const seconds = Math.max(0, Math.round((Date.now() - Number(timestamp)) / 1000));
    const steps = [
      [60, 'second'],
      [60, 'minute'],
      [24, 'hour'],
      [7, 'day'],
      [4.348, 'week'],
      [12, 'month'],
    ];
    let amount = seconds;
    let unit = 'second';
    for (let i = 0; i < steps.length; i += 1) {
      const [size, name] = steps[i];
      if (amount < size) { unit = name; break; }
      amount = Math.floor(amount / size);
      unit = steps[i + 1] ? steps[i + 1][1] : 'year';
    }
    const rounded = Math.max(1, Math.floor(amount));
    return `${rounded} ${unit}${rounded === 1 ? '' : 's'} ago`;
  }

  /* "2026-08-14, 19:59:39 UTC" - the exact form the snapshot prints. */
  function utcTimestamp(timestamp) {
    const when = new Date(Number(timestamp));
    if (Number.isNaN(when.getTime())) return '-';
    const pad = number => String(number).padStart(2, '0');
    return `${when.getUTCFullYear()}-${pad(when.getUTCMonth() + 1)}-${pad(when.getUTCDate())}, `
      + `${pad(when.getUTCHours())}:${pad(when.getUTCMinutes())}:${pad(when.getUTCSeconds())} UTC`;
  }

  /* ------------------------------------------------------------------ */
  /* Storage                                                             */
  /* ------------------------------------------------------------------ */

  /*
   * An ad on disk:
   *   { id, creatorId, creatorName, createdAt,
   *     offer:   [ slot|null x4 ],
   *     request: [ slot|null x4 ] }
   *
   * A slot is either { kind:'item', id, name } or { kind:'tag', slug }.
   * Only ids and names are stored - thumbnails, RAP and Value are looked up
   * fresh on every render so nothing ever serves stale numbers.
   */
  function loadAds() {
    let raw = null;
    try {
      raw = window.localStorage.getItem(STORAGE_KEY);
    } catch (error) {
      return [];
    }
    if (!raw) return [];
    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      return [];
    }
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeAd).filter(Boolean);
  }

  function saveAds(ads) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ads.slice(0, MAX_ADS)));
      return true;
    } catch (error) {
      return false;
    }
  }

  function normalizeSlot(raw) {
    if (!raw || typeof raw !== 'object') return null;
    if (raw.kind === 'tag') {
      return TAG_BY_SLUG.has(raw.slug) ? { kind: 'tag', slug: raw.slug } : null;
    }
    const id = Number(raw.id);
    if (!Number.isSafeInteger(id) || id <= 0) return null;
    return { kind: 'item', id, name: typeof raw.name === 'string' ? raw.name : '' };
  }

  function normalizeSide(raw) {
    const list = Array.isArray(raw) ? raw : [];
    return [0, 1, 2, 3].map(index => normalizeSlot(list[index]));
  }

  function normalizeAd(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const creatorId = Number(raw.creatorId);
    const creatorName = typeof raw.creatorName === 'string' ? raw.creatorName.trim() : '';
    if (!Number.isSafeInteger(creatorId) || creatorId <= 0 || !creatorName) return null;
    const offer = normalizeSide(raw.offer);
    const request = normalizeSide(raw.request);
    if (!offer.some(Boolean)) return null;
    return {
      id: String(raw.id || `${creatorId}-${raw.createdAt || Date.now()}`),
      creatorId,
      creatorName,
      createdAt: Number(raw.createdAt) || Date.now(),
      offer,
      request,
    };
  }

  /* ------------------------------------------------------------------ */
  /* Lookups                                                             */
  /* ------------------------------------------------------------------ */

  /* id -> { id, name, thumbnail, rap } for every item any ad mentions, and
   * id -> headshot url for every creator. Shared by both pages. */
  const items = new Map();
  const creators = new Map();

  /* One details call covers the lot; a failure leaves the ids unresolved
   * rather than fabricating names or numbers. */
  async function resolveItems(ids) {
    const wanted = [...new Set(ids.map(Number).filter(id =>
      Number.isSafeInteger(id) && id > 0 && !items.has(id)))];
    if (!wanted.length) return;
    let details = [];
    try {
      details = await API.getItemDetails(wanted, { includePrice: false });
    } catch (error) {
      return;
    }
    details.forEach(item => {
      const id = Number(item.id ?? item.assetId);
      if (!Number.isSafeInteger(id)) return;
      items.set(id, {
        id,
        name: (item.name || '').trim(),
        thumbnail: item.thumbnail || API.thumbnailUrl(id),
        rap: Number.isFinite(item.rap) ? item.rap : null,
      });
    });
  }

  async function resolveCreators(ids) {
    const wanted = [...new Set(ids.map(Number).filter(id =>
      Number.isSafeInteger(id) && id > 0 && !creators.has(id)))];
    if (!wanted.length) return;
    let map = new Map();
    try {
      map = await API.fetchUserHeadshots(wanted, 150);
    } catch (error) {
      return;
    }
    wanted.forEach(id => creators.set(id, map.get(id) || ''));
  }

  /* Every item id a list of ads references, for one bulk lookup. */
  function itemIdsIn(ads) {
    const ids = [];
    ads.forEach(ad => {
      ad.offer.concat(ad.request).forEach(slot => {
        if (slot && slot.kind === 'item') ids.push(slot.id);
      });
    });
    return ids;
  }

  function itemName(slot) {
    const known = items.get(slot.id);
    return (known && known.name) || slot.name || `Item ${slot.id}`;
  }

  function itemRap(slot) {
    const known = items.get(slot.id);
    return known && Number.isFinite(known.rap) ? known.rap : null;
  }

  function itemThumb(slot) {
    const known = items.get(slot.id);
    return (known && known.thumbnail) || API.thumbnailUrl(slot.id);
  }

  /* ------------------------------------------------------------------ */
  /* Totals                                                              */
  /* ------------------------------------------------------------------ */

  /*
   * A side's Value and RAP are the sums over its item slots. Tag slots have
   * no numbers and contribute nothing. A side with no items at all shows "-",
   * which is what the snapshot does for a tags-only request side.
   *
   * Value is the curated figure and is 0 until set, so a side of unvalued
   * items legitimately totals 0 - that is not a missing number, it is the
   * honest answer.
   */
  function sideTotals(side) {
    const slots = side.filter(slot => slot && slot.kind === 'item');
    if (!slots.length) return { value: null, rap: null };
    let value = 0;
    let rap = 0;
    let sawRap = false;
    slots.forEach(slot => {
      value += VALUES.get(slot.id);
      const known = items.get(slot.id);
      if (known && Number.isFinite(known.rap)) {
        rap += known.rap;
        sawRap = true;
      }
    });
    return { value, rap: sawRap ? rap : null };
  }

  /* ------------------------------------------------------------------ */
  /* The two sides of an ad card                                         */
  /* ------------------------------------------------------------------ */

  function slotImage(slot, index) {
    const wrap = el('div', 'position-relative');
    wrap.appendChild(el('div', `system_item_tag_container_${index + 1}`));

    if (!slot) {
      const blank = el('div', `ad_item_img ad_item_img_${index + 1} ad_item_slot_empty`);
      blank.setAttribute('aria-label', 'Empty slot');
      wrap.appendChild(blank);
      return wrap;
    }

    if (slot.kind === 'tag') {
      const tag = TAG_BY_SLUG.get(slot.slug);
      const img = el('img', `ad_item_img ad_item_img_${index + 1}`);
      img.width = 118;
      img.height = 118;
      img.decoding = 'async';
      img.loading = 'lazy';
      img.src = tagArt(slot.slug);
      img.alt = tag ? tag.label : slot.slug;
      img.title = tag ? tag.label : slot.slug;
      wrap.appendChild(img);
      return wrap;
    }

    const name = itemName(slot);
    const value = VALUES.get(slot.id);
    const rap = itemRap(slot);

    const link = el('a');
    link.href = itemHref(slot.id, name);
    const img = el('img', `ad_item_img hover_pointer ad_item_img_${index + 1}`);
    img.width = 118;
    img.height = 118;
    img.decoding = 'async';
    img.loading = 'lazy';
    img.src = itemThumb(slot);
    img.alt = `${name} thumbnail`;
    img.title = `${name}\nValue ${value ? formatNumber(value) : '-'}`
      + `\nRAP ${rap === null ? '-' : formatNumber(rap)}`;
    link.appendChild(img);
    wrap.appendChild(link);
    return wrap;
  }

  function sideNode(ad, which) {
    const slots = which === 'offer' ? ad.offer : ad.request;
    const side = el('div', which === 'offer' ? 'ad_side_left' : 'ad_side_right');
    side.appendChild(el('div', 'ad_side_header', which === 'offer' ? 'Offering' : 'Requesting'));

    const grid = el('div', 'd-flex flex-wrap flex-lg-nowrap justify-content-center');
    const rowA = el('div', 'd-flex');
    const rowB = el('div', 'd-flex');
    rowA.appendChild(slotImage(slots[0], 0));
    rowA.appendChild(slotImage(slots[1], 1));
    rowB.appendChild(slotImage(slots[2], 2));
    rowB.appendChild(slotImage(slots[3], 3));
    grid.appendChild(rowA);
    grid.appendChild(rowB);
    side.appendChild(grid);

    const totals = sideTotals(slots);
    const details = el('div', 'ad_side_details');
    details.appendChild(el('div', 'stat_title', 'Value'));
    details.appendChild(el('div', 'stat_value', totals.value === null ? '-' : formatNumber(totals.value)));
    details.appendChild(el('div', 'stat_title', 'RAP'));
    details.appendChild(el('div', 'stat_rap', totals.rap === null ? '-' : formatNumber(totals.rap)));
    side.appendChild(details);
    return side;
  }

  window.WolimonsTradeAds = {
    STORAGE_KEY,
    MAX_ADS,
    TAGS,
    TAG_BY_SLUG,
    TAG_DESCRIPTIONS,
    tagArt,
    VALUES,
    el,
    formatNumber,
    slugify,
    itemHref,
    relativeTime,
    utcTimestamp,
    loadAds,
    saveAds,
    normalizeAd,
    items,
    creators,
    resolveItems,
    resolveCreators,
    itemIdsIn,
    itemName,
    itemRap,
    itemThumb,
    sideTotals,
    slotImage,
    sideNode,
  };
})();
