# Amendment (LOCKED) to the long-range wind EMOS gate (#950): #1199's LOCKED buoys are dropped, every variable
Date: 2026-11-23. Written BEFORE #1199's locked list is recorded (`holdout.locked_list` is null) and before any fit,
coverage read or score of this gate. Collection of ENS forecast values at the frozen station points has run (the June
2025 backfill, run 43952114222; daily since 2026-11-17), but no buoy OBSERVATION has been read: no fit, coverage read or
score has run. The registration
(`log/2026-11-16-wind-emos-preregistration.md`) is not edited. Its own rule says changes after that commit are dated
amendments, and this file is that amendment.

**Ruling.** David ruled **"Whole buoy, all data (Recommended)"** on 2026-11-23. The director (session `local_d6b521eb`)
relayed the ruling. #1199's LOCKED holdout covers the whole buoy and every variable it reports. A fit is a calibration, and
#1199 section 1a allows no calibration to read a LOCKED buoy. Before the ruling, SubQ, Reflection and the EMOS lane
recommended this option. The long-range-wind lane dissented (wave height only); see `wind-long-range-v2-amendment-locked.md`.

**Why this gate is touched.** Its station rules (registration item 6: NDBC/C-MAN within 50 km of GFS land with a known
anemometer height, plus ASOS) take in most of the moored NDBC buoys on the served-wave list. The frozen record has 419
stations (frozen 11-16).

| # | Rule |
|---|---|
| L1 | **Dropped at load, every variable.** Training (`wind_emos_fit`), coverage reads and scoring drop every LOCKED id, with its aliases, for wind speed and gust, before any window, fit, bootstrap or table. They use the shared fence (`services/buoy_holdout.drop` / `keep`). The **frozen station list is unchanged** (it is metadata). The collector keeps archiving. Printed lines pass through `buoy_holdout.redact`. |
| L2 | **Counts before the first read.** Before the first fit or coverage read after the list is recorded, the gate publishes the station count before and after the drop for every (network x region) cell: NDBC/C-MAN and ASOS x US East+Gulf, US West, Hawaii, Alaska. The counts come from the frozen list and are written to the ledger. |
| L3 | **No floor is relaxed.** The registration's own rules apply unchanged to the reduced set. A (lead bin x network x region) cell below 300 training pairs falls back to its network's pooled fit, reported, as registered; that fallback is not a relaxation. G4 reports Hawaii as its own stratum. If the drop leaves the Hawaii stratum (or any registered stratum) without the rows its rule needs, that stratum is **NOT_READ**, and its cells keep raw, consistent with G4. It is never pooled into another region to make it readable, no LOCKED buoy is readmitted, and nothing is substituted. Power comes back only by a further dated amendment that adds UNLOCKED stations, made before that stratum is read. |
| L4 | **History.** Reads of buoy observations made before the list is recorded are history, not a breach. That includes the coverage read (step C, `mode=coverage`, which runs `wind_emos_fit.build_rows`) if it runs first. After the list is recorded, no table pools them with post-draw reads in any table that includes LOCKED ids. |
| L5 | **No window look.** #1199's single read in the LOCKED WINDOW (2027-03-01 to 2027-04-30) supports the served **wave** claim only. This gate never reads a LOCKED buoy, including during that window. Every read of LOCKED data anywhere is logged in the ledger. |

**Census note.** The served-wave fit-used census lists "wind / gust EMOS" as **open**. No EMOS fit has read any buoy, so this
gate makes no buoy fit_used today. Once the gate fits, the census tags the buoys it read. Under L1 none of them is LOCKED.

**Gating.** No served number moves. Serving a calibrated forecast still needs this gate's PASS and David's yes.
