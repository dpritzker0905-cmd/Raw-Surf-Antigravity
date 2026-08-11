# MISSION 1 — EXECUTION RECORD

**Delivered:** `backend/tests/test_series_build_materialisation.py` (216 lines, 4 tests)
**Production code changed:** **none.** No serving code, no constants, no flags, no shaders, no
`ci.yml`, no dependencies.
**Branch:** `dev` · **tree HEAD:** `518485cf` · staged by path, not committed.

---

## 1. The oracle fails at HEAD, for the right reason

```
tests/test_series_build_materialisation.py::test_the_build_materialises_far_more_than_it_serves XFAIL
tests/test_series_build_materialisation.py::test_a_small_viewport_materialises_exactly_what_it_serves PASSED
tests/test_series_build_materialisation.py::test_tracemalloc_cannot_see_this_defect_and_that_is_the_point PASSED
tests/test_series_build_materialisation.py::test_both_numbers_stay_on_the_wire PASSED
```

An `xfail` that fails for the *wrong* reason is a false comfort, so the assertion was read directly
with `--runxfail`:

```
E  AssertionError: the build materialised 721,104 vectors to serve 46,368 -- 15.55x.
   Only CONCURRENCY=4 grids are legitimately in flight, so anything above ~2.5x is allocation
   the response bound throws away.
E  assert 15.55175983436853 <= 2.5
```

**15.55 vectors materialised for every one served**, deterministic, no timing and no allocator.

---

## 2. THE PACKET WAS WRONG TWICE, AND THE FORENSICS CAUGHT BOTH

### 2.1 `tracemalloc` cannot see this defect — refuted before it was built on

The packet specified sampling `tracemalloc.get_traced_memory()[1]` as the measurement. Probed first:

| | vectors materialised | tracemalloc PEAK live | if all were live |
|---|---:|---:|---:|
| global 181×83 ×48 | 721,104 | **28.7 MB** | ~468 MB |
| small 20×10 ×48 | 9,600 | 4.7 MB | — |

`tracemalloc` reports **live traced bytes**, and the retention bound genuinely works — only
`CONCURRENCY` grids are alive at once. So it reads "well bounded" while the churn that raises the
process high-water is invisible to it. **An oracle built on it would have passed.**

> ★ The instrument that looks obvious for a memory defect measures *live* bytes; the defect lives in
> *freed-but-unreturned* bytes. Probe the instrument before you trust it as the gate.

That finding is now pinned as `test_tracemalloc_cannot_see_this_defect_and_that_is_the_point`, so a
future reader who "improves" the file by switching to tracemalloc is told why not.

### 2.2 "Register it in BOTH `ci.yml` list sites" — a no-op, and the real list is elsewhere

`tests/test_series_*.py` is **already** in both `ci.yml` sites, so a new `test_series_*` file needs
no workflow edit. Editing anyway would have added redundant entries to a list whose duplication is
already the recorded defect.

**And a third copy exists that nobody has been maintaining** — see §5.

---

## 3. Mutation battery — 5/5

An oracle that cannot fail *both* ways is a tripwire pointing one direction. All five arms run
in-process; no production file was edited.

| arm | expectation | result |
|---|---|---|
| **M1** simulate Mission 2 (resolver returns an already-strided grid) | oracle must go **GREEN** | **CAUGHT** — ratio **1.00×** (46,368 / 46,368) |
| **M2** disarm the retention bound (`_apply_build_stride` → no-op) | tracemalloc control must go **RED** | **CAUGHT** — peak **341.3 MB** vs 446 MB all-live |
| **M3** force a small viewport to be bounded (`SERIES_VECTOR_BUDGET=100`) | positive control must go **RED** | **CAUGHT** |
| **M4** drop the wire diagnostic (`stamp_build_time_bound` → identity) | wire check must go **RED** | **CAUGHT** |
| **M5** baseline restored | back to the HEAD result | **CAUGHT** — 15.55×, `bounded_at=build` |

**M1 is the one that matters most:** it proves the assertion is *satisfiable*, so the test will
xpass the day Mission 2 lands rather than being an unreachable bar.

**M2 independently corroborates the audit's mechanism.** Disarming retention sends tracemalloc peak
28.7 → **341.3 MB**, a 12× rise. So retention *is* genuinely bounded, and the production RSS rise is
therefore **not** retention — which is exactly what Audit 11.1 concluded from the production side,
now confirmed from the code side by an independent route.

---

## 4. Jacobian of the change

Every coupling measured, not reasoned about.

| # | coupling | measured | risk |
|---|---|---|---|
| J-1 | **science chain** | ONE FORECAST COMPOSITION control **bit-identical**: `3.3/68.1 · 5.8/84.5 · 17.6/84.5 · 30.6/55.7 · 29.5/59.8` | none |
| J-2 | **composition coverage ratchet** | floors are `<` comparisons (shrink-only), `MIN_FILES=110`, `MIN_PASSED=1235`. Change adds +1 file, +3 passed, +1 skip — both floors move **up** | none |
| J-3 | **LOC ratchet (max 800)** | real run: `Scanned 612 files, Violations: 0`, exit 0. My file 216 lines | none |
| J-4 | **`tracemalloc` in a shared process** | zero other backend tests use it — no conflict; `start()`/`stop()` wrapped in `try/finally` | none |
| J-5 | **`SERIES_VECTOR_BUDGET` in CI** | not set in any workflow ⇒ default 80,000 holds, so the 721,104 / 46,368 anchors are stable | none |
| J-6 | **junitxml: does `xfail` turn CI red?** | parsed exactly as the ratchet does: `55 tests, 52 passed, 3 skipped, 0 failed, 0 errors`. **xfail lands in `skipped`, and CI reds only on `fails or errs`** | none |
| J-7 | **test ordering** (the recorded `d4ce3397` trap) | three arms — mine first / last / alone — all identical: `37 passed, 1 xfailed` / `37 passed, 1 xfailed` / `3 passed, 1 xfailed` | none |
| J-8 | **CI lane assignment** | `ls tests/test_series_*.py` selects it; the chain lane's inline literal excludes it ⇒ **exactly one lane** | none |
| J-9 | **blast radius** (the whole memory-safety family) | 6 files: `52 passed, 2 skipped (pre-existing), 1 xfailed, 0 failed` | none |
| J-10 | **partition guard's model** | `--assert-partition` reports OK but assigns the file to **chain**, not composition — its `COMPOSITION` copy is stale | **see §5** |

---

## 5. ⛔ FOUND WHILE VERIFYING: the composition list exists THREE times, and the third is stale

The 2026-08-10 audit recorded *"the composition file list exists **TWICE** in `ci.yml` … EDIT BOTH,
ALWAYS"* and fixed both. **There is a third copy, and it was never updated.**

| # | location | patterns |
|---|---|---:|
| 1 | `.github/workflows/ci.yml` — composition lane `ls` selector | 47 |
| 2 | `.github/workflows/ci.yml` — chain lane inline `COMPOSITION = [...]` | 47 |
| 3 | **`backend/scripts/ci_test_lanes.py` — `COMPOSITION = (...)`** | **41** |

Site 3 is missing exactly the six memory-safety patterns `c7099d0a`/`6e5bf70a` added to 1 and 2:

```
tests/test_series_*.py          tests/test_dyncache_*.py
tests/test_product_cache_*.py   tests/test_health_peak_memory.py
tests/test_cold_start_*.py      tests/test_manifest_concurrent_merge.py
```

**CI execution is correct today** — composition picks them up via the `ls` glob, chain excludes them
via its own literal, nothing double-runs. **The harm is in the guard.**
`python scripts/ci_test_lanes.py --assert-partition` — whose entire job is to prove the partition —
models those six patterns as belonging to the **chain** lane, and reports `partition OK` while
describing a split CI does not execute. If anyone later removed the family from the chain lane's
inline literal while leaving the `ls` selector, CI would run them in **both** lanes and
`--assert-partition` would **still** report OK, because its own model never had them in composition.
That is precisely the double-count class `c7099d0a` caused.

`test_flag_lane_parity` pins sites 1 and 2 equal, which is why the *pair* stayed consistent and why
nothing noticed the third.

> ★★★ **THE GUARD THAT POLICES A DUPLICATION KNEW ABOUT TWO OF THE THREE COPIES.** Same shape as the
> defect it exists to prevent, one level up: a census that cannot see the whole population.

**Deliberately NOT fixed here** — Mission 1's scope is one test file and nothing else. Filed as a
separate task with both a minimal and a better (single-source-of-truth) option.

---

## 6. A second instrument trap this work walked into

`--assert-partition` was run *before* the new file was staged and reported `tracked 484 … partition
OK`. `ci_test_lanes.py` enumerates via **`git ls-files`**, so an untracked file is invisible to it:
that green was about 484 files that **did not include the new one**. Staging by path (never `-A`,
per the shared-tree rule) took it to `tracked 485`, and only then did it become evidence.

> ★ **A GREEN FROM A CENSUS THAT CANNOT SEE THE NEW ASSET IS NOT EVIDENCE ABOUT THE NEW ASSET.**

---

## 7. Completion criteria

| criterion | status |
|---|---|
| The test fails at HEAD, and the failure prints the measured cost | ✅ 15.55×, printed |
| The positive control passes in the same run | ✅ ratio 1.00× |
| The file is selected by exactly one CI lane | ✅ composition (via `ls`), excluded from chain |
| Partition guard green **with the file visible to it** | ✅ `tracked 485 … partition OK` |
| The composition lane is green apart from the intended `xfail` | ✅ blast radius `0 failed`; xfail counted as `skipped` |
| The sim control is bit-identical | ✅ all five pairs |
| No production code modified | ✅ one new test file only |

**Gate unlocked: GATE D (regression protection) for the capacity workstream.**
**Mission 2 (bound at RESOLUTION, before `GridVector` materialisation) is now authorized** — it will
be provable, and M1 shows the target it must hit: ratio **15.55× → ~1.0×**.

⚠️ **Promote the oracle to `strict=True` the day Mission 2 lands.** Otherwise the regression back is
silent, which is how this defect survived in the first place.

---

## 8. Deviations from the packet, and why

| packet said | done instead | reason |
|---|---|---|
| `test_series_build_peak_memory.py` | `test_series_build_materialisation.py` | The name should describe what it asserts. Peak memory was refuted as the measurable (§2.1). |
| sample `tracemalloc` peak as the gate | count ratio as the gate; tracemalloc pinned as a *control* | Measured: tracemalloc cannot see the defect. |
| sample RSS via `resource`/`psutil` | not used | In-process RSS tracked tracemalloc closely (26.4 vs 28.7 MB) — it reproduces neither the production magnitude nor the mechanism, and it would add platform flake for no signal. |
| register in both `ci.yml` sites | no `ci.yml` edit | `tests/test_series_*.py` already matches both; editing would add redundancy to the very list whose duplication is the recorded defect. |
| a warm-up call before measuring | kept in the probe, dropped from the test | The gate is a deterministic count; a warm-up only matters for byte measurements, which are no longer the gate. |
