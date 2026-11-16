# 2026-11-16 Fable: surf spot panel, owner observations, and the rule for the over-read test (nothing computed)

Session: Fable repair lead (`e372475c`). Branch `fable/surf-spot-panel`, cut from `dev` `90d16bd2d`.
Changes no served number and no flag. Adds a dispatch-only workflow that cannot run until the owner says so.

## 2026-11-16 00:37Z Where this comes from

The director relayed a brief (2026-11-15 19:26 EST) built on the owner's field report in the senior research lead's
session (19:07 to 19:12 EST). I did not see the owner's words; what follows is the relay.

- **Report.** At 29.77 N, 81.25 W (St. Augustine to Volusia) the infobox surf reads too high. The owner expects under
  2 ft, 2 to 3 ft on sets: wind swell on a gently sloping beach. Some spots amplify (New Smyrna, Ponce Inlet) and
  others reduce. "we need to test live dev as we work our science I think".
- **One live /point reading (the director's, not mine):** offshore 1.12 m at 7.28 s from 52 degrees; served surf
  1.58 m, 1.41 times the offshore height; regime parametric shoaling; shelf depth 21 m; break depth null; geometry
  missing: borrowed shore normal, break depth. NDBC 41117: 1.4 m, mean period 4.8 s.
- **Hypotheses, none tested:** H1 the 7.3 s period overstates a wind-sea spectrum; H2 no dissipation term for a wide
  surf zone; H3 the missing geometry sends the spot down a fallback that over-shoals; H4 spot-type factors.

## What I already know, and how it could bend the rule (disclosed)

- The one reading above, at one spot, in one sea state. It is why H1 and H3 are named, so it cannot also test them.
  **That reading and that hour are excluded from every test below.**
- The nearshore truth as it stands (Brief 7): the chain reads about 28% LOW against nearshore buoys, n = 169 across 11
  stations, WARN. That is the opposite sign to the owner's report. Both can be true (low in swell at steep or reef
  spots, high in wind sea on flat beaches), and the test must be able to show either. A rule that can only find
  over-reading would be bent toward the report.
- I chose the panel and its class labels from the spot names, knowing which spots the owner named as amplifying.

## (a) The panel, fixed now

Thirty spots in `backend/scripts/surf_spot_panel.py` (`PANEL`): the owner's point and eleven other east Florida spots,
six mid-Atlantic, six California, two Hawaii, four Gulf. Coordinates are the catalogue's (RV-12, 2026-08-12).
Classes: `open_beach` 10, `pier` 8, `inlet_jetty` 7, `point_reef` 5. **The class is read off the name by me. It is a
label to be tested, not a measurement.** A pier and an inlet are different things and are kept apart for that reason.
Adding or dropping a spot is a dated addendum to this file, never an edit to the list.

Each run prints, per spot: offshore height, period and direction; served surf; surf over offshore; regime; shelf and
break depth; geometry missing; and the nearest NDBC wave buoy within 100 km with its height, dominant period and mean
period. `backend/tests/test_surf_spot_panel.py` pins the list, the spacing, the health gates and the host allowlist.

**It is not a load test:** health first, 30 sequential reads 10 s apart, stop on a slow read or two failures, health
again. **It is not scheduled.** Each dispatch needs the owner's word typed in the session that dispatches; a schedule
needs his word and a PR of its own. Until then the panel has no readings.

**What a panel reading is.** One sea state per run. A class median from it is a description. No factor is fitted from
panel readings alone (see (c), H4).

## (b) Owner observations

`docs/weather-program/OWNER_OBSERVATIONS.md`, append-only, one row per observation: when, where, what was seen (face
height, sets), how it was observed, and who logged it from which words. It supplements the buoys. **It is never the
only gate for a served change**, because one observer at one spot cannot be told apart from that spot's quirk, and
because the served number is a significant height while a surfer's eye reads faces and sets.

## (c) The offline test, rule fixed before its data

**Question.** At the nearshore stations where we have truth, does the served chain over-read in wind sea and under-read
in swell, and does either named change move it toward truth?

**Truth.** NDBC and CDIP nearshore stations as paired in `backend/data/nearshore_ndbc_pairs.json` and
`nearshore_validation_pairs.json`, plus the research helper's Brief 7 station list when it lands; the station set is
frozen on the day the first row is pulled and printed. Buoy significant height, not breaking height: the comparison is
the chain's NEARSHORE height at the station's depth, the same instrument Brief 7 uses.

**Window.** Target times from 2026-11-17 00:00Z to 2026-12-07 00:00Z. Nothing before it.

**Sea-state split, fixed now.** A row is WIND SEA when the buoy's mean period is under 6.0 s and under 0.70 of its
dominant period; SWELL when the mean period is 8.0 s or more; MIXED otherwise. From the buoy, not from the model.

**Statistic.** log(chain / buoy) per row; reported as the median ratio with a day-block bootstrap interval (2,000
draws, seed 20261207), per sea state and per coast (`florida_east`, `mid_atlantic`, `california`, `hawaii`, `gulf`).
A cell under 30 rows or 7 days prints its n and no number.

**Arms, each re-running the ONE chain (`resolve_surf_geometry` + `estimate_surf_at`) offline with one input changed:**
- `served`: as served.
- `H1_mean_period`: the model's mean wave period in place of its peak period, where the stored product carries one;
  if it does not, the arm is NOT RUNNABLE and that is the finding.
- `H1_partition`: the wind-sea and swell partitions shoaled separately with their own periods and combined in energy,
  where partitions are stored.
- `H3_geometry`: stations where `geometry_missing` is empty against stations where it is not, as served. This arm is a
  comparison of groups, not a re-run; it cannot say what completing the geometry would do, only whether the rows with
  missing geometry read differently.
- H2 (a dissipation term) has NO arm: there is nothing to switch on. It is the residual if H1 and H3 do not account
  for a wind-sea over-read, and it is named so that a null result here is not read as "no problem".

**An arm is SUPPORTED in a sea state when** its median |log ratio| is lower than served's with the paired interval
excluding 0, AND it is not worse than served by more than 0.02 in median |log ratio| in either other sea state.
Otherwise NOT SHOWN. "Supported" is evidence for a change, not the change.

**Controls.**
- Null: the sea-state labels shuffled among rows within each station (seed 20261207, 200 shuffles). The served
  wind-sea minus swell difference must exceed the 97.5th percentile of the shuffled differences, or the split itself
  is NOT SHOWN and no arm is judged.
- Positive control: every chain value in WIND SEA rows multiplied by 1.3; the wind-sea median ratio must rise by a
  factor of 1.25 to 1.35. If not, INVALID.

**H4, spot-type factors: NOT fitted here, and not before n >= 30 per spot class** from (a) and (b) together, counting
panel readings on distinct days and owner observations. When it is fitted it needs its own dated rule, with a
shuffled-class null that must not fit a factor and a seeded 1.3 that must be recovered. Until then no class factor
exists, whatever a panel median looks like.

**Verdicts.** Per arm and sea state: SUPPORTED, NOT SHOWN, NOT RUNNABLE, TOO FEW ROWS; whole test INVALID if the
positive control fails.

## Limits, stated now

- The truth is at buoys, in several metres of water or more. The owner's complaint is at the beach. A chain that is
  right at the buoy can still be wrong at the break, which is exactly where H2 lives; this test cannot see it.
- East Florida has few nearshore stations. If `florida_east` has too few rows, the test says nothing about the coast
  the report came from, and the report stays an observation.
- Three weeks, one season.
- The panel reads the LIVE served number, so it also moves when the model run or a merged fix changes, not only when
  the science does. A before/after pair must name the two deploys and the two hours.

## What a result may change

Nothing by itself. Any change to the surf chain changes a served number: ONE FORECAST COMPOSITION, D-065 (ship on
with a kill switch and a history filter), a SCOREBOARD row, and the owner's word or Reflection and SubQ agreeing on a
met gate. Scoring: no earlier than 2026-12-07, recorded by 2026-12-09T12:00Z (ledger commitment).
