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

## 2026-10-03 21:39Z — allocation merge, browser reliability limit, CI-history repair

PR232 exact3bb8f443 passed all hosted gates: guards2276passed/66skip/1xfail,12warnings841.70s,
181files; chain1918passed/7warnings537.64s,147files; estate735passed/2865skip,128warnings58.13s.
Merged dev e4242f2064098e65651fa1ac6776f362b9946ad3 at21:36:42Z. Render Building observed;
actual after proof/full E2E37155710907 pending. Capacity postmerge37153891426 has60passed,
0final failures,3flaky,9existing skips, HTMLokfalse. Retained Chrome retry trace provesfixture200
and real spot-details-1/Axios15000timeout; Safari retained traces capture successful retries only,
so their prior failure cause is unassigned. Exit-green is not a reliability/SLO closure.

Three floor-history refusals on valid recent dev revisions prompted independent review of existing
PR224 at184f6678. Adopt its bounded three-attempt dual CLI/REST lookup onto currentdev, not its old
workflow floors or ledger. Extend lookup calls with30s deadlines (six calls plus20s backoff at most
200s for history lookup), reject malformed ids/SHAs/timestamps, missing timezone/future times before
accumulating a source. Errors stay named, all stale/unreadable answers still refuse;14day age limit
unchanged. Final36controls: BEFORE12fail/24pass twice(.15/.12s), AFTER36pass twice(.13/.13s);
actual checkout36pass twice(.53/.48s). Initial isolated-path/default-argument harness failures were
corrected and excluded; paired evidence was rerun in full. Local2missingdependencies/notvirtualenv
remains a limitation. Actual GitHub candidate reads twice: CLI named17-day35183181239, REST
named current37153891363/4b152937; both recovered actual180guards2248/147chain1918/estate735.
Current workflow untouched except estate733to747: established735 plus14 new tests predicts749;
margin2 and guard/chain budgets unchanged. Official source: [GitHub CLI run list](https://cli.github.com/manual/gh_run_list)
and [workflow-runs REST endpoint](https://docs.github.com/en/rest/actions/workflow-runs#list-workflow-runs-for-a-workflow).
These docs establish supported filters/fields, not the cause of the observed divergent answers.
Ledger452push/453PRopen/454retry/455E2E/456body/457CI/458merge/459pairedreview/460realreads/461adoption.

## 2026-10-03 22:11Z — live CI recovery, monitor window, owner latency target

PR233 checked f9cd940466b3f7f6c35b3503f8c8465201f6d217 passed14hosted gates.
CI37155975799 actual: guards2276passed/66skip/1xfail/12warnings828.15s,181files;
chain1918passed/7warnings519.81s,147files; estate749passed/2865skip/128warnings42.82s,
278selected/276results/0silent. Merged dev bd070fd6fc1da1201c25bb47d7e2b8594794bd67
at22:00:01Z; Render actual Live3m06s. Exact HTTP health200/healthy twice626.8MB,
anonymous real badge401 twice. Postmerge CI37156951424 and E2E37156951431 still running;
no new dev merge while shared backend browser acceptance is active.

Allocation e424 actual Live, health200 twice, badge401 twice. Deployed canonical Gitblob source
9480ff65a6671e91039b0319d36efeb65830affd7903a43ad3fd19b8f686648d matches. Five malformed
cases rejected twice in bounded separate Shell process, valid small axes unchanged, writes0.
First source-hash instrument used CRLF working bytes, failed before unsafe calls; corrected to
canonical Gitblob then both rounds rerun. PG catalog RLS/grants alltrue and three scientific
serving flags0 twice; these catalog reads are not new SETROLE proof. Full E2E37155710907 has
62passed/0finalfail/1flaky/9existing skips, HTMLokfalse despite job success. Retained DesktopFirefox
successful retry has realspot2004342.348ms, badge fixture200; first failure cause unassigned.

Owner selected FIVE SECONDS as response-time target for95percent of dev spot-hub loads.
Latency must be reported separately from functional success and retries. Initial-attempt timeouts
count as misses; repeated attempts are separate attempts. A paired two-run instrument does not
establish population-p95 or close an SLO; deployment/source/cache/load identity must accompany
sample reports. Browser usable-state timing and API response latency must remain distinct.

Reviewed PR225 at63b1bf8cbf1a2bcd52ebde91c7646ed965277df8. Narrow monitor script/tests adopted
onto currentdev; current CI floors/ledger retained. Shared seven-day constant drives both archive
selection and evaluator. During first week fetch previous month once; afterwards no33MBprior
object fetch. Liveness keeps its shorter original seam; thresholds unchanged. Final instrument:
BEFORE1failed36passed twice(.19/.19s), AFTER37passed twice(.08/.06s), checkout37passed twice
(.35/.32s), combined monitor/floor/partition84passed(.68s). Synthetic paired-positive fixture
proves comparison availability, not real forecast skill or an all-green main verdict. Expected
hosted guards2276+2=2278/floor2272,181files/margin6; chain1918/floor1912 andestate749/floor747
unchanged. Hosted/live monitor acceptance pending. Current real monitor37157286033 independently
red at+24h: n547, oursMAE.174 versus persistence.170, delta+.005m, win49percent; +48/+72win.
The repair does not conceal that legitimate operational-floor failure; correlation limits inference.

Final isolated identity candidate32controls uses actual keyword helper in baseline, locally generated
JWTs and DB traps, no model/CDN/photo/customer operations: before30fail2pass twice(.42/.43s),
after32pass twice(.56/.51s),10warnings. Proposed false/0/unavailable matching and ownerJWT gates
for3POSTs+pending-listGET. Valid owner GET empty read remains200. Candidate NOT adopted,
no real biometric implementation or customer claims/access/notification changes. Earlier28case
and stubbed baseline instruments superseded/excluded. Advisory whole-tree backend lint exposes
missing os in weekly financial email report, timedelta in selection deadline, json in duplicate
legacy Stripe handler; exact active route ordering must be verified before any handler repair.
No financial/email/deadline runtime source changes yet. GitHub transient503 history reads were
bounded and treated as unavailable, not failed product checks. Local runtime still lacks2declared
packages and is not CI/production environment parity. Ledger462-473 records these receipts.

Final current candidate rerun:84passed.67s, blocking narrow lint0, actual tracked partition609/181/147/278/2excluded/1quarantine, docs-only memory0FAIL2WARN11NOTE. Initial mistyped companion filename produced0tests and is excluded; corrected full run passed. Ledger474.

## 2026-10-03 22:33Z — monitor merged; truthful identity capability and owner gates prepared

PR234 exact f395a503fab81b9e52ad05fe467f70ce3e1d85c0 passed all14hosted gates.
CI37157703688 confirms guards2278/66skip/1xfail/12warnings835.35s181files,
chain1918/7warnings511.80s147files, estate749/2865skip/128warnings74.87s,
278selected276results0silent. Dev merge8ec73bd1d4020b1cda795664a5f369f74707684d
at22:31:06Z. Actual deploy and monitor after proof pending; same14day CI age and skill thresholds.

Priorbd full E2E37156951431/job111302173360:62passed0finalfail1flaky9existing skips,
HTMLokfalse. Chrome retained FIRST RETRY fails real spotstatus-1 with Axios15000timeout;
initial attempt not retained, second retry ultimately passed. No initial-cause assignment.
Two fresh bounded direct anonymous API reads, same spot/model/free query, exactbd:5.2438s
(misses5s) and4.3972s(meets5s),200both/10forecast days/no retries. Weather projection hashes
DIFFER; includes producer time fields, no source/cache identity proof or cross-response physics
parity/cause claim. Telemetry cumulative same process n6,3over10s,max20.8248s,avg10.4345s;
p90/p99 overflow fields only establish >=10s, printed20.8248s is max, NOT measured percentile.
Small sample confirms actual misses, not population p95 or browser load SLO acceptance.
First timing instrument shadowed builtin round and failed before recording; discarded, both
rounds rerun. First telemetry extractor used wrong routes key, yielded no evidence; corrected
full pair reads top_routes. Single named artifact download extracts index at root; reader root
corrected before counting. No timeouts increased and no retries hide missed targets.

Identity service currently fabricates positive confidence from filename/category/description,
with fallbackpositive. Three matching routes accepted actor query strings; pending queue GET
had noJWT gate. Repair preserves public service contracts but returns is_matchfalse/confidence0/
methods[]/unavailable, batchURLs retained and board observedNone. Three POSTs bindJWTactor
before503 manual-review guidance, no DB/scan charges/newclaims/notifications. GET pending
sessions bindsJWTowner and retains owner-filtered empty-read200. Removes dormant image-inference
code and unused private selfie resolver; no replacement biometric engine, no image/provider/CDN
operations, no synthetic matching confidence, no actual customer scans/uploads/claims/messages.
Frontend FindMe still presents selfie upload before calling the server; UI unavailable capability,
legacy stored suggestion confidence and broader manual claim/object ownership are separate OPEN
work. This patch does not certify the entire gallery or every resource authorization boundary.

Final revised32case isolated instrument uses actual old Cloudinary keyword helper (no I/O), genuine
locally generated JWTs and DB traps: BEFORE30failed2passed twice(.41/.41s), AFTER32passed twice
(.53/.54s),10warnings. After removes unused selfie helper; earlier32case.56/.51proof superseded
for revised candidate. Failed environment/encoding preflights produced no valid test summaries
and are excluded; corrected complete before/after pair rerun. Actual checkout real package imports
with actualconftest/L1guard:32passed twice4.10/4.00s12warnings;190companions19.18s90warnings;
blocking changed-file lint0. Tracked partition610/181guards/147chain/279estate/2excluded/
1quarantine. Checked hosted estate749 plus32 projects781/floor779, unchanged margin2; guard2278
and chain1918 budgets unchanged. Full server import with startup disabled/socket connect trap
confirms these four routes and JWT dependencies are actually assembled; no network calls. Stripe
canonical payments handler precedes shadowed root duplicate; no Stripe runtime source change.
Checkout census checker label before describes loading mode after adoption, not new before evidence.
Actual livebd absent-account anonymous baseline twice:3POST404, pendingGET200empty; only absent
synthetic resources, no real image/customer read. Hosted identity/live after proof pending.

Authorization follows record-specific permission checks and adversarial tests; JWT identity by
itself is not proof of gallery/object ownership ([OWASP object authorization](https://api-security.owasp.org/editions/2023/en/0xa1-broken-object-level-authorization/)).
Latency is reported independently from errors and failed requests ([Google SRE monitoring](https://sre.google/sre-book/monitoring-distributed-systems/)).
These primary sources inform checks; they do not prove this app passed. Local runtime2missing
packages/notvirtualenv still limits parity. Ledger475-481 records rollout and preparation.

## 2026-10-03 22:44Z - actual monitor acceptance and next repair boundaries

PR235 exact3dca2ec99cbaacb1df50dc60fe171dd28f30e1ce pushed/created/attached, hosted pending.
Secret scans44.74KBclean, canonical memory0FAIL2WARN11NOTE; no whole-env parity.
Render actual8ec73bd1 Live; health200/healthy582.1MB twice, anonymous badge401 twice.
Archive workflows37159003598/37159077830 bothSUCCESS/verdictOK at exact8ec. Sept+Oct supplied
178170rows, trailing7days48229rows. +24n2710 MAE.236vs.persistence.362/delta-.126m/win57percent;
+48n2268 .245vs.617/delta-.371/win70percent; +72n2707 .255vs.711/delta-.456/win72percent.
Liveness newesttarget2026-10-03T22:00Z/.6h in both. Earlier October-only +24n547/.174vs.170/win49
is a DIFFERENT target window: real archive-window coverage corrected, not physical forecast
improvement or significance proof. Archive blob hashes not retained, no identical-source claim.
Scientific flags/skill thresholds unchanged. Log label incorrectly says178170rows thismonth when
two segments supplied; correction remains. Commitment309 asks for next scheduled run, these
are manual;283 includes pre-first-segment behavior not proven. Both commitments remain open.

Runtime repair isolated: initial9case baseline5fail4pass(.81s), ONE run, not final paired evidence.
Real Notification SQLite persistence and mocked session/provider boundaries reveal missingos
weekly email stage (in-app notification alreadyqueued/persisted despite email failure), missing
timedelta (reminder flag set before failed deadline extension), dict binding to Text column failure,
and absent GalleryItem.is_selected_by_surfer/is_favorite and SurferGalleryItem.selection_type/
selected_at. Actual model stores per-surfer Locker selection_eligible/access_type/is_favorite.
Correct owner/session/gallery pool and preserved entitlements must precede restored auto-selection;
no fictitious ORM fields, final after pair, tracked runtime adoption or actual scheduler delivery.
Shadowed root Stripe duplicate removal candidate stays isolated. Five-second SLO, browser reliability,
frontend selfie capability/legacy confidence, broader media/payment/provider/rotation acceptance
remain open. Ledger482-486 records receipts.

## 2026-10-03 22:56Z - identity dev merge and truthful five-second latency evidence

Monitor8ec full browser37158719254/job111307435209:63passed/0finalfail/0flaky/9existing skips,
HTMLoktrue. No retries; skips still limit weather-rendering acceptance and this is not a p95 SLO.
Identity exact3dca2ec99cbaacb1df50dc60fe171dd28f30e1ce all hosted gates pass.
CI37158928246 actual guards2278/66skip/1xfail12warnings907.03s181files;
chain1918/7warnings541.92s147files; estate781/2865skip137warnings74.42s,
279selected277results0silent. Merge devfcea55573cf3840f073aada4810882be3d4f4e69
at22:54:29Z. Actual identity deploy, paired after boundaries and full postmerge E2E pending.

Latency evidence repair adds p95 to existing bounded per-route/total histograms and counts
requests strictly OVER5000ms using existing buckets. No new retained samples, unbounded labels,
egress, dependency, client timeout, retry, data serving or cache behavior. Fast5xx remains an
error independently of timing; row latency includes all statuses and cannot by itself establish
successful spot-hub-load SLO. Metrics cumulative since process start, top30 route list; client
and browser usable-state timing remain separate. p95 is bucket UPPER BOUND, overflow marker
>=10000ms with printed maximum, not an exact percentile. Slow markers absent on clean rows.
Decimal presentation rounds percentile/max upper bounds UP to tenths:5000.01ms cannot appear
as5000.0ms and be misread as a target pass. Exact threshold count survives quantization.

Initial six-case positive instrument superseded by eight-case final decimal controls. First
checkout found1fail21pass: zero-valued slow marker violated existing healthy-row contract.
Preserved that contract, pinned BEFORE to exact3dca original Git blob after adoption, reran
whole final pair:8failed twice(.05/.04s),8passed twice(.04/.03s); actual checkout22telemetry/
percentile checks pass twice3.63/3.37s,3warnings. No test softened. Checked hostedguards2278
plus8projects2286/floor2280,181files andmargin6 unchanged; chain1918/floor1912 and
estate781/floor779 unchanged. Hosted/live proof pending. This fixes measurement, not the
observed API latency or population p95. Isolated scheduler/media model repair remains unfinished,
no actual scheduler/customer execution. Ledger487-490 records these receipts.

Final latency checkpoint:69telemetry/floor/lane companions passed4.48s,3warnings; changed-file blocking lint0; actual tracked partition610/181/147/279/2excluded/1quarantine; ledger prefix490OK and docs-only memory0FAIL2WARN11NOTE. Note-only response text clarifies cumulative/all-status counts and upward decimal rounding; no behavioral change after these checks.

## 2026-10-03 23:18Z - checked latency merge, identity acceptance, owner ICON incident and weekly report

PR236 exact44a923944f913280e4ce6413ada4cd03a13213bc hosted CI37160210176
all gates pass: guards2286/66skips/1xfail12warnings871.90s181files;
chain1918/7warnings504.38s147files; estate781/2865skips137warnings73.38s,
279selected277results0silent. Merged dev4ff10cc44d30948b544e4d53d0738331d9ab2dad
at2026-10-03T23:16:00Z; current metrics deploy/readback pending. Five-second SLO remains open.
Prior identityfcea5557 actual RenderLive; health200/healthy384.8MB and real badge401 twice,
four affected identity anonymous401 twice. This is paired anonymous boundary proof, not live
owner/foreign-account acceptance. PostmergeCI37160007052 success; full browser37160007109/
job111311313175 report63passed/0failed/0flaky/9existing rendering skips, HTMLoktrue.
No retry was required, but weather skips still limit full rendering acceptance.

Owner reports ICON marine long-range heatmap visually not working on live dev. Original
302-line attachment remains outside tracked repository. Sanitized relevant evidence: ICON
model switch at hour179 (~7.5days), repeated waves/swell1/windwaves cache misses; resident
181x80 span360 surface reported with ICON washBase, frameOff0, no terminal upload for those
ICON waves in supplied excerpt. One swell2 blend reports15023GFS+629EURO inputs. Earlier GFS
trace died aftermappedGrid and no-downgrade rejected a world grid then self-healed on zoom-out.
These are separate symptoms, not established cause. No attachment buildSHA/time, HTTP statuses
or requested/served source/hour readback establishes owner exact deployment. Orphaned browser
extension streams alone cannot explain or dismiss model-specific behavior. Investigation open;
no speculative model clamp, zero data, cache purge or served science flag change.

Weekly scheduler active account positive earnings reproduced missingos NameError in both
configured and unconfigured email cases, while no-account/no-earnings controls pass.
Final polished four-case BEFORE2failed2passed twice(.97/.98s), candidate4passed twice(.98/.95s),
actual scheduler package checkout4passed twice(1.63/1.43s). Candidate is exactly one import.
Mock Resend delivery prevents any actual email; actual Notification ORM Text persistence is
exercised against fresh SQLite. Query reads are mocked: no claim of actual production SQL
schema compatibility, real send success or overall financial scheduler correctness.
Expectedestate781+4=785, floor779+4=783;280estate selected files, guards2286/181,
chain1918/147 unchanged. Local environment has two declared packages missing; hosted authority
required. Gallery scheduler missingtimedelta, dict Text payload and nonexistent auto-selection
fields remain unresolved, candidate not adopted. Ledger491-498 records this checkpoint.

## 2026-10-03 23:42Z - dev weekly merge, actual latency tail, ICON data/graphics and quota ownership

WeeklyPR237 exact509dfdc683ff8425da5ac4a09ed08ae7f8338c7d allhostedgatespass.
CI37161489400 actualguards2286/66skip/1xfail12warnings828.26s181files;
chain1918/7warnings523.53s147files; estate785/2865skip137warnings74.71s,
280selected278results0silent. Mergeddev012d1e1e8b59f0ee2426ee6a2986350ed21de01b
at2026-10-03T23:36:45Z. Weeklyactualdeployment/fullbrowser pending; noactual scheduler or email run.

Precedinglatency4ff actualRenderLive andtwo health200/healthy644.3/647.2MB, realbadge401.
p95 schema andover5000ms live. Sameprocess cumulative spotroute n3/5xx0:oneover5000ms/
oneover10000ms,max16435.6ms,p95OVERFLOW lowerbound>=10000. Printedp95ismaximum,
not an exact percentile. SmallallstatussamplecannotestablishownerpopulationSLO; targetstillmissed.
PostmergeCI37161213444 success; E2E37161213426 actualHTML62expected/0unexpected/2flaky/
8skips,okfalse. RetainedMobileSafari successfulretryspot2003452.799ms,syntheticbadge200;
Firefoxretryhas10swaitForURLtimeout; initialfailurecauseunassigned. Skips notremoved;
defaultFPSguardrail isdisabledbyexistingrendercontinuitygate, so CIcannotclose realdefault
graphicsfallback. This qualifies the GitHubjob'sgreen conclusion; no reliableSLOclosure.

ICONHTTPmatrixtwo rounds fixedbase2026-10-03T23:00Z,bbox[-86,23,-72,34]:
ICONwaves168 plusICONwaves/swell1/windwaves179 andGFSwaves179,all200 andnonzero182vectors.
ICON179 waves146positive/max2.3104m,swell1 140/max1.6291m,windwaves146/max2.1694m;
these are OFFSHORE input heights, not breaking surf or skill evidence. Responseestimatedtrue,
providerestimated,backendicon_persistence_gfs_blend. Requested10:00Zproduct09:00Z;
servedvalidtimefieldechoes10:00Z: do notmisreadasexactsourcehour (darkservedtimework remains).
ICON168 anchorrequestedOct10T23alreadygetsestimatedOct11T00, whereasclient>168also
computesicon_trend_extrapolation. Differentforecastpaths/doubleestimation remainunderreview,
not provenownerfailure andnotchanged. Owneractualviewport/time/revisionunknown.

Actualdevmapcontrolledfreshpages usedaccessiblewheel179. Firstpageinitialreducedgraphics/
timewarningthenrecoveredowncoloredfield. Secondpage showedlowFPSwarnings1-19 and
guardrail9FPS12consecutive seconds ->simplifiedthirdparty layer. Backenddata isavailable,
but thisisnotfullownheatmapacceptance. Providedowner302lineloghasnoFPS/guardrail entries;
cannotassignsamecausetoowner. Sourcealreadyexemptsdocumenthidden/!hasFocus andmoving/
scrubbing; donotblindlyaddanotherexemption ordisableprotection. Longrangecoarse2degreefield
andbackstopthreefailedredrives/45sprobe recordedinthisbrowser,notforecastprecisionclaim.
No speculativeparticlebudget,zero field,cacherewrite,modelclamp orscienceflagflip.

Nextsourcecheckpoint5manualselectionroutes:queueJWTself constraint; select/items/preference/
deadline checkactualquota.surfer_id before returns,expiry statechanges or preferencewrites.
Nonvacuousowner200/missingquota404,invalidJWT/anonymous401,foreignknownquota403; expired
foreignrequestcannotmarkquotaexpiredorchange preference. Final25controls BEFORE16failed/
9passed twice(1.28/1.21s),candidate25passed twice(.84/1.04s),actualpackage25passed twice
(4.60/4.43s,19warnings). LocalJWT validation real; DB reads/commits mocked, no customerdata.
Livebefore at4ff:anonymous queue200empty andfourabsentquota404 twice, no actualobject writes.
Expectedestate785+25=810/floor783+25=808,281files;guards2286/181,chain1918/147 unchanged.
Broader sessionbrowse/claims/duplicateitemselection/concurrentquota/autoexpiry remainsopen.
Initialisolatedscriptquote syntaxpreflight executedno source/testwork, excluded; entirevalid
pairreran. Ledger499-508 recordsreceipts. Actualafter/hostedownership pending.

## 2026-10-03 23:43Z — reviewable status

The weekly report repair is merged into dev as 012d1e1e. Its checked CI confirmed 2,286 weather
guards, 1,918 forecast-chain tests and 785 estate tests. Deployment and full browser acceptance
for that revision are still pending here.

The next repair protects five manual photo-selection endpoints. It validates the JWT and checks
the actual quota owner before returning items or changing a deadline, preference or selection.
The 25 HTTP controls reproduced 16 failures in each baseline, then passed twice with the fix.
The actual package passed twice, and 160 surrounding account, message, identity and sensitive-route
checks passed. These tests use real local JWT validation with mocked database reads and commits.
Broader session browsing, photo claims, selection concurrency and gallery auto-expiry remain open.

Your ICON long-range report remains an open incident. At hour 179, the backend returned nonzero
estimated waves, swell and wind-waves in both controlled rounds. Two fresh browser pages showed
different outcomes: one recovered the app's colored field, while the other triggered the low-FPS
guardrail and switched to a simplified third-party layer. Your supplied console did not contain
the guardrail messages, so that cannot yet be assigned as the cause of your original failure.
There is also a separate source-consistency concern: the frontend re-estimates long-range ICON
data even though the backend already serves stored estimates. No speculative weather change
or guardrail override has been applied.

The five-second performance target is not met. The new telemetry is live and shows a spot-hub
request over 16 seconds. The preceding full browser job succeeded only after retries: its report
contains two flaky tests and eight skips. A green job alone does not close reliability, default
graphics fallback behavior, forecast accuracy or the population latency target.

## 2026-10-04 00:17Z — selection live acceptance and a dark ICON source repair

PR238 merged to dev56544d2aa3625a2ea8750a575b8dfc4462e48d1d at
2026-10-04T00:04:58Z after every gate passed on664d93ef6b5f6073cf3394e651ba82586125b8a6.
Actual CI37162708786:2,286 guards/66skips/1xfail (1039.00s,181files),
1,918 chain (533.74s,147files),810 estate/2865skips (73.40s,281selected,
279results,0silent); frontend328suites/3362tests,focused7/96. Floors/margins unchanged.
Render visibly Live56544d2; paired exact-revision health200/healthy583.1/583.3MB
and real badge401. Five anonymous selection endpoints each401 in both rounds.
Synthetic absent identifiers only: no private photos, real quotas or customer writes.
Local JWTowner/foreign controls do not establish live customer ownership acceptance.
Postmerge565 CI/full browser still running. Gallery browsing/claims/concurrency remain open.

Weekly012 actual Render Live and health200/healthy698.7MB, real badge401 twice.
Postmerge CI37162333662 actual2286/1918/785 (888.70/537.66/53.55s).
E2E37162333713 actual62expected/0unexpected/1flaky/9skips,HTMLokfalse.
Retained MobileSafari successful retry real spot200/6862.084ms; fixture badge200;
initial failure cause unassigned. No actual weekly scheduler/email action.
The HTML stats parser initially overlaid a missing root ok onto stats.ok; corrected
the ignored artifact before adoption, actual stats.ok is false. No public claim of green
browser acceptance. Latest565 telemetry sameprocess spot n1/12,870.2ms,5xx0,over5s
and over10s. Small all-status sample is not a population-p95 proof; owner5s gate stays open.
Weekly012 earlier maximum35,561.2ms is recorded, not assigned to the import repair.

ICON repair: default-off REACT_APP_ICON_STORED_TAIL. Enabled candidate uses the
backend's stored long-range waves/swell1/windwaves, retaining physical values, product ID,
run revision, requested/served-time metadata and estimate basis; avoids a second browser
estimate and its extra anchor requests. D-003 secondary swell behavior unchanged.
The flag is unset by default and no Netlify environment was changed. This changes displayed
forecast values when enabled; D-001 requires separate owner-authorized promotion with evidence.
No change to main/public frontend freeze, other science flags,15s timeout or FPS guardrail.

Final isolated25network/identity/native/empty/error/default-off controls:
before17failed/8passed twice(1.135/1.192s), darkcandidate25passed twice(1.191/1.167s).
Four default/invalid flag controls preserve current legacy values and three requests.
A single captured set of12 actual dev grid responses across three layers and four sources
(ICON168,GFS168,GFS179,ICON179), fixedbase2026-10-04T00:00Z,bbox[-86,23,-72,34],
supports replay with no live network. Twelve actual-built-field/metadata/Jacobian controls:
before9failed/3passed twice(1.231/1.722s),candidate12passed twice(1.197/1.158s).
Actual production package37controls passed twice(1.301/1.284s),176companions in12suites pass.
Local Node24.19 installed dependencies differ from hosted Node18; hosted authority pending.
An earlier recorder read omitted UTF-8 and failed after one baseline; entire final pairs reran.

At h179, all182coordinates retained. Old client differed from stored fields in
146 waves cells,141 swell1 cells,146 windwaves cells; maximum offshore height differences
1.6524m/1.7214m/1.625m. Candidate exact0 height/period/u/v differences under normal
adapter normalization. These are OFFSHORE inputs, not breaking surf or forecast error.
Old/stored maxima: waves2.31815/2.3265m,swell1 1.4943/1.7214m,
windwaves2.1898375/2.1952m. Stored-target local central derivative at one positive
coordinate per layer: old0,candidate1 (+/-0.01m). Browser-anchor derivative at that
sample is0 in both, so no broader anchor-sensitivity claim follows. All controls share one
captured time/region: no accuracy, seam-wide, device-performance or global acceptance claim.
Stored target run revisions and actual served12Z differ from requested11Z by1hour;
carrying that metadata does not repair the remaining source-hour presentation issue.
Actual owner incident has no FPS line, build revision or exact source UTC; root cause unassigned.
Default-device low-FPS fallback remains reproduced separately; no GPU budget fix applied.
Raw forecast frames and HTML/trace files remain ignored; sanitized summaries only tracked.

The full frontend floor rises297/2879 ->298/2904; expected hosted329suites/3387tests,
preserving previous measured margins31suites/483tests. Focused lane7/96 ->8/121
and explicitly discovers the25new controls. Backend lane counts/floors unchanged.
Ledger509-517 records these receipts and the default-off adoption.

## 2026-10-04 00:42Z — dark ICON merged; next monitor and webhook checkpoint

ICONPR239 exact5a79582ff3f49e87783a4d2d88e3d4a265a64645 passed every hosted gate.
CI37164586339 backend2,286 guards/66skips/1xfail (978.61s,181files),1,918 chain
(563.08s,147files),810 estate/2865skips (74.52s,281selected279results0silent).
Actual hosted frontend329suites/3387tests and focused8suites/121tests match projection.
Mergeddev22f84f9923bf445343b0b4816653f53dfb0857d3 at2026-10-04T00:38:41Z.
Flag remains default-off in source; no Netlify env write, no main/unfreeze or scientific
serving promotion. Actual new deployment/full browser after pending here.

Selection565 postmerge CI37163814170 actual2,286/1,918/810 (888.41/535.12/71.02s).
Browser37163814183 actual63expected/0unexpected/0flaky/9skips,HTMLoktrue.
Skipped/default-FPS-disabled coverage still cannot close the observed graphics fallback.
Earlier paired real anonymous boundaries/health/badge receipts remain valid for565.
The five-second target is unresolved; no latency regression is hidden by increasing a timeout.

Live buoy-calibration read00:21Z generated22:17:57Z: ops ledgered1383,scored14,
pending47180,cap evicted0. GFS_SCALAR source rows at+24/+72 eachn1
(MAE/bias.091/-.091m and.0691/-.0691m); this is sparse source presence,
not sufficient skill or paired same-model proof. Commitments149/309 remain open.
Existing012precompute37162472350 completed successfully: actualstage417buoy spots
heightMAE.188m;1773spot ratings6frames;report1773archived0matched;rc0.
A successful precompute does not establish live propagation or the next scheduled monitor.
Most recent scheduled accuracy monitor is still failed37157286033 before the seam fix;
manual green37159003598/37159077830 is already recorded and remains distinct.

Next two non-weather repairs were reproduced in isolation before adoption.
Monitor: the caller supplies previous+current scored archives during the7day seam,
but prints their combined total as rows thismonth. Change only that label to rows loaded.
Two controls include September+October rows, exclude future targets and preserve both
OK and measured persistence-loss RED. Before2failed twice(.13/.12s),after2passed
twice(.05/.04s). Residual archive label stays monthly because its reader is still monthly.
No window, paging threshold or production verdict changed; no new monitor dispatch.

Stripe: actual server assembled POST/api/webhook/stripe twice. The first is the canonical
router; the later root function is unreachable under current registration order. The root
also has an unsigned JSON fallback and stale business logic; deleting it removes ambiguous
ownership and dormant unsafe code. It does not prove an unsigned exploit was reachable.
Canonical first handler remains registered and is now the sole route; payment flow, wallet
fulfillment, signature configuration and callbacks are otherwise untouched.
Full assembled6controls before1failed/5passed twice(6.18/5.82s),candidate6passed
twice(5.28/5.59s). HTTP controls verify missing config503,missing/invalid signature400,
and an SDK-validated unrelated event200 with zero customer reads/commits; rejected requests
roll back. Actual SDK verification is mocked; this is dispatch/ordering acceptance,
not real processor cryptographic verification, replay/concurrency or payment fulfillment proof.
No real signing/API key values appear in the new tests: configured credentials are objects.
No actual payment calls, customer data, notifications or DB startup.

Actual package: monitor39+Stripe6 =45passed twice(5.72/5.29s),3existingwarnings.
Local interpreter is not the declared CI/prod environment; hosted authority still pending.
Expected guards2288/floor2282 (two added monitor controls),chain1918/floor1912,
estate816/floor814 (six added full-app route controls),613trackedfiles/282estatefiles.
Margins6/6/2 stay unchanged; frontend counts/floors unchanged from239.

Graphics work remains measurement-first. MDN's [WebGL best practices](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices)
supports bounding GPU memory and framebuffer cost per viewport, while its
[long animation frame guidance](https://developer.mozilla.org/en-US/docs/Web/API/Performance_API/Long_animation_frame_timing)
distinguishes combined frame work from individual long tasks. These guide the next profile;
they do not prove that the87,616-particle budget caused this owner's failure.
No speculative density change, hidden-window exemption duplicate or FPS guardrail disable.
Ledger518-525 records the readbacks, merge and next adoption.

### 2026-10-04 00:45Z — checkpoint validation

The monitor-label and single Stripe-authority checkout has103 passing payment, request-telemetry,
lane, floor and discovery companion controls (6.11s,11existing warnings). Changed-file blocking
lint finds no errors. Directory governance scanned641Pythonfiles with128size warnings and
zero violations; earlier file-path invocations scanned zero files and are excluded as proof.
Tracked lane partition613/181guards/147chain/282estate,2excluded/1quarantined is complete.
Ledger525 verifies byte-prefix against actual dev22f; memory audit0FAIL/2WARN/11NOTE.
The two overdue science/operational commitments remain open. A floor-update helper initially
expected a scalar assignment instead of the actual tuple; corrected only its unexecuted floor
tail, with no duplicate ledger append or source-test change.
