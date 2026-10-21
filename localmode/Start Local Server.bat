@echo off
rem Janu's Smart Serve - Local Server (Windows): run the event from this laptop. Keep this window open.
cd /d "%~dp0"
title Local Server

where node >nul 2>nul
if errorlevel 1 goto nonode
if not exist "node_modules\embedded-postgres\" goto install
if not exist "node_modules\pg\" goto install
if not exist "node_modules\qrcode\" goto install
goto run

:install
echo First run: installing the local server's parts (needs internet, about a minute)...
call npm install --omit=dev --no-audit --no-fund
if errorlevel 1 goto installfail

:run
node ss-local.mjs start %*
set CODE=%errorlevel%
rem 0 = stopped with Ctrl+C, 2 = something to fix first: do not restart
if "%CODE%"=="0" goto done
if "%CODE%"=="2" goto done
echo.
echo The local server stopped unexpectedly (code %CODE%). Restarting in 5 seconds...
rem The desk window opened on the first start stays open: do not open another.
set SS_LOCAL_NO_DESK=1
timeout /t 5 /nobreak >nul
goto run

:nonode
echo.
echo Node.js is not installed on this computer.
echo Install the LTS version from https://nodejs.org, then double-click this file again.
goto done

:installfail
echo.
echo Could not install them. Check the internet connection and try again.

:done
echo.
pause
