# Deep-audit reconciliation and current-source security repairs

Owner supplied `C:/Users/David/App/raw-surf/audit/deep-2026-10-04/REPORT.md` on this continuation.
Its companion83-row findings register is preserved in DEEP-AUDIT-REGISTER.md. The report is
partial:3 completed lanes,13 partial,6 not started;12 spot-checks and71 single-pass findings.
Its dev baseline2a7b8615 remains current remote dev; deployed backend is still6b062e97.
Our reviewed source baseline is035ac5f2, with runtime source6c355cb2 on OPEN PR243.
The report's moving-PR overlap assessment used filenames, not a current-source review.

## Fresh audit conclusions

- **LH-01 confirmed on current source:** public push send had no authentication and forwarded
  caller-selected recipients/links to the internal transport. Subscription creation/deletion
  also trusted supplied identity. Actual HTTP/JWT/ephemeral SQLite controls reproduced this.
- **LH-02 confirmed:** both Gemini generation and health put GEMINI_API_KEY in the URL.
  Real HTTPX INFO logging captures the URL. The fresh audit also found public Gemini/OpenAI
  health key prefixes and arbitrary provider error/exception text leaking into logs/results.
- **AS-01 nuance confirmed:** the workflow diagnostic CLI overrides config trace-off.
  Executed workflow argument builders reproduced it; normal paths now explicitly force off too.
- **PS-03 confirmed:** the ledger CLI silently selects a default/environment actor when omitted.
  Real CLI calls wrote incorrectly attributed fixture ledgers instead of refusing.
- **Stripe conclusion needs qualification:** the supplied report's service table infers that
  Stripe is disabled from the server boot refusal. Current billing modules still read their
  own configuration and constructors set the SDK global. That log alone cannot establish
  whole-program refusal; original SEC09 remains open. No processor calls were made.
- **WI02/WI03 now reproduced on current source:** metadata upload success can make an empty
  ingest cycle exit0; changing known model-cycle age7h to55h with ingest1h keeps healthok,
  while ingest13h makes it critical. Six offline diagnosis controls repeated twice. These
  findings remain unrepaired; diagnosis assertions describe the defect and are not accepted
  CI fixes. See INGESTION-DIAGNOSIS.md and ingestion_jacobian_probe.py.
- **LIVE-04 still open:** /grid awaits its resolver without a route deadline. Existing dark
  PF03 admission bounds series wait/output, not CPU execution. Its shield retains ownership
  until encoding finishes; simply removing the shield would release capacity around work
  still running in a thread. A cancellable staged resolver needs separate measured qualification.
- **Earlier repairs remain source-qualified, not activated:** WC-05 overlaps SEC08; WF-05
  overlaps PF01/PF02/W-03; WS-04 overlaps W-05; LIVE-09 overlaps SH04; LR-04 overlaps W-04;
  WS-06/07 have partial cache/encoding coverage. Cloud, native GPU, full hour-to-pixel,
  quiet-hour alert preferences, real PostgreSQL and live latency acceptance stay open.

This is a focused current-source audit and reconciliation, not independent verification of
all83 original assertions, a clean security bill or a forecast accuracy certification.
The original50-row register and eight rows without source repairs remain separate; counts
must not be added as independent defects. Scientific flags and production remain unchanged.

## Implemented repairs

Public /push/send and its unused request model are removed. Internal OneSignal delivery
remains available to trusted server callers. Native subscribe/unsubscribe derive identity
from the JWT; matching legacy selectors remain compatible and foreign selectors return403.
Omitted selectors now support the existing browser callers. OneSignal subscribe also binds
the JWT before SQL. Anonymous/invalid/expired JWTs return401 before database access.
Provider-side SDK identity verification, subscription possession, database uniqueness/races,
orphan profile handling and actual device delivery require separate qualification.

Gemini generation/health use x-goog-api-key headers. Public AI health returns configuration
presence without key fragments. Provider failure bodies and arbitrary transport exception
messages are not echoed. HTTPX production logging is WARNING; controls explicitly restore
INFO and observe real request logs, proving the credential is absent without relying on
logger suppression. Rotations/old log remediation are still open; no credentials inspected.

The E2E workflow explicitly passes --trace=off in normal and diagnostic paths; diagnostics
still set zero retries and quoted filters retain literal values. Screenshots/videos remain.
This prevents this CLI override; retained artifacts, other manual tracing and rotation remain
separate. Beta access-code rotation stays owner-deferred.

Ledger append now requires --actor; environment/default fallbacks are removed. Historical
entries remain append-only. This prevents new accidental attribution; it does not retroactively
correct every historical attribution or alter authorization/commitment policy.

## Causal evidence and validation

- Original27 security/transport/workflow controls:24fail/3pass before twice,27pass after.
  Of the workflow controls, the diagnostic branch exposes the actual override; normal branches
  additionally require explicit CLI trace-off. Legitimate internal delivery and registrations
  are positive controls, not disabled-provider approximations.
- Actor CLI:3fail/2pass before twice. All5 pass after, including explicit owner/Codex,
  hostile environment fallback and hash-chain validation on isolated ledgers.
- Final36 new controls include3 expired JWT refusals and missing-key no-transport behavior.
  Supported expanded130pass, then166pass including36 discovery-floor controls. No skips.
- Current requested-product finite differences:6pass; requested/hint sensitivity remains
  [1,0] with the identity flag on, [0,1] with it off across GFS/ICON/EURO. No physics/skill claim.
- Discrete authority lens: foreign identity selection is refused without a persisted mutation;
  valid identity writes one subscription and repeat registration does not duplicate it.
  Internal target/scheduling remain intact. This is an ownership control, not a continuous
  meteorological Jacobian.
- Fatal lint on changed Python accepted; ledger selftest detects every tamper. All646 governed
  backend files remain within800LOC; repository LOC ratchet has0new/0regressed violations.
- Tracked discovery633:185guards/151chain/294estate,2existing fastmcp exclusions/1quarantine.
  Each tracked suite is claimed exactly once. Estate floor1073/reference1075 preserves margin2.
  Guards2354/reference2360 and chain2043/reference2049 are unchanged.
- Prior runtime6c355cb2 CI37253656301 now completed: all11jobs success. Actual logs show
  2360guards/2049chain/1039estate =5448backend;356suites/3689frontend. Existing66skip/1xfail;
  estate290selected/288produced/0silent. New source d1cc16fe CI37257237630 now all11success:
  5484backend=2360guards+2049chain+1075estate;356suites/3689frontend;294estate selected/
  292produced/0silent. Existing66guards skip/1xfail and2865estate skips retained; all36new
  controls executed. LOC/ledger/encoding/Lighthouse supplementary workflows success.

Offline controls use randomly generated fixture credentials, blocked external sockets,
actual routers/HTTPX/ORM and temporary fixture databases. No real users or pushes were used.
The Windows interpreter lacks two declared packages and is not the declared virtualenv;
hosted Linux CI is the full runtime authority. Frontend source is unchanged in this batch.

Read-only live start check: healthy backend6b062e97; all10 data lanes reportok, no alerts;
freshest ingest age0.6h. This does not close WI-03's model-cycle-age objection. No load test,
merge, deployment, provider write, shell/dashboard mutation or science activation occurred.

Primary guidance: [Gemini REST authentication](https://ai.google.dev/api/) supports the API-key
header; [Playwright CLI](https://playwright.dev/docs/test-cli) documents CLI trace overrides.
Recorded outputs remain ignored; compact XML counters and source digests are in
DEEP-AUDIT-VALIDATION.json.

## Next repair order

1. Qualify cancellable /grid and series stages below the proxy deadline, then index reuse and
   current-frame hub delivery with null-Jacobian checks. Do not load-test the shared box.
2. Reproduce ingestion zero-success, model-cycle age, provider-prune collision, invalid-frame
   and disk-cache refresh controls. Changes to selected served cycles stay dark under D-001.
3. Finish pixel/time/slow-fetch playback and native GPU/theme/mobile acceptance, including
   rollover identity, idle-FPS fallback and ICON point/grid estimator parity.
4. Continue original SEC07/09, financial PostgreSQL and alert preferences/outbox; then held-out
   science, band fallback, mixed-sea/partition invariance and directional disclosure.
5. Cloud publication remains prepared but unexecuted: this chat still has no callable Supabase
   tools or isolated runtime credential path. OAuth approval is not publication acceptance.
