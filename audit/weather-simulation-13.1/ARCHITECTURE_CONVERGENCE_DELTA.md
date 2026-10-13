# ARCHITECTURE CONVERGENCE DELTA — Audit 13.1

**`791fdf78` (Audit 12.2 HEAD) → `568fc2c6` (HEAD), 128 commits.**

**Method.** Every count below was taken with `git grep` **at both revisions** — from the object
store, not the working tree — so it is unaffected by the dirty tree and by the two in-tree
worktrees checked out to other branches at `.claude/worktrees/`.

---

## Verdict: **STABLE WITH MILD DIVERGENCE**

> **Not one of the ten measured architecture-authority counts converged. Three diverged. Seven
> are byte-for-byte identical to baseline.**

---

## The authority census

| # | responsibility | baseline `791fdf78` | current HEAD | trend |
|---|---|---|---|---|
| 1 | `requestAnimationFrame` owners | 24 files / 46 call sites | **24 / 46 — identical** | Stable |
| 2 | Web Worker constructions | 2 `new Worker` (8 total `Worker(`) | **identical** | Stable |
| 3 | Forecast-data caches | 50 module-scope declarations / ~35 instances / 15 | **identical** | Stable |
| 4 | Renderer authorities | 2 custom MapLibre layers / 3 `onAdd` / 2 GL engine constructors | **identical** | Stable |
| 5 | Build-time flags (`REACT_APP_`) | 11 names / 43 occurrences | **identical** | Stable |
| 6 | **Runtime overrides (`window.__RAW_*` / `__OM_*`)** | **261** distinct names | **264** | **⬆ Diverging** |
| 7 | **Backend weather env gates** | **215** names / **343** reads | **221 / 353** | **⬆ Transitional** |
| 8 | OceanMask code paths | 12 files (10 non-test) | 14 files (**10 non-test — unchanged**, +2 test) | Stable |
| 9 | Projection / coordinate corrections | 58 `mercator` tokens · 5 `project(` · **17 definitions (6 JS + 11 GLSL)** | **identical** | Stable (inherited debt) |
| 10 | Normalization paths | 17 frontend / 10 backend / 19 provider adapters | **identical** | Stable |
| 11 | **Forecast-composition entry points** | 1 definition each · 4 production call sites each | **identical** | **Stable — the mandate holds** |
| 12 | **`setInterval` owners** | 7 files | **8** | **⬆ More Duplicated** |

---

## The eight questions §14 asks

| question | answer |
|---|---|
| Did active authority count decrease? | **No. Zero of ten converged.** |
| Did bypass count decrease? | **No.** |
| Did dual-path migration decrease? | **No — and one was added** (a third EURO marine ingestion lane). |
| Did RAF ownership improve? | **No — flat.** 24 files / 46 sites, byte-identical. |
| Did worker ownership improve? | **No — flat**, and it did not need to: 2 constructions, zero multiplication under every journey. |
| Did cache ownership improve? | **No — flat.** 50 declarations, identical. |
| Did projection ownership improve? | **No.** 6 JS + 11 GLSL definitions of one transform, unchanged. |
| Did lifecycle ownership improve? | **No — it worsened slightly.** +1 `setInterval` owner; +1 live interval per marine layer visit; +1–2 shader programs per zoom, monotone. |
| Did new architectural entropy appear? | **Yes** — +3 runtime overrides, +6 backend env names, +1 interval owner, **+11 modules with zero deletions**. |

---

## The one genuine convergence — and its measurement trap

`backend/services/weather_pipeline/config_env.py` (`env_int:29`, `env_float:48`) absorbed
**20 previously inline `os.environ.get` reads** into a single clamping accessor. Example:

```
before   sim_forecast.py:110   float(os.environ.get("SIM_FORECAST_CACHE_TTL_S", "3600"))
after    sim_forecast.py:111   env_float("SIM_FORECAST_CACHE_TTL_S", 3600.0, lo=0.0)
```

Same flag, same file, **new accessor**. This is real convergence in *access path*.

### ⚠️ The trap

| what you count | reads as |
|---|---|
| `os.environ.get(` only | 343 → **333** — a 10-flag **reduction** |
| both access forms | 343 → **353** — an **increase** |

**A convergence audit that greps one access form gets the sign backwards.** This is recorded as
a reusable instrument lesson: after a centralisation refactor, *always count both the old and
the new access form*.

Note also: **the accompanying flag count grew** (+6 backend env names). The refactor improved
*how* flags are read without reducing *how many* exist. And the authority map does not track
backend env gates at all — so **the one real convergence event of this window is unrecorded,
while the accompanying growth is also unrecorded.**

---

## The largest entropy finding

### `CURRENT_ARCHITECTURE_AUTHORITY_MAP.md` is 126 commits stale while asserting it describes HEAD

Its last commit is `d8c866bd` — **the Program 13.0 *start* commit**. Since then, 126 commits have
landed touching 40 `frontend/src` files, **including the renderers, `OceanMask`, and the shaders
the map explicitly declares untouched.**

Its "261 runtime overrides" figure **reproduces exactly at the baseline** and is **264** at HEAD.
The regex that produced it is undeclared, so the figure cannot be re-derived without guessing.

### ✅ Recorded so this audit does not over-report drift

**All four of the map's Mission-1 authority claims verify at HEAD**, checked line by line:

| claim | verification |
|---|---|
| `rating_why` has exactly one producer and one call site | **CONFIRMED** — producer `spot_ratings.py:50`, call site `:242`, across `backend/services`, `backend/routes`, `backend/scheduler` |
| Readiness vocabulary has one owner, with `caveat()` beside `summarize()` | **CONFIRMED** — `spot_geometry_readiness.py:47-49` (BLIND/DEGRADED/FULL), `:139` `summarize()`, `:158` `caveat()`; not duplicated into `spot_ratings` |
| `surf_alert_body` unified, two jobs remaining | **CONFIRMED exactly as written** — one owner at `alerts.py:22`, imported by `scheduler/surf_alerts.py:33`, called at `alerts.py:358` and `surf_alerts.py:108`; two jobs remain (`alerts.py:307`, `surf_alerts.py:21`); commit `a1b5aac3` exists with the cited message |
| Two client ratings lanes, CDN-first / endpoint-on-miss | **CONFIRMED to the line** (295-299) — though the map omits the path, which is `frontend/src/components/map/useSpotRatings.js`, **not** `frontend/src/hooks/` |

**The file's reasoning is sound. Its currency is not.** That distinction matters: this is a
staleness defect, not a correctness defect.

---

## Inherited debt: six JS definitions of one transform, plus eleven GLSL bodies

`marineMaskProjection.js:118` documents itself as *"Shared canvas projector for the mask
renderers"* — yet:

| site | what it holds |
|---|---|
| `WebGLMarineMaskRenderer.js:607` | its **own** local `latToMercatorY` |
| `WebGLMarineMaskRenderer.js:625` | its **own** `project(lng, lat)`, used at `:225`, `:226`, `:260`, `:728` |
| `mapUtils.js:118` / `:128` | exports the pair — **but is not the authority the renderer uses** |
| `marineEngineDecisions.js:27` | a **second** `latToMercatorY` — this is the one the engine consumes (`WebGLMarineEngine.js:54` imports it, `:66` re-exports it) |
| `WebGLWindEngine.js:31` | a sixth |
| GLSL | **11 further bodies** |

**A projection-convention change would have to be made in six JS places plus eleven GLSL
bodies.** Unchanged across the window — neither added to nor paid down. This is the single
largest concrete convergence opportunity on the board, and it is exactly what
`WS-CAN-0069` (the second renderer) was reserved for — an id that **was never allocated**.

---

## Surface area

| | baseline | current | change |
|---|---|---|---|
| `backend/services` modules | 137 | **142** | **+5, 0 removed** |
| `frontend/src/components/map` non-test modules | 159 | **165** | **+6, 0 removed** |
| `frontend/src/components/map` test files | 134 | **150** | **+16** |
| **test : module ratio** | 0.84 | **0.91** | **⬆ the strongest convergence signal in the window** |

**Module inventory grew monotonically with zero deletions on either side of the stack.**
Coverage grew faster than surface area — which is genuinely good — but nothing was retired.

---

## Summary

> This is a program that has **stopped adding duplicate authorities** but has **not yet removed
> any**.

Seven counts flat, three up, none down. The ONE FORECAST COMPOSITION chain holds at the
computation level — 1 definition and 4 production call sites each, identical to baseline — which
is the most important single stability result in this table.

**The correct reading is not "architecture is degrading". It is "architecture is not the thing
that moved."** In a five-day window with 128 commits and +66,433 insertions, the architecture
is where it was. The work went into evidence, documentation, and a rendering campaign — and
those did not touch the authority structure at all.
