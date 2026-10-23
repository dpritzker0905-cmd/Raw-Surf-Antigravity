# ledger.d: per-PR ledger fragments

The owner, 2026-10-22 23:11 EDT: "Yes: build the per-PR ledger fragments (ledger.d/<pr>.jsonl folded into
ACTIONS.jsonl in merge order) so PRs stop colliding and auto-merge runs unattended. Keep the hash chain intact."
(DECISIONS "Ledger fragments", BRAIN_RULES §23.)

**A PR never edits `ACTIONS.jsonl` or STATE's `Ledger head` anchor.** It records its actions here, one file per PR:

```bash
python backend/scripts/action_ledger.py append --actor claude --kind pr_open --target "#470" \
    --why "..." --authorized-by "..." --evidence "..." --outcome "..." --verified "..." --rollback "..."
# -> appended ledger.d/<branch-slug>.jsonl:1
```

- **The file** is `<branch-slug>.jsonl` (`claude/clever-wozniak-c0485c` -> `claude--clever-wozniak-c0485c.jsonl`),
  written only by `action_ledger.py append`, and committed with the PR. A name already used on dev is never
  reused: append picks `<slug>-2`. Once merged, a fragment is immutable: a mistake gets a `correction` line in
  your own (new) fragment.
- **A line** carries every ledger field except `seq`, `prev` and `at`, which only the fold writes. `acted_at` is
  when the line was written unless you pass `--acted-at` (an action recorded late).
- **References** (`--fulfills`, `--corrects`): a seq already in ACTIONS.jsonl; `@frag:N`, line N of your own
  fragment; or `@frag:<name>:N`, line N of a fragment already merged to dev (folded or not).
- **Citing a line** before it is folded: `ledger.d/<name>.jsonl:N`, never a guessed seq. After the fold, the line in
  ACTIONS.jsonl carries `"fragment": "<name>:N"`, so `grep '"fragment":"<name>:N"'` gives its seq.

**The fold** (the lead): `python backend/scripts/action_ledger.py fold-pr` fetches dev and, in a temporary worktree,
appends every fragment on dev to ACTIONS.jsonl in merge order (the order the files were added to dev; line order
within a file). It chains each line normally (seq, prev, `at` = the fold time), resolves the `@frag` references,
verifies the whole chain, moves the STATE anchor, checks that every fragment line is now in ACTIONS.jsonl field for
field, and only then deletes the folded files, all in one commit with a `Ledger-Fold:` trailer. Then it pushes
`ledger-fold/<UTC stamp>` and opens the PR. `--dry-run` shows the plan. If an older PR that still writes ACTIONS.jsonl
directly merges first, re-run it with `--replace <branch>`: the fold is recomputed from dev, nothing is hand-merged. A
GitHub workflow cannot do this. Dev's ruleset requires the 11 ci.yml jobs with no bypass, and a PR opened by
GITHUB_TOKEN triggers no CI.

**The guard**: `action_ledger.py check-pr` (the Weather Program Ledger workflow) fails a PR that edits ACTIONS.jsonl
or the anchor, unless it is a fold whose lines equal the fold recomputed from dev, or a PR opened before this file
was added to dev (the transition: those keep the old way until they merge). It also fails a PR that edits or deletes
a merged fragment, reuses a fragment name or adds an invalid line. `memory_audit.py` validates every fragment and
counts their commitments, fulfilments and corrections before the fold.
