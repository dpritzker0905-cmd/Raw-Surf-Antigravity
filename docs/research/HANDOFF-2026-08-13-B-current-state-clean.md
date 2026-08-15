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


---

## ⚠️ ADDENDUM 2026-08-14 — TWO LIVE CI ITEMS, BOTH DIAGNOSED, NEITHER MINE, NEITHER FIXED

Both are in the concurrent session's active lanes (`c1566c8b` landed while I was reading them), so
they are **located and handed over** rather than edited. ★ Touching a floor or an exit-code contract
someone may be mid-raise on is exactly how the 08-12 provenance collisions happened.

### 1. `Forecast Calibration Census` pages a CALIBRATION BREACH on an upstream 503
Run 31788912652: `surf_spots (offset 0): HTTP 503 …` then
`::error::The size climatology FAILED its named exemplars … Every rating is graded against this.`
**Nothing was fetched.** Mechanism, exact:
- `local_size_gonogo.py::_get_json` → `raise SystemExit(f"…HTTP {code}…")` on non-200.
  **`SystemExit` with a STRING exits with code 1** — the NO-GO code.
- `forecast-calibration-census.yml` already branches `rc >= 2` → *"the go/no-go script itself failed
  — this is NOT a calibration verdict"*; the `else` branch is the exemplar page.
⇒ **Both sides are individually correct; the exit code does not carry the distinction.**
▶ **One-line fix:** make that non-200 path exit **2**. No new machinery — the crash branch exists.
★ The same file's docstring already guards the sibling TRUNCATION form (*"a round number in a row
count is a truncation tell"*). The **failure** form was not guarded.

### 2. `backend-estate-coverage` — a floor OVER-raise nothing catches
`only 388 passed, floor is 396 — mass-skip or deletion`.
- `ci_floor_staleness.py` is **deliberately one-sided** (a floor above the reading is correct right
  after a raise) → reports "every floor is current" at 396 vs 360.
- The lane's own assertion fires only **after** the raise ships.
- `check_floor_before_push.py` fires only when tests are **ADDED** without a floor move.
⇒ **Three guards, one uncovered direction: nobody catches an over-raise when it is made.**
⚠️ **388 vs 396 does not say WHICH** — tests removed/moved (lower the floor) or tests skipping
(floor right, collection wrong). The message names both; the fixes are opposite.
▶ Discriminator: `git log -S "def test_"` on the estate lane's files vs the run's skip count.
⛔ **RETRACTED — I READ CI.YML COMMENTS AS RUN OUTPUT.** I claimed the discriminator was
resolved ("identical 2864 skips ⇒ 10 tests LEFT the lane"). Both figures — `398 passed,
2864 skipped` and `382 passed, 2864 skipped` — are **COMMENT LINES in `ci.yml` (989, 993)**,
the author's record of past measurements. The matching 2864 is one comment quoting a number
and another quoting the same number, **not two observations agreeing.**
★ Sixth mis-identification this session, and the second where a COMMENT was read as a READING —
against my own rule *never take a number from a docstring, measure it*.

**What actually survives:** `388 passed, floor 396` and `0 silent` (this run, real) · **7 backend
test files ADDED, none deleted or renamed in 24h** (`git log --diff-filter=ADR`, real).
Additions with no deletions makes "tests left the lane" LESS likely, not more.
▶ **STILL UNDETERMINED.** The honest discriminator is this run's own pytest summary line
(passed/skipped for the estate invocation) compared against a GREEN run's — neither of which
I extracted. Do not act on the floor until one of those is read.

~~DISCRIMINATOR RESOLVED (superseded)~~: The run log carries
the floor's own derivation and the current reading:
  `398 passed, 2864 skipped` in 3:29; 398 - 2 = 396.   ← how the floor was set
  `388 passed, floor is 396`                            ← now
**The skip count is IDENTICAL (2864) in both.** ⇒ the 398→388 drop is **NOT new skips** —
**10 tests left the lane**. That is the removed/moved branch: the floor should come down,
the collection is not broken. Also `0 silent`, so no selected file failed to report.
⚠️ **BUT DO NOT LOWER ESTATE ALONE.** `guards` is over-raised too (`MIN_PASSED 1735 vs
1720 observed`). Two lanes above their observations at once looks systematic — and estate
is a **COMPLEMENT**, so tests moving INTO guards should have RAISED guards' reading, not
lowered it. Reconcile both lanes together, or a genuine loss gets masked by a floor cut.

★ **`Precompute Spot Ratings` self-heals** — failed 08:47Z (1m40s), the next scheduled run
succeeded 12:26Z (45m57s, full). **A single failed cron here is not a signal; check the next run.**
