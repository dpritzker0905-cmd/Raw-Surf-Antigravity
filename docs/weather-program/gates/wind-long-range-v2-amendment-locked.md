# Amendment L1 (LOCKED buoys) to gate wind-long-range-v2: #1199's LOCKED buoys are dropped at load, every variable
Date: 2026-11-23, written about 20:30Z. At that time: #1199's locked list was not recorded (`holdout.locked_list` null);
this gate's station list was not frozen (#1216 unmerged); and no FIT or TEST collection, fit or score had run.
It spends no amendment number: amendment 2 reserves the next numbered amendment for the GEFSv12 fallback. No v2 row exists. The
registration and amendments 1, 2 and G1 are not edited.

**Ruling.** David ruled **"Whole buoy, all data (Recommended)"** on 2026-11-23. The director (session `local_d6b521eb`)
relayed the ruling. #1199's LOCKED holdout covers the whole buoy and every variable it reports.

**Dissent (this gate's lane, `local_6be5752d`, 2026-11-23), recorded as given.** The lane preferred scoping LOCKED to wave
Hs, for three reasons:
- v2 reads only stdmet WSPD, WDIR and GST, never wave height, so it cannot tune against the wave holdout.
- A blanket drop silently moves pre-registered wind floors, Hawaii above all.
- The gate compares arms on identical rows, so a smaller list helps no one.

It stated one residual risk: a locked buoy's wind could, in principle, inform a model that corrects waves, but v2 has
none. It asked that, if the exclusion is chosen, the amendment say four things: LOCKED ids are dropped at load, the
frozen list is unchanged, per-region counts before and after are reported against the 10-station floor from the frozen
list before TEST starts, and nothing counts as a gate move until the frozen list shows a floor is actually at risk.

**Why the exclusion was chosen anyway.** SubQ, Reflection and the EMOS lane recommended it:
- One station-id rule is what the fence enforces and audits. A per-variable rule needs a per-variable fence, and that is
  how holdouts erode.
- Local wind drives wind-sea Hs, and calibrated wind can feed served wind that drives waves, so wind and gust reads at a
  locked buoy are not cleanly separable from the wave claim.

**The answer to the dissent is the floor clause (L3).** The exclusion never relaxes a floor and never turns a thin region
into a verdict. A region it pushes below the floor is "insufficient", as the registration already says. The lane's four
asks are adopted as L1 and L2.

| # | Rule |
|---|---|
| L1 | **Dropped at load, every variable.** FIT and TEST truth and every control drop every LOCKED id, with its aliases, for WSPD, WDIR and GST, before any pairing, fit, cross-validation or bootstrap. **Per-station climatology tables** (`CLIM_STN`, `CLIM_GUST`; keyed by station id, never pooled across stations) are built for every frozen station, and their hashes are frozen as built. A LOCKED id's cell is never read, because no truth row exists for it, so no pooled number depends on it. The `CLIM_STN` / `CLIM_GUST` hashes therefore do not depend on when the locked list is recorded. The FIT-only power note reads FIT rows, which exclude LOCKED ids through the same truth fence. They use the shared fence (`services/buoy_holdout`; #1234 fences `wind_lr2_truth` and `wind_lr_obs.ndbc_year` / `ndbc_window`, so a LOCKED id returns no record). The **frozen station list is unchanged** (it is metadata: a LOCKED buoy stays on the list and is dropped at load). `wind_lr2_collect` keeps archiving. Printed lines pass through `buoy_holdout.redact`. |
| L2 | **Counts before TEST.** The order is: station freeze, spots export, pairing, counts, TEST. After the list is recorded and BEFORE the first TEST init, the gate publishes, from the pairing output of the frozen station list, the count before and after the drop of **marine-exposed stations (after pairing, before coverage)**. Each count is an UPPER BOUND on the floor count, per region (US Pacific, US Atlantic + Gulf, Hawaii, Europe Atlantic, Mediterranean). The counts cover both the wind floor (>= 10 per region in >= 3 regions) and the gust floor (amendment G1, section G5: >= 10 marine-exposed ADJUSTED NDBC GST stations per region, >= 3 regions). They are written to the ledger. The coverage half of the floor (>= 70% hourly records over the TEST window) is computed at SCORE time, as registered. |
| L3 | **No floor is relaxed (the floor clause).** Every floor of the registration and of amendment G1 applies unchanged to the reduced set. A region the drop leaves below its minimum is "insufficient" (for G6 / GG6), never a verdict. Fewer than 3 sufficient regions VOIDS the wind verdict, or the gust verdict, exactly as registered. No LOCKED buoy is readmitted, no floor is lowered, and nothing is substituted. Power comes back only by a further dated amendment that adds UNLOCKED stations by the registered catalogue rules, made BEFORE the first TEST init. A floor that L2's counts put at risk is reported to the director and David before TEST starts. This is not a gate move. |
| L4 | **History.** v2 has read nothing. The superseded 2025-window hindcast runs (for example 44376282465) read their station list, including buoys now on the served-wave list, before any draw. They stay blinded (registration, condition 2), and they are not a breach. |
| L5 | **No window look.** #1199's single read in the LOCKED WINDOW (2027-03-01 to 2027-04-30) supports the served **wave** claim only. This gate never reads a LOCKED buoy, including during that window. Every read of LOCKED data anywhere is logged in the ledger. |

**Freeze order.** The station freeze (#1216) reads only catalogue metadata (`activestations.xml`, and anemometer heights
from `station_page.php` through `wind_lr_obs.anemometer_m`, which is not fenced). A LOCKED buoy therefore keeps its metadata
and stays on the frozen list. If the fence is ever extended to that metadata lookup, a metadata exemption must land with
it, or a future freeze would drop LOCKED buoys for lack of an anemometer height.

**Gating.** No served number moves. This amendment changes which rows are read, not any test, threshold or arm.
