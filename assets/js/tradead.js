/*
 * Single trade ad - /tradead/?id=...
 *
 * Reached from the Details button on any card on /trades. The page shows the
 * one ad: who posted it, when, the card itself, and a row per slot broken out
 * under Offer Details and Request Details.
 *
 * Ads live in localStorage on the device that posted them - see the comment
 * at the top of tradeads-core.js. An ad id from another device therefore has
 * nothing to open, and the page says so instead of inventing an ad.
 */
(() => {
  'use strict';

  const API = window.WanwoodAPI;
  const CORE = window.WolimonsTradeAds;
  if (!CORE) return;

  const {
    TAG_BY_SLUG, TAG_DESCRIPTIONS, tagArt, VALUES, el, formatNumber,
    itemHref, relativeTime, utcTimestamp, loadAd,
    items, creators, resolveItems, resolveCreators, itemIdsIn,
    itemName, itemRap, itemThumb, sideNode,
  } = CORE;

  const dom = {};

  function cacheDom() {
    dom.title = document.getElementById('trade_ad_page_title');
    dom.moreAds = document.getElementById('more_ads_by_player_button');
    dom.creatorProfile = document.getElementById('creator_profile_button');
    dom.headerPane = document.getElementById('trade_ad_header_pane');
    dom.avatar = document.getElementById('trade_ad_creator_avatar');
    dom.creatorName = document.getElementById('trade_ad_creator_name');
    dom.status = document.getElementById('trade_ad_status');
    dom.createdRelative = document.getElementById('trade_ad_created_relative');
    dom.createdTimestamp = document.getElementById('trade_ad_created_timestamp');
    dom.card = document.getElementById('trade_ad_card');
    dom.missing = document.getElementById('trade_ad_missing');
    dom.offerHeader = document.getElementById('offer_details_header');
    dom.requestHeader = document.getElementById('request_details_header');
    dom.offerDetails = document.getElementById('offer_details');
    dom.requestDetails = document.getElementById('request_details');
  }

  /* ------------------------------------------------------------------ */
  /* Which ad                                                            */
  /* ------------------------------------------------------------------ */

  /* /tradead/?id=... is the form the Details button links to. A bare
   * /tradead/12-345 path is accepted too, so a pasted URL still works. */
  function requestedId() {
    const fromQuery = new URLSearchParams(window.location.search).get('id');
    if (fromQuery) return fromQuery.trim();
    const parts = window.location.pathname.split('/').filter(Boolean);
    const after = parts.indexOf('tradead');
    return after >= 0 && parts[after + 1] ? decodeURIComponent(parts[after + 1]) : '';
  }

  /* ------------------------------------------------------------------ */
  /* The card                                                            */
  /* ------------------------------------------------------------------ */

  /*
   * The detail page's card is the board's card without the header bar - no
   * Details button (you are already here) and no Send Trade or Delete, which
   * the snapshot also leaves off. Both sides come from the shared core, so
   * the two pages can never drift apart.
   */
  function renderCard(ad) {
    const card = el('div', 'shadow_md_15 mix_item');
    card.style.backgroundColor = 'rgb(36, 38, 42)';
    const sides = el('div', 'd-flex flex-nowrap');
    sides.appendChild(sideNode(ad, 'offer'));
    sides.appendChild(sideNode(ad, 'request'));
    card.appendChild(sides);
    dom.card.replaceChildren(card);
  }

  /* ------------------------------------------------------------------ */
  /* Header pane                                                         */
  /* ------------------------------------------------------------------ */

  function renderHeader(ad) {
    if (dom.title) dom.title.textContent = `Trade Ad ${ad.id}`;
    document.title = `Trade Ad ${ad.id} - Wolimons`;

    if (dom.creatorName) {
      const link = el('a', null, ad.creatorName);
      link.href = `/player/?id=${ad.creatorId}`;
      dom.creatorName.replaceChildren(link);
      dom.creatorName.title = ad.creatorName;
    }

    /* An ad is on the board until its creator deletes it, and this page only
     * ever finds ads that are still on the board - so it is Active. */
    if (dom.status) dom.status.textContent = 'Active';
    if (dom.createdRelative) dom.createdRelative.textContent = relativeTime(ad.createdAt);
    if (dom.createdTimestamp) dom.createdTimestamp.textContent = utcTimestamp(ad.createdAt);

    if (dom.creatorProfile) {
      dom.creatorProfile.href = `/player/?id=${ad.creatorId}`;
      dom.creatorProfile.classList.remove('d-none');
    }
    /* Rolimon's has a /playertrades/<id> page; Wolimons does not, so this
     * goes back to the board rather than to a page that is not there. */
    if (dom.moreAds) {
      dom.moreAds.href = '/trades';
      dom.moreAds.classList.remove('d-none');
    }

    const headshot = creators.get(ad.creatorId);
    if (dom.avatar && headshot) {
      dom.avatar.src = headshot;
      dom.avatar.alt = `${ad.creatorName} avatar`;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Offer / Request Details rows                                        */
  /* ------------------------------------------------------------------ */

  function statGroup(header, data) {
    const group = el('div');
    group.appendChild(el('div', 'ad_component_stat_header', header));
    const wrap = el('div', 'ad_component_stat_data d-flex');
    wrap.appendChild(el('div', 'pl-1', data));
    group.appendChild(wrap);
    return group;
  }

  function detailRow() {
    const row = el('div', 'd-inline-block w-100 mb-2 rounded');
    row.style.backgroundColor = '#2e3337';
    return row;
  }

  /* An item slot: thumbnail, name linking to the item page, then RAP, Value
   * and Demand. Value and Demand are the curated figures - Value is 0 until
   * it is set and Demand is blank until it is set. No price, ever. */
  function itemDetailRow(slot) {
    const row = detailRow();
    const name = itemName(slot);

    const links = el('div', 'ad_component_links_section my-auto d-flex float-left');
    const thumbLink = el('a');
    thumbLink.href = itemHref(slot.id, name);
    const image = el('img', 'ad_component_image');
    image.src = itemThumb(slot);
    image.width = 64;
    image.height = 64;
    image.decoding = 'async';
    image.loading = 'lazy';
    image.alt = `${name} thumbnail`;
    thumbLink.appendChild(image);
    links.appendChild(thumbLink);

    const nameWrap = el('div', 'ad_component_item_name_link_container my-auto text-truncate');
    const nameLink = el('a', 'ad_component_item_name_link');
    nameLink.href = itemHref(slot.id, name);
    nameLink.title = name;
    nameLink.appendChild(el('span', null, name));
    nameWrap.appendChild(nameLink);
    links.appendChild(nameWrap);
    row.appendChild(links);

    const rap = itemRap(slot);
    const value = VALUES.get(slot.id);
    const demand = VALUES.demand(slot.id);

    const stats = el('div', 'ad_component_stats_section d-flex justify-content-around');
    stats.appendChild(statGroup('RAP', rap === null ? '-' : formatNumber(rap)));
    stats.appendChild(statGroup('Value', value ? formatNumber(value) : '-'));
    stats.appendChild(statGroup('Demand', demand || '-'));
    row.appendChild(stats);
    return row;
  }

  /* A tag slot: the tag's art and its name, with an empty stats section -
   * a tag has no RAP or Value of its own. This is what the snapshot does. */
  function tagDetailRow(slot) {
    const row = detailRow();
    const tag = TAG_BY_SLUG.get(slot.slug);
    const label = tag ? tag.label : slot.slug;

    const links = el('div', 'ad_component_links_section my-auto d-flex float-left');
    const image = el('img', 'ad_component_image');
    image.src = tagArt(slot.slug);
    image.width = 64;
    image.height = 64;
    image.decoding = 'async';
    image.loading = 'lazy';
    image.alt = `${label} thumbnail`;
    links.appendChild(image);

    const nameWrap = el('div', 'ad_component_item_name_link_container my-auto text-truncate');
    const name = el('span', 'text-light', label);
    const description = TAG_DESCRIPTIONS[slot.slug];
    if (description) name.title = description;
    nameWrap.appendChild(name);
    links.appendChild(nameWrap);
    row.appendChild(links);

    row.appendChild(el('div', 'ad_component_stats_section d-flex justify-content-around'));
    return row;
  }

  function renderDetails(container, header, slots) {
    const filled = slots.filter(Boolean);
    /* An empty side gets no heading rather than an empty one - the request
     * side of an offer-only ad simply has nothing to list. */
    if (header) header.classList.toggle('d-none', !filled.length);
    container.replaceChildren(...filled.map(slot =>
      (slot.kind === 'tag' ? tagDetailRow(slot) : itemDetailRow(slot))));
  }

  /* ------------------------------------------------------------------ */
  /* Missing ad                                                          */
  /* ------------------------------------------------------------------ */

  function showMissing() {
    if (dom.title) dom.title.textContent = 'Trade Ad';
    [dom.headerPane, dom.offerHeader, dom.requestHeader].forEach(node => {
      if (node) node.classList.add('d-none');
    });
    if (dom.card) dom.card.replaceChildren();
    if (dom.missing) dom.missing.classList.remove('d-none');
  }

  /* ------------------------------------------------------------------ */
  /* Boot                                                                */
  /* ------------------------------------------------------------------ */

  function render(ad) {
    renderHeader(ad);
    renderCard(ad);
    renderDetails(dom.offerDetails, dom.offerHeader, ad.offer);
    renderDetails(dom.requestDetails, dom.requestHeader, ad.request);
  }

  async function load() {
    const wanted = requestedId();

    /* Comments only need the ad id, so they mount immediately - before the
     * ad itself is fetched, which keeps the section on screen even while the
     * card is still loading. */
    if (wanted && window.WolimonsComments) {
      window.WolimonsComments.mount({
        target: `ad:${wanted}`,
        listId: 'tradead_comments_list',
        boxId: 'tradead_comments_box',
      });
    }

    const ad = wanted ? await loadAd(wanted) : null;
    if (!ad) {
      showMissing();
      return;
    }

    /* Draw once with what the server sent, then again once names, thumbnails
     * and RAP have come back - the same two-pass render the board does. */
    render(ad);
    await Promise.all([
      resolveItems(itemIdsIn([ad])),
      resolveCreators([ad.creatorId]),
    ]);
    render(ad);
  }

  let booted = false;

  function init() {
    if (booted) return;
    if (!document.body.classList.contains('page-tradead')) return;
    cacheDom();
    if (!dom.card) return;
    booted = true;
    load();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
