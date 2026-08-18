@echo off
setlocal EnableExtensions

rem ===========================================================================
rem  Wolimons - git pull.cmd
rem
rem  Pulls the newest site code into C:\Users\Administrator\Documents\wolimons.
rem  Double-click it. That's all.
rem
rem  It does NOT touch proxy\.env or proxy\data\ - both are gitignored, so
rem  your settings and your saved values survive every pull. Restart the
rem  Wolimons service afterwards to run the new code.
rem ===========================================================================

set "SITE=C:\Users\Administrator\Documents\wolimons"
set "BRANCH=arena/01a013ce-wolimons"

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

rem --- Is the folder a clone? ------------------------------------------------
if not exist "%SITE%\.git" (
  echo   %SITE% is not a git clone, so there is nothing to pull.
  echo.
  echo   One-time setup - run this once in a command prompt:
  echo.
  echo       git clone -b %BRANCH% https://github.com/ratemyavatar/Wolimons.git "%SITE%"
  echo.
  echo   If the site on this machine came from a ZIP download instead of a
  echo   clone, keep using windows\update.bat - it does the same job without
  echo   git. See windows\README.md.
  echo.
  pause
  exit /b 1
)

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
echo   Restart the service so it runs the new code:
echo.
echo       nssm restart Wolimons
echo.
echo   (If there is no service - you run it in a window - stop that window
echo   and start it again.)
echo.
pause
endlocal
exit /b 0
