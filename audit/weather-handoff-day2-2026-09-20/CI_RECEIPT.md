# PR47 hosted CI receipt — 2026-09-20

[CI run 35487375744](https://github.com/dpritzker0905-cmd/Raw-Surf-Antigravity/actions/runs/35487375744) completed successfully with **11/11 successful jobs** for exact candidate `d82032f5cd5978967622721b8c9638da36a87f7d`, at `2026-09-20T04:02:41Z`. PR47 was open/draft, with base `607af934e74fa87f3b8e58698ef68fdce919ea54`, when these receipts were captured. This is an immutable-run check, not a check of whichever run happens to be latest.

Every job checked out GitHub's synthetic PR merge `21feff6f3b4b225191120201cca9cc0f0157d54c`. The commit API confirms its parents are the base and candidate above; its tree `d7ec2bc09912cf584d87e5fd0cf93dad482b9956` exactly matches the candidate tree. Thus the tested file contents match `d82032f5`.

| Lane | Hosted result | Files/suites | Warnings | Test time | Pass floor |
|---|---|---|---:|---:|---:|
| [Guards](logs/backend-sim-composition-guards.log) | 1,912 passed; 66 skipped; 1 xfailed | 160 files | 13 | 999.13s | 1,906 |
| [Forecast chain](logs/backend-forecast-chain-guards.log) | 1,022 passed; no skips | 99 files | 6 | 377.68s | 1,016 |
| [Estate](logs/backend-estate-coverage.log) | 502 passed; 2,865 skipped | 266 selected; 264 producing | 18 | 55.36s | 500 |
| [Full frontend](logs/lint-and-build-18-x.log) | 2,486 passed | 257 suites | Console/build warnings below | 24.28s | 1,686 |
| [Marine frontend](logs/frontend-marine-composition-guards.log) | 48 passed | 2 suites | — | — | 48 |

All five test lanes report zero test failures. Guards' JUnit coverage summary combines the expected failure with skips, giving **67 skipped**, consistent with pytest's **66 skipped + 1 xfailed**. Estate reports **zero silent nonexempt files**; its two explicit empty-file exemptions are `test_clear_cache_tmp.py` and `test_trevec_index_gc.py`. The latter has optional module-level dependency skips. The new nearshore eligibility test is present in the estate selector. Complete hosted backend file selections are preserved in the JSON; lane totals should not be treated as unique whole-repository test coverage.

The backend floor pair at this head is correct: reference readings **1912/1022/502**, floors **1906/1016/500**, margins **6/6/2**. The separate staleness job read prior dev run `35483627338` (1883/947/488), so its green result alone did not establish the new counts. This receipt reconciles those counts directly. **Full-frontend floors remain loose:** 185 suites/1686 tests versus 257/2486 observed, allowing 72 suites/800 tests of count reduction before those floors fail. The marine floor is 2/48. Tightening the full-frontend floor is a separate follow-up; no floors were changed here.

The green status has these qualifications:

- **Backend lint is not clean.** The broad flake8 step exits **1**, reporting six F821 undefined-name findings and one F824 unused-global finding. `continue-on-error: true` makes that step advisory. The strict condition-report F821 step passes. All five files containing those seven diagnostics are unchanged between the dev base and candidate. Exact diagnostics are retained in [the log](logs/backend-lint.log) and JSON.
- **Frontend lint is a debt ratchet:** 1101 files, **154 errors and 923 warnings**, with no never-zero rule violation or baseline increase. Unused-import warnings improved from 128 to 126. The production build completed **with warnings**. [Lint evidence](logs/frontend-lint.log)
- Install logs report **54 npm advisories** (14 low, 12 moderate, 24 high, 4 critical), dependency deprecations, and Node engine mismatches under Node 18. This is the install-time report, not independent vulnerability triage. The build used Node 18.20.8; the separate frontend lint job used 18.20.2.
- Backend tests ran on Python 3.12.14. Warnings include AnyIO/Starlette, Pydantic, `crypt`, `gotrue`, and `datetime.utcnow` deprecations. Guards additionally report an unawaited `AsyncMock` coroutine in `test_parity_unification.py`, surfaced at `point_resolution.py:444`. Frontend tests contain jsdom canvas and exercised fallback/error-path console messages; these did not fail the suites.
- The BOLA ratchet still reports **196 bare-user_id routes** against a 219 baseline (23 baseline entries could be tightened). The import check scanned 32 modules with no cross-package circular imports. The file-size gate passed 603 Python files, while warning about 118 files between 500 and 800 lines. These bounded checks do not establish an absence of security or architecture debt.

The PR snapshot also records successful Encoding, LOC and Lighthouse checks, and successful Netlify preview deployment status; Pages Changed is neutral. Their job logs were not audited in this bounded CI receipt. No scientific grading, common-observation replay, visual correctness, production deployment, or credential revocation is established by this run.

Evidence: [sanitized JSON](ci-receipt.json), [capture script](capture_ci_receipt.py), [reconciliation script](reconcile_ci_receipt.py), and the 11 sanitized job logs in `logs/`. JSON includes capture time, job/step metadata, exact file selections, diagnostic details and log-byte SHA256 hashes. Redaction counts are regex matches, not counts of exposed secrets. This receipt work only wrote new local audit artifacts; it did not change historical reports, source, tests or remote state.
