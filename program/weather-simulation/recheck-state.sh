#!/usr/bin/env bash
# Raw Surf weather program — ONE-COMMAND STATE RECHECK
#
# Run this first thing in a new session. It answers, in order, every question a
# fresh context has to ask before it can safely act, and it never mutates anything.
#
#   bash program/weather-simulation/recheck-state.sh
#
# Read-only by construction: only `git fetch` (updates remote-tracking refs), reads,
# and GETs. No commits, no pushes, no deploys, no writes to the working tree.

set -uo pipefail
cd "$(git rev-parse --show-toplevel)" || exit 1

BACKEND="https://raw-surf-antigravity.onrender.com"
DEV_FE="https://dev--rawsurf.netlify.app"
PROD_FE="https://rawsurf.netlify.app"

hr() { printf '\n\033[1m== %s ==\033[0m\n' "$1"; }
sw() { curl -s --max-time 25 "$1/service-worker.js" | sed -n "s/.*BUILD_VERSION *= *'\([^']*\)'.*/\1/p" | head -1; }

hr "1. LOCAL STATE"
printf 'branch      : %s\n' "$(git rev-parse --abbrev-ref HEAD)"
printf 'HEAD        : %s\n' "$(git rev-parse --short HEAD)"
git fetch origin --quiet 2>/dev/null
printf 'origin/dev  : %s\n' "$(git rev-parse --short origin/dev)"
printf 'origin/main : %s\n' "$(git rev-parse --short origin/main)"
printf 'ahead/behind vs origin/dev (behind<TAB>ahead): %s\n' "$(git rev-list --left-right --count origin/dev...HEAD)"
echo "--- unpushed commits ---"
git log --oneline origin/dev..HEAD 2>/dev/null || true
echo "--- dirty files (forecast_cache JSONs are NOT ours: never stage) ---"
git status --porcelain=v1

hr "2. OTHER WORKTREES  (concurrent contexts share this tree and the dev branch)"
git worktree list

hr "3. WHAT IS ACTUALLY DEPLOYED  (a merge is not a deploy; date the artifact)"
printf 'dev  frontend : %s\n' "$(sw "$DEV_FE")"
printf 'prod frontend : %s   <-- pinned at 3bd38a83 since 2026-05-20 if unchanged\n' "$(sw "$PROD_FE")"
printf 'backend       : %s\n' "$(curl -s --max-time 40 "$BACKEND/api/health" | sed -n 's/.*"version":"\([^"]*\)".*/\1/p')"

hr "4. MAIN vs DEV"
printf 'commits main..dev : %s\n' "$(git rev-list --count origin/main..origin/dev)"
git merge-base --is-ancestor origin/main origin/dev \
  && echo 'fast-forwardable  : YES' || echo 'fast-forwardable  : NO (divergent)'

hr "5. OPEN PRs"
gh pr list --state open --json number,title,baseRefName,headRefName,headRefOid,mergeStateStatus \
  --jq '.[] | "#\(.number)  \(.headRefName) -> \(.baseRefName)  \(.headRefOid[0:8])  \(.mergeStateStatus)  \(.title[0:60])"' 2>/dev/null \
  || echo '(gh unavailable)'

hr "6. CI — last run per workflow that matters"
for w in "CI" "E2E Tests" "Marine Nightly (contract + zoomlab)" "Forecast Calibration Census" \
         "Sim Parity Monitor" "Forecast Accuracy Monitor"; do
  printf '%-38s %s\n' "$w" "$(gh run list --workflow="$w" --limit 1 \
    --json conclusion,headSha,createdAt --jq '.[0] | "\(.conclusion // "running")  \(.headSha[0:8])  \(.createdAt)"' 2>/dev/null)"
done

hr "7. LEDGER — where the program stands"
python_bin="$HOME/AppData/Local/Python/bin/python3.exe"
[ -x "$python_bin" ] || python_bin="python3"
"$python_bin" - <<'PY' 2>/dev/null || echo '(python unavailable - open COMPLETION_LEDGER_4.2.csv directly)'
import csv, collections
rows = list(csv.DictReader(open('program/weather-simulation/COMPLETION_LEDGER_4.2.csv', encoding='utf-8')))
c = collections.Counter(r['disposition'].split('_')[0] for r in rows)
print(f"{len(rows)} rows: " + "  ".join(f"{k}={v}" for k, v in sorted(c.items())))
print("\nBLOCKED ON YOU:")
for r in rows:
    if r['disposition'].startswith('BLOCKED_OWNER'):
        print(f"  {r['id']:<12} {r['owner_action'][:96]}")
print("\nREADY TO WORK NOW (no owner action needed):")
for r in rows:
    if r['disposition'] == 'OPEN_READY':
        print(f"  {r['id']:<12} {r['task'][:88]}")
PY

hr "8. THE HALO — proven fix, and how to re-verify it in 20 seconds"
cat <<'EOF'
Fixed 2026-08-16: `ocean-mask-buffer` was the painter. It is now OPT-IN ONLY.
  proof  : program/weather-simulation/LAYER_ORDER_PROOF_LOG.json  (entry LOP-0001)
  guard  : frontend/src/components/map/OceanMask.coastBuffer.test.js
  writeup: program/weather-simulation/evidence/HALO-ATTRIBUTED-ocean-mask-buffer-2026-08-16.md

Re-verify on any deployed build: open /map, enable Waves, then in the console
    map.getLayoutProperty('ocean-mask-buffer','visibility')     // expect "none"
DO NOT test with setLayoutProperty(...,'visibility','none') — it is silently
re-asserted by OceanMask.js on every sync tick. Use line-opacity instead.
EOF

hr "DONE — read program/weather-simulation/evidence/HANDOFF-2026-08-16-morning-resume.md next"
