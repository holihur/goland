#!/usr/bin/env bash
set -euo pipefail

profile=${1:-/tmp/goland-cover.out}
threshold=${2:-70}
percent=$(go tool cover -func="$profile" | awk '/^total:/ {gsub("%", "", $3); print $3}')
if [ -z "$percent" ]; then
  echo "Could not read coverage profile: $profile" >&2
  exit 1
fi
awk -v p="$percent" -v t="$threshold" 'BEGIN { if (p + 0 < t + 0) { printf "Go coverage %.1f%% is below %.1f%%\n", p, t; exit 1 } }'
printf 'Go coverage %.1f%% meets %.1f%%\n' "$percent" "$threshold"
