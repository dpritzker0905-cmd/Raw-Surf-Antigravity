# SEC08 alert delivery source repair

Both real emitters ignored `last_triggered`. Successive ticks produced two in-app
records and incremented twice. With overlapping workers, two records could be saved
while the ORM counter increased only once. Scheduled push was attempted before commit.

The manual and scheduled paths now share a conditional `UPDATE … RETURNING` claim.
The database checks active status, owner/spot identity, unchanged height bounds and
the persisted cooldown before incrementing the counter. Claim and notification commit
together; rollback restores eligibility. Forecast fetching happens before write claims.
Scheduled push starts after the notification commit and retains 410 subscription cleanup.

The default cadence is one hour. `SURF_ALERT_COOLDOWN_SECONDS` accepts 900–86400 seconds;
invalid overrides retain the default. The alert list displays the server cadence.
Zero height and a zero maximum remain valid; absent, nonfinite, negative, boolean or
explicit `no_data` height does not emit. Invalid/reversed stored bounds refuse emission.
The shared quality sentence remains unchanged, including explicit unavailable quality.

## Measured qualification

- Before changes: the same 23 actual-emitter/SQLite controls returned **16 failed,
  7 passed twice**. Raw JUnit receipts are ignored locally under `visual/`.
- After changes: **69 new controls**, including concurrent independent sessions,
  repeat/manual/scheduled combinations, UTC boundary/future stamps, rollback/null
  counters, paused/moved/reconfigured stale workers, push refusal/failure and API cadence.
- Initial delivery plus existing quality controls: **63 passed**. Final actor/config
  extension plus adjacent route/CI controls: **182 passed**, no skips. Earlier subsets93/161/167passed.
- Manual actor5failed before twice; configuration19selected13failed/6passed before twice.
  Current combined HTTP owner/positive controls25pass. Create/list/edit/delete/share/check
  bind JWT identity; own CRUD and intentional fixture-recipient sharing remain supported.
- Node24.21.0 production compilation, existing ESLint ratchet (86errors/917warnings),
  changed-file fatal Python lint and LOC guards accepted. Full frontend356suites/3689tests
  pass. Cooldown sourcef995dae4 CI37252419546 passed all11jobs: backend5427
  (2360guards/2049chain/1018estate), frontend356/3689. Estate290selected/288produced,
  no silent files; existing66skip/1xfail retained. Final owner source6c355cb2 is published;
  its CI37253656301 is running. Final hosted qualification remains pending.
- Exact tracked ownership:629backend test files,185guards/151chain/290estate,
  two existing fastmcp exclusions and one existing quarantine. New69controls belong
  to estate; projected1039passed, floor1037/reference1039. Projected backend total5448.

The discrete ownership sensitivity is one extra notification per repeat attempt before,
and zero extra within the cooldown after. This is an event-count causal control, not a
forecast-skill claim. The SQL primitive follows [SQLAlchemy update/returning guidance](https://docs.sqlalchemy.org/en/20/tutorial/data_update.html);
PostgreSQL's [Read Committed update predicate recheck](https://www.postgresql.org/docs/current/transaction-iso.html)
supports the intended competing-writer ownership. Actual PostgreSQL execution remains unqualified.

## Remaining acceptance and scope

SEC08 remains partial. Stored shape/crowd/tide/local-time preferences require an explicit
supported producer/time-zone contract; this change does not invent those classifications.
The manual check and alert configuration routes now bind JWT/owner identity. Broader
photographer-request and other media/social routes retain their separate open scopes.
External push is best effort, without a durable outbox or exactly-once delivery guarantee:
a crash after commit can lose the push while retaining the in-app notification/cooldown.
Quiet-hours/digest/email behavior and real push delivery remain unqualified.

Local controls used an offline, network-blocked runner and an ephemeral SQLite database.
The available Windows interpreter lacks two declared packages and is not the declared
virtualenv; hosted Linux CI remains the runtime qualification authority. No real users,
provider data/schema, production configuration, weather/science flags, merge or deployment
were changed. Dev cloud publication remains pending separately.

### 2026-10-05 02:50Z: final owner source hosted receipt

CI37253656301 source6c355cb2 completed: all11jobs success; actual5448backend
=2360guards+2049chain+1039estate,356suites/3689frontend; estate290selected/
288produced/0silent; existing66skip/1xfail. This supersedes final-source pending
notes. Deep-audit new source changes require their own qualification.
