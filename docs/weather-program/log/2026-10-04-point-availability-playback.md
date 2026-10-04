# Point identity, availability, and playback continuation

Started 2026-10-04 17:48Z. Branch `codex/independent-audit-repairs`, baseline69c06852.
Owner: "Ok keep going in that order" (W01/W02, then availability, then stale consumers/visuals).
Owner additionally supplied a local GFS play/scrub recording and console log and asked to add
that diagnosis to the work. Beta rotation remains deferred under the prior owner decision.
Trevec is unavailable; actual-source and graph/import inspection uses rg and bounded file reads.
The implementation skill calls for small tested slices. No subagents, live load tests, flag
activation, merge, or deployment.

## 17:48Z — locally qualified W01/W02 slice

- Before production edits, actual offline backend resolver/sampler controls ran twice:
  8 failures/7 passes. Six cross-model and two cross-domain hints selected the wrong product's
  1m value instead of the requested product's2m. Three correct hints, existing layer guard,
  and dark controls stayed positive.
- Actual frontend outer cache plus HTTP-boundary adapters ran twice:18fail/2pass of20.
  UTC rounding rollover, forced refresh, product/bbox changes, ambient hints, recursive ICON
  blend hints and weather manifest-await drift reproduced. Added six adjacent controls after
  reproduction (manifest domain/refresh, rain alias, coarse hints, aborted refresh).
- Backend repair dark behind `POINT_PRODUCT_IDENTITY=1` (default0, call-time, admin registry).
  Client repair dark behind `REACT_APP_POINT_REQUEST_IDENTITY=true` (unset by default); runtime
  `__RAW_DISABLE_POINT_REQUEST_IDENTITY__` can only disable it. Explicit context freezes anchor,
  selected absolute time, actual transmitted hints and provider across reads/writes/adapters;
  force bypasses both client caches, not provider ingestion or backend storage.
- Focused frontend26pass; full338suites/3494pass, lint ratchet86existingerrors/917warnings,
  production compilation accepted. Backend original neighboring selection tests plus extended
  controls73pass; new test file is21cases, **chain-owned** (selector read-back), partition
 616tracked/181guards/148chain/284estate/2fastmcp-excluded/1quarantined. Local interpreter has
  two declared packages absent: local evidence does not substitute for hosted environment.
- Prior source d67763d5 CI37207402431 is now completed/success. Prior receipt69c06852 has
 15checkrunsuccess/3neutral plus successful preview status (19total), read back live.
  This supersedes the dated pending entries; do not rewrite their historical receipts.

## Playback evidence added (diagnosis still open)

User recording:87.03s,2218x1552,30fps, metadata creation2026-10-04T17:31:02Z.
Decoded locally into gitignored evidence; original remains untouched. Console is also untracked;
raw owner logs/recordings are not published. Recording shows wide-view wave-color transitions.
Console lines94/99 identify46x20 at zoom3.5;132 identifies181x82;157-160 switch46x20 to181x82
while selected hour126 and zoom3.5 remain the same. No timestamps in the supplied log establish
an exact recording-to-log frame alignment. The source uses thinned series frames followed by
exact per-hour upgrades; the four-second player and asynchronous upgrades require a causal
replay before calling this repaired. Evidence of differing representations is not evidence of
a scientific accuracy improvement or of a blank GPU frame.

Primary guidance: [RFC9111 cache request identity](https://www.rfc-editor.org/rfc/rfc9111.html#section-2).
Availability semantics will use [Copernicus wave parameter definitions](https://help.marine.copernicus.eu/en/articles/6175153-how-to-describe-wave-height-period-and-direction-parameters).

## 2026-10-04 18:51Z — ordered local qualification

M01/M02/M03 adapter-to-card24cases qualified. SH01 actual producer12cases qualified;
new files chain-owned (149files); default-off availability declared0 in all three parity workflows.
SH02/SH03 actual memo and mounted spot/model/abort/zero controls qualified. PB01 real player
and common series source reproduced9fail/8pass before twice; consumer16fail/2pass before twice.
One next frame under the background lane; no future bridge staging; manual thin-world refusal;
bounded retries, readable buffering, all-theme availability. Final frontend346/3582, focused
backend171, lint ratchet86/917, production compilation, LOC accepted. Final hosted Linux full
backend pending: local full collection crashed natively on Windows; interpreter parity limits
remain. Browser fixture three themes desktop/390x844 phone, no horizontal overflow; simulated
exact delivery holds0 then6. Preview JSX runtime corrected before replay acceptance. No full
map-pixel/GPU/FPS/live-latency/skill claim. Source flags dark, no merge/deploy. New receipt
`audit/repair-2026-10-04/POINT-PLAYBACK-RESULTS.md`; raw video/log/frame assets remain local.

Pre-publication docs-only memory audit:0 FAIL/7 WARN/6 NOTE. Previously open18Z commitments are now overdue; none is claimed fulfilled by this repair. Ledger591 verifies; source default-off compilation, frontend346/3582 and lint86/917 accepted.

## 19:15Z — exact-source hosted acceptance and Jacobian receipt

PR243 head5afa0c82 read back. CI37226218002 completed/success, all11 jobs accepted.
Completed per-job logs: frontend346suites/3582tests; chain1951/149files/0skips;
guards2288/181files/67existingdocumentedskips; estate889/284selected/282produced/0silent.
Backend total5128passed,0failed. LOC37226218144, encoding37226218139, ledger37226218004
and Lighthouse37226218027 success. PR rollup19:17SUCCESS checkruns,1NEUTRAL,1successful
Netlify preview status. This supersedes candidate pending entries; the local native
collection failure remains a historical non-qualifying attempt.

Standalone point_jacobian_probe.py: actual resolver/sampler,6 controls twice. For
GFS/ICON/EURO, central derivatives requested/hint change0/1 to1/0, epsilon0.05m,
error<1e-10. This measures ownership, not surf physics or forecast skill. Instrument
is explicit-path offline, outside backend CI discovery; no exclusion or floor change.

All recorded production/test/CI fingerprints match5afa0c82. This follow-up only
publishes sanitized receipts and the offline probe. All served flags stay off; no
merge/deploy. Full map/GPU/device FPS/real-fetch cadence acceptance remains open.

## 19:55Z — calendar/horizon/terminal failure batch

- Exact baseline consumer substitution, restored byte-for-byte: 9fail/21pass twice.
  An earlier incorrect assertion count was corrected before this accepted replay.
- Exact baseline backend substitution: 17fail/70pass twice, no errors/skips. Candidate87pass;
  expanded supported neighbor set195pass, including actual routes, SDK subprocess boundary,
  cache, wire contract, source composition, script imports, registry and CI-floor controls.
- Current-only cache checks22 to2; irrelevant future fallback1 to0. Paired current dictionary
  equality retained with all cached frames. Terminal typed failure tile attempts4 to1; generic
  and spatial failures retain four attempts. These are isolated causal controls, not live p95.
- Full frontend347suites/3610tests passed; timezone subsets45pass each New York/Auckland
  before the final two rollback controls; full UTC run includes those controls.
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
Final mounted timezone controls:47pass New York,47pass Auckland, including rollback. Initial
wrong-root launcher attempt collected no tests and contributes no acceptance evidence.
