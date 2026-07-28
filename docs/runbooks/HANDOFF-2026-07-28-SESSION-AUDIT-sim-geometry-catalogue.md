# HANDOFF 2026-07-28 — SESSION AUDIT: the sim, the geometry, and the catalogue

**Supersedes nothing; continues `HANDOFF-2026-07-27-LATE-weather-sim-unreachable-and-forecast-blind.md`,
which holds the long-form detail. This file is the AUDIT: what shipped, what is PROVEN, what is only
CLAIMED, and where I was wrong.**

Session ran from `59a9c6af` (14:30) to `a3457650` (20:45): **24 commits + 2 CI asset builds**, all on
`dev`, all pushed, **tree clean, 0 ahead of origin**. Read [[standing-work-rules-user-mandate]] first.

---

## 0. ⛔ DO THESE FIRST

1. ✅ **The WeatherSimulation MCP server was restarted and VERIFIED** at the end of this session —
   `get_surf_spots("Supertubos")` returned instantly through the real MCP connection, reporting
   `source: live_catalog` and `orientation_source: etopo`. Nothing to do.
   **How, for next time — no app restart needed:**
   ```powershell
   Get-CimInstance Win32_Process -Filter "Name like '%python%'" |
     Where-Object { $_.CommandLine -like '*weather_sim_mcp*' } | Select-Object ProcessId
   Stop-Process -Id <pid> -Force    # Claude Code respawns it on the next tool call
   ```
   ⚠️ Before killing it, confirm the fix you want is committed — a bad server used to cost a 30-minute
   client hang. It cannot deadlock any more (`_warm_hot_path`), but verify out-of-band with
   `scratchpad/mcp_call.py` (own timeout) rather than by calling the MCP tool blind.
2. **Do not re-run `Build Shore Normal Asset` casually** — it is healthy now (1386/1820) and a run
   during an ERDDAP outage used to be able to destroy it. That hole is closed (§2d) but the asset is
   the input to every rating.

---

## 1. THE WEATHER SIM — was unreachable, now works

| | before | after | proof |
|---|---|---|---|
| any tool call | **hung to the client's 1800 s abort** | 0.02 s | stdio probe, cold process |
| spots forecastable | **3 of 1547** | **all 1820** | `Trestles` live, 0.72 s |
| catalogue source | `dev.db` snapshot | app's `/api/surf-spots` | Bethune at the corrected coord |
| app unreachable | blocked **42 s** | **8 s once, then 0.00 s** | blackhole-IP probe |

**`f794f78f` — the deadlock.** A **function-level `import numpy`** in `bathymetry.shelf_depth_at`,
executed inside an AnyIO worker thread on the first tool call, never returns. faulthandler stacks
identical at 25/50/75 s. ⚠️ **Whichever tool is called FIRST hangs; a second request unblocks it, and
its response arrives under the OLDER id** — read the response `id` or you will blame the wrong call.
Ruled out by measurement: not slowness (3.7 s CPU / 43 min), not fastmcp (a minimal sync tool answers
in 0.01 s), not `get_surf_spots`, and **not fixed by importing `bathymetry`** (numpy is inside the
function). ★★ **26 green unit tests proved nothing — they call the tools on the main thread, the one
place the bug cannot happen.**

**`7f04c945` + `913b4af7` — live forecast and live catalogue.** The sim now asks the app's
`/api/weather/point`, mapping copied verbatim from `spot_ratings.rate_one_spot`. ⚠️ marine
`point.speed` is **OFFSHORE Hs**, `surf_height_m` is the **BREAKING** height; wind `point.speed` is
already **KNOTS**. Payload reports **parity** (served vs sim): Mavericks +0.38%, Pipeline −0.2% — the
0.1 ft rounding, nothing more.

**`576dcbdd` — and then my own regression caused the owner's errors.** Network I/O inside the tool
handlers at a 30 s timeout blocked 42 s, past where a client reports a TIMEOUT. ⚠️ **The host is a
free Render instance that cold-starts in ~50 s: SLOW IS NORMAL.** Fixed with an 8 s timeout, a 60 s
circuit breaker, and a daemon-thread prefetch. Second failure mode found while measuring: **response
size** — `limit=500` was 93.5 KB (~24k tokens), which a client REJECTS. Cap is now a measured 200.

Kills: `SIM_EAGER_WARMUP=0` · `SIM_LIVE_FORECAST=0` · `SIM_LIVE_CATALOG=0` · `SIM_SPOTS_MAX` ·
`SIM_FORECAST_TIMEOUT_S` · `SIM_FORECAST_COOLDOWN_S`.

---

## 2. THE SHORE-NORMAL GEOMETRY — 62.6% → 76.2% coverage

**`6b739835` — a COUNT was doing a CONFIDENCE job.** `n_windows >= 3` was stricter than
`fit_shore_normal` itself (which returns a bearing at two), discarding 153 spots — **133 ON_OCEAN a
median 0.21 km from open water, agreeing to a median 5.5°**. Every one fell back to the coarse
0.25° grid, a **194.6 km window**.

★★ **THE INSTRUMENT IS THE STORY.** Overpass was down, so OSM was unavailable. Substitute: accepted
spots within 15 km as a local reference frame — **calibrated by reproducing the known OSM result
(6.4°) at 6.2° leave-one-out.** Only then used on new data:

| | vs local consensus | coarse | ETOPO wins |
|---|---|---|---|
| accepted (control, n=176) | **6.2°** | 14.6° | 70% |
| 2-window candidates (n=41) | **10.1°** | 17.4° | 68% |

⇒ **948 → 1073, and 43.1% of rating evaluations CHANGE LEVEL.**
⚠️ Measurement **killed** the obvious alternative: "loosen the spread gate" — the 264 ambiguous spots
are p50 **69.7°**, not clustered at the boundary. ⛔ The 40° gate stays.

**`084a29f4` + `bf47d86e` — the diagnosis lied, in two layers.** `spot_misplaced` fired on **0 of
1515** while 133 spots were provably beyond 3 km (Manzanillo 12.01 km, Nihiwatu 10.58 km at +264 m).
Cause: **clause ORDER** — a bad pin has no coastline in its window, so it failed the FIT clause first
and short-circuited the placement check. ★ **The worse the misplacement, the less likely it was
called one.** Then the same shape one level deeper: `shoreline_km` is None when NO shoreline exists
in the ~18 km window, so 17 spots in **110–1778 m of water** (Telescopes −1778, Macaronis −1686)
escaped a bound expressed in km-from-shore. New verdict `spot_misplaced_at_sea`, bounded by physics
(a wave breaks in ~1.3× its height; nothing breaks below 50 m) — and a shallow offshore bank like
Cortes Bank is deliberately NOT caught, pinned by a test.
⚠️ **Neither change can alter the accept set** — all clauses are rejections. Verified by replaying
both orders over the real 1515 rows: **1070 both ways, identical.**

**`8dcacefa` → `0a3a8549` — the bearing contract, and I fixed the wrong thing first.**
The build failed its own gate twice with `0.0 <= normal < 360.0`. My first fix wrapped `atan2`
(`degrees(atan2(-1e-17,1.0)) % 360.0 == 360.0` — real, but rare). **The instance that actually fired
was `round(359.97, 1) -> 360.0`**: the build ROUNDS for storage, AFTER the wrap.
★ **The invariant has to be the LAST operation applied.**

**`55bd0b2b` — an empty asset was one git race from shipping.** A run emitted **0 of 1820** (total
ERDDAP failure); the gate passed it **vacuously** (no entries = no illegal entries), the commit step
committed it, and only an unrelated `git push` race kept it out of `dev`. `write_is_safe()` now
refuses empty, or below 80% of the asset on disk. Kill: `SHORE_NORMAL_ALLOW_SHRINK=1`.

**Final: `8c49a0af` — asset 1386/1820 (76.2%), 0 illegal bearings.**

---

## 3. THE CATALOGUE — 1515 → 1820

**`af7d95c1` + `2764e1d5` — geometry can DETECT misplacement but cannot CORRECT it.** Measured: the
74 inland spots' nearest ocean is p50 **4.63 km** (0 of 74 inside the 3 km bound), and the seaward
groups' snap points the WRONG WAY. ⇒ all 164 need an authoritative name→coordinate source.
`propose_spot_corrections.py` name-matches against any gazetteer and validates candidates against
ETOPO. NGA GNS (public domain, worldwide, via NGA's **ArcGIS REST service**, not the 400 MB dump)
took coverage **7 → 75 of 164**.

⚠️ Two defects caught before trusting it: an unfiltered match returned `Manzanillo [FRM]` (a FARM)
and `Salalah [ADM2]` (an admin division) ⇒ **designation allowlist**; and `Playa Hermosa (Nicaragua)`
matched the feature **`Nicaragua`** ⇒ a **stricter matcher in the proposer only**. ⚠️⚠️ Stripping
parentheticals in the SHARED matcher **regressed `Jaws (Peahi)` → `Peahi`** — the duplicate gate must
stay LOOSE, a correction must be STRICT. Different jobs, different thresholds.

★ **A name match is still not a coordinate.** The biggest moves were the worst: Margaret River → the
TOWN 10 km inland, `Same Adentro` (*adentro* = inland), `Chiba Peninsula` (a centroid). ⇒ tiers
**HIGH 9 / MEDIUM 27 / LOW 39 / UNMATCHED 89**.

---

## 4. ✅ PRODUCTION WRITES (owner-approved, all reversible)

| | before | after |
|---|---|---|
| active spots | 1515 | **1818** (1820 imported, 2 duplicates deactivated in §9a) |
| EEA-imported | 0 | **303** active |
| `offset_adjusted` | 2 | **11** |
| `flagged_for_review` | 164 | **460** |
| `is_verified_peak` | 55 | **55** |

**The 9 corrections, verified against the REBUILT geometry** — all moved from >3 km to **0.14–1.30 km**
from shore; 8 now ship a fitted bearing, Maitencillo is correctly placed on a genuinely ambiguous
coastline. All 9 unflagged, `offset_adjusted` retains provenance.
★ **Nazaré is cross-validated: GNS `Enseada da Nazaré` 3.67 km vs EEA `NORTE (NAZARE)` 3.62 km — two
independent authorities within 50 m.**

**The 305 EEA imports** (PT+IE, `NEW` only, 2.0 km dedupe against LIVE production, unverified,
flagged, CC-BY attribution per row). 47 of 352 correctly rejected — chunks 2-4 deduped against rows
inserted moments earlier, which is exactly why the dedupe reads live state.

### ROLLBACK
```sql
-- coordinates + flags (snapshot has 1516 rows, taken before the corrections)
UPDATE surf_spots s SET latitude = b.latitude, longitude = b.longitude,
       accuracy_flag = b.accuracy_flag, flagged_for_review = b.flagged_for_review
  FROM surf_spots_coord_backup_20260727c b WHERE b.id = s.id;
-- the import
DELETE FROM surf_spots WHERE description LIKE 'Imported from EEA Bathing Water Directive%';
```
Earlier snapshots still present: `surf_spots_verified_peak_backup_20260727`,
`surf_spots_placement_backup_20260727`.

---

## 5. ⚠️ WHERE I WAS WRONG — measurement overturned me SIX times

1. **"The catalogue's coordinates are synthetic."** The 3rd decimal is `8` on 633/1515 and `2` on 316
   — **41σ** — and I called them generated. **Wikidata says no: p50 0.47 km on 18 famous breaks**
   (Snapper 0.035, Pipeline 0.245). Broadly accurate with a specific bad tail.
2. **"The 127 newly-named misplacements aren't all in the existing 164 flags."** **All 147 were
   already flagged — `newly_flagged: 0`.** No production write was needed; I took a snapshot, found
   it unnecessary, and dropped it.
3. **"Global expansion now uses the same fetcher (GNS)."** GNS coastal-landform recall of our own
   catalogue is **37–57% @3 km vs EEA's 77.4%**, and **0% in SoCal because GNS EXCLUDES THE UNITED
   STATES** (US → GNIS). It is a correction source, not a discovery source.
4. **"+89 spots recoverable in the `no_shoreline_in_window` bucket."** Only **~31**; the rest fail the
   misplacement gate regardless.
5. **"The Precision Queue is polluted by the import."** It was not — `low_accuracy` already isolated
   the 155 misplaced cleanly. What was missing was a queue for the *imports*.
6. **The 360.0 bearing** — fixed `atan2` first when the real cause was `round()`.

★ **The pattern: every one was caught by measuring instead of reasoning. Calibrate an instrument
against a known answer BEFORE using it on new data.**

---

## 6. ⚠️ CLAIMED BUT NOT VERIFIED — do not treat as done

* **THE MAP HAS NOT BEEN LOOKED AT.** `/map` redirects to the landing page without auth on the :3001
  harness. Pin clustering at zoom and search ranking at 1820 spots are **unverified by eye**. The app
  renders with zero console errors, and that is all that is proven.
* **Whether an EEA bathing-water site is a spot a surfer wants** is untested. Density is fine
  (below); the editorial question is open.
* **The 305 imports have never been reviewed by a human.** They are flagged for exactly that.
* **`spot_misplaced_at_sea` and the reordering were verified by REPLAY**, not by a fresh fit of those
  specific spots.
* **The 27 MEDIUM / 39 LOW correction proposals are unreviewed.** MEDIUM is "a settlement within
  5 km" — plausible, not cross-checked.

### What IS verified
* Density: **0 dedupe violations**, closest import to a curated break **2.06 km**, median 4.08 km.
  ⚠️ The first cut of this looked alarming (21 of 37 curated have a neighbour <2 km) until I asked
  WHICH neighbour — Ericeira ↔ São Lourenço 0.70 km is **each other**, pre-existing geography.
* Backend suite **1105 passed** at the last full run; frontend `craco build` passes.
* The sim's four tools end-to-end on a cold stdio server.

---

## 7. NEXT — ranked, with the measurement already done

### 1. ★★★ FORECAST CALIBRATION — the biggest untouched lever
Every INPUT improved this session; the OUTPUT number is still uncalibrated.
⚠️ **My memory said this was "time-gated". IT IS NOT — the loop is live.**
`GET /api/weather/buoy-calibration` returned a report generated 2026-07-27T23:36 with **60
buoy-matched spots and 421 obs/model pairs**.

★★ **Aggregate bias is +0.010 m — and that number is a TRAP.** Stratified by observed size:

| observed (buoy) | n | bias (model − buoy) |
|---|---|---|
| 0.0–0.5 m | 89 | **+0.229** over-predicts small |
| 0.5–1.0 m | 189 | −0.004 |
| 1.0–1.5 m | 81 | −0.136 |
| 1.5–2.5 m | 52 | +0.065 |
| **2.5–10 m** | **10** | **−0.794** badly under-predicts big |
| all | 421 | **+0.010** |

**The model COMPRESSES** — independently reproducing the 2026-07-26 finding (+0.206 → −0.230) from a
different dataset. ⇒ **Fit a monotonic QUANTILE MAP, not a bias term.** Gate it behind the existing
`RATING_OBS_GATE` (default `"0"`). ⚠️ **n=10 above 2.5 m** — the band with the largest error has the
least evidence; hold it until it has more samples. ★ Companion rule from memory: the report weight K
is a **KALMAN GAIN — derived, not chosen**.

### 2. The 155 remaining misplaced spots
75 have GNS proposals (27 MEDIUM, 39 LOW, unreviewed); **89 are surf-only names no official gazetteer
carries** — that is what `refinements.py` is for (built, wired, holding one row).

### 3. FR/ES/UK expansion — 2333 candidates, blocked only on judgement
Crowding is measured and is NOT a blocker. Real surf: p80 breaking height p50 **1.32 m**, 93.6%
≥0.8 m. But wholesale import takes the catalogue to ~3848 and turns a curated surf guide into a
coastal-conditions catalogue — **Spain would go from 40 curated to ~1100**. Recommend ranked batches
with `local_size_m` as the bar (≥1.5 m is 939), after someone looks at the Portugal map.

### 4. Smaller
* `test_weather_sim_mcp.py` is at **792 lines** against the 800 ratchet — the next test there breaks CI.
* `data://forecasts/summary` still iterates `MOCK_SPOTS` only.
* `caller_role` in the sim remains caller-asserted — a sandbox gate, never the auth pattern.

---

## 8. TOOLS ADDED THIS SESSION (all committed)
* `backend/scripts/validate_shore_normals_osm.py` — the OSM truth column, written and thrown away
  twice before. ⚠️ carries its own historic bug as a warning (averaging all segments makes the two
  shores of a spit CANCEL) plus mirror rotation and a certifi CA context.
* `backend/scripts/propose_spot_corrections.py` — gazetteer → validated, tiered coordinate proposals.
  **Review artefact only; never writes.**
* `backend/services/weather_pipeline/sim_forecast.py` — the app's live forecast + catalogue for
  out-of-process callers.
* `backend/tests/test_weather_sim_mcp_server_startup.py` — drives the REAL stdio server; fails with a
  60 s hang under `SIM_EAGER_WARMUP=0`.
* `spot_sources.fetch_gns` — NGA GNS via ArcGIS REST.

⚠️ **This machine's system CA store has an EXPIRED root**: Overpass fails `CERTIFICATE_VERIFY_FAILED`
while other hosts succeed. Use `certifi`. **Never cache a failed fetch** — a cached transient 504 is
indistinguishable from "this spot has no coastline".

---

## 9. ★★★ SECOND AUDIT: THE DUPLICATE SWEEP — and it caught my own import

Triggered by a live observation, not a plan: a routine `get_surf_spots("Supertubos")` returned **two
rows** — `Peniche - Supertubos` (39.379,−9.3146) and `Supertubos` (39.35,−9.3667), **5.5 km apart**.
The import dedupe is 2.0 km, so it could never have seen that. Swept the whole catalogue.

**Method:** every pair within 12 km whose names match under `find_missing_spots.names_match`.

```
1820 spots -> 302 name-matching pairs within 12 km
   288 PRE-EXISTING  ·  14 touching a 2026-07-27 import
```

### 9a. My import introduced exactly 2 duplicates — measured, and now fixed
Of 305 imports, **5 name-match an existing spot within 12 km**, and **2 are the SAME normalised
name**:

| | distance | why it slipped |
|---|---|---|
| `COXOS` vs `Coxos` | **2.17 km** | dedupe is 2.0 km and DISTANCE-ONLY |
| `CONSOLAÇÃO` vs `Consolação` | **3.20 km** | same |

Both **deactivated** (`is_active=false`, unflagged) — a duplicate is worse than a gap because it
splits reports, ratings and search between two rows that both look real.
Undo: `UPDATE surf_spots SET is_active=true WHERE id IN
('513e9d8a-fa8d-42d7-9348-69291a53c019','e824565d-3d54-43b5-8caf-13b9121fd221');`
⇒ **active 1820 → 1818, imports 305 → 303.** Duplicate rate 2/305 = **0.7%**.

★ **THE DEFECT IN MY OWN TOOL:** `import_reviewed_spots.py` dedupes on DISTANCE ALONE. An official
gazetteer's coordinate for the same break routinely sits 2–3 km from a surf catalogue's, so distance
can never catch it. **The importer must also reject on a NAME match within a wider radius** —
`find_missing_spots.SAME_BREAK_KM` is already 8.0 km and is the right constant. NOT YET IMPLEMENTED.

### 9b. The bigger finding: 288 pre-existing pairs, and they predate everything
Closest first — ⚠️ **these need human triage, they are NOT all duplicates**:

| distance | pair | verdict |
|---|---|---|
| **0.14 km** | `Teahupo'o` \| `Teahupoo` | **unambiguous duplicate** — apostrophe variant |
| 0.27 / 0.38 | `Trestles` \| `Lower Trestles` \| `Upper Trestles` | Lower/Upper are REAL separate peaks; bare `Trestles` is the dupe |
| 0.35 | `Uluwatu` \| `Uluwatu - The Peak` | probable duplicate |
| 0.37 | `Margaret River` \| `Main Break Margaret River` | probable duplicate |
| 0.40 | `La Nord` \| `La Nord Hossegor` | probable duplicate |
| 0.42 | `Ala Moana Beach` \| `Ala Moana Bowls` | probable duplicate |
| 0.15–0.39 | `Ponce Inlet` N/S Jetty · `Sebastian Inlet` S Jetty · `Rockaway 90th/92nd` | **REAL distinct peaks — do not merge** |

★ **`Teahupo'o` vs `Teahupoo` at 140 m is the clearest single defect in the catalogue** — and it is
exactly the apostrophe-normalisation case `22f84245` fixed in the duplicate GATE but never applied
retroactively to existing rows.

⇒ **A duplicate triage pass over the 288 is now the highest-value accuracy work after calibration** —
larger than the 155 misplaced spots, and cheaper per fix.
