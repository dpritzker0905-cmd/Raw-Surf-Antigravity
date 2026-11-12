# Partition truth: observed swell trains from buoy spectra, scored against stored model partitions

An offline instrument. It changes no served number, reads no Raw Surf service, and writes nothing into the repository.
It exists because the program had one truth for swell direction (the buoy's single BULK mean direction, SCOREBOARD S8)
and none for the swell **trains** that `SURF_PARTITIONS` would feed into the height and the rating.

## What it does

1. **Observed trains.** For each buoy-hour it rebuilds a frequency-direction spectrum from NDBC's realtime spectral
   files (`data_spec`, `swdir`, `swr1`) and splits it into wind sea and swell trains with a **watershed partition**
   (Gerling 1992; Hanson and Phillips 2001): steepest-ascent labelling in (f, theta), merge of neighbours whose saddle is
   at least 0.80 of the lower peak, a second merge for touching partitions within 20 degrees of each other, wind sea by
   **wave age** (1.3 x U10 x cos(peak - wind) > c_p). Each train has Hs, Tp and a mean direction.
   Directional model: per frequency one direction (alpha1) and the Kuik spread. The Maximum Entropy Method is available
   (`--model mem`) but is not the default, because it splits a single swell in two whenever r2 < r1^2 (Benoit 1992;
   pinned in `tests/test_partition_truth.py`).
2. **Model trains.** GFS-Wave 0.25 degree `SWELL/SWPER/SWDIR` slots 1 to 3 and `WVHGT/WVPER/WVDIR`, from the public NOAA
   AWS archive (the same files and slot order the ingest reads), nearest valid cell to the buoy, one byte-range GET per
   (cycle, forecast hour).
3. **Scores**, at +24/+48/+72 h, for the primary swell, the secondary swell and the wind sea: circular direction MAE,
   period MAE, height MAE, each against **persistence** (the observed train of the same rank at the issue time), with a
   95% interval from a moving-block bootstrap over UTC days (3-day blocks), the number of stations, the number of
   **independent station blocks** (complete linkage at 500 km: swell is coherent over hundreds of km, so nearby
   buoys are not independent samples), and a 180-degree control (the MAE the direction would have if the convention
   were reversed).
4. **Slot diagnostics.** How often the buoy's primary swell is better matched by model slot 2 or 3 than slot 1.

## Run it

```bash
cd backend
pip install numpy Pillow
export RAW_SURF_PARTITION_TRUTH_CACHE=/path/to/a/cache      # default: <tempdir>/raw_surf_partition_truth
python -m scripts.partition_truth.run_partition_truth --start 2026-10-12 --end 2026-11-08 --out result.json
pytest tests/test_partition_truth.py -q                      # the controls
```

Network: `www.ndbc.noaa.gov` and `noaa-gfs-bdp-pds.s3.amazonaws.com` only, sequential, 0.5 s apart. A 28-day window is
about 170 range reads of 7 MB. NDBC realtime keeps about 45 days, so cycles older than that need the NDBC history files
(not implemented: the instrument reports the gap instead of filling it).

## Controls (all in `tests/test_partition_truth.py`)

Positive: two separated swells with known Hs, Tp and direction are recovered (Hs within 8 to 12%, direction within 8
degrees); energy is conserved; a wind sea is labelled by wave age and a swell is not; north wrap-around. Null: one swell
is one partition; an empty spectrum has none; no wind gives no label. Pinned limits: trains that share frequency bins
are returned as one (a heave-pitch-roll buoy cannot separate them), and MEM's spurious split.

## What it cannot say

- The truth is a buoy model, not the ocean: two trains in the same frequency bin and direction gap under about 20
  degrees are one train here.
- Only GFS-Wave partitions are scored. EURO publishes no partitions (period bands only) and its CMEMS partitions need
  credentials; ICON publishes one total swell. Their scores are not produced by this instrument.
- Rank matching: model slot 1 is scored against the observed primary swell. WW3 numbers partitions per node, so the slot
  is not a tracked system; the slot diagnostics measure how much that costs.
- Offshore buoys only. This says nothing about nearshore height or the rating.
