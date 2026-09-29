# Weather program: state

**Updated 2026-09-29 15:05Z** (log: `log/2026-09-29-consensus-and-ops.md`; every action: `ACTIONS.jsonl`). Verify live before acting: this file
is a claim, not a measurement.

## Now
- **`dev` = `f080ad90`** (#165 at 14:59:05Z, after #166 `0b169692` at 14:58:11Z). The Render backend auto-deploys
  from `dev`. The production frontend is frozen at `fc140024` (D-002).
- **Open PRs of ours:** the upstream-gate PR (no shadow model reaches an upstream, on any domain). The arming change
  is prepared on branch `claude/arm-consensus-shadow`, unpushed, waiting for the owner.
  Codex drafts #15 #22 #23 #27 #43 #44 are not ours; leave them.
- **Live science:** one forecast composition (`surf_point.resolve_surf_geometry` + `estimate_surf_at` →
  `surf_rating.compute_surf_rating`); #146 cross-shelf friction off + cap-seam repair; #120 refraction Kr 0.873;
  per-spot size references (`RATING_LOCAL_SIZE=1`), now fail-closed in the precompute (#162).
- **Built but dark:** the consensus SHADOW at ingest (#164: model `CONSENSUS`, `CONSENSUS_INGEST` '0' in all three
  lanes; one switch builds it and adds the `raw_surf:CONSENSUS` ledger lane); MOP nearshore
  (`SURF_NEARSHORE_MOP`, graded, flip waits on spot observations).
- **Armed switches:** the workflow-dispatch fallback (#153), armed 2026-09-29 13:30Z. It dispatches a data lane's
  workflow when GitHub drops its cron slot. Audit it at `/api/health` → `scheduler.workflow_dispatch.last`. Kill:
  `WORKFLOW_DISPATCH=0`.
  ⚠️ **Its dispatches fail with HTTP 403 (13:46Z)**: the token reads Actions but cannot write them. Owner: give the
  token **Actions: Read and write** (same token value; no Render change). Durable record: Render log `[workflow-dispatch]`.
- **CI floors on `dev`:** guards 174 files / 2110 (reading 2116), chain 130 / 1531 (1537), estate 568 (570).
- **Accountability:** every state-changing action is a line of `ACTIONS.jsonl` (BRAIN_RULES §23), hash-chained and
  verified in CI (`weather-program-ledger.yml`). The anchor below moves with every STATE update:
  **Ledger head: seq 28, sha256 1128856c8277e2a0eb2a38a593f96d67e2fe8d4e3dc99acd206a0b6b3bd1f7f6**

## Next fixes, in order
1. ~~**Accuracy monitor false alarm**~~ merged as #166 (`0b169692`): page on "no scored rows for N hours", not on one zero-score pass
   (LESSONS L-F4).
2. **No shadow model reaches an upstream (open PR):** the wind fallback was ungated, so the armed `CONSENSUS`
   ledger lane would have scored real GFS wind under its name (ledger seq 27-28). Must merge BEFORE arming.
3. **Arm the consensus shadow (owner's word):** `CONSENSUS_INGEST: '1'` in forecast-ingest-pilots.yml,
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
