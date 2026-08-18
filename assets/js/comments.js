/*
 * Wolimons comments - the shared comment section.
 * -----------------------------------------------
 * One section, used at the bottom of player profiles and trade ad detail
 * pages. The server keeps the comments (see proxy/store.js); they are
 * permanent and visible to everyone, so the section renders identically for
 * a signed-out visitor and the person who wrote them.
 *
 * Everything here is reused from the site's existing kit: the rows are the
 * trade ad picker's row shape (44px headshot beside the text), the input is
 * the admin panel's note box, the buttons are the site's buttons. Posting
 * needs the same identity token trade ads use, so every comment is attached
 * to an account the poster proved they control; you can delete your own, and
 * the admin panel can take any down.
 *
 *   WolimonsComments.mount({ target, listId, boxId })
 *
 * target is the namespaced page the comments sit on - "player:<userId>" or
 * "ad:<adId>" - and the two ids are the empty containers the host page
 * provides for the list and the posting box.
 */
(() => {
  'use strict';

  const CONFIG = window.WOLIMONS_CONFIG || {};
  const API = window.WanwoodAPI;
  const ACCOUNT = window.WolimonsAccount;

  const API_BASE = CONFIG.apiBase || '';

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
   * One comment, in the picker's row shape. The headshot is a placeholder
   * until the batched headshot call paints the real one.
   */
  function commentRow(comment, { canDelete, onDelete }) {
    const row = el('div', 'trade_ad_picker_row');
    row.style.cursor = 'default';

    const img = el('img');
    img.width = 44;
    img.height = 44;
    img.loading = 'lazy';
    img.alt = '';
    img.style.borderRadius = '33%';
    img.style.backgroundColor = '#23272b';
    img.dataset.commentHeadshot = String(comment.userId);
    row.appendChild(img);

    const body = el('div', 'flex-grow-1');

    const head = el('div', 'd-flex align-items-center flex-wrap');
    const name = el('a', 'text-truncate', comment.name || `User ${comment.userId}`);
    name.href = `/player/?id=${comment.userId}`;
    name.style.color = '#e9ecef';
    name.style.fontWeight = '600';
    head.appendChild(name);
    const when = el('span', 'small ml-2', ago(comment.at));
    when.style.color = '#7a8288';
    head.appendChild(when);

    if (canDelete) {
      const remove = el('button', 'btn btn-flat-dark-gray-sm rounded-pill ml-auto', 'Remove');
      remove.type = 'button';
      remove.style.fontSize = '12px';
      remove.addEventListener('click', () => onDelete(comment, remove));
      head.appendChild(remove);
    }
    body.appendChild(head);

    const text = el('div', 'small mt-1', comment.text);
    text.style.color = '#c3c8cd';
    text.style.whiteSpace = 'pre-wrap';
    text.style.overflowWrap = 'anywhere';
    body.appendChild(text);

    row.appendChild(body);
    return row;
  }

  /* Batched headshots for whoever has commented, painted onto the rows. */
  async function paintHeadshots(list) {
    if (!API) return;
    const images = [...list.querySelectorAll('img[data-comment-headshot]')];
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

  /*
   * Build the whole section into the host page's two containers.
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
        const failed = el('div', 'small py-2', 'Comments could not be loaded.');
        failed.style.color = '#7a8288';
        list.appendChild(failed);
        return;
      }

      if (!comments.length) {
        const empty = el('div', 'small py-2', 'No comments yet - be the first.');
        empty.style.color = '#7a8288';
        list.appendChild(empty);
        return;
      }

      comments.forEach(comment => {
        const own = myId > 0 && comment.userId === myId && Boolean(token());
        list.appendChild(commentRow(comment, {
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

  window.WolimonsComments = { mount };
})();
