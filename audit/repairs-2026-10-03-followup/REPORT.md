# Audit repairs: messaging and simulation inputs

Recorded 2026-10-03. Local branch `codex/audit-repairs`, starting commit `0d516a90`.
This continues the first repair batch; its report and log remain unchanged.

**Result:** fourteen messaging routes now enforce verified actor/admin authority. Strict
weather input validation and cache separation are built behind `SIM_STRICT_INPUTS=0` by default.
No deployment, push, PR, provider mutation, real payment, notification or served flag flip occurred.
The full audit is still open. These are local implementation results, not production closure.

| Repair | Before, two runs | After, two runs | Scope |
| --- | --- | --- | --- |
| APP-05 messaging actor/audience boundary | 47 failed / 25 passed each, 72 cases | 72 passed each | Six conversation actions, six private sibling reads, conversation start and admin cleanup |
| WEA-05 required/finite input boundary | 41 failed / 18 passed each, 59 cases | Final expanded suite: 62 new passed each; 88 passed / 2 existing skips with companions | Five baseline fields, missing vs measured zero, finite/domain validity, malformed point payloads |
| Strict/legacy cache isolation discovered during validation | 3 failed / 59 passed each, 62 cases | Same final 62 new cases passed twice | Both flag transitions and zero-I/O cache peek; default-off lane retains legacy key |

There are **134 distinct new regression cases**, not 268 independent observations. The weather
suite gained three cache controls after its initial 59-case baseline; its original baseline
and separate cache baseline are both retained. Sanitized case names, outcomes and raw XML hashes
are in [results.json](results.json). Raw XML and one-off scripts stay local and gitignored.

## Messaging root cause and repair

A verified JWT protected the main read/send path but sibling handlers trusted a path/query ID.
The six state actions already checked membership of that supplied ID; that checked the wrong actor.
An anonymous caller, or an unrelated verified caller claiming `owner`, therefore returned HTTP 200.
The offline baseline persisted synthetic state changes in a real SQLite database.

The fourteen routes now call the existing strict JWT dependency. Path/query actors must match its
subject before private queries or effects. Accept, decline, hide, pin, mute and unread actions can
omit the legacy query ID and derive the actor from the JWT, supporting the frontend accept calls.
Existing membership checks remain. Cleanup additionally loads the caller's persisted admin flag
before maintenance SQL and logs the actor and aggregate result after a successful commit.

Tests mount the complete production route modules, use signed JWTs without overriding authentication,
and use real ORM rows for profiles, family links, messages and conversations. They cover anonymous,
unrelated forged-actor, unrelated nonparticipant, both legitimate participants, a linked child's
Grom directory and a parent's family preview. Cleanup alone uses an execution spy, because its
Postgres-specific aggregate cannot run in SQLite; it verifies ordering and no unauthorized commit.
The cleanup merge algorithm and Postgres execution are not certified by that spy.

The authority perturbation is discrete, so no numerical derivative is claimed. Changing only the
caller must turn unauthorized effects into rejection. Legitimate participant actions must change
only that participant's column: every peer column and other persisted field is an exact null control.

## Weather root cause and repair

`fetch_live_forecast` used `float(value or 0)` for period/direction and unchecked conversion for
height/wind. Missing period could become zero, missing direction could become north, and NaN/Infinity,
booleans or malformed point values could survive or raise. The dark strict lane validates all five
fields at the existing HTTP boundary and returns a missing baseline with an explanatory reason.

Finite measured zeros remain valid for height, wind speed and direction. A zero period is valid
with zero swell height; nonzero swell requires a positive period. Directions accept 0 through 360.
Negative physical values and booleans are refused; numeric strings remain compatible. The repair
adds no new forecast, physics, normalization or provider interpretation path. It does not resolve
peak/energy/mean period semantics, served-hour alignment, optional tide or MOP composition.

For each valid field, a +0.25 perturbation moves only the corresponding baseline component by
+0.25: the measured local input-mapping Jacobian is the identity, with exact off-diagonal null controls.
This is a boundary mapping test, not a forecast-skill measurement. Complete valid payloads produce
identical baseline and provenance with the flag on/off. Missing inputs are refused instead of guessed.

The initial strict implementation shared its cache with the legacy lane. Three tests reproduced
cross-lane contamination twice before correction. Strict fetch and peek now use a separate cache
key; disabled behavior retains the original key and mapping. The boolean flag is declared in the
admin registry and read at call time. It was not enabled in any external process.

## Wider verification and limits

- Final affected integration: **239 passed, 2 skipped**, including private media, existing authorization,
  partition composition, forecast cache/provenance, flag registry and CI floor controls.
- CI-owned simulation consumer suites: **255 passed, 2 skipped**. Existing FastMCP exclusions unchanged.
- Full estate lane: **709 passed, 2866 skipped**, zero failures. Its hosted projection is 710;
  the existing Windows-vs-hosted difference remains one pass. Skips are not successes.
- Fatal Python lint, LOC ratchet and diff whitespace checks passed. No exclusion or skip was added.
- Selector ownership: messaging +72 estate cases; sim inputs +62 chain cases, one file each.
  Floors and `_FLOOR_SET_FROM` moved together: chain 145 files / 1846 passes (projection 1852,
  margin 6); estate floor 708 (projection 710, margin 2). Guards unchanged. Projections come from
  pinned hosted base run 37048650086 plus both batches' executed additions, not local pass counts.
- Entire guards and chain lanes were not rerun in this batch; prior batch readings are historical.
  Hosted CI, staging UI and live Postgres evidence remain pending. No live load was imposed on the
  shared one-CPU server. Python 3.12 local environment lacks pygrib and uvloop and is not its own
  virtualenv; local evidence does not certify Render/CI dependency parity.
- Canonical memory audit started with 0 failures / 3 warnings / 12 notes: two overdue commitments,
  plus the secrets pointer becoming stale at eight days. No provider rotation claim relies on it.
  Trevec/Mind tools were unavailable; Git, local canonical memory, AST/source structure and mounted
  behavioral tests supplied context. No alternate memory system was installed.

Authorization design follows the request/object checks in the
[OWASP Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html).

## Remaining audit work

APP-05 remains partial: broader messaging/family permission policy, blocked-user behavior, profile
onboarding and sibling routes require their own matrices. Strava state/nonce/ownership and provider
rotation remain open. Payment concurrency/precision and legacy reconciliation remain open.
Weather served-hour consumers, tide/MOP fidelity, period semantics and forecast skill/consensus
promotion remain open. Delivery, shared-server capacity, UI/accessibility and deployment read-back
remain open. The next priority is completing Strava authority and served-hour comparison contracts.

Rollback product changes locally from `0d516a90` using the exact changed product paths. Keep the
canonical ledger append-only and record any rollback as a new action. Dark switch off restores the
legacy simulation input lane. Production readiness and the overall audit are not declared complete.
