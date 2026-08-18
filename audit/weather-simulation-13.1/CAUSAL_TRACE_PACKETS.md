# CAUSAL TRACE PACKETS — Audit 13.1

Six packets. Each states a reproduction, the evidence, the active source path, the state
transition, the commit history, a competing explanation, and a falsification attempt.

**Proof standard applied:** a symptom alone is never a confirmed root cause. Where a
falsification could not be executed, it is reported as **not performed**, never as a null
result.

---

# PACKET 1 — `swell_height_ft` publishes two different physical quantities

| | |
|---|---|
| **Finding ID** | 13.1-F1 |
| **Classification** | **CONFIRMED — static multi-site trace AND live production falsification (2026-08-18)** |
| **Severity** | **CRITICAL** |
| **Objectives / Tasks** | WS-OBJ-302 / WS-CAN-0064 |
| **Introduced by** | `9d8b2ad9` — *"[WS-CAN-0064 / Mission 4] /conditions/batch serves from the precomputed frames"* |
| **Default state** | **ON** |

### The trace

```
user / client
  └─> GET /api/conditions/batch
        ├── LANE A (live)  spot_conditions.py:64   estimate_surf_at(...)
        │                  spot_conditions.py:251-257  swell_1   → VHM0_SW1
        │                  spot_conditions.py:359      "swell_height_ft"
        │
        └── LANE B (frame, DEFAULT ON)
                           spot_ratings.py:110-111  resolve(layer="waves")
                           spot_ratings.py:136      offshore_h = getattr(marine.point, "speed", None)
                           spot_ratings.py:291      persisted to the frame blob as offshore_hs_m
                           conditions.py:75         "swell_height_ft": round(float(e["offshore_hs_m"]) * M_TO_FT, 1)
                                                    → VHM0  (total significant: swell + wind sea)
```

`VHM0` and `VHM0_SW1` are **distinct model variables** — `noaa_gfs_wave_fetcher.py:52`;
`capabilities.py:31`.

### Root cause

The route publishes a height-shaped field it obtained **outside** the forecast composition
chain. `CLAUDE.md`'s ONE FORECAST COMPOSITION mandate constrains what passes through
`resolve_surf_geometry` + `estimate_surf_at` + `compute_surf_rating`. **It does not constrain
what a route may publish.** Lane B's value never enters `estimate_surf_at`, so every guard the
mandate installed is downstream of it and cannot fire.

`CLAUDE.md`, verbatim: *"⚠️ **NEVER report marine `point.speed` as the surf height — that is the
OFFSHORE significant wave height.**"*

### Why the tests did not catch it

`conditions.py:68-70` claims only **shape** parity — *"BYTE-SHAPE IDENTICAL … six keys"*.
`test_conditions_batch_precompute.py:115,119` pins **the key set and the frame's own
arithmetic**. Neither pins the field's *meaning*. A test that asserts six keys exist passes
identically whether those keys hold VHM0 or VHM0_SW1.

### Competing explanation, considered and rejected

*"VHM0 and VHM0_SW1 are close enough to be within tolerance."*
**Rejected.** They are separate variables in the provider capability map, the divergence is
**signed one way** (total ≥ partition, always) and **structural**, not noise. The project's own
record already measured the offshore-vs-breaking divergence at a single coordinate ranging from
−18.7% to +92.7%, signed both ways — establishing that height-family substitutions in this
system are not small.

### Falsification — ✅ **PERFORMED 2026-08-18, AGAINST PRODUCTION, READ-ONLY**

Full write-up: `evidence/scientific-validation/F1-FALSIFICATION-2026-08-18.md`.
Raw data: `F1-falsification-production.json`. Harness: `evidence/f1falsify.js`.

**No production configuration was changed.** Rather than flipping `CONDITIONS_BATCH_PRECOMPUTED=0`,
the run asks **which variable the published number equals**, by sampling `/api/weather/point` at
`layer=waves` and `layer=swell_1` for the same coordinate and hour. That is strictly stronger than
demonstrating that two lanes differ.

**Sample:** 20 spots across 5 regions (Florida, California, Portugal/Iberia, Hawaii, NY/NJ),
backend `568fc2c6`, `valid_time 2026-08-18T21:00:00Z`.
**Lane that answered:** `conditions_source: {"source":"precomputed","precomputed":20,"live":0}` —
all 20 served by the default-ON frame lane under test.

| spot | region | published | VHM0 (`waves`) | VHM0_SW1 (`swell_1`) | tracks | vs partition |
|---|---|---|---|---|---|---|
| Rockpiles | Hawaii | **4.0** | **4.0** | 1.0 | **VHM0** | **+300%** |
| Backdoor | Hawaii | **4.0** | **4.0** | 1.0 | **VHM0** | **+300%** |
| Laniakea | Hawaii | **3.7** | 3.8 | 1.0 | **VHM0** | **+270%** |
| Doran Beach | California | **3.7** | 3.6 | 1.5 | **VHM0** | +146.7% |
| Fort Point | California | **3.2** | **3.2** | 1.7 | **VHM0** | +88.2% |
| Kaisers | Hawaii | **3.5** | **3.5** | 1.9 | **VHM0** | +84.2% |
| Ocean Beach SF | California | **3.1** | **3.1** | 1.7 | **VHM0** | +82.4% |
| Princeton Jetty | California | **3.2** | **3.2** | 1.8 | **VHM0** | +77.8% |
| Pepper Park | Florida | **1.0** | **1.0** | 0.7 | **VHM0** | +42.9% |
| Jetty Park | Florida | **1.4** | **1.4** | 1.0 | **VHM0** | +40% |
| Ponce Inlet | Florida | **1.5** | **1.5** | 1.2 | **VHM0** | +25% |

> **11 of 11 discriminating spots track VHM0. 0 of 11 track VHM0_SW1.**
> Overstatement **min +25%, median +84.2%, max +300% — every one positive**, exactly as a
> total-vs-partition substitution predicts (a total is ≥ its own partition by construction).

**Independent field-identity check:** for **20 of 20** spots,
`published == round(frame.offshore_hs_m × 3.28084, 1)` — **exact**. `/api/weather/spot-ratings`
exposes `offshore_hs_m` directly, so the published field is confirmed to be that value **from the
wire**, not only from the source.

**The remaining 9 spots are reported, not dropped:** all groundswell-dominated with
`|VHM0 − SW1| ≤ 0.2 ft`, where the test genuinely cannot discriminate because the two quantities
coincide. ⚠️ That is not evidence against the finding — **the defect's magnitude is
sea-state-dependent, not location-dependent.** The same Portuguese spot diverges the moment a wind
sea builds over the groundswell.

**⛔ The mission's stop condition is NOT met.** §11.1 required agreement within tolerance at
*every* sampled spot. **F1 remains CRITICAL and Mission 13.1-C1 proceeds as written.**

### Required guardrail

A **meaning** test, not a shape test: both lanes must return the same physical variable for the
same spot-hour, and no route may publish a height-shaped field sourced from
`marine.point.speed`.

---

# PACKET 2 — the island lane's "inert by construction" claim is refuted

| | |
|---|---|
| **Finding ID** | 13.1-F2 |
| **Classification** | **Confirmed** (static trace of the selector) |
| **Severity** | **HIGH** |
| **Introduced by** | `fb50fa6d` — *"the 0.083-degree island ingestion lane"*, **default ON** |

### The claim

`copernicus_island_ingestion.py:29-32`, echoed at `scheduler.py:376-378`:

> *"Until a serving tier reads `region_id` `island_*`, this lane is inert by construction."*

### The refutation

```
copernicus_island_ingestion.py:135   writes model='EURO', domain='marine',
                                     coverage_mode='regional_tile', resolution=0.0833
store_helpers.py:286-294             manifest slice key INCLUDES region_id
                                     → island products COEXIST with, not replace, the others
point_resolution.py:340              for p in products_for(manifest, model, domain, layer)
manifest_view.py:39-51               filters on (model, domain, layer) ONLY — region_id NEVER consulted
point_resolution.py:36-49            ranks by (time_diff, resolution, bbox_area)
                                     → resolution is an ACTIVE tie-break
```

At equal time, **a 0.0833° product outranks every 0.25°, 2.0° and 10.0° EURO candidate covering
the same point.**

### Root cause

The safety argument was made about a *field that exists* (`region_id`) rather than about the
*code that selects* (which never reads it). The sentence is literally true and logically
insufficient: no serving tier reads `region_id`, and none needs to for the products to win.

### Consequence

The data reaching the forecast chain for EURO marine points inside 20 bounding boxes **changes
on the first successful ingest cycle**.

### Honest scoping

- `model=EURO` only. GFS is the route default, so most traffic is unaffected.
- The change is **plausibly an improvement** — 0.0833° is genuinely finer than 2°.
- The defect is not that the data changed. **The defect is that it shipped labelled a no-op, so
  nobody is watching for the change**, and EURO is now **three upstreams under one label**
  against a repo landmine that already records EURO as two.
- It also runs against `PROGRAM_CONTROL_13.0.md:47`, which forbids coverage expansion until a
  cadence measurement and a bytes-per-model-run figure exist — figures `fb50fa6d`'s own commit
  body then supplies.

### Falsification available

Query the manifest for a Madeira coordinate after one ingest cycle and confirm which
`resolution` the selector returns. Not run — the lane had not necessarily completed a cycle
during the audit window.

---

# PACKET 3 — `SOURCE-PARITY-MISMATCH` is a fabricated violation, POSTed from production

| | |
|---|---|
| **Finding ID** | 13.1-F3 |
| **Classification** | **Confirmed** (9-step live causal trace + a pixel discriminator) |
| **Severity** | **HIGH** (observability — **not** a rendering defect) |
| **Objectives / Tasks** | WS-OBJ-506 / WS-CAN-0010, WS-CAN-0063 |

### Reproduction

Local dev, Cocoa Beach z8, dark theme. Drive
`Wind → Waves → Wind → Swell → Water Temp → Swell 2 → Wind → Fog → Waves`, reading
`window.__MARINE_SOURCE_PARITY__` after each 9-second settle.

Evidence: `evidence/causal-traces/local-parity-trace.json`, `local-parity-log.txt`.

### The trace

| step | clicked | `parity.status` | `activeLayer` | `heatmap.vectorCount` | `mismatchReasons` |
|---|---|---|---|---|---|
| 1 | Wind | `undefined` | — | — | HUD refuses: *"parity: status absent"* ✅ correct |
| 2 | Waves | `UNSAMPLED` | waves | 0 | null ✅ correct |
| 3 | Wind | **MISMATCH** | wind | 0 | `layer: heatmap=waves infobox=wind` |
| 4 | Swell | **MISMATCH** | swell_1 | 0 | `layer: heatmap=waves infobox=swell_1` |
| 5 | Water Temp | **MISMATCH** | water_temp | 0 | `layer: heatmap=swell_1 infobox=water_temp` |
| 6 | Swell 2 | `UNSAMPLED` | swell_2 | 0 | null |
| **7** | **Wind** | **MISMATCH** | **wind** | **15023** | `layer: heatmap=swell_2 infobox=wind` — **`unsampled: null`** |
| 8 | Fog | **MISMATCH** | fog | 15023 | `layer: heatmap=swell_2 infobox=fog` |
| **9** | **Waves** | **`NOT_APPLICABLE`** | waves | 15023 | **`null`** — **but the HUD still displays the mismatch** |

### Discriminator — is the renderer wrong, or the instrument?

Step 7 is decisive for the first half: `vectorCount = 15023`, `waveData = true`,
`unsampledReasons = null`. **This is a fully populated field and every one of the instrument's
own refusal guards passed** — so it is a *real* comparison by the instrument's own rules, not
dead metadata.

But the **renderer is correct**. Pixel decoding across 4 layers × 5 cameras
(`evidence/paint-control-local-fb50fa6d.json`) gives a distinct palette per layer:

| layer | mean RGB of the ocean crop |
|---|---|
| Wind | `[34, 55, 71]` |
| Waves | `[43, 58, 72]` |
| Swell | `[31, 70, 74]` |
| Water Temp | `[63, 60, 50]` |

**The drawn variable matches the active layer.** The marine engine *retains* its last marine
field while a non-marine layer displays — which is architecturally normal — and does not draw it.

### Root cause

`frontend/src/components/map/forecastDiagnostics.js:334`

```js
if (heatmapLayer !== 'unknown' && heatmapLayer !== activeLayer)
  mismatches.push(`layer: heatmap=${heatmapLayer} infobox=${activeLayer}`);
```

The comparison is guarded for an **uninitialised** heatmap (`heatmapUninitialised`) but **not
for the case where the marine heatmap is not the active renderer at all**. There is no third
guard, so the normal condition "a marine field is resident while a raster/particle layer is
displayed" is graded as a violation.

### This is the third iteration of the same shape at the same site

The file's own comment block documents the first two:

1. **A false PASS** — `match: mismatches.length === 0` encoded "nothing was comparable" as
   success. *"Measured live on production: heatmap.vectorCount 0 + infobox.status 'idle' +
   productId null ⇒ `match: true`"* — fixed 2026-08-11 (audit 11.2 / RC-02).
2. **An over-firing UNSAMPLED** — the three-valued gate fired in the resting state; scoped to
   `NOT_APPLICABLE` the same day.

The code even states the principle it has now violated a third time: *"both report a verdict
about a comparison that never happened."*

### Second, independent defect in the same packet

At step 9 the **computed** state is `status = NOT_APPLICABLE`, `mismatchReasons = null`, while
the **rendered HUD** still shows `⚠️ SOURCE-PARITY-MISMATCH layer: heatmap=swell_2
infobox=waves`. **The display and the computation disagree.**

That is a *fabricated status surface* — the exact class WS-CAN-0010 and WS-CAN-0063 were closed
for at `69ac3ddb` ("the last two fabricated status surfaces"). Most likely the HUD renders a
React-state snapshot that is not re-rendered when the window object updates; that hypothesis was
**not** confirmed and is recorded as a hypothesis.

### Blast radius

`frontend/src/__tests__/truthOverlayGate.test.js` documents the design explicitly:

> *"The RENDER is gated; the truth-violation POST telemetry effect inside the component is NOT —
> `/api/weather/client-diagnostics` is a real, tested backend route consuming those reports, so
> production keeps reporting while showing nothing."*

**Production emits up to 87 fabricated violations per session to a live endpoint, and no user or
operator sees the surface that would reveal them as fabricated.**

### Falsification attempted — **DID NOT EXECUTE**

An ablation setting `visibility: 'none'` on every custom layer was attempted; the map handle was
lost inside the probe and `hiddenIds` returned `null`. **Reported as not-performed.** (The
project's own record also warns that `visibility:'none'` is silently reverted on `OceanMask`
(`OceanMask.js:658`), so opacity would be the correct lever if repeated.) The surviving
discriminator is the pixel-palette comparison above.

---

# PACKET 4 — the served marine grid is 2° at every zoom from 5 to 12

| | |
|---|---|
| **Finding ID** | 13.1-F4 |
| **Classification** | **Confirmed** (deployed build, 20-cell sweep, HUD disabled per the repo's own probe contract) |
| **Severity** | **HIGH** (scientific meaning) |

### Reproduction

`evidence/resprobe.js` against `https://dev--rawsurf.netlify.app` (`568fc2c6`), with
`localStorage.__RAW_DIAG__ = '0'` — the contract `truthOverlayGate.test.js` documents as
required for pixel probes ("a HUD inside the screenshot crop biases every pixel metric").

### Result — deployed build

| camera | z5 | z7 | z8 | z9 | z10 | z12 |
|---|---|---|---|---|---|---|
| Cocoa FL | — | **223 km (2°)** | **223 km (2°)** | **223 km (2°)** | **223 km (2°)** | **223 km (2°)** |
| Madeira | **223 km (2°)** | **223 km (2°)** | **223 km (2°)** | **223 km (2°)** | **223 km (2°)** | — |

`Simplified wave layer — reduced graphics mode` active in most cells. `grid_series` **200** in
every window.

### Result — local control, 20 layer × camera cells

`Class: COARSE 2° GRID` in **18 of 20**, **including z11**. Provider resolves to `NOAA` for
waves and swell; **`UNKNOWN` for wind and water temp**.

### At z12 one grid cell covers roughly forty times the entire visible viewport.

### The upstream is healthy — checked directly, not assumed

| probe | result |
|---|---|
| `HEAD …/ncep_gfswave025/…/2026-08-18T1800.om` | **200** |
| `GET` with `Range: 0-63` | **206** (Range supported) |
| `GET …/ncep_gfswave025/latest.json` | **200**, 5,332 bytes, `"completed": true` |

The `.om` product **is** requested — 15 times at Cocoa z9 — and the disclosed served resolution
stays 2°.

### Competing explanation, and the honest limit of this packet

The observed client-side aborts (`signal is aborted without reason. Falling back cleanly.`) are
**consistent with correct stale-request cancellation** on a Range-chunked reader that is
superseded when the camera moves. **This audit does not claim they are pathological**, and does
not claim to have identified *why* the fine product does not become the served product.

What is established is narrower and sufficient for the trajectory verdict: **the resolution the
user is served is 2° at every zoom measured, on the deployed build**, and **the 61-commit halo
campaign (48% of the window) is a rendering investigation downstream of a 223 km interpolated
cell.**

### Recorded so the audit does not over-credit the window

`servedResolutionNotice.js` (`b8560c74`, `071e478d`, both 2026-08-11) **predates the baseline**.
The disclosure machinery is inherited, working, and should be **preserved** — it is not progress
in this window. Its own docstring records two measured tiers (0.25° → 28 km "silent";
15.455° → 1,700 km "notice"); **the 2° tier measured here is a third tier absent from that
table**, which is new information relative to the file's own 2026-08-11 measurement.

---

# PACKET 5 — `layerSwitch × modelSwitch` is super-additive

| | |
|---|---|
| **Finding ID** | 13.1-F7 |
| **Classification** | **Confirmed** (four-term interaction protocol, zero-noise baseline) |
| **Severity** | **MEDIUM** (resource lifecycle) |

### Method

`I(i,j) = f(x+Δi+Δj) − f(x+Δi) − f(x+Δj) + f(x)`, with **each of the four terms measured from an
independently re-established baseline**. Baseline noise spread over 4 identical repeats:
textures **0**, buffers **0**, layers **0**, RAF sites **0**, workers **0**, GL contexts **0**,
intervals **0**, programs **0**.

### Result

| | textures | buffers |
|---|---|---|
| Δ(layer wind→waves) alone | **−70** | **−841** |
| Δ(model GFS→EURO) alone | 0 | 0 |
| Δ(both, in that order) | **+14** | **+83** |
| **residual `I`** | **+84** | **+924** |

### Reading

A layer switch alone performs a **large teardown**. A model switch alone moves nothing.
**Doing both suppresses the teardown entirely and allocates instead.** The combined path is not
the sum of its parts — it is a different code path.

### Companion result — a state owner created only in combination

`layerSwitch × mapMove`: Δ(layer) intervals `0`, Δ(pan) intervals `0`, **Δ(both) `+1`**,
residual **`I = +1`**. A live `setInterval` exists only when the two inputs are combined.

### The contrast that makes these credible

Four other pairs are consistently **sub-additive** (`resize × zoom` I = −92/−800;
`layerSwitch × mapMove` −62/−710; `antimeridian × zoom` −52/−223; `zoom × layerSwitch`
−26/−17), and two pairs are **clean** (`modelSwitch × timeScrub` and `hidden × timeScrub`,
I ≈ 0 on every output). Against that spread, a **+924 buffer** residual is not noise.

### Required guardrail

A lifecycle test that performs layer-switch-then-model-switch and asserts the teardown still
occurs.

---

# PACKET 6 — the registers cannot see 48% of the work

| | |
|---|---|
| **Finding ID** | 13.1-F6 |
| **Classification** | **Confirmed** |
| **Severity** | **HIGH** (program control) |

### Evidence

- `madeira` and `island`: **0 hits** across `CURRENT_OBJECTIVE_REGISTER.csv`,
  `CURRENT_TASK_REGISTER.csv`, `COMPLETION_LEDGER_4.2.csv`.
- **Zero of the 42 commits since 2026-08-16** reference any `WS-OBJ` or `WS-CAN` id. The last
  that does is `fabb9fe8`, 2026-08-15.
- Only **7 of 40** objective rows carry a Program 13.0 Status; all 7 dated 2026-08-14.
- `CURRENT_ARCHITECTURE_AUTHORITY_MAP.md` last committed at `d8c866bd` — **the Program 13.0
  start commit** — while its header asserts it describes HEAD. 126 commits have landed since,
  touching 40 `frontend/src` files **including the renderers, OceanMask, and the shaders it
  explicitly declares untouched.**
- **2 dangling references:** WS-OBJ-401 cites `WS-CAN-0069` ("the second renderer") and
  `WS-CAN-0068` ("the 261 overrides"). **Neither id exists in any register.**
- **5 silent drops by omission** from the 12.2 delta — most sharply **WS-OBJ-705**, which 12.2
  ⛔REOPENED on 17 flaky results and which the current register still reads as *"Fully Delivered
  / CERTIFIED — preserve."* No cell was edited; the reopening was simply never ingested. **A
  reclassification by omission.**
- **6 broken objective↔task links** — six tasks point up at an objective and **not one** of those
  objectives' *Canonical Task IDs* cells was updated to point back.

### Root cause

The program's control files are updated **by a mission**, and the halo campaign was never
constituted as a mission. With no mission, there is no register write, and the work becomes
invisible to every downstream reader — including the next audit.

### Consequence

`MISSION_HISTORY.md` contains exactly **2** closure certificates. The four that Audit 12.2
demanded (WS-OBJ-101, 203, 503, 506) were never written. **The objective register cites zero
evidence file paths** — every objective-level closure claim rests on a commit hash, a
certificate, or a test filename.

*(Every evidence path that IS cited resolves: 12 checked, 12 exist, 0 missing. The defect is
omission, not fabrication.)*
