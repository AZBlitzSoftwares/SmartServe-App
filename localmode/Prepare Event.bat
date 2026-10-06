@echo off
rem Janu's Smart Serve - Local Server (Windows): download the event onto this laptop (the day before, with internet).
cd /d "%~dp0"
title Prepare Event

where node >nul 2>nul
if errorlevel 1 goto nonode
if not exist "node_modules\embedded-postgres\" goto install
if not exist "node_modules\pg\" goto install
goto run

:install
echo First run: installing the local server's parts (needs internet, about a minute)...
call npm install --omit=dev --no-audit --no-fund
if errorlevel 1 goto installfail

:run
node ss-local.mjs prepare %*
goto done

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
