# 2026-10-26 claude (mid-zoom session): the rating band lingers after OFF; the 18 s wedge

Task (lead, from the owner's live test at 12:40Z, bundle 4e004446 which includes #581): "the surf rating band stays on for a few seconds, when
its turned off." Console: `[Abort-Gate] Preserving high-priority fetch (timeline_scrub) against low-priority request (flavor_toggle)` (x3),
`[Release] Releasing active fetch (flavor_toggle_pending) ... for new source=flavor_toggle`, `[Marine] Stranded fetch-pending released (idle 18.0s ...)`.

## What the code does (read, then reproduced offline with `scn_band_toggle.js`)
1. THE LINGER (render). The Surf toggle flips `window.__SURF_MODE__` and dispatches `rawsurf:surf-toggle`. The engine's REVERSE gate
   (`WebGLMarineEngine`, round-8) keeps painting the resident as the band while the flag is OFF and the resident is still a RATING grid, because a
   rating grid's height channel holds SCORES (`score/10`), so the honest ramp over it is garbage. The band therefore stays until an honest grid commits.
   With a cached honest frame that is ~50-250 ms (the flavor cache fast path); with the band on since load there is no honest frame in the
   cache, so it waits for the toggle's own backend round trip (offline: a held /grid at z8 = 3.7 s; the owner's cold ICON at z5 = seconds).
   A rating resident cannot be drawn "as plain waves": there are no wave heights in it. The honest local source is the coarse base wash that already
   draws under the band (the "trade places" machinery of `resolveRatingBandFade`).
2. PRIORITY (fetch). `enqueueMarineUpdate` / `updateMarineGrid` rank `flavor_toggle` below an in-flight `timeline_scrub` (the gate's `isHighPriority`
   knew `manual`, `timeline`, `scrub` only), so the scrub's OLD-flavor fetch was preserved and the toggle was buffered/dropped behind it.
3. THE WEDGE. A release (`locks.isFetching = false`) left the released fetch's `__MARINE_FETCH_PENDING__` stamp set (a detached fetch clears it only when
   it finishes). In the owner's log the replayed `flavor_toggle_pending` fetch was released by a second toggle; when the new ask is then dropped by the
   dedupe (OFF then ON: the resident is rated and matches the flag again) the state is pending set, nothing fetching, nothing re-driving, and the
   settle check bypasses itself on a matching pending, until the stranded-pending watchdog's 18 s lease. Reproduced in Jest
   (`useMarineDataFetcherCore.flavorToggle.test.js`, kill arm). NOT shown to matter: the 1200 ms rate limiter and the 3-failure cap (a first theory,
   falsified by the kill arm, exemptions removed).

## The change (client only; no served number)
- `marineFlavorToggle.js` (new). `isFlavorToggleSource`: the toggle is high priority and SUPERSEDES an in-flight scrub (it releases it and asks for the
  current hour and the NEW flavor, which the url builder reads at request time). `releasePendingStampOf`: the stamp is cleared when its fetch is
  released (both release sites). One kill: `__RAW_DISABLE_FLAVOR_TOGGLE_PRIORITY__`.
- `resolveBandOffNow` (through `resolveRatingBandFade`, `cov.bandOff`): flag OFF + rated resident + the honest coarse wash engaged => band opacity 0
  and the wash at full strength in the same frame as the flag. Without a wash the old hold stays (a blank heatmap is worse). Kill:
  `__RAW_DISABLE_BAND_OFF_INSTANT__`.
- Band ON: paint at once if the resident is rated (unchanged); otherwise the status line says "Surf ratings loading for this view…" for 20 s after the
  toggle (`__RAW_BAND_TOGGLE_AT__`, set in the toggle handler). The instant hide is silent.

## Measured offline (dark, desktop 1280x800; one run each; rating-coloured pixels counted over the map area 60 ms after the click)
| scenario z8 | build | band painting gone (probe) | rating pixels 0 -> +60 ms |
|---|---|---|---|
| rest | dev | 153 ms | 32 497 -> 32 688 |
| rest | fix | 24 ms | 32 857 -> 22 |
| toggle during a held /grid (4 s) | dev | 5 241 ms | 33 920 -> 33 546 |
| same | fix | 22 ms | 33 622 -> 22 (the honest fine grid still lands at 3.8 s) |
| same | fix, `__RAW_DISABLE_BAND_OFF_INSTANT__` | 3 861 ms | 34 805 -> 33 896 |
| toggle mid-scrub (asks delayed) | dev | 154 ms | 31 887 -> 32 771 |
| same | fix | 18 ms | 33 534 -> 22 |
Other measured states: modelswitch z8 dev 2 264 ms -> fix 24 ms (kill arm 5 871 ms); #581's kills (`__RAW_DISABLE_BAND_RES_FADE__`, `_EDGE_`) change nothing
(rest 2/17 ms vs 9/26 ms: the hold-off legs act only while the flag is ON, so they cannot delay a hide).
Not reproduced offline: the owner's `Preserving high-priority ...` lines (the scrub arms here are fast); the priority change is pinned by Jest.
Separate, not fixed here: a model switch to EURO blanks the field for 2-4 s at z5 (the owner's "heatmap temporarily cleared when switching to Euro";
the lead's finding 3). It appears with the toggle kills on as well, so it is not this change.

## The matrix (offline, fix build, rating-coloured pixels over the map area 0 -> +60 ms after OFF; the red/orange 'very poor'/'poor' levels)
| theme | view | rest z8 | toggle during a held /grid z8 | rapid on/off x10 z8 | rest z5 |
|---|---|---|---|---|---|
| dark | desktop | 33 165 -> 22 (band gone 24 ms) | 33 530 -> 22 (19 ms; honest grid lands 3.6 s) | 31 990 -> 22 (23 ms) | no band at z5 (22 -> 22) |
| light | desktop | 39 308 -> 22 (29 ms) | 41 823 -> 22 (27 ms) | 39 385 -> 22 (30 ms) | 22 -> 22 |
| beach | desktop | 48 452 -> 22 (22 ms) | 48 419 -> 22 (20 ms) | 48 307 -> 22 (25 ms) | 22 -> 22 |
| dark | phone 390x844 dpr 3 | 112 766 -> 93 (17 ms) | 124 243 -> 93 (24 ms) | 123 658 -> 93 (23 ms) | 93 -> 93 |
| light | phone | 164 574 -> 93 (23 ms) | 167 284 -> 93 (23 ms) | 169 640 -> 93 (18 ms) | 93 -> 93 |
| beach | phone | 228 144 -> 93 (28 ms) | 228 335 -> 93 (21 ms) | 228 938 -> 93 (27 ms) | 93 -> 93 |
(The 22 / 93 left over are UI pixels; "gone" = the probe's first frame whose band opacity is 0, one to two frames after the click: the probe's rAF runs before the
engine's render of the same frame.) Every run ended with flag OFF, band off and an honest grid; 0 blank frames in all of these (the 2-4 s blank on a z5 model
switch is separate, see above). The same scenarios on dev: rest 153 ms, in-flight 3.7-5.2 s, mid-scrub 154 ms, model switch z8 2.3 s.
Phone layout observation: in the collapsed/clipped expanded sheet the Surf Rating pill was not a Playwright-visible box at this size, so the phone runs click the DOM
button (the handler is the same); worth a look at the sheet when the band pill is out of reach.
Toggle during a model switch: z8 24 ms (dev 2 264 ms). Toggle ON (from OFF): z8 R17x17 painted within 7 ms from cache; the status line covers the uncached case.

## Regressions
- #459/#465 mid-zoom instant scrub (`scn_zoom_scrub.js`, owner window, Florida z5 and z8, bundle on): 0 missed exact frames, 0 mislabel, 0 stale on dev AND fix, repeated
  twice. One earlier run (right after another harness job) showed 3-6 missed / 1 012-2 537 mislabel frames; not reproduced in 4 repeats on either build, recorded not claimed.
- #581 (`scn_rating_band.js`, `scn_rating_band_edge.js`): identical to before (2-deg grid held with the line, 63.5 % coverage held at the edge, fine grids untouched).
- Full `src/components/map` + `src/tests` Jest: 424 suites / 6 029 tests green. A second member of the load-dependent class surfaced in `marineGridSeries.regional.test.js` ('a failing bundle',
  3 page asks instead of 2 under load: the same 1.2 s page-failure retry); the retry kill is now set in `beforeEach` for the whole file (it is not under test anywhere in it).
