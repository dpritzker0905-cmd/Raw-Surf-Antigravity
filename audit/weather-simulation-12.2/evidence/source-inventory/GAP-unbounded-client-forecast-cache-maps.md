# GAP — WIND_CACHE / PRESSURE_CACHE: module-scope forecast Maps with no eviction

Adversarial re-verification at HEAD `791fdf78` (branch `dev`). Default position was that the claim
was already covered or stale. It survived all four kill attempts.

## 1. Proof reproduced at HEAD

```
grep -nE 'WIND_CACHE\.(delete|size)' frontend/src/components/map/windController.js   -> 0 matches
grep -nE 'PRESSURE_CACHE\.(delete|size|clear)' frontend/src/components/map/marineControllerPressure.js -> 0 matches
```

Every `WIND_CACHE` reference at HEAD: `:14` declaration, `:164` / `:266` `get`, `:170` / `:278`
`for (const [key, entry] of WIND_CACHE.entries())`, `:331` `set`, `:443` `.clear()`.
Every `PRESSURE_CACHE` reference: `:17` declaration, `:165` `has`, `:166` `get`, `:254` `set`.

TTL is read-side only in both (`windCacheTtlMs(entry)` at `windController.js:23-25`;
`Date.now() - cached.timestamp < 300000` at `marineControllerPressure.js:167`). An expired entry is
never removed — it is only overwritten if that exact key is requested again. Growth is therefore
new-key growth, and both key spaces are viewport-coordinate-derived.

## 2. CORRECTION to the original claim — the finding is worse than stated

The claim describes the `.clear()` at `windController.js:443` as "on an explicit model reset". It is
not. At HEAD it is the body of `export function _resetWindCachesForTest()`, and:

```
grep -rn '_resetWindCachesForTest' frontend/src --include=*.js
  -> windController.js:442 (definition)
  -> __tests__/windControllerTerminalNocov.test.js:8,47
  -> __tests__/windModelPrewarm.test.js:15,44
```

Zero production callers. Positive control for that grep technique, same file, same export style:
`isRenderableWindData` resolves to non-test callers at `marineController.js:68` and
`WeatherEngine.js:2,549,551`. So **WIND_CACHE has no removal path of any kind in production** for
the life of the page.

## 3. Key cardinality is genuinely open-ended

- `WIND_CACHE` key: `` `${model}_wind_grid_${tileId}_${hourOffset}` `` (`windController.js:163`).
  `tileId` is `` `wind_viewport_fine_${fw}_${fs}_${fe}_${fn}` `` built with `Math.floor`/`Math.ceil`
  (`backendWeatherServiceClientCoverage.js:293-296, 302` and `:337-340, 347`) — an **integer-degree
  lattice**, so panning mints a new key roughly every degree of net travel beyond the pad.
- `PRESSURE_CACHE` key: `viewportCacheKey(bounds, ...)` snaps to **half-degree**
  (`marineControllerUtils.js:293` — `Math.round(v * 2) / 2`).
- `hourOffset` is the scrubber position, `0..24*forecastDays` (`forecastDays = 3` default,
  `WeatherEngine.js:22`).

Cardinality is therefore (distinct snapped viewports) x (hours scrubbed) x (models selected), and
each value is a full grid — the vector arrays these entries hold are the payload, not a scalar.

The `:170` / `:278` full-Map scans run on every exact-key miss, i.e. on every scrub step, over the
same monotonically growing Map. Per-entry work is a short-circuiting `startsWith`, so **memory is the
dominant harm and the O(n) scan is secondary** — the claim's emphasis is slightly overstated there.

## 4. The asymmetry is the point

The sibling marine cache in the same subsystem is a deliberate `LRUMap(50)`
(`marineControllerCache.js:65-107`, `PER_MODEL_HOUR_CACHE_MAX = 50`) with recency reordering *and* a
bounded eviction-tombstone set so a later miss can report `evicted` vs `exact_key_absent`. The
design exists, is sophisticated, and two of the weather layers simply do not use it.

## 5. Census — I tried to EXPAND this and the expansion died

Enumerated every module-scope `new Map()` under `frontend/src/components/map` and checked each for a
removal call:

```
for f in $(grep -ln '^\(var\|const\|let\) [A-Za-z_]* = new Map()' *.js); do ... grep -c "$v\.delete" ... done
```

That census initially flagged four more (`_dwdCache`, `_advectMotion`, `_advectOut`,
`_advectDecoded`, all `radarTileRecolor.js`). **All four are false positives:**

- The three `_advect*` Maps are pruned by `advPrune(map)` at `radarTileRecolor.js:467-471` against
  `ADVECT_CACHE_MAX`, called at `:459, 495, 535, 566`. My per-name regex missed it because the
  delete happens through a generically-named helper parameter — the rebound-name trap.
- `_dwdCache` (`:133`) is keyed by a packed 24-bit RGB value from a fixed radar palette
  (`:143` `(r << 16) | (g << 8) | b`) — a memoization table over a finite colour domain, bounded by
  construction.

`clientGridCache` (`copernicusGridFetcher.js:42`) and `_iconAnchorCache`
(`backendWeatherServiceClientHelpers.js:398`) both carry real TTL sweeps that call `.delete`
(`:423-425` and `:416-419`).

**Result: the class is exactly the two Maps named. The claimant's scope was correct and my attempt to
widen it failed.**

## 6. Coverage diff — why no register row kills this

- Task registers 12.1 (65 rows) and 12.0: no row names either symbol; synonym sweep over
  `memor|leak|evict|unbounded|LRU|heap|retain|dispos|cleanup` returns only WS-CAN-0001 (marine
  fallback re-drive), 0013 (GPU dispose), 0022 (RAF/lifecycle residuals) — all **handle ownership**,
  not data-structure growth.
- WS-CAN-0022 / WS-OBJ-301 / SOTA A11: closure criterion is *"Every RAF has a cancel path"*, closure
  evidence *"activeRafCount 0 with no weather layer active"*. A Map cannot satisfy or violate it.
- **WS-OBJ-303 "Bounded memory" is the near-miss that matters, and it does not cover this.** Its
  Intended Outcome is *"Peak RSS stays clear of the cgroup limit"*, its Architecture Owner is
  *"Render cgroup 2048 MB"*, and its **Canonical Task IDs field is `-` — zero tasks**. Its evidence
  LV-01 is a backend `/api/health` read (peak RSS 1,243.2 MB of 2,048 MB). SOTA A16 likewise grades
  *"No route above 10 s at the median; peak RSS under an agreed bound"*.
- `FINISH_LINE_GAP_MATRIX.csv:23` marks WS-OBJ-303 `VERIFY NOW`, and
  `WEATHER_SIM_OBJECTIVE_CLOSURE_AND_FINISH_LINE_AUDIT_12.1.md:434` lists it among **"Four objectives
  [that] can close with zero production edits"**.
- `STOP_DEFER_REJECT_NOT_NECESSARY.md`: never considered and rejected (positive control: the file
  does contain 16 `WS-CAN` references, so the search technique reads it).

**The blind-spot shape:** the program's only memory objective is named correctly but instrumented
exclusively on the server, carries no tasks, and is queued to close on a backend RSS reading. A
browser-side unbounded Map is structurally invisible to that closure.

## 7. Not a symptom of a tracked task

Different file, different mechanism (data-structure growth vs resource-handle ownership), different
closure evidence. WS-CAN-0064 is a backend route-latency row. Nothing in `git log --oneline -40`
touches these caches; `git log -S 'WIND_CACHE'` last lands at `3a5435c3`, `git log -S
'PRESSURE_CACHE'` at `b5fad579` — both well before the 12.x program.

## 8. Acceptance criterion (class-based, not "fix these two")

Stating an exact count in prose is the recurring defect here, so closure must be enumerative:

1. A test that **enumerates** module-scope forecast-payload Maps under
   `frontend/src/components/map` and **fails for any without a per-entry removal path**, resolving
   removal through helpers (an `advPrune`-style indirection must count as bounded, or the test
   re-runs my false positive).
2. `WIND_CACHE` and `PRESSURE_CACHE` given a declared cap and eviction — reuse
   `marineControllerCache.LRUMap`, do not re-derive it.
3. A runtime assertion after a scripted pan+scrub session (N distinct viewports x M hours) that each
   cache's `.size` stays `<= cap`.
4. **Positive control: the test must FAIL when a cap is raised to `Infinity`.** Without that, the
   guard is a refusal-you-cannot-read.

Suggested attachment: a new WS-CAN under **WS-OBJ-303**, which today has zero canonical tasks —
and WS-OBJ-303 must not close on a backend-RSS-only reading while this is open. Gate 5.
