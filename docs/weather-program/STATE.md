# Weather program: state

**Updated 2026-09-29 23:07Z** (logs: `log/2026-09-29-consensus-and-ops.md`, `log/2026-09-29-sim-works-plan.md`; every action: `ACTIONS.jsonl`). Verify live before acting: this file
is a claim, not a measurement.

## Now
- **HANDOFF for a fresh context: `HANDOFF-2026-09-29.md`** (reading order, what is live or dark, open
  commitments, next fixes, owner-only items, the day's report audit). Read it after this file.
- **`dev` = `132ef9bc`** (#180 at 23:04:57Z; docs only, the backend still runs `cdd5cc7c`, #179). The Render backend auto-deploys from `dev`. The production frontend is frozen at `fc140024` (D-002).
- **Open PRs of ours:** #181 (the second audit and the plan of action W-00..W-50,
  `log/2026-09-29-sim-works-plan.md`; docs only).
- **The weather sim does not reach production map users** (#181 F1): `fc140024` is 3,283 commits behind `dev` and its
  map reads a Netlify Open-Meteo proxy. The plan's Phase 1 is the release-readiness evidence for D-002.
- **Open commitments:** `python backend/scripts/action_ledger.py open` (seq 78, 79, 86, 94).
- **Live science:** one forecast composition (`surf_point.resolve_surf_geometry` + `estimate_surf_at` →
  `surf_rating.compute_surf_rating`); #146 cross-shelf friction off + cap-seam repair; #120 refraction Kr 0.873;
  per-spot size references (`RATING_LOCAL_SIZE=1`), now fail-closed in the precompute (#162).
- **BUILT, DARK (#175):** `CONSENSUS_SERVE` (consensus_serve.ServedStore; D-009's one switch). Flip on the
  shadow's evidence: forecast-ingest.yml + precompute.yml + the live env together.
- **FLIPPED 2026-09-29 (#174, D-010):** `REGRID_NATIVE_CELL` '1': regional wave tiles read their exact native
  cell (land nodes their centred 3x3). Effective per lane at its next ingest. Measure: the parity probe
  (node vs native 0.045 m before) and the ledger's same-model gap (S2 NCEP line).
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
- **CI floors on `dev`:** guards 174 files / 2110 (reading 2116), chain 130 / 1531 (1537), estate 568 (570).
- **Accountability:** every state-changing action is a line of `ACTIONS.jsonl` (BRAIN_RULES §23), hash-chained and
  verified in CI (`weather-program-ledger.yml`). The anchor below moves with every STATE update:
  **Ledger head: seq 103, sha256 b8f49066bdc44d70bf44dec66101375b60de8431b952135c7fa2d62a2bb5a786**

## Next fixes, in order
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
