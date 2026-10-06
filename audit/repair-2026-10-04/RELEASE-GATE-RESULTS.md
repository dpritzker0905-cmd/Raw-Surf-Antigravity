# Gallery and deployment gate follow-up

Verified 2026-10-05 22:44Z; exact sourcef48d15e6 is hosted-qualified. Earlier pending/failed stages remain historical below.

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

## 2026-10-05 22:44Z: exact-source qualification and live column/revision preflight

Sourcef48d15e6 CI37381706714 completed all11 application jobs SUCCESS. Actual5526backend=
2360guards+2053chain+1113estate;356frontend suites/3700tests. Estate296selected/294produced/
0silent; existing skips/xfail retained. Supplementary ledger/LOC/encoding/Lighthouse SUCCESS.
This supersedes the failed59dd3d26 projection rather than hiding it. Local152 and new8repeat pass.

The authenticated live Render shell ran only metadata queries under transaction_read_only=on,
with5s statement/connect bounds, rollback and connection close. All514expected columns across13
required gallery/session/booking/dispatch/payment/profile tables are present. Database/source
revision heads match2fd2888a0987,a107b7db4f12,avatar_url_text_001. Models/migrations/requirements
have no delta from live6b062e97. This addresses required-column/revision readiness; it does not
certify data types, constraints, charge/credit behavior or PostgreSQL concurrency. No DDL or user
record was changed, and no credential value was printed. Current build remains upgrade heads;
the historical stamp command alone was not the evidence of schema readiness.

Native Chrome WebGL2 probe: stateRestored,throwRestored,framebufferRestored,passed alltrue; error0.
Spans0.2,2,12,40 all read known255 and unknown-dimensionnull. This uses actual encoder/probe helpers
and a real WebGL context; it does not identify a hardware renderer or measure full-map pixels/FPS/
heap. A repeat input timed out, so only the confirmed first run is credited. Probe tab/server closed.

Fresh Dev connector SQL confirms pointer/auth/object counts0, private weather bucket and pointer
RLS. [run-staging-canary.ps1](run-staging-canary.ps1) fixes the verified isolated target, accepts the
existing key hidden, sets only the child runtime credential environment and restores its parent;
it persists no credential. Parser PASS; actual canary unexecuted. Owner terminal JSON receipt is
pending. [STAGING-CANARY-OPERATOR.md](STAGING-CANARY-OPERATOR.md) supplies the concrete steps.
No production key, cloud data write, charge, merge, deployment or new flag activation occurred.

Remaining: configured Render HTTP health path and deliberate shared-backend rollout; actual Dev
publication/CAS canary; isolated PostgreSQL/card/concurrency; actual map/native performance/device
acceptance; unrepaired ingestion/deadline/media/observation/science findings. Main check-name
coordination is a main-promotion gate. Preserve Netlify's production freeze and keep new flags off.

## 2026-10-05 23:49Z: ingestion repairs and Gulf case

Runtime1912639b CI37388965928 all11SUCCESS, actual5577backend=2393guards+2071chain+
1113estate;356frontend suites3700tests; estate296selected294produced0silent.
Supplementary ledger/LOC/encoding/Lighthouse success. WI02/WI03 now source repaired
and hosted-qualified; this supersedes their older unrepaired release status.
Actual cloud/every-lane/upstream and rollout acceptance stay separate.

New Gulf capture: stale badge and coarse world grid at regional zoom.98focused
frontend tests pass; corrected actual encoder/JS-ramp synthetic probe twice preserves
19ft as18.913ft and distinct three-theme colors. Four-cell interpolation counterexample
derivative0.25 is not actual Gulf data. Later frame/cycle/product/cell identities are
absent from captured logs; first-three encoder statistics cannot qualify later98h.
Root cause/full native map/science remain open. GULF-HEATMAP-DIAGNOSIS.md.
No merge/deploy/provider write/forecast flag activation; productionfreeze preserved.


## 2026-10-06 00:27Z: resident diagnostics and dark WI04

Local360/3746 full frontend;250frontend/245backend expanded;27newchain cases. Null manifest
selection Jacobian across three synthetic prune modes; object preservation improves only when
explicit flag1. Hosted source pending673; no predecessor qualification borrowed. Whole backend
fatal lint reports four existing findings in unchanged files; changed files pass. No live map load,
cloud publish, deployment, activation or physical forecast gain. GULF-RESIDENT-PRUNE-RESULTS.md.


### 2026-10-06 00:52Z: ff5cfc98 qualified; WI05 remains a separate pending source

CI37394319031 all11success: actual5604backend=2393guards/2098chain/1113estate;
frontend360suites3746tests. Guards2460collected185files67skips, chain153files, estate296selected/
294produced/0silent. Exact ledger37394318487, LOC37394318475, encoding37394318862 and
Lighthouse37394318984 success. Commitment673 fulfilled by ledger680. Existing broad fatal
lint debt remains explicit because broad CI step permits errors. New WI05 local source has its
own commitment679: projected5642backend, unchangedfrontend; predecessor does not certify it.

WI01 real store full/stride2 cache probe2fail twice: fake remote4=>6m and latestmanifest/RAMclear
still yield4m and0L2reads. WI06 actual picker corrected URL fixture2fail/1genuine404control pass
twice;500/timeout transient yields6h older run. Initial URL mismatch results rejected. Ledger681.
These are offline sensitivity diagnoses, not real Gulf pixel/cell provenance or physical skill,
and not a proof of the audit's separate new-run-time/duplicate-ranking claims. Both repairs open.
No merge/deployment/flag/provider/cloud/live-map action.


### 2026-10-06 01:12Z: WI05 hosted-qualified; next WI06 local partial repair accepted

Sourcea3b321f0 CI37396359484 all11success; actual5642backend2393/2136/1113,frontend360/3746;
estate296selected294produced0silent, supplementary gates success; fulfills679, ledger684.
WI06 actual picker20before17fail3pass twice; final32regressions,67focused/347expanded twice pass.
Default0/unset retry has12s selection/3s socket/two attempts, backoff/terminal/late guards;
script-by-path passes; no cycle-axis/ranking migration. New32guards selector186, floor2419/ref2425;
projection5674backend, own hosted686 pending. Frontend unchanged. Separate actual duplicate
sweep2fail twice: later older known cycle deletes newer; WI06 remains partial. WI01 open.
No served-number/skill/flag/cloud/provider/merge/deploy action; ledger685-686; WAVE-CYCLE-RETRY-RESULTS.md.
