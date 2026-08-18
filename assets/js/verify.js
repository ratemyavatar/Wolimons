/*
 * /verify - link a Wanwood player to this browser.
 *
 * Three steps:
 *   1. Find the player (exact username, or a user id).
 *   2. Show a generated phrase; the player pastes it into the "About" field
 *      of their Wanwood account settings.
 *   3. Read the description back through the API. If it carries the phrase,
 *      whoever is sitting here can edit that profile, which is the whole
 *      claim being made. The link is then stored locally by account.js.
 *
 * No password is ever asked for, and nothing is sent anywhere: every request
 * on this page is a public read of the Wanwood API.
 */
(() => {
  'use strict';

  const API = window.WanwoodAPI;
  const ACCOUNT = window.WolimonsAccount;
  if (!API || !ACCOUNT) return;

  const FALLBACK_THUMB = '/assets/Wolimonslogoo.png';

  const el = id => document.getElementById(id);

  const signedInRow = el('signed_in_row');
  const signedInName = el('signed_in_name');
  const signedInThumb = el('signed_in_thumb');
  const signedInProfile = el('signed_in_profile_button');
  const signOutButton = el('sign_out_button');

  const step1 = el('step_1_row');
  const step2 = el('step_2_row');
  const step3 = el('step_3_row');

  const searchBox = el('player_search_textbox');
  const searchButton = el('player_search_button');
  const results = el('verify_player_results');
  const searchNotice = el('search_notice');

  const profileName = el('player_profile_name');
  const profileImage = el('player_profile_image');
  const phraseBox = el('verification_phrase_textbox');
  const copyButton = el('copy_phrase_to_clipboard_button');
  const settingsLink = el('wanwood_profile_page_link');
  const completeButton = el('complete_profile_verification_button');
  const errorNotice = el('verify_error_notice');
  const backButton = el('back_button');

  const verifiedName = el('player_profile_name_verified');
  const verifiedImage = el('player_profile_image_verified');
  const viewProfileButton = el('view_my_profile_button');

  const waitModal = el('wait_modal');

  /* The player picked in step 1: { id, name, thumb }. */
  let candidate = null;

  /* ------------------------------------------------------------------ */
  /* Small helpers                                                       */
  /* ------------------------------------------------------------------ */

  function show(node, visible) {
    node?.classList.toggle('d-none', !visible);
  }

  function setNotice(node, message, tone) {
    if (!node) return;
    node.textContent = message || '';
    node.style.color = tone === 'error' ? '#e9806e' : '#7a8288';
    node.style.fontWeight = tone === 'error' ? '600' : '';
    show(node, Boolean(message));
  }

  /* The modal plugin is not on the site; the stylesheet is, so the classes
   * are driven by hand exactly as navbar.js does for the search modal. */
  function setWaiting(waiting) {
    if (!waitModal) return;
    waitModal.style.display = waiting ? 'block' : 'none';
    waitModal.classList.toggle('show', waiting);
    waitModal.setAttribute('aria-hidden', waiting ? 'false' : 'true');
    document.body.classList.toggle('modal-open', waiting);
  }

  /* JSDOM and a few older browsers have no scrollTo; it is cosmetic. */
  function scrollToTop() {
    try {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
      /* Leave the scroll position alone. */
    }
  }

  async function thumbFor(id) {
    try {
      const thumbs = await API.fetchUserThumbnails([id], 150);
      return thumbs.get(Number(id)) || FALLBACK_THUMB;
    } catch (error) {
      return FALLBACK_THUMB;
    }
  }

  function setImage(node, url) {
    if (!node) return;
    node.src = url || FALLBACK_THUMB;
    node.onerror = () => {
      node.onerror = null;
      node.src = FALLBACK_THUMB;
    };
  }

  /* ------------------------------------------------------------------ */
  /* Step 1 - find the player                                            */
  /* ------------------------------------------------------------------ */

  /*
   * Wanwood has no player-search endpoint: only exact get-by-username and
   * get-by-id. So this is a lookup, not a search, and it produces at most
   * one card. Nothing is invented to pad the grid out.
   */
  async function lookup(term) {
    const query = term.trim();
    if (!query) return null;
    if (/^\d+$/.test(query)) return API.getUserById(query);
    return API.getUserByUsername(query).catch(() => null);
  }

  function playerCard({ id, name, thumb }) {
    const card = document.createElement('div');
    card.className = 'pb-2 search-player-card shadow_md_35 shift_up_md mx-0 verify-player-card';
    card.style.backgroundColor = '#30363c';
    card.style.cursor = 'pointer';
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.dataset.userId = String(id);
    card.dataset.userName = name;

    const image = document.createElement('img');
    image.width = 150;
    image.height = 150;
    image.alt = name;
    image.className = 'w-100';
    image.loading = 'lazy';
    setImage(image, thumb);

    const body = document.createElement('div');
    body.className = 'px-2 pt-2 text-center';

    const title = document.createElement('h6');
    title.className = 'text-truncate mb-1 text-light';
    title.textContent = name;
    title.title = name;

    const footer = document.createElement('small');
    footer.className = 'text-muted';
    footer.textContent = 'Click to verify this player';

    body.append(title, footer);
    card.append(image, body);

    const choose = () => beginVerification({ id, name, thumb });
    card.addEventListener('click', choose);
    card.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        choose();
      }
    });
    return card;
  }

  let searchToken = 0;

  async function runSearch() {
    const term = (searchBox?.value || '').trim();
    const token = ++searchToken;
    if (results) results.textContent = '';

    if (!term) {
      setNotice(searchNotice, 'Enter a username or user ID to continue');
      return;
    }

    setNotice(searchNotice, 'Looking up player...');

    let player = null;
    try {
      player = await lookup(term);
    } catch (error) {
      player = null;
    }
    if (token !== searchToken) return;

    if (!player) {
      setNotice(searchNotice, `No Wanwood player found for "${term}". Usernames must match exactly.`, 'error');
      return;
    }

    const thumb = await thumbFor(player.id);
    if (token !== searchToken) return;

    setNotice(searchNotice, '');
    results?.append(playerCard({ id: player.id, name: player.name, thumb }));
  }

  /* ------------------------------------------------------------------ */
  /* Step 2 - phrase and proof                                           */
  /* ------------------------------------------------------------------ */

  function beginVerification(player) {
    candidate = player;

    /* Reuse an unexpired phrase for the same player so that going back and
     * forth does not invalidate a phrase already saved on Wanwood. */
    const pending = ACCOUNT.getPending();
    const phrase = pending && pending.id === player.id
      ? pending.phrase
      : ACCOUNT.makePhrase();
    ACCOUNT.setPending({ id: player.id, name: player.name, phrase });

    if (profileName) profileName.textContent = player.name;
    setImage(profileImage, player.thumb);
    if (phraseBox) phraseBox.value = phrase;
    if (settingsLink) settingsLink.href = `${API.SITE_BASE}/My/Account`;
    setNotice(errorNotice, '');

    show(step1, false);
    show(step2, true);
    show(step3, false);
    scrollToTop();
  }

  function goBack() {
    candidate = null;
    ACCOUNT.clearPending();
    show(step2, false);
    show(step3, false);
    show(step1, true);
    setNotice(errorNotice, '');
  }

  async function copyPhrase() {
    if (!phraseBox) return;
    const phrase = phraseBox.value;
    let copied = false;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(phrase);
        copied = true;
      }
    } catch (error) {
      copied = false;
    }
    if (!copied) {
      /* Plain http on a LAN address has no clipboard API; select the text so
       * a long-press copy still works. */
      phraseBox.removeAttribute('readonly');
      phraseBox.focus();
      phraseBox.setSelectionRange(0, phrase.length);
      try {
        copied = document.execCommand('copy');
      } catch (error) {
        copied = false;
      }
      phraseBox.setAttribute('readonly', '');
    }
    if (copyButton) {
      copyButton.value = copied ? 'Copied!' : 'Select & copy';
      window.setTimeout(() => { copyButton.value = 'Copy'; }, 1800);
    }
  }

  /*
   * The proof itself. users/v1/users/{id} is the only endpoint that returns
   * the description, and it is a plain public GET.
   */
  async function readDescription(id) {
    const row = await API.fetchJson(`${API.API_BASE}/apisite/users/v1/users/${id}`);
    return row && typeof row.description === 'string' ? row.description : '';
  }

  async function completeVerification(event) {
    event?.preventDefault();
    if (!candidate) return;

    const pending = ACCOUNT.getPending();
    if (!pending || pending.id !== candidate.id) {
      setNotice(errorNotice, 'This verification phrase expired. Go back and start again.', 'error');
      return;
    }

    setNotice(errorNotice, '');
    setWaiting(true);

    let description = null;
    try {
      description = await readDescription(candidate.id);
    } catch (error) {
      setWaiting(false);
      setNotice(errorNotice, 'Could not reach Wanwood to read your profile. Try again in a moment.', 'error');
      return;
    }

    setWaiting(false);

    if (!ACCOUNT.descriptionProves(description, pending.phrase)) {
      setNotice(errorNotice,
        'The phrase is not in your "About" section yet. Save it on Wanwood, then press the button again.',
        'error');
      return;
    }

    /*
     * The browser is satisfied. Now ask the server to satisfy itself, while
     * the phrase is still in the description: it re-reads the profile and
     * signs a token saying who it found. That token is what lets this
     * account post trade ads, which are the one thing here that other
     * people see and so the one thing the server cannot take on trust.
     *
     * A failure is not fatal. The account still links and the whole site
     * works; only posting an ad would ask them back here.
     */
    let identity = null;
    try {
      identity = await claimIdentity(candidate.id, pending.phrase);
    } catch (error) {
      identity = null;
    }

    ACCOUNT.set({
      id: candidate.id,
      name: candidate.name,
      phrase: pending.phrase,
      token: identity?.token || '',
      tokenExpiresAt: identity?.expiresAt || 0,
    });
    showVerified(candidate);
  }

  /*
   * Trade the proven phrase for a signed identity token. Returns null when
   * the server cannot be reached or will not issue one.
   */
  async function claimIdentity(userId, phrase) {
    const response = await fetch(`${API.API_BASE}/api/identity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, phrase }),
    });
    const payload = await response.json().catch(() => null);
    return payload && payload.ok ? payload : null;
  }

  function showVerified(player) {
    if (verifiedName) verifiedName.textContent = player.name;
    setImage(verifiedImage, player.thumb);
    if (viewProfileButton) viewProfileButton.href = `/player/?id=${player.id}`;
    show(step1, false);
    show(step2, false);
    show(step3, true);
    renderSignedIn();
    scrollToTop();
  }

  /* ------------------------------------------------------------------ */
  /* The already-linked banner                                           */
  /* ------------------------------------------------------------------ */

  async function renderSignedIn() {
    const account = ACCOUNT.get();
    show(signedInRow, Boolean(account));
    if (!account) return;

    if (signedInName) signedInName.textContent = account.name;
    if (signedInProfile) signedInProfile.href = `/player/?id=${account.id}`;
    setImage(signedInThumb, await thumbFor(account.id));
  }

  /* ------------------------------------------------------------------ */
  /* Wiring                                                              */
  /* ------------------------------------------------------------------ */

  searchButton?.addEventListener('click', event => {
    event.preventDefault();
    runSearch();
  });
  searchBox?.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      runSearch();
    }
  });
  /* type="search" clear button fires input with an empty value. */
  searchBox?.addEventListener('search', () => {
    if (!searchBox.value.trim()) runSearch();
  });

  signOutButton?.addEventListener('click', event => {
    event.preventDefault();
    ACCOUNT.clear();
  });

  /* Signing out from here or from the navbar has to update both. */
  ACCOUNT.subscribe(() => { renderSignedIn(); });

  copyButton?.addEventListener('click', event => {
    event.preventDefault();
    copyPhrase();
  });
  completeButton?.addEventListener('click', completeVerification);
  backButton?.addEventListener('click', event => {
    event.preventDefault();
    goBack();
  });

  /*
   * Landing here with ?id= or ?username= (the navbar's "Verify Account"
   * entry can carry one) jumps straight to step 2.
   */
  async function applyQuery() {
    const params = new URLSearchParams(window.location.search);
    const term = params.get('id') || params.get('username') || '';
    if (!term || !searchBox) return;
    searchBox.value = term;
    await runSearch();
    /* A single unambiguous hit goes straight through. */
    results?.querySelector('.verify-player-card')?.click();
  }

  renderSignedIn();
  applyQuery();
})();
