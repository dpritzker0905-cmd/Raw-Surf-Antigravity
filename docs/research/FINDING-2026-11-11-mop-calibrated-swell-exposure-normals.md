# MOP-calibrated swell-exposure normals: better against MOP, worse on the buoy proxy (2026-11-11)

Follow-up to JAC-1 (#779), queued by the coordinating session: measure the chain's shore normal against CDIP MOP, find
whether the error is systematic, and fix the source behind `SHORE_NORMAL_MOP_CALIBRATED`, passing the #773 nearshore arm.

## 1. The chain's normal vs MOP's transect normal (77 California spots)

Every spot in `backend/data/mop_spot_cells.json`, nearest MOP v1.1 alongshore point (median 0.84 km, max 2.88 km),
`metaShoreNormal` against `surf_point._shore_normal_precedence` (script: `scripts/swell_exposure_normals_fit/measure_normals.py`).

| | p50 | p75 | p90 | max |
|---|---|---|---|---|
| abs(chain - MOP) | 9.0 deg | 20.0 deg | 31.6 deg | 61.0 deg |

- **Not a constant bias.** The signed median is +2.8 deg.
- **The large errors sit at geometry the ETOPO fit cannot resolve.** 19 of 77 spots are off by more than 20 deg: points, headlands, coves and harbours such as Princeton Jetty, Camel Rock, Shelter Cove, Rodeo Beach, Rincon, C Street, Sands and Steamer Lane. The ETOPO fit's windows are 1.7-5 km half-widths. Three coarse-grid fallbacks are also included (Carmel, Doran, 54th Street).

## 2. MOP's transect normal is NOT a better input

At the 19 JAC-1 spots, scored as the count-weighted MSE between the chain's own height factor and MOP's normalised attenuation over all angles:
- chain normal 0.0219, MOP normal 0.0252. MOP's normal wins at only 9 of 19 spots.
- Both normals sit about 31 deg (median) from the bearing at which MOP's response actually peaks.

MOP's normal is the orientation of its 10 m contour transect. The bearing a spot responds to is shaped by island shadowing and refraction. Swapping in catalogue normals would not help (`compare_normals.py`).

## 3. A fitted effective exposure normal is much better against MOP (out of sample)

For each spot, the bearing minimising that MSE was fitted on 2022-01..2023-12 and scored on 2024-01..2025-03 (`fit_effective_normal.py`, `fit_all.py`). Offshore buoys: 029p1, 157p1, 071p1, 067p1, 094p1, 168p1.

| spots | held-out MSE: chain normal | MOP normal | fitted |
|---|---|---|---|
| 77 | 0.0234 | 0.0392 | **0.0046** |

- The fit beats the chain normal at 68 of 77 spots.
- Pooled improvement: 0.0188, spot-bootstrap 95% CI [0.0117, 0.0287].
- 56 spots pass the gate in `scripts/build_swell_exposure_normals.py`: the fit is better out of sample, the optimum is not ambiguous, and the MOP point is within 1.5 km. Their normals form `services/weather_pipeline/data/swell_exposure_normals.json`.
- The fit is in the chain's own frame: the OFFSHORE swell direction against the factor.
- **Scope:** the HEIGHT's exposure factor only. The coastline normal still drives the wind's offshore/onshore test and the rating.

## 4. The #773 nearshore arm reads it WORSE

`default_on_filter.py` (with #773's nearshore arm), cache `eh0-cache`, window 2026-10-20..29, 8 nearshore CDIP anchors:
- the 4 standard anchors (Topanga, Rodeo Beach, Blacks, Swamis);
- plus 201p1 (La Jolla Shores), 264p1 (San Onofre), 284p1 (Upper Trestles) and 285p1 (Pismo), which are in the cache.

| quantity | verdict |
|---|---|
| `hs_station` | NO_CHANGE |
| `hb_proxy` | **WORSE**: ON loses 0.0385 m MAE, CI [0.0234, 0.0589]. Every lead and all three regions are worse. |
| rating census | n 960, score moved 210, level moved 19, mean +0.47 |

**Why the instruments disagree.**
- `hb_proxy`'s truth is the buoy's deshoaled Hs (1.5-10 km off the spot) through Komar-Gaughan, with **no exposure loss**.
- The chain already reads below it: H1/10 reads BETTER on it.
- In this autumn window, the fitted normals put the dominant NW swell further off-angle at most anchors (La Jolla Shores 301.5 -> 229, Blacks 267 -> 245, Rodeo 224 -> 214), so the chain attenuates more and moves further from the proxy.
- MOP, a physical model of exactly these spots, says that attenuation is right. A proxy that cannot represent exposure says it is wrong.

## Decision

Per D-065 and the coordinator's rule ("must PASS the arm"), **`SHORE_NORMAL_MOP_CALIBRATED` ships held OFF** (`GUARDED` "0"). The code path, asset and tests are in place, and its kill-switch path is byte-identical to today.

**Before any flip, resolve the instrument conflict**, for example:
- score breaking height against a nearshore truth that includes exposure: MOP's own nearshore Hs at the anchor spots, or observed surf reports; or
- give `hb_proxy` an exposure-aware observation operator, or anchors at the spots themselves rather than kilometres offshore.

## Outside California

There is no MOP, so nothing changes: no lookup entry exists and the coastline normal is used. The same per-spot fit could be run wherever a validated spectral nearshore model and an upstream directional buoy exist. Without one, the effective exposure bearing cannot be verified. The ETOPO coastline fit stays the best available source, with the known weakness at points and headlands that section 1 measures.

## Caveats

- MOP is a linear refraction model driven by these same buoys, not an observation. Its points sit 0.1-2.9 km from the spots at 10-15 m depth.
- The angle uses each buoy's single peak direction.
- Fits along several coasts bunch at 240-246 deg, partly because only directions the buoy records often enough are informative. Read those values as the response window, not a coastline.
- Samples are autocorrelated. The held-out period covers about 450 days.

## Addendum: the >90 deg height floor depends on these normals (no floor change ships)

The coordinator's second follow-up was to refit the floor beyond 90 deg against MOP with corrected normals, using held-out spots, and to ship it only if the CI is clear of 0.595 and the arm is not worse. The fit (`scripts/swell_exposure_normals_fit/floor_refit.py`) used the count-weighted mean of MOP's normalised attenuation over the >=90 deg bins, with 5-fold spot cross-validation and a 5000-draw spot bootstrap:

| normals | spots / bins / hours | pooled floor | 95% CI | CV MSE: refit vs today's 0.595 |
|---|---|---|---|---|
| coastline (served today) | 72 / 236 / 279,574 | 0.684 | [0.643, 0.728] | 0.0329 vs 0.0419 |
| fitted exposure (this PR, held off) | 58 / 128 / 186,900 | 0.553 | [0.532, 0.572] | 0.0040 vs 0.0058 |

**The sign flips with the normals.** Under the coastline normals, many hours counted as beyond 90 deg are really much closer to head-on, so a higher floor "helps". Under the response normals, the floor should come down slightly.

A floor change now would bake the normal error into a second constant. So, as the coordinator sequenced it, **no floor change ships until the normals question above is resolved.** When `SHORE_NORMAL_MOP_CALIBRATED` can be flipped, 0.553 [0.532, 0.572] is the candidate, and it must clear the arm under the same instrument caveat.
