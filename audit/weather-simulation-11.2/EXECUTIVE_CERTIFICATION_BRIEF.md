# EXECUTIVE CERTIFICATION BRIEF — Weather Simulation 11.2

**Verdict: ⛔ NOT CERTIFIED.** Commit `e015d90b`, branch `dev`, 2026-08-10.

## In one paragraph

The rendering half of this feature is good. The GPU resource lifecycle is idempotent and bounded,
animation has a single owner, transition ownership is generation-based and correct, and the unit
contract is exact — I tried to break all four and could not. What fails is the half that tells you
*what the number on screen is*. Under a total network failure the app displayed a wave field for a
layer it had never fetched, labelled it `LOADED`, `Provider: NOAA`,
`Class: AUTHORITATIVE NATIVE`, reported "No Causal Layer Violations Detected", and never
recovered. Separately, toggling one layer off and on — no other change — moved the value at a
fixed coordinate from 0.64 m / 6.8 s to 0.44 m / 3.1 s and back.

## The three findings that decide the verdict

1. **Silent failure, labelled authoritative.** All `/api/weather/*` requests rejected; clicked a
   new layer. HUD: `GFS / swell_1 · Raster Source: LOADED · Provider: NOAA · Class: AUTHORITATIVE
   NATIVE`. Internally: `productId: null`. No error, no retry, no recovery after the network
   returned.
2. **The guard cannot see its own blindness.** `__MARINE_SOURCE_PARITY__` returned `match: true`
   comparing a heatmap with `vectorCount: 0` against an infobox that was `idle` and had never
   sampled — while a sibling instrument reported `parity: false` and the live grid held 629
   vectors. The HUD's "no violations" claim rests on this.
3. **Product selection is non-deterministic and changes the forecast.** Same model, layer, valid
   time and coordinate; the answer depends on which grid the client happened to select.

**Root cause of #1 and the shape of the whole problem —** `TruthOverlay.js:418`:
```js
{isEstimated ? 'ESTIMATED FALLBACK' : 'AUTHORITATIVE NATIVE'}
```
One boolean decides whether the app claims authority. It has no way to say *coarse*,
*substituted*, *no data*, or *I don't know*.

## What I got wrong, and how it was caught

I initially found that GFS and ICON served only a 10° global grid and called it a coverage gap.
**That is false in production** — 19,995 products with a 10° / 2° / **0.25°** ladder across 16
regional tiles. My local backend was a partial ingest. A single read-only production GET refuted
it. **Consequence: every resolution and coverage number in this audit is local-only.** The
client-logic findings above are unaffected, because they are logic, not data.

## Gates

| Gate | 1 Data | 2 Projection | 3 State | 4 Animation | 5 Science | 6 Capacity | 7 Regression | 8 Modernization |
|---|---|---|---|---|---|---|---|---|
| | **FAIL** | *BLOCKED* | **FAIL** | ✅ **PASS** | **FAIL** | *BLOCKED* | **FAIL** | **FAIL** |

Gates 2 and 6 were **not tested**. They must not be recorded as passing anywhere.

## What is authorized

**Continue current stabilization only.** Mission T-1: make the truth layer incapable of reporting
confidence it has not earned — a multi-valued provenance class, a three-valued parity gate that
*refuses* when unsampled, and carry `resolution` (which the backend already sends and the client
throws away) into the client.

Then T-2 (deterministic product selection) and T-3 (failure disclosure + bounded retry).

## What is prohibited

WebGPU, OffscreenCanvas/worker rendering, data-pipeline modernization, nearshore models, neural
emulators, learned downscaling, bias correction, and removal of any legacy path — including the
declared `window.__MARINE_TRANSITIONING__` mirror. Also: no performance work on the ~27 s cold
start until product selection is deterministic, because that logic may be load-bearing.

## What would prove this verdict wrong

Reproduce the failure injection against the **production** backend with a valid session. If
production surfaces an error and retries where local did not, the decisive finding collapses and
the gates should be re-run.

## Scope honesty

This audit ran ~1 hour against a local backend in one browser. It did **not** test projection,
capacity, cross-browser, synthetic fields, timeline scrubbing, 10 of 12 layers, or route-level
remount, and captured no recordings or profiler traces. See `UNCERTAINTY_AND_EVIDENCE_GAPS.md`
(G-01…G-15). **No production code was modified.**
