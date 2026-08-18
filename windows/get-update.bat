@echo off
setlocal EnableExtensions

rem ===========================================================================
rem  Wolimons - get update.bat
rem
rem  Double-click this to pull down the newest update.bat into this same
rem  folder. Nothing else is touched. Administrator is not needed.
rem
rem  It runs get-update.ps1, which is sitting right next to it. If that file
rem  has gone missing it does the download itself instead.
rem
rem  To also refresh setup.bat, run it from a prompt with:  get-update.bat all
rem ===========================================================================

set "HERE=%~dp0"
if "%HERE:~-1%"=="\" set "HERE=%HERE:~0,-1%"

set "BRANCH=arena/01a013ce-wolimons"
set "EXTRA="
if /i "%~1"=="all" set "EXTRA=-All"

echo.
echo Wolimons - get update.bat
echo =========================
echo.

if exist "%HERE%\get-update.ps1" goto :haveps1

echo get-update.ps1 is not here, so this will do the download on its own.
echo.
goto :inline

:haveps1
powershell -NoProfile -ExecutionPolicy Bypass -File "%HERE%\get-update.ps1" -To "%HERE%" %EXTRA%
if errorlevel 1 goto :failed
goto :done

rem ---------------------------------------------------------------------------
rem  Fallback, for when get-update.ps1 is missing. Same job, written out on
rem  the command line. This one only fetches update.bat - "all" is ignored,
rem  because if get-update.ps1 has gone then so has the rest of the folder and
rem  you may as well download the repo again.
rem
rem  Every line handed to -Command is quoted, so there is nothing in it that
rem  cmd wants to read as a redirect or a pipe.
rem ---------------------------------------------------------------------------
:inline
set "URL=https://raw.githubusercontent.com/ratemyavatar/Wolimons/%BRANCH%/windows/update.bat"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
 "$ErrorActionPreference='Stop';" ^
 "try{[Net.ServicePointManager]::SecurityProtocol=[Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12}catch{};" ^
 "$p=Join-Path $env:HERE 'update.bat';" ^
 "$t=(Invoke-WebRequest -Uri $env:URL -UseBasicParsing).Content;" ^
 "if($t.Length -lt 500){Write-Host 'What came back is too small to be the real file.';exit 1};" ^
 "if($t -notmatch '^@echo off'){Write-Host 'What came back is not a batch file.';exit 1};" ^
 "$cr=[string][char]13; $lf=[string][char]10;" ^
 "$t=$t.Replace($cr,'').Replace($lf,$cr+$lf);" ^
 "if(Test-Path -LiteralPath $p){Copy-Item -LiteralPath $p -Destination ($p+'.bak') -Force};" ^
 "[IO.File]::WriteAllText($p,$t,(New-Object Text.UTF8Encoding $false));" ^
 "$b=[IO.File]::ReadAllBytes($p); $bad=0;" ^
 "for($i=0;$i -lt $b.Length;$i++){if($b[$i] -eq 10 -and ($i -eq 0 -or $b[$i-1] -ne 13)){$bad++}};" ^
 "if($bad -gt 0){Write-Host 'BROKEN - run it again'; exit 1};" ^
 "Write-Host ('OK - update.bat is here, ' + [math]::Round($b.Length/1kb,1) + ' KB')"

if errorlevel 1 goto :failed
goto :done

:failed
echo.
echo That did not work. Nothing important was changed.
echo.
echo Check the VPS can reach the internet, then try again.
echo.
pause
endlocal
exit /b 1

:done
echo.
echo Done. Double-click update.bat to update the site.
echo You do not need to run it as administrator.
echo.
pause
endlocal
exit /b 0
