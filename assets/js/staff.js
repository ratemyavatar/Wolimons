/*
 * Wolimons staff page - /staff
 * -----------------------------
 * The staff list is the site's whitelist: the same roster the admin panel
 * edits and the backend checks on every write (GET /api/roles). A name is
 * staff if and only if it holds a rank on that roster - there is no other
 * source of "is staff", and nobody outside it appears here.
 *
 * Nothing on this page is drawn twice. The cards are the leaderboard's own
 * shape and classes, the rank icons and words come from role-icons.js, the
 * verified tick is name-badges.js reading Wanwood's isVerified flag, and the
 * avatars are the same headshot batch call every roster page uses.
 */
(() => {
  'use strict';

  const CONFIG = window.WOLIMONS_CONFIG || {};
  const API = window.WanwoodAPI;
  const ROLE_ICONS = window.WolimonsRoleIcons;
  const NAME_BADGES = window.WolimonsNameBadges;

  const API_BASE = CONFIG.apiBase || '';
  const AVATAR_SIZE = 150;

  /* Owners first, then value managers, then the value team; names break
   * ties - the same pecking order the panel lists them in. */
  const RANK_ORDER = { owner: 0, value_manager: 1, staff: 2 };

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  /* The leaderboard's stat row, verbatim. */
  function statRow(label, value, valueClass) {
    const row = el('div', 'd-flex justify-content-between');
    const left = el('div');
    left.appendChild(el('small', 'text-muted', label));
    const right = el('div');
    right.appendChild(el('span', `${valueClass} text-truncate`, value));
    row.appendChild(left);
    row.appendChild(right);
    return row;
  }

  function status(message) {
    const box = document.getElementById('staff_status');
    if (!box) return;
    box.textContent = message || '';
    box.classList.toggle('d-none', !message);
  }

  /*
   * One card. The rank sits in the name row twice over, on purpose: the icon
   * (role-icons.js, same crown/shield/star as the roster and the panel) and
   * the words, down in the stats, so the card says the rank even to somebody
   * who has never learned what the icons mean. The verified tick - when
   * Wanwood says isVerified - rides next to the name exactly as it does on
   * the leaderboard and the profile.
   */
  function staffCard(entry) {
    const cell = el('div', 'pb-2 mb-3 lb_cell shadow_md_35 shift_up_md mx-0');
    cell.style.backgroundColor = '#30363c';

    /* A staff member the game does not know still gets a card; it simply
     * does not link anywhere. */
    const inner = document.createElement(entry.id ? 'a' : 'div');
    if (entry.id) inner.href = `/player/?id=${entry.id}`;

    const header = el('div');
    const name = el('h6', 'my-0 px-2 text-light py-1 d-flex align-items-center');
    name.style.backgroundColor = '#30363c';
    name.title = entry.name;
    name.appendChild(el('span', 'text-truncate', entry.name));

    const icon = ROLE_ICONS ? ROLE_ICONS.iconFor(entry.role) : null;
    if (icon) name.appendChild(icon);

    if (NAME_BADGES) {
      NAME_BADGES
        .badgeNodes({ name: entry.name, rank: null, verified: entry.verified === true })
        .forEach(node => name.appendChild(node));
    }
    header.appendChild(name);

    const imgWrap = el('div',
      'border-dark std_item_card_img_bkgnd_gradient border-top border-bottom text-center py-2');
    const img = document.createElement('img');
    img.className = 'mx-auto';
    img.width = AVATAR_SIZE;
    img.height = AVATAR_SIZE;
    img.alt = 'Player Thumbnail';
    img.loading = 'lazy';
    img.style.maxWidth = `${AVATAR_SIZE}px`;
    if (entry.avatar) img.src = entry.avatar;
    /* No render should leave a broken-image glyph behind. */
    img.addEventListener('error', () => { img.style.visibility = 'hidden'; });
    imgWrap.appendChild(img);

    const stats = el('div', 'px-2 pt-1');
    const label = ROLE_ICONS ? ROLE_ICONS.label(entry.role) : '';
    stats.appendChild(statRow('Rank', label || '-', 'text-light font-weight-bold'));
    if (entry.grantedBy) {
      stats.appendChild(statRow('Ranked by', entry.grantedBy, 'text-light'));
    }
    if (entry.grantedAt > 0) {
      const when = new Date(entry.grantedAt);
      if (Number.isFinite(when.getTime())) {
        stats.appendChild(statRow('On staff since', when.toISOString().slice(0, 10), 'text-light'));
      }
    }

    inner.appendChild(header);
    inner.appendChild(imgWrap);
    inner.appendChild(stats);
    cell.appendChild(inner);
    return cell;
  }

  async function load() {
    const container = document.getElementById('lb_cards');
    if (!container) return;
    status('Loading staff...');

    let roles = [];
    try {
      const response = await fetch(`${API_BASE}/api/roles`, {
        headers: { Accept: 'application/json' },
      });
      const payload = await response.json();
      roles = (payload && Array.isArray(payload.roles) ? payload.roles : [])
        /* The whitelist check: a name only counts while it holds a rank. */
        .filter(entry => entry && entry.name && entry.role)
        .sort((a, b) => ((RANK_ORDER[a.role] ?? 9) - (RANK_ORDER[b.role] ?? 9))
          || String(a.name).localeCompare(String(b.name)));
    } catch (error) {
      status('The staff list could not be loaded. Try again in a moment.');
      return;
    }

    if (!roles.length) {
      status('Nobody is on the staff whitelist right now.');
      return;
    }

    const entries = roles.map(entry => ({
      name: String(entry.name),
      role: entry.role,
      grantedBy: String(entry.grantedBy || ''),
      grantedAt: Number(entry.grantedAt) || 0,
      id: 0,
      avatar: '',
      verified: false,
    }));

    /* Names -> Wanwood accounts. One lookup each; the staff list is short,
     * and a name the game does not know keeps its card but loses the avatar,
     * the tick and the profile link. */
    if (API) {
      await Promise.all(entries.map(async entry => {
        try {
          const account = await API.getUserByUsername(entry.name);
          entry.id = account.id;
          entry.verified = await API.isUserVerified(account.id);
        } catch (error) {
          /* Not found on Wanwood - the card stays, the extras go. */
        }
      }));

      const ids = entries.map(entry => entry.id).filter(Boolean);
      if (ids.length) {
        try {
          const heads = await API.fetchUserHeadshots(ids, AVATAR_SIZE);
          entries.forEach(entry => {
            if (entry.id) entry.avatar = heads.get(entry.id) || '';
          });
        } catch (error) {
          /* Avatars are cosmetic; the page works without them. */
        }
      }
    }

    container.replaceChildren();
    entries.forEach(entry => container.appendChild(staffCard(entry)));
    status('');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', load);
  } else {
    load();
  }
})();
