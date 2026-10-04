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
