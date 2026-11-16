# 2026-11-16 Fable: S0 ablation of the surf chain. The gate (rule only) and the model-only decomposition (measured)

Session: Fable repair lead (`e372475c`). Branch `fable/surf-ablation-s0`, stacked on `fable/surf-spot-panel` (#941).
Changes no served number, no flag, no workflow. Two things are in this file and they are kept apart: a RULE for a test
against truth that has not been run, and a MEASUREMENT of what the chain's multipliers do, which needs no truth.

## 2026-11-16 00:48Z Where this comes from

The director relayed brief B1 from the research lead's worldwide surf-transform plan (2026-11-15 19:39 EST; a peer
message, not the owner's words in this session). It extends the St. Augustine field report (`log/2026-11-16-fable-surf-
spot-panel-prereg.md`). Offline, so no owner word is needed to run it; nothing served changes until a gate passes.

**A correction to the brief as relayed.** It names the refraction factor as 0.797. The code today is
`REFRACTION_KR = 0.873` (`surf_transform.py`; 0.797 was the value before 2026-09-27).

## Part 1. What each multiplier does (measured, model only, no truth read)

Instrument: `backend/scripts/surf_ablation.py`, which calls the production chain (`resolve_surf_geometry` +
`estimate_surf_at`) with one of the chain's own kill switches set per call. 30 panel spots (#941), four fixed sea
states, head-on and 45 degrees off the shore normal: 240 rows. Geometry from the bathymetry bundled in the repo.

**The owner's hour (29.77, -81.25; 1.12 m at 7.28 s from 52 degrees), reproduced offline:**

| | height | over offshore |
|---|---|---|
| served | 1.581 m | 1.41 |
| Komar off | 1.115 m | 1.00 |
| H1/10 off | 1.245 m | 1.11 |
| refraction off | 1.811 m | 1.62 |
| exposure off | 1.644 m | 1.47 |
| all six off | 1.046 m | 0.93 |

Contributions (served over served-with-it-off): Komar 1.418, H1/10 1.270, refraction 0.873, exposure 0.961, magnet
1.000, cap 1.000. They multiply back exactly here (no ceiling binds). **The same chain on the buoy's mean period of
4.8 s gives 1.338 m (1.19 times offshore); on 6.0 s, 1.463 m.** So the period choice moves the number by about 15%,
and no setting of the six switches or the period gets near the 0.4 the owner's report implies. The lowest this chain
can read at this point, with everything off, is 0.93 times offshore.

**Across the panel, the chain barely knows one spot from another.** At the report's sea state, head-on, 27 of the 30
spots read exactly 1.47 times offshore: Pipeline, Steamer Lane, Duck, Cocoa Beach Pier and Galveston alike. The three
that differ are the three with a hand-set magnet factor: New Smyrna Beach Inlet 1.40, Ponce Inlet North Jetty 1.40,
Sebastian Inlet First Peak 1.35 (ratios 1.98 to 2.06).

Head-on, geometric mean over spots of served over offshore, with a 95% interval over SPOTS:

| class | wind sea 1.0 m 5 s | report 1.12 m 7.28 s | swell 1.5 m 12 s | groundswell 2.0 m 16 s |
|---|---|---|---|---|
| open_beach (10) | 1.29 [1.29, 1.29] | 1.47 [1.47, 1.47] | 1.69 [1.69, 1.69] | 1.73 [1.62, 1.79] |
| pier (8) | 1.29 [1.29, 1.29] | 1.47 [1.47, 1.47] | 1.69 [1.69, 1.69] | 1.78 [1.76, 1.79] |
| point_reef (5) | 1.29 [1.29, 1.29] | 1.47 [1.47, 1.47] | 1.69 [1.69, 1.69] | 1.79 [1.79, 1.79] |
| inlet_jetty (7) | 1.49 [1.35, 1.69] | 1.69 [1.53, 1.92] | 1.90 [1.73, 2.11] | 1.91 [1.70, 2.16] |

- **Komar** raises the number at every spot, more with period: about 1.17 in wind sea, 1.40 at the report's state,
  1.6 in swell. It is the largest factor and it is the same on a flat beach as on a reef.
- **H1/10** is 1.27 wherever the cap does not bind, wind sea included.
- **Refraction** is the constant 0.873 everywhere. It is not a refraction calculation.
- **Exposure** is 1.00 head-on and about 0.88 at 45 degrees.
- **Magnet** is 1.00 except at three hand-set spots.
- **The cap** binds in 7 of 240 rows, all in swell or groundswell. Six panel spots have no break depth at all,
  the owner's point, Duck and New Smyrna Inlet among them.
- 45 degrees off the normal lowers every cell by the exposure factor and changes nothing else.

**What this is, and is not.** It is arithmetic on the served code, and it is certain: the intervals are over spots
and are zero-width where every spot gives the same number. It says the chain's spot-to-spot variation comes from three
hand-set constants and an occasional cap. It does NOT say which multiplier is wrong. A chain can be the same
everywhere and right on average. That is Part 2.

**Limits of Part 1.** Synthetic sea states, not a climatology. Thirty spots I chose, with class labels read off their
names. Bulk inputs only: the partitioned path (`estimate_surf_partitioned`) was not exercised, and it is the path the
live point lane takes when partitions exist. Shelf friction is off in production and was left off.

## Part 2. The gate: which multipliers survive (RULE ONLY, nothing computed)

**What I have already seen (disclosed).** Everything in Part 1. One live reading at the owner's point. The existing
nearshore comparison: the chain about 28% LOW against nearshore buoys, n = 169, 11 stations. From Part 1 I expect
Komar and H1/10 to be the factors an over-read in wind sea is traced to, and I expect "the chain cannot tell spots
apart" to be the finding that matters. The rule below is written so those expectations can fail.

**Two truths, never pooled.**
- FORCING truth: nearshore buoys (significant height in several metres of water or more). It can judge what the chain
  does up to the buoy: period choice, exposure, refraction, shelf friction, the pass-through. It CANNOT judge Komar,
  H1/10, the cap or a magnet, which act at the break, shoreward of every buoy.
- BREAKING truth: FRF Duck when it opens, and the owner's observations (`OWNER_OBSERVATIONS.md`). It is the only
  truth for Komar, H1/10, the cap and the magnets. Today it has one row, of unknown kind.

**Configurations.** `served`; each of the six factors off, one at a time; `all_off`; and, crossed with those, the
period taken as peak, mean, or the wind-sea partition's where the stored product carries it. Fixed here: no new
configuration is added after a result is seen.

**Window.** Target times 2026-11-17 00:00Z to 2026-12-07 00:00Z, the same rows as the over-read test in #941.

**Score.** Median |log(chain / truth)| per spot class (`open_beach`, `pier`, `inlet_jetty`, `point_reef`) and per
region (`florida_east`, `mid_atlantic`, `california`, `hawaii`, `gulf`), with a day-block bootstrap interval (2,000
draws, seed 20261207). A cell under 30 rows, 7 days or 3 spots prints its n and no number.

**Held-out SPOTS.** Choosing the best configuration is a fit, so it is scored only on spots that did not choose it:
leave-one-spot-out within each class, and again with whole regions held out. The number reported for a configuration
is its held-out score. A class with fewer than 4 spots with truth cannot be held out and is UNTESTABLE.

**A factor's verdict, per truth type:**
- KEEP: switching it off makes the held-out score worse, interval excluding 0, pooled, and no class or region better
  by more than 0.02 without it.
- REMOVE CANDIDATE: switching it off makes the held-out score better, interval excluding 0, pooled, AND no class and
  no region gets worse by more than 0.02. "No class gets worse" is the brief's condition and it is a hard one.
- CLASS-DEPENDENT: better without it in at least one class and worse in at least one other, both intervals excluding
  0. That is evidence for B2 (spot classes), not for removal.
- UNDECIDED: none of the above. An undecided factor stays as it is: no change without evidence.
- UNTESTABLE: no truth of the right type with enough rows. Komar, H1/10, the cap and the magnets are UNTESTABLE
  until breaking truth has at least 30 rows per class on at least 7 days.

**Controls.**
- Shuffled-class null: class labels shuffled among spots (seed 20261207, 200 shuffles). Any CLASS-DEPENDENT verdict
  must exceed the 97.5th percentile of the shuffled class differences, or it is NOT SHOWN. Shuffled classes must show
  no gain from a per-class choice.
- Positive control: every chain value in one class (the class with the most rows) multiplied by 1.3; the per-class
  analysis must report that class as over-reading by a factor of 1.25 to 1.35 relative to the unseeded run. If not,
  the whole test is INVALID.

**What a verdict may change.** Nothing by itself. A REMOVE CANDIDATE or CLASS-DEPENDENT verdict is evidence for a
served change, which then needs ONE FORECAST COMPOSITION, D-065 (ship on, kill switch, history filter), a SCOREBOARD
row, and the owner's word or Reflection and SubQ agreeing on a met gate.

**Limits, stated now.** Forcing truth is thin in east Florida, where the report came from. Breaking truth barely
exists, so the factors Part 1 points at are the ones this gate cannot yet judge; that is the honest state, and it is
why the panel and the observations log exist. Three weeks, one season. The class labels are name-based.

Scoring: no earlier than 2026-12-07, recorded by 2026-12-09T12:00Z (ledger commitment).

## Handover to the B2 / B3 lane

- Part 1's finding for B2: there is no spot class in the chain today. Three magnets and a cap are the whole of it.
- For B3: the partitioned path was not ablated. It should be, on real partitions, before a spectral transfer is
  designed against it.
- `surf_ablation.ablate` and `period_variants` are importable and take a pre-resolved geometry.

## 2026-11-16 01:01Z Addendum (before the window opens): the nearshore stations, a null arm, and the sign by coast

The director relayed an advisor finding from #933's science section (2026-11-15 19:53 EST): the nearshore validation
reads the chain LOW at 9 of 11 stations in all 13 runs, pooled bias -0.15 to -0.51 m, the latest run the worst, and
its decisive comparison was void because it had no null arm. The ask: include those stations and a proper null arm,
and report the sign of each factor's effect by coast type. I have not read #933's numbers myself.

**Added to the gate, nothing removed.**
- **Stations.** The forcing-truth set explicitly includes the nearshore validation stations on file
  (`backend/data/nearshore_validation_pairs.json`, 20 pairs today, and `nearshore_ndbc_pairs.json`, 2), frozen and
  printed on the day the first row is pulled.
- **A null arm for every comparison, not only the class one.** For each factor-off configuration, the paired
  difference from `served` is also computed with the configuration label shuffled within each station and day
  (seed 20261207, 200 shuffles). A difference inside the 2.5 to 97.5 percentile band of the shuffles is NOT SHOWN
  whatever its interval says. A comparison without this arm is not reported.
- **Sign by coast.** Every factor's verdict table carries, per coast and per class, the SIGN of switching it off
  (toward truth or away) beside the size, so a factor that helps on one coast and hurts on another is visible as that
  and is never averaged into "no effect".

**The sign of each factor in the served chain, by coast (measured, model only, head-on).** Geometric mean over the
panel's spots of served over served-with-it-off. Above 1 raises the served number.

| coast (spots) | sea state | surf / offshore | Komar | H1/10 | refraction | magnet | cap |
|---|---|---|---|---|---|---|---|
| florida_east (12) | wind sea | 1.40 | 1.17 | 1.27 | 0.87 | 1.08 | 1.00 |
| florida_east (12) | report | 1.59 | 1.42 | 1.27 | 0.88 | 1.08 | 1.00 |
| florida_east (12) | swell | 1.81 | 1.60 | 1.25 | 0.88 | 1.07 | 0.99 |
| florida_east (12) | groundswell | 1.86 | 1.54 | 1.25 | 0.88 | 1.05 | 0.96 |
| mid_atlantic (6) | wind sea | 1.29 | 1.18 | 1.27 | 0.87 | 1.00 | 1.00 |
| mid_atlantic (6) | report | 1.47 | 1.41 | 1.27 | 0.87 | 1.00 | 1.00 |
| mid_atlantic (6) | swell | 1.69 | 1.62 | 1.27 | 0.89 | 1.00 | 1.00 |
| mid_atlantic (6) | groundswell | 1.68 | 1.49 | 1.21 | 0.91 | 1.00 | 0.94 |
| california (6) | wind sea | 1.29 | 1.17 | 1.27 | 0.87 | 1.00 | 1.00 |
| california (6) | report | 1.47 | 1.32 | 1.27 | 0.87 | 1.00 | 1.00 |
| california (6) | swell | 1.69 | 1.54 | 1.27 | 0.87 | 1.00 | 1.00 |
| california (6) | groundswell | 1.79 | 1.65 | 1.27 | 0.87 | 1.00 | 1.00 |
| gulf (4) | report | 1.47 | 1.38 | 1.27 | 0.87 | 1.00 | 1.00 |
| hawaii (2) | report | 1.47 | 1.32 | 1.27 | 0.87 | 1.00 | 1.00 |

**Reading it.** The sign of every factor is the SAME on every coast: Komar and H1/10 raise, refraction lowers, the
cap lowers only where it binds, the magnet raises only in east Florida (three hand-set spots). The chain has no
factor whose sign depends on the coast. So if truth shows the chain high in east Florida wind sea and low at the
California nearshore stations, no retuning of one global factor can fix both; that needs something the chain does not
have. This is a statement about the code, not about truth.

**A tension I cannot resolve from here, and must be resolved before any sign is interpreted.** The chain multiplies
the offshore height by 1.29 to 1.86 at every panel spot. The nearshore validation reports the chain LOW at 9 of 11
stations. Both cannot be about the same quantity unless the offshore input at those stations is far below the buoy.
Either the validation compares a height before the breaking factors (then Komar and H1/10 are not in it and its
"low" says nothing about them), or the input field is low there (then the over-read at the break and the under-read
at the buoy are two separate errors with opposite signs, stacked). Which it is decides what "LOW" means for this
ablation. It is the first thing to read when the window opens: the validation's own definition of the chain value it
scores, per station.

## 2026-11-16 01:10Z Part 1b. The PARTITIONED path on real partitions (measured, model only, one hour)

The director asked for this before B3 is designed (2026-11-15 20:05 EST). `estimate_surf_partitioned` is the path
`estimate_surf_at` takes when partitions are supplied: each train through the same `estimate_surf`, recombined in
quadrature, then capped.

**Instrument.** One public NOAA GFS-Wave analysis field, 2026-11-15 18Z (f000, 0.25 degree): total height, peak period
and direction, the wind-sea partition and up to three swell partitions. Sampled at each panel spot's nearest water
cell within 1 degree. No backend call, nothing private. `surf_ablation.ablate(..., partitions=...)`, same switches.
Raw table, per-spot JSON and the two scratch scripts are in the shared notes folder, `fable-surf-ablation-2026-11-16/`.

**Bulk against partitioned, 30 spots, same hour, same geometry:**

| | geometric mean | 95% over spots | min | max |
|---|---|---|---|---|
| partitioned / bulk | 1.01 | [0.96, 1.07] | 0.78 | 1.36 |
| bulk surf / offshore | 1.42 | [1.26, 1.58] | 0.74 | 2.17 |
| partitioned surf / offshore | 1.44 | [1.31, 1.57] | 0.86 | 2.17 |
| all six off, partitioned / offshore | 0.97 | [0.96, 0.99] | | |

- **On average the partitioned path reads the same as the bulk path.** It does not lower the surf. It redistributes:
  it LOWERS spots where a long peak period sat on little energy (Rincon 0.78, Pipeline 0.80, Huntington 0.81,
  Wrightsville 0.83) and RAISES spots where the peak period was short but a swell train was present (Daytona 1.36,
  Manasquan 1.33, Folly 1.32).
- **The owner's point that hour** (0.68 m at 8.8 s, 75% of the energy wind sea): bulk 1.18 m (1.74 times offshore),
  partitioned 1.09 m (1.60). The partitioned path takes 8% off and leaves a 1.6 times amplification of a mostly
  wind-sea state.
- **The factors are the same through this path.** Komar 1.54 [1.47, 1.62] (bulk 1.49), H1/10 1.27 on every spot,
  refraction 0.873 on every spot, exposure 0.85, magnet 1.03, cap 1.00 (it bound nowhere this hour). H1/10 and the
  constant refraction factor are applied to each train, the wind sea included.
- **By class, partitioned over offshore:** inlet_jetty 1.62 [1.33, 1.94], open_beach 1.47 [1.30, 1.64], pier 1.33
  [1.10, 1.59], point_reef 1.29 [1.00, 1.63]. The intervals overlap everywhere; the differences are the sea state each
  spot happened to have (period and angle) and the three magnets, not the class.
- The partitions reconcile with the total: their quadrature sum over the total height is 1.00 [0.99, 1.02],
  range 0.91 to 1.19.

**How this squares with "27 of 30 read the same" in Part 1.** That was the same sea state fed to every spot. Here
each spot has its own real sea state, so the ratio ranges 0.74 to 2.17, and nearly all of that range is the INPUT
(period, and the angle to the shore normal). The spot's own geometry still contributes only a magnet at three spots.

**For B3.** A per-spot spectral transfer cannot be had by routing more traffic through this path: it honours each
train's period and direction, and then applies the same Komar, the same 0.873 and the same 1.27 to every train at
every spot. What it lacks is exactly what Part 1 found the bulk path lacks.

**Limits.** One hour, one field, so the intervals are over spots in one weather pattern, not over time. NOAA's native
field at the nearest water cell, not our stored tile through our sampler. The live point lane reconciles partitions
before the chain (`point_surf_augment`); raw partitions were used here, so a live reading can differ. Several spots
share a model cell (four St. Augustine spots have the same input). No truth was read: this says what the path does,
not whether it is right.

## 2026-11-16 01:20Z Second addendum (before the window): a breaker-index arm, and guardrails every arm must pass

The director relayed amendments from the research lead's deeper surf pass (2026-11-15 20:16 EST; a peer message).

### (A) One more arm: `breaker_steepness_kh`

**What it is.** In place of the universal Komar and Gaughan breaker height, a breaker index that depends on the
offshore wave steepness and on kh, chosen per spot PER HOUR from beach state: the bed slope and that hour's wave
steepness. The research lead cites Zhang 2021 (reported: 19% lower error) for the index and Power 2013 for the
slope and steepness similarity parameter.

**NOT RUNNABLE today, for two stated reasons. It stays an empty row until both are met.**
1. **I do not have the equation.** The research lead's log gives the citations and the 19% figure, not the formula or
   its coefficients, and I have not read either paper. I will not reconstruct a published formula from its abstract
   or from memory. The arm needs the equation transcribed from the paper, with its equation number, its coefficient
   values and its stated range of validity, written into this log by someone who has the full text.
2. **It needs a bed slope per spot.** The chain's slope is depth over shelf width, a shelf-scale proxy the code's own
   comments call contaminated at islands and deep-water spots. Six panel spots have no break depth at all. The slope
   source must be named and its coverage printed before the arm is scored.

**How it must be built when it can be.** As an offline function with the same inputs as the chain, in a module the
serving path does not import, with a test pinning that. It is a candidate, not a second forecast path: ONE FORECAST
COMPOSITION means it replaces the Komar step inside the one chain behind a kill switch if a gate passes, never beside
it. It takes NO wind input: wind stays in the rating and is never a height multiplier.

**Note for whoever builds it.** The chain already has a period- and slope-dependent breaker index
(`surf_transform.breaker_index`), but it feeds only the depth cap, which bound in 7 of 240 rows in Part 1 and in none
in Part 1b. The amplification comes from Komar, which takes height and period and nothing about the beach.

### Guardrails for EVERY arm, this one and the eight configurations already listed

An arm that fails any of these is DISQUALIFIED whatever its score.

1. **Its own ablation arm.** On and off, scored against `served` on the same rows, with the shuffled null of the
   first addendum.
2. **Monotone in the offshore height (MC-01).** For every panel spot, each of six periods (5, 7.28, 10, 12, 16, 20 s)
   and heights 0.1 to 12.0 m in 0.1 m steps, head-on, the surf must never drop as the offshore height rises.
   Instrument: `surf_ablation.monotone_violations`. **Measured today on the served chain and its seven switched
   variants: 172,800 calls over the 30 spots, zero violations.** So monotonicity is a property today's chain has and
   a new arm must keep. Limit: bulk inputs only; the partitioned path was not walked.
3. **Uncertainty carried to a served range.** An arm must give a low and a high beside its value (a stated 80%
   range). Its coverage is scored: the truth must fall inside between 70% and 90% of the time, per region. An arm
   whose range is not calibrated may still be scored on its central value, but is not eligible to be served.
4. **Validated by region, by season and at the extremes.**
   - Region: the five coasts, each with its own row; no region worse by more than 0.02.
   - Extremes: the top tenth of truth heights, and rows with offshore height of 3 m or more, each reported
     separately; an arm may not be worse there by more than 0.02. A cell under 30 rows prints its n and no number.
   - Season: this window (2026-11-17 to 12-07) is one season. Season is therefore UNTESTABLE in this window, and no
     arm is eligible to be served on this window alone; a second window in a different season is required first.
5. **No wind in the height.** No arm may take wind speed or direction as an input to the height.

### What I have seen that could bend these (disclosed)

Parts 1 and 1b, and the zero-violation monotonicity run above. Nothing about how a steepness-and-kh index performs:
it has never been run here. The 19% figure is the research lead's citation, not a measurement of mine.
