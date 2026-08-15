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
 *   - which six-hour period we are in (UTC), and
 *   - the catalog and its owner lists, as Wanwood reports them right now.
 *
 * The period number seeds a small deterministic hash. Every browser hashing
 * the same period against the same candidate list lands on the same copy, so
 * two people comparing screens see the same UAID, and nobody - including
 * whoever runs the site - can steer it. When the period rolls over the seed
 * changes and a different copy is drawn. That is a real, checkable rule; a
 * hardcoded "current item" would be a fabrication.
 *
 * The candidate pool is the honest one:
 *   - a limited that Wanwood will actually name an owner for (a private
 *     inventory means the copy cannot be found, so it cannot be the target),
 *   - not flagged projected in the value table,
 *   - value at or below LUCKY_MAX_VALUE where a value has been set. An item
 *     nobody has valued is still eligible - value 0 means "not priced yet",
 *     never "worthless".
 *
 * If the API is unreachable, or no item passes, the page says so rather than
 * showing a placeholder cat item.
 */
(() => {
  'use strict';

  const API = window.WanwoodAPI;
  const VALUES = window.WolimonsValues;

  /* How long one choice lasts. The real Rolimon's re-rolls at a random point
   * inside a 4-24h window; a random re-roll time cannot be derived, and two
   * browsers must agree, so the period here is fixed and the countdown is
   * exact rather than approximate. */
  const PERIOD_MS = 6 * 60 * 60 * 1000;

  /* Items worth more than this are left out - the badge is meant to be
   * winnable in a trade, not to sit on the single most expensive limited on
   * the site forever. Only applied when a value has actually been set. */
  const LUCKY_MAX_VALUE = 50000;

  /* How many items to consider per draw. The whole catalog is small, but the
   * owner walk is one request per item, so the pool is capped: the period
   * seed picks which slice of the shuffled catalog gets walked. */
  const MAX_CANDIDATES = 12;

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
   * catalog-card.js / deals.js / player.js, so links match across pages. */
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

  /* Which six-hour block of UTC time we are in. Integer, shared by everyone
   * whose clock is roughly right. */
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

  function remainingLabel(msLeft) {
    const total = Math.max(0, Math.floor(msLeft / 1000));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
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
        `The Lucky Cat will choose a new item in ${remainingLabel(left)}`;
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

    /* "Owned since" is the copy's own updated timestamp - when it last moved
     * into the current inventory - not a guess and not a scan of ours. */
    const stats = [];
    const moved = choice.updated ? Date.parse(choice.updated) : NaN;
    if (Number.isFinite(moved)) {
      stats.push(['Owned Since', relativeTime(moved), '']);
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

  /* The same wording tradeads-core.js uses, so ages read alike site-wide. */
  function relativeTime(timestamp) {
    const seconds = Math.max(0, Math.round((Date.now() - Number(timestamp)) / 1000));
    const steps = [[60, 'second'], [60, 'minute'], [24, 'hour'], [7, 'day'], [4.348, 'week'], [12, 'month']];
    let amount = seconds;
    let unit = 'second';
    for (let index = 0; index < steps.length; index += 1) {
      const [size, name] = steps[index];
      if (amount < size) { unit = name; break; }
      amount = Math.floor(amount / size);
      unit = steps[index + 1] ? steps[index + 1][1] : 'year';
    }
    const rounded = Math.max(1, Math.floor(amount));
    return `${rounded} ${unit}${rounded === 1 ? '' : 's'} ago`;
  }

  /* ------------------------------------------------------------------ */
  /* Cache                                                               */
  /* ------------------------------------------------------------------ */

  function readCache(index) {
    try {
      const raw = window.sessionStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.period !== index) return null;
      return parsed.choice || null;
    } catch (error) {
      return null;
    }
  }

  function writeCache(index, choice) {
    try {
      window.sessionStorage.setItem(CACHE_KEY, JSON.stringify({ period: index, choice }));
    } catch (error) {
      /* Private mode, quota, whatever - the page works without a cache. */
    }
  }

  /* ------------------------------------------------------------------ */
  /* Drawing the copy                                                    */
  /* ------------------------------------------------------------------ */

  /* Items the cat is allowed to look at, in the order this period puts them
   * in. Value and projected come from the local value table; nothing here is
   * fetched twice. */
  function candidateIds(ids, seed) {
    const eligible = ids.filter(id => {
      if (!VALUES) return true;
      const categories = VALUES.categories(id) || [];
      if (categories.includes('projected')) return false;
      const value = Number(VALUES.get(id)) || 0;
      /* 0 means "not valued yet", which is not a reason to exclude. */
      return value === 0 || value <= LUCKY_MAX_VALUE;
    });
    return seededOrder(eligible, seed, id => id).slice(0, MAX_CANDIDATES);
  }

  /*
   * Walks the shuffled candidates until one of them has a nameable owner,
   * then draws one of that item's copies with the same seed. Returns null
   * when nothing qualifies.
   */
  async function draw(index) {
    const seed = `luckycat:${index}`;

    const ids = await API.listAllCollectibles();
    if (!Array.isArray(ids) || !ids.length) return null;

    const shortlist = candidateIds(ids, seed);
    if (!shortlist.length) return null;

    for (let at = 0; at < shortlist.length; at += 1) {
      const itemId = shortlist[at];
      const owners = await API.getAssetOwners(itemId, { pageLimit: 100, maxPages: 4 })
        .catch(() => []);
      /* A copy with no UAID cannot be identified, and a copy with no named
       * owner cannot be found - neither can be the Lucky Cat item. */
      const copies = owners.filter(row => row.userAssetId && row.userId);
      if (!copies.length) continue;

      const copy = seededOrder(copies, seed, row => row.userAssetId)[0];

      const [details, thumbs, avatar] = await Promise.all([
        API.getItemDetails([itemId], { includePrice: false }).catch(() => []),
        API.fetchThumbnails([itemId]).catch(() => new Map()),
        API.fetchUserAvatar(copy.userId, { size: 420 }).catch(() => null),
      ]);

      const detail = Array.isArray(details) ? details[0] : null;

      return {
        itemId,
        itemName: (detail && detail.name) || `Item ${itemId}`,
        thumbnail: (detail && detail.thumbnail)
          || thumbs.get(itemId)
          || API.thumbnailUrl(itemId),
        userAssetId: copy.userAssetId,
        serialNumber: copy.serialNumber,
        ownerId: copy.userId,
        ownerName: copy.name || '',
        ownerAvatar: avatar || '',
        updated: copy.updated || copy.created || null,
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

    const cached = readCache(index);
    if (cached) {
      renderItem(cached);
      renderOwner(cached);
      return;
    }

    setMessage(itemBox, 'Asking the Lucky Cat what it has chosen\u2026');
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
      choice = await draw(index);
    } catch (error) {
      setMessage(itemBox, 'Could not reach Wanwood to find the Lucky Cat item. Try again shortly.');
      setMessage(ownerBox, '');
      return;
    }

    if (!choice) {
      setMessage(itemBox,
        'No item qualifies for the Lucky Cat right now - nothing in the catalog has an owner Wanwood will name.');
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
