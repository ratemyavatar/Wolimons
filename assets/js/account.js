/*
 * Wolimons account state.
 *
 * There is no Wolimons login. An "account" here is nothing more than a
 * Wanwood player id this browser has proven it controls, by writing a
 * one-time phrase into that player's Wanwood profile description (see
 * /verify). No email, no password, no server-side session - the proof is
 * re-checkable by anyone at any time by reading the same public field.
 *
 * Because the claim is only ever as good as the browser holding it, the
 * record lives in localStorage and carries the phrase it was proven with,
 * so a stale claim can be re-checked rather than trusted forever.
 *
 * One thing does need the server's word for it. Trade ads are posted to
 * Wolimons and shown to everybody, so the server cannot simply believe a
 * browser that says "I am player N" - it re-reads the profile description
 * itself and hands back a signed token saying who it found. That token is
 * kept here alongside the account, and getToken() returns it while it is
 * still good. Everything else on the site is a public read and needs none
 * of this.
 */
(() => {
  'use strict';

  const ACCOUNT_KEY = 'wolimons_account_v1';
  const PENDING_KEY = 'wolimons_verify_pending_v1';

  /* A pending phrase is only good for this long. Long enough to go and edit
   * a profile, short enough that an abandoned phrase left in someone's
   * description is not a permanent skeleton key. */
  const PENDING_TTL_MS = 60 * 60 * 1000;

  function read(key) {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (error) {
      /* Private mode, disabled storage, or hand-edited garbage. */
      return null;
    }
  }

  function write(key, value) {
    try {
      if (value === null) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      return false;
    }
  }

  /* ------------------------------------------------------------------ */
  /* The linked account                                                  */
  /* ------------------------------------------------------------------ */

  function get() {
    const row = read(ACCOUNT_KEY);
    if (!row) return null;
    const id = Number(row.id);
    const name = typeof row.name === 'string' ? row.name.trim() : '';
    if (!Number.isSafeInteger(id) || id <= 0 || !name) return null;
    return {
      id,
      name,
      phrase: typeof row.phrase === 'string' ? row.phrase : '',
      verifiedAt: Number(row.verifiedAt) || 0,
      token: typeof row.token === 'string' ? row.token : '',
      tokenExpiresAt: Number(row.tokenExpiresAt) || 0,
    };
  }

  function set({ id, name, phrase = '', token = '', tokenExpiresAt = 0 }) {
    const userId = Number(id);
    const userName = String(name || '').trim();
    if (!Number.isSafeInteger(userId) || userId <= 0 || !userName) return null;
    const row = {
      id: userId,
      name: userName,
      phrase,
      verifiedAt: Date.now(),
      token: String(token || ''),
      tokenExpiresAt: Number(tokenExpiresAt) || 0,
    };
    write(ACCOUNT_KEY, row);
    clearPending();
    notify();
    return row;
  }

  /*
   * The server-issued identity token, or '' when there is not a usable one.
   *
   * Treated as expired a minute early so a token cannot lapse between the
   * check and the request it is being used for.
   */
  function getToken() {
    const account = get();
    if (!account || !account.token) return '';
    if (!account.tokenExpiresAt) return account.token;
    return Date.now() < account.tokenExpiresAt - 60000 ? account.token : '';
  }

  function clear() {
    write(ACCOUNT_KEY, null);
    clearPending();
    notify();
  }

  function isLinked() {
    return get() !== null;
  }

  /* ------------------------------------------------------------------ */
  /* The phrase awaiting proof                                           */
  /* ------------------------------------------------------------------ */

  function getPending() {
    const row = read(PENDING_KEY);
    if (!row) return null;
    const id = Number(row.id);
    const phrase = typeof row.phrase === 'string' ? row.phrase.trim() : '';
    const issuedAt = Number(row.issuedAt) || 0;
    if (!Number.isSafeInteger(id) || id <= 0 || !phrase) return null;
    if (Date.now() - issuedAt > PENDING_TTL_MS) return null;
    return { id, name: String(row.name || ''), phrase, issuedAt };
  }

  function setPending({ id, name, phrase }) {
    const row = { id: Number(id), name: String(name || ''), phrase: String(phrase), issuedAt: Date.now() };
    write(PENDING_KEY, row);
    return row;
  }

  function clearPending() {
    write(PENDING_KEY, null);
  }

  /*
   * Phrase wording. Two adjectives, a noun and a short code: long enough
   * that it cannot appear in a description by accident, short enough to
   * retype by hand on a phone if the clipboard button is not available.
   */
  const ADJECTIVES = ['amber', 'bright', 'clever', 'crimson', 'daring', 'eager',
    'frosty', 'golden', 'humble', 'jolly', 'lucky', 'mellow', 'noble', 'quiet',
    'rapid', 'silver', 'sunny', 'swift', 'velvet', 'witty'];
  const NOUNS = ['acorn', 'anchor', 'badger', 'beacon', 'candle', 'comet',
    'ember', 'falcon', 'harbor', 'ladder', 'lantern', 'marble', 'meadow',
    'otter', 'pebble', 'raven', 'ribbon', 'thicket', 'walnut', 'willow'];

  function randomInts(count, ceiling) {
    const out = [];
    const crypto = window.crypto || window.msCrypto;
    if (crypto && typeof crypto.getRandomValues === 'function') {
      const buffer = new Uint32Array(count);
      crypto.getRandomValues(buffer);
      for (let at = 0; at < count; at += 1) out.push(buffer[at] % ceiling);
      return out;
    }
    for (let at = 0; at < count; at += 1) out.push(Math.floor(Math.random() * ceiling));
    return out;
  }

  function makePhrase() {
    const [a, b, c, d] = randomInts(4, 1000000);
    const code = String(d % 100000).padStart(5, '0');
    return `wolimons-verify-${ADJECTIVES[a % ADJECTIVES.length]}-`
      + `${ADJECTIVES[b % ADJECTIVES.length]}-${NOUNS[c % NOUNS.length]}-${code}`;
  }

  /*
   * Does a Wanwood profile description carry this phrase?
   *
   * Deliberately forgiving: descriptions get pasted through editors that
   * change case and add surrounding text, and the phrase itself is the
   * secret, so an exact-substring rule on the lowered text is enough.
   */
  function descriptionProves(description, phrase) {
    if (typeof description !== 'string' || !phrase) return false;
    return description.toLowerCase().includes(String(phrase).toLowerCase());
  }

  /* ------------------------------------------------------------------ */
  /* Change notification                                                 */
  /* ------------------------------------------------------------------ */

  /* Both the navbar and the verify page render from this state, and the
   * verify page changes it while the navbar is on screen. */
  const listeners = new Set();

  function subscribe(listener) {
    if (typeof listener === 'function') listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function notify() {
    const current = get();
    listeners.forEach(listener => {
      try {
        listener(current);
      } catch (error) {
        /* One bad listener must not stop the others. */
      }
    });
  }

  /* Another tab signing in or out counts as a change here too. */
  window.addEventListener('storage', event => {
    if (event.key === ACCOUNT_KEY) notify();
  });

  window.WolimonsAccount = {
    get,
    set,
    clear,
    getToken,
    isLinked,
    getPending,
    setPending,
    clearPending,
    makePhrase,
    descriptionProves,
    subscribe,
    PENDING_TTL_MS,
  };
})();
