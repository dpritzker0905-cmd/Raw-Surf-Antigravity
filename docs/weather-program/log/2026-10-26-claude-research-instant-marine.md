# 2026-10-26: research, instant and correct marine layers (researcher session)

**2026-10-26 18:47Z.** The lead asked for ranked, evidence-backed levers for the owner's goal ("All marine layers need to
be instant. Work perfectly. Display correct data.").

- **Deliverable:** `docs/research/instant-marine-sota-2026-10-26.md`.
- **No served number changes.** This is docs only: no product code, no flag, no SCOREBOARD row, and no request to the
  Render box.

## What was found

**Code roots of the 2026-10-26 owner test (read at `dev` `4b8563851`):**

- **Band ON takes every scrub step out of the frame store.** `staticFrames.js:494` returns false for any `surf` request,
  for every model and zoom.
- **EURO/ICON mid-zoom crops are refused on any regional overlap** (`staticFrameCrop.js:186-188`).
- **The model-switch hold blanks after 2 s** (`marineTransitionCoordinator.js:129`).
- **The band toggle can't release a scrub fetch.** The abort gate ranks by trigger, not target
  (`useMarineDataFetcherCore.js:858-862`).
- **Rating grids put scores in the height byte** (`WebGLMarineTextureEncoder.js:314`), so the band can't be turned off
  locally.

**Data:**

- **GFS-Wave is real every hour to f120** (AWS listing read), but `noaa_gfs_wave_fetcher.py:382` keeps every 3rd hour.
- **ECMWF open data has real EURO waves every 6 h to 360 h** (listing read: 85 steps), but `ecmwf_opendata_fetcher.py:172,367`
  stops at 240 h.
- Both are served-number changes for the owner (lever L6).

**Top five levers:**

1. the band as a uniform flip;
2. a model switch that holds until replaced, labelled by what is drawn;
3. closing EURO/ICON's CDN holes (`FRAME_TAIL_DOWNLOAD`);
4. request lanes keyed on the target;
5. rating frames on the CDN from the same chain.

Each has an offline acceptance test in the doc.
