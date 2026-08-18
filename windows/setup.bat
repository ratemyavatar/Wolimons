@echo off
setlocal EnableDelayedExpansion

rem ===========================================================================
rem  Wolimons setup for Windows.
rem
rem  Everything in HOSTING-WINDOWS.md, done for you. You only get asked about
rem  things that are genuinely yours to decide: the admin password, the port,
rem  and your domain name.
rem
rem  Right-click this file and pick "Run as administrator".
rem ===========================================================================

title Wolimons setup

rem --- Where is the repo? This script lives in <repo>\windows\ -------------
pushd "%~dp0.."
set "REPO=%CD%"
popd
set "PROXY=%REPO%\proxy"
set "ENVFILE=%PROXY%\.env"

rem --- Captured out here on purpose. "%ProgramFiles(x86)%" contains a  ------
rem --- closing bracket, which breaks cmd's paren matching if it appears -----
rem --- inside an if(...) block. Held in a plain variable it is harmless. ----
set "PF64=%ProgramFiles%"
set "PF86=%ProgramFiles(x86)%"

rem --- Must be elevated. Almost every step below needs it, and failing at ---
rem --- step 6 having already changed things is worse than failing now. -----
net session >nul 2>&1
if errorlevel 1 (
  echo.
  echo   This needs to run as administrator.
  echo.
  echo   Close this window, right-click setup.bat, and choose
  echo   "Run as administrator".
  echo.
  pause
  exit /b 1
)

:menu
cls
echo.
echo   ==========================================
echo     WOLIMONS SETUP
echo   ==========================================
echo.
echo   Site folder: %REPO%
call :showstate
echo.
echo   1  Set up the site      (do this first)
echo   2  Run it in this window   (test it)
echo   3  Install as a service   (starts with Windows)
echo   4  Put it on my Cloudflare domain  (browser or token)
echo   5  Check that it's working
echo   6  Change the admin password
echo   7  Uninstall the services
echo   8  Update to the latest version
echo   0  Exit
echo.
set "CHOICE="
set /p "CHOICE=  Type a number and press Enter: "

if "%CHOICE%"=="1" goto setup
if "%CHOICE%"=="2" goto runfg
if "%CHOICE%"=="3" goto svcinstall
if "%CHOICE%"=="4" goto tunnel
if "%CHOICE%"=="5" goto healthcheck
if "%CHOICE%"=="6" goto changekey
if "%CHOICE%"=="7" goto uninstall
if "%CHOICE%"=="8" goto update
if "%CHOICE%"=="0" exit /b 0
goto menu

rem ===========================================================================
rem  8. Update
rem
rem  Handed off to update.bat, which copies itself to TEMP before touching
rem  anything. The update overwrites this very file, and cmd.exe re-reads a
rem  .bat as it runs, so updating from inside this script would corrupt it.
rem ===========================================================================
:update
if not exist "%REPO%\windows\update.bat" (
  cls
  echo.
  echo   update.bat is missing from %REPO%\windows\.
  echo   Grab the latest copy of the repo once by hand, and this option
  echo   will work from then on.
  echo.
  pause
  goto menu
)
start "" "%REPO%\windows\update.bat"
exit

rem ===========================================================================
rem  A one-line summary of what is and isn't done yet, so the menu is
rem  self-explanatory on a second visit.
rem ===========================================================================
:showstate
if exist "%ENVFILE%" (
  echo   Settings:    configured
) else (
  echo   Settings:    NOT SET UP - start with option 1
)
sc query Wolimons >nul 2>&1
if errorlevel 1 (
  echo   Service:     not installed
) else (
  for /f "tokens=3" %%s in ('sc query Wolimons ^| findstr /i "STATE"') do echo   Service:     %%s
)
sc query Cloudflared >nul 2>&1
if errorlevel 1 (
  echo   Tunnel:      not installed
) else (
  for /f "tokens=3" %%s in ('sc query Cloudflared ^| findstr /i "STATE"') do echo   Tunnel:      %%s
)
exit /b 0

rem ===========================================================================
rem  1. Set up the site
rem ===========================================================================
:setup
cls
echo.
echo   SETTING UP
echo   ----------
echo.

rem --- Node has to be there. Nothing else works without it. ----------------
where node >nul 2>&1
if errorlevel 1 (
  echo   Node.js isn't installed, or isn't on the PATH.
  echo.
  echo   Get the "LTS" Windows Installer from https://nodejs.org/
  echo   Run it, accept the defaults, then CLOSE this window and run
  echo   setup.bat again. The PATH only updates in new windows.
  echo.
  pause
  goto menu
)

for /f "tokens=*" %%v in ('node --version') do set "NODEVER=%%v"
echo   Node.js %NODEVER% found.

rem --- Node 18+ is required for the built-in fetch the proxy relies on. ----
set "NODEMAJOR=%NODEVER:v=%"
for /f "tokens=1 delims=." %%m in ("%NODEMAJOR%") do set "NODEMAJOR=%%m"
if %NODEMAJOR% LSS 18 (
  echo.
  echo   That's too old. Wolimons needs Node 18 or newer.
  echo   Install the current LTS from https://nodejs.org/ and try again.
  echo.
  pause
  goto menu
)

if not exist "%PROXY%\server.js" (
  echo.
  echo   Can't find %PROXY%\server.js
  echo   This script must stay in the "windows" folder inside the site folder.
  echo.
  pause
  goto menu
)

rem --- Don't silently blow away a working config. --------------------------
if exist "%ENVFILE%" (
  echo.
  echo   Settings already exist at:
  echo   %ENVFILE%
  echo.
  set "OVER="
  set /p "OVER=  Replace them? Your password will be regenerated. (y/N): "
  if /i not "!OVER!"=="y" goto menu
  copy /y "%ENVFILE%" "%ENVFILE%.old" >nul
  echo   Old settings saved as .env.old
)

echo.
call :askkey
if errorlevel 1 goto menu

echo.
echo   Which port should it listen on?
echo     8080 - the usual choice
echo     80   - lets you drop the ":8080" from the address
echo.
set "PORT="
set /p "PORT=  Port [8080]: "
if "%PORT%"=="" set "PORT=8080"

rem --- Reject anything non-numeric before it ends up in the config. -------
echo %PORT%| findstr /r "^[0-9][0-9]*$" >nul
if errorlevel 1 (
  echo   "!PORT!" isn't a number. Using 8080.
  set "PORT=8080"
)

call :writeenv
if errorlevel 1 goto menu

rem --- Open the firewall now, so the phone test later actually works. -----
echo.
echo   Opening port %PORT% in Windows Firewall...
netsh advfirewall firewall delete rule name="Wolimons" >nul 2>&1
netsh advfirewall firewall add rule name="Wolimons" dir=in action=allow protocol=TCP localport=%PORT% >nul
if errorlevel 1 (
  echo   Couldn't add the firewall rule. You may need to do it by hand.
) else (
  echo   Done.
)

echo.
echo   ------------------------------------------------------------
echo   SET UP.
echo.
echo   Your admin password is:
echo.
echo       !ADMINKEY!
echo.
echo   Write it down NOW. It is stored in proxy\.env on this machine
echo   and is not shown again. Option 6 can change it later.
echo   ------------------------------------------------------------
echo.
echo   Next: option 2 to test it, then option 3 to keep it running.
echo.
if not "!PORT!"=="80" (
  if not "!PORT!"=="8080" (
    echo   Note: port !PORT! will NOT work directly behind Cloudflare's
    echo   proxy. If you plan to use option 4, the tunnel handles that
    echo   for you, so this is fine.
    echo.
  )
)
pause
goto menu

rem ===========================================================================
rem  Ask for a password, or make a good one.
rem ===========================================================================
:askkey
echo   ADMIN PASSWORD
echo.
echo   This is what you type to sign in to the admin panel.
echo.
echo     1  Generate a strong one for me  (recommended)
echo     2  I'll type my own
echo.
set "KEYMODE="
set /p "KEYMODE=  Choose [1]: "
if "%KEYMODE%"=="" set "KEYMODE=1"

if "%KEYMODE%"=="2" goto askkey_manual

rem --- A GUID with the dashes stripped: 32 hex characters, no shell -------
rem --- metacharacters, so it can never break the .env file it lands in. ---
for /f "delims=" %%k in ('powershell -NoProfile -Command "[guid]::NewGuid().ToString(''N'')"') do set "ADMINKEY=%%k"
if "!ADMINKEY!"=="" (
  echo   Couldn't generate a password. Choose option 2 and type one.
  exit /b 1
)
echo.
echo   Generated: !ADMINKEY!
exit /b 0

:askkey_manual
echo.
set "ADMINKEY="
set /p "ADMINKEY=  Type your password: "
if "!ADMINKEY!"=="" (
  echo   Empty password - nobody would be able to sign in. Cancelled.
  exit /b 1
)

rem --- These characters break either the .env parser or batch's own -------
rem --- redirection when the file is written. "!" is included because -----
rem --- this script runs with delayed expansion on, which eats it. Refuse --
rem --- rather than write a config that silently doesn't match what was ----
rem --- typed - that would lock you out of your own admin panel. -----------
echo !ADMINKEY!| findstr /r "[<>|&^\"%%!]" >nul
if not errorlevel 1 (
  echo.
  echo   That contains one of:  ^< ^> ^| ^& ^^ ^" %% ^^!
  echo   Those don't survive being written to the settings file.
  echo   Use letters, numbers and any of  - _ . @ #  instead.
  exit /b 1
)

rem --- Short shared secrets on a public domain are the main risk here. ----
rem --- findstr's regex has no {n,} repetition, so measure the string ------
rem --- directly instead of writing a pattern that never matches. ----------
set "KEYLEN=0"
for /l %%i in (0,1,63) do (
  if not "!ADMINKEY:~%%i,1!"=="" set /a KEYLEN=%%i+1
)
if !KEYLEN! LSS 12 (
  echo.
  echo   Warning: that's !KEYLEN! characters. Once this is on the
  echo   internet, bots will try to guess it. The server slows them to
  echo   10 tries per 15 minutes, but a short password is still weak.
  echo.
  set "SHORTOK="
  set /p "SHORTOK=  Use it anyway? (y/N): "
  if /i not "!SHORTOK!"=="y" exit /b 1
)
exit /b 0

rem ===========================================================================
rem  Write proxy\.env
rem ===========================================================================
:writeenv
echo.
echo   Writing %ENVFILE% ...

>"%ENVFILE%" (
  echo # Wolimons settings for this machine.
  echo # Written by windows\setup.bat. Never committed to git.
  echo.
  echo # The admin panel password.
  echo ADMIN_KEY=!ADMINKEY!
  echo.
  echo # Serve the pages as well as the API, so one port does everything.
  echo SERVE_STATIC=1
  echo PORT=!PORT!
  echo.
  echo # Save values to a file on this machine. No GitHub token needed.
  echo STORAGE=file
)

if not exist "%ENVFILE%" (
  echo   Failed to write the settings file.
  pause
  exit /b 1
)
echo   Done.
exit /b 0

rem ===========================================================================
rem  2. Run in the foreground
rem ===========================================================================
:runfg
cls
if not exist "%ENVFILE%" (
  echo.
  echo   Not set up yet - run option 1 first.
  echo.
  pause
  goto menu
)

rem --- The service and a foreground copy would fight over the port. -------
sc query Wolimons 2>nul | findstr /i "RUNNING" >nul
if not errorlevel 1 (
  echo.
  echo   The Wolimons service is already running, and would be holding
  echo   the port. Stopping it while you test...
  net stop Wolimons >nul 2>&1
  echo   Stopped. Start it again with option 3 when you're done.
  echo.
)

call :readport
echo.
echo   Starting. Open http://localhost:!SITEPORT!/ on this machine.
echo   Press Ctrl+C to stop and come back to the menu.
echo.
pushd "%PROXY%"
node server.js
popd
echo.
pause
goto menu

rem ===========================================================================
rem  3. Install as a Windows service (via NSSM)
rem ===========================================================================
:svcinstall
cls
echo.
echo   INSTALL AS A SERVICE
echo   --------------------
echo.
if not exist "%ENVFILE%" (
  echo   Not set up yet - run option 1 first.
  echo.
  pause
  goto menu
)

set "NSSM=%REPO%\windows\nssm.exe"

if not exist "%NSSM%" (
  echo   Downloading NSSM, which runs Node as a proper Windows service...
  set "NSSMZIP=%TEMP%\nssm.zip"
  set "NSSMDIR=%TEMP%\nssmx"

  curl -L -s -o "!NSSMZIP!" https://nssm.cc/release/nssm-2.24.zip
  if errorlevel 1 (
    echo   Download failed. Check the VPS has internet access.
    pause
    goto menu
  )
  if not exist "!NSSMZIP!" (
    echo   Download failed - no file arrived.
    pause
    goto menu
  )

  if exist "!NSSMDIR!" rd /s /q "!NSSMDIR!" >nul 2>&1
  mkdir "!NSSMDIR!" >nul 2>&1
  powershell -NoProfile -Command "Expand-Archive -LiteralPath '!NSSMZIP!' -DestinationPath '!NSSMDIR!' -Force" >nul 2>&1

  rem --- 64-bit if we have it, otherwise the 32-bit build. ---------------
  if exist "!NSSMDIR!\nssm-2.24\win64\nssm.exe" (
    copy /y "!NSSMDIR!\nssm-2.24\win64\nssm.exe" "%NSSM%" >nul
  ) else (
    if exist "!NSSMDIR!\nssm-2.24\win32\nssm.exe" copy /y "!NSSMDIR!\nssm-2.24\win32\nssm.exe" "%NSSM%" >nul
  )
  rd /s /q "!NSSMDIR!" >nul 2>&1
  del "!NSSMZIP!" >nul 2>&1

  if not exist "%NSSM%" (
    echo   Couldn't extract NSSM. Install the service by hand - see
    echo   HOSTING-WINDOWS.md section 7.
    pause
    goto menu
  )
  echo   Got it.
)

for /f "delims=" %%n in ('where node') do set "NODEEXE=%%n"

rem --- Replace any previous install rather than erroring out. -------------
sc query Wolimons >nul 2>&1
if not errorlevel 1 (
  echo   Removing the previous service first...
  "%NSSM%" stop Wolimons >nul 2>&1
  "%NSSM%" remove Wolimons confirm >nul 2>&1
  timeout /t 2 /nobreak >nul
)

echo   Installing...
"%NSSM%" install Wolimons "%NODEEXE%" "%PROXY%\server.js" >nul

rem --- AppDirectory is what lets server.js find .env next to it. ----------
"%NSSM%" set Wolimons AppDirectory "%PROXY%" >nul
"%NSSM%" set Wolimons DisplayName "Wolimons" >nul
"%NSSM%" set Wolimons Description "Wolimons trading site and API" >nul
"%NSSM%" set Wolimons Start SERVICE_AUTO_START >nul

rem --- Restart if it ever stops, whatever the reason. Without this the ---
rem --- site stays down until someone notices and logs in. AppThrottle ---
rem --- is the "don't spin" guard: if it dies inside 5s NSSM waits ------
rem --- before trying again, instead of restarting in a tight loop. ------
"%NSSM%" set Wolimons AppExit Default Restart >nul
"%NSSM%" set Wolimons AppRestartDelay 3000 >nul
"%NSSM%" set Wolimons AppThrottle 5000 >nul

rem --- Keep logs, capped, so a long-running server can't fill the disk. --
if not exist "%REPO%\logs" mkdir "%REPO%\logs" >nul 2>&1
"%NSSM%" set Wolimons AppStdout "%REPO%\logs\wolimons.log" >nul
"%NSSM%" set Wolimons AppStderr "%REPO%\logs\wolimons.log" >nul
"%NSSM%" set Wolimons AppRotateFiles 1 >nul
"%NSSM%" set Wolimons AppRotateBytes 10485760 >nul

"%NSSM%" start Wolimons >nul 2>&1
timeout /t 3 /nobreak >nul

sc query Wolimons | findstr /i "RUNNING" >nul
if errorlevel 1 (
  echo.
  echo   Installed, but it didn't start. Look at:
  echo   %REPO%\logs\wolimons.log
) else (
  call :readport
  echo.
  echo   Running, and it will start automatically with Windows.
  echo   Logs: %REPO%\logs\wolimons.log
  echo   Local address: http://localhost:!SITEPORT!/
)
echo.
pause
goto menu

rem ===========================================================================
rem  4. Cloudflare tunnel
rem ===========================================================================
:tunnel
cls
echo.
echo   PUT IT ON YOUR CLOUDFLARE DOMAIN
echo   --------------------------------
echo.
echo   This creates a tunnel: an outgoing connection from this VPS to
echo   Cloudflare. Visitors reach you over real HTTPS, and NO inbound
echo   port has to be open at all.
echo.
echo   You need: a domain already added to your Cloudflare account.
echo.
if not exist "%ENVFILE%" (
  echo   Set the site up first with option 1.
  echo.
  pause
  goto menu
)

echo   Two ways to connect this machine to Cloudflare:
echo.
echo     1  Sign in with a browser ON THIS MACHINE. setup.bat makes
echo        the tunnel and the DNS record for you.
echo.
echo     2  Paste a tunnel TOKEN from the Cloudflare dashboard or the
echo        phone app. Use this when this machine has no browser -
echo        you then add the hostname yourself in Cloudflare.
echo.
set "MODE="
set /p "MODE=  Choose 1 or 2 [1]: "
if "!MODE!"=="" set "MODE=1"
if "!MODE!"=="2" goto tunnel_token
if not "!MODE!"=="1" (
  echo   That's not 1 or 2.
  pause
  goto tunnel
)

rem ===========================================================================
rem  4a. Browser sign-in on this machine
rem ===========================================================================
:tunnel_browser
call :tunnel_hostname
if "!HOSTNAME!"=="" goto menu

call :readport

set "CFEXE="
if exist "!PF64!\cloudflared\cloudflared.exe" set "CFEXE=!PF64!\cloudflared\cloudflared.exe"
if exist "!PF86!\cloudflared\cloudflared.exe" set "CFEXE=!PF86!\cloudflared\cloudflared.exe"
if "!CFEXE!"=="" (
  where cloudflared >nul 2>&1
  if not errorlevel 1 for /f "delims=" %%c in ('where cloudflared') do set "CFEXE=%%c"
)

if "!CFEXE!"=="" (
  echo.
  echo   Installing cloudflared...
  curl -L -s -o "%TEMP%\cfd.msi" https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.msi
  if not exist "%TEMP%\cfd.msi" (
    echo   Download failed. Check internet access on the VPS.
    pause
    goto menu
  )
  msiexec /i "%TEMP%\cfd.msi" /quiet /norestart
  timeout /t 10 /nobreak >nul
  del "%TEMP%\cfd.msi" >nul 2>&1

  if exist "!PF64!\cloudflared\cloudflared.exe" set "CFEXE=!PF64!\cloudflared\cloudflared.exe"
  if exist "!PF86!\cloudflared\cloudflared.exe" set "CFEXE=!PF86!\cloudflared\cloudflared.exe"

  if "!CFEXE!"=="" (
    echo   Installed, but cloudflared.exe isn't where expected.
    echo   Close this window, reopen setup.bat as administrator and
    echo   try option 4 again.
    pause
    goto menu
  )
  echo   Installed.
)

echo.
echo   ------------------------------------------------------------
echo   A browser window will open and ask you to log in to
echo   Cloudflare and pick your domain.
echo.
echo   This is the ONLY sign-in step, and it replaces copying a
echo   very long token across to this machine.
echo.
echo   If no browser opens, a URL is printed below - open that.
echo   ------------------------------------------------------------
echo.
pause
"!CFEXE!" tunnel login
if errorlevel 1 (
  echo.
  echo   Login didn't complete. Try option 4 again.
  pause
  goto menu
)

rem --- Reuse an existing tunnel of the same name if there is one. --------
echo.
echo   Creating the tunnel...
"!CFEXE!" tunnel create wolimons 2>nul

set "TUNNELID="
for /f "delims=" %%i in ('powershell -NoProfile -Command "try { (& '!CFEXE!' tunnel list --output json ^| ConvertFrom-Json ^| Where-Object { $_.name -eq 'wolimons' } ^| Select-Object -First 1).id } catch { '''' }"') do set "TUNNELID=%%i"

if "!TUNNELID!"=="" (
  echo.
  echo   Couldn't work out the tunnel's ID.
  echo   Run this to see what exists:  "!CFEXE!" tunnel list
  pause
  goto menu
)
echo   Tunnel ID: !TUNNELID!

rem --- The service runs as LOCAL SYSTEM, which cannot reliably read the ---
rem --- credentials left in your user profile. Copying them into --------
rem --- ProgramData is what stops the service failing at boot. -----------
set "CFDATA=%ProgramData%\cloudflared"
if not exist "!CFDATA!" mkdir "!CFDATA!" >nul 2>&1

set "CREDSRC=%USERPROFILE%\.cloudflared\!TUNNELID!.json"
if not exist "!CREDSRC!" (
  echo.
  echo   Can't find the credentials file:
  echo   !CREDSRC!
  pause
  goto menu
)
copy /y "!CREDSRC!" "!CFDATA!\!TUNNELID!.json" >nul

echo   Writing the tunnel config...
>"!CFDATA!\config.yml" (
  echo tunnel: !TUNNELID!
  echo credentials-file: !CFDATA!\!TUNNELID!.json
  echo.
  echo ingress:
  echo   - hostname: !HOSTNAME!
  echo     service: http://localhost:!SITEPORT!
  echo   - service: http_status:404
)

echo   Pointing !HOSTNAME! at the tunnel...
"!CFEXE!" tunnel route dns wolimons "!HOSTNAME!"

rem --- TRUST_PROXY must go on now: behind a tunnel every request looks ---
rem --- like it came from Cloudflare, so without it the login rate ------
rem --- limiter would treat the whole internet as a single visitor. -----
findstr /i /c:"TRUST_PROXY" "%ENVFILE%" >nul 2>&1
if errorlevel 1 (
  echo.>>"%ENVFILE%"
  echo # Behind Cloudflare - read the real visitor IP from CF-Connecting-IP.>>"%ENVFILE%"
  echo TRUST_PROXY=1>>"%ENVFILE%"
  echo   Enabled TRUST_PROXY.
)

findstr /i /c:"ALLOWED_ORIGINS" "%ENVFILE%" >nul 2>&1
if errorlevel 1 (
  echo.>>"%ENVFILE%"
  echo # Only your own site may call the API from a browser.>>"%ENVFILE%"
  echo ALLOWED_ORIGINS=https://!HOSTNAME!>>"%ENVFILE%"
  echo   Locked the API to https://!HOSTNAME!
)

echo.
echo   Installing the tunnel service...
sc query Cloudflared >nul 2>&1
if not errorlevel 1 (
  "!CFEXE!" service uninstall >nul 2>&1
  timeout /t 2 /nobreak >nul
)
"!CFEXE!" service install
timeout /t 3 /nobreak >nul
sc start Cloudflared >nul 2>&1

rem --- Restart Wolimons so it picks up TRUST_PROXY. ----------------------
sc query Wolimons >nul 2>&1
if not errorlevel 1 (
  echo   Restarting Wolimons to apply the new settings...
  net stop Wolimons >nul 2>&1
  net start Wolimons >nul 2>&1
)

echo.
echo   ------------------------------------------------------------
echo   DONE.
echo.
echo       https://!HOSTNAME!/
echo.
echo   DNS can take a minute. If it doesn't load straight away,
echo   wait and retry before changing anything.
echo   ------------------------------------------------------------
echo.
echo   Nothing needs an open inbound port any more. Close the one
echo   setup opened?
set "CLOSEFW="
set /p "CLOSEFW=  (recommended) (y/N): "
if /i "!CLOSEFW!"=="y" (
  netsh advfirewall firewall delete rule name="Wolimons" >nul 2>&1
  echo   Closed. Remember your host's own firewall panel too.
)
echo.
pause
goto menu

rem ===========================================================================
rem  Shared by both tunnel flows: ask which address the site will live at.
rem  Sets HOSTNAME, or leaves it empty if the answer was no good.
rem ===========================================================================
:tunnel_hostname
set "HOSTNAME="
set /p "HOSTNAME=  Full address you want, e.g. wolimons.example.com: "
if "!HOSTNAME!"=="" exit /b 0

rem --- A bare label or a pasted URL are the two likely mistakes. ---------
echo !HOSTNAME!| findstr /r "^https*://" >nul
if not errorlevel 1 (
  echo.
  echo   Leave off the https:// - just the hostname.
  echo.
  set "HOSTNAME="
  pause
  exit /b 0
)
echo !HOSTNAME!| findstr /r "\." >nul
if errorlevel 1 (
  echo.
  echo   That doesn't look like a domain - it needs a dot in it,
  echo   like wolimons.example.com
  echo.
  set "HOSTNAME="
  pause
  exit /b 0
)
exit /b 0

rem ===========================================================================
rem  4b. Tunnel token, for when this machine has no browser
rem ===========================================================================
:tunnel_token
call :tunnel_hostname
if "!HOSTNAME!"=="" goto menu

rem --- Offer www too, so the API allowlist below covers both. ------------
set "ADDWWW="
set /p "ADDWWW=  Also use https://www.!HOSTNAME! ? (y/N): "
set "ORIGINS=https://!HOSTNAME!"
if /i "!ADDWWW!"=="y" set "ORIGINS=https://!HOSTNAME!,https://www.!HOSTNAME!"

call :readport

rem --- Standalone exe next to this script, so nothing depends on the -----
rem --- PATH or on guessing where an installer put it. --------------------
set "CFEXE=%REPO%\windows\cloudflared.exe"
if not exist "!CFEXE!" (
  if exist "!PF64!\cloudflared\cloudflared.exe" set "CFEXE=!PF64!\cloudflared\cloudflared.exe"
  if exist "!PF86!\cloudflared\cloudflared.exe" set "CFEXE=!PF86!\cloudflared\cloudflared.exe"
)
if not exist "!CFEXE!" (
  echo.
  echo   Downloading cloudflared...
  curl -L -s -o "%REPO%\windows\cloudflared.exe" https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe
  set "CFEXE=%REPO%\windows\cloudflared.exe"
  if not exist "!CFEXE!" (
    echo   Couldn't download cloudflared. Check internet access on the VPS.
    pause
    goto menu
  )
  echo   Got it.
)

echo.
echo   ------------------------------------------------------------
echo   In Cloudflare: Zero Trust - Networks - Tunnels - your tunnel
echo   - Configure. Or in the phone app: the tunnel - Add a replica.
echo.
echo   Copy the install command it shows. The token is the long
echo   eyJ... part at the end of it - that bit only.
echo.
echo   Anyone with this token can attach to your tunnel, so treat
echo   it like a password and don't paste it anywhere public.
echo   ------------------------------------------------------------
echo.
set "TOKEN="
set /p "TOKEN=  Paste the eyJ... token here: "
if "!TOKEN!"=="" goto menu

rem --- A tunnel token is a JWT, so it always starts eyJ. Catches the -----
rem --- common mistake of pasting the whole install command. --------------
echo !TOKEN!| findstr /r "^eyJ" >nul
if errorlevel 1 (
  echo.
  echo   That doesn't look like a token - it should start with eyJ.
  echo   Copy just the long eyJ... string, not the whole command.
  echo.
  pause
  goto menu
)

echo.
echo   Installing the tunnel service...
sc query Cloudflared >nul 2>&1
if not errorlevel 1 (
  "!CFEXE!" service uninstall >nul 2>&1
  timeout /t 2 /nobreak >nul
)
"!CFEXE!" service install "!TOKEN!"
timeout /t 3 /nobreak >nul
sc start Cloudflared >nul 2>&1

sc query Cloudflared 2>nul | findstr /i "RUNNING" >nul
if errorlevel 1 (
  echo.
  echo   The tunnel service didn't start. Run this by hand to see why:
  echo   "!CFEXE!" service install "!TOKEN!"
) else (
  echo   Running.
)

rem --- Same two settings the browser flow writes. TRUST_PROXY matters ----
rem --- because behind a tunnel every request arrives from Cloudflare, ----
rem --- so without it the login limiter sees one visitor for everyone. ----
findstr /i /c:"TRUST_PROXY" "%ENVFILE%" >nul 2>&1
if errorlevel 1 (
  echo.>>"%ENVFILE%"
  echo # Behind Cloudflare - read the real visitor IP from CF-Connecting-IP.>>"%ENVFILE%"
  echo TRUST_PROXY=1>>"%ENVFILE%"
  echo   Enabled TRUST_PROXY.
)

findstr /i /c:"ALLOWED_ORIGINS" "%ENVFILE%" >nul 2>&1
if errorlevel 1 (
  echo.>>"%ENVFILE%"
  echo # Only your own site may call the API from a browser.>>"%ENVFILE%"
  echo ALLOWED_ORIGINS=!ORIGINS!>>"%ENVFILE%"
  echo   Locked the API to !ORIGINS!
)

sc query Wolimons >nul 2>&1
if not errorlevel 1 (
  echo   Restarting Wolimons to apply the new settings...
  net stop Wolimons >nul 2>&1
  net start Wolimons >nul 2>&1
)

echo.
echo   ------------------------------------------------------------
echo   DONE on this machine.
echo.
echo   Last step, in Cloudflare - open the same tunnel and add a
echo   public hostname:
echo.
echo     Subdomain:  blank for the root, or "www"
echo     Domain:     !HOSTNAME!
echo     Service:    HTTP   localhost:!SITEPORT!
echo.
echo   Saving that adds the DNS record for you. Then open:
echo.
echo       https://!HOSTNAME!/
echo.
echo   DNS can take a minute - wait and retry before changing things.
echo   ------------------------------------------------------------
echo.
echo   Nothing needs an open inbound port any more. Close the one
echo   setup opened?
set "CLOSEFW="
set /p "CLOSEFW=  (recommended) (y/N): "
if /i "!CLOSEFW!"=="y" (
  netsh advfirewall firewall delete rule name="Wolimons" >nul 2>&1
  echo   Closed. Remember your host's own firewall panel too.
)
echo.
pause
goto menu

rem ===========================================================================
rem  5. Health check
rem ===========================================================================
:healthcheck
cls
echo.
echo   CHECKING
echo   --------
echo.
if not exist "%ENVFILE%" (
  echo   [X] Not set up. Run option 1.
  echo.
  pause
  goto menu
)
echo   [OK] Settings file exists

findstr /b /i /c:"ADMIN_KEY=" "%ENVFILE%" >nul 2>&1
if errorlevel 1 (
  echo   [X] No admin password set - the panel can't be signed in to
) else (
  echo   [OK] Admin password set
)

call :readport
echo   [--] Port !SITEPORT!

sc query Wolimons 2>nul | findstr /i "RUNNING" >nul
if errorlevel 1 (
  echo   [X] Service not running  ^(option 3^)
) else (
  echo   [OK] Service running
)

rem --- Is the service serving THIS folder, or an older copy of the site? ---
rem  If you downloaded a fresh copy and pasted it somewhere new, the service
rem  is still pointed at the old folder until you reinstall it. That looks
rem  exactly like "my changes didn't do anything", so check it here.
rem  Read it from the registry rather than "nssm get" - nssm prints in a
rem  format that for /f mangles, and nssm.exe isn't in the download anyway.
set "SERVEDIR="
for /f "usebackq tokens=2,*" %%a in (`reg query "HKLM\SYSTEM\CurrentControlSet\Services\Wolimons\Parameters" /v AppDirectory 2^>nul ^| findstr /i AppDirectory`) do (
  set "SERVEDIR=%%b"
)
if defined SERVEDIR (
  if /i "!SERVEDIR!"=="%PROXY%" (
    echo   [OK] Service is serving this folder
  ) else (
    echo   [X] SERVICE IS SERVING A DIFFERENT FOLDER
    echo.
    echo        it is running:  !SERVEDIR!
    echo        you are in:     %PROXY%
    echo.
    echo        That is why the site still shows the old pages. Fix it with
    echo        option 7 ^(uninstall^), then option 1, then option 3 - all
    echo        from THIS folder's setup.bat.
  )
)

echo.
echo   Asking the site if it's alive...
curl -s -m 10 "http://localhost:!SITEPORT!/healthz"
echo.
echo.
echo   Storage and admin status:
curl -s -m 10 "http://localhost:!SITEPORT!/api/status"
echo.

sc query Cloudflared 2>nul | findstr /i "RUNNING" >nul
if not errorlevel 1 (
  echo.
  echo   [OK] Cloudflare tunnel running
  if exist "%ProgramData%\cloudflared\config.yml" (
    echo.
    echo   Your public address:
    findstr /i "hostname:" "%ProgramData%\cloudflared\config.yml"
  )
)
echo.
echo   If the two lines above show JSON with "ok":true, the site is fine.
echo   If they're blank, it isn't running - check
echo   %REPO%\logs\wolimons.log
echo.
pause
goto menu

rem ===========================================================================
rem  6. Change the admin password
rem ===========================================================================
:changekey
cls
echo.
echo   CHANGE THE ADMIN PASSWORD
echo   -------------------------
echo.
if not exist "%ENVFILE%" (
  echo   Not set up yet - run option 1 first.
  echo.
  pause
  goto menu
)

call :askkey
if errorlevel 1 (
  echo.
  pause
  goto menu
)

rem --- Rewrite only the ADMIN_KEY line, keeping every other setting. -----
rem --- for /f drops blank lines, so the file comes out slightly more ------
rem --- compact. Only cosmetic - every setting and comment survives. -------
set "TMPENV=%ENVFILE%.tmp"
if exist "%TMPENV%" del "%TMPENV%" >nul 2>&1
for /f "usebackq delims=" %%l in ("%ENVFILE%") do (
  set "LINE=%%l"
  echo !LINE!| findstr /b /i /c:"ADMIN_KEY=" >nul
  if errorlevel 1 (
    echo !LINE!>>"!TMPENV!"
  ) else (
    echo ADMIN_KEY=!ADMINKEY!>>"!TMPENV!"
  )
)
move /y "%TMPENV%" "%ENVFILE%" >nul

echo.
echo   Changed. Your new password is:
echo.
echo       !ADMINKEY!
echo.
echo   Write it down now.
echo.

sc query Wolimons >nul 2>&1
if not errorlevel 1 (
  echo   Restarting the service so it takes effect...
  net stop Wolimons >nul 2>&1
  net start Wolimons >nul 2>&1
  echo   Done. Everyone signed in has been signed out.
)
echo.
pause
goto menu

rem ===========================================================================
rem  7. Uninstall
rem ===========================================================================
:uninstall
cls
echo.
echo   UNINSTALL
echo   ---------
echo.
echo   This removes the Windows services and the firewall rule.
echo   Your site files and your saved values are NOT touched.
echo.
set "SURE="
set /p "SURE=  Continue? (y/N): "
if /i not "!SURE!"=="y" goto menu

set "NSSM=%REPO%\windows\nssm.exe"
if exist "%NSSM%" (
  "%NSSM%" stop Wolimons >nul 2>&1
  "%NSSM%" remove Wolimons confirm >nul 2>&1
  echo   Wolimons service removed.
) else (
  sc stop Wolimons >nul 2>&1
  sc delete Wolimons >nul 2>&1
  echo   Wolimons service removed.
)

set "CFEXE="
if exist "!PF64!\cloudflared\cloudflared.exe" set "CFEXE=!PF64!\cloudflared\cloudflared.exe"
if exist "!PF86!\cloudflared\cloudflared.exe" set "CFEXE=!PF86!\cloudflared\cloudflared.exe"
if not "!CFEXE!"=="" (
  "!CFEXE!" service uninstall >nul 2>&1
  echo   Tunnel service removed.
)

netsh advfirewall firewall delete rule name="Wolimons" >nul 2>&1
netsh advfirewall firewall delete rule name="Wolimons80" >nul 2>&1
echo   Firewall rules removed.
echo.
echo   Your values are still at proxy\data\wolimons-data.json
echo.
pause
goto menu

rem ===========================================================================
rem  Read PORT back out of .env, defaulting to 8080.
rem ===========================================================================
:readport
set "SITEPORT=8080"
if not exist "%ENVFILE%" exit /b 0
for /f "usebackq tokens=1,* delims==" %%a in ("%ENVFILE%") do (
  if /i "%%a"=="PORT" set "SITEPORT=%%b"
)
rem --- Strip a stray trailing space if the file was hand-edited. ---------
for /f "tokens=* delims= " %%p in ("!SITEPORT!") do set "SITEPORT=%%p"
exit /b 0
