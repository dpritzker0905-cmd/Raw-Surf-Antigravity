# 2026-10-28 (claude, side session of the lead): D1, the wash drawn from another time than the frame on top of it

Branch `claude/wash-time-match` from dev ea9608095. Client only, ON. Three kill switches:
- `window.__RAW_DISABLE_WASH_TIME_MATCH__ = true`: the wash engages on model and layer alone again.
- `window.__RAW_DISABLE_WASH_CDN_FIRST__ = true`: the right-hour world grid waits in the background lane again.
- `window.__RAW_DISABLE_WASH_REFUSAL_WARM__ = true`: a refused wash asks for nothing.

No served number, no backend change.

## Ask

The lead's offline erratic fuzzer (local branch `claude/erratic-fuzz-1027`, fc033f5c1, at dev 4bd90d0d9) found a **silent mislabel**:
- **What:** the BLEND BOTH background wash was drawn from another forecast hour or run than the frame on top of it.
- **How often:** in 75 of 84 sequences, p50 42 h apart (max 327 h), lasting p50 6.3 s (max 81 s).
- **Repro (3/3):** desktop, GFS Waves at Florida z8, PageUp x2. The h48 regional tile is drawn over the h0 world wash for the rest of the session, worded "the nearest stored forecast".
- **Also:**
  - an ICON z5.2 jump to h191 left the wash at h0;
  - a run rollover drew the 00Z wash under a 06Z tile for 8.5 s.
- **Rule from the lead:** the wash must match the drawn frame's valid time and run, or not be blended.

## Cause (offline, the fuzzer's own probe plus wash telemetry added to its end snapshot)

1. **The engine engaged the wash on model and layer alone.**
   - `WebGLMarineEngine.js` blend-both condition: base and resident of the same model and layer, resident regional.
   - The base is kept per model | layer | flavor (`coarseBaseLruKey`): no hour, no run.
2. **The right-hour world grid that would replace the base never arrived.**
   - The hour world warm (`marineWorldWarmOnSettle`, 1.5 s dwell) asks `prewarmGlobalMarineGrid`, which queues the world grid in the series limiter's BACKGROUND lane.
   - That lane starts only while nothing visible loads, and serves sibling minis first.
   - Dev 953ceb74 on the z8 repro: `__MARINE_GLOBAL_PREWARM__.grid = { hour: 48, queuedAt }` had no `startedAt` after 33 s. The visible regional series pages (9.7 s, 8.9 s), then the sibling-layer series, held the lane.
   - The world grid is a CDN static frame for GFS waves (`tryStaticWorldGrid`, no backend work), so the wait bought nothing.
   - ICON z5.2 the same: queued at h191, never started.

## The fix

- **`marineStaleHour.washMatchesResident(base, resident)`**, asked in the engine's engage condition after the model and layer parity (one line; the engine stays at 3205 lines):
  - The base's DATA instant must be within `SAME_STEP_TOL_MS` (1.5 h + 1 min) of the resident's.
  - The verified cycles must agree when both name one; never the ingest clock.
  - Otherwise the wash is not drawn.
  - The data instant, in order:
    - the served time (the readout-only `__readoutServedTime` too);
    - then the product id's stamp;
    - then a series or store frame's own valid time;
    - then the ask's echo.
  - An unknown instant on either side fails OPEN (the old behaviour), counted.
  - Telemetry: `window.__MARINE_WASH_TIME__ { refused, unknown, last }`, counted in rendered frames.
- **`marineGlobalPrewarm.askWashOnRefusal`** (second commit), called by the custom layer after each rendered frame:
  - When the engine refused the wash in that frame, the prewarm is asked for the selected hour's world grid.
  - The prewarm's own gates apply: never mid-scrub, in-flight and valid-time dedupe, a cached grid staged at zero network, a CDN-built frame at once, else the background lane.
  - At most once per model | layer | hour | flavor per 3 s.
  - Kill: `window.__RAW_DISABLE_WASH_REFUSAL_WARM__ = true`.
- **`marineGlobalPrewarm.washWorldOnCdn`:**
  - When the pinned static world set holds a BUILT frame for the asked valid time (outside the band), the prewarm's world grid goes at once instead of through the background lane.
  - Anything else keeps the lane: a swell layer, the band, an unpinned set (EURO/ICON's plain world sets offline), or a listed-but-unbuilt frame.
  - Telemetry: `__MARINE_GLOBAL_PREWARM__.grid.cdnFirst`.

## Offline before/after (fuzzer replays, the same store and CDN, `serve_synthetic_selector.py`, guardrail off on 127.0.0.1)

| repro | dev ea9608095 (main.953ceb74) | fix (main.42242224) |
|---|---|---|
| GFS z8 PageUp x2 (`min-basewash-z8`) | 1/1: `inv2_base_wash_other_time` (h0 wash under h48, 8.0 s to the run's end); h48 world warm queued, never started | 0/1; h48 world grid from the CDN in 61 ms, wash re-engaged on the h48 base (`washTime` refused 0: it landed before the tile) |
| ICON z5.2 jump h191 (`min-basewash-z52`) | 6/6: `inv2_base_wash_other_time` | 0/8; the gate refuses the h0 base (offH -189, `other_time`) and the 42-degree mid crop covers the view alone; no ICON world frame on the offline CDN, so no wash |

### Seeded random sequences (the fuzzer's own generator, `SEEDS=102,106,117,118,129,139`, 60 actions each)

The two arms ran back to back in the same window, on the same store. Episodes are counted by the fuzzer's own probe; totals are summed over the 6 sequences.

| CDN | arm | `inv2_base_wash_other_time` | `inv1_alpha0` (main pass at 0, no wash under it) | `inv1_blank` |
|---|---|---|---|---|
| plain world sets only (no EURO/ICON filled sets) | dev (953ceb74) | 26 episodes, 6/6 seq, 293.6 s | 8, 21.8 s | 2, 6.3 s |
| | fix, gate + CDN-first only (42242224) | 0 | 25, 114.3 s (*) | 2, 0.0 s |
| | fix + refusal warm (this PR's head) | **0** | 17, 43.5 s | 3, 7.6 s |
| filled EURO/ICON world sets, as live | dev (953ceb74) | 29, 6/6 seq, 380.3 s | 8, 17.3 s | 3, 7.5 s |
| | fix + refusal warm | **0** | 20, 71.4 s | 2, 0.0 s |

(*) The first fix arm ran in an earlier window than the dev row above it (dev in that window: 25 episodes, 592.6 s of the mislabel; 8, 21.2 s of `inv1_alpha0`).

**The trade, stated.** Where the wrong-hour wash used to fill the sea, the gate leaves it empty until the right-hour world grid lands.
- **Gate alone:** the probe's `inv1_alpha0` time rose from about 21 s to 114 s.
- **With the refusal warm** (a refused wash asks for the selected hour's world grid at once, not after a commit holds still): 43.5 s on the plain CDN, 71.4 s on the filled one.
- **What remains:** in the filled run, 56.5 s of the 71.4 s is one band-scrub sequence (seed 102), in two kinds:
  - **The band-OFF hide** (`heldBy off_loading`: the band's main pass zeroed while the honest grid loads, which the wrong-hour wash used to cover), 18.2 s.
  - **An ICON crop held at opacity 0** at z10.27 while the hour jumps (no wash under it), 30.4 s. That is D2's case, the next PR, stacked on this one.

The lead ranked the silent mislabel above the blank sea. This PR removes the mislabel entirely (0 of 12 sequences, against 12 of 12 on dev), and the kill switches return the old behaviour per half.

**Not caused by this fix, recorded:**
- **The 3.9 s `inv1_alpha0` at the z8 boot appears in both arms.** It is D3's cold veil.
- **A recommit loop of one frame** (`encode_dup` runs, 20-30 uploads of the same `timeline_scrub` frame in about 2 s) appears in 1 of 6 dev and 2 of 8 fix z5.2 replays. It is intermittent on dev too; a separate finding.

## Tests

- **New: `marineWashTime.test.js` (13 tests).**
  - The rule: the z8 shape, the same instant, the step edge, two runs (and never the ingest clock), unknown fails open, the data-instant order, and the kill.
  - The engine call site, in source.
  - `washWorldOnCdn`: built / unbuilt / unpinned / the band / no time.
  - The prewarm skips a never-freeing lane and stages the seed. A backend grid keeps the lane, and so does the kill.
  - The refusal warm: once per hour and flavor per gap, never mid-scrub, never without a refusal, and the kill; its call site in the custom layer, in source.
- **Red first:** dev's engine and prewarm fail 3 of 11 (the call site, both CDN-first cases). The controls pass.
- **Neighbouring suites** (engine, the custom layer, prewarm, stale hour, world warm, controller, drawn frame, zoom-out gate, coarse bridge): 81 suites, 1,021 tests, all pass.

## Not measured / follow-ups

- **The run rollover case** (a 00Z wash under a 06Z tile). The rule refuses it when both name their cycle (pinned in Jest). It was not replayed (it needs a second, newer store on `ROLL_PORT`).
- **EURO/ICON on the live CDN.** Their FILLED world sets are pinned there, so `washWorldOnCdn` can fire. Offline they are not published, so ICON stays on the lane (and on no wash) here.
- **What draws around an off-screen regional when the wash is refused** is D2's question, not this PR's.
