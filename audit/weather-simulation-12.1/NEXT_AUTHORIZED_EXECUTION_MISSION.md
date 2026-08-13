# NEXT AUTHORIZED EXECUTION MISSION — Audit 12.1

## Mission

**Close WS-OBJ-101 — every activated layer paints.**
Fix the `om://` protocol's model-lock rejection that blanks **every** weather raster layer at the
map's two farthest-out zooms, and pin it with a regression guard.

| | |
|---|---|
| **Primary objective** | WS-OBJ-101 |
| **Supporting objectives** | WS-OBJ-001 (reliable visualization), WS-OBJ-502 (regression protection) |
| **Canonical tasks** | **WS-CAN-0061** (the fix). WS-CAN-0060 already shipped the sibling half |
| **Baseline commit** | `9febd970ef5d39585ad2b7b8ae5a3a7e038b8df2` on `dev` |
| **Gate unlocked** | Gate 3 |
| **Estimated size** | Small — one comparison, one guard |

## Problem statement

Every `om://` raster layer renders blank at z2–z3 (`minZoom` is 2 on dev live). The owner reported it
as *"fog isn't activating at the two farthest out zooms."* **It is not fog-specific** — water
temperature blanks there too, and the same path serves every weather raster.

## Evidence

Controlled measurement — same layer, settled view, cache cleared, one zoom notch apart:

| zoom | callback entered (`traceOmUrl`) | reached `TILE_TRUTH.protocolCalls` | decoded |
|---|---|---|---|
| 2.99 | 45 | **20** | yes |
| **2.00** | **24** | **0** | **0** |

The protocol callback **is entered** and **exits early, before decoding**. Probes shipped at
`ba7f1c18` on the three early returns; the owner ran them and reported **`blocked: model_lock`** —
`isModelMatch(requestedModelFolder, activeModelLock)` returns false at the floor, so every tile
receives a transparent fallback.

## Why this is the current critical-path mission

1. It fails **Finish Line A** (reliable production baseline), which must hold before any Finish
   Line B work. A16/A7 in the SOTA contract.
2. It is **user-visible and owner-reported**, not an internal quality metric.
3. It is **one measurement from resolution**, and the instrument is already deployed to the surface
   where the defect lives.
4. It **closes an objective outright** — WS-CAN-0060 already shipped the other half of WS-OBJ-101
   with a mutation-proven class guard.
5. It is the only remaining CLOSE NOW item that is neither a config key nor an owner decision.

## Existing implementation and current authority

| | |
|---|---|
| **Files** | `frontend/src/components/map/openMeteoProtocol.js` (`isModelMatch`, the three early returns), `omUrlTrace.js` (`traceOmUrl`, `traceOmBlock`) |
| **Instrument** | `window.__OM_URL_TRACE__` — deployed. `blockedDetail` is recorded as `requestedFolder|activeLock` |
| **Authority** | `om://` protocol handler — currently a **New Bypass** in the convergence map |

⚠️ `openMeteoProtocol.js` is **grandfathered shrink-only at 943 LOC** and is currently exactly 943.
Any addition must pay for itself.

## Ordered implementation steps

**Step 0 — read the value. Do not skip to a fix.**
```js
window.__OM_URL_TRACE__.blockedDetail   // "requestedFolder|activeLock"
```
Read `isModelMatch` at the top of `openMeteoProtocol.js` **first**. It returns `true` for: an empty
folder · a folder in `window.__OM_ACTIVE_MODELS__` · an empty lock · **any folder containing `gfs`**.
So a GFS layer blocking means the left side is a **non-empty, non-GFS string** — which is already
surprising and is the whole content of the finding.

**Step 1 — classify against the decision table:**

| `blockedDetail` shows | Reading | Fix |
|---|---|---|
| a UI model name on the right (`EURO`/`GFS`) vs a CDN folder on the left | two namespaces compared | normalise before comparing |
| the left side is not a model folder at all | `pathname.split('/')[2]` breaks for the floor's URL shape | **fix the parse, not the lock** |
| the left side is empty | contradicts the matcher — **re-read it, do not patch** | — |

⛔ **If the value matches none of these three rows: STOP and report.** Nine hypotheses died on these
layers in one session; every one died to a measurement that was available before it was guessed.

**Step 2 — apply the minimal fix** to whichever side of the comparison is wrong.

**Step 3 — write the regression guard before declaring success.** It must fail if the fix is
reverted. Model it on `layerColorScaleCoverage.test.js`, which is mutation-proven.
⚠️ **Verify the new test's FAILURE against the pre-fix behaviour**, not only its pass — a guard
written in this same area nearly reddened CI on a working layer.

**Step 4 — verify at both zooms, settled.** Assert the map is settled before reading
(`isStyleLoaded()`, stable zoom/bounds); hold the view, clear the trace, toggle the layer, then read
**once**. Four wrong readings in one session came from reading something in flight.

**Step 5 — confirm on a second layer.** Fog *and* water temp, so the fix is proven at the class
level rather than for one layer.

## Acceptance criteria

- At z2.00, `traceOmUrl` entries reach `TILE_TRUTH.protocolCalls` and decode — matching the z2.99
  control (45 entered → 20 reached → decoded).
- Tiles paint at z2 and z3 for **at least two different** `om://` layers.
- The regression guard fails when the fix is reverted.
- `openMeteoProtocol.js` ≤ 943 LOC; LOC ratchet clean; eslint at its 71-error baseline (0 added).
- CI green **and** the E2E lane still reports `Running 52 tests` (do not let this mission reduce the
  collected count).

## Explicitly forbidden scope

- Do **not** change any forecast quantity, constant, or `science_registry.py` value.
- Do **not** refactor `openMeteoProtocol.js` or the model-lock feature.
- Do **not** flip any flag (`SURF_PARTITIONS`, `SURF_TIDE_DEPTH`, `__RAW_MARINE_ARBITER__`, the
  settle debounce).
- Do **not** touch `conditions.py`, the accuracy monitor, or the resolution/`run_time` work — those
  are NEXT, deliberately.
- Do **not** `workflow_dispatch` the E2E lane to verify: `github.ref` is `refs/heads/dev` for both
  push and dispatch, so a dispatch shares the concurrency group and **cancels the push-triggered run
  it was meant to replace**.
- Do **not** `--no-verify` the pre-push floor hook.

## Rollback

Revert the single comparison change. Blast radius is the `om://` protocol's model-lock branch only;
no forecast value, no backend, no flag.

## Completion criteria and required closure evidence

A closure certificate for **WS-OBJ-101** requires, per §15 of the governing standard:
the trace evidence at both zooms · the failing-then-passing guard · a second layer confirmed · CI
green with an unreduced test count · and the rollback stated. **A commit message is not evidence.**

## After this mission

**`WS-CAN-0027` immediately** — `video: 'retain-on-failure'` plus the 1.60 → 1.62 bump. Its blocker
cleared today, it is ~15 minutes, and it is the task five consecutive audits have named and none has
done.
