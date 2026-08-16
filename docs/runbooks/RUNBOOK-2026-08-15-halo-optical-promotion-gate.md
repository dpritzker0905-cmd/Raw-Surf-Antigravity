# Runbook — the halo optical promotion gate (authenticated deploy-preview smoke)

**Status 2026-08-15: DESIGN + COMMANDS. Not yet executable end-to-end — the blocker is authentication
(zoomlab seeds no session; `/map` is auth-gated on `main--rawsurf.netlify.app`, `dev--rawsurf.netlify.app`,
and production). The estate's only optical net has never rendered the artifact that ships (A3.1-01).**

## What the gate must prove (fail-closed on every miss)

A deploy candidate may be published only when ALL of these hold, on the EXACT candidate:

1. **Artifact identity:** `curl -s <alias>/service-worker.js | grep BUILD_VERSION` names the SHA under test;
   the trace and every screenshot embed it. A mismatch = FAIL (you graded a different build).
2. **Lifecycle readiness, not a sleep:** wait for `window.map && window.__MARINE_ENGINE__`, then for a
   settle predicate — `map.isStyleLoaded()` alone is a PROVEN-BROKEN signal here (false for 36 s with every
   asset 200; the map needs 60+ s). Require: N consecutive `render` events with stable zoom/bounds AND
   `__RAW_GPU__.overlayMask` present AND wave-texture resident (`__MARINE_ENGINE__._waveData` non-null).
3. **Deterministic cameras:** the historical ladder — the reported coast at z 6.74, 7.2, 7.6, 8.03 plus one
   island-dense case (Bahamas) and one antimeridian case (Fiji) — each with a settled capture.
4. **Layer isolation at each camera:** composite; wash-only (particles off); particles-only; style
   `MASK_BUFFER` hidden vs visible with GPU layers unchanged. A "halo" verdict must name which surface bled.
5. **Joined frame trace:** zoomlab's per-frame record now carries `ovl` (overlay reason), `mDel`
   (delivered-coverage verdict) and `gate` (`[gateValue, clipValue, terminal]`) — every screenshot must be
   joinable to the coverage/terminal state that produced it.
6. **Graded comparison:** pixel-diff against the reviewed baseline captures with bounded thresholds on the
   coastal band; a new false coastal band ≥ threshold = FAIL.
7. **Fail closed:** missing auth, missing telemetry fields (older bundle without `heatmapGate`), missing
   video, or unmatchable SHA ⇒ the gate FAILS. It never "passes by absence".

## The auth blocker and its two candidate resolutions (owner decision)

- **A. Storage-state seeding:** an owner-provisioned TEST account; run Playwright once interactively to
  produce `storageState.json`; zoomlab gains `ZL_STORAGE_STATE=<path>` and passes it to
  `browser.newContext({ storageState })`. Secrets stay out of git (CI secret / local file).
- **B. Preview-only bypass:** a Netlify deploy-preview env flag that mock-authenticates `/map` on branch
  aliases ONLY (never production). Lower friction, but it grades a code path production doesn't run —
  option A is the honest gate.

## Commands (once auth exists)

```bash
# 1. Identity
curl -s https://dev--rawsurf.netlify.app/service-worker.js | grep BUILD_VERSION

# 2. Ladder + isolation captures against the DEPLOYED alias (not a local rebuild)
ZL_BASE=https://dev--rawsurf.netlify.app ZL_STORAGE_STATE=.secrets/zl-auth.json \
  node scripts/zoomlab.js staircase_full out/deploy-smoke/composite

# 3. A/B legs (each records .webm + trace):
#    clip off:   ZL_FLAGS=__RAW_DISABLE_MASK_SHORT_CLIP__
#    gate off:   ZL_FLAGS=__RAW_DISABLE_HEATMAP_BOUNDS_GATE__   (expected NULL — the gate is pixel-inert,
#                see AUDIT-3.1-INDEPENDENT-LANE-2026-08-15.md; a NON-null diff here is itself a finding)

# 4. Verdict: join traces, diff coastal-band pixels vs baseline, require SHA match in every artifact.
```

## Local stand-in until then

The runtime shader harness grades the SHADER layer of any checkout deterministically without the app:

```bash
node scripts/shaderlab-gate.js out/shaderlab
```

It is necessary but NOT sufficient for promotion (it cannot see engine wiring regressions, lifecycle, or
style layers) — treat it as the fast pre-gate, never the release gate.
