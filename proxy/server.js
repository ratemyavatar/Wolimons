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
 * Or run it yourself (Windows VPS, Linux box, anywhere):
 *   node server.js
 * with settings in proxy/.env - see proxy/.env.example.
 *
 * SERVE_STATIC=1 also serves the site's own files from the repo root, so one
 * process answers both the pages and the API on a single port. That is what
 * makes a phone able to reach the whole site at http://<server-ip>:8080/.
 *
 * Requires Node 18+ (for the built-in fetch).
 */

const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

/* Must come before ./api and ./store, which read process.env as they load. */
const loadedFromFile = require('./env').load();

const api = require('./api');

const UPSTREAM = process.env.UPSTREAM_ORIGIN || 'https://wanwoo.xyz';
const PORT = Number(process.env.PORT) || 3000;

/*
 * Serve the site itself as well as the API.
 *
 * On Render the pages are hosted elsewhere and this is only an API, so it
 * stays off by default. Self-hosting on your own server, it is far simpler to
 * have one process on one port answer everything: no CORS to configure, no
 * second server to keep running, and one address to type into a phone.
 */
const SERVE_STATIC = /^(1|true|yes|on)$/i.test(String(process.env.SERVE_STATIC || ''));
const SITE_ROOT = path.resolve(process.env.SITE_ROOT || path.join(__dirname, '..'));

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
};

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
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS');
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

/*
 * Serve one file from the repo root.
 *
 * Returns true when it answered. `/catalog/` maps to `catalog/index.html`, the
 * way the pages' root-absolute links expect.
 */
async function serveStatic(req, res, url) {
  if (!SERVE_STATIC) return false;
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;

  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch (error) {
    return false;                       /* malformed %-escape - not ours */
  }

  /*
   * Resolve inside the site root and check we are still inside it. This is
   * what stops /../../etc/passwd and its many encodings: it is checked after
   * decoding and normalising, not before.
   */
  const resolved = path.resolve(SITE_ROOT, `.${path.posix.normalize(pathname)}`);
  if (resolved !== SITE_ROOT && !resolved.startsWith(SITE_ROOT + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return true;
  }

  /* Never hand out the git history or the secrets file. */
  const relative = path.relative(SITE_ROOT, resolved).split(path.sep);
  if (relative.some(part => part === '.git' || part === '.env' || part === 'node_modules')) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return true;
  }

  let file = resolved;
  let info = null;
  try {
    info = await fsp.stat(file);
    if (info.isDirectory()) {
      file = path.join(file, 'index.html');
      info = await fsp.stat(file);
    }
  } catch (error) {
    return false;                       /* fall through to the 404 below */
  }
  if (!info.isFile()) return false;

  const type = CONTENT_TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const isHtml = type.startsWith('text/html');

  /*
   * Pages served by this process get one extra line of script.
   *
   * When the proxy serves the site, the API is on the same origin as the page,
   * whatever address the visitor typed - localhost, a LAN IP, the VPS's public
   * IP. Nothing can be hardcoded for that, so the page is told at serve time
   * and config.js picks it up. Without this the page would keep calling the
   * Render URL, which is a different machine with a different database.
   */
  if (isHtml) {
    let html = await fsp.readFile(file, 'utf8');
    const marker = '<script>window.WOLIMONS_API_BASE = window.location.origin;</script>';
    if (!html.includes('WOLIMONS_API_BASE')) {
      html = html.includes('<head>')
        ? html.replace('<head>', `<head>\n  ${marker}`)
        : `${marker}\n${html}`;
    }
    const body = Buffer.from(html, 'utf8');
    const htmlTag = `W/"${body.length}-${Number(info.mtimeMs).toString(36)}-s"`;
    const htmlHeaders = {
      'Content-Type': type,
      'Content-Length': body.length,
      'Cache-Control': 'no-cache',
      ETag: htmlTag,
    };
    if (req.headers['if-none-match'] === htmlTag) {
      res.writeHead(304, htmlHeaders);
      res.end();
      return true;
    }
    res.writeHead(200, htmlHeaders);
    res.end(req.method === 'HEAD' ? undefined : body);
    return true;
  }

  /* Everything else is fingerprinted by the ?v= on the script tags, so it can
   * be cached briefly and streamed straight from disk. */
  const tag = `W/"${info.size}-${Number(info.mtimeMs).toString(36)}"`;
  const headers = {
    'Content-Type': type,
    'Content-Length': info.size,
    'Cache-Control': 'public, max-age=300',
    ETag: tag,
  };

  if (req.headers['if-none-match'] === tag) {
    res.writeHead(304, headers);
    res.end();
    return true;
  }

  res.writeHead(200, headers);
  if (req.method === 'HEAD') {
    res.end();
    return true;
  }

  await new Promise(resolve => {
    const stream = fs.createReadStream(file);
    stream.on('error', () => {
      res.end();
      resolve();
    });
    stream.on('end', resolve);
    stream.pipe(res);
  });
  return true;
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

  /*
   * Health check - Render pings this, and it's handy for debugging.
   *
   * `/` is only the health check when we are not serving the site; otherwise
   * `/` is the homepage and would be shadowed by this. `/healthz` always
   * works, which is the one Render is pointed at.
   */
  if (url.pathname === '/healthz' || (url.pathname === '/' && !SERVE_STATIC)) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      service: 'wolimons-api-proxy',
      upstream: UPSTREAM,
      cached: cache.size,
      servingSite: SERVE_STATIC,
    }));
    return;
  }

  if (req.method !== 'GET' && req.method !== 'POST' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  /* Wolimons' own endpoints. These are ours, not Wanwood's, so they are
   * answered here and never forwarded - and never cached, because a value
   * that was just saved has to read back immediately. */
  if (await api.handle(req, res, url, readBody)) return;

  /*
   * The site's own files, when self-hosting. Checked before the upstream
   * forward so /catalog/ is this repo's page rather than a request sent off
   * to Wanwood, and after /api/ so the backend always wins.
   */
  if (await serveStatic(req, res, url)) return;

  /*
   * A page that does not exist should say so, not be forwarded to Wanwood.
   *
   * Only navigations are stopped here - a browser asking for a page. Requests
   * for images and data still fall through, because thumbnails are served by
   * rewriting Wanwood's own URLs onto this origin (see proxied() in
   * wanwood-api.js), and those paths are not ours but must still work.
   */
  if (SERVE_STATIC
      && !url.pathname.startsWith('/apisite/')
      && String(req.headers.accept || '').includes('text/html')) {
    const notFound = path.join(SITE_ROOT, '404.html');
    const body = await fsp.readFile(notFound, 'utf8').catch(() => null);
    res.writeHead(404, {
      'Content-Type': body ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8',
    });
    res.end(body || 'Not found');
    return;
  }

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

/*
 * Bound to 0.0.0.0 on purpose: on a VPS or a phone, "localhost" would only be
 * reachable from the machine itself, and the whole point is to open it from
 * another device.
 */
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Wolimons listening on port ${PORT} -> upstream ${UPSTREAM}`);

  if (loadedFromFile.length) {
    /* Names only - never the values, so a pasted log can't leak the key. */
    console.log(`Loaded from .env: ${loadedFromFile.join(', ')}`);
  }

  if (SERVE_STATIC) {
    console.log(`Serving the site from ${SITE_ROOT}`);
    console.log(`Open http://localhost:${PORT}/ here, or http://<this-machine's-IP>:${PORT}/ from another device.`);
  } else {
    console.log('API only (set SERVE_STATIC=1 to also serve the site).');
  }

  if (!process.env.ADMIN_KEY) {
    console.log('No ADMIN_KEY set - the admin panel cannot be signed into.');
  }
  if (!process.env.GITHUB_TOKEN) {
    console.log('No GITHUB_TOKEN set - values can be read but not saved.');
  }
});
