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
