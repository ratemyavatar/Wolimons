'use strict';

/*
 * Wolimons API - the site's own backend.
 *
 * Everything under /api/ is answered here rather than forwarded to Wanwood.
 * Wanwood serves items and players; this serves the two things that are ours:
 * item values and staff roles.
 *
 *   GET  /api/values                    the whole value table, for values.js
 *   GET  /api/changes?limit=&since=     the value change log, for /valuechanges
 *   GET  /api/roles                     the roster, so the site can show ranks
 *   GET  /api/me?name=<username>        what one account is allowed to do
 *   POST /api/login       { key }                    -> owner session token
 *   POST /api/roles/set   { name, role }             owner only
 *   POST /api/values/set  { id, value, ... }         value manager / staff
 *   GET  /api/ads?creatorId=            the trade ad board, newest first
 *   GET  /api/ad?id=<adId>              one ad
 *   POST /api/identity    { userId, phrase }         -> player identity token
 *   POST /api/ads/post    { creatorName, offer, request }   identity token
 *   POST /api/ads/delete  { id }                     identity token, author only
 *
 * ---------------------------------------------------------------------------
 * HOW ACCESS IS DECIDED
 * ---------------------------------------------------------------------------
 * One shared admin key, kept in the ADMIN_KEY environment variable and never
 * in the repo. POST /api/login trades the key for a token; the token goes in
 * an Authorization header on every write.
 *
 * A token proves "this is an owner". Owners may do anything, including handing
 * out roles. A value manager or staff member acts under the owner's key too -
 * they authenticate with the same key and identify themselves by username, and
 * the roster decides whether that username may write values. This is honest
 * about what it is: a shared-secret gate for a small trusted staff, not
 * per-user authentication. Anyone holding the key can act as anyone, so the
 * key belongs only with people already trusted with the site.
 */

const crypto = require('crypto');
const path = require('path');
const store = require('./store');

/*
 * Which folder the pages are being served out of. Worked out the same way
 * server.js does it, so /api/status can report it.
 *
 * This is here to answer one specific question: "I updated the files but the
 * site still shows the old pages." Nearly always that means the service is
 * still pointed at the previous copy of the site, and this tells you which
 * folder it is actually reading instead of leaving you to guess.
 */
const SITE_ROOT = path.resolve(process.env.SITE_ROOT || path.join(__dirname, '..'));

const ADMIN_KEY = process.env.ADMIN_KEY || '';
const TOKEN_TTL_MS = Number(process.env.TOKEN_TTL_MS || 12 * 60 * 60 * 1000);

/* Tokens live in memory: a restart signs everyone out, which is fine and is
 * the safer default for a shared key. */
const tokens = new Map();

function issueToken() {
  const token = crypto.randomBytes(24).toString('hex');
  tokens.set(token, Date.now() + TOKEN_TTL_MS);
  return token;
}

function validToken(token) {
  if (!token) return false;
  const expires = tokens.get(token);
  if (!expires) return false;
  if (Date.now() > expires) {
    tokens.delete(token);
    return false;
  }
  return true;
}

/* Constant-time compare so the key cannot be guessed a character at a time. */
/*
 * Who is asking, for rate limiting.
 *
 * Behind Cloudflare (or any reverse proxy) every connection arrives from the
 * proxy, so req.socket gives one address for the entire internet - rate
 * limiting on that would lock out everybody at once. CF-Connecting-IP is the
 * real client, and Cloudflare always sets it and always overwrites whatever
 * the client sent.
 *
 * This is only trusted when TRUST_PROXY is on, because a header is otherwise
 * trivially forged: an attacker sending a different one each time would get
 * unlimited attempts. Direct exposure keeps the socket address, which cannot
 * be faked.
 */
const TRUST_PROXY = /^(1|true|yes|on)$/i.test(String(process.env.TRUST_PROXY || ''));

function clientIp(req) {
  if (TRUST_PROXY) {
    const cf = req.headers['cf-connecting-ip'];
    if (cf) return String(cf).trim();
    const forwarded = req.headers['x-forwarded-for'];
    /* Left-most entry is the original client. */
    if (forwarded) return String(forwarded).split(',')[0].trim();
  }
  return req.socket?.remoteAddress || 'unknown';
}

/*
 * Login rate limiting.
 *
 * The admin key is one shared secret with no lockout, so on a public domain
 * it is worth slowing guessing down to the point where it is useless. Ten
 * tries per fifteen minutes per IP is generous for a human who has forgotten
 * their password and hopeless for a bot.
 *
 * Only failures count, so getting it right never costs you an attempt.
 */
const LOGIN_MAX_ATTEMPTS = Number(process.env.LOGIN_MAX_ATTEMPTS || 10);
const LOGIN_WINDOW_MS = Number(process.env.LOGIN_WINDOW_MS || 15 * 60 * 1000);
const loginAttempts = new Map();

function loginBlocked(ip) {
  const entry = loginAttempts.get(ip);
  if (!entry) return 0;
  if (Date.now() > entry.until) {
    loginAttempts.delete(ip);
    return 0;
  }
  if (entry.count < LOGIN_MAX_ATTEMPTS) return 0;
  return Math.ceil((entry.until - Date.now()) / 1000);
}

function noteFailedLogin(ip) {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || now > entry.until) {
    loginAttempts.set(ip, { count: 1, until: now + LOGIN_WINDOW_MS });
    return;
  }
  entry.count += 1;
}

/* Drop expired entries occasionally so a long run of attempts from many
 * addresses cannot grow the map without bound. */
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of loginAttempts) {
    if (now > entry.until) loginAttempts.delete(ip);
  }
}, 10 * 60 * 1000).unref();

function keyMatches(candidate) {
  if (!ADMIN_KEY) return false;
  const a = Buffer.from(String(candidate || ''));
  const b = Buffer.from(ADMIN_KEY);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/* ---------------------------------------------------------------------- */
/* Player identity, for trade ads                                          */
/* ---------------------------------------------------------------------- */

/*
 * Posting an ad is not a staff action - any player may do it - so the admin
 * key is the wrong gate entirely. What has to be proven is narrower: that
 * whoever is posting really is the Wanwood account the ad will be signed
 * with. Otherwise anyone could post ads as anyone.
 *
 * The proof is the one /verify already uses: a one-time phrase written into
 * the player's Wanwood profile description, which only that player can edit.
 * POST /api/identity re-reads the description here on the server, and if the
 * phrase is there, hands back a token that says "this browser is user N".
 *
 * The token is signed rather than remembered. A stored table would be emptied
 * by every restart, and /verify tells players to take the phrase back out of
 * their description once they are done - so they would have no way to get a
 * new token without going through the whole dance again. Signing means the
 * server can check a token it has never seen before, and nothing about a
 * player has to be kept on disk.
 */
const IDENTITY_TTL_MS = Number(process.env.IDENTITY_TTL_MS || 30 * 24 * 60 * 60 * 1000);

/*
 * The signing secret. ADMIN_KEY is reused when it is set so tokens survive a
 * restart; the derivation means the key itself is never recoverable from a
 * token. With no key set we fall back to a random secret, which works but
 * signs everyone out on restart - noted in /api/status.
 */
const IDENTITY_SECRET = ADMIN_KEY
  ? crypto.createHash('sha256').update(`wolimons-identity:${ADMIN_KEY}`).digest()
  : crypto.randomBytes(32);

const UPSTREAM = (process.env.UPSTREAM_ORIGIN || 'https://wanwoo.xyz').replace(/\/+$/, '');
const IDENTITY_TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS || 20000);

function signIdentity(userId, expiresAt) {
  const body = `${userId}.${expiresAt}`;
  const mac = crypto.createHmac('sha256', IDENTITY_SECRET).update(body).digest('base64url');
  return `${body}.${mac}`;
}

/*
 * Returns the user id a token vouches for, or 0. Never throws on a malformed
 * token - a bad token is simply not a token.
 */
function readIdentity(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return 0;

  const [rawId, rawExpiry, mac] = parts;
  const expected = crypto
    .createHmac('sha256', IDENTITY_SECRET)
    .update(`${rawId}.${rawExpiry}`)
    .digest('base64url');

  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return 0;
  if (!crypto.timingSafeEqual(a, b)) return 0;

  const expiresAt = Number(rawExpiry);
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return 0;

  const userId = Number(rawId);
  return Number.isSafeInteger(userId) && userId > 0 ? userId : 0;
}

/*
 * The player's Wanwood profile, read here rather than taken from the client.
 * users/v1/users/{id} is the only endpoint carrying the description.
 */
async function fetchProfile(userId) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IDENTITY_TIMEOUT_MS);
  try {
    const response = await fetch(`${UPSTREAM}/apisite/users/v1/users/${userId}`, {
      headers: { Accept: 'application/json' },
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

function bearer(req) {
  const header = req.headers.authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1] : '';
}

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readJson(body) {
  if (!body || !body.length) return {};
  try {
    const parsed = JSON.parse(body.toString('utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    throw new Error('The request body was not valid JSON.');
  }
}

/* Who is asking, and may they write? */
async function authorize(req, payload, { need }) {
  if (!ADMIN_KEY) {
    return { ok: false, status: 503, error: 'The server has no admin key configured.' };
  }
  if (!validToken(bearer(req)) && !keyMatches(payload.key)) {
    return { ok: false, status: 401, error: 'Sign in with the admin key first.' };
  }

  const name = String(payload.name || '').trim();
  if (!name) return { ok: false, status: 400, error: 'Which account is making this change?' };

  const role = await store.roleOf(name);
  if (need === 'owner' && role !== 'owner') {
    return { ok: false, status: 403, error: `${name} is not an owner.` };
  }
  if (need === 'valuer' && !['owner', 'value_manager', 'staff'].includes(role)) {
    return { ok: false, status: 403, error: `${name} cannot set item values.` };
  }
  return { ok: true, name, role };
}

/*
 * Returns true when it handled the request. server.js calls this before it
 * forwards anything upstream.
 */
async function handle(req, res, url, readBody) {
  if (!url.pathname.startsWith('/api/')) return false;

  const route = url.pathname.replace(/\/+$/, '');

  try {
    /* ---------------------------------------------------------------- reads */

    if (req.method === 'GET' && route === '/api/values') {
      const snapshot = await store.snapshot();
      send(res, 200, {
        ok: true,
        updatedAt: snapshot.updatedAt,
        values: snapshot.values,
      });
      return true;
    }

    if (req.method === 'GET' && route === '/api/changes') {
      /*
       * The value change log, newest first. This is the whole of
       * /valuechanges: the site records every edit made through the admin
       * panel, so the feed is a real history rather than a guess at one.
       */
      const rows = await store.changes({
        limit: url.searchParams.get('limit') || 200,
        since: url.searchParams.get('since') || 0,
      });
      send(res, 200, { ok: true, changes: rows });
      return true;
    }

    if (req.method === 'GET' && route === '/api/roles') {
      const snapshot = await store.snapshot();
      send(res, 200, {
        ok: true,
        roles: Object.values(snapshot.roles).sort((a, b) => a.name.localeCompare(b.name)),
      });
      return true;
    }

    if (req.method === 'GET' && route === '/api/me') {
      const name = String(url.searchParams.get('name') || '').trim();
      const role = name ? await store.roleOf(name) : null;
      send(res, 200, {
        ok: true,
        name,
        role,
        canGrantRoles: role === 'owner',
        canSetValues: ['owner', 'value_manager', 'staff'].includes(role),
      });
      return true;
    }

    if (req.method === 'GET' && route === '/api/status') {
      const snapshot = await store.snapshot();
      send(res, 200, {
        ok: true,
        hasAdminKey: Boolean(ADMIN_KEY),
        siteRoot: SITE_ROOT,
        canWrite: store.config.canWrite,
        storage: store.config.storage,
        location: store.config.location,
        repo: store.config.repo,
        branch: store.config.branch,
        items: Object.keys(snapshot.values).length,
        staff: Object.keys(snapshot.roles).length,
        changes: (snapshot.changes || []).length,
      });
      return true;
    }

    /* --------------------------------------------------------------- writes */

    if (req.method === 'POST' && route === '/api/login') {
      const payload = readJson(await readBody(req));
      if (!ADMIN_KEY) {
        send(res, 503, { ok: false, error: 'The server has no admin key configured.' });
        return true;
      }
      const ip = clientIp(req);
      const wait = loginBlocked(ip);
      if (wait) {
        const minutes = Math.ceil(wait / 60);
        res.setHeader('Retry-After', String(wait));
        send(res, 429, {
          ok: false,
          error: `Too many sign-in attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
        });
        return true;
      }
      if (!keyMatches(payload.key)) {
        noteFailedLogin(ip);
        send(res, 401, { ok: false, error: 'That admin key was not accepted.' });
        return true;
      }
      /* A correct key clears the record, so one typo does not count against
       * you for the next quarter of an hour. */
      loginAttempts.delete(ip);
      const name = String(payload.name || '').trim();
      const role = name ? await store.roleOf(name) : null;
      send(res, 200, { ok: true, token: issueToken(), expiresIn: TOKEN_TTL_MS, name, role });
      return true;
    }

    if (req.method === 'POST' && route === '/api/roles/set') {
      const payload = readJson(await readBody(req));
      const auth = await authorize(req, payload, { need: 'owner' });
      if (!auth.ok) {
        send(res, auth.status, { ok: false, error: auth.error });
        return true;
      }

      const target = String(payload.target || '').trim();
      if (!target) {
        send(res, 400, { ok: false, error: 'Name the account you are ranking.' });
        return true;
      }
      /* An owner may not demote themselves out of the panel by accident. */
      if (target.toLowerCase() === auth.name.toLowerCase() && payload.role !== 'owner') {
        send(res, 400, { ok: false, error: 'You cannot change your own owner rank.' });
        return true;
      }

      const updated = await store.setRole({
        name: target,
        role: String(payload.role || ''),
        grantedBy: auth.name,
      });
      send(res, 200, {
        ok: true,
        roles: Object.values(updated.roles).sort((a, b) => a.name.localeCompare(b.name)),
      });
      return true;
    }

    if (req.method === 'POST' && route === '/api/values/set') {
      const payload = readJson(await readBody(req));
      const auth = await authorize(req, payload, { need: 'valuer' });
      if (!auth.ok) {
        send(res, auth.status, { ok: false, error: auth.error });
        return true;
      }

      const updated = await store.setValue({
        id: payload.id,
        value: payload.value,
        demand: payload.demand,
        trend: payload.trend,
        categories: payload.categories,
        rare: payload.rare,
        /* The Valuation tab's two extra fields. Both are optional, so an
         * older client that never sends them leaves them untouched. */
        method: payload.method,
        note: payload.note,
        updatedBy: auth.name,
      });
      send(res, 200, {
        ok: true,
        id: Number(payload.id),
        item: updated.values[String(Number(payload.id))],
        updatedAt: updated.updatedAt,
      });
      return true;
    }

    /* ------------------------------------------------------- trade ads */

    if (req.method === 'GET' && route === '/api/ads') {
      /* The whole board, or one player's ads with ?creatorId=. Public: the
       * point of the board is that everybody sees the same one. */
      const rows = await store.ads({ creatorId: url.searchParams.get('creatorId') || 0 });
      send(res, 200, { ok: true, ads: rows, limit: store.ADS_PER_USER });
      return true;
    }

    if (req.method === 'GET' && route === '/api/ad') {
      const ad = await store.adById(url.searchParams.get('id') || '');
      if (!ad) {
        send(res, 404, { ok: false, error: 'That ad no longer exists.' });
        return true;
      }
      send(res, 200, { ok: true, ad });
      return true;
    }

    /*
     * Prove control of a Wanwood account and get an identity token back.
     * The phrase has to be in the profile description at the moment this is
     * called - the server reads it from Wanwood itself and does not take the
     * client's word for any of it.
     */
    if (req.method === 'POST' && route === '/api/identity') {
      const payload = readJson(await readBody(req));
      const userId = Number(payload.userId);
      const phrase = String(payload.phrase || '').trim();

      if (!Number.isSafeInteger(userId) || userId <= 0) {
        send(res, 400, { ok: false, error: 'A user id is required.' });
        return true;
      }
      /* Short phrases are not proof of anything - a two-character string
       * could be in a description by accident. */
      if (phrase.length < 8) {
        send(res, 400, { ok: false, error: 'A verification phrase is required.' });
        return true;
      }

      const profile = await fetchProfile(userId);
      if (!profile) {
        send(res, 502, { ok: false, error: 'Wanwood could not be reached. Try again.' });
        return true;
      }

      const description = String(profile.description || '');
      if (!description.toLowerCase().includes(phrase.toLowerCase())) {
        send(res, 403, {
          ok: false,
          error: 'That phrase is not in the profile description.',
        });
        return true;
      }

      const expiresAt = Date.now() + IDENTITY_TTL_MS;
      send(res, 200, {
        ok: true,
        userId,
        name: String(profile.name || '').trim(),
        token: signIdentity(userId, expiresAt),
        expiresAt,
      });
      return true;
    }

    if (req.method === 'POST' && route === '/api/ads/post') {
      const payload = readJson(await readBody(req));
      /* The creator is whoever the token says, never whoever the body says. */
      const creatorId = readIdentity(bearer(req));
      if (!creatorId) {
        send(res, 401, {
          ok: false,
          error: 'Verify your Wanwood account again before posting.',
        });
        return true;
      }

      const ad = await store.addAd({
        id: `${creatorId}-${Date.now()}`,
        creatorId,
        creatorName: payload.creatorName,
        offer: payload.offer,
        request: payload.request,
      });
      send(res, 200, { ok: true, ad });
      return true;
    }

    if (req.method === 'POST' && route === '/api/ads/delete') {
      const payload = readJson(await readBody(req));
      const creatorId = readIdentity(bearer(req));
      if (!creatorId) {
        send(res, 401, {
          ok: false,
          error: 'Verify your Wanwood account again before deleting.',
        });
        return true;
      }

      await store.removeAd({ id: payload.id, creatorId });
      send(res, 200, { ok: true, id: String(payload.id) });
      return true;
    }

    send(res, 404, { ok: false, error: `No such endpoint: ${route}` });
    return true;
  } catch (error) {
    send(res, 400, { ok: false, error: error.message });
    return true;
  }
}

module.exports = { handle };
