# ECMWF partial cycle provenance repair

Session opened 2026-10-07T11:54:32Z. Owner: "Ok keep moving forward, start the repairs".
Own branch `codex/ecmwf-cycle-provenance` starts at receipt PR254 head
`7762ae6ec03bcb3cf6f958029e056e44a3b93e4b`. Those receipt additions remain proposed;
merged dev is `4fe944205a5716aa3114dfa47a79e1ee32e69cc6`. Ledger865 records authorization
and branch creation. No merge, deployment, shared-data write or scientific flag change.

The qualified PR253 cache repairs remain closed at their documented scope. Commitments860
and863 remain open; this repair does not fulfill or replace them. The audit's bounded live
check was blocked before Waves was enabled because focus, viewport and diagnostics could
not be established with the available browser API.

Fresh public metadata readbacks: health/data at11:47:34Z still warned about missing cycles
for ICON marine, EURO marine and EURO wind; the earlier EURO wind age warning had cleared.
The bounded products manifest read at11:48:48Z located missing-cycle global cohorts in
estimated tails (estimated blend/interpolation or GFS fallback). This is not evidence of
fresh native products missing cycles, and the warnings must not be suppressed or relabeled.

Offline investigation under existing WI-03 provenance work: the ECMWF deterministic decoder
collects only non-null `analDate` values, then stamps the entire batch if that set contains
one value. A requested message without an analysis time can therefore borrow the other
messages' cycle. Regressions will execute the real fetch/decode loop using fake GRIB/client
inputs and socket guards. No live forecast request is needed. This source correction is
independent of the estimated-tail warnings and does not repair their provenance.

## 11:57Z — local candidate verified

Ledger866 records the reproduced defect and candidate. Before the source change, the real
decoder returned a false known-cycle stamp in10 cases (8 wave omissions,1 wind and1 pressure);
4 controls passed. Missing `analDate` attributes and explicit `None` values both reproduced
it. The unrelated-parameter control stayed known, confirming that filtering is preserved.

The decoder now requires complete analysis metadata on its selected deterministic messages
before stamping the sole consistent cycle. Conflicting and entirely missing batches retain
their previous unknown behavior. This is deliberately the existing conservative batch policy;
it does not infer runs or alter how values, periods, directions or ensemble spread are decoded.

Final selected suite:104passed,0failed,0skipped in3.23s. It executes cycle identity, period-band
decode/ingest, ensemble and CI floor/selector controls from the actual repository files.
The8 wave regressions compare all other point fields, valid-time lists and return counts against
the complete-metadata control. Socket connect/DNS operations are forbidden in the local harness;
global app conftest and auto-loaded plugins are disabled. Python3.12.14/numpy2.3.5 and portable
pytest9.0.2 were reused read-only. No package install or live forecast load.

Eleven new cases belong to the157-file chain lane; selection remains644 tracked test files,
186 guards,157 chain,298 estate,2 excluded and1 quarantined. The chain floor rises2311to2322
and its reference2317to2328, preserving margin6. These are projected whole-lane totals from the
last hosted receipt plus the executed additions; they are not a new hosted measurement.
Fatal flake8 reports0; backend LOC654files/0violations and full LOC ratchet2580files/0new
violations pass. Diff whitespace passes. Full backend/frontend and own hosted CI were not run
for this local candidate; publication/qualification is still required before rollout.

No served forecast number changed: this patch is local and metadata-only. The estimated-tail
warnings remain valid. No scientific flag, shared manifest, external service or deployment was
modified; PR253 cache repairs and commitments860/863 remain separate.

Implementation handoff: review the complete selected-message policy and numeric-parity controls;
reconcile this stack after receipt PR254 is qualified/merged, without replaying fulfilled851.
Publish a draft repair PR only in the authorized rollout workflow, qualify its exact source and
actual hosted lane totals, and read back source/health after any separately authorized dev rollout.
Do not mark WI-03 live acceptance or860/863 complete from these offline tests. The next live
investigation remains860 with its exact paused one-scene prerequisites; if access still cannot
establish focus/bounds/counters, record that blocker rather than force the probe.

Final record check: ledger867 records this own log/scoreboard/STATE update. Docs-only memory
audit reports0FAIL and9historical overdue warnings, all preserved. Fresh PR/remote readback
still shows PR254 OPEN draft7762ae6e and dev4fe94420. The unowned canary matches the hash in
this audit's own protected-hashes receipt (`36689d93...`) and is excluded from the commit.
Only the owned8source/test/workflow/memory files belong to this bounded candidate.
