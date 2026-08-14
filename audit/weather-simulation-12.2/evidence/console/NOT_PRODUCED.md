# Captured, but stored with its run rather than here

Console output from all three browser probes is in
`../browser-device-tests/coverage-{chromium-desktop,chromium-mobile,firefox-desktop}.json` under
`consoleErrors` / `pageErrors` (capped at 120/60 per run), because separating it from the run that
produced it would make it unattributable.

It is where the `WebGLGuardrail` fallback was observed firing five times — see
`../runtime-paths/LV12-2-04...`.
