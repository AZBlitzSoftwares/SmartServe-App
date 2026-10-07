@echo off
rem Janu's Smart Serve - Virtual Printers (Windows). Double-click to start.
rem Six pretend kitchen printers (ports 9101-9106) and a web page that shows
rem every KOT as a paper slip - for testing and demos without a real printer.
cd /d "%~dp0"
title Virtual Printers

where node >nul 2>nul
if errorlevel 1 goto nonode

rem --open: the page opens in the default browser (start) as soon as it is ready
node fake-printer.mjs --kitchens 6 --open %*
goto done

:nonode
echo.
echo Node.js is not installed on this computer.
echo Install the LTS version from https://nodejs.org, then double-click this file again.
echo.

:done
echo.
echo Virtual Printers have stopped.
pause
