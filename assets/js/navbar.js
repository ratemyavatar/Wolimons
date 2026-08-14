(() => {
  'use strict';

  const toggler = document.querySelector('.navbar-toggler[data-target="#navbarSupportedContent"]');
  const navbar = document.getElementById('navbarSupportedContent');
  if (!toggler || !navbar) return;

  const dropdownToggles = [...navbar.querySelectorAll('[data-toggle="dropdown"]')];

  function closeDropdowns(except) {
    dropdownToggles.forEach(dropdownToggle => {
      const dropdown = dropdownToggle.closest('.dropdown');
      if (!dropdown || dropdown === except) return;
      dropdown.classList.remove('show');
      dropdown.querySelector('.dropdown-menu')?.classList.remove('show');
      dropdownToggle.setAttribute('aria-expanded', 'false');
    });
  }

  /* ------------------------------------------------------------------ */
  /* Mobile toggler                                                      */
  /* ------------------------------------------------------------------ */

  /*
   * Bootstrap's collapse plugin isn't on the site, so the slide is done by
   * hand with the .collapsing class the stylesheet already ships
   * (height: 0; overflow: hidden; transition: height .35s).
   *
   * Opening: .collapse -> .collapsing at height 0, then set the height to the
   * menu's real scrollHeight so the transition has somewhere to go; when it
   * finishes, swap to .collapse.show and drop the inline height so the menu
   * can resize itself afterwards. Closing runs the same steps backwards,
   * pinning the current height first so the animation starts from a real
   * number instead of "auto".
   */
  const REDUCED_MOTION = typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : { matches: false };
  let collapseTimer = null;

  function settleNavbar(open) {
    clearTimeout(collapseTimer);
    navbar.classList.remove('collapsing');
    navbar.classList.add('collapse');
    navbar.classList.toggle('show', open);
    navbar.style.height = '';
  }

  function slideNavbar(open) {
    clearTimeout(collapseTimer);

    /* No animation asked for, or none possible - just switch. */
    if (REDUCED_MOTION.matches) {
      settleNavbar(open);
      return;
    }

    const from = open ? 0 : navbar.scrollHeight;
    navbar.classList.remove('collapse', 'show');
    navbar.classList.add('collapsing');
    navbar.style.height = `${from}px`;

    /* Read back the height so the browser commits the starting frame; without
     * this the two style writes coalesce and nothing animates. */
    void navbar.offsetHeight;

    navbar.style.height = open ? `${navbar.scrollHeight}px` : '0px';
    collapseTimer = setTimeout(() => settleNavbar(open), 350);
  }

  toggler.addEventListener('click', () => {
    const isOpen = !navbar.classList.contains('show');
    toggler.setAttribute('aria-expanded', String(isOpen));
    slideNavbar(isOpen);
    if (!isOpen) closeDropdowns();
  });

  dropdownToggles.forEach(dropdownToggle => {
    dropdownToggle.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      const dropdown = dropdownToggle.closest('.dropdown');
      const menu = dropdown?.querySelector('.dropdown-menu');
      if (!dropdown || !menu) return;

      const isOpen = !menu.classList.contains('show');
      closeDropdowns(dropdown);
      dropdown.classList.toggle('show', isOpen);
      menu.classList.toggle('show', isOpen);
      dropdownToggle.setAttribute('aria-expanded', String(isOpen));
    });
  });

  /* ------------------------------------------------------------------ */
  /* Account menu                                                        */
  /* ------------------------------------------------------------------ */

  /*
   * The Account dropdown reflects whatever player this browser has linked
   * at /verify. Linked: the player's name, their avatar in place of the
   * generic silhouette, and profile/sign-out entries. Not linked: it stays
   * as it ships in the markup, a single "Verify Account" link.
   */
  const accountMenu = {
    name: document.getElementById('navbar_player_menu_player_name'),
    pfp: document.getElementById('navbar_player_menu_pfp'),
    menu: document.querySelector('[aria-labelledby="navbarPlayerDropdown"]'),
    verify: document.getElementById('navbar_player_menu_verify'),
  };

  function accountItem(id, href, label, iconPath) {
    const link = document.createElement('a');
    link.className = 'nav-link site_navbar_item';
    link.id = id;
    link.href = href;

    const icon = document.createElement('span');
    icon.className = 'site_navbar_icon_svg';
    icon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">'
      + `<path d="${iconPath}" fill="currentColor"></path></svg>`;

    const title = document.createElement('span');
    title.className = 'navbar_item_title';
    title.textContent = label;

    link.append(icon, title);
    return link;
  }

  const PROFILE_ICON = 'M12 4a4 4 0 014 4 4 4 0 01-4 4 4 4 0 01-4-4 4 4 0 014-4m0 10c4.42 0 8 1.79 8 4v2H4v-2c0-2.21 3.58-4 8-4z';
  const SIGN_OUT_ICON = 'M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4a2 2 0 00-2 2v14a2 2 0 002 2h8v-2H4z';

  async function renderAccountMenu() {
    const account = window.WolimonsAccount;
    if (!account || !accountMenu.menu) return;
    const linked = account.get();

    /* Anything this function added last time goes first, so the markup's
     * own "Verify Account" link is all that is left underneath. */
    accountMenu.menu.querySelectorAll('[data-account-item]').forEach(node => node.remove());

    if (!linked) {
      if (accountMenu.name) accountMenu.name.textContent = 'Account';
      if (accountMenu.pfp) accountMenu.pfp.querySelector('img')?.remove();
      accountMenu.pfp?.querySelector('svg')?.removeAttribute('hidden');
      accountMenu.verify?.querySelector('.navbar_item_title')
        ?.replaceChildren(document.createTextNode('Verify Account'));
      return;
    }

    if (accountMenu.name) accountMenu.name.textContent = linked.name;
    accountMenu.verify?.querySelector('.navbar_item_title')
      ?.replaceChildren(document.createTextNode('Verify Another Account'));

    const profile = accountItem('navbar_player_menu_profile',
      `/player/?id=${linked.id}`, 'My Profile', PROFILE_ICON);
    profile.dataset.accountItem = '';
    const signOut = accountItem('navbar_player_menu_sign_out', '#', 'Sign Out', SIGN_OUT_ICON);
    signOut.dataset.accountItem = '';
    signOut.addEventListener('click', event => {
      event.preventDefault();
      account.clear();
    });

    accountMenu.menu.prepend(profile);
    accountMenu.menu.append(signOut);

    /* The avatar is a nicety; if the thumbnail call fails the silhouette
     * that is already in the markup simply stays. A headshot is used rather
     * than the full body render - at 24px a whole avatar is mostly empty
     * space with an unreadable head in the middle. */
    try {
      const url = await window.WanwoodAPI?.fetchUserAvatar(linked.id, { size: 150 });
      if (!url || !accountMenu.pfp) return;
      if (!account.get()) return;
      const image = accountMenu.pfp.querySelector('img') || document.createElement('img');
      image.src = url;
      image.alt = '';
      image.width = 24;
      image.height = 24;
      image.style.borderRadius = '50%';
      image.style.objectFit = 'cover';
      if (!image.isConnected) accountMenu.pfp.append(image);
      accountMenu.pfp.querySelector('svg')?.setAttribute('hidden', '');
    } catch (error) {
      /* Keep the silhouette. */
    }
  }

  /* ------------------------------------------------------------------ */
  /* Admin entry in the More menu                                        */
  /* ------------------------------------------------------------------ */

  /*
   * The Admin link is only put in the More menu when the linked account is
   * on the owners list in config.js. Hiding it is a courtesy, not a lock -
   * see the note above that list: this is a static site, so the answer is
   * decided in the visitor's own browser and /admin re-checks it anyway.
   */
  const ADMIN_ICON = 'M12 1 3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z'
    + 'm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z';

  const moreMenu = document.querySelector('[aria-labelledby="navbarMoreFeaturesDropdown"]');

  function renderAdminEntry() {
    if (!moreMenu) return;
    moreMenu.querySelector('#navbar_more_admin')?.remove();

    const linked = window.WolimonsAccount?.get();
    if (!linked || !window.WOLIMONS_CONFIG?.isOwner(linked.name)) return;

    /* First in the menu, so it is not buried under the feature links. */
    moreMenu.prepend(accountItem('navbar_more_admin', '/admin', 'Admin', ADMIN_ICON));
  }

  window.WolimonsAccount?.subscribe(() => {
    renderAccountMenu();
    renderAdminEntry();
  });
  renderAccountMenu();
  renderAdminEntry();

  /* ------------------------------------------------------------------ */
  /* Search modal                                                        */
  /* ------------------------------------------------------------------ */

  const searchButton = document.getElementById('navbar_search_button');
  const searchModal = document.getElementById('search_modal');

  function closeSearch() {
    if (!searchModal) return;
    searchModal.classList.remove('show');
    searchModal.style.display = 'none';
    searchModal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-open');
  }

  searchButton?.addEventListener('click', event => {
    if (!searchModal) return;
    event.preventDefault();
    closeDropdowns();
    searchModal.style.display = 'block';
    searchModal.classList.add('show');
    searchModal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
    activePane()?.querySelector('input[type="text"]')?.focus();
  });

  searchModal?.querySelectorAll('[data-dismiss="modal"]').forEach(button => {
    button.addEventListener('click', closeSearch);
  });
  searchModal?.addEventListener('click', event => {
    if (event.target === searchModal) closeSearch();
  });

  /* ------------------------------------------------------------------ */
  /* Search modal tabs                                                   */
  /* ------------------------------------------------------------------ */

  /*
   * The LIMITEDS / PLAYERS / GROUPS tabs are plain anchors whose href points
   * at "/<page>#global_..._search_tab_pane" - the snapshot relied on
   * Bootstrap's tab plugin to swallow the click. Without it the browser just
   * followed the link, which is why picking Players or Groups navigated away
   * instead of switching panes. Nine lines do the job the plugin did.
   */
  const tabLinks = [...(searchModal?.querySelectorAll('[data-search-tab]') || [])];
  const tabPanes = [...(searchModal?.querySelectorAll('.tab-content > .tab-pane') || [])];

  function activePane() {
    return tabPanes.find(pane => pane.classList.contains('active')) || tabPanes[0];
  }

  function showTab(link) {
    /* The href carries the pane id after the '#', whatever page it names. */
    const paneId = (link.getAttribute('href') || '').split('#')[1];
    const pane = paneId ? searchModal.querySelector(`#${CSS.escape(paneId)}`) : null;
    if (!pane) return;
    tabLinks.forEach(other => other.classList.toggle('active', other === link));
    tabPanes.forEach(other => other.classList.toggle('active', other === pane));
    pane.querySelector('input[type="text"]')?.focus();
  }

  tabLinks.forEach(link => {
    link.addEventListener('click', event => {
      event.preventDefault();
      showTab(link);
    });
  });

  document.addEventListener('click', event => {
    if (!navbar.contains(event.target)) closeDropdowns();
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    closeDropdowns();
    closeSearch();
  });

  /* ------------------------------------------------------------------ */
  /* Player and group search                                             */
  /* ------------------------------------------------------------------ */

  const API = window.WanwoodAPI;

  function message(container, words) {
    const note = document.createElement('div');
    note.className = 'text-center py-5 small';
    note.style.color = '#7a8288';
    note.textContent = words;
    container.replaceChildren(note);
  }

  function card(href, imageSrc, title, subtitle, { external = false } = {}) {
    const wrapper = document.createElement('div');
    wrapper.className = 'shadow_md_35 shift_up_md pb-2 search-player-card';
    wrapper.style.backgroundColor = '#30363c';

    const link = document.createElement('a');
    link.href = href;
    if (external) {
      link.target = '_blank';
      link.rel = 'noopener';
    }

    const imageWrap = document.createElement('div');
    imageWrap.className = 'std_item_card_img_bkgnd_gradient text-center border-bottom border-dark';
    const image = document.createElement('img');
    image.className = 'd-block-inline my-1';
    image.src = imageSrc;
    image.width = 100;
    image.height = 100;
    image.alt = `${title} thumbnail`;
    image.loading = 'lazy';
    imageWrap.append(image);

    const name = document.createElement('div');
    name.className = 'px-2 pt-1 text-light text-truncate';
    name.style.fontSize = '0.85em';
    name.style.fontWeight = '600';
    name.textContent = title;
    name.title = title;

    link.append(imageWrap, name);
    if (subtitle) {
      const detail = document.createElement('div');
      detail.className = 'px-2 text-truncate small text-muted';
      detail.textContent = subtitle;
      link.append(detail);
    }
    wrapper.append(link);
    return wrapper;
  }

  function grid(cards) {
    const container = document.createElement('div');
    container.className = 'search-player-card-grid';
    container.append(...cards);
    return container;
  }

  /* Runs `search` on a 300ms debounce and keeps only the newest answer. */
  function wireSearch({ input, clear, results, emptyText, search }) {
    if (!input || !results) return;
    let sequence = 0;
    let timer;

    async function run(term) {
      const mine = ++sequence;
      if (!term) {
        message(results, emptyText);
        return;
      }
      message(results, 'Searching…');
      try {
        const nodes = await search(term);
        if (mine !== sequence) return;
        if (!nodes.length) {
          message(results, `Nothing on Wanwood matches "${term}".`);
          return;
        }
        results.replaceChildren(grid(nodes));
      } catch (error) {
        if (mine !== sequence) return;
        message(results, 'Wanwood could not be reached for that search.');
      }
    }

    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => run(input.value.trim()), 300);
    });
    clear?.addEventListener('click', () => {
      input.value = '';
      run('');
      input.focus();
    });
  }

  if (API) {
    /*
     * Players. Wanwood has no user-search endpoint - only an exact
     * get-by-username lookup (and get-by-id) - so this finds the one account
     * whose name was typed rather than offering suggestions. Nothing is
     * invented to pad the list out.
     */
    wireSearch({
      input: document.getElementById('global_player_search_textbox'),
      clear: document.getElementById('global_player_search_textbox_clear'),
      results: document.getElementById('global_player_search_results'),
      emptyText: 'Type an exact Wanwood username',
      search: async term => {
        const found = /^\d+$/.test(term)
          ? await API.getUserById(Number(term))
          : await API.getUserByUsername(term).catch(() => null);
        if (!found) return [];
        const thumbs = await API.fetchUserThumbnails([found.id], 150);
        return [card(
          `/player/?id=${found.id}`,
          thumbs.get(found.id) || '/assets/Wolimonslogoo.png',
          found.name,
          `ID ${found.id}`,
        )];
      },
    });

    /* Groups. Wolimons has no group page of its own, so the cards open the
     * group on Wanwood itself. */
    wireSearch({
      input: document.getElementById('global_group_search_textbox'),
      clear: document.getElementById('global_group_search_textbox_clear'),
      results: document.getElementById('global_group_search_results'),
      emptyText: 'Type to search Wanwood groups',
      search: async term => {
        const groups = await API.searchGroups(term, { limit: 12 });
        if (!groups.length) return [];
        const icons = await API.fetchGroupIcons(groups.map(group => group.id), 150);
        return groups.map(group => card(
          `${API.SITE_BASE}/groups/${group.id}/${encodeURIComponent(group.name.replace(/\s+/g, '-'))}`,
          icons.get(group.id) || '/assets/Wolimonslogoo.png',
          group.name,
          group.memberCount === null ? '' : `${group.memberCount.toLocaleString('en-US')} members`,
          { external: true },
        ));
      },
    });
  }
})();
