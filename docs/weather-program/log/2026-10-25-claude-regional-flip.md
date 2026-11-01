# 2026-10-25 · lead · the regional zoom 7-9 flip (D-051)

The owner, 2026-10-23: "Yes: make the stored NOAA GFS tile the single zoom 7-9 source inside the pilot boxes (server dark flag + client bundles), retire the Open-Meteo lane there, and flip both together after live parity passes."
The owner, 2026-10-24 ~19:40 EDT: "Lets go with your recommendation if that is the best path forward"

## What was done (UTC)
- 12:50-13:21Z passive baseline: Render CPU (5-min max) 0.002-0.27 (the 12:00Z ingest burst in the window), memory 672-818 MB,
  5xx 2 then 0; health 0.83 s; admin regional_tile_first disabled, counts {}; #552 green and unmerged.
- 13:27:03Z Render `MARINE_REGIONAL_TILE_FIRST=1`; deploy live 13:30:06Z (ships only #558 over the running build).
- 13:47:15Z static-frames' live read, once: PASS 3/3 (18 grid + 18 series frames from the tile, max abs(dH) 0.0005 m).
- 13:52:17Z merged #552 (regional bundles ON by default) at its tested head.
- 13:55-15:00Z watch: 13 probes all from the tile in 0.19-0.50 s; app err_5xx 0; memory <= 766 MB; CPU <= 0.063. Closed clean.

## Lessons
- A live parity read needs a request the OLD path answers differently: per-hour /grid passed under both flags (a cold dynamic cache
  already serves the tile); the /grid_series page is what fails with the flag off. Static-frames found this offline first.
- The lead's own probe printed the LAST 12 characters of the health version (ec9b590d85e3) and briefly looked like an unknown
  build; it was #552's merge (fee207ac2...ec9b590d85e3). Print the leading SHA.
- The browser MCP restarted overnight; admin reads work from any same-origin static page (robots.txt), which avoids loading the
  map (three world series pages) just to reach the signed-in token.
