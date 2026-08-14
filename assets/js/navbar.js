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

  toggler.addEventListener('click', () => {
    const isOpen = navbar.classList.toggle('show');
    toggler.setAttribute('aria-expanded', String(isOpen));
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
    searchModal.querySelector('input')?.focus();
  });

  searchModal?.querySelectorAll('[data-dismiss="modal"]').forEach(button => {
    button.addEventListener('click', closeSearch);
  });
  searchModal?.addEventListener('click', event => {
    if (event.target === searchModal) closeSearch();
  });

  document.addEventListener('click', event => {
    if (!navbar.contains(event.target)) closeDropdowns();
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    closeDropdowns();
    closeSearch();
  });
})();
