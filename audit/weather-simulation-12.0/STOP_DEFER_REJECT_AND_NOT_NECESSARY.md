# STOP · DEFER · REJECT · NOT NECESSARY · PRESERVE

`dev` @ `3ec3fd13` · 2026-08-12

---

# 1. STOP NOW — work currently increasing instability or churn

| # | Stop | Evidence | Reopen when |
|---|---|---|---|
| S-1 | **Commissioning another broad weather-simulation audit.** | 35 reports exist. The failure mode was named in advance on 2026-08-11: *"Both would produce a fifth document about a system whose problems are now specifically named… The next artifact should be a one-page gate ledger you **update**, not a new report you **author**."* 12.0 is that ledger. | A gate-specific review is always allowed. A broad audit needs a named gate that the register cannot answer. |
| S-2 | **Authoring implementation packets before folding in the current window's own evidence.** | Three consecutive packets superseded before use: 11.0's rewritten at `8f1fcf41` for *"specifying building something that already exists"*; 11.1's superseded inside its own audit; 11.4's Stages 1/2/4 already complete at publication. | Never — this becomes governance rule 6. |
| S-3 | **Further ocean-mask optimisation.** | 11.4's explicit prohibition, and it is right: the cost model is cross-validated and the two levers are sized. The next lever is a visible-behaviour change. | A human watches a pan and signs off on the settle debounce. |
| S-4 | **Promoting the settle debounce.** | `85e3f1fb` — *"MUST NOT be promoted yet."* A deferral leaves the mask un-suppressed for that frame. | Same as S-3. |
| S-5 | **Citing an audit by version number.** | Three documents numbered 11.0, two numbered 11.2, none numbered 11.3. *"Report 11.0 said X"* is ambiguous by construction. | Never — cite the path. |
| S-6 | **Reporting a performance delta across different statistics.** | 11.1 reported p90 32 s → 16 s; today's live figure is p99 31.1 s. Neither refutes the other and the comparison misleads. | Never — fix the statistic, then compare. |
| S-7 | **Treating a green scheduled workflow as evidence about the product.** | Run `31606511901` ends `verdict: OK` while printing `WE LOSE` eight times. | When WS-CAN-0026 lands. |

---

# 2. DEFER — valid, prerequisites missing

| ID | Task | Missing prerequisite | Reopen condition |
|---|---|---|---|
| WS-CAN-0011 | dt-normalized advection | A frame harness (WS-CAN-0037) | Frame rate becomes measurable |
| WS-CAN-0016 | Hour-0 unification | A design decision — it changes visible label behaviour | Owner accepts the label change |
| WS-CAN-0044 | p2 exclude-precedence inversion | Zero callers today | Any canary is scheduled |
| WS-CAN-0052 | `SURF_PARTITIONS` flip | ✅ WS-CAN-0002 **closed**; cap-seam decision + owner remain | Cap-seam resolved, all lanes flip together |
| WS-CAN-0053 | `SURF_TIDE_DEPTH` flip | Break-depth completion + a positive-control census | Both exist. Highest-reach absent nearshore term (~19× γ) |
| WS-CAN-0054 | Skill-gate arming | ~2026-08-22, two clean weeks | The date, with clean data |
| WS-CAN-0042 | Calibration bound value | Owner decision | **Never widen.** Re-derive at the operating percentile, or wait for ERA5 |
| WS-CAN-0050 | WebGPU / OffscreenCanvas | No measured bottleneck **and** no way to measure one | A frame harness shows a GPU-bound frame |
| WS-CAN-0049 | AI bias correction / blending | **No validated baseline** | The lane beats a free public model, or the gate at least grades the attempt |
| WS-CAN-0051 | Learned nearshore transform | The dataset is not growing — that is the finding | Observation volume grows |
| WS-CAN-0043 | Arbiter arming | A production divergence reading | `arb_shadow_diverge` is read and is acceptable |
| WS-CAN-0032 | Settle debounce promotion | A human watching a pan | That happens |

---

# 3. REJECT — approach unsupported, duplicative, or based on a false diagnosis

| ID | Rejected | Why | Reopen condition |
|---|---|---|---|
| WS-CAN-0046 | Zarr / Kerchunk / COG / Dask | Priced against what it would replace by **3 independent audits**; all lose. Range-streamed GRIB2 ingestion off `.idx` is already the efficient pattern. 11.2 adds the decisive reframe: *the backend data contract is already strong — the defect is that the client discards it.* | A measured access-latency bottleneck in the **storage format**, not in composition |
| WS-CAN-0047 | JAX / CuPy / GPU / Numba | Load-bearing premise re-verified at 11.0: **4 s CPU global forecast.** There is no numerical bottleneck to accelerate | A profile shows numerical work dominating |
| WS-CAN-0048 | SWAN / FVCOM / GNN / nested grids / AMR | Three audits agree the binding constraint is **input coverage** (0.25° tiles, break depth, shore normals), not physics. 11.2 adds: a finer model cannot be validated while a fixed coordinate's value depends on interaction history (WS-CAN-0033) | Coverage is solved **and** selection is deterministic |

**Also standing rejected** from the 11.0 lineage, unchanged and not re-litigated here: KD-trees for
the wind lookup · closed-form dispersion · repo-wide `extra='forbid'` · γ-thread investment · finer
bathymetry as an accuracy lever.

⭐ **Preserve the objective, not the technology.** "Add Zarr" was never the task — *"reduce
forecast-data access latency"* was, and it survives. Recording an objective and its proposed
implementation as one item is why four audits re-debated the technology and none re-measured the
objective. The measured latency root today is `grid_series` composition and cold start: p99 31.1 s,
36.8% of requests over 10 s.

---

# 4. NOT NECESSARY

**Nothing is classified Not Necessary.**

The brief permits this label only on proof: the original problem no longer exists, a different
verified implementation satisfies the outcome, the feature was removed, the prerequisite
architecture changed, primary-source practice no longer supports it, the diagnosis was wrong, the
value is too small relative to proven cost, or a higher-level task subsumes it.

Every candidate examined failed at least one of those tests. **Difficulty was never accepted as a
reason.** Three tasks that *looked* like candidates and are not:

| Candidate | Why it is NOT "not necessary" |
|---|---|
| WS-CAN-0018/0019 executed-GL oracle | The code exists and cost real effort. It is **Implemented but Inactive**, not unnecessary. `test.fixme` makes it unreachable, not obsolete |
| WS-CAN-0038 reconcile `DO_NOT_ADVANCE_ITEMS` | **Subsumed** by 12.0 (a valid closure reason) — but the register keeps it so the standalone file gets retired deliberately, not forgotten |
| WS-CAN-0002 JS-mirror port | Looked mooted because `SURF_PARTITIONS` is still `0`. It is not — it is **Verified Complete**, and closing it retired the named release-blocker on the flip |

---

# 5. PRESERVE — do not modify

| System | Protection |
|---|---|
| ONE FORECAST COMPOSITION chain + single write site (`point_surf_augment.py:204`) | AST guard over all 3 rating surfaces; the sim control (12 m → 29.5 ft) reproduces digit-for-digit |
| Refusal semantics | Geometry refusals (2 mis-geocoded spots pinned as a **test control**), coverage floors, `n≥10`, REFUSE(3)≠RED(1) |
| The stale-response guard stack | Monotonic request ids + live-target identity + coalesce-hour resolution |
| Gate 4 animation and lifecycle | 11.2: *"good — don't refactor it"* |
| The projection contract | 85.051129 clamp, per-vertex Web Mercator, world-copy offsets `[0, −360, +360]` |
| The two-orientation texture contract | Explicitly *"not a defect, do not fix"* |
| The ask-echo `valid_time` contract | The frontend depends on it; honesty fields carry the truth |
| Deliberate detach-not-abort switch policy · deactivation-retain · EURO prewarm exclusion | Named *"not a defect, do not fix"* by 11.0 |
| The mask verdict cache implementation | Verified correct by 11.4 and provably guarded by RV-04 |
| The science registry + ratchet | The only barrier between a bare literal and a silent calibration drift |
| `BLIND_FINDINGS_LOCK.txt` and the blind-first method | The program's strongest methodological artifact. **Reuse it** |
| The `[POPULATIONS DIVERGE]` disclosures in the skill log | Load-bearing. An instrument that discloses its own population divergence is doing the rare thing right |

---

# 6. Reopening rules

1. A **Rejected**, **Deferred** or **Superseded** task reopens only with **new evidence named in the
   reopening commit**. A new opinion is not new evidence.
2. Reopening keeps the **original canonical ID**. Never assign a new one to an old problem — that is
   how five source identifiers became one WS-CAN-0014.
3. A task marked **Preserve** may be modified only with an explicit owner decision recorded in the
   register.
4. **STOP items S-2, S-5, S-6 and S-7 are permanent process rules, not temporary holds.**
