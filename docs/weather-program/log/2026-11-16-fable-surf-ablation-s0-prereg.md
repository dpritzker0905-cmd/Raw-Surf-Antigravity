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

## 2026-11-16 01:24Z The tension is resolved, and a correction to Part 1b

**The nearshore validation scores the chain BEFORE the breaking factors.** The rating-band lane pointed at the code
and I read it: `nearshore_validation.model_hs_at_station` multiplies shelf friction, LINEAR shoaling to the station
depth, the exposure factor and the same refraction constant, and says of itself "no cap, no H1/10". Komar is not in
it. So the two findings are about different halves of the chain and do not contradict:
- up to the buoy (friction, linear shoaling, exposure, refraction): reported LOW at 9 of 11 stations;
- shoreward of the buoy (Komar, H1/10, cap, magnet): never scored by anything, and Part 1 shows them raising every
  spot.

**What the pre-breaking half does, measured from the code** (`transform_factors`, head-on, shelf 21 m by 120 km,
friction at the served setting):

| period | station at 10 m | at 15 m | at 20 m |
|---|---|---|---|
| 5 s | 0.82 | 0.85 | 0.87 |
| 7.3 s | 0.80 | 0.80 | 0.81 |
| 10 s | 0.86 | 0.82 | 0.80 |
| 14 s | 0.97 | 0.90 | 0.86 |
| 16 s | 1.02 | 0.94 | 0.89 |

Friction is 1.00 in every cell (it is off by default), so this is linear shoaling times the constant 0.873, and off
the shore normal the exposure factor lowers it further. **The chain takes 13 to 20% off the offshore height on the
way to a 10 to 20 m buoy for every period up to 10 s.** On a 1 to 2.5 m sea that is 0.13 to 0.5 m, the same size as
the reported low bias (-0.15 to -0.51 m). That is arithmetic and a coincidence of size, NOT an attribution: I have
not read the validation's rows or its per-factor columns, and a low offshore input would produce the same bias.

**A reading that fits both halves, not proven.** The pre-breaking half removes too much (the 0.873 constant is the
only candidate that is not physics: friction is off and linear shoaling is textbook), and the breaking half then adds
it back and more with Komar and H1/10, the same amount at every spot. Net high where the real surf zone dissipates
(a flat beach in wind sea), net low or right where it does not. If so, the two errors were tuned against each other,
and removing one alone would make the served number worse. The gate's "no class gets worse" condition is what
protects against that, and it is a reason to test the factors in PAIRS as well as singly.

**Added to the gate, before the window:** one paired configuration, `refraction_off_and_komar_off`, and one,
`refraction_off_and_h110_off`, scored like the others. No other pair is added, now or later.

**What it changes for the truth split.** The forcing-truth half of the gate CAN judge the refraction constant, the
exposure factor and linear shoaling, at the validation's stations, per factor. That part is runnable as soon as the
window has rows and the per-factor columns are read (the rating-band lane could not see them in the artifacts it
downloaded; the workflow may carry them).

**Correction to Part 1b, mine.** I wrote that the partitioned path is "the path the live point lane takes when
partitions exist". It is not on in production: `SURF_PARTITIONS` defaults to off
(`point_resolution.py`: `os.environ.get("SURF_PARTITIONS", "0") != "1"`), so the live readout uses the bulk path.
Part 1b's numbers stand; they describe what the served number WOULD do with that flag on, not what it does today.
The bulk tables in Part 1 are the ones that describe today's readout.

## 2026-11-16 01:39Z The pre-breaking half, read from the validation's own report (one run, medians only)

The rating-band lane found that each graded `nearshore_report.json` carries `factors_median`. I downloaded the
latest successful run's public artifact and read it: run 43758031631, generated 2026-11-15 20:28Z, quantity
"transform_hs_at_station_depth_vs_cdip_hs (Hs statistic; no cap, no H1/10)", 163 matched spot-hours, 85
station-hours, 11 stations. **This is data dated before the gate's window. It is read here to locate the factors,
and it is excluded from the gate like every other row before 2026-11-17.**

| | value |
|---|---|
| median factors | friction 1.00, shoaling 0.958, exposure 0.812, refraction 0.873, total 0.700 |
| observed over model, median | 1.59 (10th percentile 1.16, 90th 2.45) |
| stations reading low | 11 of 11 (bias -0.08 to -0.95 m) |
| legacy friction arm | never closer (share 0.0); bulk MAE 0.281 m, arm 0.317 m |

- **The model at the buoy is the offshore height times about 0.70 at the median.** Two factors do it: the exposure
  factor (0.81, the angle to the shore normal) and the refraction constant (0.873). Shoaling is near 1 and friction
  is exactly 1.
- **Undoing both would raise the model by 1 / (0.812 x 0.873) = 1.41. The gap is 1.59.** So exposure and refraction
  together are the size of most of the low reading, and about 13% would remain (1.59 / 1.41), which would have to
  come from the offshore input or from the shoaling leg. In the run the rating-band lane quoted (11:14Z) the two
  numbers were 1.41 and 1.54.
- **The exposure factor is as large as the refraction constant here.** Part 1 fed every spot a head-on sea, so its
  exposure column read 1.00; at the validation's stations the median sea arrives well off the normal. Part 1's
  "refraction lowers, exposure is 1 head-on" understates exposure for real seas.

**What this is not.** Medians of one run, not rows. A median total and a median ratio do not multiply or divide the
way rows do, so "1.41 of 1.59" is a size comparison, not an attribution. Every station reading low in one run is one
weather pattern at eleven mostly-California stations.

**What the gate needs that the artifact lacks.** The per-row factors are computed
(`run_nearshore_validation.py`, on every matched row) but only their median is uploaded. The forcing-truth half of
the gate needs the rows: per station-hour, the truth, the model, and the four factors. That is a one-line change to
the runner, which is not this lane's file; asked of the director. Without it the per-factor verdict for refraction,
exposure and shoaling is NOT RUNNABLE, and that is recorded here before the window so it cannot be discovered later
as an excuse.

**Added to the gate, before the window:** one more single configuration, already implied by the factor list but
stated for the forcing-truth half: `exposure_off` and `refraction_off` are each judged at the stations on their own
and together (`exposure_off_and_refraction_off`). That makes three paired configurations in all, with the two from
01:24Z. The list is closed.

## 2026-11-16 01:44Z A second window, registered now (the director's answer to the season limit)

The second addendum said season is UNTESTABLE in one three-week window and that no arm is eligible to be served on
it alone. The director's answer (2026-11-15 20:42 EST): register a second window now, a winter one.

- **Window 2: target times 2027-01-11 00:00Z to 2027-02-01 00:00Z.** Same truth sets, same configurations (the list
  is closed), same score, same held-out spots, same nulls, same positive control, same guardrails. Seeds: 20270201
  where window 1 uses 20261207. Nothing about the rule may be changed between the two windows because of what
  window 1 shows; a change needs a dated addendum BEFORE 2027-01-11 that says what window 1 showed and why.
- **Eligibility to be served:** an arm must reach its verdict in BOTH windows with the same sign. A factor that is a
  REMOVE CANDIDATE in one window and KEEP or CLASS-DEPENDENT in the other is SEASON-DEPENDENT, which is a finding and
  not a licence to change the served number.
- **What two windows do not cover, stated now.** Late November and January are both the cool season in the northern
  hemisphere: the same hemisphere's storm track, stronger in window 2. They differ in swell size and period, which is
  what the extremes guardrail needs. They do NOT cover summer: small short-period seas, trade-wind and south-swell
  regimes, and the east Florida summer the owner's report is most like in size. Any served change that rests on these
  two windows must say "not tested in summer" in its SCOREBOARD row, and a summer window (2027-07) is owed before a
  class factor for flat beaches is called settled.
- Scoring of window 2: no earlier than 2027-02-01, recorded by 2027-02-03T12:00Z (ledger commitment).

## 2026-11-16 02:31Z Amendment before the window: what the saved rows can and cannot compute (advisor's condition)

The advisor's review of #942 found a real hole: the gate crosses every factor-off configuration with three period
choices, and those arms re-run the chain per row, which needs each row's height, period and direction. The public
rows file (#947) deliberately does not carry them. So the gate as written promised verdicts no saved data could
produce. This section fixes that before 2026-11-17 00:00Z. It REMOVES promises; it adds no new freedom.

**Which rows the gate reads.** The private full rows (#948, owner's word 2026-11-15 21:10 EST): per spot-hour the
station, the hour, offshore height, PEAK period, direction, the chain's height at the station, the observation, and
the four factors. They are read only by a scoring job that prints aggregates (no row, no station-hour, cells under
10 hidden); that job is not built, and its dispatch needs the owner's word. **Fallback** if #948 is not on dev or its
writes are refused: the public rows (#947): station, day, model over observed, the four factors.
A day counts only if rows exist for it. Runs before #947 and #948 are on dev left medians only, so the window's
effective start is the first run that wrote rows, and the report states that date.

**The unit of analysis is the STATION-DAY, not the row.** A row is a spot-hour; several spots share one station and
one hour, so rows are not independent, and the public file cannot tell two spots in an hour from two hours. Every
statistic is computed on station-day medians. Intervals: day-block bootstrap over days. "30 rows" in the earlier
sections is replaced by **30 station-days over at least 7 days and at least 3 stations**; a cell under that prints
its n and no number.

**Held out by STATION**, not by spot, on forcing truth: the truth is at stations. Leave-one-station-out, and whole
regions held out.

### Forcing truth (nearshore buoys): what is RUNNABLE

The quantity scored is the chain's height at the station: friction x linear shoaling x exposure x refraction, "no
cap, no H1/10". A factor is switched off by dividing the model by that row's factor; no cap can bind in this
quantity, so the division is exact.

| configuration | private rows (#948) | public rows only (#947) |
|---|---|---|
| served | RUNNABLE | RUNNABLE |
| friction off | RUNNABLE (it is 1.00 at the served setting, so expect no difference) | RUNNABLE |
| shoaling off | RUNNABLE | RUNNABLE |
| exposure off | RUNNABLE | RUNNABLE |
| refraction off | RUNNABLE | RUNNABLE |
| exposure off and refraction off | RUNNABLE | RUNNABLE |
| sea-state split (wind sea / swell by the buoy's own periods) | RUNNABLE: the hour joins the buoy's public record | **NOT RUNNABLE**: no hour |
| period taken as mean, or as the wind-sea partition's | **NOT RUNNABLE** | **NOT RUNNABLE** |
| Komar off, H1/10 off, cap off, magnet off | **NOT RUNNABLE on this truth** | **NOT RUNNABLE on this truth** |
| refraction off with Komar off; refraction off with H1/10 off | **NOT RUNNABLE on this truth** | **NOT RUNNABLE on this truth** |
| per spot CLASS | **NOT RUNNABLE on this truth** | **NOT RUNNABLE on this truth** |

- **The period arms are NOT RUNNABLE, in either file.** The rows carry the peak period only. The model's mean period
  and its partitions are not fetched by the validation runner, and fetching them is more reads of the one live box
  per row. I am not adding them. H1 (the period overstates a wind-sea spectrum) is therefore not judged by this gate
  at the buoys; what Part 1 measured about it (on the 4.8 s mean period the owner's hour reads 1.338 m against
  1.581 m) stays a model-only fact.
- **Komar, H1/10, the cap and the magnets are not in the scored quantity**, so no buoy row can judge them, alone or
  paired. They wait for breaking truth.
- **Spot class is not defined at a buoy.** Forcing-truth verdicts are per REGION and pooled. Class verdicts exist only
  on breaking truth.

### Breaking truth (the owner's timed looks, FRF Duck): NOT RUNNABLE today

Everything that acts shoreward of the buoy: Komar off, H1/10 off, cap off, magnet off, the two pairs with
refraction, the period arms re-run through the full chain, every per-class verdict, and the new transect arm below.
Each is NOT RUNNABLE until breaking truth has at least 30 eyes-on, scale-stated observations per class on at least 7
days. Today it has none: the log's two rows are an expectation with no scale. **The gate will therefore deliver, in
this window, a verdict on exposure and refraction at the buoys, and nothing on the factors Part 1 points at.** That
is the honest size of it, said before the window opens.

### Verdict words, unchanged

KEEP, REMOVE CANDIDATE, CLASS-DEPENDENT (breaking truth only now), UNDECIDED, UNTESTABLE, and NOT RUNNABLE for a
configuration no saved data can compute. Nulls, the positive control, the guardrails and the second window are as
written above; the shuffled null is over station-days.

## 2026-11-16 02:31Z Arm A replaced: a cross-shore dissipation transect (registered; not built)

The director relayed the research lead's answer (2026-11-15 21:28 EST): the Zhang and Ruessink coefficients are
paywalled and are NOT to be quoted, and arm A can be built from open sources instead. This REPLACES the
`breaker_steepness_kh` arm of the second addendum, which stays NOT RUNNABLE and is withdrawn.

**`bj_transect`.** A one-dimensional Battjes and Janssen energy balance along a shore-normal transect from the model
point to the shore: wave energy is shoaled linearly cell to cell and dissipated by depth-induced breaking, with the
fraction of breaking waves set by the ratio of wave height to the local maximum height (gamma times depth). The
served surf is the LARGEST H1/10 along the transect. This is the gentle-beach dissipation the chain does not have:
on a flat beach in short-period sea the waves break early and lose height across a wide surf zone.

**Equations.** As relayed, from the SWAN technical documentation (open): the Battjes and Janssen dissipation and
breaking-fraction relations (its equations 2.65, 2.66 and 2.68), the maximum height as gamma times depth, and the
Thornton and Guza breaking fraction (2.73) as an alternative. **I have not read the SWAN documentation myself.**
Before the arm is scored, each equation is transcribed from that document with its number into this log, and the
implementation is derived from the equations, never copied from code.

**Gamma arms, fixed now:** a constant 0.73; the slope-and-depth form the SWAN manual gives (the relayed defaults are
0.54, 7.59, -8.06 and 8.09, to be VERIFIED against the manual before use); and today's Komar path as the comparison.

**Bed slope per spot:** a shore-normal transect on ETOPO 2022 15 arc-second (a finer stack where one exists),
sampled about every 100 m out to 20 m depth or 3 km, the slope fitted over the band from 1 m depth to the break
depth. NEVER depth over shelf width. The transect's coverage is printed: a spot whose transect has fewer than 5
wet samples has no slope and the arm is NOT RUNNABLE there.

**Where it lives:** an offline module the serving path does not import, with a test pinning that; no wind input.
**Which truth judges it:** breaking truth only, so it is NOT RUNNABLE against truth today. What CAN be done before
then, and is committed here: the model-only run on the 30-spot panel (does it tell a flat beach from a reef, which
Part 1 showed today's chain cannot; is it monotone in offshore height on the `monotone_violations` grid; what does
it give at the owner's hour).

**Guardrails:** all five of the second addendum, unchanged.

## 2026-11-16 03:39Z Breaking truth source 1: the USACE Field Research Facility at Duck (registered before any value is read)

The director relayed the research lead's finding (2026-11-15 22:30 EST): the FRF's THREDDS catalog is public, no
login, and carries continuous surf-zone wave gauges on a sandy, barred, open beach. That is breaking truth for the
`open_beach` class, with thousands of hours, where the owner's log has none. This section is the rule. **No wave
height, period, direction, water level or bed elevation from the FRF has been read by me.**

**What I have looked at, exactly (disclosed).** The catalog listings at `chldata.erdc.dren.mil/thredds` (folder and
file NAMES and their modification times), and the structure description (`.dds`: variable names and array sizes) of
four November 2026 files. That is how I know which gauges are live and what they are called. No data request was
made. I know nothing about how any arm performs there.

### What is there (from the listings)

Live in 2026, monthly files, modified within the hour I looked: `8m-array`, `awac-11m`, `waverider-17m`,
`waverider-26m` (seaward of the surf zone in most seas), and the dune-lidar products `lidarWaveGauge080`, `090`,
`100`, `110`, `140` and `lidarHydrodynamics` (the inner surf zone; the last one carries a wave height along a
cross-shore line). The cross-shore pressure gauges (`xp100m` to `xp200m`) and the shallow `adop` and `awac` gauges
stopped between 2014 and 2024 and are not used.

### What Duck can and cannot be truth for

- **T1, the height INSIDE the surf zone.** The sea-swell significant height (`waveHs`) at each of the five lidar
  gauges, hourly, where the file's own quality flags pass. This is the height AFTER breaking and dissipation at a
  fixed place. It is direct truth for an arm that predicts a height along a transect (`bj_transect`). The served
  chain gives one number, a breaker height, and has no value at a place inside the surf zone: on T1 the served chain
  is NOT COMPARABLE, with one exception that is a sanity bound, not a score: a served breaking H1/10 below the
  measured inner-surf H1/10 at the same hour is counted and reported.
- **T2, the breaker height.** The largest sea-swell `waveHs` along the `lidarHydrodynamics` cross-shore line in an
  hour, times 1.27 for H1/10, **only in hours when that largest value lies INSIDE the lidar's cross-shore coverage
  and not at its seaward end.** When it sits at the seaward end, the waves broke farther out than the lidar sees and
  the breaker height was NOT OBSERVED that hour. The share of such hours is printed, per season and for the largest
  seas. I expect it to be large in big seas, which would leave T2 blind exactly where it matters; that is a limit of
  the instrument and is stated now.
- **Not truth for:** a reef, a point, an inlet or a pier. One site, one beach, mid-Atlantic. It is the nearest proxy
  for the owner's north-east Florida beach, not that beach.

### Forcing: measured, not modelled

Every arm at Duck is driven by the MEASURED sea at the `8m-array` (significant height, peak period, peak direction;
the `waverider-17m` where the array has no value that hour). So the test isolates the breaking physics from our wave
model's error: the same measured sea goes into every arm. A second, separate comparison driven by OUR offshore
values at Duck is NOT RUNNABLE until the spot panel has run for the window; it is named so it is not forgotten.

### Bed and water level

- **Bed, primary:** the FRF's own surveyed profile along the lidar line, the most recent survey before each hour
  (the facility publishes them under `frf/geomorphology`; the exact product is named in the log BEFORE it is read,
  once its listing has been looked at). The arm's physics is judged on the true bed.
- **Bed, secondary:** the ETOPO 2022 15 arc-second transect the arm would use anywhere else. The difference between
  the two runs is the cost of our bathymetry, reported separately from the cost of the physics.
- **Water level:** the FRF tide gauge that hour, added to the bed for the transect arm. The served chain's tide term
  is off in production and stays off here.

### Arms scored at Duck (the list is closed)

`served` (today's chain at the Duck spot's geometry, driven by the measured sea); each of the six factors off; all
six off; `bj_transect` with a constant gamma of 0.73; `bj_transect` with the SWAN slope-and-depth gamma;
`bj_transect` with the Thornton and Guza breaking fraction. No other arm, now or after a result.

### Window: retrospective, on data that already exists and that I have not read

- **Test set: 2026-01-01 00:00Z to 2026-10-31 23:00Z**, ten complete months, every season. This is what answers the
  season limit of the buoy window.
- **Held back: 2026-11-01 onward.** November to the present is not read until the ten months are scored and logged;
  then 2026-11-17 to 2026-12-07 is a forward check on the same rule.
- **No parameter is fitted.** Gamma is 0.73 or the manual's defaults; nothing is tuned to Duck. If anyone later
  wants to tune anything on Duck, the rule is fixed now: tune on odd days of the month, score on even days, and say
  so.

### Score, unit and intervals

- Per hour: log(predicted / measured). Hours are strongly autocorrelated, so every statistic is on DAY medians, with
  a day-block bootstrap (2,000 draws, seed 20261116).
- Reported: the median ratio and the median absolute log ratio, per gauge (T1) and for the breaker height (T2), by
  season (Jan to Feb, Mar to May, Jun to Aug, Sep to Oct), for the top tenth of measured 8 m heights, and for hours
  with 8 m height of 3 m or more. A cell under 30 days prints its n and no number.

### What a result means

- `bj_transect` is SHOWN at Duck when, on T1, its median absolute log ratio is under 0.20 pooled and in every season,
  AND, on T2, it is better than `served` with the paired interval excluding 0 pooled and not worse by more than 0.02
  in any season or in either extreme cell.
- `served` and its factor-off variants are judged on T2 only. A factor is a REMOVE CANDIDATE for the open-beach class
  if switching it off is better with the interval excluding 0 and no season or extreme cell worse by more than 0.02;
  KEEP if switching it off is worse with the interval excluding 0; otherwise UNDECIDED, which changes nothing.
- All five guardrails of the second addendum apply: own arm, monotone in the offshore height, a range with scored
  coverage, by region and season and extremes (region is one here), no wind in the height.

### Controls

- **Null (must show no skill):** the measured sea and the surf-zone truth re-paired at random within each calendar
  month (seed 20261116, 200 times). Every arm's median absolute log ratio on real pairs must be below the 2.5th
  percentile of its shuffled values, or that arm's result is NOT SHOWN: an arm that does as well with the wrong
  hour's sea is fitting the climate, not the hour.
- **Positive control (the advisor's: a planted dissipation the arm must recover):** on a fixed third of the days
  (day of month divisible by 3), the measured inner-surf heights are multiplied by 0.70. The analysis must report the
  arm reading high on those days by a factor of 1.38 to 1.48 relative to the other days' ratio. If it does not, the
  whole Duck test is INVALID.

### How it is run

Offline, on public data, by a reader that makes only GET requests to the FRF's THREDDS host, spaced, with a stated
user agent. It can run in Actions (dispatch needs the owner's word typed in this session) or on a workstation; both
write the same table. Public outputs carry aggregates only. The reader is not built.

### Limits, stated now

- One beach. A result here is about the open-beach class at one barred, sandy, micro-tidal site.
- T2 is blind in hours when the waves break seaward of the lidar; the test may end up judging the breaker height
  only in small and moderate seas.
- The lidar measures the water surface from the dune; its quality flags decide which hours count, and the share
  dropped is printed.
- Measured forcing removes our wave model from the test on purpose. It therefore says nothing about the served
  number's total error at Duck, only about the breaking step.
- Scoring recorded by 2026-11-30T12:00Z (ledger commitment); the arm must be built first.

## 2026-11-16 03:49Z FRF Duck WITHDRAWN as a truth source (owner's decision)

The director relayed the owner's words of 2026-11-15 22:15 EST: "Skip using USACE and innovate free ways to figure it
out in the SOTA methodology, innovate dig deeper". The section above (03:39Z) registered FRF Duck as breaking-truth
source 1 at the director's request of 22:30 EST; the owner's decision predates that request and had not reached me.

**Withdrawn in full.** FRF Duck is not a truth source for this gate. Nothing will be read from it, fitted to it or
gated on it. The 03:39Z section stays in the log as written (append-only) and has no force: its T1 and T2, its
window, its arms list, its controls and its ledger commitment (fragment line 4) are void.

**What was touched, for the record.** Catalog folder and file names with their modification times, and the
structure description (variable names and array sizes) of four files. No wave height, period, direction, water level
or bed elevation was requested or read. Nothing from the FRF is in the repository. The catalog listings I saved to
this session's scratch folder are deleted.

**Breaking truth for this gate is now, from the research lead's plan (PR #929's log), all free and licence-clean:**
1. Blind in-app observations, scale-labelled (face or Hawaiian). Built by another lane.
2. Sentinel-2 surf-zone detection per spot: the offshore hindcast paired with the breaking-zone width and the slope.
   Built by another lane.
3. The Oahu lifeguard record (CC0), reef class; access is being retried by the research helper.
4. The owner's labelled observations (`OWNER_OBSERVATIONS.md`): eyes-on, scale stated.
Shallow buoys remain FORCING truth only, as before.

**None of these has n today.** So every breaking-truth verdict in this gate stays NOT RUNNABLE, as the 02:31Z
amendment says: Komar, H1/10, the cap, the magnets, the two pairs with refraction, the period arms through the full
chain, every per-class verdict, and the transect arm. When a source above reaches 30 observations per class on at
least 7 days, it needs its own dated section here BEFORE its values are read: what the observation is (a face
height is not a significant height; a surf-zone width is not a height at all), how it maps to the chain's number,
and its controls.

**The transect arm (`bj_transect`) stays registered as a MODEL-ONLY run on the 30-spot panel:** does it tell a flat
beach from a reef, which today's chain cannot; is it monotone in the offshore height; what does it give at the
owner's hour. Its equations come from the open SWAN technical documentation, transcribed with their numbers before
the run; that is a published method, not USACE data, and the owner's decision does not touch it. If the owner
would rather the method not come from there either, say so and it is dropped too.

**The season limit returns.** Duck's ten months were what answered it. With Duck gone, the buoy window (2026-11-17
to 12-07) and the winter window (2027-01-11 to 02-01) are the only ones, both cool-season, and "not tested in
summer" stands on any served change that rests on them.

## 2026-11-16 04:12Z One line so the two windows cannot drift apart (advisor)

The 02:31Z amendment governs WINDOW 2 exactly as it governs window 1: which configurations are RUNNABLE from the
saved rows and which are NOT RUNNABLE, the station-day median as the unit of analysis, and holding out by STATION.
The 01:44Z section was written before that amendment and still says "same held-out spots"; where the two differ, the
02:31Z amendment is the rule for both windows. When the first breaking-truth source gets its dated section, that
section goes to the advisor before any of its values is read.

## 2026-11-17 03:12Z The scoring job is built. Its reductions, written before any row was read, and after the window opened

**Disclosure first.** The window opened at 2026-11-17 00:00Z and this section is written after that. I have read no
private row, no stored object and no aggregate of them: the scorer has only ever run on synthetic rows in its tests
and once with no credentials (it printed `fetch=not_configured`). So the choices below were made without sight of
data, but they were made late, and a reader should weigh them as that.

**What was built.** `backend/scripts/score_nearshore_rows.py` and `.github/workflows/nearshore-rows-score.yml`
(dispatch only; a dispatch needs the owner's typed word). It reads the private rows that `nearshore-validation.yml`
stores and prints pooled and per-region aggregates. It makes no request to the live backend.

**The choices the 02:31Z amendment left open, fixed now.**
- **Station-day value:** the median over a station-day's rows of log(model / observed), signed. The score is the
  median over station-days of its absolute value. The amendment said "station-day medians" without saying median of
  what; this is the reading that keeps a station-day's over- and under-reads from cancelling across days.
- **Duplicate rows:** one row per (station, spot, target time); where several runs graded the same target time, the
  row from the LATEST run is kept. Rows of a run that refused to grade are never read.
- **Day:** the UTC date of the target time.
- **Region:** boxes on the station's coordinates (`REGIONS` in the script), first match wins: hawaii, california,
  gulf, florida_east, mid_atlantic. All 22 stations on file fall in one (a test pins it): none is in Hawaii, so
  Hawaii is UNTESTABLE on forcing truth in this window.
- **Paired difference:** score(factor off) minus score(served) on the same station-days. Positive: the factor helps.
- **Interval:** the days are resampled with replacement, whole days at a time, 2,000 draws, seed 20261207.
- **Null:** within each station-day the two labels are swapped with probability one half, 200 shuffles. A difference
  inside the 2.5 to 97.5 band is NOT SHOWN.
- **Verdict words, forcing truth:** KEEP if the interval is wholly above 0 and no region with a number is better
  without the factor by more than 0.02. REMOVE CANDIDATE if wholly below 0 and no region with a number is worse by
  more than 0.02. Otherwise UNDECIDED. UNTESTABLE where the pooled cell is under 30 station-days, 7 days or 3
  stations. Regions with no number are listed beside the verdict, which says nothing about them.
- **Held out by station:** NOT BUILT in this version. The amendment asks for it where a configuration is CHOSEN.
  This version chooses nothing: it reports each registered configuration against served. If a later step picks a
  best configuration, leave-one-station-out is owed before that pick is reported.
- **Positive control:** every model height in the region with the most station-days times 1.3; the served analysis
  must read that region 1.25 to 1.35 over the unseeded run, or the report prints INVALID and no verdict.
- **Extremes:** the top tenth of observed heights, and rows with offshore height of 3 m or more, each reported
  separately under the same cell minimum.
- **Stored against graded:** a separate workflow step, with no Storage key, counts the validation runs in the window
  that were asked to grade and finished green; the report prints the gap against the stored graded runs.

**NOT BUILT, and printed as that in every report:** the sea-state split by the buoy's own periods (it needs the
buoy's public record joined by hour).

**NOT RUNNABLE on this truth, unchanged:** the period arms, Komar, H1/10, the cap, the magnets, spot classes.

**Privacy.** The report carries no row, no station id, no station-hour and no per-station number; a cell under 10
station-days prints no count. The script imports the standard library only and runs as `python3 -I -S`, because it
is the one process in its job that holds the Storage key. It only reads: one list call per day and one GET per
object. Tests pin the imports, the read-only calls, and that no station or hour reaches the text.

**Tests.** 14 in `backend/tests/test_score_nearshore_rows.py` (estate lane), on synthetic rows where the answer is
known: a factor that makes the chain 20% low comes out REMOVE CANDIDATE, one that helps comes out KEEP, a factor of
1.00 comes out NOT SHOWN, and one region getting worse turns REMOVE CANDIDATE into UNDECIDED. By hand: disabling the
null, mixing in refused runs, dropping the region condition, and skipping the division each fail at least one test.

**What I expect, written now.** From the one run's medians read on 2026-11-16 (observed over model 1.59 at 11 of 11
stations; exposure 0.812, refraction 0.873): `exposure_and_refraction_off` moves toward truth pooled, and
`shoaling_off` changes little. I do not know whether "no region worse by more than 0.02" will hold, and with about
three weeks of 6-hourly runs the Gulf and the mid-Atlantic may not reach 30 station-days.

## 2026-11-17 03:44Z The advisor's review of the scorer: items A to F, built before any dispatch. Where this and 03:13Z differ, this is the rule

The advisor read the scorer at `108702f20` and passed it to merge, with one open condition before the first SCORED
dispatch: six items. All six are built in this commit. Still no private row, object or aggregate has been read; the
scorer has run only on synthetic rows. Full note: shared notes, `redteam-997-nearshore-rows-scorer-2026-11-17.md`.

**A. One look.** The dates were free inputs, so the scorer could have printed verdicts mid-window or on any
sub-window. Now verdicts are printed only when the dates are a REGISTERED window, whole (window 1, or window 2 with
its own seed 20270201), the window has CLOSED, and the read was complete. Anything else is a COUNTS-ONLY run: how
many runs, rows and station-days per region, and which cells have reached the minimum. No score, no difference, no
verdict. One scored dispatch per window; a second one needs a dated reason here first. The code cannot count
dispatches, so that part is a rule and a ledger line, not a lock.

**B. Level is not pattern.** This is the item that decides what a result means, and my 03:13Z expectation paragraph
predicted exactly the result it would have mislabelled. The chain already reads low (about 1.59 observed over model
at 11 of 11 stations in the one run seen). Switching a factor off divides the model by a number below 1, so removing
ANY attenuating factor moves toward truth; for refraction, 0.873 on every row, "off" is exactly a constant
multiplier. A REMOVE CANDIDATE would then say the chain is low, not that this physics is wrong.
- Added: for each factor, a level-matched comparator: the served chain divided by that factor's pooled median.
  Factor-off is compared with it on the same station-days, same bootstrap.
- The verdict line carries the result: "the factor's pattern hurts" (factor-off beats its own constant), "level
  only" (it does not), or "level only: the pattern helps, the level is off" (the constant beats factor-off).
- A REMOVE CANDIDATE marked "level only" is evidence that the chain's LEVEL is off somewhere. It is not evidence for
  removing that factor.

**C. The extremes guardrail is applied.** It was printed and never read. Now a REMOVE CANDIDATE that is worse than
served by more than 0.02 at the top tenth of observed heights, or at offshore 3 m and above, is DISQUALIFIED. An
extreme cell under the minimum has no number and is printed as that. KEEP is not affected: the guardrail is on arms.

**D. A partial read prints no verdict.** A failed list call or a failed GET, or a list page that came back full
(1,000 names, so it may hide objects), makes the run counts-only.

**E. Held out by station and by region, as stability.** I had read the amendment as owing this only where a
configuration is chosen. The advisor did not accept that, and is right: a REMOVE CANDIDATE is a choice, and in a
three-station region one buoy can carry it. Now the pooled comparison is re-scored with each station left out and
with each region left out, and the report prints how many re-scores keep the same side of zero. A verdict that loses
its side with any ONE station left out is UNDECIDED. No station is named.

**F. Every report says how it was made.** Four lines at the top of every report, scored or counts-only: the
reductions were fixed at 03:13Z after window 1 opened and before any row was read, with one earlier run's medians
seen; the latest run's row is the shortest lead, so this scores near-analysis forcing and not a forecast; a region
cell rests on as few as three stations; the null is a sanity check and the positive control a plumbing check.

**Smaller points taken.**
- The stored-against-graded gap is printed as approximate: runs are counted by creation time, objects by run day,
  rows by target time.
- Each verdict line states its scope: the regions tested and not tested, and that a served change resting on it is
  limited to the tested regions. No station is in Hawaii, so nothing here can change Hawaii.
- The null is valid as a within-unit sign-flip test and nearly vacuous for a constant factor on a biased chain; it
  is labelled a sanity check. The positive control returns 1.3 by construction; it is labelled a plumbing check.

**Standing item, not mine to close.** The step that holds the Storage key runs the checked-out ref's script, so a
dispatch from any branch runs that branch's code with the service-role key. The fix is the owner-only set-up already
on his list (a GitHub Environment restricted to `dev` for that key).

**Tests.** 19 now (estate lane must read 3837). Added: a constant factor on a low chain comes out "level only"; a
factor truth ignores comes out "the factor's pattern hurts"; one whose pattern truth follows comes out "the pattern
helps, the level is off"; a verdict carried by two of four stations is UNDECIDED; the extremes guardrail
disqualifies; verdicts print only for a registered window, whole, closed and completely read. Six more mutations by
hand each fail a test. On a realistic-size synthetic set (22 stations, 20 days, 440 station-days) the scored run
takes 40 seconds at the real 2,000 draws.

## 2026-11-17 03:57Z The advisor closed the condition; four small asks built, and the wait after close fixed now

The advisor re-read the scorer at `88e1cefed` and closed the open condition: items A to F are built before any
dispatch. It left four asks that are not conditions. All four are in this commit.

- **The scored run waits 24 hours after the window closes.** Runs made after the close still grade its last target
  times. The wait is `SETTLE_HOURS = 24` in the script and is enforced: before the window end plus 24 h the run is
  counts-only. It is fixed here, before any counts-only report has been seen, so the timing cannot be chosen with
  one in hand. Window 1 can therefore be scored from 2026-12-08 00:00Z; window 2 from 2027-02-02 00:00Z. The runs
  made on the settling day are read too.
- **One look, made visible.** The scored report opens with "Scored dispatch 1 of 1 for this window". The run id is
  written in this log BEFORE the report is opened. A second scored dispatch needs a dated reason here first.
- **KEEP says where factor-off is better at an extreme** (by more than 0.02). The word stays KEEP: the extremes
  guardrail disqualifies arms, and KEEP is the status quo. It is printed because that is the case a next arm would
  be built to fix.
- **Leave-one-region-out is on the verdict line** ("holds in k of n leave-one-region-out re-scores"). It is
  reported and does not change the word: dropping the largest region mostly removes power, and the regional rule is
  already carried by "no region the opposite way by more than 0.02" and "a served change is limited to the tested
  regions".

Still no private row read. Nothing dispatched. 19 tests.

## 2026-11-17 05:59Z Registered before any report exists: a day-boundary check, and what the station count allows

No dispatch of the scorer has been made, scored or counts-only, and no private row has been read. This section is
written before either can happen (the workflow is not on `dev` yet).

**Why.** A read-only trace of the nearshore gate (`log/2026-11-17-fable-nearshore-gate-trace.md`) found the gate's
pooled ratio reading about a quarter lower on runs that fire just after 00Z. About two thirds of that is the gate's
pooling (one six-spot station supplies a quarter of its rows); 0.09 remains on nine runs, and one run
(2026-10-28 00:35Z) is low on three coasts at once. The scorer keeps the LATEST run's row for each target time, so a
true pairing fault after midnight UTC would sit inside the scored data. It has to be tested before the scored look.

**The statistic (the advisor's, not my first proposal).** MODEL-FREE: it reads only the stored OBSERVATION.
- For one station and one target time the buoy's value is the same whichever run graded it. For every
  (station, target time) graded by two consecutive GRADED runs, compare the observation each run stored: its value
  (tolerance 0.005 m) and its time.
- **Midnight group:** pairs whose later run fired in the hour after 00Z. **Control group:** pairs where both runs
  fired between 02Z and 22Z. Pairs in neither group are not counted.
- Buoy records get small late corrections, and a later run can match a nearer reading, so some differing pairs are
  normal in both groups.
- **A FAULT is:** the share of differing pairs in the midnight group above 1% AND more than twice the control's.
- A group under 10 pairs prints no count and the check reads NOT TESTABLE.
- My first proposal (compare the stored MODEL height between the two runs) was rejected, rightly: the later run
  reads a newer forecast cycle, so the model height is expected to differ and a large share would mean nothing.
- The direct check (target time equals forecast cycle plus forecast hour) is NOT RUNNABLE: the rows do not store
  the cycle.

**Where it lives.** In the counts-only report: two pair counts, two shares and one word. No station, no row, no
model-against-observed number. It is not printed in the scored report.

**What follows from a FAULT.** Rows from the faulty runs are excluded by a dated amendment here BEFORE the scored
dispatch. Nothing else in the rule changes.

**What it costs.** A counts-only dispatch holds the service-role key, so it needs the owner's typed word and a
ledger line. It does NOT count as the scored look.

**What it cannot test.** The suspect run of 2026-10-28 predates the window and its stored rows; it stays "not
disproven".

**The station count, written now, before any counts exist.** Eleven of the 22 stations on file return 404 on every
run in the last month, so the live stations are: California 4, Florida east 3, Gulf 2, mid-Atlantic 2, Hawaii 0.
The cell minimum is 3 stations. Expectation: testable pooled, in California and in Florida east; UNTESTABLE in the
Gulf, the mid-Atlantic and Hawaii. A served change resting on a verdict would be limited to California and Florida
east.

**Two smaller changes in the same commit.**
- The workflow counted only validation runs that finished GREEN as graded. A run whose own surf-zone gate goes red
  still grades and stores its rows (all three runs of 2026-11-16 did), so the gap would have been under-counted. It
  now counts runs that were asked to grade and completed, and compares them with all stored run objects.
- One more caveat line on every report: the model is the GFS member's offshore height, which inside the Southern
  California Bight has been a GFS and EURO mean since 2026-11-04, constant inside both windows.

**Tests.** 23 (estate lane must read 3841). The boundary check passes a clean set, catches a seeded one-day shift
in the midnight runs, does not call ordinary corrections in both groups a fault, hides small groups, and never
reads a refused run. Five hand mutations each fail a test.

## 2026-11-17 06:05Z The scored run does the day-boundary check itself (advisor, before the scored dispatch)

The advisor confirmed the check at `1bf6c240b` and named one gap: as built it ran only if someone dispatched a
counts-only run, so a scored report could go out unchecked. Closed in this commit, before any dispatch.

- The scored path now computes the check on the same rows and prints its one word.
- If the word is FAULT, the run prints NO verdict, like a partial read: counts only, with the reason.
- The way out of a FAULT is a dated amendment here that names the faulty runs, and the same stamps in
  `EXCLUDED_RUNS` in the script (empty today; a test pins that it is empty in the source). Their rows are then
  dropped before both the check and the scoring, and the report prints how many runs were excluded.
- Adding a stamp to `EXCLUDED_RUNS` without that dated amendment is a change to the rule after results.
- The group definition is printed beside the counts: a run is placed by the time its REPORT was built
  (`generated_at`), the nearest thing to the job reading the clock that the rows store.

24 tests (estate lane must read 3842). No private row read; nothing dispatched.
