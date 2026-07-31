# HANDOFF 2026-07-31 LATE — the infobox shows a DIFFERENT QUANTITY, and five false positives

**Queue: `START-HERE-2026-08-01-THE-ONE-QUEUE.md` is the single entry point.** This doc is the
forensic record for tonight. Read `memory/standing-work-rules-user-mandate.md` (rules 9-15) first.

Branch `dev`. Backend suite 1,664 green. All work pushed.

---

## 1. ⭐⭐⭐ THE INFOBOX — FORENSIC, FROM SOURCE, NOT A HYPOTHESIS

User: *"The infobox wave direction is definitely inaccurate… Windy claims 1ft 9sec out of the E for
GFS, which seems accurate in the animations, just not infobox. After toggling to wind, then back to
GFS the infobox corrected itself and now shows 1.3ft at 9.6s out of the east."*

**`MapForecastOverlay.js:253`**
```js
const waveHeight = isExactPointAuthority
  ? (useExactPoint?.wave_height ?? sampledWaves?.value ?? marineGridSample?.value ?? …)
```
**`MapForecastOverlay.js:405`**
```js
computeSurfRating(useExactPoint?.surf_height_m, …)     // the rating badge
```

★★★ **IN THE SAME BOX: the displayed HEIGHT is `wave_height` (OFFSHORE significant wave height);
the RATING BADGE is computed from `surf_height_m` (the nearshore BREAKING height).** Two different
physical quantities, same units, nothing in the UI distinguishing them.

Measured at Cocoa the same hour:

    offshore Hs   0.3914 m = 1.28 ft   Tp 9.62 s   from 89.32°   ← what the infobox displays
    breaking      0.625 m  = 2.05 ft                             ← what the badge grades

⇒ the user's "1.3 ft" is **1.28 ft offshore**, and it agrees with Windy **because Windy also shows
offshore**. Neither is "wrong"; they are answering a different question than a surfer asks.
This is the CLAUDE.md cardinal distinction (`point.speed` is OFFSHORE; the hub shipped it as surf
height for months, wrong by up to +92.7%) surviving at a surface nobody re-checked.

### And the SECOND mechanism — why the toggle "fixed" it
The same expression falls back to `sampledWaves?.value ?? marineGridSample?.value` whenever
`isExactPointAuthority` is false — i.e. **it samples the RENDERED GRID**. The console proves that
grid is coarse first and sharpens after:

    [Marine] Render backstop: regional_too_coarse grid at zoomed-in viewport + idle ≥3s — re-driving
    [SCRUB-SETTLE] Sharpening regional_too_coarse grid: committing covering regional series frame
    engine after:  11x13 @ cellDeg 0.227, lane=series_sharpen, tier=fine

Toggling to Wind and back forced the point response to load and become authoritative.
⇒ **`isExactPointAuthority` is the Jacobian variable**: it decides whether the box shows a point-lane
number or a coarse grid sample.

⛔ **NOT FIXED.** Two candidate changes, both product decisions: (a) LABEL the displayed height as
offshore swell (Surfline's own vocabulary: "swell" vs "surf"), or show `surf_height_m` there; and
(b) make the grid-sample fallback re-read when the sharpen lands, or refuse to show a number while
`isExactPointAuthority` is false.

## 2. ⚠️⚠️ FIVE FALSE POSITIVES ON "MARINE IS COVERING LAND" — the measurement lesson of the night

Marine measured **CLEAN**: per-pixel co-registered, real GPU, ~2.9 M px/rung —
**FL z6-11 land painted 0.000-0.007%; Bahamas/Cuba z4-10 0.000-0.030%; longest contiguous land run
0-2 px** (= coastline antialiasing). The 2026-07-24 geofence root is still fixed (`minzoom:10`).

Five instruments said otherwise first. Each is now encoded in `frontend/scripts/probe_land_bleed.js`:
1. **downscaled screenshot** — 1774 px of sparse crest in an 800 px image reads as a solid wash
2. **1-pixel probe** — sparse streaks, samples between them, reports clean regardless
3. **block scan classified by its CENTRE** — at z6 a 32 px block ≈ 48 km; on a thin cay it is mostly
   ocean. **This invented 50.6% (Cuba) and 58.2% (Andros).**
4. ★ **`probeMaskGPU` IS NOT THE AUTHORITY ON WHAT PAINTED** — it reads the RESIDENT mask
   (~1.7 km/px) while `_drawCoarseBasePass` binds the WORLD grid's own ~39 km mask.
5. **colour is not specific to marine** — green-dominant matches basemap **PARKLAND**.
★★ **VALIDITY GATE:** bleeding onto land implies painting water MORE, so `waterPainted ≈ 0` proves
the measurement is **VOID**, not clean. The probe exits 2. ⛔ Real GPU only — headless swiftshader
reported water 0.0% and land 3.1% simultaneously.

## 3. ✅ THE RATING TOGGLE IS A TIER LEVER (`159fd567`) — the user's observation, quantified
User: *"when I turn the surf rating band on, the wave animations seem to flow better… in terms of
direction."* `probe_rating_direction_ab.js` (animated easeTo+panBy, burst THROUGH the gesture,
video, + engine direction on a 4×4 lattice):

    z8  rating OFF   grid  5x5   cellDeg 1.600  tier mid    ⇒ offshore field a UNIFORM 27.9°
    z8  rating ON    grid 17x17  cellDeg 0.235  tier fine   ⇒ ~89°, matches the point lane (89.3)
        median Δdir 63.3°, max 152.7° over 16 points.  z7 and z9 agree EXACTLY.

⇒ the rating band needs coastal resolution so it pulls the 0.235° tile; without it the layer settles
for a degenerate 5×5. ★★ **This explains the direction ladder's own result** — `arrow=27.9
marker=89.0, NEVER converges` — **27.9° IS the rating-OFF uniform value and the ladder runs
rating-OFF.** Re-run every direction ladder in BOTH rating states before concluding about tiers.

## 4. ⭐⭐ THE SCIENCE THE OWNER PUSHED ON — and the blocker it exposed
Owner: *"a surfer can't ride waves moving toward the ocean… if there's a rideable 1-2 ft wave, the
energy flowing toward shore is what's accurate, above a windswell moving the other way."*

Live at Bethune (1.82 ft — the rideable case), all trains onshore:

    train        h      T      from    c_g     P (W/m)   cos(Δθ)   ONSHORE flux
    swell 2     0.12   7.09s   55°    5.53      103.5     0.999      103.4  ← greatest
    wind waves  0.22   4.04s  119°    3.15      185.6     0.483       89.7  ← TALLEST
★ **height-ranking and onshore-flux-ranking pick DIFFERENT trains on an ordinary day.**

⛔⛔ **BUT THE INPUT IS NOT TRUSTWORTHY YET.** `T_total` EXCEEDS every partition's period at **5 of 6**
FL sites (Bethune 9.60 vs 7.87; Cocoa 9.62 vs 8.05; Sebastian 8.10 vs 8.10 ✓ the only consistent
one). A sea's peak period must BE one of its partitions' peaks. **`partitions_represent` tests HEIGHT
quadrature only — all five broken sites score 0.73-0.89 and pass, and the one consistent site passes
identically.** ⇒ **add a PERIOD-representation check BEFORE the onshore-flux flip**; the ranking is
first-order in T (`c_g = gT/4π`).

## 5. ⭐⭐ OWNER GROUND TRUTH CROSS-VALIDATES `break_depth_m` — first human check of that asset
Owner: *"more swell at Cocoa than Volusia; the sandbar is shallower at Cocoa than Satellite or south
Brevard."* Both hold:

    served breaking   Cocoa 2.05 ft > Bethune 1.82 > New Smyrna 1.72     ✓
    ETOPO break depth Cocoa Pier 5.9 < Cocoa 6.3 < Satellite 6.9 < Indialantic 7.3 < Sebastian 8.4 m  ✓ monotonic

⚠️ Playalinda and New Smyrna have NO break depth (coarse normal) ⇒ the cap cannot bind.
⚠️⚠️ **LEAD:** Sebastian Inlet reads the LARGEST breaking height from the SMALLEST offshore Hs,
SHORTEST Tp and DEEPEST bar (×2.19 amplification vs Cocoa's ×1.60). Suspect a sub-grid MAGNET on a
marquee spot — probe `magnet_factor`/`magnet_name` before trusting Sebastian.

## 6. ✅ ERA5 (`3ae53a5e`) — banked nothing until the last spot, and a second run was scheduled
15.1 h wall / 610 s CPU for 150 spots (CDS queueing ≈ 6 min/spot, ~7× the research estimate). It
uploaded ONE inbox batch at the END ⇒ "92% complete" was worth 0%. Now checkpoints every 10 spots.
The 21:30 scheduled task would have started a SECOND concurrent campaign (the running one had banked
nothing, so the resume filter could not see it) ⇒ a process-scan guard, verified live against pid
71096. ★ A LOCK FILE would not have caught it — the run in flight predates the guard.
⚠️⚠️ **I called it HUNG on two identical samples and was wrong** — the third caught it moving.
**Two samples of a blocked process are indistinguishable from a hang.**

---

## ⛔ THE QUEUE — nothing here is lost
**Authority: `START-HERE-2026-08-01-THE-ONE-QUEUE.md`.** New/changed tonight:

* **#12 HAWAII WIND PRODUCT BUILT FROM A 75-HOUR-OLD RUN** — ⚠️ **SPAWNED TASK `task_98ed9f35`,
  still open, do not lose it.** `gfs_wind_wind_hawaii` run `2026-07-28T14:40Z` while every other
  region is 3-9.5 h, and its `valid_time` is CURRENT so nothing flags it. North Shore ratings score
  wind from a 3-day-old forecast; wind is 0.60 of the quality blend AND a multiplicative veto.
  ★ `timeline_slot_census --fail-on-dead` checks `valid_time` COVERAGE, not RUN AGE — give it one.
  Sweep run-age per (domain, region) first; there may be more than Hawaii.
* **#17 NEW — the infobox quantity + the grid-sample fallback** (§1). Product decision.
* **#18 NEW — period-representation check on partitions** (§4). **Prerequisite to #7's fix.**
* **#19 NEW — Sebastian Inlet over-amplification lead** (§5).
* **#7** direction: now known to be partly a RATING-MODE artifact (§3) — re-measure in both states.
* **#11** the halo: the mask-coverage instrument exists and caught the shrink (`z8.18→8.03 mask
  360°→8°`); the no-shrink guard is still NOT ported to the mask lane.
* Unchanged: #1 geometry wiring · #2 climatology→gonogo · #3 skill verdict · #4 Kr+H1/10 TOGETHER ·
  #5 SURF_PARTITIONS flip · #6 dir_confidence · #8 stale grid · #9 period layer · #10 infobox
  decomposition · #13 obs-gate asymmetry · #14 parity guard blind to post-`rating_score` steps.

## ★ METHOD NOTES
1. ★★★ **An instrument that has not been RUN is a claim, not evidence.** Running the new ladder found
   two defects in the ladder; running the land-bleed probe found three more in itself.
2. ★★★ **When a measurement and an impression disagree, suspect the measurement first** — five times
   tonight the impression was right about *something being off* and every number I reached for was
   measuring the wrong thing.
3. ★★ **Refuse rather than answer.** Both new probes now VOID themselves when their preconditions
   fail (`waterPainted≈0`; the rating toggle's label not changing).
4. ★★ **Never run the full suite in the background while editing source** — `inspect.getsource`
   tests read files live.
