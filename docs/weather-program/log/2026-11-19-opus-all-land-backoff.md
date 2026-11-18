# 2026-11-18/19: the all-land re-drive capped, and the lab's land mask fixed (Opus, Move 3; the director's small PR)

## 23:58Z: registration (committed alone, before any code)

**Defect (found 2026-11-18, log 2026-11-18-opus-phone-trace-and-box-check.md):** when the committed grid for a view is ALL ZERO (the view is
all land), the WebGL layer correctly refuses it (`renderBlockedReason: "all_zero_grid"`), the engine stays empty, and the render backstop in
`useMarineScrubSettle` re-drives the settle check every 6 s (3 s idle + a 6 s minimum gap) for as long as the view stays put. Each re-drive
can commit from the series cache or, on a miss, fetch `/grid` from the 1-CPU box.

**Change:** for the engine-empty backstop ONLY when the render diagnostics say the committed grid is all zero, re-drive with exponential
backoff (6, 12, 24, 48, 96 s) and STOP after 5 re-drives for the same episode (model, layer, hour, view at 0.5 deg); any change of episode
re-arms. A cold load (engine empty for any other reason) keeps today's cadence untouched. Kill: `window.__RAW_DISABLE_ALL_LAND_BACKOFF__`.

**Gates (all must pass; ON by default only if they do):**
- **L1, unit (Jest):** with an all-zero grid at a fixed view, re-drives fire at 6/12/24/48/96 s and then never; a view, hour, model or layer
  change re-arms; an empty engine that is NOT all-zero keeps the 6 s cadence; the kill restores today's behaviour; mutants that drop the
  stop, the backoff, the all-zero condition or the kill fail.
- **L2, lab:** an inland view (Kansas, (-98, 38), z8, desktop), idle 5 minutes after Waves on: ON makes <= 5 re-drives and no more
  `/grid` + `/grid_series` requests than KILL; KILL is today's (expected ~45 re-drives). Offline only.
- **L3, no harm:** the census load-void rule applies to L2; the existing Jest trees pass.

**The lab fix (no gate; a fixture correction):** `serve_synthetic.py` `LAND_BOXES` marks lon -125..-70, lat 25..60 as land, so the whole US
Atlantic and Gulf coasts, Florida's east coast included, are land in the lab. Water cuts along the US Atlantic and Gulf coasts make
coastal views behave like reality. LESSONS gets the rule: check the lab fixture against reality before calling a defect.
