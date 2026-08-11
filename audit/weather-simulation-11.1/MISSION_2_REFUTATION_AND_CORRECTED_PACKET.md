# MISSION 2 — REFUTED AT ITS STATED SEAM, AND THE CORRECTED PACKET

**Asked:** implement Mission 2 — *"bound `grid_series` at RESOLUTION, before `GridVector`
materialisation. Files: `grid_series_helper.py`, `series_vector_budget.py`."*

**Delivered:** the tests-first work that Mission 2 required, which **refuted the mission's stated
seam before any production code was written**; one narrow correction to the Mission 1 oracle that
the same measurements showed was over-claiming; and this corrected packet.

**Production code changed: none.**

---

## 1. Why I stopped — the one-line version

**The materialisation Mission 2 targets does not happen in the files Mission 2 names.** It happens
inside `resolve_grid`. And the only change reachable *within* the named files would make the oracle
go green **without saving a single allocation** — a fix that moves the measurement instead of the
quantity, which is the exact defect class this whole audit exists to catch.

---

## 2. The three measurements

### F-1 · Production: the cost is entirely in the COLD path

Same process, plateau verified flat before each call, byte-identical request:

| | wall | frames | `vectors_before_bound` | `vectors_total` | `bounded_at` | **RSS Δ** |
|---|---:|---:|---:|---:|---|---:|
| **call 1** (cold) | 26.6 s | 35 | **525,805** | 33,810 | `build` | **+210.9 MB** |
| **call 2** (identical) | 3.2 s | 48 | *none* | 14,400 | *none* | **+2.0 MB** |

**Ratio 0.01.** The repeat is 105× cheaper in memory and 8× faster.

⚠️ *Disclosed confound:* call 2 served a **different, coarser** product (300 cells/frame vs 966),
because call 1's hour-0 `warm_regional=True` schedules the regional-tile revalidation. So call 2 is
not a pure "same work, warm cache" repeat. The direction is unaffected and large — but the clean
version of this experiment needs a fixed product identity, and that is named in §5.

### F-2 · In-process: what a resolution-time bound would actually save, per regime

`ProductStore.load_product` on a cache **hit** (`store.py:663-667`):

```python
cloned = cached_product.model_copy()
if cloned.grid is not None:
    cloned.grid = cloned.grid.model_copy()     # BOTH SHALLOW
return cloned
```

`cloned.grid.vectors` **is** the list in `_product_cache`. Same harness, both regimes:

| regime | bound@resolution | **CONSTRUCTED** | before | served | peak MB |
|---|---:|---:|---:|---:|---:|
| WARM | – | **0** | 721,104 | 46,368 | 1.2 |
| WARM | 4 | **0** | 46,368 | 46,368 | 0.5 |
| COLD | – | 721,104 | 721,104 | 46,368 | 28.7 |
| COLD | 4 | **46,368** | 46,368 | 46,368 | 22.1 |

On a warm cache the bound saves **zero** constructions. On a cold cache it avoids **674,736 (94 %)**
— real and large, and consistent with F-1's 525,805 constructions ≈ 210.9 MB (≈ 420 B/vector of
arena high-water).

**So Mission 2 is worth doing. It is simply not doable where the packet said.**

### F-3 · Where the construction actually is

`resolve_grid` is **667 lines with 10 return sites**, shared with the single-hour `/grid` route, and
the vectors are built across `store.load_product` (deserialisation), `normalizer` (4 construction
sites), `estimator` (3), `lattice_fill` (2) and `route_helpers` (1) — then transformed again by
`apply_surf_overlay` and `fill_coarse_enclosed_sea_from_gfs_served`.

Nothing in `grid_series_helper.py` or `series_vector_budget.py` is upstream of any of that.

---

## 3. ⛔ The decisive argument: the reachable change would game the oracle

There *is* a change that fits inside the named files' reach — add an optional `stride` to
`resolve_grid` and apply it at the success return, just before the product goes back to
`_build_one`.

**Do not do this.** `_build_one` counts `bound["before"] += len(_g.vectors)` **after** `resolve_grid`
returns. Striding at the resolver's exit would make `vectors_before_bound` report the strided count,
drive the ratio to 1.00×, **turn the Mission 1 oracle green — and construct exactly as many
GridVectors as before.**

> ★★★ **A FIX APPLIED DOWNSTREAM OF THE MEASUREMENT POINT CHANGES THE MEASUREMENT, NOT THE COST.**
> It is the same shape as the `+0.0 MB` reading that started all of this: a number that could not
> have come out any other way. Shipping it would have retired the oracle and kept the defect —
> strictly worse than shipping nothing.

That is why this session stops here rather than delivering something that would pass.

---

## 4. What was changed instead — correcting my own oracle

The same measurements showed the Mission 1 oracle over-claimed. Its assertion message said the
ratio *"is the quantity that predicts the production RSS rise."* **True in the cold regime, false in
the warm one** — F-2 shows the ratio is 15.55× in both while allocation differs by 721,104.

Three narrow edits to `backend/tests/test_series_build_materialisation.py`:

1. A regime table in the module docstring, with the production cold-vs-warm figures.
2. The assertion message rewritten: *"work asked for"*, with both regimes named and a pointer to the
   table before anyone quotes it as bytes.
3. **A new test, `test_the_ratio_cannot_tell_warm_from_cold`**, which feeds the build a resolver
   returning the *same shared list* every hour — the cache-hit shape — and asserts the ratio comes
   out byte-identical to the cold one despite zero allocation. The limitation is now pinned by an
   executing test rather than by a caveat a reader skips.

**The oracle still fails at HEAD at 15.55×, for the right reason.** Its scope is now honest.

---

## 5. THE CORRECTED MISSION 2 PACKET

### Objective
Reduce **GridVector constructions** on a cold global series from ~525,000 to ~35,000, at the sites
that construct them.

### Root cause
The series lane cannot tell the resolver how coarse a grid it needs, so every hour is built at full
resolution and then decimated. On a cold cache that is ~15 constructions per vector served.

### The seam — and it is NOT the one the old packet named
A `stride` (or `max_cells`) hint threaded from `_build_one` into `resolve_grid`, honoured at the
**construction sites**, not at the return:

| file | why it must be touched |
|---|---|
| `services/weather_pipeline/grid_resolver.py` | accept + forward the hint (10 return sites) |
| `services/weather_pipeline/store.py` | `load_product` — deserialise strided on a cache MISS |
| `services/weather_pipeline/normalizer.py` | 4 `GridVector(` sites |
| `services/weather_pipeline/estimator.py` | 3 sites |
| `services/weather_pipeline/lattice_fill.py` | 2 sites |

⚠️ **This is a different risk class from the old packet.** It changes a resolver shared with
`/grid`, and it changes which cells are served. It is a Prototype-behind-a-flag mission, not a
surgical one.

### Non-goals
- ❌ the end-stage `apply_vector_budget` — still the only bound on the EURO and Open-Meteo fast paths
- ❌ striding at `resolve_grid`'s **return** — §3, this games the oracle
- ❌ `/grid`'s behaviour with no hint passed: must be byte-identical
- ❌ `PREFETCH_CONCURRENCY` / `MALLOC_*` — env, owner
- ❌ any physics constant, shader or GPU path

### Tests required BEFORE
1. A cold-regime construction counter: instrument `GridVector.__init__` (or count at the
   construction sites) and pin **525,805 → assert ≤ 40,000** after. This, not the ratio, is the
   quantity — Mission 1's oracle is a proxy and now says so itself.
2. A clean production repeat with **fixed product identity** (same bbox *and* the same served
   resolution on both calls), closing F-1's disclosed confound.
3. `/grid` golden: one hour, no hint → byte-identical response.

### Tests required AFTER
The above, plus: the Mission 1 oracle green **and promoted to `strict=True`**; the frame-count and
stride-parity goldens; the sim control bit-identical; the T-CAP-01 production protocol on a box
verifiably **below** its own peak.

### Rollback
One env kill switch defaulting to the current behaviour, plus the end-stage budget as the backstop.

### Completion
Cold-path constructions down ≥ 90 %; production RSS delta for one global series **< 40 MB** measured
on a settled box with headroom; `/grid` unchanged.

### Stop conditions
- **STOP** if the hint must be honoured at more than the five files above — the blast radius is then
  larger than the defect.
- **STOP** if `/grid` output moves by one byte with no hint passed.
- **STOP** if the oracle goes green while the construction counter does not fall. That is §3
  happening by accident, and it is the failure this packet exists to prevent.

---

## 6. Verification of the state left behind

| check | result |
|---|---|
| oracle file (now 5 tests) | 4 passed, **1 xfailed at 15.55×** — fails at HEAD, right reason |
| new limitation test | passes; pins warm-ratio ≡ cold-ratio |
| blast radius (6-file memory family) | **53 passed, 2 skipped (pre-existing), 1 xfailed, 0 failed** |
| science control | **BIT-IDENTICAL** — `3.3/68.1 · 5.8/84.5 · 17.6/84.5 · 30.6/55.7 · 29.5/59.8` |
| LOC ratchet | 276 lines; `Violations: 0` |
| lane partition | `partition OK: every tracked backend test file is claimed by exactly one lane` |
| production code modified | **none** |

**Gate D remains unlocked** (the oracle exists, fails correctly, and is now honest about its scope).
**Gate E (capacity) remains FAILED** — and Mission 2 is the thing that closes it, at the corrected
seam, as a flagged prototype rather than a surgical repair.
