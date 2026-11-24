# 2026-11-22 · Senior research lead (side session to the director, local_d6b521eb)

One log per session (README write protocol). Every PR below was docs only, `[skip render] [skip netlify]`. Nothing was built, dispatched or served.

## Research notes
| Note | PR | State at 2026-11-22 20:25Z | One line |
|---|---|---|---|
| Q1 long-range wind ensemble calibration, Q2 bias correction with lead decay, Q3 surface-current source skill | #1141 | merged | Q1 corrected: #1133 weights SYSTEMS equally (under member weights it would be IFS 51/113). |
| Q7 tide and surf quality, Q8 nearshore transform SOTA | #1146 | merged | `tide_fit` matches practice but is unproven. MOP-lite is the largest evidence-backed upgrade. |
| SubQ figures in Q7/Q8 labelled as model confidence | #1161 | open | The advisor's limit on #1146. |
| Q10 the rating's wind at the break | #1163 | open | See below. |

## Gates
| Gate | PR | State |
|---|---|---|
| `currents-skill-v1` | #1143 | merged |
| `surf-tide-v1` | #1147 | merged |
| `nearshore-moplite-v1` (datum table, seam stratum, ship rule) | #1148 | merged |
| `d071-regrade-amendment-1` (reported-beside secondaries; due before the 11-26 re-grade) | #1164 | open, advisor hold fixed |
| `rating-wind-coast-v1` | #1165 | open, advisor hold fixed; L6 prior evidence added |
| `served-wave-verify-v1`, the program's ONE point archive (purpose `served` \| `nearshore_eval`) | #1168 | open, critical path |

## Measurements (instrument cited; n = 1 where marked)
- **La Jolla pier vs offshore buoy wind:** CO-OPS 9410230 (pier) against NDBC 46086 (hourly vector means), 2026-11-09 02Z to 11-21 23Z, n = 310 paired hours, shore normal assumed 265°. Read through the CO-OPS and NDBC MCPs; the script lived in a scratch session.
  - The offshore / cross / onshore class agrees in **39.4 %** of hours. In 86 hours the buoy reads onshore while the pier reads offshore.
  - The pier shows an offshore land breeze of +0.55 to +1.86 m/s between 22:00 and 09:00 local. The buoy reads onshore every hour.
  - Observations only; no forecast was read. n = 1 site.

## Second opinions (advisory)
- **Reflection:** picked HRRR native for the rating wind, judged by a category score with a timing tolerance.
- **SubQ, Reflection and LongCat (relayed by the director):** all ranked the served point archive first.
- **LongCat paid submits:** they failed twice earlier in the session with network errors (#1138, #1142). They were not retried.

## Gaps found by this session's memory pass
- Q10 and #1165 missed the L6 2026-11-02 wind measurement (HRRR +1.17 rating points vs GFS at 7 anemometers). Both now cite it, pre-data. See LESSONS L-S29.
- #1168's first QC draft dropped NDBC numeric fills globally, which deletes valid MWD 99°. It now uses #1156's per-field ranges. See L-S30.
- #1156 and #1168 were two point archives. #1168 is now the one archive, and #1156's change list is in its §0.4 for the nearshore lane. See L-S31.

## Owed
- When #1163 and #1165 merge: nothing else is owed on them. Collection for `rating-wind-coast-v1` needs David's word, and the NBM/HRRR pull sizes must come first.
- The #1156 change list goes to the nearshore lane (the director routes it).
