#!/bin/bash
# Janu's Smart Serve - Local Server (Mac): Print Hub printing from the local server instead of the cloud.
cd "$(dirname "$0")" || exit 1
# Finder does not pass the usual PATH; add the places the Node installer and Homebrew use.
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
printf '\033]0;Print Hub (Local)\007'
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
if [ ! -d node_modules/embedded-postgres ] || [ ! -d node_modules/pg ]; then
  echo "First run: installing the local server's parts (needs internet, about a minute)..."
  if ! npm install --omit=dev --no-audit --no-fund; then
    echo
    echo "Could not install them. Check the internet connection and try again."
    read -r -p "Press Enter to close this window..."
    exit 1
  fi
fi

while true; do
  node ss-local.mjs printhub "$@"
  code=$?
  # 0 = stopped with Ctrl+C, 2 = something to fix first: do not restart
  if [ "$code" -eq 0 ] || [ "$code" -eq 2 ]; then
    break
  fi
  echo
  echo "Print Hub stopped unexpectedly (code $code). Restarting in 5 seconds... (Ctrl+C to cancel)"
  sleep 5 || break
done

echo
read -r -p "Print Hub has stopped. Press Enter to close this window..."
