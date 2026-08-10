# FIRST IMPLEMENTATION PACKET — Mission 1b (REWRITTEN 2026-08-09)
## Un-gate the staleness warning that already exists

**This is a work packet, not an implementation. No code was written for it.**

> ## ⚠️ THIS PACKET REPLACES AN EARLIER ONE THAT WAS WRONG
>
> The first version said: *"the app computes `parity:false` and never surfaces it — build a badge."*
> **The badge exists.** So does the producer, the mapper, the render site and the icon. Building one
> would have duplicated working code and left the real defect in place.
>
> Every claim below was re-verified at `file:line` by the lead auditor after a subagent raised it —
> the earlier packet is exactly what happens when you design a fix without reading the consumer.

---

## 1. The chain that already exists, end to end

| step | location | what it does |
|---|---|---|
| producer | `WebGLMarineLayer.js:168-173` | writes `__MARINE_RENDER_HOUR_PARITY__ = {requestedHour, renderedDataHour, parity, reason}` |
| producer | `WebGLMarineLayer.js:175-189` | **when `active && !parity`**, writes `__MARINE_HEATMAP_STATUS__ = {status:'retained_previous_hour', model, layer, hour, renderedHour, retainedPrevious:true}` |
| clear | `WebGLMarineLayer.js:190-196` | clears the status when parity returns |
| 2nd producer | `useMarineOrchestratorScrubCache.js:306-307` | writes `'retained_previous_hour_warning'` |
| mapper | `forecastDiagnostics.js:24-25` | `'retained_previous_hour' \| 'retained_previous_hour_warning'` → `'retained_stale_warning'` |
| badge | `forecastCardCompiler.js:22` | `retained_stale_warning: { color:'text-amber-400', text:'Stale Hour Retained' }` |
| render | `MapForecastOverlay.js:780-787` | renders the badge with an `AlertTriangle` icon |

**The whole feature is built.** It did not fire in the measured defect because of three gates.

---

## 2. The defect, in one sentence

> **`WebGLMarineLayer.js:185` explicitly records `'waves'` as a layer it reports staleness for.
> `forecastDiagnostics.js:13` excludes `'waves'` from ever displaying it.**

*(Checked: the second `activeModel !== 'EURO'` at `forecastDiagnostics.js:131` is in a different
function — `writeOverlayDiagnostics`, legacy diagnostic globals — and does **not** gate the badge.
`:13` is the only blocker.)*

The producer and the consumer disagree about which layers deserve a warning, and the consumer is
the narrower of the two.

### Gate 1 — the model/layer restriction (the one that matters)

`forecastDiagnostics.js:13-15`:
```js
if (activeModel !== 'EURO' || !['swell_1', 'swell_2', 'wind_waves'].includes(activeLayer)) {
  return null;
}
```
Structurally unreachable for:
* the **`waves`** layer — the default marine layer, **and the layer the +78 h defect was measured on**;
* **every** layer under **GFS** and **ICON**.

Note the producer at `:185` writes `layer: ...find(l => ['waves','swell_1','swell_2','wind_waves'])`
— `waves` first.

### Gate 2 — the consumer never re-reads after a scrub

`MapForecastOverlay.js:617-619`:
```js
const heatmapStatus = useMemo(() => {
  return computeHeatmapStatus({ activeModel, activeLayer, renderMarineData });
}, [renderMarineData, activeModel, activeLayer]);
```
`computeHeatmapStatus` reads the mutable globals `__MARINE_HEATMAP_STATUS__` (+ `isInCooldown`).
**None is in the dependency array.** The producer effect is keyed on
`[timeOffsetHours, revision, active, activeModel]` (`WebGLMarineLayer.js:197`) — so **scrubbing the
hour, the exact action that produces the retain, re-runs the producer and does not re-run the
consumer** unless `renderMarineData`'s identity happens to change.
⚠️ **NOT MEASURED at runtime** — this is a read of the dependency arrays. Verify before relying on it.

### Gate 3 — no pin, no infobox (out of scope, see §6)

`MapForecastOverlay.js:647-649` returns `null` for the entire infobox when
`pointLat == null || pointLng == null`. Browsing the map with the heatmap on and no spot selected ⇒
no disclosure by construction, regardless of gates 1 and 2.

---

## 3. Reproduction

1. `npm --prefix frontend start`, open `/map` (dev auto-provisions a mock user).
2. Model **GFS**, enable **Waves**, let the field paint. Select a spot so the infobox exists.
3. Click **+1h** ×6, confirm `__MARINE_RENDER_HOUR_PARITY__.parity === true`.
4. Click **ICON**, wait ~300 ms, click **EURO**. Immediately click **+1d** ×3.
5. Poll `window.__MARINE_RENDER_HOUR_PARITY__` and `window.__MARINE_HEATMAP_STATUS__`.

**Expected today:** parity `false` / `reason:"retained_previous"` for ≥60 s, `__MARINE_HEATMAP_STATUS__`
holding `retained_previous_hour` — and **no badge**, because `activeLayer === 'waves'`.

> ⚠️ Diagnose through `__MARINE_RENDER_HOUR_PARITY__` and `__MARINE_HEATMAP_STATUS__`, **not**
> `__SIM_DIAGNOSTICS__`. (That one was a stale snapshot until `0bf6278e`; it is a live accessor now.)

---

## 4. The change

**In scope — three edits, all in the consumer:**

1. **`forecastDiagnostics.js:13-15` — scope the gate PER STATUS instead of globally.**
   ⚠️ Do **not** simply delete it. It is load-bearing for one status: `no_copernicus_coverage` is
   genuinely EURO-specific (`WebGLMarineLayer.js:180` only emits it when `activeModel === 'EURO'`).
   The correct shape: let `retained_previous_hour*` and `rate_limited_cached` through for **every**
   model and **every** marine layer; keep the EURO restriction on the Copernicus-coverage statuses.
2. **`MapForecastOverlay.js:617-619` — make the consumer re-read.** Add `timeOffsetHours` (and any
   revision counter the producer keys on) to the `useMemo` deps, so an hour scrub re-evaluates.
3. **Add the `waves` layer to whatever allow-list survives**, so producer and consumer agree.

**Explicit non-goals — do not touch:**
- ❌ the retain/refuse logic in `decideMarineCommit` — it is **correct**; it is protecting the user
- ❌ any physics constant, `science_registry.py`, γ, H110, refraction, tide
- ❌ any shader, particle budget, or GPU path
- ❌ the fetch/abort machinery — cancellation already works
- ❌ **building a new badge component** — that was the previous packet's error

---

## 5. The falsification gate — run this BEFORE editing

Un-gating a warning that fires constantly makes the UI cry wolf, which is worse than silence.

> Log `computeHeatmapStatus(...)`'s return **with the gate bypassed** every 2 s across a
> **30-minute ordinary session** (pan, zoom, scrub inside the cached horizon, one model switch,
> `waves` on GFS). Record the duty cycle.

- **Proceed** if a non-null status appears only during genuine transitions and clears within seconds.
- **STOP** if it is non-null for a large fraction of ordinary time — then the **producer's** parity
  condition is too loose, and that is the defect to fix instead.

This is the step that disproves the mission if the mission is wrong.

---

## 6. Tests after editing

1. **Reproduction** — §3 sequence on **GFS + waves**; the amber *"Stale Hour Retained"* appears
   within ~2 s of `parity===false` and clears when it returns true.
2. **Negative control** — a normal scrub inside the cached horizon (14 clicks, **0** requests) must
   produce **no badge**. Without this the test cannot tell "works" from "always on".
3. **Regression control** — EURO + `swell_1` must still show `no_copernicus_coverage` when that is
   the real status. Do not trade one blind spot for another.
4. **Scrub re-read** — assert the badge appears on an hour scrub *alone* (gate 2), not only when
   `renderMarineData` identity changes.
5. **Three layouts** — desktop panel, mobile collapsed, mobile expanded (`MapWeatherControls`).
6. **Three themes** — light, dark, beach via `useTheme()`; no hardcoded colours.
   ⚠️ `text-amber-400` is a fixed colour — check it against the light theme.
7. **Accessibility** — not colour-alone; the badge already carries text. Add `role="status"` +
   `aria-live="polite"` if absent.

---

## 7. Rollback, and what is deliberately left

Three localised consumer edits behind one conditional. Revert the commit; no data, schema, constant
or GPU state is touched.

**Left for a separate decision — Gate 3.** Surfacing staleness while browsing *without* a pin needs
a surface that is not the infobox (a map-level chip near the legend). That is a design call, not a
bug fix, and it should not ride along in this change.

---

## 8. Note for whoever picks this up

The temptation will be to force the hour-78 grid to upload. **Resist it.** The renderer refused a
degenerate 6×5 grid and that refusal is protecting the user from a wrong picture. Whether the
backend *should* return that grid is open question **Q-01**.

And the lesson this packet's own rewrite records: **before building a disclosure surface, grep for
one.** The first version of this document specified building a badge that already existed, had a
producer, a mapper, an icon and a render site — and was simply gated off the default layer.
