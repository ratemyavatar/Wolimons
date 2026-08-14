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

Edit `assets/js/config.js` and set your URL:

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
| POST | `/apisite/catalog/v1/catalog/items/details` | names, values, restrictions |
| GET | `/apisite/economy/v1/assets/{id}/resale-data` | RAP |
| POST | `/apisite/users/v1/usernames/users` | username → user id |
| GET | `/apisite/inventory/v1/users/{id}/assets/collectibles` | a player's inventory |
| GET | `/asset-thumbnail/image` | item images (binary) |

If their proxy only handles `GET`, the trade calculator's item details and the
player-inventory scan won't work — those two are `POST`.

## Configuration

| Env var | Default | Meaning |
| --- | --- | --- |
| `UPSTREAM_ORIGIN` | `https://wanwoo.xyz` | where to forward requests |
| `PORT` | `3000` | set automatically by Render |
| `CACHE_TTL_MS` | `60000` | how long to cache successful GETs |
| `ALLOWED_ORIGINS` | *(unset = allow all)* | comma-separated list of sites allowed to call the proxy |

Locking down `ALLOWED_ORIGINS` is worth doing once you know your site's URL, so
other people can't use your free Render instance as their own proxy.

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
