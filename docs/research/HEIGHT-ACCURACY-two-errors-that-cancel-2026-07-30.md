# The displayed surf height is right by accident, and the input compresses

Measured 2026-07-30 against live NDBC buoys, the CDIP validation archive, and the production
calibration blob. Written because `SURF_HEIGHT_H110` was queued as the next accuracy win and
flipping it alone would have made every height on the product **25.5% too high**.

---

## 1. ⛔ Two measured errors of opposite sign are holding the height up

| error | measured | effect |
|---|---|---|
| transform assumes **no refraction** (Kr = 1.0) | **Kr = 0.797** — CDIP instruments, 385,651 QC-good swell hours, 10 independent CA sites | we over-predict nearshore height by **+25.5%** |
| we emit **Hs** where the surf standard is **H1/10** | H1/10 / Hs = **1.27** | we report **−21.3%** low |
| **net displayed vs correct** | (1/0.797) / 1.27 = **0.988** | **−1.2% — accidentally right** |

**Neither half may ship alone.**

    SURF_HEIGHT_H110 alone  -> every height x1.27  -> +25.5% TOO HIGH
    a Kr correction alone   -> every height x0.797 -> -21.3% TOO LOW
    both together           -> correct

✅ Guarded by `tests/test_surf_height_convention.py::
test_h110_and_the_missing_refraction_nearly_cancel_so_neither_ships_alone`, and the science audit
now prints the coupling instead of advertising H1/10 as a free win.

⚠️ The cancellation is a coincidence, not a design. It holds at the *median* CDIP site; Kr is
directional and swings up to **1.75× at a fixed site** (one site focuses 1.30 from 150° and blocks
0.75 from 270°), so per-spot it is much looser than −1.2%. This is a reason to fix both properly,
not a reason to relax.

---

## 2. The bigger, uncancelled error: the offshore input COMPRESSES

The production calibration blob, 1,913 archived residuals across 60 NDBC buoys (2026-07-28 →
07-30), stratified on the **observed** height:

| observed band | rows | independent buoys | bias | |
|---|---|---|---|---|
| 0.0–0.5 m | 128 | 13 | **+0.355 m** | reads HIGH |
| 0.5–1.0 m | 627 | 38 | **+0.236 m** | reads HIGH |
| 1.0–1.5 m | 629 | 46 | −0.024 m | unbiased |
| 1.5–2.5 m | 442 | 33 | **−0.175 m** | reads LOW |
| 2.5–10 m | 87 | 8 | **−0.363 m** | reads LOW |

**Aggregate bias is +0.107 m and hides all of it.** Monotonic compression toward the mean: small
seas over-read, big seas under-read. ★ A near-zero aggregate is the trap; only the stratification
shows the defect.

This is *not* cancelled by anything. It stacks on top of §1, and it explains the smell that started
this investigation — Pipeline reading **4.6 ft** and Waimea **4.7 ft** in late July, when the North
Shore is flat and the Waimea buoy (51201) measured **1.1 m at 8 s**.

★ **The product compresses twice, independently.** `size_score` saturates so 4/6/8/10/12 ft all
score identically, and the height input compresses so small reads big and big reads small. The same
defect shape in two different layers.

---

## 3. ✅ The blocker on the fix has cleared

Quantile mapping is the standard remedy for a compressing wave model, and on 2026-07-28 this repo
recorded it as unfittable — *"the blocker is EVIDENCE, not method"* — because the top band held
**2 buoys**. The residual archive was built to accumulate exactly this.

Today the three bands that carry almost all surf are fittable:

    0.5-1.0 m   38 independent buoys   FITTABLE
    1.0-1.5 m   46 independent buoys   FITTABLE
    1.5-2.5 m   33 independent buoys   FITTABLE
    0.0-0.5 m   13 buoys               thin
    2.5-10  m    8 buoys               thin  (was 2 on 07-28)

⚠️ Fit the core, leave the tails on the identity until they fill. A map fitted on 8 buoys in the top
band would calibrate big-wave behaviour off almost nothing, and the tails are where the error is
largest — the worst place to guess.

---

## 4. Order of work this implies

1. **Quantile-map the offshore input** on the three fittable bands. It is the dominant *uncancelled*
   error and everything downstream inherits it.
2. **Then Kr + H1/10 together**, never separately. Kr wants a directional transfer function per site
   (CDIP's own MOP system computes exactly this); a scalar Kr and a Snell-law Kr are both measured to
   be the wrong shape.
3. `RATING_LOCAL_SIZE` addresses the *rating-side* compression and is independent of all of the above.

## 5. One thing still unexplained

Feeding the measured Waimea buoy state (1.1 m / 8 s / 34°) through our own transform yields
**0.90 m**, but production published **1.40 m** for that spot and hour — implying an offshore input of
~1.9 m, or **1.73× the buoy**. The same inversion at Mavericks implies **1.82×**. That is far larger
than the +0.24 m the stratified archive attributes to that band.

⚠️ Two points, and the buoy reading is ~2.5 h older than the forecast valid time, so this is a lead
rather than a finding — the model may be tracking a building swell, sampling a different partition,
or reading a grid point away from the buoy. **The 1,913-row archive is the reliable measurement; this
is the thing to check next.** Do not act on the 1.7× figure without matching times properly.

---

## Sources

- `backend/scripts/validate_nearshore_transform.py` — CDIP THREDDS, Kr measurement
- `weather-products/calibration/buoy_latest.json` + `buoy_residual_archive.json` — live production
- NDBC realtime 51201 (Waimea Bay), 46012 (Half Moon Bay), fetched 2026-07-30T16:26Z
- `docs/research/SURF-FORECASTING-SCIENCE.md` §1 — the H1/10 standard and its sources
