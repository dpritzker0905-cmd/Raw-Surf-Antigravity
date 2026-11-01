# 2026-10-25/26 · claude · air temperature: elevation (lapse-rate) downscaling (dark)

The owner, 2026-10-25 (relayed by the lead): "Go with your recommendation if that is state of the art". The recommendation was
temperature at 0.5 deg plus elevation downscaling. The lead approved arm (a) in the shader with 1/16 as the default, under
conditions: a paired bootstrap gate (1/16 vs 1/8), a baked 1/8 fallback, the instant contract (the first paint never waits; the
correction fades in), the known limit recorded, dark, and a SCOREBOARD row.

## Why arm (a), and why not Open-Meteo as the yardstick
The evidence (scripts and JSON) is in shared notes `raster-resolution-2026-10-24/`.
- **Open-Meteo is another model on its own smoothed terrain.** Downscaling ours to the REAL ground moved terrain points AWAY
  from .om (High Atlas +2.4 -> -4.5 C): the ground there averages 3,031 m against GFS's 1,966 m.
- **Positive control:** downscaling ours to .om's own terrain (Open-Meteo's static HSURF) closed the gap, 1.81 -> 0.66 C mean
  (flat points within 0.16).
- **So the judge is observations:** METAR 2 m temperature at 31 airports, valid 25 Oct 00/03Z (night in the Americas) and
  12/15/18Z (day). That is 102 mountain station-hours and 50 flat ones. Model minus observed, mean absolute error (bias):

| arm | mountain (n=102) | >= 300 m off the model terrain (n=53) | flat (n=50) |
|---|---|---|---|
| as shipped (0.5 deg, uncorrected) | 2.87 (-1.33) | 3.91 (-3.19) | 1.53 |
| (a) -6.5 K/km, the REAL asset (1/16) | **2.05** (+0.68) | **2.19** (+0.37) | 1.47 |
| (a) at each station's exact elevation (the ceiling) | 2.07 | 2.14 | 1.47 |
| (b) the model's local lapse rate (2 m -> 850/700/500 hPa) | 2.42 | ~2.7 | 1.47 |
| Open-Meteo .om today (13 km) | 2.46 (-0.58) | 3.03 (-2.00) | 1.61 |

- (a) wins by night and by day.
- (b) reads the nocturnal inversion, so it barely warms the valleys.
- Where a station is under 10 m off the model terrain, nothing moves more than 0.07 C.

**KNOWN LIMIT (recorded, not fixed here: one variable at a time).** By day, (a) overshoots at stations >= 300 m off the model
terrain: bias **+1.5 C** (valleys too warm). At night it is +0.04. A diurnal blend would be a separate, measured change.

## The gate: 1/16 vs 1/8 (the lead's condition)
Paired bootstrap (10,000 resamples) of |err at 1/16| - |err at 1/8| at stations >= 300 m off, with dz from the CLIENT's own
`downscaleAt` on each real published asset:

| | mean | 95% CI per station-hour (n=53) | 95% CI by station (11 stations) |
|---|---|---|---|
| \|err 1/16\| - \|err 1/8\| | **-0.77 C** | **[-1.13, -0.41]** | **[-1.41, -0.18]** |

Neither interval includes 0, so 1/16 ships as the default and 1/8 is the fallback. MAE at those stations: 1/16 2.19, 1/8 2.95,
as shipped 3.91. The largest gains are in narrow valleys: Cusco -2.6, Innsbruck -2.1, Kathmandu -1.7, Samedan -1.6 C.

## What (dark, inside the dark air-temperature own-frames path)
**Asset** (`backend/services/raster_downscale.py`, `scripts/publish_temp_downscale.py`):
- dz = ETOPO 2022 15" (every 16th point = 1/15 deg) - GFS 0p25 HGT surface on the frames' 0.5-deg lattice, bilinear (as the
  shader samples the frames). Sea = 0.
- uint8 codes in 25 m steps (+-0.08 C); 3 cells of 14.6 M clip at +-3175 m; p99 |dz| = 675 m.
- Longitude tiles <= 4096 columns, each with one overlap column, so linear filtering never seams; gzipped and content-addressed
  (immutable).
- Full: two tiles of 2701 x 2700, **1.94 MB**. Fallback (2 x 2 box mean, 2/15 deg, tiles <= 2048 columns): two tiles of
  1351 x 1350, **0.49 MB**.
- Descriptors at fixed versioned paths (no-cache, 1.3 KB), fallback first, then the full one.
- Built once (37-52 s download + 7.5 s build), opt-in step `FRAME_RASTER_TEMP_DZ=1`; the script exits at once when current.

**Client:**
- `ownRasterDownscale.js` fetches the asset ONCE per page, on the first air-temperature toggle, through the static frames' fetch +
  inflate (off the main thread, low priority). It takes the fallback when `navigator.deviceMemory <= 2`.
- `ownRasterLayer.js` uploads the tiles as R8 textures with LINEAR filtering, one tile per frame. The shader adds
  `weight * lapse * dz` BEFORE the colour lookup; the weight fades 0 -> 1 over 400 ms once every tile is resident. Until then the
  field draws uncorrected: the first paint never waits.
- Tiles wider than MAX_TEXTURE_SIZE, or a GL error on upload (two one-off reads per asset, never per frame), drop the asset once
  and the hook loads the 1/8 fallback.
- The credit reads "NOAA GFS · terrain-adjusted" while the correction is on. Its tooltip and accessible name: "Adjusted to the real
  terrain height with NOAA ETOPO 2022 elevation (public domain), 6.5 C per km."
- Kill: `window.__RAW_DISABLE_RASTER_TEMP_DOWNSCALE__ = true`.
- **Parity:** the client's `downscaleAt` (the shader's arithmetic) on the real asset equals an independent Python mirror at all
  39 points (31 airports + 8 parity points): max difference 0.0 m.

## Measured in the app
Real clock, Alps z5.5. Local CDN with GFS 10-25 18Z temperature frames (113, 25.6 MB, parity 0.025 C) and both assets.
`probe_own_frames.js LAYER=temperature`, downscale on vs killed, alternated twice x dark/light/beach.

| arm | toggle -> first frame (median) | steps p50 / p95 (n=36) | +96 h jump (median) | asset | Open-Meteo requests |
|---|---|---|---|---|---|
| downscale on | 286.5 ms | 32 / 46 ms | 83 ms | 1.94 MB, landed 233-986 ms after the toggle (median ~308) | 0 |
| killed | 307.5 ms | 31.5 / 44 ms | 87 ms | - | 0 |

- The first paint is not delayed and the scrub is unchanged; the asset lands after the first frame and fades in.
- One light-theme run was slow in both measures (939 ms first frame): machine load, n=1.
- **Still:** shared notes `air-temp-downscale-alps.png` (uncorrected | terrain-adjusted | .om x three themes). The adjusted field
  shows the valleys (Rhone, Aosta, the Po's edge) warm and the ridges cold, at finer detail than .om's 13 km.

## Credit
Elevation: NOAA NCEI ETOPO 2022 (15 arc-second global relief; U.S. Government work, public domain), read through NOAA CoastWatch
ERDDAP (dataset ETOPO_2022_v1_15s). Terrain difference against NOAA GFS (NODD, no restrictions, attribution requested).
