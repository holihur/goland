#!/usr/bin/env bash
set -euo pipefail

found=0
if pgrep -af 'node .*dapDebugServer[.]js 0 127[.]0[.]0[.]1' >&2; then
  found=1
fi
if pgrep -af 'chrome.*--headless=new.*goland/.data/homes' >&2; then
  found=1
fi
if [ "$found" -ne 0 ]; then
  echo "Leftover browser debug processes detected." >&2
  exit 1
fi
echo "No leftover Chromium/js-debug processes."
