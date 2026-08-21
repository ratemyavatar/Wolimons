'use strict';

/*
 * Link previews for player profiles.
 *
 * Paste /player/?id=123 into Discord and the unfurler asks this server for the
 * page. It does not run JavaScript, so it only ever sees the HTML as it leaves
 * the disk - and that HTML is a shell whose numbers are filled in by player.js
 * in the browser. That is why every profile link used to preview as the same
 * generic "Wolimons - Wanwood Trading Website" card.
 *
 * So when a crawler asks for a profile, the og: tags are rewritten server-side
 * with that player's real figures before the HTML is sent.
 *
 *   thumbnail  their avatar, as the preview image
 *   RAP        summed the same way the profile page sums it
 *   Value      from our own value table, which is ours and not Wanwood's
 *   Limiteds   how many collectibles they hold
 *   Rank       their place on the leaderboard, when it is known
 *
 * ---------------------------------------------------------------------------
 * WHY RANK IS THE AWKWARD ONE
 * ---------------------------------------------------------------------------
 * The other four come from one cheap call about one player. Rank does not
 * exist as a field anywhere: the leaderboard is built by walking every
 * collectible's owner list and adding up what each player holds. That takes a
 * lot of requests and far longer than the couple of seconds an unfurler will
 * wait.
 *
 * So the roster is computed in the background and cached. A preview asked for
 * before the first roster is ready simply leaves the rank line out rather than
 * blocking - and rather than printing a number that might be wrong.
 */

const fs = require('fs');
const path = require('path');
const store = require('./store');

const UPSTREAM = (process.env.UPSTREAM_ORIGIN || 'https://wanwoo.xyz').replace(/\/+$/, '');
const TIMEOUT_MS = Number(process.env.EMBED_TIMEOUT_MS || 6000);

/* How long a built preview and the roster behind it stay good for. */
const EMBED_TTL_MS = Number(process.env.EMBED_TTL_MS || 10 * 60 * 1000);
const ROSTER_TTL_MS = Number(process.env.ROSTER_TTL_MS || 6 * 60 * 60 * 1000);

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) '
    + 'Chrome/125.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
};

/*
 * The unfurlers worth answering. Ordinary browsers must NOT match: for them
 * the page is served untouched and player.js fills it in, which is both
 * faster and always current.
 */
const CRAWLER = /(discordbot|twitterbot|slackbot|telegrambot|whatsapp|facebookexternalhit|linkedinbot|embedly|redditbot|skypeuripreview|bingpreview|googlebot|pinterest|vkshare|tumblr|mastodon|matrix|signal|iframely|opengraph)/i;

/*
 * Terminated-limiteds holding accounts, read out of assets/js/config.js so the
 * list lives in exactly one place. The browser reads that file directly; this
 * scrapes the same array out of it rather than keeping a second copy here that
 * could drift. A parse failure just means no account is treated as a holding
 * account, which is the harmless direction to fail in.
 */
const HOLDING_ACCOUNTS = (() => {
  try {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'assets', 'js', 'config.js'), 'utf8');
    const block = src.match(/const HOLDING_ACCOUNTS\s*=\s*\[([\s\S]*?)\]/);
    if (!block) return new Set();
    const names = [...block[1].matchAll(/['"]([^'"]+)['"]/g)]
      .map(m => m[1].trim().toLowerCase())
      .filter(Boolean);
    return new Set(names);
  } catch (error) {
    return new Set();
  }
})();

/* The same accounts by id, scraped the same way. Ids survive a rename, so
 * this is the half that keeps working when the name list has gone stale. */
const HOLDING_ACCOUNT_IDS = (() => {
  try {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'assets', 'js', 'config.js'), 'utf8');
    const block = src.match(/const HOLDING_ACCOUNT_IDS\s*=\s*\[([\s\S]*?)\]/);
    if (!block) return new Set();
    const ids = [...block[1].matchAll(/\d+/g)]
      .map(m => Number(m[0]))
      .filter(id => Number.isSafeInteger(id) && id > 0);
    return new Set(ids);
  } catch (error) {
    return new Set();
  }
})();

function isHoldingAccount(name) {
  return HOLDING_ACCOUNTS.has(String(name || '').trim().toLowerCase());
}

function isHoldingAccountId(id) {
  return HOLDING_ACCOUNT_IDS.has(Number(id));
}

function isCrawler(userAgent) {
  return CRAWLER.test(String(userAgent || ''));
}

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

async function getJson(path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${UPSTREAM}${path}`, {
      headers: BROWSER_HEADERS,
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return await response.json();
  } catch (error) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/* Numbers read nicer as 1,234,567 in a preview than as 1234567. */
function formatNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0';
  return number.toLocaleString('en-US');
}

/*
 * Anything interpolated into an attribute has to be escaped. A username is
 * attacker-chosen text, and without this a quote in a name would break out of
 * the content="..." and let arbitrary markup into the page.
 */
function escapeAttr(text) {
  return String(text == null ? '' : text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ------------------------------------------------------------------ */
/* The leaderboard roster, in the background                           */
/* ------------------------------------------------------------------ */

let roster = { at: 0, ranks: new Map() };
let rosterBuilding = null;

async function listCollectibleIds() {
  const ids = [];
  let cursor = '';
  for (let page = 0; page < 20; page += 1) {
    const query = new URLSearchParams({ Category: '1', Limit: '100', SortType: '3' });
    if (cursor) query.set('Cursor', cursor);
    const result = await getJson(`/apisite/catalog/v1/search/items?${query}`);
    const rows = result && Array.isArray(result.data) ? result.data : [];
    rows.forEach(row => {
      const id = Number(row.id ?? row.assetId ?? row.Id);
      if (Number.isSafeInteger(id) && id > 0) ids.push(id);
    });
    cursor = (result && result.nextPageCursor) || '';
    if (!cursor) break;
  }
  return [...new Set(ids)];
}

async function ownersOf(assetId) {
  const owners = [];
  let cursor = '';
  for (let page = 0; page < 30; page += 1) {
    const query = new URLSearchParams({ limit: '100', sortOrder: 'Asc' });
    if (cursor) query.set('cursor', cursor);
    const result = await getJson(`/apisite/inventory/v2/assets/${assetId}/owners?${query}`);
    const rows = result && Array.isArray(result.data) ? result.data : [];
    rows.forEach(row => {
      const id = Number(row.owner && (row.owner.userId ?? row.owner.id));
      if (!Number.isSafeInteger(id) || id <= 0) return;
      /* Holding accounts are not ranked, the same way the browser leaves them
       * out of the leaderboard - otherwise the ranks this hands to previews
       * would disagree with the board the reader sees. The owners feed carries
       * the name, so this costs no extra request. */
      if (isHoldingAccountId(id)) return;
      if (isHoldingAccount(row.owner && row.owner.name)) return;
      owners.push(id);
    });
    cursor = (result && result.nextPageCursor) || '';
    if (!cursor) break;
  }
  return owners;
}

async function rapOf(assetId) {
  const result = await getJson(`/apisite/economy/v1/assets/${assetId}/resale-data`);
  return Number(result && result.recentAveragePrice) || 0;
}

/* Run `worker` over `items`, at most `limit` at a time. */
async function mapLimit(items, limit, worker) {
  const queue = [...items];
  const runners = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      try {
        await worker(item);
      } catch (error) {
        /* One bad asset must not abandon the whole scan. */
      }
    }
  });
  await Promise.all(runners);
}

/*
 * Ranked exactly like the leaderboard page: Value first, RAP breaks ties, id
 * settles the rest. The two have to agree or the preview would contradict the
 * page it links to.
 */
async function buildRoster() {
  const assetIds = await listCollectibleIds();
  if (!assetIds.length) return;

  const values = (await store.snapshot()).values || {};
  const totals = new Map();

  await mapLimit(assetIds, 4, async assetId => {
    const [owners, rap] = await Promise.all([ownersOf(assetId), rapOf(assetId)]);
    /* Unvalued items are worth their RAP - the same rule the site follows, so
     * the rank in a link preview matches the one on the leaderboard. */
    const setValue = Number(values[String(assetId)] && values[String(assetId)].value) || 0;
    const value = setValue > 0 ? setValue : (Number(rap) || 0);
    owners.forEach(userId => {
      const row = totals.get(userId) || { id: userId, rap: 0, value: 0 };
      row.rap += rap;
      row.value += value;
      totals.set(userId, row);
    });
  });

  const ranked = [...totals.values()].sort((a, b) =>
    (b.value - a.value) || (b.rap - a.rap) || (a.id - b.id));

  const ranks = new Map();
  ranked.forEach((row, index) => ranks.set(row.id, index + 1));
  roster = { at: Date.now(), ranks };
}

/*
 * Never awaited by a request. The first preview after a restart goes out
 * without a rank; by the next one the roster is usually there.
 */
function refreshRosterInBackground() {
  if (rosterBuilding) return;
  if (roster.at && Date.now() - roster.at < ROSTER_TTL_MS) return;
  rosterBuilding = buildRoster()
    .catch(error => console.error('[embed] roster scan failed:', error.message))
    .finally(() => { rosterBuilding = null; });
}

/* ------------------------------------------------------------------ */
/* One player's figures                                                */
/* ------------------------------------------------------------------ */

const cache = new Map();

async function playerSummary(userId) {
  const hit = cache.get(userId);
  if (hit && Date.now() < hit.expires) {
    /* The roster usually lands after the first preview of a player. Pick the
     * rank up on the way out rather than serving the cached "no rank" for the
     * rest of the entry's life. */
    if (hit.data.rank == null) hit.data.rank = roster.ranks.get(userId) || null;
    return hit.data;
  }

  const [account, collectibles, thumbs] = await Promise.all([
    getJson(`/apisite/api/users/${userId}`),
    getJson(`/apisite/inventory/v1/users/${userId}/assets/collectibles?limit=100&sortOrder=Asc`),
    getJson(`/apisite/thumbnails/v1/users/avatar?userIds=${userId}&size=420x420&format=Png`),
  ]);

  const name = String((account && (account.Username ?? account.username)) || '').trim();
  if (!name || name === '?') return null;

  const rows = collectibles && Array.isArray(collectibles.data) ? collectibles.data : [];
  const values = (await store.snapshot()).values || {};

  let rap = 0;
  let value = 0;
  rows.forEach(row => {
    const assetId = String(row.assetId ?? row.AssetId ?? '');
    rap += Number(row.recentAveragePrice) || 0;
    value += Number(values[assetId] && values[assetId].value) || 0;
  });

  /* The account's own total is authoritative when the list was paged. */
  const reportedRap = Number(collectibles && collectibles.totalRap);
  if (Number.isFinite(reportedRap) && reportedRap > 0) rap = reportedRap;

  let avatar = '';
  const thumbRow = thumbs && Array.isArray(thumbs.data) ? thumbs.data[0] : null;
  if (thumbRow && thumbRow.state === 'Completed' && thumbRow.imageUrl) avatar = thumbRow.imageUrl;

  const data = {
    id: userId,
    name,
    rap,
    value,
    limiteds: rows.length,
    hasMore: Boolean(collectibles && collectibles.nextPageCursor),
    avatar,
    rank: roster.ranks.get(userId) || null,
  };

  cache.set(userId, { expires: Date.now() + EMBED_TTL_MS, data });
  if (cache.size > 300) cache.delete(cache.keys().next().value);
  return data;
}

/* ------------------------------------------------------------------ */
/* Rewriting the tags                                                  */
/* ------------------------------------------------------------------ */

/*
 * Unfurlers fetch og:image themselves, and Wanwood refuses requests that do
 * not look like a browser - so an image URL pointing straight at the upstream
 * would preview as nothing. Routing the URL through this origin instead lets
 * the proxy (which already speaks browser to Wanwood) serve the bytes, and
 * relative paths become absolute because crawlers need a full URL.
 */
function publicImage(image, base) {
  if (!image) return `${base}/assets/Wolimonslogoo.png`;
  if (image.startsWith('/')) return `${base}${image}`;
  try {
    const parsed = new URL(image);
    if (parsed.host === new URL(UPSTREAM).host) {
      return `${base}${parsed.pathname}${parsed.search}`;
    }
    return image;
  } catch (error) {
    return image;
  }
}

function buildTags(player, pageUrl) {
  const parts = [
    `Value ${formatNumber(player.value)}`,
    `RAP ${formatNumber(player.rap)}`,
    `${formatNumber(player.limiteds)}${player.hasMore ? '+' : ''} limiteds`,
  ];
  /* Only stated when it is actually known. */
  if (player.rank) parts.push(`Rank #${formatNumber(player.rank)}`);
  /* Holding accounts are not ranked, so say why rather than just leaving the
   * rank off and letting the preview imply an ordinary unranked player. */
  if (isHoldingAccountId(player.id) || isHoldingAccount(player.name)) {
    parts.push('Limited holder account');
  }

  const title = `${player.name} - Wolimons`;
  const description = parts.join('  |  ');
  const base = new URL(pageUrl).origin;
  const image = publicImage(player.avatar, base);

  return { title, description, image, url: pageUrl };
}

/*
 * Replaces the existing tags rather than appending: Discord honours the first
 * og:title it finds, so a second one further down the head would be ignored.
 */
function applyTags(html, tags) {
  const replacements = [
    [/(<meta\s+property="og:title"\s+content=")[^"]*(")/i, tags.title],
    [/(<meta\s+property="og:description"\s+content=")[^"]*(")/i, tags.description],
    [/(<meta\s+property="og:image"\s+content=")[^"]*(")/i, tags.image],
    [/(<meta\s+property="og:url"\s+content=")[^"]*(")/i, tags.url],
    [/(<meta\s+name="twitter:title"\s+content=")[^"]*(")/i, tags.title],
    [/(<meta\s+name="twitter:description"\s+content=")[^"]*(")/i, tags.description],
    [/(<meta\s+name="twitter:image"\s+content=")[^"]*(")/i, tags.image],
    [/(<meta\s+name="description"\s+content=")[^"]*(")/i, tags.description],
  ];

  let out = html;
  replacements.forEach(([pattern, replacement]) => {
    out = out.replace(pattern, `$1${escapeAttr(replacement)}$2`);
  });

  /* A large image makes the avatar the body of the card, not a thumbnail. */
  out = out.replace(/(<meta\s+name="twitter:card"\s+content=")[^"]*(")/i,
    '$1summary_large_image$2');

  return out;
}

/*
 * ---------------------------------------------------------------------------
 * Item previews
 *
 * Same idea as the player preview below, for /item/?id=<assetId>. Value,
 * demand and trend are ours (they live in the store, hand-set by staff); the
 * name, RAP and thumbnail come from Wanwood.
 * ---------------------------------------------------------------------------
 */
async function itemSummary(assetId) {
  const key = `item:${assetId}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < EMBED_TTL_MS) return hit.data;

  const [info, resale, thumbs] = await Promise.all([
    getJson(`/apisite/api/marketplace/productinfo?assetId=${assetId}`).catch(() => null),
    getJson(`/apisite/economy/v1/assets/${assetId}/resale-data`).catch(() => null),
    getJson(`/apisite/thumbnails/v1/assets?assetIds=${assetId}&size=420x420&format=Png`)
      .catch(() => null),
  ]);

  const name = String(info?.Name || '').trim();
  /* No name means the id is not a real item - better no preview than a card
   * that says "undefined". */
  if (!name) return null;

  /* Our own numbers. A store that will not load must not take the page down. */
  let value = 0;
  let demand = null;
  let trend = null;
  try {
    const data = await store.snapshot();
    const row = data?.values?.[String(assetId)];
    if (row) {
      value = Number(row.value) || 0;
      demand = row.demand || null;
      trend = row.trend || null;
    }
  } catch (_) { /* leave them unset */ }

  const image = (Array.isArray(thumbs?.data) && thumbs.data[0]?.imageUrl)
    || `${UPSTREAM}/Thumbs/Asset.ashx?width=420&height=420&assetId=${assetId}`;

  const data = {
    id: assetId,
    name,
    rap: Number(resale?.recentAveragePrice) || 0,
    value,
    demand,
    trend,
    image,
  };
  cache.set(key, { at: Date.now(), data });
  return data;
}

function buildItemTags(item, pageUrl) {
  /* Value first: it is the reason the site exists. Price is deliberately
   * never shown - see the note in values.js. */
  const parts = [
    `Value ${item.value ? formatNumber(item.value) : '-'}`,
    `RAP ${formatNumber(item.rap)}`,
  ];
  if (item.demand) parts.push(`Demand ${item.demand}`);
  if (item.trend) parts.push(`Trend ${item.trend}`);

  return {
    title: `${item.name} - Wolimons`,
    description: parts.join('  |  '),
    image: publicImage(item.image, new URL(pageUrl).origin),
    url: pageUrl,
  };
}

async function itemEmbed(html, url, userAgent) {
  try {
    if (!isCrawler(userAgent)) return null;

    const assetId = Number(url.searchParams.get('id') || url.searchParams.get('assetId'));
    if (!Number.isSafeInteger(assetId) || assetId <= 0) return null;

    const item = await itemSummary(assetId);
    if (!item) return null;

    return applyTags(html, buildItemTags(item, `${url.origin}/item/?id=${assetId}`));
  } catch (error) {
    console.error('[embed] item failed:', error.message);
    return null;
  }
}

/*
 * Returns rewritten HTML, or null to let the normal page be served.
 * Never throws: a preview is never worth failing a page load over.
 */
async function playerEmbed(html, url, userAgent) {
  try {
    if (!isCrawler(userAgent)) return null;

    const userId = Number(url.searchParams.get('id') || url.searchParams.get('userId'));
    if (!Number.isSafeInteger(userId) || userId <= 0) return null;

    refreshRosterInBackground();

    const player = await playerSummary(userId);
    if (!player) return null;

    return applyTags(html, buildTags(player, `${url.origin}/player/?id=${userId}`));
  } catch (error) {
    console.error('[embed] failed:', error.message);
    return null;
  }
}

module.exports = {
  playerEmbed, itemEmbed, isCrawler, playerSummary, itemSummary, formatNumber, escapeAttr,
};
