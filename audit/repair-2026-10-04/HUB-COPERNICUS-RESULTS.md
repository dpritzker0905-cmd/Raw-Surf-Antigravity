# Calendar, horizon and Copernicus repair receipt

Recorded 2026-10-04 19:55Z. Baseline `0fb75c8eb9c57aeebdf644bb1e67de6f83d53b5d`.
Candidate source is bound by LF-normalized fingerprints in `HUB-COPERNICUS-VALIDATION.json`.
Source40cd1ddd hosted CI37230181942 completed/success, all11jobs: frontend347/3610,
backend5168passed (chain1982, guards2288, estate898). Prior receipt CI37227786046 completed/success.

| Finding | Actual repair and causal controls | Activation |
| --- | --- | --- |
| SH04 | Date-only daily rows use validated noon UTC and UTC calendar formatting. Today/Tomorrow follow the actual date, including gaps, stale rows, leap/year/DST boundaries. Mounted compact/full drawer, hub and Explore controls cover real consumers. | Existing REACT_APP_FORECAST_STATE_IDENTITY, default off; kill-switch rollback covered. |
| SH05 | Drawer compact/full size labels use canonical 10/15-foot boundaries. 9ft Overhead and 12ft Double Overhead; 7/16ft unchanged controls. | Same existing client flag; dark/kill-switch preserve old labels. |
| SH06 | Current request only resolves current frame; daily N requests current+N, capped at ten daily rows. Provider coverage includes rounded next-day current hours. Existing ten-day hub/Explore preview retained. | SURF_REQUESTED_HORIZON=0; declared in registry and all three parity workflows. |
| W04 | Exact SDK time-bounds exception emits typed exit65/marker. Tiled parent stops dataset-wide time failure; spatial/generic failures still continue. Empty/error-only rows cannot become ten-minute successful cache entries; paired finite zero remains valid. | COPERNICUS_TERMINAL_TIME_GUARD=0; registry and three workflow declarations. |

## Forensics and qualification

- Exact baseline consumer substitution, restored byte-for-byte: 9fail/21pass twice.
  An earlier incorrect assertion count was corrected before this accepted replay.
- Exact baseline backend substitution: 17fail/70pass twice, no errors/skips. Candidate87pass;
  expanded supported neighbor set195pass, including actual routes, SDK subprocess boundary,
  cache, wire contract, source composition, script imports, registry and CI-floor controls.
- Current-only cache checks22 to2; irrelevant future fallback1 to0. Paired current dictionary
  equality retained with all cached frames. Terminal typed failure tile attempts4 to1; generic
  and spatial failures retain four attempts. These are isolated causal controls, not live p95.
- Full frontend347suites/3610tests passed; final timezone subsets47pass each New York/Auckland,
  including both rollback controls.
- Lint ratchet accepted1199files,86existingerrors/917warnings; baseline unchanged. Python
  fatal-error lint accepted. LOC2499files,12grandfathered,0new/0regressed accepted.
- Production compilation accepted with CI=false, matching workflow build policy and its
  separate lint gate. Initial CI=true warning-promoted build was not accepted evidence.
- Selector partition618tracked: guards181, chain150, estate284,2existing fastmcp exclusions,
  1existing quarantine. No new skip/exclusion. Candidate hosted counts expected chain1982,
  estate898, guards2288; paired floors1976/896/2282, frontend347/3610.
- Full backend local suite is not qualified: isolated runner cannot collect full-server
  test_weather_copernicus; earlier Windows native collection crash remains historical.
  Hosted Linux full lanes must qualify the candidate.
- Actual component fixture light/dark/beach at desktop and390px phone: calendar dates,
  missing/zero labels and size labels readable; scrollWidth390/viewport390 in all themes.
  Screenshots are ignored local evidence, not a full-map/GPU/FPS/canary certification.
  Owned loopback preview server stopped; inspected tab closed and viewport reset.

## Limits and next work

No merge, deployment, flag flip or forecast-skill claim. Time failure recognition is narrow;
this does not introduce cross-request negative caching or cancel an already running executor.
Remaining source priority is AS-06 immutable manifest publication/failed-upload refusal,
then bounded queues/caches/encoding and device/scientific acceptance. See `PROGRESS.md`.

Primary guidance: [MDN Date.parse](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date/parse)
and [Copernicus SDK troubleshooting](https://help.marine.copernicus.eu/en/articles/8632322-copernicus-marine-toolbox-troubleshoots).
Installed SDK exception implementation was inspected; strict-inside mode and science composition unchanged.

## 2026-10-04 20:12Z — source acceptance read-back

All eleven CI jobs accepted; chain150files/1982pass, guards181files/2288pass/66skipped/1xfailed,
estate284selected/282produced/898pass/0silent. Estate broader collection skips remain
ownership controls, not extra executed tests. Frontend347suites/3610tests and build accepted.
Separate LOC, encoding, ledger and Lighthouse gates accepted; preview success.
All source fingerprints match40cd1ddd; receipts-only follow-up does not change qualified source.
Current-source Jacobian6controls passes twice; final calendar/rollback47pass NY and Auckland.
AS06 current-source in-memory replay reproduced winner overwrite and missing upload publication
twice; serial controls pass. AS06 is diagnosed, not repaired. No merge/deploy/activation.
