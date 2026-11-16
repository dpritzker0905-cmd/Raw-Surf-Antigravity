# 2026-11-16 Fable: the surf spot panel's first read, and the schedule turned on

Session: Fable repair lead (`e372475c`). Branch `fable/panel-first-read`, cut from `dev` after #943.
Changes no served number. One reading of the live readout at one hour; nothing here is a finding about accuracy.

## 2026-11-16 08:41Z The first dispatch reads clean

The director dispatched `surf-spot-panel.yml` once after #941 merged (the owner's word, relayed, 2026-11-15 19:49
EST). Run 43808661183, queued 05:12Z, ran 06:11:40Z to 06:17:19Z at `edf2f82e3`. Read from the run's public log.

| check | result |
|---|---|
| backend health before | ok, 1.2 s |
| backend health after | ok, 0.3 s |
| spots read | 30 of 30 |
| stopped early | no |
| job length | 5 min 39 s, of which 290 s is the 29 pauses of 10 s |

So the 30 reads, the two health reads, the buoy feed and the job's set-up shared about 49 s: the reads averaged
well under 2 s. **The log does not print each read's time**, so I cannot say what the slowest single read was, only
that none tripped the 20 s stop this run used. That is a gap in the instrument: the panel should print its slowest
read. Not fixed here; listed as a follow-up.

**On that read, #943 was merged** (`16726a7d1`, 2026-11-16 08:40:14Z, squash at head `9a97efc9d`, 15 checks green,
advisor PASS WITH LIMITS with no open condition, merged by this lane on the owner's word typed in this session at
2026-11-15 21:04 EST). The panel now runs at 17 minutes past 00, 06, 12 and 18 UTC and stops on a read over 8 s.

## What the first reading shows (one hour, 2026-11-16 06:00Z; description, not a result)

- **The owner's point:** offshore 1.11 m at 6.83 s, served surf 1.54 m (5.1 ft), 1.39 times offshore, regime
  shoaling, geometry missing a fine shore normal and a break depth. The nearest buoy, 41117 at 30 km: 1.4 m, dominant
  period 5 s, mean period 4.5 s. It matches the director's reading of the evening before (1.12 m, 7.28 s, 1.58 m).
- **Served surf over offshore by class (median of one hour):** inlet_jetty 1.53, open_beach 1.46, pier 1.32,
  point_reef 1.38. The class labels are name-based and the sea differs spot to spot, so these are not factors.
- **The three hand-set magnets are the only spots near 2.2:** New Smyrna Inlet 2.19, Ponce Inlet North Jetty 2.19,
  Sebastian Inlet First Peak 2.18. New Smyrna Flagler Avenue, 4 km from the inlet and in the same sea, reads 1.57.
- **Six spots have no break depth**, the same six the offline ablation found: the owner's point, New Smyrna Inlet,
  Duck, Rodanthe Pier, Cape Hatteras Lighthouse, South Padre Jetties.
- **Period, north-east Florida:** the model's peak period at the nine spots from St. Augustine to New Smyrna is 5.2
  to 8.2 s; the two buoys there (41117, 41070) report a dominant period of 5 s and a mean of 4.5 to 4.9 s. One hour.
  It is the shape hypothesis H1 describes (the model's period sits above a wind-sea spectrum) and it is one reading,
  recorded so that the schedule's later readings can be compared with it, not so that it can be concluded from.
- **Four Gulf and Texas spots had no wave buoy within 100 km** in the feed that hour (Galveston, Pensacola, South
  Padre; Port Aransas had one with no mean period).

**What this is not.** One hour. No truth for the surf itself. A panel reading moves with the model run and with any
merged change, so a before-and-after pair must name the two deploys and the two hours.

## Follow-ups (not done here)

1. Print the slowest read's time in the panel's summary, so "no read over 8 s" can be read from the log.
2. The week-of-runs read owed by 2026-11-23 (ledger commitment in the schedule's fragment): how many scheduled runs
   ran, how many stopped early and why.
