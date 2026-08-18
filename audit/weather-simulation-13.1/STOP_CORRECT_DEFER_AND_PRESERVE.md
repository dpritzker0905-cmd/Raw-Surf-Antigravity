# STOP · CORRECT · DEFER · PRESERVE — Audit 13.1

---

## ✅ CONTINUE

| item | objective / task | evidence | reopening condition |
|---|---|---|---|
| **The forensic method itself** — reproduce → instrument → live A/B → retract when refuted | all | 52 voluntary self-retractions; `f7714cf2` reverted 3 commits and ~14 h of its own work after an A/B; `9f89e891` **withdrew a regression accusation against another session** after measuring it | if retraction chains start exceeding 4 commits without a code change (as `C4-MR-02` did: 4 documents, 0 lines) |
| **The test-craft standard** set by `d8c866bd`, `a1b5aac3`, `a6e4339a` | WS-OBJ-505 | complete red→green→red-on-mutation trail; AST census replacing a hard-coded file list; fixtures repaired rather than guards | if a new suite ships without a vacuity control |
| **Dark-by-default for science changes** | WS-OBJ-302 | `SURF_CAP_SEAM_MONOTONE` defaults `"0"` (`surf_height_convention.py:98`); WS-CAN-0076 imported by nothing — both **confirmed from code, not from commit messages** | if a science change ships default ON without a paired guard |
| **The `config_env` clamping-accessor pattern** | WS-CAN-0075 | 20 inline `os.environ.get` reads absorbed into `env_int:29` / `env_float:48`; **changed no default value anywhere** | — |
| **`LAYER_ORDER_PROOF_LOG.json` and its append-only mandate** | WS-OBJ-401 | the owner mandate that every proven ordering/paint correction is appended | — |
| **Guarding against fixtures that cannot occur** | WS-CAN-0017 | `a6e4339a`'s census forbidding any test double from answering a `Range` request with a fixed body | — |

---

## 🔧 CORRECT

| item | objective / task | decision | reason | risk of ignoring |
|---|---|---|---|---|
| **F1 — `swell_height_ft` publishes VHM0 on one lane and VHM0_SW1 on the other, DEFAULT ON** | WS-OBJ-302 / WS-CAN-0064 | **Repair now — mission node 1** | `conditions.py:75` ← `spot_ratings.py:136` `marine.point.speed`. `CLAUDE.md` names and forbids exactly this. | **CRITICAL.** Every consumer of `/conditions/batch` receives a height whose meaning depends on which lane answered, and nothing in the payload says which. |
| **F2 — the island lane is DEFAULT ON with a refuted inertness claim** | new id required | **Guard it, or default `COPERNICUS_ISLAND_INGEST=0`** — mission node 2 | the selector never consults `region_id` (`point_resolution.py:340`; `manifest_view.py:39-51`) and resolution is an active tie-break | **HIGH.** Chain data changes silently for EURO marine points in 20 bboxes; EURO becomes three upstreams under one label. |
| **F6 — register desynchronisation** | WS-OBJ-705 | **Re-synchronise — mission node 3** | 48% of the window invisible; 2 dangling refs; 5 dropped 12.2 deltas; authority map 126 commits stale | **HIGH.** The next audit cannot measure progress against records that do not contain the work. |
| **F3 — the parity instrument's unguarded third case** | WS-OBJ-506 / WS-CAN-0010, 0063 | **Scope it, and stop the ungated production POST until scoped** | `forecastDiagnostics.js:334`; the display also disagrees with the computation at step 9 | **HIGH.** Production emits up to 87 fabricated violations per session to a live endpoint, invisibly — and the HUD is no longer usable as an oracle. |
| **The CI floors' self-referential pair test** | WS-OBJ-705 | **Replace with a test that reads the real selector output** | measured at HEAD: chain floor stale by 2 files / 30 tests, and no test in the repo can see it | **HIGH.** The floors exist to notice coverage disappearing and currently cannot. |
| **`WS-OBJ-401`'s two dangling references** | WS-OBJ-401 | **Allocate WS-CAN-0068 / 0069 or remove the citations** | neither id exists in any register | MEDIUM — an objective citing nothing cannot be closed. |
| **The +5 permanent style layers per marine visit** | WS-OBJ-401 | **Repair — but in the mission AFTER 13.1-C1** (it is a renderer change) | 138→143, never returns; Jacobian +5 against a zero-noise floor | MEDIUM — a long session accumulates dead layers; no test sees it. |
| **The `layerSwitch × modelSwitch` teardown suppression** | WS-OBJ-401 | **Add a lifecycle test; repair with the batch above** | residual **+84 textures / +924 buffers** | MEDIUM — invisible to all first-order testing. |
| **`layer_to_watertemp` costs 100 requests for one switch** | WS-OBJ-302 | **Measure before repairing** | 2–40 for every other layer | LOW–MEDIUM. |
| **Accessibility of the weather controls** | CLAUDE.md a11y mandate | **Correct when next touching `MapWeatherControls`** | 62 buttons, **1** `aria-pressed`, **0** `role="slider"`; state conveyed by colour alone; toggles have no idempotent set | MEDIUM — a binding project mandate, and it also makes the controls untestable. |

---

## ⛔ STOP

| item | decision | reason | reopening condition |
|---|---|---|---|
| **Evidence-only commits that update no register and change no code** | **STOP** | **44 of 127** commits. `C4-MR-02` produced 4 documents (365 insertions) and **zero** lines of code. Two commits alone are 38% of one batch's insertions and shipped nothing. | an evidence commit is acceptable **only** when it closes a register row in the same commit |
| **Rendering-artefact campaigns at z ≥ 9** | **STOP until the resolution ceiling lifts** | the served grid is **2° / ~223 km at every zoom from 5 to 12**, measured on the deployed build. Chasing a halo across a 223 km interpolated cell has a floor no shader change can reach. | when the disclosed grid falls below 2° at z ≥ 9 |
| **Adding a new default-ON ingestion authority while Gate 1 is open** | **STOP** | `fb50fa6d` did exactly this, labelled inert | after F1 and F2 are closed and Gate 1 is assessable |
| **Retraction chains longer than ~4 commits without a code change** | **STOP — timebox them** | the "255° residual" was torn down across `b201919a`, `6a072e36`, `3bf1ef1d` and then withdrawn entirely at `80b4facb`: **it was a road-number shield icon on the basemap** | — |
| **Claiming a root cause in a commit subject before the A/B is run** | **STOP** | `7becd023`'s subject claims "ROOT-CAUSED"; `784b4c6c` states flatly the claim is refuted, and the commit plausibly *caused* the defect it named. `git log --oneline` **still shows the refuted claim as the last word.** | — |
| **Setting a CI floor from a prediction rather than a reading** | **STOP** | `be6a705a` broke CI; `ce66f6f4` records CI actually read 416. `1bcd2241` edited a floor without its pair and must have been red. | — |

---

## ⏸ DEFER

| item | decision | reason | reopening condition |
|---|---|---|---|
| **WebGPU** | **Defer** | `navigator.gpu` false in the audit context; the renderer is not the measured bottleneck; Gate 1 open | a measured frame-time bottleneck on real hardware attributable to WebGL |
| **Zarr / Kerchunk** | **Defer** | the served-resolution ceiling is an ingestion/serving-tier question, not a storage-format one | after NODE 5 lifts the ceiling and storage becomes the next bound |
| **Worker rearchitecture / transferable buffers** | **Defer (Not Necessary now)** | 2 construction sites, 18 live, **zero multiplication** under every journey | a measured main-thread stall attributable to worker messaging |
| **Gate 8 — AI-assisted forecast enhancement** | **Defer** | Gate 1 is failing and a published field carries two meanings | after Gate 1 passes |
| **The island lane's SERVE half** | **Defer to the mission after 13.1-C1** | highest-leverage feature work on the board — but must not land while the ingest half is already changing data unwatched | immediately after F1 + F2 close |
| **The style-layer and lifecycle repairs** | **Defer to one batched renderer mission** | all are renderer changes, which 13.1-C1 forbids | after 13.1-C1 completes |

---

## ❌ REJECT

| item | reason |
|---|---|
| **A seventh broad audit** | ⛔ Explicitly forbidden — 12.1 §18 lists 5 conditions and requires 3. Not met. Audit 13.1 is a *trajectory* audit and does not reset that counter. |
| **Renaming `swell_height_ft` to make the current value correct** | The consumer contract is frozen and the live lane's meaning is the established one. Renaming would propagate the wrong quantity under a new label rather than fixing it. |
| **Widening the ERA5 census bounds or the parity gate to absorb a breach** | Standing owner decision; nothing in this window changes it. |
| **Any new "just for this screen" forecast path** | `CLAUDE.md`'s standing prohibition. F1 is what happens when the mandate is satisfied at the function level and bypassed at the route level. |

---

## 🟢 NOT NECESSARY

| item | reason |
|---|---|
| **The served-resolution disclosure** | Already shipped, **pre-baseline** (`b8560c74`/`071e478d`, 2026-08-11), working, and correctly silent on native tiers. **Preserve, do not rebuild.** |
| **Worker-count reduction** | 2 construction sites; zero multiplication under race and burn-in. There is no problem here. |
| **Model-switch resource optimisation** | Already 0 textures / 0 buffers / 0 workers / 0 layers against a zero-noise floor. |
| **Antimeridian and high-latitude special-casing** | Both verified clean; `dLayers = 0` at 179.6 °E; no super-additive interaction. |

---

## 🛡 PRESERVE

**These are working. Do not refactor them, and re-verify them after any change nearby.**

| item | current evidence |
|---|---|
| **The ONE FORECAST COMPOSITION chain at the computation level** | `science_registry.py` and `surf_point.py` **byte-identical** to baseline (blobs `38b283d8…`, `33b08590…`); `estimate_surf_at` 4 production callers; `compute_surf_rating` 4 production callers — **both sets identical to baseline**. No new site derives a height or a score. |
| **Zero owner multiplication** | workers 18→18, GL contexts 1→1, canvases 4→4, renderers 2→2, under an unthrottled race journey and 3 remount cycles |
| **Stale-response rejection** | held under 71 in-flight requests during deliberate thrash; no stale label survived |
| **Model switch and timeline scrub cleanliness** | **0** textures, **0** buffers, **0** workers, **0** layers, against a **zero-spread** noise floor |
| **Antimeridian and high-latitude behaviour** | 179.6 °E z6 and 66.5 °N z5 both clean; no layer-count change |
| **Zero uncaught page errors** | across 1,558 requests and 13 journeys |
| **`servedResolutionNotice.js`** | correctly silent on native tiers, correctly refuses on unknown resolution — *"an unknown resolution is not 'fine' and not 'coarse'"* |
| **The `SAFE_DEGRADED` coverage terminal state** | `d555b17e` |
| **The FPS-guardrail downgrade disclosure AND recovery** | `fc3e2af2` — the downgrade is now both disclosed and recoverable |
| **The `spot_ratings.py` → `spot_ratings_precompute.py` split** | a **one-way** move; the precompute module imports `rate_one_spot` and never imports `compute_surf_rating` or `estimate_surf_at`. The reference implementation stayed put. |
| **`publish_surf_height`** | **narrowed** the seam — cap and statistic now resolve at one shared point instead of two |
| **The halo fix** | `784b4c6c` + `050f19b3`, verified on the deployed build with a positive control at `6022f4cf`. **Nine hypotheses refuted before the real cause.** ⚠️ It has **no register entry** — preserve it by giving it one. |
| **The 4 verified authority-map claims** | `rating_why` one producer; the readiness vocabulary one owner; `surf_alert_body` unified; the two-lane client ratings note — **all four verify at HEAD**, line by line |
