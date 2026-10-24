# 2026-10-24 · claude · per-model pressure publishers: EURO (ECMWF open data) and ICON (DWD), dark

The owner, 2026-10-23 20:13 EDT: "Yes start it", answering "start the per-model pressure route?" after "We want each models
pressure showing". The lead's route: EURO publisher, ICON publisher, a client that follows the model selector with isobars and
H/L, owner clips, then all three flip together on his word (Open-Meteo pressure retires). This file: the two publishers.

## What (on top of #515's table-driven frame_set_raster)
- `SPECS` gain `hours`, `source`, `credit`, `license`, `source_url`, `upstream_provider` per set (GFS sets keep their values:
  the pressure sha256 and index/path pins still pass). `make_source(spec)` picks the source.
- `frame_set_raster_sources.py` (new):
  - EURO `EcmwfOpenDataSource`: ECMWF IFS open data, oper fc 0p25 msl, by the JSON `.index` byte range (~0.53 MB per step),
    the stream the box's ecmwf_opendata_fetcher reads. Grid starts at 180W: columns turned to 0E-first, then the shared
    every-second-point step onto the GFS lattice. 00/12Z cycles only (0-240 h; 3-hourly to 144, 6-hourly to 240; 06/18Z stop
    at 144). Credit "Copyright ECMWF ... CC BY 4.0".
  - ICON `IconOpenDataSource`: DWD ICON global pmsl (icosahedral R3B7, 2,949,120 cells), CLAT/CLON of the same run, 00/12Z
    (0-180 h, every 3 h). REGRID: each native cell is assigned once to the 0.5-degree box centred on the node it rounds to;
    a node = the MEAN of its box's cells (a box average: one bincount per hour); empty boxes (near the poles only) take the
    periodic linear interpolation along their row; each pole row is one point (the mean of its cells). Attribution
    "Deutscher Wetterdienst".
- Workflow: two opt-in steps (FRAME_RASTER_PRESSURE_EURO=1, FRAME_RASTER_PRESSURE_ICON=1), 30-minute timeouts, ICON with a
  900 s budget (61 bz2 files of ~4 MB).

## Measured on real runs (offline into a local folder; curl + ecCodes, pygrib has no Windows wheel)
| set | run | built | bytes | parity (frame vs its plane) | wall |
|---|---|---|---|---|---|
| EURO pressure | 2026-10-23 12Z | 65 / 65 | 11.5 MB | 0.05 hPa | 78 s |
| ICON pressure | 2026-10-23 12Z | 61 / 61 | 11.3 MB | 0.05 hPa | 227 s |
- EURO, independent: 10 places (both sides of the antimeridian, the South Pole, ...) at f000/f120/f240, frame node vs ecCodes
  `codes_grib_find_nearest` on the raw message: worst 0.041 hPa. EURO vs GFS frames at the same valid times: median |diff|
  0.5 hPa at f000 rising to 4.5 hPa at 240 h (two independent models drifting apart; an orientation or unit slip would read
  tens everywhere). The p99 (16-36 hPa) sits on high terrain, where each model extrapolates MSLP below ground its own way.
- ICON regrid ERROR vs the native grid (f000): 17.4 cells per box at the equator; 96.94% of nodes hold cells (the rest near the
  poles, filled along the row). Box mean vs the native cell nearest each node: median 0.036 hPa, p95 0.295, p99 0.749, max
  5.43 (cell-scale features over steep terrain, which a 0.5-degree field cannot carry). ICON vs GFS at the same valid times:
  median |diff| 0.5 hPa at f000, 1.1 at 63 h, 2.0 at 105 h, 3.1 at 168 h.

## Follow-ups from the #515 review (static-frames, relayed by the lead)
- `test_frame_parity_tolerance`: TEMP_C and CLOUD_PCT join the half-a-step parametrize (+2).
- An f003 `.idx` fixture with the two TCDC lines exactly as NOAA's GFS 18Z 2026-10-23 f003 file carries them (636 instantaneous,
  637 the 0-3 h mean): the selector takes 636's range, ending where 637 starts (+1, chain lane).
- Step timeouts: temperature, cloud and EURO back to 12 minutes (each built a real cycle in about a minute); ICON keeps 30
  (61 bz2 files of ~4 MB from DWD; 227 s locally) with a 900 s budget.
- Floors: chain +1 (2933), estate +9 (2731: the new sources file's 7 + the 2 tolerance cases).
