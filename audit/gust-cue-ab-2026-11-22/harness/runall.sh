#!/bin/bash
# Every arm, one fresh browser each; one line per session. Needs: the synthetic backend on PORT (serve_synthetic.py
# --models GFS --layers waves,wind --dynamic 1), the dev SPA on AB_BASE, REACT_APP_SUPABASE_URL set for the SPA (public frame CDN).
#   OUT=<scratch dir> REPO=<repo root> bash runall.sh      (CUES="hatch" to run one cue)
H="$(cd "$(dirname "$0")" && pwd)"
export AB_LIB="${REPO:?set REPO}/frontend/scripts/offline-backend/ab_lib.js" AB_BASE=${AB_BASE:-http://localhost:3000} PORT=${PORT:-4100} FRAMES=${FRAMES:-150} EVERY=${EVERY:-2}
for view in desktop phone; do for theme in dark light beach; do for cue in ${CUES:-none flicker width hatch}; do
  d="${OUT:?set OUT}/ab/$view-$theme-$cue"; mkdir -p "$d"
  timeout 400 node "$H/gustcue.js" "$d" $cue $theme $view > "$d.log" 2>&1
  echo "$view $theme $cue exit=$? $(grep -c fail "$d/meta.json" 2>/dev/null)"
done; done; done
echo ALLDONE
