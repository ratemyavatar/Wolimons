'use strict';

/*
 * Wolimons API proxy.
 *
 * Wanwood blocks requests that don't look like they came from a browser, and
 * it doesn't send CORS headers, so the site can't call it directly from the
 * client. This proxy sits in the middle: it forwards every request to
 * https://wanwoo.xyz with browser-like headers, then adds the CORS headers the
 * browser needs.
 *
 * Deploy on Render as a Web Service:
 *   Root directory : proxy
 *   Build command  : npm install
 *   Start command  : npm start
 *
 * Requires Node 18+ (for the built-in fetch).
 */

const http = require('http');
const api = require('./api');

const UPSTREAM = process.env.UPSTREAM_ORIGIN || 'https://wanwoo.xyz';
const PORT = Number(process.env.PORT) || 3000;

/*
 * Which sites may use this proxy. Set ALLOWED_ORIGINS on Render to a
 * comma-separated list to lock it down, e.g.
 *   https://yourname.github.io,http://localhost:8080
 * Leave it unset to allow any origin.
 */
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean);

/* Cache successful GETs briefly - keeps load off the upstream and makes the
 * site feel much faster on Render's free tier. */
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS || 60_000);
const CACHE_MAX_ENTRIES = 500;
const cache = new Map();

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
    'Chrome/125.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': `${UPSTREAM}/`,
  'Origin': UPSTREAM,
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
};

function corsOrigin(requestOrigin) {
  if (!ALLOWED_ORIGINS.length) return '*';
  if (requestOrigin && ALLOWED_ORIGINS.includes(requestOrigin)) return requestOrigin;
  return ALLOWED_ORIGINS[0];
}

function applyCors(res, requestOrigin) {
  res.setHeader('Access-Control-Allow-Origin', corsOrigin(requestOrigin));
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('Vary', 'Origin');
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > 1_000_000) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/*
 * CSRF handshake.
 *
 * Wanwood runs the BubbaBlox v2 backend, whose CsrfMiddleware rejects any
 * non-GET request that doesn't carry a matching `rbxcsrf4` cookie plus an
 * `x-csrf-token` header. On failure it replies 403 with the freshly minted
 * token in the `x-csrf-token` response header and the cookie in Set-Cookie.
 *
 * So: send the POST, and if it comes back 403, capture that pair and replay
 * the request once. Tokens live ~4 minutes, so the last good pair is reused.
 */
let csrfToken = null;
let csrfCookie = null;

function rememberCsrf(response) {
  const token = response.headers.get('x-csrf-token');
  if (token) csrfToken = token;

  const setCookie = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);

  for (const entry of setCookie) {
    const match = /(^|[;,\s])(rbxcsrf4=[^;]+)/.exec(entry);
    if (match) csrfCookie = match[2];
  }
}

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expires) {
    cache.delete(key);
    return null;
  }
  return hit;
}

function cacheSet(key, value) {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { ...value, expires: Date.now() + CACHE_TTL_MS });
}

const server = http.createServer(async (req, res) => {
  const requestOrigin = req.headers.origin;
  applyCors(res, requestOrigin);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  /* Health check - Render pings this, and it's handy for debugging. */
  if (url.pathname === '/' || url.pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      service: 'wolimons-api-proxy',
      upstream: UPSTREAM,
      cached: cache.size,
    }));
    return;
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  /* Wolimons' own endpoints. These are ours, not Wanwood's, so they are
   * answered here and never forwarded - and never cached, because a value
   * that was just saved has to read back immediately. */
  if (await api.handle(req, res, url, readBody)) return;

  const target = `${UPSTREAM}${url.pathname}${url.search}`;
  const cacheKey = `${req.method} ${target}`;

  if (req.method === 'GET') {
    const hit = cacheGet(cacheKey);
    if (hit) {
      res.writeHead(hit.status, {
        'Content-Type': hit.contentType,
        'X-Proxy-Cache': 'HIT',
      });
      res.end(hit.body);
      return;
    }
  }

  try {
    const init = {
      method: req.method,
      headers: { ...BROWSER_HEADERS },
      redirect: 'follow',
    };

    if (req.method === 'POST') {
      const body = await readBody(req);
      init.body = body;
      init.headers['Content-Type'] = req.headers['content-type'] || 'application/json';
    }

    /* Images want an image Accept header, not JSON. */
    if (/\.(png|jpe?g|gif|webp|svg)$/i.test(url.pathname) || url.pathname.includes('thumbnail')) {
      init.headers.Accept = 'image/avif,image/webp,image/png,image/*,*/*;q=0.8';
      init.headers['Sec-Fetch-Dest'] = 'image';
      init.headers['Sec-Fetch-Mode'] = 'no-cors';
    }

    /* Attach the CSRF pair we already hold, if any. */
    if (req.method === 'POST' && csrfToken && csrfCookie) {
      init.headers['x-csrf-token'] = csrfToken;
      init.headers.Cookie = csrfCookie;
    }

    let upstreamResponse = await fetch(target, init);

    /* 403 => the token was missing or stale. Grab the new one and retry once. */
    if (req.method === 'POST' && upstreamResponse.status === 403) {
      rememberCsrf(upstreamResponse);
      if (csrfToken) {
        init.headers['x-csrf-token'] = csrfToken;
        if (csrfCookie) init.headers.Cookie = csrfCookie;
        upstreamResponse = await fetch(target, init);
      }
    }
    rememberCsrf(upstreamResponse);

    const buffer = Buffer.from(await upstreamResponse.arrayBuffer());
    const contentType = upstreamResponse.headers.get('content-type') || 'application/octet-stream';

    if (req.method === 'GET' && upstreamResponse.ok) {
      cacheSet(cacheKey, { status: upstreamResponse.status, contentType, body: buffer });
    }

    res.writeHead(upstreamResponse.status, {
      'Content-Type': contentType,
      'X-Proxy-Cache': 'MISS',
      'Cache-Control': upstreamResponse.ok ? 'public, max-age=60' : 'no-store',
    });
    res.end(buffer);
  } catch (error) {
    console.error(`[proxy] ${req.method} ${target} failed:`, error.message);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Upstream request failed', detail: error.message }));
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Wolimons API proxy listening on :${PORT} -> ${UPSTREAM}`);
});
