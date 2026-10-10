#!/bin/bash
# Janu's Smart Serve - Local Server (Mac): send everything the laptop recorded to the cloud (after the event).
cd "$(dirname "$0")" || exit 1
# Finder does not pass the usual PATH; add the places the Node installer and Homebrew use.
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
printf '\033]0;Upload to Cloud\007'
# A folder copied from a download or AirDrop is "quarantined"; macOS would then block its programs.
xattr -dr com.apple.quarantine . 2>/dev/null

if ! command -v node >/dev/null 2>&1; then
  echo
  echo "Node.js is not installed on this Mac."
  echo "Install the LTS version from https://nodejs.org, then double-click this file again."
  echo
  read -r -p "Press Enter to close this window..."
  exit 1
fi
if [ ! -d node_modules/embedded-postgres ] || [ ! -d node_modules/pg ] || [ ! -d node_modules/qrcode ]; then
  echo "First run: installing the local server's parts (needs internet, about a minute)..."
  if ! npm install --omit=dev --no-audit --no-fund; then
    echo
    echo "Could not install them. Check the internet connection and try again."
    read -r -p "Press Enter to close this window..."
    exit 1
  fi
fi

node ss-local.mjs upload "$@"
echo
read -r -p "Press Enter to close this window..."
