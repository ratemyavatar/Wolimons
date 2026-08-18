# Wolimons API proxy

Wanwood blocks requests that don't look like they came from a real browser, and
it doesn't send CORS headers. That means the site's JavaScript can't call it
directly — the browser either gets blocked or refuses to read the response.

This is a tiny Node service that sits in the middle. It forwards every request
to `https://wanwoo.xyz` with browser-like headers, then adds the CORS headers
your browser needs to read the reply.

```
browser  ->  wolimons-proxy.onrender.com/apisite/...  ->  wanwoo.xyz/apisite/...
```

## Deploy on Render

1. Push this repo to GitHub (already done if you cloned it).
2. Go to <https://dashboard.render.com> → **New** → **Web Service**.
3. Connect the `Wolimons` repo.
4. Set:
   - **Root Directory**: `proxy`
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: Free
5. Create the service and wait for the first deploy.
6. Copy the URL Render gives you, e.g. `https://wolimons-proxy.onrender.com`.

Alternatively, Render can read `proxy/render.yaml` via **New → Blueprint**.

Check it's alive by visiting `<your-url>/healthz` — you should see:

```json
{"ok":true,"service":"wolimons-api-proxy","upstream":"https://wanwoo.xyz","cached":0}
```

## Point the site at it

The deployed instance is <https://wolimons.onrender.com> and is already
configured. To swap in a different one, edit `assets/js/config.js`:

```js
const DEFAULT_API_BASE = 'https://wolimons-proxy.onrender.com';
```

Commit and push. That's it — all pages read from this one place.

To test a proxy without editing files, run this in the browser console:

```js
localStorage.setItem('wolimons_api_base', 'https://your-proxy.onrender.com')
location.reload()
```

and to undo it: `localStorage.removeItem('wolimons_api_base')`.

## Using a friend's existing proxy

If someone already deployed one, you only need their URL — no need to deploy
this. Drop it into `config.js` as above. It has to forward the full path
through to Wanwood, so that

```
<their-proxy>/apisite/catalog/v1/search/items?...
```

reaches

```
https://wanwoo.xyz/apisite/catalog/v1/search/items?...
```

The site needs these endpoints to work:

| Method | Path | Used for |
| --- | --- | --- |
| GET | `/apisite/catalog/v1/search/items` | item listings and search |
| GET | `/apisite/api/marketplace/productinfo` | item name / type / price |
| GET | `/apisite/api/v1/items/restrictions` | Limited vs Limited-U ribbons |
| GET | `/apisite/economy/v1/assets/{id}/resale-data` | RAP |
| GET | `/apisite/economy/v1/assets/{id}/resellers` | lowest asking price |
| GET | `/apisite/thumbnails/v1/assets` | item images (returns URLs) |
| GET | `/images/thumbnails/*` | the images themselves (binary) |
| GET | `/apisite/api/users/get-by-username` | username to user id |
| GET | `/apisite/inventory/v1/users/{id}/assets/collectibles` | a player's inventory |
| POST | `/apisite/catalog/v1/catalog/items/details` | optional fast path (see below) |

**Every required endpoint is a `GET`.** A friend's proxy that only forwards
`GET` will work fine.

### Why the POST endpoint is optional

Wanwood runs the [BubbaBlox v2](https://github.com/harryzawg/bubbablox-v2)
backend. Its `CsrfMiddleware` rejects any non-`GET` request that doesn't carry
a matching `rbxcsrf4` cookie *and* `x-csrf-token` header, replying `403
{"errors":[{"message":"Token Validation Failed"}]}`.

That makes `POST /apisite/catalog/v1/catalog/items/details` — the one call that
returns every item's details at once — unusable from a plain browser fetch.
So the site doesn't rely on it: it falls back to per-item `GET`s that need no
token. The batch call is still tried first because it's a single round trip
instead of ~30.

`server.js` in this folder does the handshake for you: on a `403` it reads the
token from the response header and the cookie from `Set-Cookie`, replays the
request, and caches the pair for reuse.

### A gotcha worth knowing

Unknown paths on this backend return the SPA HTML shell
(`<!doctype html><html>...`) with status **200**, not a 404. A wrong path
therefore shows up as a JSON parse error rather than an HTTP error. These two
paths look plausible but do **not** exist:

- `GET /apisite/catalog/v1/items/details`
- `GET /apisite/catalog/v1/search/items/details`

The site now detects an HTML body and treats it as a failed endpoint.

## The site's own endpoints

Everything under `/api/` is answered by this service instead of being forwarded
to Wanwood. It's where the values, the staff list, the badges and the trade
ads live — things Wanwood has no idea about, because we made them up.

| Method | Path | Who | Does |
| --- | --- | --- | --- |
| GET | `/api` | anyone | machine-readable index of the whole API |
| GET | `/api/values` | anyone | every item's value, demand, trend and categories |
| GET | `/api/changes` | anyone | the value change log |
| GET | `/api/roles` | anyone | the staff list |
| GET | `/api/badges` | anyone | badges handed out by the site |
| GET | `/api/me?name=X` | anyone | what rank that person holds |
| GET | `/api/status` | anyone | server health, for the admin panel |
| POST | `/api/roles/set` | open | rank someone, or remove their rank |
| POST | `/api/badges/set` | open | give a badge, or take it back |
| POST | `/api/values/set` | open | set a value, demand, trend, method, note or categories |
| GET | `/api/ads` | anyone | the trade ad board |
| POST | `/api/identity` | anyone | trade a verify phrase for an identity token |
| POST | `/api/ads/post` | identity token | post a trade ad |
| POST | `/api/ads/delete` | identity token | delete your own ad |
| POST | `/api/ads/moderate` | open | take any ad down, from the admin panel |

There is no admin key. The panel is an open room: whoever can reach `/admin`
can read and change everything in it — the door is the server itself, not a
password inside it. Writes still carry a `name` field, but it is attribution
(what lands in the change log and the "set by" columns), not a check. Trade
ads keep their own proof: posting and deleting your own ad still requires an
identity token from `/verify`, because the board is public.

## The public API

The same backend also answers a keyless, documented JSON API for bots and
tools — the Rolimons-style one. It is listed at `GET /api` and lives under
`/api/v1`:

| Path | Does |
| --- | --- |
| `/api/v1/itemdetails` | every tracked item: name, value, demand, trend, method, categories, RAP, lowest ask |
| `/api/v1/values` | the raw value table |
| `/api/v1/valuechanges` | the value change log (`?limit=&since=`) |
| `/api/v1/playerinfo/<userId>` | one player: name, role, badges |
| `/api/v1/getrecentads` | the trade ad board (`?limit=`) |
| `/api/v1/roles` | the staff roster |
| `/api/v1/badges` | granted badges (`?name=` for one player) |

Item names, RAP and lowest prices are fetched from Wanwood server-side and
cached (`ITEM_DETAILS_TTL_MS`, ten minutes by default), so hammering the API
does not hammer the upstream.

### Where the data lives

There's no database. `data/wolimons-data.json` in this repo *is* the database:
the server reads it at boot, keeps it in memory, and commits it back through
the GitHub API whenever something changes. Every change is therefore a commit,
with a message saying who did what — the edit history comes free.

This suits the shape of the problem. Values change a few times a day at most,
by a handful of trusted people, and the file is a few kilobytes. Paying for a
database to hold that would be silly.

Two things follow from it, both deliberate:

- **No token, no saving.** The panel still shows everything, it just won't let
  you change it. That's the local-development default.
- **If GitHub can't be read at boot, saving is refused** until it can be. The
  server falls back to the copy checked into the repo so the site still works,
  but it won't commit on top of a file it never actually read — that would
  quietly wipe every value.

Writes are queued one at a time, and if GitHub says the file moved underneath
us the server re-reads it and retries once. Two people valuing items at the
same moment won't clobber each other.

## Configuration

| Env var | Default | Meaning |
| --- | --- | --- |
| `UPSTREAM_ORIGIN` | `https://wanwoo.xyz` | where to forward requests |
| `PORT` | `3000` | set automatically by Render |
| `CACHE_TTL_MS` | `60000` | how long to cache successful GETs |
| `ALLOWED_ORIGINS` | *(unset = allow all)* | comma-separated list of sites allowed to call the proxy |
| `ADMIN_KEY` | *(unused)* | legacy: only seeds identity-token signing so old sessions survive restarts. Unlocks nothing |
| `ITEM_DETAILS_TTL_MS` | `600000` | how long `/api/v1/itemdetails` caches the enriched catalog |
| `SERVE_STATIC` | *(off)* | `1` also serves the site's pages, so one port does everything |
| `SITE_ROOT` | the repo root | where those pages are |
| `STORAGE` | `auto` | `file` (save to disk) or `github` (commit). Auto = github if a token is set |
| `DATA_FILE` | `proxy/data/wolimons-data.json` | where the file backend saves |
| `GITHUB_TOKEN` | *(unset = read-only)* | repo-write token, so changes can be saved |
| `GITHUB_REPO` | `ratemyavatar/Wolimons` | which repo holds the data file |
| `GITHUB_BRANCH` | `main` | which branch to commit to |
| `DATA_PATH` | `data/wolimons-data.json` | the data file itself |
| `TRUST_PROXY` | *(off)* | `1` reads the client IP from `CF-Connecting-IP` / `X-Forwarded-For`. Only behind Cloudflare or a reverse proxy |
| `PROTECT_SOURCES` | `1` | strip comments and blank lines from served pages, scripts and stylesheets so devtools shows the bare code. `0` serves the originals |

Settings can go in a `.env` file next to `server.js` instead of the
environment — copy `.env.example` to `.env`. It is gitignored. A real
environment variable always wins over the file, so Render's dashboard stays
authoritative there.

### Which storage backend?

**`file`** — a JSON file on the server's disk. Correct for a VPS, a home
server or a phone: no token, no network, instant saves, and the data stays on
your machine. Saves are atomic and keep a `.bak` of the previous contents.

**`github`** — commits the data back to the repo. Only worth it where the disk
does not survive a restart. Render's free tier wipes the container on every
restart and deploy, so a file there would lose every value ever set; a commit
survives and is versioned.

Set `GITHUB_TOKEN` in the Render dashboard under **Environment**.
Never commit it — anything in `render.yaml` is public.

The token needs **Contents: read and write** on this one repo. A fine-grained
personal access token scoped to just `Wolimons` is the right choice; a classic
`repo`-scoped token also works but hands out far more access than is needed.

Locking down `ALLOWED_ORIGINS` is worth doing once you know your site's URL, so
other people can't use your free Render instance as their own proxy.

### Behind Cloudflare or another reverse proxy

Set `TRUST_PROXY=1`. Every request then arrives from the proxy's address, so
without it the sign-in rate limiter treats the whole internet as a single
visitor and one bot can lock out the real admin. With it, the real client is
read from `CF-Connecting-IP` (or the left-most `X-Forwarded-For` entry).

Leave it off when the server is directly reachable: those headers are just
headers, and anyone can send a fresh one on each request to get unlimited
password guesses.

See `HOSTING-WINDOWS.md` section 10 for the full walkthrough, including the
fact that Cloudflare's proxy does **not** translate ports — `https://` reaches
your origin on 443, never on 8080.

## Running it locally

```bash
cd proxy
npm start
```

Then set the site to `http://localhost:3000` via the `localStorage` trick above.

## Notes on the free tier

Render's free instances sleep after ~15 minutes of inactivity, so the first
request after a break can take 30–60 seconds. After that it's fast. The
built-in 60-second cache means repeated page loads mostly avoid hitting Wanwood
at all.

If Wanwood starts blocking Render's IPs too, the next step is running the proxy
somewhere else (Cloudflare Workers, Fly.io, or a small VPS) — the code is
portable, only the deploy steps change.
