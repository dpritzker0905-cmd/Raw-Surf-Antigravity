# Why the nearshore arm reads the MOP-fitted normals as WORSE (2026-11-11)

Research only. **Nothing served changes**, and `SHORE_NORMAL_MOP_CALIBRATED` stays held OFF (#780).

## The question

The coordinating session asked this as an open design question. In #780 the fitted swell-exposure normals beat the coastline normals against CDIP MOP out of sample: held-out MSE 0.0046 vs 0.0234 over 77 spots. Yet #773's `hb_proxy` arm reads them **WORSE** (ON loses 0.0385 m MAE, CI [0.0234, 0.0589]). Three hypotheses were tested:
- (a) location mismatch;
- (b) `hb_proxy` embeds the coastline normal;
- (c) real overfit, regional or seasonal.

The second task is to propose how the arm should score exposure-sensitive changes without circularity.

## Answer in one paragraph

(b) is false as phrased: `hb_proxy` uses no normal at all. It collapses into (a), because its truth carries the **station's** exposure, not the spot's. (a) is real at 2 of the 4 anchors where it can be tested. Scored against the station's own response, the spot-fitted normal loses at Rodeo Beach and La Jolla Shores, while MOP at the spot says it wins (Rodeo). At Blacks, the station and spot respond to the same bearing, and the station truth agrees with MOP.

(c) is also real, and it is the more important part. **On autumn (SON) hours, the fitted normal loses to the coastline normal against MOP itself at 3 of 5 anchors.** La Jolla Shores loses badly (0.131 vs 0.017). Two of the gate's "wins", La Jolla Shores and San Onofre, also flip under a small change in how buoy and MOP hours are paired.

A fourth mechanism, (d), is a level-bias confound in the MAE metric. It is plausible, but this study does not measure it directly.

So the arm's WORSE is partly an instrument artefact, (a) and (d), and partly a true signal, (c), for the autumn window it scores. The fitted normals should stay off.

## Method

Script: `backend/scripts/arm_conflict_study/arm_conflict.py`. Results: `arm_conflict.json` beside it.
- **Data:** CDIP archives and MOP v1.1 for 2022-01..2025-03, every second hour, offshore Hs ≥ 0.5 m.
- **Statistic:** the same as #780. Take the count-weighted MSE between the chain's own height factor and the target's normalised attenuation (target Hs / offshore Hs, binned in 10° of angle, normalised to the head-on bins). This scores the **shape** of the angular response, not its level.
- **Fit and score windows:** fit on 2022–2023, score on 2024-01..2025-03.
- **Anchors (station → spot, offshore buoy):**
  - 103p1 → Topanga (067p1)
  - 142p1 → Rodeo Beach (029p1)
  - 153p1 → Blacks (067p1)
  - 201p1 → La Jolla Shores (067p1)
  - 264p1 → San Onofre (067p1)
  - The 284p1 and 285p1 archives are not on THREDDS, so Upper Trestles and Pismo are untested.
- **Test (a):** fit an effective normal to the **station's** observed response, exactly as the spot normal was fitted to MOP. Then score the coastline, spot-fit and station-fit normals against both truths.
- **Test (c):** re-score the spot hold-out against MOP on September–November hours only. The arm's window is 2026-10-20..29.

## Results

Held-out MSE, lower is better. The bold value marks the loser in each pair where the verdict flips.

| anchor | coastline / spot-fit / station-fit normal | station truth: coastline, spot-fit, station-fit | MOP spot truth: coastline, spot-fit | MOP spot truth, SON only: coastline, spot-fit |
|---|---|---|---|---|
| Topanga (103p1) | 180 / 194 / 205 | too few head-on hours | 0.0034, 0.0020 | 0.0019, 0.0019 |
| Rodeo Beach (142p1) | 224 / 214 / **250** | 0.0189, **0.0272**, 0.0006 | 0.0044, 0.0027 | 0.0028, 0.0025 |
| Blacks (153p1) | 267 / 245 / 242 | 0.0154, 0.0006, 0.0004 | 0.0112, 0.0008 | 0.0232, **0.0321** |
| La Jolla Shores (201p1) | 302 / 229 / 243 | 0.0255, **0.0310**, 0.0118 | 0.0384, **0.0406** | 0.0175, **0.1307** |
| San Onofre (264p1) | 214 / 210 / 206 | 0.0009, **0.0013**, 0.0021 | 0.0003, **0.0004** | 0.0006, **0.0012** |

### (a) Location: confirmed where the station sits in a different window

- **Rodeo Beach.** Buoy 142p1 responds about 36° further west than the spot: station fit 250°, spot fit 214°.
  - Against the station, the spot-fit normal is worse than the coastline normal.
  - Against MOP at the spot, it is better.
  - The two instruments disagree because they measure different places.
- **Blacks.** Station and spot respond at 242–245°, and both truths favour the fit by a factor of about 14–25. Where the anchor is in the spot's own window, there is no conflict on shape.
- **(b) collapses into (a).** In `eval_scoring.hb_proxy(hs, tp, depth)`, the truth is the station's deshoaled Hs run through Komar–Gaughan, with no normal anywhere. The station's Hs already carries the station's exposure. The chain's prediction carries the spot's. So hb_proxy does not "embed the coastline normal". It embeds whatever bearing the buoy itself responds to, which is the location mismatch again.

### (c) Season and fragility: a real signal, and the arm scores exactly this window

- **Autumn reversal.** On SON hours, the fitted normal loses to the coastline normal against MOP at Blacks, La Jolla Shores and San Onofre. La Jolla Shores is the clearest case: a 72.5° rotation, from 301.5° to 229°, that loses 7.5× in autumn.
  - Interpretation: the fit is one bearing for a fixed cosine shape, trained on the full year. At a sheltered spot, the effective window moves with the swell mix: winter NW versus summer S, with island shadowing in between.
  - A single bearing is a year-weighted compromise. It can be right on the pooled year and wrong in the season the arm checks.
- **Fragile gate wins.** The #780 gate passed La Jolla Shores (held-out 0.0276 vs 0.0361) and San Onofre (0.00017 vs 0.00034).
  - This script pairs MOP and buoy times by hour instead of exactly. That change alone reverses both: 0.0406 vs 0.0384, and 0.00044 vs 0.00033.
  - Neither win survives a trivial perturbation, so the gate needs a robustness test.
- **Not leakage.** The train and test years are disjoint. This is model misspecification (one bearing, fixed shape), shown up by a seasonal subset. It is not a fit to the test data.

### (d) Level bias in the MAE metric: plausible, not measured here

- The chain already reads **below** hb_proxy at these anchors. #773's positive control shows this: H1/10 reads BETTER by +0.265 m.
- Against a low-biased predictor, any change that attenuates more raises MAE, even when its angular shape is more correct.
- Blacks is the evidence. The fit is far better in shape against the station, yet the pooled arm reads ON worse.
- The arm's output reports MAE and its CI but no mean signed error, so this study cannot split level from shape at the arm. That is the first instrument fix proposed below.

## What the literature says about validating refraction-aware nearshore transforms

- **MOP is validated against observed nearshore buoys, not against itself.** O'Reilly et al. validated the buoy-driven spectral refraction model against nearshore buoys seaward of the surf zone [1]:
  - skill is high in north San Diego County and low in the Santa Barbara Channel and southern Monterey Bay;
  - errors for individual events can be large, so the system is best for mean climate rather than single events;
  - errors correlate between neighbouring validation sites.

  Fitting a per-spot bearing to MOP at **hourly** resolution therefore imports MOP's event-scale directional error. A method-level check against observed buoys is the field's own standard.
- **Sheltered Southern California is dominated by offshore directional uncertainty.** Crosby et al. assessed boundary conditions at 16 nearshore buoys [3]. Crosby found that buoys with persistent misfit point to missing physics such as diffraction and reflection [2]. A spot whose response a single cosine cannot fit (La Jolla Shores, beside the canyon and the point) is the kind of site this predicts.
- **Breaking height itself can be observed.** Timex video estimates of breaking height reach about 18% normalised RMSE across sites [4]. This is a possible future spot-level truth for the surf height, rather than a proxy 1.5–10 km offshore.

## Proposal: scoring exposure-sensitive changes without circularity

"Exposure-sensitive" means any change to the normal, the exposure factor or the floor. Each such change needs four things.

1. **Score at the observation, through the observation's own geometry.** Run the chain at the anchor buoy's coordinates, with the normal the candidate method assigns to that buoy, and compare it with the buoy's observed Hs.
   - For a normals change, apply the same fitting method to the buoy's location: fit to MOP at the buoy's nearest MOP point, on training years only.
   - Then score held-out years against the **observed** buoy.
   - This validates the method that produced the spot normals against observations, and nothing in it is fitted to the truth. That removes both the location mismatch (a) and the MOP-on-MOP circularity.
2. **Report level and shape separately.** Add the mean signed error (bias) to every arm member, and a normalised angular-response error (the statistic used here) next to MAE.
   - A change that corrects shape but deepens an existing low bias should read as "shape BETTER, level WORSE". It should not read as plain WORSE.
   - Level is then fixed where it belongs, in the transform or the deshoal, and not by tuning the normal.
3. **Stratify by season and require per-anchor not-worse.** The arm's single autumn window is one season. An exposure change must not be worse in any season with enough head-on hours, after Holm correction. This mirrors the history filter.
4. **Robustness gate on the fit itself.** A per-spot fit ships only if its held-out win survives (i) a pairing perturbation (exact versus hour-floored matching) and (ii) a block bootstrap over held-out weeks. La Jolla Shores and San Onofre would have been held back.

Keep `hb_proxy` for what it measures well: offshore and level changes that do not touch exposure.

**MOP's role.** It stays the training source and a held-out sanity check. It is not the pass/fail truth for anything fitted to it.

## Consequences for `SHORE_NORMAL_MOP_CALIBRATED`

- **Stays OFF.**
- **Before any flip:**
  - rebuild the asset with the robustness gate in item 4;
  - drop or season-split spots whose SON score loses;
  - then run the station-geometry arm in item 1 on the CDIP nearshore stations that have archives.
- **Candidate model change.** If seasonal reversal is common, a per-spot two-window response (say, a bearing for NW swell and one for S swell) may fit better than one rotated cosine. That would be a new physics proposal with its own calibration, not a tweak to this one.
- **The >90° floor stays gated on this,** as before.

## Caveats

- Only 5 anchors, of which 4 are testable for (a). These numbers are diagnostic, not a calibration.
- Hourly-floor pairing is used throughout this script. The disagreement with #780's exact pairing is itself a finding (item 4).
- SON is approximated by day-of-year months.
- (d) is inferred from the positive control and the Blacks contrast, not measured.
- **Reflection was not consulted.** Its server instructions limit it to requests from the user by name, and this request came from the coordinating session. LongCat and SubQ are paid and were not used either.
- The app backend was never called. Data: public CDIP THREDDS only.

## References

[1] [The California coastal wave monitoring and prediction system](https://consensus.app/papers/details/9f1efdf2feb75db4829f866f2d5ad596/?utm_source=claude_code) (W. O'Reilly et al., 2016, Coastal Engineering)

[2] [Predicting coastal waves with buoy observations and global model output: A Southern California case study](https://consensus.app/papers/details/0c40ebfe63c757b990048fd1dae3fee3/?utm_source=claude_code) (S. Crosby, 2017)

[3] [Modeling Long-Period Swell in Southern California: Practical Boundary Conditions from Buoy Observations and Global Wave Model Predictions](https://consensus.app/papers/details/c5cf6332ef06555ab81e7ef90360783d/?utm_source=claude_code) (S. Crosby et al., 2016, Journal of Atmospheric and Oceanic Technology)

[4] [Breaking Wave Height Estimation from Timex Images: Two Methods for Coastal Video Monitoring Systems](https://consensus.app/papers/details/75cc3e1c21e356dda9571881f4080b61/?utm_source=claude_code) (U. Andriolo et al., 2020, Remote Sensing)
