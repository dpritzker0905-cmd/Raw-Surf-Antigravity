# Gate: gust-ens-risk-v1
Stamp: 2026-11-23 02:50Z (written BEFORE any collection, fit or score for this gate; the result file `results/gust-ens-risk-v1.md` must be a later commit)
Candidate: an ensemble gust-risk product: per cell and step, the fraction of ECMWF IFS ENS open-data members whose `10fg` / `10fg3` reaches 25, 34 and 48 kn (an ECMWF EFI/SOT-style exceedance probability), shown under Gusts as a probability view.
Metric: Brier score (BS) of the member fraction against the observed window-max gust event, per threshold x lead bin, paired on identical rows against (a) station climatology and (b) the deterministic HRES `10fg` >= threshold (0/1); plus the Murphy reliability/resolution terms, the reliability diagram and ROC AUC. Full definitions in section 4.
Pass threshold: section 6 (G1-G4, per threshold x lead bin; every CI a 95% day-block bootstrap, with 5-day blocks as the fragility check).
Controls: section 7 (null shuffle, positive plant, climatology self-check, +24 h shift). A control that misbehaves makes the run VOID, not failed.
Decision rule: section 8. A missing or unmeasured item is never a pass.
Unmeasured items: section 9.
Served change: none from this gate. A pass allows the client PR (probability view, DARK or ON per the director under D-065, kill switch, registered flag, SCOREBOARD row). The publisher is built dark beside it and serves nothing until then.

## 0. Status and standing constraints
- Task: director brief 2026-11-22 (gust SOTA review rank 3, `GUSTS-SOTA-PATH.md`): "Build an ensemble gust-risk product:
  the probability that the gust reaches 25, 34 and 48 kn. Use the ECMWF open-data ENS (51 members, `10fg`)."
  The three thresholds come from that brief (Beaufort 6/8/10 edges, near-gale / gale / storm), not from any data.
- Owner decisions that bind the product: gusts use the wind's own palette (2026-11-15); no stand-in model past a
  model's range and a hard seam (D-075); no blending across models (D-076). This product is ONE model (IFS ENS)
  over its own native 0-360 h range: no seam with another model, no stand-in, no blend.
- **Blinding.** The #939/#946 hindcast (runs 44376282465, 43952101715, 44107750669) is under that registration's
  condition (2). This gate uses NONE of its files (run files, truth snapshot, station freeze, report) and no number
  from it; the author has read only its one-line verdict (FAIL, on wind) in `log/2026-11-15-wind-long-range.md`.
  #946 registered a gust-peak line P5 (Brier for gust >= 15 m/s, long range); its value has not been read. All data
  here is collected afresh from public archives. The CODE of #946 is reused (fetch, decode, station selection
  helpers, observation parsers, the day-block bootstrap), as the brief asks: no second ENS fetcher.
- Agency sources only (D-082): ECMWF open data (AWS `ecmwf-forecasts`), NDBC, IEM (the ASOS/METAR archive). No
  Open-Meteo anywhere. Nothing reads the Raw Surf backend (never load-test it).

## 1. Question
Is the ECMWF ENS member fraction a reliable and skilful probability of the observed gust reaching 25 / 34 / 48 kn,
better than station climatology and better than the deterministic "HRES gust >= threshold", at each lead bin? Where
it is, the product may show it; where it is not, it may not.

## 2. What `10fg` is (measured 2026-11-23 02:10Z from GRIB headers of run 2026-10-15 00Z; reused for every run)
The window is NOT a flat 3 h / 6 h. Decoded `stepRange` / `lengthOfTimeRange` (same in `enfo` and `oper`):
| ENS steps | param | window ending at the step |
|---|---|---|
| 3-90 h, every 3 h | `10fg` | **1 h** (e.g. step 24 = max over 23-24 h) |
| 93-144 h, every 3 h | `10fg3` | 3 h |
| 150-360 h, every 6 h | `10fg` | 6 h |
The collector reads the window from each message's header and refuses a message whose window differs from this table.
`ens_wind_fetch.PARAMS` has only `10fg`, so 93-144 h steps are read with `params=("10fg3",)`.
Members: 50 perturbed (`pf` 1..50); the control left the open-data `ef` files on 2026-05-13 (#982, amendment 5 of
#946), so the fraction is k/50. A step with any of the 50 missing is dropped, never filled (fetch_step's rule).

## 3. Data (frozen now)
- **Runs:** ECMWF 00Z runs 2026-10-10 .. 2026-11-20 (42 runs). A (run, lead) is used only when its window ends
  at or before the truth snapshot's end (section 3, truth). Overlap note: runs 10-10..10-31 are also inside #946's
  window; they are re-read from the archive, never taken from #946's files.
- **Leads scored** (21 steps): B1 = 12, 24, 36, 48, 60, 72, 84 h (1 h window); B2 = 96, 108, 120, 132, 144 h
  (3 h window); B3 = 168, 192, 216, 240 h (6 h); B4 = 264, 288, 312, 336, 360 h (6 h). The bins follow the window
  changes, so no bin mixes windows.
- **Deterministic arm:** HRES (`oper`, `fc`) `10fg`/`10fg3` at the same steps (same windows, measured above), B1-B3
  only (HRES open data ends at 240 h at 00Z). B4 has no deterministic arm; G2 does not apply there.
- **Stations (frozen by rule before any model value is read; the frozen list is committed with the result):**
  - The rule is #946's code, `wind_lr_obs.select_stations`, run afresh with this gate's span: coverage window
    2026-10-10 00Z .. 2026-11-21 00Z, no NDBC monthly files (realtime2 only), ASOS archive read for the same span.
  - That rule: NDBC/C-MAN (`activestations.xml`, met=y, buoy or fixed) within 50 km of GFS land, >= 70% of hours with
    WSPD and GST, anemometer height known (else dropped); coastal ASOS (IEM, the US/territory `*_ASOS` networks)
    within 10 km of GFS sea with >= 70% hourly coverage, at most 60, nearest the sea first (ties by id).
  - Per-station position: the nearest 0.25-degree node; an NDBC station whose four surrounding nodes are not all sea
    moves to the nearest all-sea node (`wind_lr_hindcast.sample_points` rule). Values are bilinear at that point.
  - Station counts and the network split are printed in the result beside every number.
- **Truth (snapshot taken once, before any model value is read; hashed and committed with the result):**
  - NDBC: `realtime2/<id>.txt` (45 days) plus `5day2`; GST adjusted to 10 m by the same neutral log law as the wind
    (`wind_lr_obs.to_10m`, #946 amendment 2).
  - ASOS/METAR (IEM `asos.py`, routine + specials): the gust group AND the `PK WND` remark (`peak_wind_gust`,
    `peak_wind_time`). Treated as 10 m.
  - **Window max** for a valid time V and window w (1, 3 or 6 h): the largest gust whose time lies in (V - w, V]:
    NDBC GST at each record's time; METAR gust group at the report time; `PK WND` at its own `peak_wind_time`. For
    ASOS a report with no gust group counts its sustained speed (as #946).
  - **Coverage rule:** a window is scored only if it holds >= 1 record per hour of w for NDBC, and for ASOS >= 1
    routine report per hour of w. Otherwise the row is dropped for every arm.
  - Event: window max >= T, T = 25 kn (12.861 m/s), 34 kn (17.491 m/s), 48 kn (24.693 m/s). Forecasts compare in
    m/s with the same constants.

## 4. Arms and metrics (all on the identical row set per threshold x bin)
- `ENS`: p = k/50, k = members with gust >= T (bilinear member value at the station point).
- `HRES`: 0/1 = HRES gust >= T (B1-B3).
- `CLIM`: the station's own event frequency for that threshold and window length over the scored valid times,
  leave-one-day-out (the day of the row's valid time is excluded). A station with < 20 windows left gets the pooled
  network climatology. (A sample climatology over the test period is a strong reference: it knows the period's base
  rate. That is intended; it makes G1 conservative.)
- Reported only: `ENS_MED` (0/1 = member median >= T) and `ENS_P90` (0/1 = member p90 >= T), the two cues D-075
  already names, so the result also says what the probability adds over them.
- BS = mean (p - o)^2. Paired difference per row, day-block bootstrap of the mean difference (blocks = the valid
  time's UTC day; 2000 reps, seed 20261122), 95% percentile CI. 5-day blocks on the same rows as the fragility check.
- Murphy decomposition over 11 probability bins (0, (0, 0.1], ..., (0.9, 1.0]): REL, RES, UNC; the reliability
  diagram (bin mean p vs observed frequency, with n) is printed in the result.
- ROC: hit rate vs false-alarm rate at every k threshold (k >= 1..50), AUC by the trapezoid rule, 95% day-block CI.
- Every number is printed with n rows, n events, n stations and n distinct event days.

## 5. Power
A threshold x bin cell is UNDERPOWERED (reported, never a pass, never a fail) if it has < 30 events or events on
< 10 distinct days. 48 kn is expected to be UNDERPOWERED at stations; it is reported and cannot pass unless it meets
this rule.

## 6. Pass lines (per threshold x bin; all four must hold)
- **G1 vs climatology:** BS(ENS) - BS(CLIM) has CI upper < 0 (BSS_clim > 0, significant).
- **G2 vs deterministic:** BS(ENS) - BS(HRES) has CI upper < 0 (B1-B3; not applicable in B4).
- **G3 reliability:** REL < RES, AND calibration in the large mean(p) / event frequency within [0.5, 2.0].
- **G4 discrimination:** ROC AUC 95% CI lower bound > 0.70.
- **Fragility:** a cell that passes G1 or G2 on 1-day blocks but not on 5-day blocks is FRAGILE, not a pass.
- No multiplicity adjustment across cells: each cell is its own ship decision (it controls whether THAT threshold at
  THAT lead is shown), and a cell needs all four lines, so the family error is bounded by G1 alone per cell. Stated
  now so it cannot be chosen later.

## 7. Controls (each must behave, or the run is VOID)
- **C1 null (station shuffle):** within each valid time, the observed events are permuted among stations (seed
  20261123). BS(ENS, shuffled) must exceed BS(ENS, true) by >= 10% at 25 kn in B1 (the scorer must see the pairing).
- **C2 positive plant:** on the real rows, a planted forecast p = 0.05 + 0.9 o must score BSS_clim > 0.5,
  AUC > 0.95 and REL < 0.02 (the scorer must recognise a good forecast).
- **C3 climatology self-check:** CLIM against itself gives a paired difference of exactly 0 with a zero-width CI, and
  a constant forecast equal to the row-set event frequency gives REL < 1e-6 (the decomposition is right).
- **C4 time shift:** ENS p paired with the observation at V + 24 h (same station, same window) must be worse than
  aligned at 25 kn in B1 with CI upper < 0 on BS(aligned) - BS(shifted) (timing must matter).
- **C5 window mismatch (reported only):** the B1 event frequency with a 6 h observation window instead of the 1 h one,
  to show what the window costs.

## 8. Decision rule
- The run is VOID if any of C1-C4 fails, if > 10% of the 42 runs are dropped, or if the truth snapshot cannot be
  re-read from its committed hash. VOID means fix and re-run under this same text, once; a second VOID ends the gate.
- A cell PASSES if G1-G4 hold and it is neither FRAGILE nor UNDERPOWERED.
- **Product scope follows the cells:** the client may show threshold T at lead L only if (T, bin(L)) PASSED.
  - **Minimum to build the client at all:** 25 kn passes in B1 AND B2.
  - Leads past the last consecutive passing bin for a threshold are not shown for that threshold (a labelled "not
    verified at this lead" state, never a different model).
- Each cell's verdict, and the scope that follows, goes in `results/gust-ens-risk-v1.md`, a SCOREBOARD row and the
  session log. No re-run, re-score or rule change after a result; a new idea is a new gate (v2).

## 9. Unmeasured items (named now; none of them can be read as a pass)
- Open ocean away from buoys, and land away from coastal ASOS: not scored. The product is verified for marine and
  coastal exposure only, and says so.
- Native steps between the scored ones (e.g. 87, 90, 150-162 h) are not scored; they share their bin's verdict
  because they share its window. The product shows native ENS steps only, never an interpolated hour.
- 12Z runs, and seasons other than October-November: not scored (one season, one cycle). The multi-week re-score of
  #1063 (due 2026-12-09) is separate.
- The 1 h window in B1: NDBC GST is a peak over each record's averaging period, so a window max under-samples the
  true 1 h peak; C5 and the calibration-in-the-large line report it, nothing corrects it.
- `PK WND` is reported only above 25 kt, so an hour whose peak is exactly 25 kt can be missed when no gust group
  carries it (a small low bias in the 25 kn event frequency at ASOS).
- Exceedance from a calibrated gust (EMOS, rank 1 of the review) is out of scope: this gate scores the raw member
  fraction. A calibrated version would be its own gate.

## 10. Cost (estimates, measured in the result)
- Hindcast (local, public data): 42 runs x <= 21 steps x 50 member messages x ~1.4 MB (measured message sizes
  1.29-1.43 MB) <= ~62 GB of byte-range reads from AWS, plus 42 x <= 16 HRES messages; reduced at once to station
  values (no GRIB kept). Never touches Render or Supabase.
- Publisher (built dark; GitHub Actions, once a day, 00Z run): 85 native steps x 50 members x ~1.4 MB ~ 6 GB of
  public-data reads per run, decoded and reduced in the job; written frames and egress are measured in the publisher
  PR before anything serves.
