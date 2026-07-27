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
| `d5b0f4bb`* | Cache sized from measurement (~30 MB → ~3 MB, see §5.6). |
| `6b1a4ecb`* | **The gate was measured wrong** — 25 → 40, +176 spots (§3b). |

\* see `git log` for exact hashes. Asset: `backend/services/weather_pipeline/data/shore_normals.json`,
**950 entries**.

### The measured result
```
spots in asset            950 / 1516  (62.7%)      gate 40° spread, 3 km shoreline
had NO geometry before     23         (rating graded wind on speed alone)
angular change            p50 20.4°   mean 31.0°   >45°: 23.8%   >90°: 5.6%
rating change             p50  1.9    mean  8.8 pts   p90 28.1   max 74.4
LEVEL CHANGES            1043 / 3800  = 27.4%      <-- the headline
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

### (b) ★ THE ESTIMATOR MEASURES ITS OWN CONFIDENCE — but I read that confidence WRONG at first
Each spot is fitted at 4 window sizes (1.7-5.0 km); the max pairwise disagreement is the confidence.
I first set `MAX_SPREAD_DEG=25` believing a high spread meant **no single bearing is correct**, and
published Steamer Lane and Uluwatu as cases where NEITHER source was right. **That was wrong**, and
OSM (§3b) shows they were the two biggest ETOPO wins in the whole set:

| spread | spot | prod (0.25°) | ETOPO | OSM (independent) | ETOPO err | coarse err |
|---|---|---|---|---|---|---|
| 2.3 | Pipeline | 0.0 | 308.8 | 304.3 | 4.5° | ~55° |
| 3.1 | Hossegor | 305.0 | 280.3 | 276.8 | 3.5° | 28.2° |
| 8.3 | Jeffreys Bay | 174.6 | 105.4 | 99.0 | 6.4° | 75.6° |
| 10.4 | Nusa Dua | 162.9 | 68.7 | 59.9 | 8.8° | 103.0° |
| 16.5 | Ocean Beach SF | 240.8 | 269.2 | 270.0 | 0.8° | 29.2° |
| **26.0** | Steamer Lane | 247.9 | 153.5 | 143.0 | **10.5°** | **105.0°** |
| **39.1** | Uluwatu | 162.5 | 308.4 | 318.6 | **10.2°** | **156.2°** |

A high spread means the bearing is scale-DEPENDENT, not that the circular mean is bad. Measured
across the 440 gate-rejected spots:

| spread band | n | ETOPO err | coarse err | ETOPO closer |
|---|---|---|---|---|
| **25-40°** | 17 | **31.9°** | **63.1°** | **76%** |
| 40-60° | 7 | 25.6° | 20.0° | 14% |
| 60-120° | 7 | 44.4° | 30.8° | 43% |

So the gate was costing accuracy on **176 spots**. `MAX_SPREAD_DEG` is now **40** — measured, not
guessed. Above it we emit **nothing** and the caller keeps the coarse value. Coverage **950/1516
(62.7%)**; the remaining 37% are *deliberately* absent.

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
| `/point` a point with no asset entry | `162.474…` — the exact coarse float | **fallback is safe** |
| `/point` Salvo OBX | 104.9 (east) | barrier-island fix is live |
| `/point` Pipeline | **325.0**, not the asset's 309.0 | **hand overrides still outrank** |
| `/point` Uluwatu (DB coords) | **273.9**, was 162.5 pointing *inland* | gate-40 spots are live |
| `/spot-ratings` Impossibles | live **5.6** == asset recompute **5.7** (coarse would be 25.0) | **precompute uses the asset** |
| `/spot-ratings` gate-rejected Bali spots | live 24.9 == coarse recompute 25.0 | fallback holds in precompute too |

⚠️ **Watch the coordinates.** I spent much of the session testing "Uluwatu" at -8.815/115.088, a
point I wrote down from memory. The catalog's Uluwatu is 1.6 km away at -8.829/115.085 and fits to
**273.9°, not 308.4°**. The science is unaffected (the estimator was validated at real locations),
but it is a live demonstration of §4.2: at 463 m, 1.6 km of placement error moves the answer 35°.

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
3. ★ **My own geographic recall was wrong THREE times, and it cost a shipped threshold.** I asserted
   Uluwatu faces ~250 SW, Steamer Lane ~180 S, and that Bingin's NW bearing looked wrong. OSM says
   Uluwatu 318.6 and Steamer Lane 143.0 — ETOPO was within ~10° of both. Because I trusted my recall
   over the data, I built a gate that excluded 176 spots for no reason. **Never let recall of a
   coastline be the truth column; get an independent instrument.**
6. **A cache size copied from a neighbour is not a measurement.** `maxsize=200_000` copied from the
   bathymetry helpers would hold ~30 MB to save 2.5 µs on a 13 µs lookup — on a 512 MB box with a
   documented OOM history. Now 20_000 (~3 MB measured).
7. **`gh run watch` and `sleep` chains are not how to wait here** — use `until <condition>; do sleep;
   done`, backgrounded.
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
3. **The remaining 566 unaccepted spots** split into: spread >40° (measured NOT to beat the coarse
   value — leave them), `too_few_windows`/`no_shoreline_in_window` (these are mostly the misplaced
   spots from item 2 — fixing placement converts them). A hand-audited override
   (`surf_magnets.SHORE_NORMAL_OVERRIDES`, which still outranks the asset) is the escape hatch for
   famous breaks. ⚠️ Do NOT raise the gate past 40 without new evidence — it was measured.
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

---

## 8. ★★★ ADDENDUM 2026-07-27 — THE NEXT JACOBIAN, AND A PRIORITY INVERSION

Measured after shipping §1-7. Two of this handoff's own "what to do next" items are **demoted by
measurement**, and the real binding constraint is named.

### (a) THE ROOT: three of four per-spot inputs are STILL on 28 km data
The nearshore transform differentiates spots inside one 28 km marine cell using four bathymetric
inputs. This session fixed exactly one of them.

| input | window | feeds |
|---|---|---|
| `shore_normal_at` | ~~194 km~~ → **463 m** | wind + swell exposure — **FIXED (§2)** |
| `shelf_depth_at` | **139 km** (5×5 median) | **surf HEIGHT** (shoaling) |
| `shelf_width_km` | **search to 222 km** | **surf HEIGHT** (bottom friction) |
| `is_coastal` | 194 km | whether surf exists at all |
| `bed_slope_at` | 11 km | breaker type (Iribarren) |

**Cowell's and Steamer Lane are 1.9 km apart and receive BYTE-IDENTICAL values** — depth `452.0`,
shelf_width `27.8`, coastal `True`, slope `0.0067`. On ETOPO 2022 15s their nearshore depths are
**8.5 m and 13.4 m** (Pleasure Point 13.2 m), correctly separating a shallow sheltered beach from a
deeper point. **452 m is the median across the Monterey Canyon** — the shoaling maths is off by
~40× for a wave breaking in 10 m of water.

⇒ **This is the binding constraint on per-spot surf height**, and the fix is the pattern already
shipped here: ETOPO 15s → per-spot asset → confidence gate → CI builder → kill switch.
⚠️ **Bigger blast radius than the shore normal** — it moves surf HEIGHT for every spot, so it needs
a flag plus a measured A/B, not a straight swap.

### (b) PLACEMENT IS WORTH FAR LESS THAN THE COUNTS SUGGEST
Priced 25 proposed moves (~2.9 km each) against live production:
**|surf height change| median 0.00 m** · **|rating change| median 0.1 pts** · **gained a shore
normal 0/25** · level changed 3/25. **A 2.9 km move cannot leave a 28 km cell**, so placement's
value is geometric (letting spots into the shore-normal asset), not forecast-sampling. The three
material movers were all spots whose SHORE NORMAL changed. Item §6.2 is real but low-yield — do not
over-invest.

### (c) RATING_LOCAL_SIZE — do NOT flip (item §6.4 answered)
`rating_score = sg·ex·sc·tf·bt·wg·(…)` and **nothing penalises a spot for being OVERSIZED**
(`size_score` saturates at 1.0, never falls). `sg` is purely multiplicative so the effect is exact:
at every plausible reference pair **a beginner beach (Cowell's) outranks the point break (Steamer
Lane)** on an 8 ft day — 55.9 `fair` vs 36.1 `poor_fair`. That contradicts the flag's own recorded
intent ("keep small-wave spots honest, NOT lift them"). Also **862 spots (57%) sit at size gate
1.0**; the multiplier at a spot's own good-day size is **0.60** (a 40% cut) while small spots get
**1.20**. The user's anchors stay green because they pin each spot class IN ISOLATION — nothing
pins **relative ordering between classes on the same swell**. Needs an oversize rolloff first.
⚠️ The motivating symptom ("29 CA spots epic at once") **no longer reproduces**: only 15 spots
(1.0%) now score ≥95, median 27.5. The earlier rating arc fixed it.
⚠️ Coverage is genuinely unreadable without admin — `weather-products` is private and the anon
policy covers `latest.json` ONLY (verified HTTP 400). Use
`GET /api/admin/surf-forecast/status` for the authoritative `spots_tracked`/`spots_ready`.

### (d) COORDINATE SOURCES — what is usable
**OSM/Nominatim = ODbL share-alike, REFUSED** (would make `surf_spots` a derivative database).
**Wikidata = CC0** ✓ but 2/12 coverage. **GeoNames = CC BY** ✓ (username `RAWSURF`; needs BOTH
email confirmation AND "enable free web services") — **5/12 raw, ~2-3 trustworthy**: it returned
Tarimbang **118 km away** (name collision), a *lagoon* for Okanda, a bay centroid in **58 m of
water** for Lavanono. Needs ≤40 km radius + feature-code weighting + ETOPO cross-check.
**Surfline = ToS prohibits scraping — declined.**

### (e) THE CORRECTION MECHANISM EXISTS AND IS STARVING
`spot_refinements` (propose→review→approve) = **1 row**; `spot_verifications` = 2; `spot_edit_logs`
already carries `was_on_land` + `override_land_warning`. **`check_ins` carry REAL at-the-beach
positions — median 0.36 km from the spot, 3 of 4 under 1 km — but there are 4 of them.**
⚠️ `stories`/`condition_reports` coordinates are UNUSABLE: median 297.77 km with p90 IDENTICAL
(a degenerate constant over 4-5 spots = test data). Same shape as the `surf_reports` starvation.

---

## 9. ★★ SHIPPED 2026-07-27 — THE DEPTH-LIMITED BREAKING CAP WAS DEAD

`H <= gamma*d` is the most basic law in surf and it had **never once applied in production**.
Measured across 395 live spots: the cap **bound on ZERO of them**, median cap **107x the wave**.

**Root — one number doing two jobs.** `estimate_surf` uses a single `depth_m` for cross-shelf
friction AND for the depth-limited cap. Santa Cruz reads 452 m: correct as "deep water offshore,
little friction", absurd as "waves here break at 350 m".

**Fix (additive, not a swap).** A separate `break_depth_m` from ETOPO 15s (`nearshore_depth_m`)
feeds the cap only; the friction path is untouched. Asset entries gained a 5th element and
4-element entries from older builds still load. **725 of 950 spots carry a trusted depth**
(p50 10.4 m). Kill: `SURF_BREAK_DEPTH=0` or `SHORE_NORMAL_ASSET=0`; absent depth is byte-identical
to before.

### ⚠️ THE FIRST BUILD CAPPED REAL BREAKS OUT OF EXISTENCE
Caught by measuring the live effect before trusting it. Black Rock got a break depth of **0.1 m**
and the cap crushed it from **2.40 m to 0.12 m**; Monterrico 3.78 -> 1.00; Aroa Beach 3.63 -> 1.00.
**66 spots (8%) were being capped.** Two roots, two guards:
* **reef flat / swash** — Aroa medianed 0.8 m across ALL water in range; excluding cells under 1 m
  gives **16.9 m**, the water beyond the flat, which is what actually limits the wave.
* **unresolvable nearshore** — at 463 m a cell straddling a beach reads near-zero, so a very
  shallow answer means the INSTRUMENT failed. Below 3 m now returns None (legacy behaviour).

After both guards: **6 spots (1%)**, all at the 3 m floor, largest Muriwai 3.58 -> 2.47.
★ **A wrong break depth destroys a spot; a missing one is free.**

### LIVE
| check | result |
|---|---|
| `/point` Muriwai | `surf=2.4675`, regime **`breaking`** (was 3.58 `shoaling`) |
| `/point` Steamer Lane | 1.996 `shoaling` — uncapped spots unchanged |
| `/point` Black Rock | **2.6663** — the trust guard held (would have been 0.12) |

### ⚠️ TWO CORRECTIONS TO §8, BOTH FROM MEASUREMENT
1. **`shelf_depth_at` is NOT broken.** §8 called it "off by 40x". That measured it against the
   wrong purpose. For friction it works: Cocoa Beach 24 m/73 km -> **24.6% loss**, Galveston
   16 m/167 km -> **57.1%**, Mavericks 2.7%, Pipeline 0% — exactly the wide-shallow-shelf vs
   steep-coast distinction it documents. **Do not "fix" it.**
2. **`shelf_width_km` is NOT dead.** It looked inert only because the sensitivity sweep held depth
   at 452 m. At Florida's 24 m it drives that 25-57% loss.

★ **SENSITIVITY RANKING (measured, Komar branch on):** the shore normal swings surf height **40%**
(2.97 -> 1.77 m across bearings); depth is inert above ~50 m. So §2's shore-normal asset was the
high-leverage move, and this cap is **correctness, not volume**.
