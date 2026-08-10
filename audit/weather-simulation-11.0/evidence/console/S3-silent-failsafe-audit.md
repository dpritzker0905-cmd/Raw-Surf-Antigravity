# S3 — RUNTIME SILENT FAIL-SAFES IN THE PRODUCT

**Lane 3 of the `edf91af9` generalisation.** Class under test: **a refusal you cannot READ is
indistinguishable from a pass.** One layer down from CI: places where the *product* detects a
degraded condition at runtime and then discards the fact, so the user reads a number with no mark
on it.

Read-only sweep of `frontend/src` and `backend/`. Date 2026-08-09, branch `dev`, HEAD `3d3ccdc2`.
Nothing was modified outside `audit/weather-simulation-11.0/evidence/`.

**Evidence discipline used throughout:** every claim is tagged **CODE FACT** (I read it at
file:line) or **MEASURED** (I executed it and the output is reproduced) or **NOT MEASURED**.
Where I could not run the failure, I say so rather than assert the consequence.

Companion raw data: `S3-diag-globals-scan.txt` (the 461-global census, script + full output).

---

## 0. The reference case, re-read — and a correction to how it was described

The audit's existing statement is that the marine renderer records
`{parity:false, reason:"retained_previous"}` and **"never surfaces it."**

That is **not quite right, and the difference matters**, because the fix implied by "never
surfaces it" (build a disclosure surface) would be building something that already exists.

**CODE FACT — the disclosure surface exists.**
`frontend/src/components/map/MapForecastOverlay.js:780-790` renders `STATUS_RENDERS[heatmapStatus]`
with an `AlertTriangle` icon, and `frontend/src/components/map/forecastCardCompiler.js:22` defines

```js
retained_stale_warning: { color: 'text-amber-400', text: 'Stale Hour Retained' },
```

**CODE FACT — it is gated out of the case that was measured.**
`frontend/src/components/map/forecastDiagnostics.js:13-15`:

```js
if (activeModel !== 'EURO' || !['swell_1', 'swell_2', 'wind_waves'].includes(activeLayer)) {
  return null;
}
```

The banner can only ever appear for **EURO** and only on **swell_1 / swell_2 / wind_waves**. It is
structurally unreachable for:

- the `waves` layer — the default marine layer, **and the layer the +78 h defect was measured on**;
- **every** layer under GFS and ICON.

**CODE FACT — a second gate.** `MapForecastOverlay.js:647-649` returns `null` for the whole infobox
when `pointLat == null || pointLng == null`. The only place the warning can render is inside a panel
that does not exist until the user has selected a spot or dropped a pin. Browsing the map with the
heatmap on and no pin selected ⇒ no disclosure by construction.

**CODE FACT — a third weakness, in the read.** `MapForecastOverlay.js:617-619`:

```js
const heatmapStatus = useMemo(() => {
  return computeHeatmapStatus({ activeModel, activeLayer, renderMarineData });
}, [renderMarineData, activeModel, activeLayer]);
```

`computeHeatmapStatus` reads four mutable globals — `window.__MARINE_HEATMAP_STATUS__`,
`window.__MARINE_FETCH_DIAG__`, `window.__WebGLMarineLayer_DIAG__` — plus `isInCooldown('marine')`.
None is in the dependency array. The producer (`WebGLMarineLayer.js:105-197`) writes the status from
an effect keyed on `[timeOffsetHours, revision, active, activeModel]`. **A scrub of the hour — the
exact action that produces the retain — re-runs the producer but does not re-run the consumer**
unless `renderMarineData`'s identity also changes. NOT MEASURED at runtime; this is a read of the
dependency arrays only.

> **★ The corrected class for this repo:** the failure is not usually "no disclosure was built".
> It is **"a disclosure was built and then scoped to a subset that excludes the failure"**. That is
> harder to find than an absence, because `grep` for the warning string succeeds.

---

## 1. Ranked findings

Ranking criterion, as asked: *could a user act on a wrong number with no indication it is wrong?*

| # | Finding | Degraded state visible to… | Sev |
|---|---|---|---|
| S3-01 | `geometry_readiness` / `directional_conflict` / `model_agreement` die at the client mapper | **neither** | Critical |
| S3-02 | Wind (and marine) point resolve swallowed at DEBUG inside `rate_one_spot`; rating still published | **neither** | Critical |
| S3-03 | "Stale Hour Retained" gated to EURO × 3 layers, and to an open infobox | user, but only in a subset | High |
| S3-04 | Broad `except` disables the entire surf transform; every response still validates | **neither** | High |
| S3-05 | `except: pass` around the land-bit coastal promotion ⇒ offshore Hs served as surf | **neither** | High |
| S3-06 | Heatmap band `rate_vectors` fails **open** on 5 separate inputs | **neither** | High |
| S3-07 | 92 of 461 `window.__*` diagnostics are written and never read anywhere | **neither** | Medium |
| S3-08 | `coverage_status` / `fallback_reason` / `grid_parity` have zero production consumers | **neither** | Medium |
| S3-09 | `WeatherTelemetry` report is admin-panel-only; never transmitted | admin screen only | Medium |
| S3-10 | Resolution watchdog is silent by default and requires the user to notice first | **neither** | Medium |
| S3-11 | A documented-absence claim in `surf_point.py` is stale (the field *does* have a consumer) | n/a | Info |

---

### S3-01 — CRITICAL. The provenance envelope reaches the client and dies one line short of the glyph

**CODE FACT.** The backend computes and serves, on both the point response and the glyph row:

- `services/weather_pipeline/schemas.py:248` — `geometry_readiness: Optional[str]  # full | degraded | blind`
- `schemas.py:280` — `geometry_missing: Optional[List[str]]`
- `schemas.py:266` — `directional_conflict: Optional[dict]`
- `services/weather_pipeline/point_surf_augment.py:225-241` — where both are stamped
- `services/weather_pipeline/spot_ratings.py:271,277` — carried onto every glyph row

**CODE FACT.** They survive all four client mappers (there is even a parity test —
`frontend/src/components/map/pointFieldWhitelistParity.test.js:76-129`):

- `backendWeatherServiceClientPoint.js:568,570,578`
- `backendCopernicusServiceClient.js:681,683,690`
- `forecastSamplers.js:461,463,468`
- `spotRatingsClient.js:64-66`

**CODE FACT.** They are then read by **nothing**. A grep for `geometryReadiness|geometry_readiness|
directionalConflict|directional_conflict|modelAgreement|model_agreement` across all of
`frontend/src` excluding `*.test.js` returns *only* the four mappers above. `spotRatingsClient.js`
says so itself, at line 62:

```js
// ⚠️ Carried, NOT rendered — no component reads it yet, exactly like `model_agreement`.
```

And `spot_ratings.py:243-244` states the opposite intent for the same field:

```
# ⇒ THIS IS THAT SAME DISCLOSURE, ON THE SURFACE USERS ACTUALLY READ.
```

The disclosure reaches the wire, the mapper, and the parity test. It does not reach a pixel.

`limiter` / `limiter_f` (`spot_ratings.py:268-269` — the argmin factor that names the binding
constraint) are not even mapped: they are dropped at `spotRatingsClient.js` entirely.

**Why it matters — MEASURED, not argued.** `geometry_readiness == 'blind'` means the spot has no
shore normal. Both rating surfaces (the backend `compute_surf_rating` and its JS mirror
`frontend/src/components/map/surfRating.js`) treat a missing shore normal as the **most favourable**
assumption: `surfRating.js:83` returns `1.0` (full exposure) when `shoreNormalDeg == null`, and
`surfRating.js:65` drops the wind term to neutral for the same reason.

Executed at HEAD against the production `services.weather_pipeline.surf_rating.compute_surf_rating`,
one variable changed (wind held at `None` in **both** arms so only `shore_normal_deg` moves):

```
h=1.5 m, Tp=13 s
  dtheta=  0  geometry-known (70.7, 'good')       geometry-BLIND (70.7, 'good')      delta   +0.0
  dtheta= 45  geometry-known (52.0, 'fair')       geometry-BLIND (70.7, 'good')      delta  +18.7
  dtheta= 75  geometry-known (23.5, 'poor')       geometry-BLIND (70.7, 'good')      delta  +47.2
  dtheta= 90  geometry-known ( 7.1, 'very_poor')  geometry-BLIND (70.7, 'good')      delta  +63.6
  dtheta=180  geometry-known ( 7.1, 'very_poor')  geometry-BLIND (70.7, 'good')      delta  +63.6

h=2.5 m, Tp=15 s
  dtheta= 90  geometry-known ( 7.6, 'very_poor')  geometry-BLIND (76.0, 'good')      delta  +68.4
```

**Up to +68.4 points and a four-level jump (`very_poor` → `good`), monotonically in the optimistic
direction.** The field that says "this is the blind arm" is in the same JSON object as the score,
was mapped into the same JS object as the score, and no component reads it.

**Prevalence — the repo's own recorded census, NOT my measurement.**
`docs/research/FINDING-2026-08-03-the-ceiling-is-a-conjunction.md:54-63` records a served-catalogue
sample where the exposure-limited population splits 44 `full` / 18 `degraded`, at rates 33.6% and
26.9% within class — implying roughly **one third of sampled served spots carry
`geometry_readiness = degraded`**. I did not re-run that census; cited as a prior measurement.

**Cheapest fix.** The repo already has the pattern. `SpotHub.js:440-462` and
`SpotConditions.js:234-309` render `forecast_confidence` as a coloured dot + a plain-words line +
an `aria-label`. Reuse that component for `geometryReadiness` on the glyph hover card and the
infobox Rating badge. No new physics, no new field, no new endpoint.

---

### S3-02 — CRITICAL. `rate_one_spot` publishes a rating after silently losing wind

**CODE FACT.** `services/weather_pipeline/spot_ratings.py:123-134`:

```python
    try:
        wind = await resolver.resolve_point(model=model, domain="wind", ...)
        ...
            wind_ms = (wind.point.speed or 0.0) * SR.KT_TO_MS
            wind_from = wind.point.direction
    except Exception as e:
        logger.debug(f"[spot-ratings] wind resolve failed for {spot.get('id')}: {e}")
```

`wind_ms` / `wind_from` stay `None`; execution continues to `compute_surf_rating(...)` at line 171
and the score is published. **The returned dict (lines 255-320) has no field recording that wind
was absent.** The identical shape guards the marine resolve at lines 93-122 (`surf_h`, `period`,
`swell_from`, `offshore_h`, `partitions` all stay `None`), the tide at 146-147, the breaker type at
156-157, the break depth at 166-167, the limiter at 212-213, and the spread at 225-226 — six
swallowed inputs, one published number.

**MEASURED at HEAD** (production `compute_surf_rating`, geometry full, swell head-on, only the wind
arm changed):

```
  6 m/s OFFSHORE   truth (84.2, 'epic')       wind-missing (70.7, 'good')   delta -13.5
  6 m/s ONSHORE    truth (41.9, 'poor_fair')  wind-missing (70.7, 'good')   delta +28.8
 10 m/s ONSHORE    truth (29.8, 'poor_fair')  wind-missing (70.7, 'good')   delta +40.9
 14 m/s ONSHORE    truth (18.5, 'poor')       wind-missing (70.7, 'good')   delta +52.2
```

A **blown-out 14 m/s onshore day publishes as `good` — +52.2 points, three levels** — and the glyph
a surfer taps carries nothing that distinguishes it from a real `good`.

This is CLAUDE.md's own star clause inverted: *"a blown-out 6 ft and a groomed 6 ft must not render
identically."* On the swallowed-wind path they render identically, and identically **optimistic**.

**NOT MEASURED:** the live rate at which this `except` fires. `logger.debug` means it is below the
default log level, so the production frequency is currently unobservable — which is itself the
finding. A `counter` + one output field (`inputs_missing: ["wind"]`) would make it observable
without changing a single served number.

---

### S3-03 — HIGH. The one real disclosure is scoped away from the measured defect

Fully detailed in §0. Summary of the code facts:

| Gate | Location | Effect |
|---|---|---|
| model/layer | `forecastDiagnostics.js:13-15` | EURO only; `waves` layer excluded |
| infobox presence | `MapForecastOverlay.js:647-649` | nothing renders without a selected point |
| stale read | `MapForecastOverlay.js:617-619` | 4 globals read, 0 in the dep array |

The producer covers all models and all four marine layers
(`WebGLMarineLayer.js:159-189` sets `retained_previous` / `cooldownActive` / `coverageMissing`
regardless of model). Producer coverage ⊃ consumer coverage — the classic shape.

---

### S3-04 — HIGH. One `except` disables the whole surf transform, and every response still validates

**CODE FACT.** `services/weather_pipeline/point_surf_augment.py:245-252`. The comment is the
finding; I am quoting it because it is the repo's own prior incident report:

```python
        except Exception as _se:
            # ⚠️ THIS BROAD EXCEPT HIDES CODING ERRORS, NOT JUST DATA ONES. It exists so a surf
            # estimate can never cost the caller its point — but during the 2026-07-30 extraction
            # it swallowed a NameError (`self` no longer in scope) as a quiet debug line, silently
            # disabling the whole transform while every response still validated.
            logger.debug(f"[Surf Transform] skipped for ({lat},{lng}): {_se}")
```

**CODE FACT — the downstream behaviour.** On that path `surf_height_m` is `None`, so
`forecastCardCompiler.js:331` (`if (_surf != null && _reg && ...)`) suppresses the **Surf (est.)**
row, and lines 354-366 suppress the **Rating** badge. What remains is the card at line 346-350,
labelled **`Swell`** — which is the **offshore significant wave height**.

The label is the mitigation and it is a good one (`forecastCardCompiler.js:342-345` explains
exactly why it is never called "Height"). But the *disappearance* of the mandated nearshore number
is conveyed by **absence**, and absence is the one signal a reader cannot distinguish from "this
spot legitimately has no surf row" (open ocean, calm, not nearshore — all three also produce an
absent row, at `forecastCardCompiler.js:325,330`). Four different causes, one rendering.

Same shape at the same file's `directional_conflict` block (`point_surf_augment.py:230-231`) and
`geometry_readiness` block (`240-241`) — both `logger.debug`, both leave the field `None`, and
`None` is also the legitimate "does not bind" value. **A sentinel that means both "absent" and
"failed" cannot be read.**

---

### S3-05 — HIGH. `except: pass` on the path that decides whether the offshore height gets published as surf

**CODE FACT.** `services/weather_pipeline/surf_point.py:200-211`:

```python
    if not coastal and os.environ.get("SURF_COASTAL_FROM_LAND_BIT", "1") != "0":
        try:
            from services.weather_pipeline.shore_normal_asset import land_present_at
            _land = land_present_at(lat, lng)
            if _land is not None:
                coastal = True
                ...
        except Exception:
            pass
```

**CODE FACT — what `coastal == False` does**, from the same file's own header, lines 151-156:

> `estimate_surf` then takes `if not coastal: return float(Hs_m), 'open_ocean'`, publishing the
> OFFSHORE significant height under the surf label. That is CLAUDE.md's first binding rule inverted.

So if `land_present_at` ever raises — a missing asset file, a corrupt blob, an unpickle error — the
16 named small-island spots this block exists to rescue (Maldives passes, Rangiroa, Chuuk,
Kwajalein; `surf_point.py:190-199`) revert to publishing the offshore Hs, silently, with the
regime `open_ocean`. `open_ocean` then suppresses the Surf row (S3-04), so the visible failure is
again *absence*, and the fallback is not distinguishable from a genuinely-offshore pin.

**NOT MEASURED.** I did not force `land_present_at` to raise and I did not measure how often it
does. The consequence chain is read from code and from the file's own documented measurement.

**Cheapest fix.** `except Exception as e: logger.warning(...)` plus a `coastal_promotion_failed`
entry in `geometry_missing` — the field already exists and is already served (`schemas.py:280`).

---

### S3-06 — HIGH. The heatmap band's rating fails **open** on five inputs

**CODE FACT.** `services/weather_pipeline/surf_rating.py`, inside `rate_vectors` (the function that
colours every cell of the surf-rating band):

| line | guarded input | value on failure | direction |
|---|---|---|---|
| 712-716 | `coastal_fn` | **`coastal = True`** | fail-**open**: an ocean cell that should be masked gets rated |
| 727-730 | `depth_fn` | `depth = None` | shoaling input lost |
| 732-736 | `width_fn` | `width = 0.0` | shelf width lost |
| 741-748 | `wind_fn` | `wind_speed = wind_from = None` | wind neutral — see S3-02 for the magnitude |
| 750-754 | `shore_normal_fn` | `shore_normal = None` | full exposure — see S3-01 for the magnitude |
| 772-779 | `gate_fn` | ungated score | the observation gate silently does not apply |

Line 779 carries the reasoning verbatim: `pass  # a gate error must never kill the band`.

That instinct is right about *availability* and wrong about *readability*: nothing distinguishes a
cell rated on five real inputs from a cell rated on five defaults. The vector struct has spare
capacity for exactly this — `phys_speed` and `rating_level` are already conditionally attached at
lines 786-789 — so a `rating_degraded` bit per cell is a small, additive change.

**NOT MEASURED:** whether these currently fire in production. The instrument does not exist, which
is why they cannot be counted — the same circularity as S3-02.

---

### S3-07 — MEDIUM. 92 diagnostic globals are written and never read; 86 more are read only by their author

**MEASURED.** Script and full output: `S3-diag-globals-scan.txt` (walks `frontend/src`, excludes
`*.test.js` / `*.spec.js` / `tests/` / `__tests__/`, classifies each `window.__X__` occurrence as
write or read).

```
production files scanned:        829
distinct window.__X__ globals:   461
WRITTEN, NEVER READ ANYWHERE:     92
READ ONLY INSIDE ITS OWN FILE:    86
```

**178 of 461 (38.6%) are diagnostics whose only consumer is their own author or nobody at all.**

The ones that encode a *degraded forecast state* — i.e. the ones in this lane's scope:

| global | producer | records |
|---|---|---|
| `__SIM_BIND_REASON__` | `engine/useSimulationField.js:210-221` | `marineDataIgnored` + a five-way `marineIgnoreReason` breakdown — the simulation field **discarding** marine data |
| `__EURO_MARINE_FORENSIC_DIAG__` | `components/map/forecastDiagnostics.js:180-202` | `renderAccepted`, `renderRejectedReason`, `estimateReasonIfNot` |
| `__MARINE_STALE_DIAG__` | `forecastDiagnostics.js:229-250` | `isStale`, `staleReason`, `ageMs`, `circuitRemainingMs` from the backend `X-Cache: STALE` header |
| `__MARINE_EXACT_POINT_ERROR__` | `components/map/forecastExactPoint.js` | point-fetch failure |
| `__MARINE_LAYER_VALUE_DIAG__`, `__MARINE_INFOBOX_DIAG__`, `__MARINE_PERIOD_DIAG__`, `__MARINE_MODEL_CAPABILITY_DIAG__` | `forecastDiagnostics.js:128-136` | the provenance of the values actually displayed |
| `__MARINE_BLANK_BACKSTOP_COUNT__`, `__MARINE_CLAMP_GIVEUP_COUNT__`, `__MARINE_CLAMP_TERMINAL_COUNT__`, `__MARINE_GRIDMISMATCH_COUNT__`, `__MARINE_ENGINE_EMPTY_RECOVER__`, `__MARINE_TERMINAL_NOCOV_BYPASS_COUNT__`, `__MARINE_SCRUB_HOLD_COUNT__`, `__MARINE_XFAM_HOLD_COUNT__`, `__RAW_MASK_GLITCH_COUNT__` | `useMarineScrubSettle.js`, `WebGLMarineLayer.js`, `marineTransitionCoordinator.js` | **nine counters of degraded-render events, each incremented and never read** |
| `__WIND_TERMINAL_NOCOV_SKIP_COUNT__`, `__WIND_SEAM_REPAIRED__` | `WeatherEngine.js`, `WebGLWindUtils.js` | wind coverage skips / seam repairs |
| `__RAW_RES_WATCH_WARN__` | `marineResolutionWatch.js` | see S3-10 |

**A counter nobody reads is not instrumentation — it is a comment with a `++` in it.** The nine
`*_COUNT__` globals are the cheapest possible win in this whole report: they already hold the exact
numbers a canary would want, and `WeatherTelemetry.getDiagnosticReport()` (S3-09) is one line away
from carrying them.

---

### S3-08 — MEDIUM. The point response says how coarse it is; nothing in the UI reads that

**CODE FACT.** `services/weather_pipeline/point_resolution.py:392-423` distinguishes:

- `coverage_status = "inside_regional_tile"` (fine, ~0.23°/cell)
- `coverage_status = "inside_global_coarse"` (**~9.73°/cell** per `marineResolutionWatch.js:13-14`)
- `coverage_status = "coarse_gap_direct_point"`
- `fallback_reason = "coarse_sample_degraded_direct_point_failed"` with `grid_parity = False`
  (lines 419-423) — a *last-resort* sample explicitly labelled degraded

**CODE FACT.** A grep for `coverage_status|coverageStatus|fallback_reason|grid_parity|gridParity`
across `frontend/src` excluding `*.test.js` returns hits in **exactly one file**:
`frontend/src/tests/fixtures/marine-card-matrix.fixture.json`. A test fixture. **Zero production
consumers.** A number sampled from a 9.73°-per-cell global grid renders byte-identically to one
sampled from a 0.23° regional tile — same font, same colour, same decimals.

`far_edge_hold.py:82-95` is the honest counterpart on the backend: it relabels the held frame
(`is_estimated=True`, `is_forecast_authoritative=False`, `estimate_basis`, `warnings`) — and the
`warnings` append is itself wrapped in `except Exception: pass` at lines 90-93, so the one
free-text marker can be lost while the frame still ships.

**Positive control, and the reason this is Medium not Critical:** the *point-level* `is_estimated`
**does** reach the user. `forecastCardCompiler.js:133` reads `useExactPoint?.is_estimated` and lines
298/304/434/540/632 render a literal `(est.)` suffix on the height, period and direction; the
`exact_stale_available` status renders `(latest)` on the same lines. So the repo does this
correctly for one flag on one surface, which makes the gap on the others a scoping failure, not a
capability failure.

---

### S3-09 — MEDIUM. The one place the retain flag *is* collected goes to an admin panel, in-process

**CODE FACT.** `frontend/src/components/map/WeatherTelemetry.js:524-545` — `getDiagnosticReport()`
assembles `heatmapStatus` (`__MARINE_HEATMAP_STATUS__`), `coverageStatus`, `windCoverageStatus`,
`marineLayerDiag`, `crestDiag`, `directionDiag`, `recentFailures`.

**CODE FACT.** Its only production consumer is `frontend/src/admin/advanced/WeatherDiagnostics.tsx:13,42,74`.
`WeatherTelemetry.js` contains no `fetch`, no `sendBeacon`, no POST (grep for
`fetch\(|axios|sendBeacon|POST` returns one comment line, 534). The singleton is attached to
`window.__WEATHER_TELEMETRY__` at line 550 and lives and dies in the tab.

So for the reference defect, the honest answer to "visible to a user, to telemetry, to neither?" is:
**to neither.** Not to the user (S3-03's gates), and not to server-side telemetry (this). The only
reader is an admin who has the panel open at the moment it happens.

`/api/weather/client-diagnostics` **does** exist (`backend/routes/weather.py:702`) and **is** called
from the frontend — but only from `components/map/TruthOverlay.js:140`, a separate debug overlay,
not from `WeatherTelemetry`. The transport exists; the degraded-state report is not on it.

---

### S3-10 — MEDIUM. A watchdog that requires the user to notice the bug first

**CODE FACT.** `frontend/src/components/map/marineResolutionWatch.js:1-17`:

> this watchdog **silently records**, on each marine commit, when the resident tile is coarser than
> the tier ladder expects … After the user next sees the artifact they run
> `window.__RAW_RES_WATCH__.report()`

and line 17: `Silent by default (no console noise); opt-in warns via window.__RAW_RES_WATCH_WARN__ = true`.
Line 75 confirms the console warning is behind that opt-in.

This is the S3 class stated as a design intent. The instrument correctly detects a stuck
coarse-global resident (a real degraded render), stores it in a 50-entry ring, and gates the only
output channel behind a human who has already seen the defect and knows the incantation. It is a
**refusal you cannot read unless you already knew about it.**

Not malicious and not stupid — the header explains it was built to trap a non-reproducible field
report. But the ring is never drained anywhere, `__RAW_RES_WATCH_WARN__` is in the never-read-92
(S3-07), and `store.anomalies` reaches no telemetry.

---

### S3-11 — INFO. A stale documented-absence claim

**CODE FACT.** `services/weather_pipeline/surf_point.py:177-182` asserts:

> `nearshore` … is published only as `schemas.surf_nearshore` and, measured 2026-08-07, that field
> has **zero consumers**: no frontend reference and no backend branch.

**CODE FACT, contradicting it.** `frontend/src/components/map/forecastCardCompiler.js:330-331`:

```js
const _near = useExactPoint?.surf_nearshore;
if (_surf != null && _reg && !_hidden && _near !== false) {
```

`surf_nearshore` gates the Surf row. It is also mapped at `backendWeatherServiceClientPoint.js:553`
and `forecastSamplers.js:454`, and there are four tests pinned to the behaviour
(`frontend/src/tests/forecast-card-swell-vs-surf.test.js:114-126`).

Low severity — it changes no served number. Recorded because the comment is the kind of statement
a future reader would act on ("nothing reads it, so promoting it is free"), and it is wrong. Per
the standing rule *a WRONG memory is worse than none*: this line should be edited, and the edit
should note that a "zero consumers" claim needs a dated grep next to it or it decays.

---

## 2. Positive controls — what the repo already does right

Listing these is not politeness; without them the report would read as "this codebase never
discloses anything", which is false and would misdirect the fix.

| Mechanism | Location | What it proves |
|---|---|---|
| `(est.)` suffix on height/period/direction | `forecastCardCompiler.js:133,298,304` | point-level `is_estimated` **does** reach the user |
| `(latest)` suffix on a stale point | `forecastCardCompiler.js:295,298` | a stale sea state is marked |
| "Showing +N h — the furthest this model carries" | `modelProvenance.js:97-116`, rendered `MapForecastOverlay.js:752-761` | axis-clamp disclosure, in **words not colour**, and it *refuses on placeholder data* (line 91-96) rather than manufacture a false banner |
| Model-substitution banner | `modelProvenance.js:72-80`, rendered `MapForecastOverlay.js:763-773` | a model swap is disclosed |
| `forecast_confidence` dot + prose + `aria-label` | `SpotHub.js:440-462`, `SpotConditions.js:234-309` | **the exact component S3-01 needs already exists** |
| `fallback_safe_zero` grid is rejected, not painted | `RenderPlanDispatcher.js:507-509`, `marineControllerCache.js:322` (`__renderable: false`) | a known-bad grid does not reach the screen as "calm" |
| `sim_spots` carries `identity_source` (`live_catalog` \| `surf_spots_snapshot`) | `sim_spots.py:212-220,312-348` | the sim's catalogue fallback names itself |
| `far_edge_hold` relabels the held frame | `far_edge_hold.py:82-89` | a held frame is marked `is_estimated` at the source |

The pattern across all seven: **the repo discloses well whenever the disclosure travels on the same
object as the number.** Every finding above is a case where the disclosure travels on a *side
channel* — a `window.__` global, a `logger.debug`, a field with no renderer — and side channels are
where refusals go to die.

---

## 3. The generalised rule, and the three tests that would have caught all of this

The CI defect and every finding here are the same shape:

> **A signal whose only consumer is optional is not a signal.**
> The html reporter's stdout, a `logger.debug` line, a `window.__X__` global, a payload field with
> no renderer, and a warning gated to one model × three layers are all the same construct: a
> channel that a reader is not *required* to look at, and therefore will not.

Three cheap, mechanical guards — each of which is a *count*, a *control*, or a *denominator*,
per the repo's own rule that no green suite ever caught one of these:

1. **Producer/consumer parity on the payload.** For every field a Pydantic response model declares,
   assert it is either (a) referenced by a component under `frontend/src/components/`, or (b) on an
   explicit `KNOWN_UNRENDERED` allowlist with a dated reason. `pointFieldWhitelistParity.test.js`
   already does exactly this **one layer too early** — it stops at the mapper. Extend it one hop.
   Would catch S3-01, S3-08.

2. **`window.__X__` write-without-read census.** The script in `S3-diag-globals-scan.txt`, run in
   CI with a ratchet: 92 today, and it may not grow. Would catch S3-07, S3-10, and the nine
   orphaned counters.

3. **No silent default on a rating input.** Ban `except: pass` / bare-default assignment in
   `surf_rating.py`, `surf_point.py`, `point_surf_augment.py`, `spot_ratings.py` unless the handler
   also writes to a `degraded` accumulator that ends up on the response. Would catch S3-02, S3-04,
   S3-05, S3-06 — and, notably, would have caught the 2026-07-30 `NameError` that
   `point_surf_augment.py:245-252` documents, without needing anyone to remember to run one
   specific test.

**★ The asymmetry worth naming:** every silent default measured here is **optimistic**. Blind
geometry → full exposure (+63.6). Missing wind → neutral wind (+52.2). Failed coastal check →
`coastal = True`. Failed gate → ungated score. Nothing here fails toward "worse than reality"; a
degraded input consistently produces a *better-looking* forecast. That is the property that turns a
readability defect into a safety one, because the user acts on `good`, not on `very_poor`.

---

## 4. What I did NOT do

- I did not run the app, drive a browser, or reproduce any runtime failure. Every runtime
  consequence is labelled NOT MEASURED unless it appears under a MEASURED block above.
- The two MEASURED blocks are pure-function calls into `services.weather_pipeline.surf_rating`
  at HEAD (`compute_surf_rating`), no network, no DB, no flags changed.
- I did not measure how often any of the swallowing `except` blocks fires in production. That is
  currently unmeasurable by construction — which is the report's central point, not a gap in it.
- I did not enumerate all 342 empty `catch` blocks in `frontend/src` (100 files) or all 65
  `except: pass` in `backend/`. I triaged to the forecast-number path. The remainder are mostly
  cleanup/teardown (`fut.exception()`, `os.remove(tmp)`, `map.getBounds()`) and do not gate a
  displayed value. A full enumeration is a separate, larger sweep.
