# Hosting Wolimons on a Windows VPS

How to run the whole site — pages *and* API — from one Node process on a
Windows server, and open it on your phone by typing the VPS's IP address.

Everything below assumes you are logged into the VPS over Remote Desktop.

> **Don't want to type all this?**
> Right-click **`windows\setup.bat`** → *Run as administrator*. It does every
> step on this page for you and only asks for your password, your port and
> your domain. See [`windows/README.md`](windows/README.md).
>
> The rest of this document explains what that script is doing, and is what
> you need when something goes wrong.

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
exactly this. The server allows **10 wrong guesses per 15 minutes per IP
address** and then answers `429` for the rest of the window, which stops
casual bots dead — but it is a speed bump, not a lock, and a password like
`wolimons` would still fall to a patient attacker. For a site only you
administer, use a long random string instead — you paste it in once and your
browser remembers it for 12 hours:

```
ADMIN_KEY=8mQ2vTn6xLpR4wYc9KdF3sHbZ7jUeA5g
```

Generate one on the VPS with:

```bat
powershell -Command "[guid]::NewGuid().ToString('N')"
```

Other things worth knowing:

- **Traffic is unencrypted on a bare IP.** Over plain `http://`, the admin
  password is sent across the network in the clear. That is acceptable on your
  own LAN; on the public internet it means anyone between your phone and the
  VPS could read it. **Section 10 fixes this** — putting the site behind your
  Cloudflare domain gives you real HTTPS, free, and is the single biggest
  security improvement available here.
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

## 10. Put it on your Cloudflare domain

This gets you `https://wolimons.example.com/` instead of
`http://203.0.113.45:8080/` — a real address, a real certificate, no port to
remember, and your server's IP hidden.

Read section 10.1 first. It is the one thing that catches everybody.

### 10.1 The port trap

Cloudflare's proxy (the **orange cloud**) does **not** change ports. When
someone visits `https://wolimons.example.com`, Cloudflare connects to **your
port 443**, not to 8080. The DNS record's port field does not exist, and the
`:8080` you have been typing plays no part.

Cloudflare's proxy will only talk to these origin ports:

| | Ports |
|---|---|
| HTTP | 80, 8080, 8880, 2052, 2082, 2086, 2095 |
| HTTPS | 443, 2053, 2083, 2087, 2096, 8443 |

So `http://wolimons.example.com` (port 80) → your origin port 80, and
`https://wolimons.example.com` (port 443) → your origin port 443. Neither one
lands on 8080 by itself.

That leaves you three honest options:

| | What you do | HTTPS | Firewall ports open | Typing |
|---|---|---|---|---|
| **A. Tunnel** | Install `cloudflared` | Yes | **None** | Least |
| **B. Port 80** | Set `PORT=80` | No | 80 | A little |
| **C. Origin Rules** | Keep 8080, add a rule | Yes | 8080 | Most |

**Option A is the right answer for your setup**, and it is also the least
typing on a phone. Sections 10.2–10.4 cover each one; do only one of them.

### 10.2 Option A — Cloudflare Tunnel (recommended)

A tunnel makes an **outbound** connection from your VPS to Cloudflare, and
traffic comes back down it. Nothing listens on the public internet, so you can
close 8080 in the firewall entirely. It works even behind NAT or a host that
won't let you open ports, and Cloudflare handles the certificate.

Most of this is done in your **phone's browser**, not over RDP, which is the
point — there is very little to type into that tiny window.

**In your phone's browser:**

1. Go to <https://one.dash.cloudflare.com> → **Networks** → **Tunnels**.
2. **Create a tunnel** → **Cloudflared** → name it `wolimons` → **Save**.
3. Choose **Windows / 64-bit**. It shows an install command containing a very
   long `eyJ...` token. **Copy that whole command** — you will paste it once.
4. Don't run it yet. First finish the tunnel's **Public Hostname** tab:
   - **Subdomain**: `wolimons` (or blank for the bare domain)
   - **Domain**: your domain
   - **Type**: `HTTP`
   - **URL**: `localhost:8080`
5. **Save**.

The DNS record is created for you. Note that the URL is `HTTP` and
`localhost:8080` — that leg is inside your own machine, so it does not need a
certificate, and it is the only place `8080` still appears.

**Now on the VPS, over RDP:**

Install cloudflared. Two short lines in an **Administrator** Command Prompt:

```bat
cd C:\
```

```bat
curl -L -o cfd.msi https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.msi
```

```bat
msiexec /i C:\cfd.msi /quiet
```

Then paste the command you copied in step 3. It looks like this, and it is the
only long thing you have to get onto the VPS:

```bat
cloudflared.exe service install eyJhIjoi...
```

Pasting a long token into a phone RDP client is miserable. Avoid retyping it:
copy it into a note or email you can open **inside** the VPS's own browser,
then copy it there and right-click to paste into Command Prompt. Or run
`notepad C:\t.txt` on the VPS and use your RDP client's clipboard-send.

**No browser on the VPS at all?** `setup.bat` option 4 asks whether you can
sign in on this machine or want to paste a token. Pick **2** and it does the
whole VPS side above for you — including installing cloudflared and the
service — with no `cloudflared.exe` on the PATH to type. You still add the
tunnel's **Public Hostname** in the Cloudflare app yourself; saving it creates
the DNS record.

That's it. `cloudflared` is now a Windows service that starts with the
machine, alongside the Wolimons service from section 7. Visit:

```
https://wolimons.example.com/
```

**Then tighten up.** With a tunnel, nothing needs to reach 8080 from outside,
so remove the hole you opened in section 5:

```bat
netsh advfirewall firewall delete rule name="Wolimons"
```

And close 8080 in your host's control-panel firewall too. Your VPS now has no
inbound web port open at all, which is a much better place to be than where
you started.

To check on it later:

```bat
sc query cloudflared
```

### 10.3 Option B — port 80, no tunnel

Simplest to understand, but **no HTTPS**: your admin password still crosses
the internet in the clear. Only pick this if the tunnel is impossible.

1. In `C:\Wolimons\proxy\.env`, change the port:

   ```
   PORT=80
   ```

2. Restart the service:

   ```bat
   nssm.exe restart Wolimons
   ```

3. Open port 80 in the firewall (and in your host's control panel):

   ```bat
   netsh advfirewall firewall add rule name="Wolimons80" dir=in action=allow protocol=TCP localport=80
   ```

4. In the Cloudflare dashboard → **DNS** → **Add record**:
   - **Type** `A`, **Name** `wolimons`, **IPv4** your VPS IP
   - **Proxy status**: orange cloud **on**

5. **SSL/TLS** → **Overview** → set the mode to **Flexible**. Cloudflare then
   serves HTTPS to visitors and speaks plain HTTP to your origin on port 80.

Be clear-eyed about what Flexible means: the visitor↔Cloudflare leg is
encrypted, the Cloudflare↔VPS leg is not. It hides the password from your
phone's wifi but not from the wider internet. Option A encrypts both legs.

### 10.4 Option C — keep 8080, add an Origin Rule

Cloudflare can be told to send traffic to a different origin port. This keeps
`PORT=8080` and still gives HTTPS to visitors.

1. DNS `A` record with the orange cloud on, as in 10.3 step 4.
2. **Rules** → **Origin Rules** → **Create rule**:
   - When: `Hostname equals wolimons.example.com`
   - Then: **Rewrite to** → **Destination Port** → `8080`
3. **SSL/TLS** mode: **Flexible** (your origin on 8080 is plain HTTP).
4. Leave the section 5 firewall rule for 8080 in place.

Same encryption caveat as option B, and more moving parts. It exists mainly
for when you cannot change the port the app listens on.

### 10.5 After the domain is live

**Tell the server it is behind Cloudflare.** Add this to
`C:\Wolimons\proxy\.env`:

```
TRUST_PROXY=1
```

Restart with `nssm.exe restart Wolimons`. Without it every request looks like
it comes from Cloudflare, so the sign-in rate limit from section 8 would count
the entire internet as one visitor and lock you out along with the bots. With
it, the server reads the real visitor IP from Cloudflare's `CF-Connecting-IP`
header and limits each one separately.

Only switch it on when something really is in front of the server. On a bare
public IP that header can be forged by anyone, which would let an attacker
dodge the limit entirely — which is exactly why it is off by default.

You can confirm it took effect in the startup log:

```
Trusting CF-Connecting-IP / X-Forwarded-For (behind Cloudflare or a reverse proxy).
```

**Lock the API to your domain.** Now that there is one real address, stop
accepting cross-origin calls from anywhere else. In `.env`:

```
ALLOWED_ORIGINS=https://wolimons.example.com
```

**Don't stop typing the port on the VPS itself.** `http://localhost:8080/`
still works there and is the quickest way to tell "the site is broken" apart
from "Cloudflare is misconfigured". If localhost:8080 works and the domain
doesn't, the problem is in this section, not in the app.

### 10.6 When the domain doesn't work

| What you see | What it means |
|---|---|
| **Error 521** (web server is down) | Cloudflare reached your IP and nothing answered on the port it tried. Almost always the port trap in 10.1 — you are on option B or C and Cloudflare is knocking on 443. |
| **Error 522** (connection timed out) | A firewall is eating it. Check both the Windows rule *and* your host's control-panel firewall. |
| **Error 523** (origin unreachable) | The DNS `A` record points at the wrong IP. |
| **Too many redirects** | SSL/TLS mode is **Full** while the origin only speaks HTTP. Set it to **Flexible**, or use option A. |
| Site loads, admin sign-in says **429** | The rate limit, working. Either you really did mistype it ten times, or `TRUST_PROXY=1` is missing (10.5). Wait 15 minutes or restart the service to clear it. |
| Tunnel shows **Down** in the dashboard | `sc query cloudflared` on the VPS. If it isn't running, `sc start cloudflared`. |
| Changes to `.env` seem ignored | You didn't restart: `nssm.exe restart Wolimons`. |

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
| `TRUST_PROXY` | off | Read the visitor's IP from `CF-Connecting-IP`. Turn on **only** behind Cloudflare or a reverse proxy (section 10.5). |
| `LOGIN_MAX_ATTEMPTS` | 10 | Wrong admin passwords allowed per IP per window. |
| `LOGIN_WINDOW_MS` | 900000 | The window, in milliseconds. 15 minutes. |

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
