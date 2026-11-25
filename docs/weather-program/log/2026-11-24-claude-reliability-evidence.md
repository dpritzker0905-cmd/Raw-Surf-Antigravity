# 2026-11-24 · reliability lane: post-merge evidence (#1263 jq path, #1266 storage probe)

Record only; no code change.

## The P0 lookup's jq path has a NAMED pass on dev (advisor L1 on #1271)

`test_flag_guardrail::test_the_p0_jq_filter_with_real_jq` runs the exact `P0_JQ` filter of `flag-guardrail.yml` through
real jq. It can only run where jq is installed (GitHub's runners; not the lane's Windows machine). Before #1271 the
chain lane named no skips, so its pass on #1263 was shown only by matching skip counts with dev. #1271 added `-rs` and
uploads `chain.xml` as `chain-junit-<run>-<attempt>`.

First dev CI run after #1271 merged (merge `8c7607d8e`, 16:44:17Z): **run 45440595253**, chain job 138629372186, success.
Read from its `chain-junit-45440595253-1` artifact:

- PASSED `tests.test_flag_guardrail::test_the_p0_jq_filter_with_real_jq`
- SKIPPED `tests.test_eval_harness_grib_backends::test_eccodes_decodes_every_packing_of_the_fixture_including_the_pgrb2_template_5_3`
  ("eccodes is not installed here ... CI decodes with pygrib")
- SKIPPED `tests.test_skill_ml_residual::test_a_learnable_residual_passes_and_the_output_is_aggregates_only` (no sklearn)
- SKIPPED `tests.test_skill_ml_residual::test_no_learnable_residual_does_not_pass` (no sklearn)

The same named result was on #1271's own CI (run 45425360634). No P0 issue was opened (the condition was a skip).

## #1266 storage probe: "HTTP 200" lines after merge (`3b0407247`, 13:16:44Z)

| lane | run | line |
|---|---|---|
| precompute | 45401780241 | `storage credential accepted (HTTP 200, control/flags.json)` |
| forecast-ingest | 45419392479 | `storage credential accepted (HTTP 200, control/flags.json)` |
| forecast-ingest-pilots | none yet (as of 17:20Z) | owed |
| flag-guardrail | none yet (as of 17:20Z) | owed |

Switching `STORAGE_AUTH_CHECK` from `warn` to `block` needs all four lines AND the owner's typed word (advisor L1 on
#1266); this lane does not switch it.

## #1266: all four lanes logged HTTP 200 after the merge (appended 2026-11-24, after 23:35Z)

| lane | run | started | line |
|---|---|---|---|
| precompute | 45401780241 | 13:17Z | `storage credential accepted (HTTP 200, control/flags.json)` |
| forecast-ingest | 45419392479 | 14:54Z | same |
| forecast-ingest-pilots | 45481322057 | 20:29Z | same |
| flag-guardrail | 45511214457 | 23:35Z | same |

This closes the commitment `ledger.d/claude--reliability-evidence-log.jsonl:2`. Switching `STORAGE_AUTH_CHECK` to
`block` still needs the owner's typed word; this lane does not switch it.
