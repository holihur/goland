#!/usr/bin/env bash
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "usage: $0 <plugin-dir> [output.zip]" >&2
  exit 2
fi
dir=$(cd "$1" && pwd)
out=${2:-"$dir/plugin.zip"}
case "$out" in
  /*) ;;
  *) out="$dir/$out" ;;
esac
if [ ! -f "$dir/manifest.json" ]; then
  echo "manifest.json not found in $dir" >&2
  exit 1
fi

if command -v zip >/dev/null 2>&1; then
  (cd "$dir" && zip -qr "$out" manifest.json bin web 2>/dev/null || zip -qr "$out" manifest.json bin)
else
  python3 - "$dir" "$out" <<'PY'
import os
import sys
import zipfile

root, out = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as archive:
    for current, _dirs, files in os.walk(root):
        for name in files:
            full = os.path.join(current, name)
            rel = os.path.relpath(full, root)
            if rel == "manifest.json" or rel.startswith("bin" + os.sep) or rel.startswith("web" + os.sep):
                archive.write(full, rel.replace(os.sep, "/"))
PY
fi
echo "wrote $out"
