# RV-08 — DEFAULT-MODEL CENSUS: should the served lane switch from GFS to EURO?

| Field | Value |
|---|---|
| Evidence ID | RV-08 |
| Date | 2026-08-12 |
| Branch / commit | `dev` @ `3bc776d9` |
| Canonical task | new — proposed **WS-CAN-0057**; arises from WS-CAN-0026's output |
| Sources | 17 accuracy-monitor run logs (production, 2026-08-09 → 08-12) + live `/api/weather/buoy-calibration` |
| Production code modified | **NONE** — read-only |
| Reproduce | `python audit/weather-simulation-12.0/evidence/test-results/RV-08_model_census.py` |

---

## Verdict

**EURO is durably more accurate than the served GFS lane — at every lead, on every one of 10 runs,
by 27% / 28% / 17% on MAE, and on RMSE, scatter index and correlation too.** The result strengthens
as `n` grows from 658 to 2,092, which is the opposite of a small-sample artifact.

**And the served lane has a compression defect the census exposed by accident:** it over-predicts
flat surf by **+0.24 m** and under-predicts the 2.5–10 m band by **−0.31 m** (n=377, 17 buoys),
monotonically across five bands. The worst-performing band is the one surfers care about most.

**Recommendation: one query away from a decision, and do not flip before it.** EURO's warm bias
(+0.044 → +0.106 m) is a liability on flat days and plausibly an *asset* in the tail — but
`stratified_height_bias` is computed for the served lane only, so **EURO's per-band bias is
unknown, and it is the number that decides the flip.**

---

## Part 1 — Stability (the decisive test)

The trailing-7d **paired** head-to-head, read across all 10 runs that carry the table:

| Lead | EURO better in | delta range (m) | mean | our win rate |
|---|---|---|---|---|
| **+24 h** | **10 of 10** | +0.010 … +0.018 | **+0.014** | 43–47% |
| **+48 h** | **8 of 10** | −0.001 … +0.040 | +0.012 | 43–47% |
| **+72 h** | **10 of 10** | +0.010 … +0.031 | **+0.014** | 45–47% |

**28 of 30 run × lead cells favour EURO.** The two exceptions are −0.001 and −0.0004 — ties, not
GFS wins.

⭐ **The result strengthens as the sample grows.** `n` rises monotonically 658 → 2,092 as the
archive accumulates, and the +24 h delta *widens* (+0.013 → +0.018) rather than converging to zero.
A small-sample artifact does the opposite.

## Part 2 — Controls (what makes Part 1 readable)

A comparison with no positive control cannot distinguish "EURO is better" from "this statistic
always says the other lane is better."

| Control | +24 h mean delta | beats us in | Reads as expected? |
|---|---|---|---|
| `raw_surf:ICON` | **−0.136** | **0 of 10** | ✅ the instrument can say *we win*, decisively |
| `open_meteo_marine` | +0.038 | 10 of 10 | ✅ the known standing loss reproduces |
| `persistence` | −0.003 | 4 of 10 | ✅ genuinely marginal — see below |

## Part 3 — Shape: where the difference lives

Live calibration snapshot, `generated_at 2026-08-12T18:48Z`, n ≈ 34 per cell. **Shape only — this
n cannot speak to stability.**

| Lead | GFS mae / bias / SI / corr | EURO mae / bias / SI / corr |
|---|---|---|
| +24 h | 0.178 / **−0.038** / 0.244 / 0.934 | **0.130** / +0.044 / **0.205** / **0.952** |
| +48 h | 0.181 / **+0.015** / 0.269 / 0.920 | **0.131** / +0.090 / **0.188** / **0.957** |
| +72 h | 0.184 / **+0.010** / 0.300 / 0.924 | **0.152** / +0.106 / **0.218** / **0.943** |

EURO wins MAE by **27% / 28% / 17%**, and also wins RMSE, scatter index and correlation at every
lead.

⚠️ **But look at the bias column.** GFS is near-unbiased (−0.038 → +0.010). **EURO over-predicts,
and the bias grows with lead: +0.044 → +0.090 → +0.106 m.** For a surf app that is the error a user
notices most — the app inventing surf that is not there. MAE alone hides it; the repo's own
`skill_summary` docstring makes exactly this point.

### Observed-height bands

| Lead | flat <0.5 m | small 0.5–1.5 m | rideable 1.5–3 m | **big 3 m+** |
|---|---|---|---|---|
| +24 h | EURO (0.067 vs 0.102) | EURO (0.122 vs 0.182) | GFS (0.270 vs 0.267 — a tie) | **NOT SAMPLED** |
| +48 h | EURO (0.077 vs 0.087) | EURO (0.117 vs 0.177) | EURO (0.295 vs 0.344) | **NOT SAMPLED** |
| +72 h | GFS (0.093 vs 0.053) | EURO (0.142 vs 0.160) | EURO (0.289 vs 0.494) | **NOT SAMPLED** |

⛔ **The `big 3m+` band has zero observations at every lead** *in the trailing-7-day skill block*,
and `rideable 1.5–3 m` carries **n = 4**. The two bands that decide a surf forecast are the two with
almost no data — **in that window.**

### ⚠️ CORRECTION — the tail IS sampled, just not there

My first pass wrote "NOT SAMPLED" and would have shipped a wrong conclusion. The **full archive**
(`archive.stratified_height_bias`, 2026-07-28 → 08-12, **10,918 entries across 60 buoys**) does
carry big surf, and it says something the 7-day window cannot:

| observed band (m) | n | buoys | bias (m) | MAE (m) |
|---|---|---|---|---|
| 0.0–0.5 | 770 | 27 | **+0.239** | 0.266 |
| 0.5–1.0 | 5,061 | 54 | +0.066 | 0.202 |
| 1.0–1.5 | 2,904 | 60 | −0.048 | 0.234 |
| 1.5–2.5 | 1,806 | 47 | **−0.146** | 0.296 |
| **2.5–10.0** | **377** | **17** | **−0.314** | **0.408** |

**The served lane has a textbook compression signature: it over-predicts small surf by +0.24 m and
under-predicts big surf by −0.31 m, monotonically across five bands.** The worst band is the one
surfers care about most, and it is the one where the product says *smaller than it is*.

### This inverts one of my own cautions

I listed EURO's warm bias (+0.044 → +0.106 m) as a reason for caution. Against a lane that
**under-predicts by −0.31 m in the 2.5–10 m band**, a warm bias is plausibly an **asset in the
tail** and a **liability on flat days** (where the served lane already over-reads by +0.24 m).

⛔ **State it as a hypothesis, because that is what it is.** `stratified_height_bias` is computed for
the calibration model — the served GFS lane — and is **not broken down by model**. I do not have
EURO's per-band bias in the tail, so I cannot say whether EURO's warm bias lands where it would
help. **That single missing number is now the highest-value measurement in this census**, and it
decides the flip.

---

## The persistence trend — a correction to my earlier read

I told the owner the +24 h persistence breach had "widened, not reverted." That is right, and the
run-by-run series shows it is a clean monotonic move across ten consecutive runs:

```
08-10 19:57  ours 0.181  persist 0.199  delta -0.017  win 52%   we win
08-11 08:13  ours 0.179  persist 0.190  delta -0.011  win 50%   we win
08-11 20:03  ours 0.175  persist 0.183  delta -0.007  win 49%   we win
08-12 08:36  ours 0.180  persist 0.178  delta +0.002  win 47%   WE LOSE
08-12 20:40  ours 0.183  persist 0.172  delta +0.011  win 45%   WE LOSE
```

⭐ **But the cause is not what the headline implies.** `ours` is essentially flat (0.181 → 0.183).
**`persist` improved from 0.199 to 0.172.** The baseline got better; our forecast did not get worse.

Persistence improves when the sea state is calm and slowly varying. This is very likely a
**weather effect on the baseline**, not a regression in the product — which is precisely the
condition the F-06 constraint exists for ("thresholds calibrated on 3.4 boreal-summer days").

⚠️ Caveat on the ten points: this is a **trailing-7-day rolling window**, so consecutive runs share
most of their data. They are ten heavily autocorrelated readings, not ten independent samples. The
monotonic drift means recent days entering the window are worse-relative-to-persistence than older
days leaving it — a real directional signal, but not ten confirmations of it.

**Implication for WS-CAN-0026:** the grace date is doing exactly the job it was built for. If this
is sea state, the breach may clear on its own before 2026-08-22.

---

## Why not flip the default now

1. **EURO's per-band bias is the one number that decides this, and it does not exist yet.** The
   served lane's compression signature (+0.24 m flat → −0.31 m big) means the flip's value depends
   entirely on *where* EURO's warm bias lands. That is one query away and it has not been run.
2. **"EURO" resolves to three upstreams** (recorded in the audit lineage). `raw_surf:EURO` in the
   ledger is one scoring lane; which upstream a *served* EURO would use per coordinate is a
   separate question this census does not answer.
3. **The scoring lane is not the serving lane.** `raw_surf:EURO` is scored through the ledger's
   path. Whether the full serving chain — geometry, transform, rating — reproduces that MAE is
   untested, and the audit lineage's own recurring lesson is that a payload is not reach.
4. **It is one run away from a proper A/B.** `science-shadow-ab.yml` exists and the shadow machinery
   is built. Measuring is cheap here, so guessing is unjustified.

⚠️ Note what is **not** on this list: the small-`n` band cells and the "unmeasured tail" I first
wrote down. The archive answers the tail question; my first pass read the wrong block.

## What would close it, in order

| # | Step | Cost | Decides |
|---|---|---|---|
| **1** | **Per-band bias for `raw_surf:EURO` over the full archive**, the same stratification already computed for the served lane | one query — the rows exist | **the flip** |
| 2 | Widen the paired census beyond the trailing 7 d (archive spans 07-28 → 08-12, so ~2× more history is already banked) | free | tail stability |
| 3 | Shadow A/B on `science-shadow-ab.yml`, GFS vs EURO, scored per band through the **serving** chain | ~1 run | reach |
| 4 | Confirm which upstream a served EURO resolves to per region | ~1 h | correctness |
| 5 | Decide the bias trade explicitly — **owner call**, and only meaningful after step 1 | — | — |

**Gate: this is a Gate 1 (correctness) item and it is now measurable, which is new.** Before
WS-CAN-0026 shipped there was no instrument whose output would have prompted the question.

---

## Method note

Two measurements, deliberately, because neither alone is sufficient:

- **Stability** from 10 runs × n≈2,000 paired keys — answers *does the sign hold?* A single
  cross-section cannot; the 08-10 → 08-12 persistence flip in RV-05 is the proof.
- **Shape** from one live snapshot × n≈34 with bands and bias — answers *where does it live and
  which direction is the error?* MAE alone hides both.

Runs before `60f724d0` (2026-08-10 12:37) carry no paired table. They are **excluded and stated as
excluded**, never counted as ties: 17 runs read, 10 usable.
