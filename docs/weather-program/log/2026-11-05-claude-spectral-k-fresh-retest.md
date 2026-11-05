# 2026-11-05 · claude · SURF_SPECTRAL_K sheltered scope: fix and fair re-test of #727

Branch `claude/rework-spectral-k-sheltered` (#727's own branch), from head e1f9fdea0. One writer: this session.

**Authority:** the lead's brief, which asked for four things:
- fix the review findings;
- re-test on fresh, pre-registered data with storm-block resampling;
- PASS → ON with a kill switch; FAIL → OFF, recorded;
- never merge, never touch `main`, never deploy, never change env or secrets, never call the live backend.

The owner merges weather PRs himself.

## Session start

- `memory_audit.py --docs-only`: 0 FAIL, 71 WARN, 7 NOTE.
- The OVERDUE items are live dev-site reads, which this brief forbids. None touches this flag.
- This container cannot reach CDIP, NDBC or the Actions artifact store, so scoring runs on GitHub's runners
  (`rework-score.yml`, approved by the owner on 2026-11-04).

## 1. Review findings → fixes

| finding | fix |
|---|---|
| The PR said OFF, but commit 8a63ff3 set `SURF_SPECTRAL_K` to `'1'` (GUARDED, `_RATING_FLAGS`, lanes `''`) on the 2026-11-04 "PASS" | The code half of 8a63ff3 is reverted. Code default `'0'` (`spectral_k_serving.enabled`, `point_surf_augment`, `eval_replay`: plain env reads, as before). Removed from `runtime_flags.GUARDED`. `_RATING_FLAGS` default `'0'`. `'0'` in forecast-ingest, precompute, sim-parity-monitor and spot-series. Tests pin default OFF. |
| SCOREBOARD row, DECISIONS D-067 and the 2026-11-05 log all claimed ON | Corrected in place, by exact-string replacement: these lines were added by this unmerged PR and never shipped. Each entry now points here. |
| CI run 41951077989: forecast-chain lane red | see §2 |

## 2. CI run 41951077989 (chain lane, 2 failed)

Both failures are in `tests/test_spectral_k.py`:
- `test_the_kill_switch_is_byte_identical_and_never_reads_the_read_point`;
- `test_the_default_is_on_and_the_kill_switch_is_byte_identical`.

In both, the kill-switch hash came out `ff55d0e4…` against the pinned `fad3cb8e…`.

**Cause: the test was not hermetic.**
- `SURF_TIDE_DEPTH` is ON by default (D-065), so `augment_with_surf` calls `tide.tide_norm_at`. That reaches
  Open-Meteo whenever the network is open.
- The pin was taken with no tide (η = 0). This container blocks Open-Meteo, so here the tests passed alone and in
  the full local chain lane.
- **Measured here:** a stubbed 1.5 m tide reproduces CI's `ff55d0e4f5d9…` exactly; a −1.0 m tide gives `8a99cca3…`;
  no tide gives `fad3cb8e…`. The bulk chain did not change; the test read live weather.

**Fix: d4bc7c6.** The fixture stubs `tide_norm_at`. It was pushed to this branch at 02:42Z by the PR's original
session (`session_016RofuPzhKERefhSbMffbFY`) while this session was working. It was verified here as above, and this
session's commits were rebased onto it. Nothing in the served chain changes.

**Floors** (`rederive_floor.py`, from dev run 41945407573):

| lane | new tests | floor | must read |
|---|---|---|---|
| chain | `--add 32 --add-files 2`, unchanged by this session | 3650, 209 files | 3656 passed |
| estate | `--add 11` (rework_gate 5 + rework_storm_gate 6) | 3424 → 3430 | 3432 passed |

## 3. Pre-registration (committed before any score of these windows)

The full text is in `flip-candidates/scorecards/rework-2026-11-04/spectral-k-sheltered-retest-preregistration.md`.
In short:

- **Candidate:** the unchanged rule (outside the Bight AND K ratio < 0.5 for a 1 m, 14 s, 290° swell). No retuning.
- **Evaluation set, fixed by geometry:**
  - hs_station at 285p1 (Avila);
  - hb_proxy at 142p1 (Rodeo Beach anchor) and 285p1 (Pismo Beach Pier anchor);
  - Fort Point has no truth station.
- **Fresh windows:**
  - F1 2025-01-15..02-28;
  - F2 2025-11-01..12-15;
  - F3 2026-09-22..10-05. These are Avila's only data outside every earlier window; the buoy was deployed on
    2026-09-21.
- **Gate:** `scripts/rework_storm_gate.py`, protocol `storm-v1`:
  - D-066's spatial blocks × a moving 5-day storm block;
  - t(G − 1) with SE inflated by the lag-1 autocorrelation of block means;
  - ≥ 14 days, else REFUSED.
- **PASS requires all of:**
  - hs_station CI lower bound > 0;
  - hb_proxy pooled not worse;
  - no spot, lead band, height band or season worse after Holm (both quantities);
  - Rodeo hb_proxy not worse, unadjusted;
  - controls behave: identical / ×0.8 / ×1.25 / a sign-flip null ≤ 5%;
  - the synthetic calibration holds.
- **Calibration measured before scoring** (synthetic only, 300 sets, seed 20261105):
  - 14 days, 1 block: binding nulls falsely pass ≤ 2.0%; power 79% (reported only);
  - 45 + 45 + 14 days, 2 blocks: binding nulls ≤ 3.0%; power 96% (binding);
  - the ρ 0.8 advisory nulls are 0.7-6.0%: the stated limit of a 3-5 day block.
- **How the block rule was chosen, all on synthetic data before scoring:**
  - with a moving block alone, at L = 3, 4 and 5, ρ 0.8 nulls falsely passed 7.5-17% over 45-day runs;
  - at L = 5 the moving block alone still let ρ 0.6 through at 7%. Adding the r₁ inflation fixed that;
  - a block-constant sign-flip null then falsely passed 10.5%. Taking the larger of the moving and non-overlapping
    SEs fixed that (4.0% on the test panel at L = 5);
  - L = 4 reached 83% power at 14 days but falsely passed 5.7%; L = 3 up to 7.3%. L = 5 was kept.

## 4. Result (Actions run 41958242376, head 9c4e3c14, gate job 127043248151)

**Runs:**
- Windows: F1 68 min, F2 72 min, F3 19 min. Harness controls were ok in each.
- CI on the same head (run 41958242418) was 12/12 green:
  - chain lane collected 3656 tests (3655 passed, plus the 1 skip that was already there);
  - estate lane passed 3432.
- JSON: `flip-candidates/scorecards/rework-2026-11-04/spectral-k-sheltered-retest-gate-2026-11-05.json`.

**Pooled results:**

| quantity | stations moved | n | days | storm blocks | gain m | 95% CI | p worse | bias ref → cand | MAE ref → cand |
|---|---|---|---|---|---|---|---|---|---|
| hs_station | 285p1 | 168 | 14 | 3 | **+0.354** | [0.096, 0.613] | 0.986 | +0.472 → +0.057 | 0.472 → 0.118 |
| hb_proxy | 142p1, 285p1 | 1284 | 104 | 21 | −0.132 | [−0.932, 0.669] | 0.368 | −0.052 → −0.150 | 0.390 → 0.521 |

**hb_proxy by stratum:**

| stratum | gain m | 95% CI | p worse | worse after Holm? |
|---|---|---|---|---|
| **Rodeo, spot 142p1** (n 1116, 93 days) | **−0.195** | [−0.263, −0.127] | 5e-6 | yes |
| Pismo, spot 285p1 (n 168) | +0.289 | [−0.183, 0.761] | 0.94 | no |
| season F1 | −0.239 | [−0.362, −0.115] | | yes |
| season F2 | −0.162 | [−0.231, −0.092] | | yes |
| season F3 | +0.233 | [−0.572, 1.037] | | no |
| band obs ≥ 2 m | −0.231 | [−0.291, −0.172] | | yes |

- Rodeo bias went −0.195 → −0.264 and MAE 0.314 → 0.509.
- Every hs_station stratum (each lead, each band, F3) is positive.

**Controls:**
- hs_station: identical REFUSED, ×0.8 PASS, ×1.25 FAIL, **sign-flip null 14.5% (limit 5%) → controls FAILED**.
- hb_proxy: ×0.8 and ×1.25 were INCONCLUSIVE, because the pooled hb interval spans two blocks of opposite sign.
- The synthetic calibration held: ok, binding false pass ≤ 3.0%.

**Verdict (pre-registered rule): INVALID.** A control failed, so `SURF_SPECTRAL_K` stays `'0'`. It is not a near
miss:
- with the controls set aside, rules 2-4 fail on their own (Holm-worse strata; Rodeo p_worse 5e-6);
- so under no reading is this a PASS.

**What it says:**
- **Buoy half:** at Avila, K's buoy-depth Hs removes most of the bulk chain's +0.47 m high bias again, on 14 days it
  had never seen. That is still one station, one block and 3 storm blocks.
- **Spot half:** at the Rodeo Beach anchor K lowers a breaking height that already reads low. This happens in both
  fresh winters and in big surf. The harm round 1 called "advisory" is real.

**Not done, on purpose:**
- no rescoping to "Avila / Pismo only" after seeing this, and no re-scoring;
- no change to the bar or the controls after the result.

**Lesson (D-068):** the sign-flip control was ill-posed at 3 storm blocks (8 sign patterns). A future protocol must
set a minimum block count for it before scoring.

**Recorded:** DECISIONS D-068, and ledger `ledger.d/claude--rework-spectral-k-sheltered.jsonl`. There is no
SCOREBOARD row, because no served number changes.

## 5. Follow-up diagnostic: why Rodeo is worse (owner: "lets accomplish 1")

Two hypotheses were tested; both are now settled.

**Double-counting of shelter: ruled out by reading the code.** When K supplies the sea (`nearshore=`),
`mop_nearshore.estimate_surf_from_nearshore` removes shelf friction, the swell-angle exposure, the refraction constant
and the magnet factor. Only shoaling, Komar breaking and the depth cap remain.

**A proxy that can't see the shelter: ruled out by measurement.**
- Tool: `scripts/rodeo_diagnostic.py`, with its reading rule in the docstring, committed before its first run.
- Run: `.github/workflows/rodeo-diagnostic.yml`, Actions run 41968988006, reading the window artifacts of run
  41958242376.
- Method: each Rodeo pair is binned by K's own single-train shelter ratio at its forecast Tp and direction.

| 142p1 / Rodeo bin | n | gain m | storm-block CI | bias served → K | K/served median |
|---|---|---|---|---|---|
| all | 1116 | −0.195 | [−0.263, −0.127] | −0.195 → −0.264 | 0.94 |
| shadowed < 0.6 | 176 | −0.204 | [−0.227, −0.180] | −0.395 → −0.612 | 0.87 |
| partial 0.6-0.8 | 790 | −0.159 | [−0.206, −0.112] | −0.195 → −0.328 | 0.94 |
| exposed ≥ 0.8 | 150 | −0.373 | [−0.404, −0.342] | +0.038 → +0.479 | 1.16 |
| direction < 250° | 88 | −0.451 | (1 block) | +0.115 → +0.524 | 1.12 |
| obs ≥ 2 m | 300 | −0.306 | [−0.369, −0.242] | −0.395 → −0.393 | 0.95 |

**Reading, by the stated rule: K-PATH DEFECT (b).**
- The exposed pairs are worse too. There K over-reads by about +0.48 m against a near-zero served bias.
- A proxy blind to the shadow can only make K look too LOW. It cannot produce this.
- Across the bins, K's error tracks K's own directional contrast: too high where exposed, too low where shadowed.
  K is more direction-selective at Rodeo than the observations are.
- Likely causes (not yet tested):
  - the spectrum rebuilt from three GFS partitions, with an assumed spread (`spectral_k.SPREAD_S`);
  - the distant Bay read point (37.25 N 123.50 W).
- Pismo (285p1): K better in every bin. INCONCLUSIVE by the rule: 14 days, wide CI.

**Caveats:**
- The bins split by forecast state, so their CIs are descriptive, not a test.
- Bins drawn from few, scattered storm blocks show degenerate intervals, e.g. [−0.451, −0.451]. Those are not
  evidence.

**Implication.** Re-scoping K (dropping Rodeo) would hide the defect. The targeted next step is item 3 of the plan:
feed K a measured directional spectrum (spread and direction) instead of the partition rebuild. A cheap offline
pre-check comes first: how Rodeo's K ratio moves with the assumed spread s.

## 6. Item 2 (a regional bias correction): stopped at stage A, not built

The owner approved stages A-C, with a stop after any stage that fails. Stage A was answered from committed data, at
no cost: `flip-candidates/scorecards/round7/history-gate-2026-11-04.json`, the BHC arms scored with an EURO input
substitution.

**Inside the Bight, BHC already removes the offset a correction would target:**

| quantity (Bight) | before BHC | after BHC (w 0.5, production) | EURO weight 1.0 (a stronger push) |
|---|---|---|---|
| hs_station bias | −0.353 m | −0.168 m | — |
| hs_offshore bias | −0.36 m | −0.159 m | +0.041 m |
| hb_proxy bias | −0.322 m | +0.040 m | +0.371 m |
| hs_offshore gain | — | +0.155 m | +0.136 m |

The stronger push removed nearly all the remaining offshore bias but did not reduce error, and it pushed breaking
heights high. What remains is scatter, not an offset.

**Outside the Bight, the station set cannot support a correction.** It has only two CDIP buoys, with opposite signs:
142p1 hs_station −0.395 m, 285p1 +0.472 m (headland-sheltered). One regional constant cannot fit both; two points
cannot fit a per-site model.

**The replay cannot see BHC** (no EURO archive: `eval_replay` marks it inert). A correction fitted on replay data
would double-correct the Bight in production.

**Decision:** item 2 is not pre-registered, built or scored. No PR was opened; nothing runs. Revisit only with more
outside-Bight truth stations, or once K's input defect (§5) is fixed.

## 7. Outside check (literature via Consensus; Solano shelter ray-cast), before item 3

**Correction to §6.** I wrote that what remains after BHC is scatter, and that a correction cannot remove scatter.
The second half is wrong for conditional post-processing:
- buoy-trained models that condition on wind, sea state and lead cut Hs MAE or RMSE by 10-40%, peaks and timing
  included (Zhang 2023, Ocean Modelling; Filoche 2026, JGR-MLC; Campos 2017; Gallo 2023);
- they need years of paired data (3.5 years site-specific in Filoche);
- their corrections do not transfer beyond the buoy's surroundings (Callea 2025, Applied Ocean Research).

§6's decision stands for what was proposed, a regional constant. A multi-year, site-specific conditional correction
at buoy-adjacent spots is a valid future candidate, but it does not help the ~1,700 spots that have no buoy.

**Item 3 is supported by the literature:**
- on sheltered shorelines, nearshore prediction error is dominated by directional uncertainty offshore (Crosby et al.
  2016, JTECH: ray-traced swell, 16 Southern California buoys);
- full directional spectra vs parametric inputs change nearshore energy by 40-55% at sheltered beaches (Silva et al.
  2020, JCR);
- narrow incident spectra make refraction transforms hypersensitive (O'Reilly et al. 1991, 1993);
- pure refraction is inaccurate at HIGHLY sheltered sites, where diffraction matters (O'Reilly 1993). That is a
  caution for Fort Point (ratio 0.26) even with perfect input;
- SW swell ultra-refracts over the SF ebb-tidal delta (Hanes et al. 2013), which is relevant to Rodeo's SW
  over-read.

**Solano ray-cast at Rodeo (37.832, −122.545), line of sight only, no refraction:**
- swell exposed from 150-290°, blocked from 300-140°;
- this agrees with K's geometry: 290° sits at the edge (K ratio 0.47), and NW is blocked;
- so K's shadow geometry is not grossly wrong. What remains open is the magnitude driven by the input spectrum.

## 8. CDIP MOP reference at Rodeo / Pismo: the GFS input is the defect (Actions run 41970891049)

- **Tool:** `scripts/mop_reference_diagnostic.py`. Its reading rule is in the docstring, committed before the first run.
- **Method:** CDIP's buoy-driven MOP hindcast (to 2025-04-01) and nowcast (after it), at the spot's own MOP point,
  run through the chain's own breaking step (`estimate_surf_from_nearshore`). The only difference from the K arm is
  the input spectrum.
- No flag was changed. `SURF_NEARSHORE_MOP` stays OFF.

**Rodeo (MA053, 1116 pairs, all with a reference):**

| bin | served − MOP | K − MOP | proxy − MOP | MAE vs MOP: served / K |
|---|---|---|---|---|
| all | −0.162 | −0.231 | +0.033 | 0.290 / 0.414 |
| shadowed < 0.6 | −0.108 | −0.325 | +0.287 | 0.282 / 0.392 |
| partial | −0.167 | −0.300 | +0.027 | 0.290 / 0.400 |
| exposed ≥ 0.8 | −0.195 | +0.245 | −0.234 | 0.300 / 0.517 |

**Reading, by the stated rule: GFS INPUT DEFECT.**
- Against CDIP's own reference, K is high where exposed and low where shadowed, and its MAE is worse than served.
- The proxy is ALSO shadow-blind (+0.29 m above MOP in the shadow), but K's error goes the other way. Rodeo's verdict
  stands on two independent references.

**Pismo (SL093, 168 pairs, nowcast only):** INCONCLUSIVE by the rule (< 200 pairs). For the record, K's MAE vs MOP is
0.19 against served 0.27.

**Path toward state of the art:** CDIP publishes its ECMWF-driven MOP forecast at every spot (`<label>_ecmwf_fc.nc`).
That is the operational system (O'Reilly et al. 2016; Behrens et al. 2024), and `SURF_NEARSHORE_MOP` is its built,
dark path.
- Its historical forecasts are not archived, so it cannot be scored on history like K was.
- The honest test is forward: archive `ecmwf_fc` at the catalogue spots each cycle, then score it after ≥ 14 days
  with the storm-block gate, against CDIP buoys and the MOP nowcast.
- Turning it on is the owner's call, on that evidence.
