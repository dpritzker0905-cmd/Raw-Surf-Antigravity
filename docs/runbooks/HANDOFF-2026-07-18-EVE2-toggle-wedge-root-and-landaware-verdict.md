# HANDOFF 2026-07-18 EVE-2 — the toggle-wedge root, and the day Florida impersonated a sim bug

**START HERE for a fresh context.** Supersedes `HANDOFF-2026-07-18-EVE-wrapmirror-coldveil-and-verification.md`
(read that second — its ⚡ PART 2/3/4 sections carry the wrap-mirror/cold-veil/stabilization arcs; note its
"wrapped-copy particles" residual is DISPROVEN below). Every claim here is probe-proven; probes live in the
07-18 EVE-2 session scratchpad (`probe_wedge.js`, `probe_wrapcopy.js`, `probe_gulfedge.js`, `trace-window.js`).

## 0. TL;DR
1. **§5b rating-toggle wedge (queue #2): ROOTED + FIXED `641c2678`.** The toggle's re-fetch rode the
   `'manual'` source, which the fetcher classifies as an ACTIVATION → the request went out with the
   **WORLD bbox** + `surf=1`. A world surf request structurally cannot return a rated grid (rating
   tiles are regional), so the unrated global coarse got no-downgrade-rejected and NO lane could ever
   supply the rated viewport tile (series pages are unrated; the flavor backstop's re-drive was
   guard-starved — its occasional survival is exactly the old "2 of 3 runs" variance). New source
   `'flavor_toggle'` keeps the live viewport → the manifest-tile clip serves the rated FL tile →
   **ENGAGED t+5 s** (was: never in 60 s). Same root fixed the toggle-OFF mid-interim (EVE "KNOWN
   MINOR"). Kill: `__RAW_DISABLE_FLAVOR_TOGGLE_VIEWPORT__`.
2. **"Wrapped-copy particles" (queue #5): DISPROVEN — it was the FLORIDA PENINSULA.** The persistent
   verdict band (cols 4-13) lives at the **z6.3–6.8 settled steps**, not the z2 tail, and under the
   correct 512-px-tile scale those columns are lng −83.4..−81.3 = land. Fixed in the TESTING SYSTEM
   `453b37c6`: zoomlab records engine-mask water ground truth per column (`probeMaskGPU`, 5 rows ×
   40 cols / 2 s → `trace.water`); the verdict excludes mostly-land bands; nightly budget tightened
   (0 persistent / 0 settled-step / ≤2 total). Old traces: byte-identical legacy mode.
3. **Nightly net: FULLY ARMED AND GREEN.** The user set `MAPBOX_PUBLIC_TOKEN` (~18:26Z); dispatch
   run `29655920874` passed BOTH jobs — data-contract 26 s ✓, zoomlab-battery 8m47s ✓ with the
   land-aware verdict live in CI (1 finding · 462 anim frames · 168 water samples · 25 land
   band-frames excluded · 0 persistent · 0 settled-step → under budget). The 06:30 UTC cron now
   guards every night (expect ~3 h GH cron drift). NOTE: the 16:45Z failed run predates the
   preflight + secret — its 20 "findings" are map-never-loaded noise; don't re-read it as signal.

## 1. §5b WEDGE — evidence chain
- probe_wedge run 1 (HEAD `228751f4`, Jupiter z9.31, settled): toggle → forensic ring
  `surf_toggle {isFetching:false}` (NOT swallowed) → net capture shows
  `/grid?...bbox=-180,-80,180,85&surf=1` → `reject_downgrade {incoming:37x17, incomingRating:false}`
  → `flavor_fastpath_miss {want:true, frameRated:false}` ×N (series lane is unrated) →
  `[rating-band] OFF` for 60 s. `flavor_backstop` recorded the CORRECT viewport key but produced no
  network request (guard-starved post-fetch).
- Root line: `useMarineDataFetcherCore` — `isActivation = source.startsWith('mount'|'load'|'manual')`;
  the toggle handler in `useMarineDataFetcher.js` enqueued `'manual'`. Activation = world-base-first
  by DESIGN (layer activation/model switch); the toggle is not an activation — the layer is live.
- Fix: `'flavor_toggle'` source (non-activation, 20 ms dispatch fast lane, degenerate-viewport retry
  list). `isActivationSource` extracted pure into `useMarineDataFetcherHelpers` + contract tests
  (`useMarineDataFetcherHelpers.activation.test.js`, world-vs-viewport bounds asserted).
- A/B: fix ON → viewport request immediately, rated 13×17 commits, `[rating-band] PAINTING ✓`,
  engaged t+5 s; kill ON → legacy `src:manual` world request returns (that run engaged t+10 s only
  because the racy backstop happened to survive — the fix removes the race dependence entirely).

## 2. THE FLORIDA FALSE POSITIVE — how it was unmasked
Three mutually confirming probes:
1. **Settled z2 world-grid probe** (probe_wrapcopy): all 40 columns animate (3–5 units in the
   suspect strip); `part_fbo` bypass-discard shows quads rasterizing across the whole screen incl.
   both world copies. No wrapped-copy deficit exists.
2. **Scale correction**: viewport at z6.49 / 1280 px ≈ **8.4°** (512-px tiles), not the 20° the EVE
   mapping assumed. Re-mapped, the dead cols = the peninsula. ⚠️ LESSON: verify `map.getBounds()`
   before mapping trace columns to geography.
3. **Parked z6.49 probe** (probe_gulfedge): quiet cols sit exactly over land; Gulf WATER columns
   animate with real heights (0.33–0.75 m from the resident grid — "too calm" exonerated); and in
   the staircase trace the resident shifted 2° west mid-window while the band did NOT move
   (screen-anchored = land, not resident-anchored = any engine edge effect).
- An engine crest-feather cap (built on the earlier wrong attribution) was A/B'd — zero measurable
  effect — and REVERTED unshipped per the standing no-unproven-minefield-changes rule. Banked: if a
  real narrow-resident crest edge ring ever appears, the DRAW pass inheriting the heatmap's
  clamp-softener-widened feather (0.18 → ~0.31 at coverage<1) is the first suspect; cap crest-only.

## 3. VERIFICATION LEDGER (this session)
- Unit: helpers 15/15 (incl. 7 new activation-contract) · engine suites 15/15 (191 tests) ·
  verdict land-exclusion 5/5 · **FULL SUITE AT CLOSE: 1164/1164** (1154 prior + 10 new).
- Live: wedge A/B both legs · z2 + z6.49 column probes · pre-cap staircase battery at HEAD
  (2 findings: the FL persistent + 1 three-frame transient; no SETTLED_STEP — the wedge fix does
  not disturb the staircase) · **LAND-AWARE STAIRCASE BATTERY: 164 water samples, 29 land
  band-frames excluded, FL persistent GONE; 1 residual water-side transient (cols 31-32, 5 frames
  ~1.7 s, lng ≈ −77.5 Atlantic, recurring across runs — the remaining watch item; passes the new
  budget 0-persistent/≤2-total).**
- Back-compat: new verdict on the 07-18 postbake trace = identical 3 findings, "legacy mode" label.

## 3b. ⚡ EVE-2 ROUND 2 — the transient rooted: crest feather DEAD RING (`45b1a715`)
The recurring water-side transient (3 consecutive batteries) = the east-edge crest feather dead
ring: a fixed-lng stripe of crest-dead WATER just inside the resident edge, between the live
interior and live ring-fill crests. Proof ×3 traces: quiet cols shift screen-position across zoom
steps exactly as fixed-lng geometry predicts (lng ≈ −79.3 vs the FL tile's −79 edge); water
truth = 1; ring-fill alive outside. (This vindicates the mechanism half of the reverted Gulf-edge
analysis — the earlier A/B camera had both edges off-screen; a SETTLED fetch serves a padded tile
whose edge never shows, so the staircase is the only reproduction vehicle.) FIX: crest-pass
feather width capped to 0.045 when ring-fill continues the field (heatmap untouched; kill
`__RAW_DISABLE_CREST_FEATHER_CAP__`; telemetry `__RAW_GPU__.crestFeather`). A/B: cap-OFF = the
finding in all 3 prior traces; cap-ON battery = **verdict PASS, 0 findings, 726 frames — the
first fully clean staircase**. Suite 1165/1165. ALSO shipped: `probeMaskGPU` coarse-base world-
mask fallback beyond resident bounds + zoomlab/verdict UNKNOWN(-1)-counts-as-water (the ground
truth had an unknown-as-land blind spot in the ring-fill zone). CI-log clarity: the green
nightly now ends "WITHIN BUDGET — PASS" (`1e8adf33`).

## 4. QUEUE (post-EVE-2)
1. **Commit ARBITER** (structural #1) — **DESIGN WRITTEN**: `DESIGN-2026-07-18-marine-commit-arbiter.md`
   (10-lane inventory from this session's rings, guard inventory, one-decision-point design,
   3-phase migration: logging shim → shadow mode → flip). CORRECTION while scoping it: the
   boot-time "rendered hour=undefined" scrub-settle line is the **noData** branch working as
   designed (state empty during activation, hourMismatch requires a DEFINED hour, Abort-Gate
   dedups the overlap) — NOT an unstamped series commit; `53b1ec66` + `stampSeriesCommit` cover
   every commit path. Do not re-chase.
2. z8 halo (minefield notes in DEEP-AUDIT + memory). 3. Nearshore 1 km bathymetry + break_type
   (structural #6, unlocks Iribarren breaker_type). 4. Report-calibration loop (#7).
5. USER CALLS: light-mode crest palette · v3 hot-bias trim (`SURF_V3_JACK_MAX`).
6. Peniche offshore sampling · a11y debt · security debt (LOCKED) · REST caps.
7. USER ACTIONS: `gh secret set MAPBOX_PUBLIC_TOKEN` (nightly zoomlab job) · re-check far-zoom
   land + Jupiter–Stuart line on the healed deploy (carried from EVE).

## 5. TOOLING NOTES
- `probe_wedge.js` = the definitive toggle forensic (ring + net + engine timeline in one run).
- zoomlab traces now carry `water` (per-column water fraction); `zoomlab-verdict` prints
  `N water samples, M land band-frames excluded` — a verdict WITHOUT that suffix ran an old trace.
- webpack-dev-server can wedge (compiles, never serves) after battery load — restart the preview
  server before debugging the probe.
- PowerShell `Select-Object -First N` on a live pipeline still kills the upstream process — write
  to a file, then read (re-learned).
