> ⚠️ **SUPERSEDED AS A QUEUE by `START-HERE-2026-08-01-THE-ONE-QUEUE.md`** — that file is the
> single entry point and merges this one's open items (IDs unchanged). **This document stays as
> the FORENSIC RECORD**: open it for the measurements behind an item, not for what to do next.

# START HERE — 2026-08-01 · the marine DIRECTION arc, and what is still open

**Read [[standing-work-rules-user-mandate]] FIRST — it gained a BIGGER-CONTEXT PROTOCOL on
2026-07-31 (rules 9-13) written from a night of self-inflicted rework. Then the spine
(`THE-SURF-FORECAST-SCIENCE-canonical-chain.md`) and
`THE-SURFER-FACING-ANIMATION-onshore-energy-science.md` (the owner's acceptance rule).**
This supersedes `START-HERE-2026-07-31-the-machine-is-running.md` for the direction work; that
doc's §0 checklist and §2 geometry queue are still valid and reproduced below.

Branch `dev` == `origin/dev` == `6cb252e9`. Backend suite 1,601 green. Frontend marine 333 green.
LOC ratchet clean.

---

## 0. ⛔⛔ THE OWNER'S ACCEPTANCE RULE — EVERYTHING BELOW SERVES THIS
> *"we need the logic to work for surfers on a coastline receiving surf, a surfer finds waves
> moving AWAY from a coastline useless for them in the water"*

**Animate the train with the greatest ONSHORE ENERGY FLUX, `P·cos(Δθ)` with offshore trains
excluded — NOT the biggest train.** `P = (1/8)ρgH²·c_g`, `c_g ≈ gT/4π`. Ranking on H² alone (what
every current path does) over-weights short-period chop: **c_g is 5× larger at 14 s than at 4 s.**
Full derivation, live numbers and sources:
`memory/THE-SURFER-FACING-ANIMATION-onshore-energy-science.md`.

## 1. ⛔ THE #1 OPEN ITEM — THE WAVES ARROW STILL DISAGREES WITH THE INFOBOX
**NOT FIXED. This is the user's original report and it is still true.** Measured at Cocoa:

    tier          when            defect
    global_mid 2° span >~2.8°     waves arrow 165.4° off the marker — the SERVER itself.
                                  Block is windsea-dominated (281°, moving OFFSHORE); the beach
                                  cell is swell-dominated (87°, arriving).
    regional .25° z7+             direction EXACT vs marker (0.0°) ✓
    client        z7–z8.74        server is right at z7; the ENGINE holds a stale world grid
                                  until ~8.74 (the "instant cache-hit commit" class)

⚠️⚠️ **PREREQUISITE, and it is OURS:** `WAVES_ANIM_DOMINANT_SWELL=1` (repo VARIABLE ⇒ both ingest
lanes + Render) is dark because §5i needs `availFrac ≥ 0.95` and products report **FL 0.6449 /
world 0.9067**. Measured against upstream the same hour: **florida_east 39/39 and nw_atlantic
480/480 = 1.0000.** ⇒ **upstream has FULL coverage; we lose ~35% between fetch and stamped
product.** ⛔ **FIND THAT LOSS BEFORE TOUCHING THE THRESHOLD** — lowering it stamps a
half-populated field and paints the exact seam §5i exists to prevent.
⚠️ `WAVES_ANIM_DOMINANT_SWELL` is **absent from `_RATING_FLAGS`** ⇒ invisible to the lane-parity
guard. Register it.

**Order of work:** (a) find the partition-availability loss · (b) change the ranking at the
`dominant_swell_anim` hook from "biggest swell" to onshore-energy-flux, degrading to total-field
where `shore_normal_deg is None` · (c) re-measure with the ladder · (d) ingest cycle · (e) confirm
on the user's screen BEFORE claiming anything.

## 2. ✅ WHAT SHIPPED 2026-07-31 (and what it does NOT do)
* `7502cc4b` partitions reach the RATING at all 3 surfaces + infobox. Flag OFF. A/B: **LEVEL moves
  on 50% of spot-hours** ⇒ the flip is an owner decision, 3 lanes together.
* `81c7bcb5` **the swell layers were INVENTING trains** (swell_2 = total×0.35 rotated +40°;
  **ECMWF publishes no partition at all ⇒ every EURO swell number was fiction**), and one native
  point laundered the whole product. Gated OFF. ⛔ **Does NOT touch the arrow** — proven: the
  arrow's cell is 153.3° from the fabrication signature.
* `61426e3f`+`6cb252e9` **the Canaveral vortex** ("small low pressure type wave center", z8.2).
  Third occurrence; it MOVED to a tier the guard cannot see (`isMagnifiedCoarseField` bails on
  `cellDeg < 1.0`). `resolveFineSeamFloor` (0.5 ≈ cull past ~120°) now covers fine tiles.
  Live-verified: legacy gate `engaged=false` while the new floor reads 0.5.
* Instruments — **the real deliverable, because the class recurred for want of one:**
  `frontend/scripts/probe_marine_direction_ladder.js` (direction ∝ zoom; **independently derived
  the user's z=8.74**) · `probe_vortex_visual_ab.js` (video + burst A/B) ·
  `backend/scripts/block_direction_disagreement.py` · `layer_tier_divergence.py` ·
  `marine_layer_identity_audit.py` · `partitions_rating_ab.py`.
  ⚠️⚠️ **RUN LADDERS ON PORT 3009, NEVER 3001** — 3001 is the preview pane's server and driving a
  headless ladder against it wedged the renderer unrecoverably.

## 3. THE MATRIX (ladder, Cocoa; converge = first rung within 30° that STAYS within)
| model | waves | swell_1 | swell_2 | wind_waves |
|---|---|---|---|---|
| GFS | z=8.74 | NEVER | NEVER | z=4 ✓ |
| EURO | z=8 | NEVER | NEVER | z=4 ✓ |
| ICON | z=4 ✓ | z=4 ✓ | NEVER | z=4 ✓ |
★ `wind_waves` converges at z=4 on ALL models and ICON `waves` too ⇒ **the 2° tier fails only on
intra-block BIMODALITY, not coarseness.** ⚠️⚠️ **For SWELL the ARROW is right and the MARKER was
wrong** (z10 grid 87.6 vs upstream 89; marker 136.6 on the stale pilot tile) — **do NOT "fix" the
arrow toward the marker.**

## 3b. ★ HOW SURFERS ACTUALLY USE THIS (researched 2026-07-31) — the product target
**The workflow is STORM → SWELL → SPOT.** Surfers use the field to see where energy is generated
and how it propagates, decompose what is arriving at a point, then decide at the spot.
[Surfline](https://support.surfline.com/hc/en-us/articles/16345467668763-Surfline-Charts-map-of-wave-height-period-wind-and-swell-components)
(the market leader) implements that as THREE TIERS, and ours map onto it:

| tier | Surfline | ours | gap |
|---|---|---|---|
| FIELD | Wave Height + **Wave Period** layers; Wind layer to see where waves are GENERATED | the 4 marine toggles | ⛔ **we have NO period layer** |
| POINT | click → tooltip showing **individual swell components** + wind | the infobox | ⚠️ shows a total, not components |
| SURF | spot page: BREAKING height, explicitly distinct from swell | spot glyphs + hub | ✅ we have this (`surf_height_m`) |

★★★ **"Swell energy — a combination of both wave size AND period — can be the most useful guide to
how powerful the surf is likely to be"** ([LaPoint](https://www.lapointcamps.com/blog/how-to-read-surf-forecast/),
[Surfer](https://www.surfer.com/how-to/how-to-read-a-surf-forecast)). ⇒ the ENERGY-FLUX ranking in
§0 is not our invention — it is how the domain already reasons. **Ranking on height alone is the
outlier, not the standard.**
★ Surfers filter on **period ≥ 10 s** as the quality threshold, and match direction against the
COASTLINE ORIENTATION by hand — which is exactly the shore-normal projection we already compute.
★ Surfline separates **"swell" (offshore) from "surf" (breaking at the spot)** as distinct
vocabulary; our `surf_height_m` vs `point.speed` split already honours that — **keep it explicit
in the UI** (the hub once served offshore-as-surf, wrong by up to +92.7%).

**Product implications, in priority order:**
1. **Add a PERIOD layer** — first-class at the market leader, absent here, and it is the single
   field that separates a rideable groundswell from chop at the same height.
2. **Make the infobox decompose** — show the individual trains (h / T / dir per partition) the way
   the point tooltip does, instead of one blended number. The data already rides on the response
   (`response.partitions`, 2026-07-30).
3. **Say which train the animation is showing** — with onshore ranking the arrow is a CHOICE; name it.
4. Keep total HEIGHT on the Waves layer (industry-standard, comparable across sources); change only
   the DIRECTION ranking.

## 4. ⛔ THE REST OF THE QUEUE (carried forward, still valid)
1. **Geometry wiring** — `geometry_reject_reason` backfill FIRST (script written and committed,
   `backend/scripts/backfill_geometry_reject_reasons.py`, **never run**; 413 rows, mostly
   gate-REJECTED, a naive reconcile burns 413×22 s reproducing rejections) → reconcile job
   (direct SQL; REST PATCH is 403 by RLS) → overlay rehydrate at serve-box boot.
2. **Climatology → gonogo → `RATING_LOCAL_SIZE`** (`scripts/local_size_gonogo.py`; owner flips).
3. **Skill verdict** (~2 wks of `forecast_skill`) → gate for the **4,000+ spot expansion**.
4. **Kr + H1/10 TOGETHER** (never separately — they cancel at 0.988×).
5. `SURF_PARTITIONS` flip — measured cost + A/B in hand; **3 lanes together**, owner decision.
6. **Per-partition `dir_confidence`** shipped for GFS; DWD/Copernicus fetchers still export it
   only for `wave_direction`.

## 5. ★ TRAPS LEARNED 2026-07-31 (do not re-learn)
* **A green suite is evidence about CODE, never about the SYSTEM.** Answer all three before saying
  "fixed": deployed? artifact REBUILT? does it change the SPECIFIC thing the user sees?
* **Products carry `run_time` but NO builder SHA** ⇒ "is my fix live?" is unanswerable from the
  API. Ingest cron `15 */4` with 1.3–2.4 h drift; Render auto-deploys dev but only SERVES L2.
* **A killed overnight task looks exactly like a missed one** — check `LastTaskResult`
  (3221225786 = Ctrl-C). Both tasks had `StopIfGoingOnBatteries=True`; fixed, but
  `install_*_schedule.ps1` still creates them that way.
* **Four fix hypotheses died to measurement**, each after being partly built — see the hypothesis
  ledger in `memory/direction-ladder-the-instrument-that-was-missing-2026-07-31.md`. Test the
  hypothesis against the FAILING INSTANCE before building.
