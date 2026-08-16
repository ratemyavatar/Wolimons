/*
 * Admin panel - /admin
 *
 * Reached from the Admin entry in the navbar's More menu. Three things live
 * here:
 *
 *   the greeting      who this browser is signed in as, and what it may do
 *   staff ranks       owners hand out Value Manager and Value Team
 *   player badges     owners hand out the badges nothing can work out itself
 *   item values       anyone ranked sets value, demand, trend and categories
 *
 * ---------------------------------------------------------------------------
 * WHO IS ALLOWED TO DO WHAT
 * ---------------------------------------------------------------------------
 * Two separate questions, answered in two different places.
 *
 * The panel *shows* what /api/me says the signed-in name may do. That is a
 * convenience: it stops staff being shown a rank editor they cannot use, and
 * it is fetched, not guessed, so promoting somebody takes effect on their next
 * page load rather than requiring a code change.
 *
 * The panel does not *enforce* anything, and cannot. Every write carries the
 * shared admin key, and the backend re-checks the rank of the name making the
 * change before it saves. Editing this file, or the roster it renders, changes
 * nothing on the server. The key is the door; the rank is the job.
 *
 * The old owners list in config.js is still consulted, but only so the panel
 * has an answer before the backend replies - the server's word wins.
 */
(() => {
  'use strict';

  const API = window.WanwoodAPI;
  const ACCOUNT = window.WolimonsAccount;
  const CONFIG = window.WOLIMONS_CONFIG;
  const VALUES = window.WolimonsValues;
  const ROLE_ICONS = window.WolimonsRoleIcons;
  /* The badge catalog (names, tiers, artwork) and the table of who has been
   * given what. The panel is the only place the second one is written. */
  const BADGES = window.WolimonsBadges;
  const GRANTED = window.WolimonsGrantedBadges;

  const API_BASE = (CONFIG && CONFIG.apiBase) || '';
  const TOKEN_KEY = 'wolimons_admin_token_v1';
  const SEARCH_LIMIT = 60;

  const dom = {};

  const state = {
    account: null,
    /* What the backend says this account may do. Null until it answers. */
    me: null,
    roles: [],
    token: readToken(),
    /* The rank editor's pending selection. */
    roleChoice: '',
    /* Everyone who has been given a badge, and the badge editor's pending
     * selection. */
    grants: [],
    badgeChoice: '',
    /* The item being valued, and the row as it currently reads. */
    item: null,
    demand: '',
    trend: '',
    method: '',
    categories: new Set(),
    pickerSequence: 0,
  };

  /* ------------------------------------------------------------------ */
  /* Small helpers                                                       */
  /* ------------------------------------------------------------------ */

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  const formatNumber = number => Number(number).toLocaleString('en-US');

  /* The session token, kept per browser. A restart of the backend invalidates
   * it, which shows up as a 401 on the next save and sends the key row back. */
  function readToken() {
    try {
      return window.localStorage.getItem(TOKEN_KEY) || '';
    } catch (error) {
      return '';
    }
  }

  function writeToken(token) {
    state.token = token || '';
    try {
      if (token) window.localStorage.setItem(TOKEN_KEY, token);
      else window.localStorage.removeItem(TOKEN_KEY);
    } catch (error) {
      /* Private mode: the token simply lasts for this page only. */
    }
  }

  /* The same UTC wording the trade ad detail page prints. */
  function utcTimestamp(timestamp) {
    const when = new Date(Number(timestamp));
    if (!timestamp || Number.isNaN(when.getTime())) return '-';
    const pad = number => String(number).padStart(2, '0');
    return `${when.getUTCFullYear()}-${pad(when.getUTCMonth() + 1)}-${pad(when.getUTCDate())}, `
      + `${pad(when.getUTCHours())}:${pad(when.getUTCMinutes())}:${pad(when.getUTCSeconds())} UTC`;
  }

  function notice(target, message, tone) {
    if (!target) return;
    target.textContent = message || '';
    target.style.color = tone === 'bad' ? '#e57373'
      : tone === 'good' ? '#81c784'
        : '#7a8288';
  }

  /* Toggle one of the catalog's filter chips. */
  function setPressed(button, on) {
    if (!button) return;
    button.setAttribute('aria-pressed', on ? 'true' : 'false');
    button.classList.toggle('active', Boolean(on));
  }

  async function apiCall(path, options = {}) {
    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
        ...(options.headers || {}),
      },
    });
    const text = await response.text();
    let payload = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch (error) {
      /* An HTML shell means the proxy is cold or something else answered. */
      throw new Error('The backend did not answer with JSON. It may still be starting up.');
    }
    if (!response.ok || payload.ok === false) {
      throw new Error(payload.error || `The backend refused that (${response.status}).`);
    }
    return payload;
  }

  function cacheDom() {
    dom.greetingRow = document.getElementById('admin_greeting_row');
    dom.greeting = document.getElementById('admin_greeting');
    dom.dashboard = document.getElementById('admin_dashboard');
    dom.avatar = document.getElementById('admin_avatar');
    dom.username = document.getElementById('admin_username');
    dom.userId = document.getElementById('admin_user_id');
    dom.permissions = document.getElementById('admin_permissions');
    dom.verifiedAt = document.getElementById('admin_verified_at');
    dom.profileButton = document.getElementById('admin_profile_button');
    dom.locked = document.getElementById('admin_locked');
    dom.lockedMessage = document.getElementById('admin_locked_message');

    dom.keyRow = document.getElementById('admin_key_row');
    dom.keyBox = document.getElementById('admin_key_textbox');
    dom.keyButton = document.getElementById('admin_key_button');
    dom.keyNotice = document.getElementById('admin_key_notice');
    dom.keyHint = document.getElementById('admin_key_hint');

    dom.rolesRow = document.getElementById('admin_roles_row');
    dom.roleName = document.getElementById('admin_role_name');
    dom.roleChoices = document.getElementById('admin_role_choices');
    dom.roleSave = document.getElementById('admin_role_save');
    dom.rolesNotice = document.getElementById('admin_roles_notice');
    dom.rolesList = document.getElementById('admin_roles_list');

    dom.badgesRow = document.getElementById('admin_badges_row');
    dom.badgeName = document.getElementById('admin_badge_name');
    dom.badgeChoices = document.getElementById('admin_badge_choices');
    dom.badgeGive = document.getElementById('admin_badge_give');
    dom.badgeTake = document.getElementById('admin_badge_take');
    dom.badgesNotice = document.getElementById('admin_badges_notice');
    dom.badgesList = document.getElementById('admin_badges_list');

    dom.valuesRow = document.getElementById('admin_values_row');
    dom.valueImage = document.getElementById('admin_value_item_image');
    dom.valueName = document.getElementById('admin_value_item_name');
    dom.valueStats = document.getElementById('admin_value_item_stats');
    dom.valueChoose = document.getElementById('admin_value_choose');
    dom.valueAmount = document.getElementById('admin_value_amount');
    dom.demandChoices = document.getElementById('admin_demand_choices');
    dom.trendChoices = document.getElementById('admin_trend_choices');
    dom.methodChoices = document.getElementById('admin_method_choices');
    dom.categoryChoices = document.getElementById('admin_category_choices');
    dom.valueNote = document.getElementById('admin_value_note');
    dom.valueSave = document.getElementById('admin_value_save');
    dom.valuesNotice = document.getElementById('admin_values_notice');

    dom.pickerModal = document.getElementById('item_select_modal');
    dom.pickerSearch = document.getElementById('item_select_search_textbox');
    dom.pickerResults = document.getElementById('item_select_results');
    dom.pickerClose = document.getElementById('item_select_clear_button');
  }

  /* ------------------------------------------------------------------ */
  /* Greeting                                                            */
  /* ------------------------------------------------------------------ */

  /* Every pane the panel can show has to be listed here. The badges row was
   * missing, so signing out or losing a rank left the Give badge controls on
   * screen underneath the locked notice. */
  function showLocked(message) {
    [dom.greetingRow, dom.dashboard, dom.keyRow, dom.rolesRow, dom.badgesRow,
      dom.valuesRow, dom.profileButton]
      .forEach(node => node && node.classList.add('d-none'));
    if (dom.locked) dom.locked.classList.remove('d-none');
    if (dom.lockedMessage) dom.lockedMessage.textContent = message;
  }

  /* The words for what this account may do, straight from the backend when it
   * has answered and from the local list until then. */
  function permissionsLabel() {
    if (state.me && state.me.role && ROLE_ICONS) return ROLE_ICONS.label(state.me.role);
    if (state.me && !state.me.role) return 'None';
    if (CONFIG && state.account && CONFIG.isOwner(state.account.name)) return 'Site Owner';
    return '-';
  }

  async function showDashboard(account) {
    if (dom.locked) dom.locked.classList.add('d-none');
    if (dom.greetingRow) dom.greetingRow.classList.remove('d-none');
    if (dom.dashboard) dom.dashboard.classList.remove('d-none');

    if (dom.greeting) dom.greeting.textContent = `Hello, ${account.name}`;
    if (dom.username) {
      dom.username.textContent = account.name;
      dom.username.title = account.name;
    }
    if (dom.userId) dom.userId.textContent = String(account.id);
    if (dom.verifiedAt) dom.verifiedAt.textContent = utcTimestamp(account.verifiedAt);
    if (dom.profileButton) {
      dom.profileButton.href = `/player/?id=${account.id}`;
      dom.profileButton.classList.remove('d-none');
    }
    renderPermissions();

    /* The headshot is a nicety - if Wanwood cannot be reached the pane just
     * has no picture in it, rather than a broken one. */
    try {
      const url = await API?.fetchUserAvatar(account.id, { size: 420 });
      if (url && dom.avatar) {
        dom.avatar.src = url;
        dom.avatar.alt = `${account.name} avatar`;
      }
    } catch (error) {
      /* Leave the empty frame. */
    }
  }

  /* The Permissions cell carries the rank's own icon beside its name, so the
   * crown that marks an owner on the roster marks them here too. */
  function renderPermissions() {
    if (!dom.permissions) return;
    dom.permissions.replaceChildren();
    dom.permissions.appendChild(el('span', null, permissionsLabel()));
    const icon = ROLE_ICONS && state.me ? ROLE_ICONS.iconFor(state.me.role) : null;
    if (icon) dom.permissions.appendChild(icon);
  }

  /* ------------------------------------------------------------------ */
  /* Panes                                                               */
  /* ------------------------------------------------------------------ */

  const canGrantRoles = () => Boolean(state.me && state.me.canGrantRoles);
  const canSetValues = () => Boolean(state.me && state.me.canSetValues);

  function renderPanes() {
    const signedIn = Boolean(state.token);

    /* Somebody with no rank sees neither editor - there is nothing they could
     * successfully save. */
    if (dom.keyRow) dom.keyRow.classList.toggle('d-none', !(canGrantRoles() || canSetValues()));
    if (dom.rolesRow) dom.rolesRow.classList.toggle('d-none', !canGrantRoles());
    /* Badges are the owner's to give, so the pane rides with the ranks one
     * rather than with the value editor. */
    if (dom.badgesRow) dom.badgesRow.classList.toggle('d-none', !canGrantRoles());
    if (dom.valuesRow) dom.valuesRow.classList.toggle('d-none', !canSetValues());

    if (dom.keyHint) {
      dom.keyHint.textContent = signedIn
        ? 'This browser is holding an admin session. Changes made here will be saved.'
        : 'Enter the admin key to make changes. Reading works without it.';
    }
    if (dom.keyButton) dom.keyButton.value = signedIn ? 'Sign out' : 'Sign in';
    if (dom.keyBox) dom.keyBox.classList.toggle('d-none', signedIn);
  }

  /* ------------------------------------------------------------------ */
  /* Ranks                                                               */
  /* ------------------------------------------------------------------ */

  function roleRow(entry) {
    const row = el('div', 'trade_ad_picker_row');
    row.style.cursor = 'default';

    const icon = ROLE_ICONS ? ROLE_ICONS.iconFor(entry.role) : null;
    if (icon) {
      /* Give the icon the same 44px column the item rows use for a thumbnail,
       * so names line up whatever the rank. */
      const slot = el('div');
      slot.style.width = '44px';
      slot.style.textAlign = 'center';
      slot.appendChild(icon);
      row.appendChild(slot);
    }

    const text = el('div', 'flex-grow-1');
    text.appendChild(el('div', 'text-truncate', entry.name));
    const label = ROLE_ICONS ? ROLE_ICONS.label(entry.role) : entry.role;
    const detail = entry.grantedBy
      ? `${label} \u00b7 set by ${entry.grantedBy}`
      : label;
    const sub = el('div', 'small', detail);
    sub.style.color = '#7a8288';
    text.appendChild(sub);
    row.appendChild(text);

    /* Tapping a row loads it into the editor above, which is quicker and
     * safer than retyping a username. */
    row.style.cursor = 'pointer';
    row.addEventListener('click', () => {
      if (dom.roleName) dom.roleName.value = entry.name;
      chooseRole(entry.role);
    });
    return row;
  }

  function renderRoles() {
    if (!dom.rolesList) return;
    dom.rolesList.replaceChildren();
    if (!state.roles.length) {
      const empty = el('div', 'small py-2', 'Nobody has been ranked yet.');
      empty.style.color = '#7a8288';
      dom.rolesList.appendChild(empty);
      return;
    }
    state.roles.forEach(entry => dom.rolesList.appendChild(roleRow(entry)));
  }

  function chooseRole(role) {
    state.roleChoice = role || '';
    if (!dom.roleChoices) return;
    dom.roleChoices.querySelectorAll('[data-role-value]').forEach(button => {
      setPressed(button, button.dataset.roleValue === state.roleChoice);
    });
  }

  async function loadRoles() {
    try {
      const payload = await apiCall('/api/roles');
      state.roles = Array.isArray(payload.roles) ? payload.roles : [];
    } catch (error) {
      state.roles = [];
      notice(dom.rolesNotice, error.message, 'bad');
    }
    renderRoles();
  }

  async function saveRole() {
    const target = dom.roleName ? dom.roleName.value.trim() : '';
    if (!target) {
      notice(dom.rolesNotice, 'Type the username you are ranking.', 'bad');
      return;
    }
    if (!state.roleChoice) {
      notice(dom.rolesNotice, 'Choose a rank first.', 'bad');
      return;
    }

    notice(dom.rolesNotice, 'Saving...');
    try {
      const payload = await apiCall('/api/roles/set', {
        method: 'POST',
        body: JSON.stringify({
          name: state.account.name,
          target,
          role: state.roleChoice,
        }),
      });
      state.roles = Array.isArray(payload.roles) ? payload.roles : state.roles;
      renderRoles();
      notice(
        dom.rolesNotice,
        state.roleChoice === 'none'
          ? `${target} no longer has a rank.`
          : `${target} is now ${ROLE_ICONS ? ROLE_ICONS.label(state.roleChoice) : state.roleChoice}.`,
        'good',
      );
      if (dom.roleName) dom.roleName.value = '';
      chooseRole('');
    } catch (error) {
      notice(dom.rolesNotice, error.message, 'bad');
      if (/sign in/i.test(error.message)) {
        writeToken('');
        renderPanes();
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Player badges                                                       */
  /* ------------------------------------------------------------------ */

  /*
   * The badges an owner can hand out are exactly the ones in badges.js with
   * no earn rule - the fifteen whose requirement happens somewhere a browser
   * cannot check. Deriving the list rather than repeating it means the panel
   * can never offer a badge that is actually earned, and cannot fall behind
   * when the catalog changes.
   *
   * The server keeps its own copy of the same list and refuses anything not
   * on it, so this is convenience, not enforcement.
   */
  function grantableBadges() {
    if (!BADGES || !Array.isArray(BADGES.LIST)) return [];
    return BADGES.LIST.filter(badge => typeof badge.earn !== 'function');
  }

  const badgeName = id => {
    const badge = BADGES && BADGES.get ? BADGES.get(id) : null;
    return badge ? badge.name : id;
  };

  /* One chip per badge, using the catalog's filter buttons - the same control
   * the ranks and categories rows are built from. */
  function renderBadgeChoices() {
    if (!dom.badgeChoices) return;
    dom.badgeChoices.replaceChildren();

    const list = grantableBadges();
    if (!list.length) {
      const empty = el('div', 'small py-2', 'The badge catalog failed to load.');
      empty.style.color = '#7a8288';
      dom.badgeChoices.appendChild(empty);
      return;
    }

    list.forEach(badge => {
      const button = el('button', 'filter-button btn btn-primary', badge.name);
      button.type = 'button';
      button.dataset.badgeValue = badge.id;
      button.setAttribute('aria-pressed', 'false');
      button.addEventListener('click', () => {
        chooseBadge(badge.id === state.badgeChoice ? '' : badge.id);
      });
      dom.badgeChoices.appendChild(button);
    });
    chooseBadge(state.badgeChoice);
  }

  function chooseBadge(id) {
    state.badgeChoice = id || '';
    if (!dom.badgeChoices) return;
    dom.badgeChoices.querySelectorAll('[data-badge-value]').forEach(button => {
      setPressed(button, button.dataset.badgeValue === state.badgeChoice);
    });
  }

  /*
   * One player's row in the list underneath: their name, the badges they
   * hold, and the artwork for each. Same picker row the roster uses, so the
   * two lists look like one thing.
   */
  function grantRow(entry) {
    const row = el('div', 'trade_ad_picker_row');

    /* The badge drawings, in the 44px column the item rows use for a
     * thumbnail. Capped so a player with a dozen badges cannot stretch the
     * row - the names are listed underneath anyway. */
    const slot = el('div', 'd-flex align-items-center');
    slot.style.minWidth = '44px';
    entry.badges.slice(0, 3).forEach(id => {
      const icon = BADGES && BADGES.iconNode ? BADGES.iconNode(id) : null;
      if (!icon) return;
      icon.setAttribute('title', badgeName(id));
      slot.appendChild(icon);
    });
    row.appendChild(slot);

    const text = el('div', 'flex-grow-1');
    text.appendChild(el('div', 'text-truncate', entry.name));
    const names = entry.badges.map(badgeName).join(', ');
    const sub = el('div', 'small', entry.grantedBy
      ? `${names} \u00b7 set by ${entry.grantedBy}`
      : names);
    sub.style.color = '#7a8288';
    text.appendChild(sub);
    row.appendChild(text);

    /* Tapping a row loads the player into the editor above, which is quicker
     * and safer than retyping a username. */
    row.style.cursor = 'pointer';
    row.addEventListener('click', () => {
      if (dom.badgeName) dom.badgeName.value = entry.name;
      chooseBadge(entry.badges[0] || '');
    });
    return row;
  }

  function renderGrants() {
    if (!dom.badgesList) return;
    dom.badgesList.replaceChildren();

    /* Only players who actually hold something. The server keeps an empty row
     * behind the scenes to remember a badge being taken back, and that is
     * bookkeeping rather than something to show. */
    const rows = state.grants.filter(entry => entry.badges && entry.badges.length);
    if (!rows.length) {
      const empty = el('div', 'small py-2', 'Nobody has been given a badge yet.');
      empty.style.color = '#7a8288';
      dom.badgesList.appendChild(empty);
      return;
    }
    rows.forEach(entry => dom.badgesList.appendChild(grantRow(entry)));
  }

  async function loadGrants() {
    try {
      const payload = await apiCall('/api/badges');
      state.grants = Array.isArray(payload.grants) ? payload.grants : [];
    } catch (error) {
      state.grants = [];
      notice(dom.badgesNotice, error.message, 'bad');
    }
    renderGrants();
  }

  /* `granted` false takes the badge back. Both buttons come through here so
   * the two paths cannot drift apart. */
  async function saveBadge(granted) {
    const target = dom.badgeName ? dom.badgeName.value.trim() : '';
    if (!target) {
      notice(dom.badgesNotice, 'Type the username you are awarding.', 'bad');
      return;
    }
    if (!state.badgeChoice) {
      notice(dom.badgesNotice, 'Choose a badge first.', 'bad');
      return;
    }

    const label = badgeName(state.badgeChoice);
    notice(dom.badgesNotice, 'Saving...');
    try {
      const payload = await apiCall('/api/badges/set', {
        method: 'POST',
        body: JSON.stringify({
          name: state.account.name,
          target,
          badge: state.badgeChoice,
          granted,
        }),
      });
      state.grants = Array.isArray(payload.grants) ? payload.grants : state.grants;
      renderGrants();

      /* Pull the public table back so the leaderboard and the profiles in
       * other tabs agree with what was actually stored. */
      if (GRANTED && typeof GRANTED.refresh === 'function') await GRANTED.refresh();

      notice(
        dom.badgesNotice,
        granted
          ? `${target} now has ${label}.`
          : `${target} no longer has ${label}.`,
        'good',
      );
      if (dom.badgeName) dom.badgeName.value = '';
      chooseBadge('');
    } catch (error) {
      notice(dom.badgesNotice, error.message, 'bad');
      if (/sign in/i.test(error.message)) {
        writeToken('');
        renderPanes();
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Item values                                                         */
  /* ------------------------------------------------------------------ */

  function chooseDemand(demand) {
    state.demand = demand === 'None' ? '' : (demand || '');
    if (!dom.demandChoices) return;
    dom.demandChoices.querySelectorAll('[data-demand-value]').forEach(button => {
      const value = button.dataset.demandValue;
      setPressed(button, state.demand ? value === state.demand : value === 'None');
    });
  }

  function chooseTrend(trend) {
    state.trend = trend === 'None' ? '' : (trend || '');
    if (!dom.trendChoices) return;
    dom.trendChoices.querySelectorAll('[data-trend-value]').forEach(button => {
      const value = button.dataset.trendValue;
      setPressed(button, state.trend ? value === state.trend : value === 'None');
    });
  }

  /* How the value was arrived at. The item page prints this under the
   * valuation heading, and /api/values/set has always accepted it - there was
   * simply no control here to set it with. */
  function chooseMethod(method) {
    state.method = method === 'None' ? '' : (method || '');
    if (!dom.methodChoices) return;
    dom.methodChoices.querySelectorAll('[data-method-value]').forEach(button => {
      const value = button.dataset.methodValue;
      setPressed(button, state.method ? value === state.method : value === 'None');
    });
  }

  function renderCategories() {
    if (!dom.categoryChoices) return;
    dom.categoryChoices.querySelectorAll('[data-category-value]').forEach(button => {
      setPressed(button, state.categories.has(button.dataset.categoryValue));
    });
  }

  /* Fill the editor from whatever is already stored for this item, so saving
   * without touching a field leaves it as it was. */
  function loadItemIntoEditor(item) {
    state.item = item;

    if (dom.valueImage) {
      dom.valueImage.src = item.thumbnail || (API ? API.thumbnailUrl(item.id) : '');
      dom.valueImage.alt = item.name || '';
    }
    if (dom.valueName) dom.valueName.textContent = item.name || `Item ${item.id}`;
    if (dom.valueStats) {
      const rap = Number.isFinite(item.rap) ? formatNumber(item.rap) : '-';
      dom.valueStats.textContent = `Item ${item.id} \u00b7 RAP ${rap}`;
    }

    const stored = VALUES ? VALUES.get(item.id) : 0;
    if (dom.valueAmount) dom.valueAmount.value = stored ? String(stored) : '';

    chooseDemand(VALUES ? VALUES.demand(item.id) : '');
    chooseTrend(VALUES ? VALUES.trend(item.id) : '');
    /* Read defensively: a browser holding an older cached values.js has
     * neither accessor, and a missing one must not stop the editor filling. */
    chooseMethod(VALUES && typeof VALUES.method === 'function' ? VALUES.method(item.id) : '');
    if (dom.valueNote) {
      dom.valueNote.value = VALUES && typeof VALUES.note === 'function'
        ? (VALUES.note(item.id) || '')
        : '';
    }

    state.categories = new Set();
    if (VALUES && typeof VALUES.categories === 'function') {
      /* 'valued' is derived by values.js rather than stored, so it is not one
       * of the chips and must not be sent back. */
      VALUES.categories(item.id)
        .filter(name => name !== 'valued')
        .forEach(name => state.categories.add(name));
    }
    renderCategories();

    notice(dom.valuesNotice, '');
  }

  async function saveValue() {
    if (!state.item) {
      notice(dom.valuesNotice, 'Choose an item first.', 'bad');
      return;
    }

    const raw = dom.valueAmount ? dom.valueAmount.value.trim() : '';
    const amount = raw === '' ? 0 : Number(raw.replace(/,/g, ''));
    if (!Number.isFinite(amount) || amount < 0) {
      notice(dom.valuesNotice, 'Value must be a number, zero or more.', 'bad');
      return;
    }

    notice(dom.valuesNotice, 'Saving...');
    try {
      await apiCall('/api/values/set', {
        method: 'POST',
        body: JSON.stringify({
          name: state.account.name,
          id: state.item.id,
          value: amount,
          demand: state.demand || null,
          trend: state.trend || null,
          method: state.method || null,
          note: dom.valueNote ? dom.valueNote.value.trim() : '',
          categories: [...state.categories],
        }),
      });
      /* Pull the table back so the rest of the site - and this editor - agree
       * with what was actually stored. */
      if (VALUES && typeof VALUES.refresh === 'function') await VALUES.refresh();
      notice(dom.valuesNotice, `Saved ${state.item.name || `item ${state.item.id}`}.`, 'good');
    } catch (error) {
      notice(dom.valuesNotice, error.message, 'bad');
      if (/sign in/i.test(error.message)) {
        writeToken('');
        renderPanes();
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Item picker - the trade ad composer's modal                         */
  /* ------------------------------------------------------------------ */

  /* Bootstrap's JS is not loaded on this site, so modals are shown by hand
   * the same way the rest of the pages do it. */
  function showModal(modal, open) {
    if (!modal) return;
    modal.classList.toggle('show', open);
    modal.style.display = open ? 'block' : 'none';
    modal.setAttribute('aria-hidden', open ? 'false' : 'true');
    document.body.classList.toggle('modal-open', open);
  }

  function pickerRow(item) {
    const row = el('div', 'trade_ad_picker_row');
    const img = el('img');
    img.width = 44;
    img.height = 44;
    img.loading = 'lazy';
    img.alt = '';
    img.src = item.thumbnail || (API ? API.thumbnailUrl(item.id) : '');
    row.appendChild(img);

    const text = el('div', 'flex-grow-1');
    text.appendChild(el('div', 'text-truncate', item.name));
    const value = VALUES ? VALUES.get(item.id) : 0;
    const stats = el('div', 'small', `Value ${value ? formatNumber(value) : '-'} `
      + `\u00b7 RAP ${Number.isFinite(item.rap) ? formatNumber(item.rap) : '-'}`);
    stats.style.color = '#7a8288';
    text.appendChild(stats);
    row.appendChild(text);

    row.addEventListener('click', () => {
      loadItemIntoEditor(item);
      showModal(dom.pickerModal, false);
    });
    return row;
  }

  async function runPickerSearch(keyword) {
    if (!dom.pickerResults) return;
    const sequence = (state.pickerSequence += 1);

    dom.pickerResults.replaceChildren();
    const loading = el('div', 'text-center py-4 small', 'Loading items...');
    loading.style.color = '#7a8288';
    dom.pickerResults.appendChild(loading);

    let items = [];
    try {
      const search = await API.searchItems({ keyword, limit: SEARCH_LIMIT, cursor: 0 });
      if (search.ids.length) {
        const details = await API.getItemDetails(search.ids, { includePrice: false });
        items = details.filter(item => item && item.name);
      }
    } catch (error) {
      if (sequence !== state.pickerSequence) return;
      dom.pickerResults.replaceChildren();
      const failed = el('div', 'text-center py-4 small', 'Wanwood could not be reached.');
      failed.style.color = '#7a8288';
      dom.pickerResults.appendChild(failed);
      return;
    }

    /* A slower earlier search must not overwrite a newer one. */
    if (sequence !== state.pickerSequence) return;

    dom.pickerResults.replaceChildren();
    if (!items.length) {
      const empty = el('div', 'text-center py-4 small', 'No items matched that.');
      empty.style.color = '#7a8288';
      dom.pickerResults.appendChild(empty);
      return;
    }
    items.forEach(item => dom.pickerResults.appendChild(pickerRow(item)));
  }

  function openPicker() {
    if (dom.pickerSearch) dom.pickerSearch.value = '';
    showModal(dom.pickerModal, true);
    runPickerSearch('');
    if (dom.pickerSearch) dom.pickerSearch.focus();
  }

  /* ------------------------------------------------------------------ */
  /* Backend session                                                     */
  /* ------------------------------------------------------------------ */

  async function signIn() {
    const key = dom.keyBox ? dom.keyBox.value : '';
    if (!key) {
      notice(dom.keyNotice, 'Enter the admin key.', 'bad');
      return;
    }
    notice(dom.keyNotice, 'Checking...');
    try {
      const payload = await apiCall('/api/login', {
        method: 'POST',
        body: JSON.stringify({ key, name: state.account.name }),
      });
      writeToken(payload.token);
      if (dom.keyBox) dom.keyBox.value = '';
      notice(dom.keyNotice, 'Signed in. Changes will be saved.', 'good');
      renderPanes();
    } catch (error) {
      notice(dom.keyNotice, error.message, 'bad');
    }
  }

  function signOut() {
    writeToken('');
    notice(dom.keyNotice, 'Signed out of the admin session.');
    renderPanes();
  }

  /* What may this account do? The backend decides; the local owners list is
   * only the stand-in used while it is being asked, and if it cannot be
   * reached at all. A reply that does not carry the permission flags is not a
   * reply from this API - a cold proxy answers with all sorts of things - so
   * it counts as unreachable rather than as "no permissions". */
  async function loadMe(name) {
    try {
      const payload = await apiCall(`/api/me?name=${encodeURIComponent(name)}`);
      if (typeof payload.canSetValues !== 'boolean') throw new Error('unrecognised reply');
      state.me = payload;
    } catch (error) {
      const owner = Boolean(CONFIG && CONFIG.isOwner(name));
      state.me = {
        name,
        role: owner ? 'owner' : null,
        canGrantRoles: owner,
        canSetValues: owner,
        offline: true,
      };
    }
    applyAccess();
  }

  /* The panel belongs to whoever has a rank. Everybody else is told plainly
   * that they have none, rather than being shown controls that would be
   * refused the moment they were used. */
  function applyAccess() {
    const account = state.account;
    if (!account) return;
    if (!state.me || !state.me.role) {
      showLocked(`${account.name} is not an owner or value team member on this site.`);
      return;
    }
    showDashboard(account);
    renderPermissions();
    renderPanes();
    if (canGrantRoles()) {
      loadRoles();
      loadGrants();
    }
  }

  /* ------------------------------------------------------------------ */
  /* Wiring                                                              */
  /* ------------------------------------------------------------------ */

  function bind() {
    dom.keyButton?.addEventListener('click', () => {
      if (state.token) signOut();
      else signIn();
    });
    dom.keyBox?.addEventListener('keydown', event => {
      if (event.key === 'Enter') signIn();
    });

    dom.roleChoices?.querySelectorAll('[data-role-value]').forEach(button => {
      button.addEventListener('click', () => {
        chooseRole(button.dataset.roleValue === state.roleChoice ? '' : button.dataset.roleValue);
      });
    });
    dom.roleSave?.addEventListener('click', saveRole);

    /* The chips themselves are wired as they are built, in
     * renderBadgeChoices() - there is no markup for them until then. */
    dom.badgeGive?.addEventListener('click', () => saveBadge(true));
    dom.badgeTake?.addEventListener('click', () => saveBadge(false));

    dom.valueChoose?.addEventListener('click', openPicker);
    dom.pickerClose?.addEventListener('click', () => showModal(dom.pickerModal, false));
    dom.pickerModal?.querySelectorAll('[data-dismiss="modal"]').forEach(button => {
      button.addEventListener('click', () => showModal(dom.pickerModal, false));
    });
    dom.pickerModal?.addEventListener('click', event => {
      if (event.target === dom.pickerModal) showModal(dom.pickerModal, false);
    });

    let pickerTimer = null;
    dom.pickerSearch?.addEventListener('input', () => {
      window.clearTimeout(pickerTimer);
      pickerTimer = window.setTimeout(() => runPickerSearch(dom.pickerSearch.value.trim()), 250);
    });

    dom.demandChoices?.querySelectorAll('[data-demand-value]').forEach(button => {
      button.addEventListener('click', () => chooseDemand(button.dataset.demandValue));
    });
    dom.trendChoices?.querySelectorAll('[data-trend-value]').forEach(button => {
      button.addEventListener('click', () => chooseTrend(button.dataset.trendValue));
    });
    dom.methodChoices?.querySelectorAll('[data-method-value]').forEach(button => {
      button.addEventListener('click', () => chooseMethod(button.dataset.methodValue));
    });
    dom.categoryChoices?.querySelectorAll('[data-category-value]').forEach(button => {
      button.addEventListener('click', () => {
        const name = button.dataset.categoryValue;
        if (state.categories.has(name)) state.categories.delete(name);
        else state.categories.add(name);
        renderCategories();
      });
    });
    dom.valueSave?.addEventListener('click', saveValue);
  }

  function render() {
    const account = ACCOUNT ? ACCOUNT.get() : null;
    state.account = account;
    state.me = null;

    if (!account) {
      showLocked('Link your Wanwood account to open the admin panel.');
      return;
    }

    /* Show the panel straight away to a name the site already knows is an
     * owner, so the usual case does not flicker through a locked screen while
     * the backend is asked. Anyone else waits for the answer. */
    if (CONFIG && CONFIG.isOwner(account.name)) {
      showDashboard(account);
      renderPanes();
    } else {
      showLocked('Checking what this account is allowed to do...');
    }
    loadMe(account.name);
  }

  let booted = false;

  function init() {
    if (booted) return;
    if (!document.body.classList.contains('page-admin')) return;
    cacheDom();
    if (!dom.dashboard) return;
    booted = true;
    bind();
    renderBadgeChoices();
    chooseDemand('');
    chooseTrend('');
    chooseMethod('');
    /* Verifying or signing out in another tab flips the gate. */
    ACCOUNT?.subscribe(render);
    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
