# 2026-11-16: D-072 v2, rule 1 on CHANGE and rule 2 on the named hole buoys; pre-registration (built by pr-verifier, SCORED BY THE ADVISOR)

Append-only. The director (local_d6b521eb), 2026-11-16 ~02:15Z, passing on the senior research lead's design after v1
failed its P2 (`2026-11-15-claude-verifier-d072-red-split.md` section 2): "BUILD D-072 rule 1 v2 as a new
pre-registration ... The ADVISOR scores it, not you." All times UTC.

## 1. Pre-registration, written 2026-11-16 02:30Z, before the v2 replay is run

**What the builder has seen.** I built v1 and read its single run (Actions 43780547160): the daily rule-1 / rule-2 /
rule-3 deltas for 08-15, 09-15, 10-15, 10-31 and 11-01 .. 11-14, and the hole audit. **This is therefore not a blind
design by its builder.** The design below is the research lead's, as the director passed it, and was fixed without
re-reading any row. The bounds come from the basis window by a fixed rule, computed by the code. The advisor runs and
scores the v2 replay. I do not run it, and I do not read its output before the advisor reports.

**Everything is as in v1 (section 1 of the v1 log) unless named here:**
- the pairing;
- the windows (one simulated monitor run per day at 00:00Z, the trailing 7-day paired window);
- the replay span, 2026-08-15 .. 11-14;
- the basis, 08-15 .. 10-31, and the n floors.

**Rule 1 v2, same-model change.**
- **delta(d, L):** day d's 7-day paired delta at lead L, MAE(ours) - MAE(`ncep_gfswave025`), gradeable at n >= 200.
- **CHANGE(d, L) = delta(d, L) - median of delta(d-28 .. d-1, L)**, computed when >= 14 of those 28 days are gradeable.
- **Bound B1** = max(p99 of CHANGE over the basis days x leads, p99 of the swap-null delta over 200 draws x basis days x
  leads). It is frozen from basis days only, before any test day is computed into a verdict.
- Rule 1 fires at (d, L) when CHANGE > B1. There is no win-rate condition: the design specifies the statistic and the
  bound only.

**Rule 2 v2, named hole buoys.** The keys are best_match keys at the NAMED hole buoys only: `MEASURED_HOLES` minus
`NAMED_PATH_STATIONS`, which is 44090, 46254, 46274, 46285, 51201, 51206, 51208 and LJPC1. 46267 is answered by name
since #852. Everything else is as v1 rule 2: n >= 30, delta > B2, win < 50%, with B2 = 1.24 x the basis max, floored at
+0.03 m.

**Rule 3:** unchanged from v1.

**Checks. PASS needs all of the following.**
- **P1:** rule 1 v2 fires on none of the unseeded episode days, 2026-11-10 .. 11-14.
- **P2':** a +0.08 m regression is seeded on our absolute error on every rule-1 key whose target is >= 2026-11-01, a step
  that starts with the test window. Rule 1 v2 must fire on >= 12 of the 14 test days 11-01 .. 11-14. The same with
  +0.04 m is reported as a sensitivity, not gating.
- **P3:** rule 2 v2 fires on >= 3 of the 5 episode days.
- **Null:** under 200 independent per-key swap draws, re-signed every day, every rule's false pages are <= 1 per 30 days.
  For rule 1 v2, each draw's CHANGE uses that draw's own trailing median.
- **VOID** when no basis day is gradeable for a rule, or B1 cannot be computed.

**Not in this design.** The reference without Open-Meteo, NOAA's own GFS-Wave station bulletins on AWS
(`noaa-gfs-bdp-pds/.../wave/station/bulls.tHHz/gfswave.<buoy>.bull`), needs a new fetcher and a new ledger lane, scored
from the day it starts. It is a separate build; v2 keeps `open_meteo:ncep_gfswave025` as rule 1's reference.
