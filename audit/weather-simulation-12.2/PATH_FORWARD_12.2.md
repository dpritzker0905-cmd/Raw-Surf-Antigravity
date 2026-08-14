# PATH FORWARD — Audit 12.2

`dev` @ `791fdf78` · 2026-08-13/14

**The organising principle of this path forward, and the thing 12.2 changes:**

> **Read before you build.** Three of the program's most expensive-sounding open tasks are premised
> on the absence of instruments that already exist and are already producing output. The cheapest
> lane in this program is now *reading*, not *writing*, and it is not on the current critical path
> at all.

---

## CLOSE MISSING BLOCKERS NOW — 3 maximum

### 1. `WS-CAN-0066` — the scheduled surf alert does not state the quality ★ **THE MISSION**

The only Critical in this audit that reaches a real user today. `scheduler/surf_alerts.py:94/:111`
fires every 15 minutes on the current backend and asserts *"perfect conditions!"* from height alone,
in direct violation of a binding mandate, with `rating`/`rating_level` unread in the same dict. The
guard passes because its census names the other file.
→ `NEXT_AUTHORIZED_EXECUTION_MISSION.md` · `evidence/runtime-paths/LV12-2-07`

### 2. `WS-CAN-0067` — read the standing red, then register the optical harness

`marine-nightly.yml` has failed **18 of 37 runs** and is red at HEAD with **22 graded** render
findings (`0 instrument findings` = the renderer *was* graded). It has **zero** presence in either
canonical register. Two actions, in order: **read the artifact** (it expires 2026-08-27), then give
the harness a register row so it cannot be lost a third time.
→ `evidence/runtime-paths/LV12-2-01`

### 3. Reopen `WS-OBJ-705` as PARTIAL — `flaky` is the fourth disguise a green wears

**17 flaky results across 6 E2E runs, 100% of them `[Desktop Safari]`**, 5 of them weather tests. The
workflow conclusion is `success` every time, and the certificate rests on a passed/skipped/failed
triple that cannot express `flaky`. Not "the lane is broken" — 42 of 52 pass first-attempt in every
browser — but the closure criterion cannot see a failure class that is occurring.
→ `evidence/browser-device-tests/LV12-2-05`

---

## CONTINUE CURRENT MISSION

**Nothing to continue.** The 12.1 authorised mission (`WS-CAN-0061`) and its named successor
(`WS-CAN-0027`) both shipped, along with `WS-CAN-0010`, `WS-CAN-0063` and `WS-CAN-0014`, in the seven
commits between 12.1's publication and this audit's baseline. 12.1's critical path is not wrong — it
is **spent**.

---

## VERIFY IN PARALLEL — 5 maximum, zero production source changes

Every item here closes an objective or corrects a premise **without touching production code**. This
is the cheapest quadrant in the program and none of it is on the current critical path.

| # | Action | Closes / corrects | Cost | ⏰ |
|---|---|---|---|---|
| V1 | `gh run download 31680258907` — read the zoomlab verdict + **watch the `.webm`**; compare against the 2026-08-14T06:30Z run (post-`f3fe2c85`) | Whether the WS-CAN-0061 fix cleared the render findings; **the first time anyone in this program watches this app render** | minutes | **expires 2026-08-27** |
| ~~V2~~ | ~~the WebKit weather-test failure video + trace~~ | ✅ **CLOSED 2026-08-14** — see `evidence/browser-device-tests/LV12-2-08`. Answer: **timeout budget**, and the "weather" framing was wrong: all 11 flaky fail on the *first navigation*, before any weather assertion. A WebKit redirect race in `beforeEach`, not a product defect. **Do not revert the video key.** Two corrections fell out: this audit's video-overhead lead is refuted, and the retained `.webm` are **blank** (0.96 s of white, 0.00% variance) — the **trace** did the diagnosis | done | — |
| V3 | Read `window.__MAP_RENDER_FPS__` from a compositing harness **on hardware GL**; publish the distribution | **Rescopes `WS-CAN-0037`** from "build a frame harness" (est. half a day) to "read the one that exists". ⚠️ record the WebGL renderer string beside the figure — this audit's own chromium probe fell back to SwiftShader | ~1 h | — |
| V4 | One deliberate sustained-load run, recording `peak_rss_mb` **and** the cgroup limit | **Closes WS-OBJ-303** on the `ru_maxrss` instrument, which is genuinely good. Three short uncontrolled windows are not an envelope | ~1 h | — |
| V5 | Take the full 27-workflow census, with a disposition for `marine-nightly` (red) and `python-upgrade-readiness` (**never executed**, 6 × `continue-on-error: true`) | Closes the gap that let a red stand unseen for a day | ~30 min | — |

⚠️ **V1 has a stop condition.** If the 06:30Z run is also red, that is a live optical regression in
the weather renderer and it outranks the authorised mission.

---

## NEXT — after the mission's gate passes

1. **The provenance visit** — `WS-CAN-0005` (`run_time` / `cycle_dt` / `ingested_at`), `WS-CAN-0062`
   (geometry-quality disclosure), and the newly-found **display half** of model-run truth
   (`run_time` reaches 16 client modules and no rendered surface). One file visit, closes most of
   Gate 1.
2. **The latency visit** — `WS-CAN-0064` **expanded**: at HEAD the 10 s breach population is *two*
   routes, not one (`conditions/batch` 11/11 over 10 s; `grid_series` 4/22). Co-scope with
   `WS-CAN-0009` — same file.
3. **`WS-CAN-0068`** — inventory the 261-global runtime override surface (generate, don't curate;
   CI diffs the inventory). **Inventory only — no deletions.**
4. **`WS-CAN-0069`** — the second renderer (`MarineParticleCanvas` / `WindParticleOverlay` +
   `useWebGLGuardrail`): a test that the two stacks agree on colour scale, units and land mask; a
   user-visible disclosure when a fallback engages; a reset path for the persistent `localStorage`
   trigger.
5. `WS-CAN-0018/0019` — un-`fixme` or delete the executed-GL oracle. V1/V2 tell you which.

---

## LATER

- `WS-OBJ-402` exit conditions for the three dual paths — **governance, dated, not engineering.**
- `WS-CAN-0007` ICON >168 h dual composition.
- `WS-CAN-0028` synthetic canonical fields — **the only thing that grades whether painted values are
  *correct***. Every pixel oracle in this audit proves a field *moved*, not that it is right.
- `WS-CAN-0017` expanded to include the git-tracked `forecast_cache/*.json` serving fallback.
- Add **PostHog** and both tile providers to the external dependency register; future dependency
  censuses must include `frontend/public/`, not only `frontend/src` and `package.json`.
- A **branch-protection / pre-deploy check** on `dev` (401 of 595 commits in 14 days deploy the one
  production backend with no required check).
- Make `WS-CAN-0040` a **repeating** check: diff the live Render env-var set against the ingest
  lanes', so an eleven-day silent flag-lane split becomes a red check.

---

## RESEARCH — isolated from the core platform

`WS-CAN-0046/0047/0048/0049/0050/0051` — unchanged from 12.1. **DO NOT START.** Nothing in 12.2
changes their prerequisites, and 12.2 strengthens the case against them: the platform's problem is
not capability, it is that existing capability is unread.

---

## DEFER

- `WS-CAN-0058` 0.25° coverage expansion — still needs one cadence measurement, and now also a
  bytes-per-model-run figure, which nothing measures.
- `WS-CAN-0057` default-model decision — calendar-bound, needs a storm.
- `WS-CAN-0033` z-tier determinism — **not measured since 11.2.** Cheap, and it may have closed by
  accident. Promote to VERIFY when a slot opens.

---

## REJECT / NOT NECESSARY

| Proposed | Why not |
|---|---|
| A cross-browser test lane | **Already exists** — all four Playwright projects run on every push. `DO_NOT_CREATE_DUPLICATE_WORK.md` §A1 |
| A mobile touch-target remediation | **Refuted by control run** — the 0 px reads are `display:none` desktop controls, absent from the a11y tree (`focusable: 0`). §A2 |
| A "check the other layers paint" task | **Measured** — 72/72 layer cells paint across 3 configs × 2 models × 12 layers. §A3 |
| A projection/antimeridian task | **Measured** — 24/24 geography cells, incl. 179.6° and 68°N. §A4 |
| Make `/api/health` fail on weather | **Refuted, and it would be harmful** — `/api/health/data` already 503s and is polled every 30 min; `server.py:19` records that 503-ing liveness would restart the box into an empty store. `evidence/runtime-paths/LV12-2-02` |
| A `RATING_TIDE` lane-divergence task | **Stale blocker** — closed 2026-08-10 per `test_flag_lane_parity.py:39`. One line of `render.yaml` documentation, not a task |
| Building a frame harness | One exists in CI, and the app measures its own FPS. Rescope `WS-CAN-0037`; do not duplicate |

---

## PRESERVE — do not disturb

- **The ONE FORECAST COMPOSITION serving chain.** 63 files, no route-level bypass found. The alert
  defect is a *consumer* that never joined it, not a break in it.
- **`/api/health` 200-liveness / `/api/health/data` 503-readiness split** — correct, deliberate,
  dated 2026-07-08, and proven to catch a real outage within one polling cycle.
- **`video: 'retain-on-failure'`.** It is the only reason V2 is possible. If the WebKit flake is
  timeout-driven, the fix is a per-project timeout, **not** a revert.
- **The `ru_maxrss` peak-memory instrument** — better than most production services carry.
- **Range-streamed GRIB2 off `.idx`** — 0.72% of bytes vs 16.83% naive.
- **The 12 weather layer controls' accessibility** — `aria-pressed` on 12 of 12, correct
  `display:none` per layout. Better than the program's own debt inventory implies.
- **Kill-switch-and-control-arm discipline**, with one caveat now attached: it is also what produced
  261 ungoverned globals. Keep the habit; add an inventory, not a prohibition.
