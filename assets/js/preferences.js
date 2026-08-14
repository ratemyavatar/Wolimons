/*
 * Wolimons site preferences (/preferences).
 *
 * The editor for assets/js/prefs.js, which is where the settings themselves
 * and their meanings live. This file is only the form: put the checkboxes
 * into the state the stored preferences describe, and write a change back the
 * moment it is made.
 *
 * There is no Save button on purpose. Every setting here is a single
 * checkbox that takes effect immediately across every open tab, so a Save
 * button would only add a way to lose a change by navigating away.
 */
(() => {
  'use strict';

  const PREFS = window.WolimonsPrefs;
  const ACCOUNT = window.WolimonsAccount;

  const resetButton = document.getElementById('reset_preferences_button');
  const notice = document.getElementById('preferences_notice');
  const boxes = [...document.querySelectorAll('[data-pref]')];

  let noticeTimer = 0;

  function say(message, tone) {
    if (!notice) return;
    window.clearTimeout(noticeTimer);
    notice.textContent = message || '';
    notice.style.color = tone === 'bad' ? '#ff6b6b' : '#62c462';
    notice.classList.toggle('d-none', !message);
    if (message) {
      noticeTimer = window.setTimeout(() => {
        notice.classList.add('d-none');
      }, 4000);
    }
  }

  /* Paint the form from the stored state. Called on load and again whenever
   * anything changes - including from another tab, which prefs.js reports
   * through the same subscription. */
  function paint(state) {
    boxes.forEach(box => {
      const name = box.dataset.pref;
      if (!(name in state)) return;
      box.checked = Boolean(state[name]);
    });
  }

  function initBoxes() {
    boxes.forEach(box => {
      box.addEventListener('change', () => {
        const name = box.dataset.pref;
        if (!PREFS.set(name, box.checked)) {
          /* An unknown name means the markup and prefs.js have drifted apart.
           * Put the box back rather than leaving it showing a setting that
           * was never stored. */
          box.checked = !box.checked;
          say('That setting could not be saved.', 'bad');
          return;
        }
        /* localStorage can be unavailable in private mode, in which case the
         * choice holds for this page and is gone on the next one. Better to
         * say so than to let it silently not stick. */
        say('Saved.');
      });
    });
  }

  function initReset() {
    if (!resetButton) return;
    resetButton.addEventListener('click', event => {
      event.preventDefault();
      PREFS.reset();
      /* Deliberately not touching the linked account. Clearing preferences
       * and signing out of a verified account are different intentions, and
       * /verify already owns the second one. */
      say('Preferences reset.');
    });
  }

  function boot() {
    if (!PREFS) {
      say('The preferences script failed to load.', 'bad');
      boxes.forEach(box => { box.disabled = true; });
      if (resetButton) resetButton.disabled = true;
      return;
    }

    initBoxes();
    initReset();

    /* subscribe() paints immediately and again on every later change, so this
     * is the only render path the page needs. */
    PREFS.subscribe(paint);

    /* If an account is linked, say whose - this is the page that claims to
     * list what the browser is holding, so it should not omit it. */
    if (ACCOUNT && typeof ACCOUNT.get === 'function') {
      const account = ACCOUNT.get();
      const host = document.querySelector('#reset_preferences_button')?.parentElement;
      if (account && host) {
        const line = document.createElement('div');
        line.className = 'small w-100 mt-2';
        line.style.color = '#9aa3aa';
        line.textContent = `Linked Wanwood account: ${account.name}. `;
        const link = document.createElement('a');
        link.href = '/verify';
        link.textContent = 'Manage it on the verification page.';
        line.appendChild(link);
        host.appendChild(line);
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
