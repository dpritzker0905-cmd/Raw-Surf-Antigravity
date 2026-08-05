# SCIENCE — the two owner questions, answered from primary literature + measurement
**2026-08-05 · Q: the Weggel slope · Q: `RATING_LOCAL_SIZE` · every claim cited or measured**

> **Both answers came out DIFFERENT from what the queue assumed.** The slope is not the defect —
> **`GAMMA_MAX_STEEP = 1.25` is**, and it is 54% above the highest value ever observed in the field.
> And local-size normalization is not a calibration choice — it is a **category error** that the
> surf-science literature does not use for quality at all.

---

## Q3 — THE BREAKER INDEX: what slope does Weggel actually need, and what is γ allowed to be?

### What we implement

`backend/services/weather_pipeline/surf_transform.py`

```python
GAMMA_MAX_STEEP = 1.25
center = 1.56 / (1.0 + math.exp(-19.5 * float(slope)))     # Weggel (1972) b(m)
_slope_proxy = depth_m / (shelf_width_km * 1000.0)          # <- a SHELF-scale quantity
cap = breaker_index(Tp_s, slope=_slope_proxy) * _cap_depth  # _cap_depth = nearshore break_depth_m
```

### FINDING 1 — the scale mismatch is already half-fixed, and the half that is left is the slope

`_cap_depth` was corrected to the **nearshore** `break_depth_m` (ETOPO 15s, ~463 m). The **slope**
feeding γ is still `depth_m / shelf_width` where `depth_m` is a **~139 km median**. So the live cap
is `γ(shelf-scale slope) × nearshore depth` — two different scales multiplied together.
`bathymetry.bed_slope_at` (0.1°, ~11 km, **bundled since 2026-06-29 and unused**) is the matching
nearshore partner.

### FINDING 2 — Weggel's `m` is a plane BEACH slope, and its validity range is 0.01 < m ≤ 0.07

Camenen & Larson [9] evaluated six breaker-depth-index formulas against **524 laboratory cases from
22 sources**: predictions are good for *gentle slopes* `0.01 < m ≤ 0.07` and **"typically not
satisfactory for breaking waves on steep slopes (m > 0.1)"**. Kaminsky & Kraus [3] built the
companion database — **416 points, 17 laboratory experiments, all plane slopes**.

**Measured against our own spots** (production `resolve_surf_geometry`):

| spot | live proxy m | `bed_slope_at` m | γ proxy | γ bed | in Weggel's range? |
|---|---|---|---|---|---|
| Pipeline | 0.0983 | 0.0301 | **1.250** | 1.043 | proxy edge / bed ok |
| Trestles | 0.0202 | 0.0667 | 0.972 | **1.250** | both ok |
| Nazaré | 0.0022 | **0.0606** | 0.837 | **1.234** | both ok (proxy 28× too flat at a canyon) |
| Teahupoo | 0.1169 | **0.1563** | 1.250 | 1.250 | **both OUT (m > 0.10)** |
| Uluwatu | 0.0651 | **0.1291** | 1.250 | 1.250 | **bed OUT** |
| Cocoa Beach | 0.0003 | 0.0012 | 0.823 | 0.830 | both ok |

⇒ Switching to the real asset **moves 11 of 60 spot/sea combinations (18.3%), worst +10.2%
(Trestles)**, and Pipeline **−3.6%** — not the +75% the queue expected. (That +75.4% was
slope-on vs slope-**off**, a different comparison; both are true, they answer different questions.)

### ⭐⭐⭐ FINDING 3 — THE REAL DEFECT: γ = 1.25 exceeds every field observation by 54%

Three independent primary sources, two of them **field** rather than laboratory:

* **Carini et al. [8]** — LIDAR + infrared at the USACE Duck FRF, **1,600+ breaking waves**,
  413 spilling / 111 plunging analysed wave-by-wave: **γ_plunging 0.73–0.81, γ_spilling 0.63–0.71.**
  Our ceiling of **1.25 is 54% above the highest field-observed plunging value.**
* **Goda [7]** — reanalysis of field + laboratory data: **"the incipient breaking height of the
  significant wave is about 30% lower than that of regular waves."** Weggel/Kaminsky's data are
  **regular-wave**; our chain feeds **Hs (significant)**. Applying a regular-wave index to Hs is a
  systematic over-prediction of roughly that size.
* **Chin [11]** — basin experiments, oblique incidence 15–30°: breaking initiates at **γ ≈ 0.67,
  "significantly less than that predicted from empirical relations based on normally incident
  waves"**, and *saturated* breaking at **γ ≈ 0.47**, independent of slope from 1:10 to 1:100.
  Most real spots take oblique swell.

⇒ **For a depth-limited cap applied to a SIGNIFICANT wave height, the defensible ceiling is
~0.8, not 1.25.** Even 0.85 is generous once Goda's −30% significant-wave correction is applied.

### FINDING 4 — γ and the H110 convention are ORTHOGONAL, not cancelling

The standing warning is that the height is "right by cancellation" and levers must move together.
**Measured 2×2** (feet, through production `estimate_surf`):

| case | γ 1.25→0.85 alone | H110 alone | both |
|---|---|---|---|
| 7 of 8 anchor/big cases | **0.0%** | **+27.0%** | +27.0% |
| Pipeline 12 m/18 s | **−32.0%** | **0.0%** | −32.0% |

They act on **disjoint sets**. γ only matters where the depth cap **binds**; H110 only matters where
it does **not**. The two never move the same case.
✅ The memory's "+25.5% if H110 flips alone" **replicates** here at +27.0% — that warning stands, for
H110 and its own partner. ⛔ **But γ is not that partner.** γ can be changed on its own.

⚠️ **Caveat, stated rather than hidden:** *in principle* γ and the convention are coupled — if H110
is ON, the capped quantity is H1/10, for which a **higher** γ is defensible (Goda [7]: H1/10 > Hs).
So the correct pairing is **(H110 off, γ≈0.8)** or **(H110 on, γ≈1.0)** — not a free choice of both.
The measurement shows they are decoupled *in effect today* because the cap binds so rarely.

### What production serves right now

**Pipeline, 12 m / 18 s offshore: 45.5 ft.** With a literature-defensible γ: **31.0 ft.**
The 45.5 ft number is the safety-critical regime, and it rests on a γ no field study supports.

---

## Q2 — `RATING_LOCAL_SIZE`: is normalizing to a spot's own climatology correct?

### The measurement (this session, read-only, `scripts/local_size_gonogo.py`)

```
VERDICT SANE · coverage 1773/1773 (100%) · A/B over 10,638 spot-hours
LEVEL unchanged 5987 / up 447 / DOWN 4204   =>  43.7% change, 9.4:1 DOWNWARD, median -3.5
```

### ⭐⭐⭐ THE ANSWER: the literature does not rate surf quality by local percentile. It rates it by ABSOLUTE, SKILL-STRATIFIED thresholds.

* **Boqué Ciurana et al. [3]** — the closest analogue that exists. They define **Surfing Days (SD)**
  and **Surfing Days Stratified by surfers' skill (SDS)**, applied to Somo with a 30-year hindcast
  downscaled to 100 m. The bands are **absolute wave conditions per skill level**: beginners peak in
  summer (18.1 d/month, July), intermediates in the transitional seasons (14.1 d/month, April),
  advanced and big-wave riders in winter (15.1 and **0.7** d/month, January).
  **The threshold is the surfer's ability, which is absolute — not the beach's percentile.**
* **Espejo et al. [1]** — a **global multivariable standardized index** from expert judgment,
  which concludes that west-facing low-to-mid-latitude coasts, especially in the Southern
  Hemisphere, are *better for surfing*. **A per-spot percentile normalization cannot express that
  sentence** — it makes every spot's distribution identical by construction and deletes exactly the
  between-spot signal Espejo measures.
* **Mesa [2]** — "Surfability: A Proposed Scale", a fixed 10-point scale field-tested over 24 months
  at Imperial Beach. Fixed, absolute, cross-comparable.

### Why this is a category error, not a calibration choice

`reference_size_m` enters the composite in **two multiplicative factors** (`size_score`,
`oversize_gate`) — i.e. it changes **the quality score itself**. The A/B's own examples show the
inversion:

```
São Lourenço  1.39 m  ->  fair  ->  poor        (local ref 2.06 m)
Fort De Soto  0.42 m  ->  poor  ->  fair_good   (local ref 0.40 m)
```

A **1.39 m** wave is rated *worse* than a **0.42 m** wave — a 3.3× physical inversion. On a map whose
entire purpose is choosing between spots, that is not a more pessimistic app; it is a **less
comparable** one. The 9.4:1 downward skew is a symptom of the category error, not a tuning offset.

### The defensible use of the same data

Local climatology is real and valuable — just not as a multiplier on quality:
1. **Rarity / notability** — "this is a big day *for here*" as a **separate** axis (this is what the
   `EPIC` percentile rung in the level ladder actually wants, and it needs ERA5).
2. **Skill-band labelling** — Boqué Ciurana's SDS: which ability level this spot suits today.
Both are **additional fields**, not a rescaling of the 0–100 score.

⇒ **RECOMMENDATION: do NOT flip `RATING_LOCAL_SIZE` as a score multiplier.** Keep the quality score
absolute and cross-comparable; spend the 1773/1773 climatology coverage on a separate
"big for this spot" signal and a skill band.

---

## SOURCES

[1] [Surfing wave climate variability](https://consensus.app/papers/details/f09c65c03cfb54db997035ae31d81b8d/?utm_source=claude_desktop) (Espejo et al., 2014, 24 citations, Global and Planetary Change)
[2] [Surfability: A Proposed Scale for Surfable Waves](https://consensus.app/papers/details/eb39c5073eb45f35b572c10729deac4b/?utm_source=claude_desktop) (Mesa, 2011)
[3] [Exploring the Climatic Potential of Somo's Surf Spot for Tourist Destination Management](https://consensus.app/papers/details/325d5d4a79315042b23f2cc5b2174581/?utm_source=claude_desktop) (Boqué Ciurana et al., 2022, 13 citations, Sustainability)
[7] [Reanalysis of Regular and Random Breaking Wave Statistics](https://consensus.app/papers/details/bddd40e5febb516993f0499da9cbf296/?utm_source=claude_desktop) (Goda, 2010, 156 citations, Coastal Engineering Journal)
[8] [Surf Zone Waves at the Onset of Breaking: 2. Predicting Breaking and Breaker Type](https://consensus.app/papers/details/6db0fd10f9d5579e98f49147468826fe/?utm_source=claude_desktop) (Carini et al., 2021, 12 citations, JGR)
[9] [Predictive Formulas for Breaker Depth Index and Breaker Type](https://consensus.app/papers/details/ac523ed615c95042a48c853c8cc0af21/?utm_source=claude_desktop) (Camenen & Larson, 2007, 62 citations)
[3b] [Evaluation of Depth-Limited Wave Breaking Criteria](https://consensus.app/papers/details/b162255fac3d5d58b8480ba4dc0d29f4/?utm_source=claude_desktop) (Kaminsky & Kraus, 1994, 75 citations)
[11] [Surf-zone dynamics derived from basin-scale experiments](https://consensus.app/papers/details/ccd7cbb5094152e6ba7729378eafb24b/?utm_source=claude_desktop) (Chin, 2022, Water Science and Engineering)
[12] [A modified breaker index formula for depth-induced wave breaking in spectral wave models](https://consensus.app/papers/details/5f5935fb025b5d4783c32339d3f47ec6/?utm_source=claude_desktop) (Chen et al., 2022, Ocean Engineering)

Measurement scripts: `scratchpad/slope_ab.py`, `scratchpad/gamma_cancel.py` (both read-only).
