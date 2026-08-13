# PROGRAM PATH FORWARD 12.1

Hard caps observed: **≤ 5 CLOSE NOW · ≤ 5 VERIFY NOW · ≤ 5 NEXT · exactly 1 authorized mission.**
Everything else is LATER, RESEARCH, DEFER, REJECT or PRESERVE.

---

## CLOSE NOW (5)

### 1. **WS-OBJ-101 — every activated layer paints** · `WS-CAN-0061` ◄── **AUTHORIZED MISSION**
- **Why now:** a live, owner-reported, user-visible defect. Every `om://` raster layer — fog, water
  temp, all of them — renders blank at the map's two farthest-out zooms. It fails Finish Line A,
  which must hold before anything on Finish Line B.
- **State:** root-caused. Probes shipped (`ba7f1c18`); the owner ran them and reported
  `blocked: model_lock`. **One value stands between here and the fix.**
- **Scope:** read `window.__OM_URL_TRACE__.blockedDetail`, then correct whichever side of
  `isModelMatch(requestedModelFolder, activeModelLock)` is wrong; add a regression guard pinning
  the zoom floor.
- **Non-goals:** do not touch the model-lock feature itself; do not refactor `openMeteoProtocol.js`
  (grandfathered shrink-only at 943 LOC).
- **Acceptance:** at z2.00, `traceOmUrl` entries reach `TILE_TRUTH.protocolCalls` and decode, as they
  already do at z2.99 (45 → 20 → decoded). Guard fails if reverted.
- **Gate unlocked:** Gate 3 · **Closes WS-OBJ-101** (WS-CAN-0060 already shipped).
- **Stop condition:** if `blockedDetail` shows something not on the handoff's three-row decision
  table, **stop and report** — do not guess. Nine hypotheses already died on these layers.

### 2. **WS-OBJ-503 — runtime evidence capture** · `WS-CAN-0027`
- **Why now:** the most-repeated unresolved task in the program — named by 11.0, 11.1, 11.2, 11.4 and
  12.0 — and **its blocker cleared today** (LV-02). One config key and a version bump.
- **Scope:** `video: 'retain-on-failure'` in `frontend/playwright.config.js`; `@playwright/test`
  `^1.60.0` → `1.62`. Verify with a **deliberate** failure that a `.webm` reaches the uploaded
  artifact.
- **Acceptance:** a `.webm` exists in a CI artifact. Not "the config changed."
- **Gate unlocked:** Gate 3 → then **WS-CAN-0037 and WS-CAN-0028 both become possible**.
- ⏱ Estimated 15 minutes. It has cost five audits.

### 3. **WS-OBJ-506 — measure-or-refuse** · `WS-CAN-0063` + `WS-CAN-0010`
- **Why now:** two remaining fabricated status surfaces, one line each, and **the client-side one is
  a prerequisite for WS-CAN-0020**. Grading them together is what makes the objective closable.
- **Scope:** delete `|| 60` at `TruthOverlay.js:126` (send `null`); replace
  `error_rate = 0.5  # Placeholder` at `routes/admin/system.py:208` with `request_telemetry` or a
  refusal.
- **Acceptance:** a test stubbing `gpuStats.fps = 0` proves the payload carries `0`/`null`, never
  `60`. No placeholder constant reaches a consumer.
- **Gate unlocked:** Gate 1.

### 4. **WS-OBJ-701 + WS-OBJ-702 — program truth** · `WS-CAN-0038` + `WS-CAN-0056`
- **Why now:** **this audit performs both.** The 12.1 register carries all 65 IDs; the gate taxonomy
  is mapped once in `RELEASE_GATE_AND_DEPENDENCY_GRAPH.md`.
- **Remaining:** adopt the 12.1 register as the source of truth and retire
  `audit/weather-simulation-11.2/DO_NOT_ADVANCE_ITEMS.md`.
- **Acceptance:** the next handoff cites `WS-CAN-nnnn` and domain gates only.

### 5. **The owner track (5 one-shot decisions)** · `0039`, `0021`, `0025`, `0026-threshold`, `0055`
- **Why now:** zero engineering, fully parallel, and one of them has a **hard 9-day clock**.
- ⏰ **`WS-CAN-0026` threshold is due before 2026-08-22.** On current data the armed gate **pages**,
  and the deficit has *widened* since 12.0 (LV-03). Three options, all runtime variables needing no
  code: accept the page, move the margin with the reason recorded, or extend the grace date.

---

## VERIFY NOW (4) — may close **without touching production source**

| Objective | Task | Verification |
|---|---|---|
| **WS-OBJ-102** projection both ways | `WS-CAN-0028` | Run uniform E/W/N/S + vortex + checkerboard through the real render path. The session that scoped it called this *"the largest true unknown in the system."* Needs WS-CAN-0027 first |
| **WS-OBJ-205** deterministic selection | `WS-CAN-0033` | Re-measure layer off→on ×3 at a fixed coordinate. **Not measured since 11.2** — it may have closed by accident, or be worse |
| **WS-OBJ-103** detect / disclose / recover | `WS-CAN-0036` | Replay 11.2's failure injection against HEAD. The disclosure half shipped; detection and recovery were never re-tested |
| **WS-OBJ-303** bounded memory | — | One sustained-load peak-RSS run. 87.0% (12.0) vs 60.7% (12.1) on different traffic proves nothing either way |

---

## NEXT (5) — begin only after CLOSE NOW passes

1. **`WS-CAN-0005`** true model-cycle identity — thread `cycle_dt`, add `ingested_at`, key L1 by run.
2. **`WS-CAN-0014`** populate `resolution` — and then **retire the client-side derivation**, which is
   a good fallback and a bad permanent contract.
3. **`WS-CAN-0062`** make `confidence` a function of `geometry_readiness`.
4. **`WS-CAN-0022`** add a cancel path to the `WeatherTelemetry` RAF loop.
5. **`WS-CAN-0064` + `WS-CAN-0009`** — one visit to `conditions.py` closing both the ~1-minute median
   latency and the nine 200-with-error sites.

> ⭐ **Items 1–3 are one provenance visit.** Items 5 are one file. **Five tasks, three visits.**

---

## LATER

`WS-CAN-0007` ICON one-composition · `WS-CAN-0017` integrity chain · `WS-CAN-0018/0019` un-fixme the
pixel oracle · `WS-CAN-0020` telemetry uplink (**after 0063**) · `WS-CAN-0015` the five remaining
readout-truth items · `WS-CAN-0037` frame harness (**after 0027**) · `WS-CAN-0016` hour-0 unification
· `WS-CAN-0043` arbiter (**benchmark first, then arm or delete**) · `WS-CAN-0024` band/glyph sub-term
· **write the three dual-path exit conditions** (WS-OBJ-402).

---

## RESEARCH TRACK — isolated from core stabilization

`WS-CAN-0051` learned nearshore transform · `WS-CAN-0049` AI bias correction · `WS-CAN-0050` WebGPU.
**None may consume core-stabilization capacity.** Each has a named, currently-unmet prerequisite.

---

## DEFER

`WS-CAN-0011` dt-advection · `WS-CAN-0044` p2 precedence (**before any canary**) · `WS-CAN-0052`
`SURF_PARTITIONS` · `WS-CAN-0053` `SURF_TIDE_DEPTH` (owner; evidence now exists) · `WS-CAN-0054`
skill-gate arming (08-22) · `WS-CAN-0057` default model (**calendar dependency — it needs a storm,
not more runs**) · `WS-CAN-0048` nearshore model.

**`WS-CAN-0058` coverage expansion is DEFERRED BY ONE MEASUREMENT ONLY** — the pilot lane's
fixed-vs-variable runtime split at `per_cycle` 4 vs 3. It is the largest measured accuracy lever in
the program and should move to NEXT the moment that number exists.

---

## REJECT

`WS-CAN-0046` Zarr/Kerchunk/COG/Dask · `WS-CAN-0047` JAX/CuPy/GPU/Numba · `WS-CAN-0048`
SWAN/FVCOM/GNN/nested grids/AMR. **Priced against what they would replace by three independent
audits; all lose. 12.1 does not reopen them and found no new evidence that would.**

---

## PRESERVE — do not disturb

The composition chain and its single write site (**certificate issued**) · refusal semantics · the
stale-response guard stack · the two-orientation texture contract · the ask-echo `valid_time`
contract · Gate 4 animation lifecycle (11.2: *"good — don't refactor it"*) · the verdict cache and
its non-vacuity guard · the settle debounce's default-OFF · **the E2E route handler's `extOf`
helper** (certificate issued) · **the paired accuracy gate and its `ACCURACY_PAIRED_GATE` kill
switch** (certificate issued) · the science registry ratchet · the pre-push floor hook.
