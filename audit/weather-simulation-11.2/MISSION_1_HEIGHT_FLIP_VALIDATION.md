# MISSION 1 — VALIDATING THE HEIGHT FLIP AGAINST THE LANE THAT IS SCORED

**Question (Audit 11.2 §4, §9):** `679da3d9` flips `__RAW_NEARSHORE_RENORM__` ON, changing the
**default** map display by a median 3×. Proven internally consistent; **never checked for accuracy**,
because no buoy scores the tile sampler.

**Answer: ON is closer to the scored lane by a factor of ~645, and the flip should stand.**

**No production code was modified.** The harness was run from `frontend/src` and then removed; it
is preserved here as evidence.

---

## 1. The design — why this test can answer the question

The backend point lane (`/api/weather/point` → `point.speed`) reads **the same offshore wave-height
field from the same regional product** as the tile sampler, interpolated, with **no land decay and
no renormalisation**. It is also the lane whose forecasts are scored against real buoys by the
Forecast Accuracy Monitor (`raw_surf` height MAE 0.202 m at +24 h, paired).

So at identical coordinates: **whichever flag state puts the tile sampler closer to the point lane
inherits that buoy validation.**

*(Both sides are the offshore Hs field — which is what buoys measure and what the monitor scores.
Per `CLAUDE.md`, that quantity must never be rendered **as** the surf height; here it is used only
as the like-for-like reference for a sampler reading the same field.)*

---

## 2. The data — real production, not a fixture

| | |
|---|---|
| grid | `/api/weather/grid` GFS/marine/waves, bbox `-85,24,-79,31`, **25 × 29 = 725 cells** |
| product | `gfs_marine_waves_florida_east_coast_20260811T060000Z.json` |
| land/zero cells | **204 (28 %)** — the nearshore case the decay was aimed at |
| spots | **130** real surf spots inside the bbox (of 1,773) |
| point lane | answered for **130/130** |

---

## 3. ⚠️ The control that had to pass first

The sampler indexes rows **north-first** (`ty = (1 − (lat − south)/span) × (rows−1)`); the
normalizer emits vectors **south→north**. Getting that backwards yields a mirrored field that still
produces plausible-looking numbers.

```
ORIENTATION CONTROL   mean |sampler − grid|
   north-first   0.0104 m      <- 9x better
   south-first   0.0954 m
```

The verdict below was gated on this passing. It is asserted in the harness, not merely inspected.

---

## 4. The result

```
=== 130 spots with a point-lane value, grid 25x29 ===
  sampler returned NULL   : 0
  sampler returned <= 0   : 0
  usable rows             : 130
  movers (ON != OFF)      : 103/130
  ratio ON/OFF            : p50 2.92x   p90 4.52x   max 10.68x

  |tile - point| (m)        ON        OFF
    mean                  0.0004    0.2579
    p50                   0.0001    0.3129
    p90                   0.0007    0.4781

  spots where ON is closer : 105/130 (81%)
```

> **ON reproduces the scored lane to ~0.4 mm mean error. OFF is out by 0.26 m mean, 0.31 m median.**

### Independent corroboration of their A/B
Their measurement (93 spots): movers 86 %, ratio **p50 3.00× / max 10.68×**.
Mine (130 spots, different set, different hour): movers 79 %, ratio **p50 2.92× / max 10.68×**.
**The max agrees to the decimal and the median to 0.08×** — two independent samples of the same
effect.

---

## 5. Why the ON error is ~zero, and why that is the point rather than a red flag

0.4 mm is suspiciously exact — and it should be. With the renormalisation ON, the tile sampler is
doing **precisely what the backend does**: bilinear interpolation of the same grid with land cells
excluded and the weights renormalised. The near-zero residual is not a coincidence; it is the
definition of the two lanes having become one computation.

That is the strongest available form of the result: the flip does not merely *improve* the tile
lane, it **collapses it onto the backend lane** — which is exactly what `CLAUDE.md`'s ONE FORECAST
COMPOSITION mandate requires, and what the old decay was violating by acting as a second,
client-side forecast path.

**The 19 % where OFF is nearer** are non-movers and near-ties; with a 645× difference in mean error
they carry no weight against the direction.

---

## 6. Verdict

| claim | status |
|---|---|
| The flip is internally consistent | **Confirmed** (theirs, and reproduced) |
| The flip moves the tile lane **toward** the buoy-scored lane | **PROVEN** — 0.0004 m vs 0.2579 m |
| The tile lane now inherits the point lane's buoy validation | **Yes**, to the extent the two are now the same computation |
| The old decay was a second forecast path | **Confirmed** — removing it is what produced the collapse |

> ### ✅ **KEEP THE FLIP. `__RAW_NEARSHORE_RENORM__` should stay ON.**
> Audit 11.2 rated this the largest open exposure on the grounds that a 3× change to the default
> display had no observational check. **It has one now, and it clears.** The 11.2 risk table entry
> and Gate B should be updated.

### What this still does not prove
The offshore Hs field itself is only as good as GFS — and the paired census says **Open-Meteo beats
our lane at every lead**. This mission proves the tile lane agrees with our scored lane; it does not
make our lane the best available. That remains the standing target (`1140b3e4`'s same-model
control).

---

## 7. Harness bugs caught before they produced an answer

1. **The sampler returns `{value, direction}`, not a number.** My `typeof v === 'number'` filter
   rejected all 130 rows. Caught by the `expect(rows_.length).toBeGreaterThan(30)` guard — without
   it the run would have reported an empty, confident-looking result.
2. **`baseline -> null` while `all cells = 2.0 -> {value: 2}`** looked like a harness fault and was
   not: the sampler genuinely returns **null when all four corners are land**. Real behaviour,
   diagnosed rather than patched around.
3. A Node/babel harness was abandoned after the transpile chased four levels of imports into
   `maplibre-gl`; jest already resolves the real module graph. Recorded because the cheap path was
   the second one tried.

★ Every one of these was caught by a precondition assertion, not by inspection. **A measurement
harness needs its own controls as much as the thing it measures** — the theme of both audits, and
it applied to this one too.

---

## 8. Reproduce

```bash
python audit/weather-simulation-11.2/evidence/forensics/M1_fetch_height_flip_fixture.py
cp audit/weather-simulation-11.2/evidence/forensics/M1_height_flip_validation.test.js \
   frontend/src/components/map/zzM1.test.js
cd frontend && CI=true npx react-scripts test --watchAll=false --testPathPattern=zzM1
rm frontend/src/components/map/zzM1.test.js
```
