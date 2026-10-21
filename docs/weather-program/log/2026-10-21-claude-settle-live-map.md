# The scrub-settle check sees the live map at a layer's first load (2026-10-21)

Session opened 2026-10-21 ~03:00Z, started by the request-diet session (`local_8fb65c27`, PR #426), whose log
(`log/2026-10-20-claude-request-diet.md` section 6) names this follow-up. Task: give `checkScrubSettle` the LIVE map, decide whether
the settle listener effect should also re-run when a marine layer switches on, prove it in the offline visual lab (never the live
backend), ship ON with a kill switch if client-only, one draft PR against `dev`. Branch `claude/gifted-williamson-c96418` from `dev`
448deb35c. **No served number changes** (no SCOREBOARD row): the settle check's existing branches request and draw the same products;
they now run with a map. Offline throughout: the real backend over synthetic data on :4197 (`serve_synthetic.py --thin-bounds 1
--dynamic 1 --models GFS,ICON,EURO --layers waves,swell_1,swell_2,wind_waves,wind --regions flagship`), the bundle on :3197
(`REACT_APP_ICON_STORED_TAIL=true`, as the dev deploy builds it, and as #426's lab ran). Evidence:
`docs/weather-program/evidence/settle-live-map-2026-10-21.json`. Draft PR #429 (code commit `ed3b7881e`); ledger seq 1558
(`pr_open`) and 1559 (the live read-back commitment, due 2026-10-28). Both follow `dev`'s 1557, as #426's 1558-1559 do on its branch:
whichever of the two merges second re-chains its lines. STATE.md is left to the merge receipts (a draft changes no served state).

## 1. The two defects (read in code, then traced)

- **Stale map.** `useMarineScrubSettle`'s `checkScrubSettle` is `useCallback(..., [marineData])`. Until a layer's FIRST marine commit
  `marineData` does not change, so the callback holds the `mapInstance` of the render before the map existed: null. Every branch of
  `runScrubSettleCheck` then sees no map: `detectClamp` returns no clamp, `tryExactUpgrade`'s `isWideView` throws inside its try and
  reads "not wide", the §2b zoom-out recovery is skipped (`mapInstance &&`), and the SERIES-FIRST lookup (`mapInstance.getBounds()`)
  throws inside its try, so the check falls through to `updateMarineGridRef.current('timeline_scrub')`, a `/grid` fetch, instead of
  committing the series frame that has landed. After the first commit the callback is rebuilt with the current map, so the window is
  exactly "a layer's first load". The listener effect's `handleScrubEnd` and its 150 ms interval call the same memoised callback.
- **Unarmed listeners.** The effect that registers `timeline_scrub_end`, `marine_series_revalidated` and `moveend` returns early while
  `activeMarineLayersRef.current` is false and re-runs only on `[mapInstance, marineData, checkScrubSettle]`. A layer switched on after
  the map exists (every lab flow, and any user who opens the map and then picks Waves) changes none of them, so until that layer's
  first commit no listener ran the check: in arm A of every load trace below, no settle check ran at all between Waves and the first
  commit.

## 2. What changed (`frontend/src/components/map/marineSettleLiveMap.js` documents both)

| Part (kill `window.__RAW_DISABLE_<NAME>__ = true`) | Where | What |
|---|---|---|
| `SETTLE_LIVE_MAP` | `useMarineScrubSettle.js` (a ref synced in render) + `runSettleCheckLive` | the memoised check reads the map of the current render, the same object once the map exists; kill: the memoised map again AND the listeners unarmed (the whole old behaviour; section 4 says why) |
| `SETTLE_ARM_ON_ACTIVATE` | `useMarineScrubSettle.js` (`settleArmKey` in the listener effect's deps) | the effect also depends on whether a marine layer is active, so switching one on attaches the listeners; kill: a constant key, the old deps exactly |

- **Trace (both arms):** `window.__MARINE_SETTLE_CHECK__ = { calls, counts, recent }`, keyed `'<map>|<outcome>'`: map `live` (the
  memoised map was null or older and the live one was used), `same`, `closure` (kill set), `none`; outcome = the first commit lane
  (`commit:series_settle`, `commit:recovery_2b`, `commit:series_sharpen`) or fetch reason (`fetch:timeline_scrub`,
  `fetch:clamp_resharpen`, `fetch:exact_upgrade`) the check produced. `runSettleCheckLive` wraps the commit and fetch callbacks only
  to note the first one called; it hands everything through unchanged (pinned by a test). A check made while the memoised map is
  null also logs one `[SETTLE-LIVE]` console line (a handful per layer activation at most).
- **LOC:** `useMarineScrubSettle.js` was at 797 of 800. The backstop's pure watchdog predicates (`evaluateStrandedPending`,
  `evaluateMarkerWedge`, `recordMarineFreeze`, `evaluateClampCapProbe` and their constants, 85 lines) moved VERBATIM to
  `marineSettleWatchdogs.js` (script-checked byte-identical to `dev`'s lines 130-214; the only edit is `export` on
  `recordMarineFreeze`, which the backstop still calls) and are re-exported, so every existing import keeps working. The hook is now
  722 lines; the diff that remains in it is 17 lines. The edits sit away from #426's three hunks in the same file (it inserts after
  the `frameServesSelectedHour` import, in the pending branch, and after `useMarineExactUpgrade(...)`).
- **Instrument:** `frontend/scripts/visual-lab/settle_trace.js` (load-phase trace: every settle check with the map it read and what
  it did, first draw, first non-thinned frame, requests by START, the settle branches' counters; arms interleaved on one bundle;
  `SCN=open|open_pan|open_regional`; `FAIL_GRID=1` answers every marine `/grid` with a 502).

## 3. Load-phase trace, normal backend (`settle_trace.js`, A = both kills, B = the PR, interleaved A1 B1 A2 B2 A3 B3)

Latency injected per reply: `/products` 6 s (a cold box, as #426's cold-box load), `/grid_series` 2.5 s, `/grid` 1.5 s; 20 s after
Waves is clicked. Times are ms after the click. The machine was shared with other sessions' labs and builds throughout.

| scenario | first draw A (runs; median) | first draw B | settle checks before the first commit A -> B | what B's extra checks did | requests started per open A -> B |
|---|---|---|---|---|---|
| `open` (world view) | 10.1, 9.7, 12.2 s; 10.1 | 10.9, 9.9, 9.8 s; 9.9 | 0 -> 2, 1, 1 | all `live|none`: the pending-`/grid` bypass (`pending=1`) | `/grid` 1 -> 1, series 3.0 -> 3.3 |
| `open_pan` (pan 1.5 s after the click) | 9.6, 10.1, 10.9 s; 10.1 | 10.1, 11.3, 11.2 s; 11.2 | 0 -> 3, 4, 4 | all `live|none`, `pending=1` | `/grid` 1 -> 1, series 4.0 -> 3.3 |
| `open_regional` (zoom 7.5) | 12.1, 12.8, 12.1 s; 12.1 | 13.3, 14.0, 11.7 s; 13.3 | 0 -> 1, 1, 1 | all `live|none`, `pending=1` | `/grid` 2.3 -> 2.0, series 3.7 -> 4.0 |

- **The settle branches now see a map at load:** every check B made while the memoised map was null read the live map (`live|…`);
  arm A made none at all in that window (its listeners were not armed).
- **First draw is the `/grid` in every run of both arms** (lane `manual`); the `/grid` waits for `/products` (#426's 4b, unchanged),
  so the check that runs at the series landing finds the activation fetch pending and returns at the bypass, as on `dev` after a
  commit. Without #426's paint-while-pending, this PR therefore draws nothing sooner on a healthy load.
- **New re-drives at load: 0.** Every B check before the first commit ended at the bypass (no commit, no fetch, no series request).
  After the first commit both arms run the same code with the same map: `open_regional`'s clamp re-sharpen (`series_sharpen` commit
  + one capped `clamp_resharpen` `/grid`) fired in both arms (A 3 commits / 2 fetches, B 3 / 3 over three runs).
- Request mixes are structurally identical per run (world 48-frame page, the 1-frame mini, the `/grid` after `/products`, the next
  48-frame page; a 17-frame background page near the end of the window appears in either arm by timing).
- B's median first draw was 1.1-1.2 s later in `open_pan` and `open_regional` and 0.2 s earlier in `open`; the ranges overlap and the
  checks B added did nothing but return. Re-measured on the final bundle in section 6.

## 4. Load-phase trace, every marine `/grid` failing (`FAIL_GRID=1`: the synthetic backend's reply replaced by a 502)

The settle check's job when the exact frame cannot be had is to draw the series frame that did land. `/products` 1.5 s, series 2.5 s.

**A vs B, 3 runs per arm (interleaved):**

| scenario | A: first draw | A: `/grid` per open | B: first draw (median) | B: `/grid` per open |
|---|---|---|---|---|
| `open` | **never** (20 s) | 4.0 (the activation fetch + 3 settle retries, each `none|fetch:timeline_scrub`) | 4.6, 5.9, 5.1 s (5.1), lane `series_settle` | 1.0 |
| `open_regional` | **never** | 4.0 | 5.0, 4.9, 5.1 s (5.0), lane `series_settle` | 3.0 |

- In A every check the backstop drove read no map, so SERIES-FIRST threw inside its try and the check started another failing `/grid`
  until its 3-retry cap: a blank heat map with the series frame in hand. In B the first check with no fetch pending drew it.
- `open_regional` B: after that commit (a world frame at zoom 7.5) the existing clamp machinery fires, as it does on `dev` whenever a
  frame is resident: `clamp_resharpen` twice per open (its cap: 2 per viewport, hour, model and layer) and the backstop 3 times. These
  are the re-drives that "silently no-op'd" before; bounded, and the `/grid` total per open is still lower than A's (3 vs 4).
- One B `open` run started 3 `/products` (the other five runs 1); not seen in A, where nothing ever commits.

**Isolation, 4 arms x 3 runs** (A both kills, M = live map killed only, C = arming killed only, B both on; interleaved A M C B):

| scenario | A | M | C | B |
|---|---|---|---|---|
| `open`: first draw (median) / `/grid` per open | never / 4.0 | never / 4.67 | 7.4 s (backstop) / 1.0 | 5.6 s (series-landing listener) / 1.0 |
| `open_pan`: first draw (median) / `/grid` per open | never / 4.67 | never / 5.0 | 9.3 s / 2.67 | 9.4 s / 3.0 |

- **The live map is the fix; arming is only safe with it.** C alone draws (via the 3 s blank backstop). M alone is WORSE than `dev`:
  the armed listeners re-drive a check that still has no map, so it starts more failing `/grid` fetches (12 and 19 null-map checks
  over the three runs of `open` and `open_pan`, 9 of them `none|fetch:timeline_scrub` in each) and still draws nothing. With both, the series landing itself triggers the draw
  (open: 1.8 s sooner than C); while a pan keeps a refetch pending, B and C both draw at the backstop (equal).
- **Decision:** both parts ON. The live-map kill also disarms (`settleArmKey` returns its constant under either kill), so the one
  kill `__RAW_DISABLE_SETTLE_LIVE_MAP__` restores the old behaviour whole and the harmful M combination cannot be reached through
  the kills; `__RAW_DISABLE_SETTLE_ARM_ON_ACTIVATE__` alone gives C. Made after these runs; arms A, B and C behave the same under
  the new rule (A set both kills), and section 6 re-runs A as the single live-map kill on the final bundle.

## 5. Visual lab A/B (PR #426's `lab.js` at `4a70989e8`, run unmodified against this branch's bundle)

`dev`'s `lab.js` has no `open_waves` flow and no `exactMs`; #426's does, and it changes nothing the app runs (its client code is not
in this bundle). One bundle, A = `LAB_KILLS=__RAW_DISABLE_SETTLE_LIVE_MAP__,__RAW_DISABLE_SETTLE_ARM_ON_ACTIVATE__`, B = none; per
round A-open, B-open, A-flows, B-flows, three rounds. `open_waves`: `LAT_PRODUCTS=6000`; `erratic` + `pan_zoom_future`:
`LAT_PRODUCTS=1500`; series 2.5 s and `/grid` 1.5 s in both. `LAB_CONSOLE` kept the settle lines per flow.

| flow | requests started per run A -> B | sum of per-step medians, correct / exact | never correct / never exact (steps x runs) |
|---|---|---|---|
| `open_waves` | `/grid` 1 -> 1, series 2.7 -> 3.0, `/products` 1 -> 1; first draw 14.3, 17.7, 13.8 s -> 13.9, 15.6, 14.3 s (median 14.3 -> 14.3 s) | n/a | n/a |
| `erratic` (17 steps) | `/grid` 18.7 -> 18.3, series 30.3 -> 30.0, `/products` 1 -> 1 | 56.3 / 54.0 s -> 54.7 / 53.2 s | 2 / 9 -> 1 / 7 |
| `pan_zoom_future` (5 steps) | `/grid` 5.0 -> 5.0, series 8.3 -> 8.0 | 6.1 / 6.1 s -> 5.7 / 5.7 s | 1 / 1 -> 1 / 1 |

- Per step (`erratic`): of the 12 steps that take seconds, B's median time to the correct frame is lower on 6 and higher on 6, by up
  to 2.1 s either way (the per-step table is in the evidence file); the never-exact steps (`Wind Waves`, `+153h`) are never exact in
  either arm.
- Settle lines per run: `[SETTLE-LIVE]` 0 -> 1.0 (`erratic`), 0 -> 1.3 (`pan_zoom_future`, `open_waves`): the one or two checks at the
  layer's first load, each a pending bypass. One B `pan_zoom_future` run logged a "Triggering fetch" at `+3h after zoom` and one a
  render backstop at zoom 8; both are after the first commit, where both arms run the same code with the same map (A logged a
  "Triggering fetch" in one `erratic` run the same way): timing against the pending fetch, not this change.

## 6. Final bundle (head after the kill rule changed; A = `__RAW_DISABLE_SETTLE_LIVE_MAP__` alone)

Rebuilt at WIP commit `8ed9571cb` (squashed into the PR's commit; `git diff 8ed9571cb <PR head> -- frontend/src` is empty), same
servers, interleaved A1 B1 ...:

| scenario | A: first draw (runs; median) | B: first draw | `/grid` per open A -> B | B checks before the first commit |
|---|---|---|---|---|
| `open_pan`, `/products` 6 s | 11.0, 11.6, 10.5 s; 11.0 | 10.7, 11.1, 10.5 s; 10.7 | 1 -> 1 | 3, 3, 3, all `live|none` (bypass) |
| `open_regional`, `/products` 6 s | 14.4, 15.6, 17.0 s; 15.6 | 14.2, 12.7 s, and one run past the window | 2 -> 1.67 | 1, 1, 1, all `live|none` |
| `open`, every `/grid` failing | never, never (4 `/grid` each) | 5.3, 7.0 s, lane `series_settle` (1 `/grid` each) | 4 -> 1 | 1, 1 (the one that drew) |

- The 1.1 s gap of section 3 does not repeat: B's median is 0.3 s lower in `open_pan` and lower in `open_regional`.
- **B3 `open_regional` drew nothing inside its 20 s window; the machine, not the change:** `/products` took 10.1 s (6 s injected), the
  `/grid` started at 15.8 s page time and took 9.3 s (1.5 s injected: 7.8 s of server time, against 1-3 s in the other runs), and the
  engine held its grid at 26.2 s, 0.9 s after the window closed. That run's one settle check was a pending bypass (`live|none`); A3,
  just before it, was also slow (17.0 s). Recorded as measured, not dropped.
- A as the single live-map kill reproduces section 4's A exactly (never draws, 4 `/grid`), so that kill alone restores `dev`.

## 7. Checks

- Jest, in a dot-free mirror of `frontend/` (CRA's Jest finds no tests under `.claude/worktrees/`), `node_modules` junctioned from the
  main checkout (same lockfile md5): the whole tree (`src`, all three test folders) **457 of 461 suites** on the first head; the 4
  others read repo-root files the mirror lacked (ENOENT); with those files copied beside it 3 pass and `netlifyIconStoredTailScope`
  times out spawning Git Bash on this loaded machine (`spawnSync bash ETIMEDOUT`, 12 tests; it exercises `netlify.toml` shell lines,
  untouched here; hosted CI is the authority). On the final code (`8ed9571cb`, fixture files beside the mirror): **460 of 461
  suites, 6,107 tests**; the one failure is that suite again, all 12 tests on `spawnSync bash ETIMEDOUT`.
- New suite `marineSettleLiveMap.test.js` mounts the REAL hook, brings the map in after mount and fires `marine_series_revalidated`;
  each kill is the control arm of the test that pins its part. Mutation check in the mirror: dropping `settleArm` from the effect's
  deps fails 1 test; handing the check no live ref fails 3; restored byte-identical (sha256 compared).
- `node scripts/check_eslint.js`: exit 0, no rule over its baseline. `python scripts/loc_ratchet.py`: no new violations
  (`useMarineScrubSettle.js` 722). `craco build`: compiled with warnings, as `dev`.
- Three themes x desktop/mobile, ARIA: no UI, CSS, theme or layout code changed; every theme and layout reads the same settle hook.

## 8. Limits and follow-ups

- Synthetic data, injected latency and an injected failure, on a shared machine: a lead for the real app until read there. The
  machine-noise caveat matters for the 1 s-scale differences in sections 3 and 6, not for the failure case (no picture vs a picture).
- On a healthy load this PR alone draws nothing sooner: the check now runs at the series landing with a map, but the activation
  `/grid` is pending and the check yields to it. #426's `SERIES_PAINT_WHILE_PENDING` is the part that draws there; it carries its own
  workarounds for both defects (`ctx.mapInstance || window.map`, its own `marine_series_revalidated` listener). With both merged the
  fallback and that listener are redundant (harmless: #426's `_lastPainted` guard commits once when two listeners fire for one
  landing); removing them is a cleanup for whichever PR merges second. A combined build (`dev` + #426 + this) was not replayed.
- Live read-back owed after merge and deploy (one owner map load, never a scripted replay): ledger commitment below.
