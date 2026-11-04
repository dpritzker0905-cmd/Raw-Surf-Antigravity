# 2026-11-04 claude: ANCHOR_DEEP_READ investigation. The double count is refuted at 6 of 8 CA stations, so nothing was built

Branch `claude/anchor-deep-read` (docs only). Dev was `29c01f71f`; the analysis code was read at `8a401da41`, and the
chain files it cites did not change between the two. The backend was never called: everything ran offline against
the harness cache `C:/t/eh0-cache` and the #706 run `C:/t/ssk-eh-out`. No served number moves, so there is no
SCOREBOARD row.

## Question
Round 6, item 3, found that served height reads -0.344 m low at the CDIP stations next to fallback-cell spots. It
attributed -0.154 m of that to the ANCHOR: the read cell compared with the model at a deep buoy 30-130 km away. The
suspected mechanism was a double count. The read cell is already a shelf value, and the chain attenuates it again.

## 1. The serving chain (not only the helper) treats the read value as deep water
- `point_surf_augment.augment_with_surf` passes `response.point.speed` into `surf_point.estimate_surf_at`. That value
  is the GFS-Wave cell the sampler read: bilinear, or `nearest_ocean_fallback` at `sampler.py:528-578`.
- `surf_transform.estimate_surf` (`:383-529`) then applies four steps:
  - Komar (a deep-water breaker formula);
  - `_height_exposure_factor` (0.595-1.0);
  - `REFRACTION_KR` 0.873 (`:84`);
  - the H1/10 conversion.
- Kr was fitted by driving that same chain with DEEP-buoy Hs (`scripts/validate_nearshore_transform.py:228-251`,
  `implied_kr_composed_samples`). So it is a deep-to-nearshore transfer. Wherever the read cell is attenuated, the
  serving chain would count that attenuation twice.
- `nearshore_validation.model_hs_at_station` (`:79-99`) is parity-pinned to these components. The helper and serving
  therefore behave the same way: this is not a helper-only bug.
- Cross-shelf friction is already zero (`SHELF_CF_SCALE_DEFAULT = 0.0`, `:352`; #146 removed that double count).

The real question is therefore empirical: **is the read cell actually attenuated?**

## 2. Intervention
The pre-registration was written before any arm was scored and is reproduced below. The station model is the
served chain's own functions, under the served env. The positive parity control held: arm S equals the harness
hs_station on 1536/1536 rows (fresh window) and 960/960 rows (#706 window).

- Window: targets 2026-10-16T00Z..10-31T18Z (fresh, held out), plus 10-06..10-15 (the #706 window, reported only).
- Stations: the committed SSK CA list (103 142 153 201 262 264 284 285 p1), with the harness anchor spots.
- Threshold: 200 m (`bathymetry.SHELF_BREAK_DEPTH_M`), fixed in advance.
- Primary metric: MAE gain vs S, with a 95% CI from a two-way station x day bootstrap.

| arm | fresh n 1461: bias / MAE | gain [95%] | #706 window n 720: bias / MAE | gain [95%] |
|---|---|---|---|---|
| S served | -0.143 / 0.260 | - | -0.165 / 0.324 | - |
| A deep anchor (nearest >200 m cell, 23-52 km) | -0.079 / 0.273 | -0.013 [-0.085, +0.043] | -0.081 / 0.324 | 0.000 [-0.087, +0.098] |
| D shoaling only (read value as nearshore) | -0.006 / 0.257 | +0.003 [-0.121, +0.100] | -0.001 / 0.361 | -0.037 [-0.228, +0.099] |
| C pre-registered (D where the read cell >=200 m) | no-op: no read cell met it | 0 | no-op | 0 |
| C2 post-hoc (D where the depth at the spot >=200 m: Blacks, Swamis only) | -0.094 / 0.250 | +0.010 [-0.007, +0.032] | -0.093 / 0.285 | +0.040 [0.000, +0.096] |
| K = SURF_SPECTRAL_K (#706), factorial with C | - | - | -0.146 / 0.244 | +0.080 [-0.011, +0.203] (K x C = K: C is a no-op) |

The read cell reads **0.98-1.03 x the deep cell at 6 of 8 stations**, so at those stations there is no attenuation to
count twice. Two stations differ:
- **Rodeo 0.675**: A fixes it (bias -0.28 -> -0.01).
- **Pismo/Avila 0.88**: A makes it worse (bias +0.41 -> +0.63). The Avila coast is sheltered, and the exposure and Kr
  are doing real work there.

The #706 agent's "deep cell" depths (Del Mar 642 m, Leucadia 384 m) match the depth at the SPOT (720 m at
153/262p1, the canyon heads), not the depth of the cell that was read. A bilinear read has no single cell. That is
why the pre-registered C was a no-op and C2 is post-hoc.

## Verdict
- **Neither a serving bug nor a helper bug in California.** The chain is built to double count when its input is
  attenuated, but at 6 of 8 CA stations its input is not attenuated. The round-6 ANCHOR term was a distance artefact
  (the deep buoys sit 30-130 km away).
- **Nothing was built.** The anchor arm does not help (point estimate negative; Pismo is harmed by 0.22 m). Under the
  default-on policy, shipping it would be shipping a regression at a sheltered spot. The harness station model is
  consistent with serving, so it needs no fix and #712's verdicts do not change.
- Reflection (Beam, high) said "partially sound; too universal". It noted a 23-52 km deep proxy and that a null
  aggregate is not proof of absence. The claim is narrowed accordingly: no double count where read == deep (6/8).
  The cause of the remaining -0.14..-0.28 m is NOT isolated here. Its candidates are GFS input (low in the Bight;
  the BHC arm) and the transfer at specific sites.
- **Leads, not fixes:**
  1. The canyon-head stations (153/262p1) improve with shoaling only, in both windows. That is only 2 stations,
     found post-hoc; a pre-registered test on new stations is owed before anything ships.
  2. Rodeo needs a site-specific read point.
  3. SURF_SPECTRAL_K (#706) remains the strongest CA arm.
- Exposure stratification (the lead's second axis) was NOT run. The rows do not carry it yet.

Scratch, not committed: `C:/t/adr-scr/` (PREREG.md, arms.py, score.py, arms_*.json, score_*.json).
