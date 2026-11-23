# Q11: Scoring and calibrating the 0-100 rating against blind check-ins (2026-11-22)

**Author:** senior research lead. **Status:** research note; nothing built and no served number changes.
**Why now:** three registered gates score the rating against the blind quality field (#1151):
- `surf-tide-v1` (#1147);
- `rating-wind-gate-v1` (#1173);
- the coming rating-calibration work.

Each currently uses a level hit rate and mean level error. This note asks what the state of the art adds, and how to clean crowd labels before they become truth. Literature was read at abstract level through Consensus.

## 1. What the rating is, statistically
- A deterministic score from 0 to 100, cut into 7 ordered levels (`surf_rating._BUCKETS` 14/28/42/56/70/84).
- The truth is one surfer's level for that spot and hour: ordinal and noisy, and it differs between observers.

## 2. State of the art for this kind of verification
1. **Reliability by isotonic regression (CORP).** Reliability diagrams estimated by isotonic regression (the pool-adjacent-violators algorithm) are stable and need no binning choices. The mean score splits into three parts (Gneiting et al. 2023, *Electron. J. Stat.*):
   - miscalibration (MCB): the levels are biased or stretched;
   - discrimination (DSC): the levels separate good days from bad;
   - uncertainty (UNC): the truth's own spread.

   Why it matters here: a level hit rate mixes "the rating is biased" with "the rating cannot tell days apart". Those need different fixes: re-mapping the scale for the first, new physics for the second.
2. **Isotonic distributional regression (IDR)** (Henzi et al. 2021, *JRSS-B*). It learns the observed-level distribution as a function of the score, constrained to be monotone, with no tuning. It is calibrated by construction and was competitive with state-of-the-art post-processing in the precipitation case study.
   - For us: a monotone map from score to "the chance a blind observer says epic / good / ...", fitted on a TRAIN window and frozen.
   - This is the natural first calibration layer, and it keeps the physics untouched.
3. **Scoring rules for ordered categories.** If the rating ever carries a level distribution (from IDR), the ranked probability score is the proper score.
   - The `scores` package (Leeuwenburg et al. 2024, JOSS; Python and xarray) implements isotonic reliability, RPS and the FIRM score.
   - FIRM (Fixed Risk Multicategorical) scores multi-level categories with asymmetric costs. For example, calling "epic" on a poor day could cost more than the reverse. The owner would set that cost before any data.
   - Check the `scores` licence before adopting it.
4. **Cleaning crowd labels before they are truth.** Crowdsourced wind observations needed four steps before they could be used (Chen et al. 2021, *QJRMS*):
   1. within-station range and consistency checks;
   2. per-station bias removal by quantile mapping;
   3. between-station consistency against neighbours;
   4. handling of false zeros.

   Temperature crowd networks use the same structure (CrowdQC+, Fenner et al. 2021). For surf check-ins, the observer is the "station":
   - Some surfers rate everything a level high.
   - Two reports at the same spot within an hour should broadly agree.
   - A "flat" report when nobody was in the water is the false zero.

## 3. Recommendation (for the gates that use blind quality)
1. **Pre-register a truth QC for #1151's field** (in its own gate, before any gate reads the field):
   - (a) drop rows that fail the screen's own blindness check;
   - (b) a per-observer offset, estimated only on a TRAIN window as the observer's median level difference from other observers at the same spot within ±1 h. It needs at least 10 such pairs; otherwise the offset is 0;
   - (c) a between-observer consistency flag: a report 3 or more levels from the same-hour median of at least 2 other reports is flagged. It is reported, not dropped.

   Each gate reports RAW (primary, as registered) and ADJUSTED (secondary). The adjustment never becomes primary after the fact.
2. **Add the CORP decomposition (MCB / DSC / UNC) as a reported secondary in every rating gate** (#1147, #1173 and later ones), by amendment before their data. A gain that is only an MCB gain says "re-map the scale", not "the physics improved".
3. **Register IDR as the calibration benchmark arm** for a later `rating-calibration-v1` gate:
   - TRAIN on the first half of the blind data, TEST on the second;
   - the arms are the served levels vs IDR-mapped levels;
   - scored by RPS, plus the level hit rate for continuity.

   It only re-maps the scale, so it is cheap and low-risk, and it stays dark until the gate passes.
4. **FIRM costs:** ask the owner once, before data, whether over-calling (saying good when it is poor) costs more than under-calling. If he does not answer, use a symmetric cost.

## 4. Limits
- These are abstract-level reads. The decomposition and IDR are standard in meteorology but have not been applied to surf ratings in anything found.
- Observer offsets need repeat reporters. Early on, most observers will have fewer than 10 pairs, so ADJUSTED will mostly equal RAW.
- A blind check-in is one person's perception of one hour. Ordinal noise caps any achievable hit rate, so the gates' bars must be read against the floor that UNC sets.

## References
[1] [Regression diagnostics meets forecast evaluation: conditional calibration, reliability diagrams, and coefficient of determination](https://consensus.app/papers/details/w:94c5b568-8db0-403e-9cf4-64fd7e27d165/?utm_source=claude_code) (Gneiting et al., 2023)
[2] [Isotonic Distributional Regression](https://consensus.app/papers/details/w:099d784c-2745-4ac6-a1da-8ebdb19a4549/?utm_source=claude_code) (Henzi et al., 2021)
[3] [scores: A Python package for verifying and evaluating models and predictions with xarray](https://consensus.app/papers/details/w:0d56f435-190d-4c06-b732-0db5f00f23b1/?utm_source=claude_code) (Leeuwenburg et al., 2024)
[4] [Quality control and bias adjustment of crowdsourced wind speed observations](https://consensus.app/papers/details/w:49cf1077-3fe7-4b59-976a-1847efbf57c0/?utm_source=claude_code) (Chen et al., 2021)
[5] [CrowdQC+ — A Quality-Control for Crowdsourced Air-Temperature Observations](https://consensus.app/papers/details/w:02e2c0de-6a1d-4dc6-96b4-6ae7f54d0f8e/?utm_source=claude_code) (Fenner et al., 2021)
