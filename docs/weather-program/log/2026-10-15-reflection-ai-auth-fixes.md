# Reflection AI/photo authorization fixes — 2026-10-15

Owner authorization: "Can you fix the bugs Reflection found, starting with the authentication and ownership checks?"
Publication authorization: "Can you open a PR with these fixes and make sure hosted CI passes before we deploy?"

Scope: AI/photo and review-report HTTP boundaries. No forecast, payment, runtime flag,
database migration, merge or deployment changes; no served weather number changes.

- Require verified login for photo analysis, suggestions, confirmation, photo lookup,
  viewed state, relationship-based matching, board scanning and review reporting.
- Bind photographer/reporter actors to the token. Photo lookup/viewed state derive
  identity from the token; legacy user_id does not grant authority. Relationship
  lookup permits the named photographer or surfer. Board lookup checks ownership.
- Remove fabricated image results/identity confidence and guessed board writes.
  Unimplemented image-analysis features explicitly return 503; tag/session/claim
  photo lookup remains available. A real vision-provider integration is outstanding.
- Add 34 offline HTTP/availability cases. CI selector places the tracked file in
  estate; floor1543 ->1577 and reference1545 ->1579 preserve margin2. These are
  projections until the new PR's hosted run confirms them.
- Local validation:82 passed across ownership, AI credential transport, sensitive
  route contracts and floor consistency; focused flake8 and git whitespace checks pass.
  Python3.12 local environment lacks declared pygrib and uvloop; local success is not
  a claim of CI/runtime parity. Before fixes, anonymous and impersonation requests
  failed the regressions; fabricated vision returned200 where the regression expects503.
- Reflection reviewed patch SHA256
  `918aa4e89ea6424836a33a48a70e9d6068fe0ca28afc6500026e30af90f5b7c6`
  and found no newly introduced actionable bugs. Remaining gaps:hosted CI/deployment,
  generic client unavailable-feature errors, and real-provider integration.
- Action ledger seq1211 records the local patch. PR publication and hosted receipt
  are recorded below when available. No merge/deploy is authorized by this request.
