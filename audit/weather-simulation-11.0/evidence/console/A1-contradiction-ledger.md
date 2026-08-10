# A1 — CONTRADICTION LEDGER

Every place two project documents disagree, or a document disagrees with the code at HEAD
**`9f4f85708e765741d51ac2812de5a36373ac514b`** (branch `dev`, clean apart from this audit's `audit/` dir).

Read-only. Preconditions were **executed**, not read, wherever execution was cheap.
Credentials are never reproduced — only file:line.

**Legend:** CONFIRMED = I read/executed the deciding evidence · PROBABLE = strong evidence, one
inference · BLOCKED = cannot decide without something I am not permitted or able to reach.

---

## C-01 · `AGENTS.md` carries none of the binding mandates

| | claim | evidence |
|---|---|---|
| **Doc A** | `CLAUDE.md:3-15` — *"ONE FORECAST COMPOSITION (user mandate 2026-07-28): every surface that shows surf height or quality … must go through the SAME chain"* + three-themes + accessibility mandates | `CLAUDE.md` (102 lines) |
| **Doc B** | `AGENTS.md` — 42 lines, **entirely** the auto-generated `<!-- trevec:rules:start … end -->` block. Zero project mandates | `AGENTS.md:1-42` |
| **Code** | Neither file is read by code; both are prompt-scope. But `MASTER_WEATHER_SIMULATION_REPORT_11.0:79` lists *"`CLAUDE.md`, `BRAIN_RULES.md`, `AGENTS.md`-adjacent memory indexes"* as the source of "Binding mandates", implying `AGENTS.md` carries some | — |
| **Disposition** | **CONFIRMED.** `AGENTS.md` is the conventional entry point for non-Claude agents (Codex/OpenAI). An agent honouring it and not `CLAUDE.md` never sees the rule whose violation the repo records three times (`spot_conditions.py` 93%, `cf2efb48` +19%, `bc304e44`). Cheapest fix: one include line. Not a code defect; a governance gap. |

---

## C-02 · Two rule files give **opposite** instructions on pushing to `main`

| | claim | evidence |
|---|---|---|
| **Doc A** | *"**NEVER** stage, commit, or push changes directly to the `main` production branch."* / *"AI assistants are strictly forbidden from staging, committing, or pushing any codebase modifications directly to the `main` branch."* | `.antigravityrules:213`, `.antigravityrules:216` |
| **Doc B** | *"**NEVER** push to `main` **autonomously**. … A `main` push requires an explicit user instruction AND a confirmation handshake ("Are you sure you want me to push to main?") first — see §22."* | `BRAIN_RULES.md:212`, `:215`, `:217` |
| **Which is current** | `BRAIN_RULES.md`. The exception was authored deliberately: `6ecccebc` *"docs(rules): codify §22 main-push exception — explicit instruction + confirmation handshake"*. `.antigravityrules` was last touched by `b6765139` (2026-06-07) and never received it. |
| **Code/repo state** | PR #8 (`dev`→`main` promotion) is OPEN and owner-gated (Report 11 §2.3) — i.e. the exception path is in active use | `MASTER_WEATHER_SIMULATION_REPORT_11.0:96` |
| **Disposition** | **CONFIRMED stale fork.** `.antigravityrules` is 275 of 279 lines byte-identical to `BRAIN_RULES.md` (`comm -12` on sorted lines). It is a month-behind duplicate of the same document, still git-tracked, still authoritative for one IDE. |

---

## C-03 · A hand-written surf-quality formula sits inside the rule files, contradicting the project's first mandate

| | claim | evidence |
|---|---|---|
| **Doc A** | *"**ONE FORECAST COMPOSITION** … `surf_rating.compute_surf_rating` for the 0-100 quality. `spot_ratings.rate_one_spot` is the reference implementation; mirror it, never re-derive it."* … *"⛔ Do not add a second forecast path 'just for this screen'."* | `CLAUDE.md:3-24` |
| **Doc B** | *"**Surf Quality Formula**: Surf quality scores (0-100) must be evaluated dynamically by swell height (3-8 ft optimal), swell period (≥12 s optimal), offshore winds (bonus +15), onshore winds (penalty −25), and tide cycles (rising/low bonus +10)."* — stated as a **binding rule for "all AI coding assistants, agents, and systems operating on the Raw Surf platform"** | `BRAIN_RULES.md:139` **and** `.antigravityrules:139` (identical) |
| **Which does the code support** | **CLAUDE.md.** The production 0-100 is `backend/services/weather_pipeline/surf_rating.py::compute_surf_rating`, a nine-factor multiplicative composition over geometry-resolved breaking height — not an additive ±bonus table. The sim delegates to it (`sim_rating.py:326,359,379`), and an AST guard pins the production order across all three rating surfaces (Report 11 §8 R11-18). No `+15 / −25 / +10` constants exist in the rating chain. |
| **Disposition** | **CONFIRMED contradiction.** Two tracked rule files instruct every agent to compute quality by a second, incompatible formula. This is the literal shape of the defect `CLAUDE.md` was written to prevent, encoded as a rule. Severity is governance, not runtime: nothing in `backend/` implements it. **Not measured:** whether any shipped surface ever did. |

---

## C-04 · Report 11.0 lists the JS-mirror gap as a top-5 risk **and** records shipping the fix, in the same file

| | claim | evidence |
|---|---|---|
| **Doc A (same file)** | §1.2 highest-risk #3: *"**The JS rating mirror** — missing Python's `MIN_SWELL_ENERGY_SHARE` refusal; divergence re-measured at HEAD at up to **64.6 points** … a release blocker for any `SURF_PARTITIONS` flip."* · §8 R11-02 *"Direction: port the refusal…"* · §12 row **Adopt** | `MASTER_WEATHER_SIMULATION_REPORT_11.0:51`, `:292-298` |
| **Doc B (same file)** | §16 execution record: *"and additionally action 6 (the JS-mirror refusal port, golden-verified against Python)"* | `MASTER_WEATHER_SIMULATION_REPORT_11.0:560` |
| **Code at HEAD** | **Ported.** `frontend/src/components/map/surfRating.js:109-116` — comment *"MIRROR OF surf_rating.py MIN_SWELL_ENERGY_SHARE (R11-02, ported 2026-08-09)"*, `export const MIN_SWELL_ENERGY_SHARE = 0.50;`; enforced at `:142` `if (totalE > 0.0 && (den / totalE) < MIN_SWELL_ENERGY_SHARE) return null;`. Counter-pinning test corrected: `frontend/src/__tests__/surfRating.test.js:224` *"BELOW the ported MIN_SWELL_ENERGY_SHARE gate, and this test was actively…"* |
| **Disposition** | **CONFIRMED.** §16 is right; §1.2/§8/§12 are stale. The executive summary of the live queue overstates the top-5 risk set. Residual (genuinely open): goldens across 0.4525/0.50/0.5525 and the constant's transport — JS hardcodes `0.50` with no env lane. |

---

## C-05 · Report 11.0: "the accuracy monitor's cron has never self-fired" vs "it self-fired 08-09T07:57Z and passed"

| | claim | evidence |
|---|---|---|
| **Doc A** | §1.2 #5 *"the accuracy monitor's own cron has never self-fired (one manual run)"*; §2.3 *"Forecast Accuracy Monitor has run **exactly once, manually** — its cron has never self-fired"*; §3.1 *"Resolved (cron delivery unproven)"* | `MASTER_WEATHER_SIMULATION_REPORT_11.0:53`, `:99`, `:121` |
| **Doc B** | §16 batch 2: *"Clock update: **the accuracy monitor's cron self-fired 08-09T07:57Z and passed** — the 08-10 deadline is closed."* Corroborated by `HANDOFF-2026-08-09-B…:83` *"monitor cron self-fired 07:57Z and passed"* | `MASTER_WEATHER_SIMULATION_REPORT_11.0:561` |
| **Which does the code support** | Neither — this is a *runtime delivery* fact, not a code fact. `.github/workflows/forecast-accuracy-monitor.yml` exists with cron `5 1,7,13,19 * * *` (Report 11 §3.1); whether a given run fired is only in GitHub Actions history. |
| **Disposition** | **BLOCKED on evidence, CONFIRMED as an internal contradiction.** The file states both. A reader who stops before §16 (which is 460 lines in) carries the wrong clock. **To unblock:** `gh run list --workflow forecast-accuracy-monitor.yml` (read-only) — not run here. |

---

## C-06 · Report 11.0 R11-01 (churn loop) — listed as a top-5 weakness and as shipped

| | claim | evidence |
|---|---|---|
| **Doc A** | §1.2 #1 *"The marine fallback churn loop (F-01, corrected to P2) — root cause newly pinned: `window.__MARINE_ENGINE__` is assigned once and never cleared"*; §8 R11-01 *"Direction: clear `window.__MARINE_ENGINE__` in dispose AND gate the backstop leg"* | `:49`, `:284-290` |
| **Doc B** | §16 batch 1: actions "3 … were implemented and shipped hours after this register was written — the churn-loop three-seam fix". `HANDOFF-2026-08-09-B:16` names the commit `843f6e59` and the kill switch `__RAW_BACKSTOP_IGNORE_GUARDRAIL__` | `:560` |
| **Code at HEAD** | **Seam 1 shipped.** `frontend/src/components/map/WebGLMarineEngine.js:98` `window.__MARINE_ENGINE__ = this;` and **`:3199-3200`** `if (… window.__MARINE_ENGINE__ === this) { window.__MARINE_ENGINE__ = null; }`. The identity check (`=== this`) is the correct form — it cannot clear a successor engine's pointer. |
| **Disposition** | **CONFIRMED.** §8 R11-01's "assigned once and never cleared" is false at HEAD. Seams 2–3 (backstop flag-gate, terminal truth stages) I did **not** independently verify — that is Agent-scope for the render half. |

---

## C-07 · Report 11.0 §12 "Adopt" rows for legends/readouts already shipped

| | claim | evidence |
|---|---|---|
| **Doc A** | §12 row *"Legend/readout truth fixes (labels, ramp-sourced wind legend, slot-URL sampling for cross-falls, one nearshore policy, ft/m threading)"* → **Adopt**; §16 lists the batch as **P2 "first after the ten"** | `:485`, `:665` |
| **Doc B** | §16 batch 2 *"R11-11's rain-legend unit label"*; batch 4 *"**R11-11 item 2 SHIPPED** (`6568d94b`)"*; `HANDOFF-2026-08-09-D:19,24` marks legend numbers (#3) and ft/m (#8) **✅ FIXED** | `:561`, `:598-602` |
| **Code at HEAD** | rain: `MapWeatherControls.js:190` `rain: 'Rain / Snow (mm/h)', // R11-11: stops ARE the mm breakpoints … '(in/h)' was a 25.4× misread`. wind: `MapWeatherControls.js:9` `import { windLegendGradientCSS, windLegendStops } from './WindColorRamp';` used at `:236-237`. cross-fall: `modelProvenance.js:17-22` reads the **rendered slot URL** via `resolveDisplayedSlot`; `modelProvenance.test.js:2` names *"R11-11 item 4 — the silent GFS cross-fall"*. ft/m: `forecastHelpers.js:8` `import { M_TO_FT } from './heightUnits';`, `:13` *"The constant was a drifted local copy (3.281 …) until 2026-08-09"*. |
| **Disposition** | **CONFIRMED.** Four of five sub-items shipped. Still open per the record: *one nearshore policy* (R11-11.5) and *legend tick spacing on the non-wind legends* (R11-11.3). |

---

## C-08 · Report 11.0's closing line vs its own execution record

| | claim | evidence |
|---|---|---|
| **Doc A** | *"Report ends. Written 2026-08-09 against HEAD `c9a0e9fc`. **No repository file other than this report was created or modified.**"* | `MASTER_WEATHER_SIMULATION_REPORT_11.0:824` |
| **Doc B** | The same file, §16, records four commit batches of code changes appended after the report was written: `512b1cb6..9fe18414`, `2e20122d..086ee773`, `822a0785..42242bef`, `fee36d57..6568d94b` | `:560-607` |
| **Disposition** | **CONFIRMED, low severity.** Defensible reading: the sentence scopes the audit *as written at `c9a0e9fc`*, and the batches are annotations added later. But as the file stands at HEAD, the last line is false of the file. Worth one clause. |

---

## C-09 · `HANDOFF-2026-08-09-D` says the A/B produced its first trustworthy verdict, and that every run so far refused or was retracted

| | claim | evidence |
|---|---|---|
| **Doc A** | §NEXT-2: *"✅ **DONE — the tide A/B ran for real (22:05Z, run 31338483734).** **First trustworthy verdict this instrument has produced**"* with the full result block | `HANDOFF-2026-08-09-D…:87-97` |
| **Doc B (same file)** | §KNOWN LIMITS: *"The A/B has never produced a **trustworthy non-null verdict** yet. **Every run so far either refused or was retracted.**"* | `…:119-120` |
| **Which is right** | The first clause of Doc B survives (the tide verdict *is* null: 0 level changes). The second clause — "every run so far either refused or was retracted" — is **falsified by the same file**. Confirmed mechanically: `git show 9f4f8570` rewrites §NEXT-2 (+24/−4) and **does not touch §KNOWN LIMITS**. |
| **Disposition** | **CONFIRMED**, self-inflicted within one commit. Cheap fix; notable because this repo's own rule is *"a WRONG memory is worse than none, EDIT it."* |

---

## C-10 · The "canonical, active" architecture guide is contradicted by the shipped frontend

| | claim | evidence |
|---|---|---|
| **Doc A** | `docs/architecture/weather-backend-migration-roadmap.md:3` — *"This document serves as the **canonical roadmap and active architecture guide**"*; `:31-36` **Frontend Restrictions (Anti-Patterns)** — the client must **not**: `:32` *"Fetch raw forecast parameters directly from external weather APIs (e.g. Open-Meteo or Copernicus)"*; `:35` *"Perform model-specific math or meteorology calculations"* | roadmap `:3`, `:31-36` |
| **Code at HEAD — violates `:32`** | `frontend/src/components/map/tideClient.js:16` `const OPEN_METEO_MARINE_API = 'https://marine-api.open-meteo.com/v1/marine';` — a live browser fetch of `sea_level_height_msl`, described in its own header (`:8-9`) as *"the fallback here fetches the SAME Open-Meteo Marine sea_level_height_msl series the backend's tide.py uses"* |
| **Code at HEAD — violates `:35`** | (a) `frontend/src/components/map/surfRating.js` — a hand-maintained JS mirror of the backend 0-100 rating (Report 11 §5 ownership register calls it exactly that). (b) `frontend/src/components/map/backendWeatherServiceClientHelpers.js:5-6` header: *"Contains vector mathematics, circular-blending helpers, **DWD ICON extended-range forecast blending**"*, implemented at `:16 blendDirection`, `:45 blendPeriod`, `:64 blendSubVector` — the client-side ICON/GFS/EURO composition Report 11 R11-06 documents. (c) `tideClient.js:30-35` — *"mirrors backend tide.tide_state_at"* |
| **Mitigation, stated fairly** | Each violation is **disclosed in its own module header** with a rationale and, for the tide lane, a kill switch (`window.__RAW_DISABLE_TIDE_FALLBACK__`) and an explicit "display-only, never feeds scores". The `.om` raster tiles are arguably permitted by roadmap `:26` ("tile indexes or signed CDN URLs"). |
| **Disposition** | **CONFIRMED.** The contradiction is not that the code is wrong — it is that the document calling itself *the active architecture guide* has never been reconciled, and **no report in the `MASTER-AUDIT-1.0…11.0` series or `MASTER_WEATHER_SIMULATION_REPORT_11.0` cites it**. It is the only doc in the repo that states the frontend/backend ownership boundary, and it is unmaintained. |

---

## C-11 · ⭐⭐ `SURF_HEIGHT_H110` has **three** declared defaults in-tree, and the guard built to catch this cannot see it

The flag the repo describes as changing *"EVERY displayed height by ~27%"*.

| source | says the default is |
|---|---|
| **Code (authoritative at runtime)** | **ON** — `backend/services/weather_pipeline/surf_height_convention.py:74` `return os.environ.get("SURF_HEIGHT_H110", "1") == "1"` |
| **The same module's docstring** | **OFF** — `surf_height_convention.py:42` *"⛔ **DEFAULT OFF** (`SURF_HEIGHT_H110=1` to enable). This changes EVERY displayed height by ~27%…"* |
| **The admin flag registry** (the operator's only view of Render) | **`"0"`** — `backend/routes/admin/surf_forecast.py:160` `"SURF_HEIGHT_H110": ("0", "Report H1/10 …", "Render env")` |
| **The science registry** | **ON** — `backend/services/weather_pipeline/science_registry.py:299` *"SURF_HEIGHT_H110 — DEFAULT ON since 2026-08-05, paired with REFRACTION_KR"* |

**Proven by execution at HEAD** (no env var set):

```
enabled() with no env set -> True
to_surf_convention(2.0, "shoaling") -> 2.54          # exactly x1.27
H110_OVER_HS = 1.27
```

**Why the guard misses it.** `backend/tests/test_flag_lane_parity.py` exists precisely to make *"the
flag registry describe reality"* (`:1`). But it grades a workflow's value against the **registry's own
declared default**, never against the source's `os.environ.get` fallback:

```python
# test_flag_lane_parity.py:184-188
default, _desc, where = entry              # entry := REGISTRY[flag]  (the tuple's first element)
if value != default and lane not in where:
    undeclared.append(...)
```

A registry entry that *misstates* the code default is therefore structurally invisible to it.

**Census I ran to bound the blast radius** (AST-parse `_RATING_FLAGS`, regex every literal
`os.environ.get("FLAG", "default")` under `backend/` excluding `tests/`):

* 40 registry entries.
* **Exactly one production mismatch: `SURF_HEIGHT_H110` (registry `'0'` vs code `'1'`).**
* One benign mismatch: `RATING_LOCAL_SIZE` — production sites all read `'0'`
  (`grid_resolver_surf.py:95`, `point_surf_augment.py:96`, `sim_rating.py:148`,
  `spot_conditions.py:337`, `spot_ratings.py:628`, `routes/weather.py:552`); the `'1'` sites are in
  `backend/scripts/surf_science_audit.py:235,265`, an audit script, not the chain.
* 7 registry entries have **no literal `os.environ.get` site at all** and are therefore unreachable by
  any literal scan: `SURF_V3_EXPOSURE`, `SURF_V3_KOMAR`, `SURF_V3_MAGNETS`, `SURF_V3_SHELF_RECAL`
  (read through the `surf_transform._v3(flag)` **variable** indirection the registry itself documents
  at `surf_forecast.py:154-156`), plus `RATING_GRID_SIZE_CLIMATOLOGY`, `SHORE_NORMAL_BEARING_RADIUS_KM`,
  `SURF_REFRACTION_KR`.

**Disposition: CONFIRMED (code fact). Consequence NOT MEASURED.** What is proven: an operator
reading the admin panel — the surface the registry exists to feed — is told the ~27% height
convention is OFF while the process default is ON. What is **not** proven: what the deployed Render
service actually resolves, because `render.yaml` declares only 7 env keys and exactly one science
flag (`RATING_TIDE: "1"`, `render.yaml:22`), with its own comment conceding *"if this service is not
Blueprint-synced, set RATING_TIDE=1 in the Render dashboard by hand."* This is Report 11's standing
**U-5** gap, and it is one dashboard screen away.

**Falsification I tried:** (a) that the docstring is the live one — refuted by executing `enabled()`;
(b) that some caller passes an explicit default — the only call site is `to_surf_convention` in the
same module (`:83`); (c) that the registry tuple is documentation-only — refuted by
`test_flag_lane_parity.py:184`, which consumes `entry[0]` as the comparison basis, and by
`surf_forecast.py` serving it to the admin panel.

---

## C-12 · The credential count, and the file nobody counted

| | claim | evidence |
|---|---|---|
| **Doc A** | Codex F-05 (via Report 11 §4): *"A committed API credential in `BRAIN_RULES.md`"* — **singular**. Repeated in `HANDOFF-2026-08-09-phases-0-2:66` (*"`BRAIN_RULES.md` committed API key"*) and in `MEMORY.md` (*"⚠️`BRAIN_RULES.md` carries a committed live API key — rotate"*) |
| **Doc B** | `MASTER_WEATHER_SIMULATION_REPORT_11.0:169,379` (R11-16): *"**two** live credentials, not one (a Supermemory API key and a Qdrant Cloud key + endpoint) … Codex counted one"* |
| **Code/repo at HEAD** | Doc B is right about `BRAIN_RULES.md`: **`BRAIN_RULES.md:58`** (Supermemory) and **`BRAIN_RULES.md:200-201`** (Qdrant Cloud key + cluster endpoint). Both git-tracked; introduced no later than `58f7e87d`. |
| **⭐ What both docs miss** | **The identical two credentials are also committed at `.antigravityrules:58` and `.antigravityrules:201-202`** — a second git-tracked file, 275/279 lines identical to `BRAIN_RULES.md`. `.antigravityrules` appears in **no** audit, handoff, memory index, or queue entry in the entire record I read. |
| **Disposition** | **CONFIRMED.** Report 11's own remediation instruction is *"rotate/revoke provider-side …, move to env, **secret-scan all refs**"* — the scan has demonstrably not been run, because it would have found the second file. Rotation remains the only real fix (history retains both copies regardless). **Values not reproduced anywhere in this audit's output.** |

---

## C-13 · "The sim answers from repo-root `dev.db`" — overstated in memory, corrected in the report, uncorrected in memory

| | claim | evidence |
|---|---|---|
| **Doc A** | `MEMORY.md` INDEX line: *"the live landmine is **`sim_spots.DB_PATH` → repo-root `dev.db`**, measured 1.93×/1.63× off the served catalogue"* |
| **Doc B** | `MASTER_WEATHER_SIMULATION_REPORT_11.0:154`: *"the memory claim 'sim answers from repo-root dev.db' → **nuanced: dev.db is the *fallback* lane, live catalog is consulted first**"* |
| **Code at HEAD** | Doc B. `sim_spots.py:56` `DB_PATH = os.path.join(ROOT_DIR, "dev.db")` **is** repo-root — but `sim_spots.py:220` `return "live_catalog" if sim_forecast.fetch_catalog() else "surf_spots_snapshot"`, `:240` `live = sim_forecast.fetch_catalog()`, `:300` `for row in (sim_forecast.fetch_catalog() or [])`, and `weather_sim_mcp.py:228` `live = sim_forecast.fetch_catalog()` — the live catalogue is consulted first at every site. `dev.db` is reached at `sim_spots.py:255` only after that. |
| **Disposition** | **CONFIRMED**: memory overstates. Report 11 corrected it; `MEMORY.md` still carries the uncorrected form and, per its own header, **is not in git** — so this has no commit trail and no undo. |

---

## C-14 · `MEMORY.md` open clocks that closed

| clock (MEMORY.md "⏳OPEN CLOCKS") | state at HEAD | evidence |
|---|---|---|
| *wind legend from ramp* | **CLOSED** | `MapWeatherControls.js:9,236-237` derive from `WindColorRamp` |
| *cross-fall slot sampling* | **CLOSED** | `modelProvenance.js:17-22` + `modelProvenance.test.js:2` |
| *ft/m infobox threading* | **CLOSED** | `forecastHelpers.js:8,13-14` (`M_TO_FT` from `heightUnits`; drifted 3.281 removed 2026-08-09) |
| *⛔JS mirror BEFORE any `SURF_PARTITIONS` flip* | **substantially CLOSED** | `surfRating.js:116,142` (see C-04); golden-boundary extension still open |
| *ledger `scored>0` (~08-10 02-06Z; monitor self-pages 08-12T06Z)* | **still future** on 08-09 | `HANDOFF-2026-08-09-phases-0-2:59` |
| *skill-MAE gate ~08-22* | **still future** | ibid `:61` |
| *`BRAIN_RULES.md` carries a committed live API key — rotate* | **wrong count and wrong file scope** | see C-12 |

**Disposition: CONFIRMED.** Four of seven always-loaded landmines in the router file are stale at
HEAD. `MEMORY.md` is the file loaded on every session, which makes its staleness the most expensive
in the record.

---

## C-15 · `AUDIT-OF-THE-AUDIT` still says three High findings were deliberately not done

| | claim | evidence |
|---|---|---|
| **Doc A** | `docs/research/AUDIT-OF-THE-AUDIT-2026-08-03-…:139-142` — *"⛔ **Not done, and why** — findings 1, 2, 3 are one contract change (§2), not three patches."* |
| **Code at HEAD — finding 1** | **Done.** `sim_rating.py:379` `engine_score=quality_raw` (was the post-gate score); `:412-420` emits `display_adjustment = {reason: "observation_unconfirmed_cap", from: quality_raw, …}` — exactly the repair the source audit prescribed. |
| **Code at HEAD — finding 2** | **Done.** `sim_window.py:116` now passes `valid_time=hour`; `:122-123` publishes `"quality_rating"` (DISPLAY) **and** `"quality_raw"` (RANKING); `:62-64` sorts on raw with a display fallback. The comment at `:102-106` names *"external deep audit finding 2"*. |
| **Code at HEAD — finding 3** | **Done.** `sim_compare.py:66-67` `_ranking_score` prefers `quality_raw`; `:71-78` `_ranking_margin` docstring: *"Above the cap `d(display)/d(raw) = 0` exactly, so the margin was measured in…"*; used at `:316`. |
| **Disposition** | **CONFIRMED stale.** All five findings of the 08-03 external audit are closed (4 was fixed at `77f66211` per the same doc; 5 was declared an owner decision). The reviewing document was never updated, and — see C-16 — the audit it reviews is not in the repository. |

---

## C-16 · The audited document is not in the repository

| | claim | evidence |
|---|---|---|
| **Doc A** | `AUDIT-OF-THE-AUDIT-…:3` — *"**Reviewed:** `OPUS5_WEATHER_SIM_DEEP_AUDIT_HANDOFF_2026-08-03.md` (read-only audit, snapshot `e9bd7d55`)"* |
| **Repo** | The file has **never existed in git**: `git log --all --oneline --diff-filter=A -- '*OPUS5*'` returns only `4ec3b28d` (a different, unrelated handoff), and a full `git log --all --name-only` scan for `OPUS5_WEATHER_SIM` returns nothing. Not in the working tree. |
| **Found** | On disk, outside the repo: `C:\Users\dprit\OneDrive\Documents\New project\OPUS5_WEATHER_SIM_DEEP_AUDIT_HANDOFF_2026-08-03.md`, 11,023 bytes, mtime 2026-08-03 20:50. Same folder holds `CODEX_FORENSIC_WEATHER_SIM_AUDIT_CLAUDE_HANDOFF_2026-08-09.md` (31,597 B) — the primary lead-set of the **current** queue, cited at `MASTER_WEATHER_SIMULATION_REPORT_11.0:12`. |
| **Disposition** | **CONFIRMED.** The external-audit input chain is unversioned and outside the repo. Two in-repo documents (`AUDIT-OF-THE-AUDIT`, and Report 11.0 §4, the spine of R11-01…R11-18) grade source documents a future repo reader cannot retrieve. Cheapest fix: copy them into `docs/research/` as received. |

---

## C-17 · The founding STALE BLOCKER instance is still in the tree

Full write-up in `../../CHAT_AND_HANDOFF_LEDGER.md` §3 S-01. In brief:

| | claim | evidence |
|---|---|---|
| **Doc A** | `backend/tests/test_rating_composition_parity.py:142-144` — *"Inert everywhere today: `bathymetry.bed_slope_at` returns None **until the finer slope asset is bundled** … **Wire it WITH the asset, not before.**"* · `backend/services/weather_pipeline/spot_ratings.py:149` — same claim |
| **Doc B** | `MASTER-AUDIT-5.0-2026-08-05-the-reach-audit.md:98-114` — *"a 12.96 MB asset, bundled 37 days, reaching zero served ratings … measured: `bed_slope_at()` returns a REAL value at 10 of 10 spots. It does NOT return None. … **Nothing re-evaluates a comment.**"* |
| **Code at HEAD (executed)** | `bed_slope_at` → `0.0301 / 0.0066 / 0.0606 / 0.0012 / 0.1563 / 0.0052` at Pipeline / Mavericks / Nazaré / Cocoa / Teahupoo / J-Bay. **6 of 6 non-None.** Asset `backend/services/weather_pipeline/data/etopo_slope_0p1.npy` = 12,960,128 bytes, tracked, `fa86fb53` (2026-06-29). |
| **Disposition** | **CONFIRMED.** Doc B is right; Doc A is false and has survived four days, six subsequent master-generation documents, and the publication of the defect class it founded. This is the ledger's strongest single result: **the class was named and then not applied to its own first instance.** |

---

## C-18 · `p2.py` exclude precedence — the record is right and the blocker is still live

| | claim | evidence |
|---|---|---|
| **Doc A** | `MASTER-AUDIT-11.0:466` — *"**fix the inverted exclude precedence at `p2.py:555-561` before anyone builds a canary on it**"*; repeated `MASTER_WEATHER_SIMULATION_REPORT_11.0:147` (§3.2 table row, prior finding §3.14.2 — *"still a landmine if a canary is ever wired to it"*), `:526` (§14), `:689` (§17 Postpone) |
| **Code at HEAD** | Unchanged. `backend/routes/admin/p2.py:556-557` `if user_id and flag.target_user_ids and user_id in flag.target_user_ids: return {"enabled": True, "reason": "targeted_user"}` — evaluated **before** `:560-561` `if user_id and flag.exclude_user_ids and user_id in flag.exclude_user_ids: return {"enabled": False, "reason": "excluded"}`. A user on both lists is **enabled**. |
| **Disposition** | **CONFIRMED — not stale, genuinely open.** Report 11 §3.2 also records "zero callers", so the exposure today is latent. Listed here as a control: not every documented blocker is stale, and the sweep must be able to say so. |

---

## SUMMARY TABLE

| id | contradiction | which side the code supports | severity |
|---|---|---|---|
| C-01 | `AGENTS.md` carries no mandates | — (governance gap) | Medium |
| C-02 | main-push rule: absolute vs handshake-exception | `BRAIN_RULES.md` | Medium |
| C-03 | a second surf-quality formula in the rule files | `CLAUDE.md` | High (governance) |
| C-04 | JS mirror: top-5 risk vs shipped | shipped | Medium |
| C-05 | monitor cron: never fired vs fired 07:57Z | BLOCKED (runtime) | Medium |
| C-06 | churn loop: "never cleared" vs cleared | cleared | Low |
| C-07 | legend/readout batch: Adopt vs shipped | shipped (4 of 5) | Low |
| C-08 | "no repository file … modified" vs 4 commit batches | the batches | Low |
| C-09 | A/B "first trustworthy verdict" vs "every run refused/retracted" | the verdict happened | Low |
| C-10 | active architecture guide vs shipped frontend | the frontend | High (doc rot) |
| **C-11** | **`SURF_HEIGHT_H110`: three declared defaults; the guard cannot see it** | **code = ON** | **High** |
| C-12 | one credential vs two — and a second file nobody scanned | two, in **two** files | **P1 governance** |
| C-13 | sim reads `dev.db` vs live-catalog-first | live-catalog-first | Low |
| C-14 | four `MEMORY.md` open clocks already closed | closed | Medium |
| C-15 | "findings 1,2,3 not done" | all three done | Medium |
| C-16 | the audited source document is not in the repo | absent from git; present in OneDrive | Medium |
| C-17 | **`bed_slope_at` returns None** vs 6/6 real values | **6/6 real** | **High** |
| C-18 | `p2.py` exclude precedence | still inverted — record is correct | Low (latent) |
