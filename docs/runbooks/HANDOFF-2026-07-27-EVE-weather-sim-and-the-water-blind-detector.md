# HANDOFF 2026-07-27 EVE — the weather sim answered with different physics, and the placement detector could not tell a lagoon from the sea

**Continues `HANDOFF-2026-07-27-spot-accuracy-truth-and-missing-breaks.md`.**
5 commits on `dev`. Backend 987 passed / 1 pre-existing unrelated failure.
**Both blocked production writes from that handoff are now DONE** (§1).

Read [[standing-work-rules-user-mandate]] first. Everything below was measured.
**The owner's own eyes beat the detector, and that is the most important finding here** — §3.

---

## 1. ✅ THE TWO BLOCKED PRODUCTION WRITES ARE APPLIED

Authorised by the owner this session. Snapshots exist for both.

| | before | after |
|---|---|---|
| `is_verified_peak` | 1300 | **44** (exactly the 44 with a real `verified_by`) |
| `flagged_for_review` | 0 | **158** |
| `accuracy_flag='low_accuracy'` | 0 | **158** |

`spot_confidence()` is now truthful end to end: **158 low / 1314 medium / 44 high**.

★ **They had to go together, and the measurement is why.** 121 of the 158 provably-misplaced spots
claimed `is_verified_peak`, with **zero** real verifiers. `spot_confidence` tests that flag FIRST,
so flagging alone would have left 121 spots reporting **HIGH confidence from inside the misplaced
queue** — worse than either state on its own.

Rollback:
```sql
UPDATE surf_spots s SET is_verified_peak = true
  FROM surf_spots_verified_peak_backup_20260727 b WHERE b.id = s.id;
UPDATE surf_spots s SET flagged_for_review = b.flagged_for_review, accuracy_flag = b.accuracy_flag
  FROM surf_spots_placement_backup_20260727 b WHERE b.id = s.id;
```

---

## 2. ★★★ THE WEATHER SIM ANSWERED WITH DIFFERENT PHYSICS THAN THE APP SERVES

Two independent roots, both measured, both fixed (`dc8ee965`, `cf2efb48`).

### 2a. COVERAGE — it was querying the wrong table
`query_spots_from_db` read **`condition_reports`** — the photographer conditions-UPLOAD table
(`photographer_id` / `media_url` / `expires_at`). It holds **0 rows** and is near-empty by nature,
so every call fell through a bare `except: return []` to three hardcoded spots.
**`surf_spots` is the catalogue: 1547 active rows with coordinates.**
⇒ the weather simulation system could reach **3 of 1547 spots (0.2%)**, and the silent fallback is
why nobody noticed. `simulate_weather_change` takes the weather as INPUT, so every catalogue spot
is now simulable. Kill: `SIM_SPOT_CATALOG=0`.

### 2b. FIDELITY — median +19.1%, max +39.2% against the served height
It ran raw `komar_breaker_height` on the offshore Hs: no cross-shelf friction, no swell-angle
exposure, no magnets, **no depth-limited breaking cap** — and fed it a HARDCODED shore normal
**44.9° off** the ETOPO value production uses at the same coordinate (Mavericks 270 vs 225.1,
spread 10.5). After: **max delta 0.000%**. Kill: `SIM_PRODUCTION_GEOMETRY=0`.

★ **THE LESSON, and it is the general one.** `0cae5d74` fixed this at the FUNCTION level (delegate
the two physics functions). That still left the sim owning the **COMPOSITION** — the geometry those
functions are fed and the order effects apply in — which is exactly where production kept moving
(shore-normal asset `5a48ad1e` 07-26, break-depth cap `bf5c76cd` 07-27). **Delegating functions is
not enough; the invariant has to live in the one function every path calls.**
⇒ `services/weather_pipeline/surf_point.py` is now that function, and `point_resolution` uses it
too (`test_surf_point_parity.py` pins the extraction on 8 real coordinates).

### 2c. three smaller defects found on the way
* `swell_alignment_pct` had the **same two-frame defect `2851a598` fixed for the wind class** —
  measured against a stored `optimal_swell_dir` while the engine scored against the shore normal.
  At Mavericks they disagreed by 64.9°, so the sim reported **100% alignment for a swell production
  treats as 42%**.
* `reference_size_m` was applied **unconditionally** while production gates it on
  `RATING_LOCAL_SIZE` — the sim was rating spots on a curve the app is not using. It now follows
  the flag, so it tracks the owner's decision instead of pre-empting it.
* `data://forecasts/summary` printed `Quality: 56.4/100 (Triple Overhead+)` — a SIZE value in the
  quality slot.

⚠️ **The MCP server holds the module in memory.** A running WeatherSimulation stdio server keeps
serving the OLD code until it is restarted. Verified out-of-process instead.

---

## 3. ★★★ THE PLACEMENT DETECTOR COULD NOT TELL A LAGOON FROM THE SEA — the owner caught it, not the instrument

The owner looked at Volusia County on the live map and reported three wrong pins. **All three had
PASSED the placement gate. All three were ACCEPTED into the shore-normal asset**, shipping a
bearing fitted to the **Intracoastal's bank** into the production rating engine.

| spot | stored | `nearest_shoreline_km` | real Atlantic | shipped normal |
|---|---|---|---|---|
| NSB – Flagler Avenue | 29.028,-80.921 | **0.24 km** | **3.17 km** | **84.8°** |
| NSB Inlet (dupe) | 29.027,-80.920 | **0.12 km** | **3.11 km** | 83.7° |
| Bethune Beach | 28.998,-80.926 | 1.77 km | **5.11 km** | 70.1° |

Flagler Avenue is at **+1.5 m elevation, in the town**, and the gate called it 240 m from shore
because the Indian River bank is 240 m away. Its correctly-placed neighbours read 50–65°.

`nearest_shoreline_km` measures distance to **any** land/water boundary; on a barrier-island coast
that boundary is the lagoon. **This is the same water-blindness that made barrier-island shore
NORMALS face the lagoon (`a3229d5c`, 07-26) — it was never fixed for PLACEMENT.**

### The discriminator is DEPTH, and it was measured not chosen
ETOPO transect east across New Smyrna at the Flagler Avenue latitude:
```
mainland +8.7..+1.5 | LAGOON -2.7,-0.8 | barrier island +0.3..+2.7 | ATLANTIC -3.0,-7.4,-10.8,-12.7,-14.0,-16.6
```
**The lagoon never reaches 3 m. The ocean passes it within one cell of shore.**
Swept depth {3,5,8,12} m × cutoff {0.8,1.0,1.5,2.0} km over 17 hand-checked spots (the owner's
calls + Pipeline / Steamer Lane / Mavericks / Hossegor / Cocoa Beach / Sebastian Inlet / Uluwatu /
Jeffreys Bay as controls that must NOT flag). **3 m + 1.5 km separates all 17**, the cutoff sitting
in a clean gap between the worst true positive (Jeffreys Bay 1.06 km) and the best true negative
(Ormond Beach 2.14 km). `services/weather_pipeline/ocean_access.py`, 10 tests, synthetic rasters.

### ⚠️ A CONNECTIVITY DESIGN WAS TRIED FIRST AND IS WRONG — do not "improve" it back
Flood-filling water inward from the window border looks more principled. **The Intracoastal runs
hundreds of km along the Florida coast and therefore always crosses the window edge, seeding the
lagoon as sea.** It reproduced `nearest_shoreline_km` exactly (16 cases, 2 mismatches — both of the
owner's inland spots). Depth is the property that actually separates them. Recorded in the module.

### `accepted()` now refuses to ship a normal for a spot that is not on open ocean
A miss falls back safely to the coarse grid; **a confident wrong bearing is used as-is.**

⇒ **THE 158 IS AN UNDERCOUNT, and it under-detects exactly where the app has the most spots.**
None of the owner's three were in it.

---

## 4. THE ADMIN DASHBOARD COULD NOT EXPRESS THE CHANGE (`ad6cd082`)

Owner: "I don't see the actual # of surf spot changes reflecting in the admin for surf spots."
Correct, and not caching. `/admin/spots/stats` returned `total_spots`, `by_country`, `by_tier` —
**not one number was a function of `flagged_for_review`, `accuracy_flag`, `is_verified_peak` or
`verified_by`.** 1256 + 158 rows changed and the panel rendered identically.

Now also returns active / flagged / low_accuracy / unverified / `verified_peak` **beside**
`has_verifier` (they were 1300 vs 44 — reporting both makes drift visible). Country chips became
real `<button>`s with `aria-pressed` + focus ring (they were `Badge` + `onClick`, keyboard-dead,
`text-gray-300` dark-only).

⚠️ **`AdminSpotsPanel` lists spots from the PUBLIC `/surf-spots` endpoint**, whose
`SurfSpotResponse` omits `flagged_for_review` / `accuracy_flag` / `is_verified_peak` entirely —
while `spot_admin.py:/list` returns exactly those plus a real `total` and **is unused by this
panel**. The per-row accuracy state still cannot be displayed. **Not fixed — next session.**

---

## 5. ⚠️ THE "14 MISSING BREAKS" CLAIM WAS WRONG — 4 already exist (`22f84245`)

`find_missing_spots.py` decided "absent" on **proximity alone** (nothing within 2 km). Checked
against production, that is wrong for four of its own headline results:

**Jaws** = `Jaws (Peahi)` 5.13 km · **Cloud 9** 2.42 km · **Mavericks** 3.46 km · **Guincho** 3.50 km

**Importing would have duplicated four of the most famous breaks in the world**, and a duplicate is
worse than a gap — it splits reports, ratings and search between two rows that both look real. The
information was already in the CSV (`nearest_existing_spot`); the summary dropped it.
Now classified `PLACEMENT_DISCREPANCY` vs `MISSING`, warned, and excluded from the importable count.
Two sub-defects: the neighbour prefilter bounded **latitude only** (Lunada Bay's "nearest" was
Apache Pier, **3636 km** away), and **apostrophes split Hawaiian names** ("Pe'ahi" → {pe, ahi}),
silently exempting every Hawaiian break from the gate. 16 tests.

**The import is NOT done — genuinely absent, ETOPO-confirmed:** Shipstern Bluff, Belharra, Lunada
Bay, Scheveningen, El Médano, Brouwersdam, Pointe du Diable, Elbow Ledge. Owner asked to hold.

---

## 6. VOLUSIA — what was written, and what deliberately was not

* **`New Smyrna Beach Inlet`** (29.027,-80.920, in the lagoon at -2.7 m) → **`is_active = false`**.
  The duplicate glyph is gone; the correctly-placed twin `New Smyrna Beach - Inlet`
  (29.074,-80.919, ocean 0.34 km) is untouched. Undo: `is_active = true` on
  `d928d50a-4de5-4fe3-8e5d-fbb6568c6a3c`.
* **Bethune Beach** and **NSB – Flagler Avenue** → flagged + `low_accuracy`. **Coordinates NOT
  changed.** ETOPO proposes (28.998,-80.8688) = **5.57 km** and (29.028,-80.8854) = **3.46 km**,
  both beyond the measured 3.0 km bound where snapping stops being inference. Bethune's LATITUDE is
  also suspect (28.998 is Edgewater, mainland). **These belong in AdminSpotEditor.**

---

## 7. NEXT (ranked)

1. **Re-run the placement flags from `ocean_verdict`** once the rebuild lands — the 158 is an
   undercount and the review CSV now carries `ocean_km` / `ocean_verdict` / `ocean_lat` / `ocean_lng`.
2. **Point `AdminSpotsPanel` at `/admin/spots/list`** so per-row accuracy is visible (§4).
3. **Relocate the flagged Volusia spots in the editor** using the proposals in §6.
4. Import the 8 genuinely-absent breaks (§5) after owner review.
5. Buoy calibration: still time-gated; fit a **quantile** correction, not a single number.
6. **Do NOT flip `RATING_LOCAL_SIZE`** — no oversize penalty, so a beginner beach outranks the
   point break. (The sim now follows the flag, so it will track whenever it is flipped.)

### ⚠️ OPEN / LATENT
* **The rebuild got much slower: ~3 min → 25 min+**, because `FETCH_HALF_DEG` grew 0.045 → 0.08 for
  the ocean test (3.2× the cells). If that is a problem, fetch the ocean window at a coarser ERDDAP
  **stride** rather than shrinking it — 1.5 km resolution is plenty for a 1.5 km test.
* Size-climatology coupling (unchanged): `grid_size_climatology.py:95` / `surf_rating.py:453`
  compute climatology **without** a break depth while served heights have one. Harmless at
  `RATING_LOCAL_SIZE=0`; fix before flipping.
* `test_media_privacy_contracts.py` still fails on `dev`, unrelated to this work (grom-media
  contract), reproduced clean before any change here.
