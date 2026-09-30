# Weather program: state

**Updated 2026-09-30 19:57Z** (logs: `log/2026-09-30-c188-bigswell-by-region.md` (#197, #198, W-30), `log/2026-09-30-memory-audit.md` (every memory checked), `log/2026-09-30-audit-sota.md` (the deep audit), `log/2026-09-29-consensus-and-ops.md`, `log/2026-09-29-sim-works-plan.md`; every action: `ACTIONS.jsonl`). Verify live before acting: this file
is a claim, not a measurement.

## Now
- **Commitment 186 READ (seq 196, corrected by 199), 2026-09-30T18:55:49Z pass:** the built consensus shadow matches
  its definition (abs(shadow - equal) median 0.000, p90 0.013 m; n 92 at +24 h) and beats served GFS on the same
  pairs (0.135 vs 0.175 m). The per-region rule (GFS in hawaii and atlantic_se, the equal mean elsewhere) reads 0.271
  vs equal 0.287 vs GFS 0.319 over 8,750 held-out pairs, but IN SAMPLE (the window shares 6.9 of 7 days with the pass
  that chose the coasts). Out of sample on the training weeks: the regional-rule PR, read by commitment 198 (due
  2026-10-01 18Z); only then a recommendation. 177's first half met (`wind_n` 3, seq 197).
- **HANDOFF for a fresh context: `HANDOFF-2026-09-30-b.md`** (evening; supersedes `HANDOFF-2026-09-30.md` for what
  next). Consensus evidence at the 16:31Z pass: the computed equal mean beats served GFS all-sea (24/48/72 h
  0.286/0.312/0.373 -> 0.262/0.290/0.323) and in every band, but LOSES in `hawaii` (0.443 -> 0.543) and
  `atlantic_se` (0.222 -> 0.250): the recommendation is a per-region serve rule, built dark (seq 185).
- **MEMORY AUDIT 2026-09-30 (`log/2026-09-30-memory-audit.md`):** every store re-checked against reality; 5 local
  memories were stale or wrong (fixed, dated); the Mem0 connector stores a plain-text API key (**owner: rotate it
  at Mem0 and delete memory `623a983f-...`**); we learn only what we mechanize (LESSONS L-A7), so L-P10 is now two
  checks (`action_ledger.py` refuses estimated times in `verified`; `memory_audit.py` reads HANDOFF headers; clock
  slack 5 -> 1 min). W-50 (512 MB) corrected in BRAIN_RULES and the system-brain doc.
- **AUDIT 2026-09-30, read first: `log/2026-09-30-audit-sota.md`.** Four new findings, each priced on production:
  (1) `/point` interpolated marine HEIGHT as a vector (served heights low wherever corner directions diverge: 11% of
  spots > 5% low; same-model MAE 0.055 -> 0.043 with scalar) -> fix built DARK (`SAMPLER_SCALAR_HEIGHT`);
  (2) the measured error budget: offshore Hs 37% of rating variance, swell direction 33%, wind speed 19%, period
  10% (corrects the 2026-09-29 audit's flags-off ranking); (3) the skill ledger's queue sat at 29,477 of its 30,000
  cap and the `CONSENSUS_SERVE` flip would have evicted every lane's +72 h rows -> cap 54,000 in the same PR;
  (4) a Supabase 429 on a regional tile silently serves the 2-degree tier labelled `regional` (W-23). The ordered
  path is its section 4.
- **HANDOFF for a fresh context: `HANDOFF-2026-09-30.md`** (reading order, the production-reach finding, what
  landed #181-#186, open commitments, next fixes in order, owner-only items, measurement recipes, the report
  audit). Read it after this file; `HANDOFF-2026-09-29.md` still holds the switch table and science threads.
- **`dev` = `78c568d9`** (#198 at 2026-09-30 19:56:30Z, the regional-rule grade; backend). Render served
  `2123d70e` (#195, W-23) from 18:54:40Z (ledger seq 194); the #197/#198 deploys follow. ⚠️ Every frontend merge still
  redeploys the backend: the Render build filter ignores `docs/**`, `audit/**`, `**/*.md` but not `frontend/**`
  (W-26, owner-only Render setting; #182, #183 and #184 each restarted it). The Render backend auto-deploys from `dev`. The production frontend is frozen at `fc140024` (D-002).
- **Open PRs of ours:** the W-30 PR (branch `claude/w30-sim-tide`; the sim grades tide from the glyph's served
  tide state, DARK behind `SIM_SERVED_TIDE` '0'; its evidence lane is commitment 203). Merged 2026-09-30: #198
  (19:56:30Z, the per-region rule graded on the training weeks: commitment 198 reads it), #197 (19:36:43Z,
  commitment 188's instrument: read it after the next precompute), #196 (19:17:15Z, the evening handoff),
  #195 (18:38:47Z, W-23), #194 (17:53:50Z, S9 wind), #193
  (17:20:49Z, S7/S8), #192 (14:33:02Z, the Mem0/Trevec record), #191 (14:07:22Z, the ledger for #189/#190 + the Trevec registration), #189 (12:48:23Z, the audit + dark scalar height + its
  ARMED ledger shadow + the ledger cap), #190 (13:47:39Z, the memory audit + the L-P10 checks + W-50). Merged
  2026-09-29/30 before them: #181-#188.
- **Trevec (code-graph MCP):** registered in Claude Code (user scope) on this machine, index OUTSIDE the repo
  (`C:\Users\David\.trevec\data\raw-surf-wt`), INDEXED 2026-09-30 (424 s; `trevec ask` answered in 2.2 s). Its tools
  load in sessions started after 13:49Z. The index is a snapshot: re-run `trevec index` (or `trevec watch`) after big changes.
- **Mem0:** the owner revoked the old keys; the leaked key was redacted from memory `623a983f...` (seq 164-165).
- **The weather sim does not reach production map users** (#181 F1): `fc140024` is 3,283 commits behind `dev` and its
  map reads a Netlify Open-Meteo proxy. The plan's Phase 1 is the release-readiness evidence for D-002.
- **Open commitments:** `python backend/scripts/action_ledger.py open` (seq 79, 94, 149). 78, 86, 128 fulfilled early
  on 2026-09-30 (seq 139, 140, 138).
- **Live science:** one forecast composition (`surf_point.resolve_surf_geometry` + `estimate_surf_at` →
  `surf_rating.compute_surf_rating`); #146 cross-shelf friction off + cap-seam repair; #120 refraction Kr 0.873;
  per-spot size references (`RATING_LOCAL_SIZE=1`), now fail-closed in the precompute (#162).
- **BUILT, DARK (#175):** `CONSENSUS_SERVE` (consensus_serve.ServedStore; D-009's one switch). Flip on the
  shadow's evidence: forecast-ingest.yml + precompute.yml + the live env together.
- **FLIPPED 2026-09-29 (#174, D-010):** `REGRID_NATIVE_CELL` '1': regional wave tiles read their exact native
  cell (land nodes their centred 3x3). Effective per lane at its next ingest. Measure: the parity probe
  (node vs native 0.045 m before) and the ledger's same-model gap (S2 NCEP line).
  ✅ VERIFIED 2026-09-30 (seq 139): nodes 98% within 0.011 m of Open-Meteo's own cell; probe MAE 0.076 -> 0.051.
- **FLIPPED 2026-09-29 (#179, D-011):** `GFS_MARINE_STAGE_B` '1'. ✅ VERIFIED 2026-09-30 (seq 140): 205
  `us_pacific_northwest` products; the five named buoys serve regionally; Render memory 54-62% of 2 GB.
- **BUILT, DARK (the 2026-09-30 audit PR):** `SAMPLER_SCALAR_HEIGHT` '0' in forecast-ingest.yml,
  forecast-ingest-pilots.yml, precompute.yml (+ Render env on the flip): marine heights interpolated as scalars.
  **ARMED with it (serves nothing):** `SAMPLER_SCALAR_LEDGER` '1' (forecast-ingest.yml + precompute.yml): the
  ledger grades `raw_surf:GFS_SCALAR` beside `raw_surf`; commitment 149 reads it. Ledger cap 30,000 -> 54,000.
- **ARMED 15:30:45Z (#168):** the consensus SHADOW (model `CONSENSUS`, `CONSENSUS_INGEST` '1' in all three lanes).
  Serves nothing to users. VERIFIED: run 36590800405 built 874 frames across 18 regions (17:00Z); the 17:12Z
  precompute ledgered +137 `raw_surf:CONSENSUS` rows. First scored rows ~24 h later; then read `shadow`.
- **Built but dark:** MOP nearshore
  (`SURF_NEARSHORE_MOP`, graded, flip waits on spot observations).
- **Armed switches:** the workflow-dispatch fallback (#153), armed 2026-09-29 13:30Z. It dispatches a data lane's
  workflow when GitHub drops its cron slot. Audit it at `/api/health` → `scheduler.workflow_dispatch.last`. Kill:
  `WORKFLOW_DISPATCH=0`.
  ✅ **Working since the owner's token fix:** at 15:00:50Z it dispatched the missed core-ingest (12:15Z) and pilots
  (11:45Z) slots, and at 15:22:48Z declined to stack duplicates while they ran. Durable record: Render log
  `[workflow-dispatch]`.
- **CI floors on `dev`:** guards 175 files / 2124 (reading 2130; 176 / 2139 (2145) with the W-30 PR), chain 136 /
  1655 (1661), estate 580 (582).
- **Accountability:** every state-changing action is a line of `ACTIONS.jsonl` (BRAIN_RULES §23), hash-chained and
  verified in CI (`weather-program-ledger.yml`). The anchor below moves with every STATE update:
  **Ledger head: seq 203, sha256 5c4161780b5ae2cf0f7e290662f609897a8b032c0fc9058f18458d593e886529**

## Next fixes, in order
**The 2026-09-30 audit's order (log §4; supersedes the list below where they differ):** 1 ~~merge the audit PR~~ (#189,
done); 4 MERGED as #193 (its first graded rows: commitment 172, 2026-10-02); 5 (wind) MERGED as #194 (commitment 177); 6 (W-23) MERGED as #195 (commitment 182); commitments 79/94 checked (seq 185, 187), re-promised as 186/188; 188's instrument MERGED as #197; 186 read (seq 196): the per-region rule wins IN SAMPLE, its out-of-sample grade is #198 (merged; commitment 198); W-30 (sim tide parity) built DARK in the W-30 PR, its evidence lane is commitment 203;
2 the consensus flip on commitment 79's evidence (its ledger-cap precondition is met by that PR); 3 the
scalar-height flip on 48-72 h of `raw_surf:GFS_SCALAR` rows (commitment 149); 4 an S8 swell-direction (and period)
lane in the ledger (33% of rating variance, no instrument), then test a consensus direction/period; 5 S9 wind in
the ledger (19%; the observed-wind swap moves 30% of GFS levels), then coastal high-resolution wind; 6 W-23 (the
serve path retries a 429 and names its fallback); 7 W-10/W-11 (release). Deprioritised by measurement: item 5 below
(big-swell calibration: forecast-binned bias on the equal mean is -0.10/-0.04/-0.03 m) and partitions as a
direction fix (not supported by a bulk-buoy instrument; needs spectral truth).

- ~~**A Pacific NW / NorCal regional tile**~~ built (#177) and flipped (D-011); The 2-deg global_mid tier reads +0.097 m high vs the same
  model (38% of the squared gap), led by 46244 Humboldt (+0.50 m) and Oregon/Washington buoys that no
  regional tile covers (us_west_coast_socal stops at 38N). Size it against Render memory (F-08).
0. ~~**Regrid at native resolution**~~ FLIPPED by #174 (D-010); verify with the probe and the ledger: every 0.25-deg regional tile of GFS, ICON and EURO is a 2x2
   block mean shifted half a cell NW (`half = max(1, round(res/0.25/2))` = 1; ledger seq 43). Fix: the exact
   native cell at native resolution, one shared `block_half`, behind `REGRID_NATIVE_CELL` (default 0) in the
   ingest lanes; evidence = the parity probe (node vs native cell -> rounding) and the ledger's same-model gap.
   Then: GFS-Wave is ingested 3-hourly (`f_hours = range(0, max_f+1, 3)`) while it is published hourly to
   f120 (Open-Meteo meta: temporal_resolution 3600 s): off-frame hours snap by 1 h.
1. ~~**Accuracy monitor false alarm**~~ merged as #166 (`0b169692`): page on "no scored rows for N hours", not on one zero-score pass
   (LESSONS L-F4).
2. ~~**No shadow model reaches an upstream**~~ merged as #167 (`b16dbb5d`): the wind fallback was ungated, so the armed `CONSENSUS`
   ledger lane would have scored real GFS wind under its name (ledger seq 27-28). Must merge BEFORE arming.
3. ~~**Arm the consensus shadow**~~ merged as #168 (`de72c81c`), 15:30:45Z: `CONSENSUS_INGEST: '1'` in forecast-ingest-pilots.yml,
   forecast-ingest.yml and precompute.yml (+~5% manifest, D-009). Then PR C reads `raw_surf:CONSENSUS`.
3. **Consensus PR C:** evidence for the flip: judge `CONSENSUS_AB`, ledger `by_band`/`by_region`, a before/after
   catalogue sweep of displayed heights. Then the owner's flip.
4. **MOP for California:** needs spot observations for the sheltered spots (Fort Point, Rincon, Leadbetter, Sands).
5. **Big-swell calibration on the served consensus:** quantile mapping by lead and coast, trained on the ledger's
   big-swell rows (every model reads 0.3-0.8 m low on 3 m+ days).
6. **Uncertainty** from the 51-member ECMWF wave ensemble (blocked on pygrib in CI).
7. **Close the public-reference gap** (SCOREBOARD S2: Open-Meteo marine +0.045 to +0.058 m ahead at 24-72 h since
   2026-08-10). Steps 1, 3 and 5 are the planned attack; re-read S2 after each.

## Open, not yet diagnosed
- Supabase 429 bursts on the SERVE box that are not ours: 02:25:58-02:26:24Z hit ~20 12Z-frame waves/swell_1
  products no audit request asked for (a prewarm? a client scrub?). n = 1 (log 2026-09-30-audit-sota §3.5).
- Marine Nightly zoomlab: 12 MULT0 animation frames (2026-09-29) and 15 s API timeouts (2026-09-28). n = 2.
- The live `/spot-ratings` fallback still rates on the global default when its climatology read fails (#162
  residual; failing closed there needs a frontend decision).

## Owner-only
- Arm the nearshore judge hourly (`NEARSHORE_VAL_ENABLED=1`, a repo variable).
- Every served-number flip: the consensus (after PR C) and MOP (after spot checks).
- Unfreeze the production frontend.
- Also open: stale island products in `/products`; the A15-07 Satellite label; band spot-anchoring; real-device
  checks (#85 phone banding, #87 120 Hz wind); F-09 temperature capability rows; A15-11 detach-vs-budget.

## How to measure
```bash
gh workflow run nearshore-validation.yml --ref dev -f backfill_hours=24 -f mop=1 -f mop_grid=1 -f nwps=1 -f consensus=1
gh workflow run science-shadow-ab.yml --ref dev -f candidate="SURF_NEARSHORE_MOP=1"
gh workflow run precompute.yml --ref dev        # also runs the buoy calibration (the skill ledger)
gh workflow run e2e-tests.yml --ref <branch>
```
- The ledger: `https://raw-surf-antigravity.onrender.com/api/weather/buoy-calibration` → `forecast_skill_consensus`.
- Decision lines: `VERDICT`, `GEOMETRY`, `CONSENSUS_AB … SAME_ROWS`, `MEMBER_AB`, `PAIR_AB`, `MOP_AB`,
  `MOP_GRID_AB`, `NWPS_AB`, `TRAINS_AB`, `LEGACY_FRICTION_AB`; the shadow A/B prints `MOP`, `HEIGHT`, `DEPENDENCY`,
  `INFERRED`.
- Never dispatch the judge within ~20 min of a `dev` merge (LESSONS L-O1).
