# The uniform inputs sample is blind to the tail, and the tail is where the open questions live

Rationale relocated from `backend/services/weather_pipeline/spot_ratings.py::_persist_inputs`
under the 800-LOC ratchet. The code carries a pointer to this file.

## The measurement (2026-08-12, production `raw-surf-antigravity.onrender.com`)

A 200-spot global viewport, served 2026-08-12T22:00Z, GFS:

| | |
|---|---|
| estate max breaking height | **3.66 m** (Papara) |
| max in the 5% `inputs` sample | **1.93 m** |
| spots >= 3.0 m | 3 of 200 (**1.5%**) |
| spots >= 2.0 m | 17 of 200 (8.5%) |

5% of a 1.5% tail is ~0.075 rows per 200-spot frame. The sample does not reach the tail, and it
never will by drawing uniformly.

## Why it matters

All three `SURF_TIDE_DEPTH` samples drew from that blind sample:

| sample | window | replayable | moved | max abs delta |
|---|---|---|---|---|
| 1 | 08-09, 3 h | 486 | 0 | 0.2 |
| 2 | 08-11, 5 h | 496 | 8 | 3.2 |
| 3 | 08-12, 12 h span / 5 distinct served frames | 123 | 0 | 0.2 |

Sample 3 covered a MEASURED tidal swing of 2.4-3.1 m and moved nothing, which retired the
tide-phase explanation for sample 2's outlier. The remaining unmeasured dimension is SWELL SIZE --
and the tide term binds at the DEPTH-LIMITED cap, the one regime a uniform draw of a thin tail
will not reach. Confirmed from the same production frame: across 200 spots the binding limiter was
`size_gate` 48.5%, `swell_exposure` 30.5%, `wind_period_blend` 19.5%, `period_gate` 1.5% -- never
depth. (That is the RATING limiter, not demonstrably the same cap the tide term modifies; the link
is not closed.)

## The change

Big surf is sampled UNCONDITIONALLY, on top of the uniform draw. `SPOT_RATINGS_INPUTS_TAIL_M`
(default 2.5 m) is the threshold; `SPOT_RATINGS_INPUTS_SAMPLE_PCT=0` still ships nothing, because
a kill switch that stops killing is worse than no kill switch.

## The cost, and the cost that is NOT paid

- The tail is ~1.5% of rows; an `inputs` block is **+42.8%** on a ~320 B row => the blob grows
  **~0.6%**.
- The 5% cap exists because shipping `inputs` on EVERY row cost +42.8% overall (~1.4 MB on a blob
  every client downloads). That bound is untouched.

## The cost that IS paid, and must be disclosed

The sample is now **non-representative on purpose**. "N% of rows moved" can no longer be read as
"N% of served spot-hours move". A replay wanting the population rate must stratify -- tail rows are
identifiable by their own `surf_height_m`. Coverage of the RESPONSE SURFACE is what this sample is
for; a census is not, and was never what 5% of anything could give.

★ This is the third coverage defect in this instrument in one day, after `SPAN UNKNOWN` (an
unmeasured window read as fine) and `REPEATED FRAMES` (12 requested hours resolving to 5 served
frames). All three are the same shape: **the sample looked broader than it was, and nothing in the
output said otherwise.**


---

## Relocated verbatim from `spot_ratings.py` (run provenance, INTERNED)

Moved 2026-08-12 to pay for the tail-sampling change under the hard 800-LOC limit.
Not edited, not summarised -- the ratchet measures our documentation, so rationale moves,
it never gets deleted.

```python
# ── run provenance, INTERNED ─────────────────────────────────────────────────────────────────────
# `run_time`/`wind_run_time` answer "which forecast", and they vary PER SPOT: the point resolver
# serves regional products on independent ingest cadences, so within one (model, valid_time) frame
# the marine run ranged over 17 hours across four spots when measured.
#
# ⚠️ BUT THEY ARE NOT PER-SPOT DATA — they are per-PRODUCT data, and a frame holds ~20 products for
# ~900 spots. That object is fetched off the CDN by EVERY client on EVERY map load
# (`spotRatingsCdn.js`: one download per 5-minute bucket serves every pan/zoom/model-switch/scrub),
# so the encoding is a bandwidth decision, not a style one. Measured on a realistic 900-spot frame
# with 20 distinct products:
#
#     baseline (no run fields)   259,882 bytes
#     raw ISO pair per spot      338,201 bytes   +30.1%   (+87 bytes/spot)
#     INTERNED                   268,800 bytes    +3.4%   (+10 bytes/spot)
#
# Across the object (3 models x 2 frames) that is +459 KB against +52 KB of client bandwidth for a
# diagnostic field. So the frame carries the distinct pairs ONCE and each spot carries a small
# integer into them; the endpoint expands it back on read, so the API stays legible and nothing
# downstream has to know the encoding.
```
