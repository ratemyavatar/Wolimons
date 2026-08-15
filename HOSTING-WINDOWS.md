# Hosting Wolimons on a Windows VPS

How to run the whole site — pages *and* API — from one Node process on a
Windows server, and open it on your phone by typing the VPS's IP address.

Everything below assumes you are logged into the VPS over Remote Desktop.

---

## 1. Install Node.js

Download the **LTS** Windows Installer (.msi) from <https://nodejs.org/> and
run it with the default options. Node 18 or newer is required.

Open **Command Prompt** and check it worked:

```bat
node -v
```

You should see something like `v22.11.0`. If you get *'node' is not
recognised*, close the Command Prompt window and open a new one — the
installer only updates the PATH for new windows.

## 2. Get the site onto the VPS

With Git for Windows (<https://git-scm.com/download/win>):

```bat
cd C:\
git clone -b arena/019fff2c-wolimons https://github.com/ratemyavatar/Wolimons.git
cd Wolimons
```

No Git? Download the ZIP from the repo's green **Code** button, extract it to
`C:\Wolimons`, and carry on.

There is nothing to build and nothing to `npm install` — the server uses only
what ships with Node.

## 3. Set your password

Copy the example settings file and open it:

```bat
cd C:\Wolimons\proxy
copy .env.example .env
notepad .env
```

Set these four lines:

```
ADMIN_KEY=your-password-here
SERVE_STATIC=1
PORT=8080
STORAGE=file
```

Put your real password where `your-password-here` is.

`STORAGE=file` saves values and roles to a file on the VPS
(`proxy\data\wolimons-data.json`). That is what you want here: no GitHub
token, no account, nothing leaving the server, and saves are instant. The
GitHub option only exists for hosts that wipe the disk on every restart, like
Render's free tier — a VPS keeps its disk, so it is unnecessary.

On the first run the file is created from the copy committed in the repo, so
the roles and values already there carry over.

Save and close.

`ADMIN_KEY` is the admin panel password. It lives only in this file, which is
listed in `.gitignore`, so it is never committed and never sent to the
browser — the password is checked on the server. **Read section 8 before
choosing it** — a short, guessable password is a bad idea on a public IP.

`SERVE_STATIC=1` is the important one: it tells the process to serve the web
pages as well as the API, so the whole site is on one port.

## 4. Start it

```bat
cd C:\Wolimons\proxy
node server.js
```

You should see:

```
Wolimons listening on port 8080 -> upstream https://wanwoo.xyz
Loaded from .env: ADMIN_KEY, SERVE_STATIC, PORT
Serving the site from C:\Wolimons
Open http://localhost:8080/ here, or http://<this-machine's-IP>:8080/ from another device.
```

On the VPS itself, open <http://localhost:8080/>. If the site loads, the
server is fine and anything else is a firewall problem.

Leave that window open — closing it stops the site. Section 7 makes it
permanent.

## 5. Open the port in Windows Firewall

This is the step people miss. Windows blocks incoming connections by default,
so the site works on the VPS but not from your phone.

Open **Command Prompt as Administrator** (right-click → Run as administrator):

```bat
netsh advfirewall firewall add rule name="Wolimons" dir=in action=allow protocol=TCP localport=8080
```

If your VPS host has its own firewall in their control panel (AWS security
groups, Azure NSG, Vultr/DigitalOcean firewalls, OVH…), you must allow
inbound **TCP 8080** there too. Two separate firewalls, both need the rule.

## 6. Open it on your phone

Find the VPS's public IP. On the VPS:

```bat
curl ifconfig.me
```

or just read it from your host's control panel.

On your phone, in any browser, type the address with the port:

```
http://203.0.113.45:8080/
```

(substituting your own IP). Notes that save a lot of confusion:

- **Type `http://`, not `https://`.** There is no certificate on a bare IP, so
  `https://` will fail. Some phone keyboards add it for you — delete it.
- **Don't forget `:8080`.** Without it the phone tries port 80 and nothing
  answers. To drop it, set `PORT=80` in `.env` and open port 80 in the
  firewall instead; then `http://203.0.113.45/` works.
- If it doesn't load, the port is closed, not the site. Recheck section 5.

Everything works from the phone the way it does on the VPS, including the
admin panel — the page asks whichever address you used for its data, so there
is nothing to configure per-device.

## 7. Keep it running after you log off

Running `node server.js` in a window stops the moment you close it or
disconnect Remote Desktop. To run it as a real Windows service, use NSSM:

1. Download NSSM from <https://nssm.cc/download> and unzip it, e.g. to
   `C:\nssm`.
2. In an **Administrator** Command Prompt:

```bat
C:\nssm\win64\nssm.exe install Wolimons "C:\Program Files\nodejs\node.exe" "C:\Wolimons\proxy\server.js"
C:\nssm\win64\nssm.exe set Wolimons AppDirectory C:\Wolimons\proxy
C:\nssm\win64\nssm.exe start Wolimons
```

It now starts automatically with the VPS. Useful commands:

```bat
nssm.exe restart Wolimons
nssm.exe stop Wolimons
nssm.exe remove Wolimons confirm
```

`AppDirectory` matters — it is what lets the server find `.env`.

## 8. Before you leave this on the public internet

Read this bit properly.

**A short password is a weak password on a public IP.** Once the VPS is
reachable, anyone in the world can reach the login endpoint, and bots scan for
exactly this. There is no rate limiting and no lockout in this server, so a
guessable password with no symbols will eventually be found. For a site only
you administer, use a long random string instead — you paste it in once and your browser
remembers it for 12 hours:

```
ADMIN_KEY=8mQ2vTn6xLpR4wYc9KdF3sHbZ7jUeA5g
```

Generate one on the VPS with:

```bat
powershell -Command "[guid]::NewGuid().ToString('N')"
```

Other things worth knowing:

- **Traffic is unencrypted.** Over plain `http://`, the admin password is sent
  across the network in the clear. That is acceptable on your own LAN; on the
  public internet it means anyone between your phone and the VPS could read
  it. Fixing it properly needs a domain name and HTTPS (Caddy is the easiest
  on Windows — it gets a free certificate automatically).
- **Signing in survives 12 hours, restarts sign everyone out.** Tokens are
  held in memory only.
- **Your data lives on the VPS.** With `STORAGE=file` (section 3) values and
  roles are saved to `proxy\data\wolimons-data.json` on the server. Nothing is
  sent to GitHub and no token is needed. Back that file up - it is the one
  irreplaceable thing on the machine, and rebuilding the VPS takes it with it.
  The previous contents are kept next to it as `.bak` on every save.
- **Never commit `.env`.** It is gitignored already. If a password or token
  ever does get pushed, treat it as public and change it, because the repo is
  public and the history keeps it.

## 9. Back up your values

`C:\Wolimons\proxy\data\wolimons-data.json` holds every value you have ever
set, the change history behind `/valuechanges`, and who has which role. It is
the only thing on the VPS that cannot be re-downloaded, so it is worth a
scheduled copy.

A daily copy into a dated folder, as one line:

```bat
xcopy /Y C:\Wolimons\proxy\data\wolimons-data.json C:\WolimonsBackups\%DATE:/=-%\
```

Save that as `backup.bat` and add it to Task Scheduler (**Create Basic Task**
→ Daily → Start a program). Better still, point the destination at OneDrive or
Google Drive so a copy leaves the machine.

To restore, stop the server, drop the file back at that path, and start it
again. To move to a new VPS, copy that one file across.

Two smaller safety nets are already there: `wolimons-data.json.bak` is the
previous contents, rewritten on every save, and saves are atomic — the file is
written to a temporary name and renamed into place, so a crash or a power cut
mid-save leaves the old file rather than a truncated one.

## Settings reference

All of these go in `proxy\.env`. A real environment variable, if you set one,
always beats the file.

| Setting | Default | What it does |
| --- | --- | --- |
| `ADMIN_KEY` | *(empty)* | Admin panel password. Empty = nobody can sign in. |
| `SERVE_STATIC` | off | `1` serves the web pages too, not just the API. |
| `PORT` | 3000 | Port to listen on. |
| `SITE_ROOT` | repo root | Where the site's files are. |
| `STORAGE` | `auto` | `file` saves to disk, `github` commits to the repo. |
| `DATA_FILE` | `proxy\data\wolimons-data.json` | Where the file backend saves. |
| `GITHUB_TOKEN` | *(empty)* | Only for `STORAGE=github`. Not needed on a VPS. |
| `GITHUB_REPO` | `ratemyavatar/Wolimons` | Repo holding the data file. |
| `GITHUB_BRANCH` | `main` | Branch to commit to. |
| `UPSTREAM_ORIGIN` | `https://wanwoo.xyz` | Where item/player data comes from. |
| `ALLOWED_ORIGINS` | any | Sites allowed to call the API cross-origin. |
| `CACHE_TTL_MS` | 60000 | How long upstream responses are cached. |

## Troubleshooting

**Works on the VPS, not on the phone** — firewall. Section 5, and check your
host's control panel firewall too.

**`EADDRINUSE`** — something already uses that port. Find and stop it:

```bat
netstat -ano | findstr :8080
taskkill /PID <the-number-in-the-last-column> /F
```

**Pages load but everything is unstyled** — you opened `index.html` as a file
instead of through the server. Use `http://…:8080/`.

**"The server has no GitHub token, so nothing can be saved"** — the server is
using the GitHub backend. Set `STORAGE=file` in `.env` and restart; on a VPS
that is what you want.

**"server has no admin key configured"** — the server started without seeing
`ADMIN_KEY`. Check `.env` is in `C:\Wolimons\proxy\` (not the repo root), that
it is named exactly `.env` and not `.env.txt` — Notepad does that — and that
the startup log lists `ADMIN_KEY` on the "Loaded from .env" line.

**Item images and data are missing** — the VPS can't reach `wanwoo.xyz`, or
Wanwood is down. Test with `curl https://wanwoo.xyz/` on the VPS.
