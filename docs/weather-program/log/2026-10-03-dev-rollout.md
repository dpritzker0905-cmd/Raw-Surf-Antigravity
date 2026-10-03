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

## 18:17Z — merged deployment and paired acceptance

PR228 merged3de464b8 at17:59:13Z after exact-head CI37141260667 success. Actual guards2248,
chain1876, estate735 match projections; fourteen GitHub checks successful. Netlify preview canceled.
Applied pinned additive Strava nonce schema: two pre reads absent, two catalog/role readbacks pass;
anon/authenticated42501, service_role permitted, cascadeFK and three indexes verified.
Render auto-deploy succeeded Live,3m32s, exact3de464b8 in health twice. Anonymous Strava four
and messaging three reads each401 twice; owner messaging and Strava status200 twice. GFS Spanish
House conditions/tides/forecast healthy before/after twice: regression canary only, refreshed
frame values cannot be attributed to repairs. Correct runtime flags all0 twice.
L2restore13097/0errors, prefetch120/0failed; inspected connection-exhaustion filter no matches.
HealthRSS598.8/599.4MB, peak29.8%; short uptime is not memory-growth/SLO proof.
No real payment/provider exchange, rotation, weather grade or flag promotion. Broader audit open.
Report audit/dev-rollout-2026-10-03/REPORT.md and sanitized results carry boundaries and rollback.
Ledger374-380 records missing publication, schema, hosted acceptance, merge, deploy, live finding,
and document receipt. Post-merge workflows pending at receipt preparation.
No new served forecast skill number claimed; previous synthetic sensitivity rows remain the proof.

## 18:22Z — post-merge CI and overdue memory evidence

Post-merge CI37142516639 success at3de464b8; actual2248/1876/735 agree. E2E still running.
Owner profile loaded twice without writes. Ledger381 hosted finding;382 checks commitment172:
+24h scored direction n407 GFS/EURO/ICON (MAE24.38/25.31/32.43deg), persistence404/27.77.
Period MAE/bias GFS2.012/+0.511, EURO1.830/-0.739, ICON2.548/-1.704, persistence2.326/-0.056s.
Different lead/window from Sep30 snapshot; no improvement attributed to rollout.
Ledger383 diagnoses309: ops now present (1383ledgered/172scored/45006pending/cap_evicted0),
but latest monitor37139645631 atoldhead fails operational +24h skill floor, n438 raw0.176m vs
persistence0.162m and win47%. Do not conflate it with missing samples or month-seam failure.
Commitments149/309 remain open;172 checked. No weather promotion.

## 18:24Z — receipt publication

Published c598daa2, opened and attached PR229 into dev. Ledger384 push/385PR open/386checkpoint.
Ledger prefix verification OK; docs-only memory0FAIL/2WARN/11NOTE after commitment172 readback.
Secret scans33.60KB and419B no leaks. Shared STATE update needed UTF-8 decoding correction before
publication; exact head anchor now386. No test result inferred from that failed document read.
Receipt branch changes docs/audit only, inside actual Render/E2E ignored paths. CI follows.

## 18:32Z — owner issuer config gap and runtime repair

Live PostgreSQL race acceptance stopped before state issuance: dev redirect rejected400.
Confirmed twice by actual _redirect_target; STRAVA_REDIRECT_ORIGINS absent; no configured FRONTEND_URL
matched existing app frontends (fallback localhost). Status200 alone did not certify issuer readiness.
Used Render env-vars skill, added STRAVA_REDIRECT_ORIGINS naming only existing dev/public Netlify
frontends; Save and deploy accepted at unchanged3de464b8. Ledger387 finding/388env/389deploy-start.
Provider credentials and weather flags unchanged. Redeploy/paired issuance and race acceptance pending.

## 18:42Z — redirect redeploy and PG race accepted

Ledger390 records config Live1m16s at unchanged3de464b8;391 records two synthetic hashed nonce
fixtures issued/consumed/retained;392 records paired acceptance. Before dev redirect400 twice,
after200 twice; foreign origin/path400 twice. Two PostgreSQL concurrent claim/replay rounds
each exactly one mock-provider call; owner token snapshot unchanged twice, no real provider I/O.
Direct route functions inject owner; separate HTTP401 proof covers auth boundary. Config redeploy
health200 twice/RSS608.7/608.8MB; RLS/grants and dark flags0 twice. No served weather value changes.
Real OAuth/provider consent, rotation, monetary acceptance and weather skill remain open.

## 19:01Z — browser acceptance forensics

Ledger393 publishes8080fa6e receipt;394 records E2E cancellation/attempt rows and actual owner
read failure then recovery;395 records bounded diagnostic instrument. No served weather number
changed. No final E2E total/artifact available; neither401 messages nor WebGL warnings prove cause.
Receipt CI floor refused17-day-old GitHub API reading; attempted job-only rerun refused while
run active, so no dispatch occurred. Bounded targeted reproduction and completed-run retry pending.

## 19:04Z — receipt merged and diagnostic controls

Ledger396 records completed-run floor retry success,397 records PR229 exact checked merge at
f2ae19d2 (19:03:54Z),398 records three literal argument cases twice. No thresholds changed.
Optional PyYAML unavailable before checks; corrected stdlib extraction plus actual Git Bash
argv controls passed twice. No YAML parser acceptance claimed; hosted dispatch will validate it.
Diagnostic branch builds on the merged receipt; product backend remains3de464b8.

## 19:07Z — bounded reproduction dispatched

Ledger399 push8b00573e/400PR230/401dispatch37146663057. Published instrumentation only,
no live app behavior changed. Desktop Chrome existing spot-hub test, one fresh attempt,
no retry; hosted result/artifact pending. PR230 attached. Receipt229 already merged.

## 19:11Z — first bounded failure and trace correction

Run37146663057 failed one spot-hub attempt, screenshot final page auth signup. HTML/video retained,
trace absent because existing config records on-first-retry; zero-retry needed explicit trace option.
Ledger402 corrects395: diagnostic option now retain-on-failure; argument controls pass twice.
First failed diagnostic artifact parser found no traces and its non-escalated summary write failed;
no conclusion credited to that attempt. Screenshot/HTML assertion readback remains valid evidence.
Second fresh trace-enabled baseline is next; exact401 trigger still unproved.
