# The height residual is 67.5% site, and a global correction curve is refused

Measured 2026-07-30 (evening) against the live production residual archive — 1,973 rows, 60 NDBC
buoys. This **revises the interpretation** in `HEIGHT-ACCURACY-two-errors-that-cancel-2026-07-30.md`:
the stratified compression table stands as a *description*, but its *cause* is substantially
spatial, and that kills the "fit a global quantile map now" plan on its own evidence.

---

## 1. What was built, and what happened when it met the data

`services/weather_pipeline/height_quantile_map.py` + `scripts/fit_quantile_map.py` implement
phase 1 exactly as specified: EQM knots at matched 5–95% quantiles over the fittable bands,
identity outside with per-side blend margins scaled to the edge correction (a fixed margin smaller
than the correction folds the blend back — non-monotone; the tests caught it on the first fit).

Fitted on production (per OBSERVED band, never aggregate):

| band | n | buoys | bias before → after | MAE before → after | |
|---|---|---|---|---|---|
| 0.0–0.5 m | 131 | 13 | +0.349 → +0.269 | 0.355 → 0.287 | improves |
| 0.5–1.0 m | 651 | 38 | +0.240 → +0.158 | 0.295 → 0.274 | improves |
| 1.0–1.5 m | 649 | 46 | −0.022 → −0.083 | 0.270 → **0.305** | **REGRESSES** |
| 1.5–2.5 m | 454 | 33 | −0.177 → −0.181 | 0.323 → **0.341** | **REGRESSES** |
| 2.5–10 m | 88 | 8 | −0.360 → −0.348 | 0.403 → 0.390 | identity (thin) |

A conditional-mean candidate (bin residual by MODEL value, the MMSE-style correction) was measured
too: it helps 1.0–1.5 m dramatically (0.270 → 0.195) and worsens 1.5–2.5 m (0.323 → 0.385), and
its bin deltas **zigzag** (+0.14 @ 0.83 m, −0.367 @ 1.55, −0.056 @ 1.78) — not a curve, a mixture.

## 2. ★★★ The decisive decomposition

**67.5% of the residual variance is BETWEEN buoys.** Per-buoy mean bias: median +0.064, p10 −0.379,
p90 +0.397, extremes **−0.534 (46277) to +0.934 (46267)**, SD 0.316 m.

And the mixture explains the "compression": the over-reading buoys are SMALL-SEA sites (44090 /
41115 / 46267: mean obs 0.42–0.54 m, bias +0.62…+0.93) while the under-reading ones are BIG-SEA
sites (46277 / 46285 / 51202: mean obs 1.44–2.34 m, bias −0.44…−0.53). Stratifying on observed
height therefore mixes *site identity* with *sea size* — much of the band-wise "compression" is
site composition, not a global model law. Pearson r(model, obs) = 0.773.

★ This is the **same site-offset dominance** the nearshore validation found for Kr (site offset A
0.852–1.250, Snell anti-correlated) — one layer up, at the offshore input. The recurring shape of
this product's height error is **per-site, not per-magnitude**.

## 3. What this means, in order

1. ⛔ **No global height correction ships on this archive** — EQM or otherwise. The fitter now
   prints the between-buoy share and a SHIP/NO-GO verdict and **refuses `--upload` on a NO-GO**, so
   the plan cannot be re-believed against the data.
2. ✅ **Retention is the unlock, and it is live** (`buoy_residual_retention.py`, commit
   `86d511a3`): per-month append-only history segments. Per-site fits need independent weather
   systems per site — today each buoy has ~33 rows over 2.5 days ≈ 1–2 systems, which is why
   per-site correction must wait weeks, not because the method is wrong.
3. **The eventual correction is per-site** (offset first, then shape): fits keyed by buoy, applied
   by nearest-buoy/region at the offshore input, with the same identity-fallback discipline. It
   composes with — and is philosophically the same fix as — the per-site Kr transfer function.
4. **Unchanged by this finding:** the H1/10↔Kr cancellation (both-or-neither), ERA5's three roles
   (instruments=truth · ERA5=climate · GFS/EURO/ICON=forecast), and using ERA5 for per-spot
   climatology percentiles (task: `era5_spot_climatology`). The size-climatology work does not
   read the residual archive at all.

## 4. Method notes

- ★★ **The instrument must carry its own verdict.** The first dry run printed a table a hopeful
  reader could cherry-pick (two bands improve!). The script now computes the decomposition and
  prints NO-GO itself.
- ★★ **A synthetic test validates the machinery, not the plan.** The synthetic-compression tests
  pass — they prove the fitter decompresses a *true* global compression. Production data is not
  that, which only the production fit could say.
- ★ Candidate (b) conditioning on the model's own value is legitimate for *correction* (it is all
  the runtime knows); the memory's warning against bucketing by prediction applies to *evaluation*,
  which stays stratified on the observation here.
