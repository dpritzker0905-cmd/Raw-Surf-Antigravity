# UPGRADE READINESS MATRIX — reassessed at HEAD `8be9dd56`

Report 11.0 rejected a large modernization set after pricing it three audits in a row. This audit
**re-tested the load-bearing premises rather than re-inheriting the conclusions**, and changes two
of them.

Readiness: **Ready Now · Ready After Current Gate · Prototype Only · Benchmark First · Premature ·
Misprioritized · Defer · Reject · No Longer Needed**

---

## 1. The rejections — do they still hold?

| Upgrade | 11.0 verdict | 11.1 verdict | What changed / what was re-tested |
|---|---|---|---|
| JAX / CuPy / GPU / Numba for the forecast chain | Reject | **Reject — reaffirmed** | The measured bottleneck is **server RSS on the serve path**, not CPU in the physics. T-CAP-03 shows the cost scales with *cells serialized*, not with arithmetic. Accelerating the physics would not move the binding constraint at all. |
| Zarr / COG / Kerchunk / Dask | Reject | **Reject — reaffirmed** | Range-streamed ingestion is not what is failing. Nothing in this window touched ingestion cost. |
| Neural emulators / learned downscaling | Reject | **Reject — and now with a stronger reason** | The product's own lane loses to a **free deterministic competitor at all three horizons** (paired, n≈790). Adding a learned layer on top of a lane that is 33 % behind Open-Meteo optimises the wrong term. Fix the deterministic gap first. |
| GNN / nested grids / AMR / SWAN / FVCOM | Reject | **Reject — reaffirmed** | Nearshore physics remains input-bound, not model-bound (fourth audit in a row). |
| Finer bathymetry as an accuracy lever | Reject | **Reject — reaffirmed** | The γ thread binds on 0.145 % of served spot-hours. |
| WebGPU / OffscreenCanvas / worker rendering | Not prioritized | **Premature — and now unmeasurable** | The GPU path could not be measured at all this audit (hidden tab, 0 rAF ticks). Adopting a new rendering substrate while the *existing* one has no executed-pixel test in CI would layer a new system on an unverified foundation. |
| SharedArrayBuffer / transferable buffers | Not prioritized | **Premature** | Same reason; and `GridParserWorker`'s reply-ordering test (R11-14.3) is still absent. |

---

## 2. The adoptions — where is each one now?

| Upgrade | 11.0 classification | 11.1 status | Readiness now |
|---|---|---|---|
| Clear/gate `__MARINE_ENGINE__` + backstop flag gate + terminal stages | Adopt | **Shipped, unvalidated under trip** | **Ready After Current Gate** — needs the `force_marine_fallback` soak (G-05) |
| Run identity on series frames + run census | Adopt | **Shipped and already earning** — caught a live `mixed_runs: true` | **Ready Now** for the *cycle* half (`cycle_dt` as true `run_time`) |
| Build stamp in truth/telemetry payloads | Adopt | **Shipped** | **No Longer Needed** |
| Client→server telemetry uplink | Adopt | **Not started** | **Ready Now** — both halves exist; this is the highest-leverage absent instrument |
| Measure-or-refuse status endpoints | Adopt | **Shipped** (one `# Placeholder` residual at `system.py:208`) | **Ready Now** (trivial residual) |
| Worker `onerror` + reply ordering + zero-fill→null | Adopt | **Shipped** (ordering test still absent) | **Ready After Current Gate** |
| dt-normalized advection | Prototype | **Not started** | **Benchmark First** — and the benchmark is currently impossible (G-02). Fix the visibility precondition in the harness before prototyping the physics. |
| Port marine's 4 invariants to wind | Adopt | **Shipped** (device-tier + reduced-motion) | **No Longer Needed** for those two |
| Retire/pin the ICON client blend | Prototype | **Not started** | **Defer** — behind the capacity work |
| **Executed-GL pixel harness** | Adopt | **Authored as `test.fixme`; never runs** | **Ready Now — and overdue.** The blocker was diagnosed as *not* a missing GPU (Chromium's SwiftShader passes under `--disable-gpu`); it is a skip by declaration. |
| Canvas-hash "hour change changes the frame" assertion | Adopt | Not started | **Ready After Current Gate** (rides the same harness) |
| Legend/readout truth batch | Adopt | **5 of 7 shipped** | **Ready Now** for cross-fall slot sampling; radar dBZ correctly **Blocked** on an absent palette spec |
| Hour-0 unification + served-frame label | Prototype | Not started | **Defer** |
| Arm `marineCommitArbiter` | Benchmark First | Not started; still dark | **Benchmark First — unchanged.** Read `arb_shadow_diverge` before flipping. |
| Serve-side run-age ceiling → staleness state | Prototype | Not started | **Ready After Current Gate** — `run_census` now supplies the input it needed |
| Held-frame/estimated badge | Adopt (design-gated) | **Shipped** (`d1b40987` un-gated the existing staleness warning) | **No Longer Needed** |

---

## 3. Two upgrades that changed rank in this window

### 3.1 — **NEW #1: bound `grid_series` at RESOLUTION, not at retention**

Not in Report 11.0's matrix, because 11.0 predates the OOM diagnosis. It is now the highest-value
piece of engineering available.

* **Confirmed problem it solves:** one global series still costs +157 to +202 MB resident on a
  settled box, and the client fires three per settle against ~484 MB of headroom.
* **Prerequisite architecture stable?** Yes — `stride_for` already exists and is the one expression
  both bounds use.
* **Bottleneck measured?** Yes, three times, with a size-scaling control.
* **Migration partially complete?** Yes — `0d9149b7` moved the bound from the response to the
  per-hour landing. The remaining step is to move it *before* `GridVector` materialization.
* **Safer to finish the current path than start a new one?** **Yes** — this is completion, not a
  new system.
* **Fallback / shadow mode?** Yes — the existing kill switch and the end-stage budget both remain.
* **Readiness: Ready Now — but see the packet: the *test* comes first.**

### 3.2 — **RISING: the accuracy gate needs baseline rows before any forecast investment**

* **Confirmed problem:** the gate is green (`MAE 0.152 m` vs `warn 0.30`) while paired comparisons
  show the product lane losing to Open-Meteo at +24/48/72 h and to its own EURO member.
* **Why it outranks physics work:** every forecast improvement will be graded by this gate. A gate
  that cannot express "worse than a free competitor" cannot certify any of them.
* **Readiness: Ready Now** (add `persistence` and `open_meteo_marine` paired rows to the RED
  criterion — the monitor already computes both).
* **Explicitly NOT authorized yet:** the ICON warm-bias correction. It is a calibration change, and
  the standing constraint is *no calibration/threshold tuning until the gate that would catch a
  mistake exists*.

---

## 4. Sequence check — is the project following Report 11.0's order?

| Phase | Order | Following it? |
|---|---|---|
| 0 Baseline protection | first | **Yes** — clocks closed, CI coverage widened, E2E signal restored |
| 1 Surgical stability repairs | second | **Yes, substantially** — 8 of 18 R11 items materially repaired |
| 2 Low-risk performance | third | **Partly, and out of order in one place** — the OOM repair was correct to do (it was a P0), but it was **declared complete on an unsound measurement**, which is a *validation* failure, not a sequencing one |
| 3 Data-pipeline modernization | fourth | Not started — correct |
| 4 Numerical acceleration | fifth | Not started — correct |
| 5 Nearshore modeling | sixth | Not started — correct |
| 6 AI-assisted enhancement | last | Not started — correct |

**No premature-phase violations found.** Nothing was GPU-modernized before render ownership was
stable; no new model was added before timeline harmonization; no AI layer was added before
deterministic validation. The single sequencing concern is not "too far ahead" but **"declared
done too early"** — a gate-D (regression protection) failure inside phase 2.
