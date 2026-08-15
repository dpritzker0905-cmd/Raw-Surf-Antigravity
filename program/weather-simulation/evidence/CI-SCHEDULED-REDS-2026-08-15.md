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

⚠️ Not investigated further here — it belongs to the marine/zoomlab lane and needs the recording
(`zoomlab-nightly-31871169312`, 59.8 MB, 14-day retention). ★ **Download it before it expires**; the
08-13 recording is already gone, which is why the two bursts can only be compared as counters.

---

## What was NOT done, and why

Nothing was edited. Each red is a true statement by a gate that is working, and each resolution is an
owner decision (re-author bounds after the campaign · add a waiver-aware attribution class · triage a
render finding). ⛔ Widening a bound, raising a budget, or adding a waived factor to the sim would
each silence a correct instrument — and the census gate was explicitly rebuilt on 08-09 so that its
bounds would *never* be widened to clear a red.
