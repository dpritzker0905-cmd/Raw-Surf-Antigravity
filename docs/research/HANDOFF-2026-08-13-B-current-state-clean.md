# Handoff 2026-08-13 (B) — current state, clean

**Supersedes `HANDOFF-2026-08-13-the-map-layer-arc-and-a-self-audit.md`**, which is now a layered
document (its lead section is marked superseded). That file is still worth reading for the
**self-audit** and the **method**; this one is the current truth.

**State:** tip `29a22c8a` · CI **22 pass / 0 fail** (2 pending) · dev live deployed at `29a22c8a` ·
38 commits on `dev` today (mine + the concurrent session's) · nothing uncommitted of mine
(`backend/uploads/forecast_cache/*.json` were already modified when the session began).

---

## ✅ CLOSED TODAY

| what | outcome |
|---|---|
| **Water temp blank on every model** | **FIXED** `0f13fa7d` — colour-scale KEY did not exist; owner-confirmed pixels; verified in 2 environments |
| **Weather field blank at the zoom floor** | **FIXED by the concurrent session** — layer ORDER, not the tile pipeline (`e88b0f68`, `f3fe2c85`, `d21b7cd9`); root cause `40b47946` |
| **`isModelMatch` one-sided normalisation** | **FIXED** `06bf431f` (real defect; my probe measured it, but it was *not* what blanked the field) |
| **Local backend could not start** | **FIXED** `7b74ae96` — `launch.json` pointed at the broken Windows python |
| **5 CI reds** | each traced to root cause; the floor trap fixed at the CLASS level (`d4c4f5d3`) + a pre-push hook (`c40b7fff`) |

### The two root causes, stated once
1. **Water temp:** the layer requests `variable=surface_temperature`; decode produced **4,718,592
   real values (−53.95…+38.75 °C)**; colourisation found **no scale under that key** and emitted
   transparent tiles. `LayerRegistry` moved the DATA (because `sea_surface_temperature` is not
   CDN-hosted) and **the SCALE kept the old name**.
   ⭐⭐ **A lookup miss that returns "nothing to draw" is indistinguishable from "nothing to show."**
   ⇒ **Blank render + green upstream ⇒ diff the NAME KEYS first.**
2. **Zoom floor:** `water_temp` sat at layer idx 5 while basemap `water` (11) and `water-shadow`
   (17) rendered **above** it — the field painted and the ocean covered it.
   ⭐⭐ **It looked zoom-related ONLY because `styledata` fires on zoom.**
   ⇒ **A zoom correlation in this UI is nearly worthless.** ⇒ **Blank field that decodes fine ⇒
   read `getStyle().layers` INDICES first** (field vs `water` vs `ocean-mask-fill`).
   ⛔ **Fifth occurrence of one class** in the owner's ledger (07-11 lakes · coast buffer · green
   landuse · 07-17 inland repaints · 08-13 basemap water).

---

## 🛠 GUARDS AND INSTRUMENTS SHIPPED (all mutation-tested)

- **`layerColorScaleCoverage.test.js`** — every raster **and marine** layer's variable must resolve
  to a colour scale. Remove the alias → it reports `water_temp -> surface_temperature`.
  ⚠️ It **false-positived on its first run** (`temperature_2m`, a working layer): the library strips
  **level suffixes** before lookup, so the rule is calibrated against two observed outcomes with a
  control pinning both. **Verify a new test's FAILURE against production before trusting it.**
- **`omUrlTrace.js`** (+ `traceOmBlock`) — the only non-second-hand view of the om protocol
  (`__RASTER_PROBE__` never fires there, fetches are off-thread, `getStyle()` reports `tiles: []`
  for sources that ARE serving). Its docstring leads with the trap that misled me.
- **Pre-push floor hook** — caught its own author on the commit that added its tests; fails OPEN
  (shared tree); 1200 → 424 ms; warns that `core.hooksPath` would silently disable the LOC guard.

**LOC:** `openMeteoProtocol.js` is grandfathered **shrink-only at 943** and is still exactly 943 —
probes folded into existing `return` expressions, comments condensed with all facts retained.

---

## ⚠️ OPEN

- **`water-shadow` (LEAD, unverified, occlusion owner's area).** `configureWaterTransparency` sets
  opacity on `water` **only**; `water-shadow` appears in `map/*.js` solely in comments and tests,
  yet `waterTempAnchor.js` lists it as an occluder. The `planAnchorMoves` refusal *does* account for
  it, so the guard is sound. **One live check at the zoom floor settles it** — snippet in
  handoff (A)'s final section. May be a non-issue if it is low-opacity or a coastal edge.
- **`SURF_TIDE_DEPTH`** — owner call, now evidence not a guess: 6 samples, 5 nulls, harness proven
  able to see a 38.1-pt move. Sample 2 (8 rows / 3.2 pts) unexplained; every hypothesis tested and
  failed.
- **Geometry coverage** — **44.0% of 1,052 sampled spots degraded, 17 blind.** ⚠️ Quote as "of
  1,052 sampled spots", never "the estate" (4 of 6 regions hit the `limit=200` cap).
- **Blind geometry undisclosed** — 15 of 17 blind spots report `confidence: medium`, identical to
  full-geometry spots; the only signal is a **missing word** in `why`.
- **Recurring non-attaching map state** — `styleLoaded` never true, 0 slot sources, layer activation
  yields 0 protocol calls; clears on its own schedule. **It blocks measurement**, and I twice
  mistook it for the bug under investigation.
- **Unchanged owner items** — three dark frontend flags · `BRAIN_RULES.md` committed API key ·
  radar legend (needs the external RainViewer scheme-7 spec).

---

## ⛔ THE ONE THING TO CARRY FORWARD

**I was the defect more often than the code was.** Nine hypotheses died; seven claims were published
before testing; **five** were the same shape — *I measured a transient or a correlation and called
it a cause* (tile trace mid-zoom ×2, page mid-deploy, layer census mid-style-load, and finally
zoom-correlation-as-mechanism).

⇒ **Before reading map state, assert it is SETTLED** (`isStyleLoaded()`, stable zoom/bounds), then
read **once**. For a tile trace: hold the view, clear the trace, toggle the layer, then read.
⇒ **Console residue is a confound** — re-test on a clean page before reporting anything found in a
tab you have been poking.
⇒ **Assert the match count before `str.replace`** in any edit script — that guard prevented four
half-applied edits today.

★ And the miss that cost the most: **I spent the day in the tile-fetch pipeline for a bug that lived
in paint order, one array-index read away — while the class was already recorded five times in the
owner's ledger and I never opened it.** Check the defect index for the DOMAIN, not just for guards.
