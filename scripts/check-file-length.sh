#!/usr/bin/env bash
set -euo pipefail

limit=800
failed=0
while IFS= read -r -d '' file; do
  lines=$(wc -l < "$file")
  if [ "$lines" -gt "$limit" ]; then
    printf '%s: %d lines (limit %d)\n' "$file" "$lines" "$limit" >&2
    failed=1
  fi
done < <(find backend frontend/src -type f \( -name '*.go' -o -name '*.ts' -o -name '*.tsx' \) -print0)

if [ "$failed" -ne 0 ]; then
  echo "Source file length check failed." >&2
  exit 1
fi
echo "Source file length check passed (max ${limit} lines)."
