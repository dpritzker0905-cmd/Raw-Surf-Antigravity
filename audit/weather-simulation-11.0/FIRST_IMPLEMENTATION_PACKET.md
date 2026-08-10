# FIRST IMPLEMENTATION PACKET — Mission 1
## Surface the forecast-staleness the application already computes

**This is a work packet, not an implementation. No code was written for it.**
A future coding session should be able to execute this without rereading the audit.

---

## 1. Selected root cause

**F-01 — The map renders a stale forecast hour and model under confident labels, with no disclosure.**

The application **already detects** the condition. It computes, stores, and then discards it:

```js
window.__MARINE_RENDER_HOUR_PARITY__
  === { parity: false, reason: "retained_previous", requestedHour: 78, renderedDataHour: 6 }
```

Nothing in the UI consumes it. **Detection is solved; only disclosure is missing.**

---

## 2. Evidence summary (measured 2026-08-09, `dev` @ `3d3ccdc2`)

| Time | State |
|---|---|
| T0 | GFS, Waves, +6 h → `parity true`, 6 == 6, particles 87,616 |
| T+12 s | EURO, +78 h → `parity FALSE`, `reason "retained_previous"`, requested **78**, rendered **6** |
| T+60 s | unchanged — `parity FALSE`, still rendering hour 6 |
| after viewport change | `parity true`, 78 == 78 (self-heals) |

`renderedParticleCount` stayed **87,616 across the entire sequence** — the field was never re-uploaded.

**What the user saw at T+60 s** (screenshot reviewed): model chip **EURO** selected, **Waves** lit,
timeline label **"Thu 12 AM"**, legend *Combined Waves (ft) 0–20+* — over a field **pixel-identical**
to the pre-switch GFS hour-6 render. **No spinner. No badge. No error.**

Supporting: the hour-78 fetches returned **HTTP 200** (not a network failure), and the grid that came
back was degenerate (`cols 6, rows 5`, `maxHeight 1.1519`). The renderer's refusal to draw it is
**correct behaviour** and must not be changed.

---

## 3. Reproduction steps (exact)

1. `npm --prefix frontend start` (or launch config `frontend-preview`, port 3007). Open `/map`.
   Dev mode auto-provisions a mock user — no credentials needed.
2. Confirm baseline: model **GFS**, enable **Waves**, wait for the field to paint.
3. Click **+1h** six times (offset → 6). Confirm `__MARINE_RENDER_HOUR_PARITY__.parity === true`.
4. Click **ICON**; wait ~300 ms; click **EURO**.
5. Immediately click **+1d** three times (requested hour → 78).
6. Poll `window.__MARINE_RENDER_HOUR_PARITY__` every 5 s for 60 s.

**Expected today (the bug):** `parity:false, reason:"retained_previous"` persists ≥60 s while the UI
shows EURO / "Thu 12 AM" with no indication.

> ⚠️ **Do not diagnose this through `window.__SIM_DIAGNOSTICS__`** — it is a stale snapshot object
> (F-02) and will mislead you. Use `__MARINE_RENDER_HOUR_PARITY__`, which *is* refreshed.

---

## 4. Files and symbols

**Producer of the signal (read-only for this mission — do not change):**
- `frontend/src/components/map/` — the module that publishes `__MARINE_RENDER_HOUR_PARITY__` and
  `__WebGLMarineLayer_DIAG__`. Locate with:
  `rg -n "__MARINE_RENDER_HOUR_PARITY__" frontend/src`
- The retain decision (`reason: "retained_previous"`) originates near `decideMarineCommit` /
  `marineEngineDecisions.js`. **Read it to confirm the flag's semantics. Change nothing there.**

**Consumer to add (the entire change surface):**
- `frontend/src/components/map/MapWeatherControls.js` — owns the timeline/legend region where the
  badge belongs.
- ⚠️ **`MapWeatherControls` has THREE layouts** (desktop panel, mobile collapsed float, mobile
  expanded sheet). The project's binding rule requires the change be mirrored across **all three**.
- Optionally `frontend/src/components/map/TruthOverlay.js` (Diagnostics HUD) for the verbose form.

---

## 5. Architecture invariant being restored

> **User-visible loading/readiness state must correspond to actual readiness.**
> A surface that displays a forecast hour and model must display *the hour and model actually
> rendered*, or explicitly mark itself degraded.

---

## 6. Narrow change boundary

**In scope**
1. Subscribe the weather-controls component to the existing parity signal.
2. When `parity === false`, render a small, theme-aware, accessible badge near the timeline, e.g.
   *"Showing +6 h — +78 h unavailable"*, derived from `requestedHour` / `renderedDataHour`.
3. Clear it when `parity === true`.
4. Mirror across all three `MapWeatherControls` layouts.

**Explicit non-goals — do not touch**
- ❌ the retain/refuse logic (`decideMarineCommit`) — it is **correct**
- ❌ any physics constant, `science_registry.py`, γ, H110, refraction, tide
- ❌ any shader, particle budget, or GPU path
- ❌ the fetch/abort machinery — cancellation already works (S-05)
- ❌ the render orchestrator — verified healthy (S-01)
- ❌ the backend

---

## 7. Required test BEFORE editing (the falsification gate)

**Do not build the badge until this passes**, or you risk shipping permanent UI noise:

> Log `__MARINE_RENDER_HOUR_PARITY__.parity` every 2 s across a **30-minute ordinary session**
> (pan, zoom, scrub inside the cached horizon, one model switch). Record the **duty cycle**.

- **Proceed** if `parity === false` only during genuine transitions and clears within a few seconds.
- **STOP and fix the flag first** if it is false a large fraction of ordinary time — then the flag,
  not the UI, is the defect.

This is the step that disproves the whole mission if the mission is wrong.

---

## 8. Required tests AFTER editing

1. **Reproduction test** — the §3 sequence; badge appears within 2 s of `parity===false` and clears
   when it returns true.
2. **Negative control** — a normal scrub inside the cached horizon (14 clicks, 0 requests) must
   produce **no badge**. Without this control the test cannot distinguish "works" from "always on".
3. **Three-layout test** — badge present and legible in desktop, mobile-collapsed, mobile-expanded.
4. **Three-theme test** — light, dark, beach (project mandate). Use `useTheme()`; no hardcoded colours.
5. **Accessibility** — not colour-alone; include text; `role="status"` + `aria-live="polite"`.
6. **Regression guard** — assert the §17 probes still pass: one RAF `frame` per vsync; net-zero GPU
   resources over 6 toggle cycles; scrub still issues 0 requests.

---

## 9. Visual test journey

Cocoa Beach z9 → GFS + Waves → +6 h → screenshot (no badge) → ICON → EURO → +1d ×3 →
screenshot at T+15 s (**badge present**) → pan to Portugal → screenshot (badge cleared).

---

## 10. Performance comparison

Expect **no measurable change**. Record before/after: FPS badge, `__RAW_GPU__.drawCallsPerFrame`,
request count for the journey. A React commit-count regression from a per-frame subscription is the
one real risk — **subscribe at the parity signal's own cadence, not per animation frame.**

---

## 11. Rollback

Single additive UI component behind one conditional. Revert the commit. No data, schema, constant or
GPU state is touched, so rollback is complete and instantaneous.

---

## 12. Completion criteria

- [ ] Duty-cycle gate (§7) passed and recorded
- [ ] Reproduction test shows the badge; negative control shows none
- [ ] All three layouts, all three themes
- [ ] `role="status"`, `aria-live`, text (not colour alone)
- [ ] §17 regression probes still green
- [ ] No change to any file under `backend/`, `science_registry.py`, or any shader
- [ ] Screenshots attached to the PR

---

## 13. Note for whoever picks this up

The temptation will be to "fix the stale render" by forcing an upload of the hour-78 grid.
**Resist it.** The renderer refused a degenerate 6×5 grid and that refusal is protecting the user
from a wrong picture. Whether the backend *should* return that grid is a **separate, open question**
(`OPEN_QUESTIONS_AND_BLOCKERS.md`, Q-01). This mission makes the system **honest**, not louder.
