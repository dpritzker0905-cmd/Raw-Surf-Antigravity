# 2026-11-22 wind long-range v2: design for the next attempt (session `local_318ba0a1`, branch `claude/wind-long-range-v2-prereg`)

Task (director `local_d6b521eb`, owner: fix the long-range wind gap toward state of the art, only through a new design under a fresh pre-registration). The registration is `gates/wind-long-range-v2.md` (committed with this file; no result exists). No served number changes in this PR.

## What binds
- #939 (raw ECMWF 51-member mean, ICON 180-336 h / EURO 240-336 h) was scored FAIL by the designated reader (run 44376282465, log 2026-11-15-wind-long-range.md "VERDICT"); closed 2026-11-20. Its stop rule holds: no re-run, no fourth collection, no re-scoring under a changed rule.
- **Blinding:** step 3b (coastal wind MOS) is not started, so no per-station, per-region or per-lead number from that run is read or recorded. This lane read the verdict line only and opened no report, score log or artifact of 44376282465, 43952101715 or 44107750669. Nothing from those runs is used in this design. The design does NOT depend on why #939 failed (that is unreadable by rule); it is built from first principles and tested on data that does not yet exist.
- Looping/cloning is unacceptable (owner). D-082: agency sources only. D-065/D-080: ships ON with a kill switch, a SCOREBOARD row, the history filter. Merges only through the director's gated loop (BRAIN_RULES section 24).

## The problem in one paragraph
At 8-14 days the day-by-day wind has little skill over climatology. The honest best forecast is therefore not "the model's field" but a calibrated estimate that leans on the model where it has skill and relaxes to climatology where it does not. Today's tails have neither property: ICON replays old days and EURO copies GFS, with no uncertainty handling and no calibration. #939 swapped in a better single source (an ensemble mean) but kept a fixed, un-shrunk, uncalibrated form and a single system. The surf rating also reads wind NONLINEARLY (`wq*wg`), so the quantity to score is that factor, not only speed.

## Candidate approaches

### A. Calibrated grand ensemble, shrunk toward climatology (RECOMMENDED; this is what is registered)
- Pool NOAA AIGEFS (31) + NOAA GEFS (31) + ECMWF IFS ENS (51). Fit, per lead bin x region, `f = c + alpha*(m - c)` for the vector, a matching speed map and a gust factor, ridge-shrunk toward the identity, with `c` a gridded seasonal ERA5 climatology.
- Why it could beat today's tail: (1) it uses real multi-model physics instead of a replayed or copied day; (2) multi-system pooling reduces the sampling noise of any one 31-51 member ensemble and mixes a physics ensemble with an AI ensemble whose errors are less correlated (a standard grand-ensemble effect; to be measured, not assumed); (3) the fitted `alpha` falls with lead, so the field relaxes to climatology by itself as skill dies, with no hard switch and no fallback to a loop; (4) calibration removes the systematic speed bias and the over-dispersed variance an unshrunk member mean carries.
- Data: AIGEFS from NOAA's open archive (31 members, 10 m UGRD/VGRD, f000-f384 at 6 h, 4 cycles/day, bucket `noaa-nws-graphcastgfs-pds`, `EAGLE_ensemble/aigefs.*`); GEFS 0.25 deg live archive (`noaa-gefs-pds`); IFS ENS open data (AWS mirror plus the GCS copy). Climatology from ERA5 (C3S). Truth NDBC/C-MAN/ASOS as before.
- Cost: collection ~3 systems x 90 TEST runs plus ~69 FIT runs, byte-range reads of u/v only on a hosted runner (public repo, nothing on Render). Heaviest is IFS ENS (~8 GB read per run, throttled before); AIGEFS and GEFS are plain object reads. Estimated tens of runner-hours, comparable to the earlier hindcast. Serve cost: one reduced file per cycle written by an Actions workflow (like the earlier ens_wind producer), no live-box load. Both estimates are measured in the build PR.
- Risks: the TEST window is 8 weeks away (forward), only 2 months of winter, 90 runs, about 10 five-day blocks (FRAGILE); AIGEFS became operational 2025-12-17 so FIT is only ~11 months; model upgrades may move the fit.

### B. Calibrated AIGEFS alone (second gated arm)
- NOAA's AI ensemble on its own, calibrated by the same form. A deliberate cheaper fallback: one system, no ECMWF dependency, no throttled mirror. If AI ensembles keep an edge at days 8-15 (published results for AI ensembles point that way; unverified here), this may win outright. Tested as a second gated arm so a throttled ECMWF side cannot sink the whole study. Holm over two arms.

### C. Rating-space ensemble (member-wise `wq*wg`; NOT registered now)
- Instead of rating the calibrated MEAN wind, compute the rating's wind factor for each member at each spot and serve its median. Why it could win: the mean vector of a spread-out ensemble goes calm, which the rating reads as glassy, a systematic optimistic bias; a member-wise functional avoids it. Data: the same members, plus 31-51 rating-factor evaluations per spot-hour (arithmetic, cheap if done in the producer, but it changes the "one forecast composition" chain contract and needs the owner's/director's design ruling). Held for a later registration once A exists; the metric `M2` in the gate already measures the factor, so the evidence to justify C can be reported from A's TEST without gating.

### D. Extended-range / week-2 anomaly products (NOT registered)
- ECMWF extended-range or C3S S2S weekly anomalies to modulate climatology in days 11-14. Plausible skill in weekly means, but data access and licence for the open feeds are unverified, and weekly means do not give the 6-hourly wind the product needs. Parked.

### E. Reject list
- Looping or cloning any frames (owner).
- Open-Meteo, in any role (D-082).
- Resurrecting #939 as-is, or re-scoring its collected runs with a new arm (its stop rule).
- A learned (gradient-boosted/neural) post-processor now: no training history long enough, and it would multiply the number of hypotheses.

## What was checked while writing (inventory and listings only; no forecast values read)
- **AIGEFS:** operational at NCEP since 2025-12-17 (NOAA EPIC and AWS listings, via search); earlier archive (2025-06 to 2025-12-16) is the experimental EAGLE ensemble and is excluded from FIT. Archive scan of the bucket, 2025-06-01 to 2026-11-21: 540 day directories, 0 missing days; days with fewer than 4 cycles: 2025-08-11 (2), 2025-12-16 (2), 2025-12-18 (1), 2026-01-12 (3), 2026-01-13 (3), 2026-02-03 (2), and 2026-11-21 (3, in progress). One sampled run: `mem000` to `mem030` present, f000 to f384, `sfc` files hold UGRD/VGRD 10 m and TMP 2 m. Not checked: NOAA's own release notes per version, the member-by-member completeness of every run.
- **GEFSv12 reforecast** (`noaa-gefs-retrospective`, 2000-2019, 5 members): `ugrd_hgt_*`/`vgrd_hgt_*` inventory lists "10 m above ground" and "100 m above ground", 3-hourly in days 1-10 and 6-hourly later. This is a fall-back climatology source, not the plan.
- **Not verified:** ERA5 10 m climatology via the CDS (needs `CDS_API_KEY`, by env name); IFS ENS archive depth and cycle changes over the FIT year; AIGEFS grid size (file size suggests 0.25 deg).

## Why the window and the shape (so a reviewer can check the reasoning, not the numbers)
- The test must be unreadable at registration time, and the earlier hindcast showed that a retrospective window leaks through attention: this is forward. 2026-12-01 to 2027-01-14 inits avoid every blinded window (valid >= 2026-12-08, 3b TEST ends 2026-11-15).
- FIT ends 2026-09-30 so no FIT truth overlaps 3b TEST; the coefficient files are hashed before the first TEST init.
- The old C1 control (a +48 h shift must lose to climatology) is replaced, because a shrunk arm sits at climatology in B3 and cannot satisfy it; the replacement controls are in the gate.
- Three gated arms (two calibrated plus the labelled-climatology arm), not eight, so the Holm family stays small.

## Open questions (owner/advisor)
1. If nothing beats climatology in B1-B2: serve a labelled climatology (not a loop)? ANSWERED 2026-11-22 (owner via director): yes. Registered as the third gated arm `CLIM_SERVE` (G1, G2, G4, G6; no G3), served labelled as climatology only where no calibrated arm passes. CLIM_SERVE is gatekept: tested (own family F1c) only for a tail where both calibrated arms fail; F1 stays 20 lines, F3 6.
2. The hard hand-off (no taper) interacts with shrinkage: a calibrated field is smoother than the native one, so the seam test may fail. A taper is a new decision for the owner.
3. The wait for a forward test (first score on or after ~2027-02-01) is the price of an unreadable test. A cheaper but weaker alternative is a retrospective winter window; this lane did not register one because it cannot be unread.
4. Gust: AIGEFS has none, so its gust is derived; the gust gates are reported only.

## Sequence after the advisor's line (nothing starts before it)
1. Build PR (collector for AIGEFS and GEFS added to the `wind_lr_*` instrument, FIT fitter, scorer with the controls above, tests, floor fragment). Advisor reads it.
2. David's typed word, then ONE FIT collection, then freeze and hash the coefficients and the ERA5 climatology BEFORE 2026-12-01 00Z.
3. Weekly truth snapshots from 2026-12-08. TEST collection runs forward; pass 1 after each run's 336 h exists; the single pass-2 for throttled runs.
4. Score once on or after ~2027-02-01; the reader applies the rule and reports the verdict line first.

## Record
No served number changed. No dispatch made. No hindcast report or score log of the earlier runs opened. Branch `claude/wind-long-range-v2-prereg`.
