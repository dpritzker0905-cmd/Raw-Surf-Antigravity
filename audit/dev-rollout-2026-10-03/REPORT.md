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
- Exercise an owner-approved real Strava linking journey and provider exchange. Actual PostgreSQL
  concurrent claims/replay now pass twice with a mock provider; that is a separate contract.
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

## 2026-10-03 18:42Z — redirect configuration and live nonce race

Extended acceptance found a configuration gap: actual dev `/surf-log` redirect rejected400
twice because STRAVA_REDIRECT_ORIGINS was absent and frontend fallback was localhost. The
owner status200 control above tested reading status; it did not certify linking issuance.
Added only the existing dev/public Netlify origins to STRAVA_REDIRECT_ORIGINS through the
Render dashboard. Runtime Save and deploy succeeded Live1m16s at unchanged3de464b8.
Actual dev redirect passes200 twice; foreign origin and foreign path still reject400 twice.

Two real PostgreSQL race rounds each issued one synthetic owner-bound nonce and launched two
concurrent callback claims. Exactly one reached the controlled rejecting provider mock; the
other claim and subsequent replay rejected. Owner tokens were unchanged twice. Two consumed
fixtures remain retained. No nonce, OAuth URL, connection string or token was printed/saved.
The mock was confined to a separate Shell process, with no real provider request or live API
worker modification. Route calls inject the known owner directly; separate HTTP probes prove
the authentication boundary. This is not an end-to-end real OAuth acceptance certificate.

After config redeploy, all seven anonymous routes still401 twice and health200 healthy twice
at3de464b8. RSS608.7/608.8MB, peak30.2%, uptime485/486.9s; a short canary, not a capacity SLO.
RLS/restricted grants and all three dark weather flags were read back successfully twice.
No served weather number changes from this runtime configuration repair.

## 2026-10-03 19:01Z — browser acceptance remains open

[E2E37142516586](https://github.com/dpritzker0905-cmd/Raw-Surf-Antigravity/actions/runs/37142516586)
was cancelled at its50-minute job bound. No failure-trace artifact survived. Its99 printed
attempt rows include47 passed/44 failed/8 skipped **attempts**, including retries; these are
not final test totals. Spot-hub and marine-render journeys fail in multiple browsers.
The suite seeds synthetic browser users without verified backend identity;401 counts alone
do not prove causation. A real owner Explore read and spot-hub read each failed once and worked
on retry. Public dependency reads returned200 twice: Explore9.56/8.78s with8 spots, spot-details
3.56/4.06s with current and10 forecasts. This is not stable end-to-end acceptance.

Diagnostic workflow changes isolate title/project with quoted argument arrays, allow one fresh
attempt, and stop the test step at40minutes within the50-minute job bound so always-upload can
preserve traces. Push acceptance keeps the complete suite, existing assertions and retries.
The failure has not been attributed or repaired yet; targeted trace reproduction is next.

Report CI37145251962 floor check refused a stale GitHub API reading of a17-day-old successful
run even though fresh dev CI is available. A targeted retry while the enclosing run was active
was refused before dispatch; retry after run completion is pending. No threshold was lowered.

## 2026-10-03 19:20Z — traced synthetic session fixture repair

Fresh Desktop Chrome spot-hub baselines [37146663057](https://github.com/dpritzker0905-cmd/Raw-Surf-Antigravity/actions/runs/37146663057)
and [37147047704](https://github.com/dpritzker0905-cmd/Raw-Surf-Antigravity/actions/runs/37147047704)
each failed one test. The first retained screenshot/video/HTML; on-first-retry config produced no
trace at retries0, corrected by an explicit diagnostic trace option. The second trace shows
synthetic unread-counts401 at19:14:43, then client session redirect/cancelled spot request at19:14:45.
Final page is auth/signup. Site gate verifies200, and trending/conditions200 precede the redirect.

The UI tests seed local synthetic users rather than verified backend accounts. A shared fixture
now supplies only their incidental GET unread-message badge at the exact backend origin/path for
the two declared fake IDs. It refuses real identities and passes through writes, other origins
and every weather/spot/auth request. Boundary controls pass twice; hosted after checks pending.
[Playwright route ordering/fallback](https://playwright.dev/docs/api/class-route#route-fallback)
informs registration after the existing external-resource router. Production authentication and
all UI assertions remain intact. This fixture is UI acceptance, not end-to-end identity acceptance.
Private trace bodies stay in ignored local artifacts; public evidence contains no credentials.

## 2026-10-03 19:32Z — paired focused acceptance

| Fresh spot-hub run | Result | Controlled change | Real spot request |
|---|---|---|---|
| Before37146663057 | 1failed | none | cancelled after session redirect |
| Before37147047704 | 1failed | trace retention only | cancelled after badge401/session redirect |
| After37147556271 | 1passed | only synthetic badge fixture | 200,4.109s |
| After37147738635 | 1passed | same fixture, fresh context | 200,3.643s |

Successful traces retain weather/spot responses and contain no action errors. Direct requests
to the **actual** unread-count endpoint still401 twice; health200 healthy twice at3de464b8.
No production auth behavior changed. This controlled fixture perturbation removes the redirect
while real spot composition stays live; it is not a numerical weather-accuracy Jacobian.

The [full browser suite37147928653](https://github.com/dpritzker0905-cmd/Raw-Surf-Antigravity/actions/runs/37147928653)
is pending at this checkpoint, with all four projects, assertions and normal retries2/worker1.
The two focused passes do not certify that broader suite. PR230 exact-head CI also follows.

## 2026-10-03 19:56Z — full suite and distinct failure mechanisms

Full37147928653 finished: **60passed,2failed,1flaky,9existing skips**,72 total in21.8min.
Both Safari spot-hub journeys fail; Chrome spot-hub passes only on retry2. Retained Safari traces
show synthetic badge401 without the fixture header and cancelled spot request after session redirect.
Chrome retains fixture200, then a real spot request times out at the unchanged15s Axios budget;
its final screenshot shows the correct unavailable/manual-retry UI. These are distinct mechanisms.

Playwright recommends blocking service workers for intercepted requests ([official routing docs](https://playwright.dev/docs/api/class-page#page-route)); that is the first controlled hypothesis
for Safari. Matcher/origin compatibility is the second. Real transport latency remains separate.
Fresh Safari baseline37149619694 is running; no worker setting or live auth behavior changed yet.

The nine pre-existing skips are four executed-pixel fixmes, two mobile continuity exclusions,
and three Firefox WebGL capability refusals. They limit device/GL coverage and were not added here.
Required PR230 CI37148313603 at0fc5e9f6 is successful:2248guard/1876chain/735estate passes,
with66guard skips/1xfail and2865estate skips; same floors and margins.

## 2026-10-03 20:05Z — intermittent Safari controlled repair

Fresh Safari baselines37149619694/37149843112 are **1passed/1failed** unchanged. Passing trace
uses fixture200 and real spot2004.876s; failing trace loads worker200, receives badge401 twice
without fixture marker, and times out at90s. The full suite also retained two failing Safari
journeys with this mechanism. Do not rewrite the mixed baselines as two fresh failures.

Seeded Explore tests now block service workers per the official interception contract; anonymous
journeys retain workers. Setup asserts a completed synthetic badge fulfillment. This strengthens
fixture observability; real identity/auth, spot/weather requests and product code are unchanged.
Boundary controls pass twice; hosted after pair is pending. Chrome15s timeout remains a separate
capacity issue. Passive Render CPU chart reaches100percent in that request window; no specific
heavy function or causal coefficient established.

## 2026-10-03 20:26Z — four-browser pair and independent capacity candidate

Worker-control after runs37150377846/37150639002 each **4passed,0failed,0flaky,0skipped**,
with zero retries. All four retained traces per run show badge fixture200, no worker-script request
or action error, and unmocked real spot200. Real spot durations4.276-4.837s /4.571-5.747s.
Full normal suite37150963742 is running. Latest5d9e92f2 CI37150378034 succeeds:2248/1876/735
passes with unchanged floors/margins and disclosed existing skips/xfail.

The audit capacity recommendation is being advanced independently: current dev materializes
full global-mid grids before thinning. The existing PR222 candidate was reviewed against current
5d9e92f2, preserving its other repairs, and copied only into an ignored isolated snapshot.
Eighteen existing real-store parity/materialization cases fail twice because the full cache entry
remains; the same normalized outputs compare equal. Candidate42checks pass twice, including
damaged/non-global/antimeridian fallbacks, kill switch, cache immutability and dark max thinning.

| One-core synthetic16-hour page, stride4 | Old round1/2 | Candidate round1/2 |
|---|---|---|
| Cold CPU seconds |1.4375/1.3906|0.3281/0.3438|
| Cold wall seconds |1.5100/1.5348|0.3949/0.4207|
| Repeated page L1 hits |0/0|16/16|
| Retained L1 vectors |105161/105161|15456/15456|
| Normalized sixteen-frame equality |exact|exact|

Each output retains966cells/frame; raw synthetic inputs15023cells/frame. This varies the read
strategy while holding the stored physical fields fixed. No live-performance multiplier, actual
product skill improvement or server-capacity closure is inferred. Candidate source672b996e and
file hashes are in sanitized results; no production code/deploy has adopted it yet.

Local setup initially had42errors from a site-package tests namespace collision; a local package
path shim retained the actual L1 mutation guard for both accepted after runs. First accepted run
lacked workflow metadata; the second includes pinned current workflow and reports2missing declared
packages/no virtualenv. These passes describe that local environment; hosted/current-head and
live rollout proof remain required. The prior malformed-grid tiny-spacing lattice hazard and
joint concurrency/SLO recommendations remain separate open issues.

## 2026-10-03 20:39Z — PR230 merged; remaining transport retry isolated

Full normal acceptance37150963742:62passed,0final failures,1flaky,9existing skips.
Retained Chrome retry trace has fixture200 and real spot cancellation/Axios15000ms timeout;
Safari interception failures resolved, whole transport/SLO not certified. Exact5d CI success.
PR230 merged449b3b910278c52b5d0dde64d1fd5bee4f0e9ffc at20:39:06Z; actual deploy pending.
Capacity candidate13neighbor files:275passed/0failed/0skipped,3warnings,46.25s in disclosed local
environment; candidate not deployed. Ledger432full verdict/433neighbor check/434PRbody/435merge.

## 2026-10-03 20:47Z — capacity repair checkout and live baseline

PR230 backend449b3b91 Live and healthy200twice; badge401twice. Postmerge E2E37152301831 pending.
Capacity applied onto449b3b91 from the four source hashes already reviewed; all earlier repairs retained.
Actual checkout42pass twice15.73/11.23s;22floor controls pass. Partition608tracked/180guards/147chain/
278estate/2FastMCPexcluded/1quarantine. First partition invocation used repo root and found0; corrected
required backend cwd gives actual partition proof. Blocking lint0; file-size check116files0violations
(route helper760LOC). Hosted chain1918 is projected from checked5d run1876 plus42executed cases;
floor1912 and147files keep the margin6, reference moves with it; guards/estate unchanged.

Bounded live BEFORE: fixed21Z GFS global waves6offsets0..15h;200twice,6of6storedglobal_mid/NOAA,
3822vectors/frame,3.579MB,2.8302/2.9111s; all physical hashes identical between reads. Initial lowercase
model request422 was a probe enum error, corrected to documentedGFS and excluded from acceptance.
No load/concurrency/SLO claim. Candidate default-on identity read changes materialization, with explicit
MARINE_MID_SERIES_LOAD_STRIDE=0 rollback; it does not promote max thinning or scientific serving flags.
Ledger436deploy/437checkout build/438live baseline. Hosted/current-head and after-deploy proof pending.

2026-10-03 20:48Z readback (ledger439): live449b3b91 actual catalog/grants pass twice;
three scientific flags0 twice. Canonical docs memory0FAIL/2WARN/11NOTE; unchanged overdue149/309.

## 2026-10-03 21:07Z — capacity merge and separate bounded-allocation proof

PR231 at7cd898f4 passed hostedCI37152927047:guards2248/66skip/1xfail12warnings814.20s,
chain1918/7warnings517.64s,estate735/2865skip128warnings73.18s. Merged4b152937b98b00ebaf43da88cd9a5f9f8a132ad1
at21:05:40Z; actual deploy/after proof pending. PR230 exact-dev full browser37152301831:63passed,
0failed,0flaky,9existing rendering skips. Dev CI37152301913 attempt2success: initial floor job
refused48-day stale GitHub API result31958635101(Aug16); targeted retry, no floor/budget relaxation.

Separate malformed-grid recommendation: small inferred spacing can request enormous axes and fill
products; nonfinite or huge finite longitude can spin during normalization. Work stayed isolated.
Two initial probe attempts reached distinct untrapped longitude loops; only their owned Python
children were stopped, no large lattice allocated; neither is accepted baseline evidence. Final
harness adds loop traps, range/placeholder traps and45s child timeout. An intermediate after result
20pass/1fail was a legitimate small resolution-derivation range misclassified by the instrument;
separate counters corrected it and the entire before/after pair was rerun. Subsequent finite-bound
and subnormal-resolution controls expand the final instrument to28cases: BEFORE23failed/5passed
twice(.25/.24s), AFTER28passed twice(.06/.06s). The after guard uses the existing250000-vector
serve ceiling before either axis or cross-product allocation, rejects unsafe geometry before
normalization, returns an empty diagnosed partial clip, and copies diagnostics instead of altering
L1. Exact shared-cap and valid/empty-clip null controls pass. Candidate source784LOC, no tracked
code adoption/deploy yet; earlier21case neighbor296pass is superseded by final expanded neighbor
run pending. These are malformed-input containment proofs, not forecast skill or live SLO claims.
Ledger440push/441PRopen/442E2E/443CIrerun/444CIcounts/445body/446merge/447isolatedguard.

## 2026-10-03 21:19Z — live capacity same-file proof; guard prepared

Capacity4b152937 is Live/healthy200twice(662.6MB), anonymous badge401twice. Bounded HTTP AFTER
returns6of6NOAA/global_mid frames200twice,4.0524/1.6237s,3.578MB. AFTER hashes agree with each
other but differ from BEFORE; baseline raw source bytes/run identifiers were not retained, so
source-cycle vs downstream change cannot be assigned and cross-deploy physical equality is NOT
claimed. No live speed multiplier/SLO conclusion from these two timings. A direct same-current-file
control on deployed8hprt varies only the tier read strategy in a separate Shell Python process:
old kill0 vs new1, six exact local21Z..12Z files, two rounds. All twelve pairs are equal in EVERY
normalized product field; file hashes unchanged across all arms, actual optimized lane taken each
time, retained per-file cache15023to3822vectors. No service env/flag changes, no L2/provider I/O,
no source writes, no API-worker cache mutation. This is real stored-tier parity, not a complete
HTTP before/after attribution or independent weather grade. Full E2E37153891426 pending.

Final allocation guard neighbor run303passed/0failed/0skipped,4warnings54.87s; actual checkout
28passed twice(.36/.36s), final paired floor controls22passed(.42s). Selector proves this
new test_grid_* file belongs to GUARDS:609tracked/181guards/147chain/278estate/2excluded/
1quarantine. The initial unpublished chain projection was corrected before publication; expected
guards2276/floor2270, exact181files andmargin6; chain1918/floor1912 unchanged, estate unchanged.
File-only size invocation scanned0 and is excluded; real directory check116files/0violations,
route_helpers784LOC. Blocking lint0. Final source hashes pinned to isolated before adoption.
Local dependency limitation remains2declared packages absent/no virtualenv; hosted/live pending.
Ledger448final neighbors/449checkout adoption/450actual capacity deploy/451same-file proof.
