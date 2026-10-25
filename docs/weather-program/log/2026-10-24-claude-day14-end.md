# 2026-10-24 — the day-14 end: proper marine data at the scrubber's last hours (claude, branch claude/day14-end)

Owner, 2026-10-24: "make sure the tails have proper data. I noticed on the live dev that far end day 14 was lacking marine
heatmap data specifically ... I even noticed GFS day 14 tails were lacking data in the heatmaps visuals ... Research this
deeply. Use reflection.ai to help you and subq". Before that, on the static-frames task: "Yes: design and build frame
publishing for the ICON/EURO estimated 14-day tails ..."; and, asked how, "Pilots downloads tails (Recommended)".

## The starting brief was stale

The brief (extend #422's static frames from GFS waves to every world marine set) was already done on dev: #453 (8 world sets),
#460 (series lane), #461/#462 (EURO/ICON world boxes ask /grid while `gulf_fill_mid` is on), #513 (u/v tolerance), #458
(model toggles from frames). The one open gap was the ICON/EURO estimated tails, listed `not_local` in the pilots lane.

## Measured (live, 2026-10-24 ~03-06Z)

CDN frame indices (`weather-frames/v1/latest.json`, public reads only; Supabase answered 429 to 8 parallel frame reads, so
the decode ran 1 at a time):

| set | frames | built | unbuilt | last frame |
|---|---|---|---|---|
| GFS waves / swell_1 / swell_2 / wind_waves | 113 | 112 / 113 / 113 / 111 | refused 1 / 0 / 0 / 2 | 2026-11-06T18Z |
| ICON waves | 117 | 114 | refused 3 (tail built: on the pilots disk) | 2026-11-06T12Z |
| ICON swell_1 / wind_waves | 117 | 61 / 60 | not_local 56 / 57 (the tail) | 2026-11-06T12Z |
| EURO waves | 117 | 69 | not_local 48 (the tail) | 2026-11-06T12Z |

Decoded, the published tail frames are full fields: GFS waves 67.6% valid nodes at f000 and at f336, ICON waves estimated
69.2% to the end. **The frames that exist are not empty: the hours past them are.**

Storage listing (`storage.objects`, read-only): every stored marine lane (GFS, ICON native + estimated, EURO native +
estimated, global_coarse and global_mid) ended at **2026-11-06T18Z** while the scrubber's end (now + 336 h) was
2026-11-07T04Z. Root: the scrubber counts from NOW (`backendWeatherServiceClient.js:222-241`, `LayerAccessResolver.js:163`),
every lane from its RUN (GFS ingest `GFS_GLOBAL_FORECAST_DAYS` / `GFS_MID_RES_FORECAST_DAYS` = 14 -> f336, although GFS-Wave
runs to f384; ICON/EURO tails ceiling run + 336 h, `icon_marine_extension._CEILING_HOURS`, `scheduler_helpers.euro_estimate_within_ceiling`).
Audit defect C-01 (`docs/audits/2026-10-18-weather-scrub-audit/evidence/lane-contract.md:62-68`) already named it.

What /grid served at now + 336 h, world box (one request each, `/api/health` healthy before and after):

| model | served | why |
|---|---|---|
| GFS waves | provider open-meteo, **19 x 9 = 171 vectors**, region `viewport_...` | Step 4's on-demand upstream fetch targets ~200 points for any box (`viewport_service`: 20 deg for the world) and SUCCEEDS, so the far-edge hold (only on its failure) never runs |
| ICON waves | far-edge hold `+11.0h`, **global_coarse 37 x 17** | dynamic lane off past 168 h; the hold took the first of two same-hour tiers in manifest order, coarse before the 2-deg mid |
| EURO waves | 404 once (during the core lane's 05:19Z EURO tail rewrite), then the same coarse hold `+11.0h` / `+5.0h` | transient, plus the tier tie |

Offline (synthetic store, two backends), a COLD GFS world ask past the tail is first answered by Step 3.7's instant preview:
the tail's 10-deg frame from 10 h earlier, labelled authoritative; once a world upstream grid is cached, Steps 1-2 serve
that 19 x 9 grid ahead of everything stored.

Second opinions (the owner asked for both): Reflection (Beam, high effort) ranked: GFS to f384 = do (watch the lane budget),
prefer-mid = do, hold-before-upstream = do restricted to wide boxes past the tail, tails via a core-lane-owned pointer;
SubQ (decide): GFS to 16 days 0.84 (+ the safety net 0.14), prefer mid 0.997, lane-budget risk HIGH 0.91. The budget risk
was then MEASURED, not assumed: the pilots lane ran 58-107 min in its last 15 runs (the "~185 of 200 min" in its comments is
stale), the core lane 83-139 min. On the tails the owner picked the pilots download (one latest.json writer).

## Built (all DARK; nothing changes until a flag moves)

| flag | where | what |
|---|---|---|
| `FAR_EDGE_HOLD_PREFER_MID` | Render env, '0' | `far_edge_hold`: the newest 2-deg `global_mid` frame inside the bound first |
| `FAR_EDGE_HOLD_BEFORE_UPSTREAM` (+ `FAR_EDGE_HOLD_UPSTREAM_MIN_RES` 2.0) | Render env, '0' | past the tail, the hold before Step 3.7's preview, before a cached upstream grid (Steps 1-2) and before Step 4's fetch, whenever that fetch would be coarser than 2 deg; finer boxes keep the live fetch |
| `GFS_WORLD_FULL_HORIZON` | repo variable, read by forecast-ingest.yml AND forecast-ingest-pilots.yml, '0' | GFS world tiers (global_coarse, global_mid) NOAA-direct to f384; the flagship pass downloads once and `trim_points_to_days` cuts every regional tile back to 14 d; open-meteo fallbacks (bill > 14 d as extra calls) and the ICON/EURO ceilings unchanged |
| `FRAME_TAIL_DOWNLOAD` (+ `_MAX` 240) | repo variable, pilots publish step, '0' | `publish_frame_images.TailDownloads`: ICON/EURO `global_mid` estimated entries not on disk are fetched from `weather-products` (changed ones only) and go through the same run check and parity gate; wire bytes reported |

All four registered or declared where they flip; `tests/test_day14_end.py` (22 tests) pins them, mutation-checked (trim off,
prefer-mid ignored, the resolution floor removed: each kills tests).

## Offline proof

- Publisher, synthetic store of GFS / ICON / EURO x waves, swell_1, swell_2, wind_waves (2,155 products), runner disk WITHOUT
  the 153 core-lane tails (ICON swell_1 59, wind_waves 59, EURO waves 35): flag off = those 153 `not_local` (as live); flag on
  = **every set fully built, 0 not_local, 0 refused, 0 parity_bad**, 153 downloaded (253.6 MB uncompressed offline).
- `scn_static_parity.mjs` over that CDN against the real backend: **0 bad of 27,522,136 nodes, 1,832 comparisons, 8 sets**
  (EURO waves 99/99, ICON swell_1 and wind_waves 115/115 built).
- Hold A/B, two synthetic backends (off :4137 / on :4138, separate stores, upstream lane answered with the synthetic field),
  10 h past the tail: GFS world 37 x 17 preview or 19 x 9 upstream -> **181 x 83 = 15,023 nodes, held, `is_estimated`,
  `far_edge_hold:+10.0h`**; GFS 60 x 60 deg box 19 x 9 / 13 x 13 -> the same 2-deg hold; a 10 x 10 deg box keeps its 1-deg
  live grid (by design); ICON / EURO the 2-deg hold. Raw rows: the session's scratchpad `hold_probe.json`.
- Backend chain lane locally: 2,923 passed; the 16 failures are all `test_local_forecast_recovery.py` (`logfire` absent from
  this machine's venv, one of the 5 declared packages absent), not this change. Floor re-derived with `rederive_floor.py`
  (chain 2,927 -> 2,949, files 179 -> 180; this PR must read 2,955).

## Owed / not done

- No frontend change (the tail frames are picked by the existing `pickIndexFrame`, estimated after authoritative), so no Jest,
  eslint or build run was needed for this PR.
- Wire cost of `FRAME_TAIL_DOWNLOAD` on the authenticated object endpoint is unmeasured (public JSON came back brotli 20x;
  the step summary's `__tail_downloads__.wire_bytes` measures it on the first run).
- Live read-backs after each flip (one short world probe at now + 336 h per model, health before/after).
- Still open, not in scope: while DRAGGING, a world series page with missing tail hours keeps the old view
  (`marineSeriesStatic.js:122-133`, `useMarineOrchestratorScrubCache.js:138-141`); Step 3.7's preview labels a held tail
  frame authoritative at narrow boxes past the tail.

## Flip and read-back, 2026-10-25 (#548 merged 06:23Z)

Owner, 2026-10-25: "Yes, set GFS_WORLD_FULL_HORIZON=1 now, log the flip, and do the now+336 h read-back after the next
ingests." Set 18:09:17Z (`gh variable list`), ledger `claude--day14-flip.jsonl:1`. The core run already in progress
(40213217992, started 16:45Z) kept 14 d.

| reading | GFS world frame indices (CDN) | /grid GFS world at now + 336 h | health |
|---|---|---|---|
| before, 18:13Z | run 06Z, 113-119 entries, last lead **336 h** (2026-11-08T06Z) | ask 2026-11-08T18Z: open-meteo `viewport_...` **19 x 9 = 171** vectors | healthy / healthy |
| after, 22:10Z | run 12Z, **129 / 129 built** in all four layers, last lead **384 h** (2026-11-10T12Z) | ask 2026-11-08T22Z: `global_mid` **181 x 83 = 15,023** vectors, native (`is_estimated` false), served 21Z; waves and swell_1 | healthy / healthy |

The runs that carried it: core 40224293278 (19:04Z, success) logged `GFS_WORLD_FULL_HORIZON: 1` and a GFS-Wave world fetch
of 129 steps to 2026-11-10T12Z, `truncated=no`, 393 s; pilots 40231621851 (20:37Z, success) the same 129 steps in the
flagship pass, which stayed ONE pass (3 regions: the flagship boxes + global_mid; its log names the group by its 14 d key),
523 s. Decoded CDN frames, valid ocean nodes at f000 / f336 / f384: waves 67.7% / 67.7% / 67.7%, swell_1 62.9% / 62.7% /
62.9%: full fields to the end. Ledger `claude--day14-flip.jsonl:2`. **PASS for GFS.**

Still owed from commitment 1944: ICON / EURO past their run + 336 h ceilings serve the 10-deg coarse hold until
`FAR_EDGE_HOLD_PREFER_MID` (Render) is flipped; `FRAME_TAIL_DOWNLOAD` not flipped.
