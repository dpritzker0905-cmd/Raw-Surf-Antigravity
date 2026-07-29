# THE SCIENCE AUDIT — the rating has a DYNAMIC RANGE problem, not a physics problem

**Owner, 2026-07-29:** *"Maybe a clean offshore 3-4ft could read fair-good or good. Wave energy can
also be factored in, if its not already. Maybe you need to take a step back and really analyze the
science of surf forecasting and reporting to the T."*

Measured in-process against the production engine and real bathymetry. Companion to
`memory/THE-SURF-FORECAST-SCIENCE-canonical-chain.md` (how it works) and
`memory/JACOBIAN-the-shore-normal-dominates-2026-07-30.md` (what to fix in the INPUTS). This one is
about the **shape of the scoring function itself**.

---

## 0. ★★★ THE HEADLINE

**A clean offshore 3-4 ft already reads `fair_good` to `good`. The engine does what you asked.**
What it *also* does is score a **4 ft day identically to a 10 ft day** — and that is the real defect.

| clean, head-on, light offshore | score | level |
|---|---|---|
| 3.0 ft @ 8 s | 58.1 | `fair_good` |
| 3.5 ft @ 8 s | 70.5 | **`good`** |
| 4.0 ft @ 8 s | 81.3 | **`good`** |
| 4.0 ft @ 9 s | 84.0 | ⚠️ `epic` |

⇒ **The Florida complaint is not a scoring problem.** Early next week genuinely delivers 2.5–3 ft at
7.4–7.9 s, and that is `fair`. The engine matches your own 2026-07-12 anchor exactly.

---

## 1. ⛔ THE DEFECT: `size_score` SATURATES AT 1.2 m AND THE SCORE GOES SIZE-BLIND

Perfect wind, head-on swell, only H and T varying:

| Tp | 4 ft | 6 ft | 8 ft | 10 ft |
|---|---|---|---|---|
| 15 s | **100.0** | **100.0** | **100.0** | **100.0** |
| 12 s | 92.0 | 92.0 | 92.0 | 92.0 |
| 9 s | 84.0 | 84.0 | 84.0 | 84.0 |
| 7 s | 78.7 | 78.7 | 78.7 | 78.7 |

★★★ **Byte-identical.** `size_score` maps [0.2 m → 1.2 m] onto [0 → 1] and then flatlines. Real surf
runs 0.2 m to 10 m+, so **the entire useful range of the size factor is spent in the first four
feet**, and every wave above that is indistinguishable until the oversize gate fires.

Two visible consequences, and they are the two complaints:
1. **Florida (2–3 ft) sits on the steep part** → reads low, and small errors move it a lot.
2. **Everywhere else (4 ft+) sits on the flat part** → 4 ft reads `epic`, 10 ft reads the same.

★★ **THIS IS THE FOURTH INSTANCE OF THE SAME DEFECT FAMILY.** The spine predicted a fourth. The
first three were factors that could not say **NO** (fixed by making them multiply: `wind_gate`,
`oversize_gate`, `period_gate`). This one is a factor that cannot say **MORE** — the mirror image,
and the same root: *a bounded factor pinned at its bound carries no information.*

---

## 2. ★ WAVE ENERGY: THE RIGHT LENS, THE WRONG TARGET

Energy flux `P = (ρg²/64π)·H²·Te ∝ H²T` is the physical measure of "how much surf is there". The
rating has **no such term** — H and T are graded independently and T's only continuous contribution
is 40 % of an additive blend.

**Spearman ρ(energy, score) = 0.749** over 36 (H, T) combinations. The divergences are systematic
and they are *diagnostic*:

| case | energy rank | score rank | verdict |
|---|---|---|---|
| 10 ft @ 5 s | 11 | 28 | **under-rated — CORRECTLY.** 10 ft of 5 s chop is junk. |
| 8 ft @ 5 s | 15 | 27 | correctly under-rated |
| 4 ft @ 15 s | 18 | **0** | ⛔ **over-rated. 4 ft is not `epic`.** |
| 4 ft @ 9 s | 22 | 12 | ⛔ over-rated |

★★ **Do not target energy directly.** A 10 ft 5-second storm sea has huge energy and is unsurfable;
the model is right to reject it and an energy-maximising score would not. **Energy is the instrument
that reveals the blind spot, not the thing to optimise.**

### The double-count check — and it clears

Adding any energy term risks counting T twice, because T already enters the breaking height through
shoaling and the breaker index. Measured, offshore Hs held at 1.00 m, Tp 5 → 18 s:

| spot | breaking height ratio | energy ratio |
|---|---|---|
| **Cocoa Beach FL** | **×1.12** | ×3.60 |
| Lower Trestles CA | ×1.67 | ×3.60 |
| Pipeline HI | ×1.67 | ×3.60 |

⇒ **The height carries only 12–67 % of period's energy effect — and just 12 % in Florida.** An
energy-aware term would not meaningfully double-count.
★ Nice physical validation in passing: Cocoa Beach's breaking height **peaks at 15 s and falls at
18 s** (1.373 → 1.294 m). That is the wide shallow shelf — a longer wave feels the bottom sooner and
loses more to friction. The transform is doing real physics there.

---

## 3. ★ THE STRUCTURE JACOBIAN — where the 0–100 scale actually lives

Base 3.5 ft @ 9 s clean = 72.8. Each factor swept over its realistic range:

| factor | range | share of the score it can remove |
|---|---|---|
| `swell_exposure` | 0.100 – 1.000 | **90 %** |
| `wind_gate` | 0.193 – 1.000 | 81 % |
| `period_gate` | 0.250 – 1.000 | 75 % |
| `size_gate` | 0.257 – 1.000 | 74 % |
| `period_quality` | 0.400 – 1.000 | **24 points (additive, weight 0.40)** |

★★ **The multiplicative vetoes own the score; the only continuous period signal owns 24 points.**
That is why period feels weak in the output even though it is physically dominant in the energy.

---

## 4. ⇒ THE PATH FORWARD, IN ORDER

### 1. ★★★ SHIP `RATING_LOCAL_SIZE` — it *is* the dynamic-range fix
Not merely "calibration". It replaces the fixed 1.2 m saturation with **2.5 × the spot's own p80
good-day height**:

| spot | reference | saturates at |
|---|---|---|
| Florida | 0.7 m | **5.7 ft** (was 3.9 ft) |
| Pipeline | 2.5 m | **20 ft** (was 3.9 ft) |

That single change ends `4 ft ≡ 10 ft` everywhere, and it kills the 4 ft = `epic` absurdity
(size_gate 1.000 → 0.798).
✅ Built (`95c5f04a`, 2026-07-11), blob live (218 KB, 6×/day), preview surface shipped
(`d8635716`): `GET /admin/surf-forecast/local-size-preview`.
⚠️ It is a **redistribution, not a Florida boost** — the curves cross at 2.83 ft. It will *lower*
some small-surf scores. That is correct behaviour, and it must be stated before the flip so nobody
reads it as a regression.
**Blocked on:** one admin call to the preview endpoint, then an env flip in Render + precompute.yml.

### 2. ★★ FIX THE FLORIDA PERIOD BIAS — +3.2 s, and it runs GENEROUS
Measured against 18 NDBC buoys (`93663b1e`): globally we are unbiased (median +0.4 s), but the
short-period Atlantic reads **+3.2 s high**. Florida buoys say 3–4 s; we serve 5.2–7.6 s.
⇒ The true Florida sea is *worse* than we render. **Any recalibration toward "nicer" would be
compounding an error that already flatters that coast.** Fix the input before the scale.

### 3. ★★ ONLY THEN consider an energy-relative size term
With #1 shipped, re-run the energy analysis. If `4 ft ≡ 10 ft` is gone and the Spearman divergence
has collapsed to the *correct* rejections (big short-period seas), **no energy term is needed** —
local calibration will have absorbed it. If a gap remains, the principled form is a spot-relative
energy ratio rather than a bolt-on:

```
E     = H² · T
E_ref = H_ref² · T_ref          # from the SAME per-spot climatology, extended to carry T_ref
size_energy = f(E / E_ref)
```

⚠️ **Do not build this first.** It duplicates what #1 already achieves and would be a second
composition — the exact failure mode CLAUDE.md forbids.

### 4. ★ The inputs, per the existing Jacobian
Shore normal coverage → refraction/Kr site offset → depth-dependence. Unchanged by this analysis;
those remain the biggest *input* errors, while this document is about the *function's* shape.

---

## 5. ★ METHOD NOTES

1. ★★★ **Energy was the right question to ask and the wrong thing to optimise.** It found the defect
   in one table after three sessions of circling — because it is an *independent* yardstick, and a
   check that shares no assumptions with the thing it checks is the only kind that can surprise you.
2. ★★ **"4 ft ≡ 10 ft" was invisible from every previous angle** because every prior investigation
   fixed size and varied something else. Sweeping the plane exposed it immediately.
3. ★★ **The saturation defect has now appeared four times.** Three as "cannot say NO", once as
   "cannot say MORE". ⇒ audit every bounded factor for whether it spends its range where the data
   actually lives.
4. ★ Verify the fix that exists before designing the fix that does not.
