# AUTHORIZED NEXT-PHASE PACKET — 11.2

**Authorized phase:** *Continue current stabilization.* Nothing else.
**Do not implement from this packet without owner sign-off on scope.**

## Gates passed / remaining

Passed: **Gate 4** (Animation & Lifecycle).
Failed: **1, 3, 5, 7, 8.** Blocked (untested): **2, 6.**

## MISSION T-1 — Make the truth layer unable to report unearned confidence

**Root causes addressed:** RC-01, RC-02, RC-05.

**Files and symbols**
- `frontend/src/components/map/TruthOverlay.js:418` — the `Class` ternary.
- `__MARINE_SOURCE_PARITY__` producer (search `mismatchReasons`).
- `__MARINE_PROJECTION_DIAG__` assembly — where `resolution` is dropped.

**Scope**
1. Replace the two-valued `Class` with a computed classification over
   `(isEstimated, productId != null, resolution, upstream_model vs active model)`. It must be able
   to say **COARSE**, **SUBSTITUTED**, **NO DATA** and **UNKNOWN** — not only
   `AUTHORITATIVE NATIVE` / `ESTIMATED FALLBACK`.
2. Make the parity gate **three-valued**: `MATCH` / `MISMATCH` / **`UNSAMPLED`**. `UNSAMPLED` must
   never render as a pass, and must suppress "No Causal Layer Violations Detected".
3. Carry `resolution` (and ideally `truthTag.dataHash`) from the grid response into the client
   diagnostic and surface grid coarseness in the legend.

**Explicit non-goals:** no change to any forecast formula; no change to product selection in this
mission; no renderer or shader work; no new dependency.

**Required test before editing** (must fail first):
- A test asserting `Class !== 'AUTHORITATIVE NATIVE'` when `productId === null`.
- A test asserting parity returns `UNSAMPLED`, not `match: true`, when
  `heatmap.vectorCount === 0` and `infobox.status === 'idle'`.

**Required test after editing:** the failure-injection journey below, automated.

**Completion criteria:** with all `/api/weather/*` requests rejected, activating a new layer must
not display `LOADED` + `AUTHORITATIVE NATIVE`, and the HUD must not claim zero violations.

## MISSION T-2 — Deterministic, disclosed product selection

**Root cause:** RC-03. **Blocked by T-1** (T-1 provides the disclosure surface).

Make product/tier selection a pure function of `(viewport, zoom, model, layer, hour)` — never of
interaction history. Toggling a layer off and on must return the **same** product id.
**Completion criterion:** the layer-cycle battery returns an identical `productId` and identical
sampled value on every ON step.

## MISSION T-3 — Failure disclosure and bounded retry

**Root cause:** RC-04. Detect request failure, surface it, retry with bounded backoff, and recover
without user action when the network returns.

## Reproduction harness (reuse verbatim)

**Failure injection**
```js
const rf = window.fetch;
window.fetch = (i, n) => /\/api\/weather\//.test(String(typeof i==='string'?i:i?.url||''))
  ? Promise.reject(new TypeError('AUDIT-INJECTED failure')) : rf.call(window, i, n);
// then click a NEW layer, wait 14s, read the HUD
```

**Layer round-trip determinism**
```js
// click Waves OFF, wait 7s; click Waves ON, wait 16s; record
// __MARINE_PROJECTION_DIAG__.productId + nearest-neighbour value at a fixed coordinate. Repeat x3.
```

**Resource census** — see `evidence/` harness; assert `progNet` constant and `bufNet` returning to
baseline on every OFF.

## Rollback plan

All three missions are additive to a diagnostic surface plus one selection function. Each should
land behind a flag defaulting to **current behaviour**, flipped only after its own test is green.

## Stop conditions

Stop and re-audit if: T-2 changes any *served* forecast value (it must not — it changes *which
product answers*, which must then be made deterministic, not different); or if the three-valued
parity gate turns out to fire `UNSAMPLED` in normal steady-state operation, which would mean the
sampling model itself is wrong.

## Evidence required before the next audit

1. The failure-injection journey, automated and green.
2. A layer-cycle determinism test, automated and green.
3. A production-backend re-run of the failure injection (RC-04's falsification test).
4. Whatever is needed to unblock **Gate 2** (projection: antimeridian, high latitude, DPR,
   bearing/pitch, OceanMask) and **Gate 6** (capacity) — both are currently untested, not passed.
