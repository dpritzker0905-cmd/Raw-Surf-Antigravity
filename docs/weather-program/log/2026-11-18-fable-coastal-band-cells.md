# 2026-11-18 Fable: the coastal band's cells, and a count of them on GFS's own field (coastal band, step 2)

Session: Fable repair lead (`e372475c`). Branch `fable/coastal-band-cells`, cut from `dev` at `db2107a75`.
A definition and a logging-only census. Nothing is stored, served or read from the band. No served number moves.

## 2026-11-18 23:07Z What was done, and why

**Asked for by David**, typed in this session: "Cover with agency data, start the coastal band"; "Start slice 2 once
the counter split is pushed"; "Open the slice 2 PR and send it to the advisor".

**The band** (`backend/services/_coastal_band.py`): an OCEAN cell of the world 0.25 degree lattice with land within
`width` cells (a square neighbourhood; longitude wraps, latitude does not), between 60S and 72N. Land and ocean are
the repo's own ETOPO grid, the one `bathymetry` reads. Counted from that grid:

| width | band cells, 60S to 72N |
|---|---|
| 1 cell (about 28 km) | 20,959 |
| 2 cells (about 55 km) | 38,504 |
| 3 cells (about 83 km) | 54,243 |

**The width is NOT decided here.** The advisor's red-team of the design (item 5): ETOPO's coast is not a wave model's
coast, so some band cells are land in a model and carry no value, and the width must be fixed from a count on a real
field. So this PR adds that count and nothing that depends on a width.

**The census** (logging only). `noaa_gfs_wave_fetcher.fetch_global_coarse` already decodes NOAA's whole 0.25 degree
wave-height field on every pass. Once per pass, off the first decoded field, it now calls `log_census`, which writes
one line to stderr: for each candidate width, the band cells and how many of them have no value in GFS's own field.
It re-indexes the field from GFS's layout (north-first rows, 0..360 longitudes), refuses a field that is not on the
0.25 degree lattice, never raises, and does no work when `COASTAL_BAND_CENSUS=0`.

## Checks

- `tests/test_coastal_band_cells.py`: 13 tests: the three counts above; ocean-only and nested; the rule on a
  hand-built grid including the date-line wrap and the no-wrap in latitude; the latitude limits; the census on a
  north-first 0..360 field; refusal of another grid; the log line; the hook never raising; the kill switch doing no
  work; the fetcher importing the sibling by path first.
- `tests/test_noaa_gfs_marine.py` and `tests/test_fetcher_script_imports.py` pass locally with the hook in place.
  The local interpreter is not the declared environment; hosted CI is the authority.
- CI lint gate clean. File size: the fetcher is 775 of 800 lines.
- NOT run: a real GFS pass. The hook has not yet printed a line from a real field.

## Expected reading on the first pilots run after merge (written before it runs)

One stderr line starting `[coastal-band census] GFS waves, band cells on the model's own field:` with the three cell
counts above. The share with no value should rise as the band narrows (cells nearest ETOPO land are the likeliest to
be land in GFS). If the line reads "not on the 0.25 degree lattice", GFS-Wave's grid is not what the code map said and
the band design needs a re-indexing step. If no line appears, the fetcher's stderr does not reach the job log and the
census must be surfaced another way.

## Not in this PR

ICON and EURO hooks (same call, in `dwd_gwam_fetcher` and `ecmwf_opendata_fetcher`; EURO must mask ECMWF's 9999.0
land value first). The count of catalogue spots with fewer than four valid corners (needs the model's wet mask beside
the spot list). Both come before the width is fixed.
