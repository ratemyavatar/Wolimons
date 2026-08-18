/*
 * Wolimons inventory share - the shared renderer.
 * --------------------------------------------
 * The inventory share picture: a player's inventory as one image:
 * the name and totals across the top, then the items in a grid, most
 * valuable first. This file is the one place that draws it; the profile
 * page's Share inventory button and the /stylesheet page both call it, so
 * the picture can never drift between the two.
 *
 * The palette is the site's own - page background, navbar band, catalogue
 * card tiles - so a style sheet reads as a Wolimons page even when it is
 * pasted into Discord on its own.
 *
 * Thumbnails must arrive same-origin (the proxy already rewrites Wanwood's
 * thumbnail URLs onto this site), or the canvas taints and the export dies.
 */
(() => {
  'use strict';

  const COLORS = {
    page: '#272b30',
    band: '#3a3f44',
    tile: '#30363c',
    title: '#e9ecef',
    sub: '#adb5bd',
    itemName: '#e9ecef',
    value: '#7ab8f5',
    rap: '#8a9199',
    footer: '#7a8288',
    placeholder: '#43494f',
  };

  const COLS = 4;
  const TILE_W = 250;
  const TILE_H = 195;
  const PAD = 24;
  const HEADER = 118;
  const FOOTER = 52;
  /* More than sixty items and the tiles stop being readable. */
  const MAX_ITEMS = 60;

  const formatNumber = value => Number(value || 0).toLocaleString('en-US');

  const truncate = (name, max) => {
    const clean = String(name || '');
    return clean.length <= max ? clean : `${clean.slice(0, max - 1)}\u2026`;
  };

  function loadImage(src) {
    return new Promise(resolve => {
      if (!src) return resolve(null);
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  /*
   * Draws the style sheet and resolves to the finished canvas.
   *
   *   options.name     whose inventory this is, for the header
   *   options.items    [{ name, value, rap, copies, src }] - already sorted;
   *                    only the first MAX_ITEMS are drawn
   *   options.totals   { value, rap, copies } - the whole inventory, not just
   *                    the drawn slice
   */
  async function render({ name, items, totals }) {
    const top = (Array.isArray(items) ? items : []).slice(0, MAX_ITEMS);
    const images = await Promise.all(top.map(item => loadImage(item.src)));

    const rowCount = Math.max(1, Math.ceil(top.length / COLS));
    const width = PAD * 2 + COLS * TILE_W;
    const height = HEADER + rowCount * TILE_H + FOOTER;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    /* Page background, then the header band in the navbar's own grey. */
    ctx.fillStyle = COLORS.page;
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = COLORS.band;
    ctx.fillRect(0, 0, width, HEADER - 12);

    ctx.fillStyle = COLORS.title;
    ctx.font = 'bold 26px sans-serif';
    ctx.fillText(`${name || 'Player'}'s Inventory`, PAD, 46);

    ctx.fillStyle = COLORS.sub;
    ctx.font = '15px sans-serif';
    ctx.fillText(
      `Value R$ ${formatNumber(totals && totals.value)}    `
      + `RAP R$ ${formatNumber(totals && totals.rap)}    `
      + `${formatNumber(totals && totals.copies)} limiteds`,
      PAD, 78,
    );

    top.forEach((item, index) => {
      const col = index % COLS;
      const row = Math.floor(index / COLS);
      const x = PAD + col * TILE_W;
      const y = HEADER + row * TILE_H;

      ctx.fillStyle = COLORS.tile;
      ctx.fillRect(x + 5, y + 5, TILE_W - 10, TILE_H - 10);

      const img = images[index];
      const BOX = 100;
      if (img) {
        ctx.drawImage(img, x + (TILE_W - BOX) / 2, y + 16, BOX, BOX);
      } else {
        ctx.strokeStyle = COLORS.placeholder;
        ctx.strokeRect(x + (TILE_W - BOX) / 2, y + 16, BOX, BOX);
      }

      ctx.textAlign = 'center';
      const cx = x + TILE_W / 2;
      ctx.fillStyle = COLORS.itemName;
      ctx.font = '13px sans-serif';
      ctx.fillText(truncate(item.name, 27), cx, y + 135);
      ctx.fillStyle = COLORS.value;
      ctx.font = '12px sans-serif';
      ctx.fillText(item.value ? `Value R$ ${formatNumber(item.value)}` : 'Unvalued', cx, y + 155);
      ctx.fillStyle = COLORS.rap;
      ctx.fillText(
        `RAP R$ ${formatNumber(item.rap)}${item.copies > 1 ? `   x${item.copies}` : ''}`,
        cx, y + 173,
      );
      ctx.textAlign = 'left';
    });

    ctx.fillStyle = COLORS.footer;
    ctx.font = '13px sans-serif';
    ctx.fillText(`Wolimons \u00b7 ${new Date().toISOString().slice(0, 10)}`, PAD, height - 20);

    return canvas;
  }

  window.WolimonsInventoryArt = { render, MAX_ITEMS };
})();
