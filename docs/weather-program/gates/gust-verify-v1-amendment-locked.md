# Amendment (LOCKED) to the gust verification record (#1063): #1199's LOCKED buoys are dropped, every variable
Date: 2026-11-23. Written BEFORE #1199's locked list is recorded (`holdout.locked_list` is null in
`docs/weather-program/gates/served-wave-verify-v1-buoys.json`), so no score in this record has been read with or without
the exclusion. The registration (`log/2026-11-18-opus-gust-verification.md` section 1) is not edited. Its own rule says
changes are appended as dated amendments, and this file is that amendment.

**Ruling.** David ruled **"Whole buoy, all data (Recommended)"** on 2026-11-23. The director (session `local_d6b521eb`)
relayed the ruling. #1199's LOCKED holdout covers the whole buoy and every variable it reports, not only wave height. Before
the ruling, SubQ, Reflection and the EMOS lane recommended this option (whole buoy). The long-range-wind lane dissented
(wave height only); its dissent is recorded in `wind-long-range-v2-amendment-locked.md`.

**Why this record is touched.** The record scores every NDBC station that reports a gust (GST) between 60S and 65N: 510
stations, frozen 2026-11-20. (The first freeze, on 11-19 with 512 stations, was never stored, because every storage call
that day returned HTTP 401.) 87 of the 100 served-wave buoys report a gust in NDBC `latest_obs` on 2026-11-23 by the same
rule. That is an approximation of the frozen list, which L2 counts exactly. Almost every LOCKED buoy is therefore in this
record. #1199 section 1a says that no gate, ablation, calibration or **diagnostic** reads a LOCKED buoy.

| # | Rule |
|---|---|
| L1 | **Dropped at load, every variable.** The scorer (`gust_verify_score.py`) drops every LOCKED id, with its aliases, from GST, WSPD and every derived field, before any pairing, bootstrap or table. It uses the shared fence (`services/buoy_holdout.drop` / `keep`, served-wave-verify amendment 3). The **frozen station list is unchanged** (it is metadata). The collector keeps archiving every station, because LOCKED buoys are still collected for #1199's window. Printed lines and published tables pass through `buoy_holdout.redact`. |
| L2 | **Counts before the first read.** Before the first score read after the list is recorded, the record publishes the station count before and after the drop: in total, land vs sea node, and with vs without a usable anemometer height (amendment 1's ADJUSTED set). The counts come from the frozen list and are written to the ledger. |
| L3 | **No floor is relaxed.** The record has two registered count floors. Per model x lead bin, the decision rule needs "at least 14 distinct cycles"; the drop removes stations, not cycles, so that floor is unaffected. The POSITIVE control needs n >= 1,000 (section 1, Controls); if the drop takes it below, that run's table is **VOID**, as section 1 says of a failed control, and the floor is not relaxed. A cell that the drop empties, or leaves without any pair of a decision condition, is **NOT_READ** for that cell. It is not relaxed, no LOCKED buoy is readmitted, and nothing is substituted. Power comes back only by a further dated amendment that adds UNLOCKED stations, made before that cell is read. |
| L4 | **History.** The scores computed before the list is recorded read the overlapping buoys: the keyless PR dry run on 2026-11-18 (run 44392035963, nothing uploaded) and the scheduled daily scores from 2026-11-19, after #1063 merged at 06:46Z. They read the overlapping buoys as a verification diagnostic. They precede any draw, so they are history, not a breach of the holdout. From the first score after the list is recorded, they are not re-scored, re-published or pooled with post-draw scores in any table that includes LOCKED ids. |
| L5 | **No window look.** #1199's single read in the LOCKED WINDOW (2027-03-01 to 2027-04-30) supports the served **wave** claim only. This record never reads a LOCKED buoy, including during that window. Every read of LOCKED data anywhere is logged in the ledger (BRAIN_RULES section 23). |

**Gating.** No served number moves. The record proposes a gust correction only under its own decision rule, and a
correction needs its own gate. This amendment takes effect when #1199 records the list. Until then the fence is a no-op.
