# Three scheduled lanes red at `aa305291` — all three diagnosed, none is a code regression

**Date** 2026-08-15 · **Trigger** ci-monitor on PR #8 named `parity`, `census`, `zoomlab-battery`
**Method** artifact forensics only. No bound, budget or floor was touched.

> ⚠️ These are **scheduled** runs, not PR checks. `gh pr checks 8` shows **31 checks, all pass** —
> the PR lane cannot see any of this. The three reds are cron-fired at the same SHA.
> ★ Same instrument as the 08-08 finding: *a scheduled workflow's health is invisible to a green push.*

| job | workflow | run | what it means |
|---|---|---|---|
| `parity` | Sim Parity Monitor | 31882534108 (11:37Z) | first composition red in 20+ runs — a **declared waiver** |
| `census` | Forecast Calibration Census | 31875779301 (08:57Z) | the ERA5 campaign **inverted** an ordering claim |
| `zoomlab-battery` | Marine Nightly | 31871169312 (07:07Z) | real render findings, **intermittent** (2 of last 3) |

---

## 1. `parity` — the divergence is a DECLARED, PRICED WAIVER, and the gate cannot see the waiver

### The control that makes this readable

The **same SHA** ran green six hours earlier (31867700376, 05:44Z). Compare the two:

| | GREEN 05:44Z | RED 11:37Z |
|---|---|---|
| level differences | **9** | **1** |
| `d_score` max | **42.1** | **4.4** |
| `d_height_pct` max | **84.9%** | **2.7%** |
| provenance of the differing rows | `run_match=False` on **all 9** | `run_match=True`, `wind_match=True` |

⭐⭐⭐ **THE WORSE-LOOKING RUN PASSED AND THE BETTER-LOOKING RUN FAILED — CORRECTLY.** Every
aggregate in the green run is an order of magnitude worse. The gate does not read aggregates: it
fails only on a level split whose two sides ran on the **same marine and wind runs**. Ranking these
two runs by any summary statistic gets the answer exactly backwards.

### The single red row, fully decomposed

`Shark Pit` (florida, 27.8415/-80.4275), hour `2026-08-15T12:00:00Z`, `geometry: full`,
`attribution: "composition"`, note *"identical marine and wind runs — inputs are the same"*.

```
glyph 27.4 (poor)   sim 31.8 (poor_fair)   d_score +4.4
h_served 0.539 m    h_sim 0.5486 m         d_height +1.79%
glyph_limiter_f 0.3761   sim size_gate 0.3760      <-- agree to 0.03%
```

**The height is a red herring.** The size gate — the only sub-1.0 term on the sim side — agrees to
three decimals. The sim's own arithmetic checks out: `100 x blend(0.845) x size_gate(0.376) = 31.77`.
So the glyph carries an **extra factor of `27.4 / 31.78 = 0.862`** that the sim does not apply.

### Which factor, established by elimination and then confirmed

`test_rating_composition_parity.py` declares the sim's gaps against the reference surface. It waives
exactly two:

- **`tide_norm`/`best_tide`** — *"the sim's lane is SYNCHRONOUS (urllib) and `tide.tide_norm_at` is
  async HTTP … measured 42.2 s blocking … weighed against 18 of 1,773 spots (1.0%) having a usable
  tide band, the cost is not worth the coverage."*
- **`breaker_xi`** — `RATING_BREAKER_TYPE` defaults `"0"` and is set in **no** workflow.

So only tide is armed in the serving lane (`RATING_TIDE='1'` in both ingest lanes and on Render since
2026-08-10). `tide_fit` is bounded `[0.5, 1.0]`; 0.862 sits inside it.

**Confirmed against production, not inferred.** `spot_ratings.py:243` appends the tide clause to
`why` only when `tide_state AND best_tide` are both truthy. Live `/api/weather/spot-ratings`,
florida viewport, 2026-08-15T14:00Z:

```
33 spots · tide OBJECT resolved on 29 · "tide" named in WHY on 6
the 6: Bethune Beach · Sebastian Inlet x4 · SHARK PIT
```

⇒ The tide **state** is global; the tide **factor** reaches 6 of 33 here — the ~1.0% the waiver
priced. **Shark Pit is one of them.** `tide_fit = clamp(1 - 1.3*dist, 0.5, 1.0)`, so 0.862 implies
the tide sat 0.106 outside the spot's preferred band; the served row's own `why` says *"rising tide"*
at that hour, and the 14:00Z frame reads `norm=0.934, falling` — a high water in between.

### ⭐⭐⭐ THE FINDING

**Both components are correct and neither knows about the other.** The waiver is registered, priced
and enforced by a test. The monitor pages on any same-provenance level split. Nothing connects them,
so the monitor calls the waiver's own budgeted cost a *"ONE FORECAST COMPOSITION violation"*.

⛔ **Do NOT "fix" this by adding tide to the sim** — that contradicts a measured waiver (42.2 s
blocking, the `576dcbdd` regression) for 1.0% coverage.
⛔ **Do NOT widen the gate** — it took 20+ runs to fire once and it fired on a true statement.

▶ **The shape of the fix, for the owner:** a fourth attribution class beside `provenance_only` —
`waived_factor`: a divergence whose magnitude is explained by a factor this surface *declares* it
does not supply. It needs one thing the payload does not yet carry: the **full factor vector**, not
just `limiter`/`limiter_f` (the minimum). Today the tide factor is invisible unless it happens to be
the limiter.

★ **The monitor was built for exactly this.** Its 2026-08-09 comment records that three sessions
could not name the mechanism behind rotating composition reds because only the *verdict* was stored,
so factor-vector self-diagnosis was added on divergence. That instrument is why this took one
artifact pull.

---

## 2. `census` — the ordering claim inverted because the ERA5 campaign reached Florida

The run **fetched fine** (1,821 climatology entries, 1,773 active spots, 10,638 spot-hours compared),
so this is **not** the 08-14 `503`-exiting-1 conflation. It is a real measurement:

```
OUT OF RANGE  Florida east coast (Sebastian Inlet) ref=1.16 m  expected <=1.1
OUT OF RANGE  Hawaii North Shore (Pipeline)        ref=1.46 m  expected >=1.5
ORDERING : worst pair Sebastian vs Pipeline = 1.262x (authored 1.364x) -> margin 0.926x INVERTED
```

The workflow's own error text says to check `drift.json` before treating it as a code regression.
Done — against the **git-tracked** baseline `backend/scripts/climatology_baseline.json`
(written 2026-08-01), which is a primary source, not a re-derivation:

| spot | baseline 08-01 | live 08-15 | move |
|---|---|---|---|
| Sebastian Inlet | 0.812 | 1.156 | **+42.4%** |
| Sebastian — Monster Hole | 0.877 | 1.161 | +32.4% |
| New Smyrna (Flagler) | 0.690 | 1.065 | **+54.3%** |
| **Pipeline** | 1.542 | 1.460 | **−5.3%** |
| Mavericks | 1.857 | 1.693 | −8.8% |

**Ordering ratio Pipeline/Sebastian: 1.899x (08-01) → 1.263x (now), against an authored 1.364x.**
Estate-wide: `psi 0.1341`, **722 of 1,821 spots moved (39.65%)**, top movers +157% to +228%, all of
them small→large.

⇒ **The small-wave coast climbed 32–54% while the big-wave coast drifted down 5–9%.** That is the
recorded STEP+FREEZE mechanism: a backfilled spot's population is replaced (~139k ERA5 samples vs
~72/day live) and steps once; an un-backfilled spot keeps drifting. Two populations moving in
opposite directions collapse a ratio that neither one broke.

★ **A banked prediction landed, and its earlier miss is now explained.** 2026-08-08 predicted *"the
next failure is Florida, from ABOVE"*; on 08-09 it was scored NOT confirmed because the exemplar
resolves to the nearest single spot, which then read 0.86 m. That same spot now reads **1.156 m**.
The prediction was right and the six-day delay was the campaign reaching it.

⛔ **DO NOT WIDEN THE BOUNDS.** The 08-09 redesign already froze them byte-for-byte and moved the
paging claim to ORDERING precisely so a real inversion could still be seen. This **is** that
inversion — the margin went 1.258x (green, 08-09) → 0.926x. The gate is working.
▶ **Owner call:** re-author the exemplar bounds against the post-campaign population, or re-anchor
the drift baseline — after the campaign finishes, not during it. Re-authoring mid-campaign buys one
green run and the next backfilled region breaks it again.

---

## 3. `zoomlab-battery` — real render findings, intermittent, same signature as 08-13

```
[verdict] FAIL - 7 render finding(s), 0 instrument finding(s), 380 anim frames, 161 water samples
  DEAD_BAND_TRANSIENT cols[13,15] xFrac[0.33,0.40] t[345850,348109] frames=3
  MULT0_FRAME x5   t = 335253 336341 337261 338091 339189
  SETTLED_STEP     t = 340127  z = 5.523  dL = -21.2
render findings=7 settled_steps=1 persistent=0   (budget: <=2 findings, 0 persistent, 0 settled)
```

**`0 instrument findings`** — the transport REFUSE path did not fire, so these are render facts, not
a sleeping backend.

The last three nightlies:

| date | findings | settled steps | signature |
|---|---|---|---|
| 08-13 | 22 | **1** | MULT0 burst t≈323.8–340.8 s, then a settled step |
| 08-14 | 1 | 0 | one DEAD_BAND_TRANSIENT, clean |
| 08-15 | 7 | **1** | MULT0 burst t≈335.3–339.2 s, then a settled step |

⇒ **Intermittent, not new, and the burst lands in the same phase of the battery both times**
(≈323–341 s), ending in a settled step. A run of zero-multiplier frames followed by the settled
reading stepping −21.2 is the WS-CAN-0061 family: the field is present during the gesture and the
settle is where it changes.

### ✅ ROOT-CAUSED — it is a FETCH-ARRIVAL RACE AGAINST THE ZOOM, not a renderer defect

Traces pulled for the red (08-15) and the **green control** (08-14) and compared frame by frame.
Both nights run the identical staircase and hold the **identical 8.00 × 8.00° regional resident**
down to z=6.323 at **covF 0.843**. They differ only in *when a wider grid arrives*:

| | 08-14 GREEN | 08-15 RED |
|---|---|---|
| wider grid arrives at | z **6.323** (28.00 × 24.00°) | z **5.523** (32.00 × 32.00°) |
| coverage while held | never below **0.843** in this band | **0.462**, then **0.360** |
| heatmap opacity | 1.0 throughout | **0.0 for 5 frames** |

`__RAW_DOWNGRADE_COVER_FRAC__` defaults to **0.6**. Red's resident fell below it two zoom steps
before a replacement landed, so the layer applied its coarse-bridge hold (opacity mult → 0), and the
engine's mid-frame realign (`WebGLMarineEngine.js:756`) **cannot rescue it** — that path requires the
resident to have *changed this frame* AND to cover ≥ 0.6. Neither was true, so the hold stood:

```
t=335253  z=5.703  covF=0.462  mult=0  hm=0.00  L=193.7  <- hold engages
t=337261  z=5.523  covF=0.360  mult=0  hm=0.00  L=195.9  <- zoom has STOPPED
t=339189  z=5.523  covF=0.360  mult=0  hm=0.00  L=195.9
t=340127  z=5.523  covF=1.000  mult=1  hm=0.70  L=174.7  <- 32x32 grid lands; -21.2 = the SETTLED_STEP
```

**4,874 ms with the field's heatmap at zero — 2,866 ms of it with the zoom not moving.**

⚠️ **Not a bare basemap: the under-wash held** (`wE` 0.516 → 0.504, `blend` engaged throughout), which
is the design working. What the viewer loses is the heatmap: **speckle −43% (32.8 → 18.8), L +9.2**,
then a −21.2 snap-back. That is the owner's own report — *"I think I see it for a second as I zoom
out quickly"*, *"it clears there"* — and it is a **second, independent cause** from the layer-order
blank the concurrent session fixed on 08-13.

⇒ **The "intermittency" is not renderer flakiness.** It is whether a covering grid happened to be
resident when the staircase crossed z≈6.3→5.5. Same code both nights.

### The 08-13 trace confirms it a third time — and it is FOUR TIMES WORSE than its counter implied

| night | heatmap at zero | of which zoom already stopped | covering grid that ended it |
|---|---|---|---|
| 08-13 | **18,836 ms** | 3,327 ms | 44.00 × 36.00° |
| 08-15 | 4,874 ms | 2,866 ms | 32.00 × 32.00° |
| 08-14 | **0 ms** | — | 28.00 × 24.00°, arrived early |

**⭐ THE LEVER IS BRACKETED BY MEASUREMENT, NOT BY READING THE DEFAULT.** Across all three runs:

```
mult == 0  observed at covF   0.075 .. 0.479
mult == 1  observed at covF   0.607 .. 1.000
                              ^^^^^^^^^^^^^^ __RAW_DOWNGRADE_COVER_FRAC__ = 0.6 sits in the gap
```

⚠️ **And 08-13 shows an aggravating second behaviour the other two do not:** at t=323755, *at constant
zoom 6.144*, the resident **SHRANK** from `8.00 × 8.00°` to `7.17 × 5.02°` — coverage 0.745 → 0.479 —
and that swap is what *started* the hold. The engine then held that smaller grid through **five**
further zoom steps (covF decaying 0.479 → 0.203 → 0.158 → 0.123 → 0.096 → 0.075) before a covering
one arrived. This is the "viewport GREW, mask SHRANK" shape already recorded at
`marineEngineDecisions.js:760` and in `mask-no-shrink-halo.test.js`.

⇒ **Duration is set by arrival latency of a covering grid, and a shrinking resident can start the
hold on its own.** The nightly's finding COUNT tracks neither: 22 findings vs 7 understates a 4×
difference in how long the field was gone.

### ⛔ REFUTED EN ROUTE — this is NOT the known band-fade dead zone

The MULT0 frames sit at span **14.58** and **16.51**, inside the recorded 9.5–40° dead zone, which
makes `__RAW_RATING_SPAN_FADE_HI__` the obvious suspect. It is wrong:

- the GREEN run has **58 frames with span in [9, 42]** and `mult=1` in **every one**;
- the RED run itself has **span 16.511 with mult=0 (covF 0.360) and mult=1 (covF 1.000)** — same
  span, same zoom z=5.523, opposite outcome;
- `band` (`ratingBandFade.bandMult`) reads **1.0 across the whole burst**.

★★★ **The trace's `mult` is `__RAW_GPU__.opacity.mult`, NOT `ratingBandFade.bandMult`** — two
different multipliers, one letter apart in the trace. Reading the field name as the familiar one
would have pinned this on an owner-gated span constant and closed the investigation on the wrong
lever. **A within-run control (same span, both outcomes) is what killed it.**

### Where it could be fixed — owner's call, all three are behaviour changes

1. let a sub-covering regional keep painting **inside its own bounds** during the hold instead of
   going to zero;
2. widen the realign to accept a resident below 0.6 when nothing better exists (show something);
3. request the wider grid one zoom step **earlier**, so arrival leads the coverage cliff.

### Artifacts (both retained — verified via the artifacts API)

| artifact | size | expires |
|---|---|---|
| `zoomlab-nightly-31680258907` (08-13, 22 findings) | 59.6 MB | **2026-08-27** |
| `zoomlab-nightly-31871169312` (08-15, 7 findings) | 59.8 MB | **2026-08-29** |
| `zoomlab-nightly-31781976971` (08-14, GREEN control) | 50.3 MB | 2026-08-28 |

★ The 08-13 trace is still unread here — it should show the same coverage collapse over a longer
hold (22 findings vs 7). **Pull it before 08-27.**

---

## What was NOT done, and why

Nothing was edited. Each red is a true statement by a gate that is working, and each resolution is an
owner decision (re-author bounds after the campaign · add a waiver-aware attribution class · triage a
render finding). ⛔ Widening a bound, raising a budget, or adding a waived factor to the sim would
each silence a correct instrument — and the census gate was explicitly rebuilt on 08-09 so that its
bounds would *never* be widened to clear a red.
