# HANDOFF 2026-07-26 (Opus 5) — the ACCURACY arc: measurement revived, two roots found

**HEAD `c41d0879` == `origin/dev`. 19 commits, all pushed, tree clean, CI green.
Frontend 170 suites / 1517 tests. Backend 260 passed / 0 failed. LOC ratchet green.**

Read [[standing-work-rules-user-mandate]] and [[standing-context-guards-landmines]] first. This
session was forensics-led throughout; every number below was measured, and the places where an
instrument lied are called out because they will lie to you too.

---

## 0. THE ONE-PARAGRAPH STATE

The app could not measure its own accuracy. Both ground-truth loops were built, enabled, running —
and producing nothing. That is now fixed and **the first accuracy numbers in the app's history
exist**. They immediately found a real defect (offshore compression). Separately, two structural
roots were proven: **shore normal is derived on a 194.6 km window**, and **over half the spot catalog
is not in the surf zone**. Both cap per-spot accuracy no matter how good the wave model gets.

---

## 1. WHAT SHIPPED (19 commits)

### Governance / hygiene
| commit | what |
|---|---|
| `853d99e4` | **The frontend LOC gate had NEVER run.** `loc-check.yml` was `pull_request`-only under a push-direct workflow; `ci.yml`'s size job is backend-scoped. Verified: zero workflow runs, zero PRs ever. Shipped a **ratchet + baseline** (new files can't exceed 800; the 13 existing may only shrink). |
| `cb00ee14` | `scheduler.py` was at **exactly 800** = a live hard gate on all weather work. Extracted EURO coarse ingest → **512**. Proven a pure mechanical move by reversing the transform: **292 lines round-trip byte-identical**. |
| `348bbef7` · `af3c908a` · `2a1bbe87` | tri-tool audit ledger; gitignore for harness outputs |

### Rating correctness
| commit | what |
|---|---|
| `0cae5d74` · `2851a598` | Sim carried **private copies of both physics steps** and both had drifted (quality omitted `swell_h` ⇒ flat ocean = "Epic"; height drifted −53%/+31% vs Komar). Now delegates to `surf_rating` + `surf_transform`. Also unified two disagreeing wind reference frames and deleted dead code. |
| `12b0e1ec` | **Infobox was permanently geometry-blind** — all 3 point mappers dropped `shore_normal_deg`, so wind DIRECTION was ignored and every cell rated as head-on. **74.6% level-disagreement vs the glyph, worst 90 pts.** Live proof on Steamer Lane: **73.7 "good" → 34.8 "poor_fair"**. Also fixed the size ladder, which was internally impossible (settled with NO external source: `report_calibration.py:37` already held double overhead = 11 ft). |
| `817379da` | **A 100 kt onshore gale rated "fair"** (43.0), identical at 16/30/60/100 kt, and INVERTED — longer period scored higher in a gale. Root is `W_PERIOD*pq` as a **co-ADDEND**, not the wq clamp ⇒ the fix must MULTIPLY. Keyed on physics, not `wq` (which saturates flat at 0.0500 from 16→100 kt). |
| `18098080` | **4320-case cross-language parity gate.** Caught a real ±0.1 divergence: Python `round()` is banker's, JS `Math.round` is half-away-from-zero. Levels never differ; contract is exact level parity + one rounding unit. |
| `67d63198` | **The band painted the NEXT level's colour** — the ramp anchored on `_BUCKETS` EDGES, so 41 ("poor_fair") rendered 93% fair-green. Re-anchored to bucket CENTRES. Test **parses the ramp out of the GLSL source** and evaluates it numerically; proven non-vacuous (restoring edge anchors fails 4/5). |

### MAR-01
| commit | what |
|---|---|
| `dbc49ea0` · `b8114048` · `2dc12a9a` | Duplicate world fetch root = **WRITE key from the response `region_id` vs READ key from the request `selectedTileId`**; `41addb91` flipped the served tier and desynced them. **A REINTRODUCTION** — `backendWeatherServiceClientCoverage.js:390` documents the same fix once already and **that comment is now FALSE**. Fixed by ALIASING, not renaming. A/B n=4/leg: **2→1 world fetches, 5122→4359 ms, distributions DISJOINT.** |
| `5ec29a63` | **DEBT-CACHE-03's published root is DISPROVEN** — see §3. |

### Measurement (the arc's point)
| commit | what |
|---|---|
| `8980ada1` · `466b8295` · `e8f08609` | Revived the dead offshore loop — buoy mapping, resolve-at-buoy, per-buoy aggregation, pagination, column-scoped write. |
| `c41d0879` | Spot placement detector. |

---

## 2. ★ THE HEADLINE: MEASUREMENT IS ALIVE, AND IT FOUND SOMETHING

### It was producing nothing
`run_buoy_calibration()` was **enabled** (`BUOY_CALIBRATION=1` in both workflows) and ran every
cycle — but selected spots via `noaa_buoy_id=not.is.null`, and **0 of 1516 spots had one**. Every
cycle logged `no buoy-tagged spots — nothing to do` inside a guarded `except`.
`/api/weather/buoy-calibration` returned `{"available": false}`. The instrument that would say how
accurate we are had been dark since it shipped.

**Fixed:** `scripts/map_spots_to_ndbc_buoys.py` populates the column from NDBC's bulk `latest_obs`
feed (one request = every station's id/lat/lon AND latest obs). **422 spots → 60 buoys**, verified in
the DB. The 100 km radius is measured, not assumed — coverage saturates at 34-40% because NDBC is
US-centric, and no radius fixes that. Acceptable because **a buoy verifies the MODEL, which is
global**.

### The first numbers — and the trap in them
```
n (distinct buoys) 60 | height_bias +0.003 m | height MAE 0.219 m (0.72 ft)
                        period_bias +0.497 s | period MAE 1.934 s
```
**The near-zero bias is an artifact of cancellation.** By observed size:

| observed Hs | n | bias |
|---|---|---|
| 0.00–0.75 m | 13 | **+0.206 m** (model HIGH) |
| 0.75–1.25 m | 29 | −0.005 m |
| 1.25–2.00 m | 14 | **−0.103 m** (model LOW) |
| 2.00 m+ | 4 | **−0.230 m** (model LOW) |

Perfectly monotonic. **The model over-predicts small surf and under-predicts big surf — a
compression.** This is the owner's reported "off by a little", and it is in the **OFFSHORE model**
(measured at the buoy, upstream of the surf transform), so everything downstream inherits it.

⚠️ **A single-number bias correction would do NOTHING** — the mean error is already zero.
State-dependent bias needs **quantile mapping**.
⚠️ **n=4 in the top bin, ONE timestamp, GFS only, observed range 0.3–2.5 m.** Do not correct on this.
Let it accumulate — every 3-hourly cycle adds a sample. Want a week and a real size range first.

### The human-report loop is starving, not broken
`surf_reports` = **4 rows, 0 in 21 days**; the archive window is 21 days, so `n_matched: 0`. The
prediction side is primed (60,000 archived). Not an engineering problem — needs users logging.

★ **On the report weight (`REPORT_NUDGE_K`, currently 0.30):** the owner suggested 20% as an example
and then correctly asked for the real spec. Researched: the correct weight is the **Kalman gain**,
`K = σ²_model / (σ²_model + σ²_obs)` — and `report_nudge` already implements exactly that form
(`score + K*(consensus-score)` ≡ an (1-K)/K blend). **K is DERIVED, not chosen.** 0.30 implies
observers are 1.53× noisier than the model; 0.20 implies 2.0×. Neither is measured. **Left at 0.30
deliberately — a premature 0.20 edit was made and reverted.** Derive it once both σ's exist.
The "no report ⇒ factor absent" behaviour the owner asked for is **already correct and formally
right** (no observation ⇒ no update).

---

## 3. ★ THE TWO STRUCTURAL ROOTS (both verified by hand, both open)

### (a) Shore normal is derived on a 194.6 km window
- `surf_spots` has **32 columns and ZERO geometry columns** — no orientation/shore_normal/bearing.
  Verified in `information_schema`. It is derived at request time.
- `bathymetry.shore_normal_at(lat,lng,window_cells=3)` slices `grid[r-3:r+4, c-3:c+4]` = **7×7**, and
  I loaded the grid metadata: **dlat = 0.25° ⇒ 7×0.25° = 1.75° = 194.6 km.**

**A 194 km window decides which way a beach faces.** Consequences measured by the workflow: all 15
Bali spots share 2 bearings 0.42° apart (Uluwatu and Nusa Dua, ~130° apart in truth,
indistinguishable — costing **Uluwatu 28.9 pts LOW and Nusa Dua 26.4 pts HIGH** on one ordinary
day); 8 North Shore Oahu spots all return `0.0°` against a coast facing ~325°; 60% of pairs within
25 km are byte-identical. Cost is near-linear at **≈0.30 rating points per degree** of error, and
**18.3 pts / 73.2% level disagreement** when null.

**THE FIX, VERIFIED LIVE:** NOAA **ETOPO 2022 15s** on ERDDAP —
`https://coastwatch.pfeg.noaa.gov/erddap/griddap/ETOPO_2022_v1_15s` — **0.004167° ≈ 463 m, CC0
public domain** (no attribution, no share-alike). I pulled a real Oahu window: HTTP 200, genuine
bathymetry, spacing confirmed. **60× finer.** On that window the workflow measured: current grid → 8
spots / 1 bearing (0.0°); ETOPO → **8/8 non-null, 7 distinct, 290–324°**.

### (b) Over half the catalog is not in the surf zone
`scripts/audit_spot_placement.py`, 160-spot random sample vs ETOPO:

| band | n | % |
|---|---|---|
| **INLAND (>10 m)** | 44 | **27.5%** |
| on land (0–10 m) | 40 | 25.0% |
| surf zone | 63 | 39.4% |
| shelf | 8 | 5.0% |
| **deep ocean (<−200 m)** | 5 | **3.1%** |

Geocoding artifacts — place names resolved to municipal centroids. **Reggae Falls +678 m** (a
waterfall in the Jamaican interior — not a surf break at all), Twin Rocks +301 m, Ao Nang +157 m;
Nanumea in **1,230 m** of open ocean. **~31% confirmed misplaced ⇒ ~465 of 1516.**

⚠️ **INSTRUMENT LIMIT, encoded in the code:** ETOPO 15s is 463 m and a correct break sits 50–300 m
offshore, so its cell can straddle beach and land and read slightly positive. **The 0–10 m band is
SUSPECT, not condemned**; `is_confirmed_defect()` excludes it and a unit test pins that exclusion.

**Duplicates are NOT the problem** (contrary to impression): SQL-exact — **4 pairs <50 m**, 18 <200 m,
but **159 <1 km** (legitimately adjacent named peaks; Rincón has 5 breaks within 3 km), and only **1
duplicated name** in 1516.

**3 spots forecast the WRONG OCEAN** (name collisions, awaiting owner confirmation of coordinates):
Old Mans (region Canggu/Bali, coords in **Cabo, Mexico**) · Long Beach (region Washington Coast,
coords **Long Beach NY**) · Surfside Beach (region Brazoria TX, coords **Surfside Beach SC**).

### (c) DEBT-CACHE-03's published root is DISPROVEN
Both the 07-24 handoff §(B) and Antigravity's debt bank say the z6 global resident is caused by
`getModelSafeMarine` "missing the `gwid>=340` global-skip guard" and propose adding
`__RAW_DISABLE_SAFECACHE_GLOBAL_SKIP__`. **That guard has existed since `82bd76b3` (Codex, 07-25)**
with that exact kill switch and a two-direction test — **and the symptom still reproduces 3/3.**
DO NOT re-add it. Corrected root + repro in
`HANDOFF-2026-07-26-DEBT-CACHE-03-z6-global-resident-CORRECTED-ROOT.md`.

---

## 4. ⚠️ INSTRUMENTS THAT LIED THIS SESSION (they will lie to you)

1. **PostgREST silently caps at 1000 rows** and still returns 200 — dropped 516 of 1516 spots while
   looking successful. Always paginate; verify against a direct SQL count.
2. **`42501 permission denied` was NOT a bad key.** `service_role` held SELECT only on `surf_spots`.
   Fixed with a **column-scoped** grant (`noaa_buoy_id` alone). A bulk upsert then failed for a
   *different* reason (needs INSERT) — writes are a grouped PATCH.
3. **Naive `awk` on activationlab reports double-counts** — the same bbox appears again under
   `marine grid RESPONSES`. Reported 2 for BOTH legs until the parse stopped at that boundary.
4. **Region-centroid outlier detection is confounded** — "South Coast" exists in Barbados, Iceland,
   Sri Lanka AND Mauritius. Use distance-to-nearest-SIBLING.
5. **`/api/weather/point` needs `domain`+`layer`+`valid_time`** — omitting them returns a 422 body
   that parses as "no data". Nearly filed a false "backend doesn't send shore_normal_deg".
6. **Anchor tests require `reference_size_m`** — checking the owner's calibration anchors with
   `None` is the wrong instrument.
7. **My own hand-mirror of the rating math was wrong.** Always evaluate the REAL module.
8. **Both research workflows returned 0 refuted out of 28 and 20.** Treat that verifier as lenient;
   agents also had file paths wrong. **Verify load-bearing claims by hand** — I did, and the
   substance held every time, but the citations did not.

---

## 5. WHAT TO DO NEXT (ranked)

1. **ETOPO shore normal.** Highest leverage available: one geometry change lifts all 1516 spots and
   every future spot, costs zero precompute rows, CC0, and is verified working. ~0.30 pts/degree
   recovered.
2. **Run the placement audit at full scale** (`audit_spot_placement.py`, read-only, no write grant
   needed) → ranked CSV → owner's spot editor. Then consider an auto-snapper (nearest shoreline →
   project seaward to the 5–10 m contour) with confidence tiers; **GSHHG** is the right shoreline
   source (avoids OSM's ODbL share-alike).
3. **Let the buoy calibration accumulate** ~a week, then characterise the compression curve and fit
   a **quantile** correction. Do not fit on one snapshot.
4. **`RATING_LOCAL_SIZE=1`** (Render env + `precompute.yml`) — owner's call; changes every visible
   rating. Stops Cowell's scoring 99.9 beside Steamer Lane's 100. Safe by construction; coverage is
   unknowable until flipped (count is logged inside the flag branch).
5. Open marine items: z6 commit path (§3c), band assumes head-on swell, `wind_quality` saturation,
   dead depth cap, 13 LOC violators behind the ratchet.

**⛔ EXPANSION IS NOT NEXT.** The owner asked for every spot globally; the workflow refused the
premise with evidence and I verified the load-bearing parts. **There is no legitimate 40,000-spot
source** — OSM has **1,254 surf objects globally, FEWER than our 1,516**, and 699 are shops/schools;
Wannasurf prohibits commercial use; Surfline's ToS bans scrapers. And adding spots onto 194 km
geometry multiplies a 73%-level-disagreement defect. Fix geometry and placement first.

---

## 6. OWNER DECISIONS OUTSTANDING

- Confirm coordinates for the 3 wrong-ocean spots.
- `RATING_LOCAL_SIZE=1` — when.
- Beach observations (app said X / actually Y / Surfline said Z, noting whether error is
  size-dependent) — still the fastest independent check on the compression finding.
- Driving surf-report volume (product, not engineering) — gates the human loop and the derived K.
- FEAT-01 face recognition (1457 Antigravity planning steps, no git trace) — resurrect or kill.
- Antigravity credits — idle since 07-24.

**⚠️ A research workflow (`wf_1a08aef6-426`) DIED** — 6 agents, 5 hours silent, zero results, 250–350
KB of transcript each. Its science was re-derived by hand (§2). Kill or salvage.
