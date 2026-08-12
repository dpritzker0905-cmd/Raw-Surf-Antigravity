# RV-04 — Independent re-verification of Audit 11.4's Gate C (Test Integrity)

| Field | Value |
|---|---|
| Evidence ID | RV-04 |
| Timestamp (UTC) | 2026-08-12T19:5xZ (see command log) |
| Branch / commit | `dev` / `3ec3fd13` (HEAD) |
| Historical commit under review | `fb601060` (Audit 11.4 publication), repair `e6033e2b`, harness fix `ecfc1077` |
| Canonical task | WS-CAN-0031 (verdict-cache guardrail) |
| Environment | isolated `git worktree --detach` at HEAD, node_modules junctioned from the primary tree; Node v24.14.1, craco/jest, jsdom, Windows 11 |
| Tool | jest via `npx craco test --testPathPattern=marineMaskShelter` |
| Production source modified | **NONE in the primary working tree.** Mutations were applied only inside the temporary worktree, which was then removed. |

## Action

Audit 11.4 records **Gate C = FAIL**, note: *"6 of 10 mutants survive 32/32 green. A cache
returning a fully INVERTED mask on every hit is caught by zero tests."* Its
`AUTHORIZED_NEXT_GATE_PACKET.md` authorizes exactly one next mission: repair the harness so that
M2/M8/M9/M10 fail.

I re-applied two of the four content mutations directly against HEAD.

## Expected result (per Audit 11.4)

Mutant survives; suite stays green.

## Actual result

| Mutant | Mutation applied at `marineMaskShelter.js` hit path | Suite result |
|---|---|---|
| M9 | `sheltered = _hit.sheltered.slice().fill(1)` (hit returns ALL-ONE mask) | **CAUGHT** — 2 failed / 52 passed of 54 |
| M8 | `sheltered = _hit.sheltered.slice().fill(0)` (hit returns ALL-ZERO mask) | **CAUGHT** — 2 failed / 52 passed of 54 |

Unmutated control at HEAD: **54 passed / 54 total**, 2 suites.

Failing assertions in both arms include
`marineMaskShelter.wrapper.test.js:399` — *"the cached mask is POST-close — a hit must not skip the
close and leak a raw mask"* — and the star-marked byte-identity assertion.

## Verification status

**Audit 11.4's Gate C is REFUTED at HEAD.** The guardrail holds.

The cause is a publication-ordering defect, not an analytical error: the harness fix landed at
`ecfc1077` (2026-08-12 12:43), and the audit's own
`evidence/mutated-repair/MUTATION_RESULTS_FINAL_10of10.json` — committed inside the audit's own
publication commit `fb601060` (13:05) — already records all ten mutants CAUGHT. The report body,
the Gate C row of `RELEASE_GATE_MATRIX.csv`, the Executive Gate Decision and the
`AUTHORIZED_NEXT_GATE_PACKET.md` were not updated to match evidence shipped in the same commit.

Consequence for the program: **the most recent audit's single authorized next mission was already
complete before the audit was published**, and its headline verdict
("NEXT ENGINEERING GATE NOT AUTHORIZED") rests on Gate C → Gate I, the first of which its own
evidence refutes.

Residual, genuinely open (not refuted): Stage 3 of that packet — an explicit **non-vacuity guard**
asserting the compared mask contains both sheltered and open pixels — is still absent from the
byte-identity assertion itself. Non-vacuity is currently implied only by a sibling test
(`different inputs do NOT collide`, which asserts `narrow.shelteredFrac > 0` on the same fixture),
not by the assertion that would degrade.
