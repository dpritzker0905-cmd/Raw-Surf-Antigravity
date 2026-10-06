# Offline marine renderer probe

Run from the repository root with the frontend dependencies installed:

```powershell
node audit/repair-2026-10-04/renderer-probe/serve-projection-native-profile.cjs
```

Open the printed loopback URL in a WebGL2 browser. Run one case at a time.
Stop the server with Ctrl+C. The page's CSP blocks external connections; the
fixture is synthetic and the MapLibre style has no sources. No live weather
backend, credentials or hardware renderer identifiers are used.

The standalone control measures 60 frames after 12 warm-up frames and compares
296² and32² crests in either order, with one GL context per paired run. Function
wrappers count selected GL calls and their CPU duration. The MapLibre control
uses the actual custom layer and engine at two selectable container sizes,
measuring callback CPU duration, cadence, projection length and GL errors.
It removes the map after collecting60 frames or timing out.

This is an investigative tool, not a pass/fail performance gate. CPU-call time
can include driver waits; it is not GPU elapsed time. These scenes do not
qualify app-level playback/scrubbing, full basemap cost, coast masks, physical
forecasts or device coverage. Findings: [native profile](../NATIVE-RENDERER-PROFILE.md).

## Callback-gap calibration (2026-10-06)

`Run callback gap controls` measures 30 animation frames, first idle and then
with six deliberate 100 ms main-thread stalls. Reverse the order with the
existing checkbox. The actual bounded timing collector reports delivered
long-task and long-animation-frame scalars alongside RAF gaps. It makes no
forecast or backend request. Run it alone, with the tab focused and local
builds/tests stopped; controls are not a measurement of the original live
problem. See [callback diagnosis](../CALLBACK-GAP-DIAGNOSIS.md).

## Truth-inspector cadence control

From the repository root, run the pinned Node runtime with
`audit/repair-2026-10-04/renderer-probe/serve-truth-cadence.cjs`.
Open the reported localhost URL and press **Run before/after cadence**.
The server reads the original hook from pinned dev 1993cc39 with git; the baseline
copy and webpack bundle are ignored. Actual React and MapLibre events drive both
cases, with 100 background layers and no live forecast requests. A 120-frame target
may include an already queued final frame; the report gives actual counts.
Deadline failures are incomplete evidence, never passing measurements.
See `../TRUTH-INSPECTOR-CADENCE-RESULTS.md` for the captured result and limits.
