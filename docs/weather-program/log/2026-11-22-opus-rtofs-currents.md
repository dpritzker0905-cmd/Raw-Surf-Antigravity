# 2026-11-22 · opus · NOAA Global RTOFS surface currents for the Currents layer's GFS picker (dark)

Lane: started by the director (local_d6b521eb) on 11-18; interrupted at the source probe when usage ran out, resumed 11-22 on
the director's word ("Publish frames dark (no served-number change without David's word) ... Keep the GFS model picker wiring
behind a kill switch"). Branch `claude/rtofs-currents`, rebased on `dev` 5bbf5ee25.

## Why

The Currents layer showed Copernicus Marine under all three pickers (GFS, ECMWF and ICON have no open surface-current forecast).
David wants each picker to show its own reading. GFS -> NOAA Global RTOFS (NOAA's own ocean model); EURO keeps Copernicus,
credited as Copernicus; ICON (no DWD ocean model) is a separate decision.

## Source, checked against the live servers (2026-11-22)

- AWS `noaa-nws-rtofs-pds` has `rtofs_glo_2ds_fHHH_diag.nc` and `_ice.nc` only. The diag velocities are
  `u_barotropic_velocity` / `v_barotropic_velocity`: the DEPTH MEAN, not a surface current. Not usable for this layer.
- NOMADS `pub/data/nccf/com/rtofs/prod/rtofs.YYYYMMDD/` also has `rtofs_glo_2ds_fHHH_prog.nc` (155 MB each):
  `u_velocity` / `v_velocity` (standard names eastward_ / northward_sea_water_velocity, m/s), shape (1, 1, 3298, 4500) =
  layer 1, the top model layer, gzip HDF5 chunks of 1100 x 1500; 2-D `Latitude` / `Longitude`; `MT` in days since 1900-12-31.
  Hours f000-f072 hourly, f075-f192 3-hourly; one 00Z cycle a day, written about 13 UTC; NOMADS keeps two days. Range
  requests are honoured (206).
- So the source is NOMADS. One frame reads the u and v chunks plus the HDF5 metadata by range (8 MB blocks).

## What shipped (dark)

- `backend/services/frame_set_raster_rtofs.py`: spec `currents_rtofs` (set `RTOFS/marine/currents/global_0p25`, the `currents`
  frame layout: speed kn + direction toward, uv_convention 1, the one-byte band under FRAME_RASTER_ONE_BYTE), every 6 h f000-f192
  (33 frames). Regrid: each ocean source cell to its nearest 0.25-degree node, the node takes the mean of u and of v (a vector
  mean, as the Copernicus set's 3 x 3 mean); fill (1.27e30), NaN and |u| or |v| > 10 m/s excluded. Each file's own `MT` must equal
  cycle + f, else the hour is refused. NOMADS politeness: two files in flight, requests spaced 0.4 s (all threads).
- Pilots workflow: one step, `if vars.FRAME_RASTER_CURRENTS_RTOFS == '1'`, continue-on-error, timeout 20 min, budget 900 s,
  service-role key from the job's `environment: supabase-service`. The data-health monitor passes the switch by name.
- Client: `setKey('currents', 'GFS')` returns the RTOFS set only while `rtofsCurrentsOn()`: the lever
  `window.__RAW_RTOFS_CURRENTS__ = true` (or localStorage), default `RTOFS_CURRENTS_DEFAULT_ON = false`; the kill
  `window.__RAW_DISABLE_RTOFS_CURRENTS__ = true` wins over both. EURO and ICON keep Copernicus. The credit follows the drawn set:
  "NOAA RTOFS · open-ocean current; ..." or "© Copernicus Marine · ...", never an atmospheric model's name.
- No served number changes: nothing publishes until the variable is 1, and nothing draws it until the lever is set. No
  SCOREBOARD row (none is served).

## Measured cost (one real build, cycle 2026-11-21 00Z, from this machine, scratch script `measure_rtofs.py`)

| | |
|---|---|
| frames built | 33 / 33 (0 failed, 0 refused), parity max abs err 0.0100 kn (band step 0.02) |
| downloaded | 2.99 GB in 371 range requests (~90 MB a frame; the grid once) |
| wall time | 163 s for the whole build (two files in flight) |
| frames uploaded | 14.3 MB gzip for the set |
| runs that find the cycle already published | two HEADs + the latest.json read, seconds |

Expected Actions cost: one build a day (the 19:45 UTC pilots run is the first after the ~13 UTC files; the 03:45 and 11:45 runs
find it published), about 3-5 runner minutes a day; NOMADS bandwidth is free. Retention drops the previous run's frames as the
Copernicus set does (`publish` -> `retention_deletes`).

## Science check: RTOFS against Copernicus at the same valid time (2026-11-22 00Z, both on the 0.25-degree lattice)

| band | nodes | vector correlation | mean rotation | median direction diff (> 0.5 kn) | mean speed RTOFS / CMEMS (kn) |
|---|---|---|---|---|---|
| 80S-47N | 541,490 | 0.601 | -1.8 deg | 24.9 deg | 0.466 / 0.432 |
| 47N-66N | 43,328 | 0.699 | +9.6 deg | 19.5 deg | 0.387 / 0.329 |
| 66N-90N | 98,978 | 0.621 | -8.5 deg | 21.8 deg | 0.128 / 0.147 |
| 20S-20N | 177,397 | 0.607 | +1.3 deg | 24.8 deg | 0.571 / 0.543 |

North of ~47N RTOFS sits on a tripolar patch; a grid-relative u/v there would show up as a large rotation or a collapsed
correlation in the two northern bands. It does not, so the file's "eastward / northward" names hold and no rotation is
applied. The two ocean models agree about as well as two independent models do (r ~ 0.6-0.7, directions ~20-25 deg apart on
currents above half a knot): this is a different reading, not a copy, which is the point of the picker. Node coverage: 2,148
nodes only RTOFS fills, 8,662 only Copernicus (coastlines differ). n = 1 valid time: a recorded check, not a skill score.

## Turning it on (owner's word needed for the client)

1. Repo variable `FRAME_RASTER_CURRENTS_RTOFS = 1` (publishes the set; nothing draws it yet).
2. After one publish, look with the lever `window.__RAW_RTOFS_CURRENTS__ = true` side by side with Copernicus.
3. On David's word: `RTOFS_CURRENTS_DEFAULT_ON = true` (kill stays `__RAW_DISABLE_RTOFS_CURRENTS__`).

## Not done / open

- The always-shown credit before a frame is drawn still names Copernicus (it does not know the model); once a frame is on
  screen the credit follows it.
- With the lever on before the set is published, GFS currents draw nothing (own-only layer, a miss); the availability check
  reads the `models` table, which still lists Copernicus for GFS. Fine for a dark lever; fold RTOFS into availability when the
  default flips.
- ICON's ocean source (Canada GIOPS or other) is the director's separate discussion with David.
