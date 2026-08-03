# QUEUE — the LEARNED NEARSHORE TRANSFORM (the downstream ML), and whether it speeds the sim

**Status:** RESEARCH BRIEF, nothing built. Queued 2026-08-03 at the owner's request.
**Depends on:** ledger row 6 (no skill score — nothing is falsifiable without it) and row 2 (38%
degraded geometry). **Its training set is the ERA5 campaign now running.**

---

## §1 WHY THIS IS THE ML THAT APPLIES TO US, AND THE GPU ONE IS NOT

Three different things get called "GPU weather", and conflating them wasted a research pass:

| sense | what it is | applies to us? |
|---|---|---|
| CUDA-ported NWP | a physics model on GPU | **No** — we are a CONSUMER of ECMWF/NOAA, not a runner |
| AI weather emulator | GraphCast / AIFS / Aurora | **No** — AIFS produces NO WAVE fields; Aurora 0.25° Wave emulates HRES-WAM at ~25 km while Open-Meteo already gives us **WAM 9 km / MFWAM 8 km**. It is a RESOLUTION DOWNGRADE. |
| **our WebGL render** | `WebGLMarineEngine.js`, `WebGLMarineTextureEncoder.js`, `WebGLWindEngine.js`, `WebGLFilterEngine.js` | **Yes — this is ours, and it is RENDERING.** It makes the map fast and changes **no forecast number.** |

⭐ **The frontier for us is DOWNSTREAM.** No global model computes what a surfer stands in: the
nearshore transform from an offshore spectrum to a breaking wave at one reef. That is where our error
lives, and it is small-data, low-dimension, **CPU-trainable — no GPU at any point.**
Precedent: a random-forest surrogate of SWAN trained on buoys **beat SWAN at ~100× less compute**. The
model that fits our problem is ~10⁴ parameters, minutes to train.

## §2 THE TARGET — replace the two hand-built functions the audits keep landing on

Both are **geometric proxies standing in for a measurement we could now make:**

1. **`swell_exposure(swell_from, normal) = clamp(0.10 + 0.90·max(0, cos Δθ))`** — a straight-beach
   cosine with a hard half-plane cutoff. **~18% of served spots sit at its 0.10 floor** (n=979,
   replicated on two frames), median score **3.8** vs 21.1. Whether that is WRONG is still open — see
   §4 — but it is the single largest multiplicative term in the composition.
2. **`size_score`'s `reference_size_m`** — the per-spot typical day. The ERA5 campaign replaces a
   CIRCULAR reference (a percentile of our own ~2 days of forecasts) with 47 years.

**The learned object is a per-spot function `f(offshore Hs, Tp, direction, tide, wind) → breaking
height + a directional exposure weight`**, fit on that spot's own 47-year record put through the
production chain, and — where a buoy exists — corrected against instruments.
⚠️ **ERA5 IS NOT TRUTH: it under-reads extremes by 30–32%.** Use it for DISTRIBUTION SHAPE and
directional structure; never to correct our tails, or we launder our own error. Instruments = truth ·
ERA5 = climate · models = forecast. **Three roles, never conflated.**

## §3 ⚠️ DOES IT MAKE THE SIM FASTER? — the honest answer is NO, and here is the measurement that says so

The owner asked to queue it *if* it speeds the sim up. **On what is measured today it does not**, and
the queue entry says so rather than borrowing a second justification:

* The sim's rating is **nine multiplications and a `min`** — arithmetic, microseconds. There is no
  compute to surrogate away. `reconstruction_error: 0` in the sim payload is that arithmetic being
  re-derived exactly.
* The sim's real cost is **I/O**: it FETCHES the baseline it rates (`_baseline_with_source` → the app's
  point endpoint). An ML model does not remove a network round trip.
* ⇒ **If sim latency is the goal, the lever is the fetch, not the physics** — and the latency root
  already found (`1f5a796f`) is product-selection MISSES costing 13–43 MB / 18–35 s against a HIT's
  1.3–3 MB / 2–4 s. That is a **10–30× cache lever** sitting in front of a microsecond computation.

⭐ **WHERE A SURROGATE *WOULD* PAY, and it is not the sim:** the ERA5 campaign is **~78 s/spot ×
1,773 spots ≈ 38 h**, dominated by CDS queueing — one request per spot. A model that predicts a
spot's climatology from its geometry plus already-fetched neighbours would cut the *next* campaign
from days to minutes. **Measure before building:** the campaign now running is exactly the dataset
needed to test whether neighbour-interpolation reproduces a held-out spot's reference within
tolerance.

## §4 ⛔ WHAT MUST BE MEASURED FIRST — do not build on the open question

The `swell_exposure` floor is **measured** (18% of spots) and its **cause is NOT attributed**. The one
spot tested against history refuted the obvious story: **Arugam Bay's best decile is only 0.7%
floored** (control Hossegor 0.0%), so at that spot the cosine is fine and the served 3.9 may be right.
⇒ **Run `scripts/directional_exposure_probe.py --spots-file` over a sample of floored spots and read
`floored_top_decile_frac` BEFORE fitting anything.** Best decile floored ⇒ the model is wrong there and
is worth learning. Best decile clear ⇒ those are off-direction hours and there is nothing to learn.
⚠️ **First run, first limitation:** the probe VOIDED at Raglan — *"0 usable samples"* — because ERA5's
~0.5° wave grid has no usable ocean cell at that coordinate. **A learned per-spot transform inherits
that hole**, so the coverage of the training set must be measured, not assumed.

## §5 ORDER (unchanged by this entry — it is gated, not urgent)

1. **A skill score against instruments.** Until it exists, no learned model can be shown to beat the
   hand-built one, and "state of the art" stays uncheckable. **This is the true blocker.**
2. **Geometry**: 38% degraded shore normals. Better physics fitted on degraded geometry will not land.
3. **Then** the learned exposure/transform, validated by (1).
