# 2026-11-25 · the PR-time floor fragment check becomes BLOCKING (#1311)

David: "Yes, make it block", then "Yes, block + fix" after SubQ and Reflection reviewed it. Both endorsed blocking, and
both flagged fail-open on "unknown" as a loophole.

## Bedding-in read before the flip

51 PR runs since #1277: 1 true mismatch (#1294, run 45516926313), 0 false, 0 inconclusive.

## Outcomes

| outcome | result |
|---|---|
| every lane ok, no relevant change, fragments-only, or shrinks only | pass |
| docs-only PR | never runs: the job-level `if:` skips it, which a required check counts as success |
| mismatch | FAIL unless overridden |
| unknown (collection error, inconclusive lane, or a crash) | the collection is retried ONCE; still unknown = FAIL unless overridden |

- **Override (the same for both):** the `floor-fragment-override` label (read live) plus a ledger `decision` line
  naming `floor-fragment-override #<pr>`, with a written reason ≥ 20 characters and an `authorized_by` that STARTS with
  David or the director.
- **Limit:** one GitHub account serves every lane, the director and David, so the authorizer is a written, ledgered
  claim the advisor reviews, not an identity check.
- **Kill switch:** repo variable `FLOOR_FRAGMENT_CHECK=report`; every outcome becomes a warning and the job passes.
- **Ruleset:** adding `backend-floor-fragment-check` to the dev ruleset's required checks is the director's step after
  the merge (David's word covers it).

## Follow-ups (not in #1311; recorded for later)

- (a) Floors computed from COLLECTION plus a bot high-water mark, replacing declared fragments.
- (b) Staleness opens an issue plus a bot fix PR, instead of failing every open PR.
- (c) A separate bot identity or GitHub App for the lanes, so an override's applier can be told apart.
- (d) A merge queue.
