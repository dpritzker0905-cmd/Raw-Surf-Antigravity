# AI setup, releases and testing budget: durable handoff

This is the navigation record for the owner's 2026-10-15 request to remember the AI work. Read the linked
receipts and verify GitHub/Render before changing anything; source qualification is separate from deployment.
No secret values, bearer tokens, connection strings or raw customer media belong in this public repository.

## Owner decisions

- Reflection should be optional inside Codex. The owner declined a desktop restart/switcher workaround and
  requested prompt-invoked second opinions instead. An optional `mcp__reflection__ask_reflection` tool is exposed
  in this session. Do not claim Reflection was added to the native desktop model picker. Its local adapter/key
  configuration is not versioned in this repository; recheck the installed tool before using it in another session.
- Reflection reviewed the Raw Surf code and the authentication patch. The patch-review receipt below records
  no newly introduced actionable bug; do not generalize that result to later changes or to the whole application.
- Reuse Render's existing `OPENAI_API_KEY`. A delayed request for a new key was superseded by explicit reuse.
  The owner chose OpenAI after comparing Gemini and reported funding $10 for testing. Do not replace keys or
  switch providers without a new instruction. No real app users yet, per the owner's budget clarification.
- Keep production frontend publishing locked. Shared Render backend changes affect both dev and production.
  Prior explicit deployment permission concerned PR334 and PR335; PR336 is not merged/deployed by this record.
- Add a removable lifetime $10 app budget. Stated conservative implementation assumption: account for $1.25
  of earlier documented tests first, leaving $8.75. This is an allowance, not a measured billing invoice.

## What shipped

| Change | Source and acceptance | State recorded on 2026-10-15 |
| --- | --- | --- |
| Authentication/ownership | [PR334](https://github.com/dpritzker0905-cmd/Raw-Surf-Antigravity/pull/334), squash `48877804c0747afa347858067b55f9f3c128cde0` | Shared backend deployed at byte-equivalent `363c6d738`; 46 public HTTP checks passed, fixtures removed and zero remaining verified |
| Real OpenAI vision | [PR335](https://github.com/dpritzker0905-cmd/Raw-Surf-Antigravity/pull/335), qualified `83ca36160b862e7b964e5201d1ecc584aa10c34d`, squash `f2d339e64a086537a010b158a33840babd85d5b0` | Shared backend and dev frontend deployed; production frontend remains locked at `fc140024` |
| Lifetime app budget | [PR336](https://github.com/dpritzker0905-cmd/Raw-Surf-Antigravity/pull/336), implementation `73422d4be` | Open, not merged, no live migration/initialization/environment/deployment performed. First hosted PostgreSQL safety job passed; broader qualification pending |

PR335 Render service `srv-d7fhiu7lk1mc73debje0`, deploy `dep-db8jlt6q1p3s738v7j0g`, live source `f2d339e64`.
Dev Netlify deploy `6ad13c86685b0990da0280a7` serves `f2d339e6`. Health read back healthy with matching version,
database connected and scheduler running. These are historical observations, not a current live-state guarantee.

Vision smoke: four paid synthetic/public-image requests; 14 HTTP cases plus two health checks passed. They cover
photo analysis, descriptive suggestions, board reading and no-board handling, plus authentication/invalid inputs.
No persistent test fixtures or customer photos were sent. These used short-lived signed synthetic-subject tokens;
normal password logins were separately tested in PR334's smoke. Real stored-media/photos, visual accuracy and
device workflows remain unverified. Conservative bound for the four calls was $1.236; two earlier probes returned
1209 input/183 output tokens in total. Actual billing and account-wide spending/auto-recharge settings were not read.

## Provider behavior and budget design

Vision calls the fixed official Chat Completions endpoint with GPT-5.4 mini, strict schemas, 2000 output-token
limit, two concurrent slots, public HTTPS or validated image data and no automatic provider fallback. Photo tags
are descriptive. Identity matching stays unavailable; person profiles are not sent. Board results return
`saved:false` and unknown attributes stay null for owner review. Existing Gemini key was rejected and its model
configuration is stale; the Cloudinary helper classifies filenames/descriptions rather than performing vision.

The new budget guards both paid call sites: `routes/ai/ai_vision.py` and `services/ai_moderation.py`. One atomic
PostgreSQL UPDATE commits a $0.35 reservation before each provider attempt. Pinned snapshots and bounded output
make this conservative at reviewed prices; both callers explicitly pin `service_tier=default` to prevent project
priority defaults from raising the bound. No refunds, retries, automatic resets or public mutation endpoint.
Missing/uninitialized ledger, DB errors, unknown settings/models and pricing expiry (2026-11-15 UTC) stop paid calls.
Vision returns a safe 503; review moderation preserves its earlier fail-open review behavior without a paid call.

The private RLS schema `ai_budget_private` has no public grants/policies. Migration `6b8bb9b66da7` extends
`2fd2888a0987`, one of three existing Alembic heads. It starts closed with the whole budget reserved. Inspect the
deployed migration history before applying ONLY this migration; never blindly upgrade other heads/held payment
migrations. Use `backend/scripts/openai_budget.py` for read-only status or one-time initialization with prior
spend allowance. It refuses resets. At $1.25 opening allowance, at most 25 further $0.35 attempts fit.

Later removal: set `OPENAI_TEST_BUDGET_ENABLED=false` in the backend environment and restart/redeploy. Re-enabling
retains the same counter. Keep the ledger/table and budget ID. This is an app-side guard; direct API calls or other
programs using the key are outside it. Account billing limits were not changed or verified.

## Verification and next steps

Local budget+vision+authority/transport/floor checks: 153 passed and one PostgreSQL-only skipped. Latest budget,
vision and floor run: 107 passed/one skipped. Dedicated PostgreSQL job on CI run
[38808589933](https://github.com/dpritzker0905-cmd/Raw-Surf-Antigravity/actions/runs/38808589933) passed on the first
published source; it runs the real migration and tests ACL/RLS, final-reservation races, persistence and failures.
The reset-counter mutant is detected (20 attempts instead of one). No paid calls were needed for these tests.
Local Python lacks declared pygrib/uvloop; it is not runtime parity. Supabase advisors were unavailable, not passed.

Before activation: qualify the final PR336 hosted head, inspect the real migration graph/role, apply only the
reviewed budget migration, initialize once using the prior allowance, deploy the shared backend and verify live
paid-call denial before declaring the cap active. Preserve production frontend lock. Do not call the guard live
merely because unit tests or CI passed. Verify any new spending since this record before initialization. Earlier
calls omitted service tier, so the $1.25 full-context opening allowance assumes standard pricing; verify actual
prior tier/spend or use a higher verified allowance before initializing. The closed-start guard prevents guessing.

## Sources to recall

- [Authentication and Reflection review receipt](../weather-program/log/2026-10-15-reflection-ai-auth-fixes.md)
- [Vision source, CI and deployment receipt](../weather-program/log/2026-10-15-vision-provider-integration.md)
- [Vision behavior/runbook](VISION-PROVIDER.md)
- [Budget activation and removal runbook](OPENAI-TESTING-BUDGET.md)
- [Budget implementation/session log](../weather-program/log/2026-10-15-openai-testing-cap.md)
- [Current shared state](../weather-program/STATE.md) and hash-chained `ACTIONS.jsonl` in the same directory

The repository is the cross-machine memory of record. Logs/ledgers are append-only; update STATE by exact
replacement and advance its ledger anchor to the actual head. Private local smoke/check JSON artifacts exist
under the session visualization directory, but must not be the sole source for future recovery.
