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
const store = require('./store');

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
function keyMatches(candidate) {
  if (!ADMIN_KEY) return false;
  const a = Buffer.from(String(candidate || ''));
  const b = Buffer.from(ADMIN_KEY);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
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
      if (!keyMatches(payload.key)) {
        send(res, 401, { ok: false, error: 'That admin key was not accepted.' });
        return true;
      }
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

    send(res, 404, { ok: false, error: `No such endpoint: ${route}` });
    return true;
  } catch (error) {
    send(res, 400, { ok: false, error: error.message });
    return true;
  }
}

module.exports = { handle };
