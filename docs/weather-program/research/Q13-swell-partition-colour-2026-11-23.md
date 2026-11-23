# Q13: what should a partition layer's cell colour encode?

Dated 2026-11-23. Research for the owner decision on #1198. No code, no served change.

**Question.** On the map's `swell_1`, `swell_2` and `wind_waves` layers, what should a cell's colour show?

- **(A)** the 0–100 surf rating of the whole sea at that cell, labelled "Surf quality: whole sea", with the partition's own height in the infobox and legend.
- **(B)** the partition's own physical height. The rating stays only on the total layer, the spot pages and the infobox.
- **(C)** each partition rated as if it were alone. This was the old behaviour, and it breaks the one-forecast-chain rule.

**Recommendation: (B).** Colour each partition layer by its own physical height. Keep the surf rating on the total layer, the spot pages and the infobox. Details and the failure modes are in §4.

## 1. What the primary publishers show

| Source | Partition layer shows | Rating shown? | Evidence |
|---|---|---|---|
| Surf-forecast.com (FAQ) | Swell sizes are open-water heights, not breaking heights. The "surf quality" star rating combines swell size, period and wind, and goes pale in onshore wind. Swell maps show wave energy (kJ) per swell. | Yes, a whole-conditions rating, separate from the swell map | [Surf-forecast FAQ](https://www.surf-forecast.com/pages/faq) (read directly) |
| Windy (community help) | Swell 1 and Swell 2 are the largest and second-largest swell trains. "Waves" is the total of wind waves and swell. | No rating in the thread | [Windy: How to interpret Swell 1 and Swell 2?](https://community.windy.com/topic/23699/how-to-interpret-swell-1-and-swell-2) (read directly; community answers, not an official help article) |
| Copernicus Marine | Forecast partitions carry partition height, period and direction (for example `VHM0_SW1`, `VMDR_SW1`). The viewer provides maps and time series. Whether the viewer draws partition layers was not found. | No | [Copernicus global wave analysis and forecast](https://data.marine.copernicus.eu/product/GLOBAL_ANALYSISFORECAST_WAV_001_027/description) and [Earth Engine catalogue entry](https://developers.google.com/earth-engine/datasets/catalog/COPERNICUS_MARINE_WAV_ANFC_0_083DEG_PT3H) (search-reported) |
| PredictWind (not in the owner's list; a reference) | Colour is significant wave height for swell and wind waves; arrows are direction; contours are mean period. | No | [PredictWind wave maps help](https://help.predictwind.com/en/articles/2884611-how-to-use-wave-maps) (search-reported) |
| Surfline | **Not verified.** The help centre and the swell-chart legend could not be read (the page returned a bot challenge). | Unknown | — |
| Magicseaweed | **Not verified.** Not read in this session. | Unknown | — |
| Stormglass | **Not verified.** The docs page fetched was a 2 kB JavaScript shell with no content. | Unknown | — |
| PacIOOS | **Not verified.** The search found no partition map page. | Unknown | — |

**Reading.** Where a partition layer is shown, the publishers draw its physical quantity (height, energy or period). The one surf rating in the set sits next to the whole sea, not beside a single swell. The Surf-forecast FAQ is the only source that uses a rating at all, and it keeps the rating separate from the per-swell maps, which show physical energy.

## 2. Literature on partition display

- **Partitioning is for interpretation.** Wyatt et al. (2022) describe partitioning as a way "to simplify, and hence make more useful, the interpretation of the spectrum for users of wave data". Source: [Wyatt et al. 2022, J. Operational Oceanography](https://consensus.app/papers/details/w:7fe0612e-d7f0-40f6-ba6c-9d58ed36ae97/?utm_source=claude_code) (abstract read via Consensus).
- **Swells usually coexist with wind sea.** Mazzaretto et al. (2024) find swells coexist with wind sea on about 70% of the global coast, and about 30% of coastal locations have at least five swell systems. Source: [Mazzaretto et al. 2024, Frontiers in Marine Science](https://consensus.app/papers/details/w:fad3aa52-8a57-461a-ba1a-1822213fbfa0/?utm_source=claude_code) (abstract read). This matters because a single partition rarely sets the surf on its own.
- **No user-study evidence found.** Searches for forecast-communication studies on partition colour encodings returned nothing directly on point. **Unverified: no published user test of partition colour encodings was found.** Treat the user-test design in §4 as a proposal, not as a finding.

## 3. Why (A) and (C) are weaker

- **(C) breaks the chain.** Rating each partition alone ignores how the partitions combine. The one-forecast-chain rule exists because a surf quality must come from the same composition as the forecast it sits beside.
- **(A) is coherent only if labelled, and still misleads.** The label "whole sea" fixes what the number means, but not the layer. Every partition layer would then show the same colour field, so switching layers changes only the infobox text. A colour that does not change with the layer is a false affordance.
- **(A) puts a quality on a physical quantity.** Surf-forecast keeps its swell maps (physical energy) separate from its rating for the same reason.

## 4. Recommendation (B), with its failure mode and a test

**Recommend (B).** Colour each partition layer by the partition's own physical height, in metres or feet, with the unit in the legend. Keep the 0–100 rating on the total layer, the spot pages and the infobox.

**Main failure mode.** Users read height as quality. A large short-period wind sea looks attractive, while a small long-period groundswell looks skippable. The second risk is unit confusion: a rating on one layer and metres on another. Mitigation: a distinct colour ramp for partition layers, an explicit unit in the legend, and a one-line note under the rating that the rating is the whole sea.

**Proposed user test (not run).** Within-subject, counterbalanced, with surfers of mixed experience. Tasks: go/no-go ("worth paddling out?"), attribution ("which swell is making the waves at this spot?"), and recall ("what does this colour mean?"). Compare A (labelled) and B. The expected result, to be tested rather than assumed: B is faster and more accurate on attribution, and A produces more "this swell scores 75/100" statements despite the label. The design should record misattribution, not only accuracy.

## 5. What the advisory views say, and where they differ

- **LongCat:** B, as reported by the director. Not re-run in this session.
- **SubQ (subq-savant-1.4, medium effort):** B. Its main argument is that a partition is a physical decomposition, and that A puts the same rating on three layers, which is a false affordance.
- **Reflection (Beam-1.0):** B. Its main risk is that users read a partition's height as its contribution to quality.
- **The advisor:** A is coherent if labelled; B is a different product. This note's reading agrees that A is coherent if labelled. It disagrees on the layer-switching point: under A the three partition layers render the same colour, so the labels cannot carry the difference alone.

## 6. Open items

- Surfline, Magicseaweed, Stormglass and PacIOOS displays are unverified. Their legends would settle whether any of them colours a swell layer by a rating; a screenshot from each would do it.
- Copernicus viewer support for partition layers is unverified.
- The user test in §4 has not been run.

## Sources

- Surf-forecast.com FAQ: https://www.surf-forecast.com/pages/faq
- Windy community, How to interpret Swell 1 and Swell 2?: https://community.windy.com/topic/23699/how-to-interpret-swell-1-and-swell-2
- Copernicus Marine, global wave analysis and forecast: https://data.marine.copernicus.eu/product/GLOBAL_ANALYSISFORECAST_WAV_001_027/description
- PredictWind, how to use wave maps: https://help.predictwind.com/en/articles/2884611-how-to-use-wave-maps
- Wyatt et al. 2022: https://consensus.app/papers/details/w:7fe0612e-d7f0-40f6-ba6c-9d58ed36ae97/?utm_source=claude_code
- Mazzaretto et al. 2024: https://consensus.app/papers/details/w:fad3aa52-8a57-461a-ba1a-1822213fbfa0/?utm_source=claude_code
- Second opinions in this session: SubQ (subq-savant-1.4, medium effort) and Reflection (Beam-1.0) were each put this note's conclusion and sources, and both answered B. LongCat's B is as reported by the director; it was not re-run here.
