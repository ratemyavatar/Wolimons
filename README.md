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
python3 -m http.server 8080
```

Then open <http://localhost:8080/>.

In Termux, install the deps first with `pkg install -y git python`, and use
`python` instead of `python3`.

Pages:

- `/` — homepage
- `/catalog/` — item catalog
- `/tradecalculator/` — trade calculator
- `/badges/` — badges

## Item data / the API proxy

Item and player data comes from Wanwood. Wanwood blocks direct requests from
browsers (no CORS headers, plus bot filtering), so requests go through a small
proxy.

Set your proxy URL in [`assets/js/config.js`](assets/js/config.js):

```js
const DEFAULT_API_BASE = 'https://your-proxy.onrender.com';
```

A ready-to-deploy proxy is in [`proxy/`](proxy/) with
[setup instructions for Render](proxy/README.md). If a friend already runs one,
just paste their URL into `config.js` — check
[the endpoint list](proxy/README.md#using-a-friends-existing-proxy) to make sure
theirs forwards `POST` as well as `GET`.

To try a proxy without editing files, run in the browser console:

```js
localStorage.setItem('wolimons_api_base', 'https://your-proxy.onrender.com')
location.reload()
```

## Layout

```
index.html            homepage
catalog/              item catalog
tradecalculator/      trade calculator
badges/               badges
assets/js/config.js   API base URL - edit this to point at your proxy
assets/js/            page scripts
css/                  stylesheets
img/                  images
proxy/                deployable CORS/anti-bot proxy
```

Wolimons is not affiliated with Roblox Corporation or Rolimon's.
