# HANDOFF 2026-08-11 — the OOM attributed, the flip validated, and four instruments that lied

**Branch:** `dev` · **Session tip:** `30b969bc` · **Owner-visible outcome:** the serve box went from
26 OOM kills to zero and now idles at ~58 % of cap, and the map's default wave height was proven —
not assumed — to agree with the buoy-scored lane to **0.4 mm**.

⚠️ A **concurrent session worked this tree the whole time**: 6+ commits and ~10 deploys landed
during my measurement windows. Everything below was staged BY PATH. Their handoff
(`HANDOFF-2026-08-10-the-oom-the-instruments-that-lied-and-a-flag-flipped.md`) is the companion to
this one and should be read alongside it.

---

## §0 READ THIS FIRST — what will bite you

1. ⛔⛔ **A DELTA MEASURED AGAINST A SATURATED HIGH-WATER MARK READS ZERO BY CONSTRUCTION.** The
   `0d9149b7` OOM fix was recorded as `+170.3 MB → +0.0 MB`, "PROVEN IN PRODUCTION". It was measured
   on a box already at its own `peak_rss_mb`, where a +157 MB transient cannot move either
   `rss_mb` or `peak_rss_mb`. Re-measured on a box **with headroom** it was **+156.7 / +201.6 /
   +812.8 MB**. Before quoting any RSS delta, check the process is ≥50 MB below its own peak.

2. ⛔⛔ **MATCH THE LOAD, NOT THE CLOCK** (theirs, and it lands on me). RSS tracks
   `disk_product_count`, **not uptime**. Confirmed again tonight: 618 products → 789 MB;
   893 products → 1,083 MB. `uptime` is not a control. `disk_product_count` is on `/api/health`
   and I did not use it — my T-CAP-01/02 are downgraded to corroborating because of it. T-CAP-03
   survives only because it ran **two arms in adjacent windows** (small bbox +5.7 MB vs global
   +812.8 MB) and background load would have raised both.

3. ⛔ **`/api/health` reports the LAST 8 CHARS of the 40-char SHA, not the first.** I read
   `b4053ad8` as an unknown deploy twice; it is the tail of `679da3d9e80e…`. Recorded trap, walked
   into anyway.

4. ⛔ **A RENDER ENV VAR IS INERT UNTIL A DEPLOY** (theirs). `PUT /env-vars` returns 200, the
   read-back shows the new value, the running process keeps the old one. Verify against the
   PROCESS, never the config.

---

## §1 THE OOM — CLOSED, AND NOW ATTRIBUTED

**26 `oomKilled` events on record** (Render events API, 1,200 paginated), 08-02T20:26Z →
**08-10T13:09:19Z**. The newest is **48 minutes before the fix landed. There has not been one since.**

The deploy timeline isolates the code fix from the config fix:

| window | duration | interventions active | OOMs |
|---|---|---|---:|
| **A** | **7.8 h** | `0d9149b7` **only** | **0** |
| **B** | 3.2 h | + `PREFETCH_*`, `MALLOC_TRIM_THRESHOLD_` | 0 |

⚠️ **AND IT DOES NOT DISCRIMINATE YET.** Pre-fix inter-OOM gaps (h): **44.6, 31.3, 27.6, 27.6,
16.3, 10.1 …** median **1.3**. **6 of 25 gaps were ≥7.8 h; 5 of 25 ≥10.9 h.** A clean run past
**44.6 h** exceeds every pre-fix gap and settles it. **Re-read the counter at 2026-08-11T13:57Z
(48 h) and 72 h** — one API call, script at
`audit/weather-simulation-11.2/evidence/forensics/render_oom_events.py`.

**The config half, reproduced independently by me** (third series): 1,445.3 MB @590 products →
**789.1 MB @618** = **−656 MB at a higher product count**. glibc auto-raises its trim threshold as
a program frees large blocks — which is exactly why RSS never returned. Pinning it at 128 KB
disables that.

★ This **explains my own central measurement without contradicting it**: a per-request +156.7 MB
and a closed OOM are both true, because the delta was arena high-water glibc refused to return.
**I measured the symptom correctly and named the wrong remedy.**

---

## §2 WHAT I SHIPPED

### `d68f6f2d` — the load-time stride (grid_series)
Bounds the series **before** `NormalizedProduct.model_validate` turns cells into `GridVector`
models, instead of after. `15.55× → 1.30×` materialisation on a cold global 48 h series.
6 files, kill switches `SERIES_LOAD_STRIDE=0` / `SERIES_VECTOR_BUDGET=0`, mutation battery **6/6**.

⚠️ **It is currently INERT at live traffic.** Every request I could make resolves to ~300-cell
coarse products, far under the 80,000-vector budget, so `stride_for` returns 1 and the new path
never runs. **Not verified in production.** It needs a series request resolving to the 181×83 mid
tier at >1,666 cells/frame.

⛔ **AND DO NOT "FIX" IT BY STRIDING AT `resolve_grid`'s RETURN.** `_build_one` counts
`vectors_before_bound` *after* the resolver returns, so that would drive the oracle green while
constructing exactly as many vectors. **A fix downstream of the measurement point changes the
measurement, not the cost.**

**Four bugs my own tests caught in it:** double decimation (I wrote "the second pass is a no-op" in
a comment — it is not: 966 cells → 72); a hit stamping itself `decimated_stride: 1`; two test
doubles broken by a positional arg; and an extraction that dropped 5 names → 24 failures.

⚠️ `store.py` sat at **exactly 800 LOC**, the hard ceiling — any addition breaks CI. Resolved by
extracting `load_product`'s body to `store_helpers.load_product_helper` (the file's own existing
pattern) and relocating rationale to
`docs/research/DESIGN-2026-08-10-the-grid-series-load-time-stride.md`. **800 → 704.**

### Audits 11.1 and 11.2 + Mission 1
`audit/weather-simulation-11.1/` (18 files) and `audit/weather-simulation-11.2/`.
**11.1: ON TRACK WITH CORRECTIONS → 11.2: ON TRACK.**

---

## §3 THE HEIGHT FLIP — VALIDATED, KEEP IT

`679da3d9` (theirs) flips `__RAW_NEARSHORE_RENORM__` ON, changing the **default** map display by a
median 3×. They proved consistency; nobody had checked accuracy. **Mission 1 did.**

The backend point lane reads the **same** offshore field from the **same** product with no decay
and no renormalisation — and it is the lane the accuracy monitor scores against buoys. So whichever
flag state lands closer to it inherits that validation.

**130 real Florida spots, real 25×29 production grid, 28 % land cells:**

```
|tile - point| (m)     ON        OFF
  mean               0.0004    0.2579
  p50                0.0001    0.3129
ON closer at         105/130 (81%)
ratio ON/OFF         p50 2.92x   max 10.68x   (theirs: p50 3.00x, max 10.68x — max agrees exactly)
```

★ **ON reproduces the scored lane to ~0.4 mm, and that near-zero IS the point**: with the
renormalisation on, the tile sampler does precisely what the backend does. The flip doesn't improve
the tile lane, it **collapses it onto** the backend lane — which is what ONE FORECAST COMPOSITION
requires and what the old decay violated as a second client-side forecast path.

⚠️ **The orientation control had to pass first** — the sampler indexes rows NORTH-first, the
normalizer emits SOUTH→NORTH, and backwards gives a mirrored field that still looks plausible
(`north-first 0.0104 m vs south-first 0.0954 m`).

**Still not proven:** the offshore field is only as good as GFS, and **Open-Meteo beats our lane at
every lead**. This proves the tile lane agrees with *our* scored lane, not that ours is best.

---

## §4 STATE OF THE BOX (2026-08-11 ~01:30Z)

| | |
|---|---|
| RSS / peak | **1,082.9 / 1,195.5 MB = 58.4 % of 2 GiB** at 893 products |
| 5xx | **0 of 938 requests** |
| OOMs since the fix | **0**, 11+ h |
| env vars set | `MALLOC_TRIM_THRESHOLD_=131072`, `PREFETCH_MAX=120`, `PREFETCH_CONCURRENCY=2` |
| CI at my tip | `CI` ✅ · Encoding Guard ✅ · LOC Governance ✅ · Lighthouse ✅ |
| frontend suite | **209 suites / 1,949 tests, all pass** |
| backend composition lane | **1,634 passed / 66 skipped / 1 xfailed / 0 failed** (143 files) |
| science control | **BIT-IDENTICAL** to the 11.0 baseline, third audit running |

---

## §5 GATES

| gate | state | why |
|---|---|---|
| A Baseline truth | PASS | |
| B Correctness | **PASS ⬆** | the height flip is validated (§3) |
| C Lifecycle | CONDITIONAL | R11-01 still unexercised under a real guardrail trip |
| D Regression protection | **CONDITIONAL — now the binding gate** | the capacity oracle exists and is mutation-proven; **the pixel oracle does not** |
| E Capacity | **PASS ⬆** | 58 % of cap, zero OOMs, attribution isolated |
| F Upgrade readiness | CONDITIONAL | unblocked once D clears |

---

## §6 THE QUEUE, ranked

1. **Read the OOM counter at 48 h (13:57Z) and 72 h.** One API call. Settles whether Gate E's PASS
   is durable. Script is committed.
2. **The pixel oracle** — `weather-simulation.spec.js` is still **5 live / 1 `test.fixme` / 6
   `test.skip`**. No CI green has ever proven the marine field paints. **This is the binding gate.**
   ⭐ `grep "^\s*test\("` misses both disabled forms — census with them or the number lies.
3. **Verify the load-time stride in production** — needs a request resolving to the 181×83 mid tier.
4. **Rotate the credential at `BRAIN_RULES.md:200`** — measured present at HEAD, unchanged across
   11.0, 11.1, 11.2. **The oldest unactioned P1 in the lineage.** Owner-only; history retains it.
5. **Open-Meteo same-model control** (`1140b3e4`) — needs ~1–2 days of scored rows to separate
   *model choice* from *our chain*.
6. **333 backend test files still in no CI lane** (I fixed only the memory family).
7. **The external uptime probe** — scored **P0 in Report 11.0's own table**, open across three audits.
8. ⚠️ **A THIRD copy of the CI composition list** lives in `backend/scripts/ci_test_lanes.py` and is
   missing the six memory-safety patterns. CI execution is correct today; the **partition guard**
   models the wrong lanes. Spawned as its own task.

---

## §7 MY ERRORS — the useful half

**Four instrument failures, all caught by preconditions, none silent.** The through-line is the same
one both sessions keep finding: *the instruments failed more often than the code under test.*

1. ⛔ **A `GridVector.__init__` counter read ZERO** — pydantic v2 builds nested models in Rust and
   never calls Python `__init__`. It would have "proved" a 100 % saving. Caught only by a
   `SETUP BROKEN` assertion demanding the counter see the baseline first.
2. ⛔ **`typeof v === 'number'` rejected all 130 rows** in the Mission 1 harness — the sampler
   returns `{value, direction}`. Caught by an `expect(rows.length > 30)` guard that would otherwise
   have reported a confident **empty** result.
3. ⛔ **`git show <sha> -- backend/…` run from inside `backend/`** resolved to
   `backend/backend/…`, matched nothing, printed nothing, and **exited 0**. I read that as "no test
   added". `git log -S` is the reliable tool.
4. ⛔ **A probe crashed on an emoji under cp1252** at the exact line where it was about to correctly
   refuse. Recorded trap, paid anyway.
5. ⚠️ **I asserted an absence without grepping for it.** I recorded the Render API as "owner-gated,
   no credential" — `RENDER_API_KEY` was in `backend/.env` the whole time. That is the
   *absence is a claim, grep first* rule broken **inside the document whose only job is to bound
   what I did not check**.
6. ⚠️ **My own audit contradicted itself within the hour.** Mission 1 resolved 11.2's top risk and I
   updated §1.2 and the gates but not §1, §4 and §9. The stale-statement class, in my own file.
   Superseded text is marked and kept, not rewritten.

---

## §8 REPRODUCE ANYTHING HERE

```bash
# OOM history + attribution
python audit/weather-simulation-11.2/evidence/forensics/render_oom_events.py

# the height-flip validation (fetch, then run the harness from src, then remove it)
python audit/weather-simulation-11.2/evidence/forensics/M1_fetch_height_flip_fixture.py
cp audit/weather-simulation-11.2/evidence/forensics/M1_height_flip_validation.test.js \
   frontend/src/components/map/zzM1.test.js
cd frontend && CI=true npx react-scripts test --watchAll=false --testPathPattern=zzM1
rm frontend/src/components/map/zzM1.test.js

# the capacity measurements (needs a box >=50 MB below its own peak)
python audit/weather-simulation-11.1/evidence/memory/T-CAP-03_size_scaling_control.py

# the science control -- must be bit-identical
cd backend && python -c "import sys;sys.path.insert(0,'.');from services.weather_pipeline import sim_rating as s;sp={'name':'Pipeline','latitude':21.665,'longitude':-158.053};print([(h,s.calculate_surf_rating(sp,h,14.0,315.0,5.0,270.0)['breaking_height_ft'],s.calculate_surf_rating(sp,h,14.0,315.0,5.0,270.0)['quality_rating']) for h in (0.5,1.0,4.0,8.0,12.0)])"
# expect: 3.3/68.1 · 5.8/84.5 · 17.6/84.5 · 30.6/55.7 · 29.5/59.8
```
