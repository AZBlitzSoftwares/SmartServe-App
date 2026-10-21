#!/bin/bash
# Janu's Smart Serve - Open Desk (Mac): the Control Desk in its own Chrome window. KOTs print by themselves, no print dialog.
# Local Server running on this Mac: the laptop's desk. Otherwise: the cloud desk.
cd "$(dirname "$0")" || exit 1
# Finder does not pass the usual PATH; add the places the Node installer and Homebrew use.
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
printf '\033]0;Open Desk\007'
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

node ss-local.mjs desk "$@"
code=$?
echo
if [ "$code" -eq 0 ]; then
  read -r -t 30 -p "This window can be closed (it closes itself in 30 seconds)." _
  echo
else
  read -r -p "Press Enter to close this window..."
fi
