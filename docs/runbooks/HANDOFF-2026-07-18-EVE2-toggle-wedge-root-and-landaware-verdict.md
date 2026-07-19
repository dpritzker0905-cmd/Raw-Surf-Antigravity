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

## 3c. ⚡ EVE-2 ROUND 3 — ARBITER PHASE A SHIPPED (`06ee44c6`)
Logging shim, zero behavior change: every commit path stamps its lane on the GRID
(commitMarineData source · stampSeriesCommit lane param · the abort-recovery raw site), and the
engine setWaveData ledger records {lane, tier, cellDeg, flavorWant, flavorMismatch} per commit.
TRAP found en route: the useMarineWindData conform (explicit field list — the flag-eating mirror)
ate __commitLane on the first probe run (lane:null at the engine); carried BY NAME now, its 4th
victim after is_valid/dirConfidence/ratingMode. VERIFIED: wedge probe ENGAGED t+5s with
lane:flavor_toggle tier:fine cellDeg:0.231 in the ring · staircase battery PASS 0 findings
(746 frames) · suite 1166/1166. NEXT ARC: Phase B shadow mode (arbiterDecide logs would-be
decisions; diff vs actual across the battery + probes before any flip).

## 3d. ⚡ EVE-2 ROUND 4 — ARBITER PHASE B: SHADOW LIVE, FIRST TUNE LANDED (`fba6b281`)
`marineCommitArbiter.arbiterDecide` (the design's 9-rule priority list, pure + 20 fixture tests
incl. 4 guard-agreement spot-checks) now SHADOWS the engine commit choke: decides nothing,
tallies `__RAW_ARBITER_SHADOW__ {n,agree,disagree,byRule}`, ring-logs `arb_shadow_diverge`,
zoomlab records `frames[].arb`. Kill `__RAW_DISABLE_ARBITER_SHADOW__`. THE PHASE B LOOP RAN
END-TO-END: battery 1 = 14 decisions / 2 divergences — both ONE class (v1 rule 7 gated the
tier-downgrade rejection on zoom>6.5; the shipped guard holds a finer COVERING mid into
z5.5–6.1 and the trace shows it was right — coarsening-never-clearing) → rule 7 re-tuned
coverage-driven (unknown viewport fails open) → battery 2 = 12 decisions / **0 divergences**,
verdict PASS 0 findings (4th consecutive clean staircase). Suite 1186/1186. NEXT ARC: soak the
shadow across scrub/rating/pan scenarios + more models; divergence-free soak across all
batteries = the Phase C flip gate. HARNESS LESSON: a fresh dev server answering `/` is not
warm — run one probe_boot.js pass before batteries (2 false zoomlab FATALs; boot is 6 s warm).

## 3e. ⚡ EVE-2 ROUND 5 — PHASE B SOAK: 45/45, ZERO DIVERGENCES (`79017e9d`)
Four scenario classes on the warm harness, all agreement, all verdicts PASS 0 findings:
staircase 12/12 · pan_coverage 13/13 (3 agreed tier-downgrade rejections MID-PAN + a post-pan
coverage release) · layers 9/9 (4 agreed layer_switch commits) · **RATED staircase 11/11** —
the guard`s most nuanced territory: 2 agreed flavor_downgrade holds (the rating-grace class) +
1 rated_uncovering_release, AND the first fully clean rated-staircase verdict ever. Harness:
ZL_SURF=1 boots the rating flag; traces persist arbShadow tallies + diverge events. PHASE C
GATE REMAINING: EURO/ICON model legs (add a ZL_MODEL hook) + a scrub-heavy scenario, then the
kill-switched flip with the guard chain retained one release (design §5).

## 3f. ⚡ EVE-2 ROUND 6 — PHASE C GATE MET: 89/89, ZERO DIVERGENCES, 7 CLASSES (`2af79f30`)
Soak complete: staircase 12/12 · pan 13/13 · layers 9/9 · rated staircase 11/11 · scrub 20/20
(new scenario — the ForecastWheel KEYBOARD contract as the test hook, hour_change ×11) · EURO
ladder 12/12 · ICON ladder 12/12 (new ZL_MODEL hook; a model switch lands as empty_resident —
teardown clears the engine first). Every verdict PASS 0 findings. 91 lifetime shadow decisions,
100% post-tune agreement. **NEXT ARC = PHASE C FLIP** (fresh context): arbiterDecide replaces
the ENGINE-choke guards, kill-switched, guard chain retained one release — and NOTE the
commitMarineData-side guards (dedup / commit short-circuit) are NOT yet shadowed: either shadow
them first or scope the flip to the engine choke only. Design §5 has the plan.

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





## 6. ⚡ OPUS 4.8 TAKEOVER BRIEF (written by Fable at session close, DOUBLE-VERIFIED)
FINAL STAMP (two fresh runs at close): suite 1186/1186 · staircase battery PASS 0 findings
(706 frames, land-aware) · shadow 12/12 — lifetime 103 decisions, 101/101 post-tune agreement.
origin/dev == local == this doc''s commit. Nightly cron 06:30 UTC armed (secret set, both jobs
green on dispatch run 29655920874).

READ ORDER: this doc §0→§3f → DESIGN-2026-07-18-marine-commit-arbiter.md → the EVE handoff ⚡
parts → memory MEMORY.md (standing-work-rules FIRST — forensics/kill-switch/A-B are BINDING).

THE QUEUE, IN ORDER, WITH THE TRAPS THAT WILL BITE YOU:
1. **ARBITER Phase C flip** (engine choke ONLY — the commitMarineData guards dedup/short-circuit
   are NOT shadowed; do NOT flip them). Method: `__RAW_MARINE_ARBITER__=1` routes the setWaveData
   accept/reject through arbiterDecide; keep shouldRejectResolutionDowngrade/-Subcovering callable
   behind `__RAW_DISABLE_MARINE_ARBITER__` for one release. GATE every step on: full battery set
   (staircase, _ratingon or ZL_SURF, pan, layers, scrub, ZL_MODEL=EURO/ICON) all PASS + probe_wedge
   ENGAGED t+5s. ⚠️ The guard''s rating-GRACE (bounded hold + _pendingDowngrade stash + self-heal)
   has NO arbiter equivalent — the stash/self-heal loop (engine lines ~1150-1170) must survive the
   flip or rejected grids strand (the 07-03 permanent-wedge class).
2. z8 halo — minefield; read [[z8-halo-overlay-mincombine-structurally-excluded-2026-07-18]]
   BEFORE touching computeWideOverlayMode/refreshViewportOverlayMask.
3. Nearshore 1km bathymetry + break_type (backend, additive) → unlocks Iribarren breaker_type.
4. Report-calibration loop. 5. USER CALLS: light crest palette · SURF_V3_JACK_MAX trim · security
   buckets (LOCKED — ask first). 6. Peniche · a11y debt · REST caps.

HARNESS RULES (cost Fable real time today — do not relearn):
- Dev server: preview_start `frontend-verify` (:3009). After battery load it can WEDGE (compiles,
  never serves) → restart. A fresh server answering `/` is NOT warm — run probe_boot.js (session
  scratchpad; rebuild from this doc if gone: boots /map, waits map+engine, ~6s warm) BEFORE zoomlab.
- EVERY zoomlab run ends with `node scripts/zoomlab-verdict.js <trace file>` (not outdir). A verdict
  without "N water samples" ran an old trace. "[verdict] FAIL — 1 finding" inside a within-budget
  nightly is NOT an error (the workflow budget is the authority).
- Col→lng mapping from traces: 512-px tiles (z6.49/1280px ≈ 8.4°) — verify with map.getBounds();
  the wrong scale manufactured the "wrapped-copy particles" phantom.
- The useMarineWindData conform is an EXPLICIT field list that EATS grid flags (is_valid,
  dirConfidence, ratingMode, __commitLane) — any new grid-level stamp must be added there BY NAME.
- Parked cameras serve padded tiles with edges OFF-SCREEN — resident-edge bugs only reproduce
  mid-gesture (the staircase). PowerShell: never pipe a live process into Select-Object -First.
- Kill-switch registry added today: __RAW_DISABLE_FLAVOR_TOGGLE_VIEWPORT__ ·
  __RAW_DISABLE_CREST_FEATHER_CAP__ · __RAW_DISABLE_ARBITER_SHADOW__ (+ all prior in memory).

USER ACCEPTANCE still pending: rating toggle ~5s on the deployed build · far-zoom land ·
Jupiter–Stuart line. The user runs Render deploys — never poll; ask and do ONE curl.

## 7. ⚡ EVE-3 ROUND 7 — ARBITER PHASE C SHIPPED, FLIP-READY + KILL-SWITCHED (`8b002f73`)
Queue #1 CLOSED (mechanism; the default stays guards — see the gate below). Default behavior is
UNCHANGED: `__RAW_MARINE_ARBITER__=1` enables, `__RAW_DISABLE_MARINE_ARBITER__` outranks it and
restores the guard chain wholesale. Both paths ship one release (design §5).

**TWO ROOTS THE PHASE B SOAK STRUCTURALLY COULD NOT SEE — find these before trusting a soak:**
1. **The rating-GRACE had no arbiter equivalent.** 89/89 agreement was a COVERAGE GAP, not
   equivalence: every non-covering rated fixture in the battery was ≥15° wide, which trips the
   guard's `wideView` exemption — the one place guard and arbiter both release immediately. At a
   zoomed-IN NARROW viewport the guard HOLDS (bounded 4 s) and the pre-fix arbiter committed:
   unit-proven divergence, and a straight regression of round-12 §4f (band blinks out). Now a
   named rule `rated_uncovering_grace` (bounded + wide-view exempt, grace state passed BY
   ARGUMENT so the module stays window-free).
   **LESSON: a soak's agreement number is only as good as its fixture COVERAGE. Ask what class
   the battery cannot reach before reading N/N as equivalence.**
2. **The self-heal loop would have bounced at frame rate.** The verdict lives in TWO places —
   the `setWaveData` choke and the `_pendingDowngrade` re-evaluation (~L1186) — and flipping only
   the choke has the ARBITER reject while the GUARDS insta-accept the stash next frame: a
   permanent commit⇄stash bounce, worse than the ping-pong the guards were built to kill. Both
   sites now call `decideMarineCommit`, so the mirror is STRUCTURAL in both modes (pinned by the
   MIRROR INVARIANT test).

**EVIDENCE (all this session, land-aware verdicts):** shadow w/ the updated rule list 35/35 agree
0 divergences (26 staircase + 9 layers), and its `tier_downgrade` counts (6,4) match the guards'
actual rejects (6,4) · arbiter-mode battery ALL PASS 0 findings: staircase ×3, rated staircase
(ZL_SURF — `rated_uncovering_release` exercised), pan_coverage, scrub (`hour_change` ×11), EURO,
ICON · kill switch verified LIVE (both flags → `mode=guards, decisions=0`, PASS) · units
1199/1199 + 33/33 arbiter contract.

**⚠️ `layers` FAILs 2 SETTLED_STEP findings (−22.1/+27.9) in BOTH modes, identical magnitudes** —
a pre-existing harness false-positive on a layer switch (waves→swell legitimately steps
luminance). Do NOT chase it as an arbiter regression; do consider teaching the verdict to exempt
layer-switch frames.

**THE GATE BEFORE DEFAULTING THE ARBITER ON (the one open thread):** arbiter mode takes ~1.7×
more choke rejects than guard mode on a MATCHED staircase (7 vs 4, same final zoom 3.61) despite
per-decision agreement. Understood as extra commit ATTEMPTS downstream of self-heal timing, NOT a
rule disagreement — but not root-caused, so the default stays guards. Root-cause that delta
(instrument the self-heal accept timing in both modes), then flip the default.

**NEW FORENSICS:** `__RAW_ARBITER_LIVE__ {n, rejects, byRule, last}` is the ENGAGEMENT proof — a
flip that silently fell back to the guards would produce an identically green battery. zoomlab
persists it as `arbLive` and prints it per run; `rule`/`decidedBy` are stamped on the reject ring.

**TOOLING:** port 3009 was held by another chat → added a `frontend-arb` launch config on :3011
(`ZL_BASE=http://localhost:3011`). `probe_boot.js` rebuilt in the session scratchpad (warm ≈17 s).
⚠️ `npx eslint` is BROKEN repo-wide (ESLint 9 vs `unused-imports`: `context.getDeclaredVariables
is not a function`) — pre-existing, `npm run lint` currently catches nothing; task chip filed.
