# Nearshore validation harness (offline)

Built 2026-10-23 after the owner saw ~2-3 ft (face) at Cape/Port Canaveral while the infobox said 6.5 ft. It measures,
from public buoys only, how much offshore wave energy actually reaches the nearshore by direction and period, and
checks the app's real surf chain against that. **It changes no served number and never calls the Raw Surf backend.**

## Truth hierarchy (read before quoting any number)
1. **Buoy-to-buoy transfer** (NDBC 41009 offshore -> CDIP 143 Cape Canaveral nearshore / CDIP 134 Fort Pierce) is
   measured truth for energy reaching ~10-16 m depth.
2. **Surf face height** has no instrument here. `observations.csv` is the only truth for the breaking step; it is sparse
   and every number from it carries its n.
3. Reference formulas are not truth and are labelled as such.

## Pipeline
| step | file | venv | output |
|---|---|---|---|
| fetch raw spectra (NDBC realtime + yearly history; CDIP archive via OPeNDAP ASCII subsets + realtime file) | `fetch_spectra.py` | spectra | `cache/<station>.npz` |
| rebuild every spectrum the same way (maximum entropy, Lygre & Krogstad) and split wind sea / swell (wavespectra `steepness`, no wind needed) | `partition_spectra.py` | spectra | `out/<station>_parts.npz` |
| measured transfer by offshore swell direction x period, explore vs hold-out years, lag sensitivity | `transfer.py` | either | `out/transfer.json` |
| the real chain: sheltering shape vs measured, breaking step on nearshore input, observation log | `chain_eval.py` | backend | `out/chain_eval.json` |

```powershell
cd <worktree>\backend\scripts\nearshore_validation
..\..\..\.venv-spectra\Scripts\python.exe fetch_spectra.py
..\..\..\.venv-spectra\Scripts\python.exe partition_spectra.py
..\..\..\.venv-spectra\Scripts\python.exe transfer.py
<backend venv>\Scripts\python.exe chain_eval.py
```
The spectra venv: `python -m venv .venv-spectra` at the worktree root, then `pip install wavespectra netCDF4 certifi`.
`cache/` and `out/` are local only (git-excluded).

## Controls (each step refuses to report when one fails)
- CDIP moment convention: the peak direction rebuilt from a1/b1 must match CDIP's own `waveDp` (median < 10 deg).
- Reconstruction: Hs of the rebuilt 2-D spectrum must equal 4*sqrt(m0) of the 1-D input; swell^2 + sea^2 must equal Hs^2.
- NDBC directions: `check_ndbc_dirs.py` (rebuilt peak direction vs NDBC's own MWD, history and realtime apart).
- Reconstruction direction: the rebuilt spectrum's mean direction must match the moments' (median < 15 deg).
- NDBC r1/r2 must lie in 0-1 after the history x100 rescale (refused otherwise).
- Transfer: the offshore buoy paired with itself gives exactly 1.000 (null); scaled x0.5 gives exactly 0.500 (positive).
- Every median carries a bootstrap 95% CI; direction is also split by season (`by_dir_x_season_all_years`).
- Chain: refuses to run if bathymetry is missing (the wrong venv silently serves offshore Hs).

## Traps found while building it
- netCDF-C's libcurl rejects this machine's TLS chain; Python's HTTPS stack accepts it. CDIP is read through Python
  (OPeNDAP ASCII subsets, realtime file downloaded whole), never by turning verification off.
- NDBC realtime and yearly files use different layouts AND frequency grids (46 vs 47 bins): parsed apart, regridded.
- NDBC and CDIP split swell from wind sea with different algorithms, so their own SwH columns cannot be compared:
  this harness re-partitions both with one method.
- The 41113/41114 NDBC stations are CDIP 143/134 rebroadcasts; NDBC holds no spectral history for them.

## Add a site
Add the station to `STATIONS`, a pair to `PAIRS`, beach points to `BEACHES` in `config.py`; rerun the four steps.
Add observations to `observations.csv` (UTC time, FACE height range in ft, which nearshore buoy describes it).
