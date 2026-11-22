# Q2: What lead-time decay should the gap fill's anchored offset use? Is 120 h linear defensible? (research lead, 2026-11-22)

**Asked by:** the director, for the gap fill in #1136 (`ownRasterGapFill.js`).
**What #1136 does (read from its PR body, 2026-11-22):**
- For temperature, the fill is GFS plus an offset `w · (Model(t0) − GFS(t0))`.
- `t0` is the model's last own frame at the same UTC hour of day.
- `w` falls linearly from 1 to 0 over the 120 h after the seam. After that it is plain GFS.
- Rain is never offset.
- The PR calls the ramp "NOAA NBM's decaying-average bias handover" and states that it is unscored.

**Second opinions (advisory, selected context only):** SubQ and Reflection, folded in below.

## Answer
**120 h linear is acceptable as a labelled, unscored bridge. Its stated justification is wrong, and a better-supported shape exists.**

### 1. The NBM "decaying average" is not a lead-time decay
- In NAEFS and NBM, the decaying-average bias estimate is a running filter over PAST INITIALISATIONS: `B_new = (1 − w) · B_old + w · error`, with w ≈ 0.02, about a 50-run memory. It is applied at EVERY lead [1].
- It answers "what is this model's typical error at lead L?". It does not answer "how fast should a correction fade as lead grows?".
- **Fix #1136's wording:** cite it as "an analogy to blending systems' lead-weight ramps (IMPROVER [2])", not as the NBM decaying average.

### 2. The quantity carried is a single-frame difference, and it has two parts
`Model(t0) − GFS(t0)` mixes:
- **(a) a systematic resolution or terrain part.**
  - The 0.125° ICON sees coastal elevation, land-sea masks and sea breezes that 0.25° GFS smooths.
  - This part does NOT decay with lead. It is a property of the grids.
  - It should persist as a climatological offset. Cui et al. found that for week 2, a climate-mean bias correction beats the decaying-average estimate [1].
- **(b) a synoptic-state part** (the two models placing a front differently at t0).
  - This decays as both forecasts lose skill.
  - It can also flip sign. Carried forward it is noise, and that is the risk the 2026-11-19 advisor hold on the same-hour rule already partly addressed.

So decaying the whole offset to zero throws away (a), and holding (b) for 120 h keeps noise for days.

### 3. A better-supported shape (recommended for the follow-up, not a change to #1136 as merged)
`offset(L) = S(hour, cell) + w(L) · [Model(t0) − GFS(t0) − S(hour, cell)]`, where:
- **S** is the systematic part: the decaying-average (NBM sense) of `Model − GFS` at the same UTC hour over recent runs.
  - It is computed from our OWN stored frames. No truth and no new source are needed.
  - It persists at all leads, as the climate-mean term in [1].
- **w(L)** is fitted, not hand-set: the lag-correlation of the residual `(Model − GFS − S)` between the last native lead and lead L, measured from archived runs of both models.
  - An exponential with a fitted e-folding time is the parsimonious form.
  - IMPROVER's piecewise-linear ramps and the BoM's CRPS-optimised lead weights are the operational precedents for skill-driven, lead-varying weights [2][3].

**Verification (REQUIRED before calling it skilful):**
- held-out MAE AND ME per lead against ASOS / NDBC air temperature;
- three arms: today's 120 h linear, S-only, and S + fitted w;
- paired moving-block bootstrap with Holm;
- planted +1 °C and +2 °C controls;
- a seam check at the native horizon.

### 4. Counter-arguments (Reflection, SubQ)
- **A fitted decay can overfit noisy verification. The linear ramp is robust and auditable.**
  - Answer: w(L) comes from model-vs-model lag correlation, which has abundant data (every cell, every run). It is not fitted on scarce truth.
  - Truth is used only to score the three arms.
- **S assumes a stable resolution offset.** It can drift with season and regime.
  - Answer: the NBM-style running filter is exactly the tool for slow drift [1].
  - Still report S's stability by month, and per region (coast vs inland).
- **Rain.** No offset. #1136 is right: a precipitation difference is not additive.

## Bottom line for the director
- **Keep 120 h linear** as the labelled, unscored bridge #1136 ships with its kill switch.
- **Correct its citation:** the NBM decaying average is a filter over past runs, not a lead ramp.
- The evidence-based upgrade is a **persistent systematic offset S** plus a **fitted decay of the residual only**, scored before anyone calls it skilful.

## References
Not re-fetched this session. Earlier reads are in `log/2026-11-15-senior-research-lead-sota-plan.md`.
1. Cui, Toth, Zhu, Hou (2012). Bias correction for global ensemble forecast. *Weather and Forecasting* 27(2), 396-410. doi:10.1175/WAF-D-11-00011.1
   - Decaying-average (Kalman-type) bias estimate per lead, best for days 1-5. A climate-mean bias was better in week 2.
2. Roberts et al. (2023). IMPROVER: the new probabilistic postprocessing system at the Met Office. *Bulletin of the American Meteorological Society* 104(3), E680-E697. doi:10.1175/BAMS-D-21-0273.1
   - Linear and gradient lead-time weight ramps for blending.
3. Bureau of Meteorology operational blending: CRPS-optimised, lead-varying weights (Consensus, earlier read in this programme).
