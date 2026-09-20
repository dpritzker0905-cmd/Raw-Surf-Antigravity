# WP1 final real-input replay — 2026-09-20

Local candidate on localhost:3001, live backend607af934, Chrome, desktop1280x900.
The final source was frozen after the cache-writer ordering correction. After its delayed HMR
settled, the sequence used genuine focused arrow keys, pointer drag/double-click and the Now
button. No programmatic map move, synthetic event, request interception or page reload occurred
within this sequence. The plain `/map` probe was observational only. Earlier captures interrupted
by HMR or lacking the basemap token are not used as final visual acceptance.

These are transcriptions of browser-tool observations, not saved HAR or image files. Screenshots
were inspected in the tool. `browser-probe.js` preserves the temporary local harness; it was removed
from public assets and index.html before the production build. Its explicit query-string scenarios
are only for WP2/WP3; the final WP1 sequence used neither.

| UTC observation | Real input / wheel | Requested and selected identity | Accepted engine grid |
|---|---|---|---|
|20:51:22.240|18 ArrowRight presses;18/+18 hours|request Sep21 15Z; selected Sep21 14Z; response_time_mismatch|h18,7x9, valid14Z; productId and model_run_time absent; run_time Sep20 20:50:36Z|
|20:52:07.226|pointer pan, double-click zoom, Jump to now;0/Now|request and selected Sep20 21Z; aligned|h0,17x17, valid21Z; product `gfs_marine_waves_florida_east_coast_20260920T210000Z.json`; run_time Sep19 22:34:04.798324Z; model_run_time absent|
|20:52:35.346|ArrowRight;1/+1 hour|request21Z; selected20Z; response_time_mismatch|h0,4x7, valid20Z; productId/model_run_time absent; run_time Sep20 20:51:37Z|
|20:52:54.737|two more ArrowRight;3/+3 hours|request Sep21 00Z; selected Sep20 23Z; response_time_mismatch|h3,4x7, valid23Z; productId/model_run_time absent; run_time Sep20 20:51:37Z|
|20:53:06.241|Home;0/Now|request and selected21Z; aligned|same regional product and accepted identity as Now above|

Post-pan viewport was z10, west-80.84472624511453,south28.114897244284464,
east-80.10314909667686,north28.658568126858142. At Now, scrubbing=false and pending=null.
The warning visibly appeared for the time disagreements and disappeared after aligned resets.
The series path's one-hour offset is a newly isolated defect; its advancing selected time disproves
the stronger claim that every recovery control remains stuck. Do not confuse native three-hour
cadence with this one-hour disagreement between requested and accepted valid instants.

The accepted grid's `run_time` is recorded literally. It is **not** substituted for the missing
`model_run_time`; the required model-cycle identity proof is incomplete. Engine acceptance is not
proof of GPU drawing that exact frame. Screenshots show a field and the warning, not frame identity.

Responsive check: at390x844, the expanded mobile timeline displayed the same readable warning,
wheel and five recovery controls above navigation. The development HUD initially covered the
timeline; it was collapsed with keyboard activation, then the timeline expanded. An overlapping
pointer action initially opened the location picker; it was dismissed without selecting a location
or granting permission. The viewport override was reset. Desktop and mobile screenshots were in
the current dark theme; light/dark/beach warning semantics are covered by unit tests, not a complete
three-theme browser acceptance matrix.

## Disposition

The diagnostic repair is supported by red/green and mutation controls. Now and Home recovered
without reload, while forward input exposed a separate series-anchor disagreement. **WP1 full
acceptance remains open**, and WP4 remains deferred under the same-owner dependency rule. The next
bounded investigation must compare browser rounding with the backend series anchor and preserve
actual product/cycle metadata; it must not silently relabel the existing frame as the requested time.

For initial real-input and actual-hook before evidence, see `forensics/STATE_PATH_FINDINGS.md`,
`forensics/REPORT.md` and the red logs. No motion, performance or deployed-fix claim is made.
