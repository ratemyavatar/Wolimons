# Hosting Wolimons on a Windows VPS

How to run the whole site — pages *and* API — from one Node process on a
Windows server, and open it on your phone by typing the VPS's IP address.

Everything below assumes you are logged into the VPS over Remote Desktop.

> **Don't want to type all this?**
> Right-click **`windows\setup.bat`** → *Run as administrator*. It does every
> step on this page for you and only asks for your port and your domain.
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
git clone -b arena/01a013ce-wolimons https://github.com/ratemyavatar/Wolimons.git
cd Wolimons
```

No Git? Download the ZIP from the repo's green **Code** button, extract it to
`C:\Wolimons`, and carry on.

There is nothing to build and nothing to `npm install` — the server uses only
what ships with Node.

## 3. Set your settings

Copy the example settings file and open it:

```bat
cd C:\Wolimons\proxy
copy .env.example .env
notepad .env
```

Set these three lines:

```
SERVE_STATIC=1
PORT=8080
STORAGE=file
```

There is no admin password to set any more — the panel is open to whoever
can reach the server. If an old `.env` still carries `ADMIN_KEY`, that is
harmless: the key only seeds trade-ad identity tokens and unlocks nothing.

`STORAGE=file` saves values and roles to a file on the VPS
(`proxy\data\wolimons-data.json`). That is what you want here: no GitHub
token, no account, nothing leaving the server, and saves are instant. The
GitHub option only exists for hosts that wipe the disk on every restart, like
Render's free tier — a VPS keeps its disk, so it is unnecessary.

On the first run the file is created from the copy committed in the repo, so
the roles and values already there carry over.

Save and close.

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
Loaded from .env: SERVE_STATIC, PORT, STORAGE
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

**The admin panel has no password.** That is on purpose: the panel is an open
room, and the door is the server itself. Anyone who can reach `/admin` on
this machine can read and change everything in it — values, ranks, badges,
the trade ad board. For a small site run from a private VPS that is the
trade-off being made. If you ever want the door back, the lever is the
firewall, not a setting here: lock port `8080` down to your addresses, or
keep the site only behind your Cloudflare domain and firewall at that layer.

Other things worth knowing:

- **Traffic is unencrypted on a bare IP.** Over plain `http://`, anything you
  type is sent across the network in the clear. That is acceptable on your
  own LAN. **Section 10 fixes this** — putting the site behind your
  Cloudflare domain gives you real HTTPS, free, and is the single biggest
  improvement available here.
- **Trade ads keep their own proof.** The panel is open, but the public board
  is not: posting and deleting an ad still requires the poster to prove
  control of their Wanwood account. Those sessions sign out on a server
  restart (tokens live in memory) and can be reset from setup.bat option 6.
- **Your data lives on the VPS.** With `STORAGE=file` (section 3) values and
  roles are saved to `proxy\data\wolimons-data.json` on the server. Nothing is
  sent to GitHub and no token is needed. Back that file up - it is the one
  irreplaceable thing on the machine, and rebuilding the VPS takes it with it.
  The previous contents are kept next to it as `.bak` on every save.
- **Never commit `.env`.** It is gitignored already. If a token ever does get
  pushed, treat it as public and change it, because the repo is public and
  the history keeps it.

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

Updating the site does not touch this file — see section 11.

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

Simplest to understand, but **no HTTPS**: everything you type still crosses
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

**First, work out which half is broken.** The two halves fail differently:

- A **Cloudflare error page** (521, 522, 1016 — a real page with a number on
  it) means TLS worked fine and Cloudflare could not reach *your VPS*. The
  problem is on your side: the table below.
- **`ERR_SSL_PROTOCOL_ERROR`**, "can't provide a secure connection", "invalid
  response" — no page at all — means the browser never finished the
  handshake with **Cloudflare's edge**. Your VPS was never contacted. Nothing
  in `.env`, the service, the firewall or the tunnel can cause this, so don't
  go changing them. See 10.7.

| What you see | What it means |
|---|---|
| **Error 521** (web server is down) | Cloudflare reached your IP and nothing answered on the port it tried. Almost always the port trap in 10.1 — you are on option B or C and Cloudflare is knocking on 443. |
| **Error 522** (connection timed out) | A firewall is eating it. Check both the Windows rule *and* your host's control-panel firewall. |
| **Error 523** (origin unreachable) | The DNS `A` record points at the wrong IP. |
| **Too many redirects** | SSL/TLS mode is **Full** while the origin only speaks HTTP. Set it to **Flexible**, or use option A. |
| Site loads, admin sign-in says **429** | The rate limit, working. Either you really did mistype it ten times, or `TRUST_PROXY=1` is missing (10.5). Wait 15 minutes or restart the service to clear it. |
| Tunnel shows **Down** in the dashboard | `sc query cloudflared` on the VPS. If it isn't running, `sc start cloudflared`. |
| Changes to `.env` seem ignored | You didn't restart: `nssm.exe restart Wolimons`. |

### 10.7 ERR_SSL_PROTOCOL_ERROR on the domain, but localhost:8080 works

This one confuses everyone, so here is what it actually means.

`localhost:8080` working tells you the site is **fine**. It is plain HTTP and
it never touches a certificate. The domain failing at the TLS stage means the
browser could not agree on encryption with whatever answered — and it never
got far enough to ask for a page. So these are two unrelated things, and the
working one is not evidence about the broken one.

The site itself never does HTTPS. `proxy/server.js` calls
`http.createServer` — there is no certificate in this repo and no place to put
one. HTTPS is entirely Cloudflare's job. That is why nothing you change in
`.env` or in the Windows service will fix this error.

**Check the four causes in this order.** The first is by far the most common.

**1. The DNS record is grey-clouded (most likely).**

In Cloudflare → **DNS** → **Records**, look at the cloud icon next to your
record. It must be **orange** (Proxied), not **grey** (DNS only).

Grey cloud = Cloudflare hands out your VPS's raw IP and steps out of the way.
The browser then tries to speak HTTPS **directly to your Windows box**, which
only speaks plain HTTP on 8080 — so the handshake dies exactly like this. The
certificate you see in the dashboard only applies to traffic that goes
*through* Cloudflare.

Click the cloud to turn it orange. It takes effect within a minute or so.

If you are on **option A (tunnel)** the record must be the `CNAME` ending in
`.cfargotunnel.com` that the tunnel created, and it is always proxied. If you
also left an old `A` record for the same name, delete it — two records fight
and you get intermittent failures.

**2. You are using a port Cloudflare doesn't do HTTPS on.**

Re-read 10.1. Cloudflare only serves HTTPS on 443, 2053, 2083, 2087, 2096 and
8443. `https://gazeee.xyz:8080` will never work, proxied or not — 8080 is an
**HTTP**-only port on Cloudflare. Visit `https://gazeee.xyz` with no port.

**3. SSL/TLS mode is Off.**

**SSL/TLS** → **Overview**. If the mode is **Off (not secure)**, Cloudflare
refuses HTTPS for the zone. Set it to **Flexible** — correct for every option
in section 10, because your origin is plain HTTP.

(**Full** or **Full (strict)** cause a *different* symptom: a 5xx page or a
redirect loop, not this error. If you see 525 that is Full against an origin
with no certificate — also Flexible.)

**4. The certificate hasn't been issued yet.**

On a brand-new domain, **SSL/TLS** → **Edge Certificates** can sit on
*Pending Validation* for a while — usually minutes, up to ~24h. Until the
status is **Active** there is no certificate to serve and HTTPS fails. If it
is stuck, confirm the domain's nameservers at your registrar are the two
Cloudflare gave you; a Universal certificate is only issued once the zone is
**Active**.

**How to confirm the fix without guessing.** On any machine:

```
curl -sI https://gazeee.xyz/
```

- Any `HTTP/2 200` (or even a Cloudflare error page) = TLS now works.
- Still an SSL error = you are on cause 1, 2 or 4.

And to prove your VPS is not involved, on the VPS:

```
curl -sI http://localhost:8080/
```

If that returns `200` while the domain gives an SSL error, the app is healthy
and the problem is 100% in the Cloudflare settings above.

## 11. Update the site without losing your values

Short version: **your values are not in the download, so an update cannot
overwrite them.** Everything staff have typed in lives in two files that only
exist on the VPS, and neither is in the repo:

| Yours, stays on the VPS | Comes from the download |
| --- | --- |
| `proxy\data\wolimons-data.json` — every value, the change history, the roles | everything else: `proxy\`, `assets\`, `css\`, the pages |
| `proxy\.env` — your settings: port, domain, storage | `data\wolimons-data.json` — a starter file, empty values |

Both are gitignored, so they are not in the ZIP and not in `git pull`. As long
as you don't delete `C:\Wolimons\proxy\data\`, updating is just replacing code.

> Don't confuse the two data files. `proxy\data\wolimons-data.json` is the real
> one the server writes. `data\wolimons-data.json` in the repo root is a starter
> file with no values in it — the server never reads it. Copying it over the
> real one is the one way to actually lose everything, so don't.

### 11.0 Getting update.bat onto the VPS in the first place

You only need the one file. Don't download the whole 43 MB for this — most of
that is the `snapshots\` folder, which is reference material the site never
loads.

**The easy way: `windows\get-update.bat`.** Double-click it. It downloads the
newest `update.bat` into the same folder it is sitting in, so you never type a
path, and it does the line-ending conversion and the check below for you. It
keeps your old `update.bat` as a `.bak` and puts it back if the download comes
out wrong. Administrator is not needed. `get-update.bat all` refreshes
`setup.bat` as well.

There is a PowerShell version of the same thing, `windows\get-update.ps1`,
which takes `-All`, `-Branch <name>` and `-To <folder>`:

```powershell
cd C:\Users\Administrator\Documents\wolimons\windows
powershell -ExecutionPolicy Bypass -File .\get-update.ps1
```

If you don't have `get-update.ps1` either, grab it the same way — from inside
your `windows` folder:

```powershell
$u='https://raw.githubusercontent.com/ratemyavatar/Wolimons/arena/01a013ce-wolimons/windows/get-update.ps1'
[IO.File]::WriteAllText("$pwd\get-update.ps1",((iwr $u -UseBasicParsing).Content))
powershell -ExecutionPolicy Bypass -File .\get-update.ps1
```

That one is a `.ps1`, not a `.bat`, so its line endings don't matter.

Everything below is the by-hand version, for when you want to do it yourself.

On the VPS, open PowerShell as administrator. Set `$win` to **your** `windows`
folder, then paste the rest as-is:

```powershell
$win='C:\Users\Administrator\Documents\wolimons\windows'

$u='https://raw.githubusercontent.com/ratemyavatar/Wolimons/arena/01a013ce-wolimons/windows/update.bat'
$t=(iwr $u -UseBasicParsing).Content
$cr=[string][char]13
$lf=[string][char]10
$t=$t.Replace($cr,'').Replace($lf,$cr+$lf)
[IO.File]::WriteAllText("$win\update.bat",$t)
```

Then **check it worked**, because the failure here is silent:

```powershell
$b=[IO.File]::ReadAllBytes("$win\update.bat")
$bad=0; for($i=0;$i -lt $b.Length;$i++){ if($b[$i] -eq 10 -and ($i -eq 0 -or $b[$i-1] -ne 13)){$bad++} }
if($bad -eq 0){"OK - update.bat is good"}else{"BROKEN - $bad wrong line endings, run the block again"}
```

It either says `OK` or tells you it's broken. If it's broken, paste the block
again one line at a time.

> **Why it's written this awkwardly.** The obvious version uses backticks and a
> `|`, and those get mangled by chat apps, RDP clipboards and web pages —
> silently. A mangled backtick makes PowerShell match nothing instead of
> erroring, so it prints no error, writes the file, and leaves the line endings
> wrong. `cmd.exe` then mis-parses the `.bat` in confusing ways. The version
> above has no backticks and no pipe, so there is nothing to mangle, and the
> size check catches it either way.

> **If you are copying these commands out of a chat app, read this first.**
> Chat apps, Teams, Discord and web pages silently turn URLs into markdown
> links, so `https://example.com` arrives as `[https://example.com](https://example.com)`.
> They do it to bare filenames too — `w.zip` becomes a link, because `.zip` is
> a real domain ending. The result is a string with `http://` inside it, which
> is not a legal Windows filename, so the command fails in a confusing place
> or, worse, fails silently. If a command below arrives with square brackets
> in it, that is what happened. Paste it into Notepad first, delete the
> brackets and the duplicated URL, then paste into PowerShell.

### The way that cannot go wrong

If PowerShell is being difficult, skip it. This does the same job with no
quoting to mangle and no line endings to convert — the ZIP already has the
right ones:

```powershell
$win='C:\Users\Administrator\Documents\wolimons\windows'

$z="$env:TEMP\wolimons_dl"
$url='htt'+'ps://codeload.git'+'hub.com/ratemyavatar/Wolimons/zip/refs/heads/arena/01a013ce-wolimons'
curl.exe -L -s -o $z $url
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip=[IO.Compression.ZipFile]::OpenRead($z)
$e=$zip.Entries | Where-Object { $_.FullName.EndsWith('windows/update.bat') }
[IO.Compression.ZipFileExtensions]::ExtractToFile($e,"$win\update.bat",$true)
$zip.Dispose()
```

Bigger download, but there is nothing in it to get wrong. Or do it by hand:
download the ZIP from GitHub in a browser, open it, and drag
`windows\update.bat` into your `windows` folder.

After that, updating is option **8** forever — you never download by hand
again.

> **Why the `-replace`.** Raw GitHub serves `.bat` files with Unix line
> endings. `cmd.exe` mis-parses those — labels and `if (` blocks are the usual
> casualties, so the script fails in odd places rather than cleanly. The ZIP
> is fine because GitHub applies `.gitattributes` to it; a raw single-file
> download is not. That one `-replace` fixes it, and the result is
> byte-identical to the ZIP copy.

If you'd rather not use PowerShell: open the file on GitHub, click **Raw**,
then Ctrl+S. Save it as `update.bat` with **Save as type: All Files** so
Notepad doesn't make it `update.bat.txt`. Same line-ending caveat applies —
in Notepad, check the status bar says `Windows (CRLF)`, not `Unix (LF)`.

### 11.1 The quick way

Don't do any of this by hand. Right-click **`windows\update.bat`** →
*Run as administrator*, or press **8** in `setup.bat`. It backs your values up
to a dated folder, stops the site, fetches the new version (git if you cloned,
otherwise the ZIP), copies it in without touching `proxy\data\` or
`proxy\.env`, starts the site again and checks it responded.

The rest of this section is what that script does, for when you want to do it
yourself or something goes wrong.

### 11.2 Back up first, always

One minute, and it makes the rest of this risk-free:

```bat
xcopy /Y C:\Wolimons\proxy\data\wolimons-data.json C:\WolimonsBackups\before-update\
xcopy /Y C:\Wolimons\proxy\.env C:\WolimonsBackups\before-update\
```

### 11.3 With Git (easiest)

```bat
cd C:\Wolimons
git pull
C:\nssm\win64\nssm.exe restart Wolimons
```

Git will not touch `proxy\data\` or `proxy\.env` — it doesn't track them.

If `git pull` complains that local changes would be overwritten, you've edited
a file the update also changes. To throw your edits away and take the new
version: `git reset --hard` then `git pull`. That is safe for your values —
`reset --hard` only touches tracked files, and your two files aren't tracked.

### 11.4 From the ZIP (no Git)

The trap here is deleting `C:\Wolimons` and extracting fresh — that takes your
values with it. Extract *over* the top instead:

1. Do the backup in 11.2.
2. Stop the service so nothing is mid-save:
   ```bat
   C:\nssm\win64\nssm.exe stop Wolimons
   ```
3. Download the ZIP from the repo's green **Code** button and extract it. You
   get a folder like `Wolimons-arena-01a013ce-wolimons` with the site inside.
4. Copy the **contents** of that folder into `C:\Wolimons`, choosing
   **Replace the files in the destination**. New files land, changed files are
   overwritten, and `proxy\data\` — which isn't in the ZIP — is left alone.
5. Start it again:
   ```bat
   C:\nssm\win64\nssm.exe start Wolimons
   ```

Same thing as one command, if you'd rather not drag folders — it copies
everything except your two files:

```bat
robocopy "%USERPROFILE%\Downloads\Wolimons-arena-01a013ce-wolimons" C:\Wolimons /E /XD data /XF .env
```

`/XD data` skips every folder called `data`, so it also skips the starter file
in the repo root. That one is unused, so it costs you nothing — and it means
there is no way for this command to reach your real values.

### 11.5 Check it worked

Open the site and look at any item you've valued. If the value is there, you
kept everything. Also check `/valuechanges` — that history comes out of the
same file, so if it's intact, nothing was lost.

If the values *are* gone, don't set them again by hand. Stop the service, copy
your backup back to `C:\Wolimons\proxy\data\wolimons-data.json`, and start it.
There's also a `wolimons-data.json.bak` sitting next to the real file — the
contents from the save before last — if you have no backup of your own.

## Settings reference

All of these go in `proxy\.env`. A real environment variable, if you set one,
always beats the file.

| Setting | Default | What it does |
| --- | --- | --- |
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
| `ITEM_DETAILS_TTL_MS` | 600000 | How long the public API caches the enriched item table. |
| `TRUST_PROXY` | off | Read the visitor's IP from `CF-Connecting-IP`. Turn on **only** behind Cloudflare or a reverse proxy (section 10.5). |

## Troubleshooting

**Works on the VPS, not on the phone** — firewall. Section 5, and check your
host's control panel firewall too.

**`ERR_SSL_PROTOCOL_ERROR` on your domain, but `localhost:8080` works** — the
site is fine; HTTPS is Cloudflare's job and it isn't doing it. Nine times out
of ten the DNS record is **grey-clouded** instead of orange. Full checklist in
section 10.7.

**All the values vanished after an update** — you replaced the whole
`C:\Wolimons` folder instead of copying over it, or you copied the repo's
starter `data\wolimons-data.json` onto the real one. Stop the service, put
your backup (or `wolimons-data.json.bak`) back at
`C:\Wolimons\proxy\data\wolimons-data.json`, start it. Section 11 has the
update steps that don't do this.

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

**"The admin panel is open" in the startup log** — that is the new normal,
not a warning. The admin key is gone; `/admin` works for whoever can reach
the server, and writes are recorded with whoever made them.

**Item images and data are missing** — the VPS can't reach `wanwoo.xyz`, or
Wanwood is down. Test with `curl https://wanwoo.xyz/` on the VPS.
