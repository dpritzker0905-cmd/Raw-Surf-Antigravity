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
