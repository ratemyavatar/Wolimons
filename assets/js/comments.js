/*
 * Wolimons comments - the shared comment section + the inbox.
 * -----------------------------------------------------------
 * One comment section, used at the bottom of player profiles and trade ad
 * detail pages, and one inbox that collects every comment left on the linked
 * account's own profile and trade ads. The server keeps the comments (see
 * proxy/store.js); they are permanent and visible to everyone, so the section
 * renders identically for a signed-out visitor and the person who wrote them.
 *
 * Each comment is its own card: a darker tile in the same grey family as the
 * pane it sits in, with the commenter's headshot, name, how long ago, and the
 * text. The card is styled inline rather than through the picker-row classes,
 * because those classes are scoped to specific page body classes and would
 * not apply on the profile or trade ad detail pages - so the cards carry
 * their own look and render the same everywhere.
 *
 * Posting needs the same identity token trade ads use, so every comment is
 * attached to an account the poster proved they control; you can delete your
 * own, and the admin panel can take any down.
 *
 *   WolimonsComments.mount({ target, listId, boxId })   a comment section
 *   WolimonsComments.mountInbox({ listId, statusId })   the inbox list
 *
 * target is the namespaced page the comments sit on - "player:<userId>" or
 * "ad:<adId>" - and the ids are the empty containers the host page provides.
 */
(() => {
  'use strict';

  const CONFIG = window.WOLIMONS_CONFIG || {};
  const API = window.WanwoodAPI;
  const ACCOUNT = window.WolimonsAccount;

  const API_BASE = CONFIG.apiBase || '';

  /* The palette the cards draw from: the pane grey and one step darker, so a
   * comment reads as its own tile inside the section that holds it. */
  const CARD_BG = 'rgb(36, 38, 42)';
  const CARD_BORDER = 'rgb(58, 63, 68)';

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function ago(timestamp) {
    const seconds = Math.max(0, Math.floor((Date.now() - Number(timestamp)) / 1000));
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
    return new Date(Number(timestamp)).toISOString().slice(0, 10);
  }

  const token = () => (ACCOUNT && typeof ACCOUNT.getToken === 'function'
    ? ACCOUNT.getToken()
    : '');

  async function apiCall(path, options = {}) {
    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token() ? { Authorization: `Bearer ${token()}` } : {}),
        ...(options.headers || {}),
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) {
      throw new Error(payload.error || `The backend refused that (${response.status}).`);
    }
    return payload;
  }

  /*
   * One comment as its own card. Styled inline so it does not depend on the
   * picker-row classes, which are scoped to other pages' body classes. The
   * headshot is a placeholder until the batched headshot call paints it.
   */
  function commentCard(comment, { canDelete, onDelete, contextNode }) {
    const card = el('div');
    card.style.cssText = `background:${CARD_BG};border:1px solid ${CARD_BORDER};`
      + 'border-radius:6px;padding:10px 12px;margin-bottom:8px;display:flex;'
      + 'gap:10px;align-items:flex-start;';

    const img = el('img');
    img.width = 44;
    img.height = 44;
    img.loading = 'lazy';
    img.alt = '';
    img.style.cssText = 'border-radius:33%;background-color:#23272b;flex:0 0 auto;';
    img.dataset.commentHeadshot = String(comment.userId);
    card.appendChild(img);

    const body = el('div');
    body.style.cssText = 'flex:1 1 auto;min-width:0;';

    const head = el('div');
    head.style.cssText = 'display:flex;align-items:center;flex-wrap:wrap;gap:6px;';
    const name = el('a', null, comment.name || `User ${comment.userId}`);
    name.href = `/player/?id=${comment.userId}`;
    name.style.cssText = 'color:#e9ecef;font-weight:600;text-decoration:none;';
    head.appendChild(name);
    const when = el('span', null, ago(comment.at));
    when.style.cssText = 'color:#7a8288;font-size:12px;';
    head.appendChild(when);

    /* The inbox adds a "on your profile / trade ad" chip ahead of the row. */
    if (contextNode) head.insertBefore(contextNode, head.firstChild);

    if (canDelete) {
      const remove = el('button', null, 'Remove');
      remove.type = 'button';
      remove.style.cssText = 'margin-left:auto;background:rgb(58,63,68);color:#c3c8cd;'
        + 'border:0;border-radius:12px;padding:2px 10px;font-size:12px;cursor:pointer;';
      remove.addEventListener('click', () => onDelete(comment, remove));
      head.appendChild(remove);
    }
    body.appendChild(head);

    const text = el('div', null, comment.text);
    text.style.cssText = 'color:#c3c8cd;font-size:13px;margin-top:4px;'
      + 'white-space:pre-wrap;overflow-wrap:anywhere;';
    body.appendChild(text);

    card.appendChild(body);
    return card;
  }

  /* Batched headshots for whoever has commented, painted onto the cards. */
  async function paintHeadshots(container) {
    if (!API || !container) return;
    const images = [...container.querySelectorAll('img[data-comment-headshot]')];
    const ids = [...new Set(images.map(img => Number(img.dataset.commentHeadshot)))]
      .filter(id => Number.isSafeInteger(id) && id > 0);
    if (!ids.length) return;
    try {
      const heads = await API.fetchUserHeadshots(ids, 48);
      images.forEach(img => {
        const url = heads.get(Number(img.dataset.commentHeadshot));
        if (url) img.src = url;
      });
    } catch (error) {
      /* Headshots are cosmetic; the section works without them. */
    }
  }

  /*
   * The posting box. Linked + verified browsers get the note-box input and a
   * Post button; everyone else is told how to join in.
   */
  function renderBox(box, target, onPosted) {
    if (!box) return;
    box.replaceChildren();

    const account = ACCOUNT ? ACCOUNT.get() : null;
    if (!account || !token()) {
      const note = el('div', 'small');
      note.style.color = '#7a8288';
      note.append('Link your Wanwood account on the ');
      const link = el('a', null, 'verify page');
      link.href = '/verify';
      link.style.color = '#7ab8f5';
      note.appendChild(link);
      note.append(' to leave a comment.');
      box.appendChild(note);
      return;
    }

    const group = el('div', 'input-group');
    const input = document.createElement('input');
    input.className = 'form-control form-control-lg rounded-0 shadow border-0';
    input.style.backgroundColor = '#eee';
    input.type = 'text';
    input.maxLength = 500;
    input.placeholder = `Comment as ${account.name}...`;
    input.autocapitalize = 'off';

    const post = el('input', 'btn btn-flat-light-blue shadow');
    post.type = 'submit';
    post.value = 'Post';
    group.appendChild(input);
    group.appendChild(post);
    box.appendChild(group);

    const notice = el('div', 'small mt-1');
    notice.style.color = '#7a8288';
    box.appendChild(notice);

    const say = (message, tone) => {
      notice.textContent = message || '';
      notice.style.color = tone === 'bad' ? '#e57373'
        : tone === 'good' ? '#81c784'
          : '#7a8288';
    };

    const submit = async () => {
      const text = input.value.trim();
      if (!text) {
        say('Write something first.', 'bad');
        return;
      }
      post.disabled = true;
      say('Posting...');
      try {
        const payload = await apiCall('/api/comments/post', {
          method: 'POST',
          body: JSON.stringify({ target, text }),
        });
        input.value = '';
        say('');
        onPosted(payload.comment);
      } catch (error) {
        say(error.message, 'bad');
      } finally {
        post.disabled = false;
      }
    };

    post.addEventListener('click', submit);
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') submit();
    });
  }

  function emptyNote(container, message) {
    const empty = el('div', null, message);
    empty.style.cssText = 'color:#7a8288;font-size:13px;padding:8px 0;';
    container.replaceChildren(empty);
  }

  /*
   * Build a whole comment section into the host page's two containers.
   */
  async function mount({ target, listId, boxId }) {
    const list = document.getElementById(listId);
    const box = document.getElementById(boxId);
    if (!list || !target) return;

    const account = ACCOUNT ? ACCOUNT.get() : null;
    const myId = account ? Number(account.id) : 0;

    const refresh = async () => {
      list.replaceChildren();
      let comments = [];
      try {
        const payload = await apiCall(
          `/api/comments?target=${encodeURIComponent(target)}&limit=200`);
        comments = Array.isArray(payload.comments) ? payload.comments : [];
      } catch (error) {
        emptyNote(list, 'Comments could not be loaded.');
        return;
      }

      if (!comments.length) {
        emptyNote(list, 'No comments yet - be the first.');
        return;
      }

      comments.forEach(comment => {
        const own = myId > 0 && comment.userId === myId && Boolean(token());
        list.appendChild(commentCard(comment, {
          canDelete: own,
          onDelete: async (item, button) => {
            button.disabled = true;
            button.textContent = 'Removing...';
            try {
              await apiCall('/api/comments/delete', {
                method: 'POST',
                body: JSON.stringify({ id: item.id }),
              });
              refresh();
            } catch (error) {
              button.disabled = false;
              button.textContent = 'Remove';
            }
          },
        }));
      });
      paintHeadshots(list);
    };

    renderBox(box, target, () => refresh());
    await refresh();
  }

  /*
   * The inbox: every comment left on the linked account's own profile or
   * trade ads, newest first. Needs a linked + verified account; otherwise it
   * says so and points at the verify page.
   */
  async function mountInbox({ listId, statusId }) {
    const list = document.getElementById(listId);
    const status = statusId ? document.getElementById(statusId) : null;
    if (!list) return;

    const say = (message, tone) => {
      if (!status) return;
      status.textContent = message || '';
      status.style.color = tone === 'bad' ? '#e57373' : '#adb5bd';
      status.classList.toggle('d-none', !message);
    };

    const account = ACCOUNT ? ACCOUNT.get() : null;
    if (!account || !token()) {
      const note = el('div');
      note.style.cssText = 'color:#7a8288;font-size:14px;padding:8px 0;';
      note.append('Link your Wanwood account on the ');
      const link = el('a', null, 'verify page');
      link.href = '/verify';
      link.style.color = '#7ab8f5';
      note.appendChild(link);
      note.append(' to see when someone comments on your profile or trade ads.');
      list.replaceChildren(note);
      return;
    }

    say('Loading\u2026');
    let comments = [];
    let lastRead = 0;
    try {
      const payload = await apiCall('/api/inbox?limit=200');
      comments = Array.isArray(payload.comments) ? payload.comments : [];
      lastRead = Number(payload.lastRead) || 0;
    } catch (error) {
      say(error.message, 'bad');
      return;
    }

    if (!comments.length) {
      say('');
      emptyNote(list, 'Nothing yet. When someone comments on your profile or a trade ad you posted, it shows up here.');
      return;
    }

    const unread = comments.filter(comment => comment.at > lastRead).length;
    say(unread
      ? `${unread} new comment${unread === 1 ? '' : 's'}.`
      : 'You\u2019re all caught up.');

    list.replaceChildren();
    comments.forEach(comment => {
      const isAd = comment.target.startsWith('ad:');
      const ref = isAd ? comment.target.slice(3) : comment.target.slice(7);
      const isNew = comment.at > lastRead;

      /* A small chip saying where the comment landed, linking to the page. */
      const context = el('a', null, isAd ? 'your trade ad' : 'your profile');
      context.href = isAd ? `/tradead/?id=${encodeURIComponent(ref)}` : `/player/?id=${ref}`;
      context.style.cssText = 'color:#7ab8f5;font-size:12px;text-decoration:none;'
        + 'background:rgb(58,63,68);border-radius:10px;padding:1px 8px;';

      const card = commentCard(comment, { canDelete: false, contextNode: context });
      if (isNew) {
        /* Unread cards get a thin blue edge so they stand out until the
         * inbox is opened and everything is marked read. */
        card.style.boxShadow = 'inset 3px 0 0 rgb(0, 132, 221)';
      }
      list.appendChild(card);
    });
    paintHeadshots(list);

    /* Opening the inbox marks everything in it as read, so the navbar
     * badge goes out. Fire-and-forget - a failure here is not worth
     * surfacing, the list is already showing. */
    apiCall('/api/inbox/read', { method: 'POST', body: '{}' }).catch(() => {});
    /* Tell the navbar to drop its badge now that we are caught up. */
    try {
      window.dispatchEvent(new CustomEvent('wolimons:inbox-read'));
    } catch (error) { /* older browsers */ }
  }

  /* The inbox page is recognised by its list container; nothing else on the
   * site has one, so this auto-mounts there and nowhere else. */
  function autoMountInbox() {
    if (document.getElementById('inbox_notifications_list')) {
      mountInbox({ listId: 'inbox_notifications_list', statusId: 'inbox_status' });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoMountInbox);
  } else {
    autoMountInbox();
  }

  window.WolimonsComments = { mount, mountInbox };
})();
