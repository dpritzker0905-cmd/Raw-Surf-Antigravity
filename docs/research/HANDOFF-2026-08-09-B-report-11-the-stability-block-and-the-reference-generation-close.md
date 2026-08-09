# HANDOFF 2026-08-09-B — Report 11.0, the P1 stability block, and the reference-generation close

**Session span:** `512b1cb6..` (report + ~20 commits, all on `dev`, all deployed; last pushed SHA
`bd75343b` verified serving in production via the health-embedded SHA). Sibling session
(`local_6321aeb8`, the audit session) collaborated live: it caught my LOC regression and my
wire-contract drop within one CI run each — the instruments now watch each other AND their authors.
**Method throughout:** forensics before design; every mechanism claim killed or confirmed by its
own measurement; kill switch on every behavior change; margin/baseline never widened.

## §1 WHAT SHIPPED (verification state at handoff)

| commit(s) | what | proof |
|---|---|---|
| `512b1cb6` | **MASTER_WEATHER_SIMULATION_REPORT_11.0.md** (repo root) — Codex ledger (9 findings verified/corrected), 20 invariants, R11-01..18 register, roadmap | the queue this session then executed; execution records stamped in §16 |
| `0013020c` | Parity probe self-diagnosis (both sides' factor vectors on divergence) | diagnosed the real mechanism ON ITS FIRST RED (run 31311733401) |
| `843f6e59` | **Churn loop closed at 3 seams** (`__MARINE_ENGINE__` cleared on dispose; backstop stands down in fallback; `cancelTruthChains` terminal) + Promise-as-geojson guard | 16 new tests; guardrail suite intact; kills: `__RAW_BACKSTOP_IGNORE_GUARDRAIL__` |
| `f1db2900` | BUILD_VERSION on truthTag / WeatherTelemetry events / client-diagnostics POST | truth suites green |
| `7312412b` | **Series frames carry run_time/upstream/dataset/basis + per-response `run_census`** (mixed-run pages self-identify) | 4 new tests; frontend conformer already preferred the field |
| `47d249bb` | Grid worker onerror+recover; truncated arrays refuse (no more flat-calm fabrication) | worker suite green |
| `926d6b22` | api-metrics serves REAL request-telemetry or refuses; `/weather/status` stops asserting unmeasured health; `staleReason` classified (`upstream_cooldown` on the neg-cache path) | 3 new tests; test_dynamic_viewport updated to the honest contract |
| `9fe18414` | **JS-mirror `MIN_SWELL_ENERGY_SHARE` refusal ported** (incl. dir-less-train dilution; counter-pinning test corrected) | 7 fixtures golden-verified vs live Python (0.28/None/None/1.0/None/1.0/None) |
| `2e20122d` | GPU hygiene: score-tex dispose leak; dispose→`safeDeleteTexture` accounting; state isolation units 0–6 | engine suites green |
| `13b772bf` | Wind ports: deviceTier pool + prefers-reduced-motion damp (a11y-mandate gap) | deviceTier.windRes test |
| `4a36ede7` | Rain legend **(mm/h)** — stops were always mm | — |
| `bb8bd0da` | 4 worst silent-excepts now log (surf_point asset+override, frame-honesty stamp, bucket latch) | non-fatal contract unchanged |
| `d43563ca` | Probe gate: raw-vs-raw (docstring made true); `FAIL (INSTRUMENT)` for unattributed; **prose to stderr** (the 08-05 artefact was unparseable JSON from the straddle note printing into stdout) | artefact = pure JSON from now on |
| `8301b78e` | LOC regressions shrunk via rationale relocation → `docs/architecture/RATIONALE-WebGLWindEngine.md` | ratchet local run: Regressed 0; CI LOC green |
| `32bd579c` + `bd75343b` | **THE PARITY CLOSE** (§2) + `reference_size_m` declared on `SpotRatingItem` (wire-contract red fixed same hour) | test_reference_generation_disclosure + wire contract green; CI fully green at `bd75343b` |

**CI:** every push verified BY HEAD SHA; final pushed SHA fully green (CI/E2E/Lighthouse/LOC/Encoding, push+PR). **Suites:** frontend 197/1,822+ · backend sweeps 88+94+32+27+24+22 across the touched areas.

## §2 THE PARITY-RED MECHANISM — three hypotheses died in one day (the session's core forensic)

1. *Marginal threshold / rotating victim* — *killed by the artefact pull* (−18.2 / −11.2 are not marginal).
2. *Tide waiver* — *killed by SIGN* (tide can only lower the GLYPH; every red had the SIM below).
3. **REFERENCE-GENERATION SKEW — CONFIRMED.** The size climatology **moves** (every precompute folds
   new heights in; references grow). Glyph frames rated at an older reference paged against the
   probe's fresh lookup as fake "composition" — the attribution ladder compared only MODEL-run
   identity. Pedras Negras: glyph ref 1.2793 (inverted exactly from its own limiter_f) vs probe
   2.199 → −18.2 on identical runs/heights. **Controls: live glyph converged to the sim within 2 h;
   replay with the glyph's own reference = d 0.0 EXACTLY.** Rotation + constant sign fall out
   (growing refs × rotating top-6 sampling).
   **Fix:** glyph payload discloses `reference_size_m` (absent-not-null = global curve); probe gates
   on the glyph's DISCLOSED ref (shared-input `d_score`; `d_score_served` keeps the product/cell
   question so queue E#1 stays separately visible). Margin untouched all day.
   ⭐⭐⭐ **THE RULE: `run_time` is not the only generation — EVERY moving input a comparison spans
   (references, calibration blobs, assets) needs provenance recorded at use time.**

## §3 THE DEFECT LEDGER — what instruments caught THIS session's own work (kept on purpose)

1. **LOC ratchet** red on my R11-09 port (+16/+3) — caught by the sibling; fixed by rationale
   relocation, never deletion, baseline untouched.
2. **Wire-contract differential** red on my own disclosure — `reference_size_m` returned by the
   producer, silently Pydantic-dropped at the route; my report's own rule ("a field in a payload is
   not reach") violated by me within hours and caught within one CI run.
3. **My own artefact parsing** — the 08-05 parity.json was JSON+prose because the probe printed the
   straddle note to stdout; found the hard way, fixed at the source.
4. **The pixel oracle's four live iterations** (§4) — each failure was the harness learning the
   environment; none was shipped as a paging red.

## §4 OPEN — the executed-GL pixel oracle (`test.fixme`, ships without reddening CI)

`frontend/e2e/pngPixels.js` (dependency-free PNG decode/diff) + a new describe in
`weather-simulation.spec.js`. Four live iterations established: **(a) the e2e global mock 404s the
MAPBOX STYLE HOST, so the GL custom layer never attached in ANY prior e2e** (the siblings force the
DOM-canvas fallback — that is why nobody noticed); the new describe routes the style host through,
scoped. (b) UI pixels (readout, pulsing dot) must not vote → central-ocean clip + self-calibrated
noise (control pair) + data-delta discriminator (live-calibrated: h0→h24 moves 64% of cells > one
texture quantum, 20.3% cross a colour band — floor 10%). (c) The engine **clears-and-recommits
during series settle** (measured: `_waveData` null 1.5 s after a verified commit) → stable-read
retry + a page-side max-hour LATCH. (d) Remaining flake: the +24h commit is not yet reliably
observed against the shared 1-CPU box under repeated runs (90 s wait + latch in place).
**Finish line: un-fixme after 3 consecutive green local HEADED runs** (`npx playwright test -g
"pixel truth" --project="Desktop Chrome" --headed`). The REFUSE arms are in (paint gate, noise
gate, becalmed-sea gate) — it refuses rather than lies everywhere it cannot measure.

## §5 OPEN CLOCKS AND STANDING ITEMS

| item | state | who/when |
|---|---|---|
| `reference_size_m` on the wire | serialization test-pinned; precomputed frames carry it from the **next precompute** (~15:45Z cron) | self-resolving; spot-check one row after |
| Next scheduled Sim Parity run | first run with shared-input gating + full self-diagnosis | observe (~17:20Z); expect green or a self-explaining row |
| Ledger `scored>0` | grace to 08-12T06:00Z; **monitor cron self-fired 07:57Z and passed** | self-paging |
| Skill-MAE gate | arm ~08-22 (two clean weeks) | next session |
| Pixel oracle | `fixme`, §4 | next session, headed runs |
| Readout-truth batch | wind legend from ramp · cross-fall slot sampling · ft/m infobox threading (report R11-11) | next session |
| External uptime probe | cheapest remaining stability purchase (cron delivery 5–32%) | owner-gated (external service) |
| Owner one-clicks | TWO keys in BRAIN_RULES.md rotate · Render env screen read · Vercel app uninstall · Netlify unfreeze · census bound | owner |
| `store.py` at exactly 800 LOC | zero headroom — next edit needs its own relocation | whoever touches it |

## §6 THE PATH FROM HERE (Jacobian-ranked)

1. **Observe the two self-resolving clocks** (§5 rows 1–2) — zero effort, confirms the close.
2. **Finish the pixel oracle headed** — it is the estate's only optical-layer pin; everything else
   about the render path is state-machine-tested only.
3. **Readout-truth batch** — every item has its fix pattern already in-repo (`decodedOmSampler`,
   `applyThemeWaveScale`, `heightUnits`).
4. **Client→server telemetry uplink** (report R11-15) — both halves already built; highest-leverage
   new instrument after the uptime probe.
5. ⛔ Unchanged rejections: JAX/GPU/Zarr/SWAN/nested grids/neural; no calibration tuning before the
   skill gate arms; never widen a monitor's margin to make red go away.

**One sentence for the next session:** open the report's §16 execution record + this handoff, check
the two self-resolving clocks, run the pixel oracle HEADED three times, and keep trusting the
instruments — every defect this session, including two of mine, was caught by one.
