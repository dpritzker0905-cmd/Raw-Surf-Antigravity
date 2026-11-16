# 2026-11-16 Fable: S0 ablation of the surf chain. The gate (rule only) and the model-only decomposition (measured)

Session: Fable repair lead (`e372475c`). Branch `fable/surf-ablation-s0`, stacked on `fable/surf-spot-panel` (#941).
Changes no served number, no flag, no workflow. Two things are in this file and they are kept apart: a RULE for a test
against truth that has not been run, and a MEASUREMENT of what the chain's multipliers do, which needs no truth.

## 2026-11-16 01:15Z Where this comes from

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
