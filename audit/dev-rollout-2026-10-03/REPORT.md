# Dev rollout of accumulated audit repairs

Recorded 2026-10-03 18:17Z. Owner authorized: "ok push to dev and do all your recommendations".

[PR #228](https://github.com/dpritzker0905-cmd/Raw-Surf-Antigravity/pull/228) merged into `dev` at
2026-10-03T17:59:13Z. Tested head `4f3aaa410c8997406e3c35ad08dbe849ab88a265`; merge and live backend
`3de464b8ea9a467f67a9a04d4b6f87b6ce8ab6cb`. Render reports **Deploy succeeded | Live**, Auto-Deploy,
3m32s. Independent health readbacks agree with that revision. This service serves both dev and the
frozen public frontend. Main and that frontend freeze were not changed.

## What was published

All three accumulated repair batches are included: account/owner/admin boundaries, public profile
projection, wallet fulfillment/idempotence and failure semantics, env-only Strava configuration,
optional forecast preview isolation, dark spectral tide cap, per-domain sim identity, messaging
actor authority, dark finite/required simulation inputs with cache separation, and owner-bound
one-use OAuth state plus dark actual-served-time comparison. The earlier reports remain historical
local evidence: [first](../repairs-2026-10-03/REPORT.md),
[followup](../repairs-2026-10-03-followup/REPORT.md),
[OAuth/time](../repairs-2026-10-03-oauth-time/REPORT.md).

The new weather guards stay dark: `SIM_STRICT_INPUTS=0`, `SIM_SERVED_TIME_MATCH=0`,
`SURF_TIDE_DEPTH=0`, verified twice on the new runtime. Publishing their code is not activation
or a claim that the weather simulation is accurate.

## Hosted acceptance

[CI 37141260667](https://github.com/dpritzker0905-cmd/Raw-Surf-Antigravity/actions/runs/37141260667)
passed on the exact repair head. Fourteen GitHub checks succeeded. Actual pytest summaries:

| Lane | Passed | Existing skip/xfail | Projected passes |
|---|---:|---|---:|
| Simulation guards | 2248 | 66 skipped, 1 xfailed | 2248 |
| Forecast chain | 1876 | none reported | 1876 |
| Estate | 735 | 2865 skipped | 735 |

Ratchet margins6/6/2, lane exclusions and quarantine remain unchanged. Local Windows counts were
not substituted for hosted measurements. The Netlify preview status said canceled; it did not
supply preview acceptance. Live owner dev browser checks supplied the read-flow canaries below.
Post-merge [CI37142516639](https://github.com/dpritzker0905-cmd/Raw-Surf-Antigravity/actions/runs/37142516639)
also completed successfully at3de464b8 with the same actual2248/1876/735 counts. E2E remained
in progress at this readback; its outcome is not inferred from backend CI.

## Live PostgreSQL prerequisite

The actual backend database had no `public.strava_oauth_states` table in **two before checks**.
`profiles.id` is varchar(36), matching the FK. Runtime database/project target checks were true
without publishing connection strings or project IDs. Pinned SQL from tested4f3aaa41 verified
SHA256 `bc51467d3f33280f24f4190d5bc3234f38a800edccee225be3c6e13de9b3ba93` (863bytes).
Six statements ran in one transaction with lock_timeout2s and statement_timeout5s.

**Two after catalog checks** passed for table/RLS/restricted grants; **two actual role-read rounds**
denied anon/authenticated with SQLSTATE42501 and permitted service_role. Cascade FK and three
indexes including PK were verified twice. Post-deploy runtime checks repeated protections twice.
No existing profiles, account links, provider tokens or balances were edited. This follows
[Supabase RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security).
A diagnostic initially treated the asynchronous engine as synchronous and failed before SQL;
the corrected async read-only probe passed twice. No failed diagnostic is counted as acceptance.

## Paired live behavior

Each endpoint below ran **twice before and twice after** deployment. Missing synthetic identities
were used; no real customer data was requested. Callback probes included provider-denied error
so they could not exchange a token on the old implementation. No raw OAuth URL, nonce or response
body was saved into public evidence.

| Anonymous endpoint | Before, both runs | After, both runs |
|---|---:|---:|
| Strava status | 404 | 401 |
| Strava sync-recent | 404 | 401 |
| Strava auth-url | 200 | 401 |
| Strava denied callback | 400 | 401 |
| Messages unread-counts | 200 | 401 |
| Messages check-thread | 404 | 401 |
| Messages conversation-count | 200 | 401 |
| Health | 200, e0f93466 | 200 healthy, 3de464b8 |

After durations0.156-0.344s. These are a handful of sequential probes, not latency percentiles
or a load test. The protected outcome changes when verified identity is absent; legitimate
owner controls keep working. This is a controlled boundary sensitivity comparison, not a
numerical Jacobian or a full authorization census.

Owner positive controls: messaging list reloaded successfully twice; logs confirm conversation,
family-list and unread reads200. Strava status twice200 and the smartwatch modal settles at
Authorize Strava Account. No provider consent or exchange occurred. Profile/read controls
were inspected separately; no update or real financial action was used as a canary.

Spanish House/GFS conditions was healthy twice before, and twice after with current data,
tides and forecast link. Before3.5ft/0.8ft swell/12of100; after3.2ft/1.9ft/28of100. The current
forecast frame refreshed across rollout, so this difference is **not attributed to the repairs**.
This journey checks regressions; the earlier controlled upstream-outage replay proves preview
isolation and unchanged current inputs. No new live forecast-skill grade was measured.

## Observed startup and capacity

Render startup logged L2restore13097 products/0errors and prefetch120ok/0failed. The inspected
last-hour `too_many_connections` filter had no matches. Error-filter matches included our
intentional denied callback and a zero-errors restore message; they are not startup failures.
This is a bounded log window, not a claim that every service/log is clean.

Two health reads show RSS598.8/599.4MB, peak29.8% of2048MB, uptime313.5/314.9s.
A short post-boot sample cannot establish memory growth, steady-state capacity or a latency
SLO. The backend remains one shared CPU. No heavy server test was run. Existing
[Render linked-branch auto-deploy](https://render.com/docs/deploys) settings were read back,
not replaced from a blueprint.

## Closure limits and next acceptance

Deployment and the measured boundary/read-flow checks are complete. The wider audit remains
open. In particular:

- Confirm exposed credential rotation at the provider; code deletion does not rotate it.
- Exercise an owner-approved real Strava linking journey, expiry/replay, and concurrent claims
  against PostgreSQL; SQLite lifecycle tests and role proofs cover different contracts.
- Reconcile paid-credit fulfillment with the processor sandbox; validate monetary concurrency
  and precision without charging real users.
- Finish spot/run identity, period typing, nearest-row/rounded-coordinate cache aliases,
  tide/MOP combinations, and independently grade actual built products before serving flags.
- Close push delivery, capacity/SLO, accessibility/device/theme and the remaining family/route
  permissions findings with their own twice-before/twice-after instruments.
- Review open evidence/governance PRs on current dev; this rollout does not silently merge them.

Rollback code through a dev revert PR while retaining canonical ledger history and the additive
nonce table. Dropping the table/nonce rows is a separate reviewed database action and can
interrupt pending linking. No main push, weather promotion, customer message or real payment
was performed. Sanitized machine evidence: [results.json](results.json).

## 2026-10-03 18:22Z — overdue evidence and monitor diagnosis

The S7/S8 first-results commitment172 is checked: live +24h rows are scored.

| Source | Direction n | Direction MAE deg | Period MAE / bias s |
|---|---:|---:|---|
| GFS raw_surf | 407 | 24.38 | 2.012 / +0.511 |
| EURO | 407 | 25.31 | 1.830 / -0.739 |
| ICON | 407 | 32.43 | 2.548 / -1.704 |
| Persistence | 404 | 27.77 | 2.326 / -0.056 |

The Sep30 snapshot18.6deg/1.5s was a first-row nowcast at a different lead/window; these are not
a paired before/after improvement claim. Period types remain an audit issue.

`forecast_skill_ops` is now present (ledgered1383, scored172, pending45006, cap-evicted0).
The latest [accuracy monitor37139645631](https://github.com/dpritzker0905-cmd/Raw-Surf-Antigravity/actions/runs/37139645631),
which predates this rollout, fails an **operational skill floor**: +24h438 paired keys, raw_surf
MAE0.176m versus persistence0.162m (reported delta+0.015m), win47% below50%. It does not fail
for missing ops or an insufficient sample in that run. Correlated observations do not establish
statistical significance. Do not lower the gate or assume the open month-seam PR will make it green.
The scalar lane has height rows, but full paired/lead/band acceptance remains owed. Commitments149
and309 stay open. Closing one memory warning does not close weather skill or monitor acceptance.
