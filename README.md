# Wolimons

My Wanwood trading site. Item catalog, values, trade ads, leaderboards,
badges, trade calculator.

It's plain HTML, CSS and JavaScript. No build step, no npm install, nothing
to compile. The only thing you need on the server is Node.

---

## Download it (read this bit)

**The site is on the `arena/01a013ce-wolimons` branch, not `main`.**

`main` is old and doesn't have any of this. If you download the wrong one
you'll get a nearly empty folder and nothing will work. So:

1. Go to the repo on GitHub.
2. Click the **branch dropdown** at the top left (it says `main`).
3. Pick **`arena/01a013ce-wolimons`**.
4. Now click the green **Code** button → **Download ZIP**.

Check you got the right one before going further. The ZIP is about **36 MB**
and is called:

```
Wolimons-arena-01a013ce-wolimons.zip
```

If your file is tiny, you downloaded `main`. Go back and pick the branch
again.

### Unzip it on the VPS

Right-click the ZIP → **Extract All**.

Watch out for this: extracting gives you a folder called
`Wolimons-arena-01a013ce-wolimons`, and Windows likes to put it *inside*
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

### If it's already on there and I just want the newest version

Don't download anything. Right-click `C:\Wolimons\windows\update.bat` →
**Run as administrator** (or `setup.bat` → option **8**). It does the
download, the copying and the restart itself, in about ten seconds.

Your values are safe. They live in `proxy\data\`, which isn't in the download,
so there is nothing for an update to overwrite. It copies them to
`C:\WolimonsBackups\<date>` before it starts anyway.

Only do the long way below if you're moving the site to a different folder or
a different VPS.

<details>
<summary>Setting it up somewhere new / moving folders</summary>

Don't just paste new files over the old folder by hand — old files that aren't
in the new download stay behind, and the service carries on pointing at
whatever it was set up with, so the site keeps showing the old pages.

1. Run the **old** folder's `setup.bat` as administrator and pick **7** to
   uninstall the services.
2. Copy `C:\Wolimons\proxy\data\wolimons-data.json` and
   `C:\Wolimons\proxy\.env` somewhere safe. **These are your values and your
   settings, and they are the only things you can't download again.**
3. Rename the old folder to `C:\Wolimons-old` so nothing is guessing which
   one is which.
4. Put the fresh download at `C:\Wolimons`.
5. Copy those two files back into `C:\Wolimons\proxy\` (the data one goes in
   `C:\Wolimons\proxy\data\`).
6. Run the **new** `C:\Wolimons\windows\setup.bat` and do **1**, then **3**,
   then **4**.
7. Check with **option 5** — it prints which folder it's serving. It should
   say `C:\Wolimons\proxy`.

Once the site looks right and your values are still there, delete
`C:\Wolimons-old`.

</details>

Also: only ever download from the `arena/01a013ce-wolimons` branch. The
other branches are old and still have the old pages in them, so mixing files
from two different downloads is what causes this in the first place.

---

## Set it up

Open `C:\Wolimons\windows`, then **right-click `setup.bat` → Run as
administrator**.

It has to be "Run as administrator" or it can't create the service or open
the firewall. It'll tell you off if you forget.

Then just work down the menu:

| Option | What it does |
|---|---|
| **1** | Sets everything up. Writes the settings, opens the firewall. |
| **2** | Runs it in the window so you can check it works. |
| **3** | Installs it as a service so it stays running after you log off. |
| **4** | Puts it on my Cloudflare domain with proper HTTPS. |
| **5** | Checks everything and tells you what's broken. |
| **6** | About the old admin password (it's retired — nothing to change). |
| **7** | Uninstalls the services. |

**Do 1, then 3, then 4.** Option 2 is only for having a quick look.

There is no admin password any more — the panel is open to whoever can reach
the server. It only asks me three things:

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
| Updated the files but the site still shows the old pages | The service is still pointed at the old folder. Run option 5 — it tells you which folder it's actually serving. Fix it with option 7, then 1, then 3, from the new folder. |
| Want the newest version | Option **8**, or `windows\update.bat` as administrator. Keeps your values. |
| Values disappeared after updating | You replaced the whole folder instead of using option 8. Put the backup from `C:\WolimonsBackups\` back at `C:\Wolimons\proxy\data\wolimons-data.json` and restart. |
| Error 521 from Cloudflare | Cloudflare doesn't forward ports. See HOSTING-WINDOWS.md §10.1. |

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
admin\                admin panel - no password; writes locked to the staff roster
apidocs\              the public API documentation page

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

Everything starts at value 0 until I set it. Open `/admin/` — there is no
sign-in any more, the panel is open.

Saved values go to `proxy\data\wolimons-data.json` on the server. **That file
is the one thing that can't be re-downloaded** — back it up. There's a
`.bak` next to it from the previous save, and HOSTING-WINDOWS.md §9 has a
scheduled backup script.

---

## Notes

- Item and player data comes from Wanwood (`wanwoo.xyz`). The proxy handles
  it because Wanwood blocks browsers from calling it directly. The server
  needs internet access for pages to fill in.
- `proxy\.env` holds my settings and is deliberately not in the ZIP or
  on GitHub. setup.bat creates it.
- Re-running setup.bat is safe. It replaces the services instead of erroring,
  and keeps a `.env.old` if it overwrites settings.

Not affiliated with Roblox or Rolimon's.
