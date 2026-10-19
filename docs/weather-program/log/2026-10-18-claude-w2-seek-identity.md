# W-2 one seek identity (scrub audit 2026-10-18)

Session opened 2026-10-19T03:01Z (2026-10-18 23:01 EDT), started by the scrub-audit session to implement handoff W-2 of the
independent scrub audit (untracked report `docs/audits/2026-10-18-weather-scrub-audit/REPORT.md` in the
`audit-scrub-2026-10-18` worktree, §4, §7 and `evidence/lane-temporal.md`). Branch `claude/unruffled-bartik-d6315b`
from dev `d8614c36e`. Client-only. **No served number changes** (no SCOREBOARD row): every fix is a client race or a
diagnostic record, shipped ON with its own `window.__RAW_DISABLE_*__` kill switch (owner, 2026-10-19 03:07Z: "implement
these with everything turned on. We can kill switch anything that doesn't work, after testing"). `mid_res_tier` and
`grid_resolver` are untouched (Codex owns exact-time selection).

## What changed

| Audit id | Defect (code-proven by the audit) | Fix | Kill switch |
|---|---|---|---|
| T-01 | `ForecastWheel` cleanup cancelled the coast/settle rAF only: on unmount (mobile sheet collapse, layer off) or a redraw mid-coast (`max`, theme, radar), the final commit and `onScrubEnd` never ran, so `window.isScrubbingTimeline` stayed true and every pan/zoom marine fetch, wind moveend, autoplay tick and the settle net dropped until the next drag | the cleanup finishes an open gesture (commit the detent under the wheel + `onScrubEnd`); a redraw mid-DRAG leaves the drag alone | `__RAW_DISABLE_WHEEL_FINISH_ON_CANCEL__` |
| T-03 | the fetch core's non-abort error catch checked the hour only, so a detached request from the previous model that threw after a switch ran `setMarineData(prev => other model ? null : ...)` and blanked the new model's frame | the catch acts only for the newest request (or a pre-dispatch failure, id 0) whose model, layer and hour are still selected (`marineSeekIdentity.marineErrorOwnsDisplay`) | `__RAW_DISABLE_MARINE_ERROR_IDENTITY__` |
| T-06 | the render-parity record compared the hour only: the old model's frame HELD through a switch read `parity: true` and the selected-point card sampled it under the new button (F-03, ~4 s measured) | the record also requires the drawn model (resolved the way the fetcher resolves it past a model's horizon) and layer; reason `model_layer_mismatch`. The heat-map STATUS global keeps its hour-only rule on purpose: a status written at a switch sticks on `MapForecastOverlay`'s memoized badge (T-05, pinned by `WebGLMarineLayer.parity.test.js`) | `__RAW_DISABLE_PARITY_IDENTITY__` |
| T-02 | wind's drag path is cache-only and the wheel dedups its release commit, so a final hour that missed mid-drag was never fetched (particles stayed on the pre-drag hour) | an in-drag miss is remembered; `timeline_scrub_end` re-runs wind's normal settle path once for it (`windScrubEndSettle.js`) | `__RAW_DISABLE_WIND_SCRUB_END_SETTLE__` |
| F-02 | "stranded hour" | **no client change: not a data defect** (below) | n/a |

## F-02 is label-only (measured)

Offline harness (real backend over synthetic 3-hourly GFS+ICON, `--thin-bounds 1`, headless system Chrome, the audit's
`scn_scrub_audit.js`), live-like latency `LAT_SERIES=2500 LAT_GRID=500`, seek +1 h right after activation.
Reproduced on the unfixed bundle 2/2: wheel "+1 hour", engine grid labelled hour 0 for 20 s, no `/grid` for +1 h.

But the field on screen is the forecast for +1 h. The committed frame is the hour-0 bootstrap frame (valid 03:00Z);
with the now-anchor at 03:00, +1 h asks for 04:00, which the manifest snaps to the same 03:00Z product, and the
render-parity record already reads `parity_match` by instant (`marineHourInstant.js`, the #267 rule). In the
zero-latency run the exact fetch for +1 h asked `valid_time=03:00Z` and drew **byte-identical** texture data (FNV
`52c8c760`, the same hash the "stranded" run holds). The re-arm the handoff asked for already exists: every non-coarse
series page landing fires `marine_series_revalidated`, which re-runs the settle check within 60 ms, and that check
correctly declines because the drawn instant already serves the hour. Forcing a refetch would re-download identical
bytes on the 1-CPU box. The real gap is the LABEL ("+1 hour" over a frame labelled 03:00), which is W-1's honest
time readout.

A/B at the same anchor (the page clock shifted -1 h so both builds run at anchor 03:00; a first comparison an hour
apart was confounded, since at anchor 04:00 +1 h snaps to 06Z and the ordinary settle path fetches it): unfixed and
fixed bundles behave identically, 4/4 runs, +1 h holding `52c8c760` and the only `/grid` requests 03Z (activation)
and 06Z (+2 h).

## Race (harness, the audit's race phase: keys 48 -> 6 -> 72 -> 18, older requests delayed longer)

Final resident texture vs a direct seek to 18 in a fresh page (`e54d5f47`): unfixed bundle 10/10; fixed bundle 9/10
then 10/10 (19/20). The one miss was the first, cold browser launch of the first batch: it ended on the thinned world
series frame labelled 17, valid 21Z, the same product +18 h snaps to at that anchor, without the exact `/grid` 21Z
upgrade inside the 12 s window while three older `/grid` requests were still held by the injected 4-7 s delays. None
of the four changes touches that path (the far-zoom exact upgrade, F-01 / W-3); it did not recur in the next 10.
Recorded, not explained.

## Tests

New: `useMarineDataFetcherCore.race.test.js` (R-1 out-of-order 48/6/72/18 through the REAL `updateMarineGrid`, the
first test to drive it with deferred responses; R-2 stale error after a model switch), `ForecastWheel.unmount.test.js`
(R-3), `__tests__/weatherEngine.scrubEndSettle.test.js` (R-4 wind final hour), T-06 cases in
`marineRenderParity.test.js` (R-5), `marineSeekIdentity.test.js`. Red before / green after: with the four modified
sources reverted to dev, 10 tests fail (every defect case of R-2..R-5; R-1 is a pin and passes on both, matching the
audit's 6/6 race result); restored, 76/76 pass. Each kill-switch test reproduces the old defect. Source pins updated
for the new code: `marinePausedChurn.test.js` (the parity line), `windDarkRules.test.js` (the new wind kill is
classified as delivery, not drawing). Full `src/components/map` + `src/tests` + `src/__tests__`: 400 suites,
5,378 tests, all passing on the committed tree (2 source-pin failures in the first run, fixed by the pin updates). `check_eslint.js` and `loc_ratchet.py` pass (`useMarineDataFetcherCore.js`
965 of its 966 baseline).

## Not covered / follow-ups

- T-04 (wind keyboard/autoplay fetches unabortable, undebounced) is outside W-2 and still open; R-WIND-SEQ's in-flight
  count would fail on it.
- T-05 (badge memo lag) still open; it is why T-06 stops at the parity record.
- The wheel unmount and the wind scrub end were proven in Jest, not in the browser harness (it drives waves only and has
  no mobile sheet collapse).
