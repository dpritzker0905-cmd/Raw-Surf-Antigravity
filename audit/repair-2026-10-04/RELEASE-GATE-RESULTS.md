# Gallery and deployment gate follow-up

Verified 2026-10-05 22:16Z; source qualification below is local until the new hosted run completes.

## Source repair

The updated audit's on-demand redemption repair did not scope the whole selection queue.
Two galleries from the same photographer were mixed; unscoped/ambiguous quotas were advertised;
a mismatched photographer assignment could be listed and redeemed. Six actual JWT/HTTP/ORM
regressions failed twice on the prior source, with assertion failures rather than collection errors.

Queue, item listing, redemption and leftover sweeping now share the surfer/photographer/scope
query. Gallery-only quotas require the correct parent gallery and no booking/live assignment.
Invalid scopes are omitted from the queue and refused by item listing/redemption. On-demand queue
metadata now reports its gallery identity. Booking/live positive controls still list, redeem and
sweep only their session. Existing frontend queue consumes quota IDs, not session_type/session_id.

Four additional cases delete the environment variable to prove actual default-off behavior for
SURF_STRICT_AVAILABILITY, SURF_REQUESTED_HORIZON and COPERNICUS_TERMINAL_TIME_GUARD, including
the real subprocess boundary. They preserve legacy behavior while unset; they do not activate it.

After repair:87 focused cases pass; repeat with floor/flag parity:144 pass. Fatal Python lint,
file-size and existing route-authority gates pass. Local Python lacks two declared packages;
hosted Linux remains the full qualification authority. SQLite does not qualify PostgreSQL locks.
Ten new gallery cases and four unset-default cases raise projected estate1095 to1109; paired floor
1107 retains the existing two-case margin. No skip/exclusion or BOLA baseline changes.
Prior exact published docs head4a7671a9 CI37377554458 completed all11 jobs SUCCESS; its runtime
source remains13f6d0a9 (5504backend/356suites3700frontend). New source needs its own hosted run.

## Authenticated provider readback

Read-only Chrome sessions are authenticated; this supersedes the earlier unavailable-provider
statement in DEPLOYMENT-READINESS.md. Secret values stayed masked. No provider settings changed.

- Render: shared service branch dev; Auto-Deploy On Commit, verified selected dropdown then canceled.
  Build: pip install -r backend/requirements.txt && cd backend && alembic upgrade heads.
  Start: cd backend && uvicorn server:app --host 0.0.0.0 --port $PORT. Pre-deploy command empty.
  Health Check Path empty; source /api/health/simple has no database dependency and live GET returned
  HTTP200/status ok at21:59:30Z. Proposed path is /api/health/simple; not configured yet.
  All new backend flags in the readiness flag table are absent from the complete provider key list.
  Docs/audit/Markdown build ignores are present. No migration-file delta against dev in this PR;
  actual shared database revision/readiness is not certified by that absence.
- Netlify: Auto Publishing Locked; published prod-frozen-3bd38a83 atfc140024. Production branch main;
  branch deploys dev and the frozen branch. All nine dashboard environment keys were inspected
  without revealing values; no new frontend flag overrides are present. netlify.toml supplies only
  the previously authorized ICON-tail switch for branch-deploy/dev.
  Dashboard Node22.x/build command are superseded by file settings: completed13f6d0a9 preview log
  explicitly uses Node24.21.0 and build.command from netlify.toml, including the dev-only ICON guard.
  Docs-only838514dc/4a7671a9 previews were canceled; GitHub's success context does not mean rebuilt.

## Remaining release boundary

PR243 is not deployed. Dev merge triggers the shared production API because Auto-Deploy is On Commit.
Preserve the production frontend lock. Use a qualified exact source commit and verify the lightweight
health path, existing database migration state, rollback compatibility and unconditional product changes
before the shared backend rollout. Do not treat unset new flags as isolating unconditional repairs.

Actual-source Supabase Dev publication upload/CAS/two-writer/cleanup still requires secure runtime
STAGING_SUPABASE_URL and STAGING_SUPABASE_SERVICE_ROLE_KEY; the scoped connector alone supplies neither
to Python. PostgreSQL/card concurrency, native playback/GPU/heap/device acceptance, ingestion cycle
freshness and empty-ingest failures, grid deadline and held-out science remain explicitly open.
Main protection's required18.x versus emitted24.21.0 check mismatch remains a main-promotion gate.
No cloud test data, actual charge, merge, deployment or flag activation occurred in this follow-up.

## 22:16Z correction and further acceptance

The earlier estate1109 projection was wrong: actual-source59dd3d26 hosted estate ran1105pass,
2865skip and its1107floor failed. Four unset controls belong to chain, which ran2053pass. This
is a CI configuration error, not a skipped/failing gallery regression. Do not call59dd3d26 green.
Selector readback from backend confirms ownership. Eight added gallery/session collision controls
cover both booking/live assignment across queue/items/redemption/leftover sweeping.152expanded
pass; the new eight repeat independently8pass. Correct paired projections: chain2053/floor2047,
estate1113/floor1111. Both floors increase; no baseline, discovery, exemption or skip changes.
Expected total5526backend=2360+2053+1113 requires successor hosted confirmation.

The isolated visual build instrument initially failed because an unwrapped DefinePlugin object
made a concise arrow parse as a block. Wrapping the expression fixed the instrument; production
CRA source/build is unchanged. Native Chrome actual controls held desktop0h/Buffering until exact6h
delivery, and phone6h/Buffering until exact12h delivery. Keyboard scrub to7h announced the nearest
6h model step. Light/dark/beach styles were checked; native390x844 phone viewport restored. Calendar
shows Oct6 and Oct8 rather than inventing a contiguous third day; missing sea is Unavailable, measured
zero Flat,9ft Overhead. Fixture cache/API/frame delivery are synthetic; no actual map pixel, native
GPU/FPS/heap/real-data latency acceptance is inferred. Local server and preview tab were closed.

Render live6b062e97 deploy history contains `alembic stamp heads`, unlike current configured
`alembic upgrade heads`. Therefore actual shared database schema and revision must be checked;
stamping alone did not run DDL. No migration/requirements file delta from the live source, but that
does not certify existing schema. No schema repair or provider setting change was performed.
Official guidance: [Render deployment triggers](https://render.com/docs/deploys),
[Render HTTP checks](https://render.com/docs/health-checks),
[Netlify file configuration](https://docs.netlify.com/build/configure-builds/file-based-configuration/).
