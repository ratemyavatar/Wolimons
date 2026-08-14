/*
 * Admin dashboard - /admin
 *
 * Reached from the Admin entry in the navbar's More menu, which only appears
 * for an owner. Right now the dashboard is just the greeting: the owner's
 * headshot, "Hello, <name>", and the handful of facts Wolimons actually
 * knows about the signed-in account. Tools come later.
 *
 * ---------------------------------------------------------------------------
 * WHAT "OWNER" MEANS HERE
 * ---------------------------------------------------------------------------
 * It means the Wanwood username this browser has linked is on the owners
 * list in config.js. That is all it can mean: Wolimons is a static site with
 * no server of its own, so there is nobody to ask and nothing to check
 * against. The gate keeps the panel out of ordinary visitors' way - it is
 * not a security boundary, and anyone determined can walk straight past it
 * in their own browser. Nothing sensitive belongs behind it until there is a
 * backend that can enforce the answer.
 */
(() => {
  'use strict';

  const API = window.WanwoodAPI;
  const ACCOUNT = window.WolimonsAccount;
  const CONFIG = window.WOLIMONS_CONFIG;

  const dom = {};

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
  }

  /* The same UTC wording the trade ad detail page prints. */
  function utcTimestamp(timestamp) {
    const when = new Date(Number(timestamp));
    if (!timestamp || Number.isNaN(when.getTime())) return '-';
    const pad = number => String(number).padStart(2, '0');
    return `${when.getUTCFullYear()}-${pad(when.getUTCMonth() + 1)}-${pad(when.getUTCDate())}, `
      + `${pad(when.getUTCHours())}:${pad(when.getUTCMinutes())}:${pad(when.getUTCSeconds())} UTC`;
  }

  function showLocked(message) {
    if (dom.greetingRow) dom.greetingRow.classList.add('d-none');
    if (dom.dashboard) dom.dashboard.classList.add('d-none');
    if (dom.profileButton) dom.profileButton.classList.add('d-none');
    if (dom.locked) dom.locked.classList.remove('d-none');
    if (dom.lockedMessage) dom.lockedMessage.textContent = message;
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
    if (dom.permissions) dom.permissions.textContent = 'Owner';
    if (dom.verifiedAt) dom.verifiedAt.textContent = utcTimestamp(account.verifiedAt);
    if (dom.profileButton) {
      dom.profileButton.href = `/player/?id=${account.id}`;
      dom.profileButton.classList.remove('d-none');
    }

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

  function render() {
    const account = ACCOUNT ? ACCOUNT.get() : null;
    if (!account) {
      showLocked('Link your Wanwood account to open the admin panel.');
      return;
    }
    if (!CONFIG || !CONFIG.isOwner(account.name)) {
      showLocked(`${account.name} is not an owner of this site.`);
      return;
    }
    showDashboard(account);
  }

  let booted = false;

  function init() {
    if (booted) return;
    if (!document.body.classList.contains('page-admin')) return;
    cacheDom();
    if (!dom.dashboard) return;
    booted = true;
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
