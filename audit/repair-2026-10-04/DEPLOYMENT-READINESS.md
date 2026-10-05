# Deployment readiness: updated audit versus actual repairs

Verified 2026-10-05 23:49Z. This is a deployment assessment, not deployment authorization.
The supplied deep REPORT.md includes sections 10 and 11, and its current SHA256 is
`be4914fbc8de71b1cfada3b7beb0f78e669c8fd6b5090fefbc3678accb5b72c0`.
Its merge-blocker review is of `0bb3aec0`; the qualified runtime/CI-test/workflow source is now `1912639b`; later receipts/audit instruments do not change that source.
This supersedes the older deployment status in PROGRESS.md without rewriting historical receipts.

## What is actually running

| Component | Fresh evidence | Meaning |
|---|---|---|
| PR243, targeting dev | OPEN, qualified source1912639b; CI37388965928 all11 application jobs success,5577backend/3700frontend | Repaired source has not reached dev |
| Shared Render API | Public /api/health healthy, version ends6b062e97; /api/health/data ok, alerts empty | Current PR backend is not live; health does not certify model-cycle freshness |
| Netlify dev | service-worker BUILD_VERSION2a7b8615 | Current PR frontend is not live on dev |
| Netlify production | service-worker BUILD_VERSIONfc140024 | Owner's frozen frontend remains served |
| Netlify PR243 preview | Completed13f6d0a9 frontend preview; later receipts have no frontend delta | Existing preview uses shared backend; status success does not mean every docs head rebuilt |
| Separate Supabase Dev | Scoped SQL: pointer0rows, auth0users, weather bucket0objects, private, pointer RLS enabled | Connector works; real publication canary is still unexecuted |

Authenticated Chrome readback now confirms Render dev/Auto-Deploy On Commit, migrations in the
build command and empty health-check path. Live /api/health/simple returned HTTP200. Netlify is
Auto Publishing Locked atfc140024; production branch main, branch deploys dev/frozen branch.
The completed13f6d0a9 preview uses Node24.21.0 and netlify.toml's build command, overriding the
dashboard's22.x/default command. New flag overrides are absent from both provider key inventories;
secret values stayed masked. No provider configuration changed. Live Render build used stamp heads,
while current settings use upgrade heads. Actual live READ ONLY schema preflight now verifies all514
required columns across13tables and matching three revision heads; types/constraints/concurrency remain
separate acceptance. Current source1912639b is hosted-qualified; predecessorf48d15e6 had corrected
59dd3d26's failed estate projection.
Native isolated controls and WebGL state/dimension checks pass; actual map/FPS/heap acceptance remains.
Full follow-up receipt:
[RELEASE-GATE-RESULTS.md](RELEASE-GATE-RESULTS.md).

## Updated audit reconciliation

| Audit finding | Current source assessment | Remaining release condition |
|---|---|---|
| LH01/LH02/AS01 | Push authority, Gemini credential transport and unconditional trace-off remain repaired | Deploy source; historical cleanup/rotation is separate; beta-code rotation remains owner-deferred |
| F01 | PR244 binds join, in-session purchase and quick-book to JWT identity before database operations | Actual financial/card/concurrency behavior remains outside SQLite authority qualification |
| F02 | PR244 restores gallery redemption; follow-up scopes queue/items/redemption/sweep by owner, photographer and session/gallery | Six prior defects reproduced twice;152expanded/new8repeat pass;5526backend hosted green; PG concurrency remains |
| FCA01 | PR244 separates the damage snapshot from the island reassert gate | Actual painter tests cover401/850/1199, coarse68/205/399 and kill205/850; native GPU/geography acceptance remains |
| FCA02 | PR244 restores readable forecast chip classes on the existing dark card surface in all three themes | Mounted light/dark/beach controls pass; broader desktop/mobile visual acceptance remains |
| CD01 | main still requires lint-and-build (18.x); current job emits (24.21.0) | Coordinate a stable check name with protection, or explicitly update the required context before main promotion; preserve protection |
| TLD02 | PR242/244 merge receipts reconstructed; hosted ledger gates at838514dc/4a7671a9 SUCCESS | Resolved missing-history gate; preserve append-only ledger |
| LIVE04 | grid_series has a default-off response bound; /grid has no deadline | Do not describe this as complete CPU cancellation or a grid-wide deadline repair |
| WI02/WI03 | Source repaired;67current/216expanded twice,51new cases;1912639b hosted5577backend/3700frontend | Unknown legacy provenance now warns; cloud publication/every-lane and rollout acceptance remain separate |
| LIVE01/LIVE02/WC01 and science/geometry rows | Still open; matching file names are not proof of repair | Index scan/cache work, height floor, canonical composition, mixed-sea/partition controls and disjoint held-outs require separate repairs/evidence |

The four section11 merge blockers were fixed by PR244 merged into the repair branch, not dev.
Historical13f6d0a9 hosted counts were5504backend=2360guards+2049chain+1095estate,
356frontend suites/3700tests. Estate296selected/294produced/0silent; existing skipped
coverage remains. Independent local replay:20backend and29frontend pass, no failures.
Local Python reports two declared packages absent; hosted Linux remains the full environment authority.
The separate Weather Program Ledger run37357966994 failed on missing PR242.
Docs838514dc reconstructs PR242/244; its ledger37377273489 completed SUCCESS.
Docs4a7671a9 application CI37377554458 all11SUCCESS; runtime unchanged from13f6d0a9.
The current ingestion source1912639b is qualified by CI37388965928 all11SUCCESS:
5577backend and356suites3700frontend; supplementary gates success. Predecessorf48d15e6 had
5526backend. Later receipts and standalone audit instruments change no runtime/CI-test/workflow
source; actual cloud publication is still unexecuted. Unknown model-cycle provenance now warns
unconditionally in the candidate. The supplementary Gulf frame-to-pixel diagnosis remains open.

## Release sequence

1. Record PR242/244 merges, qualify the ledger on the resulting exact head, and update the stale PR
   description and canonical state. Review the blocker delta rather than redoing the correct security fixes.
2. Choose the first deployable scope. The urgent push/Gemini/trace slice can be separated from broad
   financial and UI behavior if their acceptance is not ready. The full PR has unconditional changes:
   restored financial routes, alert cooldown/zero-bound semantics, entitlement rejection and unavailable
   selfie matching. Explicitly accept these product changes and qualify the relevant PostgreSQL/card
   paths before calling the entire bundle deployment-ready. No actual charges during validation.
3. Read actual Render settings and migration state. This single service serves both dev and production;
   deploying from dev changes the production API too. Configure a lightweight readiness health check,
   confirm effective flags and migration compatibility, and record rollback to the prior verified build.
   A frontend-only Netlify preview cannot isolate backend or database effects.
4. Deploy the approved source with new forecast/performance switches still off. Read back the exact API
   build and dev frontend version. Preserve the production frontend freeze and verify its deploy lock
   before relying on it; the new Netlify ignore command is no longer an unconditional production skip.
5. Activate one qualified feature group at a time on an isolated/dev path with owner approval. For a
   server flag on the shared Render service, either isolate the backend or explicitly account for its
   production impact. Client flags require a Netlify build; setting an environment variable alone does
   not change an already-built bundle. Existing dev-only ICON-tail approval is not approval for new flags.
6. Post-deploy: verify safe auth denials without writes, matching-user compatibility, legacy forecast
   parity, job errors and rollout metrics. For playback, record requested/served/drawn hour under play,
   scrub, slow fetch and rapid changes; never advance into an incomplete frame. Check all three themes,
   mobile, land masks, missing versus measured zero and rollback switches. Measure GPU/heap/FPS in a
   native browser and latency in isolation; do not load-test the shared live box.

## Flag groups that merging does not activate

| Group | Switch names | Acceptance before activation |
|---|---|---|
| Point/availability/playback | POINT_PRODUCT_IDENTITY, SURF_STRICT_AVAILABILITY; REACT_APP_POINT_REQUEST_IDENTITY, REACT_APP_MARINE_VALUE_VALIDITY, REACT_APP_FORECAST_STATE_IDENTITY, REACT_APP_GFS_EXACT_PLAYBACK | Product/hour parity, missing/zero controls, native play/scrub/slow-fetch acceptance |
| Requested horizon/Copernicus | SURF_REQUESTED_HORIZON, COPERNICUS_TERMINAL_TIME_GUARD | Actual unset-default pin tests, bounded hub latency, terminal-versus-retry controls; parity across serving/ingestion/precompute/monitor |
| Work/cache/decoder bounds | GRID_SERIES_RESPONSE_BOUNDS; REACT_APP_MARINE_SERIES_WORK_BOUNDS, REACT_APP_MARINE_SERIES_CACHE_BOUNDS, REACT_APP_RASTER_WORK_BOUNDS | Partial-page/nonfinite failure contract, permit retention, isolated latency and native heap/GPU acceptance |
| Publication | MANIFEST_IMMUTABLE_PUBLICATION | Actual-source Dev upload/CAS/two-writer/readback/cleanup canary; requires STAGING_SUPABASE_URL and STAGING_SUPABASE_SERVICE_ROLE_KEY securely supplied to the runtime |
| Sampler/sim/composer | SAMPLER_EXACT_VALIDITY, SIM_FORECAST_SERVED_GATE; REACT_APP_COMPOSER_CONDITIONS | Geometry/provenance controls, canonical composition, mounted consumer/device acceptance and applicable held-out science evidence |

All listed new switches default off/unset in source. Authenticated provider key inventories confirm
their overrides are absent. Four new cases exercise actual environment-variable deletion; no new
switch was activated. Do not enable every switch as a batch. Unrepaired deadlines, ingestion, private-media, financial, observation and science findings
remain separate backlog, not automatically fixed by publishing this PR.

Official deployment guidance: [Render health checks](https://render.com/docs/health-checks),
[Netlify production locks](https://docs.netlify.com/deploy/deploy-overview/),
[Netlify environment changes require rebuild](https://docs.netlify.com/api-and-cli-guides/cli-guides/get-started-with-cli/).

## 2026-10-05 23:30Z: remaining ingestion repair candidate

WI02/WI03 runtime source now changes beyond qualifiedf48d15e6; the new candidate must
pass its own hosted run. Local67controls/216expanded twice; projected5577backend and
unchanged3700frontend. Invocation product progress is distinct from metadata, restore
and earlier runs. Health grades verified model cycles, with unknown/stale warnings
unconditional in this candidate; no serving model/value/science switch changed.
INGESTION-REPAIR-RESULTS.md states the exact scope and cloud/rollout limits.
