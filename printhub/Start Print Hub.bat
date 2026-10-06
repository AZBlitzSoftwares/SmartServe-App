@echo off
rem Janu's Smart Serve - Print Hub (Windows). Double-click to start.
cd /d "%~dp0"
title Print Hub

where node >nul 2>nul
if errorlevel 1 goto nonode

:run
node printhub.mjs %*
set CODE=%errorlevel%
rem 0 = stopped with Ctrl+C, 2 = settings need fixing: do not restart
if "%CODE%"=="0" goto done
if "%CODE%"=="2" goto done
echo.
echo Print Hub stopped unexpectedly (code %CODE%). Restarting in 5 seconds...
timeout /t 5 /nobreak >nul
goto run

:nonode
echo.
echo Node.js is not installed on this computer.
echo Install the LTS version from https://nodejs.org, then double-click this file again.
echo.

:done
echo.
echo Print Hub has stopped.
pause
