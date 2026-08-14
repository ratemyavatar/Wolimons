(() => {
  'use strict';

  const toggler = document.querySelector('.navbar-toggler[data-target="#navbarSupportedContent"]');
  const navbar = document.getElementById('navbarSupportedContent');
  if (!toggler || !navbar) return;

  toggler.addEventListener('click', () => {
    const isOpen = navbar.classList.toggle('show');
    toggler.setAttribute('aria-expanded', String(isOpen));
  });
})();
