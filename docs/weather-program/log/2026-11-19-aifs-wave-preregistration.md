# AIFS-wave vs IFS wave vs GFS-Wave at the L1 19-buoy panel: PRE-REGISTRATION (2026-11-19 00:35Z, before any forecast value is read)

Amendments A1-A5 and the limits section, taken from the advisor's read (2026-11-19). Still before any forecast value
is read:
- A1: V1 margin;
- A2: block length;
- A3: 20,000 resamples;
- A4: what V2 is not;
- A5: window check.

Amendments B1-B3, from the research lead's read (2026-11-19). Still before any value is read:
- B1: plants judged by the statistic they move (additive by ΔME, amplitude by ΔMAE);
- B2: a Δ|ME| family F3 enters V1 and V2;
- B3: land-fallback counts plus an all-bilinear sensitivity line.

The AIFS-ENS wave arm is left out unless its open-data stream covers 2026-07-01 onward.
- **Checked 2026-11-19 by HEAD on the Google copy:**
  `aifs-ens/0p25/waef/<date>000000-24h-waef-ef.index` returned 404 for 07-01, 09-01 and 11-01.
- **Possible cause:** the filename pattern may differ from what the research lead saw on 11-18.
- **Status:** coverage from July is NOT shown, so the arm is OUT of this registration. If it is added, that is a new
  registration.

Lane: wind long-range (built the L1 instrument). Asked by the director 2026-11-19, from exit-plan section O. Offline only:
nothing here runs on Render, writes Storage or serves a number. No Open-Meteo (D-074). Not served until it passes AND
ships under D-080.

## 0. What was read before writing this (listings and HEAD requests only; no field decoded, no buoy value read)
- `aifs-single/0p25/wave/` (ECMWF open data, Google copy): the first published day is **2026-05-13** (05-12 and
  earlier: 404). Four cycles (00/06/12/18Z). Steps to at least +360 h. Params in the +24 h index: swh, mwd, mwp, cdww,
  h1012, h1214, h1417, h1721, h2125, h2530. CC BY 4.0.
- `ifs/0p25/wave/` present for every probed day from 2026-01-01; +240/+324/+360 h present.
- GFS-Wave global 0.25 on NOAA's S3 (`noaa-gfs-bdp-pds`, `gfs.YYYYMMDD/HH/wave/gridded/gfswave.tHHz.global.0p25.fFFF.grib2`): present.
- NDBC standard met, monthly: `data/stdmet/<Mon>/<id><m><yyyy>.txt.gz` for closed months (Aug, Sep checked), and
  `data/stdmet/<Mon>/<id>.txt` for the newest month (Oct checked).

## 1. Question
Is ECMWF's machine-learning wave forecast (AIFS-single wave) as good as or better than the physics models we already
use for offshore significant wave height, and does adding it to the equal-weight mean improve the mean?

## 2. Arms (deterministic Hs, `swh`, m)
- **A** = AIFS-single wave; **I** = ECMWF IFS wave (`ifs/0p25/wave`, type fc); **G** = GFS-Wave global 0.25 (HTSGW).
- **C2** = (I + G) / 2; **C3** = (I + G + A) / 3. Equal weights, fixed now; no fitted weights.

## 3. Sample, fixed now
- **Inits:** 00Z and 12Z, **2026-07-01 00Z through 2026-10-21 12Z** inclusive (226 inits). Every +240 h valid time
  falls on or before 2026-10-31 12Z, so all truth comes from closed or current NDBC monthly files.
- **Why it starts 07-01:** the L1 gate's TEST window is valid times 2026-01-01 to 2026-07-01 (one scored look,
  `wave_l1_score.py`). Nothing here touches it, so this study cannot leak into L1.
- **Leads:** +24, +48, +72, +120, +240 h.
- **Buoys:** the L1 panel, named 2026-11-16 23:22 EST, 19 buoys: 46025 46014 46041 46029 46027 41004 41025 41043 41049
  51001 51002 51004 51202 41008 46087 46054 46086 51201 46026.
- **A row** = (init, lead, buoy), written whether or not the buoy reported (y = NaN when it did not).
- **Paired:** a row is scored only when y and all three arms exist, so every arm is scored on the same rows.
- **Halves (the replication block):** H1 = inits 07-01 to 08-31; H2 = inits 09-01 to 10-21.

## 4. Extraction, one rule for all three models
- **Field:** the model's own 0.25 grid; no regridding between models.
- **Point value:** bilinear at the buoy position. If any of the four corners is missing (land or missing value), use
  the nearest valid cell within 0.5°. If there is none, the arm is missing for that row.
- **Truth:** NDBC WVHT. Take the report nearest the valid hour within ±30 min; 99.0 counts as missing.
- **Retries:** a fetch that fails after the standard retries leaves the arm missing for that row. It is never filled,
  and the count is reported per model.

## 5. Metrics and statistics
- **Per arm and lead:** MAE and ME (forecast − buoy), pooled over buoys.
- **Paired differences, ΔMAE per lead:**
  - A−I, A−G, I−G;
  - the consensus arm C3−C2.
- **CI:** 95% moving-block bootstrap over init dates, N = 20,000, seed 20261119 (amendment A3; was 2,000).
  - **Block length** is the larger of 3 days and the lead (amendment A2): primary blocks are 3, 3, 3, 5 and 10 days
    for +24, +48, +72, +120 and +240 h.
  - **The 3-day result** is reported beside the primary at every lead.
- **Holm** (α = 0.05), in two families:
  - F1 = {A−I, A−G, I−G} × 5 leads (15 tests);
  - F2 = {C3−C2} × 5 leads (5 tests);
  - F3 = paired Δ|ME| for {A−I, A−G, C3−C2} × 5 leads (15 tests), with the same blocks (amendment B2).
- **Land-fallback sensitivity (amendment B3).**
  - The bilinear → nearest-valid-cell count is reported per model × buoy.
  - V1 and V2 are also reported restricted to rows where all three arms used bilinear. This line is reported, not
    gating.
- **Coastal/offshore split:**
  - **Rule:** a buoy is "coastal" if any GFS 0.25 land cell lies within 50 km of it, else "offshore".
  - **Computed from the land mask before scoring;** the class list is written into this file as an amendment before
    any score.
  - **Status:** reported, not gating.
- **Also reported, not gating:**
  - per basin (pacific / atlantic_gulf / hawaii, as in L1);
  - per buoy;
  - per lead ME;
  - the scorable-row counts.

## 6. Verdict lines (decided now)
- **V1, "A not worse than physics" at a lead (amendment A1, a margin).** All three must hold:
  - the Holm-adjusted upper bound of ΔMAE(A−I) is ≤ +0.03 m, and the same for ΔMAE(A−G);
  - the 1× amplitude plant (I × 1.10) is detected by ΔMAE at that lead (B1);
  - |ME_A| is not Holm-significantly larger than both |ME_I| and |ME_G| (F3, amendment B2);
  - the point ΔMAE has the same sign in H1 and H2.

  Otherwise the line reads "not shown worse", never "as good as". "A better than I at L" needs the Holm-adjusted CI
  upper < 0 pooled AND the same sign in both halves.
- **V2, "A improves the consensus" (the D-080 candidate).** All three must hold:
  - C3−C2 is Holm-significant < 0 at ≥ 3 of the 5 leads;
  - no lead is Holm-significant > 0;
  - the pooled sign over 48-240 h is the same in H1 and H2;
  - |ME(C3)| is not Holm-significantly larger than |ME(C2)| at any lead (F3, amendment B2).
- **Fragile.** A line that holds with 3-day blocks and not with 10-day blocks, or the reverse, is labelled FRAGILE.
- **A V2 PASS is necessary, not sufficient, to serve.** Serving still needs:
  - D-080 and its own default-on filter;
  - a seam check where A would join the chain;
  - David's word.
- **What V2 is NOT (amendment A4).**
  - **What C2 and C3 are:** equal-weight means of IFS and GFS offshore Hs, with no ICON member. They are not the
    program's consensus construction.
  - **What a V2 PASS shows:** evidence about adding AIFS to that two-member mean at 19 offshore buoys. It is not a test
    of the served three-model consensus.
  - **Before anything is served:** the comparison is repeated with the program's own consensus construction and its
    real members.

## 7. Controls (run on the same rows, before the arms are compared)
- **Null.** I vs a copy of I: ΔMAE exactly 0 with a zero-width CI at every lead. If not, the run is VOID.
- **Planted controls (amendment B1, research lead).** Each plant is judged by the statistic it actually moves. An
  additive shift barely moves MAE when errors straddle zero (measured 2026-11-18: paired MAE missed a +0.1 m plant).
  - **Additive plants:** I + 0.10 m (1×) and I + 0.20 m (2×), judged by the paired ΔME.
  - **Amplitude plants:** I × 1.10 (1×) and I × 1.20 (2×), judged by the paired ΔMAE. This is the MAE power check.
  - **Required:** each 2× plant must be Holm-significant in its own test at all 5 leads, or the run is VOID (no power).
  - **Reported:** the 1× plants, as the detectable floors.
  - **Scope:** the plants form a family of their own and do not enter F1/F2/F3.
- **Derangement.**
  - **How:** A paired with the wrong buoy's observation (same valid time and lead, buoys cycled by one in the list
    above).
  - **Required:** it must score MAE worse than A at the true buoy at every lead, or VOID.

## 8. VOID rules
- **Cell coverage.** A (model, lead) cell with < 80% of its rows scorable is VOID for that cell. If more than 3 of
  the 15 model-lead cells are VOID, the whole run is VOID.
- **Halves.** If H1 or H2 has < 40% of the scored rows, the replication line is reported as NOT TESTABLE, not as a
  pass.
- **Model versions.**
  - **Before the fetch:** record IFS and AIFS cycle/version changes inside the window (ECMWF changelog).
  - **If a change falls inside it:** report per version segment.
  - **Effect on the verdict:** none; the V lines are pooled.

## 9. One scored look
- **Scored once,** after the collection, on whatever exists.
- **Changing anything after a score** is a new registration on new data: inits after 2026-10-21, scored once their
  truth exists.

## 10. Cost and where it runs
- **Fetch:** byte-range reads of the swh message only. About 1 MB per field × 3 models × 5 leads × 226 inits, about
  3.4 GB.
- **Where:** a dispatch-only GitHub Actions workflow on dev. The dispatch needs David's word, typed in the
  dispatching session. Or a local offline run.
- **Not during the running wind hindcast** (run 44376282465): ECMWF reads go to the Google copy; GFS reads go to
  NOAA's S3.

## 10a. Is the window free? (amendment A5)
Every registration I found that touches these 19 buoys and/or valid times 2026-07-01..10-31, checked against the shared
notes and dev's log on 2026-11-19:
- **L1 E2 / wave EMOS instrument (#1016, `wave_l1_score.py`).** Uses TRAIN 2025-03..12 and TEST 2026-01-01..07-01,
  with two held-out weeks inside TEST. It does not use Jul-Oct 2026 and does not treat it as unseen.
- **Isotonic calibration gate (proposal 2026-11-18).** It waits for L1 E2, and its fit and eval windows are NOT yet
  fixed ("rolling held-out window", "different seasons").
  - It calibrates the served Hs. This study reads IFS and GFS-Wave errors at the panel in Jul-Oct, which is
    information about two served members.
  - **Recorded rule:** the isotonic registration may not use Jul-Oct 2026 at these buoys as unseen evaluation data;
    this study spends it.
- **Archive research reads (job spec 2026-11-18).** It reads the 7 days before its dispatch day, in November, so it
  does not overlap.
- **D-072 monitor replay (#949).** Covered 2026-08-15..11-14 at monitor buoys. It is already run and scored (FAIL as
  registered), and it is a monitor replay, not a model selection, so it does not treat the window as unseen.
- **Wind long-range hindcast (run 44376282465).** Covers Sep-Oct 2026, but it is WIND at NDBC + ASOS stations, not Hs,
  so the quantity is not shared.
- **Tide G3 (2026-08-25..09-07).** Tide gauges and water level, not Hs at these buoys.

**Conclusion:** no registration treats Jul-Oct 2026 Hs at this panel as unseen. From this file on, this study spends
it.

## 10b. Limits (written in, not fixed)
- **One season only (Jul-Oct).** H1 and H2 are two halves of one season, not a replication across seasons. Winter
  swell regimes are not tested.
- **Height only.** No period, direction or partition skill is tested.
- **Offshore buoys only.** Nothing here speaks to nearshore or breaking height.
- **AIFS-single is one deterministic run,** compared with deterministic physics runs. It is not a probabilistic
  comparison.
- **The nearest-valid-cell fallback (§4) differs by model at coastal buoys.** Its count is reported per model per
  buoy.

## 11. Owed before any fetch
- The collector, with its tests and floor fragment.
- The coastal/offshore class list (§5), as an amendment.
- The version list (§8).
- The advisor's read of this file.
