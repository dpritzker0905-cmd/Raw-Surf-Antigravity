# WS-CAN-0064 Mission 4 — the /conditions/batch precompute lane

**Date** 2026-08-15 (second session) · **Base** `e0fb3289` + working set

## The decision chain, each link measured

1. Mission 3 (08-14): production linear at **0.380 s/spot** (n=2..87, stdev 0.031), 10 s at ~26
   spots; concurrency 6 buys nothing; the same code parallelises 7.28× locally ⇒ environmental.
2. Blocked on ONE value with opposite repairs either way: the live `SPOT_RATINGS_CONCURRENCY`.
3. **The owner's Render read (WS-CAN-0040, 08-15): the variable is NOT SET.** Tuning refuted;
   the architectural repair chosen — the lane `/spot-ratings` already survives the 1-CPU box on.

## What shipped

- `rate_one_spot` frames now carry `swell_from_deg` + `offshore_hs_m` ALWAYS-ON (the two batch
  fields previously only in the 5%-sampled inputs block). **Blob tax measured honestly: ~8–10%**
  on a realistic 200-spot frame — the first draft claimed 2–3% and was wrong; the corrected test
  (`test_the_blob_tax_of_the_two_fields_is_measured_and_bounded`) pins the realistic figure with
  a 12% budget. Accepted deliberately: product fields serving users, not instrument telemetry.
- `/conditions/batch`: frame-first per spot (fresh → bounded-stale, `pick_precomputed_frame`,
  same tolerances as `/spot-ratings`), with the untouched live path as per-spot fallback. A full
  frame hit touches **neither the resolver nor the database**. Six-key per-spot shape frozen;
  `conditions_source` is additive top-level disclosure. Kill: `CONDITIONS_BATCH_PRECOMPUTED=0`
  (declared in `_RATING_FLAGS` in the same commit).
- Rollout-safe in both orders: an entry missing any of the four source fields falls through to
  live for THAT spot — a deployed route against a pre-upgrade blob degrades per spot, never to a
  partial payload.

## Verification

- 8 tests red-first (8F) → 8/8: zero-resolver-zero-DB on a fresh hit; per-spot fallback; old-blob
  fallback; stale-beyond-bound; kill switch byte-identical; model isolation (a GFS frame must not
  answer an EURO request); label through the SAME public ladder as the live path; the tax bound.
- Mutation MK (lane forced off) → exactly the two frame-hit tests red; fallback tests green.
- Quick sweep 56/56: flag-lane parity (new registry row accepted), floor staleness, and the
  rating payload guards with the two new fields.
- Chain floors selector-verified BEFORE predicting (the rule the previous mis-route bought):
  the new test file lands in **chain** → 799+8 = 807 / MIN 801, edited as the pair.
- Full lanes: recorded below when the run lands.

## The live measurement (embargo lifted 2026-08-15 ~23:5xZ)

The first post-deploy precompute cycle regenerated the frames with the two fields, and the
30-spot production measurement (3 consecutive runs, read-only GETs):

    run 1: 0.40 s   n=30  precomputed=30  live=0  source=precomputed
    run 2: 0.59 s   n=30  precomputed=30  live=0  source=precomputed
    run 3: 0.56 s   n=30  precomputed=30  live=0  source=precomputed

Against the measured BEFORE — 0.380 s/spot linear (≈11.4 s for the same 30-spot request; audited
p50 52–59 s at larger n, 11/11 sampled calls over 10 s) — that is **~22× at n=30**, and the
shape changed from linear-in-n to ~flat: the request costs a frame lookup, not thirty
resolutions. The route that crossed its 10-second budget at 26 spots now answers 30 in half a
second on the same 1-CPU box.

Caveat kept honest: these three runs sample one warm moment; the fresh→stale→live ladder means a
missed precompute cron degrades to bounded-stale frames before any live cliff (the same posture
that carried `/spot-ratings` through the melt history).

## Lane results (final tree; local 3.14 interpreter)

- **guards 1788/0** (20:02) · **chain 807/0** (11:14, = 799 + the 8 selector-verified new tests)
  · **estate 428/0** (2:19).
- The FIRST full-lane run had 4 reds, all earned and all repaired: the wire-contract guard caught
  the two new fields being silently DROPPED by `SpotRatingItem` at the `/spot-ratings` boundary
  (exactly the defect that guard exists for — declared now, with the guard's exemplar lists
  updated for the two keys' legitimate graduation from inputs-only to product); and the batch
  bounds guard failed only in-lane because a NEIGHBOUR's warmed blob cache let the frame path
  answer the 250-id request it bounds — that file now pins the live path explicitly
  (`CONDITIONS_BATCH_PRECOMPUTED=0` autouse), with the observation recorded in its docstring.
- `routes/weather.py` funded its +5 lines with whitespace only (double-blank separators → single;
  799 → 801 → **799**; nothing deleted).
