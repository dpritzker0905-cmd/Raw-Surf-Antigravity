# 2026-11-25 · trace: the estate "+3" and the chain floor above its reading (director's request, from the advisor on #1309)

Read-only investigation; written 02:46Z. Instruments: per-dev-run "N passed" vs the floor at that run's own commit (base
literal in ci.yml + Σ fragments); `scripts/floor_fragment_check.py` run per merge against its parent; per-file
`pytest --collect-only` diffs.

## 1. Estate: one test slipped, not three

The estate base is the last hosted reading minus the margin of **2**, so exact accounting reads **floor + 2**.
- That held at every dev run from 829434ceb to 89f6213ee (00:47Z).
- At 59f1b9607 (run 45524560629, 01:16Z) it read 4830 against a floor of 4827, a difference of **3**: ONE test without a
  fragment. The "+3" includes the margin.
- The window holds three merges, all from this lane's storage-auth plan:

  | merge | PR | collected Δ | fragment |
  |---|---|---|---|
  | d526b586f | #1297 | +3 | +3 |
  | **3a2480758** | **#1294** | **+5** | **+4** |
  | 59f1b9607 | #1295 | +6 | +6 |

- The extra test: `tests/test_workflow_key_environment.py` 48 → 49. It is parametrized over every workflow that uses the
  storage key, and #1294 added one (`storage-auth-probe.yml`) without touching that test file.
- **Did #1277 miss it? No.** On #1294's PR run 45516926313 the `backend-floor-fragment-check` job printed
  `| estate | 5 | 0 | 4 | 0 | mismatch |` and the fix command. It is REPORT-ONLY, so the job was green, and the author (this
  lane) did not read the table before sending the head.
- The director's catch-up #1309 (+1 to 4828) is the right size.

## 2. Chain: floor 4571 above the last reading 4555, but the next run reaches it

- **The floor:** at dev head 925d77519 the chain floor is base 4160 + Σ fragments 411 = **4571 passed**. Since
  59f1b9607 (which read 4555 against its own floor of 4549), two fragments landed: claude-tide-a-v2-instrument (+21
  tests, +1 file) and claude-harcon-arm-synth-guard (+1).
- **The collection:** collecting dev head against 59f1b9607 gives chain **+22 tests, +1 file**, matching those
  fragments exactly.
- **The expectation:** the next dev run should read about 4555 + 22 = **4577** passed ≥ 4571. NOT red, provided the new
  tests pass and none of them skips.
