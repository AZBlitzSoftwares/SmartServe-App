@echo off
rem Janu's Smart Serve - Open Desk (Windows): the Control Desk in its own Chrome window. KOTs print by themselves, no print dialog.
rem Local Server running on this laptop: the laptop's desk. Otherwise: the cloud desk.
cd /d "%~dp0"
title Open Desk

where node >nul 2>nul
if errorlevel 1 goto nonode
node ss-local.mjs desk %*
if errorlevel 1 goto done
echo This window can be closed (it closes itself in 30 seconds).
timeout /t 30 >nul
exit /b 0

:nonode
echo.
echo Node.js is not installed on this computer.
echo Install the LTS version from https://nodejs.org, then double-click this file again.

:done
echo.
pause
