# OpenAI app testing budget

The shared dev/production backend has one lifetime$10 reservation ceiling. It covers photo analysis, descriptive
tag suggestions, board scanning and GPT-4o review moderation. The lineup classifier and Gemini matcher do not call
OpenAI despite older comments. This is an app-side limit, not an OpenAI-account billing setting; other programs or
direct API calls using the key are outside it.

## Safety contract

- Every paid request commits a$0.35 debit in PostgreSQL BEFORE one provider attempt. Concurrent workers/restarts
  share the same row. No midnight/month/key rotation or deployment reset. No SDK retries.
- Full model context plus bounded output costs at most$0.309 for GPT-5.4 mini and$0.321 for GPT-4o at reviewed
  prices. The guard pins the known snapshots. Unrecognized models, increased output limits or pricing review
  expiry (2026-11-15 UTC) fail closed. Unknown configuration values also fail closed.
- No refunds: timeout, cancellation, refusal, invalid output or lost acknowledgement might still be billed.
  This deliberately stops testing early. Counter values are conservative reservations, not provider invoices.
- Missing table/row, uninitialized budget, database failure or exhausted balance prevents the paid attempt.
  Vision returns503 with a safe paused-budget message. Moderation keeps its pre-existing fail-open review
  behavior and reports a static moderation-unavailable error without calling OpenAI.
- Private schema `ai_budget_private`, RLS with no public policy, no PUBLIC/anon/authenticated grants, no public
  mutation/status API. Backend must use the migration owner or an appropriately privileged private backend role.

## Activation

Apply only the reviewed private-budget migration after inspecting the deployed Alembic history; do not blindly
upgrade other heads or adopt held payment migrations. Revision `6b8bb9b66da7` extends `2fd2888a0987` and creates
only the private schema/table. It starts CLOSED with$10 reserved and initialized:false. Missing migration also
keeps the deployed guard closed. There is no lazy creation or automatic zero-spend initialization.

Run from the backend runtime, using its existing `DATABASE_URL` (never copy connection values):

```sh
python scripts/openai_budget.py
python scripts/openai_budget.py --initialize --prior-spend-upper-bound-usd 1.25
```

The second command is one-time only and refuses an initialized ledger. Use a conservative upper bound including
earlier/outstanding app calls. For this testing rollout the owner clarified there are no real users; the stated
implementation assumption reserves$1.25 for the earlier documented six synthetic/public-image requests (the four-call
worst-case bound$1.236 plus the prior two small probes is below$1.25). This leaves$8.75, at most25 further$0.35
attempts. If other earlier app use is discovered, use a higher verified upper bound before first initialization;
do not reset an initialized counter. Actual earlier provider charges were not read from billing.

## Remove the cap when ready

Set `OPENAI_TEST_BUDGET_ENABLED=false` in the backend environment and restart/redeploy. This explicit operator
opt-out removes the app-side guard without deleting any ledger data or changing client code. Omit it or set it
back to`true` to resume the SAME remaining balance. Do not drop the table, reset the row, change the budget ID or
rerun initialization to extend testing. Downgrade refuses to destroy the spending record.

Production frontend publishing remains locked. A backend change affects both dev and production API callers.

## Verification

Local SQLite tests cover last-reservation races, independent pools, cross-model sharing, ambiguous commits,
timeouts/errors, one-time prior-spend initialization, fail-closed configuration and provider denial. Dedicated
isolated PostgreSQL CI repeats the suite and executes the actual migration, checks ACL/RLS and proves a non-owner
reader cannot see the row. No provider calls are needed for those tests. Local Python lacks declared pygrib/uvloop;
local success does not substitute for hosted/runtime qualification.

Prices checked2026-10-15: [GPT-5.4 mini](https://developers.openai.com/api/docs/models/gpt-5.4-mini),
[GPT-4o](https://developers.openai.com/api/docs/models/gpt-4o). [PostgreSQL concurrency](https://www.postgresql.org/docs/current/explicit-locking.html).
