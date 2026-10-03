# Audit repair continuation: OAuth authority and simulation frame time

Recorded 2026-10-03 17:17Z. Branch `codex/audit-repairs`, repair-start checkpoint `88c9278e`.
This continues APP-06 and the downstream portion of WEA-02 from the full-app audit. These are local
repairs with reproducible evidence; the whole audit and deployment acceptance remain open.

## Paired evidence

| Instrument | Before 1 | Before 2 | After 1 | After 2 |
|---|---:|---:|---:|---:|
| Strava authority, 25 new cases | 22 failed / 3 passed | 22 failed / 3 passed | 25 passed | 25 passed |
| Weather served-time contract, 24 new cases | 21 failed / 3 passed | 21 failed / 3 passed | 24 passed | 24 passed |

The final Strava after runs include three existing configuration companions: **28 passed each**.
The final weather after runs include existing tide/parity companions: **53 passed each**.
There are no errors or skips in these pairs. `results.json` preserves counts, failed case names,
XML hashes and instrument hashes. Raw traces and one-off scripts are ignored, not published.
The weather before runs directly reproduce requested-hour/GFS queries and stale/mixed-frame acceptance.
Strava ownership, forged account state and redirect cases directly reproduce the old boundary;
new nonce lifecycle cases fail at the old issuer's predictable-state precondition. That baseline
failure does not independently exercise an old expiry/replay mechanism that never existed.

## APP-06: verified account and durable authorization transaction

`status`, `auth-url` and `sync-recent` now require the existing strict JWT dependency and reject
an account ID different from its verified subject before account/provider effects. The frontend
already sends its session Bearer header through `apiClient`, including the callback exchange.
Mounted production-router tests retain the real identity dependency and use real SQLite ORM sessions.

Authorization issues a random opaque nonce. Only its SHA-256 hash, verified profile ID, expiry
(ten minutes) and consumed timestamp are persisted. The callback requires a verified Raw Surf session,
matching account, unexpired state, and an atomic conditional UPDATE/RETURNING claim. It commits
that claim before provider I/O. Wrong-owner requests cannot consume another owner's state; repeat
callbacks do not exchange another token. A failed exchange requires beginning a fresh authorization
flow. This trades retry of a consumed nonce for prevention of repeated provider effects.

Redirects must exactly match `/surf-log` under a configured frontend origin. Multiple exact
origins can be provided using `STRAVA_REDIRECT_ORIGINS`; default is `FRONTEND_URL`. Arbitrary origins,
other paths, queries and script URIs are rejected. Integration configuration remains environment-only.
The existing configuration tests were adapted to the new authentication contract, with no skips.
Successful token responses require nonempty strings and a future integer expiry before saving only
the verified profile. Provider error response bodies are no longer written to logs.

`backend/migrations/2026-10-03_strava_oauth_states.sql` is additive, transactional and Supabase-specific.
The exported model also installs RLS and revokes anon/authenticated access during first-table bootstrap.
Only the privileged backend/service role can use the state store. The PostgreSQL dialect emitted
table, cascading FK, two indexes, then RLS/revoke/grant in order, twice (`schema-emission.json`).
This proves emitted SQL, not transaction execution or actual database grants. No migration was applied
externally. Confirm table creation and backend role permissions before rolling out these routes.

Forensic control: changing only the caller from the owner to another/anonymous actor produces zero
provider calls and zero persisted token-hash changes. The legitimate owner path has one exchange and
changes only that account. This discrete boundary control supplements the continuous weather tests.

Open: provider credential rotation evidence (APP-04), a real test-account OAuth/browser journey,
live PostgreSQL contention, session/browser-level binding beyond account identity, nonce retention,
refresh-response validation, and broader token-storage/logging hardening. Local race prevention is
supported by sequential replay and atomic SQL shape; concurrent PostgreSQL behavior is not certified.

## WEA-02: compare the actual baseline hour and model

New switch **`SIM_SERVED_TIME_MATCH=0` by default** is declared in the admin flag registry.
When enabled, the existing observation adapter uses marine and wind `served_valid_time` identities.
Both must name known timezone-aware equal instants. It queries the actual hour and provenance model
(GFS, ICON or EURO), rather than requested time and an implicit GFS. Unknown or mixed baseline
frames return explicit unavailable comparison evidence, with no observation fetch or invented delta.

A precomputed rating must name the same actual served hour and model before supplying tide or
quality parity. An echoed requested time cannot excuse a stale fallback. A live-computed rating can
use its named requested hour under its existing live response contract. Mismatched observations
withhold tide and quality; the independently carried height comparison can remain available when
the baseline itself is aligned. Tide and parity share the same cached query. The flag-off legacy
query/composition is preserved. No additional forecast/physics implementation was introduced.

Jacobian lens: moving only requested hour 12Z to 18Z while actual frame remains 09Z leaves quality
and height comparisons invariant and adds no fetch. Moving actual frame 09Z to 15Z moves the query
hour by the same amount for each model. Equivalent ISO timezone spellings match by instant; mixed
or unknown frames are refused. These are synthetic contract sensitivities, not forecast skill.

Open: full product/run identity and spot identity (including the existing rounded-coordinate cache
key and nearest-row fallback), period semantics, tide/MOP fidelity, finite rating/height contracts,
scientific skill, and flag promotion with served read-back. No served flag was enabled externally.

## Integration, CI and environment limits

Affected integration: **339 passed / 2 existing skips**. Full estate selector: **734 passed /
2866 existing skips**, zero failures/errors. Skips do not count as acceptance. The estate emitted
pre-existing background bridge-sync DNS and local webhook-refusal warnings; successful delivery was
not observed. It cannot be certified hermetic. New OAuth/weather instruments use synthetic provider
transports. No intentional live provider, database, payment or notification operation was performed.

Partition: 607 tracked test files, guards 180 / chain 146 / estate 278, two existing FastMCP exclusions
and one existing quarantine. New executed additions: 24 chain, 25 estate. Floors and provenance move
together to chain 146 files / 1870 passes (projected 1876), estate 733 (projected 735); margins stay
6/6/2. The projection extends successful hosted base run
[37048650086](https://github.com/dpritzker0905-cmd/Raw-Surf-Antigravity/actions/runs/37048650086)
at `e0f93466` with this branch's executed owned additions. Windows estate's one-pass difference
is not substituted for hosted calibration. Entire guards/chain lanes were not rerun this batch.
Hosted confirmation remains pending; exclusions and budgets were not widened.

Fatal Python lint, LOC ratchet and whitespace checks pass. Local runtime is Python 3.12 using the
existing dependency directory, lacks pygrib/uvloop and is not its own virtualenv. This evidence does
not certify CI or Render parity. No live load was imposed intentionally on the shared one-CPU box.
No push, PR, merge, deployment, migration application or serving-flag promotion occurred.

Canonical memory/brain rules were consulted. Trevec/Mind tools were unavailable; Git and canonical
tracked memory plus source/AST and behavioral tests supplied context. The Tree Ring hook is a no-op
without an installed worktree memory tree; no replacement memory infrastructure was introduced.
The start memory audit had 0 failures / 3 warnings / 12 notes; overdue commitments and the stale
secret pointer do not prove provider rotation. End/checkpoint receipts are appended to the session log.

## Sources and remaining program work

The account-bound one-use state design follows the OAuth CSRF/state guidance in
[RFC 9700](https://www.rfc-editor.org/rfc/rfc9700.html); this is not a full OAuth BCP compliance claim.
The backend-only state store follows [Supabase RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security).
Project Postgres best-practices references informed role protection and short claim transactions.

Broader APP-05/family permissions, money concurrency/precision, delivery and AI reliability, UI and
accessibility, shared-server capacity, weather observation/period/nearshore skill and external
acceptance remain open. The next independent evidence should target these explicit remaining
contracts, rather than count local passing tests as deployment or scientific success.

Rollback these product/test/CI paths locally to `88c9278e` before deployment, preserving the canonical
ledger append-only and recording the rollback. Turning the new dark switch off restores legacy
comparison behavior. If the schema has subsequently been applied, its rollback requires a separately
reviewed database action; deleting its nonce rows can interrupt outstanding linking flows.
