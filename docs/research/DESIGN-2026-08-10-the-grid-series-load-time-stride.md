# The `grid_series` load-time stride — why it exists and why it sits where it sits

Relocated from `services/weather_pipeline/store.py` and `grid_series_helper.py` so the 800-LOC
ratchet measures code rather than rationale. **Nothing here was deleted; the code keeps one-line
pointers back to this file.**

---

## 1. The defect

`grid_series` decimates each hour as it lands (`_apply_build_stride`, shipped `0d9149b7`). That
bounds **retention** — measured, live peak drops ~12× when it is armed, and disarming it in a
mutation arm sends `tracemalloc` peak 28.7 MB → 341.3 MB. It cannot bound **allocation**, because
by the time the series sees a product every cell is already a `GridVector`.

Production, same process, plateau verified flat between calls, byte-identical request:

| | wall | `vectors_before_bound` | **RSS Δ** |
|---|---:|---:|---:|
| call 1 (cold) | 26.6 s | **525,805** | **+210.9 MB** |
| call 2 (repeat) | 3.2 s | *none* | **+2.0 MB** |

≈ **420 B of resident growth per vector constructed**, and a repeat that constructs almost nothing
costs almost nothing. The construction is the cost.

## 2. Why the cost is invisible to the obvious instruments

| instrument | reads | why it misses this |
|---|---|---|
| `tracemalloc` peak | **live** traced bytes | the retention bound works, so live stays ~29 MB while 721,104 models are churned |
| `vectors_before_bound / vectors_total` | cells **asked for** | identical (15.55×) in the warm and cold regimes, which differ by 721,104 allocations |
| `rss_mb` delta on a saturated box | high-water | **cannot rise past itself** — this is why the original fix measured `+0.0 MB` |

Measured, same harness, both regimes:

| regime | bound@resolution | **constructed** | before | served |
|---|---:|---:|---:|---:|
| WARM (cache hit) | – | **0** | 721,104 | 46,368 |
| COLD (cache miss) | – | 721,104 | 721,104 | 46,368 |
| COLD | 4 | **46,368** | 46,368 | 46,368 |

`ProductStore.load_product` on a hit returns `model_copy()` of both product and grid, **both
shallow** — so `grid.vectors` *is* the cached list and nothing is constructed.

## 3. The seam

`load_product` parses JSON and calls `NormalizedProduct.model_validate(data)`. That line is where
cells become models. Striding the **raw dicts** first means the discarded cells are never modelled.
Doing it one line later shrinks the document and leaves the cost — which is the defect, not the fix.

`grid_series` knows the stride once hour 0 resolves, and every remaining hour is going to be
decimated by exactly that number anyway. So it says so up front.

## 4. Four hazards, each with a guard

### 4.1 Cache poisoning — the worst available failure
`_product_cache` is read by the point lane, spot ratings and the coarse gulf fill, and
`load_product` hands out shallow copies. A decimated product under the full grid's key would be
silently wrong for every later reader, on a fraction of requests: intermittent, silent, and wrong
rather than absent.
**Guard:** strided reads use their own key, `filename#sN`. Pinned in both orders by
`test_a_strided_load_never_poisons_the_full_grid_cache` and its twin.

### 4.2 Double decimation
The build loop strides every hour as it lands. A grid that arrived **already** strided gets strided
again — measured, 966 cells → 72, a stride² grid and a 13.89× ratio that looked like the fix had
failed. Geometry cannot distinguish "already decimated by 4" from "natively this small".
**Guard:** the resolver stamps `grid.diagnostics.load_stride`; the loop keys off that stamp, never
off geometry. `test_the_series_loop_forwards_the_stride_to_the_resolver` caught this on first run.

### 4.3 A hit advertising itself as bounded
`bound["stride"] == 1` with an unstamped grid also yields `_load_stride_of() == 1`, so an unbounded
series took the "already strided" branch and stamped `decimated_stride: 1` on every frame of a
viewport that was never decimated.
**Guard:** the branch requires `bound["stride"] > 1`.
`test_a_small_viewport_is_never_decimated` caught it.

### 4.4 Breaking existing callers and doubles
`load_product` has **36 references across 18 files**. Passing `stride` unconditionally — even as
`None` — breaks any double whose signature is `load_product(self, filename)`. Two mid-res-tier
tests failed exactly that way.
**Guard:** `_load_kw()` emits `{"stride": n}` only when a stride is actually wanted. A store that
never receives the kwarg cannot behave differently because of it.

## 5. What is deliberately NOT covered

* **Hour 0** always builds a full grid — its geometry is what *chooses* the stride. It is the one
  full grid the series still pays for, by construction.
* **The dynamic-viewport fast path** (`viewport_service.get_cached_dynamic_product`) is untouched.
  Only the durable-product lanes honour the hint.
* **The end-stage `apply_vector_budget`** is unchanged — it is still the only bound on the EURO and
  Open-Meteo fast paths.

## 6. Kill switches

| switch | effect |
|---|---|
| `SERIES_LOAD_STRIDE=0` | `_effective_load_stride` pins the answer to 1 — the whole feature inert, no deploy needed |
| `SERIES_VECTOR_BUDGET=0` | disables `stride_for`, so the series never requests a stride in the first place |

`_effective_load_stride` fails **open** (returns 1) on anything unparseable: a load-time bound must
serve the full grid when in doubt, because failing closed would silently serve a coarser forecast.

## 7. One quantity, one expression

Both the load-time and build-time paths select cells through `series_vector_budget.decimate_vectors`
with a stride from `stride_for`. Two independent implementations of the same selection is the
recorded *ONE QUANTITY, TWO FLOORS* class, and here it would mean a single series page mixing two
griddings. `test_the_strided_load_matches_decimate_vectors_cell_for_cell` pins them equal.
