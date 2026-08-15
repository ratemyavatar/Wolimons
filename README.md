# Wolimons

A Wanwood trading site — item catalog, trade calculator, badges and leaderboards.

Static HTML/CSS/JS. There's no build step and no framework.

## Running locally

The pages use root-absolute paths (`/css/…`, `/assets/…`), so opening
`index.html` from the file manager will look unstyled. It has to be served over
HTTP from the repo root:

```bash
git clone -b arena/019fff2c-wolimons https://github.com/ratemyavatar/Wolimons.git
cd Wolimons
./serve.sh
```

Then open <http://localhost:8080/>. Pass a port to use a different one:
`./serve.sh 3000`.

In Termux, install the deps first with `pkg install -y git python`.

`serve.sh` serves the pages only, and is a shell script, so it needs a
Unix-like shell. To run the pages **and** the API from one process — which is
what you want on a server, and works on Windows as-is:

```bash
cd proxy
cp .env.example .env      # then set SERVE_STATIC=1 and your ADMIN_KEY
node server.js
```

That needs Node 18+ and installs nothing. For a Windows VPS, and for opening
the site on your phone at the server's IP, see
[HOSTING-WINDOWS.md](HOSTING-WINDOWS.md).

### Opening it on other devices

`serve.sh` listens on every network interface, so anything on the same Wi-Fi
can reach it. On startup it prints the address to use:

```
  On this device:   http://localhost:8080/
  On the network:   http://192.168.1.42:8080/
```

Type that second address into the other device's browser. Some notes:

- Both devices have to be on the **same Wi-Fi network**. A phone on mobile
  data won't reach it, and many public/guest networks block devices from
  talking to each other.
- The address is the *host's* IP, and it usually changes when it reconnects
  to the network. Re-run `serve.sh` to see the current one.
- Keep the terminal open — closing it, or letting the phone sleep hard
  enough to suspend Termux, stops the server. `termux-wake-lock` helps.
- It's plain HTTP on your LAN, with no authentication. Fine for family on
  your home Wi-Fi; don't port-forward it to the open internet.

Item and player data still comes from Wanwood over the internet (see below),
so the other devices need a working connection for pages to populate.

Pages:

- `/` — homepage
- `/catalog/` — item catalog
- `/item/?id=<assetId>` — item page (works for any item, not just Dominus)
- `/leaderboard/` — richest players
- `/players/` — player search
- `/player/?id=<userId>` — player profile
- `/valuechanges/` — recent value changes
- `/projecteds/` — items flagged as projected
- `/luckycat/` — the daily Lucky Cat draw
- `/trades/` — trade ads
- `/tradead/?id=<adId>` — a single trade ad
- `/playertrades/?id=<userId>` — one player's trade ads
- `/tradecalculator/` — trade calculator
- `/badges/` — badges
- `/verify/` — account verification
- `/preferences/` — site preferences
- `/admin/` — value/role administration (needs the admin key)

## Item data / the API proxy

Item and player data comes from Wanwood. Wanwood blocks direct requests from
browsers (no CORS headers, plus bot filtering), so requests go through a small
proxy.

The live proxy is <https://wolimons.onrender.com>, already set in
[`assets/js/config.js`](assets/js/config.js). To use a different one, change:

```js
const DEFAULT_API_BASE = 'https://your-proxy.onrender.com';
```

A ready-to-deploy proxy is in [`proxy/`](proxy/) with
[setup instructions for Render](proxy/README.md). If a friend already runs one,
just paste their URL into `config.js`. Every endpoint the site needs is a
plain `GET`, so a simple forwarding proxy is enough — see
[the endpoint list](proxy/README.md#using-a-friends-existing-proxy).

To try a proxy without editing files, run in the browser console:

```js
localStorage.setItem('wolimons_api_base', 'https://your-proxy.onrender.com')
location.reload()
```

## Values, demand and trend

Wanwood reports prices and RAP, but it has no concept of an item's *value*, its
*demand* or its *trend* — those are community judgements, the same way
Rolimon's does it. They're set by hand in
[`assets/js/values.js`](assets/js/values.js) and nowhere else; nothing is
guessed from a price field.

Every item starts unset: value `0`, demand and trend blank. To set one, add a
row keyed by the Wanwood asset id (the number in a catalog URL —
`wanwoo.xyz/catalog/1581/Cthulhu` → `1581`):

```js
const ITEMS = {
  1581: 4500,                    // just a value
  4031: {
    value: 12000,
    demand: 'High',              // High | Decent | Low | Terrible
    trend: 'Raising',            // Raising | Stable | Lowering | Unstable | Fluctuating
    categories: ['rare'],        // rare | projected | tablet | unobtainable | hoarded
  },
};
```

Save and reload — there's no build step. The catalog's **Demand**, **Trend**
and **Categories** filters read straight from this table, and anything left out
is filtered as "Unassigned". `valued` isn't written by hand: an item counts as
valued once its value is above 0.

## Layout

```
serve.sh              local + LAN dev server
index.html            homepage
admin/                value/role administration
badges/               badges
catalog/              item catalog
item/                 item page (any item, by ?id=)
leaderboard/          richest players
luckycat/             daily Lucky Cat draw
player/               player profile
players/              player search
playertrades/         one player's trade ads
preferences/          site preferences
projecteds/           projected items
tradead/              a single trade ad
tradecalculator/      trade calculator
trades/               trade ads
valuechanges/         recent value changes
verify/               account verification
assets/js/config.js   API base URL (points at the Render proxy)
assets/js/            page scripts
assets/vendor/        Highcharts Stock 10.3.3 (the item/player history graph)
css/                  stylesheets
data/                 committed value/role data read by the proxy
img/                  images
proxy/                deployable CORS/anti-bot proxy + values API
tools/                maintenance scripts (badge art/consistency)
```

Wolimons is not affiliated with Roblox Corporation or Rolimon's.
