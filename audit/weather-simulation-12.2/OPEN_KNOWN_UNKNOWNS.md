# OPEN KNOWN UNKNOWNS — Audit 12.2

Only uncertainties that **survived reasonable investigation**. "Unknown" is not used here as a
substitute for looking; each row states what was already checked and the exact missing evidence.

---

## ~~K1~~ — ✅ ANSWERED 2026-08-14: the red has cleared (attribution NOT isolated)

> **22 findings → 1.** Post-fix nightly `dd6a8126` reads a single `DEAD_BAND_TRANSIENT`; zero
> `MULT0_FRAME`, zero `SETTLED_STEP`. The red was genuine and graded (`observable: true`,
> `instrumentFindings: 0`) and is on film — an 18-second blank ocean across a zoom-out.
> ⚠️ **Causation is NOT isolated**: n=1 either side, several commits between, and the nightly grades
> live production sea state which differs run to run. And it is probably **not** WS-CAN-0061 — that
> was `water_temp`; zoomlab grades the **marine** field. Full record:
> `evidence/browser-recordings/LV12-2-09`. **One green is not a trend on a lane failing ~47%.**

<details><summary>original question</summary>

### K1 — Did the WS-CAN-0061 fix clear the 22 optical render findings?

| | |
|---|---|
| **Why it matters** | `marine-nightly.yml` is red at HEAD with 22 **graded** render findings (`0 instrument findings`, so the renderer was genuinely graded, not starved of data). If they persist, there is a live optical regression in the weather renderer. |
| **Already checked** | The red run graded `7b74ae96`. `git merge-base --is-ancestor 7b74ae96 f3fe2c85` → **true**: it ran **14 commits before** the ocean-mask layer-order fix. The findings are 1 `SETTLED_STEP`, 0 `DEAD_BAND_PERSISTENT`, 21 transient/`MULT0_FRAME`. |
| **Exact missing evidence** | The verdict of the **2026-08-14T06:30Z** scheduled run, which grades a post-`f3fe2c85` tree, compared like-for-like. |
| **Action** | Wait for it (do **not** `workflow_dispatch` — prefer the natural run so the comparison is like-for-like), then `gh run download`. |
| **Objective** | WS-OBJ-101, WS-CAN-0067 |
| **Blocks a finish line?** | **Yes if still red** — Finish Line A |
| **Owner** | Next engineering session |
| **Closes when** | Two consecutive post-fix runs are read and their findings enumerated by type |

</details>

## K2 — Is the WebKit E2E flake a timeout budget or a real defect?

| | |
|---|---|
| **Why it matters** | 17 flaky results across 6 runs, **100% `[Desktop Safari]`**, 5 of them weather tests including *model selection, layer toggle, and timeline scrubbing*. The workflow conclusion is `success` every time. |
| **Already checked** | Per-project distribution measured. `retries: 2`, per-test `timeout: 90000` against a live deployment on a 1-CPU box. A **lead, not a finding**: 0 flaky in the three runs before the video key, 12 and 5 in two of the three after — n=3 per side, and the config's own comment records that a previous generated diagnosis of this lane was *measurably wrong in every limb*. |
| **Exact missing evidence** | The retained `video.webm` and trace for `weather-simulation.spec.js:270` on Desktop Safari, showing whether the page had **rendered** or was **still spinning** at the deadline. |
| **Action** | `gh run download 31751873373 --name playwright-report`. Decide the discriminator **before** watching. |
| **Objective** | WS-OBJ-705 (reopened PARTIAL), WS-CAN-0018/0019 |
| **Blocks a finish line?** | Blocks the honest re-issue of WS-OBJ-705's certificate |
| **Owner** | Next engineering session |
| **Closes when** | The at-deadline page state is stated, and either a per-project timeout lands or a defect is opened with the trace attached |
| ⏰ | **Artifact expires 2026-08-27** |

## K3 — Do the WebGL and Canvas2D renderers agree scientifically?

| | |
|---|---|
| **Why it matters** | `MarineParticleCanvas` and `WindParticleOverlay` are production-reachable through four triggers, one of them persistent in `localStorage`. Under ONE FORECAST COMPOSITION, a second renderer drawing different values from the same data is the visual analogue of a second forecast path. |
| **Already checked** | Both components exist and are wired (`MapWebGL.js:1026-1047`, `:1070-1088`). **Zero** test files reference either (control: `WebGLMarineEngine` → 30 test files). Zero register presence. |
| **Exact missing evidence** | A same-input comparison of colour scale, units and land mask between the two stacks. Neither this audit's pixel oracle nor any existing test exercises the Canvas2D path at all. |
| **Action** | Force the fallback (`window.__FORCE_MARINE_FALLBACK__ = true` pre-boot) in a harness and diff against the WebGL render at a fixed camera and hour. |
| **Objective** | WS-OBJ-707 (proposed), WS-CAN-0069 |
| **Blocks a finish line?** | Finish Line A if they disagree |
| **Owner** | Next engineering session after the authorised mission |
| **Closes when** | The comparison exists and its result is recorded either way |

## K4 — Are the painted values *correct*?

| | |
|---|---|
| **Why it matters** | This audit measured **72 of 72** layer/model/config cells painting and **24 of 24** geography cells rendering. **None of that grades correctness.** A wrong-but-colourful field passes every oracle used here, and passes zoomlab too. |
| **Already checked** | Row order and UV flip are unverified **in both directions** — SOTA A5, unchanged across four audits. The projection authority is certified by arithmetic and API probes, not by a rendered value. |
| **Exact missing evidence** | `WS-CAN-0028` — synthetic canonical fields (uniform E/W/N/S, vortex) driven through the **real** render path. |
| **Action** | Run it. Its stated blocker (`WS-CAN-0027`) cleared on 2026-08-13. |
| **Objective** | WS-OBJ-102 |
| **Blocks a finish line?** | **Yes — Finish Line B**, and it is the single largest remaining scientific unknown in the render plane |
| **Owner** | Engineering |
| **Closes when** | A known field renders to a known picture, verified in both directions |

## K5 — What is on the live Render service?

| | |
|---|---|
| **Why it matters** | `render.yaml` is **documented as not applied** (verified three ways by a prior session): the live service's ~27 env vars, `autoDeploy`, `buildFilter` and `healthCheckPath` exist only in the Render dashboard. Several statements in this audit are bounded by that, including whether the 503-capable `/api/health/data` is the configured health-check path. |
| **Already checked** | `git grep healthCheckPath` → zero hits, with a positive control (`startCommand` → `render.yaml:28`). **Absence in git is not absence in production**, so the grep is non-probative. `RATING_TIDE`'s divergence is **closed** (`test_flag_lane_parity.py:39`, 2026-08-10) — the `render.yaml` header warning about it is stale. |
| **Exact missing evidence** | One screenshot or API read of the live service's configuration. |
| **Action** | `WS-CAN-0040`, owner, one screen. |
| **Objective** | WS-OBJ-402 / WS-CAN-0025 / WS-CAN-0040 |
| **Blocks a finish line?** | No, but it bounds several claims and it gates the flag-lane parity check |
| **Owner** | **OWNER** |
| **Closes when** | The env-var set is recorded, and ideally turned into a **repeating** diff against the ingest lanes rather than a one-off read |

## K6 — Does the platform behave correctly under concurrent users?

| | |
|---|---|
| **Why it matters** | One production backend, one process, **17 in-process APScheduler jobs** including `check_surf_alerts` every 15 minutes, and `/api/conditions/batch` occupying it for 36 s (11 of 11 sampled calls over 10 s). |
| **Already checked** | Live telemetry: `n=3,133` over 1 h 30 m of **uncontrolled** traffic, `err_5xx: 0`, `peak_rss 1231.6 MB` of a 2048 MB cgroup limit. No concurrency limit, queue or per-user quota was found. An agent's claim that *"nothing bounds concurrency"* was marked **PROOF_FAILED** by adversarial verification — so the bounds question is genuinely open in both directions, not settled either way. |
| **Exact missing evidence** | One deliberate load run against a known request mix, with peak RSS and per-route p50/p99 recorded. |
| **Action** | The V4 verify item. |
| **Objective** | WS-OBJ-302, WS-OBJ-303 |
| **Blocks a finish line?** | WS-OBJ-303 cannot close honestly without it |
| **Owner** | Engineering |
| **Closes when** | A sustained-load envelope exists with the cgroup limit recorded beside it |

## K7 — Real mobile hardware, and browser zoom

| | |
|---|---|
| **Why it matters** | **Untested must not be read as supported.** All mobile coverage in this program — CI's Mobile Safari project and this audit's 390×844 DPR-2 probe — is **emulation**. Browser zoom, low-DPR displays, orientation change and reduced-hardware devices have never been exercised anywhere. |
| **Already checked** | Emulated mobile passes: map boots (20.8 s), 12/12 layers paint, 8/8 geographies render, the desktop panel is correctly `display:none` with `focusable: 0`. |
| **Exact missing evidence** | One session on real hardware. |
| **Action** | Owner or a manual pass; explicitly **not** an engineering task yet. |
| **Objective** | WS-OBJ-709 (proposed) |
| **Blocks a finish line?** | No |
| **Owner** | OWNER |
| **Closes when** | Either a real-device pass happens, or the support matrix explicitly states emulation-only |

## K8 — What does the production artifact actually do?

| | |
|---|---|
| **Why it matters** | **Every frontend finding in this audit was measured against `dev`.** Production has served `3bd38a83` (2026-05-20) for **85 days**. The zoomlab red, the second renderer, the 261 globals, the WebKit flake and the layer-paint positives all describe an artifact production users do not receive. |
| **Already checked** | Both service workers read live: prod `3bd38a83`, dev `791fdf78` = HEAD exactly. |
| **Exact missing evidence** | A production deploy, or a deliberate probe of the frozen build. |
| **Action** | `WS-CAN-0039`, owner, one decision. |
| **Objective** | WS-OBJ-104 |
| **Blocks a finish line?** | **Yes — it gates the VALUE of every frontend objective in the program** |
| **Owner** | **OWNER** |
| **Closes when** | Production serves an artifact within one release of HEAD |

---

## Deliberately NOT listed as unknowns

Because they were investigated and **answered**, and listing them would let a resolved question drift
back into the backlog:

- Whether cross-browser/mobile E2E coverage exists — **it does**, all four Playwright projects, every
  push.
- Whether the 12 weather layers paint — **72/72 cells measured**.
- Whether projection reaches the antimeridian and high latitude — **24/24 cells measured**.
- Whether `/api/health` can express weather-unreadiness — **`/api/health/data` does, proven by an
  executed control and a 30-minute poller that already caught a real outage.**
- Whether the mobile touch targets are 0 px — **no**, they are `display:none` desktop controls,
  `focusable: 0`.
- Whether `RATING_TIDE` is a live lane divergence — **no**, closed 2026-08-10.
- Whether the ONE FORECAST COMPOSITION serving chain has a route-level bypass — **no** (63 files, and
  a targeted search returns nothing under `backend/routes/`). The alert defect is a **consumer that
  never joined the chain**, not a break in it.
