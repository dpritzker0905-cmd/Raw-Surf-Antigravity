# Combined repair release readiness — 2026-10-30

Updated 2026-10-30T13:46:55.026012+00:00. Candidate source `e1a7817db6497425572c72e582f2039461c275d1`. This plan supersedes earlier local-only release status; historical test and delivery receipts remain unchanged.

## Completed local gates
- Settings-only Customer Support entry committed as `ad231e22fff0bef0d45914a94d933c096522a4b0`; 50 native CRA/CRACO tests passed and normal hooks passed.
- CI packaging committed as `e1a7817db6497425572c72e582f2039461c275d1`: two isolated fixture launchers and paired estate map/floor. Exact staged export passed 39 launcher/floor cases and 140 email cases; partition is 763 tracked files = 213 guards + 183 chain + 364 estate + 2 excluded + 1 quarantined.
- Email harness initially omitted the explicitly required asyncio plugin because automatic plugin loading was disabled. Failure retained; corrected harness passed without product changes. Four declared packages remain absent from this local interpreter: these receipts do not establish hosted CI parity.
- Latest green dev baseline was independently read in the signed-in GitHub UI: run 40807961067, job 123231302403, SHA `72b4652d5753423cce18b9ad1d1de95f0afcb7e7`, 3376 passed. Complete package adds 23 collected cases: projected 3399, floor 3397. Hosted candidate count is still unverified.

## Approved scope and coordinated ownership
The parent chat relayed explicit human approval to publish and merge the reviewed combined package to DEV. It also confirmed explicit approval for this release's disclosed shared Render deployment, existing `alembic stamp heads`, and startup schema/self-heal behavior. Compatibility must still be proved; this is not permission for destructive schema changes, backfills, new paid resources, production frontend/main promotion, or new weather work.

The eleven pre-existing `docs/weather-program/` deltas are unchanged app repair documentation. The parent cleared carrying that reviewed history unchanged. Complete path/commit/hash manifest and patch are retained in this directory; no new weather-path write is made here.

The independent ce30 reviewer owns Chrome until explicit handback and is checking Supabase catalogs read-only. No concurrent browser focus actions. Keep Claude and shared ownership coordination through existing approved chats; do not infer acknowledgement from a file hash or another owner's test pass.

## Provider facts independently read from existing signed-in UI
- Render service `srv-d7fhiu7lk1mc73debje0`, Raw-Surf-Antigravity, exists in the project's Production environment and tracks `dev`, auto-deploy On Commit. Live revision `e3ad24209ae11f3f7c84f6ecb02c897328e7a134`, deployment `dep-dbh9eeivcj2c73fr66a0`.
- Actual build command: `pip install -r backend/requirements.txt && cd backend && alembic stamp heads`. Start command: `cd backend && uvicorn server:app --host 0.0.0.0 --port $PORT`. PR previews off. Ignored paths docs/**, audit/**, **/*.md, frontend/**. `render.yaml` is not the applied source of configuration.
- Netlify rawsurf site `d03521d3-4d1e-4a0e-b81c-fd02db187503` production tracks main; branch deploys include dev. Production publishing is on, but main promotion is outside scope. Published production revision `3c6f1a27ab06b09554a6713dba54b1bad4712749`. Current DEV frontend served revision/API destination are not yet verified.
- Read-only provider connectors were unavailable; existing authenticated browser UI was used. An earlier raw GitHub API endpoint-protection denial was not retried or bypassed.

## Remaining gates, in order
1. Publish only the reviewed isolated branch and open draft PR into dev; inspect exact-head required CI and review status. Do not equate the baseline green run with candidate success.
2. Confirm the shared Render service's actual database mapping without revealing credentials. Reconcile the mapped destination's schema, constraints, defaults, indexes and migration-version lineage with the proposed source. Project names alone do not establish mapping.
3. Resolve genuine compatibility gaps through reviewed non-destructive preparation; do not blindly upgrade or stamp heads. No shared migration has been run by this lane.
4. After actual exact-head checks and compatibility gates pass, perform the authorized DEV integration and verify shared backend and DEV frontend served revisions separately.
5. Update this plan and append a small memory note with exact resulting SHAs and remaining limitations.

## Evidence
`ci-staged-verification.json`, `ci-launchers-and-floor.log`, `ci-email-regressions.log` (initial harness failure), `ci-email-regressions-async-plugin.log`, `ci-partition.log`, `ci-commit-normal-hooks.log`, `settings-commit.json`, and `settings-native-craco.json` are bounded local receipts. No live customer rows, payments, email, tickets, new resources or security scan were exercised.
