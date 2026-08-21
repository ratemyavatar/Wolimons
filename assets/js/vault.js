/*
 * thuglolboi - the new-drop watcher.
 *
 * Two gates: the browser must hold an identity token for the website owner,
 * and the password is checked on the server, never here. Nothing on the page
 * is fetched until both pass.
 *
 * Buying happens on the server.
 *
 * The first attempt at this called Wanwood straight from the browser with
 * credentials. That cannot work: a browser will not attach another site's
 * cookies to a cross-origin request unless that site opts in through CORS,
 * and Wanwood does not. The request never even left.
 *
 * A server has no such rule - it is not a browser, so there is no origin to
 * approve and the cookie is simply set by hand. So the purchase is posted to
 * our own backend, which holds a Wanwood session and makes the real call.
 */
(() => {
  'use strict';

  const CONFIG = window.WOLIMONS_CONFIG || {};
  const API = window.WanwoodAPI;
  const ACCOUNT = window.WolimonsAccount;
  const API_BASE = CONFIG.apiBase || '';

  const POLL_MS = 5000;

  const dom = {};
  const state = { password: '', watching: false, timer: null, buying: new Set(), seen: new Set(), linked: false };

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

  async function vaultCall(path, body) {
    const response = await fetch(`${API_BASE}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token()}`,
        'x-vault-password': state.password,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) {
      throw new Error(payload.error || `Refused (${response.status}).`);
    }
    return payload;
  }

  /* ------------------------------------------------------------------ */
  /* The Wanwood session the server buys with                            */
  /* ------------------------------------------------------------------ */

  const money = amount => (amount === null || amount === undefined
    ? ''
    : `R$ ${Number(amount).toLocaleString('en-US')}`);

  function showSession(info) {
    state.linked = Boolean(info && info.linked && info.valid !== false);
    if (!dom.sessionState) return;
    if (!info || !info.linked) {
      dom.sessionState.textContent = 'Not linked';
      dom.sessionState.style.color = '#e57373';
      return;
    }
    if (info.valid === false) {
      dom.sessionState.textContent = `Expired (${info.hint})`;
      dom.sessionState.style.color = '#e57373';
      return;
    }
    const balance = info.balance === null || info.balance === undefined ? '' : ` \u00b7 ${money(info.balance)}`;
    dom.sessionState.textContent = `${info.account.name}${balance} (${info.hint})`;
    dom.sessionState.style.color = '#81c784';
  }

  async function loadSession() {
    try {
      showSession(await vaultCall('/api/vault/session'));
    } catch (error) {
      if (dom.sessionState) {
        dom.sessionState.textContent = 'Unknown';
        dom.sessionState.style.color = '#7a8288';
      }
    }
  }

  async function saveSession() {
    const cookie = (dom.cookie ? dom.cookie.value : '').trim();
    if (!cookie) {
      sessionNote('Paste the cookie first.', 'bad');
      return;
    }
    sessionNote('Checking the session with Wanwood\u2026');
    try {
      const info = await vaultCall('/api/vault/session', { cookie });
      if (dom.cookie) dom.cookie.value = '';
      showSession(info);
      sessionNote('', '');
      log(`Session linked as ${info.account.name}.`, 'good');
    } catch (error) {
      sessionNote(error.message, 'bad');
    }
  }

  /*
   * Sign in from the page. The password goes to our own backend, which uses
   * it once against Wanwood and keeps only the session cookie that comes
   * back. It is cleared from the field either way, and never stored here.
   */
  async function signIn() {
    const username = (dom.username ? dom.username.value : '').trim();
    const password = dom.pw ? dom.pw.value : '';
    if (!username || !password) {
      sessionNote('Enter the Wanwood username and password.', 'bad');
      return;
    }
    sessionNote('Signing in\u2026');
    if (dom.login) dom.login.disabled = true;
    try {
      const info = await vaultCall('/api/vault/login', { username, password });
      showSession(info);
      sessionNote('', '');
      log(`Signed in as ${info.account.name}.`, 'good');
    } catch (error) {
      sessionNote(error.message, 'bad');
    } finally {
      /* However it went, the password does not stay on screen. */
      if (dom.pw) dom.pw.value = '';
      if (dom.login) dom.login.disabled = false;
    }
  }

  async function clearSession() {
    try {
      showSession(await vaultCall('/api/vault/session', { clear: true }));
      sessionNote('Session forgotten.', '');
      log('Session forgotten.');
    } catch (error) {
      sessionNote(error.message, 'bad');
    }
  }

  function sessionNote(message, tone) {
    if (!dom.sessionNotice) return;
    dom.sessionNotice.textContent = message || '';
    dom.sessionNotice.style.color = tone === 'bad' ? '#e57373' : tone === 'good' ? '#81c784' : '#7a8288';
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

  /*
   * Try to get in. The website owner needs no password - the identity token
   * already proves who they are - so on load we simply ask, and only fall
   * back to showing the password box if the server says no.
   */
  async function unlock(password) {
    if (!token()) {
      note('Link the website owner account on /verify first.');
      return false;
    }
    note('Checking\u2026');
    try {
      const response = await fetch(`${API_BASE}/api/vault/unlock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ password: password || '' }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false) {
        note(payload.error || `Refused (${response.status}).`);
        return false;
      }
      state.password = password || '';
      if (dom.password) dom.password.value = '';
      dom.gate.classList.add('d-none');
      dom.main.classList.remove('d-none');
      log(`Unlocked by ${payload.name}.`, 'good');
      loadSession();
      check(true);
      return true;
    } catch (error) {
      note('The server could not be reached.');
      return false;
    }
  }

  /* Called once on load: the owner walks straight in, anyone else is left
   * looking at the password box with nothing given away. */
  async function tryOwnerUnlock() {
    if (!token()) return;
    note('');
    const opened = await unlock('');
    if (!opened) note('');
  }

  function unlockFromForm() {
    const password = (dom.password ? dom.password.value : '').trim();
    if (!password) {
      note('Enter the password.');
      return;
    }
    unlock(password);
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
   * The purchase, run by our own backend against its stored Wanwood session.
   * The price sent is the price shown, so a listing that moved between the
   * poll and the click is refused upstream instead of quietly costing more.
   */
  async function buy(item, button) {
    if (state.buying.has(item.assetId)) return;
    if (!state.linked) {
      log(`${item.name}: link a Wanwood session first.`, 'bad');
      return;
    }
    state.buying.add(item.assetId);
    if (button) {
      button.disabled = true;
      button.textContent = 'Buying\u2026';
    }
    log(`Buying ${item.name} for ${item.price}\u2026`);

    try {
      const result = await vaultCall('/api/vault/buy', {
        assetId: item.assetId,
        productId: item.productId,
        price: item.price,
        sellerId: item.sellerId,
      });
      if (result.bought) {
        log(`Bought ${item.name}.${result.balance === null ? '' : ` Balance ${money(result.balance)}.`}`, 'good');
        if (button) button.textContent = 'Bought';
      } else {
        log(`${item.name}: ${result.reason}`, 'bad');
        if (button) {
          button.textContent = 'Retry';
          button.disabled = false;
        }
        /* A dead session is worth saying once, loudly, rather than on every
         * drop from here on. */
        if (/session/i.test(String(result.reason))) loadSession();
      }
    } catch (error) {
      log(`${item.name}: ${error.message}`, 'bad');
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

  function init() {
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
    dom.cookie = document.getElementById('vault_cookie');
    dom.username = document.getElementById('vault_username');
    dom.pw = document.getElementById('vault_pw');
    dom.login = document.getElementById('vault_login');
    dom.pasteToggle = document.getElementById('vault_paste_toggle');
    dom.sessionForm = document.getElementById('vault_session_form');
    dom.sessionState = document.getElementById('vault_session_state');
    dom.sessionSave = document.getElementById('vault_session_save');
    dom.sessionClear = document.getElementById('vault_session_clear');
    dom.sessionNotice = document.getElementById('vault_session_notice');

    showWho();
    tryOwnerUnlock();
    dom.unlock?.addEventListener('click', unlockFromForm);
    dom.password?.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        unlockFromForm();
      }
    });
    dom.watch?.addEventListener('click', () => setWatching(!state.watching));
    dom.refresh?.addEventListener('click', () => check(false));
    dom.sessionSave?.addEventListener('click', saveSession);
    dom.login?.addEventListener('click', signIn);
    dom.pw?.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        signIn();
      }
    });
    dom.username?.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        dom.pw?.focus();
      }
    });
    dom.pasteToggle?.addEventListener('click', event => {
      event.preventDefault();
      dom.sessionForm?.classList.toggle('d-none');
    });
    dom.sessionClear?.addEventListener('click', clearSession);
    dom.cookie?.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        saveSession();
      }
    });
  }

  /* Same guard the panel uses: run now if the document is already parsed,
   * and only ever once - a second DOMContentLoaded must not wire every
   * button twice. */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
