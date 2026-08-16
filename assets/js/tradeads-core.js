/*
 * Trade ads - shared core for /trades and /tradead
 *
 * ---------------------------------------------------------------------------
 * WHERE THE ADS LIVE
 * ---------------------------------------------------------------------------
 * On the Wolimons server, in the same store the item values live in.
 *
 * Wanwood has no trade ad service - there is no endpoint to post an ad to and
 * none to read other players' ads from - so the board is ours. Ads go to
 * /api/ads and everybody reads the same list, which is the only way a board
 * makes any sense: you see other people's ads and they see yours.
 *
 * Posting is gated on the account link. The server will not take a browser's
 * word for who is posting, because an ad carries a name that other people
 * will trade against; it re-reads the Wanwood profile description during
 * /verify and issues a signed token, and that token is what /api/ads/post
 * wants. Deleting is the same, and only an ad's author may delete it.
 *
 * `loadAds`, `postAd` and `deleteAd` below are the only places that talk to
 * the server - both pages read through them.
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

  const ACCOUNT = window.WolimonsAccount;

  /* Where the board is. Same origin as everything else the site calls. */
  const API_BASE = (API && API.API_BASE) || '';
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
  /*
   * Every ad on the board, newest first, or one player's with { creatorId }.
   *
   * Returns [] when the server cannot be reached. An empty board reads as
   * "no ads", which is wrong but harmless; the alternative is a page that
   * will not draw at all. The callers show their own notice.
   */
  async function loadAds({ creatorId = 0 } = {}) {
    const query = creatorId ? `?creatorId=${encodeURIComponent(creatorId)}` : '';
    try {
      const response = await fetch(`${API_BASE}/api/ads${query}`, {
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) return [];
      const payload = await response.json();
      if (!payload || !payload.ok || !Array.isArray(payload.ads)) return [];
      /* Normalised again on the way in: the server is the authority on what
       * it stored, but the renderers still want a guaranteed shape. */
      return payload.ads.map(normalizeAd).filter(Boolean);
    } catch (error) {
      return [];
    }
  }

  /* One ad by id, or null. */
  async function loadAd(adId) {
    if (!adId) return null;
    try {
      const response = await fetch(`${API_BASE}/api/ad?id=${encodeURIComponent(adId)}`, {
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) return null;
      const payload = await response.json();
      return payload && payload.ok ? normalizeAd(payload.ad) : null;
    } catch (error) {
      return null;
    }
  }

  /*
   * The identity token proving which account is acting. Absent when the
   * browser has no linked account, or the token has run out.
   */
  function identityToken() {
    return ACCOUNT && typeof ACCOUNT.getToken === 'function' ? ACCOUNT.getToken() : '';
  }

  /*
   * Both writes answer the same shape - { ok, ad?, error? } - so the pages
   * can show the server's own wording rather than guessing at what failed.
   */
  async function send(path, body) {
    const token = identityToken();
    if (!token) {
      return {
        ok: false,
        error: 'Link your Wanwood account on the verify page first.',
      };
    }
    try {
      const response = await fetch(`${API_BASE}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => null);
      if (!payload) return { ok: false, error: 'The server did not answer properly.' };
      return payload;
    } catch (error) {
      return { ok: false, error: 'Could not reach the server. Try again in a moment.' };
    }
  }

  /* Post an ad. The creator comes from the token, not from here. */
  async function postAd({ creatorName, offer, request }) {
    const result = await send('/api/ads/post', { creatorName, offer, request });
    if (result.ok && result.ad) result.ad = normalizeAd(result.ad);
    return result;
  }

  /* Delete one of your own ads. */
  async function deleteAd(adId) {
    return send('/api/ads/delete', { id: adId });
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

  /*
   * A whole ad card: creator header, then the offer and request sides.
   *
   * /trades draws the board and /playertrades draws one player's ads, and
   * they must be the same card - so it lives here rather than in either page.
   * `onDelete` is what makes the Delete button appear: only a page that can
   * actually remove an ad passes one, and even then it is only offered on the
   * viewer's own ads, because those are the only ones in their browser.
   */
  function adCard(ad, { onDelete = null } = {}) {
    const ACCOUNT = window.WolimonsAccount;

    const card = el('div', 'shadow_md_15 mix_item');
    card.style.backgroundColor = 'rgb(36, 38, 42)';
    card.dataset.adId = ad.id;

    const header = el('div', 'trade_ad_header d-flex flex-wrap');
    const bar = el('div', 'text-truncate w-100 py-0 pl-2 my-auto d-flex justify-content-between flex-wrap');

    const who = el('div', 'd-flex');
    const pfpWrap = el('div');
    const pfpLink = el('a');
    pfpLink.href = `/player/?id=${ad.creatorId}`;
    const pfp = el('img', 'ad_creator_pfp');
    pfp.width = 38;
    pfp.height = 38;
    pfp.decoding = 'async';
    pfp.loading = 'lazy';
    pfp.alt = 'Player thumbnail';
    const headshot = creators.get(ad.creatorId);
    if (headshot) pfp.src = headshot;
    pfpLink.appendChild(pfp);
    pfpWrap.appendChild(pfpLink);
    who.appendChild(pfpWrap);

    const names = el('div', 'ml-2');
    const nameRow = el('div');
    nameRow.style.marginTop = '3px';
    nameRow.style.lineHeight = '1.35em';
    const nameLink = el('a', 'ad_creator_name my-auto', ad.creatorName);
    nameLink.href = `/player/?id=${ad.creatorId}`;
    nameRow.appendChild(nameLink);
    const stampRow = el('div');
    stampRow.style.lineHeight = '1em';
    stampRow.style.paddingBottom = '3px';
    stampRow.appendChild(el('span', 'trade-ad-timestamp small text-truncate', relativeTime(ad.createdAt)));
    names.appendChild(nameRow);
    names.appendChild(stampRow);
    who.appendChild(names);

    const actions = el('div', 'py-1 my-auto ml-auto');
    /* Details opens this ad on its own page. */
    const details = el('a', 'trade_ad_page_link_button my-auto btn btn-flat-light-blue-sm shadow-none', 'Details');
    details.href = `/tradead/?id=${encodeURIComponent(ad.id)}`;
    details.setAttribute('role', 'button');
    actions.appendChild(details);

    /* "Send Trade" goes to the creator's Wanwood profile - trading happens on
     * Wanwood itself, Wolimons only advertises. */
    const send = el('a', 'send_trade_button my-auto btn btn-flat-light-blue-sm shadow-none', 'Send Trade');
    send.href = `${window.WOLIMONS_CONFIG.siteBase}/users/${ad.creatorId}/profile`;
    send.target = '_blank';
    send.rel = 'noopener';
    send.setAttribute('role', 'button');
    actions.appendChild(send);

    /* Only your own ads can be taken down, and only because they are yours -
     * they are sitting in your own browser. */
    const account = ACCOUNT && typeof ACCOUNT.get === 'function' ? ACCOUNT.get() : null;
    if (onDelete && account && account.id === ad.creatorId) {
      const remove = el('input', 'delete_trade_ad_button my-auto btn btn-flat-dark-gray shadow-none mr-3');
      remove.type = 'submit';
      remove.value = 'Delete';
      remove.addEventListener('click', () => onDelete(ad.id));
      actions.appendChild(remove);
    } else {
      send.classList.add('mr-3');
    }

    bar.appendChild(who);
    bar.appendChild(actions);
    header.appendChild(bar);
    card.appendChild(header);

    const sides = el('div', 'd-flex flex-nowrap');
    sides.appendChild(sideNode(ad, 'offer'));
    sides.appendChild(sideNode(ad, 'request'));
    card.appendChild(sides);
    return card;
  }

  /* ------------------------------------------------------------------ */
  /* Shared filter panel                                                 */
  /* ------------------------------------------------------------------ */

  function showModal(modal, open) {
    if (!modal) return;
    modal.classList.toggle('show', open);
    modal.style.display = open ? 'block' : 'none';
    modal.setAttribute('aria-hidden', open ? 'false' : 'true');
    document.body.classList.toggle('modal-open', open);
  }

  function debounce(fn, wait) {
    let timer = 0;
    return (...args) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => fn(...args), wait);
    };
  }

  /*
   * The `.trade_ads_search_grid` block - two item-name boxes, two value-range
   * modals and the tag modal - is identical markup on /trades and
   * /playertrades, so the behaviour behind it lives here once.
   *
   * `onChange` fires whenever a filter moves; the page re-renders its own
   * list. The panel owns only the filter state, never the ads.
   */
  function createFilterPanel({ onChange = () => {}, debounceMs = 300 } = {}) {
    const filters = {
      offerName: '',
      requestName: '',
      tags: new Set(),
      /* null means "no bound set", which is not the same as 0. */
      offer: { min: null, max: null },
      request: { min: null, max: null },
    };

    const dom = {
      offerFilter: document.getElementById('filter_offer_side_item_name_search_textbox'),
      requestFilter: document.getElementById('filter_request_side_item_name_search_textbox'),
      tagFilterRow: document.getElementById('request_tag_filter_row'),
      tagFilterModal: document.getElementById('request_tag_filter_modal'),
      tagFilterButton: document.getElementById('trade_ads_request_tags_filter_button'),
      valueFilterModals: {
        offer: document.getElementById('offer_value_filter_modal'),
        request: document.getElementById('request_value_filter_modal'),
      },
      valueFilterButtons: {
        offer: document.getElementById('trade_ads_offer_value_filter_button'),
        request: document.getElementById('trade_ads_request_value_filter_button'),
      },
    };

    function slotMatchesName(slot, needle) {
      if (!slot || slot.kind !== 'item') return false;
      const known = items.get(slot.id);
      const name = ((known && known.name) || slot.name || '').toLowerCase();
      return name.includes(needle);
    }

    /* A side passes a value filter when its total sits inside the bounds. A
     * tags-only side has no total at all, so any bound excludes it - there is
     * no number to compare, and guessing one would be inventing data. */
    function withinValueRange(side, bounds) {
      if (bounds.min === null && bounds.max === null) return true;
      const total = sideTotals(side).value;
      if (total === null) return false;
      if (bounds.min !== null && total < bounds.min) return false;
      if (bounds.max !== null && total > bounds.max) return false;
      return true;
    }

    function matches(ad) {
      const offerNeedle = filters.offerName.trim().toLowerCase();
      const requestNeedle = filters.requestName.trim().toLowerCase();
      if (offerNeedle && !ad.offer.some(slot => slotMatchesName(slot, offerNeedle))) return false;
      if (requestNeedle && !ad.request.some(slot => slotMatchesName(slot, requestNeedle))) return false;
      if (!withinValueRange(ad.offer, filters.offer)) return false;
      if (!withinValueRange(ad.request, filters.request)) return false;
      if (filters.tags.size) {
        const present = new Set(ad.request
          .filter(slot => slot && slot.kind === 'tag')
          .map(slot => slot.slug));
        /* Every selected tag must be on the ad. */
        for (const slug of filters.tags) if (!present.has(slug)) return false;
      }
      return true;
    }

    function apply(ads) {
      return ads.filter(matches);
    }

    function renderChips() {
      TAGS.forEach(({ slug }) => {
        const on = filters.tags.has(slug);
        const image = document.getElementById(`filter_display_request_tag_${slug}`);
        const remove = document.getElementById(`filter_display_request_tag_${slug}_remove_button`);
        if (image) image.classList.toggle('d-none', !on);
        /* .filter-remove-button is display:none in the stylesheet, so the
         * button has to be shown explicitly alongside its tag. */
        if (remove) remove.style.display = on ? 'block' : '';
      });

      ['offer', 'request'].forEach(side => {
        ['min', 'max'].forEach(bound => {
          const amount = filters[side][bound];
          const container = document.getElementById(`enabled_filter_${side}_value_${bound}_container`);
          const text = document.getElementById(`enabled_filter_${side}_value_${bound}`);
          if (container) container.classList.toggle('d-none', amount === null);
          if (text) text.textContent = amount === null ? '' : formatNumber(amount);
        });
      });
    }

    /* A tag in the picker grid reads as chosen by the same dimming the rest of
     * the site uses for an inactive thumbnail. */
    function syncTagButtons() {
      if (!dom.tagFilterRow) return;
      dom.tagFilterRow.querySelectorAll('[data-tag]').forEach(button => {
        const on = filters.tags.has(button.dataset.tag);
        button.style.opacity = on ? '1' : '0.45';
        button.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    }

    function setTag(slug, on) {
      if (on) filters.tags.add(slug);
      else filters.tags.delete(slug);
      syncTagButtons();
      renderChips();
      onChange();
    }

    function setValue(side, bound, amount) {
      filters[side][bound] = amount;
      const input = document.getElementById(`filter_${side}_value_${bound}`);
      if (input && amount === null) input.value = '';
      renderChips();
      onChange();
    }

    function wire() {
      const applyNames = debounce(() => {
        filters.offerName = dom.offerFilter ? dom.offerFilter.value : '';
        filters.requestName = dom.requestFilter ? dom.requestFilter.value : '';
        onChange();
      }, debounceMs);

      if (dom.offerFilter) dom.offerFilter.addEventListener('input', applyNames);
      if (dom.requestFilter) dom.requestFilter.addEventListener('input', applyNames);

      /* Tag picking happens inside the tag modal, on the grid of tag art. */
      if (dom.tagFilterRow) {
        const pick = target => {
          const button = target.closest('[data-tag]');
          if (!button) return;
          setTag(button.dataset.tag, !filters.tags.has(button.dataset.tag));
        };
        dom.tagFilterRow.addEventListener('click', event => pick(event.target));
        dom.tagFilterRow.addEventListener('keydown', event => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          pick(event.target);
        });
      }

      /* The three icon buttons open their modal; the chips' red x buttons and
       * the modals' own clear buttons take a filter back off. */
      if (dom.valueFilterButtons.offer) {
        dom.valueFilterButtons.offer.addEventListener('click',
          () => showModal(dom.valueFilterModals.offer, true));
      }
      if (dom.valueFilterButtons.request) {
        dom.valueFilterButtons.request.addEventListener('click',
          () => showModal(dom.valueFilterModals.request, true));
      }
      if (dom.tagFilterButton) {
        dom.tagFilterButton.addEventListener('click',
          () => showModal(dom.tagFilterModal, true));
      }

      ['offer', 'request'].forEach(side => {
        ['min', 'max'].forEach(bound => {
          const input = document.getElementById(`filter_${side}_value_${bound}`);
          if (input) {
            input.addEventListener('input', debounce(() => {
              const amount = Number(input.value);
              setValue(side, bound,
                input.value.trim() === '' || !Number.isFinite(amount) ? null : amount);
            }, debounceMs));
          }

          const clear = document.getElementById(`clear_filter_${side}_value_${bound}_button`);
          if (clear) clear.addEventListener('click', () => setValue(side, bound, null));
          const chip = document.getElementById(`filter_display_${side}_${bound}_value_remove_button`);
          if (chip) chip.addEventListener('click', () => setValue(side, bound, null));
        });
      });

      TAGS.forEach(({ slug }) => {
        const remove = document.getElementById(`filter_display_request_tag_${slug}_remove_button`);
        if (remove) remove.addEventListener('click', () => setTag(slug, false));
      });

      [dom.tagFilterModal, dom.valueFilterModals.offer, dom.valueFilterModals.request]
        .forEach(modal => {
          if (!modal) return;
          modal.addEventListener('click', event => {
            if (event.target === modal) showModal(modal, false);
          });
          modal.querySelectorAll('[data-dismiss="modal"]').forEach(button => {
            button.addEventListener('click', () => showModal(modal, false));
          });
        });

      document.addEventListener('keydown', event => {
        if (event.key !== 'Escape') return;
        closeModals();
      });

      syncTagButtons();
      renderChips();
    }

    function closeModals() {
      showModal(dom.tagFilterModal, false);
      showModal(dom.valueFilterModals.offer, false);
      showModal(dom.valueFilterModals.request, false);
    }

    return { filters, dom, wire, matches, apply, renderChips, syncTagButtons, setTag, setValue, closeModals };
  }

  window.WolimonsTradeAds = {
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
    loadAd,
    postAd,
    deleteAd,
    identityToken,
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
    adCard,
    showModal,
    debounce,
    createFilterPanel,
  };
})();
