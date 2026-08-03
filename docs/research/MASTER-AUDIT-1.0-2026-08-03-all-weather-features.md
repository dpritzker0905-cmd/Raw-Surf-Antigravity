# MASTER AUDIT REPORT 1.0 — all weather features
**2026-08-03** · backend · frontend · database · live API · deployed site · the sim · ERA5 lane · CI

**Method:** 12 parallel survey agents (2.65 M tokens, 813 tool uses, 22 min) over docs/handoffs,
backend chain, frontend chain, the sim, database, ERA5 lane, flags/wiring, tests/CI, live API,
external best practice, accuracy levers, perf/memory — then **every critical/high finding sent to an
independent adversarial verifier instructed to REFUTE it**. In parallel I drove the live map myself
(all marine layers, zoom 3→13, four basins, rating toggle, scrub) reading the app's own diagnostic
rings, and exercised all six sim MCP tools against production.

---

## §0 THE META-FINDING: SEVERITY DID NOT SURVIVE CONTACT WITH VERIFICATION

| | surveys claimed | after adversarial check |
|---|---|---|
| critical | **17** | **0** |
| high | **40** | **1** |
| medium | — | 15 |
| low | — | 13 |
| **refuted outright** | — | **5** |

**134 raw findings. 34 verified. 29 stood, 5 fell, and almost every survivor was DOWNGRADED.**

⭐ This is the most important line in the report. A fan-out of capable readers produced 17
"criticals"; **not one survived an adversarial pass**. The failure mode was consistent: a real code
fact, wrapped in a consequence nobody had measured. That is the same shape this repo has recorded
against itself all week, and it is why the verify phase exists.
⇒ **Treat any un-verified severity in this repo as a hypothesis.** The count is not the finding.

---

## §1 THE WEATHER SIM — the owner's stated priority

### 1a. ⭐⭐⭐ THE RATING ENGINE IS NOT THE CEILING. THE DATA IS. (constructive proof)

Fed `simulate_weather_change` a physically ordinary Florida groundswell at Sebastian Inlet
(full geometry, shore normal 68.2°, break depth 5.6 m):

| input | breaking | quality | binding factor |
|---|---|---|---|
| 1.55 m @ 14 s, dir 68°, 3 kt offshore | **8.7 ft** | **97.3 "epic"** | none — all nine multipliers **1.0**, blend 0.973 |
| 2.6 m @ 15 s, dir 70°, 4 kt offshore | 13.1 ft | 60.4 "fair_good" | `oversize_gate 0.604` (ceiling 9.4 ft) |

`reconstruction_error: 0` on both. **The nine-factor product reaches 97.3 on an achievable day**,
while the live product served **0 good/epic across 1,346 spot-hours**. This closes the ledger's #1
question constructively: the composition is sound; the inputs never land in the window.

### 1b. WHAT THE SIM DOES WELL — do not "fix" these
* `find_best_window` returns `light` / `sun_elevation_deg` / `surfable_light` — it will not
  recommend a 2 am session. 13/13 frames resolved.
* `find_best_spot`'s `truncated` field is **exemplary no-silent-caps practice**: *"49 spots lie
  within 120 km; the nearest 12 were scanned (SIM_COMPARE_MAX_SPOTS=12, a latency budget). This
  answer is COMPLETE out to 25.75 km."*
* Blind-spot rule: a spot with no resolved shore normal is ranked **last whatever it scores**,
  because the error can only push a score UP (+8.5 median, max +88.6, level changed at 66.7%).
* Every payload carries `limiting_factor`, `swell_exposure`, `shore_normal_source`,
  `geometry_readiness`, `quality_raw` vs `quality_confirmed`, `reconstruction_error`.

### 1c. CONFIRMED SIM WEAKNESSES
1. **Hard-pinned to GFS** — the weakest model in the stack. Measured this session at 70 buoys,
   GFS scored on the SAME sites: `EURO/copernicus` MAE **0.159** vs `GFS/noaa` **0.443**. No sim tool
   exposes a model choice. *(survey; severity per verifier: medium)*
2. **Cannot differentiate co-located breaks.** Six Sebastian breaks within 2 km score 41.5–42.9 —
   First Peak 42.3, Monster Hole 41.5. They differ only by shore normal (68–72°) and break depth;
   sandbar shape, size preference and per-peak tide windows are not modelled. **Product-value gap.**
3. **An isolated period spike yields a spurious `very_poor`.** Sebastian window scan, 6 h steps:
   period 7.8 → **3.7** → 7.5 → 7.5. The 3.7 drives quality to **5.6 (very_poor)** via `period_gate`
   inside a run of `fair` hours. One bad frame makes the scan recommend against a fine hour.
4. **`baseline_delta`'s baseline side is ungated** (`weather_sim_mcp.py:486` and `:556` both omit
   `valid_time`). For the what-if that is correct by design; for `base_calc` it grades the REAL
   forecast at a real hour, so `quality_rating.from` can disagree with what the app shows. Latent
   today (42.7 < the 69.9 cap). ⚠️ The fix is subtle — the code deliberately grades both sides
   identically so the delta measures the caller's change; gating one side corrupts it.
5. **31 sim tests run in no CI lane** — including the stdio-deadlock guard and the mutation/RBAC
   guard — because fastmcp is install-incompatible with the pinned stack.

### 1d. ✅ FIXED THIS SESSION
The observation gate was **inert on `get_weather_forecast`**: the hour was parsed, used for the
baseline, and never threaded into the rating call. The sim was the only surface able to say "good",
purely by skipping the cap every glyph applies. Fixed `2680afe7`; guarded by a new `GATE_ARG_CALLERS`
registry + a source-by-path reader so fastmcp modules are guardable at all.

---

## §2 THE ONE SURVIVING HIGH — data is modified and the provenance is silently dropped

`fill_coarse_enclosed_sea_from_gfs_served` fills Gulf/enclosed-sea holes from GFS (verified by
execution: `is_valid` False→True, `speed` 0.0→2.5 = the donor's). It then stamps
`product.coarse_fill = {...}` — but `NormalizedProduct` has **no such field and no `extra="allow"`**,
so the assignment raises `ValueError` and is **swallowed at `coarse_gulf_fill.py:162-163`**.
`"coarse_fill" in out.model_dump_json()` → **False**.

Two things the verifier added that the reporter missed:
* **A second barrier**: `weather.py:105` declares `response_model=NormalizedProduct`, so declaring
  the field is necessary but not sufficient — the value must also survive FastAPI's filter.
* ⭐⭐⭐ **A GREEN GUARD THAT TESTS NOTHING**: `test_coarse_fill_layers.py:125-134` asserts
  `out.coarse_fill[...]`, but its `_product()` helper builds the product with
  **`types.SimpleNamespace`, which accepts any attribute assignment**. The provenance guard has been
  green and has never once touched the type that actually raises.

**Why it matters:** served values are silently substituted from another model with nothing in the
payload to say so — the exact PROVENANCE class this repo names as its recurring root.

---

## §3 CONFIRMED, MEDIUM — the actionable middle (15 stood, all at high confidence)

Grouped by leverage. Full evidence in `scratchpad/survey_digest.md` (254 KB) and `verdicts.md`.

**Correctness / composition**
* `/api/conditions/{spot_id}` serves **offshore Hs** under `wave_height_ft`, bypassing
  `resolve_surf_geometry` — the binding ONE-COMPOSITION rule. *(downgraded from critical: verifier
  scoped which callers actually read it)*
* The **map rating band** computes breaking height without the directional exposure factor the point
  lane applies.
* The **ECMWF period-band partition path is unreachable**: `wave_bands` is READ but never WRITTEN.
  Three docs describe it as shipped. *A consumer with no producer.*

**Accuracy levers (all gated on §5's measurement problem)**
* A **refraction coefficient measured against 385,651 CDIP hours** (Kr median 0.797) exists and
  production serves 1.0.
* The **quantile map** that corrects the dominant uncancelled height error has **no production
  caller**.
* The **spectral path** is built, tested, documented with its own measured 2× errors — and **off**.
* `H110`/`Kr` **do not cancel in two places but three** — the size-climatology reference is the third.
* EURO's served wave field is the **25 km ECMWF stream at 7 of 8 regions** while its own partitions
  are 8 km CMEMS.

**Data / geometry**
* **40.6% of served spots run on degraded or absent geometry**; the shore normal is the top rating
  lever (7.4 / 28.1).
* The seven geometry columns exist **only in the live database** — not in the ORM, not in any
  migration. *(downgraded: they are present and working; the risk is reproducibility, not outage)*
* The reconcile queue is **write-only** — `needs_geometry_refresh` is set and never consumed.

**Ops / CI**
* **CI red on 27 consecutive runs**, `dev` unprotected. *(downgraded — most failures are in
  non-weather product suites, but the gates are not gating)*
* `--limit` applied **before** the resume filter, so the nightly ERA5 task means "the first 150 by
  id" forever. **One-line move; not done here because it changes scheduled-job behaviour.**
* `/status` health fields are **hardcoded literals** — it can never report unhealthy.

---

## §4 REFUTED — 5 findings that did not survive, and why that is the point

1. *"The fix was never shipped"* → **it shipped 2026-07-30 (`cc6455a9`) as a sibling module and is
   live in prod.** The reporter grepped one name.
2. *"The one discriminating measurement was never run"* → **both limbs refuted**, with n and commands.
3. *"Warming 400 into a store bounded at 128 cannot work"* → **a category error**, refuted at HEAD.
4. *"NEVER RUN"* → **false — the untracked artifacts ARE the run's output.**
5. *"Three misses"* → the raw code facts reproduce, but **only one of the three is real.**

⭐ Four of five are the **absence-is-a-claim** failure: asserting something does not exist after one
grep. It is the repo's most common self-inflicted error and it recurred inside the audit built to
find it.

---

## §5 THE THING THAT GATES EVERYTHING ELSE

**We have a skill score and it says we are behind.** `forecast_skill.py` runs from the calibration
loop and its archive was populated all along — nobody had read it. Paired over **3,852 cells**:

| lead | ours MAE | Open-Meteo MAE | we win |
|---|---|---|---|
| +24 h | 0.289 | **0.182** | 35.6% |
| +48 h | 0.311 | **0.210** | 37.6% |
| +72 h | 0.341 | **0.239** | 42.6% |

~52% worse than a free competitor, at 42 of 59 buoys, **~zero bias on both sides ⇒ scatter, not an
offset any constant can fix.** And it is largely a **GFS** gap: stratified by the provider that
actually answered, with GFS scored on the SAME sites — `EURO/copernicus` **0.159**, `EURO/ecmwf`
**0.339** (worse than GFS's 0.266 there), `GFS/noaa` **0.443**.

External best practice (§ from the research agent): verification reports only bias and MAE — **no
RMSE, scatter index, correlation or symmetric slope**, all standard at operational wave centres — and
the buoy network is nearshore-dominated (median depth 32 m) with no depth or exposure stratification.

⇒ **Every accuracy item in §3 is unfalsifiable until this is fixed.** That is the real #1.

---

## §6 MY OWN LIVE FINDINGS — including two retractions

**Retracted.** *"The antimeridian collapses the marine grid ~600×"* — **did not replicate.** The tell
was in my own data: −175.0 and −160.0 returned **byte-identical `nonzero=11797, maxH=18.1327`** —
one retained global grid over-served at both, not two fetches. Known cache-containment behaviour.
★ **Two viewports returning identical payload stats is the signature of one cached grid. Diff the
payload before calling a difference a defect.**

**Downgraded to hypothesis.** FPS 3 / 315 dropped frames / texture growth 27→79 with GPU memory
26→55 MB. The Browser pane runs **hidden**, so rAF is paused —
`marine-raf-hidden-tab-confound.md` says findings of this shape are "mostly TEST ARTIFACTS". The ring
reader independently found `textureUploadCount=160` vs `uploadDiag=26` — **two counters of one
quantity disagreeing 6×** — which undermines the metric the claim rested on. **Needs a visible tab.**

**Stands.** A zoom-7 viewport can be served a 4×6–7×7 grid — effectively blank — while the
Diagnostics HUD reads `Raster Source: LOADED`, `AUTHORITATIVE NATIVE`, `No Causal Layer Violations
Detected` (screenshot captured). And `upstreamProvider` is **null at all 21 render steps**; the
user-facing HUD resolves provenance correctly via `__sourceDataset`, so this is a **developer-
diagnostic** gap, not a user-facing mislabel.

**Ring reader, 3 FAILs on a live map** — `FPS_drop_detected` is **86.4% of 434** telemetry entries.
That is the **third** ring-poisoning instance after I fixed `model_warning` (73.8%) this morning:
fixing emitters one at a time just promotes the next-loudest. **The ring needs a per-type quota.**

---

## §7 ✅ SHIPPED DURING THIS AUDIT

* `96285138` — **the ERA5 resume marker had a ~4-hour half-life.** `merge_frames_into_climatology`
  rebuilds each record; the hazard was named in the code's own comment and fixed for `lat`/`lng`
  ALONE, so `era5`/`backfill` were stripped every precompute cycle. **The histogram was never lost;
  RESUMABILITY was** — an ~85 h campaign re-fetched spots it already held on every restart, and this
  morning's `NEVER BANK AN EMPTY SPOT` guard reasoned entirely from a stamp with a four-hour
  half-life. Fixed generically; regression test states why its control is there.
* `2680afe7` — the sim's observation gate, armed.
* `9fa10d8e` — LayerRegistry idempotency (48 identical warns in 2 ms were destroying the telemetry
  ring they shared).

**ERA5 campaign:** running, 31 spots, 30 banked, **zero NO-SAMPLES** since the seaward-nudge fix.

---

## §8 WHAT TO DO NEXT — Jacobian order

1. **Fix the measurement before any accuracy work.** Add RMSE / scatter index / symmetric slope to
   the skill report and stratify the buoy set by depth and exposure. Everything in §3's accuracy
   group is unfalsifiable until this exists. *(The per-model ledger `a2302102` already accumulates
   ICON+EURO; the provider split is the next field to carry.)*
2. **Route EURO `waves` to CMEMS — but horizon-aware, and A/B it.** 3.2× better where it applies;
   costs a shorter native tail (blend seam moves earlier) and ~9× cells on a 2 GiB box.
3. **`--limit` after the resume filter** (one line) so the nightly ERA5 task advances.
4. **Make `coarse_fill` provenance real** — declare it on the model AND past the `response_model`
   filter, and rebuild its guard against the real type instead of `SimpleNamespace`.
5. **A per-type quota on the telemetry ring.** Three instances of one emitter erasing all others.
6. **The sim: expose model choice** and stop hard-pinning GFS.
7. **Geometry**: 40.6% degraded is a prerequisite for any nearshore modelling, not a parallel track.

⛔ **Do not** tune `swell_exposure`'s floor, flip the default model, or unpick `H110`/`Kr` until (1)
exists. Each is a constant chosen against an unverifiable target.
