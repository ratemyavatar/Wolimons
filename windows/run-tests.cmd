@echo off
setlocal EnableExtensions

rem ===========================================================================
rem  Wolimons - run tests.cmd
rem
rem  Checks the site over before you trust a pull. Double-click it.
rem
rem  Nothing here touches the running site, your settings or your saved
rem  values - it only reads files. Safe to run at any time, including while
rem  the service is up.
rem ===========================================================================

cd /d "%~dp0.."

title Wolimons - tests

echo.
echo   Wolimons - tests
echo   ================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo   Node is not installed, or is not on the PATH.
  echo   Get it from https://nodejs.org/ and install the LTS version.
  echo.
  pause
  exit /b 1
)

node --test
set "RESULT=%ERRORLEVEL%"

echo.
if "%RESULT%"=="0" (
  echo   All good - nothing is broken.
) else (
  echo   Something above FAILED. Each failure names what it checked, so read
  echo   the lines starting with "not ok" and fix those before restarting
  echo   the service.
)
echo.
pause
endlocal
exit /b %RESULT%
