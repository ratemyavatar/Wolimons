@echo off
setlocal EnableExtensions EnableDelayedExpansion

rem ===========================================================================
rem  Wolimons update.
rem
rem  Pulls the latest version of the site onto this VPS and restarts it.
rem  Your values, your change history, your roles and your password are never
rem  touched - they live in proxy\data\ and proxy\.env, neither of which is in
rem  the download.
rem
rem  Double-click it, or use option 8 in setup.bat.
rem
rem  Administrator is only needed to stop and start the Wolimons service. If
rem  you are not running as administrator the files are still updated - the
rem  script just tells you to restart the service yourself, or offers to
rem  reopen itself as administrator.
rem ===========================================================================

rem ---------------------------------------------------------------------------
rem  Work out where the site folder is, first, before anything else runs.
rem
rem  This used to be done inside an if-block with pushd, popd and !CD!.
rem  Everything inside a block is expanded in one go, so if pushd would not
rem  take the folder the variable came out empty, and every path built from
rem  it afterwards was nonsense with nothing in front of it.
rem
rem  %~f collapses the two dots for us, so REPO comes out as a real, plain,
rem  absolute path with no trailing slash and nothing relative left in it.
rem  Doing it in a subroutine keeps it on its own line, on its own, where
rem  nothing around it can interfere.
rem ---------------------------------------------------------------------------
if /i "%~1"=="--relaunched" goto :fromargument
call :resolve REPO "%~dp0.."
goto :haverepo

:fromargument
call :resolve REPO "%~2"

:haverepo
if not defined REPO goto :badfolder
if not exist "%REPO%\proxy\server.js" goto :badfolder

set "PROXY=%REPO%\proxy"
set "ENVFILE=%PROXY%\.env"

rem --- This file lives in the repo, and the update overwrites the repo. -----
rem --- cmd.exe re-reads a .bat while it runs, so replacing this file -------
rem --- underneath ourselves would corrupt the rest of the run. Copy to -----
rem --- TEMP and carry on from there, where nothing can overwrite us. -------
if /i "%~1"=="--relaunched" goto :main

set "SELF="
if exist "%TEMP%\" call :resolve SELF "%TEMP%\wolimons-update.bat"
if not defined SELF call :resolve SELF "%REPO%\..\wolimons-update.bat"
copy /y "%~f0" "%SELF%" >nul 2>&1
if not exist "%SELF%" (
  echo.
  echo   Could not copy the updater somewhere safe to run from.
  echo     tried: %SELF%
  echo.
  pause
  exit /b 1
)
start "Wolimons update" "%SELF%" --relaunched "%REPO%"
exit /b 0

rem ===========================================================================
rem  From here on we are the copy in TEMP, and REPO came in as argument 2.
rem ===========================================================================
:main
title Wolimons update

rem --- Where the values actually live. Normally proxy\data\, but .env can ---
rem --- point DATA_FILE anywhere (D:\WolimonsData\... and so on), and if it -
rem --- does we must back up THAT file, not the default one that isn't -----
rem --- being used. Read it out of .env rather than assuming. --------------
set "DATAFILE=%PROXY%\data\wolimons-data.json"
call :readenv DATA_FILE DATAFILE

set "SITEPORT=8080"
call :readenv PORT SITEPORT

cls
echo.
echo   ==========================================
echo     WOLIMONS UPDATE
echo   ==========================================
echo.
echo   Site folder:  %REPO%
echo   Your values:  %DATAFILE%
echo.

rem ---------------------------------------------------------------------------
rem  Administrator, and whether we even need it.
rem
rem  The only thing on this whole page that needs administrator is stopping
rem  and starting the Windows service. No service installed - running the
rem  site by hand, or with the setup.bat "run in this window" option - means
rem  no administrator needed at all.
rem ---------------------------------------------------------------------------
set "ELEVATED="
net session >nul 2>&1
if not errorlevel 1 set "ELEVATED=1"

set "HASSERVICE="
sc query Wolimons >nul 2>&1
if not errorlevel 1 set "HASSERVICE=1"

if not defined HASSERVICE goto :noadminneeded
if defined ELEVATED goto :noadminneeded

echo   The Wolimons service is installed on this machine, and stopping it
echo   needs administrator. This window is not running as administrator.
echo.
echo     y  reopen this updater as administrator (recommended)
echo     n  update the files anyway, and restart the service yourself
echo        afterwards with:  net stop Wolimons ^& net start Wolimons
echo.
set "ASADMIN="
set /p "ASADMIN=  Reopen as administrator? (y/n): "
if /i "%ASADMIN%"=="y" goto :elevate
echo.
echo   Carrying on without administrator. The service will be left alone.
echo.
goto :noadminneeded

:elevate
rem  Hand the two paths over as environment variables rather than trying to
rem  nest three levels of quotes inside one PowerShell command line. cmd and
rem  PowerShell disagree about quoting and the result is unreadable; reading
rem  $env: on the other side always works.
set "WOLI_SELF=%~f0"
set "WOLI_REPO=%REPO%"
rem  [char]34 is a double quote. Writing one literally here would need it
rem  escaped for cmd, then again for PowerShell, and that is how these lines
rem  end up broken; asking for the character by number cannot be misread.
powershell -NoProfile -Command "Start-Process -FilePath $env:WOLI_SELF -ArgumentList ('--relaunched ' + [char]34 + $env:WOLI_REPO + [char]34) -Verb RunAs" >nul 2>&1
if errorlevel 1 (
  echo.
  echo   Windows would not open an administrator window. Close this, then
  echo   right-click update.bat and choose "Run as administrator".
  echo.
  pause
)
exit /b 0

:noadminneeded
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
set "STAMP="
for /f "delims=" %%d in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd_HHmmss"') do set "STAMP=%%d"
if not defined STAMP set "STAMP=backup"
set "BACKUP=C:\WolimonsBackups\%STAMP%"
mkdir "%BACKUP%" >nul 2>&1
if not exist "%BACKUP%\" (
  echo.
  echo   Could not create the backup folder:
  echo     %BACKUP%
  echo   Stopping here rather than updating without a backup.
  echo.
  pause
  exit /b 1
)

rem --- Record the size of the values file now, so we can prove after the ---
rem --- update that it is still exactly the same file. ---------------------
set "SIZEBEFORE="
if not exist "%DATAFILE%" goto :novaluesyet
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
goto :backedup

:novaluesyet
echo     no values file yet - nothing to back up

:backedup
if exist "%DATAFILE%.bak" copy /y "%DATAFILE%.bak" "%BACKUP%\" >nul 2>&1
if exist "%ENVFILE%" copy /y "%ENVFILE%" "%BACKUP%\" >nul

rem ===========================================================================
rem  2. Stop the service, so nothing is half-written while files move.
rem ===========================================================================
set "WASRUNNING="
if not defined HASSERVICE goto :serviceleftalone
if not defined ELEVATED goto :serviceleftalone
sc query Wolimons | findstr /i "RUNNING" >nul
if not errorlevel 1 set "WASRUNNING=1"
echo   Stopping the site...
net stop Wolimons >nul 2>&1

:serviceleftalone

rem ===========================================================================
rem  3. Update. Git if this is a clone, otherwise the ZIP.
rem ===========================================================================
set "OK="
set "USEGIT="
if not exist "%REPO%\.git" goto :notaclone
where git >nul 2>&1
if not errorlevel 1 set "USEGIT=1"
:notaclone

if defined USEGIT call :pullwithgit
if not defined USEGIT call :pullwithzip

rem ===========================================================================
rem  4. Start it again.
rem ===========================================================================
if defined HASSERVICE if defined ELEVATED (
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
if not defined SIZEBEFORE goto :datachecked
if not exist "%DATAFILE%" (
  set "DATAOK="
  goto :datachecked
)
for %%f in ("%DATAFILE%") do set "SIZEAFTER=%%~zf"
if not "%SIZEAFTER%"=="%SIZEBEFORE%" set "DATAOK="

:datachecked
if defined DATAOK goto :dataisfine
echo.
echo   ------------------------------------------------------
echo   WARNING - your values file changed during the update.
echo   ------------------------------------------------------
echo.
echo   It should not have. Putting your backup back:
echo.
if defined ELEVATED net stop Wolimons >nul 2>&1
copy /y "%BACKUP%\wolimons-data.json" "%DATAFILE%" >nul
if errorlevel 1 (
  echo     Couldn't restore automatically. Copy this back by hand:
  echo       from: %BACKUP%\wolimons-data.json
  echo       to:   %DATAFILE%
) else (
  echo     Restored from %BACKUP%
)
if defined ELEVATED net start Wolimons >nul 2>&1
echo.
pause

:dataisfine
echo   ------------------------------------------------------
echo   UPDATED
echo   ------------------------------------------------------
echo.
if defined USEGIT call :shownowon

if defined HASSERVICE if not defined ELEVATED (
  echo   The service was left running the old files, because this window
  echo   is not an administrator. Restart it to pick the update up:
  echo.
  echo       net stop Wolimons
  echo       net start Wolimons
  echo.
  goto :finish
)

echo   Checking it's alive...
curl -s -m 10 "http://localhost:%SITEPORT%/healthz"
echo.

:finish
echo.
echo   Open http://localhost:%SITEPORT%/ and check an item you've valued.
echo   If the value is there, everything came through.
echo.
echo   Backup of your values: %BACKUP%
echo.
pause
exit /b 0

rem ===========================================================================
rem  Something went wrong before we could start.
rem ===========================================================================
:badfolder
echo.
echo   That doesn't look like the Wolimons folder:
echo     %REPO%
echo.
echo   update.bat has to stay in the repo's windows\ folder, next to
echo   setup.bat, with proxy\server.js one level up from it.
echo.
pause
exit /b 1

rem ===========================================================================
rem  Subroutines. Everything fiddly lives down here rather than inside an
rem  if-block, because a block is expanded all at once and one empty
rem  variable in it poisons every path built afterwards.
rem ===========================================================================

rem --- :resolve  NAME  PATH  -----------------------------------------------
rem  Turn a path that may contain "..", a trailing slash or quotes into a
rem  plain absolute one. %~f2 does the whole job; doing it in a subroutine
rem  means it happens on its own line, where nothing else can interfere.
:resolve
set "%~1="
if "%~2"=="" goto :eof
set "%~1=%~f2"
goto :eof

rem --- :readenv  KEY  NAME  ------------------------------------------------
rem  Read one setting out of proxy\.env, if it is in there. findstr picks out
rem  just the line we want, so a comment, a blank line or a stray "=" further
rem  down the file cannot confuse the parse the way reading every line did.
:readenv
if not exist "%ENVFILE%" goto :eof
set "_V="
for /f "usebackq tokens=1,* delims==" %%a in (`findstr /r /i /c:"^ *%~1 *=" /c:"^ *export  *%~1 *=" "%ENVFILE%"`) do set "_V=%%b"
if not defined _V goto :eof
rem .env allows "quoted values"; the server strips them, so we must too or
rem we would look for a path that does not exist.
set "_V=!_V:"=!"
if not defined _V goto :eof
rem Leading spaces off (for /f eats them), then trailing ones one at a time.
for /f "tokens=* delims= " %%v in ("!_V!") do set "_V=%%v"
:readenv_tail
if not defined _V goto :eof
if not "!_V:~-1!"==" " goto :readenv_done
set "_V=!_V:~0,-1!"
goto :readenv_tail
:readenv_done
if not defined _V goto :eof
set "%~2=!_V!"
goto :eof

rem --- :pullwithgit ---------------------------------------------------------
:pullwithgit
echo   Fetching the latest version with git...
pushd "%REPO%"
git pull --ff-only
if not errorlevel 1 set "OK=1"
popd
if defined OK goto :eof
echo.
echo   git couldn't fast-forward. Usually that means a file here was
echo   edited by hand. To throw those edits away and take the new
echo   version - your values are not tracked by git, so they survive:
echo.
echo       cd /d "%REPO%"
echo       git reset --hard
echo       git pull
echo.
goto :eof

rem --- :pullwithzip ---------------------------------------------------------
:pullwithzip
echo   Downloading the latest version...
set "ZIP=%TEMP%\wolimons-update.zip"
set "UNZIP=%TEMP%\wolimons-update-src"
if exist "%ZIP%" del /q "%ZIP%" >nul 2>&1
if exist "%UNZIP%" rmdir /s /q "%UNZIP%" >nul 2>&1

curl -L -s -o "%ZIP%" "https://codeload.github.com/ratemyavatar/Wolimons/zip/refs/heads/arena/019fff2c-wolimons"
if not exist "%ZIP%" (
  echo   Download failed. Check the VPS has internet access.
  goto :zipdone
)

echo   Unpacking...
call :unpack "%ZIP%" "%UNZIP%"

set "SRC="
for /d %%d in ("%UNZIP%\*") do set "SRC=%%d"
if not defined SRC (
  echo   The download didn't unpack properly.
  goto :zipdone
)

echo   Copying the new files in...
rem --- /E copies everything, but with no /PURGE nothing in the -------
rem --- destination is ever deleted. /XD data skips both data --------
rem --- folders, /XF .env skips the password file. So the two --------
rem --- things that matter cannot be reached by this copy. -----------
rem --- Belt and braces on the exclusions: -------------------------
rem ---   /XD "%PROXY%\data"  the real values folder, by full path --
rem ---   /XD "%SRC%\data"    the unused starter file in the ZIP ----
rem ---   /XF "%ENVFILE%"     the password file, by full path -------
rem --- The source has no proxy\data in it anyway, so there is ------
rem --- nothing to copy over the top even if a flag were dropped. ---
robocopy "%SRC%" "%REPO%" /E /NFL /NDL /NJH /NJS /NP /XD "%PROXY%\data" "%SRC%\data" "%REPO%\.git" /XF "%ENVFILE%" >nul
if errorlevel 8 (
  echo   Copy failed.
  goto :zipdone
)
set "OK=1"

:zipdone
if exist "%ZIP%" del /q "%ZIP%" >nul 2>&1
if exist "%UNZIP%" rmdir /s /q "%UNZIP%" >nul 2>&1
goto :eof

rem --- :shownowon -----------------------------------------------------------
:shownowon
pushd "%REPO%"
for /f "delims=" %%c in ('git log -1 --format^=%%s') do echo   Now on: %%c
popd
echo.
goto :eof

rem ===========================================================================
rem  :unpack - extract the ZIP one entry at a time.
rem
rem  Expand-Archive (and ZipFile::ExtractToDirectory) abort the ENTIRE archive
rem  if a single entry has a name Windows will not allow - a pipe, colon,
rem  question mark and so on. Some of the reference snapshots in this repo are
rem  saved with the original page titles, which contain a pipe. Extracting entry
rem  by entry means one awkward filename can never stop the update.
rem
rem  The PowerShell is written to a .ps1 first. Long inline -Command strings
rem  full of quotes and braces are exactly what cmd.exe mangles.
rem
rem  THE LINE THAT USED TO BREAK THIS
rem  The bad-filename test was written as a regex character class:
rem
rem      if ($e.Name -match '[ ...the illegal characters, written out... ]')
rem
rem  with the less-than and greater-than signs typed straight into it. cmd
rem  does not know that line is PowerShell. It sees those two signs as its
rem  own redirection operators, tries to redirect to the nonsense that
rem  follows them, and prints
rem
rem      The filename, directory name, or volume label syntax is incorrect.
rem
rem  GetInvalidFileNameChars gives the same answer with no punctuation cmd
rem  can misread, and it is Windows' own list rather than one written out by
rem  hand here, so it cannot be wrong.
rem ===========================================================================
:unpack
set "PSF=%TEMP%\wolimons-unpack.ps1"
> "%PSF%" echo Add-Type -AssemblyName System.IO.Compression.FileSystem
>>"%PSF%" echo $zip = [IO.Compression.ZipFile]::OpenRead($args[0])
>>"%PSF%" echo $out = $args[1]
>>"%PSF%" echo $bad = 0
>>"%PSF%" echo $illegal = [IO.Path]::GetInvalidFileNameChars()
>>"%PSF%" echo foreach ($e in $zip.Entries) {
>>"%PSF%" echo   if ($e.FullName.EndsWith('/')) { continue }
>>"%PSF%" echo   if ($e.Name.IndexOfAny($illegal) -ge 0) { $bad++; continue }
>>"%PSF%" echo   $dest = Join-Path $out $e.FullName
>>"%PSF%" echo   $dir = Split-Path $dest -Parent
>>"%PSF%" echo   if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force ^| Out-Null }
>>"%PSF%" echo   try { [IO.Compression.ZipFileExtensions]::ExtractToFile($e, $dest, $true) } catch { $bad++ }
>>"%PSF%" echo }
>>"%PSF%" echo $zip.Dispose()
>>"%PSF%" echo if ($bad -gt 0) { Write-Host ("     skipped $bad file(s) Windows cannot name - harmless") }
powershell -NoProfile -ExecutionPolicy Bypass -File "%PSF%" "%~1" "%~2"
del /q "%PSF%" >nul 2>&1
goto :eof
