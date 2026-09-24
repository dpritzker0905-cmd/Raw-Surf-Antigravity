# Archive retention: guarded reads and acknowledged writes

The confirmed defect was a read/merge/replace operation interpreting an unreadable object as an empty history. The offline baseline probe used the actual loader, ledger and JSON serializer: a month with two old rows became only the one new row after a simulated 503, timeout, or invalid JSON response. A failed pending read similarly replaced one pending forecast with an empty list. `LEDGER_READ_FAILURE_FINDING.md` and `ledger-read-failure-results.json` preserve that pre-repair evidence.

The repair is local source work on HEAD `d82032f5cd5978967622721b8c9638da36a87f7d`; no real provider, database, storage, or production credential was used by the tests. The user-authorized scope expanded from the skill ledger to both other append writers after the root found the same mechanism in hot residual history and monthly residual rollups.

## Implemented contract

- `buoy_calibration.py:491–558` adds typed read/write failures and opt-in strict storage operations. Legacy report reads/uploads preserve their optional/best-effort behavior. Strict successful JSON null is rejected, so it cannot masquerade as absence. The common `load_calibration_rows_l2` validates `list[dict]` and returns `(rows, exists)`.
- Strict absence accepts HTTP 404 only with the documented modern `NoSuchKey` or legacy `not_found` code. Bucket/tenant failures, unknown/error bodies, forbidden access, timeouts, non-404 HTTP errors, and invalid JSON refuse the update. A not-found result can hide an unseen existing object, so **every first write uses `x-upsert: false`**. Both modern 409 and legacy 400 create conflicts fail; no fallback overwrite occurs.
- `store.py:331` retains existing default upload semantics and adds optional strict acknowledgment and overwrite control. A strict success is the literal `True` only after HTTP 200/201. Every other status or exception fails. `upload_calibration_l2` refuses `None`, `False`, and even truthy non-boolean acknowledgments such as integer `1`.
- `forecast_skill.py:596–620` reads and validates pending and every touched month before any write. It writes merged scored months first, then consumes pending only after all archive writes acknowledge. Partial success and lost acknowledgments retry by the existing immutable-row dedupe key. A failed pending write leaves old pending available; the retry sees already archived scores and does not duplicate them.
- `buoy_residual_retention.py:64–87` preflights all touched monthly segments and requires acknowledged append/create writes. Partial month success remains idempotent on retry. `run_buoy_calibration` at `buoy_calibration.py:741` applies the same strict contract to the hot residual archive. Its existing age/entry rules are unchanged. A hot-archive failure is caught by the existing best-effort enrichment boundary, allowing the calibration report to publish without falsely claiming an archive summary.

The error-code and upload semantics were checked against the official [Supabase storage error codes](https://supabase.com/docs/guides/storage/debugging/error-codes) and [standard uploads](https://supabase.com/docs/guides/storage/uploads/standard-uploads). Interpreting a not-found response as permission to replace is unsafe; conditional creation is the protection even when absence is genuine at read time but another writer creates before the upload.

## Verification and ownership

`backend/tests/test_forecast_skill_retention.py` adds **69 cases**, all owned by the actual forecast-chain selector. The file is included through `git add -N`; the selector now emits **101 chain files**. Existing `test_forecast_skill.py` and `test_buoy_residual_retention.py` fixtures only gained keyword compatibility; they add no cases. CI floors/selector definitions were not modified by this agent.

The initial ledger tests ran before its source changes: **39 failed, three passed** across 42 cases (`retention-baseline-red.xml`/`.log`). Later controls added false/truthy acknowledgments, conflict responses, lost acknowledgments, and documented legacy absence. The separate 18-case residual-writer baseline showed **15 failed, three passed**, with 51 other cases deselected (`retention-residual-baseline-red.xml`/`.log`). This is not a claim that all final 69 cases were separately baseline-red.

Final affected-suite command, from `backend`:

```powershell
& 'C:\Users\dprit\AppData\Local\Python\bin\python3.exe' -B -m pytest -q -p no:cacheprovider tests/test_forecast_skill_retention.py tests/test_forecast_skill.py tests/test_forecast_skill_per_model.py tests/test_buoy_residual_retention.py tests/test_buoy_calibration.py tests/test_l2_writer_gate.py tests/test_manifest_cdn_policy.py tests/test_manifest_pointer.py --junitxml=../audit/weather-handoff-day2-2026-09-20/retention-affected.xml
```

Final result: **213 passed, 10.57 s**, `retention-affected.xml`. These tests intercept HTTP at a dummy `.invalid` URL and execute the actual loader, serializers, ledger, hot-archive entry point, monthly rollup, and `ProductStore` upload method. Controls include healthy append, genuine first creation, explicit empty arrays, unreadable/invalid history, false absence, failed writes, timeout after server-side commit, month-boundary preflight and partial-success retry, existing report fallback, hot archive age pruning, designated-writer gates, manifest CDN policy, and manifest-pointer behavior. The first expanded combined run exposed a test-fixture `__new__` monkeypatch leak; the fixture was corrected to patch only `__init__`. Independent review then caught the hot archive's date fixture aging out in the future; the final fixture freezes `bc.datetime` while keeping the actual merge/runner. The eight-module rerun above includes that final test-only correction. No product source workaround was made for either fixture issue.

The post-storage **full chain passed 1,148 tests, three existing warnings, 710.85 s**, selecting 101 files. `retention-chain-selected.txt`, `retention-chain.xml` and `retention-chain.log` retain the exact selector and outcome. Every production source change was stable during that run. The clock fixture alone was corrected afterward, followed by the final 213-test affected run. Additional non-chain upload-consumer checks passed **42 tests** across spot ratings, grid size climatology and climatology inbox (`retention-adjacent.xml`), plus **10 tests** for spot size climatology (`retention-size-climatology.xml`). These overlap other validation scopes; do not add run totals as unique test counts.

An explicit post-implementation ordering mutation copied the full `forecast_skill.py` into `retention-mutation/` and moved pending upload before archive writes, executing only the copy inside a disposable child process. The failed-archive preservation guard then failed because pending was emptied, while the healthy append/idempotency control still passed: **one expected failure, one pass, 1.48 s**. The probe asserts the exact failed/passed test identities and verifies checkout source bytes remained unchanged. Original/mutant source hashes and receipt are in `retention-mutation/receipt.json`, with copied sources, `ordering.xml`, and `retention-ordering-mutation.log`. This verifies that the negative guard detects the intended persistence-order defect and does not simply reject all writes. Run from `backend`:

```powershell
& 'C:\Users\dprit\AppData\Local\Python\bin\python3.exe' -B ../audit/weather-handoff-day2-2026-09-20/run_retention_ordering_mutation.py
```

Current physical source sizes are 774 lines (`buoy_calibration.py`), 645 (`forecast_skill.py`), 720 (`store.py`), and 107 (`buoy_residual_retention.py`), below 800. `git diff --check` passed. The earlier direction full-chain run, 1,079 passed, preceded these storage changes and the 69 extra cases; the 1,148-test run supersedes it for the combined backend source.

Local interpreter evidence is Python 3.14.4 versus declared CI/production 3.12, with 28 differing pins and seven absent packages. Hosted exact-source CI remains separate evidence.

## Limits that remain explicit

- This repairs failure/absence confusion and missing acknowledgments. It does **not** add compare-and-swap, transactions, locks, or a single-writer guarantee. Two successful readers of an existing object can still race with last-writer-wins upserts. Stale successful reads also remain a risk. Create-only protects unseen first writes, not updates to successfully read existing objects.
- Multi-object persistence is retryable, not atomic. Earlier monthly writes can succeed before a later month fails; pending survives for retry. Fresh incoming forecasts generated during a failed run are not guaranteed stored. Retry must occur before ordinary retention/observation windows expire. The hot residual archive retains its existing 90-day/20,000-row limits and is written before windowed monthly rollup; sustained rollup failure can outlast that window and lose unarchived rows through ordinary pruning. The approximate 14-day depth in old comments depends on workload, not an age guarantee.
- The `list[dict]` gate verifies structural safety for merging. It is not a complete historical science-schema validation or a provenance certification of every old row.
- No earlier erased observations are reconstructed by this fix. The current 86,346-row production snapshot and its September 9–20 target span do not prove that production loss occurred, or identify its cause. Prior authenticated contents and relevant storage/job logs are needed for incident attribution.
- Legacy report uploads remain best effort by design. The fix does not promise that a successful calibration-loop return proves every report object persisted.
