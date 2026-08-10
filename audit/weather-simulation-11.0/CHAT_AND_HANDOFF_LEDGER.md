# CHAT AND HANDOFF LEDGER — Agent A (history & memory forensics)

**Produced:** 2026-08-09 · **Mode:** READ-ONLY. No file outside `audit/weather-simulation-11.0/` was
created or modified. Read-only git only (`log`, `show`, `ls-files`, `log -S`, `rev-parse`).

## 0. Baseline correction before anything else

| item | commissioning brief said | measured |
|---|---|---|
| HEAD | `3d3ccdc2`, clean tree | **`9f4f85708e765741d51ac2812de5a36373ac514b`** (`git rev-parse HEAD`), branch `dev`. `3d3ccdc2` is HEAD~1 (2026-08-09 17:52:13 -0400); `9f4f8570` landed 18:07:30 -0400 |
| tree | clean | clean except `?? audit/` (this audit's own output dir) |

`9f4f8570` is a docs-only commit (`docs/research/HANDOFF-2026-08-09-D-…`, +24/−4). No code delta.
Every code claim in this ledger was verified at `9f4f8570`.

---

## 1. THE "PREVIOUS TEN CHATS" — RAW TRANSCRIPTS **DO** EXIST

The audit brief asked for "the previous ten chats" and warned they might be absent. They are **not**
absent. Precisely:

* **Location:** `C:\Users\dprit\.claude\projects\C--Users-dprit-Raw-Surf\`
* **Count:** **116** `*.jsonl` session transcripts, **1,018 MB** total, oldest `1019921d-…` (2026-07-10),
  newest `d2594eb4-…` (this audit's own session).
* **Format:** JSONL, one event per line, `{type: user|assistant|…, timestamp, message:{content}}`.
  Verified by parsing — first user message and first timestamp extracted from each.
* **NOT found (searched and confirmed absent):** `.specstory/` (does not exist);
  `Raw-Surf/scratch/` exists but contains only 2026-05/06-era command output, **no chat exports**;
  `.cursor/` contains `rules/` only, no history; no `*chat*.md` / `*transcript*` export anywhere in
  the repo.

**The ten sessions immediately preceding this audit** (by mtime, excluding this audit's own
`d2594eb4`), with their opening instruction:

| # | transcript (uuid.jsonl) | first event ts | bytes | opening instruction (verbatim head) |
|---|---|---|---|---|
| 1 | `6a5094ec-d328-4147-8135-014d8b79591c` | 2026-08-08T19:32Z | 10.9 MB | "AGENT INSTRUCTION: State-of-the-Art Architecture Audit & Zero-Regression Upgrade Assessment…" → produced **MASTER-AUDIT-11.0** |
| 2 | `6fc3fb5c-001a-4ab9-82f3-48febb81cc8c` | 2026-08-09T13:06Z | 5.2 MB | "Follow brain rules. Use forensics to find truth, and show proof. Use jacobian lens…" → the shadow-A/B + readout-truth session (**HANDOFF-2026-08-09-C/D**) |
| 3 | `b576871b-8fb6-4a05-a372-b0cd7b96b9a1` | 2026-08-09T04:42Z | 6.6 MB | "…read this: # AGENT INSTRUCTION # MASTER WEATHER SIMULATION ARCHITECTURE REPORT 11.0 # Codex Audit Integration…" → produced **MASTER_WEATHER_SIMULATION_REPORT_11.0.md** |
| 4 | `3173b48b-53f2-413e-b9bc-984909c21acb` | 2026-08-09T12:10Z | 1.5 MB | codebase-memory skill invocation |
| 5 | `43ef1d24-0dac-41c9-9bb7-160f3e4c8f05` | 2026-07-12T18:11Z | 13.0 MB | "Follow brain rules… deploy several testing agents to test the Raw Surf app admin, legacy console and Raw Surf OS admin sync for regressions" (long-lived session, last written 08-09) |
| 6 | `54062ff6-72d6-40ea-a1eb-d5e5008b9b62` | 2026-08-08T15:28Z | 3.4 MB | "Follow brain rules. Pick up where we left off… There is a hand off report and audit report." |
| 7 | `cbb1774c-4760-48d7-b4c7-2440579dc6bb` | 2026-08-08T15:23Z | 0.17 MB | no user text event in the first 32 lines (tooling/system session) |
| 8 | `28fee094-8b95-4603-99d5-4347681245bb` | 2026-08-01T20:37Z | 5.0 MB | "AGENT INSTRUCTION: State-of-the-Art Architecture Audit & Safe Upgrade Assessment" → the 9.0/10.0 arc |
| 9 | `8222e140-bb02-49c2-8c27-4ae1952b5080` | 2026-08-04T22:56Z | 6.8 MB | "Follow brain rules. Study the memory… Use forensics. Use jacobian lens." |
| 10 | `da221840-7309-4d13-a98e-ffa440cd2a98` | 2026-08-06T00:17Z | 6.4 MB | "Follow brain rules. Study the memory… Use forensics. Use jacobian lens." |

⚠️ **Interpretive caveat, stated rather than glossed:** I enumerated these transcripts and extracted
their opening instruction and timing. I did **not** read 1 GB of transcript bodies. Everything in the
"Claimed Changes / Verification Status" columns below is derived from the **committed documents and
the code**, not from chat bodies. A claim that exists only inside a chat and never reached a document
or a commit is therefore outside this ledger's evidence, and I do not assert it does not exist.

---

## 2. DOCUMENT LEDGER

Verification vocabulary: **Implemented+verified** (I executed or read the code at HEAD) ·
**Implemented-unverified** · **Partial** · **Planned only** · **Superseded** ·
**Contradicted by code** · **Not relevant** · **Unable to verify**.

### 2.1 Governance / rule files (repo root)

| Document | Date | Main goal | Decisions | Claimed changes | Unresolved | Verification status |
|---|---|---|---|---|---|---|
| `CLAUDE.md` (102 lines) | last edit 2026-08-05 | The binding project rules | ONE FORECAST COMPOSITION; three themes; accessibility; 2026-07-25 security status; a 2026-08-06 correction retracting the "height-blind sim" note | Asserts the sim delegates both halves to production and quotes a control set (`12 m → 29.5 ft / 61.2 fair_good`) | Security block is 15 days old and unrefreshed; "trevec is active and synchronized" is an indexing claim with no date | **Implemented+verified** for the sim-delegation claim: `sim_rating.py:359,379` explains on `quality_raw`, `sim_rating.py:326` gates via `gate_single_model_surface`; production order pinned. **Unable to verify** the 07-25 security block (out of scope, needs prod). |
| `AGENTS.md` (42 lines) | 2026-05-30 | (nominally) agent instructions | — | Contains **only** the auto-generated `<!-- trevec:rules -->` block | **Carries none of the binding mandates.** An agent that reads `AGENTS.md` (the Codex/OpenAI convention) and not `CLAUDE.md` never sees ONE FORECAST COMPOSITION | **Contradicted by code** in effect — see C-01 |
| `.antigravityrules` (279 lines, git-tracked) | last touched `b6765139` (Jun 7) | Antigravity-IDE agent rules | Same "SYSTEM SENTINEL / Brain-Spine-Limb" protocol as `BRAIN_RULES.md` | — | **275 of 279 lines are byte-identical to `BRAIN_RULES.md`**; it is a month-stale fork that still carries the superseded absolute main-push ban **and both live credentials** | **Superseded / Contradicted by code** — see C-02, C-03, A1-F-02 |
| `BRAIN_RULES.md` (308 lines) | last touched `220cbbdd` | "The brain": an MCP-maximization protocol + 30-odd numbered rule sections | §22 git branching (main push requires explicit instruction + handshake, `6ecccebc`); 14-day horizon + tier contract (`220cbbdd`, pinned as Invariant 20 by Report 11) | Registers ~20 MCP servers, several of which do not exist as tools in this environment | **A live Supermemory API key at `BRAIN_RULES.md:58` and a live Qdrant Cloud API key + cluster endpoint at `BRAIN_RULES.md:200-201`** (values not reproduced). Committed since `58f7e87d`. Also `:139` a competing hand-written 0-100 surf-quality formula | **Contradicted by code** (§139) + **Implemented-unverified** (the MCP roster) — see A1-F-01, C-03 |

**What "the brain" actually is, since the brief asked:** `BRAIN_RULES.md` is not a runtime component.
It is a prompt-scope document that (a) declares a trigger phrase — *"Follow the rules"* → a
Brain/Spine/Limb compliance report — and (b) enumerates MCP servers agents should prefer over ad-hoc
scripts, plus ~22 numbered domain rule sections (Stripe splits, WooCommerce, scheduling, git
branching, horizon/tier contract). Its authority is real in practice: 6 of the 10 most recent chat
transcripts open with the literal words *"Follow brain rules."* Nothing in `backend/` or
`frontend/` imports, parses, or enforces it — grep for `BRAIN_RULES` in code returns nothing.
Report 11.0 §6 Invariant 20 nonetheless treats one of its clauses (the 14-day horizon + tier
contract) as a **preserved architecture invariant**, i.e. a Markdown file is load-bearing on the
invariant register.

### 2.2 The running queue

| Document | Date | Main goal | Decisions | Claimed changes | Unresolved | Verification status |
|---|---|---|---|---|---|---|
| `MASTER_WEATHER_SIMULATION_REPORT_11.0.md` (824 lines, repo root) | 2026-08-09, written against `c9a0e9fc` | Integrate the Codex forensic audit, verify it, and publish R11-01…R11-18 + roadmap | KEEP/PROTECT/REPAIR/OPTIMIZE/MODERNIZE/PROTOTYPE/DEFER/REJECT verdict set; 20 invariants graded; §16 ten prioritized actions | §16 carries **four execution-record batches** appended the same day: batch 1 `512b1cb6..9fe18414` (actions 3,4,5,6,7,9-partial,10), batch 2 `2e20122d..086ee773`, batch 3 `822a0785..42242bef`, batch 4 `fee36d57..6568d94b` | Actions 1 (uptime probe), 2 (clock-watching) and 8 (executed-GL harness) open; owner one-clicks open | **Mixed — the document contradicts itself in five places** because §1/§8/§12 were never re-written after the batches landed. See C-04…C-08. Every batch claim I spot-checked **is** in the code. |

### 2.3 Prior master reports (`docs/research/MASTER-AUDIT-N.0`)

| Document | Date | Main goal | Key decisions | Verification status |
|---|---|---|---|---|
| `MASTER-AUDIT-11.0-…-zero-regression-assessment.md` (569 ln) | 08-08 | 12-dimension, 34-agent adversarial audit | P0: restore skill ledger; add runtime telemetry; fix 4 event-loop blocks; close 16 open-ocean spots. Rated Observability **Critical** ("zero runtime telemetry") | **Superseded** — all four P0s shipped 08-08/09 and Report 11.0 §3.1 re-verified 13 of them at HEAD. Its §548 blocker ("the JS mirror… before anyone can flip `SURF_PARTITIONS`") is now **stale**: ported at `surfRating.js:116,142` |
| `MASTER-AUDIT-10.0-…-safe-upgrade-assessment.md` (917 ln) | 08-07 | SOTA + safe-upgrade | "10 of 10.0's 16 §1 gaps are FIXED" per 11.0 §0 | **Superseded** |
| `MASTER-AUDIT-9.0` (43 kB) | 08-06 | SOTA + zero-regression path | `RATING_BREAKER_TYPE` flip **"⛔ Blocked on F′"** | **Partial / stale premise** — see S-02 |
| `MASTER-AUDIT-8.0` | 08-06 | Two hypotheses killed by their own measurements | — | Superseded, methodologically live |
| `MASTER-AUDIT-7.0` | 08-06 | State of the art compared | notes a doc still saying "PROBE-BLOCKED" after the probe existed | Superseded |
| `MASTER-AUDIT-6.0` | 08-05 | State of truth at handoff | added `residual_accrual_census.py` | Superseded |
| **`MASTER-AUDIT-5.0-…-the-reach-audit.md`** | 08-05 | **The reach audit — and the origin of the STALE BLOCKER defect class (§2)** | Two instances found; publishes the sweep grep (`:162`); "execute the precondition, never read it" | **Its own §2a instance is STILL OPEN at HEAD — see S-01.** This is the single most important finding in this ledger. |
| `MASTER-AUDIT-4.0 / 3.0 / 2.0 / 1.0` | 08-03…08-05 | earlier passes | 1.0 §2b's 60 s breaker window was corrected 60× by the Codex review | Superseded |

### 2.4 The Codex / external-audit chain

| Document | Date | Where it lives | Verification status |
|---|---|---|---|
| `docs/research/AUDIT-OF-THE-AUDIT-2026-08-03-codex-weather-sim-review.md` (169 ln) | 08-03 | in repo | **Stale at HEAD.** Its §4 says findings **1, 2, 3 were deliberately NOT done** ("one contract change, not three patches"). All three are **now implemented** — `sim_window.py:116,120-123` (two channels) + `:62-64` (rank on raw); `sim_rating.py:379` (`engine_score=quality_raw`) + `:412-420` (`display_adjustment: observation_unconfirmed_cap`); `sim_compare.py:66-78,287,316` (margin on the raw ranking score). The document was never updated. See S-04. |
| **`OPUS5_WEATHER_SIM_DEEP_AUDIT_HANDOFF_2026-08-03.md`** — the audit that document reviews | 08-03 20:50 | **NOT in the repo, and never in git history** (`git log --all --name-only` over all refs: zero hits). **Found on disk at `C:\Users\dprit\OneDrive\Documents\New project\OPUS5_WEATHER_SIM_DEEP_AUDIT_HANDOFF_2026-08-03.md`, 11,023 bytes** | Read for this ledger. All 5 of its findings are now closed in code. |
| `CODEX_FORENSIC_WEATHER_SIM_AUDIT_CLAUDE_HANDOFF_2026-08-09.md` (31,597 B) | 08-09 | same OneDrive folder; cited by Report 11.0 line 12 as its primary lead-set | Present on disk, **not version-controlled** |
| `CODEX_FINAL_WEATHER_SIMULATION_AUDIT_CLAUDE_HANDOFF_2026-06-21.md`, `claude-4.8-weather-simulation-audit.md` | Jun | same folder | Present, not version-controlled |

⚠️ **Structural finding (A1-F-05):** the entire external-audit input chain lives outside the
repository in an unversioned OneDrive folder. `AUDIT-OF-THE-AUDIT` is an in-repo document whose
subject a future repo reader **cannot retrieve**, and Report 11.0's §4 "Codex Verification Ledger" —
the spine of the current queue — grades a document with the same property.

### 2.5 The twenty most recent handoffs / findings (by filename date)

| Document | Date | Main goal | Decisions / claimed changes | Unresolved | Verification status |
|---|---|---|---|---|---|
| `research/HANDOFF-2026-08-09-D-jacobian-audit-of-the-instrument-session.md` | 08-09 (HEAD & HEAD~1) | Rank the session by ∂(user's number)/∂(change) | 9-row Jacobian: #1 lane-dependent height **2.86×** PINNED; #2 tide potency **+43.7% / 38.1 pts**; #3,4,8 FIXED; #5,6,9 owner/blocked. Tide A/B verdict: 496 rows, 0 level changes, 98% input coverage | #1 needs a science call; #5,#6 owner; #9 needs RainViewer scheme-7 spec; **open discrepancy: ledger says tide reach 1.694% (~8 rows) vs 0 observed** | **Implemented+verified** in part (`MapWeatherControls.js:9,190`; `forecastHelpers.js:8,13`); **self-contradictory** — see C-09 |
| `research/HANDOFF-2026-08-09-C-the-five-layer-refutation.md` | 08-09 | Five design layers each killed by measurement | `SURF_EXPOSURE_RECONCILED` built + OFF; `wave_wrapping.py` landed **unvalidated**; root cause = 0.25° bathymetry cannot see Cape St Francis | Spectral closed form unbuilt; the two rotation measurements unreconciled; full `build_shore_normals` rebuild not run | **Implemented+verified**: `surf_transform.py:370` is the sole `SURF_EXPOSURE_RECONCILED` read, default `"0"`; `wave_wrapping.py` has **zero importers** outside its own test |
| `research/HANDOFF-2026-08-09-C-the-instrument-session.md` | 08-09 | Ship the shadow A/B; record 5 self-errors | `science_shadow_ab.py`; 4 owner decisions with evidence attached | tide A/B "still pending at handoff" | **Superseded** by the D handoff (the A/B ran, run 31338483734) |
| `research/HANDOFF-2026-08-09-B-report-11-…reference-generation-close.md` | 08-09 | Execute Report 11's P1 block | 14 commits; **reference-generation skew** identified and closed (`32bd579c`); `reference_size_m` on the wire | pixel oracle `test.fixme`; skill gate ~08-22 | **Implemented+verified** for the seams I checked (`WebGLMarineEngine.js:3199-3200`; `surfRating.js:116`) |
| `research/HANDOFF-2026-08-09-phases-0-2-shipped-and-the-stability-ledger.md` | 08-09 00:21 | Execute MASTER-AUDIT-11.0 Phases 0–2 | 14 commits; skill-ledger fix, accuracy monitor, telemetry, land-present bit, 0.25° expansion | §3 clock table | **Stale in three rows** — §3 "monitor cron not yet fired" (fired 07:57Z), §4.4 "63.5 points" (re-measured 64.6), §4.5 "shadow execution … the largest structural gain still unbuilt" (built the same day). §3 also says **"BRAIN_RULES.md committed API key"** singular — there are two. |
| `research/FINDING-2026-08-09-the-dual-floor-reconciliation.md` | 08-09 | The 3.54× quality-vs-height floor split | Reconcile behind a kill switch | height −46.9% at the floor if shipped | **Planned only** (flag OFF) |
| `research/FINDING-2026-08-09-the-rating-band-dead-zone.md` | 08-09 | Rated grid painted at alpha 0 over 9.5–40° | `__RAW_RATING_SPAN_FADE_HI__=40` closes it | **owner call** | **Planned only** |
| `research/FINDING-2026-08-09-the-prewarm-is-not-the-cause.md` | 08-09 | A "fix" that was a regression | disabling `prewarmMarineSeries` made panzoom/scrub worse; A/B noise floor 48–91% | — | Methodological; **not a change** |
| `research/FINDING-2026-08-09-an-instrument-must-not-tax-the-product.md` | 08-09 | The `inputs` payload cost +42.8% on a 320 B row | 5% deterministic md5 sample | — | **Implemented-unverified** (not re-measured here) |
| `research/RATING-SCALE-2026-08-09-what-is-proper.md` | 08-09 | What a proper 0-100 scale is | candidate edges `E=[7,22,42,56,70,84]` **not shipped** | edges blocked on the floor | **Planned only** |
| `research/MASTER-AUDIT-11.0-2026-08-08-…` | 08-08 | see §2.3 | | | Superseded |
| `runbooks/HANDOFF-2026-08-08-E-the-yardstick-was-being-replaced-underneath.md` | 08-08 | A **fifth** scheduled workflow (Calibration Census) failing in no handoff/queue/audit | STEP+FREEZE vs DRIFT; do not widen bounds | census bound = owner call | **Superseded** by Report 11 batch 3 (`822a0785`) |
| `runbooks/HANDOFF-2026-08-08-D-VERIFIED-audit-of-the-whole-session.md` | 08-08 | Verification pass over 08-07-C | 24 commits re-measured | §4 open+unattended | Superseded |
| `runbooks/HANDOFF-2026-08-07-C-the-fourth-gate-was-a-render-gate.md` | 08-07 | 4th gate between ensemble and screen | 19 commits; 4 of 5 predecessor premises wrong | | Superseded |
| `runbooks/HANDOFF-2026-08-07-B-audit-10-and-the-queue-it-cleared.md` | 08-07 | Audit 10 narrative + open list | 16 commits | | Superseded |
| `runbooks/HANDOFF-2026-08-07-audit-of-this-session.md` | 08-07 | Self-audit | 3 of 5 planned builds killed by measurement | | Superseded |
| `runbooks/HANDOFF-2026-08-06-B-the-probe-refuted-its-own-premise.md` | 08-06 | probe self-refutation | | | Superseded |
| `runbooks/HANDOFF-2026-08-06-the-finer-model-lost-and-the-ensemble-is-affordable.md` | 08-06 | model-lane pricing | ensemble affordable | | Superseded |
| `runbooks/HANDOFF-2026-08-05-B-production-is-a-static-shell-and-the-cause-is-isolated.md` | 08-05 | Netlify prod frozen at `3bd38a83` | owner-gated | **still open** | **Implemented-unverified** (owner/dashboard) |
| `runbooks/RATIONALE-2026-08-04-moved-for-the-loc-ratchet.md` | 08-04 (edited 08-06) | Rationale relocated out of source for the LOC ratchet | | | Implemented+verified (pattern reused at `8301b78e`) |

### 2.6 `docs/architecture/` — the intended architecture

| Document | Date | Main goal | Verification status |
|---|---|---|---|
| **`weather-backend-migration-roadmap.md`** (349 ln) | 2026-06-05 | Self-described **"canonical roadmap and active architecture guide"**. §9 North Star: *backend owns weather truth, frontend owns visualization*. §30-36 **Frontend Restrictions (Anti-Patterns)** | **Contradicted by code at HEAD on at least 2 of its 6 anti-patterns** — see C-10. Never cited by any MASTER-AUDIT or by Report 11.0. |
| `weather-support-matrix.md` | 06-05 | per-layer status | **Unable to verify** (not re-derived) |
| `map-data-contracts.md` | 06-03 | grid/point contracts | Unable to verify |
| `weather-engine.md` (1,976 B) | 06-03 | engine overview | Predates the v7.6 "forecast-authoritative" supersession Report 11 §6 Inv-14 records; **Superseded** |
| `RATIONALE-WebGLWindEngine.md` | 08-09 | LOC-ratchet rationale relocation target | Implemented+verified (created by `8301b78e`) |

---

## 3. STALE BLOCKER SWEEP

Method: MASTER-AUDIT-5.0's own prescription — *"this code says it is waiting for X — has X already
happened?"* — with its published grep (`MASTER-AUDIT-5.0:162`) re-run at HEAD, plus a doc-side sweep
for `blocked on / waiting for / cannot X until Y / before any / gated on`. **Preconditions were
executed, not read.**

### S-01 — ⛔ **CONFIRMED, and it is the same instance MASTER-AUDIT-5.0 published four days ago**

* **The blocker text, still live at HEAD:**
  * `backend/tests/test_rating_composition_parity.py:142-144` — *"Inert everywhere today:
    `bathymetry.bed_slope_at` returns None until the finer slope asset is bundled, so
    `breaker_type_quality` is a neutral 1.0 at every surface including the reference. **Wire it WITH
    the asset, not before.**"*
  * `backend/services/weather_pipeline/spot_ratings.py:149` — *"…AND neutral unless the FINER slope
    asset is bundled (bed_slope_at→None)."*
* **X has already happened.** `backend/services/weather_pipeline/data/etopo_slope_0p1.npy` is
  **12,960,128 bytes, git-tracked, committed `fa86fb53` on 2026-06-29** — 41 days ago.
* **Executed at HEAD** (`python3 -c "from services.weather_pipeline.bathymetry import bed_slope_at"`):

  ```
  Pipeline   0.0301      Mavericks  0.0066      Nazare     0.0606
  Cocoa      0.0012      Teahupoo   0.1563      JBay       0.0052
  non-None: 6/6
  ```

  `bed_slope_at` returns a real float at **6 of 6** spots. The stated precondition is **false**.
* **Aggravator:** MASTER-AUDIT-5.0 §2a (2026-08-05) already measured exactly this (10/10 spots) and
  named it the founding instance of the STALE BLOCKER class. Six master-audit-generation documents
  (`MASTER-AUDIT-6.0…11.0`, `MASTER_WEATHER_SIMULATION_REPORT_11.0`) have been written since; **none
  removed the text, and none re-flagged it.** The class was *documented* and then *not applied to its
  own founding instance*.
* **Consequence — measured vs inferred:** the CODE FACT is that the comment is false.
  The consequence (`RATING_BREAKER_TYPE` still defaults `"0"` at `surf_forecast.py:208` and its one
  caller sits behind it at `spot_ratings.py:151`) is a **code fact**; whether flipping it would
  improve the forecast is **NOT MEASURED** by me and MASTER-AUDIT-9.0 explicitly prices it as HIGH
  risk (18.5% out-of-validity slopes). **The finding is "the blocker is stale", not "flip it".**

### S-02 — `RATING_BREAKER_TYPE` "⛔ Blocked on F′" (MASTER-AUDIT-9.0:293) — **PARTIALLY STALE**

F′ was "requires the owner-anchor harness + a served-score delta census first". The owner-anchor
harness exists (`test_owner_calibration_anchors.py`, 6/6, cited by the 08-09 five-layer handoff) and
a general served-population A/B harness now exists (`backend/scripts/science_shadow_ab.py`,
`.github/workflows/science-shadow-ab.yml`, shipped 08-09 `44cc2ddd`) whose input parameter is
literally `FLAG=value`. **The tooling half of the blocker is satisfied; the census has not been run
for this flag.** Classification: **PROBABLE stale** (the harness exists; nobody re-evaluated the
sentence).

### S-03 — "The JS mirror… before anyone can flip `SURF_PARTITIONS`" — **STALE (blocker cleared)**

Asserted as an open blocker in `MASTER-AUDIT-11.0:548`, in `HANDOFF-2026-08-09-phases-0-2` §4.4
("63.5 points… the one known landmine armed to fire on a flag"), in `MASTER_WEATHER_SIMULATION_REPORT_11.0`
§1.2 #3 and §8 R11-02, and in `MEMORY.md` ("⛔JS mirror BEFORE any `SURF_PARTITIONS` flip").
**Verified ported at HEAD:** `frontend/src/components/map/surfRating.js:109-116`
(`export const MIN_SWELL_ENERGY_SHARE = 0.50;`) and `:142`
(`if (totalE > 0.0 && (den / totalE) < MIN_SWELL_ENERGY_SHARE) return null;`), with the
counter-pinning test corrected at `frontend/src/__tests__/surfRating.test.js:224,251`.
Report 11's own §16 batch-1 note records the ship (`9fe18414`); its §1.2/§8/§12 bodies do not.
⚠️ **Not fully closed:** the same R11-02 direction also required *"extend goldens across
0.4525/0.50/0.5525"* and *"decide the constant's transport"* — the constant is **hardcoded** in JS
(`= 0.50`) with no frontend env lane, which is one of the two options R11-02 named. Golden extension
across the boundary: **BLOCKED for me** — I did not enumerate the golden fixture set.

### S-04 — `AUDIT-OF-THE-AUDIT` §4 "⛔ Not done… findings 1, 2, 3" — **STALE (all three done)**

See §2.4. The document still tells a reader that three High findings are deliberately deferred. At
HEAD they are implemented, and `sim_window.py:102-106` cites *"external deep audit finding 2"* by
name in the comment that implements it.

### S-05 — "the accuracy monitor's cron has never self-fired" — **STALE INSIDE ONE DOCUMENT**

`MASTER_WEATHER_SIMULATION_REPORT_11.0` asserts it at §1.2 #5, §2.3 and §3.1 ("cron delivery
unproven"), and `HANDOFF-2026-08-09-phases-0-2` §3 repeats it. The **same report's** §16 batch-2 note
states *"the accuracy monitor's cron self-fired 08-09T07:57Z and passed — the 08-10 deadline is
closed"*, and `HANDOFF-2026-08-09-B` §5 agrees. **Unresolved by me:** I did not query GitHub Actions
run history (would require `gh`/network); the batch note is the only evidence and it is
self-reported. Classification: **STALE within the document; the underlying fact is BLOCKED.**

### S-06 — MEMORY.md "OPEN CLOCKS: … wind legend from ramp · cross-fall slot sampling · ft/m infobox threading" — **ALL THREE STALE**

* wind legend from ramp → `MapWeatherControls.js:9` `import { windLegendGradientCSS, windLegendStops } from './WindColorRamp';`, used at `:236-237`. Shipped `6568d94b`.
* ft/m infobox threading → `forecastHelpers.js:8` `import { M_TO_FT } from './heightUnits';`, and `:13-14` records the drifted 3.281 local copy being removed on 2026-08-09. Shipped `5e920a5d`.
* cross-fall slot sampling → `modelProvenance.js:17-22` reads the **rendered slot URL** via `resolveDisplayedSlot`, with `modelProvenance.test.js:2` naming *"R11-11 item 4 — the silent GFS cross-fall"*. Shipped `8b20f2c3`.

`MEMORY.md` is **not in git** (per its own header), so this staleness has no commit trail and no undo.

### S-07 — `reference_size_m` "waits on the 15:45Z precompute" (Report 11 §16 batch 3) — **CLOSED by batch 4** in the same document ("0/64 → **88/88** on the wire"). Stale only for a reader who stops at batch 3.

### S-08 — "Shadow execution for the science chain… the largest structural stability gain still unbuilt" (`HANDOFF-2026-08-09-phases-0-2` §4.5, written 00:21) — **STALE by ~09:00 the same day**: `backend/scripts/science_shadow_ab.py` + `.github/workflows/science-shadow-ab.yml` shipped at `44cc2ddd`.

### S-09 — `p2.py` exclude-precedence "fix before anyone builds a canary" — **NOT STALE, STILL OPEN**

`MASTER-AUDIT-11.0:466` and `MASTER_WEATHER_SIMULATION_REPORT_11.0` §14/§17 both make this a hard
precondition. Verified unchanged at HEAD: `backend/routes/admin/p2.py:556-557` returns
`{"enabled": True, "reason": "targeted_user"}` **before** `:560-561` returns
`{"enabled": False, "reason": "excluded"}` — a user on both lists is INCLUDED. The blocker is real.

### S-10 — "Dual-floor reconciliation — **BLOCKED ON ERA5** (12.4% coverage)" (`MASTER-AUDIT-5.0:291`) — **SUPERSEDED, not cleared**

The 08-09 five-layer handoff reached the opposite conclusion by measurement: the over-generous height
floor is *standing in for absent refraction* at J-Bay, so reconciling without a refraction term cuts
every point break ~47%. The blocker is no longer ERA5; it is the spectral closed form. The 5.0
sentence would send a reader to the wrong resource. **Superseded.**

### S-11 — Blockers I checked and found **genuinely live** (not stale)

| statement | source | state at HEAD |
|---|---|---|
| `SURF_EXPOSURE_RECONCILED` OFF, one read site | 08-09-C §1 | ✅ `surf_transform.py:370`, default `"0"` — exactly one production read |
| `wave_wrapping.py` "imported by nothing" | 08-09-C §1 | ✅ zero importers in `backend/services` or `backend/routes`; only `backend/tests/test_wave_wrapping.py:22` |
| Ledger `scored>0` grace to 08-12T06:00Z | Report 11 §16 / phases-0-2 §3 | ⏳ still a future clock on 08-09 |
| Skill-MAE gate arms ~08-22 | multiple | ⏳ future |
| Netlify prod frozen at `3bd38a83` | 08-05-B, Report 11 §2.3 | owner-gated; **Unable to verify** without the dashboard |
| Render env flag state (U-5) | Report 11 §9 | **BLOCKED** — `render.yaml` declares only 7 env keys and **only one** science flag (`RATING_TIDE: "1"`, `render.yaml:22`), with its own comment warning *"if this service is not Blueprint-synced, set RATING_TIDE=1 in the Render dashboard by hand"* |

---

## 4. NEW FINDINGS THIS LEDGER PRODUCED (full detail in `evidence/console/A1-contradiction-ledger.md`)

* **A1-F-01** — `BRAIN_RULES.md:58` and `:200-201` carry **two** live credentials (Report 11 R11-16
  has this right; Codex F-05 and `HANDOFF-2026-08-09-phases-0-2` §3 both say "key", singular).
* **A1-F-02** — ⭐ **The same two credentials are ALSO committed at `.antigravityrules:58` and
  `:201-202`.** Every remediation instruction in the record names one file. Rotation-by-file would
  leave a second tracked copy. **No audit in the series mentions `.antigravityrules` at all.**
* **A1-F-03** — ⭐⭐ **`SURF_HEIGHT_H110` has three different declared defaults in-tree**, and the
  guard that exists to catch exactly this cannot see it. Code = **ON**; module docstring = OFF;
  admin registry = "0". Proven by execution. See C-11.
* **A1-F-04** — `AGENTS.md` contains none of the binding mandates.
* **A1-F-05** — the external-audit input chain is unversioned OneDrive.
* **A1-F-06** — `docs/architecture/weather-backend-migration-roadmap.md`, which calls itself the
  active architecture guide, is contradicted by the shipped frontend and is cited by no audit.
