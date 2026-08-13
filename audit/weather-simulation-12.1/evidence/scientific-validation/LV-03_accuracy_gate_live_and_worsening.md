# LV-03 — The paired accuracy gate is live, and the deficit widened rather than narrowed

**Objective:** WS-OBJ-501 · **Tasks:** WS-CAN-0026, WS-CAN-0054, WS-CAN-0049, WS-CAN-0057
**Source:** scheduled run `31710210215`, 2026-08-13T14:26Z, head `2dd8f1ff` (`gh run view --log`)

## 1. The gate exists and fires

```
ACCURACY_PAIRED_GATE: 1   --paired-grace 2026-08-22T00:00:00Z
--paired-min-n 200  --paired-persistence-margin 0.0  --paired-reference-margin 0.10

##[warning] SKILL FLOOR BREACHED at +24h -- we lose to `persistence` on n=2483 paired keys:
MAE 0.186 vs 0.171 (delta +0.015 m) AND win rate 44% < 50%. Both statistics agree, so this is
not one storm. A lane that cannot beat 'tomorrow = today' is adding no value at this lead.
[pages after 2026-08-22T00:00Z]

verdict: OK
```

**This is the objective delivered.** The instrument named the losing comparison, cited both agreeing
statistics, and disclosed its own arming date. `verdict: OK` is correct — the grace window is open.

## 2. Audit 12.0's "honest counterweight" is refuted by a larger sample

12.0 §1.3 ① wrote: *"the gap is **narrowing**. At 11.1 the +24 h delta was +0.050 with a 39% win
rate; it is now +0.038 at 41%."*

| paired row | 12.0 (08-12, run 31606511901) | **12.1 (08-13, run 31710210215)** | direction |
|---|---|---|---|
| vs `persistence` +24 h | n=1790 · Δ **+0.007** · win 46% | n=**2483** · Δ **+0.015** · win **44%** | **worse** |
| vs `open_meteo_marine` +24 h | n=1770 · Δ +0.038 · win 41% | n=**2456** · Δ **+0.040** · win 41% | worse |
| vs `open_meteo_marine` +48 h | n=1796 · Δ +0.051 · win 39% | n=**2401** · Δ **+0.052** · win 40% | flat |
| vs `open_meteo_marine` +72 h | n=1678 · Δ +0.063 · win 38% | n=**2386** · Δ **+0.069** · win 38% | **worse** |
| vs `raw_surf:EURO` +24/48/72 h | Δ +0.016 / +0.003 / +0.012 | Δ **+0.023 / +0.012 / +0.024** | **worse ×3** |

Sample sizes grew ~39% in one day and **every** row moved against the product or held flat. The
+24 h persistence delta **doubled**. On this evidence the deficit is not closing on its own, and the
gate will page when it arms in 9 days.

## 3. Two rows that survive as strengths

```
vs persistence +48h  n=1730  ours=0.196 theirs=0.222  delta=-0.026  win=54%  we win
vs persistence +72h  n=1103  ours=0.227 theirs=0.246  delta=-0.019  win=55%  we win
```
The lane has **real skill at longer leads** — the deficit is specifically a +24 h problem. And the
gate correctly refuses to grade the +72 h floor:
```
(skill floor +72h not gradeable: POPULATIONS DIVERGE (1103 paired vs 2460/1103 totals))
```
**Refusal-over-fabrication is working inside the new gate.**

## 4. A new datum the register does not yet carry: ICON is far worse than both lanes

```
raw_surf:ICON  +24h  mae=0.310    +48h  mae=0.342    +72h  mae=0.383
vs raw_surf:ICON +24h  ours=0.187 theirs=0.311 delta=-0.124 win=68%  we win
```
ICON's MAE is **~66–75% higher** than the served GFS lane at every lead. ICON is a user-selectable
model. This is a **model-selection** question (WS-CAN-0057), not an accuracy incident — and by the
gate's deliberate design `raw_surf:*` rows never gate. Recorded here so the decision is made on
evidence rather than discovered later.

## 5. What this does to the downstream gates

- **WS-CAN-0054** (arm the skill-MAE gate) — its clock is the same 08-22. Unchanged.
- **WS-CAN-0049** (AI correction) — remains **blocked at the premise**, now more firmly: you cannot
  fit a learned residual toward a baseline you lose to, and the loss widened.
- **WS-CAN-0057** (default model) — EURO's like-for-like edge was measured at 2.9–5.9%; the
  head-to-head above shows EURO beating the served lane at all three leads on n≈2,600. Neither
  overturns 12.0's conclusion that **the advantage is coverage, not model** (WS-CAN-0058).
