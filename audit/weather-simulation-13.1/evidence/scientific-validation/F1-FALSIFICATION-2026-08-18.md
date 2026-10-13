# F1 FALSIFICATION — RUN AGAINST PRODUCTION, READ-ONLY

**2026-08-18 · backend `2.0.0-stage-6f-v1-568fc2c6` · `status: healthy` · `valid_time 2026-08-18T21:00:00Z`**

---

## Result: **F1 CONFIRMED. The finding does NOT downgrade.**

> **11 of 11** spots where the two candidate variables are distinguishable track **VHM0**
> (the `waves` layer's total offshore significant height).
> **0 of 11** track **VHM0_SW1** (the primary swell partition).
> Overstatement vs the swell partition: **min +25%, median +84.2%, max +300%** — **every one
> positive**, exactly as a total-vs-partition substitution predicts.

The mission's stop condition — *"if the two lanes agree within tolerance at every sampled spot,
stop and report; the finding downgrades to a naming defect"* — **is not met.**

---

## Method — no production configuration was changed

The mission contract's original design called for flipping `CONDITIONS_BATCH_PRECOMPUTED=0` on
the Render service. **That was not done**; no environment variable, setting, or configuration on
any service was modified. A read-only discriminator was used instead, and it is **stronger**:
rather than showing that two lanes *differ*, it identifies **which physical variable the
published number equals**.

| quantity | source | endpoint |
|---|---|---|
| `published` | what a client actually receives | `GET /api/conditions/batch?spot_ids=…&model=GFS` → `conditions[id].swell_height_ft` |
| **VHM0** | total offshore significant height (swell + wind sea) | `GET /api/weather/point?…&layer=waves` → `point.speed × 3.28084` |
| **VHM0_SW1** | primary swell partition | `GET /api/weather/point?…&layer=swell_1` → `point.speed × 3.28084` |

Sample: **20 spots across 5 regions** — Florida east coast, California, Portugal/Iberia, Hawaii,
New York/New Jersey. The contract required ≥10 spots across ≥3 regions.

**Which lane answered:** `conditions_source: {"source":"precomputed","precomputed":20,"live":0}`.
All 20 were served by the **frame lane** — the default-ON path under test.

---

## The discriminating subset

`VHM0` and `VHM0_SW1` are only separable where wind sea is non-negligible. Below is every spot
where the two candidates differ by **≥ 0.25 ft**, so a 0.1 ft-resolution published value can tell
them apart.

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

**11 / 11 → VHM0. 0 / 11 → VHM0_SW1.**

### Non-discriminating spots — reported, not hidden

Nine spots had `|VHM0 − VHM0_SW1| ≤ 0.2 ft` and the test **cannot** separate the candidates
there. These are groundswell-dominated coasts where the total *is* essentially the partition:

| spot | published | VHM0 | SW1 | gap |
|---|---|---|---|---|
| Vero Beach Pier | 1.0 | 1.0 | 0.8 | 0.2 |
| Mareta (PT) | 3.0 | 3.1 | 3.0 | 0.1 |
| Ericeira (PT) | 3.6 | 3.7 | 3.5 | 0.2 |
| Zambujeira do Mar (PT) | 2.7 | 2.8 | 2.7 | 0.1 |
| Alvor-Poente (PT) | 2.2 | 2.2 | 2.0 | 0.2 |
| Belmar 16th Ave | 1.6 | 1.6 | 1.7 | 0.1 |
| Long Beach | 2.1 | 2.1 | 2.0 | 0.1 |
| Long Beach Jetty | 2.1 | 2.1 | 2.0 | 0.1 |
| Gilgo Beach | 2.3 | 2.3 | 2.2 | 0.1 |

⚠️ **These are NOT evidence against the finding.** They are cases where the substitution is
harmless because the two quantities coincide. **The defect's magnitude is
sea-state-dependent, not location-dependent** — the same Portuguese spot will diverge the moment
a wind sea builds on top of the groundswell.

---

## Independent field-identity cross-check

`/api/weather/spot-ratings` exposes the frame's own `offshore_hs_m` per spot. For **20 of 20**
spots:

```
published swell_height_ft  ==  round(frame.offshore_hs_m × 3.28084, 1)
```

**Exact, every time.** This confirms — from the wire, not from the source — that the published
field *is* `offshore_hs_m`, which `spot_ratings.py:136` fills from
`getattr(marine.point, "speed", None)` under a `layer="waves"` resolve.

The static trace and the live measurement now agree on the same chain:

```
marine.point.speed (layer="waves", VHM0)
  → spot_ratings.py:136  offshore_h
  → spot_ratings.py:291  persisted as offshore_hs_m
  → conditions.py:75     published as "swell_height_ft"
```

---

## Alternative explanations, tested and rejected

| alternative | verdict |
|---|---|
| *"The two quantities are close enough to be within tolerance."* | **Rejected.** Median +84.2%, max +300% on the discriminating subset. |
| *"The divergence is noise, signed both ways."* | **Rejected.** All 11 discriminating deltas are **positive**. A total ≥ its own partition by construction, so the sign is structural. |
| *"The live lane would publish the same thing."* | **Not testable read-only** — but `spot_conditions.py:252,292,359` resolves `layer="swell_1"` and reads `swell_wave_height`, which is the `SW1` column measured above and which the published value does **not** match at 11 of 11 discriminating spots. |
| *"Only obscure spots are affected."* | **Rejected.** Ocean Beach SF, Fort Point, Backdoor and Laniakea are marquee breaks. |

---

## Worst observed case

**Rockpiles and Backdoor, Oahu — published `4.0 ft`, primary swell partition `1.0 ft`.**
A client reading `swell_height_ft` receives a number **4× the swell it names**, because it is
being handed the total sea state including local wind chop.

---

## Two further findings this run confirmed live

1. **`frame_offset_hours = 1.0` on every region.** A request for `valid_time 21:00:00Z` was
   answered by a frame whose `served_valid_time` is `22:00:00Z`. `/spot-ratings` **discloses**
   this per response; `/conditions/batch`'s frozen six-key per-spot payload **cannot**, and only
   the top-level `conditions_source` carries it. This is Audit 13.1 scientific drift item #4,
   now observed on production rather than inferred from code.
2. **The `/spot-ratings` and `/conditions/batch` frames are the same object** — both reported
   `source: "precomputed"`, `served_valid_time: 2026-08-18T22:00:00Z`. The defect is in the
   *publication mapping*, not in the frame.

---

## What this does NOT establish

- **It does not measure the live lane directly.** Every one of the 20 spots was answered by the
  frame. A true A/B needs `CONDITIONS_BATCH_PRECOMPUTED=0`, which requires a production
  configuration change and was deliberately not made.
- **It does not establish user impact** — no measurement was taken of how many clients read
  `swell_height_ft`, or what they do with it.
- **It is a single valid_time** (`2026-08-18T21:00:00Z`). The magnitudes are one sea state; the
  *identity* (published = VHM0) is structural and does not depend on the hour.

---

## Consequence for Mission 13.1-C1

**Stop condition 1 is NOT triggered. The mission proceeds as written**, and F1 stays
**CRITICAL**:

- **T1** (meaning test) and **T2** (provenance test) must be written and watched failing at
  `568fc2c6`. This run supplies their expected values — e.g. Ponce Inlet should publish
  **1.2 ft**, not 1.5; Rockpiles **1.0 ft**, not 4.0.
- The repair must make the frame lane publish the **primary swell partition**, or **omit** the
  field. **Renaming the field to legitimise the current value is explicitly rejected** — the
  live lane's meaning is the established contract.

---

## Reproduce

```bash
node audit/weather-simulation-13.1/evidence/f1falsify.js
```

Raw data: `F1-falsification-production.json` (20 rows, every intermediate value, product ids and
run times retained). Harness archived beside it. **No credential, token or signed URL appears in
either artefact.**
