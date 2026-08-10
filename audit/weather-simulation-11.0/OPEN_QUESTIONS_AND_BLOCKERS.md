# OPEN QUESTIONS AND BLOCKERS — Weather Simulation 11.0

Everything this audit could **not** settle, with the exact action that would settle it.
Nothing here is a finding; these are honest gaps.

---

## A. Open questions requiring an owner decision

| ID | Question | Why it matters | Cheapest discriminator |
|---|---|---|---|
| **Q-01** | Is the degenerate hour-78 EURO grid (**6×5, maxHeight 1.15 m**) a *backend* defect, or expected at long horizons? | Determines whether F-01's remedy is frontend disclosure only, or also a backend fix | Call `/api/weather/grid_series?model=EURO&…&hours=78` directly at several bboxes and compare cell counts against the advertised 0.083° Copernicus dataset |
| **Q-02** | Is the **rating band** meant to be the same quantity as the point value, or a deliberate cell-aggregate? | Decides whether E1-01 is a **composition** violation or a **labelling** one — different remedies | Check whether any surface/tooltip/legend presents the band value as *the spot's* surf height. Yes ⇒ composition; No ⇒ labelling |
| **Q-03** | Should the **SimulationLoop physics kernel** (FieldEvolutionEngine + RK4 ParticleSystem + FCE) be wired into production, or deleted? | It is reachable, inert, and loudly self-reports as active — it corrupts every diagnosis made through it | Owner call. Either is defensible; *leaving it as-is is not* |
| **Q-04** | Should `GPUMarineLayer` / `MarineParticleCanvas` be removed? | Imported for 81 days, **never mounts** (verified). Bundle weight + confusion only | Now low-risk to delete — the runtime check that made it risky has been done |
| **Q-05** | Why is the served **grid tier non-monotonic in zoom** (25 / 306 / 25 cells at z8 / z9 / z10)? | Strongest lead for F-04 and plausibly for E1-01 | Log the tier-selection decision (`mid_res_tier` / global-grid fallback) per zoom for one viewport |
| **Q-06** | Is `__WebGLMarineLayer_DIAG__.infoboxHeatmapParity === false` a real disagreement or an unevaluated default? | The app tracks heatmap-vs-infobox parity and it is currently failing | Read the writer of that field; then compare an infobox value against the heatmap value at one coordinate |

---

## B. Blocked — required evidence not obtainable this session

| ID | Area | Why blocked | Exact unblock | Confidence impact |
|---|---|---|---|---|
| **B-01** | **Video forensics** — recording, frame differencing, contact sheets | No recording tool in this browser pane; screenshots return inline and are **not persisted** | Playwright `video: 'on'` + `trace: 'on'` with the existing `frontend/playwright.config.js`; ffmpeg for frame extraction | **High.** Every animation-continuity claim rests on numeric probes, not reviewed footage |
| **B-02** | **Cross-browser** (Firefox, WebKit) | Only the in-app Chromium pane is wired | `npx playwright test --project=firefox --project=webkit` | Medium. All findings are Chromium-only |
| **B-03** | **11 of 12 weather layers** (Wind, Swell, Swell 2, Wind Waves, Precip, Radar, Satellite, Fog, Pressure, Air Temp, Water Temp) | Session budget spent on the engine-loop falsification chain and the F-01 root cause | Repeat the §17 probe set per layer — ~2 min each | **High.** Only **Waves** was exercised end-to-end |
| **B-04** | **Antimeridian and high latitude** | Not reached | `map.jumpTo` ±179.9 lng from both sides, and lat > 66 | **High** — `b5bbaa7d` was itself a world-wrap seam fix, so this is known-sensitive |
| **B-05** | **Historical baseline comparison** | No worktree comparison run | Isolated worktree at a chosen commit + the same `readPixels` probe | Medium |
| **B-06** | **DPR 1, mobile viewport, bearing, pitch, tab-visibility, route remount** | Not reached | `resize_window` presets + `setBearing`/`setPitch` + visibility events | Medium |
| **B-07** | **React commit counts / Profiler** | React Scan badges observed visually; no programmatic profile captured | React DevTools programmatic profiling API | Medium — no memoization claim is made anywhere in this report |
| **B-08** | **JS heap leak** | GC noise dominated a 6-cycle run (130–339 MB, no trend) | 50+ cycle soak with `--expose-gc` | Low — explicitly reported as inconclusive, not as a leak |
| **B-09** | **Backend capacity limits** | Local frontend points at the **production** backend; load testing was prohibited | A staging backend, or an owner-approved rate-limited window | **High** — no capacity envelope for the backend exists |
| **B-10** | **Which GPU Chromium bound** | `WEBGL_debug_renderer_info` not queried on a hybrid-graphics laptop | One `getParameter(UNMASKED_RENDERER_WEBGL)` call | Medium — invalidates any GPU-headroom claim until answered |
| **B-11** | **Codex findings 1, 2, 3, 5** | Backend MCP-surface claims, outside the live browser lane | Re-run the Codex review's own probes | Medium — they are **not disputed** and **not re-proven** |
| **B-12** | **Exported chat transcripts** ("the previous ten chats") | **Not located.** No raw transcript store was found | Point the audit at the transcript directory if one exists | Medium — handoff docs were used as the substitute record and are labelled as such |
| **B-13** | **Production build + service worker** | Dev server unregisters the SW; no production build was made | `npm run build` + serve + repeat L0/L5 | Medium — all SW/caching findings are dev-mode only |
| **B-14** | **Failure/race/recovery (Ladder L8)** | Deliberately not run against a production backend | Staging environment, or a request-level fault injector | **High** — offline, malformed-response and WebGL-context-loss behaviour is entirely unknown |

---

## C. Process hazards observed during this audit

| ID | Hazard | Evidence | Recommendation |
|---|---|---|---|
| **P-01** | **Concurrent sessions share this working tree** | HEAD advanced `3d3ccdc2` → `9f4f8570` at 18:07 mid-audit, from another session with the same git identity. Fast-forward, docs-only, no production code — but it silently moved the audit baseline | Any long-running audit or migration should run in a dedicated worktree |
| **P-02** | **Broken instruments produce fabricated findings** | Four hypotheses (duplicate RAF loops, duplicate modules, subscriber churn, engine stall) were raised and refuted here, all traceable to one stale global | Mission 2 (live accessors). Treat any diagnosis made through `__SIM_DIAGNOSTICS__` before that fix as unreliable |
| **P-03** | **Environment does not match its own declaration** | The repo's guard printed: *"python 3.14 != declared 3.12; 28 of 46 pins differ; 7 declared packages absent; not in a virtualenv"* during E1's run | E1's numbers are arithmetic-only so drift risk is low, but **CI parity is unverified** |
| **P-04** | **A committed live credential** | Reported in `BRAIN_RULES.md` by subagent A1 | **Rotate the key.** Not opened or reproduced by this audit |

---

## D. What would most change the conclusions

1. **Q-02.** If the band is a deliberate cell-aggregate, the single Critical finding becomes a
   labelling problem and the recommended first repair changes shape (though the guard is still the
   prerequisite either way).
2. **B-03.** Eleven untested layers could each carry their own F-01-class disclosure defect. The
   "YELLOW, safe to build on" verdict is scoped to what was actually exercised.
3. **B-14.** Failure-path behaviour is entirely unknown, and this project's own history records that
   *"a failure path is the least-tested code you have."*
