# 2026-11-17 - G4: Copernicus ocean-model SST as water temperature (session gusts-currents-layers, Opus)

Registration: docs/weather-program/log/2026-11-15-opus-gusts-currents.md §11 (gates) and §11b (the director's arm R2: 1/12 deg
regional tiles hourly + 1/6 deg world 3-hourly). Started on David's word "start the G4 Copernicus SST prototype" (2026-11-17
17:48 EST). Branch `claude/g4-sst-water-temp` (off dev after #928's squash 0430f2eb0).

## 1. Candidate check, BEFORE any SST value was read (22:55Z; metadata and coordinates only)
- Candidate A `cmems_mod_glo_phy_anfc_0.083deg_PT1H-m`, ARCO `mdl-arco-time-014/.../_202406/timeChunked.zarr`: `thetao`
  shape [39360, 1, 2041, 4320], chunks [1, 1, 512, 2048], f4 blosc-lz4, fill 9.97e36, `cell_methods: area: mean`,
  degC, valid -10..40. The `elevation` coordinate has ONE value, -0.494025 m (positive up): the top model layer, the same
  level as the currents set. So `thetao` IS the top level and A is kept (section 11's rule; B not needed).
- Time: 'hours since 1950-01-01', whole hours, hourly, 2022-06-01T00 .. 2026-11-26T23 at the time of reading (forecast
  ~9.5 days past today). The hourly mean is stamped on the whole hour; which side of the hour it averages is not stated in
  the store's attributes - recorded as an open point for the observation check (it pairs the station's obs within that hour).
- Note: the service's own catalogue swaps the labels ("arco-geo-series" names the timeChunked store); the URL is what counts.

## 2. Build order (prototype)
1. WORLD 1/6 deg, 3-hourly (`water_temp_cmems`, set CMEMS/marine/water_temp/global_1p6, dark: FRAME_RASTER_WATER_TEMP_CMEMS):
   every second source cell, its own value (no mean, no interpolation), 2160 x 1021, f000..f237. Client: ICON's water temp
   (blank today) draws it, labelled; GFS / EURO keep their own skin temperature until the observation check's PASS line.
2. REGIONAL 1/12 deg tiles, hourly, on the pilot boxes: after (1) passes parity; needs a regional raster path on the client.

## 3. World set built and checked (2026-11-18 ~00:20Z; offline, nothing published)
- Offline publish (scratch, the real store; `publish_raster_frames.py --set water_temp_cmems`): bulletin 2026-11-17 00Z,
  80 frames f000-f237, 0 refused / 0 failed, 71.6 MB (0.90 MB per frame; §11b estimated 1.37), 47 s wall at 6 workers.
  The publisher's own check: worst 0.025 degC (the quantisation step).
- PARITY GATE (section 11, pass/fail): PASS. An independent reader (zarr's own v2 array reader on the store's `thetao`,
  `latitude`, `longitude`, `time` arrays; not the publisher's chunk code; the store refuses listing, so no xarray group open)
  at 8 nodes x 3 frames (f000, f120, f237): open ocean (0N 140W, 25N 40W, 55S 60E, 70N 0E), two coastal cells (next to land:
  33.67N 118.0W, 21.33N 158.17W), the antimeridian both sides (10S 179.83E and 180W). Every node's coordinate is exactly
  its source cell's; worst |frame - source| 0.0213 degC <= 0.025.
- Client (prototype): ICON's water temp maps to the CMEMS set, credit "Copernicus Marine · ocean model, top 0.5 m" (accessible
  label: top half metre, hourly mean, 1/6 degree, not a skin temperature, ICON has none). DEFAULT OFF until the observation
  check (the ICON bar: beat persistence); the lever reaches it. Looked at offline (production build, local CDN, lever on,
  ICON picked): the frame draws in light / dark / beach on desktop 1440 x 900 and phone 390 x 844, credit present in each.
  The desktop panel truncates the credit text at its width, as it already does for currents (the full text is the aria-label).
- NOT done yet: the observation check (needs the 14-day forward collection, one bulletin a day, started below); GFS / EURO
  stay on their skin temperature until its PASS line; the 1/12-degree regional tiles (step 2).

### 3b. Correction to §3 (appended; §3 is not edited)
§3's last bullet says the 14-day forward collection "started below". It has NOT started: no collector exists yet. It is a
ledger commitment (ledger.d/claude--gusts-currents-layers-172ef8.jsonl) and starts when built, as the next step of G4.
Draft PR #1025 carries this world set.
