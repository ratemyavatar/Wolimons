# Wolimons

My Wanwood trading site. Item catalog, values, trade ads, leaderboards,
badges, trade calculator.

It's plain HTML, CSS and JavaScript. No build step, no npm install, nothing
to compile. The only thing you need on the server is Node.

---

## Download it (read this bit)

**The site is on the `arena/019fff2c-wolimons` branch, not `main`.**

`main` is old and doesn't have any of this. If you download the wrong one
you'll get a nearly empty folder and nothing will work. So:

1. Go to the repo on GitHub.
2. Click the **branch dropdown** at the top left (it says `main`).
3. Pick **`arena/019fff2c-wolimons`**.
4. Now click the green **Code** button → **Download ZIP**.

Check you got the right one before going further. The ZIP is about **36 MB**
and is called:

```
Wolimons-arena-019fff2c-wolimons.zip
```

If your file is tiny, you downloaded `main`. Go back and pick the branch
again.

### Unzip it on the VPS

Right-click the ZIP → **Extract All**.

Watch out for this: extracting gives you a folder called
`Wolimons-arena-019fff2c-wolimons`, and Windows likes to put it *inside*
another folder with the same name. You want the one that has `index.html`
and the `windows` folder directly inside it.

Rename it to `C:\Wolimons` to keep things simple. Everything below assumes
that path.

You should end up with:

```
C:\Wolimons\
    index.html
    windows\setup.bat
    proxy\
    assets\
    ...
```

If `C:\Wolimons\index.html` doesn't exist, you've got the folder nesting
wrong. Go up or down a level until it does.

---

## Set it up

Open `C:\Wolimons\windows`, then **right-click `setup.bat` → Run as
administrator**.

It has to be "Run as administrator" or it can't create the service or open
the firewall. It'll tell you off if you forget.

Then just work down the menu:

| Option | What it does |
|---|---|
| **1** | Sets everything up. Makes your admin password, writes the settings, opens the firewall. |
| **2** | Runs it in the window so you can check it works. |
| **3** | Installs it as a service so it stays running after you log off. |
| **4** | Puts it on my Cloudflare domain with proper HTTPS. |
| **5** | Checks everything and tells you what's broken. |
| **6** | Changes the admin password. |
| **7** | Uninstalls the services. |

**Do 1, then 3, then 4.** Option 2 is only for having a quick look.

It only asks me four things:

- **Admin password** — press Enter and it makes a strong one for me.
  **Write it down when it shows it.** It doesn't show it again.
- **Port** — press Enter for 8080.
- **My domain** — only in option 4, like `wolimons.example.com`.
- **Cloudflare login** — option 4 opens a browser to sign in.

Everything else it does on its own: downloads NSSM and cloudflared, the
firewall rule, both services, the tunnel, and the settings that go with it.

### Node has to be installed first

If setup.bat says Node is missing, get the **LTS** installer from
<https://nodejs.org/>, run it with all the defaults, then **close the window
and open setup.bat again**. The PATH only updates in new windows, so it
won't see Node until you reopen it.

Node 18 or newer. The script checks.

---

## Getting to it

- **On the VPS itself:** <http://localhost:8080/>
- **From my phone, before Cloudflare:** `http://<vps-ip>:8080/` —
  type `http://` not `https://`, and don't forget the `:8080`.
- **After option 4:** `https://mydomain.com/`

`http://localhost:8080/` on the VPS always works regardless of Cloudflare.
If that loads and my domain doesn't, the problem is the tunnel or DNS, not
the site.

---

## If something breaks

Run **option 5** first. It checks each part and prints the site's own status.

Full troubleshooting is in [HOSTING-WINDOWS.md](HOSTING-WINDOWS.md), but the
usual ones:

| What's happening | Why |
|---|---|
| Downloaded folder is nearly empty | Got `main` instead of the branch. |
| Pages look unstyled | Opened `index.html` by double-clicking. It has to be served — use setup.bat. |
| "Not recognised as a command" | Node isn't installed, or the window was open before installing it. |
| Site works on VPS, not on phone | Firewall. Option 1 opens it, but the VPS host's own control panel has a separate firewall. |
| Changed `.env`, nothing happened | Needs a restart. Option 3 reinstalls, or `nssm restart Wolimons`. |
| Error 521 from Cloudflare | Cloudflare doesn't forward ports. See HOSTING-WINDOWS.md §10.1. |
| Locked out of admin, says 429 | Too many wrong passwords. Wait 15 min or restart the service. |

Logs are in `C:\Wolimons\logs\wolimons.log`.

---

## Where things are

```
windows\setup.bat     the installer - start here
HOSTING-WINDOWS.md    the long version, and troubleshooting

index.html            homepage
catalog\              item catalog
item\                 item page, /item/?id=<assetId>
leaderboard\          richest players
players\              player search
player\               player profile, /player/?id=<userId>
valuechanges\         recent value changes
projecteds\           projected items
luckycat\             daily Lucky Cat
trades\               trade ads
tradead\              one trade ad
playertrades\         one player's trade ads
tradecalculator\      trade calculator
badges\               badges
verify\               account verification
preferences\          site preferences
admin\                admin panel - needs the password

proxy\                the server. Serves the pages AND the API.
proxy\.env            my settings. Made by setup.bat. Never goes on GitHub.
proxy\data\           my saved values live here once I start setting them.
data\                 the starting copy of values/roles
assets\               images, scripts, the chart library
css\                  stylesheets
snapshots\            the old saved pages I rebuilt this from. Reference
                      only, nothing loads them. Safe to delete.
serve.sh              Linux/Termux only, pages without the API
tools\                maintenance scripts
```

Most of the 36 MB is `snapshots\`. The site itself is small.

---

## Setting values

Values, demand and trend aren't from Wanwood — Wanwood only has prices and
RAP. Value is a judgement call, so I set it myself in the admin panel.

Everything starts at value 0 until I set it. Sign in at `/admin/` with the
password setup.bat gave me.

Saved values go to `proxy\data\wolimons-data.json` on the server. **That file
is the one thing that can't be re-downloaded** — back it up. There's a
`.bak` next to it from the previous save, and HOSTING-WINDOWS.md §9 has a
scheduled backup script.

---

## Notes

- Item and player data comes from Wanwood (`wanwoo.xyz`). The proxy handles
  it because Wanwood blocks browsers from calling it directly. The server
  needs internet access for pages to fill in.
- `proxy\.env` holds my admin password and is deliberately not in the ZIP or
  on GitHub. setup.bat creates it.
- Re-running setup.bat is safe. It replaces the services instead of erroring,
  and keeps a `.env.old` if it overwrites settings.

Not affiliated with Roblox or Rolimon's.
