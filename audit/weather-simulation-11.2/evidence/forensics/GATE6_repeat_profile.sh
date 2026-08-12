#!/usr/bin/env bash
# Repeat the CPU profile N times and extract the named-native totals from each run.
#
# ⛔ ONE RUN IS NOT A MEASUREMENT. getImageData measured 2729.6 ms and 4420.5 ms on CONSECUTIVE runs
# of the SAME build (GATE6_getParameter_REFUTED.md), so a single before/after pair cannot resolve
# anything smaller than roughly 1.6x. getParameter is far steadier (1411-1519 ms across two runs,
# ~4%), but "steadier" is a claim that needs its own samples.
# ★ Report a RANGE from repeated runs, never one number — that is what turned 286a4e6b from a
#   "5x improvement" into a refutation.
#
# Usage: bash GATE6_repeat_profile.sh <runs> [url]
set -u
RUNS="${1:-3}"
URL="${2:-https://dev--rawsurf.netlify.app/map}"
HERE="$(cd "$(dirname "$0")" && pwd)"
FRONTEND="$(cd "$HERE/../../../../frontend" && pwd)"

echo "### repeat profile: ${RUNS} runs against ${URL}"
echo -n "### deployed BUILD_VERSION: "
curl -s --max-time 30 "${URL%/map}/service-worker.js?cb=$(date +%s)" | grep -o "BUILD_VERSION = '[^']*'" | head -1
echo

cd "$FRONTEND" || exit 1
for i in $(seq 1 "$RUNS"); do
  echo "--- run $i/$RUNS ---"
  HEADED=1 node "$HERE/GATE6_cpu_profile.js" "$URL" 30 2>&1 \
    | grep -E "getParameter|getImageData|drawImage|WORKLOAD  delta|CPU profile:" \
    | sed 's/^/    /'
done
echo
echo "### Compare the getParameter column across runs, and against the pre-change range."
echo "### Pre-change (286a4e6b, 2 runs): 1411.2 ms / 4.50%  and  1519.1 ms / 4.92%"
echo "### A change is only real if the post-change RANGE clears the pre-change RANGE."
