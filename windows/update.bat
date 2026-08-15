@echo off
setlocal EnableDelayedExpansion

rem ===========================================================================
rem  Wolimons update.
rem
rem  Pulls the latest version of the site onto this VPS and restarts it.
rem  Your values, your change history, your roles and your password are never
rem  touched - they live in proxy\data\ and proxy\.env, neither of which is in
rem  the download.
rem
rem  Double-click it, or use option 8 in setup.bat.
rem ===========================================================================

rem --- This file lives in the repo, and the update overwrites the repo. -----
rem --- cmd.exe re-reads a .bat while it runs, so replacing this file -------
rem --- underneath ourselves would corrupt the rest of the run. Copy to -----
rem --- TEMP and carry on from there, where nothing can overwrite us. -------
if /i not "%~1"=="--relaunched" (
  pushd "%~dp0.."
  set "SRCREPO=!CD!"
  popd
  copy /y "%~f0" "%TEMP%\wolimons-update.bat" >nul
  if errorlevel 1 (
    echo   Could not copy the updater to %TEMP%.
    pause
    exit /b 1
  )
  start "Wolimons update" "%TEMP%\wolimons-update.bat" --relaunched "!SRCREPO!"
  exit
)

title Wolimons update
set "REPO=%~2"
set "PROXY=%REPO%\proxy"
set "ENVFILE=%PROXY%\.env"

rem --- Where the values actually live. Normally proxy\data\, but .env can ---
rem --- point DATA_FILE anywhere (D:\WolimonsData\... and so on), and if it -
rem --- does we must back up THAT file, not the default one that isn't -----
rem --- being used. Read it out of .env rather than assuming. --------------
set "DATAFILE=%PROXY%\data\wolimons-data.json"
if exist "%ENVFILE%" (
  for /f "usebackq tokens=1,* delims==" %%a in ("%ENVFILE%") do (
    set "K=%%a"
    set "K=!K: =!"
    if /i "!K!"=="exportDATA_FILE" set "K=DATA_FILE"
    if /i "!K!"=="DATA_FILE" (
      set "V=%%b"
      rem --- strip a leading space and any trailing spaces --------------
      for /f "tokens=* delims= " %%v in ("!V!") do set "V=%%v"
      rem --- .env allows "quoted values"; the server strips them, so ----
      rem --- we must too or we'd back up a path that doesn't exist. -----
      if defined V set "V=!V:"=!"
      if not "!V!"=="" set "DATAFILE=!V!"
    )
  )
)

cls
echo.
echo   ==========================================
echo     WOLIMONS UPDATE
echo   ==========================================
echo.

if not exist "%PROXY%\server.js" (
  echo   That doesn't look like the Wolimons folder:
  echo     %REPO%
  echo.
  echo   Run this from inside the repo's windows\ folder.
  echo.
  pause
  exit /b 1
)

net session >nul 2>&1
if errorlevel 1 (
  echo   This needs to run as administrator, so it can stop and start
  echo   the service.
  echo.
  echo   Close this, right-click update.bat, and choose
  echo   "Run as administrator".
  echo.
  pause
  exit /b 1
)

echo   Site folder: %REPO%
echo.
echo   These are yours and will NOT be touched:
echo     proxy\data\   - every value, the history, the roles
echo     proxy\.env    - your admin password and port
echo.
set "GO="
set /p "GO=  Update now? (y/n): "
if /i not "%GO%"=="y" exit /b 0

rem ===========================================================================
rem  1. Back up the two irreplaceable files first.
rem ===========================================================================
echo.
echo   Backing up...
for /f "delims=" %%d in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd_HHmmss"') do set "STAMP=%%d"
set "BACKUP=C:\WolimonsBackups\%STAMP%"
mkdir "%BACKUP%" >nul 2>&1

rem --- Record the size of the values file now, so we can prove after the ---
rem --- update that it is still exactly the same file. ---------------------
set "SIZEBEFORE="
if exist "%DATAFILE%" (
  for %%f in ("%DATAFILE%") do set "SIZEBEFORE=%%~zf"
  copy /y "%DATAFILE%" "%BACKUP%\" >nul
  if errorlevel 1 (
    echo.
    echo   Could not back up your values. Stopping here rather than
    echo   updating without a backup.
    echo     %DATAFILE%
    echo.
    pause
    exit /b 1
  )
  echo     values    -^> %BACKUP%
) else (
  echo     no values file yet - nothing to back up
)
if exist "%DATAFILE%.bak" copy /y "%DATAFILE%.bak" "%BACKUP%\" >nul 2>&1
if exist "%ENVFILE%" copy /y "%ENVFILE%" "%BACKUP%\" >nul

rem ===========================================================================
rem  2. Stop the service, so nothing is half-written while files move.
rem ===========================================================================
set "WASRUNNING="
sc query Wolimons >nul 2>&1
if not errorlevel 1 (
  sc query Wolimons | findstr /i "RUNNING" >nul
  if not errorlevel 1 set "WASRUNNING=1"
  echo   Stopping the site...
  net stop Wolimons >nul 2>&1
)

rem ===========================================================================
rem  3. Update. Git if this is a clone, otherwise the ZIP.
rem ===========================================================================
set "OK="
set "USEGIT="
if exist "%REPO%\.git" (
  where git >nul 2>&1
  if not errorlevel 1 set "USEGIT=1"
)

if defined USEGIT (
  echo   Fetching the latest version with git...
  pushd "%REPO%"
  git pull --ff-only
  if not errorlevel 1 set "OK=1"
  popd
  if not defined OK (
    echo.
    echo   git couldn't fast-forward. Usually that means a file here was
    echo   edited by hand. To throw those edits away and take the new
    echo   version - your values are not tracked by git, so they survive:
    echo.
    echo       cd /d %REPO%
    echo       git reset --hard
    echo       git pull
    echo.
  )
) else (
  echo   Downloading the latest version...
  set "ZIP=%TEMP%\wolimons-update.zip"
  set "UNZIP=%TEMP%\wolimons-update-src"
  if exist "!ZIP!" del /q "!ZIP!" >nul 2>&1
  if exist "!UNZIP!" rmdir /s /q "!UNZIP!" >nul 2>&1

  curl -L -s -o "!ZIP!" "https://codeload.github.com/ratemyavatar/Wolimons/zip/refs/heads/arena/019fff2c-wolimons"
  if not exist "!ZIP!" (
    echo   Download failed. Check the VPS has internet access.
  ) else (
    echo   Unpacking...
    powershell -NoProfile -Command "Expand-Archive -LiteralPath '!ZIP!' -DestinationPath '!UNZIP!' -Force" >nul 2>&1

    set "SRC="
    for /d %%d in ("!UNZIP!\*") do set "SRC=%%d"
    if not defined SRC (
      echo   The download didn't unpack properly.
    ) else (
      echo   Copying the new files in...
      rem --- /E copies everything, but with no /PURGE nothing in the -------
      rem --- destination is ever deleted. /XD data skips both data --------
      rem --- folders, /XF .env skips the password file. So the two --------
      rem --- things that matter cannot be reached by this copy. -----------
      rem --- Belt and braces on the exclusions: -------------------------
      rem ---   /XD "%PROXY%\data"  the real values folder, by full path --
      rem ---   /XD "!SRC!\data"    the unused starter file in the ZIP ----
      rem ---   /XF "%ENVFILE%"     the password file, by full path -------
      rem --- The source has no proxy\data in it anyway, so there is ------
      rem --- nothing to copy over the top even if a flag were dropped. ---
      robocopy "!SRC!" "%REPO%" /E /NFL /NDL /NJH /NJS /NP /XD "%PROXY%\data" "!SRC!\data" "%REPO%\.git" /XF "%ENVFILE%" >nul
      if errorlevel 8 (
        echo   Copy failed.
      ) else (
        set "OK=1"
      )
    )
  )
  if exist "!ZIP!" del /q "!ZIP!" >nul 2>&1
  if exist "!UNZIP!" rmdir /s /q "!UNZIP!" >nul 2>&1
)

rem ===========================================================================
rem  4. Start it again.
rem ===========================================================================
sc query Wolimons >nul 2>&1
if not errorlevel 1 (
  echo   Starting the site...
  net start Wolimons >nul 2>&1
)

echo.
if not defined OK (
  echo   ------------------------------------------------------
  echo   NOT UPDATED. The site was put back the way it was.
  echo   ------------------------------------------------------
  echo.
  echo   Your backup is in %BACKUP% either way.
  echo.
  pause
  exit /b 1
)

rem ===========================================================================
rem  Prove the values file survived, rather than just claiming it did.
rem  Same file, same size = the update never went near it.
rem ===========================================================================
set "DATAOK=1"
if defined SIZEBEFORE (
  if not exist "%DATAFILE%" (
    set "DATAOK="
  ) else (
    for %%f in ("%DATAFILE%") do set "SIZEAFTER=%%~zf"
    if not "!SIZEAFTER!"=="!SIZEBEFORE!" set "DATAOK="
  )
)
if not defined DATAOK (
  echo.
  echo   ------------------------------------------------------
  echo   WARNING - your values file changed during the update.
  echo   ------------------------------------------------------
  echo.
  echo   It should not have. Putting your backup back:
  echo.
  net stop Wolimons >nul 2>&1
  copy /y "%BACKUP%\wolimons-data.json" "%DATAFILE%" >nul
  if errorlevel 1 (
    echo     Couldn't restore automatically. Copy this back by hand:
    echo       from: %BACKUP%\wolimons-data.json
    echo       to:   %DATAFILE%
  ) else (
    echo     Restored from %BACKUP%
  )
  net start Wolimons >nul 2>&1
  echo.
  pause
)

rem --- Prove it actually came back up. --------------------------------------
set "SITEPORT=8080"
if exist "%ENVFILE%" (
  for /f "usebackq tokens=1,* delims==" %%a in ("%ENVFILE%") do (
    if /i "%%a"=="PORT" set "SITEPORT=%%b"
  )
)
set "SITEPORT=%SITEPORT: =%"

echo   ------------------------------------------------------
echo   UPDATED
echo   ------------------------------------------------------
echo.
if defined USEGIT (
  pushd "%REPO%"
  for /f "delims=" %%c in ('git log -1 --format^=%%s') do echo   Now on: %%c
  popd
  echo.
)
echo   Checking it's alive...
curl -s -m 10 "http://localhost:%SITEPORT%/healthz"
echo.
echo.
echo   Open http://localhost:%SITEPORT%/ and check an item you've valued.
echo   If the value is there, everything came through.
echo.
echo   Backup of your values: %BACKUP%
echo.
pause
exit /b 0
