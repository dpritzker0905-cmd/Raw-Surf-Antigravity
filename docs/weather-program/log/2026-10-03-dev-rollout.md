# 2026-10-03 dev rollout of audit repairs

## 17:35Z — owner-authorized publication

Owner: "ok push to dev and do all your recommendations". Applies to the three validated repair
batches on codex/audit-repairs, their hosted checks, merging into dev and deployment/readback.
No authority to touch main or promote served weather flags is inferred.

Fetched origin: dev unchanged at e0f93466; repair branch0behind/7ahead, clean checkpoint0ead508e.
Branch protection API says dev is unprotected; project check/approval rules still apply.
Pushed origin/codex/audit-repairs; opened PR228 into dev, MERGEABLE, attached to this chat.
Hosted CI37141083745 and Netlify preview started; awaiting exact-head success and expected counts
(guards2248, chain1876, estate735). Do not substitute local counts for hosted measurements.

Actual Render dashboard confirms source branchdev, auto-deploy On Commit, service previews Off,
1CPU/2GB shared backend; current deployed commit e0f93466. Build installs backend requirements
and runs alembic upgrade heads; start command uvicorn server:app from backend. No deployment
setting was changed. Merge will update the shared dev/public backend; public frontend freeze stays.
Strava state migration/schema/role validation and paired lightweight live boundary checks are next.
Weather guards stay off. Credentials remain runtime-only and no values go into tracked evidence.

Ledger371 records push,372 PR open,373 canonical log/STATE publication. Schema/deploy acceptance
pending. Rollback unmerged work by closing PR; merged code by revert PR, preserving ledger history.
