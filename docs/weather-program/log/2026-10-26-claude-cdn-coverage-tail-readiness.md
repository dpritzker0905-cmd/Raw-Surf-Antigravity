# 2026-10-26 — CDN coverage audit and FRAME_TAIL_DOWNLOAD readiness (static-frames session)

The lead's P0 after the owner's 12:40Z test ("Euro had delays scrubbing ... All marine layers need to be instant ... Display
correct data"). Nothing in this entry calls the serve box: the audit reads only the public frames bucket, and the tail check runs
the real app offline.

## 1. CDN coverage, every model x layer x set (waves, swell_1, wind_waves)

`latest.json` written by pilots run 40322134819 at 13:41:35Z, read 14:04Z. For each asked hour now..now + 336 h (1-h steps,
hour 0 = now rounded), the client's own rule: `pickIndexFrame` (authoritative first, nearest within +-3 h), then no pick or an
unbuilt pick -> /grid (`tryStaticWorldGrid`, `regionalPickFrom`). A regional frame counts as built when it has a bundle offset.
Script and full JSON: shared notes `owner-manual-test-2026-10-26/cdn-coverage-and-tail-readiness/`.

| set | built | static hours | to /grid |
|---|---|---|---|
| GFS waves/swell_1/wind_waves global_mid | 131/131 to 11-11T06Z | 337/337 | none |
| GFS regional, florida_east_coast + us_west_coast_socal (x3 layers) | 113/115 to 11-09T06Z | 332/337 | h332-h336 (no frame: the boxes end at 11-09T06Z) |
| GFS regional, the other 16 boxes (x3 layers) | 41/45 to 10-31T06Z | 116/337 | **h116-h336**: no frame. The client keeps the box on its regional set and asks /grid every hour, though the GFS world frames cover it (and /grid's mid tier serves those frames there) |
| ICON waves/swell_1/wind_waves global_mid and _filled | 57 (55 filled) authoritative to 11-02T00Z (run + 168 h) | 158/337 | **h158-h336**: the estimated tail, `not_local`/`stale_local` (FRAME_TAIL_DOWNLOAD=0) |
| EURO waves global_mid and _filled | 69 (63 filled) authoritative to 11-05T00Z (run + 240 h) | 230/337 | **h230-h336**: the estimated tail, `not_local`/`stale_local` |
| EURO swell_1, EURO wind_waves | no set (not in STATIC_SETS, not published) | 0/337 | **every hour**. The products bucket holds NO 2-deg EURO swell_1 / wind_waves at all (only 10-deg global_coarse: 120 and 129 files), so there is nothing to frame at 2 deg |
| ICON / EURO regional | none (GFS-only pilot tiles) | - | z7-9 inside a box: /grid |

## 2. FRAME_TAIL_DOWNLOAD readiness

**The index already chooses as /grid does.** `pickIndexFrame` (staticFrameCodec.js) is authoritative-first within +-3 h, the
same rule as `mid_res_tier.pick_mid_item`. #584's "EURO 33/34" graded each built estimated frame against /grid at the frame's
OWN valid time. The 15Z tail frame then differs from /grid at 15Z (the native 12Z), but the client never shows that frame at a
15Z ask: it picks 12Z there too. The client view is per ASK, so `day14_arms.py asks` (new) grades the frame the client's rule
picks at every whole hour across each tail (last native - 6 h to the lane end + 3 h) against /grid at that ask, node by node.

Offline run: the real app (TestClient), real CDN frames (fetch 15:22Z, NOW 15Z), and tails baked by the real core-lane jobs at
MARINE_EXT_CEILING_MARGIN_H=12 (to 11-10T00Z, run + 348 h, as live). The publisher ran with FRAME_TAIL_DOWNLOAD=1.

| set | asks | static | bad nodes / nodes | served time != picked frame |
|---|---|---|---|---|
| ICON waves global_mid | 202 | 202 | **0** / 3,034,646 | 0 |
| EURO waves global_mid | 130 | 130 | **0** / 1,952,990 | 0 |
| ICON waves global_mid_filled | 202 | 202 | 877 / 3,034,646 in 7 asks; **0 with MARINE_GULF_FILL_DONOR_SERVED_TIME=1** | 0 |
| EURO waves global_mid_filled | 130 | 130 | 210 / 1,952,990 in 7 asks; **0 with the flag** | 0 |

- `day14_pick_check.mjs` replays the client's own `pickIndexFrame` on all 664 asks: 0 disagreements with the harness.
- **The filled differences are /grid's own fill, not the frames.** In all 14 asks the client and /grid show the same frame. The
  route-level fill picks its GFS donor at the ASKED hour (e.g. 02Z asks a 00Z frame filled from GFS 03Z), while the baked frame
  uses the frame's hour (#584 finding 3; #588's dark MARINE_GULF_FILL_DONOR_SERVED_TIME fixes /grid).
- 4 of the 14 are NATIVE picks (EURO 11-04T20-22Z, 11-05T02-03Z), so today's published filled frames already differ from /grid
  this way at off-lattice asks. The tails add the same case at more hours.
- Frame-time grading (`publish`, as #584) reproduces the one mismatch per set at the first tail hour.

**Cap and budget against the run + 348 h tails:**
- **Downloads:** a core cycle re-bakes the whole tail, so every tail product is new each run: ICON 64 x 3 layers + EURO 40 =
  232 products, against the old cap of 240 (8 spare; 216 before D-053). Each product is ~2.3 MB of JSON (storage metadata),
  much smaller on the wire (gzip). **Cap -> 320.**
- **Time:**
  - The publish step took 603 s in run 40322134819 with the tails off.
  - The budget is read before each set, and the regional bundle sets run LAST.
  - Offline, a tail frame costs 0.24-0.38 s (plain/filled; downloads excluded). The tails add 464 frames (232 plain + 232
    filled): ~150 s here, more on a runner, plus the downloads.
  - At 600 s that would skip every regional set EVERY run (published once, never refreshed).
  - **Budget now follows the flag:** `FRAME_PUBLISH_BUDGET_S: vars.FRAME_TAIL_DOWNLOAD == '1' && '960' || '600'`.
  - **Step timeout 15 -> 22 min.** With the flag off, runs end where they did.

## Changes (PR)

- `frontend/scripts/offline-backend/day14_arms.py`: `asks` subcommand; GFS fetched from ICON's last native frame (the ICON job's
  targets); `--ceiling-margin` for `build` (default 12, live).
- `frontend/scripts/offline-backend/day14_pick_check.mjs`: the client's own pick, replayed.
- `forecast-ingest-pilots.yml`: budget tied to the flag, step timeout 22, cap default 320. `publish_frame_images.py`: cap
  default 320.
- `test_day14_end.py`: 2 tests (budget/timeout pin; cap covers a cycle); chain floor 2975.

## For the lead / owner

- FRAME_TAIL_DOWNLOAD=1 is speed only. Plain frames equal /grid at every ask; filled frames equal /grid once
  MARINE_GULF_FILL_DONOR_SERVED_TIME=1 (that flag moves /grid's filled cells to the frame's own hour). Flip the donor flag first
  or together, or accept the same off-lattice filled-cell differences today's native frames already carry.
- Merge this PR before the flip, so the budget and cap follow the flag. Then read back one dispatched run:
  - `__tail_downloads__` downloaded ~232, capped 0;
  - no `skipped_budget`;
  - the step time;
  - the CDN audit's ICON/EURO rows go to 337/337 up to the lane end.
- **Follow-ups, not done here:**
  - **Regional past day 5:** fall back to the world crop when the regional index has no frame in the window (client).
  - **EURO swell_1 / wind_waves at 2 deg:** an ingest question; only 10-deg exists today.
  - **Hidden ordering assumption:** a tie between two authoritative frames 3 h either side (EURO's 6-hourly natives) resolves to
    the earlier one in both paths here, by index order vs manifest order.
