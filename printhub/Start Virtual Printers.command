#!/bin/bash
# Janu's Smart Serve - Virtual Printers (Mac). Double-click to start.
# Six pretend kitchen printers (ports 9101-9106) and a web page that shows
# every KOT as a paper slip - for testing and demos without a real printer.
cd "$(dirname "$0")" || exit 1
# Finder does not always pass the usual PATH; add the places the Node installer uses.
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
printf '\033]0;Virtual Printers\007'

if ! command -v node >/dev/null 2>&1; then
  echo
  echo "Node.js is not installed on this Mac."
  echo "Install the LTS version from https://nodejs.org, then double-click this file again."
  echo
  read -r -p "Press Enter to close this window..."
  exit 1
fi

# --open: the page opens in the default browser as soon as it is ready
node fake-printer.mjs --kitchens 6 --open "$@"

echo
read -r -p "Virtual Printers have stopped. Press Enter to close this window..."
