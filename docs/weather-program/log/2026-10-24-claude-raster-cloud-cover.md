# 2026-10-24 · claude · cloud cover (the 'satellite' layer) from our own frames (dark client, GFS)

The lead (2026-10-24): "the temperature and cloud dark clients, each with its measured row." The owner (2026-10-22): "instant load
upon activating the toggle, and instant scrub"; and "we want free grib data". Stacked on #540 (air temperature); the diff below is
against it.

## What
DARK, behind the same lever. Turn it on with `window.__RAW_RASTER_OWN_FRAMES__ = 'satellite'` (or `true`). Kill switch:
`window.__RAW_DISABLE_RASTER_OWN_SATELLITE__ = true`.
- **Layer:** the app's 'satellite' layer draws forecast TOTAL cloud cover (Satellite IR was discontinued, `useWeatherState`).
- **Set:** `GFS/weather/cloud_cover/global_0p5` (#515; field 8 cloud_pct; GFS TCDC, the instantaneous entire-atmosphere message).
  It is added to `STATIC_SETS`. GFS only: with EURO or ICON picked, the layer stays on the .om path.
- **Colour:** the tile library's own `cloud_cover` scale (0..90 % every 10, straight alpha). It has LIGHT and DARK colour sets,
  and the .om URL carries `dark=true` for the dark AND beach themes (`useOpenMeteoTileUrls`). `scaleForTheme` applies the same
  rule. A test checks the step LUT against the library's own `resolveColorScale` + `getColor` at every 0.05 % in all three
  themes, and pins the `dark=true` rule to the URL builder's source line.
- **Opacity:** the satellite slot ramp (0.55/0.60/0.65/0.70), pinned to MapWebGL.

## Measured
Offline: real GFS 18Z (2026-10-23) TCDC frames (113 frames, 12.4 MB, parity 0.5 %), shifted -24 h to the replay clock, with the
.om hosts replay-only. `probe_own_frames.js LAYER=satellite`, North Atlantic z3, steps +3..+18 h and a +96 h jump.

| arm | theme | toggle to first frame | steps (6) | +96 h jump | Open-Meteo requests | frames / MB |
|---|---|---|---|---|---|---|
| own frames | dark / light / beach | 234 / 220 / 186 ms | 17-39 ms (one 1,098 ms, dark +15 h, n=1) | 66-77 ms | 0 | 14 / 1.52 |
| today's .om path (lab.js, 2026-10-22 log) | desktop | 4.7 s | p50 60 ms / p95 2.0 s | 3.1 s | 384 -> 0 after the client fixes | 3.6 MB per hour |

The lab.js row is a different instrument. The 1,098 ms step is recorded as n=1 and not chased; no other step in three themes
exceeded 39 ms.

**THE ROW THE OWNER NEEDS: resolution, more visible than for temperature.** The .om route is ncep_gfs013 (about 13 km); our frames
are 0.5° (about 55 km). Cloud cover is close to 0 or 100 % per cell, so at 0.5° the cloud edges come out blocky, in steps one cell
wide (`own-satellite-GFS-{on,off}-dark.png`). The .om field's edges are smooth. The palette matches; the patterns differ only
because the runs differ (our frames are shifted). A 0.25° set (about 0.45 MB a frame gzipped, from 0.11 now) would halve the
step; the owner decides.
**Owed:** a same-run point parity row against the .om values (needs one live .om read of a run we also publish locally).
