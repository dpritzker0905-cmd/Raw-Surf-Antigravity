# RAW SURF — CODEX GPT-6 ASTRA
# EVIDENCE-BASED WEATHER STABILIZATION AND ADVANCEMENT

You are implementing fixes to Raw Surf's weather/forecast system, based on a forensic audit performed
2026-09-20. You cannot see that audit session. Everything you need is below or in the linked report.

---

## A. VERIFIED STARTING POINT

**Repository:** `dpritzker0905-cmd/Raw-Surf-Antigravity` · **branch `dev`** (this is the working branch;
`main` drives the frozen Netlify production shell).

**Baseline SHA at audit time:** `607af934e74fa87f3b8e58698ef68fdce919ea54`

**Environments, as measured 2026-09-20 19:26Z:**

| surface | identity | how to re-verify |
|---|---|---|
| Backend | `https://raw-surf-antigravity.onrender.com` · version `2.0.0-stage-6f-v1-607af934…` | `curl -s <backend>/api/health` — the SHA is embedded in `version` |
| Live weather app | `https://dev--rawsurf.netlify.app` · `BUILD_VERSION 607af934` | `curl -s <url>/service-worker.js \| grep BUILD_VERSION` |
| Production shell | `https://rawsurf.netlify.app` · `BUILD_VERSION 3bd38a83` | same — **frozen, owner-gated, do not try to ship to it** |

At audit time backend, live app and local HEAD were all the **same SHA**. Verify this still holds before
you touch anything; if it does not, see §B.

**Uncommitted work to preserve — do NOT stage, commit or revert:**
- `backend/uploads/forecast_cache/marine_global.json` (modified)
- `backend/uploads/forecast_cache/wind_global.json` (modified)
- `frontend/scripts/gr-live/` (untracked)

A **concurrent session may share this working tree**. Always commit with explicit paths
(`git commit -o <paths>`), never `git commit -a`.

**Audit report:** `audit/weather-simulation-14.0/FINDINGS.md`
**Reproduction scripts:** `audit/weather-simulation-14.0/evidence/*.py` (plain Python 3, no auth, read-only)

**Binding project constraints (from `CLAUDE.md` — read it in full before editing):**
1. **ONE FORECAST COMPOSITION.** Every surface showing surf height or quality must go through
   `surf_point.resolve_surf_geometry` + `estimate_surf_at` (nearshore *breaking* height), then
   `surf_rating.compute_surf_rating` (0–100). `spot_ratings.rate_one_spot` is the reference. **Never
   publish marine `point.speed` as surf height** — that is offshore significant wave height.
   **Do not add a second forecast path for one screen.**
2. **THREE THEMES, ALL DEVICES.** Light, dark and beach, desktop and mobile. Use `useTheme()`. Components
   with separate desktop/mobile layouts need every layout updated.
3. **ACCESSIBILITY.** Real `<button>`/`<input>`, `aria-label` on icon-only controls, `role` + keyboard on
   custom widgets (`ForecastWheel.js` is the house pattern), never colour alone. New/touched code must not
   add to the existing debt.
4. Constants live in `science_registry.py`, never as bare literals.

**Known baseline conditions that are NOT your bugs:**
- Animation/frame-rate could not be measured in the audit harness (RAF starved). See §E.
- `dev--rawsurf` is behind a private-beta access-code gate; `localhost`/`127.0.0.1` bypasses it by design.
- The wider `jsx-a11y` lint debt in `Auth.js`, `SpotConditions.js`, `SpotHub.js`, `ExploreTrending.js`
  predates this work.

---

## B. REQUIRED INDEPENDENT REVALIDATION (do this first, before any edit)

1. Record current `git rev-parse HEAD` and current deployed identity for backend and `dev--rawsurf`
   using the commands in the table above. Write them into your final report.
2. If HEAD has moved past `607af934`, run `git log --oneline 607af934..HEAD -- backend/routes/weather.py
   backend/services/weather_pipeline frontend/src/components/map` and state which findings that touches.
3. **Reproduce each defect you are about to fix, before you fix it.** Every work packet below names its
   reproduction. If a defect does not reproduce, **stop that packet**, record the evidence that it no
   longer reproduces, and move to the next — do not "fix" it anyway.
4. Do not accept the audit's conclusions as given, and do not re-run the whole audit either. Revalidate
   the scope you are about to change.

**Two traps that will waste your time if you skip them:**
- **Front the browser tab.** In a hidden/background pane `requestAnimationFrame` yields zero frames,
  every timed promise hangs, and every diagnostic read is meaningless.
- **Settle ≥7 s after any `map.jumpTo()`.** An unsettled read reports a transient 2° global load-state.
  The audit nearly published WP-2 backwards from exactly this.

---

## C. PRIORITIZED IMPLEMENTATION STAGES

Order is dependency-driven: trustworthy time/state first, then resolution delivery, then transfer cost,
then contract truth. **Do not start a later packet if an earlier one is unresolved and they touch the
same state owner** (WP-1 and WP-4 both touch the timeline).

---

### WP-1 — Fix the timeline/field desynchronisation  ·  Finding F-01  ·  P1

**User-visible objective:** the forecast time shown on the wheel always matches the weather on the map,
and "Jump to now" always returns to the current frame.

**Reproduce first (D-1).** Using **real pointer and keyboard input only** — no `map.jumpTo()`, no
synthetic `KeyboardEvent`:
1. Open `/map` on localhost, enable **Waves**.
2. Scrub the wheel forward ~18 h by dragging and/or arrow keys.
3. Pan and zoom the map with the mouse.
4. Click **Jump to now**.
5. Read `window.__FORECAST_TIMELINE_COVERAGE_DIAG__.selectedValidTime` and compare with the wheel's
   `aria-valuenow` / `aria-valuetext`.

Expected-if-defective: handle reads `0`/"Now" while `selectedValidTime` stays at the future frame, and no
subsequent control (ArrowRight, `Home`, Jump-to-now) moves it.

**If it does not reproduce with real input,** the audit's entry path was programmatic. Convert this
packet into a **diagnostic task**: add an invariant assertion (below) plus a regression test that drives
the programmatic path, report that the user-facing path is clean, and stop.

**Implicated area:** the forecast-clock state owner behind `ForecastWheel` and
`__FORECAST_TIMELINE_COVERAGE_DIAG__` (`requestedValidTime` / `selectedValidTime` are written near the
marine fetch layer — `frontend/src/components/map/useMarineDataFetcherCore.js`,
`marineControllerCache.js`, `backendCopernicusServiceClient.js`). Locate the single owner of the hour
offset; **do not create a second one.**

**Scope boundary:** one state owner, the wheel, and the reset control. No renderer changes, no backend
changes, no new caching layer.

**Minimal correction:** make the wheel's displayed value and the value that builds `requestedValidTime`
read from **one** source of truth, and make the reset control write that source rather than the wheel's
local visual state.

**Tests to add:**
- A deterministic unit/integration test: set offset → +18 h, invoke reset, assert both the displayed
  offset **and** the resolved `validTime` return to the current frame.
- A metamorphic test: `offset A → B → A` yields the same `selectedValidTime` as never leaving A.
- An **invariant assertion** wired into the diagnostic: when `aria-valuenow === "0"`,
  `selectedValidTime` must equal the current frame; surface a visible stale indicator if violated
  (never a silent green `coverage_status: full_coverage`).

**Acceptance:** the repro sequence above ends with wheel and `selectedValidTime` in agreement; all three
recovery paths (ArrowRight, `Home`, Jump-to-now) move `selectedValidTime`; new tests pass; no page reload
required to recover.

**Regression risk:** the hour offset feeds prefetch and cache keys — a change here can cause refetch
storms. Watch request counts before/after. **Rollback:** revert the single commit.

---

### WP-2 — Stop the tile-edge resolution collapse  ·  Finding F-02  ·  P1

**User-visible objective:** zooming out one step at a Florida spot must not turn a 0.25° heatmap into a
2° one.

**Reproduce first.** Localhost `/map`, Waves on, `__MAP_INSTANCE__.jumpTo({center:[-80.45,27.86],
zoom:10})`, **wait 7 s**, read `__MARINE_PROJECTION_DIAG__.resolution` → expect `0.25`. Repeat at
`zoom:8` → observe `2`. The viewport's east edge (−78.97) crosses the `florida_east_coast` tile edge
(−79) by 0.03°.

**Implicated area:** `backend/services/weather_pipeline/grid_resolver.resolve_grid` and the manifest
selection it calls, plus the frontend's viewport→bbox request construction. The selector currently
requires **full containment** of the requested bbox within a regional tile, and falls back to
`global_mid` (2°) otherwise.

**Scope boundary:** selection/fallback policy only. **Do not** change the grid format, the renderer, the
heatmap direction, or introduce a new product tier.

**Minimal correction (preferred):** allow a regional tile to serve a **partially covering** viewport and
report the shortfall honestly via the fields that already exist — `partial_coverage`, `served_bbox`,
`coverage_scope`. Compose with the coarse tier only for the uncovered margin rather than discarding the
fine tile for the whole view. If composition is too large a change for this packet, the acceptable
smaller step is to **clamp the requested bbox to the tile** when overlap exceeds a threshold (e.g. ≥70%)
and set `partial_coverage: true`.

**Explicitly forbidden:** do not "fix" this by upsampling the 2° grid to look finer. The audit verified
(P-03) that this system does not fabricate resolution; keep it that way.

**Tests to add:** a backend test parameterised over centre offsets straddling a known tile edge,
asserting the served `resolution` stays `0.25` while `partial_coverage` is truthful; a fixture for the
exact Sebastian Inlet z8 case.

**Acceptance:** Sebastian Inlet at z8 serves `resolution 0.25`; `served_bbox`/`partial_coverage` describe
reality; no case serves fine data while claiming full coverage it does not have.

**Regression risk:** coastline/land-mask edges at the seam between fine and coarse data. Any ordering or
paint correction must be appended to `program/weather-simulation/LAYER_ORDER_PROOF_LOG.json` (owner
mandate). **Stop condition:** if the fix produces a visible seam or halo, stop and report — do not
iterate on shader changes inside this packet.

---

### WP-3 — Eliminate per-frame whole-world grid fetches  ·  Finding F-03  ·  P1

**User-visible objective:** scrubbing the timeline at a coastal zoom transfers kilobytes, not megabytes.

**Reproduce first.** Install the fetch recorder from §E, scrub 3–6 hours at zoom 7–9 over Florida, and
tally bytes by whether the URL contains `bbox=-180`. Audit baseline: **13,890 KB total, 13,783 KB
(99.2%) global, 6 global requests in 21 s.**

**Run D-3 before changing anything:** determine what consumes the global grid. The likely consumer is the
wide-zoom base pass (`__MARINE_ZOOM_THRESHOLDS__.zoomedOutMaxZoom = 7`). Disable the global request and
record precisely what visibly breaks and at which zooms.

**Implicated area:** the marine fetch layer's request planning
(`frontend/src/components/map/useMarineDataFetcherCore.js` / `windGridSeries.js` /
`marineSeriesFrame.js`) and `/api/weather/grid_series` on the backend.

**Scope boundary:** request planning and caching only. Do not change grid encoding or add a new transport
format in this packet.

**Minimal correction:** request the global grid **only** at the zooms that actually consume it, and cache
it across timeline steps instead of refetching per frame. If a wide-zoom pass genuinely needs global data
at every frame, cache one global frame and reuse it across hours rather than refetching 2.3 MB each step.

**Tests to add:** an assertion that at zoom ≥ 8 no request carries `bbox=-180`; a test that N timeline
steps issue at most one global fetch.

**Acceptance:** the same 21 s scrub transfers **< 1 MB** total; backend `grid_series` p90 measured before
and after under equivalent conditions; no visible change to the wide-zoom field.

**Regression risk:** wide-zoom blanking. Verify z3–z7 still paint. **Rollback:** single revert.

---

### WP-4 — Make timeline granularity match the data cadence  ·  Finding F-07  ·  P2

**Objective:** the wheel must not offer 1-hour steps for a 3-hourly field without saying so.

**Reproduce:** GFS + Waves, scrub +1 h and +2 h — `selectedValidTime` stays on the 21:00Z frame while the
wheel reads "+1 hour"; only +3 h advances it.

**Minimal correction:** read `cadence_hours` from the already-published capability matrix
(`__WEATHER_CAPABILITIES__`, per model+domain+layer) and either step the wheel by that cadence, or keep
1-hour steps and display the resolved frame time. GFS *wind* is genuinely 1-hourly, so this must be
per-layer, not global. Record the pre-snap request so `requestedValidTime` ≠ `selectedValidTime` is
observable when quantisation occurs.

**Acceptance:** for any model/layer, either the handle only lands on real frames, or the UI states the
frame actually shown. Keyboard and ARIA semantics preserved (`ForecastWheel.js` house pattern).

---

### WP-5 — Correct the EURO capability contract  ·  Finding F-04  ·  P2

**Objective:** `/api/weather/capabilities` tells the truth about what serves each layer.

**Reproduce:** run `audit/weather-simulation-14.0/evidence/res_truth.py`. `EURO/marine/waves` serves
`provider: open-meteo`, `upstream_model: ecmwf_wam025`; `EURO/marine/swell_2` and `wind_waves` serve
`provider: copernicus`, `cmems_mod_glo_wav_anfc_0.083deg_PT3H-i`. The capability matrix declares CMEMS
for all four.

**Minimal correction:** make the capability row **per layer**, reflecting the upstream that actually
serves it. Keep the change **additive/backward-compatible** for existing consumers.

**Do not** change which upstream serves which layer in this packet — only make the declaration match
reality.

**Acceptance:** a test that, for every `(model, domain, layer)` in the capability matrix, a live `/grid`
call returns a matching `upstream_model`. That test is the durable guard for this whole class.

---

### WP-6 — DIAGNOSTIC ONLY: provenance disagreement  ·  Finding F-06  ·  P2

**This is not a repair task. Do not change serving behaviour based on a hypothesis.**

`/api/weather/grid` and `/api/weather/point` agree with each other but report a `model_run_time` /
`ingested_at` ~21 h older than `/api/weather/products` reports for the **same `product_id`**. Values
themselves track the upstream to median 5.4% (P-01), so this is *probably* stale labelling rather than
stale data — but that is **unproven**.

**Your task (D-2):** add temporary instrumentation, in one process, that logs the identity of the record
`resolve_grid` actually reads, and diff it against the manifest entry for the same `product_id`. Report:
(a) are they the same record? (b) if not, which store does each read, and when was each last refreshed?

Deliver the answer and a recommendation. **Make no production change in this packet.**

---

### WP-7 — Layer-registry truth  ·  Finding F-09  ·  P3

Run D-5 first: toggle **Satellite** and record what the user sees. Then: **Air Temp** and **Water Temp**
are offered in the UI but absent from the 24-row capability matrix, and **Satellite** is offered while
declared `discontinued` / `supports_grid: 0`.

**Minimal correction:** every offered toggle must have a capability row; a layer whose upstream is
discontinued must either be removed from the picker or disclose its state in the UI (not colour alone —
see constraint 3). Owner decision required on remove-vs-disclose; **ask before removing a user-facing
feature.**

---

### WP-8 — DIAGNOSTIC ONLY: parity flags  ·  Finding F-10  ·  P3

`infoboxHeatmapParity` and `pointVisualParity` both read `false` while the layer is healthy. Run D-4:
`grep` for **writes**, not reads, of both symbols. Report whether they are genuine divergence signals or
orphaned instruments. If orphaned, propose either wiring or deletion — an instrument nobody writes is
worse than none, because it reads as a failing check.

---

## D. IMPLEMENTATION RULES

- Preserve the existing architecture. **No parallel weather engine, no second forecast path, no duplicate
  state owner, no competing render loop.** WP-1 in particular is about *removing* a second source of
  truth, not adding one.
- **Do not** revert heatmaps to legacy marine raster overlays. GPU data textures are not legacy image
  overlays. Do not remove legitimate radar/satellite imagery paths as part of WP-7 without owner sign-off.
- **No fabricated data**: no unlabelled mocks, no silent model substitution, no manufactured freshness, no
  upsampling presented as resolution. The system currently does none of these (P-02, P-03) — keep it so.
- Keep external contracts additive/backward-compatible.
- Work in an isolated branch or worktree. Focused, reversible commits, one packet per commit, explicit
  paths (`git commit -o <paths>`).
- **Do not merge, push or deploy without explicit authorization.** Note that on this project every push to
  `dev` is a production backend deploy.
- Do not upgrade dependencies, reformat unrelated code, weaken tests, suppress errors, or update snapshots
  to make checks pass.
- If evidence contradicts a packet's premise, **pause that packet only**, document the contradiction, and
  continue with the independent packets.

---

## E. PROOF REQUIRED FROM CODEX

For each packet:
1. **Reproduce the failure before the fix** and paste the evidence.
2. **Add a deterministic regression test** that fails before and passes after.
3. Apply the **smallest** change justified by the evidence.
4. Run the relevant numerical, contract, integration and build checks — and **verify the lines you
   changed are actually covered**, not merely that the suite is green. A green suite that never executes
   your diff is not proof.
5. **Animation:** if you claim anything about motion, prove it with a frame sequence, not a screenshot.
   The audit could not: in that harness `requestAnimationFrame` returned **0 frames in 4,006 ms** with
   `visibilityState:"visible"` and `hasFocus:true`, and `__RAW_GPU__.drawCallsPerFrame` stayed 0. Use a
   harness that genuinely composites (Playwright with a fronted page) or **declare it BLOCKED**. Do not
   convert "no problem seen" into a pass.
6. **Timeline/dataset identity:** prove correctness with `selectedValidTime` + `product_id` +
   `model_run_time`, not by eye.
7. Re-run the cross-feature journeys that share this code: spot hub / `SpotConditions`, spot-ratings map
   glyphs, `/conditions/batch`. Confirm ONE FORECAST COMPOSITION still holds — breaking height and
   offshore Hs must remain distinct fields (P-04, P-05).
8. **Before/after performance under equivalent conditions** for WP-3, stating zoom, region, cold/warm
   caches and sample count.
9. Record every command run, its result, and residual limitations.
10. **Distinguish local verification from deployed verification.** Do not claim production is fixed until
    an authorized deployed artifact has actually been tested — verify via the `/api/health` SHA and the
    service-worker `BUILD_VERSION`, not via a merge.

**Useful instrumentation (local, non-destructive) — the fetch recorder used for WP-3:**

```js
window.__AUDIT_NET__=[];
const rf=window.fetch;
window.fetch=function(i,n){
  const url=String(typeof i==='string'?i:(i&&i.url)||'');
  if(!/\/api\/weather\//.test(url)) return rf.call(this,i,n);
  const rec={url,t0:performance.now(),status:null,ms:null,bytes:null};
  window.__AUDIT_NET__.push(rec);
  return rf.call(this,i,n).then(r=>{
    rec.status=r.status; rec.ms=performance.now()-rec.t0;
    try{r.clone().arrayBuffer().then(b=>rec.bytes=b.byteLength).catch(()=>{});}catch(e){}
    return r;});
};
```

Key diagnostic globals: `__MARINE_PROJECTION_DIAG__` (productId, resolution, cols/rows, vectorCount) ·
`__WEBGL_MARINE_UPLOAD_DIAG__` (vectorCount, nonzeroCount, renderAccepted, rejectionReason) ·
`__FORECAST_TIMELINE_COVERAGE_DIAG__` (requested/selectedValidTime, isEstimated, coverage_status) ·
`__WEATHER_CAPABILITIES__` · `__MARINE_ZOOM_THRESHOLDS__` · `__MAP_INSTANCE__` (a real MapLibre map).

---

## F. DEFINITION OF DONE

**Must be closed to call this stage complete:**
- **F-01 (WP-1)** — wheel and `selectedValidTime` provably agree; all three recovery paths work;
  invariant assertion in place; regression test passes. *Or*, if it does not reproduce under real input,
  the diagnostic result plus the invariant assertion are delivered.
- **F-02 (WP-2)** — Sebastian Inlet z8 serves 0.25°; coverage honestly reported; parameterised
  edge-straddle test passes.
- **F-03 (WP-3)** — the 21 s reference scrub transfers < 1 MB; before/after numbers reported; wide zooms
  still paint.

**Should be closed:** F-07 (WP-4), F-04 (WP-5).
**Diagnostics delivered, not necessarily fixed:** F-06 (WP-6), F-10 (WP-8), F-09 (WP-7 pending owner call).

**Gates:**
- No regression in `/api/weather/spot-ratings`, `/api/weather/point`, `/conditions/batch` contracts.
- Breaking height and offshore Hs remain distinct everywhere they are published.
- No new `jsx-a11y` violations; touched controls keep `role`/`aria-*`/keyboard support.
- Touched UI works in light, dark and beach themes, desktop and mobile.
- Backend memory does not regress past the measured 90.2%-of-limit peak.

**Accepted residual risk (do not attempt to close in this stage):**
- 13,600 stale island-lane products still listed in a 32 MB `/products` payload (P-06 residual) — the
  ingest and serve gates are already in effect; cleanup is a separate owner-scheduled task.
- F-08 (41.3% of spots outside any 0.25° tile) is a **coverage/ingest scope decision for the owner**, not
  a code fix. Do not add tiles unilaterally — it changes ingest cost and provider quota.
- Animation/frame-rate verification remains BLOCKED unless you stand up a compositing harness.

**Explicit reasons NOT to advance to a further stage:** if WP-1 does not reproduce and the entry path is
unknown; if WP-2's fix introduces any coastline seam or halo; if WP-3's global fetch turns out to have a
real consumer you cannot cache. In each case, report and stop rather than widening scope.

**Return to the owner:**
1. Implementation summary keyed to finding IDs (F-01 … F-10).
2. Focused diff / file summary.
3. Before/after evidence per packet.
4. Test results with the actual commands and environment.
5. Remaining failures and any blocked verification, named.
6. Deployment and rollback instructions — **without claiming an undeployed change is live.**
