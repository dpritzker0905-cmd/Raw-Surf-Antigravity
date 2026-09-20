# Confirmed read-failure overwrite mechanism; production loss unproven

This records the initial scratch-only forensic reproduction, before the subsequently authorized source repair described in `RETENTION_REPAIR.md`. The reproduction changed no application source/tests, real storage object, database, provider or credential. The Supabase skill was consulted; evidence here comes from the actual repository code and intercepted calls, rather than assuming service behavior from memory. Line references below describe the pre-repair state. The probe now explicitly loads the original two modules from commit `d82032f5` into its disposable offline process, using `git show`; it changes no checkout file and writes replay results separately from the original baseline.

`backend/services/weather_pipeline/buoy_calibration.py:498` (`load_calibration_l2`) returns the same `None` for missing configuration, any non-200 status (including 404 and 503), network exceptions and JSON decode errors. It cannot tell its caller whether an archive is absent or unreadable. `upload_calibration_l2` at line 491 serializes the supplied object and passes it to `store._upload_to_supabase`.

`forecast_skill.run_skill_ledger` uses `load_calibration_l2(key) or []` for both pending and monthly scored objects (current working source lines 596 and 609). It then uploads the resulting pending list and `existing + fresh`. The actual `ProductStore._upload_to_supabase` at `store.py:331` uses the Storage REST path with **`x-upsert: true`**, replacing the same object key. The monthly-segment docstring promises append-only/no pruning, but the writer is a read/merge/replace operation whose failure state can silently become an empty merge base.

The probe calls the actual loader, actual ledger and actual upload serializer. Provider/calibration inputs are synthetic; all `requests.get` calls are intercepted at a dummy `.invalid` URL, and the store upload method captures serialized bytes in memory. The existing month has two distinct older scored rows; pending contains one valid new scoreable row. No helper return value was directly stubbed to `None`—the real loader produces it from each failing HTTP/JSON condition.

| Monthly read condition | Stored month before | Captured replacement | Older rows retained |
|---|---:|---:|---:|
| Healthy 200 with valid array | 2 | 3 | 2 |
| Real absence, 404 control | 0 | 1 | 0, expected |
| 503 while two rows exist | 2 | 1 | 0 |
| Timeout while two rows exist | 2 | 1 | 0 |
| Invalid JSON on 200 | 2 | 1 | 0 |

A separate pending-timeout case starts with one pending forecast and an intact two-row month. The failed pending read leads to a captured empty pending upload (1 → 0), with no new score and no monthly write. Thus the vulnerability can discard both historical scored evidence and not-yet-scored forecasts.

Reproduce from `backend`:

```powershell
& 'C:\Users\dprit\AppData\Local\Python\bin\python3.exe' -B ../audit/weather-handoff-day2-2026-09-20/ledger_read_failure_probe.py
```

Original results are in `ledger-read-failure-results.json`. They record HEAD `d82032f5...` and `skill_source_modified: false`; the scorer diagnostics already belong to that commit. The earlier draft incorrectly described concurrent diagnostics edits. A replay now writes `ledger-read-failure-replay.json`, records the exact baseline SHA and loaded module hashes, and asserts the same healthy append and failing overwrite outcomes despite the repaired working tree.

The root's independently retrieved snapshot reportedly contains 86,346 internally consistent rows spanning September 9–20, while object creation metadata dates to August 31. That chronology alone does **not** show what rows were present previously, why the first retained target is September 9, whether an upload replaced earlier history, or whether this failure path occurred. It supports investigating retention, not asserting a confirmed production incident. Object creation time is not evidence of the earliest forecast target formerly stored.

Attribution needs prior snapshots/versioned objects or other independent row inventories, plus the relevant job and storage read/write logs around any suspected truncation. Record archive byte/row counts and time bounds across writes; a changed first target is evidence only when compared to an authenticated earlier content snapshot.

A bounded repair should distinguish explicit absence from read failure and malformed content, and refuse destructive replacement after a failed read. True first creation and a healthy deduplicated append need positive controls; timeout/503/invalid JSON/malformed archive must preserve the previous object and expose an operational failure. Pending and scored paths both need that contract. This report does not specify a new retention policy or claim that handling read failures alone provides atomicity against concurrent writers; concurrency protection remains a separate question.
