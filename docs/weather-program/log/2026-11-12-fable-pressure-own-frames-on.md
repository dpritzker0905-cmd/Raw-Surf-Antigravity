# 2026-11-12 · Fable · pressure draws from our own frames by default

Branch `fable/pressure-own-frames-on`, draft PR #812, nothing merged. Client only; no served surf number moves, so no
SCOREBOARD row. The owner, 2026-11-12: "Yes, publish pressure".

## What changed

| Change | Module | Kill switch |
|---|---|---|
| `pressure` joins `DEFAULT_ON_LAYERS`: the layer draws from the published per-model sets (`<MODEL>/weather/pressure/global_0p5`) instead of Open-Meteo `.om` files; labelled isobars and H / L centres ride that field | `ownRasterFrames.js` | `window.__RAW_DISABLE_RASTER_OWN_PRESSURE__ = true` |

A model whose set is not in `v1/latest.json` keeps the `.om` path (per model, unchanged code).

## Ingest side

- The three pressure publish steps had never run: EURO and ICON are opt-in, and the GFS step's
  `vars.FRAME_RASTER_PRESSURE != '0'` is false while the variable is unset. Repo variables `FRAME_RASTER_PRESSURE`,
  `FRAME_RASTER_PRESSURE_EURO`, `FRAME_RASTER_PRESSURE_ICON` set to `1` (ledgered).
- Manual pilots run 43239161836: GFS published (cycle 2026-11-12T12Z, 113 frames), EURO published (00Z, 65 frames).
  **ICON did not publish**: one frame upload got HTTP 520 from storage and the step is `continue-on-error`, so the run is
  green. Read `v1/latest.json`, not the step colour. The next scheduled run retries it.
- The "rated static frames" step has the same `!= '0'` condition and is skipped the same way. Not touched (director's lane).

## Measured (offline: built client over `serve_synthetic.py`; the published GFS and EURO sets mirrored to a local stand-in
with 150 ms per response; `.om` ranges through `rr.js`; tool `frontend/scripts/offline-backend/scn_pressure_own.js`)

Before = the same build with the kill set. 12 ArrowRight steps at 300 ms; "settle" = ms from the last key until the wanted
frame is drawn. The two arms use different drawn tests (own: shown frame equals wanted frame; `.om`: map loaded with a slot
lit), so the gap is large, not exact. Phone = 390 x 844, dpr 3, CPU 4x. Fallback basemap (no map key) for these rows.

| GFS | settle before | settle after | toggle before | toggle after |
|---|---|---|---|---|
| desktop dark, 3 runs | 937 / 3824 / 6115 | 40 / 29 / 50 | 423 / 489 / 382 | 629 / 390 / 658 |
| desktop light, beach | 1044, 1168 | 9, 10 | 367, 403 | 516, 477 |
| phone dark, 3 runs | 35728 / 16837 / 16281 | 58 / 66 / 125 | 1168 / 1980 / 1516 | 1216 / 1907 / 1678 |
| phone light, beach | 3012, 16400 | 120, 109 | 765, 1460 | 1714, 1693 |
| EURO desktop dark | 841 | 46 | 449 | 510 |

- Bytes per run: 8 frames, 1.42 MB (own) against 104-140 range requests, 5.3-6.8 MB (`.om`).
- Phone Long Animation Frames during the scrub, dark, total ms (blocking ms): before 16170 (1709) / 10326 (2940) / 14220 (3769);
  after 5064 (2414) / 8841 (4218) / 8316 (3915). Total lower, **blocking higher**: correct sooner, not smoother.
- **Toggle is not faster.** With the real basemap (second pass, 6 steps) the phone toggle was slower in all three themes:
  3142 / 2887 / 3047 ms after against 1703 / 2215 / 1797 ms before; desktop 467 / 647 / 581 against 509 / 417 / 451.
  Not profiled; the isobar worker and the label layers are the suspects.
- ICON (set not published): the default arm fell back to `.om`, drawn in 611 ms, 0 own loads.
- The first pass of the `.om` arm recorded its misses live (once); runs 2 and 3 are pure replay.

## Visible differences the owner should see before merge

Sheets (dark, light, beach; before / after): `pressure-own-frames-desktop.png`, `pressure-own-frames-phone.png` (sent to the
owner, not tracked).

- Isobars every 4 hPa with their numbers, and H / L centres with their pressure.
- Credit reads "NOAA GFS" instead of "Open-Meteo · CC BY 4.0".
- The scrubber card gains "Showing <time>: the nearest stored forecast": our frames are 3-hourly, the `.om` path is hourly.
- On the tokenless fallback basemap there is no font to borrow, so isobars draw WITHOUT numbers or H / L. That is what the
  offline rig showed until the build was given the map key (L-harness: a build without the key cannot show these labels).

## Not measured

A real phone, Safari and Firefox, memory, ICON on its own frames (not published), the 14-day end of the scrub, play mode,
and the per-step latency inside the scrub (only the settle after the last key).
