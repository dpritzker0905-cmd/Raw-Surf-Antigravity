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
