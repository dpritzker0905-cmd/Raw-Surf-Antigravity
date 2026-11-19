# Best path toward SOTA: a synthesis of our own research (research lead, 2026-11-19)

The owner asked: "what is the best path toward SOTA? Look at our research and knowledgebase". This note ranks the
levers by EVIDENCE we already hold, not by what is in flight.

## What our research already established
- **E1. Chain error ranking.** Source: the 11-02 Jacobian of the real served chain (48 geometries × 288 seas).
  - Typical days: swell-to-shore ALIGNMENT (direction error 24° MAE → score error p50 11.9, p90 26) > per-site
    TRANSFER (Kr) > offshore Hs (grows with lead) > period DEFINITION > local wind.
  - Tail days: break depth / γ cap, transfer, alignment, tide.
  - Consensus weights, time interpolation and offshore sampling are each < 1 score point. Stop optimising them for
    accuracy.
- **E2. Height physics over-reads.** The ×1.27 on Komar likely double-counts (about +11% net after Kr 0.873). Canaveral
  reads 1.4-2× hot; the NE Florida over-read is about half Komar (11-16).
- **E3. Half a site's error is a stable per-site bias that does NOT transfer** (0.22 within 30 km).
- **E4. MOP in California:** a nearshore judge MAE of 0.250 → 0.096 m. It is graded on Scripps buoys, so it is
  re-judged under option C.
- **E5. Imagery** (the adviser's Sentinel-2 tests):
  - white water tracks surf over time (0.81);
  - period and direction carry information beyond height at 43 of 48 spots;
  - the chain did NOT beat a one-line period rule.
- **E6. Truth: n = 0** usable labels. blind_v1 has 0 rows; the legacy reports are staff/test data.
- **E7.** 11-02 DROPPED period MOS as a priority (about 0.1 rating point). The period lever is its DEFINITION (which
  period is served: D-081, Hs²·Tp dominant pick), not bias correction.
- **CONFLICT TO RECONCILE.** The repair lead's flip decomposition (period 36%, wind 31%, height 13%) and the Jacobian
  (alignment first) use different measures.
  - Direction acts THROUGH height and exposure, so "height 13%" likely hides alignment.
  - Before investing in step 3b's period-CORRECTION arm, rerun the flip attribution with direction as its own input.

## The ranked path
0. **TRUTH we own (gates everything nearshore).**
   - Get blind_v1 check-ins flowing (consent, anchors, traffic) and evaluate licence-clean surf-cam height extraction.
   - Without it, no nearshore method (MOP, NWPS teacher, physics K) can be certified "better" anywhere, and half the
     world has no agency nearshore model at all.
1. **ALIGNMENT, the #1 error term (E1).**
   - Serve swell TRAINS with their own directions (step 3, the D-081 gate), plus the Hs²·Tp dominant pick.
   - Correct the measured direction bias.
   - Each spot gets an exposure window (which directions reach it), from geometry now, refined by the teacher/imagery
     pilot.
2. **Per-site TRANSFER + per-site BIAS (E1, E3).**
   - K = MOP in California (keep; option C), teacher-distilled where NWPS/EWAM/CMEMS pass vs buoys, and the physics
     prior elsewhere.
   - Then the step-5 hierarchical per-site bias, fitted on our own truth. This is the half of site error that is fixed.
3. **HEIGHT PHYSICS FIX (E2).** It is cheap, gated, and fixes the Florida over-read: the ×1.27 double-count arm plus
   break-depth / dissipation placement.
4. **WIND: higher-resolution rating wind.**
   - Free NOAA HRRR (3 km, hourly) as the CONUS rating wind, an item already on our agenda.
   - Then step 3b's direction-aware MOS for the wind-class hit rate.
   - A better wind SOURCE beats correcting a coarse one.
5. **PERIOD = its DEFINITION (E7):** the D-081 rule and the dominant pick. Demote the 3b period-CORRECTION arm unless the
   reconciled flip attribution says otherwise.
6. **HONEST UNCERTAINTY + ENSEMBLES:**
   - step 6, the ±1 level range from spread;
   - L1 probabilistic Hs using GEFS-Wave and ECMWF `waef`, plus the AIFS-ENS `waef` 51 ML members (verified 11-18).
7. **STOP:** tuning consensus weights or time interpolation for accuracy (E1). They are worth < 1 point.

## The MOP decision inside this path
Option C stands: MOP is the best California transfer physics we have, so keep it while it is re-judged on non-Scripps
evidence ("not worse"). The path to "better" is step 0, our own truth.
