# Point identity, availability, and playback continuation

Started 2026-10-04 17:48Z. Branch `codex/independent-audit-repairs`, baseline69c06852.
Owner: "Ok keep going in that order" (W01/W02, then availability, then stale consumers/visuals).
Owner additionally supplied a local GFS play/scrub recording and console log and asked to add
that diagnosis to the work. Beta rotation remains deferred under the prior owner decision.
Trevec is unavailable; actual-source and graph/import inspection uses rg and bounded file reads.
The implementation skill calls for small tested slices. No subagents, live load tests, flag
activation, merge, or deployment.

## 17:48Z — locally qualified W01/W02 slice

- Before production edits, actual offline backend resolver/sampler controls ran twice:
  8 failures/7 passes. Six cross-model and two cross-domain hints selected the wrong product's
  1m value instead of the requested product's2m. Three correct hints, existing layer guard,
  and dark controls stayed positive.
- Actual frontend outer cache plus HTTP-boundary adapters ran twice:18fail/2pass of20.
  UTC rounding rollover, forced refresh, product/bbox changes, ambient hints, recursive ICON
  blend hints and weather manifest-await drift reproduced. Added six adjacent controls after
  reproduction (manifest domain/refresh, rain alias, coarse hints, aborted refresh).
- Backend repair dark behind `POINT_PRODUCT_IDENTITY=1` (default0, call-time, admin registry).
  Client repair dark behind `REACT_APP_POINT_REQUEST_IDENTITY=true` (unset by default); runtime
  `__RAW_DISABLE_POINT_REQUEST_IDENTITY__` can only disable it. Explicit context freezes anchor,
  selected absolute time, actual transmitted hints and provider across reads/writes/adapters;
  force bypasses both client caches, not provider ingestion or backend storage.
- Focused frontend26pass; full338suites/3494pass, lint ratchet86existingerrors/917warnings,
  production compilation accepted. Backend original neighboring selection tests plus extended
  controls73pass; new test file is21cases, **chain-owned** (selector read-back), partition
 616tracked/181guards/148chain/284estate/2fastmcp-excluded/1quarantined. Local interpreter has
  two declared packages absent: local evidence does not substitute for hosted environment.
- Prior source d67763d5 CI37207402431 is now completed/success. Prior receipt69c06852 has
 15checkrunsuccess/3neutral plus successful preview status (19total), read back live.
  This supersedes the dated pending entries; do not rewrite their historical receipts.

## Playback evidence added (diagnosis still open)

User recording:87.03s,2218x1552,30fps, metadata creation2026-10-04T17:31:02Z.
Decoded locally into gitignored evidence; original remains untouched. Console is also untracked;
raw owner logs/recordings are not published. Recording shows wide-view wave-color transitions.
Console lines94/99 identify46x20 at zoom3.5;132 identifies181x82;157-160 switch46x20 to181x82
while selected hour126 and zoom3.5 remain the same. No timestamps in the supplied log establish
an exact recording-to-log frame alignment. The source uses thinned series frames followed by
exact per-hour upgrades; the four-second player and asynchronous upgrades require a causal
replay before calling this repaired. Evidence of differing representations is not evidence of
a scientific accuracy improvement or of a blank GPU frame.

Primary guidance: [RFC9111 cache request identity](https://www.rfc-editor.org/rfc/rfc9111.html#section-2).
Availability semantics will use [Copernicus wave parameter definitions](https://help.marine.copernicus.eu/en/articles/6175153-how-to-describe-wave-height-period-and-direction-parameters).

## 2026-10-04 18:51Z — ordered local qualification

M01/M02/M03 adapter-to-card24cases qualified. SH01 actual producer12cases qualified;
new files chain-owned (149files); default-off availability declared0 in all three parity workflows.
SH02/SH03 actual memo and mounted spot/model/abort/zero controls qualified. PB01 real player
and common series source reproduced9fail/8pass before twice; consumer16fail/2pass before twice.
One next frame under the background lane; no future bridge staging; manual thin-world refusal;
bounded retries, readable buffering, all-theme availability. Final frontend346/3582, focused
backend171, lint ratchet86/917, production compilation, LOC accepted. Final hosted Linux full
backend pending: local full collection crashed natively on Windows; interpreter parity limits
remain. Browser fixture three themes desktop/390x844 phone, no horizontal overflow; simulated
exact delivery holds0 then6. Preview JSX runtime corrected before replay acceptance. No full
map-pixel/GPU/FPS/live-latency/skill claim. Source flags dark, no merge/deploy. New receipt
`audit/repair-2026-10-04/POINT-PLAYBACK-RESULTS.md`; raw video/log/frame assets remain local.

Pre-publication docs-only memory audit:0 FAIL/7 WARN/6 NOTE. Previously open18Z commitments are now overdue; none is claimed fulfilled by this repair. Ledger591 verifies; source default-off compilation, frontend346/3582 and lint86/917 accepted.

## 19:15Z — exact-source hosted acceptance and Jacobian receipt

PR243 head5afa0c82 read back. CI37226218002 completed/success, all11 jobs accepted.
Completed per-job logs: frontend346suites/3582tests; chain1951/149files/0skips;
guards2288/181files/67existingdocumentedskips; estate889/284selected/282produced/0silent.
Backend total5128passed,0failed. LOC37226218144, encoding37226218139, ledger37226218004
and Lighthouse37226218027 success. PR rollup19:17SUCCESS checkruns,1NEUTRAL,1successful
Netlify preview status. This supersedes candidate pending entries; the local native
collection failure remains a historical non-qualifying attempt.

Standalone point_jacobian_probe.py: actual resolver/sampler,6 controls twice. For
GFS/ICON/EURO, central derivatives requested/hint change0/1 to1/0, epsilon0.05m,
error<1e-10. This measures ownership, not surf physics or forecast skill. Instrument
is explicit-path offline, outside backend CI discovery; no exclusion or floor change.

All recorded production/test/CI fingerprints match5afa0c82. This follow-up only
publishes sanitized receipts and the offline probe. All served flags stay off; no
merge/deploy. Full map/GPU/device FPS/real-fetch cadence acceptance remains open.

## 19:55Z — calendar/horizon/terminal failure batch

- Exact baseline consumer substitution, restored byte-for-byte: 9fail/21pass twice.
  An earlier incorrect assertion count was corrected before this accepted replay.
- Exact baseline backend substitution: 17fail/70pass twice, no errors/skips. Candidate87pass;
  expanded supported neighbor set195pass, including actual routes, SDK subprocess boundary,
  cache, wire contract, source composition, script imports, registry and CI-floor controls.
- Current-only cache checks22 to2; irrelevant future fallback1 to0. Paired current dictionary
  equality retained with all cached frames. Terminal typed failure tile attempts4 to1; generic
  and spatial failures retain four attempts. These are isolated causal controls, not live p95.
- Full frontend347suites/3610tests passed; timezone subsets45pass each New York/Auckland
  before the final two rollback controls; full UTC run includes those controls.
- Lint ratchet accepted1199files,86existingerrors/917warnings; baseline unchanged. Python
  fatal-error lint accepted. LOC2499files,12grandfathered,0new/0regressed accepted.
- Production compilation accepted with CI=false, matching workflow build policy and its
  separate lint gate. Initial CI=true warning-promoted build was not accepted evidence.
- Selector partition618tracked: guards181, chain150, estate284,2existing fastmcp exclusions,
  1existing quarantine. No new skip/exclusion. Candidate hosted counts expected chain1982,
  estate898, guards2288; paired floors1976/896/2282, frontend347/3610.
- Full backend local suite is not qualified: isolated runner cannot collect full-server
  test_weather_copernicus; earlier Windows native collection crash remains historical.
  Hosted Linux full lanes must qualify the candidate.
- Actual component fixture light/dark/beach at desktop and390px phone: calendar dates,
  missing/zero labels and size labels readable; scrollWidth390/viewport390 in all themes.
  Screenshots are ignored local evidence, not a full-map/GPU/FPS/canary certification.
  Owned loopback preview server stopped; inspected tab closed and viewport reset.

## Limits and next work

No merge, deployment, flag flip or forecast-skill claim. Time failure recognition is narrow;
this does not introduce cross-request negative caching or cancel an already running executor.
Remaining source priority is AS-06 immutable manifest publication/failed-upload refusal,
then bounded queues/caches/encoding and device/scientific acceptance. See `PROGRESS.md`.

Primary guidance: [MDN Date.parse](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date/parse)
and [Copernicus SDK troubleshooting](https://help.marine.copernicus.eu/en/articles/8632322-copernicus-marine-toolbox-troubleshoots).
Installed SDK exception implementation was inspected; strict-inside mode and science composition unchanged.
Final mounted timezone controls:47pass New York,47pass Auckland, including rollback. Initial
wrong-root launcher attempt collected no tests and contributes no acceptance evidence.

## 2026-10-04 20:12Z — calendar/horizon/terminal source hosted accepted

Source40cd1ddd CI37230181942 completed/success11jobs, frontend347/3610 and backend5168pass:
chain1982, guards2288/66skipped/1xfailed, estate898/0silent. All separate gates/preview accepted.
Supersedes local-candidate pending entries and ledger600 publication intent. Fingerprints
unchanged; current Jacobian6pass twice and final timezone47pass eachNY/Auckland. AS06 winner
overwrite/missing-upload publication rechecked twice offline with serial controls; next repair.
Receipt-only follow-up, no merge/deploy/activation. Full map/GPU/device/science limits remain.

## 2026-10-04 22:09Z — AS06 publication repair

The prior publisher used one object name per generation with overwriting uploads. A losing
writer could overwrite the winner's already-pointed bytes; an upload returning no acknowledgment
could still advance the pointer. Both actual-source failure paths reproduced twice.

`MANIFEST_IMMUTABLE_PUBLICATION=0` is the new dark switch. Enabled publication uses a unique
generation/UUID key, the real store's strict=True/overwrite=False upload, and requires the exact
True acknowledgment before insert/CAS. The existing pointer schema, reader bytes and fallback
are retained. No migration or remote configuration change. Direct publication also enforces
the existing designated-writer gate. UUID collision or HTTP400/409/429/500 refuses publication.

A failed or ambiguous CAS never immediately deletes its uploaded candidate: the server might
have committed before the acknowledgment was lost. Successful writers perform at most one
100-row listing and one20-object batch deletion, each with5s HTTP timeout. Cleanup keeps five
generations AND3600s since the later created/updated timestamp. Unknown paths, invalid/naive
timestamps, fresh copies, current/future generations and non-designated writers are preserved.
Old legacy keys can age out during transition. No unbounded listing or per-object delete loop.
Cleanup errors cannot revoke an acknowledged publication. This bounds work per publication;
it does not prove a global object-count cap or an absolute network wall-clock deadline.

## Forensic and local qualification

- Final exact prior publisher substitution, restored byte-for-byte:16cases,9fail/7pass twice,
  zero collection errors/skips. Initial pre-strengthening replay13cases,8fail/5pass twice retained.
- Repaired actual publisher/store upload/REST CAS/reader and manifest neighbors109pass twice.
  Thirty-six new controls cover initial/ordinary races, exact upload acknowledgment, UUID
  collision, failed/ambiguous uploads/CAS, legacy success despite copy failure, writer gate,
  retention safety/bounds/failures, reader/CDN parity and dark rollback.
- Publication central differences epsilon0.05: winner/loser derivatives[0,1] legacy→[1,0]
  enabled. Both controls execute the real publisher, uploader, REST CAS and reader with
  deterministic concurrent synthetic storage. This measures ownership, not forecast skill.
- Paired floor controls36pass; selector619tracked/182guards/150chain/284estate, two existing
  fastmcp exclusions and one existing quarantine. No new skip/exclusion. Guards projected2324,
  floor2318; chain1982/estate898 unchanged; backend total projected5204. Frontend347/3610 unchanged.
- Fatal Python lint and backend643-file/800LOC guard accepted. Repository LOC ratchet accepted.
  Local interpreter remains partial (two declared packages absent/not a venv); full hosted
  Linux CI must qualify candidate. No acceptance inferred from a root-directory selector
  attempt reporting zero files; corrected backend-directory selector proves actual ownership.
- One live health/data read remains healthy/ok at deployed6b062e97. No live load test or write.

## Remaining acceptance

Hosted candidate full gates pending. Source is default off, no merge/deploy/activation. Actual
Supabase staging concurrency/acknowledgment/read-back and bounded-cleanup timings remain open.
Stored forecast values, reader schema and scientific composition are unchanged by the dark path.
Next source phase is PF01–04 queues, caches, duplicate raster work and encoding deadlines.

Primary guidance: [Supabase uploads and concurrency](https://supabase.com/docs/guides/storage/uploads/standard-uploads),
[file listing](https://supabase.com/docs/reference/python/storage-from-list),
[batch deletion](https://supabase.com/docs/reference/python/storage-from-remove).
Current changelog was retrieved and checked; installed storage3 REST routes/payloads inspected.
Backend-only environment credentials and existing writer authorization are retained; no client
credential, RLS/schema change or package upgrade introduced.

AS06 final local qualification supersedes the earlier109/36 partial counts:148pass twice,
39newpublication controls, guards2327projected/floor2321. Added fallback-safe gate failures
and independent pilot writer flag0. Final causal before16cases9fail/7pass unchanged;
publication Jacobian winner/loser[0,1]→[1,0]. Hosted full candidate remains pending.

### 2026-10-04 22:25Z: explicit chronology correction

The final AS06 expansion row was appended with date-only precision after timestamped rows.
It was written with ledger610 at22:14:13Z, not midnight. CI37239259594 rejected it because
the checker invented midnight. The historical row is retained. Date-only rows now constrain
the whole UTC day; prior explicit time constraints carry across them. Earlier days and
reversed explicit times still fail. Actual audit_docs before1fail/1pass; after12controls
and108publication/parity/floor/chronology controls pass; audit selftest accepted and
docs-only0FAIL/7WARN/6NOTE. Existing overdue commitments remain open.
Selector620tracked/182guards/150chain/285estate;12new estate controls, reference910/floor908.
Expected full backend5219, frontend3610; hosted follow-up pending. No served-number change.

### 2026-10-04 22:49Z: PF01/PF02 browser work and retention repair

Source e4353c06 prior AS06/chronology CI37240056010 all11jobs success; backend5219/frontend3610.
Current local PF01/PF02: three limiter-owned requests; scoped regional cancellation with
reusable global work retained; rapid A/B/A aborted-owner replacement and cleanup safety.
Every cache writer shares48entry/32MiB estimated budget, expires stale entries and retains
recency without changing freshness. Cache before3fail/5pass twice; exact old limiter
2causal failures twice (9deselected, not production skips). Final90focused controls twice,
full351/3647; lint86existingerrors/917warnings, standard build and LOC accepted. Extra
CI=true build rejected existing warning debt; established CI=false compile accepted.
Both flags disabled; no merge/deploy/activation/live load. Backend admission, true heap/GPU
bytes, p95/slow-fetch oracle, PF03/PF04 remain open. User withdrew wrong-chat Foamking request;
no Foamking changes made. Hosted current candidate pending.

### 2026-10-04 23:08Z: performance exact-source hosted acceptance and next diagnosis

Source21db8ee8 CI37241546337 all11jobs success. Frontend351/3647, backend5219: guards2327
with66skips/1xfail; chain1982, estate910/0silent. Supplemental gates and preview accepted.
Source fingerprints match; remotehead21db8ee8 and PR243 body updated/read back.
PF03 actual route/framework synthetic-builder experiment:40distinct-vector requests,
5trials per arm repeated in reverse order; decoded masks/quantities/missing/provenance
parity. Unguarded Pydantic NaN→null differs from baseline refusal. Finite guard and actual
route datetime/bytes/set fallback/nonfinite error controls accepted; no runtime change.
Response-cost/body/headroom/admission/deadline acceptance still open. Own diagnostic
fixture shared vectors initially; superseded with76800distinct vectors. No production
latency inference. Reviewable experiment and limitations recorded in PF03-DIAGNOSIS.md.
No merge/deploy/activation. This publication is receipts plus offline experiment only.

### 2026-10-05 00:32Z: remaining-workgroup source checkpoint and staging forensics

Fourteen additional rows source-covered, including partial composer/session repairs; nine source rows
plus cloud/device/financial/scientific acceptance remain. All new served switches off. Full Node24
frontend356/3689 and production build accepted;160new backend controls and68CI controls pass;
expanded280pass/2legacy skips. Prior-source82controls44fail/38pass twice; current82pass.
Selector628tracked/185guards/151chain/289estate; projected2360/2049/970=5379backend, hosted pending.
Local Python partial; full-repo lint existing scheduler/watermark/quarantined test debt persists,
changed/new fatal lint and both LOC checks pass. Earlier frontend timeout and sandbox Git Bash
DLL startup failures retained; final escalation passes without test relaxation.
Read-only provider inventory: separate existing Raw Surf App Dev, private weather bucket0objects,
pointer0rows, actual authusers0. Shared Render has no isolated staging environment identified.
Prepared actual-source nonce-owned cloud canary is NOT executed. Dev-scoped local MCP registered
on owner authorization; OAuth metadata decoding fails before approval. Public metadata framing
also fails curl; provider versus network cause unknown. No cloud data/config/deployment writes.
Automatic review rejected revealing shared Render URL; safe metadata/SQL alternative established
staging instead, without retrying disclosure. Report: audit/repair-2026-10-04/REMAINING-BATCH-RESULTS.md.

### 2026-10-05 00:45Z: connector diagnosis narrowed to local HTTPS inspection

Owner normal PowerShell repeats OAuth decoding failure. Active Avast One26.9.11171.1011,
public Supabase TLS issuer Avast Web/Mail Shield Root under normal certificate validation,
and sanitized current codex_apps startup logs establish local HTTPS interception and the
same connector decoding failure. Public issuer endpoint succeeds; MCP metadata framing fails.
Upstream issue48504 reports the same Avast version and controlled resolution elsewhere.
Earlier missing-registration explanation was incomplete; earlier unknown cause superseded.
No antivirus setting or remote provider state changed. Proposed endpoint-only exception
still requires owner UI action and controlled retest; no causal closure or authenticated access yet.

### 2026-10-05 00:49Z: first endpoint clear; second OAuth endpoint still inspected

Owner CLI now fails at the API OAuth issuer instead of MCP resource discovery. Normal TLS
read-back: mcp.supabase.com issuer Google Trust Services and metadata200/curl0;
api.supabase.com issuer Avast Web/Mail Shield Root and metadata200/curl0, while Codex still
fails decoding there. Suggested second exception restricted to the API host, pending owner
action and retest; no global antivirus disable or agent settings edit. Ledger629 records it.
Ledger630 corrects author attribution on620-628: the CLI defaulted to claude when omitted,
but the actions were Codex's. Original entries retained; future calls explicitly set actor codex.

### 2026-10-05 01:02Z: full hosted repair acceptance and remaining connector gate

CI37248136689 atd7b10451 all11jobs success. Runtime fingerprints identical to4eac3550.
Frontend356/3689; backend5379=2360guards+2049chain+970estate; guards66skip/1xfail,
estate289selected/287produced. Floors/build/lint/imports pass; no new exclusions.
Ledger631 records exact-source acceptance; no merge/deploy/activation/science promotion.
Ledger632 records owner confirmation of saved API Website/Domain exception; public TLS
still Avast-intercepted and Codex API metadata decoding fails. First endpoint remains
clear. Saved UI details not visible to agent; no antivirus edits or repeated login.

### 2026-10-05 01:11Z: Dev connector OAuth recovery verified

Owner saved explicit API HTTPS path exception and approved browser OAuth. Fresh normal
TLS validation returns Google Trust Services issuer for MCP/API hosts; discovery200/exit0
each. CLI login exit0; outside-sandbox MCP list explicitly enabled/OAuth (sandbox read
cannot see the credential status and reports Unknown). Endpoint-only recovery verified.
No global antivirus disable or provider data/config writes. Current chat tool snapshot
still lacks Supabase, so reload Codex and reopen this same chat before actual scoped
tool verification. Source cloud publication canary not executed; runtime credential
path remains separate. Ledger633 records owner approval and measured recovery.

### 2026-10-05 01:35Z: partial alert delivery repair and connector reload scope

Owner confirms only reopening the chat after OAuth approval, not fully restarting Codex.
Current tools still lack Supabase; no re-authentication or provider write attempted.
Source SEC08 repaired both emitters through one conditional SQL cooldown claim.
Two before repetitions:16fail/7pass; after48new controls,63delivery/quality and161expanded
pass. Concurrent stale workers no longer create two records/lost counter updates;
claim and notification commit together; push follows commit; forecasts precede writes.
One-hour default with bounded operator env override is reported by the API/list.
Missing/invalid height refuses emission; measured zero and maximum zero survive.
Build/lint/LOC accepted; frontend/hosted pending. No new forecast value or scientific
threshold, real notification, provider schema/data, merge/deploy or activation.
SEC08 remains partial: preferences, manual actor binding, durable outbox, quiet hours
and PG/provider qualification open. ALERT-RESULTS.md; ledger634 records source proof.

### 2026-10-05 01:38Z: final local alert qualification and publication checkpoint

Full Node24frontend356suites/3689tests accepted. Production compilation/lint ratchet
accepted; changed Python fatal lint clean;646backend files within800LOC and general
ratchet accepted. Final delivery/quality63pass and expanded161pass, no skips.
Ledger635 records publication checkpoint with commit/push/hosted read-back pending.
ALERT-VALIDATION.json derived directly from the five local JUnit receipts.

### 2026-10-05 01:57Z: alert actor/configuration extension and next financial dependency

After sourcef995dae4 publication/read-back, review found check/CRUD/share actor gaps.
Check5fail before twice; config19selected13fail/6pass before twice. Repaired all seven
alert handlers with JWT/owner binding; actual own CRUD and intentional fixture-recipient
share preserved, scheduler retains all owners. Final69new/182expanded/25repeated HTTP
controls pass; changed fatal lint/LOC accepted; frontend unchanged356/3689. Ledger636.
Broader photographer-request routes retain their separate scope. Source41rows partial/
eight without source; stored preference/outbox/PG/provider qualification open.
Stripe trace confirms separate configuration reads in routes/scheduler/constructor;
cleanup can abandon pending transactions if verification is unavailable. Centralizing
key refusal must retain an explicit no-write disabled-verification control. SEC09 remains
unrepaired; no processor/network/account/payment calls or provider writes made.

### 2026-10-05 02:03Z: source publication and hosted cooldown receipt

Final source6c355cb2 published/read back OPEN at PR243. PR description updated.
Previous cooldown sourcef995dae4 CI37252419546 all11jobs success; actual completed
logs5427backend (2360/2049/1018),356/3689frontend,290estate selected/288produced/
0silent; existing66skip/1xfail. Final owner handlers differ and remain hosted-pending
in CI37253656301; no earlier-source acceptance borrowed. Ledger637. No merge,
deployment, activation or provider writes. Shared memory audit0FAIL/7WARN/6NOTE;
existing seven overdue commitments unchanged.

PR243 final description read back with69new/182expanded and honest final hosted
pending status. Ledger638 records receipt-only synchronization; no source/provider
change. Supabase tools still absent; full Codex restart and staged runtime access
remain the publication-canary prerequisites. No new login or credentials requested.

### 2026-10-05 02:50Z: owner-supplied deep audit and fresh source repairs

Read the supplied83-finding partial audit and reconciled its older dev/deployed
baseline with PR243. Current push/credential/trace/actor failures reproduced:
security24fail/3pass twice; actor3fail/2pass twice. Source now36new controls,
166expanded pass, fatal lint/LOC/ledger selftest accepted; requested-product
Jacobian6pass twice. Original eight source gaps and all external acceptance
remain. Whole83 findings not independently re-certified; registry preserves them.

Fresh readonly health healthy/live6b062e97, all10 data lanes ok/no alerts,
freshest age0.6h; no inference about model-cycle age. Prior final alert source
6c355cb2 CI37253656301 all11success, actual5448backend/frontend356/3689.
New publication/hosted pending. No provider writes, live pushes, activation,
merge/deploy or computer-use shell mutation; beta rotation remains deferred.

### 2026-10-05 03:09Z: publication and next ingestion diagnosis

Source d1cc16fe published/read back OPEN on PR243; description updated/read back.
CI37257237630 now10success/one long guard running. Source/hosted counters remain
pending until completed logs are available; commitment641 owns the follow-up.
First commit was blocked by a receipt-digest generic-key false positive; path/hash
representation then passed the full guard. No bypass or secret value was added.

Current WI02/WI03 diagnosis reproduced6controls twice: empty-cycle exit tracks
health upload; model cycle55h staysok when ingest1h, ingest13h iscritical.
These passing assertions describe unrepaired behavior and are excluded from
accepted repair counts. INGESTION-DIAGNOSIS and durable instrument retained.
Application/workflow fingerprints unchanged after published source. Ledger642/643.

### 2026-10-05 03:14Z: exact new source hosted qualification

CI37257237630 at d1cc16fe all11jobs success; actual5484backend=2360/2049/1075,
356suites/3689frontend; estate294selected/292produced/0silent; existing66skip/
1xfail in guards and2865estate skips retained; all36new controls executed.
Supplementary LOC/ledger/encoding/Lighthouse success. Ledger644 fulfills641.
Runtime/workflows unchanged in subsequent receipt work; no merge/deploy/
activation/provider writes. Current ingestion diagnosis remains unrepaired.
