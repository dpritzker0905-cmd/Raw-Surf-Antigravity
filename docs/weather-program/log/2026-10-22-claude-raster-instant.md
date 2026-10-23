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

## PR P1: raster frame swap (`claude/raster-frame-swap`)
Client only, no served number, palette or legend change; each part ON with its own kill switch.
- HARD CUT: raster-opacity-transition 0 and raster-fade-duration 0 on the six Open-Meteo slots and on radar's frame layers
  (`rasterFrameSwap.slotTiming`, `radarFrameHold.radarFrameTiming`). Kills `__RAW_DISABLE_RASTER_HARD_CUT__`,
  `__RAW_DISABLE_RADAR_FRAME_HOLD__`.
- DIRECTIONAL NEIGHBOUR: the third slot preloads one step in the scrub's direction (was the PARITY of the time index). Same one-hour
  lookahead, same requests. Kill `__RAW_DISABLE_RASTER_DIRECTIONAL_NEIGHBOUR__`.
- INSTANT FLIP + READY CHECK: a resident, loaded target is shown in the same React commit as the URL update. A slot is ready only with
  tiles in view AND a tile template that belongs to its URL. Found while measuring: MapLibre 5.24 marks a raster source loaded when an
  in-flight TileJSON request is aborted, and setUrl aborts the previous URL's request AFTER the new load cleared the flag. A
  re-pointed, still-loading neighbour slot then reads "loaded" with the OLD tiles under the NEW URL until the new TileJSON lands
  (~1 s): long jumps flipped in ~100 ms to an older hour's tiles, silently (first P1 build; fixed before the A/B below). Kill
  `__RAW_DISABLE_RASTER_INSTANT_FLIP__` (the old isSourceLoaded check).
- RETAIN ON TOGGLE OFF: a layer switched off keeps its slots; switched back on at the same hour/model/theme it shows at once; if the
  hour changed, nothing of it is shown until the asked hour is ready. Kill `__RAW_DISABLE_RASTER_TOGGLE_RETAIN__`.
- RADAR HOLD: the frame on screen stays until the asked frame's tiles are loaded, then one swap.
- Instrument: `frontend/scripts/raster-lab/` (rr.js record/replay, lab.js per-frame classes incl. evaluated opacities and tile
  templates, summarize.js). Probed and NOT observed: the decoder's shared-reader race (44 concurrent hour decodes = their solo
  decodes, byte for byte), so no field-load serialization.

### A/B (paired, interleaved per combo; zoom 4 and 6; GFS + EURO; replay of the recorded traffic, 0 external requests)

Per layer, all four combos (zoom 4 and 6 x GFS and EURO; fog and radar GFS only), frame-changing steps only; desktop 1280x800,
phone 390x844 dpr 3 with the CPU at 1/4:

| layer | viewport | step p50 / p95 (before -> P1) | steps <=100 ms | toggle p50 | long jump p50 | stale frames | mixed-hour | per-tile fades | blank |
|---|---|---|---|---|---|---|---|---|---|
| rain | desktop | 1.4 s / 2.7 s -> **55 / 1.4 s** | 0/28 -> **21/28** | 3.3 s -> 3.3 s | 1.6 s -> 1.7 s | 2033 -> 804 | 393 -> **0** | 0 -> **0** | 0 -> 0 |
| rain | phone | 1.8 s / 3.5 s -> **183 / 2.0 s** | 0/28 -> **2/28** | 5.4 s -> 6.9 s | 2.2 s -> 2.8 s | 1920 -> 545 | 176 -> **0** | 0 -> **0** | 0 -> 0 |
| radar | desktop | 13 / 1.0 s -> **6 / 1.0 s** | 6/8 -> **6/8** | 825 -> 726 | - -> - | 0 -> 63 | 61 -> **6** | 154 -> **0** | 15 -> 0 |
| radar | phone | 179 / 6.5 s -> **137 / 4.9 s** | 4/8 -> **4/8** | 3.9 s -> 3.1 s | - -> - | 0 -> 48 | 19 -> **3** | 27 -> **0** | 27 -> 0 |
| satellite | desktop | 1.7 s / 3.8 s -> **60 / 2.0 s** | 0/28 -> **18/28** | 4.7 s -> 4.7 s | 2.9 s -> 3.1 s | 2819 -> 1292 | 384 -> **0** | 0 -> **0** | 0 -> 0 |
| satellite | phone | 2.2 s / 5.3 s -> **296 / 2.5 s** | 0/28 -> **0/28** | 8.6 s -> 7.1 s | 4.3 s -> 3.9 s | 2321 -> 1089 | 119 -> **0** | 0 -> **0** | 0 -> 0 |
| pressure | desktop | 1.1 s / 1.9 s -> **53 / 60** | 0/28 -> **28/28** | 3.0 s -> 2.9 s | 2.0 s -> 1.9 s | 1744 -> 493 | 331 -> **0** | 0 -> **0** | 0 -> 0 |
| pressure | phone | 1.3 s / 2.4 s -> **240 / 349** | 0/28 -> **2/28** | 4.3 s -> 7.1 s | 2.0 s -> 2.6 s | 1672 -> 392 | 216 -> **0** | 0 -> **0** | 0 -> 0 |
| temperature | desktop | 1.8 s / 4.9 s -> **56 / 3.7 s** | 0/28 -> **18/28** | 4.9 s -> 5.3 s | 3.3 s -> 3.4 s | 3350 -> 1950 | 337 -> **0** | 148 -> **0** | 0 -> 0 |
| temperature | phone | 2.0 s / 6.0 s -> **193 / 4.4 s** | 0/28 -> **3/28** | 6.9 s -> 7.2 s | 4.3 s -> 4.2 s | 3049 -> 1893 | 158 -> **0** | 24 -> **0** | 0 -> 0 |
| water_temp | desktop | 1.8 s / 6.1 s -> **170 / 4.7 s** | 0/28 -> **13/28** | 6.7 s -> 7.0 s | 5.1 s -> 4.8 s | 3856 -> 2527 | 388 -> **0** | 117 -> **0** | 0 -> 0 |
| water_temp | phone | 3.1 s / 9.3 s -> **186 / 6.8 s** | 0/28 -> **3/28** | 10.6 s -> 13.3 s | 7.3 s -> 8.6 s | 3693 -> 2410 | 183 -> **0** | 39 -> **0** | 0 -> 0 |
| fog | desktop | 1.4 s / 1.6 s -> **51 / 56** | 0/20 -> **20/20** | 3.6 s -> 3.2 s | 1.6 s -> 1.6 s | 1145 -> 235 | 263 -> **0** | 0 -> **0** | 0 -> 0 |
| fog | phone | 1.6 s / 2.1 s -> **162 / 240** | 0/20 -> **3/20** | 4.5 s -> 4.7 s | 1.9 s -> 2.1 s | 1120 -> 260 | 141 -> **0** | 0 -> **0** | 0 -> 0 |

- Phone toggles (the 7.1 / 13.3 s P1 cells): the slow P1 rows coincided with other jobs on the test machine (probes, Jest, a ledger
  audit). Re-run alone (pressure + rain, GFS, z4/z6): toggle 3.6-3.8 s vs 3.7 s (pressure), 5.0-5.2 vs 4.8-4.9 s (rain): unchanged.
- Radar mixed frames after the hard cut: the first sampler counted a layer added this frame (target 0, MapLibre's default 1 until its
  first evaluation) as lit; with that state excluded, radar desktop z4/z6: mixed 0 / tile fades 0 (before: 2-10 mixed per step,
  16-50 fading frames at the toggle and first step).
- STALE frames fall (the neighbour is ready more often) but are not 0: P2 makes every remaining hold say so in words.
- Contract status: desktop tap steps meet it on pressure and fog (p95 56-60 ms) and at p50 everywhere; slow hours, phones and
  long jumps still wait for the hour's data (the free-GRIB frames plan, owner 2026-10-22 21:35 EDT "we want free grib data", replaces the source).
