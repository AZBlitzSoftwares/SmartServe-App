#!/bin/bash
# Janu's Smart Serve - Print Hub (Mac). Double-click to start.
cd "$(dirname "$0")" || exit 1
# Finder does not always pass the usual PATH; add the places the Node installer uses.
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
printf '\033]0;Print Hub\007'

if ! command -v node >/dev/null 2>&1; then
  echo
  echo "Node.js is not installed on this Mac."
  echo "Install the LTS version from https://nodejs.org, then double-click this file again."
  echo
  read -r -p "Press Enter to close this window..."
  exit 1
fi

while true; do
  node printhub.mjs "$@"
  code=$?
  # 0 = stopped with Ctrl+C, 2 = settings need fixing: do not restart
  if [ "$code" -eq 0 ] || [ "$code" -eq 2 ]; then
    break
  fi
  echo
  echo "Print Hub stopped unexpectedly (code $code). Restarting in 5 seconds... (Ctrl+C to cancel)"
  sleep 5 || break
done

echo
read -r -p "Print Hub has stopped. Press Enter to close this window..."
