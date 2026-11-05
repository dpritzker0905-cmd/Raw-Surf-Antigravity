# 2026-11-05 - claude - spot-hub phase 4 (#729): verify and ship

Owner's words (relayed): "ship #729" - merge #729 into `dev` only, and only if every check passes.

## Measured

- Branch `claude/spot-hub-charts` at `b4fe72f` already contained `origin/dev` `c0508521` (0 behind, no conflict).
- Hosted CI at `b4fe72f`: every check green. Guards lane "collected 3612 tests across 223 files -> 3545 passed",
  equal to the projection in ci.yml / `_FLOOR_SET_FROM` (3545). Frontend: suites 640/640, tests 8327/8327, failed 0.
- Visual check of the real production build against an offline mock (never the live box): 34 scenarios, all pass;
  evidence and harness in `evidence/spot-hub-phase4/`.
- Local `CI=true npx react-scripts test --watchAll=false src/components src/tests`: 526/527 suites;
  the one failure is `map/marineHeightEncoding.test.js` (texture byte hashes), identical with and without this
  session's change and identical to dev's file; this sandbox runs Node 22 while the repo pins 24.22.1, and hosted CI
  (Node 24) passes it. Environmental, not #729.
- `node scripts/check_eslint.js`: no rule over baseline. `backend/tests/test_spot_series_serve.py`: 22 passed
  (local Python 3.13, not the declared 3.12; hosted CI is the authority).

## Found and fixed (within #729's scope)

1. Home / a tap could not select the first bar (the frame covering "now" maps to hour 0, whose nearest bar is the
   next one, so the two-way hour sync bounced it). Fixed in `SpotForecastChart.useSelection`; +1 test.
2. The infobox readout truncated the rating word ("Poor t..."): colour was the only visible carrier. Now wraps.

Frontend floor 7093 -> 7094 (+1 test). No served number changes (no SCOREBOARD row: display-only fixes).

## Not from #729 (left alone)

- Radix "`DialogContent` requires a `DialogTitle`" console error on the map page; fires with the kill switch on too.
