# Bug hunt: the weather simulation system (2026-11-22)

**Author:** senior research lead.
**Method:**
- two read-only reviewers (the surf chain across surfaces; time, runs and the frame codec), plus the lead's own reading;
- every item marked CONFIRMED was reproduced offline from `backend/` on `dev` `b7ef69f23` with the production functions. The lead re-verified A, B, C and D directly.

Nothing was edited, and no production call was made.

**Second opinions (advisory):**
- Reflection (Beam-1.0, high effort);
- SubQ (snap-1.2; figures are model confidence, not statistics);
- LongCat: its one paid submit failed with a network error and an uncertain billing outcome, the third failure this session. It was not retried, and its usage should be checked.

## Findings, in the fix order the reviewers agreed on

| # | Finding | Status | User impact |
|---|---|---|---|
| B | A "no data" sample is rated as a real zero. Missing wind becomes glassy (best wind); missing marine becomes flat, `very_poor`. | CONFIRMED | **High** where it occurs. The frequency in production is unmeasured. |
| A | The tide freezes past its 3-day window and feeds the breaking-height cap. | CONFIRMED | **High** on big-swell days at depth-limited breaks, every hour beyond about 72 h. |
| E | The hub's "now" floors the hour while the map's "Now" rounds, so they show different 3-hourly products. | CONFIRMED | Medium: 30 of every 180 minutes. |
| D | The map rating band rates one partition layer (swell_1 / swell_2 / wind_waves) as if it were the whole sea. | CONFIRMED | Medium: the band's colour, whenever Rating is on over a partition layer. |
| F | The sim turns a missing period into 0, giving flat surf where the glyph says unknown. | CONFIRMED | Low (the MCP sim's default path). |
| C | Cross-shore and offshore gales are never vetoed. | CONFIRMED | Medium-high, but contested (see below). Routed to gate `rating-wind-gate-v1` (#1173). |
| G | Breaker type computes a deep-water Iribarren number from the breaking height. | PLAUSIBLE, dormant (`RATING_BREAKER_TYPE` off) | None today. Fix it before that flag is ever turned on. |

### B: a "no data" sample is rated as a real zero
- **Code:**
  - `sampler._build_unavailable_response` returns `speed=0.0, direction=0.0, period=0.0, interpolation_method="unavailable"`. The out-of-bounds fallback does the same.
  - `point_resolution.py:417-438` discards degraded samples only for MARINE on the global-coarse grid. Everywhere else they are returned as a normal answer.
  - `spot_ratings.rate_one_spot:183` computes `wind_ms = (speed or 0.0) * KT_TO_MS`, so 0 kt reads as glassy. The engine's own rule for unknown wind (`wind_quality(None)`) is neutral 0.6.
- **Repro** (the real `rate_one_spot` with a fake resolver, 2 m at 14 s):

  | Wind input | Score |
  |---|---|
  | Sampled 12 kt onshore | 42.9 fair |
  | "unavailable" | **96.0 epic** |
  | Resolve failed (None) | 72.3 good |

  With unavailable marine: surf 0.0 m, score 0.0 `very_poor`.
- **The observation gate** caps the 96.0 at 69.9 unless the hour is confirmed. That limits the damage but does not fix the input.
- **The lead's own miss:** the lead first dismissed `speed or 0.0` as benign because `NormalizedPoint.speed` defaults to 0.0. That default is exactly the problem.
- **Fix shape (Reflection's improvement, adopted):**
  - carry the sample's status from the sampler boundary;
  - every rating caller maps `interpolation_method in {unavailable, out_of_bounds_fallback}` to None (unknown), never 0;
  - add one test per surface.
- It moves served ratings, so it falls under D-065.
- **Owed first:** count how often production serves `unavailable` / `out_of_bounds_fallback` for the rated catalogue (from the precompute's own records, not a live sweep).

### A: the tide freezes past its 3-day window
- **Code:**
  - `tide.tide_state_at` (`tide.py:305-345`) takes the nearest sample with no maximum distance.
  - `tide_norm_at` (`:484`) fetches the default `forecast_days=3` from 00Z today.
  - `sea_inputs.resolve` (`:43`, `SURF_TIDE_DEPTH` on) feeds the result into the cap depth for `/point`, the precompute and the hub's 14-day plan.
- **Repro** (the production `tide_state_at` on a 72 h sinusoid with 1.5 m amplitude): hours 0-71 are exact, but +80, +120 and +200 h all serve **-1.467 m** against true values of +0.541, -1.276 and +0.905 m.
- **Effect:** in the reviewer's case, cap depth 9.63 m instead of 12.00 m, about 1.9 m less breaking ceiling.
- **Fix shape:**
  - fetch a window that covers `valid_time` (the own tide table is published 90 days ahead);
  - add a maximum distance (one sample step) that returns None.
- **Reflection's objection:** falling back to η = 0 biases toward MSL. Agreed. The primary fix is the window, so η = 0 should only happen past the table's 90 days.
- **Missing test:** a time outside the series.

### E: hub "now" vs map "Now"
- `spot_hub_composition.current_valid_time` (`:112-115`) floors to the hour. The client's `getSeriesAnchorMs` (`backendWeatherServiceClient.js:223`) rounds.
- With nearest-pick on 3-hourly products, at 10:40Z the hub uses 09Z and the map uses 12Z.
- This is the F-01 floor-vs-round class again.
- **Fix:** one shared rule (the client's round-to-nearest) plus a parity test that pins both.

### D: the rating band rates a partition as the whole sea
- `grid_resolver_surf.py:28` runs the overlay on `waves`, `swell_1`, `swell_2` and `wind_waves`, and the client sends `surf=1` for all four.
- `rating_transform_grid` grades that layer's height, period and direction. The glyphs rate `waves` (the total).
- **Repro**, one point at 5 kt offshore:
  - total 2.0 m at 10 s: 85.3;
  - swell_1 1.0 m at 15 s: 98.6;
  - wind_waves 1.6 m at 7 s: 61.0.
- **Is it a defect?** SubQ put "real defect" at 0.59 model confidence; Reflection allows that it might be an intended per-layer view. The parity registry's waiver says the band rates "one combined sea state", which is true only on `waves`.
- **Owner/design question:** should the band always rate the total sea (matching the glyphs), or should it show a labelled "this partition's quality"?

### F: the sim's missing period
- `sim_forecast.py:466-472` (non-strict default) uses `float(period or 0.0)`. The estimate then returns None, which becomes 0.0 `calm`, `very_poor`. The glyph says unknown.

### C: cross-shore and offshore gales (contested)
- **Repro table:** in #1173 §0.
- **Reflection** called the onshore-only veto "likely intended" and warned against arbitrary thresholds.
- **Against that:**
  - the code's own veto rationale ("a blown-out day is unsurfable regardless of swell period");
  - practice (strong offshore hampers paddling and take-off);
  - a 60 kt cross-shore storm reading "poor-to-fair".
- **Resolution:** neither view is evidence. #1173 tests it against blind quality truth, ships dark, and the owner decides.

### G: dormant Iribarren input
- `spot_ratings.py:207` passes the breaking height to `iribarren`, whose docstring expects the offshore height. ξ comes out about 21 % low (Pipeline 0.319 → 0.253).
- Fix before `RATING_BREAKER_TYPE` is ever turned on.

## Lower severity (time, runs, codec reviewer)
- **PLAUSIBLE, medium:** `marineGridSeries.js:684, 698-731`. The containment fallback ignores the cache entry's time anchor, so for about 5 minutes after each :30 anchor change it can serve a frame 3 h off. Needs a Jest test to confirm.
- **CONFIRMED, low:** `route_helpers.parse_valid_time` keeps non-UTC offsets, so `-08:00` is stamped as Z, and a date-only input yields a naive datetime. Only outside API callers hit this.
- **CONFIRMED, latent:** `frame_binary._epoch` and `frame_set.iso` read naive timestamps as the host's local time, which would be 5 h off on a non-UTC host. CI runs in UTC.
- **PLAUSIBLE design issue:** while a new run lands, `manifest_point_selection.selection_key` can prefer an older run's finer product, so the infobox and the map show different runs.
- **CONFIRMED, low, killed legacy path:** `spot_conditions.py:322` uses `round(hour/3)*3` and ignores minutes.
- **Test gap:** there is no Python-generated golden fixture for raster fields 6-14. A hand check (Python encode, JS `decodeFieldCore`) agrees to float32 precision with 0 direction mismatches; the codec is clean.
- **PLAUSIBLE:** `RATING_TIDE` is read with `os.environ.get`, not `runtime_flags`, so the runtime manifest cannot set it. A hub payload could mix tide-rated precompute frames with untided live frames.
- **Open-water `/point-rating`:** for an `open_ocean` / `unknown_depth` regime it rates the offshore Hs as surf. Only API consumers can reach it; the client refuses to ask.

## A claim inconsistency (not a code defect)
- With shelf friction off by code default (`SHELF_CF_SCALE_DEFAULT = 0.0`), head-on breaking height below the depth cap does not depend on depth. At 2 m and 12 s, Cocoa, Mavericks, Pipeline and Teahupo'o all read 3.193 m.
- That is the Komar-only v3 step working as written, but it contradicts the "wide shelf yields much smaller surf" claims in docstrings and project instructions. The text should be corrected, or the claim re-measured.

## Checked and found correct
- Wind knots → m/s at every surface.
- Break depth from geometry (glyph, band, sim).
- Shore normal source.
- Marine and wind asked for the same valid time.
- Reference size via `reference_map` / `reference_for_spot`.
- Observation-gate split (documented).
- NaN and inf go to unknown.
- One 0.1 rounding inside `rating_factors`.
- Codec layout, offsets, direction wrap and missing codes.
- Static frame paths and the `validMs` check.
- Series anchor and page keys.
- DST-safe readout.
- `stamp_frame_honesty`.
- Capabilities as a static table.

## Second opinions, summarised
| Item | Reflection | SubQ (model confidence) |
|---|---|---|
| Most severe | B and A high | B 0.71 |
| Fix first | B → A → E → D → F → G; C "leave unless policy changes" | B 0.63 |
| B real | yes | 0.996 |
| D real | "may be intended" | 0.59 |
| C | "likely intended, low" | 0.04 most-severe weight |

## DECISIONS candidates (owner)
1. **B and A:** repair, shipping ON with a kill switch, a SCOREBOARD row and the history filter (D-065). They move served heights and ratings.
2. **D:** the band rates the total sea, or a labelled per-partition quality?
3. **C:** `rating-wind-gate-v1` (#1173). It ships dark, and the flip is on David's word with evidence.
4. **E:** one rounding rule, round-to-nearest, with a parity test.
