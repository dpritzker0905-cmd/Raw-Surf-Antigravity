# Q7: Is the rating's tide_fit state of the art for surf quality vs tide, by break type? (research lead, 2026-11-22)

**Asked by:** the director. Context: the surf rating's tide_fit and the depth cap now take our FES tide (PR B); MLLW is display only.
**Second opinions:** SubQ (subq-snap-1.2 ranking) and Reflection (Beam-1.0). Both are advisory; their points are marked below. LongCat was not used (the paid tool is failing; director, 2026-11-22).

## What the code does (read on `dev` fe2240df1, 2026-11-22)
- **Level.** `tide.tide_state_at` returns `norm`: the tide height placed between the minimum and maximum of the surrounding ±12 h (`window_h = 12`). 0 is the local low, 1 the local high. It also returns `trend` (rising / falling / slack).
- **Preference.** `surf_rating.parse_best_tide` maps the spot's free-text `best_tide` to a band:
  - low 0-0.35; mid 0.33-0.67; high 0.65-1.0;
  - low-to-mid 0-0.60; mid-to-high 0.40-1.0;
  - "all", "any", or a trend-only note → no preference.
- **Factor.** `tide_fit = clamp(1 − 1.3 · distance outside the band, 0.5, 1.0)`. It is neutral when either input is missing.
  - It uses the level only. `trend` is computed but never enters the factor.
  - It is gated by `RATING_TIDE`, code default `"0"` in `spot_ratings.py` (the flag registry entry on `dev` reads `"0"` too).
- **No break type.** No break-type field (reef / point / beach) is read by the rating. The factor is the same shape for every spot.

## Answer
**No published surf-forecast study defines or validates a tide-quality function**, so "state of the art" here means current practice, not a proven method.

Our approach, an expert prior band on tide level applied as a gentle multiplier, matches what the literature and products do:
- Espejo et al.'s global surfing index uses tide through expert judgment [1].
- Commercial forecasts publish per-spot expert tide preferences. That is product knowledge with no public validation, so it is not evidence of skill.

It is a reasonable prior. **It is not shown to be better than no tide term**, and three parts of it are weaker than the physics supports.

## What the evidence says, by break type
- **Reef and ledge breaks.**
  - Water depth over the reef crest controls whether, where and how hard waves break. On fringing reefs, setup and breaking change measurably across the tidal range for the same incident wave [2].
  - On the Gold Coast, wave peel tracking showed tide changing breaking patterns and intensity on a reef differently from the adjacent beach [3].
  - The quantity that matters physically is ABSOLUTE depth over the feature, not the position within the day's range.
- **Point breaks.** Refraction around the headland and the inshore shelf set the peel. Tide moves the breaking position along and across the point. Same physics as reefs, usually weaker [4].
- **Beach breaks.**
  - Sandbar depth dominates, and the bars move week to week. Video studies show breaking shifting across shore with the tide, and bimodal breaking on a low-tide terrace beach [5].
  - A fixed per-spot preference is least stable here, because the bar migrates.
- **Height, not only quality.**
  - Wave-tide interaction modulates nearshore significant wave height by up to about 20-25% where tidal currents are strong (Irish Sea model [6]; Florida CDIP buoy observations, plus peak-period shifts up to 1 s [7]).
  - That is a HEIGHT effect our chain does not model (tidal currents are absent). It is separate from tide_fit.
- **Typology.** The standard classes are point/headland, beach, river or estuary bar, reef and ledge [4]. Wave height, peel angle, breaking intensity and section length are the essential surf parameters, and tide acts on all but the first through depth.

## Three weaknesses in tide_fit
1. **Relative normalisation ignores the spring-neap cycle.**
   - `norm = 0.9` on a neap day is a lower absolute water level than 0.9 at springs.
   - For reefs and points, the physics [2][3] says absolute depth matters.
   - SubQ ranked "absolute level vs a datum or break depth" as the better predictor for reefs and points (p = 0.76, vs 0.12 for relative).
   - **Counter (Reflection):** absolute thresholds need an accurate reef-crest elevation and datum, and coarse public bathymetry may make the absolute version noisier than the relative band. **That is why it must be tested, not assumed.**
2. **Trend is ignored.** Many spot notes say "incoming" or "push". The parser drops trend-only text, and the factor never uses `trend`.
3. **Mixed and diurnal tides.**
   - In diurnal regimes the ±12 h window can hold only one high and one low.
   - In mixed semidiurnal regimes the two highs differ, so "high" means different depths within the same day.
   - Normalisation still works, but the band then means a different depth at each high.

## Recommendation
1. **First (pre-register now, cheap):** an OFF/ON ablation of the current `tide_fit` against the rating truth we already score (the rating-truth harness).
   - **Caution (Reflection):** if a truth source already embeds tide preferences, the test is confounded. Use truth that is independent of `best_tide`, and report that condition.
   - This answers whether the prior earns its place before any refinement is built.
2. **Arms for the refinement test (pre-registered beside it; all from FES `η` + datum; no fitting on TEST):**
   - `REL`: today's relative band;
   - `REL+TREND`: plus a signed rising/falling term, used only where the spot note names a trend;
   - `ABS`: absolute level relative to a per-spot threshold, for reef and point spots only. The threshold comes from the spot's `break_depth_m` asset where present, else `REL`.
   - Report by break type and by local tidal range (micro < 2 m, meso 2-4 m, macro > 4 m). Reflection suggested pooling by tidal range.
3. **Per-spot tide preference learned from check-ins: worth pre-registering NOW and running LATER.**
   - **Model:** hierarchical, with each spot's preferred band shrunk toward its break-type × tidal-range group. Partial pooling is what makes thin per-spot data usable.
   - **Volume floor before any run:** at least 30 rated sessions per spot, spread over at least 3 tide terciles. A spot below the floor uses its group.
   - **Holdout:** time-blocked; each spot's newest 30% of sessions are TEST.
   - **Gate:** beats the expert band on held-out ratings (MAE of the 0-100 rating; paired block bootstrap; Holm across break types). Planted controls: a tide-shuffled label must lose its gain; a planted +0.2 band shift must be recovered.
   - **Why now:** the floor will take months of check-ins. Registering first stops the band being tuned to data already seen.
   - **Risk (Reflection):** low check-in volume makes per-spot estimates unstable, so the floor and the pooling are not optional.
4. **Not recommended:** a tidal-current height modulation (wave-tide interaction [6][7]).
   - It is real but regional: the big effects are in strongly tidal shelf seas and inlets.
   - It needs tidal currents we do not serve.
   - Note it as a known missing term for macro-tidal coasts.

## Bottom line for the director
- `tide_fit` matches practice (an expert prior on level) but is unproven, and it is still OFF by default.
- Register its OFF/ON ablation and the `REL / REL+TREND / ABS` refinement test now.
- Register the check-in-learned per-spot preference now, with a hard volume floor and break-type pooling, to run when check-ins reach the floor.

## References
1. Espejo et al. (2014). [Surfing wave climate variability](https://consensus.app/papers/details/w:43847627-998c-4b21-ae67-85c61e29e8d3/). *Global and Planetary Change*.
2. Becker et al. (2014). [Water level effects on breaking wave setup for Pacific Island fringing reefs](https://consensus.app/papers/details/w:5628feab-a568-4e1c-ad14-02edf648787b/). *Journal of Geophysical Research: Oceans*.
3. Thompson et al. (2021). [Wave Peel Tracking: A New Approach for Assessing Surf Amenity and Analysis of Breaking Waves](https://consensus.app/papers/details/w:1b399e6a-bc47-43eb-8e13-2acc6a3f44a9/). *Remote Sensing*.
4. Scarfe et al. (2009). [Research-Based Surfing Literature for Coastal Management and the Science of Surfing — A Review](https://consensus.app/papers/details/w:ab69226f-bc8f-49b1-b918-cd67c590eca0/). *Journal of Coastal Research*.
5. Yin et al. (2024). [Analysis of Tidal Cycle Wave Breaking Distribution Characteristics on a Low-Tide Terrace Beach Using Video Imagery Segmentation](https://consensus.app/papers/details/w:b1eb3e80-c465-412b-8f14-a2715340f4d4/). *Remote Sensing*.
6. Lewis et al. (2019). [Wave-tide interaction modulates nearshore wave height](https://consensus.app/papers/details/w:74fdd0da-42a5-4adb-8a38-cd896259ddc0/). *Ocean Dynamics*.
7. Ho et al. (2022). [Wave–Tide Interaction for a Strongly Modulated Wave Field](https://consensus.app/papers/details/w:5aeafaef-4034-4169-bce6-1f08d4cb7f69/). *Journal of Physical Oceanography*.
