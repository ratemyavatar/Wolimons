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
const embed = require('./embed');

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

/*
 * Source guard.
 *
 * The repo files are written for people - every file is half comments - and
 * with SERVE_STATIC on, those same files used to be what a browser saw in
 * its Sources panel, one clean download per file. This strips the comments
 * and blank lines at serve time, so what lands in a visitor's devtools is
 * the bare code with none of the explanation. The files on disk are never
 * touched, and PROTECT_SOURCES=0 turns it back off for debugging.
 *
 * The strippers are conservative: only comments and empty lines go. A
 * browser needs the code itself to run the page - nothing served over HTTP
 * can hide that - but it no longer gets the annotated original.
 */
const PROTECT_SOURCES = !/^(0|false|no|off)$/i.test(String(process.env.PROTECT_SOURCES || '1'));

/* JavaScript: walk the text tracking strings so a // inside a quote is
 * never mistaken for a comment. Handles '...' "..." and `...` with
 * backslash escapes.
 *
 * Regex literals need care too - `/'/g` holds a quote that must not open a
 * string - so a `/` that follows a token where a regex is legal is scanned
 * as a pattern (with [...] classes) rather than as division. */
function stripJs(text) {
  let out = '';
  let i = 0;
  const n = text.length;
  let quote = '';
  let lastSig = '';

  const regexAllowed = () => {
    if (!lastSig) return true;
    if ('(,=:[!&|?{};+-*%<>~^'.includes(lastSig)) return true;
    return /(?:return|typeof|case|in|of|new|delete|void|throw|do|else|instanceof)\s*$/.test(out);
  };

  while (i < n) {
    const ch = text[i];
    const next = text[i + 1];

    if (quote) {
      out += ch;
      if (ch === '\\') {
        if (i + 1 < n) { out += text[i + 1]; i += 2; continue; }
        i += 1; continue;
      }
      if (ch === quote) {
        quote = '';
        lastSig = ch;
      }
      i += 1;
      continue;
    }

    if (ch === '\'' || ch === '"' || ch === '`') {
      quote = ch;
      out += ch;
      i += 1;
      continue;
    }

    if (ch === '/' && next === '/') {
      while (i < n && text[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < n && !(text[i] === '*' && text[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }

    if (ch === '/' && regexAllowed()) {
      /* Regex literal: copy the pattern, honouring escapes and [...]
       * classes, then the flags. A bare newline means it was division after
       * all - bail out and let the normal scan continue. */
      out += ch;
      i += 1;
      let inClass = false;
      let closed = false;
      while (i < n) {
        const c = text[i];
        if (c === '\\') {
          out += c;
          if (i + 1 < n) { out += text[i + 1]; i += 2; continue; }
          i += 1;
          continue;
        }
        if (c === '\n') { i += 1; break; }
        out += c;
        i += 1;
        if (c === '[') inClass = true;
        else if (c === ']') inClass = false;
        else if (c === '/' && !inClass) { closed = true; break; }
      }
      if (closed) {
        while (i < n && /[a-z]/i.test(text[i])) { out += text[i]; i += 1; }
        lastSig = '/';
      }
      continue;
    }

    out += ch;
    if (!/\s/.test(ch)) lastSig = ch;
    i += 1;
  }

  return out.split('\n').filter(line => line.trim() !== '').join('\n');
}

/* CSS has no strings that can hide a comment start, so the naive scan is
 * the right one. */
function stripCss(text) {
  let out = '';
  let i = 0;
  const n = text.length;
  while (i < n) {
    if (text[i] === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < n && !(text[i] === '*' && text[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    out += text[i];
    i += 1;
  }
  return out.split('\n').filter(line => line.trim() !== '').join('\n');
}

/* HTML: strip comments, but never inside a <script> or <style> block - the
 * text there belongs to the other two strippers' worlds, and a comment
 * marker inside a script string is not a comment. */
function stripHtml(text) {
  let out = '';
  let i = 0;
  const n = text.length;
  let rawRegion = '';

  while (i < n) {
    const ch = text[i];

    if (rawRegion) {
      const close = `</${rawRegion}`;
      if (ch === '<' && text.slice(i, i + close.length).toLowerCase() === close) {
        rawRegion = '';
      }
      out += ch;
      i += 1;
      continue;
    }

    if (ch === '<') {
      const open = text.slice(i, i + 8).toLowerCase();
      if (open.startsWith('<script') || open.startsWith('<style')) {
        rawRegion = open.startsWith('<script') ? 'script' : 'style';
      }
      if (text.slice(i, i + 4) === '<!--') {
        i += 4;
        while (i < n && text.slice(i, i + 3) !== '-->') i += 1;
        i += 3;
        continue;
      }
    }

    out += ch;
    i += 1;
  }

  return out.split('\n').filter(line => line.trim() !== '').join('\n');
}

/* Stripped bodies are remembered per file-and-mtime so a busy page is only
 * transformed once, not on every request. */
const strippedCache = new Map();

function stripped(kind, file, text, mtimeMs) {
  const key = `${kind}:${file}:${Number(mtimeMs).toString(36)}`;
  const hit = strippedCache.get(key);
  if (hit) return hit;
  const body = kind === 'js' ? stripJs(text) : kind === 'css' ? stripCss(text) : stripHtml(text);
  if (strippedCache.size > 200) strippedCache.clear();
  strippedCache.set(key, body);
  return body;
}

/*
 * How long to wait on Wanwood before giving up.
 *
 * Without this a request that Wanwood accepts but never answers is held open
 * forever, and every one of them keeps a socket and its buffers alive. Wanwood
 * is a hobby revival that goes down from time to time, so this is not a rare
 * case. Enough of them and the machine runs out of handles or memory and the
 * whole site stops answering - which looks like "cannot connect" in the
 * browser even though the VPS itself is perfectly fine.
 */
const UPSTREAM_TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS || 20_000);

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

/*
 * The origin the outside world used to reach this request - the Host header,
 * with the proto read from X-Forwarded-Proto when something proxies in front
 * (a Cloudflare tunnel, most usually). Needed wherever a URL has to make
 * sense to a stranger: the link-preview tags, for one.
 */
const TRUST_PROTO = /^(1|true|yes|on)$/i.test(String(process.env.TRUST_PROXY || ''));

function publicBase(req) {
  const host = String(req.headers.host || '').trim() || `localhost:${PORT}`;
  let proto = 'http';
  if (TRUST_PROTO) {
    const forwarded = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
    if (forwarded === 'https' || forwarded === 'http') proto = forwarded;
  }
  return `${proto}://${host}`;
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
      /* Room for an inventory share card JPEG; every other body is far
       * smaller than this. */
      if (size > 4_000_000) {
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
/*
 * Has this browser asked for the 2018 site?
 *
 * theme.js writes the cookie when the preference is set, so the server can
 * answer a plain page request with the 2018 page and the reader never sees a
 * redirect or a different address.
 */
function wants2018(req) {
  const cookie = String(req.headers.cookie || '');
  return /(?:^|;\s*)wolimons_theme=2018(?:;|$)/.test(cookie);
}

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
  let resolved = path.resolve(SITE_ROOT, `.${path.posix.normalize(pathname)}`);
  if (resolved !== SITE_ROOT && !resolved.startsWith(SITE_ROOT + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return true;
  }

  /*
   * Never hand out the git history, the secrets file, the design reference
   * copies - or the server's own directory.
   *
   * proxy/ holds the backend source, the live data file and the Wanwood
   * session cookie. None of it is a page, and the session in particular is
   * the keys to an account, so the whole folder is off limits rather than
   * blocklisting files inside it one at a time.
   */
  const DENIED = new Set(['.git', '.env', 'node_modules', 'snapshots', 'proxy', 'cards']);
  const relative = path.relative(SITE_ROOT, resolved).split(path.sep);
  if (relative.some(part => DENIED.has(part))) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return true;
  }

  /*
   * The 2018 site.
   *
   * Turning on the 2018 theme does not restyle these pages - it serves
   * different ones. They are the actual 2018 pages, rebuilt from snapshots
   * and wired to this API, and they live under /2018.
   *
   * The switch is a cookie rather than the URL, so a reader keeps the address
   * they are on, links they share work for everybody, and nothing has to be
   * duplicated into a second set of routes. A request that explicitly asks
   * for /2018/... still gets it, which is what makes the pages testable.
   */
  if (!path.relative(SITE_ROOT, resolved).startsWith('2018')) {
    const alternative = path.join(SITE_ROOT, '2018', path.relative(SITE_ROOT, resolved));
    const candidate = alternative.endsWith('.html')
      ? alternative
      : path.join(alternative, 'index.html');

    /* stat throws for "no such file", which is the normal answer for a page
     * 2018 never had - the admin panel, the trade board. Anything else would
     * be a real fault and is left to surface. */
    const has2018 = await fsp.stat(candidate).catch(() => null);

    if (has2018 && has2018.isFile()) {
      if (wants2018(req)) {
        resolved = candidate;
      } else {
        /*
         * The other direction: /itemtable only exists in 2018, so a reader on
         * the modern site following a shared link to it would otherwise fall
         * through to the upstream proxy and get somebody else's 404. A page
         * this site has is better than an error, whichever version asked.
         */
        const modern = await fsp.stat(resolved.endsWith('.html')
          ? resolved
          : path.join(resolved, 'index.html')).catch(() => null);
        if (!modern) resolved = candidate;
      }
    }
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
    /*
     * Link previews. Only for the profile page, and only for a crawler -
     * a real browser gets the page untouched and fills it in itself.
     * Returns null whenever it cannot help, so the page still loads.
     *
     * The URL handed over carries the origin the crawler actually asked for
     * (its Host header, and the forwarded proto behind Cloudflare) - not the
     * localhost origin this process sees itself as - so og:url and og:image
     * come out as links Discord can follow.
     */
    let embedded = false;
    const publicUrl = new URL(req.url, publicBase(req));
    if (url.pathname === '/player/' || url.pathname === '/player/index.html') {
      const rewritten = await embed.playerEmbed(html, publicUrl, req.headers['user-agent']);
      if (rewritten) {
        html = rewritten;
        embedded = true;
      }
    } else if (url.pathname === '/item/' || url.pathname === '/item/index.html') {
      const rewritten = await embed.itemEmbed(html, publicUrl, req.headers['user-agent']);
      if (rewritten) {
        html = rewritten;
        embedded = true;
      }
    }

    if (PROTECT_SOURCES) {
      /* The cache key carries the embedded flag: a crawler's rewritten copy
       * and a browser's plain copy are different bodies for the same file,
       * and they must never be served to each other. */
      html = stripped('html', file + (embedded ? ':embed' : ''), html, info.mtimeMs);
    }

    const body = Buffer.from(html, 'utf8');
    /* The '-e' keeps a crawler's copy from colliding with a browser's in any
     * cache between here and them - same file, deliberately different body. */
    const htmlTag = `W/"${body.length}-${Number(info.mtimeMs).toString(36)}-s${embedded ? 'e' : ''}"`;
    const htmlHeaders = {
      'Content-Type': type,
      'Content-Length': body.length,
      'Cache-Control': 'no-cache',
      ETag: htmlTag,
    };
    /* Same URL, different HTML depending on who asks. */
    if (embedded) htmlHeaders.Vary = 'User-Agent';
    if (req.headers['if-none-match'] === htmlTag) {
      res.writeHead(304, htmlHeaders);
      res.end();
      return true;
    }
    res.writeHead(200, htmlHeaders);
    res.end(req.method === 'HEAD' ? undefined : body);
    return true;
  }

  /* Scripts and stylesheets get the source guard: served without their
   * comments and blank lines, whatever the file on disk says. */
  const ext = path.extname(file).toLowerCase();
  if (PROTECT_SOURCES && (ext === '.js' || ext === '.mjs' || ext === '.css')) {
    const text = await fsp.readFile(file, 'utf8');
    const body = Buffer.from(stripped(ext === '.css' ? 'css' : 'js', file, text, info.mtimeMs), 'utf8');
    const guardTag = `W/"${body.length}-${Number(info.mtimeMs).toString(36)}-g"`;
    const guardHeaders = {
      'Content-Type': type,
      'Content-Length': body.length,
      'Cache-Control': 'no-cache',
      ETag: guardTag,
    };
    if (req.headers['if-none-match'] === guardTag) {
      res.writeHead(304, guardHeaders);
      res.end();
      return true;
    }
    res.writeHead(200, guardHeaders);
    if (req.method === 'HEAD') {
      res.end();
      return true;
    }
    res.end(body);
    return true;
  }

  /* Everything else is fingerprinted by the ?v= on the script tags, so it can
   * be cached briefly and streamed straight from disk. */
  const tag = `W/"${info.size}-${Number(info.mtimeMs).toString(36)}"`;
  const headers = {
    'Content-Type': type,
    'Content-Length': info.size,
    'Cache-Control': 'no-cache',
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

/*
 * fetch() with a deadline. AbortSignal.timeout would do, but building the
 * controller by hand keeps this working on the older Node 18 builds that are
 * still common on Windows, and lets the timer be cleared on the happy path so
 * a slow-but-fine response is not left holding a pending timer.
 */
async function fetchUpstream(target, init) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    return await fetch(target, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
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

    let upstreamResponse = await fetchUpstream(target, init);

    /* 403 => the token was missing or stale. Grab the new one and retry once. */
    if (req.method === 'POST' && upstreamResponse.status === 403) {
      rememberCsrf(upstreamResponse);
      if (csrfToken) {
        init.headers['x-csrf-token'] = csrfToken;
        if (csrfCookie) init.headers.Cookie = csrfCookie;
        upstreamResponse = await fetchUpstream(target, init);
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
    const timedOut = error.name === 'AbortError' || error.name === 'TimeoutError';
    console.error(`[proxy] ${req.method} ${target} failed:`,
      timedOut ? `no answer within ${UPSTREAM_TIMEOUT_MS}ms` : error.message);

    /*
     * The reply may already be on its way - the client can disconnect at any
     * point, and once anything has been written writeHead() throws. That throw
     * would land outside every try/catch and take the whole process down with
     * it, which is exactly the "site randomly stops answering" case.
     */
    if (res.headersSent) {
      res.end();
      return;
    }
    res.writeHead(timedOut ? 504 : 502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: timedOut ? 'Upstream timed out' : 'Upstream request failed',
      detail: timedOut ? `Wanwood did not answer within ${UPSTREAM_TIMEOUT_MS}ms.` : error.message,
    }));
  }
});

/*
 * A malformed request should cost one connection, not the server. Without
 * this, Node's default for a client error on a socket that is already broken
 * can surface as an unhandled 'error' event.
 */
server.on('clientError', (error, socket) => {
  if (!socket.writable || socket.destroyed) {
    socket.destroy();
    return;
  }
  socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
});

/*
 * Sockets that connect and then say nothing tie up a slot each. These caps let
 * the server let go of them instead of accumulating them until it stops
 * accepting new connections.
 */
server.headersTimeout = 30_000;
server.requestTimeout = 120_000;
server.keepAliveTimeout = 65_000;

server.on('error', error => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use - is Wolimons already running?`);
    process.exit(1);
  }
  console.error('[server] error:', error.message);
});

/*
 * The safety net.
 *
 * Everything above tries to handle its own failures, but anything missed used
 * to end the process, and a stopped process is a browser saying "cannot
 * connect" while the VPS itself looks perfectly healthy. Log it and keep
 * serving instead: a single broken request is not a reason to take the site
 * off the internet.
 */
process.on('uncaughtException', error => {
  console.error('[server] uncaught exception - still running:', error && error.stack || error);
});

process.on('unhandledRejection', reason => {
  console.error('[server] unhandled rejection - still running:',
    reason && reason.stack || reason);
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

  console.log('Admin writes are locked to the staff roster - no key. Public API index: /api');

  if (PROTECT_SOURCES) {
    console.log('Source guard on: served pages and scripts are stripped of comments.');
  }

  if (/^(1|true|yes|on)$/i.test(String(process.env.TRUST_PROXY || ''))) {
    console.log('Trusting CF-Connecting-IP / X-Forwarded-For (behind Cloudflare or a reverse proxy).');
  }

  const store = require('./store');
  if (store.config.storage === 'file') {
    console.log(`Saving values to ${store.config.file}`);
  } else if (store.config.canWrite) {
    console.log(`Saving values to GitHub (${store.config.location})`);
  } else {
    console.log('No GITHUB_TOKEN set - values can be read but not saved. '
      + 'Set STORAGE=file to save to disk instead.');
  }
});
