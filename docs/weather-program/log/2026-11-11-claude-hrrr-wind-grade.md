# 2026-11-11: the HRRR wind lane graded against NDBC buoys over 25 days (branch `claude/hrrr-wind-grade-970`)

Brief (lead session, relaying ledger commitment seq 970, overdue since 2026-10-27T18:00Z): grade the HRRR wind lane vs
GFS against NDBC buoys over >= 14 days, by lead and coast, with the meas/coastal5 method; add a SCOREBOARD S9 row; if
the lane is worse than GFS by > 0.3 kn vector RMSE at any lead/coast with n >= 300, propose a skill-weighted or shorter
lane (NBM practice) to the owner. Offline only, public archives, no served change. This log is written only by this
session. All times UTC; the work ran 2026-11-11 22:00Z to 2026-11-12 05:00Z (the file carries the brief's date).

## 1. Verdict

**The rule triggers.** The lane is worse than GFS by more than 0.3 kn vector RMSE, n >= 300, at:

| lead | cell | lane - GFS vector RMSE, kn [95% CI, cycle bootstrap] | n |
|---|---|---|---|
| L3 | West coastal <50 km | **+0.41** [+0.24, +0.56] | 1976 |
| L3 | East offshore | +0.30 (0.303) [+0.11, +0.51] (marginal) | 790 |
| L12 | West coastal | **+0.62** [+0.35, +0.89] | 1973 |
| L24 | West coastal | **+1.47** [+1.13, +1.85] | 1973 |
| L36 | West coastal | **+1.49** [+1.06, +1.92] | 1973 |
| L24 | East+Gulf+West pooled | +0.49 [+0.33, +0.65] | 6177 |
| L36 | East+Gulf+West pooled | +0.58 [+0.35, +0.81] | 6176 |

- **East coastal is a tie at every lead** (-0.05 to +0.13 kn, every CI spans 0), as the 5-day grade found (log
  2026-10-09-hrrr-wind-lane.md §5).
- **West: the lane loses at all 20 coastal buoys at L36 (0/20) and 19 of 20 at L24.** It is not a few outliers. The
  lane's speed bias there is +0.84 kn against GFS's -0.54, and its direction MAE 30-32 deg against 25-27.
- **Gulf** (4 buoys, n ~ 200 per cell, under the n rule): the lane ties or wins coastal and is mixed offshore.
- **On the time taper (L47, w_t 0.5) the half-and-half blend beats both models**: pooled -0.22 kn vs GFS
  [-0.35, -0.09], East coastal -0.39, Gulf -0.35/-0.43, West -0.03; raw HRRR there is +1.06 kn worse than GFS.
- **Raw HRRR (native 3 km cell, rotated) is worse than the lane in 34 of 35 E/G/W cells.** The 0.25-deg area mean
  helps at the buoys, and the blend with GFS helps again (L47, and the feather zone at L47).
- **The space feather zone (0 < w < 1, 8 buoys) grades worse than GFS at L3-L36** (+0.40 to +0.82 kn), while it sits
  between raw HRRR and GFS. Any HRRR weight there costs accuracy at these leads.

D-017 reopens (its stated condition). §4 holds the proposal; nothing served changes in this PR.

## 2. The grade (instrument: `backend/scripts/grade_wind_lane_ndbc.py`, evidence `evidence/hrrr-wind-grade-2026-11-11.json`)

100 extended cycles 2026-10-15 00Z to 2026-11-08 18Z (25 days), leads 3/12/24/36/47 h, 38,709 matched pairs, 80 buoys.
Vector RMSE / speed MAE / direction MAE, knots and degrees; n = matched pairs (direction MAE uses the n_dir pairs
whose observed 10 m wind is >= 4 kn; every n_dir is in the evidence JSON).

| lead | cell (buoys) | n | lane | GFS | raw HRRR | lane - GFS [95% CI] | buoys lane better |
|---|---|---|---|---|---|---|---|
| L3 | E+G+W full-weight (64) | 6176 | 5.45 / 2.60 / 17.5 | 5.21 / 2.57 / 16.4 | 5.56 / 2.52 / 18.1 | +0.25 [+0.15, +0.34] | 17/64 |
| L3 | East coastal (29) | 2722 | 5.68 / 2.99 / 16.2 | 5.58 / 3.00 / 15.7 | 5.61 / 2.68 / 16.6 | +0.11 [-0.01, +0.21] | 9/29 |
| L3 | East offshore (8) | 790 | 5.92 / 2.34 / 15.3 | 5.61 / 2.17 / 13.7 | 6.10 / 2.42 / 15.6 | +0.30 [+0.11, +0.51] | 3/8 |
| L3 | Gulf coastal (2) | 198 | 5.63 / 2.11 / 17.9 | 5.70 / 2.57 / 18.4 | 5.71 / 1.99 / 18.4 | -0.07 [-0.32, +0.23] | 2/2 |
| L3 | Gulf offshore (2) | 199 | 4.83 / 1.70 / 12.7 | 4.21 / 1.76 / 10.0 | 4.94 / 1.76 / 13.2 | +0.62 [+0.31, +0.96] | 0/2 |
| L3 | West coastal (20) | 1976 | 5.05 / 2.38 / 20.8 | 4.65 / 2.30 / 19.3 | 5.36 / 2.52 / 21.8 | +0.41 [+0.24, +0.56] | 3/20 |
| L3 | West offshore (3) | 291 | 4.80 / 2.14 / 17.7 | 4.24 / 1.99 / 16.1 | 5.06 / 2.24 / 19.1 | +0.56 [+0.07, +1.07] | 0/3 |
| L3 | feather zone (8) | 789 | 5.16 / 2.15 / 15.0 | 4.76 / 2.12 / 13.6 | 5.90 / 2.39 / 17.2 | +0.40 [+0.21, +0.58] | 3/8 |
| L12 | E+G+W full-weight | 6175 | 5.93 / 2.75 / 19.8 | 5.74 / 2.79 / 19.4 | 6.12 / 2.71 / 20.4 | +0.19 [+0.06, +0.33] | 25/64 |
| L12 | East coastal | 2723 | 5.93 / 3.02 / 17.7 | 5.97 / 3.13 / 18.1 | 5.99 / 2.76 / 18.1 | -0.04 [-0.19, +0.10] | 15/29 |
| L12 | East offshore | 790 | 5.89 / 2.36 / 15.4 | 5.89 / 2.29 / 15.1 | 6.10 / 2.45 / 16.0 | -0.00 [-0.26, +0.24] | 3/8 |
| L12 | Gulf coastal | 199 | 6.60 / 2.50 / 22.2 | 6.78 / 2.66 / 23.8 | 6.76 / 2.34 / 23.1 | -0.18 [-0.55, +0.23] | 1/2 |
| L12 | Gulf offshore | 197 | 4.06 / 1.68 / 11.3 | 4.36 / 1.70 / 12.5 | 4.09 / 1.68 / 11.8 | -0.30 [-0.64, +0.01] | 2/2 |
| L12 | West coastal | 1973 | 6.06 / 2.73 / 25.2 | 5.44 / 2.72 / 23.4 | 6.41 / 2.93 / 26.1 | +0.62 [+0.35, +0.89] | 3/20 |
| L12 | West offshore | 293 | 5.71 / 2.32 / 21.0 | 5.19 / 2.19 / 20.1 | 5.98 / 2.46 / 21.7 | +0.51 [-0.01, +0.95] | 1/3 |
| L12 | feather zone | 788 | 6.33 / 2.75 / 17.8 | 5.61 / 2.58 / 15.1 | 7.29 / 3.14 / 21.4 | +0.72 [+0.43, +1.04] | 2/8 |
| L24 | E+G+W full-weight | 6177 | 6.55 / 2.98 / 21.9 | 6.06 / 2.92 / 20.7 | 6.81 / 3.01 / 22.6 | +0.49 [+0.33, +0.65] | 21/64 |
| L24 | East coastal | 2725 | 6.16 / 3.05 / 18.7 | 6.21 / 3.21 / 18.9 | 6.33 / 2.88 / 19.4 | -0.05 [-0.20, +0.11] | 13/29 |
| L24 | East offshore | 790 | 6.40 / 2.47 / 15.9 | 6.36 / 2.48 / 16.2 | 6.57 / 2.59 / 16.3 | +0.03 [-0.23, +0.31] | 4/8 |
| L24 | Gulf coastal | 199 | 6.74 / 2.64 / 21.6 | 6.83 / 2.70 / 24.6 | 6.96 / 2.55 / 21.9 | -0.09 [-0.48, +0.32] | 1/2 |
| L24 | Gulf offshore | 197 | 4.76 / 1.89 / 12.7 | 4.73 / 1.95 / 12.4 | 4.83 / 1.95 / 13.2 | +0.03 [-0.53, +0.56] | 1/2 |
| L24 | West coastal | 1973 | 7.30 / 3.32 / 30.0 | 5.82 / 2.88 / 25.5 | 7.67 / 3.56 / 31.1 | +1.47 [+1.13, +1.85] | 1/20 |
| L24 | West offshore | 293 | 6.13 / 2.54 / 22.4 | 5.57 / 2.41 / 21.9 | 6.57 / 2.72 / 23.8 | +0.56 [+0.05, +1.06] | 1/3 |
| L24 | feather zone | 788 | 6.85 / 2.84 / 19.6 | 6.03 / 2.74 / 17.0 | 8.22 / 3.24 / 24.1 | +0.82 [+0.36, +1.29] | 4/8 |
| L36 | E+G+W full-weight | 6176 | 7.01 / 3.14 / 23.2 | 6.43 / 3.11 / 22.0 | 7.27 / 3.23 / 23.8 | +0.58 [+0.35, +0.81] | 18/64 |
| L36 | East coastal | 2725 | 6.64 / 3.12 / 19.9 | 6.51 / 3.34 / 20.2 | 6.84 / 3.08 / 20.3 | +0.13 [-0.19, +0.46] | 12/29 |
| L36 | East offshore | 790 | 6.71 / 2.56 / 16.9 | 6.82 / 2.76 / 17.5 | 6.86 / 2.64 / 17.6 | -0.11 [-0.60, +0.33] | 5/8 |
| L36 | Gulf coastal | 199 | 7.03 / 2.65 / 23.0 | 7.07 / 2.76 / 26.3 | 7.30 / 2.54 / 23.6 | -0.04 [-0.61, +0.54] | 1/2 |
| L36 | Gulf offshore | 197 | 4.90 / 2.00 / 13.5 | 4.68 / 1.94 / 13.3 | 5.09 / 2.10 / 14.2 | +0.22 [-0.31, +0.70] | 0/2 |
| L36 | West coastal | 1973 | 7.80 / 3.61 / 31.6 | 6.31 / 3.13 / 26.9 | 8.19 / 3.87 / 32.5 | +1.49 [+1.06, +1.92] | 0/20 |
| L36 | West offshore | 292 | 6.69 / 2.83 / 24.2 | 5.86 / 2.82 / 22.3 | 6.91 / 3.01 / 25.0 | +0.84 [+0.05, +1.61] | 0/3 |
| L36 | feather zone | 788 | 7.33 / 3.14 / 21.5 | 6.60 / 3.07 / 18.7 | 8.68 / 3.71 / 25.1 | +0.73 [+0.35, +1.14] | 2/8 |
| L47 (w_t 0.5) | E+G+W full-weight | 6161 | 6.52 / 2.99 / 22.0 | 6.74 / 3.22 / 22.7 | 7.80 / 3.44 / 25.9 | -0.22 [-0.35, -0.09] | 44/64 |
| L47 | East coastal | 2712 | 6.37 / 3.13 / 19.8 | 6.76 / 3.45 / 21.1 | 7.42 / 3.30 / 22.2 | -0.39 [-0.53, -0.25] | 24/29 |
| L47 | East offshore | 781 | 7.01 / 2.68 / 17.8 | 7.16 / 2.87 / 19.0 | 8.05 / 3.07 / 20.1 | -0.14 [-0.45, +0.11] | 6/8 |
| L47 | Gulf coastal | 199 | 6.55 / 2.50 / 22.6 | 6.90 / 2.76 / 26.1 | 7.42 / 2.73 / 24.1 | -0.35 [-0.62, -0.09] | 2/2 |
| L47 | Gulf offshore | 200 | 4.50 / 1.75 / 12.8 | 4.93 / 1.86 / 14.7 | 4.99 / 2.16 / 14.4 | -0.43 [-0.70, -0.17] | 2/2 |
| L47 | West coastal | 1976 | 6.68 / 3.18 / 27.4 | 6.71 / 3.29 / 26.8 | 8.48 / 4.07 / 34.7 | -0.03 [-0.28, +0.23] | 9/20 |
| L47 | West offshore | 293 | 6.55 / 2.45 / 24.7 | 6.56 / 2.83 / 24.2 | 7.60 / 2.82 / 28.7 | -0.01 [-0.44, +0.46] | 1/3 |
| L47 | feather zone | 791 | 6.91 / 3.14 / 19.0 | 7.06 / 3.32 / 19.8 | 9.26 / 3.94 / 26.4 | -0.15 [-0.31, +0.01] | 7/8 |

Great Lakes (outside the commitment's East/Gulf/West; 7 coastal buoys + 1 offshore, n 677-688 coastal) are in the
evidence JSON: coastal ties at every lead (-0.11 to +0.24); the one offshore buoy (45001-class) loses +0.8 to +2.9 kn.

Speed bias (the evidence JSON has every cell): the lane's bias is higher than GFS's in 33 of 35 E/G/W cells (not at
L12 East coastal or offshore). GFS reads the buoys ~1.1 kn low pooled. On the West at L12-L36 the lane flips to +0.5 to +0.8 kn high. West coastal by valid hour
(L24): lane 6.61 / 6.80 / 7.68 / 8.02 kn at 00/06/12/18Z vs GFS 5.51 / 5.97 / 6.00 / 5.80. The gap is widest in the
morning and afternoon, Pacific time.

## 3. Method (what is the same as coastal5, and what is not)

- **The coastal5 tooling was not in the repo.** `meas/coastal5.py` and `coastal5b.py` lived in the 2026-10-09
  session's scratchpad. That folder is now empty, and `git log -S coastal5` finds only the docs. The method was rebuilt
  from §5 of that log as a committed script. It reuses the production code rather than copying it:
  - `noaa_hrrr_wind_fetcher.wind_ranges`, `check_grid` (refuses a changed grid), `cell_index`, `area_mean` and
    `encode`;
  - `_hrrr_grid.rotate_to_earth` and `space_weight_np`;
  - `wind_lane.Lane` and `apply_wind_lane` itself, on a GFS `NormalizedProduct` of the buoys' corner nodes.
- **Lane, as drawn:**
  - the production blend at the 0.25-deg lattice nodes. A per-cycle `Lane` holds the graded leads and keeps the
    published horizon f48, so `time_weight` is the shipped one: 1.0 at L3-L36 and 0.5 at L47 (checked in the rows);
  - shipped defaults (`WIND_HRRR_FEATHER_KM` 200, `WIND_HRRR_TAPER_HOURS` 3; the script pops the env vars);
  - then bilinear to the buoy (scalar speed; direction from the bilinear u, v).
- **GFS:** NOAA GFS 0.25 (`noaa-gfs-bdp-pds` pgrb2.0p25 UGRD/VGRD 10 m), same cycle and lead, same nodes and bilinear.
  The served base is Open-Meteo `gfs_global`, which is this model; the 2026-10-09 grade used the same stand-in.
- **Raw HRRR:** the native 3 km cell under the buoy, rotated to earth. No area mean, no blend.
- **Leads** are from the 00/06/12/18Z extended cycles, the only cycles the lane ingests. In service the map shows a
  given hour from the newest published cycle, so a user sees a mix of these leads.
- **Buoys:**
  - NDBC `activestations.xml`, `type="buoy"`, met, 5-digit ids with WMO prefix 41/44 East, 42 Gulf, 46 West, 45 Lakes;
  - zone `full` where `space_weight_np` = 1 at the buoy (146 listed), `feather` where 0 < w < 1 (14 listed);
  - 80 of the 160 reported wind at the paired times (72 full, 8 feather). The rest are mostly CDIP wave buoys
    (462xx, 441xx) and seasonal Canadian lake buoys whose realtime2 files carry no wind.
  - The commitment said "101+": 101 was the 2026-10-09 count. This period has 80 wind-reporting buoys in that area.
- **Coastal** = < 50 km from the nearest HRRR land cell (`LAND:surface`, 3 km, read once from the 2026-10-15 00Z
  f00 file). East coastal 29 buoys, East offshore 8, Gulf 2 + 2, West 20 + 3.
- **Observations:**
  - NDBC realtime2 (45 days), the report nearest the valid time within +-30 min;
  - WSPD adjusted to 10 m by the neutral power law U10 = Uz (10/z)^0.11 (Hsu, Meindl & Gilhousen 1994);
  - z is the station page's "Anemometer height" (79 of 80 buoys; 4.1 m default for one). At z = 3.8-4.1 m the factor
    is 1.10-1.11, the flat x1.10 of the 2026-10-09 grade.
- **Metrics:**
  - vector RMSE of (speed x unit bearing) and speed MAE / bias, over all pairs;
  - direction MAE where the observed wind is >= 4 kn;
  - the 95% interval on lane - GFS resamples whole cycles (1000 draws), because buoys inside one cycle share its
    weather;
  - "buoys lane better" compares per-buoy vector RMSE.

### Controls

- **Null, GFS lattice alignment:** HRRR area mean vs the GFS sub-array, 12 cycles at f03. The RMS difference is
  smallest at offset (0, 0) (1.327 m/s) and grows at +-1 row or column (1.477-1.549). The GFS cut is not shifted.
- **Null, rotation:** a wrong rotation sign would hurt East and West alike. At L3 the East coastal cell ties
  (+0.11) while the West loses at every lead, and the signal grows with lead. That is not a fixed-geometry error.
- **The lane path is the shipped one:** time weights read back from `wind_lane.time_weight` are {1.0} at L3/L24 and
  {0.5} at L47 for every full-weight row.
- **Agreement with the earlier 5-day grade:** coastal L3 was a tie then (5.97 vs 5.99) and East coastal L3 is a tie
  now. Its L24 coastal pool (6.61 vs 6.47, lane worse) carried West buoys; the West is where the lane now loses.

## 4. Proposal to the owner (NOT implemented; a D-017 reopen)

The NBM does not take HRRR at full weight. It weights each member by its decaying-average error against analyses, by
lead and place. This grade shows why:
- a fixed blend beats both members (L47 at w = 0.5: pooled -0.22 kn vs GFS, -1.28 vs raw HRRR);
- HRRR's extended leads lose to GFS on the Pacific coast.

A diagnostic sweep (scratch `wsweep.py`, not committed) blends the drawn lane and drawn GFS at the buoy with a
constant HRRR weight w per lead and coast. It fits w on odd cycles and scores on the held-out even cycles. Scores
below are vector RMSE in kn; "base" is GFS at w = 0.

| lead | cell | fitted w | held-out RMSE at w (GFS / lane) |
|---|---|---|---|
| L3 | pooled | 0.5 | 5.08 (5.17 / 5.51) |
| L12 | pooled | 0.4 | 5.49 (5.70 / 5.93) |
| L24 | pooled | 0.3 | 5.73 (5.99 / 6.34) |
| L36 | pooled | 0.3 | 6.16 (6.45 / 6.93) |
| L24 | West coastal | 0.2 | 5.62 (5.83 / 6.85) |
| L36 | West coastal | 0.2 | 6.03 (6.25 / 7.37) |
| L24 | East coastal | 0.5 | 5.81 (6.17 / 6.10) |
| L36 | East coastal | 0.5 | 6.19 (6.54 / 6.76) |

The held-out blend beats both members in 26 of 28 cells. The two misses are L3 Gulf offshore and L3 West offshore,
both under n 300. It is an approximation: it blends at the buoy, not at the
nodes, but bilinear is linear, so the two differ only through the bearing's magnitude.

**Recommendation: a skill-weighted lane (option A).** Option B is the quicker interim.
- **A. Skill-weighted lane (NBM practice):**
  - HRRR's maximum weight becomes w_max(lead, region) instead of 1;
  - start from this table (about 0.5 East/Gulf at every lead; 0.4-0.5 West to L3, then 0.2 West beyond L12);
  - then let a running buoy grade update it (the decaying-average MAE, alpha 0.05, as the NBM does). That needs a
    wind truth lane: this script run on a schedule against the lane's stored cycles.
  - It keeps HRRR's coastal detail at half weight, and HRRR's coastal gradient was the measured gain (x1.37, §5 of
    2026-10-09). The served map would be smoother than today's lane but sharper than GFS.
- **B. Shorter lane, West only:** HRRR to L12 on the Pacific coast, then the existing 3 h taper to GFS. The East keeps
  the lane to 48 h, where it ties.
  - This is simpler and needs no new truth lane, but it leaves the measured 0.4-0.6 kn West loss at L3-L12.
  - It throws away the blend gain the L47 rows show everywhere.
- Either change moves the wind MAP's drawn numbers. Per D-001 it ships dark behind a flag, with a SCOREBOARD row on
  the owner's word. The spot points and ratings never read the lane (2026-10-09 §5 AST guard), so neither option
  moves a surf height or rating.
- The space feather zone loses to GFS at L3-L36 (+0.40 to +0.82 kn, 8 buoys). Under A it inherits the lower w_max
  and needs no separate change.

## 5. Limits

- One season (mid-Oct to early Nov), 25 days.
- Buoys sit 3-55 km offshore. The lane's case is coastal DETAIL (sharper gradients at the land-water edge), and no
  buoy measures that. This grades accuracy at the buoys only.
- The Gulf has 4 wind-reporting full-weight buoys, so every Gulf cell is under n 300.
- The GFS stand-in is NOAA GFS 0.25, not the bytes Open-Meteo served on those days.
- "As drawn" is bilinear on the 0.25-deg lattice; coarser zoom tiers (0.5, 2 deg) draw a coarser lattice.

## 6. Reproduce

```bash
cd backend   # needs numpy, requests, pydantic and gribberish (or pygrib); ~3 GB downloaded, ~150 MB cached
python scripts/grade_wind_lane_ndbc.py --start 2026-10-15T00 --end 2026-11-08T18 \
  --cache <scratch dir outside the repo> --out <grade.json> --rows <rows.jsonl>
```

The fetch took ~20 min with 8 workers. A rerun from the cache takes ~2 min.
- NDBC realtime2 keeps 45 days, so this exact window can be rerun only until about 2026-11-29. After that it needs
  NDBC's monthly historical files (not wired).
- Nothing touched the Render box, Supabase, any workflow or any env var.

## 7. Ledger

`ledger.d/claude--hrrr-wind-grade-970.jsonl`:
- line 1: a `finding` that fulfils commitment 970;
- line 2: a `pr_open` for the draft PR.
