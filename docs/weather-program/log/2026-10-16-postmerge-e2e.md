# PR340 post-merge E2E investigation

Owner directly requested checking post-merge E2E and fixing failures, with enabled10USDcap and locked
production frontend. This is separate from the completed Gallery Hub board-clue smoke and rollout.

Run38830529934 on deployed ae13bade2d87846b43087034d8f39b0c20b66a52 FAILED: frontend matching gate
passed00:41:48Z, backend/restore matching gate passed00:44:01Z, browser step timed out after40minutes
at01:24:13Z. Upload step ran but no files existed; artifacts API total_count0. Individual console
network/WebGL/WebSocket messages do not establish cause. Original paid board-clue smoke remains passed;
cap last read5.45reserved/4.55available, production frontend locked/fc140024. No new provider call or deploy.

Bounded workflow dispatch38835061375 on dev selected three failed Desktop Chrome tests, no retry:
Explore spot opens hub, timeout recovery, standard surfer model/layer/timeline controls. All3failed;
retained1.56MB report contains screenshots/videos/error contexts. All three ended at the login screen.
Map control locator was visible, then evaluation stalled across a sign-out; endpoint causing rejection
not established yet. Fix must preserve backend authentication and distinguish synthetic UI fixtures from
real authenticated HTTP acceptance. No raising test assertion budgets or skipping failed tests.

Created codex/fix-postmerge-e2e-340 and aligned history with origin/dev. Resolved only three memory-file
conflicts: dev ledger1257 is exact prefix of retained1266; owned prior log likewise prefix; STATE changes
are only timestamp, PR340 release status and anchor. No memory entries lost and application source equals
deployed ae13bade at this checkpoint. Local evidence safeguard gives Playwright a35minute global failure
deadline before Actions40minute kill and retains per-test artifacts even before HTML report finalization.
Narrow diagnostic logging records only backend401 method/path/status, no query/headers/storage/keys.
No served weather number changed. Investigation remains open; ledger1267 records first diagnostic.

Single-journey diagnostic38836004086 on eb640fda7 reproduced401 before hub failure at login:
GET /api/surfer-gallery/claim-queue-count/test-surfer-id. Render filtered request logs corroborate this
path for original and bounded3case runs. This is the unfixtured incidental locker navigation badge,
not a failed spot/weather response. Repair renames shared seeded helper to seededUiBadges and adds
only this exactGET for declared test-surfer-id/admin-user-id, returning pending_count0. Existing message
badge remains scoped likewise. Three Node contracts passed, including negatives for real identities,
other origins, auth/weather/spot endpoints and mutations. App/backend source remains deployed ae13bade.
No full E2E success claimed yet; next verification uses corrected harness against unchanged DEV app.

Published repair43ffb99c6 and opened/attached draftPR341 againstdev. Full workflow38836406336 runs
all72tests/3files/fourbrowserprojects once without retries against unchanged deployedDEVae13bade.
Application/backend diff versusdev empty. Source head stays frozen while E2E and hostedPRchecks run.
Fresh live cap enabledtrue/initialized5.45reserved/4.55available; production Auto Publishing Locked,
publicworkerfc140024, DEVworkerae13bade. No provider requests, deployments, flags, settings or migrations.
Ledger1269-1271 records publication, PR and full verification dispatch. Final browser result pending.

Full corrected run38836406336 completed01:59:55Z:62passed9existing-skips1failed in16.7minutes.
All map controls, model switches, renderer continuity/rapid gestures and controlledtransport cases pass.
One Chrome Explore case stayed signed in at Unable to load this spot / Try again. No locker badge401;
admin event-dashboard401s are separate, expected by existing admin suppression. Screenshot proves the
error/recovery screen, not which transport or response caused it; prior run lacks that request telemetry.
All14PRsourcechecks passed at43ffb99c6 (CI38836457374), CLEAN.

New candidate records exact-selected-spot request status/failure/duration and exercises one explicit
visible manual recovery ONLY for recorded network failure or502/503/504. Final real-hub success stays
mandatory, with existing90s test/60s assertions unchanged. Invalid successful payloads,500/authfaults
and persistent unavailability fail. First fault is always retained in JSONattachment/console, never
silently retried away. Added a companion per-browser503fault-to-real-backend200 control proving this
branch requires manual recovery, exactly two requests, actual final data and no automatic retry.
Suite discovery76cases, no new skip. Nodebadgecontracts3pass and syntax pass; new head needs full hosted
qualification. No application/backend code, paid provider request, deploy or settings change.

Published2797872bf and dispatched76case38838733164, no retry. Its Mobile Safari control injected one
503, clicked visible Try again, then the real selected-spot request failed after15016ms. Metadata:
first live test request1792116535937 ->200 in5623ms; recovery request1792116546361 ->networkfail15016ms.
Render matching public spot-details completion at02:09:24Z is about18s after that second start, beyond
client15s. This is a real availability boundary, not permission to keep retrying. Cancelled superseded
harness-only run; terminalcancelled, one8108649byte artifact retained. No full76case success claimed.

Inspected retained error-context and screenshot for43head Chrome signed-in unavailable screen; focused
original3error-contexts showed login. Reports downloaded privately; videos retained but UNREVIEWED.
No traces recorded (credential-bearing context policy). Request timing establishes the late response;
code inspection identifies the optional11day forecast await before metadata as an unbounded seam, not
an attribution of all latency to one internal phase. No performance-window unaffected claim.

Actual app repair: bound optional forecast enrichment8s using cancellation; preserve spot metadata,
return forecast_status unavailable with None/empty readings on timeout/error, and keep valid forecast
composition/model/spot identity unchanged. UI labels Forecast temporarily unavailable and offers one
manual Retry forecast, theme-aware in light/dark/beach. No automatic retry, new provider, altered math,
source/cache/clock/flags/schema or OpenAI budget change. Metadata DB waits are not claimed hard-bounded;
live after evidence is still required. This changes availability under a slow forecast, no numeric
calculation; no served weather number formula changed and no runtime rollout yet.

Regression RED: backend8failed2pass (stalled await/absent availability), UI3failed23pass. GREEN:
23backend including10new+13adjacent composition/spot-reference controls;36focusedUI;36floorchecks;
build and lint passed. Original restricted Windows backend run stalled and was stopped; escalated
isolated run completed. CRA direct Jest invocation discovered no tests on Windows; project Craco
configuration exercised the real26loading cases correctly. Local Python still lacks2declaredpackages,
so hosted results are authority. New file is guards196 (not estate); projected2668passes, floor2662,
margin6 preserved. Full frontend verification pending at this checkpoint. Shared rollout and real
76case after acceptance remain pending; owner will review the concrete application change first.
Ledger1273-1275 records dispatch, cancellation/diagnosis and source repair.

Full local frontend434suites/5581tests passed (205.5s); build completed with inheritedwarnings and
lint-debt gate passed. No tracked generated build files. Canonical ledger prefix verified, docs audit
0FAIL14inheritedWARN24NOTE. New application candidate now moves to its own hosted qualification;
prior43/279source results are not inherited and live rollout remains pending.
