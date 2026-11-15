# 2026-11-15: D-059 live parity read (pr-verifier session local_458cea94)

Append-only. One short live scenario on the owner's word, relayed by the director (David, 2026-11-15 10:52 EST: "Sure,
if that is the path toward state of the art"). It fulfils the D-059 measure-after owed since 2026-11-08
(`ledger.d/claude--stoic-solomon-366747.jsonl:5`, re-dated by `ledger.d/claude--state-reconciliation-20261111.jsonl:74`).

## Method
- 8 backend calls, sequential, at 15:59:39Z: `/api/health`, 6 x `/api/weather/grid` = {EURO, ICON} waves x
  {florida_east_coast, uk_ireland, hawaii}, ONE hour each (2026-11-16T00:00Z, the first bundle hour >= now + 6 h), each
  a z8-sized box at the tile's centre that the app's own clip window fully covers (checked offline before any call),
  then `/api/health`. No `/grid_series`, no retries.
- Reference: the regional bundles on the public `weather-frames` CDN that the client reads (`v1/latest.json`; EURO run
  2026-11-15T06Z, ICON run 2026-11-15T00Z), fetched from the CDN, not the backend, and decoded with the app's own
  modules (`staticFrameCodec.js`, `staticFrameCrop.js`, `staticRegional.js`), as `scn_regional_client_parity.mjs` does.
- Pass rule (D-051's, as in the 2026-10-25 GFS read): served from the box's tile (`coverage_scope` regional, product id
  names the box, not partial), same grid geometry, 0 missing, 0 validity flips, max |dH| <= 0.001 m, direction and
  period exact; bundle slice sha12 checked.

## Result: PASS 6/6
| Model | Box | Served product | Nodes | Missing / validity / bad | max abs(dH) m | dir / period | /grid s |
|---|---|---|---|---|---|---|---|
| EURO | florida_east_coast | `euro_marine_waves_florida_east_coast_20261116T000000Z.json` | 289 | 0 / 0 / 0 | 0.0005 | exact | 0.59 |
| EURO | uk_ireland | `euro_marine_waves_uk_ireland_20261116T000000Z.json` | 425 | 0 / 0 / 0 | 0.0005 | exact | 0.56 |
| EURO | hawaii | `euro_marine_waves_hawaii_20261116T000000Z.json` | 425 | 0 / 0 / 0 | 0.0005 | exact | 0.47 |
| ICON | florida_east_coast | `icon_marine_waves_florida_east_coast_20261116T000000Z.json` | 289 | 0 / 0 / 0 | 0.0005 | exact | 0.35 |
| ICON | uk_ireland | `icon_marine_waves_uk_ireland_20261116T000000Z.json` | 425 | 0 / 0 / 0 | 0.0005 | exact | 0.42 |
| ICON | hawaii | `icon_marine_waves_hawaii_20261116T000000Z.json` | 425 | 0 / 0 / 0 | 0.0004 | exact | 0.48 |

Every served product equals the bundle frame's product id; served_valid_time equals the asked hour; all slices' sha12
matched. `/api/health` 200 in 1.44 s before, 200 in 0.15 s after. The 0.0005 m residual is the frame's height
quantisation (as in the GFS read, 0.0005 m).

## Limits
- Waves only (D-059 also covers ICON swell_1 / wind_waves); one hour per box; 3 of the 14 boxes; `/grid` only.
- The read compares the server with the CDN bundle; it says nothing about forecast skill.

## Evidence
Shared notes `d059-live-read-2026-11-15/` (outside git): `live-read-out.json` (sha256 a8af68ce...7880) and the
script `d059_live_read.mjs` (no backend call until its offline plan shows every box fully covered).
