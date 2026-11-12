# 2026-11-12 · claude (opus design lead) · WAVES_ANIM_DOMINANT_SWELL registration and census

Gap map move 2 (`log/2026-11-12-advisor-sota-gap-map.md` on #787), assigned by the director session. Offline only.
Branch `claude/waves-anim-dominant-swell-register` from `dev` `a7c41dd2a`.

## What was done
- Registered `WAVES_ANIM_DOMINANT_SWELL` in `_RATING_FLAGS` (default `'0'`, the code default; where-to-flip names the
  repository variable that reads 1). No value changed anywhere.
- Added a guard test: one repo variable of the flag's own name in both ingest lanes, the same `'0'` fallback, equal to the
  normalizer's default and the registry's, never in precompute. Mutation: registry default set to `'1'` -> the test fails.
- Wrote `backend/scripts/dominant_swell_anim_census.py` and ran it once (numbers in DECISIONS D-070).
- DECISIONS D-070 (proposed): records the state and the census; leaves the value to the owner.

## Census command
`python scripts/dominant_swell_anim_census.py --spots <120 lat,lng lines> --days 3 --step 6` (2 min 55 s).
Spot sample: `surf_spots`, up to 4 per 15 x 30 deg cell, ordered by md5(id), read-only SQL. 27 spots had no sea state
at the nearest GFS-Wave sea cell (Open-Meteo returns zeros there, e.g. Pipeline's cell); they are excluded, not imputed.

## Limits
- Sensitivity, not skill: no truth for a partition direction exists in our instruments.
- GFS only. ICON stamps too; not run. The §5i availability gate is assumed met (GFS carries partitions everywhere).
- Open-Meteo's GFS-Wave is the same model our NOAA ingest reads, not our stored products.

## 12:40 EST: the heavy-session measurement for #815 (per-account limits)

Owner, 11:47 EST, relayed by the verifier: "also do the heavy-session measurement before the flip, we can increase the limit a little bit if needed".

**Method: OFFLINE ONLY; nothing reached the live box.**

- **Setup:**
  - **App:** the #815 build (`f427abcb0`; #782 + #783 + #815 combined) served by `serve_spa.js` on :3170.
  - **Backend:** `serve_synthetic_selector.py` on :4170, run with `--models GFS,ICON,EURO --layers waves,swell_1,swell_2,wind_waves,wind --regions florida_east_coast --dynamic 1`. That is the real backend app over a synthetic store with 115 frames per set.
  - **Frames CDN:** a local static host on :4190, serving `publish_frame_images.py --only frames` output (141 sets).
- **Harness:** `frontend/scripts/offline-backend/scn_account_rate_session.js`, built on `ab_lib`.
  - **Routing and audit:** every `/api/weather/*` GET goes to the local backend, and everything else is stubbed. Host audit ok: only fonts.googleapis, fonts.gstatic and cdn.jsdelivr left the machine.
  - **Account:** one signed-in premium user. The second tab is the same account.
- **What counts as a request on each lane:**
  - **reads:** the limiter's lane is `/grid_series`, `/grid`, `/point`, `/spot-ratings`, `/point-rating`, `/spot-series/*`, `/point-tide` and `/wind_lane`.
  - **frame-urls:** one per run-index load from the CDN. With `FRAME_ENTITLEMENT` on, the signer asks `/frame-urls` exactly once per index load (`staticFrames.loadIndex`), so this is an exact proxy.
- **Phases, in one continuous 12.7 min session:**
  1. cold `/map` load;
  2. scrub all 14 days (`ArrowRight` ×336 then back, ×3);
  3. the same with static frames killed, so every hour falls back to `/grid` (the worst case);
  4. a reload;
  5. every model × every layer chip (15);
  6. 2 min of drags and wheel zooms over Florida;
  7. 5 right-click point taps;
  8. a second tab, both tabs scrubbing at once;
  9. a reload and a scrub.

**Result: `session1.json` (scratchpad); the trace summary is in #815's description.**

| lane | total | peak in any 10 s | peak in any 60 s | bucket at the shipped numbers: minimum tokens left | refused |
|---|---|---|---|---|---|
| reads | 295 | 24 | 52 | 591.8 / 600 (98.6%) | 0 |
| frame-urls | 11 | 3 | 5 | 56.8 / 60 (94.7%) | 0 |

- **Reads by phase:**

  | phase | reads |
  |---|---|
  | scrub | 83 |
  | scrub on `/grid` only | 88 |
  | layers | 38 |
  | two tabs | 29 |
  | reload + scrub | 29 |
  | pan | 16 |
  | taps | 10 |

- **Index loads by phase:** layers 4; cold load, two tabs and the last reload 2 each; the first reload 1.
- **The client coalesces a scrub:** 2,016 key presses produced 83–88 reads.

**Decision:** the rule is to raise a limit only if a bucket goes below 25% of capacity or a request would be refused. Neither happened, so the limits stay at 600 / 2 per s and 60 / 0.1 per s.

**Caveat:** Playwright pressed keys at about 10 per second, not the ~30 per second of a held key. Even three times this session's peak (156 reads in 60 s) leaves the read bucket above 70%.
