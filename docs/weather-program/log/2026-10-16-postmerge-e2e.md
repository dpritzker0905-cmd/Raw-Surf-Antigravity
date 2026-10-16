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
