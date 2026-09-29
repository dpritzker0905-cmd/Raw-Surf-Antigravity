# 2026-09-29 · consensus builder, dispatch token, a glyph bug from the failed runs

Owner: the worktree session (`raw-surf-wt`). Append-only; only this session writes this file.

## ~08:30Z · start-of-context checks
- `dev` = `e82f59c8` (#153), healthy; every data lane green since the night; MOP ingest recovered at 06:10Z after the
  23:30Z CDIP 403s. `workflow_dispatch.armed: false` (no token yet).
- Ledger `by_band` and `by_region` published for the first time (numbers in SCOREBOARD, 11Z row, and D-006's flip
  caveats). Decision D-006 unchanged; Hawaii and small seas are the flip caveats.

## ~09:00Z · #161 (consensus PR A) opened
- `consensus_product.build_equal_mean(gfs, euro, icon)`: a copy of the GFS waves product carrying the equal mean
  where all three members answer, with GFS's period and direction; diagnostics carry members, counts and the
  consensus/primary ratio; mismatched inputs are refused. `equal_consensus` moved from the judge module so the judge
  and the builder share one definition.
- **Correction of the handoff:** "sampler 0.16 ms/sample, no cache needed" held only for small tiles. The sampler
  rebuilt its grid index (and resolution) on every call: 2.66 ms/sample on a 5,917-cell Brazil tile, ~25 s per frame.
  `PointSampler(memoize=True)` (opt-in; guarded to the builder) → 0.15 s. (LESSONS L-S9)
- 21 tests, 9/9 mutations red, chain floor 128/1495.

## 13:27Z · #161 merged on the owner's word (`e4c27fd7`); owner set the token
- Hosted chain 128 files / 1501 passed, exactly as projected.
- After the owner's manual deploy and the #161 deploy: `workflow_dispatch.armed: true` (13:30Z).

## ~13:35Z · failed runs triaged (owner asked "check logs to see what runs failed")
1. **Sim Parity 11:24Z = a real served-number bug.** 32/48 spots a level apart with heights within ~1%;
   `glyph_reference_size_m` null on all 48 (present on all 48 at 02Z). The 02:43Z precompute's GFS pass logged
   "0 spots have a size reference": at 02:48:41Z the prefetcher drew Supabase Storage 429s, the climatology read got
   the same 429 → None → every spot rated on the global default, served ~9 h (Trestles 63.4 vs 38.7). 1 pass in 90
   over 5 days. → **#162** (LESSONS L-F1).
2. Sim Parity 22:33Z on 09-28: glyph frames still on the pre-#146/#120 chain; the 23:01Z rebake fixed it, #150
   automates it. No action.
3. Forecast Accuracy Monitor 06:48Z: **false alarm.** Ledger passes 34-37 min after the previous one scored 0
   (scored vs gap: 3 h → 1,282; 66 min → 36; 34 min → 0; 37 min → 0; 11:57Z → 1,005). (LESSONS L-F4) Fix queued.
4. Marine Nightly zoomlab 13:14Z (and 09-28): 12 consecutive MULT0 frames (~7 s); 09-28 was 15 s API timeouts. n=2
   with different signatures: recorded, not diagnosed.

## ~13:40Z · #162 opened
- Status-aware climatology loader (failed vs absent), retries 3 s / 6 s, the precompute refuses the pass and the
  model keeps its previous frames. 20 tests incl. a replay of the 02:48Z 429-then-200 sequence; 7/7 mutations red
  (+1 equivalent). Chain floor 129/1515. Residual: the live `/spot-ratings` fallback.

## ~13:45Z · memory moved into git (D-008)
- This folder created: README (protocol), STATE, DECISIONS (D-001..D-008), SCOREBOARD (seeded with the measured rows
  above), LESSONS (migrated from agent-local memory, without infrastructure IDs), and this log.
- The untracked `audit/weather-simulation-15.0/HANDOFF.md` on the main machine is frozen history from now on.

## ~13:55Z · #162 merged; D-009
- #162 merged on the owner's word (`f18c7ab8`); hosted chain 129 / 1521 exactly as projected.
- Designing consensus PR B surfaced two flaws in rewriting GFS tiles in place: the pre-flip evidence would come only
  from the judge's approximation, and the ledger/judge would lose their GFS baseline (their equal arm would count
  EURO and ICON twice). Asked the owner once with a recommendation → **D-009: shadow product first.**
- Found for PR B: the point resolver's live marine fallback runs only for GFS/ICON/EURO, so a `CONSENSUS` point reads
  the manifest or answers unavailable (no upstream calls); `/point` and `/grid` accept only GFS|ICON|EURO (the
  judge arm needs that widened in PR C); the ICON regional pilot covers 2 days and the four GFS-only regions have no
  EURO/ICON tiles, so members come from their coarser tiers via `manifest_point_selection`.
