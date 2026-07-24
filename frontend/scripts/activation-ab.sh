#!/usr/bin/env bash
# Multi-sample activation A/B. One run is worthless here: the click->paint path crosses a real
# network to Render, so variance across runs is large. We take N samples per leg and compare
# MEDIANS, and we also count the WORLD-bbox fetches per run (that count is a correctness signal
# that does not depend on timing at all).
#
# Usage: bash activation-ab.sh [N]
set -u
N="${1:-5}"
BASE="${AC_BASE:-http://localhost:3007}"
OUT="scripts/ab-results"
mkdir -p "$OUT"
: > "$OUT/raw.txt"

run_leg () {
  local label="$1"; local flags="$2"
  for i in $(seq 1 "$N"); do
    local d="$OUT/${label}_$i"
    rm -rf "$d"
    if [ -n "$flags" ]; then
      AC_BASE="$BASE" AC_THEME=dark AC_ZOOM=8.5 AC_FLAGS="$flags" node scripts/activationlab.js "$d" >/dev/null 2>&1
    else
      AC_BASE="$BASE" AC_THEME=dark AC_ZOOM=8.5 node scripts/activationlab.js "$d" >/dev/null 2>&1
    fi
    local paint commit world
    paint=$(grep -o 'first painted frame : [0-9]*' "$d/report.txt" 2>/dev/null | grep -o '[0-9]*$')
    commit=$(grep -o '_waveData committed : [0-9]*' "$d/report.txt" 2>/dev/null | grep -o '[0-9]*$')
    world=$(grep -c 'bbox=-180,-80,180,85' "$d/report.txt" 2>/dev/null || echo 0)
    echo "$label $i paint=${paint:-NA} commit=${commit:-NA} worldFetches=${world:-NA}" | tee -a "$OUT/raw.txt"
  done
}

echo "=== LEG A: default (prewarm ON) ==="
run_leg A ""
echo "=== LEG B: __MARINE_SIBLING_PREWARM__=false ==="
run_leg B "__MARINE_SIBLING_PREWARM__=false"

echo ""
echo "=== MEDIANS ==="
for L in A B; do
  vals=$(grep "^$L " "$OUT/raw.txt" | grep -o 'paint=[0-9]*' | grep -o '[0-9]*' | sort -n)
  n=$(echo "$vals" | grep -c .)
  med=$(echo "$vals" | awk -v n="$n" 'NR==int((n+1)/2){print}')
  wf=$(grep "^$L " "$OUT/raw.txt" | grep -o 'worldFetches=[0-9]*' | grep -o '[0-9]*$' | paste -sd, -)
  echo "leg $L  n=$n  paint values: $(echo "$vals" | paste -sd, -)  MEDIAN=${med:-NA} ms  worldFetchCounts=[$wf]"
done
