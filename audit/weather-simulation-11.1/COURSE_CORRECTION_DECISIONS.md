# COURSE-CORRECTION DECISIONS

**Verdict: ON TRACK WITH CORRECTIONS.**

---

## CONTINUE — producing verified progress, do not disturb

| item | why it earns continuation |
|---|---|
| **The composition-guard estate** (`578e9a1c` enrolling the map rating band as the 4th surface) | Caught the author's own `ci.yml` double-edit within hours. A guard that catches its own maintainer is the strongest kind. |
| **Run identity + `run_census` on series frames** (`7312412b`) | Shipped in this window and **already caught a live `mixed_runs: true`** (two runs 7.8 h apart in one response). It closed Report 11.0's open question U-2 with a positive observation. |
| **The widened CI composition lane** (`c7099d0a` → `6e5bf70a`, 49 → 141 files) | Deliberately a *named family*, not a blanket widening, and it caught a real regression (`4cb9c3c6` → `c4d1c7f8`) hours after landing. |
| **The JS rating-mirror port** (`9fe18414`) | Closed a 64.6-point release blocker **and** corrected the green test that was certifying the wrong behaviour. |
| **E2E `paths-ignore`** (`00dfba86`) | Broke an 8-run cancellation cascade; the fix's own run was the first to complete since 16:01Z. |
| **The dark-flag discipline itself** | Every one of the four is strict `=== true`, default-off, mutation-tested against silently defaulting on, and each changes a number a user reads — correctly the owner's call, not the engineer's. |
| **Bit-identical science** | 103 commits, four inside the physics/rating subsystem, zero movement in the served numbers. Whatever else changes, keep this property. |

---

## COMPLETE — partial migrations to finish before starting anything new

| item | what remains |
|---|---|
| **The `grid_series` memory bound** | The bound moved from the response to the per-hour landing. It must move once more — **before `GridVector` materialization**. `stride_for` already exists; this is completion, not a new system. **Mission 2.** |
| **R11-01 churn loop** | All three seams are in source and the churn counter reads clean — but **on the healthy path only**. The `force_marine_fallback` soak is the missing half. |
| **R11-04** | Serialization half shipped; the **cycle half** (`run_time` = model cycle rather than ingest wall-clock) is untouched, and `run_census` now proves it matters. |
| **R11-08** | Two of three surfaces now measure-or-refuse; `system.py:208 error_rate = 0.5  # Placeholder` is the residual. |
| **R11-11** | 5 of 7 shipped. Cross-fall slot sampling remains; radar dBZ is correctly **refused** for want of the scheme-7 palette spec (do not invent thresholds). |
| **R11-02's detector** | The refusal is ported, but `ratingParity.test.js:38` still passes **6 of 12 args** — the class of drift stays structurally invisible. |

---

## CORRECT — right direction, implementation or validation needs adjustment

| item | correction required |
|---|---|
| **The OOM repair's validation** | The repair is good engineering (wire −25 %, p90 32 s → 16 s). Its **acceptance criterion was unsound**: measured on a box already at its own high-water mark, where a +157 MB transient reads as zero. **Correct the oracle, then finish the fix.** Mission 1. |
| **`AUDIT-2026-08-10` §1 and §5** | Two headline claims are live and wrong in the newest audit document: "+0.0 MB" (contradicted three ways) and "losing to persistence" (refuted by the paired control the very next commit shipped). **Annotate both in place** — a wrong record is worse than none. |
| **The accuracy gate** | Green (`MAE 0.152 m` vs warn 0.30) while paired comparisons show the product lane losing to Open-Meteo at all three horizons and to its own EURO member. **Add `persistence` and `open_meteo_marine` paired rows to the RED criterion.** The monitor already computes both. |
| **Push discipline vs live measurement** | Two production deploys landed mid-audit from a concurrent session and forced the retraction of an in-flight inference. **Batch pushes, or announce a measurement window.** |
| **The five new dark flags** | Each is individually justified; collectively they add five permanent dual paths with **no dated owner decision**. Attach a decision date to each, or they become architecture. |

---

## PAUSE — stop until a prerequisite or test exists

| item | blocked on |
|---|---|
| **Any further `grid_series` performance work** | Mission 1's oracle. Another unfalsifiable improvement is worse than none. |
| **The ICON warm-bias correction** (+0.143 → +0.191 m) | The gate that would catch a mistake cannot currently express "worse than a free competitor". Fix the gate first. |
| **Any animation, particle or dt work (R11-09's dt half)** | It cannot be benchmarked: `visibilityState: hidden`, 0 rAF ticks. Fix the harness's visibility precondition before touching the physics. |
| **`SURF_PARTITIONS`** | Unchanged from 11.0 — R11-02's *detector* (6 of 12 args) still cannot see the class of drift, even though this specific instance is closed. |

---

## ROLL BACK — none

**No change in this window has a regression cost exceeding its demonstrated benefit.** Nothing is
recommended for rollback. Specifically, the OOM commit `0d9149b7` should be **kept**: it genuinely
reduced the wire and latency and moved the retention multiplier from N to CONCURRENCY. It is
incomplete, not wrong.

---

## DEFER — technically sound, wrong timing

R11-05 (sim model contract) · R11-06 (ICON blend / arbiter arming) · R11-12 (hour-0 unification) ·
R11-17 (lifecycle residuals) · serve-side run-age staleness state · the canvas-hash scrub assertion.

---

## REJECT — complexity without a confirmed problem

The whole Report 11.0 §17 list, **reaffirmed with one premise re-tested and strengthened**:

- **JAX / GPU / Numba** — the measured bottleneck is server RSS on the *serve* path, and T-CAP-03
  shows the cost scales with cells serialized, not with arithmetic. Accelerating the physics would
  not move the binding constraint at all.
- **Neural emulators / learned downscaling** — now rejected for a *stronger* reason than in 11.0:
  the product's lane is 33 % behind a free deterministic competitor at +24 h, paired, n=790.
  Adding a learned layer optimises the wrong term.
- **Zarr/COG/Kerchunk/Dask · GNN/nested grids/SWAN/FVCOM · finer bathymetry as an accuracy lever** —
  unchanged.
- **WebGPU / OffscreenCanvas / SharedArrayBuffer** — **Premature**, and newly *unmeasurable*: no
  executed-pixel test has ever proven the current renderer paints.

---

## INVESTIGATE — important, not enough evidence

| question | cheapest discriminator |
|---|---|
| Have `oomKilled` events actually stopped since `0d9149b7`? | One Render API call: `/v1/services/{id}/events` since 08-10T14:00Z. **Owner-gated.** |
| Does the accuracy gate's headline aggregate the same population as its per-source table? | Print the headline's n-by-source breakdown beside it. One line. |
| Does the R11-01 churn loop actually die under a real guardrail trip? | `localStorage.force_marine_fallback` soak in a **visible** browser. |
| Does the marine field paint at all in CI? | Un-`fixme` the pixel oracle at `weather-simulation.spec.js:578`. The blocker was diagnosed as a declaration, not a missing GPU. |
| R11-13's integrity chain — is anything actually corrupting? | A checksum on one lane, then count mismatches. Currently unknowable: zero checksums exist. |

---

## OWNER-ONLY — no engineer can substitute, and several findings' reach is bounded by them

1. **Rotate the Qdrant Cloud credential at `BRAIN_RULES.md:200`** (provider-side; history retains
   it regardless of any edit). Flagged P1 on 08-09; **unchanged**.
2. **Set the Render env vars**: `MALLOC_ARENA_MAX=2`, `MALLOC_TRIM_THRESHOLD_=67108864`,
   `PREFETCH_MAX=120`, `PREFETCH_CONCURRENCY=2`. Prescribed 2026-08-03; **7 days, 7 OOM events, and
   still not applied.** `PREFETCH_CONCURRENCY` is the literal multiplier in the fix's own
   "CONCURRENCY full grids".
3. **Decide the four dark flags** — each changes a number a user reads.
4. The standing set: unfreeze the production frontend · the seeded admin row · the Vercel app.
