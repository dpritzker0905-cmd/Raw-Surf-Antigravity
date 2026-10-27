# 2026-10-23 · claude · raster layers instant toggle + scrub (continued)

Continues `2026-10-22-claude-raster-instant.md` (same session, same brief: the owner's "instant load upon activating the toggle,
and instant scrub" for the seven raster layers). A new file only so this PR and #471 (which appends to yesterday's) never collide.

## P4: water-temp land fill, fast exact path (`claude/raster-wt-fast-fill`)
Client only; no served number, palette or legend change (byte-identical fields, below). ON, kill:
`window.__RAW_DISABLE_WT_FAST_FILL__ = true`.
- WHY: every water-temp hour decodes a whole-world field, then fills land cells from the nearest ocean cells and runs a coastal
  outlier QC (openMeteoProtocol's `oceanFillLandCells` + `coastalOutlierQC`), a cell-by-cell pass over ~4.7 M cells on the main
  thread. With zero network latency a water-temp hour took 1.35-2.05 s to load against 0.49-0.59 s for air temperature
  (yesterday's baseline).
- WHAT: `waterTempLandFill.js` holds the legacy pair verbatim (the kill path) and an exact fast pair: the QC ring is built once
  per mask (WeakMap) and the fill walks frontier/candidate lists instead of rescanning the grid. `openMeteoProtocol.js` calls
  `applyWaterTempLandFill` (937 -> 836 lines).
- PARITY, three ways: (1) Jest, 40 synthetic scenes (blobs, one-cell islands, spits, NaN holes, coastal spikes) byte-identical
  for QC + fill, fill alone, all-land / all-water edges. (2) In the browser, end to end, real GFS data (replayed): every decoded
  water-temp field the app publishes (`window.__DECODED_OM_TILES__`, after the fill), legacy (kill) vs fast from ONE build:
  6 of 6 fields identical (4,718,592 cells each, hours 10-15); with the coastal QC off on both arms, 4 of 4 identical.
  (3) POSITIVE CONTROL: QC on vs off really changes the field, and the probe sees it: 0 of 4 identical.
  Instrument: `frontend/scripts/raster-lab/probe_field_parity.js` (new).
- TIMING, paired arms from ONE build (lab `ARM_FLAGS`, new), GFS + EURO, z4/z6:
  | arm (desktop, recorded latency) | toggle p50 | step p50 / p95 | long jump p50 |
  |---|---|---|---|
  | legacy | 6.8 s | 1.8 s / 6.5 s | 4.6 s |
  | fast | 6.4 s | 1.8 s / 6.7 s | 4.4 s |
  With the recorded latency the step is network-bound (80 range reads, 5.05 MB per GFS hour), so the CPU saving hides. Zero
  latency (the CPU alone), GFS z4 + z6:
  | arm | desktop toggle | desktop step p50 / p95 | desktop long | phone toggle p50 (6 pairs) | phone long p50 |
  |---|---|---|---|---|---|
  | legacy | 2.3 / 2.2 s | 1.3 s / 1.7-1.8 s | 1.4 / 1.5 s | 11 s | 6.2 s |
  | fast | 1.6 / 1.8 s | 0.88-1.1 s / 1.3 s | 1.1 / 1.0 s | 11 s (one 16 s outlier) | 4.5 s |
  Desktop: about 0.4-0.5 s less main-thread work per water-temp hour, every metric in both combos. Phone (4x CPU throttle):
  cold hour loads faster (the slow alternating steps ~4 s vs ~6.5 s at z4, long jump 6.2 -> 4.5 s), the toggle a wash; phone
  pairs swing +-3-5 s run to run, so the phone gain is a direction, not a number.
- Honest scope: small. Water temp stays network-bound on the .om path until it moves to our own frames (SST is 5th in the
  free-GRIB build order); this only removes the CPU half until then.
- Lab instruments added here (README): `ARM_FLAGS` (levers for one arm), `probe_field_parity.js` (+ `FLAGS_A`/`FLAGS_B`),
  `OWN_CDN` byte counting and an own-frames frame classifier (for the pressure client, next PR).
