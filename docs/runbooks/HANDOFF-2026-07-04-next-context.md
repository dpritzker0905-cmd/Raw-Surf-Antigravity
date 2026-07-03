# HANDOFF → next context (written 2026-07-03 late eve; dev = `d9345f8b`)

**Standing order: dev-only, NO main pushes.** Netlify prod = `main`, ~620 commits behind.
⚠️ Bundle checks = the **MapPage CHUNK** (`src_components_MapPage_js-*.chunk.js`), never bundle.js;
a "reused" preview server can serve a pre-edit compile — verify chunk markers first.

## 0. Read order for a fresh context
1. This file. 2. `docs/runbooks/HANDOFF-2026-07-03-evening-full-audit-and-repairs.md` (the day's
   19-commit arc + regression map + landmine sheet). 3. `docs/audits/AUDIT-2026-07-03-weather-system.md`
   (front-to-back architecture truth — the system-brain weather doc is stamped PARTIALLY STALE; trust
   the audit §4 map). Memory index routes here.

## 1. FINAL PASS DELTA (this file's reason to exist) — `d9345f8b`

**User report:** wave animations fading in patches at z5.69 → 2.63 ("not tremendously bad,
needs adjusting"). **Root:** the §0B-a confidence fade rides the SAME encoded-|waveVec| channel
as seam coherence (dim threshold 0.7). The v1 LINEAR conf→magnitude map dimmed every cell below
~0.7 confidence — ~60+ mid-confidence patches worldwide instead of the ~dozen truly-incoherent
cells the design targets. **Fix:** `scaleUnitDirByConfidence` v2 = quadratic compression
`1−(1−conf)²·strength` (strength 0.75 default, `__RAW_CONF_FADE_STRENGTH__` live-tune, 0=off,
echoed at `__MARINE_DIR_CONFIDENCE__.strength`). Resulting behavior:
conf ≥ ~0.5 → NO dim (0.5→0.813, 0.65→0.908, both above the 0.7 threshold);
conf 0.2 → crest alpha ≈ 0.63; Baja-class 0.09 → ≈ 0.38 dim shimmer (never dead; clamp ≥0.05).
**Live-verified:** z5.4 Baja hotspot — crests across the whole viewport, annihilation core subtly
dimmer; z2.7 world view — zero dead patches, 31 FPS. FE 510/510.

If the user still sees patches: A/B with `__RAW_CONF_FADE_STRENGTH__ = 0` (isolates confidence
from SEAM fade — if patches persist at 0, they're seam-coherence or data, not confidence), then
`__RAW_DIR_COHERENCE_MIN__ = 0` (seam fade off). Tuning headroom: strength 0.5–0.6 softens
further without losing the Baja dim.

## 2. Current state of the wave-animation stack (all live-verified today)
- Directions: R_d-gate product verified via pinned-`ncep_gfswave025` + R_d block probes (never
  judge by raw best_match deltas — recipe in [[gate-rebuild-verified-2026-07-03]]).
- Motion: global u/v-vs-direction scan 0 mismatches/367; Baja SSW motion CONFIRMED correct.
- Visibility ladder: land dilation + validity gate (coastlines) → per-polygon mask culling
  (close zoom) → zoom-band crest self-contrast z3.5–4.4 (`__RAW_CREST_CONTRAST__`) → +20%
  low-range heatmap contrast (all 3 themes; surf-mode colormap byte-identical) → v2 confidence
  fade (this pass) → reduced-motion a11y damp (`__RAW_REDUCED_MOTION__`).
- Pipeline hygiene: state-authoritative dedup everywhere; surf-mode boot pin + mode-keyed
  caches/held frames; fetch-pending stamp identity-clear; inflight registry drains to [].
- /point: degraded/masked-bilinear coarse marine → direct 0.25° (cm-parity verified: Galveston,
  Oman 0.8, Tonkin 1.82); inland nulls → "--" never zeros; serving matrix 17/18 (ICON swell_2 =
  by-design GWAM gap, synthesized client-side).

## 3. NEXT (priority order)
1. **User eyeballs**: the reported zoom band (5.69→2.63) after `d9345f8b` deploys to the dev
   frontend they use; plus Baja 4-corner seam + close-zoom roam (still owed from night-2).
2. **Upgrade queue** (audit §6): ① encoded marine data tiles (JSON→raster, off main thread —
   biggest 1-CPU-backend win); ② two-texture hourly time-interpolation for continuous scrubber
   playback. Both designed-not-started.
3. **Docs**: proper rewrite of `frontend/system-brain/weather-simulation-system.md` (stamp is a
   tourniquet).
4. **Residual watch**: toggle-mid-fetch surf cache-label race (full fix = grid carries its own
   surf marker); SWR-reschedule-vs-dup-skip (terminated by dedup; only touch with a live repro);
   satellite black patches (2-min triage in [[satellite-black-patches-triage-2026-07-03]] FIRST).

## 4. Field-plumb template (the #1 regression trap, 3-month study)
Any NEW per-cell field must be added at ALL of: backend `GridVector` (schemas.py) → normalizer →
`mapNormalizedGridToWebGL` (componentUV + getConjoinedLayer + top-level) → **`useMarineWindData`
conform (THE last explicit-field-list rebuild — it ate is_valid AND dir_confidence)** → encoder
read chain (4 shape variants: top/sub × camel/snake). Grep `dirConfidence` for the worked example.

## 5. Levers quick-sheet
`__RAW_GPU__.anim` (per-frame truth) · `__MARINE_DIR_CONFIDENCE__` {scaledCells≈all, read min +
strength} · `__MARINE_INFLIGHT__` (active→[]) · `__MARINE_FETCH_PENDING__` (→null) ·
`__FETCH_OM_TILE__` · synthetic grids via `map.painter.context.gl` + `__ORIG_SET_WAVE_DATA__` ·
FBO-read `engine._residentWaveTex` · `map.stop()` before `jumpTo` (boot camera animates ~20s) ·
theme = localStorage `raw-surf-theme` + reload · kill switches: `__RAW_CONF_FADE_STRENGTH__`,
`__RAW_DISABLE_DIR_CONFIDENCE__`, `__RAW_CREST_CONTRAST__`, `__RAW_REDUCED_MOTION__`,
`__RAW_DIR_COHERENCE_MIN__`, `__RAW_DISABLE_DIR_DILATION__`, `NOAA_COARSE_DIR_{BLOCKMEAN,TOTAL_FIELD,CONFIDENCE}`.
