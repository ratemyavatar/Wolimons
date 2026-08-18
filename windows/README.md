# Windows setup script

`setup.bat` does everything in `HOSTING-WINDOWS.md` for you. It only stops to
ask about things that are actually yours to decide.

## Using it

1. Copy the site folder onto the VPS (e.g. `C:\Wolimons`).
2. Open the `windows` folder.
3. **Right-click `setup.bat` → Run as administrator.**

Then work down the menu:

| | Does |
|---|---|
| **1** | Checks Node, writes the settings, opens the firewall |
| **2** | Runs it in the window so you can see it work |
| **3** | Installs it as a service so it survives logging off and reboots |
| **4** | Puts it on your Cloudflare domain with real HTTPS |
| **5** | Tells you what is and isn't working |
| **6** | About the old admin password (it's retired — nothing to change) |
| **7** | Removes the services again |
| **8** | Updates to the latest version |

Do **1**, then **3**, then **4**. Option 2 is just for a quick look.

## Updating later

Three ways, all one double-click:

- **`git-pull.cmd`** — if the site folder is a git clone (e.g. you set it up
  with `git clone`). Pulls the newest code with git, fast-forward only, and
  never touches `proxy\.env` or `proxy\data\` (both are gitignored). Restart
  the service afterwards. If the folder isn't a clone it tells you the
  one-time `git clone` command to run.
- **`update.bat`** (or setup.bat option **8**) — the no-git way: downloads a
  fresh copy of the code and swaps it in, keeping your values.
- Either one takes about ten seconds.
It backs up your values first, then replaces only the code — `proxy\data\`
(your values, history and roles) and `proxy\.env` (your settings) are never
touched, because neither is in the download.

You do **not** have to run it as administrator. The only part that needs
administrator is stopping and starting the Wolimons service, so:

- **Running as administrator** — it does the whole thing, service restart
  included, and then checks the site answers on `/healthz`.
- **Not running as administrator** — it offers to reopen itself as
  administrator. Say no and it still updates every file; it just leaves the
  service alone and tells you to restart it yourself afterwards with
  `net stop Wolimons` then `net start Wolimons`.
- **No service installed at all** (you run the site with option 2, or by
  hand) — administrator is never needed and never asked about.

### If you don't have update.bat yet

You don't need the whole repo for it, just the one file, and there is a script
that fetches it for you: **`get-update.bat`**.

Put it in the `windows` folder (it is already there if you have the repo) and
**double-click it**. It downloads the newest `update.bat` into that same
folder, right next to itself — you never type a path. Administrator is not
needed.

It keeps your old `update.bat` as a `.bak` first, and it checks the download
afterwards, because this is the one thing that fails silently: raw GitHub
serves `.bat` files with Unix line endings and `cmd.exe` mis-parses those, so
the line endings are converted before it hits the disk. If the check fails it
puts your old copy back and says so. See `HOSTING-WINDOWS.md` §11.0.

If you want `setup.bat` refreshed too, run it from a prompt as
`get-update.bat all`.

From PowerShell instead, the same thing with a few more options:

```powershell
cd C:\Users\Administrator\Documents\wolimons\windows
powershell -ExecutionPolicy Bypass -File .\get-update.ps1
```

| Option | Does |
|---|---|
| `-All` | also refresh `setup.bat` |
| `-Branch <name>` | take it from a different branch |
| `-To <folder>` | put it somewhere else instead of next to the script |

**And if you don't have `get-update.bat` either** — one line in PowerShell,
run it from inside the `windows` folder:

```powershell
$u='https://raw.githubusercontent.com/ratemyavatar/Wolimons/arena/01a013ce-wolimons/windows/get-update.ps1'
[IO.File]::WriteAllText("$pwd\get-update.ps1",((iwr $u -UseBasicParsing).Content))
powershell -ExecutionPolicy Bypass -File .\get-update.ps1
```

## What it asks you

Only three things, and two have sensible defaults:

- **Port** — press Enter for 8080.
- **Your domain** — only in option 4, e.g. `wolimons.example.com`.
- **Cloudflare login** — option 4 opens a browser window. This replaces
  copying a very long token onto the VPS, which is miserable over a phone
  RDP client.

There is no admin password any more — the panel is open to whoever can reach
the server, and the key the old versions asked about is retired.

Everything else — downloading NSSM and cloudflared, the firewall rule, the
services, the tunnel config, `TRUST_PROXY`, `ALLOWED_ORIGINS` — is automatic.

## Notes

- `setup.bat` must be run as administrator. Services and firewall rules need
  it, and it says so rather than half-failing later. `update.bat` does not —
  see "Updating later" above.
- Re-running is safe. It replaces existing services rather than erroring, and
  asks before overwriting settings (keeping a `.env.old`).
- **Option 4 uses a Cloudflare Tunnel**, so no inbound port is needed at all.
  It offers to close the firewall hole afterwards. This sidesteps the trap in
  `HOSTING-WINDOWS.md` §10.1 — Cloudflare's proxy does not translate ports,
  so an orange-clouded DNS record alone would never reach port 8080.
- Logs go to `logs\wolimons.log`, capped at 10 MB with rotation.
- `nssm.exe` is downloaded into this folder on first use and is gitignored.

## If something breaks

Run option **5** first — it checks each piece in turn and prints the site's
own status. The full troubleshooting table is in `HOSTING-WINDOWS.md` §10.6.

The one thing worth knowing: `http://localhost:8080/` on the VPS itself
always bypasses Cloudflare. If that works and your domain doesn't, the
problem is the tunnel or DNS, not the site.
