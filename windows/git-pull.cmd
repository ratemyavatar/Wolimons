@echo off
setlocal EnableExtensions EnableDelayedExpansion

rem ===========================================================================
rem  Wolimons - git pull.cmd
rem
rem  Pulls the newest site code into C:\Users\Administrator\Documents\wolimons.
rem  Double-click it. That's all.
rem
rem  It does NOT touch proxy\.env or proxy\data\ - both are gitignored, so
rem  your settings and your saved values survive every pull.
rem
rem  It restarts the Wolimons service for you at the end, because a pull only
rem  changes files on disk - the running process keeps the old code until it
rem  is restarted. Run it as administrator so it can do that.
rem ===========================================================================

set "SITE=C:\Users\Administrator\Documents\wolimons"
set "BRANCH=arena/01a013ce-wolimons"
set "REPO_URL=https://github.com/ratemyavatar/Wolimons.git"
set "REPO_NAME=origin"

title Wolimons - git pull

echo.
echo   Wolimons - git pull
echo   ===================
echo.

rem --- Is Git here at all? --------------------------------------------------
where git >nul 2>&1
if errorlevel 1 (
  echo   Git is not installed. Get it from https://git-scm.com/download/win,
  echo   install it with the defaults, then close this window and run it again.
  echo.
  pause
  exit /b 1
)

rem --- Is the folder a clone? If not, adopt it as one. --------------------
if not exist "%SITE%\.git" (
  echo   %SITE% is not a git clone yet, so this will adopt it as one.
  echo.
  echo   Your settings and your saved values are NOT in git - proxy\.env
  echo   and proxy\data\ stay exactly as they are. Only the site's code
  echo   files are synced, from the ZIP copy to the branch copy. If you
  echo   ever hand-edited code files in this folder, those edits would be
  echo   replaced by the branch's versions.
  echo.
  set "ADOPT="
  set /p "ADOPT=  Adopt this folder as a git clone? (y/N): "
  if /i not "!ADOPT!"=="y" (
    echo   Cancelled. Nothing was changed.
    echo.
    pause
    exit /b 1
  )

  pushd "%SITE%"
  git init
  if errorlevel 1 goto adoptfailed
  git remote add %REPO_NAME% %REPO_URL% >nul 2>&1
  echo   Fetching from GitHub...
  git fetch origin
  if errorlevel 1 goto adoptfailed
  git reset --hard "origin/%BRANCH%"
  if errorlevel 1 goto adoptfailed
  git branch -M "%BRANCH%"
  git branch --set-upstream-to="origin/%BRANCH%" >nul 2>&1
  popd
  echo.
  echo   Adopted. From now on this folder updates with a plain pull.
  echo.
  goto do_pull
)

goto do_pull

:adoptfailed
popd
echo.
echo   Adopting the folder failed. Nothing important was changed - the
echo   site keeps running off the files it already has. If the fetch
echo   failed, check the VPS can reach GitHub, then try again.
echo.
pause
exit /b 1

:do_pull

cd /d "%SITE%"
if errorlevel 1 (
  echo   Could not open %SITE%.
  pause
  exit /b 1
)

echo   Site folder: %SITE%
echo.

rem --- Which branch is checked out? -----------------------------------------
for /f "delims=" %%b in ('git rev-parse --abbrev-ref HEAD 2^>nul') do set "CURBRANCH=%%b"
if not defined CURBRANCH set "CURBRANCH=(detached)"
echo   Current branch: %CURBRANCH%

if /i not "%CURBRANCH%"=="%BRANCH%" (
  echo.
  echo   That is not the site branch - switching to %BRANCH% ...
  git checkout "%BRANCH%" >nul 2>&1
  if errorlevel 1 (
    git checkout -b "%BRANCH%" "origin/%BRANCH%" >nul 2>&1
    if errorlevel 1 (
      echo   Could not switch branches. Run 'git status' in the site folder
      echo   to see what is in the way, then try again.
      echo.
      pause
      exit /b 1
    )
  )
  echo   Switched.
)

rem --- Anything locally changed? ---------------------------------------------
git status --porcelain > "%TEMP%\wolimons-gitpull-status.txt" 2>nul
for %%F in ("%TEMP%\wolimons-gitpull-status.txt") do if %%~zF GTR 0 (
  echo.
  echo   Heads up - some files in the clone were changed locally:
  echo.
  type "%TEMP%\wolimons-gitpull-status.txt"
  echo.
  echo   Your settings and values are NOT in that list - proxy\.env and
  echo   proxy\data\ are gitignored and are never touched by a pull.
)

rem --- Fetch, then fast-forward ----------------------------------------------
echo.
echo   Fetching from GitHub...
git fetch origin
if errorlevel 1 (
  echo.
  echo   The fetch failed. Check that the VPS can reach the internet,
  echo   then run this again.
  echo.
  pause
  exit /b 1
)

echo   Pulling...
git pull --ff-only origin "%BRANCH%"
if errorlevel 1 (
  echo.
  echo   The pull failed. With --ff-only that means the local history has
  echo   diverged from the branch - usually a local commit. Run
  echo   'git status' in the site folder to see what is different.
  echo.
  pause
  exit /b 1
)

echo.
echo   Up to date. Newest commit:
git log -1 --oneline
echo.

rem ===========================================================================
rem  Restart the service so the new code is actually running.
rem
rem  Pulling only changes files on disk - the running Node process keeps the
rem  old code in memory until it is restarted, which is why a pull used to
rem  look like it had done nothing.
rem
rem  nssm restart can report success while the service is still stopping, so
rem  this stops it, waits for it to actually be down, then starts it and
rem  confirms it came back up.
rem ===========================================================================

set "SERVICE=Wolimons"

sc query "%SERVICE%" >nul 2>&1
if errorlevel 1 (
  echo   No "%SERVICE%" service is installed on this machine.
  echo   If you run the site in a window, close that window and start it again.
  echo.
  pause
  endlocal
  exit /b 0
)

rem --- Needs administrator: a normal user cannot stop a service. -------------
net session >nul 2>&1
if errorlevel 1 (
  echo   The site was updated, but restarting the service needs administrator
  echo   rights and this window does not have them.
  echo.
  echo   Right-click this file and choose "Run as administrator", or run:
  echo.
  echo       nssm restart %SERVICE%
  echo.
  pause
  endlocal
  exit /b 0
)

echo   Restarting the %SERVICE% service...

where nssm >nul 2>&1
if errorlevel 1 (
  set "NSSM=%~dp0nssm.exe"
) else (
  set "NSSM=nssm"
)

if /i not "%NSSM%"=="nssm" if not exist "%NSSM%" (
  rem  No nssm anywhere - fall back to Windows' own service control.
  net stop "%SERVICE%" >nul 2>&1
  net start "%SERVICE%" >nul 2>&1
  goto checkservice
)

"%NSSM%" stop "%SERVICE%" >nul 2>&1

rem  Wait up to 20 seconds for it to really stop before starting it again.
set /a WAITED=0
:waitstop
sc query "%SERVICE%" | find "STOPPED" >nul 2>&1
if not errorlevel 1 goto startit
if !WAITED! GEQ 20 goto startit
timeout /t 1 /nobreak >nul
set /a WAITED+=1
goto waitstop

:startit
"%NSSM%" start "%SERVICE%" >nul 2>&1

:checkservice
rem  Give it a moment to come up, then say what actually happened.
timeout /t 3 /nobreak >nul
sc query "%SERVICE%" | find "RUNNING" >nul 2>&1
if errorlevel 1 (
  echo.
  echo   The service did not come back up. Check what it said:
  echo.
  echo       nssm status %SERVICE%
  echo.
  echo   The log is usually in the folder you set when installing the service.
  echo.
  pause
  endlocal
  exit /b 1
)

echo   Service is running the new code.
echo.
pause
endlocal
exit /b 0
