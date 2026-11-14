# 2026-11-14 — opus: fog, water temperature and per-model air temperature raster sets (server publish half)

Session: the frame-carry side session, asked by the move-3 lane (David 11-13 23:35 EST to the director: "make fog, air temp and
water temp instant"; move 3 does the client read path and the harness). Branch `opus/raster-fog-temp` from dev `079866eb7`.
All sets DARK: each publishes only when its own repo variable is '1'. No variable was set and nothing was uploaded to the bucket.

## What changed

- `backend/services/frame_binary.py`: field **11 `visibility_m`**, u16, byte-shuffled; code 0 = no data, else round(m) + 1
  (descriptor scale 1.0, offset -1.0). Range 0..65534 m at 1 m steps; tolerance 0.5 m. GFS VIS tops out near 24.1 km.
- Water and air temperature REUSE field 7 `temp_c` (u16, 0.05 degC, -100..+3176 degC): the same unit, and a range that holds
  every skin temperature measured below. The index's `value_kind` tells them apart (`temperature_2m` / `skin_temperature`).
- `backend/services/frame_set_raster.py` SPECS: five sets, each with its own env switch (default off):

| set (`--set`) | key | source | grid | hours | variable |
|---|---|---|---|---|---|
| fog | GFS/weather/fog/global_0p25 | gfs.pgrb2.0p25 VIS surface | 1440 x 721 | PRESSURE_HOURS (hourly to f120, 3-hourly to f336; 193) | FRAME_RASTER_FOG |
| water_temp | GFS/weather/water_temp/global_0p25 | gfs.pgrb2.0p25 TMP surface (skin; SST over sea), K -> degC | 1440 x 721 | f000-f336 every 3 h (113) | FRAME_RASTER_WATER_TEMP |
| temperature_euro | EURO/weather/temperature/global_0p5 | ECMWF open data 2t | 720 x 361 | pressure_euro's steps (65; 00/12Z) | FRAME_RASTER_TEMPERATURE_EURO |
| temperature_icon | ICON/weather/temperature/global_0p5 | DWD ICON T_2M, pressure_icon's regrid | 720 x 361 | 0-180 h every 3 h (61; 00/12Z) | FRAME_RASTER_TEMPERATURE_ICON |
| water_temp_euro | EURO/weather/water_temp/global_0p25 | ECMWF open data skt (in today's open-data index) | 1440 x 721 | pressure_euro's steps (65) | FRAME_RASTER_WATER_TEMP_EURO |

- `.github/workflows/forecast-ingest-pilots.yml`: one step per set after the ICON pressure step, each gated
  `vars.FRAME_IMAGES_PUBLISH == '1' && vars.<VAR> == '1'` (unset = never runs), `continue-on-error`, the precip/pressure timeouts.

## Offline proof (real open data, `--out-dir`, local machine)

pygrib has no Windows wheel. The run decoded with ECMWF's `eccodes` 2.50.0 (the same ecCodes library pygrib wraps) through a
scratch `pygrib.fromstring` shim kept outside the repo. CI and production decode with pygrib as before.

| set | cycle | frames | MB per run | KB per frame (gz) | seconds per run | parity max (tol) | no-data nodes |
|---|---|---|---|---|---|---|---|
| fog | 2026-11-13 18Z | 193/193 | 111.0 | 575 | 27.7 | 0.499 m (0.5) | 0 |
| water_temp | 2026-11-13 18Z | 113/113 | 71.1 | 629 | 14.8 | 0.0249 degC (0.025) | 0 |
| temperature_euro | 2026-11-13 12Z | 65/65 | 10.1 | 156 | 9.5 | 0.0246 (0.025) | 0 |
| temperature_icon | 2026-11-14 00Z | 61/61 | 15.1 | 248 | 32.9 | 0.025 (0.025) | 0 |
| water_temp_euro | 2026-11-13 12Z | 65/65 | 31.5 | 484 | 12.7 | 0.0250 (0.025) | 0 |

All five together: 497 frames, ~239 MB per run (retention keeps two runs: ~480 MB in the bucket), ~98 s on this machine. Fog
is the heavy one: 1 m steps over 1.04 M nodes compress worse than temperature. A coarser step (e.g. 10 m) would cut it but
was not asked for; say so if the bucket cost matters.

## Value checks (an independent reader)

Each set's source GRIB for one hour was re-read with eccodes `codes_grib_get_data` (eccodes' own lat/lon per point, never
through our reorder or conversion code), then compared at random points that fall on the lattice
(`scratchpad/valcheck.py`, not committed):

| set | hour | points | max abs(frame - source) | range over every frame |
|---|---|---|---|---|
| fog | f064 | 3000 | 0.43 m (tol 0.5) | 14 .. 24136 m |
| water_temp | f111 | 3000 | 0.0249 degC | -59.50 .. 73.95 degC |
| temperature_euro | f063 | 712 | 0.0021 | -48.40 .. 46.00 degC |
| water_temp_euro | f063 | 3000 | 0.0117 | -54.35 .. 67.65 degC |
| temperature_icon | f060 | 1500 vs the GLOBAL nearest ICON cell (brute force) | see below | -58.35 .. 44.80 degC |

ICON vs the global nearest cell, by latitude: |lat| 0-30 all within 0.025 (n 487); 30-60 99.8% (max 0.086, n 527); 60-75 99.6%
(max 0.050, n 256); **75-90 62% (p99 1.96, max 3.42 degC, n 230)**. This is the existing `nearest_pick`, which this set reuses
unchanged from pressure_icon: it takes the nearest cell INSIDE the node's 0.5-degree lat/lon box. Near the poles that box is very
narrow in longitude, so the true nearest cell can sit in the next box. It is a property of the shared regrid, not new here.
Pressure varies smoothly near the poles, so it showed little there; temperature over the Antarctic plateau does show it.
Follow-up: rank candidates from the neighbouring boxes too.

Water temperature over land is LAND skin temperature (up to 74 degC in GFS, 68 in ECMWF): the client keeps covering land, as today.

## Not done / options

- GFS sflux (the 0.117-degree field Open-Meteo's gfs013 served): `gfs.tHHz.sfluxgrbfFFF.grib2` carries TMP:surface on a
  **regular Gaussian grid**, 3072 x 1536 (4.7 M points, 2.5 MB per message). Our frames need a regular lat/lon lattice, so it
  would need our own interpolation in latitude and ~4.5x the bytes (~2.8 MB a frame, ~320 MB a run). Not done; 0.25 deg ships.
- No client reads these keys yet (move 3's half). No SCOREBOARD row while dark (the lane's instruction).

## Addendum 05:15Z: EURO 2 m temperature at 0.25 deg

Move 3 relayed the director's resolution rule: a layer moves to own frames only where the set is at least as fine as today's .om
grid. Open-Meteo serves EURO 2t from ifs025, so the 0.5-degree EURO set would not be read by default. Added
`temperature_euro_0p25` (EURO/weather/temperature/global_0p25, every point, FRAME_RASTER_TEMPERATURE_EURO_0P25, dark). The 0.5-degree set
stays under its own switch. Offline, cycle 2026-11-13 12Z: 65/65 frames, 31.5 MB per run, 484 KB per frame, 14.6 s, parity max
0.0246 degC, no-data nodes 0. Independent eccodes read at f063: max 0.0021 degC over 3000 points; range -48.40 .. 46.00 degC.
Tests 27 (estate +27).

`GFS/weather/temperature/static/elevation_dz_v1.json` (the GFS temperature downscale asset) answers 400 on the CDN at 05:10Z. This PR does
not publish it. It comes from its own pilots step (`publish_temp_downscale.py`), gated on `FRAME_RASTER_TEMP_DZ == '1'`, and the
GFS temperature set was not yet in latest.json then either.

## Correction (05:51Z): the addendum header's time

The header 'Addendum 05:15Z: EURO 2 m temperature at 0.25 deg' was an estimate written ahead of the clock (LESSONS L-P10): the
section was committed at 05:09:57Z (`0f9866cd3`). The work it describes ran 05:05Z-05:09Z. Ledger: ledger.d/opus--raster-fog-temp.jsonl:2.
