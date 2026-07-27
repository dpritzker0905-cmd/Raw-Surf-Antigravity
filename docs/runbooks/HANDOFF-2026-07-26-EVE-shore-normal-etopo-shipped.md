# HANDOFF 2026-07-26 (eve, Opus 5) — ROOT A IS FIXED: shore normal now comes from 463 m, not 194.6 km

**Continues `HANDOFF-2026-07-26-OPUS5-accuracy-arc-and-measurement-revival.md` (its ranked item #1).
5 commits + 1 CI-built asset, all pushed to `dev`. Asset live at 774/1516 spots.**

Read [[standing-work-rules-user-mandate]] first. Every number below was measured. Two claims that
looked settled were **wrong and are corrected here** — §4.

---

## 1. THE ONE-PARAGRAPH STATE

The previous session proved that `bathymetry.shore_normal_at()` decides which way a beach faces from
a **194.6 km** window, at ~0.30-0.39 rating points per degree of error. That is now fixed for
**774 of 1516 spots** using NOAA ETOPO 2022 15s (~463 m, CC0). It was not a matter of pointing the
old algorithm at finer data: at 463 m the old estimator is **noisier**, not better, and it needed two
corrections that only showed up under measurement. **25.8% of rating evaluations change LEVEL** —
the word the user reads.

---

## 2. WHAT SHIPPED

| commit | what |
|---|---|
| `5a48ad1e` | The fix: `shore_normal_fit` (pure estimator), `shore_normal_asset` (runtime lookup), `build_shore_normals.py`, the dispatch workflow, 29 tests. |
| `14a665b3` | Dropped the ~1.1 km window — 5×5 cells cannot fit a coastline. |
| `a3229d5c` | **Barrier islands faced the lagoon.** Depth-weighted the seaward sign test. |
| `ce9a0396` · `a770f352` | CI plumbing (see §5.4). |
| `230536e4` | The asset itself, built from production by GitHub Actions. |

Asset: `backend/services/weather_pipeline/data/shore_normals.json`, 21 KB, 774 entries.

### The measured result
```
spots in asset            774 / 1516  (51.1%)
had NO geometry before     18         (rating graded wind on speed alone)
angular change            p50 18.8°   mean 28.8°   >45°: 21.8%   >90°: 4.6%
rating change             p50  1.6    mean  8.2 pts   p90 25.7   max 74.4
LEVEL CHANGES             798 / 3096  = 25.8%      <-- the headline
```
(4 sea states × 774 spots, evaluated through the **real** `surf_rating` module with the sea state
held fixed so the only variable is the shore normal.)

---

## 3. ★ THE THREE THINGS THAT MADE IT WORK (none were obvious)

### (a) Resolution alone makes it WORSE — the estimator had to change
At 0.25° the land/ocean centroid is smooth because the window is enormous. At 463 m the split inside
a 1-3 km box is jagged and the centroid **jitters**: measured spread across window sizes at Pipeline
was 10.1° (centroid) vs 5.2° (coast-PCA), at Sunset 6.1° vs 2.9°. The shipped estimator fits the
**shoreline's** orientation by PCA and takes the seaward perpendicular, using the land→water vector
only for its SIGN — discarding the magnitude that causes the jitter.

### (b) ★ THE ESTIMATOR MEASURES ITS OWN CONFIDENCE, and that is the whole safety story
Each spot is fitted at 4 window sizes (1.7-5.0 km); the max pairwise disagreement is the confidence.
Validation against production — **every low-spread spot beats production outright, and both
high-spread spots are places where NO single bearing is correct**:

| spread | spot | prod (0.25°) | ETOPO | real truth | right |
|---|---|---|---|---|---|
| 0.9 | Sunset | 0.0 | 315.5 | ~335 NW | ETOPO |
| 2.3 | Pipeline | 0.0 | 308.8 | ~325 NW | ETOPO |
| 3.1 | Hossegor | 305.0 | 280.3 | ~275 W | ETOPO |
| 8.3 | Jeffreys Bay | 174.6 | 105.4 | ~110 ESE | ETOPO |
| 10.4 | Nusa Dua | 162.9 | 68.7 | ~110 E | ETOPO |
| 16.5 | Ocean Beach SF | 240.8 | 269.2 | 270 due W | ETOPO |
| **26.0** | Steamer Lane | 247.9 | 153.5 | ~180 S | **NEITHER** |
| **39.1** | Uluwatu | 162.5 | 308.4 | ~250 WSW | **NEITHER** |

`MAX_SPREAD_DEG=25` sits in the gap. Above it we emit **nothing** and the caller keeps the coarse
value — we never trade one wrong answer for another. This is why 49% of spots are *deliberately* not
in the asset.

### (c) ★ BARRIER ISLANDS FACED THE LAGOON — and the gate could not see it
The first shipped asset gave Waves/Salvo/Avon Pier on the Outer Banks **273.7-289.6° (due WEST, into
Pamlico Sound)**. They face east. Waves reported a spread of **4.5°** — maximum confidence, totally
wrong. Root, straight off the raster: a ±5 km window holds **210 water cells on each side**, sound at
mean **0.9 m** west, Atlantic at **11.1 m** east. With the counts tied, an unweighted centroid is a
coin flip and it landed on the lagoon.

Fix: **weight each water cell by its depth** in the sign test — swell arrives from deep water, not a
1 m sound. The PCA axis was never wrong (both shores of a barrier island run parallel); only the sign
was. After: Salvo 104.9, Avon Pier 109.6, and Waves now *rejected* because the residual disagreement
surfaces honestly as a 177° spread instead of hiding behind a confident 4.5°. **All eight validated
spots stayed bit-identical.**

---

## 3b. ★ INDEPENDENTLY VALIDATED (added after shipping — the asset was checked, not assumed)

Everything in §3 was validated against *my own reading* of coastline geography, and I got that wrong
twice today. So the shipped bearings were re-checked against an instrument sharing **no assumption**
with ETOPO: **OSM coastline ways**, which are hand-digitised vectors drawn with **land on the left,
water on the right** — so the seaward normal is `segment bearing + 90°`, with no elevation, no depth,
no raster. (Validation only. Nothing OSM-derived is written into the asset — ODbL is share-alike.)

```
n = 90 sampled shipped spots      median 6.4°   mean 14.1°   p90 26.6°
                                  within 15°: 70%    within 30°: 91%
gate predicts truth:  spread <=10° -> median error 5.4°   |   spread >10° -> 7.6°
```
The gate's own confidence **monotonically predicts real-world error**, which is the property it was
assumed to have and had never been tested for.

⚠️ **The first pass of this validation was itself wrong, and its failure mode is instructive.**
Averaging every OSM segment within 3 km made the **two shores of an island or spit cancel** — their
normals oppose — producing a meaningless residual and 7 apparent "worst disagreements". Using the
nearest-shore cluster instead: Outer Banks 86°→**1°**, Cuba 104°→**5°**, Maldives 118°→**13°**,
Dingle 62°→**7°**, Pensacola 52°→**8°**, SW Florida 46°→**5°**. **Six of the seven were the
validator's bug, not the asset's** — and it is the *same* structural trap that depth weighting
already fixes in ETOPO (§3c). Only one genuine disagreement survived (Chile, 41°).

### LIVE, in production
| check | result | proves |
|---|---|---|
| `/point` Hossegor | **279.8** (coarse would be 304.99) | asset is serving |
| `/point` Uluwatu (gate-rejected) | `162.474…` — the exact coarse float | **fallback is safe** |
| `/point` Salvo OBX | 104.9 (east) | barrier-island fix is live |
| `/point` Pipeline | **325.0**, not the asset's 309.0 | **hand overrides still outrank** |

⚠️ Two independent instruments (ETOPO raster and OSM vectors) put Pipeline at **304-309°**, while the
hand override says **325°**. The override was tuned to match one Surfline reading on one day. It
still wins by design, but it is worth revisiting.

## 4. ⚠️ TWO PUBLISHED CLAIMS CORRECTED

1. **"~31% of spots misplaced ⇒ ~465 of 1516" is an OVERCOUNT.** That came from elevation banding,
   which condemns clifftop breaks: Uluwatu reads **+34.3 m** yet is **0.29 km** from the water — a
   clifftop, correctly placed. Measured at full scale with distance-to-nearest-shoreline instead:
   **63 spots have no shoreline within ±5 km (definitively misplaced)** and **95 more are 3-5 km out**
   ⇒ **158 actionable spots (10.4%)**, not ~465. Worst: El Socorro (Tenerife) **+1020 m**, Tarimbang
   (Sumba) +946 m, Reggae Falls +678 m, Medewi (West Bali) +471 m, Pohnpei P-Pass +414 m.
2. **Root A and Root B interact, and the earlier analysis had them as independent.** At 194 km a
   misplaced coordinate is invisible; at 463 m it dominates. So the builder gates on shoreline
   distance too, and the placement review is now a by-product of the same fetch.

---

## 5. ⚠️ INSTRUMENTS THAT LIED (again)

1. **A confident spread is not a correct answer.** Waves: 4.5° spread, 180° wrong. The gate measures
   *self-consistency*, which cannot detect a systematically wrong sign. Only the raster caught it —
   **dump the ASCII map before trusting a bearing you find surprising.**
2. **MAX-pairwise is poisoned by one bad window.** Flagler Beach Pier: `[161, 64, 63, 67, 67]` — four
   windows inside 4°, one 5×5-cell outlier forcing 98° and disqualifying the spot.
3. **My own geographic recall was wrong twice.** I asserted Uluwatu faces SW and that Bingin's NW
   bearing looked wrong; the raster showed the estimator was reading the terrain faithfully both
   times. Same class as the prior session's "hand-mirror of the maths" lesson — **check the data, not
   your memory of the map.**
4. **`gh run watch` hid three CI failures in a row** that were all the same shape: `tests/conftest.py`
   imports the whole app stack at collection time (pytest_asyncio, then httpx, ...). Use
   `--noconftest` for standalone test files rather than chasing the dependency chain.
5. **Bare `python` on this box is still broken** — `AppData\Local\Python\bin\python3.exe` only.

---

## 6. WHAT TO DO NEXT (ranked)

1. **Nothing is required — this is live and safe.** Ratings update on the next `precompute.yml` cron
   (:45 past 3,7,11,...); it runs in GitHub Actions off the checkout, so it needs no Render deploy.
   The infobox `/point` lane needs the normal Render deploy from `dev`.
2. **The 158-spot placement list** (`shore-normal-build-review` artifact, sorted worst-first, columns
   `shoreline_km` + `front_depth_m`) → the owner's spot editor. Every spot fixed there also becomes
   eligible for a shore normal on the next asset rebuild. **Re-run the workflow after moving spots.**
3. **The 440 `ambiguous_coastline` spots** are the remaining headroom. They are genuinely bending
   coastlines; a per-spot hand-audited override (`surf_magnets.SHORE_NORMAL_OVERRIDES`, which still
   outranks the asset) is the correct escape hatch for famous breaks.
4. Unchanged from the prior handoff: let buoy calibration accumulate a week then fit a **quantile**
   correction; `RATING_LOCAL_SIZE=1` is still the owner's call; the marine items in its §5.
5. ⚠️ **`backend/tests/test_media_privacy_contracts.py` fails on `dev` and is NOT from this work**
   (reproduced with a clean stash). Child-safety media contract — a task chip was raised.

---

## 7. HOW TO REBUILD / KILL

```bash
gh workflow run "Build Shore Normal Asset" --ref dev     # ~3 min, commits the asset itself
```
Kill switches, in precedence order at the single call site in `point_resolution.py`:
`SURF_V3_NORMAL_OVERRIDES=0` (hand overrides) · `SHORE_NORMAL_ASSET=0` (this asset) · deleting the
JSON. All three degrade to today's coarse behaviour; **nothing here can make a rating worse than it
was.**
