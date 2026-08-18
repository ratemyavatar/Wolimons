/*
 * Wolimons inventory share page - /inventoryshare
 * ---------------------------------------
 * Type any Wanwood username or user id and the page draws that player's
 * inventory picture - the same one the profile's Share inventory button
 * makes, because the drawing is the shared inventory-art.js renderer. From here it
 * can be uploaded for a plain link that Discord unfurls as an image.
 *
 * The inventory pipeline is the profile page's: collectibles summary first
 * (the only call that reports the backend's own RAP total), paged out to the
 * full list when one page is not enough, copies grouped per asset, values
 * from our own table, thumbnails batched. Nothing is fetched twice and
 * nothing is invented.
 */
(() => {
  'use strict';

  const CONFIG = window.WOLIMONS_CONFIG || {};
  const API = window.WanwoodAPI;
  const VALUES = window.WolimonsValues;
  const ACCOUNT = window.WolimonsAccount;
  const ART = window.WolimonsInventoryArt;

  const API_BASE = CONFIG.apiBase || '';

  const state = {
    player: null,     /* { id, name } of whoever is drawn */
    canvas: null,     /* the finished style sheet */
  };

  const $ = id => document.getElementById(id);

  function status(message, tone) {
    const box = $('ss_status');
    if (!box) return;
    box.textContent = message || '';
    box.classList.toggle('d-none', !message);
    box.style.color = tone === 'bad' ? '#e57373'
      : tone === 'good' ? '#81c784'
        : '#adb5bd';
  }

  /*
   * Accepts a user id as-is, or resolves a username through the game API.
   * Either way the answer is { id, name }, spelled the way Wanwood spells it.
   */
  async function resolvePlayer(query) {
    const asNumber = Number(query);
    if (Number.isSafeInteger(asNumber) && asNumber > 0) {
      const user = API ? await API.getUserById(asNumber) : null;
      if (!user) throw new Error(`No Wanwood player with id ${asNumber}.`);
      return user;
    }
    let user = null;
    if (API) {
      try {
        user = await API.getUserByUsername(query);
      } catch (error) {
        user = null;
      }
    }
    if (!user) throw new Error(`No Wanwood player named \u201c${query}\u201d.`);
    return user;
  }

  /* The profile page's inventory pipeline, condensed to what a style sheet
   * needs: grouped items with value and RAP, and the whole-inventory totals. */
  async function loadInventory(userId) {
    const summary = await API.getCollectiblesSummary(userId);
    if (!summary) {
      throw new Error('Could not load this player from Wanwood. They may not exist, or the site is temporarily unreachable.');
    }

    let rows = summary.rows;
    if (summary.hasMore) {
      const full = await API.getCollectibles(userId).catch(() => null);
      if (full && full.length > rows.length) rows = full;
    }

    const grouped = new Map();
    rows.forEach(row => {
      const id = Number(row.assetId);
      if (!Number.isSafeInteger(id) || id <= 0) return;
      const copies = Math.max(1, Number(row.ownedCount) || 1);
      const existing = grouped.get(id);
      if (existing) {
        existing.copies += copies;
        return;
      }
      grouped.set(id, {
        id,
        name: typeof row.name === 'string' ? row.name.trim() : `Item ${id}`,
        rap: Number(row.recentAveragePrice) || 0,
        value: VALUES ? VALUES.get(id) : 0,
        copies,
        thumbnail: null,
      });
    });

    const items = [...grouped.values()];

    /* Thumbnails in one batched call; a miss leaves the tile blank rather
     * than breaking the sheet. */
    if (API && items.length) {
      try {
        const map = await API.fetchThumbnails(items.map(item => item.id));
        items.forEach(item => {
          const url = map && map.get ? map.get(item.id) : null;
          if (url) item.thumbnail = url;
        });
      } catch (error) {
        /* Cosmetic loss only. */
      }
    }

    return {
      items,
      totals: {
        value: items.reduce((sum, item) => sum + item.value * item.copies, 0),
        rap: Number.isFinite(summary.totalRap) && summary.totalRap
          ? summary.totalRap
          : items.reduce((sum, item) => sum + item.rap * item.copies, 0),
        copies: items.reduce((sum, item) => sum + item.copies, 0),
      },
    };
  }

  async function load() {
    if (!API || !ART) return;

    const input = $('ss_player');
    const query = input ? input.value.trim() : '';
    if (!query) {
      status('Type a Wanwood username or user id first.', 'bad');
      return;
    }

    const button = $('ss_load');
    if (button) button.disabled = true;
    const card = $('ss_card_wrap');
    if (card) card.classList.add('d-none');
    hideResult();
    status('Loading\u2026');

    try {
      /* The value table lands a moment after the page; wait for it so the
       * sheet is drawn with real values instead of a column of Unvalued. */
      if (VALUES && VALUES.ready) {
        try { await VALUES.ready; } catch (error) { /* fall through unset */ }
      }

      const player = await resolvePlayer(query);
      status(`Reading ${player.name}'s inventory\u2026`);
      const { items, totals } = await loadInventory(player.id);

      if (!items.length) {
        state.player = null;
        state.canvas = null;
        status(`${player.name} owns no collectibles, so there is nothing to picture.`, 'bad');
        return;
      }

      status(`Drawing ${player.name}'s inventory\u2026`);
      const sorted = items.slice()
        .sort((a, b) => (b.value - a.value) || (b.rap - a.rap) || a.name.localeCompare(b.name));

      const canvas = await ART.render({
        name: player.name,
        items: sorted.map(item => ({
          name: item.name,
          value: item.value,
          rap: item.rap,
          copies: item.copies,
          src: item.thumbnail || API.thumbnailUrl(item.id),
        })),
        totals,
      });

      state.player = player;
      state.canvas = canvas;

      const holder = $('ss_canvas_holder');
      if (holder) {
        holder.replaceChildren();
        canvas.style.maxWidth = '100%';
        canvas.style.height = 'auto';
        holder.appendChild(canvas);
      }
      if (card) card.classList.remove('d-none');
      status('');
    } catch (error) {
      state.player = null;
      state.canvas = null;
      status(error.message, 'bad');
    } finally {
      if (button) button.disabled = false;
    }
  }

  function hideResult() {
    const result = $('ss_result');
    const notice = $('ss_result_notice');
    if (result) result.classList.add('d-none');
    if (notice) notice.classList.add('d-none');
  }

  async function upload() {
    if (!state.canvas) return;
    const button = $('ss_upload');
    const original = button ? button.textContent : '';
    if (button) {
      button.disabled = true;
      button.textContent = 'Uploading\u2026';
    }
    hideResult();

    try {
      const blob = await new Promise(resolve => state.canvas.toBlob(resolve, 'image/jpeg', 0.85));
      if (!blob) throw new Error('The browser refused to export the image.');

      const response = await fetch(
        `${API_BASE}/api/inventory-card?id=${state.player ? state.player.id : 0}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'image/jpeg' },
          body: blob,
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || `The upload failed (${response.status}).`);
      }

      const result = $('ss_result');
      const urlBox = $('ss_result_url');
      const notice = $('ss_result_notice');
      if (result && urlBox) {
        urlBox.value = `${window.location.origin}${payload.url}`;
        result.classList.remove('d-none');
      }
      if (notice) {
        notice.textContent = 'Done - paste this link in Discord and it opens as a picture of the inventory.';
        notice.classList.remove('d-none');
      }
    } catch (error) {
      const notice = $('ss_result_notice');
      if (notice) {
        notice.textContent = error.message;
        notice.style.color = '#e57373';
        notice.classList.remove('d-none');
      }
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = original || 'Get a share link';
      }
    }
  }

  function init() {
    const loadButton = $('ss_load');
    const input = $('ss_player');
    if (loadButton) loadButton.addEventListener('click', load);
    if (input) {
      input.addEventListener('keydown', event => {
        if (event.key === 'Enter') load();
      });
    }

    const uploadButton = $('ss_upload');
    if (uploadButton) uploadButton.addEventListener('click', upload);

    const copyButton = $('ss_result_copy');
    if (copyButton) {
      copyButton.addEventListener('click', () => {
        const box = $('ss_result_url');
        if (!box || !box.value) return;
        box.select();
        box.setSelectionRange(0, box.value.length);
        try { document.execCommand('copy'); } catch (error) { /* user can Ctrl+C */ }
        const original = copyButton.textContent;
        copyButton.textContent = 'Copied';
        window.setTimeout(() => { copyButton.textContent = original; }, 1200);
      });
    }

    /* The linked account is the most common thing people want to picture;
     * prefill it and say so. */
    const account = ACCOUNT ? ACCOUNT.get() : null;
    if (account && account.name && input && !input.value) {
      input.value = account.name;
      const hint = $('ss_linked_hint');
      if (hint) {
        hint.textContent = 'Filled with your linked account - press Load, or type anyone else.';
        hint.classList.remove('d-none');
      }
    }

    /* Deep link: /stylesheet/?id=123 loads that player straight away. */
    const fromUrl = new URLSearchParams(window.location.search).get('id');
    if (fromUrl && input) {
      input.value = fromUrl;
      load();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
