@echo off
rem Janu's Smart Serve - Local Server (Windows): send everything the laptop recorded to the cloud (after the event).
cd /d "%~dp0"
title Upload to Cloud

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
node ss-local.mjs upload %*
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
