# Independent verification and the next measured repair

September 8, 2026. These controls validate the diagnostic repairs; they do not certify forecast science or every part of the application.

## Independent interventions

- Real headless Edge, fresh profile: the same intercepted fetch succeeds, then fails with injected DNS resolution failure. The new collector records only origin/type/error code; private path/query/fragment are absent. On the same 626 recorded frames, clearing errors yields PASS, adding the browser DNS error yields REFUSE, and adding a renderer TypeError yields FAIL. This controlled manipulation is not a clean production replay. See independent-browser-control.cjs and independent-browser-result.json.
- Real monitor CLI over localhost HTTP: hold the public-report MAE and paired observations fixed; change only primary paired forecast/error from +0.1 to +0.3 m versus persistence +0.2 m. Monitor exit changes 0 to 1. Stop the HTTP server entirely: both saved cases replay successfully offline. Modify each input file by one byte: both replays reject the hash mismatch. Synthetic credentials are absent from captured evidence. See independent-accuracy-control.py and independent-accuracy-result.json.
- CI floor controls use the measured Linux readings. Current floors pass; independently lower each lane's passed floor by one beyond its existing margin: exactly that lane is detected. See independent-floor-result.json.

## What the live attribution revealed

Marine run 34281404416 recorded seven fetch DNS failures at https://map-tiles.open-meteo.com and one aborted backend XHR plus a 15000 ms timeout message. It REFUSED; 381 analyzed frames, 162 water samples, two conditional render findings. Those findings cannot be promoted to clean renderer defects while transport is incomplete. Its head was 16cff871, not the later metadata repair.

Public DNS at 21:56:14 UTC returned Status 3 (NXDOMAIN) for map-tiles.open-meteo.com and a successful A answer for api.open-meteo.com. The [provider's own weather-map-layer documentation](https://github.com/open-meteo/weather-map-layer) still names the failing tile hostname and calls that package under construction. No replacement hostname has been verified; none is invented in this repair.

## Repair after the controls passed

useOpenMeteoTileUrls unconditionally warmed seven tile models at mount, including when native marine uses backend grids and needs none of those tile models. Remove the unconditional warm-up and request only the models selected by active raster/fallback tasks. Existing fetchModelMetadata deduplicates live and in-flight requests. Bootstrap cached axes no longer prevent the activation-time request. Raster and explicit marine-fallback metadata access remains present; those features still depend on the provider's availability.

Three hook regressions fail before the change and pass afterward: native marine makes zero metadata calls (previously seven), a raster requests only its selected model despite bootstrap axes, and marine fallback requests its own model. Full frontend validation: 250 suites, 2380 tests passed. Targeted ESLint and LOC ratchet pass. The initial ESLint invocation used the wrong working directory, then succeeded from frontend with its actual configuration; no lint rules were changed.

Remaining: verify this exact new head in CI and the marine battery; independently trace backend timeout behavior. Provider/cycle identity loss in calibration/skill rows, the Azores regional edge, and nearshore observation readiness remain open. Accuracy thresholds and physical coefficients are unchanged.
