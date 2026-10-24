# 2026-10-24 · claude · air temperature from our own frames (dark client, GFS)

The lead (2026-10-24), after #531: "Next order: the lab-tool PR (small), then the temperature/cloud dark clients." The owner's ask
behind the raster lane (2026-10-22): "instant load upon activating the toggle, and instant scrub"; and (2026-10-22 21:35 EDT)
"we want free grib data". Stacked on #531 (per-model pressure isobars); the diff below is against it.

## What
DARK, behind the same lever as pressure. `window.__RAW_RASTER_OWN_FRAMES__` now also takes a comma list of layers:
`'pressure'` or `'temperature'` or both; `true` still means every own layer. Each layer is its own owner decision. Kill switches:
`window.__RAW_DISABLE_RASTER_OWN_TEMPERATURE__ = true` (this layer only), or the existing global and per-set kills.
- **Set:** `GFS/weather/temperature/global_0p5` (#515's publisher; field 7 temp_c). It is added to `staticFrames.STATIC_SETS`
  beside the pressure sets. GFS only: with EURO or ICON picked, the layer stays on the .om path for that model (no GFS frames under
  another model's label, so no stand-in tail).
- **Colour:** the .om path draws the tile library's own `temperature` breakpoint scale (no app override, not theme-varied), and
  the client reads that same object from `window.__OM_PROTOCOL_SETTINGS__`. The library's `getColor` equals `colorAtValue` at
  every 0.01 °C from −95 to 60 (0 mismatches in 15,500). Every breakpoint is a multiple of 0.5, so a 0.5 °C step LUT
  (−80..50, 261 entries) is exact at every boundary. Both facts are pinned by tests; the second test reads the library's
  `getColor` directly.
- **Opacity:** the temperature slot's zoom ramp (0.38/0.44/0.49/0.53), pinned to MapWebGL's paint like pressure's.
- **FIX (would have blanked every sub-zero area):** the shader treated any value `< 0` as no data. That was safe for pressure
  (always positive) but not for temperature. The no-data test is now `< −9000` (`MISSING = −9999`); the sentinel and the shader
  constant are pinned together.
- The shader's isoline lever (`__RAW_OWN_RASTER_ISOBARS__`) is pressure's only (`shaderIsobars`), so it never draws isotherms.
- **Not changed:** the store keeps one window, one LRU and one status record. The app shows ONE weather layer at a time
  (`useWeatherState.toggleLayer` sets `[layer]`, and nothing else sets layers), so two own layers never draw together. A
  per-layer store was built, measured, and then dropped as unneeded.

## Measured
Offline, against real GFS 18Z (2026-10-23) TMP 2 m frames from the publisher run (113 frames, 25.5 MB, parity 0.025 °C). The
frames were shifted −24 h to the replay clock (`own_frames_shift.js`), and the .om hosts were replay-only.
`probe_own_frames.js LAYER=temperature`, Europe z3, steps +3..+18 h and a +96 h jump.

| arm | theme | toggle to first frame | steps (6) | +96 h jump | Open-Meteo requests | frames / MB |
|---|---|---|---|---|---|---|
| own frames, run 1 | dark / light / beach | 173 / 261 / 240 ms | 24-41 ms | 47-85 ms | 0 | 14 / 3.06 |
| own frames, run 2 (machine busier) | dark / light / beach | 377 / 443 / 308 ms | 29-113 ms | 88-127 ms | 0 | 14 / 3.06 |
| own frames, PRESSURE control, run 2 | dark | 576 ms | 91-136 ms | 135 ms | 0 | 14 / 2.65 |
| today's .om path (lab.js, 2026-10-22 log) | desktop | 4.9-5.3 s | p50 56 ms / p95 3.7 s | 3.4 s | 337 -> 0 after the client fixes | 4.6 MB per hour |

The lab.js row is a different instrument; same-instrument pairs are run 2 against its pressure control. Within each run the
status line names the nearest stored forecast ("Showing Thu 8 PM: the nearest stored forecast"), and the credit reads
"NOAA GFS".

**THE ROW THE OWNER NEEDS: resolution.** The .om route for GFS air temperature is Open-Meteo's ncep_gfs013 (about 13 km). Our
frames are 0.5° (about 55 km). Side by side at the same instant (`own-temperature-GFS-{on,off}-dark.png`), the palette and the
large-scale pattern match, but mountain detail (the Alps, the Atlas) is visibly coarser in ours. Pressure is smooth, so 0.5° lost
nothing there; temperature follows terrain. The choices are a 0.25° set (1440 x 721, about 4x the bytes, about 0.9 MB a frame
gzipped) or accepting 0.5°. This is the owner's call, which is why the layer stays dark.
**Owed:** a same-run point parity row (our frame vs the .om values at points and hours). It needs a live .om read of a run we
also publish locally, after the 12:45-16:00Z no-live window.

## Checks
- Jest: `src/components/map src/tests src/__tests__`: 484 suites, 6,468 tests, all pass.
- eslint ratchet: pass. LOC ratchet: 0 new.
- Build: OK.
