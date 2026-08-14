/*
 * Wolimons - the standard item card.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 * ---------------------------------------------------------------------------
 * /catalog draws it, /projecteds draws it, and /deals draws a variant of it.
 * It is the same card each time - the same name header, the same gradient
 * image box with its ribbon and tag icons, the same stat rows - so it is
 * built in one place instead of being copy-pasted per page and left to drift.
 *
 * ---------------------------------------------------------------------------
 * WHAT A CARD SHOWS, AND WHAT IT NEVER SHOWS
 * ---------------------------------------------------------------------------
 * Value and RAP, and never a price. Value is the community figure from
 * values.js - assigned by hand, never fetched - and reads 0 until somebody
 * sets it. Price is a shop listing, not a valuation, and does not belong on a
 * card; a page that genuinely needs to talk about a sale price (the deals
 * scanner) labels it as such itself rather than passing it off as value.
 *
 * The Limited / Limited U ribbon comes from the API's own restriction flags,
 * which the API client resolves through api/v1/items/restrictions. It is
 * never guessed from a serial number or from anything else.
 */
(() => {
  'use strict';

  const API = window.WanwoodAPI;

  const formatNumber = value => Number(value || 0).toLocaleString('en-US');

  const slugify = value => String(value || 'unnamed')
    .replace(/'/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unnamed';

  function text(tag, className, value) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined) node.textContent = value;
    return node;
  }

  /* One "Label   1,234" row. A null value draws nothing at all, so a card
   * simply omits a figure nobody has rather than printing a dash. */
  function statRow(label, value, { cell, className = 'text-light' } = {}) {
    if (value === null || value === undefined) return null;
    const row = text('div', 'd-flex justify-content-between');
    const labelWrap = text('div');
    labelWrap.append(text('small', 'text-muted', label));
    const amount = text('div', `${className} text-truncate`,
      typeof value === 'number' ? formatNumber(value) : String(value));
    if (cell) amount.dataset.cell = cell;
    row.append(labelWrap, amount);
    return row;
  }

  /*
   * The little square badges in the bottom-left of the image: Rare, then
   * Projected. Both are community categories from values.js, and both are
   * drawn with the existing .system_item_tag_icon sprites, so nothing new is
   * introduced for them.
   */
  function tagContainer(item) {
    const tags = [];
    if (item.rare) tags.push(['rare_tag_icon', 'Rare']);
    if (item.projected) tags.push(['projected_tag_icon', 'Projected']);
    if (!tags.length) return null;

    const container = text('div', 'system_item_tag_container');
    tags.forEach(([className, label]) => {
      const icon = text('div', `system_item_tag_icon ${className}`);
      icon.setAttribute('title', label);
      icon.setAttribute('aria-label', label);
      container.append(icon);
    });
    return container;
  }

  /*
   * Build a card.
   *
   *   item   { id, name, thumbnail, limited, limitedUnique, rare, projected }
   *   stats  [ [label, value, options], ... ] - drawn in order, nulls skipped
   *   href   where the card links (defaults to our own item page)
   *
   * The extra classes and the data-ref attribute match what /catalog already
   * emits, so the same stylesheet rules and the same tests apply to every
   * page that uses this.
   */
  function itemCard(item, { stats = [], href, className = '' } = {}) {
    const card = text('div', `shadow_md_35 shift_up_md pb-2 mb-3 mix_item${className ? ` ${className}` : ''}`);
    card.dataset.ref = 'item';
    card.dataset.itemKey = String(item.id);
    card.style.backgroundColor = '#30363c';

    const link = document.createElement('a');
    /* Cards open our own item page, not Wanwood's catalog. The slug is
     * cosmetic - /item/ reads the id out of the query string. */
    link.href = href || `/item/?id=${item.id}&name=${slugify(item.name)}`;

    const headingWrap = document.createElement('div');
    const heading = text('h6', 'item_card_name px-2 text-light my-1 text-truncate');
    const name = text('div', 'text-truncate', item.name || `Item ${item.id}`);
    name.title = item.name || `Item ${item.id}`;
    heading.append(name);
    headingWrap.append(heading);

    const imageWrap = text('div',
      'position-relative std_item_card_img_bkgnd_gradient text-center border-top border-bottom border-dark');

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

    const tags = tagContainer(item);
    /* The ribbon sits bottom-left too, so when both are present the tags move
     * across to the right rather than stacking on top of the banner. */
    if (tags) {
      if (item.limited) {
        tags.style.left = 'auto';
        tags.style.right = '4px';
      }
      imageWrap.append(tags);
    }

    const image = document.createElement('img');
    image.className = 'd-block-inline my-1';
    image.src = item.thumbnail || (API ? API.thumbnailUrl(item.id) : '');
    image.width = 100;
    image.height = 100;
    image.alt = `${item.name || `Item ${item.id}`} thumbnail`;
    image.loading = 'lazy';
    imageWrap.append(image);

    const statsWrap = text('div', 'px-2 pt-1');
    stats.forEach(([label, value, options]) => {
      const row = statRow(label, value, options);
      if (row) statsWrap.append(row);
    });

    link.append(headingWrap, imageWrap, statsWrap);
    card.append(link);
    return card;
  }

  window.WolimonsItemCard = {
    itemCard,
    statRow,
    text,
    slugify,
    formatNumber,
  };
})();
