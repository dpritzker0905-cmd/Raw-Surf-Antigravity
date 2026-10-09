# 2026-10-09 · Wind colour vs map colour: mute the basemap under the wind (light, beach)

Owner, after a visual test on live dev: "there is still some ambiguity to the wind color vs the color of the map in
light mode and beach modes. Research the best skills to help you make this work for wind. Use even newer special tests
that test it all through zooms and pans of all types, even erratic."

Skills and tools used: mapbox-cartography ("data visualization: muted base map, let data stand out"; blue = water,
green = parks), dataviz (compute the colour part, never eyeball it), a deep-research pass
(`research_notes/Wind overlay basemap colour separation/`), the project's palette checker (`scripts/wind-color`) and
colour-blind port (`windPaletteCvd.test.js`). Leonardo was not needed: no palette colour changed.

## What the owner sees, and why

Light and beach draw the wind field as a per-channel MULTIPLY tint over full-colour basemaps (navigation-day-v1: cyan
water, green parks; outdoors-v11: blue water, tan land, green landcover). Every colour on screen is the wind's hue times
the map's: beach's 6-16 kn aqua-greens over tan land come out vegetation green; a 33-40 kn gold over cyan water comes
out green; the coast land takes the same green as the sea beside it. The map seems to change colour instead of
carrying a wind layer. A multiply leaves the ground's contrast ratios unchanged, which reads as lighting or as the
surface's own colour, not as a layer (Singh & Anderson 2002). The leaders take hue out of the ground and keep it for the
data: Mapbox's own raster-particle example runs on Standard's `monochrome` theme; MapTiler draws weather on its Dataviz
style and veils the water; Esri's Light Gray Canvas exists for thematic overlays; earth.nullschool draws coastlines only.

Every earlier round judged the tint by its distance from the ground ("is it visible?"), never by whether it still
showed the legend's colour for that speed.

## New instruments (all offline: real Mapbox basemaps, real engine, served GFS fixture; the backend is never called)

`scripts/wind-bench/path-run.js` (PATH mode; `paths.js`, `ambiguity.js`; tested by `windBenchPaths.test.js`):

- **Camera paths:** pan, fling (inertia), zoomIn z5 → z10.5, zoomOut z11 → z5, pinch (off-centre focal point that
  drifts), jitter (z5.7-7.9 at 2 Hz across the close-zoom ramp, with a circling pan), erratic (seeded random walk:
  pan to 2500 px/s, zoom to 4 z/s, pauses, one-frame jumps; 3 seeds span z4.5-11). Virtual 60 Hz.
- **Two passes, so no paint change happens mid-path:** at rest, the original map, its water mask and line work at
  every sample camera; then the path flown with the mute as the app sets it, each sample captured twice (wind on, map
  alone) without advancing the engine.
- **Metrics per sample:**
  - `hue30`: share of wind-coloured pixels whose hue sits > 30° off the legend colour for the TRUE speed under that
    pixel (sampled from the served grid);
  - `mapLike` / `conv`: wind pixels that land within 5 ΔE00 of another map feature's colour (on screen / the style's
    own palette);
  - `windLike`: map area in legend colours;
  - `coast`: ΔE00 across every coastline crossing, past the stroke;
  - `keptMap` / `keptComp`: the original map's colour edges kept (hue-only edges included);
  - `retL` / `retW`: map-run's L* line retention;
  - `cover` and `pops`: the wind stays visible and does not flash;
  - `warpW` / `warpM` (field-only): the previous sample warped by the EXACT camera change. Wind on vs map alone, so
    the excess is the field's own swimming or popping in motion.
- **Controls:**
  - Dark (alpha-over, not muted) is the null control for hue.
  - The kill switch is the positive control.
  - Unit tests cover CIEDE2000 on Sharma's pairs, exact pan/zoom warps, and each metric's positive and null case.

`scripts/wind-color/check.mjs` now mutes the ground with the app's own function before compositing and adds a "hue
bent by the ground" line; `--no-mute` keeps the old picture.

## Two bench bugs found on the way (L-V19)

1. MapLibre fades paint changes over 300 ms. With the bench's virtual clock standing still, the water mask and the
   unmuted reference were read mid-fade (coast numbers off by a third). The bench sets the style transition to 0.
2. A data-driven colour (`match` on class) makes MapLibre re-parse the tiles in a worker. One frame after a change,
   some layers still show the old colour, and toggling per sample corrupted the frames after it (a round trip read
   "exact" only because the mute had never landed). References now come from a separate settled pass. In the app,
   turning the wind on re-parses the visible tiles once; the old tiles stay drawn meanwhile.

## Results

All runs are offline on the real basemaps. Sampling: every 8th frame (`--every 8`), a 120-frame warm-up, the served GFS
fixture, Mobile Bay. Each run covers pan, fling, zoomIn, zoomOut, pinch and jitter, plus erratic seeds 1-3 (9 runs per
theme and arm). Values are medians over runs of each run's per-sample median.

**Full particle layer** (`--arms off / mute`, final defaults):

| theme | arm | hue30 | hue30 worst run (p90) | coast dE00 | colour edges kept | L* lines kept land / water | pops |
|---|---|---|---|---|---|---|---|
| light | off | 0.381 | 0.959 (erratic 2) | 11.6 | 0.764 | 0.669 / 0.744 | 0 |
| light | mute | **0.028** | 0.196 (erratic 3) | 10.5 | 0.712 | 0.691 / 0.763 | 0 |
| beach | off | 0.256 | 1.000 (erratic 2) | 11.8 | 0.670 | 0.673 / 0.768 | 0 |
| beach | mute | **0.007** | 0.034 (erratic 3) | 9.8 | 0.602 | 0.710 / 0.807 | 0 |

**Field alone** (`--field`; the warp check needs a still field):

| theme | arm | hue30 | coast dE00 | L* lines land / water | warp excess p90 (wind - map) |
|---|---|---|---|---|---|
| light | off | 0.548 | 15.5 | 0.786 / 0.731 | <= 0.23 |
| light | water x0.85 / x0.92 / x1.0 | 0.030 / 0.030 / 0.030 | 19.1 / 14.7 / 10.3 | 0.831-0.793 / 0.755-0.734 | <= 0.36 |
| beach | off | 0.357 | 13.8 | 0.760 / 0.794 | <= 0.0 |
| beach | mute (x0.94) | **0.009** | 12.6 | 0.828 / 0.843 | <= 0.20 |
| dark | off = default (null control) | 0.040 / 0.041 | 9.2 / 9.1 | 0.738 / 0.882 | <= 0.0 |

Light's field sweep ran before the final water x0.90 (between the x0.85 and x0.92 arms). The full-particle rows use the
final defaults.

- **The wind reads true.** hue30 falls from 26-55% to 0.7-3% in every path, erratic included; dark (never muted) sits at
  4%.
- **Still glued in motion.** Zero flashes or drop-outs. The field's motion error exceeds the bare map's by at most 0.36
  dE00 at p90.
- **Lines are better.** L* line retention rises on land and water in both themes.
- **The coast costs some colour contrast.** Under the particles, its dE00 falls 9% (light) and 17% (beach): water and
  land lose their hue difference. Beach's x0.94 water is the darkest that keeps its colour-blind floor. The coastline
  stroke and L* lines carry the coast; the field-only sweep shows darker water buys it back (x0.85: 19.1) at the cost of
  a muddier sea.
- **The map's own colour edges.** Its hue-only distinctions (parks, landcover) are hidden while the wind is on:
  `keptMap` 0.88 light, 0.79 beach.

## The colour-blind floor on the muted ground

- **Beach:** the tint over muted water keeps ≥ 5 for all three dichromacies at water ×0.94 (5.08; ×0.92 gave 4.97,
  which set the default).
- **Light:** its field's 27-33 kn pair collapses for a deuteranope on ANY neutral ground. It was already 1.8 on light's
  own near-grey land before this change; only the cyan water split it (2.8). Muted, the water reads like the land (1.9).
  Pinned (never lower) in `windPaletteCvd.test.js`. The fix is a light FIELD colour-blind pass on a neutral ground
  (8 pairs under 5): a separate palette change for an owner A/B.

## Shipped (client only; no served number moves)

`src/components/map/windBasemapMute.js`, wired in `WebGLWindLayer.js`. While the wind is on, light and beach lose 85% of
their area colours' OKLab chroma (lightness kept). Water is also darkened: ×0.90 light, ×0.94 beach. Scope:
- muted: fills, background, extrusions, hillshade and the water's own lines, under the wind layer;
- untouched: roads, borders, labels and satellite imagery.

The mute is restored when the wind goes off. It re-syncs on a theme change, and never writes back a colour that is no
longer its own (a style diffed in place).

- Lever: `__RAW_WIND_BASEMAP_MUTE__` (0-1). Kill: `__RAW_DISABLE_WIND_BASEMAP_MUTE__`.
- Water lever: `__RAW_WIND_BASEMAP_WATER_L__`.
- Levers apply on the next wind toggle or theme change.
- Dark: untouched (alpha-over keeps the hue; the null control).

Watch items: light z9-10 hue-only map edges (parks, urban tints) are hidden while the wind is on (`keptMap` ~0.85); beach
z10 keeps 0.57 of its landcover edges; 2-5% of light's tinted land pixels sit within 5 ΔE00 of the muted water's grey.
