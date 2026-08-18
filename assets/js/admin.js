/*
 * Admin panel - /admin
 *
 * The panel has no key, but it is not for everybody either. One top bar with
 * the way back out, one shared sidebar, and one page per function:
 *
 *   Dashboard      the stat wall, the newest value changes and trade ads
 *   Item Values    set value, demand, trend, method, categories and the note
 *   Staff Ranks    the roster - Site Owner, Value Manager, Value Team
 *   Player Badges  hand out the badges nothing can work out itself
 *   Trade Ads      moderate the public board - take any ad down
 *   Change Log     every value/demand/trend edit, newest first
 *   Public API     the keyless JSON API this server answers, live links
 *   Server         what the backend reports about itself
 *
 * ---------------------------------------------------------------------------
 * WHO IS ALLOWED TO DO WHAT
 * ---------------------------------------------------------------------------
 * The roster is the door. Every visitor can open the panel and look at the
 * dashboard, the change log and the API page, but the functions are locked:
 *
 *   Item Values          owner, value manager or value team
 *   Staff Ranks/Badges   site owners
 *   Trade Ads, Server    anyone with any rank at all
 *
 * The check is made twice. The panel hides controls the visitor cannot use,
 * and the backend re-checks the roster on every write - so editing this file
 * changes nothing about what actually saves. Linking is done on /verify.
 */
(() => {
  'use strict';

  const API = window.WanwoodAPI;
  const ACCOUNT = window.WolimonsAccount;
  const VALUES = window.WolimonsValues;
  const ROLE_ICONS = window.WolimonsRoleIcons;
  /* The badge catalog (names, tiers, artwork) and the table of who has been
   * given what. The panel is the only place the second one is written. */
  const BADGES = window.WolimonsBadges;
  const GRANTED = window.WolimonsGrantedBadges;

  const API_BASE = (window.WOLIMONS_CONFIG && window.WOLIMONS_CONFIG.apiBase) || '';
  const SEARCH_LIMIT = 60;

  /*
   * THE SIDEBAR - one list, every page of the panel reads it.
   *
   * `need` says which roster level unlocks the page's function:
   *   'grant' - owners only, 'value' - the value team and up,
   *   'role'  - any rank at all. Absent means the page is open to look at.
   */
  /* Every page is gated - the panel is for whitelisted admins only, and the
   * whitelist is the staff roster the server checks on every write. 'role'
   * means any rank at all, 'value' the value team and up, 'grant' owners. */
  const PAGES = [
    { id: 'dashboard', label: 'Dashboard', section: 'Overview', need: 'role' },
    { id: 'values', label: 'Item Values', section: 'Editing', need: 'value' },
    { id: 'roles', label: 'Staff Ranks', section: 'Editing', need: 'grant' },
    { id: 'badges', label: 'Player Badges', section: 'Editing', need: 'grant' },
    { id: 'ads', label: 'Trade Ads', section: 'Moderation', need: 'role' },
    { id: 'changes', label: 'Change Log', section: 'Moderation', need: 'role' },
    { id: 'api', label: 'Public API', section: 'Site', need: 'role' },
    { id: 'server', label: 'Server', section: 'Site', need: 'role' },
  ];

  /* The public API's own table, for the Public API page. Kept in step with
   * proxy/api.js - that file serves the machine-readable copy at /api, and
   * /apidocs is the human one. */
  const PUBLIC_ENDPOINTS = [
    ['/api/v1/itemdetails', 'Every tracked item: name, value, demand, trend, valuation method, categories, RAP and lowest ask. Cached ten minutes.'],
    ['/api/v1/values', 'The raw value table this site runs on, keyed by item id.'],
    ['/api/v1/valuechanges', 'The value change log, newest first. Add ?limit= and ?since= to narrow it.'],
    ['/api/v1/playerinfo/&lt;userId&gt;', 'One Wanwood player: name, staff role and granted badges.'],
    ['/api/v1/getrecentads', 'The trade ad board, newest first. Add ?limit= to narrow it.'],
    ['/api/v1/roles', 'The staff roster.'],
    ['/api/v1/badges', 'Badges handed out by the site. Add ?name= to ask about one player.'],
    ['/api', 'The machine-readable index of every endpoint above.'],
  ];

  const dom = {};

  const state = {
    account: null,
    /* What the backend says the linked account may do. Null until it
     * answers, or when no account is linked. */
    me: null,
    page: 'dashboard',
    /* The rank editor's pending selection. */
    roleChoice: '',
    /* The badge editor's pending selection. */
    badgeChoice: '',
    /* The item being valued, and the row as it currently reads. */
    item: null,
    demand: '',
    trend: '',
    method: '',
    categories: new Set(),
    pickerSequence: 0,
    /* What has already been loaded this visit. */
    loaded: new Set(),
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

  /* The name a change is saved under. The server checks it against the
   * roster before it saves anything. */
  function actorName() {
    return state.account && state.account.name ? state.account.name : '';
  }

  const roleLabel = role => (ROLE_ICONS && role ? ROLE_ICONS.label(role) : (role || 'None'));

  /* The same UTC wording the trade ad detail page prints. */
  function utcTimestamp(timestamp) {
    const when = new Date(Number(timestamp));
    if (!timestamp || Number.isNaN(when.getTime())) return '-';
    const pad = number => String(number).padStart(2, '0');
    return `${when.getUTCFullYear()}-${pad(when.getUTCMonth() + 1)}-${pad(when.getUTCDate())}, `
      + `${pad(when.getUTCHours())}:${pad(when.getUTCMinutes())}:${pad(when.getUTCSeconds())} UTC`;
  }

  function ago(timestamp) {
    const seconds = Math.max(0, Math.floor((Date.now() - Number(timestamp)) / 1000));
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
    const days = Math.floor(hours / 24);
    return `${days} day${days === 1 ? '' : 's'} ago`;
  }

  function uptimeText(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const days = Math.floor(total / 86400);
    const hours = Math.floor((total % 86400) / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const parts = [];
    if (days) parts.push(`${days}d`);
    if (hours || days) parts.push(`${hours}h`);
    parts.push(`${minutes}m`);
    return parts.join(' ');
  }

  function notice(target, message, tone) {
    if (!target) return;
    target.textContent = message || '';
    target.style.color = tone === 'bad' ? '#e57373'
      : tone === 'good' ? '#81c784'
        : '#7a8288';
  }

  function emptyRow(target, message) {
    if (!target) return;
    target.replaceChildren();
    const empty = el('div', 'small py-2', message);
    empty.style.color = '#7a8288';
    target.appendChild(empty);
  }

  /* Toggle one of the catalog's filter chips. */
  function setPressed(button, on) {
    if (!button) return;
    button.setAttribute('aria-pressed', on ? 'true' : 'false');
    button.classList.toggle('active', Boolean(on));
  }

  async function apiCall(path, options = {}) {
    /* Every write is checked server-side against the roster, and the proof
     * that this browser is who it claims is the identity token from
     * /verify - so it rides along on every call. */
    const token = ACCOUNT && typeof ACCOUNT.getToken === 'function' ? ACCOUNT.getToken() : '';
    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
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
    if (!response.ok || payload.ok === false || payload.success === false) {
      throw new Error(payload.error || `The backend refused that (${response.status}).`);
    }
    return payload;
  }

  function cacheDom() {
    dom.topbarStatus = document.getElementById('admin_topbar_status');
    dom.nav = document.getElementById('admin_nav');

    dom.dashboardAccount = document.getElementById('admin_dashboard_account');
    dom.greeting = document.getElementById('admin_greeting');
    dom.identityPane = document.getElementById('admin_identity_pane');
    dom.avatar = document.getElementById('admin_avatar');
    dom.username = document.getElementById('admin_username');
    dom.userId = document.getElementById('admin_user_id');
    dom.permissions = document.getElementById('admin_permissions');
    dom.verifiedAt = document.getElementById('admin_verified_at');
    dom.statsGrid = document.getElementById('admin_stats_grid');
    dom.dashChanges = document.getElementById('admin_dash_changes');
    dom.dashAds = document.getElementById('admin_dash_ads');
    dom.dashEconomy = document.getElementById('admin_dash_economy');

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

    dom.valueText = document.getElementById('admin_value_text');
    dom.valueTextApply = document.getElementById('admin_value_text_apply');
    dom.valueTextNotice = document.getElementById('admin_value_text_notice');
    dom.valueTextResults = document.getElementById('admin_value_text_results');

    dom.roleName = document.getElementById('admin_role_name');
    dom.roleChoices = document.getElementById('admin_role_choices');
    dom.roleSave = document.getElementById('admin_role_save');
    dom.rolesNotice = document.getElementById('admin_roles_notice');
    dom.rolesList = document.getElementById('admin_roles_list');

    dom.badgeName = document.getElementById('admin_badge_name');
    dom.badgeChoices = document.getElementById('admin_badge_choices');
    dom.badgeGive = document.getElementById('admin_badge_give');
    dom.badgeTake = document.getElementById('admin_badge_take');
    dom.badgesNotice = document.getElementById('admin_badges_notice');
    dom.badgesList = document.getElementById('admin_badges_list');

    dom.adsRefresh = document.getElementById('admin_ads_refresh');
    dom.adsNotice = document.getElementById('admin_ads_notice');
    dom.adsList = document.getElementById('admin_ads_list');

    dom.changesRefresh = document.getElementById('admin_changes_refresh');
    dom.changesList = document.getElementById('admin_changes_list');

    dom.apiBase = document.getElementById('admin_api_base');
    dom.apiList = document.getElementById('admin_api_list');

    dom.serverRefresh = document.getElementById('admin_server_refresh');
    dom.serverList = document.getElementById('admin_server_list');

    dom.pickerModal = document.getElementById('item_select_modal');
    dom.pickerSearch = document.getElementById('item_select_search_textbox');
    dom.pickerResults = document.getElementById('item_select_results');
    dom.pickerClose = document.getElementById('item_select_clear_button');
  }

  /* ------------------------------------------------------------------ */
  /* Access - the roster is the door                                     */
  /* ------------------------------------------------------------------ */

  const canGrant = () => Boolean(state.me && state.me.canGrantRoles);
  const canValue = () => Boolean(state.me && state.me.canSetValues);
  const hasRole = () => Boolean(state.me && state.me.role);
  /* The server proves who is writing with the identity token from /verify,
   * so a ranked account whose proof has expired is locked out too - the
   * panel says so instead of letting every save fail. */
  const identityToken = () => (ACCOUNT && typeof ACCOUNT.getToken === 'function'
    ? ACCOUNT.getToken()
    : '');

  function allowedFor(need) {
    if (!need) return true;
    if (!identityToken()) return false;
    if (need === 'grant') return canGrant();
    if (need === 'value') return canValue();
    return hasRole();
  }

  /*
   * What the backend says about the linked account. Asked fresh whenever the
   * account changes, because a promotion takes effect on the server first
   * and in the panel second.
   */
  async function loadAccess() {
    const account = state.account;
    state.me = null;
    if (account && account.name) {
      try {
        const payload = await apiCall(`/api/me?name=${encodeURIComponent(account.name)}`);
        if (typeof payload.canSetValues === 'boolean') state.me = payload;
      } catch (error) {
        state.me = null;
      }
    }
    renderIdentity();
    applyLocks();
  }

  /* One lock pane per gated page: what is missing, and how to get it. */
  function lockText(need) {
    if (!state.account) {
      return {
        message: 'These functions are locked to Wolimons admins.',
        link: true,
        hint: ' first, then come back.',
      };
    }
    if (!hasRole()) {
      return {
        message: `${state.account.name} is not on the staff whitelist, so these functions stay locked.`,
        link: false,
        hint: '',
      };
    }
    if (!identityToken()) {
      return {
        message: `${state.account.name} is whitelisted, but the verification for this browser has expired, so these functions stay locked.`,
        link: true,
        hint: ' again to unlock them.',
      };
    }
    if (need === 'grant') {
      return {
        message: `Only a Site Owner may do this. ${state.account.name} is ${roleLabel(state.me.role)}.`,
        link: false,
        hint: '',
      };
    }
    if (need === 'value') {
      return {
        message: `Only the value team and up may do this. ${state.account.name} is ${roleLabel(state.me.role)}.`,
        link: false,
        hint: '',
      };
    }
    return { message: 'These functions are locked to Wolimons admins.', link: false, hint: '' };
  }

  function applyLocks() {
    PAGES.forEach(page => {
      const section = document.getElementById(`admin_page_${page.id}`);
      if (!section) return;
      const lock = section.querySelector('.admin_page_lock');
      const body = section.querySelector('.admin_page_body');
      if (!lock || !body) return;

      const allowed = allowedFor(page.need);
      lock.classList.toggle('d-none', allowed);
      body.classList.toggle('d-none', !allowed);
      if (!allowed) {
        const words = lockText(page.need);
        const message = lock.querySelector('.admin_lock_message');
        const link = lock.querySelector('.admin_lock_link');
        const hint = lock.querySelector('.admin_lock_hint');
        if (message) message.textContent = words.message;
        if (link) link.classList.toggle('d-none', !words.link);
        if (hint) hint.textContent = words.hint;
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* Sidebar - built once from the shared list                           */
  /* ------------------------------------------------------------------ */

  function buildSidebar() {
    if (!dom.nav) return;
    dom.nav.replaceChildren();

    let section = '';
    PAGES.forEach(page => {
      if (page.section !== section) {
        section = page.section;
        const label = el('div', 'admin_nav_section', section.toUpperCase());
        label.setAttribute('aria-hidden', 'true');
        dom.nav.appendChild(label);
      }
      const button = el('button', 'filter-button btn btn-primary admin_nav_button', page.label);
      button.type = 'button';
      button.dataset.page = page.id;
      button.setAttribute('aria-pressed', 'false');
      /* The lock glyph on gated entries - a small padlock, drawn with the
       * same currentColor trick the rest of the icons use. */
      if (page.need) {
        const lockIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        lockIcon.setAttribute('viewBox', '0 0 24 24');
        lockIcon.setAttribute('aria-hidden', 'true');
        lockIcon.style.width = '0.95em';
        lockIcon.style.height = '0.95em';
        lockIcon.style.marginLeft = '6px';
        lockIcon.style.verticalAlign = '-2px';
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', 'M12 2a5 5 0 0 1 5 5v3h1a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h1V7a5 5 0 0 1 5-5zm3 8V7a3 3 0 0 0-6 0v3h6z');
        path.setAttribute('fill', 'currentColor');
        lockIcon.appendChild(path);
        button.appendChild(lockIcon);
      }
      button.addEventListener('click', () => {
        if (window.location.hash !== `#${page.id}`) window.location.hash = page.id;
        else showPage(page.id);
      });
      dom.nav.appendChild(button);
    });
  }

  /* ------------------------------------------------------------------ */
  /* Pages - one per function, switched from the sidebar                 */
  /* ------------------------------------------------------------------ */

  function showPage(name) {
    const known = PAGES.some(page => page.id === name) ? name : 'dashboard';
    state.page = known;

    PAGES.forEach(page => {
      const section = document.getElementById(`admin_page_${page.id}`);
      if (section) section.classList.toggle('d-none', page.id !== known);
    });

    if (dom.nav) {
      dom.nav.querySelectorAll('[data-page]').forEach(button => {
        const active = button.dataset.page === known;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
    }

    /* Each page fills itself when it is shown - the locked ones only fill
     * what is unlocked. */
    const page = PAGES.find(entry => entry.id === known);
    const allowed = allowedFor(page ? page.need : null);
    if (known === 'dashboard' && allowed) loadDashboard();
    if (known === 'roles' && allowed && !state.loaded.has('roles')) loadRoles();
    if (known === 'badges' && allowed && !state.loaded.has('badges')) loadGrants();
    if (known === 'ads' && allowed) loadAds();
    if (known === 'changes' && allowed) loadChanges();
    if (known === 'api' && allowed && !state.loaded.has('api')) renderApiPage();
    if (known === 'server' && allowed) loadServer();

    window.scrollTo({ top: 0 });
  }

  function pageFromHash() {
    const match = /^#\/?([a-z]+)/.exec(window.location.hash || '');
    return match ? match[1] : 'dashboard';
  }

  /* ------------------------------------------------------------------ */
  /* Identity row                                                        */
  /* ------------------------------------------------------------------ */

  function renderIdentity() {
    const account = state.account;
    if (dom.topbarStatus) {
      dom.topbarStatus.textContent = !account
        ? 'Admin functions are locked to staff'
        : hasRole()
          ? `${account.name} \u00b7 ${roleLabel(state.me.role)}`
          : `${account.name} \u00b7 not on the staff roster`;
    }
    if (dom.greeting) {
      dom.greeting.textContent = account ? `Hello, ${account.name}!` : 'Hello!';
    }

    /* The headshot pane. Only for a linked account - the lock panes speak
     * for everyone else. */
    if (dom.identityPane) {
      dom.identityPane.classList.toggle('d-none', !account);
    }
    if (account) {
      if (dom.username) {
        dom.username.textContent = account.name;
        dom.username.title = account.name;
      }
      if (dom.userId) dom.userId.textContent = String(account.id);
      if (dom.verifiedAt) dom.verifiedAt.textContent = utcTimestamp(account.verifiedAt);
      if (dom.permissions) {
        dom.permissions.replaceChildren();
        const label = el('span', null, hasRole() ? roleLabel(state.me.role) : 'None');
        dom.permissions.appendChild(label);
        const icon = ROLE_ICONS && state.me ? ROLE_ICONS.iconFor(state.me.role) : null;
        if (icon) dom.permissions.appendChild(icon);
      }
      /* The headshot is a nicety - if Wanwood cannot be reached the pane
       * keeps the logo rather than a broken image. */
      if (dom.avatar && API && typeof API.fetchUserAvatar === 'function') {
        API.fetchUserAvatar(account.id, { size: 420 })
          .then(url => {
            if (url && dom.avatar) {
              dom.avatar.src = url;
              dom.avatar.alt = `${account.name} avatar`;
            }
          })
          .catch(() => {});
      }
    }

    if (dom.dashboardAccount) {
      dom.dashboardAccount.replaceChildren();
      if (!account) {
        dom.dashboardAccount.append('Admin functions are locked to staff - ');
        const link = el('a', 'admin_lock_link', 'link your Wanwood account');
        link.href = '/verify';
        dom.dashboardAccount.appendChild(link);
        dom.dashboardAccount.append(' to unlock them.');
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Dashboard                                                           */
  /* ------------------------------------------------------------------ */

  function statCell(header, value, title) {
    const cell = el('div', 'admin_stat_cell');
    const head = el('div', 'top-stat-header', header);
    if (title) head.title = title;
    const data = el('div', 'top-stat-data text-truncate', value);
    if (title) data.title = title;
    cell.appendChild(head);
    cell.appendChild(data);
    return cell;
  }

  /* One row of the change feed - the dashboard shows eight, the Change Log
   * page shows the long form. */
  function changeRow(change, long) {
    const row = el('div', 'trade_ad_picker_row');
    row.style.cursor = 'default';

    const text = el('div', 'flex-grow-1');
    const field = change.field === 'value' ? 'Value' : change.field === 'demand' ? 'Demand' : 'Trend';
    const format = value => {
      if (value === null || value === undefined || value === '') return 'unset';
      return change.field === 'value' ? formatNumber(value) : String(value);
    };

    const head = el('div', 'text-truncate');
    head.append(`Item ${change.id} \u00b7 ${field}: ${format(change.old)} \u2192 ${format(change.new)}`);
    text.appendChild(head);

    const sub = el('div', 'small text-truncate');
    sub.style.color = '#7a8288';
    sub.textContent = `${change.by || 'someone'} \u00b7 ${long ? utcTimestamp(change.at) : ago(change.at)}`;
    text.appendChild(sub);
    row.appendChild(text);

    const open = el('a', 'btn btn-flat-light-blue-sm rounded-pill my-auto', 'Item');
    open.href = `/item/?id=${change.id}`;
    open.setAttribute('role', 'button');
    row.appendChild(open);
    return row;
  }

  function adSummary(ad) {
    const side = list => {
      const slots = (list || []).filter(Boolean);
      return slots.map(slot => (slot.kind === 'tag' ? `[${slot.slug}]` : slot.name || `#${slot.id}`)).join(', ') || '-';
    };
    return `${side(ad.offer)}  \u2192  ${side(ad.request)}`;
  }

  function adRow(ad, { moderate }) {
    const row = el('div', 'trade_ad_picker_row');

    const text = el('div', 'flex-grow-1');
    const head = el('div', 'text-truncate', ad.creatorName);
    text.appendChild(head);
    const sub = el('div', 'small text-truncate', `${adSummary(ad)} \u00b7 ${ago(ad.createdAt)}`);
    sub.style.color = '#7a8288';
    text.appendChild(sub);
    row.appendChild(text);

    const open = el('a', 'btn btn-flat-light-blue-sm rounded-pill my-1 mx-1', 'View');
    open.href = `/tradead/?id=${encodeURIComponent(ad.id)}`;
    open.setAttribute('role', 'button');
    row.appendChild(open);

    if (moderate) {
      const remove = el('button', 'btn btn-flat-dark-gray-sm rounded-pill my-1 mx-1', 'Remove');
      remove.type = 'button';
      remove.addEventListener('click', async () => {
        remove.disabled = true;
        remove.textContent = 'Removing...';
        try {
          await apiCall('/api/ads/moderate', {
            method: 'POST',
            body: JSON.stringify({ id: ad.id, name: actorName() }),
          });
          loadAds();
        } catch (error) {
          notice(dom.adsNotice, error.message, 'bad');
          remove.disabled = false;
          remove.textContent = 'Remove';
        }
      });
      row.appendChild(remove);
    }
    return row;
  }

  async function loadDashboard() {
    /* Everything the wall is made of, asked for together. Each one can fail
     * on its own; a dead corner shows a dash rather than taking the page
     * down. */
    const [status, changes, ads, values] = await Promise.all([
      apiCall('/api/status').catch(() => null),
      apiCall('/api/changes?limit=8').catch(() => null),
      apiCall('/api/ads').catch(() => null),
      apiCall('/api/values').catch(() => null),
    ]);

    if (dom.statsGrid) {
      dom.statsGrid.replaceChildren();
      if (!status) {
        dom.statsGrid.appendChild(statCell('Backend', 'Unreachable', 'The proxy did not answer /api/status'));
      } else {
        dom.statsGrid.appendChild(statCell(
          'Items valued',
          `${formatNumber(status.valued)} / ${formatNumber(status.items)}`,
          'Items with a value above zero, out of every item the table knows',
        ));
        dom.statsGrid.appendChild(statCell('Value changes', formatNumber(status.changes), 'Edits recorded in the change log'));
        dom.statsGrid.appendChild(statCell('Trade ads live', formatNumber(status.ads), 'Ads currently on the public board'));
        dom.statsGrid.appendChild(statCell('Staff ranked', formatNumber(status.staff), 'Names on the staff roster'));
        dom.statsGrid.appendChild(statCell('Badges granted', formatNumber(status.badges), 'Players holding a hand-given badge'));
        dom.statsGrid.appendChild(statCell(
          'Storage',
          `${status.storage}${status.canWrite ? ' \u00b7 writable' : ' \u00b7 read-only'}`,
          String(status.location || ''),
        ));
        dom.statsGrid.appendChild(statCell('Upstream', status.upstream || '-', 'Where items and players come from'));
        dom.statsGrid.appendChild(statCell('Uptime', uptimeText(status.uptime), 'How long this server process has been running'));
      }
    }

    if (dom.dashChanges) {
      const rows = changes && Array.isArray(changes.changes) ? changes.changes : [];
      if (!rows.length) emptyRow(dom.dashChanges, 'No value changes have been made yet.');
      else {
        dom.dashChanges.replaceChildren();
        rows.forEach(change => dom.dashChanges.appendChild(changeRow(change, false)));
      }
    }

    if (dom.dashAds) {
      const rows = ads && Array.isArray(ads.ads) ? ads.ads.slice(0, 5) : [];
      if (!rows.length) emptyRow(dom.dashAds, 'Nobody has posted a trade ad yet.');
      else {
        dom.dashAds.replaceChildren();
        rows.forEach(ad => dom.dashAds.appendChild(adRow(ad, { moderate: false })));
      }
    }

    if (dom.dashEconomy) {
      const table = values && values.values && typeof values.values === 'object'
        ? values.values : {};
      /* The ten biggest values in the table, newest edit first on a tie.
       * These are the numbers the whole economy is keyed to, so they are the
       * ones to eyeball - a rogue 6,000,000 lands at the top of this list the
       * moment it is saved. */
      const rows = Object.entries(table)
        .map(([id, entry]) => ({
          id: Number(id),
          value: Number(entry && entry.value) || 0,
          updatedAt: Number(entry && entry.updatedAt) || 0,
          updatedBy: String((entry && entry.updatedBy) || ''),
        }))
        .filter(row => Number.isSafeInteger(row.id) && row.id > 0)
        .sort((a, b) => (b.value - a.value) || (b.updatedAt - a.updatedAt))
        .slice(0, 10);

      const total = Object.values(table)
        .reduce((sum, entry) => sum + (Number(entry && entry.value) || 0), 0);

      dom.dashEconomy.replaceChildren();
      if (!rows.filter(row => row.value > 0).length) {
        emptyRow(dom.dashEconomy, 'Nothing has been valued yet.');
      } else {
        rows.forEach(row => {
          const item = el('div', 'trade_ad_picker_row');
          item.style.cursor = 'default';

          const text = el('div', 'flex-grow-1');
          const head = el('div', 'text-truncate');
          const link = el('a', null, `Item ${row.id}`);
          link.href = `/item/?id=${row.id}`;
          link.target = '_blank';
          link.rel = 'noopener';
          link.style.color = '#e9ecef';
          head.appendChild(link);
          text.appendChild(head);
          const sub = el('div', 'small text-truncate', row.updatedBy
            ? `set by ${row.updatedBy} \u00b7 ${ago(row.updatedAt)}`
            : '');
          sub.style.color = '#7a8288';
          text.appendChild(sub);
          item.appendChild(text);

          const figure = el('div', 'top-stat-data text-nowrap my-auto',
            row.value ? formatNumber(row.value) : '-');
          figure.style.color = row.value >= 1000000 ? '#e57373' : '#e9ecef';
          item.appendChild(figure);

          dom.dashEconomy.appendChild(item);
        });

        const sum = el('div', 'small mt-2', `Total value in the table: ${formatNumber(total)}`);
        sum.style.color = '#7a8288';
        dom.dashEconomy.appendChild(sum);
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Ranks                                                               */
  /* ------------------------------------------------------------------ */

  function roleRow(entry) {
    const row = el('div', 'trade_ad_picker_row');

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
    row.addEventListener('click', () => {
      if (dom.roleName) dom.roleName.value = entry.name;
      chooseRole(entry.role);
    });
    return row;
  }

  function renderRoles() {
    if (!dom.rolesList) return;
    dom.rolesList.replaceChildren();
    if (!state.roles || !state.roles.length) {
      emptyRow(dom.rolesList, 'Nobody has been ranked yet.');
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
      state.loaded.add('roles');
    } catch (error) {
      state.roles = [];
      notice(dom.rolesNotice, error.message, 'bad');
    }
    renderRoles();
  }

  async function saveRole() {
    if (!canGrant()) {
      notice(dom.rolesNotice, 'Only a Site Owner may hand out ranks.', 'bad');
      return;
    }
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
          name: actorName(),
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
    }
  }

  /* ------------------------------------------------------------------ */
  /* Player badges                                                       */
  /* ------------------------------------------------------------------ */

  function grantableBadges() {
    if (!BADGES || !Array.isArray(BADGES.LIST)) return [];
    return BADGES.LIST.filter(badge => typeof badge.earn !== 'function');
  }

  const badgeName = id => {
    const badge = BADGES && BADGES.get ? BADGES.get(id) : null;
    return badge ? badge.name : id;
  };

  function renderBadgeChoices() {
    if (!dom.badgeChoices) return;
    dom.badgeChoices.replaceChildren();

    const list = grantableBadges();
    if (!list.length) {
      emptyRow(dom.badgeChoices, 'The badge catalog failed to load.');
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

  function grantRow(entry) {
    const row = el('div', 'trade_ad_picker_row');

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

    row.addEventListener('click', () => {
      if (dom.badgeName) dom.badgeName.value = entry.name;
      chooseBadge(entry.badges[0] || '');
    });
    return row;
  }

  function renderGrants() {
    if (!dom.badgesList) return;
    dom.badgesList.replaceChildren();

    const rows = (state.grants || []).filter(entry => entry.badges && entry.badges.length);
    if (!rows.length) {
      emptyRow(dom.badgesList, 'Nobody has been given a badge yet.');
      return;
    }
    rows.forEach(entry => dom.badgesList.appendChild(grantRow(entry)));
  }

  async function loadGrants() {
    try {
      const payload = await apiCall('/api/badges');
      state.grants = Array.isArray(payload.grants) ? payload.grants : [];
      state.loaded.add('badges');
    } catch (error) {
      state.grants = [];
      notice(dom.badgesNotice, error.message, 'bad');
    }
    renderGrants();
  }

  async function saveBadge(granted) {
    if (!canGrant()) {
      notice(dom.badgesNotice, 'Only a Site Owner may hand out badges.', 'bad');
      return;
    }
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
          name: actorName(),
          target,
          badge: state.badgeChoice,
          granted,
        }),
      });
      state.grants = Array.isArray(payload.grants) ? payload.grants : state.grants;
      renderGrants();

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
    chooseMethod(VALUES && typeof VALUES.method === 'function' ? VALUES.method(item.id) : '');
    if (dom.valueNote) {
      dom.valueNote.value = VALUES && typeof VALUES.note === 'function'
        ? (VALUES.note(item.id) || '')
        : '';
    }

    state.categories = new Set();
    if (VALUES && typeof VALUES.categories === 'function') {
      VALUES.categories(item.id)
        .filter(name => name !== 'valued')
        .forEach(name => state.categories.add(name));
    }
    renderCategories();

    notice(dom.valuesNotice, '');
  }

  async function saveValue() {
    if (!canValue()) {
      notice(dom.valuesNotice, 'Only the value team and up may save values.', 'bad');
      return;
    }
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

    /* The economy guard. A value this size moves every holder's profile
     * total, badges and leaderboard position the moment it is saved, so it
     * gets a deliberate pause - this is exactly how a 6,000,000 once got
     * set and had to be hunted back down. */
    if (amount >= 1000000) {
      const label = state.item.name || `item ${state.item.id}`;
      const sure = window.confirm(
        `Set ${label} to ${formatNumber(amount)}?\n\n`
        + 'A value this large changes every holder\'s total, badges and '
        + 'leaderboard position as soon as it is saved. Only confirm if the '
        + 'value team has really decided on it.',
      );
      if (!sure) {
        notice(dom.valuesNotice, 'Not saved.');
        return;
      }
    }

    notice(dom.valuesNotice, 'Saving...');
    try {
      await apiCall('/api/values/set', {
        method: 'POST',
        body: JSON.stringify({
          name: actorName(),
          id: state.item.id,
          value: amount,
          demand: state.demand || null,
          trend: state.trend || null,
          method: state.method || null,
          note: dom.valueNote ? dom.valueNote.value.trim() : '',
          categories: [...state.categories],
        }),
      });
      if (VALUES && typeof VALUES.refresh === 'function') await VALUES.refresh();
      notice(dom.valuesNotice, `Saved ${state.item.name || `item ${state.item.id}`}.`, 'good');
    } catch (error) {
      notice(dom.valuesNotice, error.message, 'bad');
    }
  }

  /* ------------------------------------------------------------------ */
  /* Paste a valuation                                                   */
  /* ------------------------------------------------------------------ */

  /*
   * The text form the value team writes valuations in:
   *
   *     red energy sword (res)
   *
   *     unvalued --> 325
   *
   *     demand --> low
   *
   *     trend --> unstable
   *
   *     explanation: sold for 100 and 150 robux, so unstable
   *
   * Every field after the name is optional; only the lines present are
   * applied, and anything left out keeps whatever the item already had.
   * The arrow may be written -->, ->, => or a real arrow character, and the
   * explanation may use a colon instead. An acronym in brackets after the
   * name is remembered as a backup search in case the full name finds
   * nothing.
   */
  const VALUE_ARROW = /-->|->|=>|\u2192/;
  const VALUE_VOCAB = {
    demand: ['High', 'Decent', 'Low', 'Terrible'],
    trend: ['Raising', 'Stable', 'Lowering', 'Unstable', 'Fluctuating'],
  };

  function matchVocab(raw, allowed) {
    const word = String(raw || '').trim().toLowerCase();
    if (!word) return null;
    const first = word.split(/\s+/)[0];
    return allowed.find(name => {
      const lower = name.toLowerCase();
      return lower === word || lower === first;
    }) || null;
  }

  function parseValuationText(raw) {
    const result = { title: '', acronym: '', searchName: '', fields: {}, note: '', problems: [] };
    let inNote = false;

    const parseLine = (line) => {
      const noteMatch = /^(?:explanation|note)\s*(?:-->|->|=>|:|\u2192)\s*(.*)$/i.exec(line);
      if (noteMatch) {
        const text = noteMatch[1].trim();
        if (text) result.note += (result.note ? ' ' : '') + text;
        inNote = true;
        return;
      }

      if (!VALUE_ARROW.test(line)) {
        /* The first plain line is the item. */
        if (!result.title) {
          result.title = line;
          const paren = /\(([^()]+)\)\s*$/.exec(line);
          if (paren) result.acronym = paren[1].trim();
          result.searchName = line.replace(/\s*\(([^()]+)\)\s*$/, '').trim();
        }
        return;
      }

      const halves = line.split(VALUE_ARROW);
      const key = halves[0].trim().toLowerCase();
      const value = halves.slice(1).join(' ').trim();

      if (/demand/.test(key)) {
        const demand = matchVocab(value, VALUE_VOCAB.demand);
        if (demand) result.fields.demand = demand;
        else result.problems.push(`could not read the demand \u201c${value}\u201d`);
      } else if (/trend/.test(key)) {
        const trend = matchVocab(value, VALUE_VOCAB.trend);
        if (trend) result.fields.trend = trend;
        else result.problems.push(`could not read the trend \u201c${value}\u201d`);
      } else if (/method|valuation/.test(key)) {
        if (/proof/i.test(value)) result.fields.method = 'proof';
        else if (/rap/i.test(value)) result.fields.method = 'rap';
        else result.problems.push(`could not read the valuation method \u201c${value}\u201d`);
      } else {
        /* "unvalued --> 325", "value --> 325", or any other label - the
         * number on the right is what matters. */
        const cleaned = value.replace(/,/g, '').replace(/\b(?:robux|r\$)\b.*$/i, '').trim();
        const amount = Number(cleaned);
        if (Number.isFinite(amount) && amount >= 0 && cleaned !== '') {
          result.fields.value = Math.round(amount);
        } else {
          result.problems.push(`could not read a value from \u201c${value}\u201d`);
        }
      }
    };

    String(raw || '').split(/\r?\n/).forEach(rawLine => {
      const line = rawLine.trim();
      if (!line) {
        /* A blank line ends an explanation's extra lines; the next real line
         * is parsed normally. */
        inNote = false;
        return;
      }
      if (inNote) {
        if (VALUE_ARROW.test(line) || /^(?:explanation|note)\b/i.test(line)) {
          inNote = false;
          parseLine(line);
        } else {
          result.note += (result.note ? ' ' : '') + line;
        }
        return;
      }
      parseLine(line);
    });

    return result;
  }

  async function searchValuationTargets(keyword) {
    const search = await API.searchItems({ keyword, limit: SEARCH_LIMIT, cursor: 0 });
    if (!search.ids.length) return [];
    const details = await API.getItemDetails(search.ids, { includePrice: false });
    return details.filter(item => item && item.name);
  }

  function valuationSummary(parsed) {
    const parts = [];
    if ('value' in parsed.fields) parts.push(`value ${formatNumber(parsed.fields.value)}`);
    if (parsed.fields.demand) parts.push(`demand ${parsed.fields.demand}`);
    if (parsed.fields.trend) parts.push(`trend ${parsed.fields.trend}`);
    if (parsed.fields.method) {
      parts.push(parsed.fields.method === 'proof' ? 'Proof-Based method' : 'RAP-Based method');
    }
    if (parsed.note) parts.push('explanation');
    return parts;
  }

  /* Apply the parsed fields to one item. Only the fields that were listed
   * go into the request, so everything else on the item's row is left
   * exactly as it was. */
  async function applyParsedToItem(item, parsed) {
    if ('value' in parsed.fields && parsed.fields.value >= 1000000) {
      const sure = window.confirm(
        `Set ${item.name} to ${formatNumber(parsed.fields.value)}?\n\n`
        + 'A value this large changes every holder\'s total, badges and '
        + 'leaderboard position as soon as it is saved.',
      );
      if (!sure) {
        notice(dom.valueTextNotice, 'Not saved.');
        return;
      }
    }

    notice(dom.valueTextNotice, `Saving ${item.name}...`);
    try {
      const body = { name: actorName(), id: item.id, ...parsed.fields };
      if (parsed.note) body.note = parsed.note;
      await apiCall('/api/values/set', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (VALUES && typeof VALUES.refresh === 'function') await VALUES.refresh();

      /* Show the result in the manual editor so it can be eyeballed. */
      loadItemIntoEditor(item);
      if (dom.valueText) dom.valueText.value = '';
      if (dom.valueTextResults) {
        dom.valueTextResults.replaceChildren();
        dom.valueTextResults.classList.add('d-none');
      }
      const skipped = parsed.problems.length
        ? ` (skipped: ${parsed.problems.join('; ')})`
        : '';
      notice(dom.valueTextNotice,
        `Saved ${item.name} - ${valuationSummary(parsed).join(', ')}.${skipped}`, 'good');
    } catch (error) {
      notice(dom.valueTextNotice, error.message, 'bad');
    }
  }

  function textMatchRow(item, parsed) {
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
    const stats = el('div', 'small',
      `Value ${VALUES && VALUES.get(item.id) ? formatNumber(VALUES.get(item.id)) : '-'} `
      + `\u00b7 RAP ${Number.isFinite(item.rap) ? formatNumber(item.rap) : '-'}`);
    stats.style.color = '#7a8288';
    text.appendChild(stats);
    row.appendChild(text);

    row.addEventListener('click', () => applyParsedToItem(item, parsed));
    return row;
  }

  async function applyValuationText() {
    const parsed = parseValuationText(dom.valueText ? dom.valueText.value : '');

    if (!parsed.title) {
      notice(dom.valueTextNotice, 'Start with the item name on its own line.', 'bad');
      return;
    }
    if (!Object.keys(parsed.fields).length && !parsed.note) {
      notice(dom.valueTextNotice,
        'Nothing to apply - add a value, demand, trend or explanation line.', 'bad');
      return;
    }

    if (dom.valueTextResults) {
      dom.valueTextResults.replaceChildren();
      dom.valueTextResults.classList.add('d-none');
    }
    notice(dom.valueTextNotice, `Looking for \u201c${parsed.searchName}\u201d...`);

    let items = [];
    try {
      items = await searchValuationTargets(parsed.searchName);
      if (!items.length && parsed.acronym) {
        items = await searchValuationTargets(parsed.acronym);
      }
    } catch (error) {
      notice(dom.valueTextNotice, 'Wanwood could not be reached. Try again in a moment.', 'bad');
      return;
    }

    if (!items.length) {
      notice(dom.valueTextNotice, `No item matched \u201c${parsed.searchName}\u201d.`, 'bad');
      return;
    }

    if (items.length === 1) {
      await applyParsedToItem(items[0], parsed);
      return;
    }

    /* Several candidates: make the human pick, so a wrong match is never
     * saved silently. */
    notice(dom.valueTextNotice,
      `${items.length} items matched - pick the right one to save the valuation:`,
      parsed.problems.length ? 'bad' : '');
    if (dom.valueTextResults) {
      items.slice(0, SEARCH_LIMIT).forEach(item => {
        dom.valueTextResults.appendChild(textMatchRow(item, parsed));
      });
      dom.valueTextResults.classList.remove('d-none');
    }
  }

  /* ------------------------------------------------------------------ */
  /* Trade ads                                                           */
  /* ------------------------------------------------------------------ */

  async function loadAds() {
    if (!dom.adsList) return;
    try {
      const payload = await apiCall('/api/ads');
      const ads = Array.isArray(payload.ads) ? payload.ads : [];
      dom.adsList.replaceChildren();
      if (!ads.length) {
        emptyRow(dom.adsList, 'The board is empty - nothing to moderate.');
        return;
      }
      ads.forEach(ad => dom.adsList.appendChild(adRow(ad, { moderate: true })));
      notice(dom.adsNotice, `${ads.length} ad${ads.length === 1 ? '' : 's'} on the board.`);
    } catch (error) {
      emptyRow(dom.adsList, 'The board could not be loaded.');
      notice(dom.adsNotice, error.message, 'bad');
    }
  }

  /* ------------------------------------------------------------------ */
  /* Change log                                                          */
  /* ------------------------------------------------------------------ */

  async function loadChanges() {
    if (!dom.changesList) return;
    try {
      const payload = await apiCall('/api/changes?limit=200');
      const rows = Array.isArray(payload.changes) ? payload.changes : [];
      dom.changesList.replaceChildren();
      if (!rows.length) {
        emptyRow(dom.changesList, 'Nothing has been changed yet.');
        return;
      }
      rows.forEach(change => dom.changesList.appendChild(changeRow(change, true)));
    } catch (error) {
      emptyRow(dom.changesList, 'The log could not be loaded.');
    }
  }

  /* ------------------------------------------------------------------ */
  /* Public API page                                                     */
  /* ------------------------------------------------------------------ */

  function renderApiPage() {
    if (dom.apiBase) {
      dom.apiBase.textContent = `${window.location.origin}/api/v1/...`;
    }
    if (!dom.apiList) return;
    dom.apiList.replaceChildren();

    PUBLIC_ENDPOINTS.forEach(([path, description]) => {
      const row = el('div', 'trade_ad_picker_row');
      row.style.cursor = 'default';

      const text = el('div', 'flex-grow-1');
      const head = el('div', 'text-truncate');
      const chip = el('span', 'small mr-2 px-1 rounded', 'GET');
      chip.style.backgroundColor = 'rgb(58, 63, 68)';
      chip.style.color = '#81c784';
      head.appendChild(chip);
      const code = el('span', null, '');
      /* The playerinfo path carries <userId> already escaped in the table. */
      code.innerHTML = path;
      code.style.color = '#e9ecef';
      head.appendChild(code);
      text.appendChild(head);
      const sub = el('div', 'small', description);
      sub.style.color = '#7a8288';
      text.appendChild(sub);
      row.appendChild(text);

      /* The playerinfo row needs an id to open; link the index instead so
       * the button is never a dead end. */
      const open = el('a', 'btn btn-flat-light-blue-sm rounded-pill my-auto', 'Open');
      open.href = path.includes('userId') ? '/api' : path;
      open.target = '_blank';
      open.rel = 'noopener';
      open.setAttribute('role', 'button');
      row.appendChild(open);

      dom.apiList.appendChild(row);
    });
    state.loaded.add('api');
  }

  /* ------------------------------------------------------------------ */
  /* Server page                                                         */
  /* ------------------------------------------------------------------ */

  function kvRow(key, value) {
    const row = el('div', 'admin_kv_row');
    row.appendChild(el('div', 'admin_kv_key', key));
    row.appendChild(el('div', 'admin_kv_val', value === undefined || value === null || value === '' ? '-' : String(value)));
    return row;
  }

  async function loadServer() {
    if (!dom.serverList) return;
    dom.serverList.replaceChildren();
    try {
      const status = await apiCall('/api/status');
      const rows = [
        ['Admin access', 'No key - writes are locked to the staff roster (owners rank and badge, the value team values, ranked members moderate).'],
        ['Source guard', status.protectSources === false ? 'off' : 'on - comments and blanks are stripped from served pages and scripts'],
        ['Storage', `${status.storage}${status.canWrite ? ' (writable)' : ' (read-only)'}`],
        ['Data location', status.location],
        ['Site root', status.siteRoot],
        ['Upstream', status.upstream],
        ['Node', status.node],
        ['Port', status.port],
        ['Uptime', `${uptimeText(status.uptime)} (since ${utcTimestamp(Date.now() - (status.uptime * 1000))})`],
        ['Items in the table', status.items],
        ['Items with a value', status.valued],
        ['Staff ranked', status.staff],
        ['Players with badges', status.badges],
        ['Trade ads live', status.ads],
        ['Logged changes', status.changes],
        ['Repo / branch', `${status.repo} @ ${status.branch}`],
      ];
      rows.forEach(([key, value]) => dom.serverList.appendChild(kvRow(key, value)));
    } catch (error) {
      dom.serverList.appendChild(kvRow('Backend', `Unreachable - ${error.message}`));
    }
  }

  /* ------------------------------------------------------------------ */
  /* Item picker - the trade ad composer's modal                         */
  /* ------------------------------------------------------------------ */

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
    if (!canValue()) return;
    if (dom.pickerSearch) dom.pickerSearch.value = '';
    showModal(dom.pickerModal, true);
    runPickerSearch('');
    if (dom.pickerSearch) dom.pickerSearch.focus();
  }

  /* ------------------------------------------------------------------ */
  /* Wiring                                                              */
  /* ------------------------------------------------------------------ */

  function bind() {
    /* The hash keeps the browser's back button and shared links honest:
     * /admin/#values opens straight on the Item Values page. */
    window.addEventListener('hashchange', () => showPage(pageFromHash()));

    dom.roleChoices?.querySelectorAll('[data-role-value]').forEach(button => {
      button.addEventListener('click', () => {
        chooseRole(button.dataset.roleValue === state.roleChoice ? '' : button.dataset.roleValue);
      });
    });
    dom.roleSave?.addEventListener('click', saveRole);

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
    dom.valueTextApply?.addEventListener('click', applyValuationText);

    dom.adsRefresh?.addEventListener('click', () => { if (hasRole()) loadAds(); });
    dom.changesRefresh?.addEventListener('click', loadChanges);
    dom.serverRefresh?.addEventListener('click', () => { if (hasRole()) loadServer(); });
  }

  function render() {
    state.account = ACCOUNT ? ACCOUNT.get() : null;
    state.loaded.delete('roles');
    state.loaded.delete('badges');
    loadAccess();
  }

  let booted = false;

  function init() {
    if (booted) return;
    if (!document.body.classList.contains('page-admin')) return;
    cacheDom();
    booted = true;
    buildSidebar();
    bind();
    renderBadgeChoices();
    chooseDemand('');
    chooseTrend('');
    chooseMethod('');
    /* Verifying or signing out in another tab flips the locks. */
    if (ACCOUNT && typeof ACCOUNT.subscribe === 'function') ACCOUNT.subscribe(render);
    render();
    showPage(pageFromHash());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
