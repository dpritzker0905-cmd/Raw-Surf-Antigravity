# UNCERTAINTY AND EVIDENCE GAPS — 11.2

This audit covered far less than the 11.2 brief specifies. Everything below was **not performed**.
None of it is reported as passing anywhere in this audit.

## G-01 — Backend divergence (the most important gap)
Runtime testing ran against a **local** backend (1,294 products, partial ingest). Production
carries **19,995**. This already refuted one of my own findings. **Every data-coverage or
resolution claim in this audit is local-only.** Client-logic findings (RC-01…RC-05) are unaffected.

## G-02 — Projection entirely untested (Gate 2 BLOCKED)
No antimeridian, high-latitude, polar, bearing, pitch, DPR, resize, OceanMask registration or
coastline-alignment test. Only Florida/Bahamas at bearing 0, pitch 0, DPR 1. Gate 2 is **BLOCKED,
not passed**.

## G-03 — Capacity entirely unmeasured (Gate 6 BLOCKED)
No soak, no throttling, no mobile viewport, no DPR 2, no heap snapshots, no allocation profiling,
no DevTools performance trace, no React Profiler, no React Scan. The cold-start and FPS numbers
recorded are single observations on a cold local backend, not an envelope.

## G-04 — No recordings, traces or profiler captures
No screen recordings, no Playwright traces, no HAR files, no `evidence/recordings/`,
`playwright-traces/`, `react-scan/`, `react-profiler/`, `devtools-performance/` content. The brief
requires reviewing recordings; none were captured, so none were reviewed.

## G-05 — Single browser
Chromium only. No Firefox, no WebKit. Metamorphic relation 11.8 (browser differential) **not run**.

## G-06 — Route-level mount/remount BLOCKED
The dev-mock session is cleared by a 401 on route change, forcing a logout and hard redirect. The
layer-level activate/deactivate lifecycle **was** tested (and passed); the `/map → /feed → /map`
remount cycle was **not**.

## G-07 — Failure matrix is one scenario deep
Only total weather-endpoint rejection was injected. **Not tested:** slow responses, out-of-order
responses, cancelled requests, partial data, invalid dimensions, NaN/Infinity, missing variables,
stale cache, stale service-worker assets, offline→online, WebGL context loss, resize during
loading, model switch during loading, worker error.

## G-08 — Synthetic canonical fields not injected
No uniform-east/west/north/south, diagonal, vortex, antimeridian-crossing, gradient, checkerboard
or hotspot fields. Row reversal, UV flip, handedness and tile placement are therefore **unverified
in either direction**.

## G-09 — No observational validation
No NDBC buoy, station, tide or radar comparison. No bias/MAE/RMSE/skill computed. Gate 5's
observational requirement is treated as an explicit limitation.

## G-10 — 10 of 12 layers untested
Only `waves` was validated end to end, with a brief `wind` and `swell_1` toggle. Precip, Radar,
Satellite, Swell 2, Wind Waves, Fog, Pressure, Air Temp, Water Temp: untested.

## G-11 — Timeline/scrubbing untested
Only forecast hour 0. No scrub, no play, no ±1h/±1d, no rapid-scrub stale-response race, no
end-of-range behaviour. Hour parity read `parity_match` throughout, but only at hour 0.

## G-12 — Artifacts specified but NOT produced
`STATE_MACHINE_MODEL.md`, `STATE_TRANSITION_MATRIX.csv`, `SCIENTIFIC_CONFORMANCE_MATRIX.csv`,
`CAPACITY_CERTIFICATION.md`, `ARCHITECTURE_CONFORMANCE_MATRIX.csv`,
`CURRENT_VS_PRIOR_FINDINGS_LEDGER.csv`, and most `evidence/` subdirectories. Their content is
partially covered in narrative form inside the main report (§5, §9, §11, §12) and should not be
mistaken for the full artifacts.

## G-13 — Report 11.0 and the Codex audit were not read in full
Reconciliation drew on Report 11.1's header and executive section plus the commit log. Report 11.0
(130 KB) and the original Codex audit were **not** read. Reconciliation is therefore partial.

## G-14 — The two code commits in the window are unvalidated
`679da3d9` (nearshore renorm flag flip) and `712e3bac` (manifest re-parse) were not exercised by
any test here.

## G-15 — RC-04 falsification — ✅ **CLOSED 2026-08-11**
RC-04 was re-run against the **production** backend (`raw-surf-antigravity.onrender.com`) with the
weather endpoints reached unauthenticated and a synthetic local-only session. **It reproduced
exactly**: `Raster Source: LOADED`, `Class: AUTHORITATIVE NATIVE`, `TRUTH VIOLATIONS: none`, with
`productId: null`; no retry, no recovery after 15 s of restored network. RC-01, RC-02 and RC-05
also reproduced. Total load imposed on production: **15 weather requests**. The test that was most
likely to overturn the verdict **confirmed** it. See
`PRODUCTION_FALSIFICATION_AND_FORENSICS.md`.

**New gap opened by that arm — G-16:** production-only findings PF-01 (15 requests per layer
activation, including a whole-planet `grid_series`), PF-02 (`selectedTileId` vs `productId`
disagreement) and PF-03 (`cols x rows` vs `vectorCount` disagreement) were observed but not
root-caused. PF-01 in particular touches the capacity axis that Gate 6 leaves unmeasured.
