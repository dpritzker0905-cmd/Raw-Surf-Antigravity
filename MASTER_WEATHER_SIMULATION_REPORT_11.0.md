# MASTER WEATHER SIMULATION REPORT 11.0

| | |
|---|---|
| **Report title** | Master Weather Simulation Architecture Report |
| **Version** | 11.0 (first report in the `MASTER_WEATHER_SIMULATION_REPORT` series — see lineage note in §2) |
| **Audit date** | 2026-08-09 |
| **Repository branch** | `dev` |
| **Repository commit** | `c9a0e9fca53d30d8001e46fd7faebd4b73b79fbd` (clean working tree; 3,820 commits across all refs) |
| **Working-tree status** | Clean. One registered stale worktree at `.claude/worktrees/gracious-cannon-e4aed4` (search-hygiene hazard only; all searches in this audit used ripgrep or scoped greps) |
| **Prior report** | `docs/research/MASTER-AUDIT-11.0-2026-08-08-sota-architecture-and-zero-regression-assessment.md` + its execution record `docs/research/HANDOFF-2026-08-09-phases-0-2-shipped-and-the-stability-ledger.md` |
| **Codex report used** | `C:/Users/dprit/OneDrive/Documents/New project/CODEX_FORENSIC_WEATHER_SIM_AUDIT_CLAUDE_HANDOFF_2026-08-09.md` |
| **Claude model/session role** | Claude (Fable 5), Lead Principal Systems Architect & Scientific Software Auditor; non-invasive audit — the only repository file created is this report |
| **Audit limitations** | See §2.4. Notable: local timings are Windows/py3.14 (ratios transfer, absolutes do not); the F-01 low-FPS trigger was not runtime-reproduced (the structural mechanism was verified statically and the healthy path verified live); production Netlify frontend remains owner-frozen at `3bd38a83` (2026-05-20) so "mechanism exists at HEAD" ≠ "production frontend serves it" |

**Deployed-artifact identity, verified live during this audit (2026-08-09 ~05:00Z):**
backend `https://raw-surf-antigravity.onrender.com/api/health` → `"version": "2.0.0-stage-6f-v1-c9a0e9fca53d…"` (full HEAD SHA); dev frontend `https://dev--rawsurf.netlify.app/service-worker.js` → `BUILD_VERSION = 'c9a0e9fc'`. **Both live surfaces this audit exercised are built from the audited commit.** This resolves the Codex report's first open question and removes "stale deployment" as an alternative explanation for its live findings.

---

## SECTION 1 — EXECUTIVE DECISION SUMMARY

*(Ratings and top-five lists are finalized in §1.1–§1.3 below after the full evidence base; this section is written last and stands complete.)*

**Overall system status: YELLOW** — stable production baseline, one real (but corrected-severity) render-control-plane defect, verification machinery genuinely present but too young to certify accuracy claims.

| Dimension | Rating | One-line justification |
|---|---|---|
| Architecture maturity | **Strong** | ONE FORECAST COMPOSITION holds under execution controls; `surf_height_m` has exactly one production write site; the 08-08 audit's top structural fixes verified shipped at HEAD |
| Forecast-data maturity | **Adequate** | Range-streamed ingestion and honest refusals are strong; integrity plumbing (no checksums, no byte-count validation, L1 never revalidated, fail-open manifest reconcile) remains open |
| Simulation maturity (weather-sim MCP subsystem) | **Adequate** | Physics fully delegated to the production chain in the production order; contract gaps: no model parameter on any of six tools, model-less caches, three of five surfaces omit provenance |
| Rendering maturity | **Adequate** | Historical invariants largely Preserved (projection, orientation, flip-Y, teardown); one Violated (ocean-mask single authority), one Superseded (FCE), and the F-01 fallback-churn loop is real at P2 |
| Marine maturity | **Adequate** | Model-keyed caches, commit arbitration, stale-response guards all verified; control-plane churn is concentrated in 6 files with 129–191 commits each |
| Nearshore-physics maturity | **Adequate** | Six processes genuinely modelled; binding constraint is input coverage (0.25° tiles, break-depth, shore normals), not physics — re-confirmed, third audit in a row |
| Performance maturity | **Adequate** | The four event-loop blocks and the serial batch route from the prior audit are FIXED and verified; `/grid_series?surf=1` remains the dominant cost (live telemetry: p90 32 s) |
| Reliability maturity | **Lagging** | HTTP 200 error bodies, fabricated ICON swell_2 zeros, fail-open reconcile, unconditional manifest registration, no checksums — all still open at HEAD |
| Validation maturity | **Lagging → recovering** | The ledger fix, accuracy monitor, persistence baseline all shipped <30 h before this audit; scored>0 recovery and the skill-MAE gate (~08-22) are still pending clocks |
| Test maturity | **Strong** | Mutation-killed guard matrices (46/46), 4,320-row goldens byte-current, bit-identity differentials, refusal controls; known gaps: JS-mirror parity covers 6 of 12 args, no mounted cross-controller render test |
| Observability maturity | **Adequate** | Runtime telemetry now live on `/api/health` (verified in production during this audit); rich frontend truth/forensic channels; the one systemic gap is that truth events and client-diagnostics carry no release identity |

### 1.1 Five highest-value strengths (preserve through any change)
1. **ONE FORECAST COMPOSITION with a single write site** — verified again at HEAD; the sim control (12 m → 29.5 ft) reproduces digit-for-digit; three rating surfaces agree under execution tracing.
2. **Refusal semantics everywhere** — geometry, coverage floors, skill metrics (n≥10), accuracy monitor (REFUSE≠RED, exit 3 vs 1), spread (refuses <2 members); the platform prefers "no answer" to a plausible wrong number.
3. **The stale-response guard stack in the marine fetch path** — monotonic request ids + live-target identity + coalesce-hour resolution, verified line-by-line; races Codex hypothesized are guarded.
4. **Release-identity plumbing** — backend health embeds the SHA; the frontend build stamps service worker + bundle and self-checks for stale bundles; both verified live against production this session.
5. **The instrument loop built 08-08/09** — skill ledger (keep-earliest eviction), accuracy monitor that can go RED, persistence baseline, request telemetry, non-saturated height anchor: the platform can now, for the first time, detect its own accuracy regressions — once the pending clocks mature.

### 1.2 Five highest-risk weaknesses
1. **The marine fallback churn loop (F-01, corrected to P2)** — root cause newly pinned: `window.__MARINE_ENGINE__` is assigned once and never cleared; after guardrail-triggered dispose, the scrub-settle backstop re-drives a disposed engine every ~6 s, unbounded, with no terminal truth event — while the raster+canvas fallback renders correctly on top.
2. **Integrity chain of the product pipeline** — no checksum anywhere, no byte-count/Range validation on 3 of 3 range fetchers, manifest registration unconditional on an unconfirmed L2 upload, L1 never revalidated, anti-clobber reconcile fails open silently.
3. **The JS rating mirror** — missing Python's `MIN_SWELL_ENERGY_SHARE` refusal; divergence re-measured at HEAD at up to **64.6 points**; the live JS test suite actively pins the wrong behavior; a release blocker for any `SURF_PARTITIONS` flip.
4. **Refusals served as success** — `/conditions/*` returns HTTP 200 with `{"error": …}`; ICON swell_2 `/point` fabricates `0.0`; `swell_period` is `wave_period` renamed at the route; the conditions route still drops the entire quality axis (9 of 17 keys).
5. **Cron-delivery dependence** — the accuracy monitor's own cron has never self-fired (one manual run); GitHub cron measured at 5.4–32% of nominal delivery; a permanently-red calibration census (5 consecutive failures) is training red-blindness.

### 1.3 Five highest-leverage next actions
1. Let the new instruments mature and close only their gaps: external uptime probe for the cron-delivery hole; watch the ledger's `scored>0` recovery clock (RED after 08-12T06:00Z if not).
2. Fix F-01 at its two owning seams: clear/gate `window.__MARINE_ENGINE__` on dispose AND gate the backstop's engine-empty leg on `webglMarineFailed`, with a terminal `cancel` stage added to the truth-tracker vocabulary; a mounted integration test (deterministic via `force_marine_fallback`).
3. Add release identity to truth events, WeatherTelemetry, and the client-diagnostics POST (one field; the backend schema's `details` dict already accepts it).
4. Port the JS-mirror refusal + extend the parity goldens across the 0.50 boundary before anyone considers `SURF_PARTITIONS`.
5. Resolve the standing census red honestly (owner decision — re-derive bounds at the operating percentile or wait for ERA5; never widen).

**Production baseline: STABLE.** All CI green at HEAD on push and PR; deployed backend and dev frontend equal HEAD; the defect ledger shows every recent failure caught by an instrument, not a user.
**Major modernization: DO NOT PROCEED NOW** — and mostly *never*, for the priced-and-rejected set (JAX/GPU/Zarr/SWAN/nested grids/neural emulators — see §12). The correct investment remains composition, reach, and measurement, third audit in a row.

---

## SECTION 2 — SOURCES AND AUDIT METHOD

### 2.1 Source register

| Source | Version / Commit | Date | Role in Report 11.0 |
|---|---|---|---|
| Codex forensic audit (`CODEX_FORENSIC_WEATHER_SIM_AUDIT_CLAUDE_HANDOFF_2026-08-09.md`, OneDrive) | audited HEAD `c9a0e9fc` | 2026-08-09 | Primary audit lead-set (F-01…F-09); every material finding independently verified (§4) |
| `MASTER-AUDIT-11.0-2026-08-08-…` (docs/research) | HEAD `b5afda92`/`1e37b003` | 2026-08-08 | Newest prior master report; basis of the §3 delta; 34-agent adversarially-verified evidence base |
| `HANDOFF-2026-08-09-phases-0-2-…` (docs/research) | `1e37b003..5ee77bcd` | 2026-08-09 | Execution record of the prior report's Phase 0–2; every claimed fix re-verified at HEAD (§3) |
| Repository at HEAD `c9a0e9fc` | — | 2026-08-09 | **The primary evidence.** ~30 targeted file traces by 11 verification agents + direct reads |
| Live deployed system (Render backend + Netlify dev frontend) | both = `c9a0e9fc` | 2026-08-09 | Runtime validation: artifact identity, telemetry, F-01 live probe, model-switch semantics |
| GitHub Actions run history (`gh run list`, per-workflow) | — | 2026-08-09 | Scheduled-workflow evidence: monitor cron, parity monitor red-rate, census red streak |
| `CLAUDE.md`, `BRAIN_RULES.md`, `AGENTS.md`-adjacent memory indexes | HEAD | 2026-08-09 | Binding mandates (ONE FORECAST COMPOSITION; three themes; accessibility) and the operating rule "do not rewrite the system" |
| Prior lineage `MASTER-AUDIT-1.0…10.0`, `AUDIT-2026-08-01…03` series | — | 2026-08-01…08-07 | Historical decisions and closed threads (JAX/Zarr/nested-grid rejections; height-pair calibration) — consulted, not re-derived |

**Lineage conflict, documented rather than silently resolved:** the commissioning instruction labeled the OneDrive file "the most recent previous Master Weather Simulation Report" and left the Codex-audit path placeholder unfilled. The OneDrive file *is* the Codex audit, by its own title and content. The actual prior-master lineage is the repo's `docs/research/MASTER-AUDIT-N.0` series (newest: 11.0, 2026-08-08). This report therefore treats the OneDrive file as the Codex input and `MASTER-AUDIT-11.0` as the prior master. The filename `MASTER_WEATHER_SIMULATION_REPORT_11.0.md` numerically collides with the existing `MASTER-AUDIT-11.0` but is a distinct series; no prior report was overwritten.

### 2.2 Method

1. **Phase A baseline** (§2.3): branch/HEAD/tree/CI/deployment state recorded before any judgment.
2. **Input reports read in full** (Codex audit; prior master; handoff).
3. **Independent verification by orchestrated agents** — two workflows, 16 read-only audit agents total, each instructed to *refute* rather than confirm, each required to cite file + symbol + line + verbatim quote, each warned off the known search-hygiene traps (stale worktree; rebound names; trevec `get_context`):
   - Workflow 1 (11 agents): one agent per material Codex finding; two delta agents (13 claimed fixes; 12 claimed still-open defects); three invariant agents (render ownership; projection/orientation; mask/FCE/timeline).
   - Workflow 2 (9 agents): independent deep audit of the subsystems the prior master explicitly did not cover — particles, GPU residency, heatmaps/infobox, frontend performance/races, reliability, testing inventory, observability, ingestion/run-mixing/time, and the weather-sim subsystem (~4,000 LOC, examined by zero prior dimensions).
4. **Live runtime validation** (in-app browser, foreground, logged-in session against the deployed dev artifact proven = HEAD): the F-01 protocol (GFS→Waves→h0, no scrubbing, console/truth-chain capture), a model-switch observation, and the health/telemetry probes.
5. **Root-cause consolidation** (§27 discipline): duplicate symptoms merged; provenance (Codex/Claude/Prior/Multiple) tagged on every finding.

### 2.3 Phase A — repository and runtime baseline

- `dev` @ `c9a0e9fc`, **clean tree**; 3,820 commits all-refs (matches Codex's census exactly); PR #8 (dev→main promotion) OPEN, owner-gated; PR #7 (zoomlab test pin) OPEN.
- **CI at HEAD: all green** on both push and PR (CI, E2E, Lighthouse, Encoding Guard, LOC Governance, 04:21Z). The handoff's "CI in flight" resolved green.
- **Deployment state:** backend Render = HEAD (health-embedded SHA); dev Netlify = HEAD (`BUILD_VERSION`); production Netlify **frozen at `3bd38a83` (2026-05-20), owner-gated** — a standing item, not new.
- **Scheduled-workflow board:** Forecast Calibration Census **RED, 5 consecutive scheduled runs** since 08-08T09:19Z (the standing Pipeline 1.49-vs-≥1.5 census finding — a known owner-gated calibration question, not a new defect); Sim Parity Monitor intermittent (**5 of last 20 scheduled runs red**, last 4 green); Data Health Monitor green; Forecast Accuracy Monitor has run **exactly once, manually** — its cron has never self-fired; keep-warm firing but historically at ~5% of nominal.
- **State classification: an active development branch whose HEAD is live-deployed.** Not a frozen known-good baseline; not a broken state. Confidence levels throughout reflect this.

### 2.4 Evidence limitations

- The F-01 **low-FPS trigger itself was not runtime-reproduced** (this session's foreground run rendered to terminal success; the mechanism was verified statically and has a deterministic repro path via `localStorage force_marine_fallback` that was not exercised against the live site).
- Backend Python tests were **not re-executed** in this environment (CI green at HEAD is the execution evidence; the prior master's caveat about Windows-vs-production interpreter parity stands).
- Production Render **environment variables were not read** (same standing gap as the prior master: one dashboard screen would bound several flag-state questions).
- The **production (frozen) frontend artifact was not audited**; all frontend runtime claims are against the dev artifact (= HEAD).
- No performance numbers were invented; where a figure appears it is either from live production telemetry captured this session, the prior master's measured harnesses, or marked measurement-required.

---

## SECTION 3 — REPORT 10.x → 11.0 DELTA

The prior master (08-08) ranked findings; a 14-commit session (08-08/09) then shipped its Phase 0–2. **Every claimed fix was re-verified at HEAD by reading the code, not the commit messages; every claimed-open defect was re-verified still open.** This is the largest single-day resolution delta in the report lineage.

### 3.1 Previously-open findings now RESOLVED (all 13 verified present and active at HEAD)

| Prior finding | 11.0 status | Evidence at HEAD |
|---|---|---|
| §3.1 Skill ledger scored 0 since 08-04 (eviction) | **Resolved** (recovery clock pending) | `forecast_skill.py:46` `PENDING_MAX_ENTRIES=30000`; `merge_pending` keep-earliest (`out[:max_entries]` after ascending target sort); `{kept, expired, cap_evicted}` instrument surfaced on the wire (`forecast_skill_ops`) |
| §3.7 No workflow can go red on accuracy | **Resolved** (cron delivery unproven) | `.github/workflows/forecast-accuracy-monitor.yml` cron `5 1,7,13,19 * * *`; RED exit 1 on MAE>0.40 m / report age / scored=0 past grace / retention stall; REFUSE exit 3 below n=30 — *refusal distinct from red*, the correct semantics |
| Golden blindness (saturated anchor) | **Resolved** | `test_height_anchors.py`: Pipeline 2 m/14 s → 10.11 ft in `shoaling` regime; Kr=1.0 → 12.68 ft asserted (drift now visible) |
| No persistence baseline | **Resolved** | `SOURCE_PERSISTENCE` rows wired into `run_skill_ledger`; kill `FORECAST_SKILL_PERSISTENCE=0` |
| §3.4 Per-cell wind scan (8.9× warm cost) | **Resolved** | `grid_resolver_surf.py:246` numpy `argmin` over hoisted arrays; **no kill switch** — pinned instead by a verbatim-old-scan differential test (`test_grid_surf_overlay_copies.py::_old_sampler`) |
| Manifest linear scan | **Resolved** | `manifest_view.products_for` indexed by `(model,domain,layer)`, cache keyed on **products-list identity + length** (the near-miss: 11 writer sites reassign `manifest.products`) |
| deepcopy before the skip decision | **Resolved** | copy moved inside both branches after the skip; zero runtime `deepcopy` remains in the file |
| §3.3 `/conditions/batch` uncapped + serial | **Resolved** | cap 200 disclosed via `truncated_to`; one `IN` query; bounded gather (`SPOT_RATINGS_CONCURRENCY`, default 6 — a shared *bound*, per-request Semaphore object) |
| §3.6 Observation gate blocking the loop | **Resolved** | `spot_conditions.py:430` `asyncio.to_thread(gate_single_model_surface, …)` (correction: the offload lives in `spot_conditions.py`, not `spot_ratings.py`) |
| §3.14 Zero runtime telemetry | **Resolved and verified live in production** | pure-ASGI middleware → `/api/health.request_telemetry`; template-keyed, `MAX_ROUTES=200` fold, kill `REQUEST_TELEMETRY=0`; observed serving 40 routes this session |
| Point resolver never ranks by resolution | **Resolved** | `point_resolution._selection_key` `(diff, resolution, area)` at all four `min()` sites; kill `POINT_RES_TIEBREAK=0` |
| §3.5 16 open-ocean spots serving offshore Hs | **Resolved (14+2)** | land-present bit: `surf_point.py:192` promotes `coastal` only (never a bearing); 14 asset entries; the 2 mis-geocoded spots **refuse, pinned as a test control**; flag `SURF_COASTAL_FROM_LAND_BIT` registered in `_RATING_FLAGS` |
| 55% of spots with no 0.25° tile (partial) | **Improved** | +4 regions (241 spots), `per_cycle` 2→3 in both workflows, 32 h cadence held by construction (`test_pilot_region_starvation.py`) |

### 3.2 Prior findings STILL OPEN at HEAD (all 12 re-verified; none regressed, two changed at the margins)

| Prior finding | 11.0 status | What changed |
|---|---|---|
| §3.2 Scheduler `tracked()` wraps every job async → sync jobs inline on the loop; the crashing ingest job still records `success` | **Unchanged** (`scheduler/base.py:87-95`, last touched 07-12) | Exposure is the in-process-ingestion mode only; CI-decoupled topology remains the primary path. Adjacent: sync `_periodic_l2_restore` does blocking I/O on the serve loop every 30 min |
| §3.8 H1/10 cap seam (up to 27% over own ceiling; non-monotonic) | **Unchanged in behavior; now documented-as-intentional** | A new comment asserts γ·d is an individual-wave statistic — a defensible position that still leaves the 1.27·H > cap band and the 26.7% single-vs-partitioned divergence; now an owner/calibration question, not an oversight |
| §3.9 Manifest reconcile fails open, silent | **Unchanged** | `store.py` inner `except: return None` still swallows everything with zero logs and no counter; the 08-07 prefer-newer fix addressed a *different* defect |
| §3.11 Retention prune no-ops (46.8% expired) | **Unchanged** | Prune code untouched; reconcile fold-in still re-imports remote-only entries with no age filter |
| §3.13b/c/j/k conditions route defects | **Unchanged** | `swell_period` = renamed `wave_period`; HTTP 200 error bodies; unenforced documented paywall; whitelist still drops 9 of 17 keys **including the entire quality axis** (a size with no quality, against the CLAUDE.md mandate) |
| §3.13d ICON swell_2 fabricated zeros | **Unchanged** | 200-with-0.0 builder still live on the `/point` path; no-coverage correctly 404s — the two refusal builders still disagree |
| §3.13e/f L1 never revalidated; product count pinned at list-page size | **Unchanged** | filename still keys `valid_time` only (acknowledged verbatim in `3c25228e`'s own message) |
| §3.13i Register-before-upload-confirm | **Unchanged** | Both save paths fire-and-forget the L2 upload then register unconditionally |
| §3.13g spot-ratings single mutable L2 key, two writers | **Unchanged** | Two scheduled writers in separate concurrency groups; plain overwrite; `generated_at` still unconsulted at write time |
| §3.14.2 Rollout evaluator: zero callers + inverted exclude precedence | **Unchanged** | `p2.py:556-561` target-before-exclude; still a landmine if a canary is ever wired to it |
| §3.13h No byte-count/Range validation | **Unchanged** | 3 byte-identical `_fetch_message_bytes` copies accept 200/206 with no length or Content-Range check |
| §3.14.3 No end-to-end checksum | **Unchanged** | zero matches for checksum/sha256/md5/digest across `backend/` |

### 3.3 Newly discovered, newly resolved, stale-assumption corrections

- **Newly discovered issues** (this audit, not in Codex or the prior master): the always-on `WeatherTelemetry` FPS rAF loop; the `userTier`-change zombie shutdown; the `window.__MARINE_ENGINE__` stale-pointer linchpin under F-01; the sim parity self-check hardwired to GFS; the JS test that actively pins the mirror's wrong behavior; the dead `resolution` field on point responses; run_time-as-serve-time on fallback lanes. Full register in §8.
- **Stale historical assumptions corrected**: "multiple competing RAF hooks" → current truth is 3–4 concurrent loops with exactly one violation; "FCE is the single source of truth" → formally Superseded (v7.6), with three stale in-code comments still claiming otherwise; "the sim is a 3-spot mock / height-blind" → long refuted, re-confirmed; the memory claim "sim answers from repo-root dev.db" → nuanced: dev.db is the *fallback* lane, live catalog is consulted first.
- **Regressions**: none found. No previously-fixed defect was observed re-opened at HEAD.

---

## SECTION 4 — CODEX VERIFICATION LEDGER

Every material Codex finding was treated as an audit lead and independently verified against HEAD `c9a0e9fc` (static trace + live runtime where applicable). Verdicts use the mandated vocabulary. **The Codex audit was substantially accurate: nothing was fabricated, its HEAD/commit census matched exactly, and its two central mechanisms are real — but three findings needed severity or scope correction, and one sub-claim cited a symbol that has never existed in the repository's history.**

| ID | Codex finding | Verification status | Decisive evidence | Corrected interpretation | Final disposition |
|---|---|---|---|---|---|
| F-01 | Live marine fallback enters an unbounded cross-controller recovery loop (P1) | **VERIFIED** (mechanism) / severity corrected | `useWebGLGuardrail.js:149-155` (12-window flip); `useMarineScrubSettle.js:683,764-766` (engine-empty leg: no counter, no cap, no terminal state — the adjacent clamp leg has all three); `WebGLMarineEngine.js:98` (`window.__MARINE_ENGINE__` assigned once, never cleared) | The loop is real and unbounded in count (~6 s cadence, not per-second), **but the display is not broken**: `MapWebGL.js:1027-1048` mounts a complete fallback (Open-Meteo raster heatmaps for all four marine layers + Canvas2D foam particles), the re-drive's `ensureMarineSeries` call is TTL-deduped (no network storm), and the loop exits on any model/layer change. Root cause is the stale `window.__MARINE_ENGINE__` pointer to a disposed engine plus the backstop never consulting `webglMarineFailed` (grep: zero references in the orchestrator/scrub-settle). Live probe this session: GFS/Waves/h0 reached every terminal truth stage — the failure is intermittent/load-dependent, plausibly tied to the cold-backend regime observed (60 s ancillary timeouts) | **Include as Confirmed Issue, P2** (was P1) — §8 R11-01 |
| F-02 | Runtime artifact and chain terminality cannot be tied to a release (P1) | **PARTIALLY VERIFIED** | Live: `/api/health` embeds the full HEAD SHA; `service-worker.js` serves `BUILD_VERSION='c9a0e9fc'`. Code: `health.py` (RENDER_GIT_COMMIT), `update-sw-version.js` (stamps SW + `buildVersion.js`), `marineForensics.js` (announceBuild, `__RAW_GPU__.build`, STALE-BUNDLE cross-check) | The headline ("cannot be tied to a release") is **overbroad — both deployed surfaces were tied to HEAD during this audit in minutes**. The *real* boundary Codex found: truth-event payloads (`weatherTruthTracker.js` truthTag/stage records), `WeatherTelemetry` events, the TRUTH_VIOLATION POST to `/api/weather/client-diagnostics`, its backend schema, and the TruthOverlay HUD all carry **no build field** — so a truth event *in isolation* is release-anonymous. Codex was also re-reporting a solved incident: `marineForensics.js`'s header documents the 2026-07-12 stale-bundle episode and the build-announce machinery built as its fix; the truth tracker never adopted the same stamp | **Include as Confirmed Issue, P2 (one-field fix)** — §8 R11-03 |
| F-03 | The simulator cannot reproduce model selection; cache keys lack model (P1) | **PARTIALLY VERIFIED** | `sim_forecast.py:55` (`MODEL = env('SIM_FORECAST_MODEL','GFS')`, import-time, process-wide); `_FORECAST_CACHE` key `(lat4,lng4,valid_time)`; all **six** MCP tools (not just two) expose no model parameter; `routes/weather.py:158` accepts `GFS\|ICON\|EURO` — so the restriction is sim-side only | Restate as **single-model-per-process**, not GFS-only-by-architecture. Sub-claim (b) named `_cached_live_forecast`, a symbol `git log -S` proves **never existed at any revision** — inferred, not read. Sub-claim (e) is **wrong for the main tool**: `get_weather_forecast` carries `forecast_provenance.model` + server `product_id` on both branches; it is right for `simulate_weather_change`, `find_best_window`, `find_best_spot` (no model in any payload). New hazard found beyond the claim: `sim_observed.parity()` omits the model argument to the one cache that HAS a model key, hardwiring GFS — if `SIM_FORECAST_MODEL` were ever set to EURO the sim's own parity check would silently report cross-model divergence as a physics delta. Cache keys are latent (not live) hazards while model is a process constant | **Include as Confirmed Issue (contract), P2 latent / P1-on-any-model-parameter-work** — §8 R11-05 |
| F-04 | JS/Python rating mirror diverges 63.5 points when `SURF_PARTITIONS` flips (P1-on-flip) | **VERIFIED** (and understated) | `surf_rating.py:444,474-476` (refusal present) vs `surfRating.js:112-126` (absent; `git log -S MIN_SWELL_ENERGY_SHARE -- frontend/` = zero commits); parity gate passes 6 of 12 args (`ratingParity.test.js:38`); flag '0' in code + all three declared lanes | Reproduced fresh at HEAD: **64.6-point** max divergence on a 216-case paired grid, two-sided (108 JS-high / 108 JS-low). Worse than Codex knew: (1) `surfRating.test.js:221-227` **actively asserts the old behavior** (its fixture sits below the 0.50 gate where Python now returns None) — the port must change a green test; (2) a second divergence source exists (Python counts dir-less trains into `total_e`, JS drops them); (3) the live consumer wiring already passes partitions into the JS badge (`MapForecastOverlay.js:429`), so the flip produces a same-screen infobox-vs-glyph contradiction; (4) the env knob has no frontend lane — port must hardcode or ship the value | **Include as Confirmed Issue, release-blocker-on-flip** — §8 R11-02 |
| F-05 | A committed API credential in `BRAIN_RULES.md` (P1 governance) | **VERIFIED — and undercounted** | Direct read: **two** live credentials, not one (a Supermemory API key and a Qdrant Cloud key + endpoint), plus the same file carries the committed cluster URL. Values not reproduced here | Owner action stands: rotate/revoke provider-side (history retains them regardless of any future edit), move to env, secret-scan all refs. Both keys, not one | **Include as Confirmed Issue (owner-gated)** — §8 R11-08 |
| F-06 | Scientific verification controls too new to justify tuning | **VERIFIED** | All three controls landed within ~26 h of the audit (commit timestamps); the monitor's one run ever is a manual dispatch; self-expiring grace windows (`OPS_GRACE` 08-10, `SCORED_GRACE` 08-12) encode the pending recovery; the skill gate's own comment defers arming to ~08-22; even the armed RED thresholds are calibrated on 3.4 boreal-summer days and say so | Adopt as-is. Do not tune constants or widen calibration bounds on current operational evidence | **Include as Risk/constraint on all calibration work** — §11 |
| F-07 | Deterministic model switching is not uncertainty quantification | **VERIFIED** | The one UQ mechanism (ECMWF 5-member spread → `wave_height_spread` → `forecast_confidence`) reaches exactly **2 rendering components / 3 render sites** (SpotHub, SpotConditions); the `/spot-ratings` copy of the field has **zero** frontend consumers; conditions routes default `model=GFS` which never carries spread | Accurate. The payload-vs-reach split repeats the platform's signature defect class ("a field in a payload is not reach"). No fake confidence percentage; expand only from residual-supported calibration | **Include as Opportunity (gated)** — §12 |
| F-08 | Upstream resolution/coastal-validity limits must remain visible | **PARTIALLY VERIFIED** (reframed) | `NormalizedPointResponse` declares and the pipeline populates: snapped `sampled_lat/lng` + `interpolation_method`, `run_time`, `is_estimated`/`estimate_basis` (incl. `native_horizon_hours`, far-edge `gap_hours`), `product_id`, `upstream_provider/model`, partitions, `shore_normal_source`/`geometry_readiness` | The visibility machinery **exists and is live** — any implication of absence is contradicted. True residual gaps: the numeric `resolution` field is declared but **never populated** on any point path; fallback-lane and synthetic-miss responses stamp `run_time = now()` (serve time, not model cycle — wrong lead-time computations downstream); truthTag diagnostics attach only for GFS waves + wind, not EURO/ICON layers | **Downgrade to two concrete gaps** — §8 R11-10 |
| F-09 | Complexity/churn concentrated in control-plane hotspots | **VERIFIED** | All six churn counts reproduce **exactly** (191/184/158/148/132/129); `arbiterDecide` 9 tiers/15 verdicts/~22 ifs; guardrail 19 ifs/8 bypass gates; **447 distinct `window.__*` globals across 142 map files** (436 excluding tests), with real control-flow flags (not just diagnostics) crossing modules without import edges | Accurate, and the prescription matches the repo's own direction: `arbiterDecide` is already the pure, window-free, 3000-fixture-differential-tested extraction — but it **ships dark** behind `__RAW_MARINE_ARBITER__` while the branch-heavy guard chain remains the live path | **Include as Risk + a ready next step (arm the arbiter)** — §8 R11-06 |

**Codex process observations (for Appendix D):** the audit's history census, churn counts, and both central mechanisms were verified accurate; its errors were of *scope* (F-02 headline; F-03(e)) and one instance of citing an inferred symbol name that never existed (F-03(b)). Its live observation was made against a deployed artifact this audit proved equals HEAD, which strengthens the observation while its "cannot prove the SHA" framing was simultaneously overbroad — the proof took two curl commands against mechanisms already in-repo.

---

## SECTION 5 — CURRENT AUTHORITATIVE ARCHITECTURE

End-to-end map with the **authoritative implementation for each responsibility** (verified at HEAD; duplicates/transitional ownership called out explicitly).

```
EXTERNAL SOURCES
  NOAA GFS wave/wind/pressure (GRIB2, HTTP Range off .idx) · DWD ICON + GWAM · ECMWF open-data
  (deterministic + separate 5-member swh ensemble, mean discarded) · Copernicus/CMEMS ·
  Open-Meteo (backend point/forecast + frontend .om raster tiles) · NDBC buoys (60, observations)
        ↓  INGESTION (decoupled GitHub Actions CI runner = primary; in-process scheduler = broken fallback, §3.2)
  fetchers → _fetch_common (shared axis/NN/pooling; 0-360 vs ±180 absorbed HERE)
           → WeatherNormalizer.normalize  ←  THE ordering/units/convention authority
             (sort (lat,lng) south→north row-major; lng wrapped to ±180; antimeridian column mirrored)
        ↓  STORAGE   L1 ephemeral disk · L2 Supabase `weather-products` · manifest.json (16k entries)
             + run-keyed immutable copies + Postgres CAS pointer  [single shared mutable SPOF, guarded, guard fails open]
        ↓  PHYSICS — THE MANDATED CHAIN (one path, verified again at HEAD)
  surf_point.resolve_surf_geometry → surf_transform.estimate_surf → surf_rating.compute_surf_rating
  point_surf_augment.py:204 = the ONE production write site for surf_height_m
        ↓  DISTRIBUTION  /api/weather/{point,grid,grid_series,spot-ratings,capabilities,…} · /conditions/* · /explore/spot-details
        ↓  CLIENT (React + MapLibre)
  useWeatherState.timeOffsetHours = THE forecast-hour owner (with 6 one-way mirrors — §6 C6)
  useMarineOrchestrator/useMarineDataFetcherCore = marine fetch/commit authority (request-id + live-target guards)
  WebGLMarineEngine.setWaveData → decideMarineCommit = THE single marine commit choke
  WebGLMarineLayer / WebGLWindLayer (MapLibre custom layers, render inside MapLibre's frame)
  fallback (webgl*Failed): Open-Meteo raster slots + Canvas2D particle overlays (mutually exclusive by JSX ternary)
  OceanMask (style tier) + engine mask textures (GPU tier) + basemap-water overlay = the mask STACK (§6 A1: no single authority)
```

**Ownership register (authoritative / duplicate / transitional / dead):**

| Responsibility | Authoritative implementation | Competing/duplicate/dead |
|---|---|---|
| Grid ordering & conventions | `normalizer.py:499-504` (single sort site) | Frontend `GridParserWorker` row-reversal: conditional-on-input and **dead** (no consumer) |
| Longitude convention absorption | `_fetch_common.build_regular_nn` + per-fetcher `is_360` idiom | EURO antimeridian dead-column repaired in TWO places (backend mirror + wind-texture-only frontend repair) — both idempotent |
| Projection (lng/lat→Mercator) | MapLibre's own matrix (`defaultProjectionData.mainMatrix`); closed-form `latToMercatorY` | The formula is **duplicated ~10×** (5 GLSL + 4 JS copies + 1 dead util); one clamp-constant drift (`85.0511` vs `85.051129`); marine layer's matrix fallback chain accepts `modelViewProjectionMatrix`, which the wind layer explicitly bans |
| Forecast hour | `useWeatherState.timeOffsetHours` (only `useState` holding it) | 6 one-way mirrors: ref, `window.activeTimeOffsetHours`, scrub globals, debounced copy (raster/FCE), per-grid stamps — skew, not conflict |
| Marine data commit | `decideMarineCommit` via `engine.setWaveData` (every feeder funnels through) | FCE dispatcher upload path: **fail-closed** behind `__ALLOW_FCE_*_UPLOAD__`, carries a full second decoder (dormant); `__RAW_DISABLE_NO_DOWNGRADE__` force-pass global |
| Field composition | **Superseded**: v7.6 "forecast-authoritative mode" — per-layer fetch→decode→texture; FCE runs as a 4 Hz diagnostics shadow | Three in-code comments still claim FCE is the "single source of truth" (stale) |
| Ocean mask | **No single authority** — five live mechanisms, three data sources (§6 A1) | — |
| Render lifecycle | MapLibre frame + `triggerRepaint`; engine rAF loop = plugin/diagnostics | `WeatherTelemetry` FPS rAF loop: always-on, uncancellable, app-wide (violation); dead: `render-pipeline.js`, `gpu-texture-manager.js` binding, `layer-plugins/marine-layers.js` |
| Rating computation | `surf_rating.py` (backend); sim delegates both halves in production order | Hand-maintained JS mirror (`surfRating.js`) for the infobox — parity-gated on 6 of 12 args, missing the energy-share refusal (R11-02) |
| Release identity | health SHA (backend); SW/bundle BUILD_VERSION + `marineForensics` announce (frontend) | Truth events / WeatherTelemetry / client-diagnostics: **no build field** (R11-03) |
| Sim catalog | Live app catalogue (`fetch_catalog`) first | repo-root `dev.db` fallback (drifted; documented in-code); a second independent `dev.db` resolution in `weather_sim_mcp.py` for admin persists |

---

## SECTION 6 — ARCHITECTURE INVARIANT AUDIT

Historical invariants from prior reports, each verified at HEAD. Statuses: Preserved / Partially Preserved / Violated / Superseded / Unable to Verify.

| # | Invariant | Status | Decisive evidence | Violation risk |
|---|---|---|---|---|
| 1 | Single authoritative projection path; GPU Mercator authority | **Partially Preserved** | No `MercatorCoordinate` usage; both engines multiply the map's own mercator matrix; but the closed-form lat→mercator formula is source-duplicated ~10× with one clamp drift, and the marine layer's matrix fallback accepts the matrix the wind layer bans | Formula copies can desynchronize silently; marine mis-projects on MapLibre versions lacking `mainMatrix` while wind stays correct |
| 2 | GFS row reversal only during controlled CPU encoding, once | **Preserved** | No explicit flip anywhere: fetchers map rows **by latitude value** (`argmin`), `normalizer.py` sorts south→north once, frontend encodes flat order verbatim with `FLIP_Y=false`; the only frontend reversal code is dead | Contract is comment-enforced between normalizer and encoders; a normalizer-bypassing fetcher would ship inverted rows undetected |
| 3 | `UNPACK_FLIP_Y_WEBGL` disabled where the texture contract requires | **Preserved** | All six true-setters are canvas-mask uploads that snapshot & restore; both data-upload paths pin false (marine) or rely on the ambient default (wind — unpinned, by discipline) | A third-party library leaving flipY=true on the shared context would invert wind textures with no in-repo defense |
| 4 | Shaders sample established UV orientation directly | **Preserved** | Two orientations exist **by contract** (data = lat-linear v0=south; masks = mercator, uploaded flipped), each with one canonical formula, regression-locked (incl. an ordering test that the mercator y-flip applies once) | The dual convention is intrinsically confusable; the encoder documents the exact cross-sampling failure (lat 28°→~7°) |
| 5 | Coastline masking consistent with the GPU pipeline | **Partially Preserved** | Shared NE 50m/10m sources and cross-asserted stacking-order pins; but consistency is *emergent from compensations* (color-matched blur buffer, order pins, hysteresis) | 50m/10m hysteresis gap (z 7.3–8 band); GPU-only truth layers (basemap water, SDF, shelter) have no CPU counterpart; one stale doc pointer (`HIRES_MASK_MIN_ZOOM` doesn't exist) |
| 6 | Exactly ONE ocean-mask authority | **Violated** (documented division of labor) | **Five live mechanisms, three data sources**: style-tier NE mask (5 layers), GPU base mask (canvas-rasterized NE), GPU viewport-truth overlay (OSM basemap water + inland guard + shelter), per-vector model land-sea data mask, backend serve-time enclosed-sea fill; plus the spot-side land bit as a sixth for forecasts | Every historical mask defect was a coordination failure between two of these; each fix added a compensation layer. Any new masking consumer must match five mechanisms or recreate the class |
| 7 | No competing render ownership; MapLibre owns the lifecycle | **Preserved** | Both weather renderers are MapLibre custom layers animated via `triggerRepaint`; Canvas2D fallbacks draw to their own DOM canvases; engine loop renders no pixels; state capture/restore wraps every draw | One latent hazard: wind engine's zoom-transition FBO clear runs *before* state capture — harmless on the flat-map default framebuffer, a corruption vector if terrain/RTT is ever enabled |
| 8 | No duplicate requestAnimationFrame loops | **Partially Preserved** | Full census: 3 concurrent loops in the healthy map path (MapLibre + engine loop + **WeatherTelemetry FPS loop**), 4 in fallback (+ Canvas2D coordinator), ~6 worst-case with transients. The FPS loop is the violation: infinite, no stored id, no cancel path, started at module import, runs on **every screen of the app forever** | The engine loop also spins 60 fps with zero visible layers (bookkeeping only); documentation's "ONE loop" claims are true per-domain, false globally |
| 9 | No legacy renderer silently operating alongside | **Preserved** | Canvas2D predecessors are explicit failure fallbacks, mutually exclusive by JSX ternary, with a duplicate-engine tripwire; dead legacy inventoried (zero importers) | Persisted `force_*_fallback` localStorage keys silently pin the fallback renderer across sessions for that browser |
| 10 | No component independently clearing a shared canvas | **Partially Preserved** | GL clears are engine-owned/FBO-scoped/debug-gated; Canvas2D clears owner-only — except `MapWebGL`'s fade effect reaches across ownership via `getElementById('marine-canvas-layer').clearRect` | Benign today (idempotent deactivation clears); bypasses the coordinator's ownership model; any future renderer reusing that id inherits an invisible external eraser |
| 11 | No subsystem mutating shared GPU buffers without contract | **Preserved** | Exactly two writers, both through engine mutation APIs; FCE dispatcher self-describes as "NOT a renderer", fail-closed both domains; intra-engine texture ownership documented (resident-slot aliasing) | The kill-switches are window globals — one console assignment re-opens the two-writer hazard v7.6 closed |
| 12 | Resources released on layer removal | **Preserved** | Symmetric dispose paths delete VAOs/programs/shaders/buffers/FBOs/textures with null-out; coordinator self-stops; deliberate deactivation-retain is documented with its rationale (87,616-particle rebuild cost) | Retain policy holds tens of MB of GPU memory while layers are toggled off — accepted trade, invisible to a naive leak audit |
| 13 | React lifecycle/hot-reload cannot duplicate initialization | **Preserved** (one-sided) | No StrictMode; init-once flag + sequencer hard gate + idempotent re-registration + styledata re-add guards | The guard prevents double-init but permits **zombie shutdown**: a `userTier` change runs cleanup (`shutdownEngine`) and the re-run lands in the already-booted branch — engine loop/dispatcher stay permanently stopped until a new map instance (latent or live depending on whether tier can change mid-session) |
| 14 | No bypass around the Field Composition Engine | **Superseded** | v7.6 "forecast-authoritative mode": the direct React→engine path is *declared* authoritative; FCE composes diagnostics at 4 Hz; its upload gates are fail-closed with zero production setters | The invariant's *intent* (no ungoverned data to the GPU) survives via the `decideMarineCommit` choke that every feeder funnels through; three stale "single source of truth" comments should be corrected |
| 15 | No duplicate normalization pipelines | **Preserved** | All lanes (incl. the 08-08 0.25° expansion) funnel through `scheduler.normalizer`; axis/convention helpers shared | The dormant FCE dispatcher contains a full second marine decoder + vector synthesizer (`hydrateGridFromLocalStorage`, `fieldToMarineGrid`) — 2026-era semantics, resurrected if anyone sets the gate flag |
| 16 | No model-specific convention leaking into another model | **Preserved** | 0-360 vs ±180 auto-detected per-source; ICON's icosahedral cloud handled pole-safe; final wrap+sort in exactly one place | The EURO near-zero antimeridian column has a wind-texture-only frontend repair; an equivalent artifact in another lane relies on the backend mirror alone |
| 17 | One authoritative owner of forecast time | **Partially Preserved** | Single `useState` owner verified repo-wide; six one-way mirrors each synced by a different mechanism | Failure mode is skew (debounced raster copy lags the marine heatmap by design); any new consumer picking the window global inherits the weakest sync |
| 18 | A slow earlier-hour response cannot overwrite a newer selection | **Preserved** | Three stacked guards verified: monotonic request-id, live-target identity (model+layer+hour vs refs), coalesce-hour resolution; plus the post-hoc scrub-settle hour check | `commitMarineData` itself doesn't hard-reject mismatched hours — protection depends on callers passing the gates; direct callers must re-implement or rely on the settle net |
| 19 | Model/layer switching cannot mix runs / leave stale textures | **Partially Preserved** (by explicit policy) | Generation-owned transitions; `__sourceModel` cross-model display cap (1.5 s); 21 AbortController sites; switches **detach rather than abort** so the abandoned fetch self-caches for switch-back | Bounded staleness is chosen over blanking (up to ~2 s wrong-model, 120 s cross-family retention); correctness rests entirely on the C7 identity guards |
| 20 | 14-day horizon & tier contract (BRAIN_RULES locked) | **Preserved** (spot-checked) | Capabilities route remains the horizon source of truth; series paging 48-frame structure present; `LayerAccessResolver` remains the single permissions authority (no parallel gating found in the audited map path) | — |

**Newly discovered invariants future agents must preserve** (added by this report): (a) *the `decideMarineCommit` choke* — every marine commit source must continue to funnel through it; (b) *the two-texture-orientation contract* (data lat-linear / mask mercator) with its one-formula-each rule; (c) *the products-list identity+length cache key* on the manifest index (11 writer sites reassign the list); (d) *refusal ≠ red* in monitor semantics (exit 3 vs exit 1); (e) *keep-earliest eviction* in the skill ledger (keep-latest is what killed it); (f) *the argmin sampler's differential test* is its only rollback — do not delete `_old_sampler`.

---

## SECTION 7 — CONFIRMED STRENGTHS AND COMPETITIVE ADVANTAGES

**S-01 · ONE FORECAST COMPOSITION, singular and execution-verified.** `surf_point.py` → `surf_transform.py` → `surf_rating.py`; single write site `point_surf_augment.py:204`; sim control reproduces digit-for-digit. *Preserve because* every other number's trustworthiness derives from it; three recorded incidents of second forecast paths. *Regression risk if disturbed:* the +19%/93% classes recur.

**S-02 · Refusal-over-fabrication semantics, system-wide.** Geometry refusals (the two mis-geocoded spots are pinned as a *test control*), coverage floors, `n≥10` shape-metric refusal, monitor REFUSE(exit 3)≠RED(exit 1), spread refuses <2 members, no-coverage 404s, `__renderable:false` safe-zero grids that the commit arbiter refuses as residents. *Preserve:* this is the platform's strongest defense against confidently-wrong output — and §8 R11-11 shows what happens where it's absent.

**S-03 · The stale-response guard stack (marine fetch path).** Monotonic request-id + live-target identity (model/layer/hour vs refs) + coalesce-hour resolution + signature ledger + engine-level `decideMarineCommit` choke + generation-owned transitions. All eight named race scenarios have a specific guard (two partial). The Abort-Gate dedupe + detach-and-self-cache registry ended the abort-storm class; a seven-healer watchdog lattice bounds every known strand mode, each healer gated on "provably dead" with kill switch + counter.

**S-04 · GPU residency discipline (historical concern resolved).** Timeline hours update resident textures via `texSubImage2D` (delete+create only on dims change); particle state reseeds in place (marine); every GPU cache bounded (coarse-base LRU 6 + ref-counted shared world mask, mask-canvas LRU 3, geo cache 12); `readPixels` only in gated diagnostics; context loss handled centrally with a complete Canvas2D+raster fallback; DPR synced live with matchMedia re-arm.

**S-05 · Test estate with anti-decay structure.** 475 backend + 193 frontend test files + 2 e2e specs; CI partitions the backend into three lanes with a **partition assertion** (no tracked test file can run nowhere — a class this repo was bitten by four documented times); shrink-only count floors (185/1686 frontend); mutation-proven guards; the 4,320-row rating goldens; E2E that **refuses to run against stale deploys** by SHA-matching both frontend and backend.

**S-06 · Degradation ladders that are labeled and killable.** Negative caches (60/120 s), labeled stale fallbacks, background native wind recovery, `far_edge_hold` (bounded 24 h, relabeled estimated, never masks mid-range holes), warming markers, EURO→GFS fallback relabeled `gfs_estimated_fallback`, honesty stamps (`served_valid_time`/`frame_substituted`). Upstream outages degrade to stale-but-labeled, not blank or fabricated.

**S-07 · Release-identity and stale-bundle self-diagnosis.** Health-embedded SHA; SW+bundle BUILD_VERSION stamping; `marineForensics.announceBuild` cross-checks the running bundle against SW caches and warns `STALE BUNDLE` — built as the fix for a documented 07-12 incident.

**S-08 · Frontend instrumentation depth.** The 12-stage truth-lineage tracker with FNV hashes; a 500-slot fair-evicting telemetry ring with saturation-honest counts; the `__RAW_FORENSIC__` ring; FORENSIC-SNAP; a 4-tab HUD reachable in production via `?diag=1`; the GLSL-parsing rating-ramp test (legend/band/badge pinned to the *actual shader source*). Reach is the gap (§8 R11-21), not quality.

**S-09 · Verified live this session:** the no-downgrade guard rejecting an 8×9 grid then self-healing at the right zoom; Abort-Gate dedupe; stale-view retention on cache miss; model-keyed cache transition — all observed working in the deployed artifact's console during the F-01 probe.

---

## SECTION 8 — CONFIRMED ROOT-CAUSE ISSUE REGISTER

Sorted by operational impact. Every entry verified at HEAD `c9a0e9fc` with file:line evidence (Appendix A). Duplicated symptoms are consolidated under root causes; provenance tagged.

### R11-01 · The marine fallback churn loop (Codex F-01, root cause completed by this audit)
**Provenance:** Codex + Claude · **Status:** Confirmed · **Severity: P2** (Codex said P1; display is not broken) · **Confidence:** HIGH
**Subsystem:** frontend render control plane · **Location:** `WebGLMarineEngine.js:98` (`window.__MARINE_ENGINE__` assigned once, never cleared), `useMarineScrubSettle.js:683,764-766` (engine-empty backstop leg), `useWebGLGuardrail.js:149-155`, `weatherTruthTracker.js:357-405`
**Root cause (three cooperating gaps):** (1) after guardrail-triggered dispose, the module global still points at the disposed engine (`_waveData=null`), so the backstop perceives "engine empty" forever; (2) the engine-empty leg — unlike the adjacent clamp leg with its 3-strike cap, 45 s probe cadence, 4-probe budget and terminal state — has **no counter, no cap, no terminal state**; (3) the backstop never consults `webglMarineFailed` (zero references in orchestrator/scrub-settle), and the truth tracker has **no cancel/error/superseded terminal stage**, so abandoned chains die to the 30 s absence watchdog.
**Current behavior:** unbounded ~6 s-cadence re-drives (cloned frame commit + full MapWebGL re-render + TTL-deduped ensure) while the **raster+canvas fallback renders a correct display on top**. Exits on model/layer change, context restore, or layer deselect. Live probe this session did not trip the guardrail (chain terminal-OK); deterministic repro exists (`localStorage force_marine_fallback`).
**User impact:** silent CPU/battery churn + dead-chain telemetry + false "engine empty" diagnostics; NOT a blank screen.
**Regression risk of repair:** LOW–MEDIUM (the backstop's other legs are load-bearing healers).
**Required guardrail:** mounted integration test (guardrail+backstop+truth) with fake time: ≤1 transition per trip, terminal event for the abandoned chain, zero re-drives after terminal, one bounded re-arm on model/layer change.
**Direction:** clear `window.__MARINE_ENGINE__` in dispose AND gate the backstop leg on the guardrail flag (both are needed — a null engine still passes `!(eng && eng._waveData)`), and add `chainCancelled`/`chainError` terminal stages at the existing flip/abort sites.

### R11-02 · The JS rating mirror will contradict the backend by up to 64.6 points on the day `SURF_PARTITIONS` flips
**Provenance:** Multiple (prior report + Codex F-04 + re-measured by this audit) · **Status:** Confirmed (latent) · **Severity: release-blocker-on-flip** · **Confidence:** HIGH
**Location:** `surfRating.js:112-126` vs `surf_rating.py:444,474-476`; `ratingParity.test.js:38`; `MapForecastOverlay.js:429` (live consumer wiring)
**Root cause:** the 2026-08-03 backend refusal (`MIN_SWELL_ENERGY_SHARE=0.50`) was never ported (`git log -S` over frontend/: zero commits); the parity gate passes 6 of 12 args so the drift is structurally invisible to it.
**Aggravators found by this audit:** the JS unit test `surfRating.test.js:221-227` **actively certifies the pre-refusal behavior** (its fixture sits below the gate where Python now returns None — the Python twin test was updated, the JS twin was not, despite the file header "KEEP IN SYNC"); a **second divergence source** (Python counts dir-less trains into `total_e`, JS drops them); the env knob has **no frontend lane** (port must hardcode 0.50 or ship the value in the payload).
**User impact on flip:** same-screen infobox-vs-glyph contradiction; two-sided (108 high/108 low on the probe grid).
**Direction:** port the refusal + fix the counter-pinning test + extend goldens across 0.4525/0.50/0.5525 + decide the constant's transport — all **before** any lane flips.

### R11-03 · Truth telemetry is release-anonymous (Codex F-02, corrected scope)
**Provenance:** Codex (corrected) · **Status:** Confirmed · **Severity: P2 (one-field fix)** · **Confidence:** HIGH
**Location:** `weatherTruthTracker.js` (truthTag, no build field), `WeatherTelemetry.js` (events, no build field), `TruthOverlay.js:118-133` (the production POST), `schemas.py:328-337` (`ClientDiagnosticReport`)
**Corrected scope:** release identity **exists and works** (health SHA, SW/bundle stamps, `__RAW_GPU__.build`, STALE-BUNDLE check — all verified live this session against the deployed HEAD); the gap is that the truth/telemetry payload family never adopted the stamp, so a truth event or server-side client-diagnostics record cannot alone distinguish HEAD defect from stale deploy.
**Direction:** add `build: BUILD_VERSION` to truthTag/emit and to the TRUTH_VIOLATION POST (`details` accepts it with zero backend change), and display it in the HUD.

### R11-04 · Model-run identity does not exist in the pipeline; mixed-run output is possible without disclosure
**Provenance:** Claude (this audit) · **Status:** Confirmed · **Severity: High** · **Confidence:** HIGH
**Location:** `store_helpers.py:81-86` (`_build_product_filename` keys valid_time only), `grid_series_helper.py:477-493` (frames strip `run_time`/`upstream_provider`/`estimate_basis`), `normalizer.py:142-144` + `scheduler.py` (run_time = **ingest wall-clock**, never the model cycle — `_pick_cycle` knows `cycle_dt` and discards it), `marineGridSeries.js:208-210` (page cache key has no run component; `base_time` discarded), `store.py:21-36` (L2 product bodies CDN-cached 1 h under a false immutability premise while runs overwrite the same filename)
**Current behavior:** during every ingest window (~1–2.75 h, 6×/day) adjacent scrubber hours can serve different model runs — physically discontinuous seas — with no disclosure anywhere; the serving ladder never consults run age; a cancelled ingest leaves generations interleaved by construction (the prune's own comments document ~6–7 accumulated run generations).
**Consequential sub-defect:** the 2026-08-03 provenance fix ("prefer the backend's `upstream_provider`") is **inert on the series lane** — the lane that serves most heatmap commits — so the frontend's *falsified* EURO model-guess is the active provenance path for series frames.
**User impact:** scrub discontinuities at run boundaries; wrong upstream attribution in every diagnostic for EURO series frames; "which model run is this?" is unanswerable everywhere.
**Regression risk of repair:** LOW for the serialization gap (fields already exist on the resolved product; copy them into the three frame builders); MEDIUM for true cycle identity (thread `cycle_dt` from fetchers as `run_time`, keep wall-clock as `ingested_at`).
**Required guardrail:** a response-level run census (min/max run_time across frames) + a frame test asserting provenance fields survive the series lane.

### R11-05 · The simulator is single-model-per-process, and its self-checks hardwire GFS (Codex F-03, corrected)
**Provenance:** Codex + Claude · **Status:** Confirmed (latent hazard; live gap is disclosure) · **Severity: P2 today / P1 gating any model-parameter work** · **Confidence:** HIGH
**Location:** `sim_forecast.py:55` (import-time `MODEL`), `_FORECAST_CACHE` key `(lat4,lng4,valid_time)`, `weather_sim_mcp.py` (all six tools model-less; `_SIM_OVERRIDES` keyed by spot name, timeless by documented design), `sim_observed.py:79,205-206` (the ONE model-keyed cache whose only caller omits the argument → parity always compares against GFS-served ratings)
**Corrections to Codex:** `_cached_live_forecast` never existed at any revision (inferred symbol); `get_weather_forecast` **does** carry `forecast_provenance.model` + server `product_id` — the disclosure gap is real for `simulate_weather_change`, `find_best_window`, `find_best_spot` (payloads never name the model).
**Direction:** contract decision first (per Codex's own framing): either a validated model enum threaded through tools + every cache/override/provenance key **in one change**, or an explicit "GFS-only" label on every answer. The cache keys and `sim_observed.parity` are load-bearing parts of either choice.

### R11-06 · The ICON >168 h hour has two live compositions, and the client blend can straddle model runs
**Provenance:** Claude · **Status:** Confirmed · **Severity: High** (one-composition class) · **Confidence:** HIGH
**Location:** `backendWeatherServiceClient.js:272-278` (client blend is the unconditional per-hour path >168 h), `backendWeatherServiceClientHelpers.js:398-527` (cached ICON/GFS@168 anchors, 5-min TTL, fresh GFS target — `hIcon + (hGfsTarget − hGfsAnchor)` straddles a run change; >240 h = 0.6·GFS+0.4·EURO labeled ICON), vs `icon_marine_extension.py:85-124` (backend-baked estimates serving the series lane, with traceable `estimate_basis` product ids)
**Current behavior:** which composition a user sees for the same hour depends on series-cache warmth; the blended grid carries no `valid_time`, no `run_time`, no truthTag; disclosure is the infobox `(est.)` marker only — no heatmap-level marker.
**Direction:** retire the client blend where the backend bake covers (serve stored estimates through the per-hour lane), or pin anchor+target to one product generation and stamp identity on the blend. This is the same defect class the CLAUDE.md mandate exists for, one subsystem over.

### R11-07 · Reliability seams that convert failure into false success
**Provenance:** Multiple (prior report §3.13 + Claude extensions) · **Status:** Confirmed · **Severity: High (cluster)** · **Confidence:** HIGH
- `conditions.py` returns **HTTP 200 with `{"error":…}`** on every failure path (incl. raw `str(e)` leakage); the route also fabricates `swell_period` from `wave_period`, documents an unenforced paywall, and still drops 9 of 17 producer keys **including the entire quality axis** (a size with no quality, against the mandate).
- ICON swell_2 `/point` fabricates **200-with-0.0** while no-coverage 404s — two refusal builders disagreeing.
- The dynamic-viewport stale fallback stamps **every** failure class `upstream_rate_limited` (`viewport_service.py:544-573`) — incident misdiagnosis by construction.
- `GridParserWorker` **zero-fills truncated arrays** (`|| 0` on out-of-bounds reads) — the fabricated-zeros class; and the shared worker has **no `onerror`**, so a worker crash strands promises and silently freezes the pressure lane for the session (its "main-thread fallback" comment is false — the fallback is `Promise.resolve(null)`).
- The marine texture encoder **silently zero-fills** `vectors.length ≠ cols×rows` while the point-sampler strictly refuses the same grid — paint-vs-sample truth divergence.
- NaN posture is asymmetric: native-GRIB lane fully sanitized (`x != x` + physical ranges); the Open-Meteo JSON lane has **no isnan anywhere** (normalizer included); frontend protection is implicit Uint8Array coercion (NaN→0 texel) and one NaN can poison the extrapolation ring around it.
- Three frontend lanes have **no client-side deadline**: single-grid fetch, pressure, tide.
- Silent-failure census: 26 bare `except…pass` in the backend pipeline; **85 truly-empty catches** in map components. Worst five: the frame-substitution provenance stamp (`grid_resolver.py:61-62` — a failure serves a substituted frame with its flag silently unset), estimator ICON-anchor extraction, **`surf_point.py:108-120`** (asset + override reads feeding the height chain swallow everything), `store.py:238-242` (bucket bootstrap failure latched as done), OceanMask's 26 empty catches around style mutations (the waves-over-land class, zero telemetry).

### R11-08 · Fabricated observability: three backend status surfaces serve hardcoded/simulated numbers as measured
**Provenance:** Claude · **Status:** Confirmed · **Severity: Medium (High trust-impact)** · **Confidence:** HIGH
**Location:** `routes/weather.py:652-668` (`/api/weather/status`: `provider_status` hardcoded "healthy", `last_errors: []`, `stale_products_count: 0`); `routes/admin/system.py:478-514` (`api-metrics` reads `SystemHealthMetric`, which has **no writers anywhere** — the simulated 45 ms / 0.3% / "healthy" branch is the only branch that can execute); `system.py:206-208` (`error_rate = 0.5  # Placeholder`); plus the admin WeatherDiagnostics "Sandbox replay" button that pushes fabricated log lines (UI theater).
**Why it matters:** this is the exact class the repo's own rules name (*a check that can't tell not-sampled from broken must REFUSE*) — and the real data these endpoints pretend to have now exists in `request_telemetry`.
**Direction:** point api-metrics at `request_telemetry.snapshot()`; make `/api/weather/status` measure or refuse; delete or implement the replay.

### R11-09 · Particle physics is frame-rate-dependent, and the wind engine trails marine on four shipped invariants
**Provenance:** Claude · **Status:** Confirmed · **Severity: Medium** · **Confidence:** HIGH
**Root cause:** both WebGL engines advect with per-frame forward Euler using zoom-derived constants and **no dt term** (`WebGLWindEngine.js:540-544`, `WebGLMarineEngine.js:2166`) — hand-tuned at 60 Hz — while both Canvas2D fallbacks ARE dt-normalized. A 120 Hz display drifts 2× a 60 Hz one; a throttled tab slows the weather itself; and since drift speed encodes intensity, the same sea reads differently across hardware and across the primary/fallback switch. Marine's wall-clock crest phase can disagree with its frame-locked drift.
**Invariant drift (fix landed in marine, never crossed to wind):** device-tier pool sizing (wind still one-shot `innerWidth<768` — the exact documented marine bug), `prefers-reduced-motion` damp (accessibility-mandate gap: 147k particles at full speed), unconditional OOB culling (wind gated off at z>6 → particles advect on CLAMP_TO_EDGE junk), in-place particle reseed (wind delete+reallocs during pan/zoom). Plus 16-bit position quantization can stall light-wind particles at z3–6 (the tile fix scoped to z>6 only).
**Direction:** clamped-dt multiplier into both engines (kill switch pinning dt=1 for A/B); port marine's four invariants to wind; treat marine as reference.

### R11-10 · GPU lifecycle residuals (the historical concern is fixed; five specific defects remain)
**Provenance:** Claude · **Status:** Confirmed · **Severity: Medium** · **Confidence:** HIGH
(a) **`WebGLMarineLayer.js:664` passes a Promise as `landGeoJSON`** into the escaped-mask rebuild — the documented "ALL-WATER world mask" poison class, fixed at the bridge site one day later but never at this site; a Promise has no `.features` so the rebuilt mask is all-water until a real commit heals it. (b) `engine._residentScoreTex` is absent from `disposeEngine`'s delete inventory — leaks per dispose cycle in rating mode, and a stale handle survives context restore. (c) The encoder's error-rollback nulls resident pointers without deleting reused textures. (d) `disposeEngine` bypasses `safeDeleteTexture`, so `__RAW_GPU__` accounting drifts upward per dispose — the same telemetry-drift class already fixed once at the delete site. (e) `WebGLStateIsolation` captures/restores texture units 0–3 while the marine pass binds 4–6 — latent state pollution toward the basemap.
**Direction:** (a) pass null (identical to the bridge fix) + a type guard in `setWaveData`; (b)–(e) one-line-each hygiene with the existing tests.

### R11-11 · What the map says vs what it shows: seven readout/legend truth divergences
**Provenance:** Claude · **Status:** Confirmed · **Severity: Medium (High for the two label errors)** · **Confidence:** HIGH
(1) Rain legend labeled **"in/h" over mm stops** while the infobox prints mm/h — a 25.4× misread for anyone trusting the label. (2) The wind legend is a **stale hand-maintained CSS duplicate** of an 8-stop 0–50 kn ramp; the shipped ramp is 13 stops 0–75 kn with magenta/violet calm — the legend actively misidentifies calm vs strong. (3) Legend tick labels are equally spaced under value-proportional gradients — mid-scale labels sit under the wrong colors on every breakpoint legend. (4) **Silent GFS cross-falls** (fog: always; ICON >168 h; EURO >228 h): the raster paints GFS while the infobox number stays on the active model (fog loses its readout entirely on EURO/ICON) — the fix pattern exists in-repo (`decodedOmSampler` parses the rendered slot URL). (5) Three inconsistent nearshore policies (sampler decay 0.65/0.45/0.35 vs renormalization vs encoder ocean-extrapolation) — worst exactly at the coastal points surfers click. (6) The ft/m toggle reaches legends and marker tooltips but **not the infobox cards** (which also carry a second, drifted conversion constant). (7) Radar shows model mm/h numbers under reflectivity colors with a legend whose "dBZ" label contradicts its own fractional stops.
**Also confirmed (bounded, principled):** 8-bit texture quantization (height/10 saturating 10 m, period/20 at 20 s) — color saturates while the raw-value readout keeps rising; the infobox never reads the quantized texture.

### R11-12 · Forecast-hour zero has three disagreeing owners, and the scrubber label never reads the served frame
**Provenance:** Claude · **Status:** Confirmed · **Severity: Medium** · **Confidence:** HIGH
Backend floors now-UTC per request (`grid_series_helper.py:322`, `spot_ratings.py:573`); the frontend per-hour lane **rounds** to nearest hour then snaps to the manifest (`getSharedValidTime`) — so during minutes 30–59 the two lanes disagree by 1 h (which can flip a 3-hourly frame); the display label is **raw client-clock local time** (`MapWeatherControls.js:327-331`), never the committed frame's `served_valid_time` — up to ~3 h label-vs-frame skew (24 h under far-edge hold), plus DST-transition label skew. Series `base_time` is discarded client-side (pages fetched across an hour boundary silently re-index by the ±1.5 h snap).
**Direction:** unify on floor; derive the label from the committed frame's `served_valid_time`; store `base_time` per page.

### R11-13 · Pipeline integrity chain (carried from the prior master, all re-verified OPEN)
**Provenance:** Prior report · **Status:** Confirmed open · **Severity: Medium (compounding)** · **Confidence:** HIGH
No checksum anywhere fetch→L1→L2→restore→serve; no byte-count/Range validation (3 identical fetcher copies); manifest registration unconditional on a fire-and-forget L2 upload; L1 never revalidated (filename omits run — same root as R11-04); reconcile fails open silently (zero logs, no counter); retention prune no-ops (46.8% expired, fold-in re-imports with no age filter); spot-ratings single mutable L2 key with two scheduled writers and no CAS; scheduler `tracked()` false-success (+ sync `_periodic_l2_restore` blocking the serve loop every 30 min); the H1/10 cap seam (now documented-as-intentional, behaviorally identical: up to 27% over its own ceiling, non-monotonic, and single-vs-partitioned capping 26.7% apart); the p2 rollout evaluator's inverted exclude precedence (dormant; landmine for any canary).

### R11-14 · Testing gaps concentrated on the optical output layer
**Provenance:** Claude · **Status:** Confirmed · **Severity: Medium** · **Confidence:** HIGH
(1) **No executed-GL or pixel assertion anywhere** — every shader test is a source-substring check (the repo's own defect-classes memory rejects that pattern); e2e asserts canvas visibility + diag flags only; a hemisphere-mirrored field would ship green (historical precedent: the 12-day invisible-heatmap kill). (2) **No test that changing the hour changes the displayed frame** — four hold/dedup mechanisms whose combined failure mode is "the readout advanced, the picture didn't", each tested only in isolation. (3) GridParserWorker's async reply ordering is untested (the one inherently reorderable boundary). One executed-GL harness (synthetic asymmetric grid + readPixels at a projected coordinate) converts four PARTIAL axes to COVERED at once.

### R11-15 · Observability: rich instruments, no transport; and no terminal-failure vocabulary
**Provenance:** Claude (+ Codex F-01d) · **Status:** Confirmed · **Severity: Medium (highest-leverage single instrument)** · **Confidence:** HIGH
The frontend has 474 `window.__*` globals, three bounded rings, lineage hashing, build self-check — and the only client→server transport in the entire system is the 60 s-throttled truth-violation POST (unauthenticated, server-unthrottled, appended to an ephemeral file). Every hard frontend incident in the runbooks was diagnosed by asking a user to paste console output. Both ends of an uplink already exist (`getDiagnosticReport()`/`forensicSummary()` client-side; the route + the `request_telemetry` aggregation pattern server-side). The truth-stage vocabulary has **no error/cancel/superseded terminals** (12 stages, all success-shaped) — failure is only inferable 30 s late; mismatch scope is GFS-waves+wind only. Also: web vitals measured then discarded in prod; `request_telemetry` counts 4xx inside `n` but only distinguishes 5xx.

### R11-16 · Committed credentials (owner-gated)
**Provenance:** Multiple · **Status:** Confirmed · **Severity: P1 governance** · **Confidence:** HIGH
**Two** live credentials committed in `BRAIN_RULES.md` (a Supermemory key; a Qdrant Cloud key + endpoint) — Codex counted one. History retains them regardless of future edits: rotate provider-side, move to env, secret-scan all refs, then decide on history rewriting. (Values not reproduced in this report or its evidence trail.)

### R11-17 · Render-lifecycle residuals (new, latent)
**Provenance:** Claude · **Status:** Confirmed (latency of each stated) · **Severity: Low–Medium** · **Confidence:** HIGH
The always-on `WeatherTelemetry` FPS rAF loop (module-import side effect, no cancel path, runs on every screen of the app forever — the one true RAF-invariant violation); the `userTier`-change **zombie shutdown** (cleanup stops the engine loop; re-run lands in the already-booted branch; no re-init path until a new map instance); `MapWebGL`'s fade effect clearing another component's canvas via `getElementById`; the wind engine's FBO clear before state capture (corruption vector only if terrain/RTT ever lands); persisted `force_*_fallback` keys silently pinning the fallback renderer across sessions; MapWebGL's wholesale re-render per committed scrub tick (~11 Hz — the known, probe-instrumented churn whose context-split fix hasn't landed); series retry timers that outlive caller abort.

### R11-18 · The weather-sim subsystem: composition verified sound; the parity monitor's red rate now has a decomposition and a candidate mechanism
**Provenance:** Claude (first deep audit of this subsystem — zero of the prior master's twelve dimensions examined it) · **Status:** Confirmed (mechanism candidate: Probable) · **Severity: Medium** · **Confidence:** HIGH (structure) / MEDIUM (mechanism)
**Verified sound:** `sim_rating.calculate_surf_rating` delegates both halves to production **in the production order** (geometry → `estimate_surf_at` breaking height → `rating_score` by keyword → gate), matching `rate_one_spot`; the `cf2efb48` wrong-order class is closed and pinned by an AST guard over all three rating surfaces. Disclosure honesty is the subsystem's standout property (dual score coordinates, `directional_conflict` on all 4 renderers, truncation/staleness/blindness named in payloads, NaN/inf trust-boundary validation, the zero-network what-if invariant enforced structurally). CI exclusions are at their healthiest recorded state (2 genuinely server-shaped modules, staleness-guarded).
**The parity monitor decomposition (5 reds in last 20 scheduled runs):** two rotating-victim **composition** reds (Lafitenia 08-07, Cape Canaveral 08-05 — same-model-run level splits above the calibrated 1.0 margin) + three **instrument** failures (empty probe/unreachable app; unparseable JSON; runner-never-acquired). The victim rotates because the probe samples each region's **top-6 spots by served score** at whatever hour the cron fires — the sampled population rotates with the weather.
**MECHANISM SOLVED (2026-08-09, same session, fix `32bd579c`): REFERENCE-GENERATION SKEW.** The rebuilt probe self-diagnosed on its first red (Pedras Negras, run 31311733401): identical model runs, heights within 0.9%, the entire −18.2 gap in `size_gate` — glyph rated at reference **1.2793**, the probe's fresh lookup said **2.199**, because the size climatology is a *moving input* (every precompute folds new heights in; references grow as entries accrete) and the attribution ladder compared only model-run identity. Two controls: the live glyph converged to the sim within 2 h, and replaying the sim with the glyph's own reference gave **d = 0.0 exactly**. Rotation and the constant sign both fall out (growing references × rotating top-6 sampling). Fix: the glyph payload discloses `reference_size_m` (absent-not-null = global curve) and the probe's gating calc grades on the glyph's disclosed reference — `d_score` is now a true shared-input composition check. Generalized rule added to the invariants: *`run_time` is not the only generation — every moving input a comparison spans needs its provenance recorded at use time.* The intermediate history: the tide-waiver hypothesis was **REFUTED by sign** — `tide_fit ∈ [0.5, 1.0]` can only lower the *glyph*, but both red rows show the **sim** below the glyph (Lafitenia d −11.2; Cape Canaveral d −7.3) on identical runs with heights matching <2%. Geometry readiness is not the common factor either (Canaveral was `full`). A live reproduction at the current hour shows **exact parity (d = 0.0 at both victims)**, proving the wiring sound and the red conditional. The surviving hypothesis (MEDIUM confidence): **input-sampling divergence between the point lane and the precompute lane on the unshared inputs — the wind leg (feeding the 0.6-weighted blend and `wind_gate`) and/or `swell_from` (the high-Jacobian aim angle)** — which rotates with the weather and pages only at level boundaries. The artefact rows record *neither side's* factor decomposition, so the probe cannot yet name the factor; this session ships the self-diagnosis instrumentation (both sides' limiter + factor vectors + the sim's input vector recorded per diverging row) so the next red identifies its own mechanism. **The margin was not widened.**
**Probe gate defects (independent of the mechanism):** the paging predicate excludes only `provenance_only`, so `observation_gate` and `unattributed` attributions page as composition; the probe's docstring claims a raw-score comparison the code does not make (it compares the sim's ungated score against the **gated** served score, then neutralizes after the fact); and by sampling top-scored spots it maximizes exposure to the 69.9 unconfirmed-cap boundary.
**Also:** `forecast_confidence` reaches **zero** of the six sim tools (the "shipped complete, reached nobody" class recurring on the newest disclosure axis — same history as `directional_conflict` before its renderer-enumerating guard); the override dict is process-global with no TTL (disclosed by design; inventoried by exactly one surface); the dev.db fallback nuance is as stated in R11-05.

---

## SECTION 9 — UNVERIFIED RISKS AND OPEN QUESTIONS

| # | Suspicion | Why suspected | Missing evidence | Exact test required | Priority |
|---|---|---|---|---|---|
| U-1 | The F-01 low-FPS trip fires under real user conditions at some measurable rate | Codex observed it live once; this session could not reproduce (healthy run); the cold-backend regime plausibly gates it | Fleet occurrence rate | The R11-15 uplink counting `FPS_drop_detected`→flip transitions; or the `force_marine_fallback` deterministic soak | HIGH |
| U-2 | Mixed-run frames are actually served during ingest windows (mechanism proven; live occurrence not sampled) | R11-04 mechanisms are structural | A caught instance | Response-level run census on `/grid_series` during an ingest window (needs R11-04's serialization fix first — the fields aren't in the frames to observe) | HIGH |
| U-3 | L2 CDN staleness on product bodies after ingest (the manifest half was proven in 07-06; products kept max-age 3600) | `store.py`'s own scar comments | Byte-compare | Overwrite one product, immediately restore on the serve box, compare bytes | MEDIUM |
| U-4 | `userTier` can change mid-session (decides whether R11-17's zombie shutdown is live or latent) | Effect deps include `userTier` | A live tier-change path | Grep the auth/subscription flow for tier updates without remount; or instrument `shutdownEngine` calls | MEDIUM |
| U-5 | Production Render env flag state (`SURF_TIDE_DEPTH`, `RATING_OBS_GATE`, `SURF_PARTITIONS`, `L2_WRITER`, …) | Same standing gap as two prior audits; gates several findings' reach | One dashboard screen | Owner reads the Render env screen (no code) | HIGH (cheapest) |
| U-6 | Open-Meteo JSON lane can deliver NaN in practice (guard absent; exploitability unknown) | R11-07 NaN asymmetry | An observed NaN body | Add the one-site `x != x` guard regardless; optionally log-and-count | LOW |
| U-7 | The uniform-location per-frame lookups and land-mask rebuild bursts are measurable jank contributors | Agent-observed patterns; magnitude unmeasured | Frame-time attribution | `__SCRUB_PROBE__.bench` correlation of `mask_rebuild` events with long frames | LOW |
| U-8 | ~~Tide waiver~~ **REFUTED by artefact pull (this session)**; surviving hypothesis: point-lane vs precompute-lane input sampling divergence (wind leg / swell_from) | Both reds show sim BELOW glyph (tide predicts the opposite); heights match <2%; live repro shows exact parity at the current hour | Which factor diverges at a red hour | The probe now records both sides' limiter + factor vectors per diverging row (shipped this session) — the next red self-diagnoses. **Margin unchanged** | Resolved→instrumented |

---

## SECTION 10 — PERFORMANCE HOTSPOT RANKING

Live production figures from this session's telemetry capture where marked; others carry the prior master's measured harness figures (ratios transfer, absolutes don't) or "measurement required".

| Rank | Component | Type | Evidence | Current cost | Optimization direction | Confidence |
|---:|---|---|---|---|---|---|
| 1 | `/api/weather/grid_series` (surf flavor) | Composite backend | **Production telemetry this session:** n=39, avg 10.4 s, p90 32.1 s; prior interleaved control: 20× surf=0 | Dominant serving cost | Per-frame timing inside `resolve_grid`; the shipped argmin/manifest-index/deepcopy fixes address parts; re-measure before more | HIGH |
| 2 | Cold backend request storms | Infra | This session: 60 s ECONNABORTED on ancillary routes; health p99 100.5 s; box uptime 24 min at probe | Cold-start regime is the plausible F-01 trigger environment | External uptime probe (the cron-delivery fix) + keep-warm reliability | HIGH |
| 3 | MapWebGL wholesale re-render per scrub commit | Frontend CPU | `scrubPerfProbe.js` header + props at HEAD; ~11 Hz commit throttle bounds it | Known felt jank; measured by the in-repo probe | The planned context-split; A/B via `__SCRUB_PROBE__.bench` (contract: `newMarineClears`/`newParticleReinits` stay 0) | HIGH |
| 4 | Land-mask rebuilds (4096×2048) | GPU upload + main-thread paint | Each rebuild = ~32 MB `texImage2D` + 100–250 ms paint on LRU miss; bursts correlate with gestures; observed repeatedly in this session's console | Bounded by design; bursts during pan/zoom | Correlate `mask_rebuild` events with long frames before touching the tuned retain ladder | MEDIUM |
| 5 | Per-hour standalone coarse-base re-encode at wide zoom | Frontend CPU | LRU key includes hour → every scrub step re-encodes the base (mask spared via ref-count) | Doubles encode work while scrubbing wide | In-place `texSubImage2D` update of the same-identity base | MEDIUM |
| 6 | Cold bathymetry (backend) | I/O page faults | Prior master: 5.93 s / 10k fresh coords, 593× cold/warm | Cold path only | Warm-on-start over the served coordinate set (Phase 2 candidate, unshipped) | MEDIUM |
| 7 | `coarse_gulf_fill` | Backend CPU | Prior master: ~207 ms per `/grid` at production cell counts | Unchanged (not in the shipped set) | Memoise per product-id pair + thread | MEDIUM |
| 8 | Wind particle reseed churn on pan/zoom | GPU alloc | delete+realloc of 296²–384² texture pairs per recenter/tier crossing | Gesture-time churn | Route through the in-place reseed helper (exists in marine) | MEDIUM |
| 9 | Per-frame `getUniformLocation` lookups | GPU driver overhead | ~25 lookups/frame in one marine pass alone | measurement required | Cache locations per program at init | LOW |
| 10 | Encode-dup on boot/commit storms | Frontend CPU | `__RAW_GPU__.encodeDupCount` instrument exists; rate unread | measurement required | Read the counter live, then the deferred short-circuit | LOW |

⚠️ The request-volume denominator the prior master called "the single missing instrument" now **exists** (`request_telemetry`) — ranking #1 above uses it. The client-side equivalent (R11-15's uplink) is the remaining missing denominator for ranks 3–5, 8–10.

---

## SECTION 11 — FORECAST ACCURACY AND PHYSICS ASSESSMENT

Kept strictly separate from performance (§10). Speed changes in the 08-08/09 ship-set are bit-identical by construction and change no forecast.

### 11.1 Data correctness
Offshore inputs are 9–25 km global wave products (Open-Meteo-served ECMWF/GFS + native GRIB lanes) with honest snapping/interpolation provenance on the point path (F-08, corrected). Known input-quality facts carried from the measured record: the paired-lane census found the free competitor lane ~52% better than the legacy lane and "EURO" resolves to **three** upstreams (why R11-04's provenance stripping matters); ERA5 underestimates extremes 30–32% (shape only, never tails); the offshore input-compression signal is real but conditioned-on-observation (regression-to-mean caveat — condition on the model before acting).

### 11.2 Numerical correctness
The dispersion solve converges to machine precision (6.3e-16, prior master, unchallenged). The known numerical seams are compositional, not kernel: the H1/10 cap seam (27% over-ceiling band, non-monotonic; now comment-defended as a γ·d statistic choice — an owner/calibration question) and the single-vs-partitioned cap statistics (26.7%, reach-zero while `SURF_PARTITIONS=0`).

### 11.3 Offshore forecast capability
Three deterministic lanes (GFS native 336 h+; ICON 168 h native + estimated tail; EURO 240 h native + stored estimated 241–336 h), capability-driven horizons, 0.25° regional tiles now covering 241 more spots (08-09 expansion, cadence held at 32 h). Deterministic switching is not UQ (F-07 verified): the one probabilistic signal is the 5-member ECMWF spread reaching two rendering components.

### 11.4 Nearshore transformation capability (honest classification, per-process)
| Process | Status |
|---|---|
| Shoaling (Ks) | **Physically modelled** (per-spot, via geometry chain) |
| Depth-limited breaking (γ·d cap, H1/10 convention) | **Physically modelled** (with the R11-13 seam caveat; cap binds only where break depth exists — 39× reach difference) |
| Shelf friction (Kf) | **Physically modelled** (empirically calibrated floor) |
| Refraction | **Empirically corrected** — one global scalar `Kr=0.797`, a validated pair with H110; not ray-traced |
| Swell-direction exposure / shadowing | **Empirically corrected** with a hard 0.10 floor; the built spectral shadowing (`swell_exposure_fraction`) is validated and **never called**; the dominant instability is the relative aim angle (50% level-flip sensitivity), not the floor's shape |
| Tide (η in the breaker cap) | **Implemented, flag-OFF** (`SURF_TIDE_DEPTH`, owner-gated; the 0/172 census was taken on a frame where the cap couldn't bind — worthless without a positive control) |
| Wave setup, diffraction, bottom-friction spectra, nearshore currents, sandbars, headland/cove geometry beyond shore-normal, multi-partition spectra (flag off), local wind-wave growth | **Absent or planned** — correctly so per three consecutive audits: the binding constraint is measured to be **input coverage** (tiles, break depth, shore normals, swell direction), not physics sophistication |

**The frontend renders a further, *presentation-layer* nearshore treatment that diverges from all of the above** (R11-11.5): three inconsistent land-adjacent policies. That is a display defect, not physics.

### 11.5 Observation validation
Real machinery, freshly operational: 60-buoy NDBC residual loop (8,208+ archived pairs), skill ledger with keep-earliest eviction + persistence baseline, accuracy monitor able to go RED on MAE with REFUSE semantics, per-band/per-region archives. **Constraints that gate every claim:** first post-fix scored ingest pending (self-expiring grace to 08-12); monitor cron never self-fired; thresholds calibrated on 3.4 boreal-summer days (self-documented); skill-MAE gate deliberately unarmed until ~08-22. **Therefore: no calibration change, constant tuning, or bound widening is justified by current operational evidence** (F-06 adopted as a standing constraint). Wind residuals are parsed and unit-tested but scored nowhere (still-open opportunity). The answer to "how will the system prove a change improved the forecast?" is now concrete: the ledger's per-lead skill vs persistence, once two clean weeks exist — that machinery did not exist at the prior master's writing.

### 11.5a The simulator's scientific standing
The weather-sim MCP delegates its entire physics to the production chain in the production order (verified at HEAD, AST-guarded — R11-18); its `parity` block validates **wiring, never physics** (both numbers derive from the same offshore Hs through the same chain — a shared physics error passes it by construction; accuracy against reality is the buoy/ledger lane's job). Its one live *scientific* asymmetry against the served glyphs is the declared tide waiver (up to 2× multiplicative where a tide band exists and RATING_TIDE is on in the lane) — a disclosure/composition question now feeding the parity monitor, not a physics defect.

### 11.6 Improvement opportunities (accuracy-ranked, unchanged priorities re-verified)
1. Let the ledger mature; arm the skill gate on schedule. 2. Continue 0.25° tile coverage (largest genuine accuracy lever; ~55% of spots still on global forcing before the latest expansion; tie-break already fixed). 3. Break-depth completion (multiplies the cap's — and tide's — reach ~39×). 4. Wind-residual scoring (zero new requests). 5. The offshore input-compression investigation, conditioned on model height. 6. Swell-direction quality + shore-normal *jointly* (each contributes ~equally to the 50% flip instability — price both before funding either). ⛔ Rejected-and-stays-rejected: γ-thread work (0.145% reach), finer bathymetry (0.72% vs 16.83%), learned transform (labels accrue at 0.00/day), quantile map (its own fitter says NO-GO).

---

## SECTION 12 — STATE-OF-THE-ART OPPORTUNITY MATRIX

The prior master's 40-row matrix was re-validated by the delta agents; rows unchanged at HEAD are not repeated. New/changed rows from this audit:

| Opportunity | Problem solved | Expected value | Complexity | Regression risk | Evidence | Decision |
|---|---|---|---|---|---|---|
| Clear/gate `__MARINE_ENGINE__` + backstop flag-gate + terminal truth stages | R11-01 churn loop | Ends the unbounded re-drive class | Low | Low–Med | Static trace + deterministic repro path | **Adopt** |
| Run identity on series frames (+ `cycle_dt` as true run_time) | R11-04 | Mixed-run detection; honest provenance; fixes the falsified EURO guess | Low (serialization) / Med (cycle) | Low | Fields exist at the build site | **Adopt** |
| Build stamp in truth/telemetry payloads | R11-03 | Release-correlated field diagnostics | Trivial | Low | Both ends exist | **Adopt** |
| Client→server telemetry uplink (fixed-cardinality, modeled on `request_telemetry`) | R11-15 | Fleet visibility of context loss, stale bundles, truth violations, FPS | Low–Med | Low | Both halves already built | **Adopt** |
| Point api-metrics at `request_telemetry.snapshot()`; make `/api/weather/status` measure-or-refuse | R11-08 | Ends fabricated health | Low | Low | Data source now exists | **Adopt** |
| Worker `onerror` + reply-ordering guard + zero-fill→null | R11-07 worker cluster | Un-freezes the pressure lane's failure mode | Low | Low | — | **Adopt** |
| dt-normalized advection (kill-switch pinned dt=1) | R11-09 | Hardware-independent motion | Low–Med | Med (changes tuned look) | Fallbacks already dt-correct | **Prototype** (A/B behind flag) |
| Port marine's 4 invariants to wind (deviceTier, reduced-motion, OOB, in-place reseed) | R11-09 | Closes directional engine drift + a11y mandate gap | Low | Low | Marine implementations portable | **Adopt** |
| Retire/pin the ICON client blend | R11-06 | One composition per hour | Med | Med | Backend bake already exists | **Prototype** (serve baked products via per-hour lane first) |
| Executed-GL pixel harness (synthetic asymmetric grid + readPixels) | R11-14 | Converts 4 PARTIAL test axes to COVERED | Med | Low | e2e scaffolding exists | **Adopt** |
| Canvas-hash "hour change changes the frame" e2e assertion | R11-14 | Pins the composite scrub chain | Low | Low | Existing e2e test extends | **Adopt** |
| Legend/readout truth fixes (labels, ramp-sourced wind legend, slot-URL sampling for cross-falls, one nearshore policy, ft/m threading) | R11-11 | Number/color agreement | Low each | Low | Fix patterns exist in-repo (`decodedOmSampler`, `applyThemeWaveScale`) | **Adopt** |
| Hour-0 unification + served-frame-derived label | R11-12 | Label/frame honesty | Low | Med (changes label behavior) | — | **Prototype** |
| Arm `marineCommitArbiter` (shipped dark, 3000/3000 differential-tested) | R11-06/F-09 | Replaces the branch-heavy guard chain with the pure reducer | Low | Med | Shadow divergence ring exists | **Benchmark First** (read `arb_shadow_diverge` rate, then flip) |
| Serve-side run-age ceiling → user-visible staleness state | R11-04 adjunct | Stale-run honesty | Med | Med | data_health thresholds exist | **Prototype** |
| Held-frame/estimated badge on scrubber/layer chip | R11-07 residual | No-coverage honesty in-map | Low | Low | Three-theme mandate applies | **Adopt** (design-gated) |
| Zarr / JAX / GPU / Numba / neural emulators / nested grids / SWAN / GCN / KD-trees / closed-form dispersion / repo-wide `extra=forbid'` | — | — | — | — | Priced and rejected by three consecutive audits + this one's re-verification | **Reject** (unchanged) |

---

## SECTION 13 — REGRESSION RISK MATRIX

| Change | Risk | Potential failure | Detection | Guardrail | Rollback |
|---|---|---|---|---|---|
| R11-01 fix (global clear + flag gate + terminal stages) | LOW–MED | Backstop stops healing a *genuine* empty engine | The healers' own counters (`__MARINE_ENGINE_EMPTY_RECOVER__` etc.) | Mounted integration test w/ fake time; `force_marine_fallback` soak; gate each leg separately | Two independent kill switches (one per seam) |
| Series-frame run/provenance fields | LOW | Payload size growth; a consumer choking on new keys | Series page byte-size check | Additive-only fields; frame test | Revert serialization |
| True cycle_dt as run_time | MED | Anything comparing run_time semantics (prefer-newer merge, prune ranking, +6h slack guard) shifts | The named compensation sites (`store_helpers.py:20-45,65-78`) | Keep `ingested_at`; change consumers one-by-one with tests | Field-level revert |
| dt-normalized advection | MED | The tuned 60 Hz look changes; speed-encodes-intensity perception shifts | Visual A/B | Kill switch pinning dt=1; ship OFF, flip after A/B | Env/window flag |
| ICON blend retirement | MED | Far-hour ICON goes blank where the bake lacks coverage | Coverage census of baked products vs blend reach | Serve-baked-first with blend as fallback for one cycle | Re-enable blend |
| Wind invariant ports | LOW | Pool size / motion damp changes visuals | Screenshot A/B | deviceTier already tested for marine | Per-item revert |
| Legend/readout fixes | LOW | User-visible label changes | — | Pin new legends to their ramps (the GLSL-parse pattern) | Trivial |
| Hour-0 unification | MED | Every consumer of the per-hour lane's rounding shifts by ≤1 h | The ±1.5 h snap absorbs; assert lane agreement in a test | Flag the snap rule | Env flag |
| Arbiter arming | MED | The 166-divergence class the shadow found | `arb_shadow_diverge` ring must read ~0 first | Shadow → per-cohort flip | `__RAW_MARINE_ARBITER__` off |
| Truth terminal stages | LOW | Absence watchdog double-reports | Watchdog dedup per lane exists | Vocabulary-only addition | Revert |
| Cap-seam conversion fix | **HIGH** | Served heights change for real users below the cap | Winter-frame census with the η=−6 m positive control | Owner sign-off; flag | Env flag |
| `SURF_TIDE_DEPTH` / `SURF_PARTITIONS` / `RATING_BREAKER_TYPE` flips | **HIGH/VERY HIGH** | As per prior master (one-sided downgrade; 64.6-pt client drift + 26.7% path divergence; 76% out-of-validity slopes) | Censuses with positive controls | R11-02 closed first; all lanes together; owner | Env flags |

Conservatism boundaries (unchanged from the instruction's list): projection, grid orientation, units, direction, time, interpolation, ocean masks, particle integration, shader UVs, blending, bathymetry, GPU ownership — every change touching these requires a pinned before/after on the golden assets in §14.

---

## SECTION 14 — ZERO-REGRESSION VALIDATION SPECIFICATION

**Golden datasets (exist — preserve):** the 4,320-row rating goldens (byte-current at HEAD); `test_surf_point_parity` real-coordinate geometry set (Mavericks/Montara/… covering every precedence branch); the height-anchor pair (saturated 29.50 ft control + non-saturated 10.11 ft @ 2 m/14 s with Kr-drift discrimination at 12.68 ft); `_old_sampler` verbatim differential; the science-registry ratchet; `decodedOmSampler` row-0=south pin; the GLSL-parsed rating ramp anchors; flag-lane parity; LOC/encoding ratchets.
**Golden gaps to add:** a keyword-arg golden set over `reference_size_m`/`partitions`/`break_depth_m` (the declared 6-of-12 blind spot, now with RATING_LOCAL_SIZE ON in production); partition goldens straddling 0.4525/0.50/0.5525; a full-chain (geometry+height+rating) snapshot per region.
**Golden coordinates (Appendix C):** the 12-region matrix with per-region behaviors to pin.
**Numerical tolerances:** rating scores ±0.1 (banker's rounding artefact, 55 known diffs, 0 level diffs — keep exact levels); heights ±0.01 ft at anchors; bit-identity for all Phase-1-class optimizations (the house delegation pattern).
**Visual/rendered tests:** the executed-GL harness (synthetic hot-cell grid → readPixels at projected coordinate: kills orientation/registration/encode classes); canvas-hash inequality across an hour scrub; both inside the existing SHA-gated e2e.
**Forecast-skill metrics:** per-source × lead MAE vs persistence (already computed); arm as a gate ~08-22; refuse below n=30; never tune on <2 clean weeks.
**Performance budgets:** p50/p90 per route from `request_telemetry` snapshots as the baseline (this session's capture is the first archived denominator); scrub budget via `__SCRUB_PROBE__.bench` with `newMarineClears=0`/`newParticleReinits=0` as hard contract.
**Memory budgets:** the existing count+vector-budget product cache bounds; `__RAW_GPU__` accounting after the R11-10(d) fix makes GPU drift assertable.
**Race-condition tests:** keep the 8-scenario matrix green (§8 agent evidence names each guard's test); add the worker reply-ordering test (R11-14.3).
**Shadow/canary:** shadow execution for the science chain remains the largest unbuilt structural item (rate_one_spot is pure; the precompute already rates every spot 3×/day — diff candidate-vs-live constants per cycle); **fix the inverted exclude precedence at `p2.py:555-561` before wiring any canary**; keep deterministic output as fallback for every future ML lane.
**Acceptance criteria for any forecast-touching change:** goldens byte-stable (or the change's census explains every moved value), skill ledger non-regressing at matured leads, kill switch present, rollback stated, and the flag registered in `_RATING_FLAGS` in the same commit (the lane-parity guard enforces this — it caught exactly this omission on 08-09).

---

## SECTION 15 — UPGRADE ROADMAP

### Phase 0 — Baseline protection (mostly SHIPPED 08-08/09; close the remainder)
Shipped and verified: skill-ledger fix, accuracy monitor, non-saturated anchor, persistence baseline, request telemetry. **Remaining Phase-0 items:** external uptime probe (the cron-delivery hole — the cheapest single stability purchase left); the executed-GL pixel harness + canvas-hash scrub assertion; build stamp in truth/telemetry payloads; run/provenance fields on series frames; the keyword-arg golden set. Nothing else may precede these.

### Phase 1 — Surgical stability repairs (confirmed defects only, no forecast math)
R11-01 (churn loop, both seams + terminal stages) · R11-07 worker cluster (`onerror`, zero-fill→null, reply ordering) · R11-08 (measure-or-refuse status endpoints) · R11-10(a) Promise-as-geojson one-liner (+ type guard) · R11-10(b–e) GPU hygiene · staleReason classification · the three unbounded frontend lanes' deadlines · HTTP-status honesty on `/conditions/*` (with a client-contract check) · the `surf_point.py` silent-except pair gets a log line. Do not combine unrelated repairs in one commit.

### Phase 2 — Low-risk performance (no forecast mathematics)
The MapWebGL context-split (probe-gated) · wind in-place reseed + invariant ports · coarse-base in-place update · uniform-location caching · `coarse_gulf_fill` memoise · cold-bathymetry warm-on-start · encode-dup short-circuit (instrument first — counter exists).

### Phase 3 — Data-pipeline modernization (shadow first; no Zarr)
True cycle identity (`cycle_dt`) + `ingested_at` split · confirm-then-register on L2 upload · L1 freshness validation · retention-prune root-cause + age-filtered fold-in · product CDN cache decision (verify U-3 with the byte probe first) · spot-ratings CAS · reconcile loud-fail counter.

### Phase 4 — Numerical acceleration behind flags
Only delegation-pattern, bit-identical work (house pattern proven twice). ⛔ No JAX/GPU/Numba — the global forecast remains ~4 s of CPU.

### Phase 5 — Nearshore modeling (owner-gated, census-gated)
Cap-seam conversion (winter frame + positive control) · `SURF_TIDE_DEPTH` (after break-depth completion multiplies its reach) · break-depth + tile coverage continuation · coastal shadowing wiring · R11-02 closed **before** `SURF_PARTITIONS` is even scheduled · one nearshore *display* policy (R11-11.5).

### Phase 6 — AI-assisted enhancement (only after the ledger matures)
Reliability diagram/Brier for the categorical rating first (needs no new data). Residual correction stays blocked on its own fitter's NO-GO. Deterministic output remains the live path in every case. ⛔ No neural emulator, no GNN.

---

## SECTION 16 — PRIORITIZED ACTION REGISTER

Scores 1–5 (Cx/Risk/Ops are costs). **≤10 immediate actions.**

> **EXECUTION RECORD (same day, 2026-08-09, commits `512b1cb6..9fe18414`):** actions **3, 4, 5, 7, 9-partial, 10** were implemented and shipped hours after this register was written — the churn-loop three-seam fix (+ the Promise-as-geojson guard from action 9), series-frame run identity + run census, build stamps on all truth/telemetry payloads, the worker-crash/fabricated-zeros cluster + both fabricated-status endpoints + the staleReason classification, the probe self-diagnosis instrumentation (action 10's artefact pull **refuted the tide hypothesis by sign** — see R11-18's resolution), and additionally action 6 (the JS-mirror refusal port, golden-verified against Python). Actions 1–2 (uptime probe; clock-watching) and 8 (executed-GL harness) remain open; the owner items remain owner-gated.
> **Batch 2 (same day, `2e20122d..086ee773`):** R11-10(b/d/e) GPU hygiene (score-texture dispose leak, `safeDeleteTexture` accounting at teardown, state-isolation units 0–6); R11-09 wind ports (device-tier pool + `prefers-reduced-motion` damp — the accessibility-mandate gap); R11-11's rain-legend unit label; the four worst silent-excepts now log (`surf_point` asset/override reads, the frame-honesty stamp, the bucket latch); and the parity probe's gate now compares ungated-vs-ungated (its docstring made true), labels unattributed reds `FAIL (INSTRUMENT)`, and keeps prose out of the JSON artefact (the stdout contamination that broke the 08-05 artefact). Clock update: **the accuracy monitor's cron self-fired 08-09T07:57Z and passed** — the 08-10 deadline is closed.

> **Batch 3 (same day, `822a0785..42242bef`) — THE SCHEDULED LANE, which none of the above covered.**
> Batches 1–2 were verified **by HEAD SHA across the push/PR lanes**, and that is precisely the check
> that cannot see a cron run: it fires on a SHA already passed. Enumerating latest-run-per-workflow
> found **two standing reds nobody had looked at** — `Forecast Calibration Census` red on **6
> consecutive runs since 08-08T09:19Z**, and `Marine Nightly` red on most days since **08-03**.
> Both were **instrument defects, not product defects**, and both are now fixed, kill-switched and
> live-verified on `42242bef`:
> - **Census** — the control pair named it: last green and first red printed the *identical*
>   `Pipeline ref=1.5 m expected >=1.5` with opposite verdicts (a zero-margin bound crossed by drift;
>   1.48 today). Cause, verified from git objects: bounds authored `d8635716` at `REF_PERCENTILE=0.80`,
>   `e3aedb06` moved it to 0.50 the next day, bounds never re-authored — a p80 envelope grading a p50
>   population, ~21% too high, for ten days. **Second instance of R11's "threshold outlives the
>   calibration of its input", which promotes it to a class.** Fix pages on the *percentile-invariant*
>   claim (ordering, measured **6.6%** stable across p0.50–0.85 vs **27%** for the absolute quantity)
>   and downgrades an out-of-frame absolute miss to `BOUNDS STALE` (warn, not page). Bounds frozen
>   byte-for-byte and still page in their own frame; `CENSUS_STRICT_ABSOLUTE_BOUNDS=1` restores the
>   old gate. Live: run `31316077890` green, margin **1.258×**, warning emitted.
> - **Marine Nightly** — control pair from two runs on the *same commit* 13 min apart: backend asleep
>   → 30 findings (20 transport); backend awake → **0 findings, 415 frames**. The verdict counted every
>   console error against a "≤2 findings" budget and graded `MULT0_FRAME` (*a frame drawn with no data*)
>   as a rendering defect. Fix = warm (preflight), classify (INSTRUMENT vs RENDER), refuse (exit 3,
>   warn). The classifier's regex was corrected by replaying the **real retained trace**, which exposed
>   two false negatives a fixture would not have.
> **Still open from this batch:** the oversize multipliers remain orphaned by the same percentile move
> (the registry says so and nothing enforces it); the census exemplar grades **one spot**, so a
> neighbour over the same bound is invisible; the `reference_size_m` disclosure and the parity gating
> both wait on the **15:45Z precompute** (glyph frames disclose 0/48 until then — the parity green at
> 13:33Z is real but does *not* yet exercise the disclosure path).

> **Batch 4 (same day, `fee36d57..6568d94b`) — readout truth, plus a USER-OBSERVED divergence.**
> Both self-resolving clocks CLOSED and verified in production: `reference_size_m` went 0/64 → **88/88**
> on the wire across three regions after the 16:01Z precompute, and the parity probe's next run
> reports **glyph discloses 48/48**, `gating_reference_lane: glyph` (was the `lookup_spot` fallback),
> worst `d_score` **16.8 → 0.1** — a 164× collapse that reproduces the d=0.0 replay control end to end
> and confirms R11-18's reference-generation mechanism in production.
> - **R11-11 item 2 SHIPPED** (`6568d94b`): the wind legend was a byte-exact copy of the legacy 8-stop
>   0–50 kn ramp while the shipped ramp is 13 Beaufort stops to 75 kn — so **calm (vivid magenta) read
>   as hurricane**, and 64–75 kn had no label. Now derived from the ramp, value-proportional, with
>   equal-value ticks (item 3 fixed for this legend too). Beach pinned as the theme where the legend
>   is load-bearing: its calm and hurricane ends are only 0.34 apart.
> - ⚠️ **CORRECTION to batch 3's note:** "~16% of marine serves publish no grid bounds" was WRONG in
>   framing. `__MARINE_SERVE_DIAG__` is written only on a cache HIT, so it is simply absent before the
>   first serve and stale during fetch-heavy periods. Measured unknown windows across four storms:
>   1s / 24s / 33s / 95s — startup, except when the backend was slow. Not a missing field.
>
> **✅ MEASURED — THE BAND/GLYPH ZOOM DEPENDENCE, REPRODUCED (2026-08-09, both lanes, live prod).**
> Sweeping bbox size at a fixed centre and reading BOTH lanes at the same coordinate and hour:
>
> | spot | GLYPH | BAND @ close (0.25° cells) | BAND @ wide (2.0° `mid_res_tier`) |
> |---|---|---|---|
> | Pipeline | 2.3 `very_poor` | 6.3 `very_poor` (2.7×) | 2.6 `very_poor` |
> | Mavericks | 12.5 `very_poor` | **28.3 `poor`** (2.3×) | 10.5 `very_poor` |
> | Sebastian Inlet | 25.4 `poor` | **57.3 `fair_good`** (2.3×) | 47.0 `fair` |
>
> **The close-zoom band systematically over-reads the glyph by 2.3–2.7× at all three spots.** Whether
> that becomes a VISIBLE colour difference depends on whether it crosses a `_BUCKETS` boundary —
> Mavericks straddles 14 (very_poor→poor) and is the owner's exact report; Pipeline stays inside
> `very_poor` both ways and looks fine; Sebastian is 2–3 levels off at every zoom.
> **Four candidate explanations KILLED by the measurement:**
> 1. *Distance to the spot* — the wide-zoom rated cell is **0.34–0.71° away (38–79 km)** vs 0.10–0.12°
>    (11–13 km) at close zoom. It is 3–7× FURTHER and agrees BETTER.
> 2. *Input height* — Pipeline's raw offshore height is **1.55 m close vs 1.60 m wide (+3%)** while its
>    band score differs **2.4×**. The inputs agree; the outputs do not.
> 3. *The local-size flag* — `local_size: true` in the `surf_transform` tag at BOTH tiers.
> 4. *cell_ref vs spot_ref* — a larger cell reference (Pipeline 2.164 vs 1.481) makes `size_score`
>    **smaller**, so the reference gap predicts the band reading LOW. Observed sign is the opposite.
> ⇒ **The divergence is in the PER-CELL COMPOSITION, not in the inputs, the flag, or the blob.** The
> band rates each cell with that cell's own bathymetry-derived geometry (`shelf_depth_at`,
> `is_coastal`, `shelf_width_km`, `shore_normal_at`) plus co-sampled wind, at the CELL's coordinate;
> the glyph uses the SPOT's resolved geometry. Two different questions rendered as one answer, and the
> grid tier decides which cell's geometry answers it. ⚠️ The exact binding sub-term is NOT yet isolated
> (needs a per-cell geometry dump alongside the score) — do not tune either lane before it is.
> ⭐ Instrument note: the `surf_transform` tag is nested at `grid.diagnostics.surf_transform`; reading
> `diagnostics.value_kind` falls back to the product's top-level `value_kind`, which stays
> `wave_height` even when the rating overlay ran. A first pass read every row as "not rated".
>
> **⚠️ PRIOR ENTRY (superseded above by measurement) — OWNER-OBSERVED: the rating BAND and the spot GLYPHS disagree on colour at
> CLOSE zoom, and agree at wider zooms that still paint the band** (owner, 2026-08-09). This is queue
> **E#1** seen in the wild for the first time. Established: the two surfaces resolve their reference
> from **different lanes** — the band via `reference_for(clim, lat, lng)`, a COORDINATE lookup
> (`grid_resolver_surf.py:104`), the glyphs via the per-SPOT reference now disclosed on the wire. The
> census's own E#1 artifact measures the gap: **Pipeline spot_ref 1.484 vs cell_ref 2.164 (46% apart)**,
> Mavericks 1.694 vs 1.922, Kommetjie 2.469 vs 2.079 — same height, two yardsticks, two colours.
> ⛔ **The zoom dependence is NOT yet explained by that alone** and is the discriminator to chase: a
> coordinate lookup should get *more* faithful as cells shrink, not less, so either the close-zoom band
> takes a different reference path or the wide-zoom agreement is an artifact of the rating-band
> cross-fade (`resolveRatingBandFade`) blending toward the height wash. Do not "fix" either lane before
> that is measured. The parity probe already keeps this visible as `d_score_served`, separate from the
> shared-input `d_score` that just went to 0.1.

| # | Action | FcstAcc | User | Perf | Rel | Evid | Cx | Risk | Ops | Priority |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | External uptime probe on `/api/health` + monitor endpoint | 2 | 2 | 1 | 5 | 5 | 1 | 1 | 2 | **P0** |
| 2 | Watch the three clocks (ledger `scored>0` by 08-12; monitor cron by 08-10; new-region onboarding) — *observe, don't tune* | 5 | 1 | 1 | 4 | 5 | 1 | 1 | 1 | **P0** |
| 3 | R11-01 fix + terminal truth stages + mounted integration test | 1 | 3 | 3 | 5 | 5 | 2 | 2 | 1 | **P1** |
| 4 | Run/provenance fields on series frames (R11-04 serialization half) | 3 | 3 | 1 | 4 | 5 | 1 | 1 | 1 | **P1** |
| 5 | Build stamp in truth/telemetry/client-diagnostics (R11-03) | 1 | 1 | 1 | 4 | 5 | 1 | 1 | 1 | **P1** |
| 6 | R11-02 JS-mirror port + goldens + counter-test fix | 3 | 4 | 1 | 4 | 5 | 2 | 1 | 1 | **P1** |
| 7 | Worker onerror + zero-fill→null + status-endpoint honesty (R11-07/08 quick set) | 2 | 3 | 1 | 5 | 5 | 1 | 1 | 1 | **P1** |
| 8 | Executed-GL pixel harness + canvas-hash scrub assertion (R11-14) | 2 | 4 | 1 | 4 | 5 | 3 | 1 | 1 | **P1** |
| 9 | Promise-as-geojson fix + GPU hygiene batch (R11-10) | 1 | 3 | 2 | 4 | 5 | 1 | 1 | 1 | **P1** |
| 10 | Pull the red-run parity artefacts; confirm/refute the tide-waiver mechanism (R11-18/U-8); fix the probe's paging predicate | 2 | 1 | 1 | 4 | 4 | 1 | 1 | 1 | **P1** |
| — | Legend/readout truth batch (rain label, wind legend from ramp, cross-fall sampling) (R11-11) | 1 | 4 | 1 | 2 | 5 | 2 | 1 | 1 | **P2** (first after the ten) |
| — | Client→server telemetry uplink (R11-15) | 2 | 3 | 2 | 5 | 5 | 3 | 2 | 2 | **P2** (after #1, #5) |
| — | Owner one-clicks: rotate both keys · Render env screen read · Vercel app uninstall · Netlify unfreeze decision · census-bound decision | — | — | — | — | — | — | — | — | **P0-owner** |
| — | dt advection, ICON blend retirement, hour-0 unification, arbiter arming | — | — | — | — | — | — | — | — | **P3 prototypes** |
| — | Learned transform, quantile map, γ-thread, finer bathymetry | — | — | — | — | — | — | — | — | **P4/PX** |

Each action's objective/files/dependencies/tests/rollback are specified in §8 and §13; none requires another's completion except as marked.

---

## SECTION 17 — RECOMMENDED IMPLEMENTATION SEQUENCE

> **If personally accountable for protecting the existing production baseline, I would authorize, in this exact order:**

1. **The owner screen-reads and one-clicks first** (env flags, both key rotations, Vercel uninstall, census decision) — minutes each, several findings' reach is bounded by them, and no code can substitute.
2. **The external uptime probe** — every other instrument's value is gated by delivery, measured at 5–32% of nominal.
3. **Nothing that touches accuracy until the clocks mature** — watch `scored>0` (08-12) and the monitor's first scheduled fire (08-10); arm the skill gate ~08-22 on two clean weeks.
4. **The P1 stability block** (actions 3–9), one commit per repair, each with its kill switch and its test-that-fails-before.
5. **The provenance pair** (series-frame run identity + build stamps) before any debugging session relies on those payloads again.
6. **Then the P2/P3 prototypes** in §12's order, each behind its flag with its A/B.

> **I would explicitly reject or postpone:**

- **Reject** (permanently, absent new evidence): Zarr/COG/Kerchunk/Dask, JAX/CuPy/GPU/Numba, neural emulators, GNN/nested grids/AMR/SWAN/FVCOM, KD-trees for the wind lookup, closed-form dispersion, repo-wide `extra='forbid'`, γ-thread investment, finer bathymetry as an accuracy lever. Three consecutive audits priced them against what they'd replace; all lose. This audit re-verified the load-bearing premises (4 s CPU global forecast; Range-streamed ingestion; 0.72% vs 16.83%).
- **Postpone**: `SURF_PARTITIONS` (until R11-02 + the cap-seam are closed and lanes flip together), `SURF_TIDE_DEPTH` (until break-depth completion and a positive-control census), the cap-seam conversion itself (owner + winter census), any canary (until the p2.py precedence inversion is fixed), the learned nearshore transform (the dataset is not growing — that is the finding), and all calibration/threshold tuning (F-06 constraint).
- **Not a defect, do not "fix":** the ask-echo `valid_time` contract (frontend depends on it; honesty fields carry the truth), the deliberate detach-not-abort switch policy, deactivation-retain, the EURO prewarm exclusion, and the two-orientation texture contract.

---

## SECTION 18 — FINAL ARCHITECT VERDICT

**KEEP.** The composition chain and its single write site; refusal semantics everywhere they exist; the stale-response guard stack; the commit choke; capability-driven horizons; Range-streamed ingestion; the science registry + ratchets; the golden/parity estate; honesty stamps; the degradation ladders; the two-orientation texture contract; the model-keyed frontend caches.

**PROTECT** (regression locks required): the six newly-stated invariants (§6 end); the argmin differential test; the partition-assertion CI structure; the SHA-gated e2e; the ask-echo contract; the arbiter's 3000-fixture differential.

**REPAIR** (confirmed defects, surgical): R11-01, R11-02, R11-03, R11-04 (serialization half), R11-07 cluster, R11-08, R11-10, R11-11 label pair, the `surf_point` silent excepts.

**OPTIMIZE** (same architecture): MapWebGL context-split; wind invariant ports; in-place paths; uniform caching; `coarse_gulf_fill`; bathymetry warm-on-start.

**MODERNIZE** (genuinely absent capability): the client telemetry uplink; true model-cycle identity; terminal failure vocabulary in truth telemetry; the executed-GL test lane; serve-side run-age staleness state.

**PROTOTYPE** (flag + census + owner): dt advection; ICON blend consolidation; hour-0 unification; arbiter arming; cap-seam conversion; shadow execution for the science chain.

**DEFER** (prerequisites missing): skill-gate arming (08-22); `SURF_TIDE_DEPTH`; partitions; reliability-diagram scoring (needs matured ledger); any canary (needs the precedence fix).

**REJECT**: the full §17 list. A more modern design is not a safer or better system; this codebase's risk lives in composition, reach, and measurement — and for the first time in the report lineage, the measurement layer exists and is running.

---

## APPENDIX A — FILE AND SYMBOL EVIDENCE INDEX (searchable)

| Finding | File | Symbol | Lines | Subsystem |
|---|---|---|---|---|
| R11-01 | frontend/src/components/map/WebGLMarineEngine.js | `window.__MARINE_ENGINE__` assignment | 98 | render control |
| R11-01 | frontend/src/components/map/useMarineScrubSettle.js | `needsRefetch` / backstop re-drive / clamp budget | 683, 764-766, 181-199, 708-762 | render control |
| R11-01 | frontend/src/components/map/useWebGLGuardrail.js | 12-window flip + exclusions | 44-160 | render control |
| R11-01/15 | frontend/src/components/map/weatherTruthTracker.js | `_TERMINAL_STAGES` / `_sweepAbsentChains` | 357-405 | telemetry |
| R11-01 | frontend/src/components/map/MapWebGL.js | fallback ternary / raster slots / flag reset | 853-868, 1027-1048, 98-104 | render control |
| R11-02 | frontend/src/components/map/surfRating.js | `effectiveSwellExposure` | 112-126 | rating mirror |
| R11-02 | backend/services/weather_pipeline/surf_rating.py | `MIN_SWELL_ENERGY_SHARE` refusal | 444, 474-476 | rating |
| R11-02 | frontend/src/__tests__/ratingParity.test.js + surfRating.test.js | 6-arg gate / counter-pin | 38; 221-227 | tests |
| R11-03 | frontend/src/components/map/marineForensics.js | `announceBuild` / STALE BUNDLE | 80-101 | release identity |
| R11-03 | backend/routes/health.py | SHA-embedded version | 159-191 | release identity |
| R11-04 | backend/services/weather_pipeline/store_helpers.py | `_build_product_filename` | 81-86 | storage |
| R11-04 | backend/services/weather_pipeline/grid_series_helper.py | frame builders (no run/provenance) | 158-172, 250-264, 477-493 | serving |
| R11-04 | backend/services/weather_pipeline/normalizer.py | run_time = now() | 142-144 | ingestion |
| R11-04 | backend/services/noaa_gfs_wave_fetcher.py | `_pick_cycle` (cycle known, discarded) | 197-214 | ingestion |
| R11-04 | frontend/src/components/map/marineGridSeries.js | pageKey / falsified EURO guess | 208-210, 236-260 | serving |
| R11-05 | backend/services/weather_pipeline/sim_forecast.py | `MODEL` / `_FORECAST_CACHE` | 55, 86-158 | sim |
| R11-05 | backend/services/weather_pipeline/sim_observed.py | `parity` omits model | 79, 205-206 | sim |
| R11-06 | frontend/src/components/map/backendWeatherServiceClientHelpers.js | ICON blend anchors/trend | 398-527, 574-603 | serving |
| R11-06 | backend/services/weather_pipeline/icon_marine_extension.py | baked estimates | 85-124 | serving |
| R11-07 | backend/routes/surf_data/conditions.py | 200-error bodies / whitelist | 92-95, 146-216, 327-331 | API |
| R11-07 | backend/services/weather_pipeline/route_helpers.py | ICON swell_2 zeros vs 404 | 470-539 | API |
| R11-07 | backend/services/weather_pipeline/viewport_service.py | `upstream_rate_limited` mislabel | 518-573 | serving |
| R11-07 | frontend/src/components/map/GridParserWorker.js + useGridWorker.js | zero-fill / no onerror | 71-73, 139-142; 22-55 | workers |
| R11-07 | backend/services/weather_pipeline/surf_point.py | silent excepts on geometry reads | 108-120 | physics chain |
| R11-08 | backend/routes/weather.py | hardcoded `/status` | 652-668 | observability |
| R11-08 | backend/routes/admin/system.py | writer-less api-metrics / placeholder error_rate | 478-514, 206-208 | observability |
| R11-09 | frontend/src/components/map/WebGLWindEngine.js / WebGLMarineEngine.js | dt-less `stableSpeedScale` | 540-544; 2166 | particles |
| R11-09 | frontend/src/components/map/WebGLWindLayer.js | innerWidth pool sizing | 222-224 | particles |
| R11-10 | frontend/src/components/map/WebGLMarineLayer.js | Promise-as-geojson | 651-668 | GPU lifecycle |
| R11-10 | frontend/src/components/map/WebGLMarineEngineInit.js | disposeEngine inventory (score-tex absent) | 242-279 | GPU lifecycle |
| R11-10 | frontend/src/components/map/WebGLStateIsolation.js | units 0-3 vs 4-6 | 48-91 | GPU lifecycle |
| R11-11 | frontend/src/components/map/MapWeatherControls.js | legends (rain label, wind CSS, tick spacing) | 18-52, 184, 225-239, 770-773 | UI truth |
| R11-11 | frontend/src/components/map/useOpenMeteoTileUrls.js | GFS cross-falls | 456-515 | UI truth |
| R11-11 | frontend/src/components/map/forecastHelpers.js | nearshore decay / model-guess sampler / mToFt | 75-119, 223-239, 381-411, 9 | UI truth |
| R11-12 | backend/services/weather_pipeline/grid_series_helper.py | floor-now | 322 | time |
| R11-12 | frontend/src/components/map/backendWeatherServiceClient.js | round-now `getSharedValidTime` | 189-251 | time |
| R11-12 | frontend/src/components/map/MapWeatherControls.js | raw-clock label | 327-331 | time |
| R11-13 | backend/services/weather_pipeline/store.py | reconcile fail-open / CDN cache-control | 108-219, 21-36 | storage |
| R11-13 | backend/scheduler/base.py | `tracked()` false success | 50-95 | scheduler |
| R11-13 | backend/services/weather_pipeline/surf_transform.py | cap seam | 517-527, 576-595 | physics |
| R11-14 | frontend/e2e/weather-simulation.spec.js | visibility-only assertions | 311-401 | tests |
| R11-15 | frontend/src/components/map/WeatherTelemetry.js | uncancellable FPS loop / ring | 72, 380-395 | observability |
| R11-15 | frontend/src/components/map/TruthOverlay.js | prod POST / `?diag=1` gate | 15-26, 103-146 | observability |
| R11-17 | frontend/src/components/map/MapWebGL.js | userTier zombie shutdown | 685-695 | render control |
| S-04 | frontend/src/components/map/WebGLMarineTextureEncoder.js | resident reuse / mask LRU | 467-518, 583-591 | GPU lifecycle |
| Inv-1 | frontend/src/components/map/WebGLWindShaders.js | clamp drift 85.0511 | 803 | projection |
| Inv-6 | frontend/src/components/map/OceanMask.js | mask authority stack / CDN fallback | 8-45, 30, 251-266 | mask |
| Inv-14 | frontend/src/engine/RenderPlanDispatcher.js | fail-closed FCE gates / second decoder | 447-482, 38-195 | FCE |
| R11-18 | backend/services/weather_pipeline/sim_rating.py | `calculate_surf_rating` (production order) | 228-305 | sim |
| R11-18 | backend/scripts/sim_health_probe.py | paging predicate / gated-score comparison / top-6 sampling | 538-540, 154-202, 134-135 | sim |
| R11-18 | backend/tests/test_rating_composition_parity.py | tide waiver declaration + 41% price tag | 134-174 | sim |
| R11-18 | .github/workflows/sim-parity-monitor.yml | flag mirror incl. RATING_TIDE=1 | 106-174 | sim |
| R11-18 | backend/services/weather_pipeline/surf_rating.py | `tide_fit` floor [0.5, 1.0] | 526-534 | sim |
| R11-18 | backend/weather_sim_mcp.py | `_SIM_OVERRIDES` (timeless) / six tools | 71-123, 177-760 | sim |

## APPENDIX B — ACTIVE VS LEGACY IMPLEMENTATION MAP

| Subsystem | Active implementation | Legacy/dormant | Runtime reachability | Removal risk | Disposition |
|---|---|---|---|---|---|
| Marine heatmap+particles | WebGLMarineEngine via MapLibre custom layer | GPUMarineLayer (Canvas2D) | Fallback-only (context loss / flags) | Load-bearing fallback — keep | Keep both |
| Wind | WebGLWindEngine | WindParticleOverlay (Canvas2D) | Fallback-only | Keep | Keep both |
| Field composition | Per-layer fetch→decode→texture ("forecast-authoritative") | FieldCompositionEngine + RenderPlanDispatcher upload path | 4 Hz diagnostics shadow; uploads fail-closed behind window flags | The dormant second decoder is the risk, not the removal | Correct the three stale "single source of truth" comments; decide dispatcher decoder's fate |
| Marine commit decision | Guard chain in `decideMarineCommit` | `arbiterDecide` (pure rewrite) | Arbiter runs in **shadow** on every commit; ships dark | Arming is the roadmap, not removal | Benchmark-first flip |
| Grid worker lanes | `calculatePressureExtrema` | `parseWind`/`parseMarine` (~600 LOC) | Dead (no callers) | None | Delete or wire with transferables |
| Row-order normalization | backend `normalizer.py` sort | GridParserWorker conditional reversal | Dead | None | Delete with the lanes above |
| Projection utils | In-shader `latToMercatorY` copies + MapLibre matrix | `engine-brain/projection-utils.js` | Test-only import | None | Delete or adopt as the single source |
| Render pipeline | MapLibre frame | `engine/render-pipeline.js` | Zero importers | None | Delete |
| GPU texture manager | Engines self-manage | `engine/gpu-texture-manager.js` | Imported, never bound (`ctx.gl` never passed) | Invites double-ownership if wired naively | Delete or document |
| Wind abort | WeatherEngine `windFetchController` | `windController.js` `windAbortController` | Dead (declared, never assigned) | None | Delete |
| Sim catalog | Live app catalogue via `fetch_catalog` | repo-root `dev.db` (3.0 MB, git-ignored, drifted) | Fallback lane + the admin persist path writes to it | Divergence documented in-code | Keep fallback; never let it serve silently (label the lane in payloads) |
| ICON >168 h | Backend-baked estimates (series lane) | Client blend (per-hour lane) | **Both live** — R11-06 | The blend is the removal candidate | Consolidate |
| est. power-law color | Neutralized (same colormap) | Shader branch behind `__RAW_ESTIMATED_POWERLAW__` | Lever-gated | None | Delete branch after a quiet period |

## APPENDIX C — GEOGRAPHIC VALIDATION MATRIX

| Region (coordinate class) | What to pin |
|---|---|
| Florida / western Atlantic (regional 0.25° tile + GFS regional products) | Tile-vs-global tie-break (resolution term); `florida_east_coast` product path; hurricane-season large-swell census frames |
| New York coastline | New `us_northeast` 0.25° region onboarding (stale-first pickup); shore-normal fit quality on a straight coast |
| Portugal / Spain (Azores region) | New `azores` region; EURO native vs estimated tail boundary (240/241 h) |
| Morocco | Coarse-only coverage (no fine tile): global forcing honesty; point-lane `coverage_scope` |
| El Salvador / Central America | Pacific swell-window exposure; aim-angle sensitivity (the 50% flip class) |
| Open Atlantic / open Pacific | `open_ocean` regime honesty (no coastal promotion; offshore == breaking suppressed) |
| Antimeridian (Fiji/NZ line) | Normalizer column mirror; shader `mod()` UV wrap; world-copy offsets; EURO dead-column repair (wind) |
| Island chains (Maldives atolls) | The land-present bit's 14 promoted spots; **Quarters/Yin Yang refusal = the pinned control** |
| Bay/cove (Venice/Lido; SF Bay) | Basemap-water overlay mask carving; inland-water guard; ribbon-endpoint land fade |
| High latitude (Norway/Alaska) | Mercator clamp behavior; latitude-dependent advection correction (cos-lat) |
| Bight/enclosed sea (Gulf of Mexico, Med) | `coarse_gulf_fill` donor semantics (GFS fills EURO/ICON masked cells, never invents land) |
| Depth-saturated big-wave point (Pipeline/Mavericks) | The two height anchors (29.50 saturated / 10.11 non-saturated); cap-engagement census |

## APPENDIX D — CODEX FINDINGS NOT ADOPTED (or adopted with correction)

| Codex claim | Why excluded/corrected |
|---|---|
| F-01 severity P1 / "the wave field did not recover"→no usable display | **Overstated**: a complete raster+canvas fallback renders when the flag is set; the loop is churn, not blankness. Adopted at P2 with the deeper root cause |
| F-02 headline "cannot be tied to a release" | **Contradicted at the artifact level** — both deployed surfaces tied to HEAD in minutes using in-repo mechanisms Codex didn't find; the truth-payload boundary was adopted (R11-03) |
| F-03(b) `_cached_live_forecast` cache symbol | **Never existed at any revision** (`git log -S` empty) — the functional claim was right, the cited symbol was inferred, not read |
| F-03(e) "output provenance does not state which model answered" | **Wrong for `get_weather_forecast`** (carries model + product_id both branches); right for the other three tools — adopted with that split |
| F-01 backstop cadence "every backstop interval" | Corrected: ~6 s effective cadence (blankStreak≥3 + 6 s min gap), not per-second |
| "63.5 points" as the mirror ceiling | Grid-dependent floor, not ceiling — 64.6 reproduced on a fresh grid; adopted with the larger figure |
| F-05 "a committed API credential" (singular) | Undercount — two live credentials; adopted corrected |
| Codex §7 ordering "prove deployed SHA" as step 1 | Already executed by this audit (both surfaces = HEAD); the step dissolves |
| Implication that guardrail excludes make F-01 rare-but-deterministic | The live probe shows the trigger is environment-gated (cold-backend regime); occurrence rate is U-1, unproven either way |

---

*Report ends. Written 2026-08-09 against HEAD `c9a0e9fc`. No repository file other than this report was created or modified.*
