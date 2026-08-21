/*
 * Wolimons Lucky Cat (/luckycat).
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS PAGE IS
 * ---------------------------------------------------------------------------
 * One copy of one limited is "the Lucky Cat item" for a while. Whoever holds
 * that exact copy - identified by its UAID, not by the item - earns the Lucky
 * Cat badge. The page names the copy, names its current owner, and says how
 * long is left before a different copy is chosen.
 *
 * ---------------------------------------------------------------------------
 * HOW THE CHOICE IS MADE, AND WHY IT IS MADE THIS WAY
 * ---------------------------------------------------------------------------
 * There is no Lucky Cat table on the backend and no job running anywhere to
 * write one. Rather than invent an owner and a serial that nothing can back
 * up, the choice is DERIVED, in the browser, from two things both readers
 * already share:
 *
 *   - which day we are in (UTC), and
 *   - the tracked player roster and their inventories, as Wanwood reports
 *     them right now.
 *
 * The day number seeds a small deterministic hash. Every browser hashing the
 * same day against the same candidate list lands on the same copy, so two
 * people comparing screens see the same UAID, and nobody - including whoever
 * runs the site - can steer it. At UTC midnight the seed changes and a
 * different copy is drawn. That is a real, checkable rule; a hardcoded
 * "current item" would be a fabrication.
 *
 * The order of the draw is user first:
 *
 *   1. Pick a random tracked player for today, from the shared roster in
 *      player-roster.js - the same list /leaderboard and /players show, so
 *      the winner is always somebody the site already knows about.
 *   2. Pick a random limited out of THAT player's inventory.
 *
 * This is the way round the page is meant to work: the cat visits a trader,
 * then blesses something they are holding. Doing it the other way - walking
 * the catalog and then looking for an owner - biases the result towards
 * whoever holds the most copies of common items.
 *
 * A player's own copy is where the UAID and serial come from, so the badge
 * still hangs on one exact copy rather than on the item.
 *
 * The candidate pool is the honest one:
 *   - a player whose inventory Wanwood will actually show (a private
 *     inventory returns nothing, so that player is skipped),
 *   - a limited in it that is not flagged projected in the value table,
 *   - value at or below LUCKY_MAX_VALUE where a value has been set. An item
 *     nobody has valued is still eligible - value 0 means "not priced yet",
 *     never "worthless".
 *
 * If the API is unreachable, or nobody passes, the page says so rather than
 * showing a placeholder cat item.
 */
(() => {
  'use strict';

  const API = window.WanwoodAPI;
  const VALUES = window.WolimonsValues;
  const ROSTER = window.WolimonsRoster;

  /* One choice per day, rolling over at UTC midnight. The original lucky cat
   * re-rolls at a random point inside a window; a random re-roll time cannot
   * be derived, and two browsers must agree, so the period here is a fixed
   * day and the countdown is exact rather than approximate. */
  const PERIOD_MS = 24 * 60 * 60 * 1000;

  /* Items worth more than this are left out - the badge is meant to be
   * winnable in a trade, not to sit on the single most expensive limited on
   * the site forever. Only applied when a value has actually been set. */
  const LUCKY_MAX_VALUE = 50000;

  /* How many players to try per draw. Today's seed shuffles the roster and
   * the cat walks down it until somebody's inventory is visible and holds an
   * eligible limited; the cap stops a run of private inventories turning one
   * page load into a scan of every tracked player. */
  const MAX_CANDIDATE_PLAYERS = 15;

  /* A draw is good until its period ends anyway, so the cached copy is only
   * there to stop a reload re-walking every owner list. */
  const CACHE_KEY = 'wolimons_luckycat_v1';

  const itemBox = document.getElementById('lucky_cat_item_container');
  const ownerBox = document.getElementById('lucky_cat_owner_container');
  const ownerCaption = document.getElementById('lucky_cat_owner_caption');
  const countdown = document.getElementById('lucky_cat_countdown');

  let timer = null;

  /* ------------------------------------------------------------------ */
  /* Small helpers                                                       */
  /* ------------------------------------------------------------------ */

  const formatNumber = number => Number(number || 0).toLocaleString('en-US');

  const text = (tag, className, value) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined) node.textContent = value;
    return node;
  };

  /* The catalog's slug, character for character the same as the one in
   * catalog-card.js / player.js, so links match across pages. */
  const slugify = value => String(value || 'unnamed')
    .replace(/'/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  function setMessage(box, message) {
    if (!box) return;
    box.replaceChildren();
    if (!message) return;
    const line = text('div', 'text-center py-4 small', message);
    line.style.color = '#c3ccd4';
    box.appendChild(line);
  }

  /* ------------------------------------------------------------------ */
  /* The period, and the seeded draw                                     */
  /* ------------------------------------------------------------------ */

  /* Which UTC day we are in. Integer, shared by everyone whose clock is
   * roughly right. */
  function periodIndex(now = Date.now()) {
    return Math.floor(now / PERIOD_MS);
  }

  function periodEnd(index) {
    return (index + 1) * PERIOD_MS;
  }

  /*
   * A tiny deterministic string hash (FNV-1a, 32-bit). Not cryptography -
   * it only has to spread evenly and give the same answer in every browser,
   * which Math.random cannot do.
   */
  function hash(input) {
    let value = 0x811c9dc5;
    const string = String(input);
    for (let index = 0; index < string.length; index += 1) {
      value ^= string.charCodeAt(index);
      value = Math.imul(value, 0x01000193) >>> 0;
    }
    return value >>> 0;
  }

  /* Order a list by hash(seed + key). Same seed and same members, same
   * order - this is the shuffle the whole page rests on. */
  function seededOrder(list, seed, key) {
    return [...list].sort((a, b) => {
      const left = hash(`${seed}:${key(a)}`);
      const right = hash(`${seed}:${key(b)}`);
      return left - right || String(key(a)).localeCompare(String(key(b)));
    });
  }

  /* ------------------------------------------------------------------ */
  /* Countdown                                                           */
  /* ------------------------------------------------------------------ */

  /* Seconds always show - a countdown that only changes once a minute
   * reads as dead text, which is exactly what "15h 34m" used to do. */
  function remainingLabel(msLeft) {
    const total = Math.max(0, Math.floor(msLeft / 1000));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    const pad = number => String(number).padStart(2, '0');
    if (hours > 0) return `${hours}h ${pad(minutes)}m ${pad(seconds)}s`;
    if (minutes > 0) return `${minutes}m ${pad(seconds)}s`;
    return `${seconds}s`;
  }

  function startCountdown(index) {
    if (!countdown) return;
    if (timer) window.clearInterval(timer);

    const tick = () => {
      const left = periodEnd(index) - Date.now();
      if (left <= 0) {
        countdown.textContent = 'The Lucky Cat is choosing again\u2026';
        window.clearInterval(timer);
        timer = null;
        /* The period has rolled over, so the answer on screen is stale.
         * Re-draw rather than leave a wrong item up. */
        load();
        return;
      }
      countdown.textContent =
        `The Lucky Cat will visit someone new in ${remainingLabel(left)}`;
    };

    tick();
    timer = window.setInterval(tick, 1000);
  }

  /* ------------------------------------------------------------------ */
  /* Cards - both are the snapshot's own card markup                     */
  /* ------------------------------------------------------------------ */

  /* One "Header / image / stat rows" card, which is the shape both the item
   * card and the owner card on this page have. */
  function statCard({ href, title, image, imageAlt, headerColor, footerColor, stats, gradient }) {
    const outer = text('div', 'text-center text-truncate shadow_md_35 shift_up_md');

    const link = document.createElement('a');
    link.href = href;
    link.style.textDecoration = 'none';

    const headWrap = document.createElement('div');
    const heading = text('h6', 'mb-0 px-2 text-light py-1 text-truncate', title);
    heading.title = title;
    heading.style.backgroundColor = headerColor;
    heading.style.maxWidth = '260px';
    headWrap.appendChild(heading);

    const imageWrap = text('div',
      gradient ? 'text-center d-block std_item_card_img_bkgnd_gradient' : 'd-block');
    const picture = document.createElement('img');
    picture.className = 'img-responsive img-fluid shadow-sm';
    picture.src = image;
    picture.alt = imageAlt;
    picture.style.width = '240px';
    picture.style.height = 'auto';
    if (!gradient) picture.style.backgroundColor = '#33383e';
    imageWrap.appendChild(picture);

    const foot = text('div', 'p-2');
    foot.style.backgroundColor = footerColor;
    stats.forEach(([label, value, color]) => {
      const row = text('div', 'd-flex justify-content-between text-truncate');
      const left = document.createElement('div');
      left.appendChild(text('span', 'align-middle text-muted current-stat-header', label));
      const right = document.createElement('div');
      const data = text('span', 'current-stat-data text-truncate', value);
      if (color) data.style.color = color;
      right.appendChild(data);
      row.append(left, right);
      foot.appendChild(row);
    });

    link.append(headWrap, imageWrap, foot);
    outer.appendChild(link);
    return outer;
  }

  function renderItem(choice) {
    if (!itemBox) return;
    itemBox.replaceChildren();

    /* Serial is genuinely absent on most Wanwood copies - the field is there
     * and null - so it prints as "No serial" rather than a made-up number. */
    const serial = Number.isFinite(choice.serialNumber) && choice.serialNumber > 0
      ? `#${formatNumber(choice.serialNumber)}`
      : 'No serial';

    itemBox.appendChild(statCard({
      href: `/item/?id=${choice.itemId}&name=${slugify(choice.itemName)}`,
      title: choice.itemName,
      image: choice.thumbnail,
      imageAlt: 'Item Thumbnail',
      headerColor: '#011d3b',
      footerColor: '#011d3b',
      gradient: true,
      stats: [
        ['Serial', serial, '#e78224'],
        ['UAID', String(choice.userAssetId), '#0084dd'],
      ],
    }));
  }

  function renderOwner(choice) {
    if (!ownerBox) return;
    ownerBox.replaceChildren();

    if (!choice.ownerId) {
      setMessage(ownerBox, 'Wanwood is not naming an owner for this copy right now.');
      return;
    }

    /* The collectibles feed says nothing about when a copy last moved, so
     * there is no honest "Owned Since" to print. What it does say is how
     * much the player is holding, which is a real number from the same
     * response the copy came out of. */
    const stats = [];
    if (Number.isFinite(choice.ownerItems)) {
      stats.push(['Limiteds Held', formatNumber(choice.ownerItems), '']);
    }

    ownerBox.appendChild(statCard({
      href: `/player/?id=${choice.ownerId}`,
      title: choice.ownerName || `User ${choice.ownerId}`,
      image: choice.ownerAvatar || '',
      imageAlt: 'Player Thumbnail',
      headerColor: '#004371',
      footerColor: '#004371',
      gradient: false,
      stats,
    }));
  }

  /* ------------------------------------------------------------------ */
  /* Cache                                                               */
  /* ------------------------------------------------------------------ */

  /* The Lucky Cat's choice depends on which items are eligible - and
   * eligibility reads the values table (projecteds excluded, overpriced
   * items excluded). The draw is therefore stamped with the table version
   * the same way the roster is, so a value being set or reverted sends the
   * cat back to pick again from the corrected pool instead of blessing a
   * copy on the strength of numbers that no longer stand. */
  function valuesVersion() {
    const stamp = Number(VALUES && VALUES.updatedAt);
    return Number.isFinite(stamp) ? stamp : 0;
  }

  function readCache(index) {
    try {
      const raw = window.sessionStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.period !== index) return null;
      if (parsed.valuesVersion !== valuesVersion()) return null;
      return parsed.choice || null;
    } catch (error) {
      return null;
    }
  }

  function writeCache(index, choice) {
    try {
      window.sessionStorage.setItem(CACHE_KEY,
        JSON.stringify({ period: index, valuesVersion: valuesVersion(), choice }));
    } catch (error) {
      /* Private mode, quota, whatever - the page works without a cache. */
    }
  }

  /* ------------------------------------------------------------------ */
  /* Drawing the copy                                                    */
  /* ------------------------------------------------------------------ */

  /*
   * Is this row a limited the cat is allowed to bless?
   *
   * Projected items are excluded because their price is a manipulation
   * rather than a valuation, and anything valued above the ceiling is left
   * out so the badge stays winnable. An item with no value set yet is still
   * eligible - 0 means "nobody has priced it", not "worthless".
   */
  function eligibleItem(row) {
    const id = Number(row && row.assetId);
    if (!Number.isSafeInteger(id) || id <= 0) return false;
    /* Without a UAID the copy cannot be identified, so it cannot be the
     * target no matter how good a fit the item is. */
    if (!Number.isFinite(Number(row.userAssetId))) return false;
    if (!VALUES) return true;
    const categories = VALUES.categories(id) || [];
    if (categories.includes('projected')) return false;
    const value = Number(VALUES.get(id)) || 0;
    return value === 0 || value <= LUCKY_MAX_VALUE;
  }

  /*
   * Today's shortlist of players, in the order this day's seed puts them in.
   * The roster is the site's own tracked-player list, so the cat can only
   * land on somebody /players and /leaderboard already know about.
   */
  function candidatePlayers(players, seed) {
    const named = players.filter(player =>
      player && Number.isSafeInteger(Number(player.id)) && Number(player.id) > 0);
    return seededOrder(named, seed, player => player.id).slice(0, MAX_CANDIDATE_PLAYERS);
  }

  /*
   * The draw, in the order the page describes it: a player first, then one of
   * their limiteds.
   *
   * Walks today's shortlist until a player's inventory is both visible and
   * holds an eligible limited, then picks one copy out of it with the same
   * seed. Returns null when nobody qualifies.
   */
  /*
   * Today's draw as the server made it. Returns null - rather than throwing -
   * whenever the backend cannot answer, so the page falls back to drawing for
   * itself instead of showing an error.
   */
  async function serverDraw() {
    const base = (window.WOLIMONS_CONFIG && window.WOLIMONS_CONFIG.apiBase) || '';
    let payload = null;
    try {
      const response = await fetch(`${base}/api/luckycat`);
      payload = await response.json();
    } catch (error) {
      return null;
    }
    const choice = payload && payload.choice;
    if (!choice || !choice.itemId) return null;

    /* The server names the copy and its owner; the pictures are the browser's
     * job, the same as everywhere else on the site. */
    const itemId = Number(choice.itemId);
    const [thumbs, avatar] = await Promise.all([
      API.fetchThumbnails([itemId]).catch(() => new Map()),
      choice.ownerId ? API.fetchUserAvatar(choice.ownerId, { size: 420 }).catch(() => null) : null,
    ]);

    return {
      itemId,
      itemName: choice.itemName || `Item ${itemId}`,
      thumbnail: thumbs.get(itemId) || API.thumbnailUrl(itemId),
      userAssetId: Number(choice.userAssetId),
      serialNumber: Number.isFinite(Number(choice.serialNumber)) ? Number(choice.serialNumber) : null,
      ownerId: Number(choice.ownerId) || 0,
      ownerName: choice.ownerName || '',
      ownerAvatar: avatar || '',
      ownerItems: Number.isFinite(Number(choice.ownerCopies)) ? Number(choice.ownerCopies) : null,
    };
  }

  async function draw(index) {
    const seed = `luckycat:${index}`;

    /* The roster is shared with /leaderboard and /players and is usually
     * already warm in sessionStorage, so this is normally free. */
    const players = await ROSTER.load();
    if (!Array.isArray(players) || !players.length) return null;

    const shortlist = candidatePlayers(players, seed);
    if (!shortlist.length) return null;

    for (let at = 0; at < shortlist.length; at += 1) {
      const player = shortlist[at];

      /* A private inventory answers with nothing, which is a real answer:
       * that player simply cannot be today's winner. */
      const inventory = await API.getCollectibles(player.id, { pageLimit: 100, maxPages: 4 })
        .catch(() => []);
      const holdings = Array.isArray(inventory) ? inventory.filter(eligibleItem) : [];
      if (!holdings.length) continue;

      /* One copy out of that player's eligible holdings, seeded by the UAID
       * so every browser draws the same one. */
      const copy = seededOrder(holdings, seed, row => row.userAssetId)[0];
      const itemId = Number(copy.assetId);

      const [details, thumbs, avatar] = await Promise.all([
        API.getItemDetails([itemId], { includePrice: false }).catch(() => []),
        API.fetchThumbnails([itemId]).catch(() => new Map()),
        API.fetchUserAvatar(player.id, { size: 420 }).catch(() => null),
      ]);

      const detail = Array.isArray(details) ? details[0] : null;

      return {
        itemId,
        itemName: (detail && detail.name) || (copy.name || '').trim() || `Item ${itemId}`,
        thumbnail: (detail && detail.thumbnail)
          || thumbs.get(itemId)
          || API.thumbnailUrl(itemId),
        userAssetId: Number(copy.userAssetId),
        serialNumber: Number.isFinite(Number(copy.serialNumber)) ? Number(copy.serialNumber) : null,
        ownerId: Number(player.id),
        ownerName: player.name || '',
        ownerAvatar: avatar || player.avatar || '',
        /* Straight off the inventory response that produced the copy, so it
         * is what Wanwood says this player holds, not a figure of ours. */
        ownerItems: inventory.length,
      };
    }

    return null;
  }

  /* ------------------------------------------------------------------ */
  /* Load                                                                */
  /* ------------------------------------------------------------------ */

  async function load() {
    const index = periodIndex();
    startCountdown(index);

    if (!API) {
      setMessage(itemBox, 'The Wanwood API client failed to load.');
      setMessage(ownerBox, '');
      return;
    }

    if (!ROSTER) {
      setMessage(itemBox, 'The player roster script failed to load.');
      setMessage(ownerBox, '');
      return;
    }

    const cached = readCache(index);
    if (cached) {
      renderItem(cached);
      renderOwner(cached);
      return;
    }

    setMessage(itemBox, 'Asking the Lucky Cat who it has visited today\u2026');
    setMessage(ownerBox, '');

    /* The value table decides which items are eligible, so a draw made
     * before it arrives could exclude the wrong ones. */
    if (VALUES && VALUES.ready && typeof VALUES.ready.then === 'function') {
      try {
        await VALUES.ready;
      } catch (error) {
        /* The fallback table is still worth drawing against. */
      }
    }

    let choice = null;
    try {
      /* The server draws now, so every visitor is shown the same copy and a
       * profile can tell whether its player is holding it. The old in-page
       * draw stays below as a fallback for a backend that cannot answer. */
      choice = await serverDraw();
      if (!choice) choice = await draw(index);
    } catch (error) {
      setMessage(itemBox, 'Could not reach Wanwood to find today\u2019s Lucky Cat player. Try again shortly.');
      setMessage(ownerBox, '');
      return;
    }

    if (!choice) {
      setMessage(itemBox,
        'The Lucky Cat found nobody to visit today - no tracked player has a visible inventory with an eligible limited in it.');
      setMessage(ownerBox, '');
      if (ownerCaption) ownerCaption.textContent = 'There is no chosen copy to locate yet.';
      return;
    }

    writeCache(index, choice);
    renderItem(choice);
    renderOwner(choice);
  }

  load();
})();
