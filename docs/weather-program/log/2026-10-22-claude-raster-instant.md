# 2026-10-22 (claude, raster-instant session): the seven raster layers, instant on toggle and scrub

Written 2026-10-23T01:50Z. Owner, 2026-10-22 17:47 EDT: "all the layers in the weather simulation system ... instant load upon
activating the toggle, and instant scrub, when scrubbing the timeline"; then "start one session covering all 7 raster layers
(rain, radar, satellite, pressure, temperature, water temp, fog) ... measured first". Lead: local_d6b521eb.

## Baseline (dev 6a03c442a; the raster path is unchanged through d1dbeed8b)
Instrument: `frontend/scripts/raster-lab/` (lands with the P1 PR). Offline: built bundle + synthetic backend; every external raster
request (Open-Meteo S3 `.om` ranges, RainViewer, IEM, nowCOAST) recorded ONCE live, then replayed with its recorded latency through
6 connections per HTTP/1.1 host; the app's clock pinned to the recording. Our backend never touched. Per animation frame: the
visible raster slot, the hour and model its URL names, tile states, the evaluated (mid-transition) opacity of every slot.
Matrix: 7 layers x z2/4/6/9 x desktop 1280x800 / phone 390x844 (dpr 3, CPU 4x) x GFS + EURO; toggle, 10 single steps, one +96 h
jump; 96 combos, 1,056 actions. Raw JSONL and per-combo tables: the lead's side-session notes folder
(`raster-baseline-and-plan-2026-10-22.md`).

| layer | toggle to first correct pixels p50 (desktop / phone) | step p50 / p95 desktop | step p50 / p95 phone | long jump p50 (d / p) |
|---|---|---|---|---|
| rain | 3.4 s / 5.0 s | 1.4 s / 2.6 s | 1.6 s / 4.1 s | 1.8 / 2.3 s |
| satellite | 4.8 s / 6.1 s | 1.5 s / 3.6 s | 1.8 s / 4.5 s | 2.6 / 3.5 s |
| pressure | 2.8 s / 4.0 s | 0.95 s / 1.6 s | 1.3 s / 2.3 s | 1.7 / 1.9 s |
| temperature | 5.1 s / 6.5 s | 1.4 s / 3.7 s | 1.9 s / 5.6 s | 3.0 / 3.9 s |
| water_temp | 5.9 s / 12 s | 1.7 s / 4.9 s | 3.0 s / 10 s | 4.1 / 8.4 s |
| fog | 3.2 s / 3.9 s | 1.3 s / 1.5 s | 1.5 s / 1.8 s | 1.6 / 1.7 s |
| radar | 9.5 s (z2-z4) .. 0.33 s (z9) / 4.3 s | 7 ms / 8.5 s | 27 ms / 4.6 s | 3.2 / 1.7 s |

- Frame-changing steps at or under 100 ms: 0 of 112 per Open-Meteo layer per viewport. Radar inside its +-2 preloaded frames: 2-27 ms.
- Silent stale: every slow step showed the previous hour under the new label (85-380 frames per step); no status line admits a
  raster hold (ForecastTimeStatus reads only the marine drawn-frame record).
- Mixed-hour: every slot flip cross-faded for MapLibre's default 300 ms (9-12 frames with two hours lit); radar 250 ms (5-11);
  per-tile fade-ins on temperature, water temp (200 ms) and radar (180 ms).
- Bytes per hour (GFS world field): rain 1.58 MB, satellite 3.6 MB, pressure 1.1 MB, temperature 4.6 MB, water temp 5.05 MB,
  fog 1.3 MB; EURO 1.05-1.64 MB.
- Causes: one neighbour chosen by index PARITY (hits every other forward step); whole-world fields; 8 MiB block cache and
  `cache: 'no-store'`; tiles queue FIFO behind the neighbour's; water-temp land mask on the main thread.

## Plan (agreed with the lead 2026-10-23 01:34Z)
P1 frame cache + hard cut + directional neighbour; P2 honest raster status line; P3 persistent .om block cache; P4 decoder
priority, races, water-temp mask off the main thread; P7 viewport-bounded reads. P5 directional S3 prefetch bounded to one or two
steps (S3 open data, CC-BY-4.0). On hold for the owner's licensing answer: P6 toggle prewarm, P8 RainViewer preload.

## PR: data credit beside the raster legends (`claude/raster-data-credit`)
- Found: the map's attribution control is off (`MapWebGL attributionControl={false}`) and no raster legend named its source.
  Open-Meteo's spatial data is CC-BY-4.0 (credit with a licence link next to the data); RainViewer asks for "Rain Viewer" with a link.
- Fix: `LayerDataCredit.js`, a small link beside the legend label in all three layouts (desktop panel, mobile collapsed, mobile
  expanded): "© Open-Meteo · CC BY 4.0" (open-meteo.com/en/licence#maps) for rain, satellite, pressure, temperature, water temp
  and fog; "© RainViewer" for radar. Legend text colour (light / dark / beach), a real link with an accessible name, new tab.
  No palette, legend scale or served number changes. Kill: `window.__RAW_DISABLE_LAYER_DATA_CREDIT__ = true`.
- MapWeatherControls.js stays at 957 lines (its ratchet). Tests: LayerDataCredit (4) and the 8 suites that render the controls.
