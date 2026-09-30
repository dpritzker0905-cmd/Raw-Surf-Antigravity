# 2026-09-30 session c188: the handoff picked up; commitment 188's instrument (#197)

Session `c188`, worktree `C:\Users\David\App\raw-surf-wt`, branch `claude/c188-bigswell-by-region` (from
`claude/handoff-2026-09-30-b` at `14961798`). Owner (chat): "Pick up on the last context where it left off and check
the handoff report". Times are clock reads (`date -u`) or platform timestamps (L-P10).

## Start (19:11:09Z)
- `memory_audit.py`: 0 FAIL / 0 WARN / 6 NOTE (commitments 149, 172, 177, 182, 186, 188 open, none overdue).
- Verified live against HANDOFF-2026-09-30-b: `origin/dev` = `2123d70e` (#195); #196 open, every check green (hosted
  chain 136 / 1655 = the projection); Render `/api/health` at 19:11:40.9Z: version `...2123d70e`, uptime 1020.5 s,
  so #195 (W-23) has served since 18:54:40Z (ledger seq 194; commitment 182's 12 h window opens 2026-10-01T06:55Z).
- Precompute 36759469454 (started 18:33:50Z) still in progress at `b1e5e50d` = #194's merge, so its report carries the
  S9 wind fix (commitment 177) and the consensus shadow's first +24 h targets (commitment 186).

## Commitment 188's instrument (#197, opened 19:17:28Z)
The handoff's next buildable item not waiting on data. `skill_consensus._big_swell` gains `by_forecast_by_region`:
per lead, for the served lane and the equal mean (the two choices of the recommended per-region serve rule), each
forecast's own >= 3 m calls per coast, MAE and bias; both keys listed where either calls big (n 0 where one never
does); a thin cell (< 10) prints n only. The held-out pair's coast is carried aligned with the lead's test list.
- No served number changes; no fetch; no new ledger rows.
- 2 tests; mutations 8/8 caught (harness in the session scratchpad, verdict from pytest's summary, no shell).
- ⚠️ The mutation harness restored the file with Python text mode, which wrote CRLF on Windows: `git status` showed
  it modified with no content diff. Restored from the committed WIP (`git checkout HEAD --`); `file` reads LF again.
  A harness that restores must write bytes (`read_bytes`/`write_bytes`), not text. Recorded as LESSONS L-P16.
- 210 nearby skill/calibration tests pass locally (main checkout venv, 2 declared packages absent).
- Chain floor 136 / 1651 (hosted 1655 on #196 + 2 = 1657, margin 6), `_FLOOR_SET_FROM["chain"]` -> 1657.

## Owner action learned of
- #196 merged by the owner at 19:17:15Z as `50669cd5` (ledger seq 193), 13 s before #197 was opened; #197's
  diff is therefore its own commit only.

## The read (commitment 188, due 2026-10-02 18Z)
After #197 merges and a precompute runs: `forecast_skill_consensus.by_lead[*].big_swell.by_forecast_by_region`.
Build a dark regional calibration only if a coast's forecast-binned bias exceeds ~0.2 m with n >= 30.

## Owner (chat, after 19:20Z): "merge #197 when it's green and move to the next fix"
- GitHub auto-merge refused ("Auto merge is not allowed for this repository"), as the handoff said; the merge waits
  for the checks and is done by hand.
- #197 MERGED 19:36:43Z as `15188320` (ledger seq 200): 15 pass, 3 skipped (Netlify), 0 failing; run 36764840449's
  chain job collected 1657 tests across 136 files = the projection.
- Precompute 36759469454 completed 19:17:37Z; the report it published reads `generated_at` 2026-09-30T18:55:49Z.

### Commitment 186, read (ledger seq 196)
- Built shadow at +24 h, n 92: MAE 0.135 / bias +0.014; computed equal 0.139 / +0.033; served GFS 0.175 / -0.125.
  |shadow - equal| median 0.000, p90 0.013 m: the construction control passes. No 48/72 h shadow rows yet.
- by_region, computed equal, held-out week pooled over leads (n): hawaii GFS 0.440 / equal 0.538 (946); atlantic_se
  0.215 / 0.243 (1730); atlantic_ne 0.400 / 0.321 (1911); gulf 0.164 / 0.149 (322); pacific_ne 0.305 / 0.242 (3321);
  other 0.327 / 0.223 (520). n-weighted: GFS 0.319, equal 0.287, the per-region rule 0.271.
- Why no recommendation yet: this window (09-23T18:55Z..09-30T18:55Z) shares 6.9 of 7 days with the 16:31Z pass that
  chose the two coasts (5.7 with the 09-29 11Z pass). Three agreeing passes are one sample. ⚠️ Ledger seq 196 first
  said "~5.9"; corrected by seq 199 (re-derived before pushing). The training weeks
  never saw the choice: they are the test. New commitment 198 reads it.

### Commitment 177, first half met (ledger seq 197)
`summary.wind_n` 3, `wind_mae_kt` 3.86 (was 0 since 2026-08-09). The ledger's wind grade reads `no_wind_rows` (24 h of
new rows needed); it rides with 172.

### The next fix: the per-region rule graded out of sample (branch `claude/consensus-regional-rule`)
`RULE_GFS_REGIONS` declared; `regional_rule` (per lead, held-out AND training weeks: served, equal, rule) and
`by_region_train`; the shadow's `by_region`. 4 tests; mutations 11/11 (bytes restore, `git status` clean after).
No served number changes.

### Commitment 149, early look (not its read)
The 18:55Z report's `forecast_skill` has no `raw_surf:GFS_SCALAR` lead grades yet: the lane was armed by #189 at
12:48Z, so its first +24 h targets score on 2026-10-01. Due 2026-10-03T18:00Z; nothing owed yet.

### W-31 scoped (not started)
`surf_transform.py:415` returns the offshore Hs labelled `shelf` when a coastal spot has no usable depth. The label is
not cosmetic: `surf_height_convention._CONVERTIBLE = ("shelf", "shoaling")` applies the x1.27 H1/10 factor by regime,
so a bare rename to `unknown_depth` would drop the factor there (a served change). The served-neutral fix: name the
regime `unknown_depth` AND list it in `_CONVERTIBLE` (it is still a significant height presented as surf); the plan's
null control then proves byte-identical heights. Consumers of the label to check first: `mop_nearshore.py:235`,
`surf_transform.py:527`, and anything that branches on `regime` downstream (frontend included). Backend branches
found: `surf_rating.py:740`, `surf_transform.py:645`, `grid_size_climatology.py:117` exclude only
open_ocean/calm/unknown, so `unknown_depth` would rate like `shelf` there (served-neutral). 13 frontend files mention
"shelf", but none branches on the literal regime string (non-test grep for the quoted value: 0 hits): shelf width and comments.

### W-33 scoped (not started)
`backendWeatherServiceClientPoint.js:666` writes `infoboxDisplayedHeight: point.speed` (the OFFSHORE Hs) into the
debug trace `window.__GFS_WAVES_SINGLE_SLICE_TRACE__.exactPoint`; nothing else reads the field. The fix is a rename
(e.g. `offshorePointHeight`), served-neutral, but any frontend merge restarts the Render backend (W-26): bundle it with
other frontend work.

### W-30 scoped (not started)
`spot_ratings.rate_one_spot` applies tide (`tide_norm_at`, the `tide_fit` factor) under `RATING_TIDE`, which is '1' in
forecast-ingest.yml, precompute.yml and sim-parity-monitor.yml; `sim_rating.py` has no tide path. So the sim and the
served rating diverge on every spot with a `best_tide` prior (38 of 1516 on 2026-07-18; the plan's S4 monitor names
18 banded spots, up to 2x quality). A served-number change for the SIM surface: dark flag, parity test on a
"Low tide" spot, then the owner's flip.

### For the dark build, if commitment 198 confirms the rule
- The switch is small: `consensus_serve.twin_index` pairs GFS regional tiles with their CONSENSUS twins by
  `region_id`; a rule is a region filter there, behind its own default-off flag, so a tile outside the rule keeps GFS.
- ⚠️ The ledger's coasts are NDBC id prefixes, not tiles. The spot-matched `41xxx` buoys in the 18:55Z report are
  41065/41067/41070/41076/41110/41112/41113/41115/41117/41120/41121/41159 (mostly CDIP nearshore, North Carolina to
  Florida), so `atlantic_se` means the US Southeast coast, not the Florida tile alone; `51xxx` are 51201-51214 (Hawaii).
  The tile list must be derived from where those buoys sit, and graded per tile before any flip.

## Owner (chat, after 19:38Z): "merge #198 when it's green and move to the next fix"
- #198 MERGED 19:56:30Z as `78c568d9` (ledger seq 202): 15 pass, 3 skipped; chain 136 / 1661 = the projection;
  guards 175 / 2130.

### W-30 built DARK (branch `claude/w30-sim-tide`)
The next fix in the handoff's order not waiting on data. The design turned on one recorded trap: the plan's wording
("when it has a valid_time and RATING_TIDE=1") gates on the sim's own env, which is empty on the owner's machine, so
the fix would have been inert where the sim runs. Instead the sim reads the tide state THE GLYPH graded with off the
`/spot-ratings` response `sim_observed.parity` already fetches (`SpotRatingItem.tide` survives the wire), with the
same condition and arguments, so it costs zero new I/O (a test counts one request for tide and parity together).
- Effect, measured on a synthetic "Low" reef at high water (norm 0.95): sim 97.3 epic -> 48.7 fair, x tide_fit 0.5,
  what the glyph grades. A spot with "All tides" is unchanged.
- `SIM_SERVED_TIDE` default '0'; 15 tests; mutations 13/14, the survivor an equivalent mutant (a redundant isfinite()
  that the range test covers), removed. The composition-parity registry marks the sim's tide SUPPLIED.
- ⚠️ The first mutation run hit a Windows write error (errno 22, a file held just after a test read it) mid-run and
  left a mutant in `sim_observed.py`; the committed WIP restored it (`git checkout HEAD --`). The harness now retries
  a held write. Two local failures in the wider sim suite (`condition_reports` absent from the local sqlite; the stdio
  handshake) fail identically at the base commit: environment, not this change.
- `weather_sim_mcp.py` is at 800 lines, the ceiling: the new kwarg replaced a comment line.
- Evidence lane (commitment 203, due 2026-10-02T18:00Z): the parity probe must pass the glyph's `item["tide"]` on its
  composition call under the flag and sample the banded spots; then a monitor dispatch 1 vs 0.
