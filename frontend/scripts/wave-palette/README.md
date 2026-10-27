# Marine wave-palette repair evidence

Run from the repository root. The installed frontend dependencies must be available; no new package is required.
`metrics.py` / `cvd-swatches.py` need the existing `coloraide` environment used by `scripts/wind-color/cvd_check.py`.

```powershell
node frontend/scripts/wave-palette/measure.cjs evidence/field-before --baseline
node frontend/scripts/wave-palette/measure.cjs evidence/field-after
<coloraide-python> frontend/scripts/wave-palette/metrics.py evidence/field-before/gpu-ramp.json evidence/field-before/metrics.json --strict
<coloraide-python> frontend/scripts/wave-palette/metrics.py evidence/field-after/gpu-ramp.json evidence/field-after/metrics.json --strict
```

The baseline clarity diagnostic is expected to exit 1; the repaired ramp exits 0. Dark is measured as the immutable
reference and excluded from the repair's design floor. Full shader composite measurements are reported separately.
`--legacy` evaluates the page-load rollback arm. `--baseline` reads immutable source at `131d5d9e`.

`app-check.cjs <fresh-output-dir> [beach,light,dark] [desktop,phone]` runs the actual built app against synthetic marine
API fixtures. By default it uses `frontend/build`, blocks all external services and exercises the shipped tokenless
basemap fallback. `WAVE_BUILD` selects a private build directory. `WAVE_MAPBOX=1` permits read-only GETs to the explicit
Mapbox API/tile hosts, with the existing public map token read only into process memory. Build with a harmless token
placeholder to enable the app's Mapbox branch; the harness replaces that placeholder only on authorized map requests.
No token enters the build, receipt, source, HAR or trace. No API request reaches a live application backend.

`WAVE_CONTROLS_ONLY=1` limits the map capture to zoom 9 for sequential cadence/control/timing checks. Normal runs
capture zooms 4/6/9, eight motion frames, units, panels, Play/Pause, pan and emulated touch. The current harness waits
4.5 seconds for the app's existing four-second marine playback cadence, then exercises the +1h/Now controls.
Phone mode is emulation on the desktop GPU; it is not physical-device validation.

After complete captures exist in `evidence/real-before-complete` and `evidence/real-after`:

```powershell
<coloraide-python> frontend/scripts/wave-palette/cvd-swatches.py
node frontend/scripts/wave-palette/review.cjs
node frontend/scripts/wave-palette/serve-review.cjs
```

The optional review server binds only `127.0.0.1` on an available port and records its URL/PID in
`evidence/review-server.json`. The HTML also opens locally and retains relative links to the original PNGs/receipts.
Motion is a sampled frame comparison, not an FPS demonstration. Build/test caches should be private to this worktree.
