/*
 * thuglolboi - the new-drop watcher.
 *
 * Two gates: the browser must hold an identity token for the website owner,
 * and the password is checked on the server, never here. Nothing on the page
 * is fetched until both pass.
 *
 * Buying deliberately does NOT go through the Wolimons proxy. The proxy
 * forwards its own CSRF cookie and nothing else, so a purchase made through
 * it would be unauthenticated. The call below goes straight from this browser
 * to Wanwood with credentials, so the game sees the logged-in account.
 */
(() => {
  'use strict';

  const CONFIG = window.WOLIMONS_CONFIG || {};
  const API = window.WanwoodAPI;
  const ACCOUNT = window.WolimonsAccount;
  const API_BASE = CONFIG.apiBase || '';
  const GAME = (API && API.SITE_BASE) || 'https://wanwoo.xyz';

  const POLL_MS = 5000;

  const dom = {};
  const state = { password: '', watching: false, timer: null, buying: new Set(), seen: new Set() };

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function log(message, tone) {
    if (!dom.log) return;
    const stamp = new Date().toTimeString().slice(0, 8);
    const line = el('div', tone || '', `${stamp}  ${message}`);
    dom.log.prepend(line);
    while (dom.log.childElementCount > 200) dom.log.lastElementChild.remove();
  }

  const token = () => (ACCOUNT && typeof ACCOUNT.getToken === 'function' ? ACCOUNT.getToken() : '');

  async function vaultCall(path) {
    const response = await fetch(`${API_BASE}${path}`, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token()}`,
        'x-vault-password': state.password,
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) {
      throw new Error(payload.error || `Refused (${response.status}).`);
    }
    return payload;
  }

  /* ------------------------------------------------------------------ */
  /* Gate                                                                */
  /* ------------------------------------------------------------------ */

  function showWho() {
    const account = ACCOUNT && typeof ACCOUNT.get === 'function' ? ACCOUNT.get() : null;
    if (!dom.who) return;
    if (!account) {
      dom.who.textContent = 'This browser has no linked account.';
      return;
    }
    dom.who.textContent = `Linked as ${account.name}.`;
  }

  async function unlock() {
    const password = (dom.password ? dom.password.value : '').trim();
    if (!password) {
      note('Enter the password.');
      return;
    }
    if (!token()) {
      note('Link the website owner account on /verify first.');
      return;
    }

    note('Checking\u2026');
    try {
      const response = await fetch(`${API_BASE}/api/vault/unlock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ password }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false) {
        note(payload.error || `Refused (${response.status}).`);
        return;
      }
      state.password = password;
      if (dom.password) dom.password.value = '';
      dom.gate.classList.add('d-none');
      dom.main.classList.remove('d-none');
      log(`Unlocked by ${payload.name}.`, 'good');
      check(true);
    } catch (error) {
      note('The server could not be reached.');
    }
  }

  function note(message) {
    if (dom.gateNotice) dom.gateNotice.textContent = message || '';
  }

  /* ------------------------------------------------------------------ */
  /* Watching                                                            */
  /* ------------------------------------------------------------------ */

  function setWatching(on) {
    state.watching = on;
    clearInterval(state.timer);
    if (on) state.timer = setInterval(() => check(false), POLL_MS);
    if (dom.watch) dom.watch.value = on ? 'Stop watching' : 'Start watching';
    if (dom.statusDot) dom.statusDot.classList.toggle('off', !on);
    if (dom.status) dom.status.textContent = on ? `Watching every ${POLL_MS / 1000}s` : 'Idle';
  }

  async function check(initial) {
    try {
      const payload = await vaultCall(`/api/vault/feed?recent=${initial ? 8 : 0}`);
      if (dom.watching) {
        dom.watching.textContent = `${payload.watching} items known to the catalogue.`;
      }
      if (payload.baseline) {
        log('Baseline taken - anything after this counts as a drop.');
      }
      if (payload.isNew) {
        log(`${payload.items.length} new item${payload.items.length === 1 ? '' : 's'} listed.`, 'good');
      }
      render(payload.items || [], payload.isNew);

      /* Auto-buy fires only on a genuine new listing, never on the recents
       * shown for context, and never twice for the same item. */
      if (payload.isNew && dom.autobuy && dom.autobuy.checked) {
        payload.items.forEach(item => {
          if (!state.seen.has(item.assetId)) buy(item);
        });
      }
      (payload.items || []).forEach(item => state.seen.add(item.assetId));
    } catch (error) {
      log(error.message, 'bad');
      if (/password|owner|verify|Link/i.test(error.message)) setWatching(false);
    }
  }

  function render(items, fresh) {
    if (!dom.items) return;
    dom.items.replaceChildren();
    if (!items.length) {
      const empty = el('div', 'small py-2', 'Nothing new. Leave the watcher running.');
      empty.style.color = '#7a8288';
      dom.items.appendChild(empty);
      return;
    }
    items.forEach(item => dom.items.appendChild(itemRow(item, fresh)));
  }

  function itemRow(item, fresh) {
    const row = el('div', `vault_row${fresh ? ' fresh' : ''}`);

    const img = el('img');
    img.alt = '';
    img.loading = 'lazy';
    img.src = API ? API.thumbnailUrl(item.assetId) : '';
    row.appendChild(img);

    const body = el('div');
    body.style.cssText = 'flex:1 1 auto;min-width:0;';
    body.appendChild(el('div', 'vault_name text-truncate', item.name));
    const bits = [`id ${item.assetId}`];
    if (item.limited) bits.push('Limited');
    if (item.remaining !== null) bits.push(`${item.remaining} left`);
    if (!item.forSale) bits.push('not for sale');
    body.appendChild(el('div', 'vault_meta', bits.join(' \u00b7 ')));
    row.appendChild(body);

    row.appendChild(el('div', 'vault_price',
      item.price === null ? '\u2014' : `R$ ${Number(item.price).toLocaleString('en-US')}`));

    const button = el('button', 'btn btn-flat-light-blue shadow ml-2', 'Buy');
    button.type = 'button';
    button.disabled = !item.productId;
    button.addEventListener('click', () => buy(item, button));
    row.appendChild(button);

    return row;
  }

  /* ------------------------------------------------------------------ */
  /* Buying - straight to the game, with this browser's own login        */
  /* ------------------------------------------------------------------ */

  /*
   * BubbaBlox v2 runs the same CSRF middleware Roblox does: a POST without a
   * matching x-csrf-token comes back 403 carrying the fresh token, and the
   * request is replayed with it. Nothing is cached between attempts because a
   * drop is a one-shot and a stale token is worse than a second round trip.
   */
  async function purchase(item) {
    const url = `${GAME}/apisite/economy/v1/purchases/products/${item.productId}`;
    const body = JSON.stringify({
      expectedCurrency: 1,
      expectedPrice: item.price,
      expectedSellerId: item.sellerId,
    });
    const init = {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body,
    };

    let response = await fetch(url, init);
    if (response.status === 403) {
      const fresh = response.headers.get('x-csrf-token');
      if (fresh) {
        init.headers['x-csrf-token'] = fresh;
        response = await fetch(url, init);
      }
    }
    const payload = await response.json().catch(() => ({}));
    return { status: response.status, payload };
  }

  async function buy(item, button) {
    if (state.buying.has(item.assetId)) return;
    state.buying.add(item.assetId);
    if (button) {
      button.disabled = true;
      button.textContent = 'Buying\u2026';
    }
    log(`Buying ${item.name} for ${item.price}\u2026`);

    try {
      const { status, payload } = await purchase(item);
      const bought = payload && (payload.purchased === true || payload.success === true);
      if (bought) {
        log(`Bought ${item.name}.`, 'good');
        if (button) button.textContent = 'Bought';
      } else {
        const why = (payload && (payload.errorMsg || payload.reason || payload.message))
          || `HTTP ${status}`;
        log(`${item.name}: ${why}`, 'bad');
        if (button) {
          button.textContent = 'Retry';
          button.disabled = false;
        }
      }
    } catch (error) {
      /* A cross-origin refusal lands here with no detail, so say what it
       * most likely means rather than printing "Failed to fetch". */
      log(`${item.name}: the browser could not reach Wanwood directly `
        + '(not signed in there, or the game refused a cross-site call).', 'bad');
      if (button) {
        button.textContent = 'Retry';
        button.disabled = false;
      }
    } finally {
      state.buying.delete(item.assetId);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Wiring                                                              */
  /* ------------------------------------------------------------------ */

  document.addEventListener('DOMContentLoaded', () => {
    dom.gate = document.getElementById('vault_gate');
    dom.main = document.getElementById('vault_main');
    dom.who = document.getElementById('vault_who');
    dom.password = document.getElementById('vault_password');
    dom.unlock = document.getElementById('vault_unlock');
    dom.gateNotice = document.getElementById('vault_gate_notice');
    dom.items = document.getElementById('vault_items');
    dom.log = document.getElementById('vault_log');
    dom.status = document.getElementById('vault_status');
    dom.statusDot = document.getElementById('vault_status_dot');
    dom.watching = document.getElementById('vault_watching');
    dom.watch = document.getElementById('vault_watch');
    dom.refresh = document.getElementById('vault_refresh');
    dom.autobuy = document.getElementById('vault_autobuy');

    showWho();
    dom.unlock?.addEventListener('click', unlock);
    dom.password?.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        unlock();
      }
    });
    dom.watch?.addEventListener('click', () => setWatching(!state.watching));
    dom.refresh?.addEventListener('click', () => check(false));
  });
})();
