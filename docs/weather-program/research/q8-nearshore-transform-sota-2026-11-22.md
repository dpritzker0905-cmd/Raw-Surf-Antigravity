# Q8: Is our nearshore breaking-height chain state of the art? The single biggest evidence-backed upgrade, with a test (research lead, 2026-11-22)

**Asked by:** the director.
**Second opinions:** SubQ (subq-snap-1.2 ranking) and Reflection (Beam-1.0). Both are advisory and marked below. LongCat was not used (the paid tool is failing).

## What the chain does (read on `dev` fe2240df1, 2026-11-22)
`surf_point.resolve_surf_geometry` / `estimate_surf_at` → `surf_transform.estimate_surf` (or `estimate_surf_partitioned` per swell partition):
- linear-theory shoaling `Ks`;
- a depth-limited cap: `γ · depth`, with γ inside the field-observed individual-wave envelope 0.63-0.81 (Carini et al. 2021, cited in the module);
- a geometric exposure factor: the cosine of the misalignment, 0% at 0°, −40.5% at 90°;
- one global refraction constant `REFRACTION_KR = 0.873` (a composed-chain fit, 2026-09-27);
- shelf friction implemented but off;
- the optional tide water level on the cap (PR B).

In California the EURO member serves CDIP MOP's nearshore forecast instead (D-069). MOP beat the bulk chain in the pre-registered nearshore judge (`evidence/2026-11-05-nearshore-mop/`).

## Answer
**No. Outside California the chain is a well-built parametric first cut, not state of the art.**
- What it lacks is **spot-specific refraction and sheltering**. The constant `Kr` and the cosine exposure are the same for every spot and only see the angle to one shore normal.
- Bathymetry focuses energy on headlands and reefs and shadows bays and islands. That is exactly where surf spots sit, and exactly what MOP models and we do not.

## The options, against the evidence
| Option | Evidence | Scales to thousands of free global spots? |
|---|---|---|
| **A. Per-spot spectral / partition transfer coefficients**, precomputed offline by backward ray tracing over public bathymetry, applied to each swell partition (the MOP principle; hybrid per-partition downscaling as in HyWaves) | MOP: an operational linear spectral refraction model, validated against nearshore buoys, low bias, skilful at most sites, weakest in sheltered and complex bathymetry [1][2]. HyWaves: per-partition hybrid downscaling reproduced Hs, Tp and direction at Pacific island sites [3]. Our own judge: MOP beat the bulk chain (D-069) | **Yes.** Computed once per spot, offline, from free bathymetry; serving stays arithmetic |
| B. ML downscaling per site | Comparable to, or up to 16% better RMSE than, a calibrated process model [4]. But it was trained on that model's catalogue plus observations, and needs about 25,000 samples per site [5] | No. Needs per-site truth or a calibrated model we do not have for most spots |
| C. SWAN on demand per spot | The physics reference. Cost is the problem, especially on our single 1-CPU box | No (CPU) |
| D. Per-spot bias correction from check-ins | Plausible later. Needs volume (the Q7 floor logic) | Later |
| E. A new breaker formula only | Breaker relationships remain uncertain [6]; our γ is already field-bounded | Small gain at best |

SubQ ranked A first (model confidence 0.97). Its second was unclear: E at 0.46, D at 0.28. These are the model's confidence weights in a ranking, not statistics or p-values (advisor limit on #1146, 2026-11-22).

**The single biggest evidence-backed upgrade is A:** per-spot, partition-resolved linear transfer coefficients (a "MOP-lite" for the rest of the world). Each swell partition's height, and optionally its direction, is multiplied by a spot-specific coefficient looked up by the partition's period and direction. That replaces the global `Kr` and the cosine exposure for spots that have coefficients. The depth-limited cap and γ stay as they are.

## Caveats (Reflection, adopted)
- **Bathymetry decides.** MOP's advantage comes from high-resolution bathymetry and full spectral propagation. Public bathymetry may not reproduce it everywhere:
  - GEBCO is 15 arc-seconds (~450 m) globally;
  - NOAA's coastal relief / CUDEM models are much finer for US coasts;
  - EMODnet covers Europe.
  So the test MUST include a check that MOP-lite reproduces MOP itself where both exist (California).
- **Height at 20 m is necessary, not sufficient.** Buoy Hs at about 20 m depth tests the transfer. It does not test breaking or surf quality. Surf-height truth (spot observations) stays the end-to-end check.
- **Local effects can dominate:** buoy siting, reflection and bathymetry error. Report per site, not only pooled.

## Test design (outline for a pre-registration; nothing fitted, so buoys can be EXAM truth)
- **Arms:**
  - `CHAIN`: today's chain, partition mode, run to the buoy's depth WITHOUT the breaking cap;
  - `LITE`: the per-partition transfer coefficients to the same depth;
  - `MOP`: CDIP MOP at the same point, California only (the benchmark `LITE` must approach);
  - `OFFSHORE`: no transformation (the floor).
- **Coefficients:**
  - computed once, before TEST, from frozen bathymetry: NOAA coastal relief / CUDEM in the US, GEBCO elsewhere;
  - backward rays from each target point, a frequency × direction grid matching the partitions' range;
  - sha256-frozen.
  - No parameter is fitted to buoy data.
- **Truth:** directional wave buoys at 10-40 m depth, outside the surf zone:
  - NDBC-owned stations;
  - CDIP stations as EXAM only (the programme rule: never fitted on; valid here because nothing is fitted);
  - optionally Copernicus In Situ European coastal buoys (licence-clean).
  - California sites are reported as their own region (the MOP check).
- **Metrics:**
  - Hs RMSE and ME, by region;
  - by incoming direction relative to the shore normal (the bins where sheltering matters);
  - for a pre-declared **sheltered subset**: sites where the open-ocean angular window seen from the buoy is < 90°, computed from the same bathymetry.
- **Statistics:** paired moving-block bootstrap over valid dates (5-day blocks), Holm across regions × direction bins. `LITE` must beat `CHAIN` overall AND not be worse in any region. In California, `LITE` vs `MOP` is a TOST at ±10% (reported; it says whether public bathymetry is good enough).
- **Controls:**
  - null (`CHAIN` vs itself);
  - planted +10% Hs (ME catches 2×, i.e. +20%);
  - a planted +20° / +40° direction rotation of the incoming partitions: sheltered-site errors must rise at 2×, otherwise the arm is direction-blind and the run is VOID.
- **Window:** forward. The served offshore partitions are archived per init (as in the wind and current gates), with at least 60 daily inits spanning at least two swell regimes.
- **Ship rule (D-065 / D-080):** if `LITE` passes, it ships ON for covered spots with a kill switch and a SCOREBOARD row. The breaking cap and the rating chain are untouched (ONE FORECAST COMPOSITION: `LITE` replaces factors inside `estimate_surf`, not the chain).

## Bottom line for the director
- The chain is a careful parametric first cut. The evidence-backed step to state of the art is **spot-specific spectral refraction**, which is what made MOP win in California, computed offline as per-partition transfer coefficients so the serve path stays cheap.
- Test it first against buoys at 20 m (with a MOP-reproduction check in California), then end-to-end against spot observations.
- ML downscaling and on-demand SWAN do not scale to our spot count or our box.

## References
1. O'Reilly et al. (2016). [The California coastal wave monitoring and prediction system](https://consensus.app/papers/details/w:8ac139fa-e71f-4508-8126-cfa7bdcdb79a/). *Coastal Engineering*.
2. Behrens et al. (2024). [Coastal Data Information Program: advances in measuring and modeling wave activity, climate, and extremes](https://consensus.app/papers/details/w:9685f0ab-dc61-43ee-b085-f4a95d4c3715/). *Coastal Engineering Journal*.
3. Ricondo et al. (2023). [HyWaves: Hybrid downscaling of multimodal wave spectra to nearshore areas](https://consensus.app/papers/details/w:0f3a5e6c-6ddf-401a-aed2-74f7ae5d3626/). *Ocean Modelling*.
4. Peach et al. (2023). [A comparison of process-based and data-driven techniques for downscaling offshore wave forecasts to the nearshore](https://consensus.app/papers/details/w:9b61b737-ba97-4f62-a99e-5bd9c1484729/). *Ocean Modelling*.
5. Portillo Juan et al. (2023). [Data-driven and physics-based approach for wave downscaling: A comparative study](https://consensus.app/papers/details/w:b82dddce-4083-4f2b-b5fe-9391f9a19232/). *Ocean Engineering*.
6. Robertson et al. (2013). [Breaking Waves: Review of Characteristic Relationships](https://consensus.app/papers/details/w:dd42ae59-b24e-45ed-aef0-e7a975acea72/). *Coastal Engineering Journal*.
7. Halsne et al. (2025). [Coastal wave refraction in variable currents over a varying bathymetry](https://consensus.app/papers/details/w:54bac8d3-88d1-41c0-a308-62077a16193a/). *Journal of Fluid Mechanics* (ray-tracing framework; depth- and current-induced refraction).
