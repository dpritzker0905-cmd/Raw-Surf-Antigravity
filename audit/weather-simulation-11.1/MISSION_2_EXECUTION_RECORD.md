# MISSION 2 — EXECUTION RECORD (corrected packet)

**Objective:** stop `grid_series` constructing ~525,000 `GridVector` models it immediately throws
away, at the site that constructs them.

**Result: shipped.** A cold global 48-hour series now materialises **60,425** cells instead of
**721,104** to serve 46,368 — a **15.55× → 1.30×** materialisation ratio, with hour 0 the one full
grid it still pays for by construction.

---

## 1. TEST BEFORE

| check | before |
|---|---|
| M1 oracle | **xfail at 15.55×** — right reason, read with `--runxfail` |
| memory-safety family (6 files) | 52 passed, 2 skipped, 1 xfailed |
| science control | BIT-IDENTICAL |
| LOC / partition | `Violations: 0` / `partition OK` |
| **new construction gate** | **7 failed / 1 passed** — `load_product() got an unexpected keyword argument 'stride'` |

The one *passing* test in that last row is the control (`no stride → unchanged`), which is what
proved the harness worked before the feature existed.

### Two harness bugs the gate found on itself, before it was trusted

1. **`ProductStore(cache_dir=str)` raised `TypeError`** — the store does `self.cache_dir /
   "manifest.json"`. All eight tests **ERRORed** rather than failed, and an error is not a
   reproduction.
2. **The fixture omitted 8 required `NormalizedProduct` fields**, so `model_validate` rejected it.
   *A fixture that cannot occur disarms the guard downstream of it.*

---

## 2. THE MEASUREMENT THAT PICKED THE SEAM

Production, same process, plateau verified flat between calls, byte-identical request:

| | wall | `vectors_before_bound` | **RSS Δ** |
|---|---:|---:|---:|
| call 1 (cold) | 26.6 s | **525,805** | **+210.9 MB** |
| call 2 (repeat) | 3.2 s | *none* | **+2.0 MB** |

≈ **420 B resident per vector constructed.** In-process, both cache regimes:

| regime | bound@resolution | **constructed** | before | served |
|---|---:|---:|---:|---:|
| WARM (cache hit — shallow copy, shared list) | – | **0** | 721,104 | 46,368 |
| COLD (cache miss — `model_validate`) | – | 721,104 | 721,104 | 46,368 |
| COLD | 4 | **46,368** | 46,368 | 46,368 |

⇒ the seam is `NormalizedProduct.model_validate(data)` in `load_product`. Striding the **raw dicts**
one line earlier means the discarded cells are never modelled.

---

## 3. WHAT SHIPPED

| file | change |
|---|---|
| `series_vector_budget.py` | `effective_load_stride()` + `stride_raw_grid_dicts()` — one module owns the stride |
| `store_helpers.py` | `load_product_helper()` — `load_product`'s body, extracted (see §5) |
| `store.py` | `load_product(filename, stride=None)`; strided reads use their own cache key `filename#sN` |
| `grid_resolver.py` | `resolve_grid(..., series_stride=None)` → 3 durable-product load sites via `_load_kw()` |
| `grid_series_helper.py` | forwards the stride for hours 1..N; `_load_stride_of()` prevents double decimation |
| `routes/weather.py` | `series_stride` query param, `include_in_schema=False` |

**Kill switches:** `SERIES_LOAD_STRIDE=0` (inert everywhere) and `SERIES_VECTOR_BUDGET=0`
(no stride is ever requested). `_effective_load_stride` fails **open** — a load-time bound must
serve the full grid when in doubt, because failing closed silently serves a coarser forecast.

**Not covered, deliberately:** hour 0 (its geometry *chooses* the stride), the dynamic-viewport fast
path, and the end-stage `apply_vector_budget`.

---

## 4. FOUR BUGS THE TESTS CAUGHT IN MY OWN IMPLEMENTATION

| # | bug | caught by | symptom |
|---|---|---|---|
| 1 | **Double decimation** — I wrote in a comment that re-striding a pre-strided grid "is a no-op". It is not. | the wiring test, first run | 966 cells → **72**, ratio 13.89× — looked like the fix had failed |
| 2 | **A hit advertising itself as bounded** — with `stride == 1` and an unstamped grid, `_load_stride_of() == 1` matched, stamping `decimated_stride: 1` on every frame of a viewport never decimated | `test_a_small_viewport_is_never_decimated` | a HIT claiming it was bounded |
| 3 | **Broke two test doubles** — passing `stride` positionally broke `load_product(self, filename)` doubles | 2 mid-res-tier tests | `TypeError: takes 2 positional arguments but 3 were given` |
| 4 | **Extraction dropped 5 names** — the moved body referenced `ProductStore`, `WEATHER_BUCKET`, `_get_supabase_storage`, and both stride helpers | wide blast radius | **24 failures**, `NameError` |

Bug 1 is the one worth keeping: **a comment asserting a no-op is an assumption, not a fact.** The
fix is a `diagnostics.load_stride` stamp read by the consumer — geometry cannot distinguish
"already decimated by 4" from "natively this small".

Bug 4 was found by the *wide* run; a targeted run over the new file alone also caught it, but only
because the extraction broke everything. Bug 3 would have been invisible without the wide run.

---

## 5. THE LOC RATCHET FORCED A REFACTOR, AND THAT IS WORTH RECORDING

`store.py` sat at **exactly 800** lines — the hard limit. **Any** addition breaks CI. Two rounds of
comment-trimming got 891 → 834, still over.

The resolution follows the file's own established pattern (`save_product_helper`,
`restore_from_supabase_helper`): `load_product`'s 140-line body moved to
`store_helpers.load_product_helper`, leaving a 9-line delegator. Rationale relocated to
`docs/research/DESIGN-2026-08-10-the-grid-series-load-time-stride.md` — **relocated, never
deleted**, per the standing rule that the ratchet measures documentation.

`store.py`: **800 → 704.** `Violations: 0`.

---

## 6. TEST AFTER

| check | after |
|---|---|
| **construction gate** (9 tests incl. wiring) | **9 passed** |
| **mutation battery** (6 arms) | **6/6 CAUGHT** — neuter the seam · drop the stamp · poison the cache · disarm the kill switch · stop forwarding · restore |
| wide blast radius (12 globs, store/series/grid/point/spot/weather/marine) | **421 passed, 2 skipped, 1 xfailed, 0 failed** |
| science control | **BIT-IDENTICAL** — `3.3/68.1 · 5.8/84.5 · 17.6/84.5 · 30.6/55.7 · 29.5/59.8` |
| LOC ratchet | **Violations: 0** (612 files) |
| lane partition | **partition OK** |
| `/grid` with no hint | `series_stride` default `None`, `include_in_schema=False` — unchanged for all 36 existing callers, pinned by 3 parametrised tests |

### The M1 oracle stays xfail — and its reason was corrected

Its fake resolver deliberately does **not** accept `series_stride`, so it now measures the lane the
fix does **not** cover (the dynamic-viewport fast path), still at 15.55×. The stale instruction
"promote to strict the day Mission 2 lands" was replaced with an accurate one: do not promote until
that lane is bounded too. **Leaving it would have been the stale-comment class, in a file written
this session to fight exactly that.**

The end-to-end proof lives in
`test_series_load_stride.py::test_the_series_loop_forwards_the_stride_to_the_resolver`, which drives
the real build loop with a hint-honouring resolver: hour 0 gets no stride, hours 1..47 all get 4,
and the ratio lands at **1.30×**.

---

## 7. What is NOT proven

- **No production measurement of the change.** The +210.9 MB figure is pre-change. This has not
  been deployed, and the audit rule stands: *a fix recorded in a handoff is not a fix applied.*
  The T-CAP-01 protocol must be re-run on a settled box **with headroom** after deploy.
- **The dynamic-viewport lane is untouched** and still materialises everything it serves.
- **`PREFETCH_CONCURRENCY` / `MALLOC_*` remain unset** on the live box — owner action, 7 days open,
  and still the multiplier on whatever transient survives.
- Local interpreter is env-parity-flagged (python 3.14 vs declared 3.12, 28/46 pins differ); CI is
  authoritative.

**Nothing is committed or pushed** — every push to `dev` is a production deploy.
