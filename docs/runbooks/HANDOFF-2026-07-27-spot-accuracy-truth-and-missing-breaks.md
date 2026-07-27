# HANDOFF 2026-07-27 — spot accuracy is a LIE the UI shows, the breaking cap was dead, and 14 famous breaks are missing

**Continues `HANDOFF-2026-07-26-EVE-shore-normal-etopo-shipped.md` (§8/§9 are its addenda).
23 commits this session, all pushed to `dev`, tree clean. Backend 959 passed / 1 pre-existing fail.**

Read [[standing-work-rules-user-mandate]] first. Everything below was measured. **Three of my own
earlier claims were disproven by measurement and are corrected here** — §5.

---

## 0. ⛔ ONE THING NEEDS YOUR HAND — a blocked production write

`is_verified_peak` is **false information for 1256 spots** (§1). The fix is ready and a rollback
snapshot already exists, but the UPDATE was **blocked by the permission classifier**, so nothing was
written to `surf_spots`. Its state is unchanged.

```sql
-- rollback snapshot ALREADY TAKEN: surf_spots_verified_peak_backup_20260727 (1256 rows)
UPDATE surf_spots
   SET is_verified_peak = false
 WHERE is_verified_peak = true
   AND verified_by IS NULL
   AND accuracy_flag NOT IN ('verified','admin_verified');
-- expected: 1256 rows. Leaves the 44 spots that have a real verifier untouched.

-- to undo:
UPDATE surf_spots s SET is_verified_peak = true
  FROM surf_spots_verified_peak_backup_20260727 b WHERE b.id = s.id;
```

**Two visible effects, both corrections:**
1. `spot_confidence()` returns `"high"` for any `is_verified_peak`. 1256 spots currently report
   **HIGH confidence** on a pin nobody ever checked; they will drop to `"medium"`.
2. `routes/weather.py:426` orders the map's rated subset by `is_verified_peak DESC`. With 1300 true
   the ordering is meaningless; afterwards the 44 genuinely-verified spots sort first, as intended.

---

## 1. ★★★ IS THERE ACCURACY WITH THE SPOTS? NO — and the data proves it

`models/spots.py:39` documents `is_verified_peak` as *"True if manually verified or snapped to
water"*, `default=False`. The bulk expansion scripts hardcode it anyway:
`global_expansion_phase3.py:630,643` and `caribbean_asia_pacific_expansion.py:657,670` both insert
`is_verified_peak=True` for **every** spot, with no verification of any kind.

**The decisive test** — does the flag predict placement accuracy?

| bucket | claims `is_verified_peak` | has a real `verified_by` |
|---|---|---|
| spots ETOPO **proves misplaced** | **89.6%** | **0** |
| rest of the catalogue | 85.6% | 44 |

**It is slightly MORE common among provably-misplaced spots.** The flag carries zero accuracy
information. `accuracy_flag` is the honest field: 1472 `unverified`, 36 `verified`, 8
`admin_verified` — and only those 44 have a `verified_by`, matching exactly.

⇒ **Answer to "verified or unverified": UNVERIFIED**, for all but the 44. SQL in §0.

### Where the bad coordinates came from
Misplacement is spread evenly across the two bulk expansions — **5.7%** of the 2026-04-02 batch
(368 spots) and **5.5%** of the 2026-04-03 batch (962) — and is **0%** in the three small
hand-curated batches (16, 36, 38). The 358 hardcoded `CURATED_SPOTS` are good; the geocoded bulk
expansions are where placement broke. It is not one bad script.

### ⚠️ THE PRECISION QUEUE IS BUILT AND EMPTY — the third starving mechanism today
`spot_admin.py:149` filters on `flagged_for_review`; `AdminPrecisionQueue.js` already styles
`low_accuracy` orange; `AdminSpotEditor.js` is a working map editor; `refinements.py` is a complete
crowdsourced flow (`crowdsourced_pending` → `verified` → `offset_adjusted`).
**`flagged_for_review` is `false` for all 1516 spots.** Nothing has ever populated it — alongside
`spot_refinements` (1 row) and `surf_reports` (4 rows).
**The right next move is to write the ETOPO placement verdicts into `flagged_for_review` +
`accuracy_flag='low_accuracy'`** so the queue you already built lights up. That also makes
`spot_confidence` truthful end-to-end: misplaced → `low`, unverified → `medium`, verified → `high`.

---

## 2. ★★ THE DEPTH-LIMITED BREAKING CAP WAS DEAD — fixed and live

`H <= gamma*d` had **never once applied in production**: across 395 live spots the cap bound on
**zero**, median cap **107x the wave**. Root — `estimate_surf` used one `depth_m` for two unrelated
jobs (cross-shelf friction AND the breaking cap). Santa Cruz reads 452 m: right as "deep water
offshore, little friction", absurd as "waves break at 350 m".

**Fix (additive):** a separate `break_depth_m` from ETOPO 15s feeds the cap only; friction is
untouched. **725 of 950** asset entries carry a trusted depth (p50 10.4 m). Kill:
`SURF_BREAK_DEPTH=0` or `SHORE_NORMAL_ASSET=0`.

⚠️ **The first build capped real breaks out of existence** — caught by measuring before trusting.
Black Rock got a 0.1 m break depth and was crushed **2.40 → 0.12 m**; 66 spots (8%) were affected.
Two guards: exclude sub-1 m swash/reef-flat cells (Aroa 0.8 m → 16.9 m), and return **None** below
3 m because at 463 m a cell straddling a beach reads near-zero — that is the instrument failing.
After: **6 spots (1%)**, largest Muriwai 3.58 → 2.47.
★ **A wrong break depth destroys a spot; a missing one is free.**

**Live:** Muriwai `surf=2.4635` regime **`breaking`** · Black Rock `2.6357` (guard held) ·
Hossegor `279.8` · Pipeline `325.0` (hand override still outranks).

---

## 3. ★★ 14 FAMOUS BREAKS ARE MISSING — `scripts/find_missing_spots.py`

Wikidata (**CC0**) holds 40 surf breaks with coordinates; **21 are absent** from the catalogue and
**14 are ETOPO-confirmed within 2 km of a real shoreline**:

**Jaws (Pe'ahi)** 0.12 km · **Cloud 9** 0.12 · Pointe du Diable 0.13 · Lunada Bay 0.23 ·
Brouwersdam 0.39 · Scheveningen 0.39 · Guincho 0.46 · **Shipstern Bluff** 0.68 · El Médano 0.89 ·
**Mavericks** 0.97 · **Belharra** 1.44 · Elbow Ledge 1.63 (+ dupes).

Each carries an ETOPO-verified shore normal, ready to import. Review `missing_spots_wikidata.csv`
first — the tool never writes to the database.
★ **40 items worldwide is also the proof there is no bulk source**, independently confirming the
2026-07-26 expansion refusal.

### ⚠️ LICENCE — the constraint that shapes all of this
* **OSM / Overpass = ODbL SHARE-ALIKE.** `import_global_spots.import_osm_spots` **can write OSM
  coordinates into `surf_spots`** (the admin "include_osm" checkbox). **Production has ZERO spots
  with an `osm_id`** — verified — so the catalogue is clean of ODbL data today. **Keep it that way**;
  importing OSM risks making the whole table a derivative database.
* **Wikidata = CC0** ✓ (used here). **GeoNames = CC BY** ✓ (username `RAWSURF`, now working) —
  but only ~2-3 of 12 hits were trustworthy: it returned Tarimbang **118 km away**, a *lagoon* for
  Okanda, a bay centroid in **58 m of water** for Lavanono. Needs ≤40 km radius + feature-code
  weighting + ETOPO cross-check before use.
* **Surfline = ToS prohibits scraping — declined.**

---

## 4. GPS ACCURACY — what it is actually worth (measured, and it is less than it looks)

Priced 25 proposed moves (~2.9 km each) against live production:
**|surf height change| median 0.00 m** · **|rating change| median 0.1 pts** · gained a shore normal
**0/25**. **A 2.9 km move cannot leave a 28 km marine cell.** Placement's value is *geometric*
(letting spots into the shore-normal asset), not forecast-sampling.

`scripts/propose_spot_placements.py` triages all 302 spots with no usable geometry:
**113 PROPOSE_COORD** (median move 2.41 km, each yielding a gate-passing normal) · 15 AMBIGUOUS ·
103 TOO_FAR · 70 IMPOSSIBLE_COORD. It refuses to propose beyond measured bounds (≤3 km move,
opposed-fraction ≤0.15) because snapping passes the shore-normal gate 87-94% of the time **without
being right** — Twin Rocks passes after a 13.9 km coin-flip move; Iron Bottom Sound sits in 654 m of
water and is a WWII naval graveyard, not a break.
⚠️ **`IMPOSSIBLE_COORD` means RELOCATE, never delete** — it catches Lakey Peak (337 m up a hillside)
and Tuason Point (in 899 m of water), both world-class breaks with wrong coordinates.

---

## 5. ⚠️ THREE OF MY OWN CLAIMS, DISPROVEN BY MEASUREMENT

1. **"`shelf_depth_at` is broken, 452 m vs ETOPO's 8.5 m, off by 40x."** WRONG — I measured it
   against the wrong purpose. For friction it works: Cocoa Beach 24 m/73 km ⇒ **24.6% loss**,
   Galveston 16 m/167 km ⇒ **57.1%**, Mavericks 2.7%, Pipeline 0%. **Do not "fix" it.**
2. **"`shelf_width_km` is dead (zero sensitivity)."** WRONG — an artifact of holding depth at 452 m
   in the sweep. At Florida's 24 m it drives that 25-57% loss.
3. **"The snapper is the best next path."** WRONG — the 63 worst-placed spots are precisely the ones
   geometry must not touch (median move 8.94 km).

★ **SENSITIVITY RANKING (measured):** shore normal swings surf height **40%** (2.97→1.77 m across
bearings); depth is inert above ~50 m. The 2026-07-26 shore-normal asset was the high-leverage move.

---

## 6. WHAT TO DO NEXT (ranked)

1. **Run the §0 SQL** — it is the only blocked item, and it stops the app claiming HIGH confidence
   on 1256 unchecked pins.
2. **Populate `flagged_for_review` + `accuracy_flag='low_accuracy'`** from the 302 placement
   failures so the Precision Queue you already built becomes usable (§1).
3. **Import the 14 missing breaks** from `missing_spots_wikidata.csv` after review (§3).
4. **`RATING_LOCAL_SIZE`: still DO NOT flip** — nothing in the composite penalises an oversized
   spot, so at every plausible reference pair a beginner beach (Cowell's, `fair`) outranks the point
   break (Steamer Lane, `poor_fair`) on an 8 ft day. Needs an oversize rolloff first. Its motivating
   symptom ("29 CA spots epic at once") **no longer reproduces** — only 15 spots (1.0%) now score ≥95.
5. Buoy calibration: let it accumulate a week, then fit a **quantile** correction (unchanged).

### ⚠️ OPEN / LATENT
* **Size-climatology coupling.** `grid_size_climatology.py:95` and `surf_rating.py:453` compute the
  climatology through `estimate_surf` **without** a break depth, while served heights now have one.
  Harmless today (`RATING_LOCAL_SIZE=0`), but references would be built from uncapped heights
  against capped actuals if it is ever enabled. Fix before flipping that flag.
* **`test_media_privacy_contracts.py` fails on `dev` and is NOT from this work** (reproduced with a
  clean stash). Child-safety media contract; a task chip was raised.
* Production writes made this session: **only** `surf_spots_verified_peak_backup_20260727`
  (a rollback snapshot). `surf_spots` itself is unmodified.

---

## 7. REBUILD / KILL

```bash
gh workflow run "Build Shore Normal Asset" --ref dev     # ~3 min, commits the asset
```
Re-run after moving any spot or it silently falls back. Precedence at the single call site in
`point_resolution.py`: hand overrides (`surf_magnets`) > ETOPO asset > coarse `bathymetry`.
Kills: `SURF_V3_NORMAL_OVERRIDES=0` · `SHORE_NORMAL_ASSET=0` · `SURF_BREAK_DEPTH=0` · delete the
JSON. **Every path degrades to previous behaviour; nothing here can make a rating worse.**
