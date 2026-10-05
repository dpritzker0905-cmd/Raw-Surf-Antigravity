# Deployment readiness: updated audit versus actual repairs

Verified 2026-10-05 21:35Z. This is a deployment assessment, not deployment authorization.
The supplied deep REPORT.md includes sections 10 and 11, and its current SHA256 is
`be4914fbc8de71b1cfada3b7beb0f78e669c8fd6b5090fefbc3678accb5b72c0`.
Its merge-blocker review is of `0bb3aec0`; the actual PR243 head is now `13f6d0a9`.
This supersedes the older deployment status in PROGRESS.md without rewriting historical receipts.

## What is actually running

| Component | Fresh evidence | Meaning |
|---|---|---|
| PR243, targeting dev | OPEN, MERGEABLE, head13f6d0a9; CI37357966896 all11 application jobs success | Repaired source has not reached dev |
| Shared Render API | Public /api/health healthy, version ends6b062e97; /api/health/data ok, alerts empty | Current PR backend is not live; health does not certify model-cycle freshness |
| Netlify dev | service-worker BUILD_VERSION2a7b8615 | Current PR frontend is not live on dev |
| Netlify production | service-worker BUILD_VERSIONfc140024 | Owner's frozen frontend remains served |
| Netlify PR243 preview | service-worker BUILD_VERSION13f6d0a9 | Latest frontend preview exists; it still uses the shared backend |
| Separate Supabase Dev | Scoped SQL: pointer0rows, auth0users, weather bucket0objects, private, pointer RLS enabled | Connector works; real publication canary is still unexecuted |

Render and Netlify connectors are not exposed in this session. The public Netlify dashboard
confirms the published frozen commit, but is logged out and does not establish its current lock,
configured build branch or environment values. Render's actual build command, health-check path,
auto-deploy mode and full effective flags must be read back before a deployment. The previous audit
reported an empty health-check path and migrations in the live build command. Do not apply
render.yaml wholesale: that source file is not proof of current service configuration.

## Updated audit reconciliation

| Audit finding | Current source assessment | Remaining release condition |
|---|---|---|
| LH01/LH02/AS01 | Push authority, Gemini credential transport and unconditional trace-off remain repaired | Deploy source; historical cleanup/rotation is separate; beta-code rotation remains owner-deferred |
| F01 | PR244 binds join, in-session purchase and quick-book to JWT identity before database operations | Actual financial/card/concurrency behavior remains outside SQLite authority qualification |
| F02 | PR244 restores gallery-scoped on-demand redemption and prevents cross-gallery redemption/leftover sweeping | Quota-specific item listing tested; whole queue listing and odd legacy data need broader acceptance |
| FCA01 | PR244 separates the damage snapshot from the island reassert gate | Actual painter tests cover401/850/1199, coarse68/205/399 and kill205/850; native GPU/geography acceptance remains |
| FCA02 | PR244 restores readable forecast chip classes on the existing dark card surface in all three themes | Mounted light/dark/beach controls pass; broader desktop/mobile visual acceptance remains |
| CD01 | main still requires lint-and-build (18.x); current job emits (24.21.0) | Coordinate a stable check name with protection, or explicitly update the required context before main promotion; preserve protection |
| TLD02 | Hosted ledger gate fails because PR242 has no merge record; PR244 is also not yet recorded | Reconstruct both from GitHub merge metadata and get the exact new-head ledger gate green |
| LIVE04 | grid_series has a default-off response bound; /grid has no deadline | Do not describe this as complete CPU cancellation or a grid-wide deadline repair |
| WI02/WI03 | Causal diagnosis only, not repaired | Empty ingestion must fail correctly; health must measure model-cycle freshness before claiming closure |
| LIVE01/LIVE02/WC01 and science/geometry rows | Still open; matching file names are not proof of repair | Index scan/cache work, height floor, canonical composition, mixed-sea/partition controls and disjoint held-outs require separate repairs/evidence |

The four section11 merge blockers were fixed by PR244 merged into the repair branch, not dev.
Hosted current-head counts are5504backend=2360guards+2049chain+1095estate,
356frontend suites/3700tests. Estate296selected/294produced/0silent; existing skipped
coverage remains. Independent local replay:20backend and29frontend pass, no failures.
Local Python reports two declared packages absent; hosted Linux remains the full environment authority.
The separate Weather Program Ledger run37357966994 is FAILURE. Do not call all checks green.

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

All listed new switches default off/unset in source. Effective provider values were not independently
read in this session. Capture them without credentials before deployment; do not enable every switch
as a batch. Unrepaired deadlines, ingestion, private-media, financial, observation and science findings
remain separate backlog, not automatically fixed by publishing this PR.

Official deployment guidance: [Render health checks](https://render.com/docs/health-checks),
[Netlify production locks](https://docs.netlify.com/deploy/deploy-overview/),
[Netlify environment changes require rebuild](https://docs.netlify.com/api-and-cli-guides/cli-guides/get-started-with-cli/).
