/*
 * WoliBadges - the badge catalog, shared by /badges and the player profile.
 *
 * badges/index.html is the canonical list: it owns the artwork and the
 * wording. This module restates the same 48 badges as data, adds the rule
 * that decides whether a player has earned each one, and is the single place
 * the profile badge row is built from. The drawings themselves come from
 * assets/js/badge-art.js, which is generated out of badges/index.html by
 * tools/gen-badge-art.mjs so the two pages can never drift apart.
 *
 * A player's row starts empty. Badges are never assigned by hand here and
 * nothing is granted for merely existing - each one is awarded only when
 * evaluate() finds the player's inventory actually satisfies its rule.
 *
 * Badges whose requirement lives off-site (Discord events, trade ads,
 * manual recognition) have `earn: null`. They are listed so the catalog and
 * the profile agree on what exists, but no browser-side rule can ever grant
 * them - including Certified Wanwoodian, which is a specific award and not a
 * decoration every account wears.
 */

(function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* Tiers                                                               */
  /* ------------------------------------------------------------------ */

  /* Matches the .border_top_* colours in css/koromons.css. Rank orders the
   * profile row so the rarest badge sits first. */
  const TIERS = {
    artifact: { rank: 90, label: 'Artifact' },
    legendary: { rank: 80, label: 'Legendary' },
    koro_award_winner: { rank: 75, label: 'Woli Award Winner' },
    koro_award_nominee: { rank: 70, label: 'Woli Award Nominee' },
    epic: { rank: 60, label: 'Epic' },
    booster: { rank: 55, label: 'Booster' },
    rare: { rank: 40, label: 'Rare' },
    uncommon: { rank: 20, label: 'Uncommon' },
    common: { rank: 10, label: 'Common' },
  };

  /* ------------------------------------------------------------------ */
  /* Tunables                                                            */
  /* ------------------------------------------------------------------ */

  /*
   * Wanwood exposes no rarity flag, so "a rare limited" is derived from how
   * many copies of the item exist (resale-data assetStock / numberRemaining,
   * falling back to serialCount). Anything at or under this many copies
   * counts as rare.
   */
  const RARE_MAX_COPIES = 100;

  /*
   * Accessorized wants a limited of every wearable asset type. These are the
   * Roblox asset type ids that can be limited; assetTypeId comes straight off
   * the collectibles rows.
   */
  const ACCESSORY_ASSET_TYPES = [
    8,  /* Hat */
    18, /* Face */
    19, /* Gear */
    41, /* Hair Accessory */
    42, /* Face Accessory */
    43, /* Neck Accessory */
    44, /* Shoulder Accessory */
    45, /* Front Accessory */
    46, /* Back Accessory */
    47, /* Waist Accessory */
  ];

  /* ------------------------------------------------------------------ */
  /* Matching helpers                                                    */
  /* ------------------------------------------------------------------ */

  function clean(name) {
    return String(name || '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  /* Every item row the player owns, matched against a name test. */
  function owns(context, test) {
    return context.items.some(item => test(clean(item.name), item));
  }

  function countCopies(context, test) {
    return context.items.reduce(
      (sum, item) => (test(clean(item.name), item) ? sum + item.copies : sum), 0);
  }

  function hasSerial(context, test) {
    return context.items.some(item => item.serials.some(test));
  }

  /* Highest number of copies of any single item. */
  function biggestHoard(context) {
    return context.items.reduce((best, item) => Math.max(best, item.copies), 0);
  }

  /* Largest share of one item's existing copies the player holds, 0..1.
   * Items whose supply is unknown, or that only ever had one copy, are
   * skipped - the badges explicitly require 2+ available copies. */
  function biggestShare(context) {
    return context.items.reduce((best, item) => {
      if (!Number.isFinite(item.available) || item.available < 2) return best;
      return Math.max(best, item.copies / item.available);
    }, 0);
  }

  function rareCount(context) {
    return context.items.reduce((sum, item) => {
      if (!Number.isFinite(item.available) || item.available <= 0) return sum;
      return item.available <= RARE_MAX_COPIES ? sum + 1 : sum;
    }, 0);
  }

  const DOMINUS = /dominus/;
  const BIG_DOMINI = /dominus (empyreus|frigidus|astra|infernus|pittacium|aureus|messor|rex)/;
  const NOOB_ITEMS = /(noob attack|noob assist|pocket pal|bag o'? noobs)/;
  const KATANAS = ['blue', 'crimson', 'golden', 'iris', 'jade', 'ocherous'];

  function valueAtLeast(amount) {
    return context => context.totalValue >= amount;
  }

  function copiesAtLeast(amount) {
    return context => context.totalCopies >= amount;
  }

  /* ------------------------------------------------------------------ */
  /* The catalog                                                         */
  /* ------------------------------------------------------------------ */

  /*
   * id      - slug, matches the key in assets/js/badge-art.js
   * name    - exactly as printed on /badges
   * tier    - drives the border colour and the row ordering
   * section - the heading it appears under on /badges
   * earn    - (context) => boolean, or null when it cannot be automatic
   */
  const LIST = [
    /* --- Community: awarded by hand, off-site ----------------------- */
    { id: 'contributor', name: 'Contributor', tier: 'legendary', section: 'Community Badges', earn: null },
    { id: 'sword-fighting-champion', name: 'Sword Fighting Champion', tier: 'legendary', section: 'Community Badges', earn: null },
    { id: 'woli-award-winner', name: 'Woli Award Winner', tier: 'koro_award_winner', section: 'Community Badges', earn: null },
    { id: 'woli-award-nominee', name: 'Woli Award Nominee', tier: 'koro_award_nominee', section: 'Community Badges', earn: null },
    { id: 'event-winner', name: 'Event Winner', tier: 'epic', section: 'Community Badges', earn: null },
    { id: 'game-night-winner', name: 'Game Night Winner', tier: 'rare', section: 'Community Badges', earn: null },
    { id: 'booster', name: 'Booster', tier: 'booster', section: 'Community Badges', earn: null },
    { id: 'woligang', name: 'Woligang', tier: 'uncommon', section: 'Community Badges', earn: null },

    /* --- Website: trade ads are a site feature that does not exist
     *     yet, so nothing can grant these either ---------------------- */
    { id: 'boundless-trader', name: 'Boundless Trader', tier: 'legendary', section: 'Website Badges', earn: null },
    { id: 'active-trader', name: 'Active Trader', tier: 'rare', section: 'Website Badges', earn: null },
    { id: 'frequent-trader', name: 'Frequent Trader', tier: 'uncommon', section: 'Website Badges', earn: null },
    { id: 'trade-advertiser', name: 'Trade Advertiser', tier: 'common', section: 'Website Badges', earn: null },

    /* The only automatic account badge. The catalog entry reads "Verify your
     * account on the site", so it tracks Wolimons verification - the profile
     * description proof handled by /verify - and not Wanwood's own isVerified
     * flag, which is what the separate Verified Checkmark represents. */
    { id: 'verified', name: 'Verified', tier: 'uncommon', section: 'Website Badges', earn: context => context.siteVerified === true },

    /* Both are manual recognition, handed out to specific people. */
    { id: 'verified-checkmark', name: 'Verified Checkmark', tier: 'rare', section: 'Website Badges', earn: null },
    { id: 'certified-wanwoodian', name: 'Certified Wanwoodian', tier: 'legendary', section: 'Website Badges', earn: null },

    /* --- Trading: everything below is computed from the inventory ---- */
    { id: '20m-plus', name: '20M+', tier: 'artifact', section: 'Trading Badges', earn: valueAtLeast(20000000) },
    { id: '10m-plus', name: '10M+', tier: 'legendary', section: 'Trading Badges', earn: valueAtLeast(10000000) },
    { id: '5m-plus', name: '5M+', tier: 'epic', section: 'Trading Badges', earn: valueAtLeast(5000000) },
    { id: '1m-plus', name: '1M+', tier: 'rare', section: 'Trading Badges', earn: valueAtLeast(1000000) },
    { id: '500k-plus', name: '500K+', tier: 'uncommon', section: 'Trading Badges', earn: valueAtLeast(500000) },
    { id: '100k-plus', name: '100K+', tier: 'common', section: 'Trading Badges', earn: valueAtLeast(100000) },

    { id: 'lucky-cat', name: 'Lucky Cat', tier: 'epic', section: 'Trading Badges', earn: context => owns(context, name => name === 'lucky cat') },

    { id: 'serial-1', name: 'Serial #1', tier: 'rare', section: 'Trading Badges', earn: context => hasSerial(context, serial => serial === 1) },
    { id: 'l337', name: 'L337', tier: 'rare', section: 'Trading Badges', earn: context => hasSerial(context, serial => serial === 1337) },
    { id: 'sequential-serial', name: 'Sequential Serial', tier: 'rare', section: 'Trading Badges', earn: context => hasSerial(context, serial => serial === 123 || serial === 1234 || serial === 12345) },
    { id: 'low-serial', name: 'Low Serial', tier: 'uncommon', section: 'Trading Badges', earn: context => hasSerial(context, serial => serial > 0 && serial < 10) },

    { id: 'big-dominator', name: 'Big Dominator', tier: 'epic', section: 'Trading Badges', earn: context => owns(context, name => BIG_DOMINI.test(name)) },
    { id: 'dominator', name: 'Dominator', tier: 'rare', section: 'Trading Badges', earn: context => owns(context, name => DOMINUS.test(name)) },
    { id: 'sparkly', name: 'Sparkly', tier: 'rare', section: 'Trading Badges', earn: context => owns(context, name => name.includes('sparkle time fedora')) },
    /* "a valued federation item" - a federation item Wolimons has priced. */
    { id: 'federated', name: 'Federated', tier: 'uncommon', section: 'Trading Badges', earn: context => owns(context, (name, item) => name.includes('federation') && item.value > 0) },
    { id: 'enduring', name: 'Enduring', tier: 'uncommon', section: 'Trading Badges', earn: context => owns(context, name => name.includes('immortal sword')) },
    {
      id: 'epic-blade-collector',
      name: 'Epic Blade Collector',
      tier: 'rare',
      section: 'Trading Badges',
      earn: context => KATANAS.every(colour =>
        owns(context, name => name.includes('katana') && name.includes(colour))),
    },
    { id: 'evening-royalty', name: 'Evening Royalty', tier: 'uncommon', section: 'Trading Badges', earn: context => owns(context, name => name.includes('king of the night')) },
    { id: 'noobie', name: 'Noobie', tier: 'uncommon', section: 'Trading Badges', earn: context => countCopies(context, name => NOOB_ITEMS.test(name)) >= 15 },
    { id: 'noob', name: 'Noob', tier: 'common', section: 'Trading Badges', earn: context => countCopies(context, name => NOOB_ITEMS.test(name)) >= 5 },

    { id: 'rare-supremist', name: 'Rare Supremist', tier: 'epic', section: 'Trading Badges', earn: context => rareCount(context) >= 10 },
    { id: 'rare-enthusiast', name: 'Rare Enthusiast', tier: 'rare', section: 'Trading Badges', earn: context => rareCount(context) >= 3 },
    { id: 'rare-owner', name: 'Rare Owner', tier: 'uncommon', section: 'Trading Badges', earn: context => rareCount(context) >= 1 },

    { id: 'uncontrollable-addiction', name: 'Uncontrollable Addiction', tier: 'artifact', section: 'Trading Badges', earn: context => biggestShare(context) >= 0.5 },
    { id: 'unhealthy-obsession', name: 'Unhealthy Obsession', tier: 'legendary', section: 'Trading Badges', earn: context => biggestShare(context) >= 0.25 },
    { id: 'modest-enthusiasm', name: 'Modest Enthusiasm', tier: 'epic', section: 'Trading Badges', earn: context => biggestShare(context) >= 0.1 },

    { id: 'mega-hoarder', name: 'Mega Hoarder', tier: 'epic', section: 'Trading Badges', earn: context => biggestHoard(context) >= 100 },
    { id: 'hoarder', name: 'Hoarder', tier: 'rare', section: 'Trading Badges', earn: context => biggestHoard(context) >= 50 },
    { id: 'mini-hoarder', name: 'Mini Hoarder', tier: 'uncommon', section: 'Trading Badges', earn: context => biggestHoard(context) >= 10 },

    { id: 'incurable-collector', name: 'Incurable Collector', tier: 'epic', section: 'Trading Badges', earn: copiesAtLeast(1000) },
    { id: 'devout-collector', name: 'Devout Collector', tier: 'rare', section: 'Trading Badges', earn: copiesAtLeast(100) },
    { id: 'collector', name: 'Collector', tier: 'uncommon', section: 'Trading Badges', earn: copiesAtLeast(10) },

    {
      id: 'accessorized',
      name: 'Accessorized',
      tier: 'rare',
      section: 'Trading Badges',
      earn: context => ACCESSORY_ASSET_TYPES.every(type => context.assetTypes.has(type)),
    },
  ];

  const BY_ID = new Map(LIST.map(badge => [badge.id, badge]));

  /* ------------------------------------------------------------------ */
  /* Evaluation                                                          */
  /* ------------------------------------------------------------------ */

  /*
   * Turns a profile's raw numbers into the shape the rules above read.
   *
   *   items        - [{ id, name, value, rap, copies, serials, assetTypeId,
   *                     available }]  (available = copies in existence, or null)
   *   verified     - users/v1/users/{id}.isVerified, Wanwood's own flag
   *   siteVerified - this player proved ownership through /verify
   *
   * Everything else is derived so no caller has to agree on how a total is
   * computed.
   */
  function buildContext({ items = [], verified = false, siteVerified = false } = {}) {
    const normalized = items.map(item => ({
      id: Number(item.id) || 0,
      name: String(item.name || ''),
      value: Number(item.value) || 0,
      rap: Number(item.rap) || 0,
      copies: Math.max(1, Number(item.copies) || 1),
      serials: (Array.isArray(item.serials) ? item.serials : [])
        .map(Number)
        .filter(serial => Number.isFinite(serial) && serial > 0),
      assetTypeId: Number.isFinite(Number(item.assetTypeId)) ? Number(item.assetTypeId) : null,
      available: Number.isFinite(Number(item.available)) ? Number(item.available) : null,
    }));

    const assetTypes = new Set();
    normalized.forEach(item => {
      if (item.assetTypeId !== null) assetTypes.add(item.assetTypeId);
    });

    return {
      items: normalized,
      verified: verified === true,
      siteVerified: siteVerified === true,
      assetTypes,
      totalValue: normalized.reduce((sum, item) => sum + (item.value * item.copies), 0),
      totalRap: normalized.reduce((sum, item) => sum + (item.rap * item.copies), 0),
      totalCopies: normalized.reduce((sum, item) => sum + item.copies, 0),
      uniqueItems: normalized.length,
    };
  }

  /*
   * Returns the badges this player has earned, rarest first, then in catalog
   * order. An empty array is the normal result for a player who has not met
   * any requirement yet - callers must render nothing in that case.
   */
  function evaluate(input) {
    const context = input && input.items && input.assetTypes ? input : buildContext(input);

    const earned = [];
    LIST.forEach((badge, index) => {
      if (typeof badge.earn !== 'function') return;
      let ok = false;
      try {
        ok = badge.earn(context) === true;
      } catch (error) {
        /* A broken rule must never take the profile down with it. */
        ok = false;
      }
      if (ok) earned.push({ badge, index });
    });

    earned.sort((a, b) => {
      const rankA = (TIERS[a.badge.tier] || {}).rank || 0;
      const rankB = (TIERS[b.badge.tier] || {}).rank || 0;
      return (rankB - rankA) || (a.index - b.index);
    });

    return earned.map(entry => entry.badge);
  }

  /* Artwork for one badge, as an element. Falls back to nothing rather than
   * throwing if badge-art.js was not loaded on this page. */
  function iconNode(id) {
    const art = (window.WolimonsBadgeArt || {})[id];
    if (!art) return null;
    const span = document.createElement('span');
    span.className = 'roli_badge';
    span.innerHTML = art;
    return span;
  }

  window.WolimonsBadges = {
    LIST,
    TIERS,
    RARE_MAX_COPIES,
    ACCESSORY_ASSET_TYPES,
    get: id => BY_ID.get(id) || null,
    buildContext,
    evaluate,
    iconNode,
  };
})();
