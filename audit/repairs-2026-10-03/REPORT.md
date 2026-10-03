# Raw Surf audit repairs — first batch, 2026-10-03 UTC

Branch: `codex/audit-repairs`. Base: `origin/dev` at `e0f934662eb919de6182a4c0fc4cfc41f9f5aa89`.
This is a local repair batch. No deployment, real payment, provider credential rotation,
production database write, or served weather flag change was performed.

## Repairs and the repeated experiments

Each item below was tested twice before changing its production implementation and twice
afterwards, in fresh Python processes. Only valid behavioral runs are counted; preliminary
fixture/import mistakes were corrected before repeating the baseline. Detailed run identifiers,
exit codes and summaries are in [results.json](results.json).

| Item | Before, twice | After, twice | Result and remaining boundary |
|---|---|---|---|
| APP-01/02: account authority | 11 failed, 6 passed each | 17 passed each | Verified JWT required; another user's profile cannot be patched; wallet/administrative fields rejected; direct tier assignment requires admin. Other account routes still need their own audit repairs. |
| APP-05: profile read privacy | 6 failed, 3 passed each | Full account file: 26 passed each | Three profile lookup/list paths omit email, balance and home location for public/other-user readers; verified owner retains them. Family/conversation disclosures remain open. |
| APP-03 / part APP-10: wallet fulfillment | 12 failed, 1 passed each | 13 passed each | Webhook and both status readers share conditional payment claim, wallet update and ledger insertion in one transaction. Verification errors retain 400/503; fulfillment failures return retryable 500. Postgres concurrency, legacy reconciliation and remaining wallet paths are unverified. |
| APP-04: Strava configuration | 2 failed, 1 passed each | 3 passed each | Literal credential fallback removed; missing environment configuration returns 503 before OAuth operations. Exposed credential rotation is still required/unverified; OAuth state security is a separate open finding. |
| WEA-07: optional preview isolation | 13 failed, 1 passed each | 14 passed each | Exceptions, 429s, actual async timeout and malformed preview data preserve valid current conditions for GFS/ICON/EURO. Preview has a 3-second budget. Current-resolution failure remains 502. |
| WEA-03: recombined spectral tide cap | 6 failed, 4 passed each | New plus existing tide guards: 21 passed each | Scalar and recombined paths now share the tide-adjusted cap depth. Dark flag remains off by default. Scientific forecast skill is not established by these synthetic physics checks. |
| WEA-02: sim product provenance | 3 failed each | New plus existing forecast guards: 26 passed, 2 skipped each | Marine/wind each preserve requested/served hour, model cycle, ingestion time, product identity and estimate/staleness flags. Mixed/aligned/unknown hours are disclosed. Downstream parity/tide consumers have not yet all migrated. |

The six new regression files contain **69 distinct tests**, not 138 independent observations.
After combining all repairs, those 69 passed in two fresh processes. After synchronizing CI
floors, the same 69 plus 22 existing CI controls passed twice: **91 passed**, then **91 passed**.
The two skips in the earlier provenance companion run remain skips, not passes.

## Forensic causes and sensitivity checks

The authority failures came from treating an arbitrary resource/user selector as proof of identity,
unprotected profile mutations, and a profile patch schema accepting balance edits. Authentication
now supplies authority, ownership is checked before mutation, and the schema restricts editable
fields. Public and private response projections are selected using verified caller identity.

Three wallet entry points previously disagreed about the balance column and completion state.
Two used a nonexistent `Profile.credits` field; the credit-specific path used `credit_balance`.
An error could be acknowledged as HTTP 200, preventing Stripe retries. All three now use the same
conditional UPDATE of the payment row and the existing locked wallet/credit-ledger operation.
Changing arrival order (status then webhook then status), or repeating a successful delivery,
produces one wallet effect in the local database tests. Commit failure leaves payment and balance
unchanged. Unpaid events and subscription purchases have zero wallet effect. This is local ORM
evidence, **not a proof of production Postgres race behavior or historical accounting correctness**.
Amounts remain stored in existing floating-point columns; this does not close APP-10's precision work.

For preview isolation, the perturbation changes only the optional forecast provider. Current
height, rating and timestamp stay fixed for outage, throttling, timeout and malformed data.
The successful control still produces six breaking-height forecast hours. The primary-current
failure control still returns 502, so degraded optional data does not disguise a primary outage.

For spectral tide, individual trains already used adjusted water depth, but the final recombination
cap used the original depth. At a binding 3.5 m cap with gamma 0.81, the expected heights at water
levels -2, 0, +1 and +2 m are 1.215, 2.835, 3.645 and 4.455 m. The independent tests check these
numbers. Finite differences on both sides of zero now give `dH/deta = 0.81 m/m`; the old positive-tide
recombination cap gave zero sensitivity when binding. One partition agrees with the scalar path;
the disabled-tide control remains inert. Offshore shelf friction continues to use offshore depth.

For provenance, the requested hour and numerical baseline stay fixed while marine served hour,
marine model cycle and wind model cycle are varied independently. The identity block changes
accordingly; baseline values do not change. This makes misalignment visible but does not yet
make every downstream observation/parity comparison use the served hour.

## Broader validation and limitations

The initial exploratory whole-backend run was interrupted during slow unrelated service tests;
it loaded some modules before all edits had finished and is not final evidence. A fresh whole-tree
probe with `--maxfail=5` stopped at **624 passed, 574 skipped, 5 failed**. All five failures are in
the already quarantined `tests/test_debug_consciousness.py`:

- `test_dcl_event_trace_reconstruction`
- `test_dcl_failure_detection_and_rca`
- `test_dcl_system_health_score_calculation`
- `test_dcl_broken_flows_discovery`
- `test_dcl_chain_comparison`

The diagnostic response reports `Event Bus DB not found`. That test, the Event Bus implementation,
the Debug Consciousness implementation, and the quarantine selector are unchanged from the base.
No new quarantine was added. The capped probe does not establish that later tests pass.
Live-server smoke tests were skipped because `REACT_APP_BACKEND_URL` was unset.

The project's complete guards and forecast-chain lanes are being measured separately; final
receipts are appended below. The CI partition check passes: 603 tracked files, 180 guards,
144 chain, 276 estate, two existing FastMCP exclusions and one existing quarantine. File-size
policy passes. Hosted `dev` run **37048650086** at the base confirms 2248 guards, 1777 chain and
582 estate passes. New tests belong to chain (+13) and estate (+56). Projected next hosted
readings are 2248/1790/638; floors are 2242/1784/636 with unchanged 6/6/2 margins. A future
hosted run must confirm that projection; none was dispatched by this session.

Local Python is 3.12, matching declared CI/Render interpreter major/minor. The bundled interpreter
loads the existing project package directory rather than its own virtualenv: 44/46 pins match;
`pygrib` and `uvloop` are absent. This is not production/CI environment parity. Tests use synthetic
accounts and provider-boundary substitutes, real HTTP handlers/ORM where applicable, and temporary
SQLite databases. No real payment, notification or production account mutation was tested.

## Release and remaining work

This batch needs review and hosted CI before integration. Strava credential rotation must be
confirmed at the provider; reverting must never restore the removed literal credential.
Production payment concurrency and reconciliation need a safe isolated Postgres experiment.
Weather rollout requires the existing paired skill/parity instruments and the owner's authorization
for served flag changes. No accuracy, latency or production availability improvement is claimed.

The remaining audit program includes family/conversation authority, Strava state, recognition
claims, upload durability, ingress/rate-limit trust, remaining wallet precision and delivery jobs;
period semantics, sim tide/MOP composition, finite/missing weather data, consensus skill and
storage/connection bursts; frontend accessibility/performance and release-governance conflicts.
Partial repairs above stay open at those boundaries. The next batch should complete account/OAuth
boundaries and Postgres fulfillment evidence before promoting any scientific weather candidate.

## Final local receipts — 2026-10-03 UTC

| Required lane | Passed | Skipped | Expected failures | Failures |
|---|---:|---:|---:|---:|
| Composition guards | 2246 | 68 | 1 | 0 |
| Forecast chain | 1790 | 0 | 0 | 0 |
| Application estate, final | 637 | 2866 | 0 | 0 |

**4673 passed across the three required lanes**, with 2934 skipped and one existing expected
failure. The skips, quarantine and two existing FastMCP exclusions are not counted as coverage.
The local guard count is two below the hosted baseline, and estate one below its projection;
both remain above their unchanged-margin floors. These local counts do not replace a hosted receipt.
Composition and chain took 21:28 and 11:41 respectively. The slow section around the marine/NOAA
tests was actively using CPU; no test was cut out to shorten those lanes.

The first complete estate run had 636 passes, 2866 skips and one failure: its native-availability
control assumed `crypt` existed on Windows Python 3.12. The
[Python documentation](https://docs.python.org/3.12/library/crypt.html) specifies Unix availability.
That one platform expectation was corrected without skipping any hashing case or changing
production hashing. The entire ten-test password file failed 1 / passed 9 twice beforehand and
passed 10 twice afterwards. Frozen-hash and wrong-password checks remain intact. The rerun of the
whole estate then passed 637 with zero failures.

The final combined changed-file controls (69 new regressions, 22 CI controls and 10 password
controls) passed **101 twice**, in fresh processes. `results.json` includes both XML-derived receipts,
the initial estate failure and its final success. Raw local pytest XML and the temporary credential
removal helper are ignored by Git; sanitized results and the verifier are the public record.

Start and end canonical memory verification: **0 FAIL, 2 WARN, 12 NOTE**; the two overdue
commitments remain open. Ledger integrity and file-size policy pass. Legacy clients relying only
on `user_id` query authentication now receive 401; authenticated frontend journeys still need
staging verification. No frontend or deployed-server journey is claimed tested by this local batch.

To reproduce the final focused set from `backend/` in the declared environment:

```powershell
python -B -m pytest tests/test_audit_account_boundaries.py tests/test_audit_conditions_isolation.py tests/test_audit_payment_fulfillment.py tests/test_audit_sim_product_identity.py tests/test_audit_spectral_tide_cap.py tests/test_audit_strava_configuration.py tests/test_ci_floor_staleness.py tests/test_password_hashing_py313.py -q -p no:cacheprovider
```

Use `python scripts/ci_test_lanes.py --lane guards`, `--lane chain` or `--lane estate` from that
same directory to select a complete lane. `update_evidence.py` summarizes locally retained XML
receipts and checks the credential defaults and unchanged DCL files without emitting credential
values. It updates only this batch's owned `results.json`.

The source/evidence repair checkpoint is `32a10a9a` on `codex/audit-repairs`. Its local Git head
and clean status were read back. Pre-commit scanned 85.77 KB of staged material and found no
leaks; this does not certify old history or complete credential rotation. Canonical ledger
seq 359 records the checkpoint read-back. A separate local closeout commit preserves that record.

The post-checkpoint memory check additionally surfaced a missing historical receipt for PR #220,
the already merged base of this worktree (temporarily 0 FAIL / 3 WARN / 12 NOTE). GitHub/Git identity
was verified and the historical receipt backfilled at ledger seq 360; this session performed no
merge. Seq 361 preserves the audit-reading change, and the published anchor advances with it.
Final read-back after that backfill: **0 FAIL, 2 WARN, 12 NOTE; ledger 361 entries, OK**.
