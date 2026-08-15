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
| **4** | Puts it on your Cloudflare domain with real HTTPS (browser sign-in *or* pasted tunnel token) |
| **5** | Tells you what is and isn't working |
| **6** | Changes the admin password |
| **7** | Removes the services again |

Do **1**, then **3**, then **4**. Option 2 is just for a quick look.

## What it asks you

Only four things, and three have sensible defaults:

- **Admin password** — press Enter and it generates a strong one. Write it
  down when it is shown; it is not shown again.
- **Port** — press Enter for 8080.
- **Your domain** — only in option 4, e.g. `wolimons.example.com`.
- **Cloudflare login** — option 4 asks how you want to connect:
  - **1** opens a browser window on the VPS and creates the tunnel and DNS
    record for you. Best when the machine has a screen.
  - **2** takes a tunnel **token** you copied from the Cloudflare app on your
    phone. Use this when there is no browser on the VPS (e.g. you manage
    Cloudflare from your phone). You then add the public hostname — which
    creates the DNS record — in the app yourself.

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
- **Option 4 choice 2 (token)** installs a *remotely-managed* tunnel. The
  tunnel and its DNS record are created in the Cloudflare app, not by the
  script: after it finishes, add a **Public Hostname** on the tunnel pointing
  at `http://localhost:<port>` — saving it creates the proxied DNS record.
- Logs go to `logs\wolimons.log`, capped at 10 MB with rotation.
- `nssm.exe` is downloaded into this folder on first use and is gitignored.

## If something breaks

Run option **5** first — it checks each piece in turn and prints the site's
own status. The full troubleshooting table is in `HOSTING-WINDOWS.md` §10.6.

The one thing worth knowing: `http://localhost:8080/` on the VPS itself
always bypasses Cloudflare. If that works and your domain doesn't, the
problem is the tunnel or DNS, not the site.
