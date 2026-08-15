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
| **1** | Checks Node, makes your password, writes the settings, opens the firewall |
| **2** | Runs it in the window so you can see it work |
| **3** | Installs it as a service so it survives logging off and reboots |
| **4** | Puts it on your Cloudflare domain with real HTTPS |
| **5** | Tells you what is and isn't working |
| **6** | Changes the admin password |
| **7** | Removes the services again |
| **8** | Updates to the latest version |

Do **1**, then **3**, then **4**. Option 2 is just for a quick look.

## Updating later

Option **8**, or right-click `update.bat` → *Run as administrator*. One step,
about ten seconds. It backs up your values first, then replaces only the code —
`proxy\data\` (your values, history and roles) and `proxy\.env` (your password)
are never touched, because neither is in the download.

## What it asks you

Only four things, and three have sensible defaults:

- **Admin password** — press Enter and it generates a strong one. Write it
  down when it is shown; it is not shown again.
- **Port** — press Enter for 8080.
- **Your domain** — only in option 4, e.g. `wolimons.example.com`.
- **Cloudflare login** — option 4 opens a browser window. This replaces
  copying a very long token onto the VPS, which is miserable over a phone
  RDP client.

Everything else — downloading NSSM and cloudflared, the firewall rule, the
services, the tunnel config, `TRUST_PROXY`, `ALLOWED_ORIGINS` — is automatic.

## Notes

- It must be run as administrator. Services and firewall rules need it, and
  it says so rather than half-failing later.
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
