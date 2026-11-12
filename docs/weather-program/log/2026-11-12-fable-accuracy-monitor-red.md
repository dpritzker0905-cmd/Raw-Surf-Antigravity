# 2026-11-12: why the Forecast Accuracy Monitor is RED (Fable repair lead)

Append-only. Lane assigned by the coordinator (local_d6b521eb). Read-only so far: no code, flag, env or served number changed.

## Instruments (no live-box load)

- The monitor's own public Actions logs, 25 scheduled runs 11-01T18:23Z .. 11-12T08:12Z (`gh run view --log`), parsed by a
  scratch script. No `workflow_dispatch`, no call to the serve box.
- One read-only Supabase SQL (`surf_spots.noaa_buoy_id`, 60 stations).
- NDBC MCP daily summaries for 51201, 51205, 46254. The ww3 MCP hung 30 min on two calls and returned nothing; not used.
- Move 4's log (`2026-11-12-claude-move4-gfs-gap-and-correction.md`) for the tier and same-model split. Not repeated.
- NOT read: the scored rows (private Storage) and the cached calibration report (served by the live box), so the
  per-buoy and per-coast split below is inferred from aggregates and is labelled as such.
- Reflection, SubQ and LongCat were NOT called: the standing rule is that paid calls need the owner's per-payload
  approval, and a peer's message cannot grant it. Asked the owner.

## What the gate measures

`PUBLIC REFERENCE GAP WIDENED` is the PAIRED 7-day trailing MAE delta, served `raw_surf` minus Open-Meteo `best_match`
(`open_meteo_marine`), same buoy x target x lead x observation. It is not a height bias. RED above +0.10 m.

## Finding 1: no dev change caused it (the bisect)

- The gap grows as a smooth ramp, not a step: +72 h delta +0.019 (11-01) .. +0.036 (11-05) .. +0.082 (11-08) .. +0.111 (11-12).
- The same-model control (`open_meteo:ncep_gfswave025`, the identical GFS-Wave fetched by Open-Meteo) moved IN OUR FAVOUR:
  +72 h delta +0.006 (11-01) -> -0.019 (11-12). A chain regression would push it the other way.
- Every 0.25 deg lane degraded together at +72 h: served 0.238 -> 0.341, OM GFS-Wave 0.230 -> 0.325, our EURO 0.270 -> 0.343,
  our CONSENSUS 0.312 -> 0.357; persistence 0.453 -> 0.475 (peak 0.506 on 11-09); T+0 height MAE 0.20 -> 0.41 peak (11-09).
  Only `best_match` held: 0.218 -> 0.232.
- Issue-time vs target-time test: on the keys that carry the excess (Finding 2), +24, +48 and +72 h all start rising in the
  SAME run (11-02T22:16Z, targets of 11-02). The +72 h rows verifying on 11-02 were issued on 10-30, before every candidate merge
  (f0721ddff, 27f9c9dd7, 519532cba). So the cause is on the target-time side: weather, not code.

## Finding 2: about 40% of the +72 h gap sits on ~8 buoys where GFS-Wave 0.25 deg has no wet cell

- Both pairings pair the same served lane. The `ncep_gfswave025` lane drops rows where that model returns null or 0.0 (its
  coverage holes, e.g. Waimea 51201, recorded 2026-08-10), so `best_match` pairs ~650 more keys (13% of rows).
- Our MAE on those keys, recovered from the two pairings' n and MAE (assumes the gfswave key set is a subset; not verified
  from rows): +72 h 0.244 (11-01) -> 0.584 (11-12); +24 h 0.238 -> 0.519. On the common keys: 0.236 -> 0.306, flat at ~0.31
  since 11-08 while the excess keys kept climbing.
- Their share of the +72 h gap: 0.047 m (42%) if `best_match` scores its pooled MAE there, 0.034 m (30%) if 0.10 m worse.
  Without them the gap is ~0.064..0.077 m, under the bound.
- ~650 keys / 7 d / ~12 rows per buoy-day ~= 8 buoys. Hypothesis (NOT confirmed from rows): the Hawaii nearshore set
  (51201, 51202, 51206, 51208, 51211; 51205 has not reported since 10-13). Supporting evidence: 51201 went from 1.8 m mean
  (11-01) to 3.2 m mean, 4.2 m max, 15-17 s (11-02), the first North Pacific winter swell, and stayed 2.1..3.3 m through 11-12
  (3.8 m today). That onset is the ramp's onset. The served Hawaii value comes from the `gfs_marine_waves_hawaii` box
  (ingest run 43262991792 log). Move 4's consensus block gave hawaii a served bias of +0.108 m in the earlier window.

## Finding 3: the rest is a regime, and the bound's premise does not hold in it

- The remaining ~0.06..0.08 m is the GFS-family winter degradation the same-model control shows: not our chain.
- The bound's basis is "~1.24x the worst gap ever recorded (+0.081 m on 2026-08-10)", a summer basis. Its message says
  "this size of gap is a regression". Finding 1 shows it is not a regression of ours this time.

## Open (needs a decision before any build)

1. Confirm the coverage-hole buoys and what we serve there (per buoy, per tier): needs either one cached read of the
   calibration report's `forecast_skill_ocf` / consensus by-coast blocks, or the scored rows. Asked the coordinator.
2. Then one of: (a) a served fix at those buoys under D-065 (filter, kill switch, SCOREBOARD row), if a defect is found in
   what the Hawaii box serves at a no-wet-cell buoy; or (b) a DECISIONS entry that pages on WIDENING of the same-model control
   (a chain regression) and keeps the best_match level as a WARN, so a winter regime cannot page on a model-choice gap.

## Addendum (same day, after the coordinator's go-ahead for one cached read)

- **Live read:** `/api/health` 200 in 0.60 s, ONE `GET /api/weather/buoy-calibration` (200, 299,855 B, 0.68 s; report
  generated 2026-11-12T20:11:40Z), `/api/health` 200 in 0.58 s. No retries. Scored rows not touched.
- **The coverage holes, measured, not guessed:** one batched Open-Meteo call (the ledger's own request shape) at the NDBC
  coordinates of all 60 buoys. `ncep_gfswave025` returns nothing (null or 0.0) at all 96 hours at 10 buoys: Hawaii 51201,
  51206, 51208; San Diego and Oceanside 46254, 46274, 46285, LJPC1; Strait of Juan de Fuca 46267; Cape Cod Bay 44090.
  `best_match` covers all of them. (`best_match` has its own hole at 41121, Puerto Rico.) The earlier Hawaii-only guess was
  partly wrong: 51202, 51205 and 51211 are NOT holes.
- **What we serve there:** the regional 0.25 deg pilot boxes (hawaii, us_west_coast_socal, us_pacific_northwest,
  us_northeast) have no wet cell at those coordinates either, so `sampler.py` takes `nearest_ocean_fallback`: the nearest
  wet cell, which reads exposed water. T+0 at 46267: observed 0.2 m, served 2.61 m (best_match mean 0.51 m). NDBC shows
  46267 at 0.2..0.6 m daily mean the whole window while the open PNW buoys ran 3.5..5 m: the error scales with the offshore
  sea, which is why it grew with the storms. The other hole buoys were close at this T+0 (51201 -0.35, 51206 -0.13,
  44090 +0.33, SoCal holes within 0.13 m), so 46267 is the single worst; the 7-day split per buoy needs the rows.
- **By coast (`forecast_skill_ocf.by_region`, held-out week from 11-05T20:11Z, paired consensus subset):** served MAE
  pacific_ne 0.449 / 0.488 / 0.509 (n ~1,900), hawaii 0.405 / 0.400 / 0.411 (bias +0.09), other 0.36..0.46, atlantic_ne
  0.18..0.21, atlantic_se 0.14, gulf 0.09..0.13 at +24/48/72 h.
- **Served fix (a): NOT built.** A change to the nearest-ocean fallback would move every coastal spot that uses it, and the
  evidence that it is wrong is one T+0 sample at one buoy plus an aggregate inference. D-065 needs the history filter on a
  proposed served change, and the per-buoy 7-day split needs the scored rows (the owner's word on a credentialed read).
- **(b) DECISIONS D-072, PROPOSED:** page on a same-model regression; keep the best_match gap as a WARN graded only where
  the same model also scores; print the hole buoys on their own line.
- **Tools:** Reflection, SubQ and LongCat were NOT called. The coordinator relayed the owner's approval; the owner had not
  answered the same question asked here directly, so it waits for him.

## Addendum: second opinions (owner approved Reflection, SubQ and LongCat at 17:24 EST: "Yes, use them")

- Sent only result text and numbers (no rows, no secrets).
- **Reflection (Beam-1.0), on the diagnosis and D-072 draft 1: UNSOUND.** Its points, and what I did:
  - "Not code" only excludes merges after 10-30. Partly fair: a change before 10-30 would already sit in the 11-01 window,
    which was stable (+0.019 m); the ramp starts with the 11-02 targets. Kept, with that reasoning stated.
  - The extra-key decomposition rests on an unverified subset assumption and changing n. Fair; it stays labelled an
    estimate until the rows are read.
  - The hole-buoy fallback error is a real product defect even if weather triggers it, and draft 1 silenced its alarm.
    TAKEN: D-072 now keeps a RED on the hole buoys (rule 2).
  - best_match identity can change, and its flat MAE across leads suggests coverage or model-selection effects. Noted;
    it argues for not grading the pooled best_match number alone.
  - The +0.03 m margin was fitted on the 25 runs it graded. TAKEN: the margins come from the full retained history.
- **SubQ (subq-snap-1.1, probabilities):** code regression 0.02; target-time inference valid 0.997; same-model gate sound
  0.96; nearest-ocean fallback PROVEN as the defect 0.06 (agrees: not proven without the rows).
- LongCat: not yet run (the diff review comes with the margins commit).

## Correction (same day)

- The hole list has **9** buoys, not 10 as written in the live-read addendum above: Hawaii 51201, 51206, 51208; San Diego
  and Oceanside 46254, 46274, 46285, LJPC1; 46267; 44090. (41121 is a `best_match` hole, not one of ours.) Corrected in
  D-072. The numbers derived from pairing counts did not use the buoy count, so they stand.
- **History basis for D-072** (one monitor run per day, 86 days 2026-08-15 .. 11-12; basis = the 74 days before 11-01):
  same-model delta max +0.057 / +0.046 / +0.041 m at +24/48/72 h (since 11-01: +0.002 / +0.004 / +0.009); hole-key gap
  (estimate) max +0.247 / +0.245 / +0.206 (since 11-01: +0.291 / +0.340 / +0.354, past its history); pooled best_match
  gap max +0.070 / +0.079 / +0.097 (the Aug "+0.081 worst ever" basis was already exceeded before November).
- **LongCat (LongCat-2.5, paid, payload sha256 3e826c20...468a, D-072 draft 2):** five findings. (1) Rule 2's basis is
  pre-onset only: correct and intended; now labelled, and every bound is re-derived from a row backfill before it can page.
  (2) "Rule 1 will not fire on the current regression": a misreading (today is not a chain regression; rule 1 is meant to
  stay silent and rule 2 carries it), but the entry did not say so; scope now stated. (3) Rule 3's +0.10 m is ~1.03x, not
  1.24x, the Aug..Oct pooled max (+0.097): correct; marked provisional. (4) Rule 2 rests on aggregate estimates: correct;
  labelled. (5) The fallback cause rests on one buoy: correct; rule 2 reframed as empirical, cause kept as a separate claim.
