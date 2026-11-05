# 2026-11-05 · claude · SURF_SPECTRAL_K sheltered-scope rework (#727)

Branch `claude/rework-spectral-k-sheltered` from dev df713415 + #706 (`claude/surf-spectral-k` aeadafb, merged in).
One writer: this session. Authority: the lead's rework brief after round 7 (#722); the owner's "Yes" (2026-11-04) to
scoring on GitHub Actions on the draft PRs. Never touched: main, Render, Netlify, env, secrets, the live backend,
Codex's branches. Not merged by this session.

## Session start

- `memory_audit.py --docs-only`: 0 FAIL, 71 WARN, 7 NOTE. The OVERDUE items are live dev-site reads this brief
  forbids (never call the live backend); none touches the nearshore chain.
- This container's egress blocks NDBC, CDIP, Open-Meteo and data.ecmwf.int (AWS S3 is open; ECMWF's AWS bucket
  throttles this IP). Scoring therefore runs on GitHub's runners (`.github/workflows/rework-score.yml`), which the owner
  approved.

## 1. Pre-registration (commit 8dd917c1, before any score)

`flip-candidates/scorecards/rework-2026-11-04/spectral-k-sheltered-preregistration.md`. Sheltered := outside the Bight
polygon AND K's Hs ratio for a 1 m, 14 s, 290-deg reference swell < 0.5. Computed on the committed table before
scoring: Rodeo Beach 0.47, Fort Point 0.26, Pismo Beach Pier 0.45, 285p1 0.36 (nearest misses Steamer Lane 0.53,
Cayucos 0.63). Every Bight entry out by rule 1. The registration stated in advance that only 285p1 would move at a buoy.

## 2. Build

- `spectral_k_serving`: `shelter_ratio`, `is_sheltered` (memoised per entry), `in_scope`; both the spot path and the
  buoy instrument obey it. `SURF_SPECTRAL_K_ALL_SPOTS` ('0' default; '1' = #706's scope; the registry accepts only
  booleans, so the planned string flag `SURF_SPECTRAL_K_SCOPE` became this boolean before the first push).
- Shared scoring tools (identical in #730): `scripts/rework_gate.py` (pooled gate), `rework_window.py` (one window per
  matrix job: eval_backfill prefetch, then the harness in-process), `rework_net.py` (retrying GET, per-station truth
  isolation).
- Tests: `test_spectral_k_sheltered.py` 8 (chain; 5/5 mutations killed: threshold 0.55, Bight rule dropped, buoy scope
  dropped, spot scope dropped, scope default inverted); `test_rework_gate.py` 5 (estate). #706's mechanics tests run at
  the all-spots scope.

## 3. Scoring (Actions run 41939357144, head a9eb3fbf1)

The first run (41938235471) lost W1 to a transient CDIP THREDDS 403 in `stage_truth`; fixed by `rework_net` (7 tries,
backoff; 404 never retried; a station whose truth still fails scores with no items). Windows then took 21-38 min each.

| arm | quantity | moved | days | blocks | gain m | two-way 95% CI | bias ref -> cand | Holm worse | verdict |
|---|---|---|---|---|---|---|---|---|---|
| SURF_SPECTRAL_K=1 (sheltered) | **hs_station** | 168 (285p1) | 14 | 1 | **+0.312** | **[0.218, 0.406]** | +0.431 -> +0.064 | - | **PASS** |
| same | hb_proxy (advisory) | 780 (142p1, 285p1) | 51 | 2 | -0.111 | [-0.559, 0.336] | -0.016 -> -0.191 | W4 | FAIL |
| all-spots (reference) | hs_station | 4,872 | 70 | 3 | +0.034 | [-0.093, 0.161] | -0.275 -> +0.113 | - | FAIL |
| all-spots (reference) | hb_proxy | 4,644 | 70 | 4 | -0.214 | [-0.420, -0.008] | -0.203 -> +0.266 | W4 | FAIL |

Controls on both quantities: null REFUSED, x0.8 PASS, x1.25 FAIL. Full JSON:
`flip-candidates/scorecards/rework-2026-11-04/spectral-k-sheltered-gate-2026-11-05.json`.

**Reading.**
- At Avila the bulk chain reads +0.43 m high (the headland shadow it cannot see); K removes most of it (MAE
  0.433 -> 0.121). Avila's CDIP record covers only W26, so the binding test is exactly the 14-day minimum, one block.
- The advisory hb_proxy is worse at 142p1's Rodeo Beach anchor (-0.233, bias -0.260 -> -0.391). 142p1 (SF Bar) has no
  K entry, so the binding instrument cannot test the Bay spots, and the proxy says K lowers an already-low height there.
  Not rescoped after seeing it (that would be tuning). Flagged for the owner (D-067); a pre-registered central-only
  scope is the next test if the guardrail or a Bay buoy says so.
- The all-spots reference reproduces round 7 (Bight buoys flip from -0.3 m to +0.3 m bias): the diagnosis holds.

## 4. Outcome: ships ON (D-065), per the pre-registered rule

- `runtime_flags.GUARDED["SURF_SPECTRAL_K"] = "1"`; every read goes through `_rf.on` (`spectral_k_serving.enabled`,
  `point_surf_augment`, `eval_replay`); the harness asks for the read-point span whenever the EFFECTIVE value is '1'.
- `_RATING_FLAGS` default '1'; precompute.yml, forecast-ingest.yml and sim-parity-monitor.yml declare `''` (defer to
  the runtime manifest, as SURF_BIGHT_HS_CONSENSUS does). Kill switch: `SURF_SPECTRAL_K=0`.
- SCOREBOARD row 2026-11-05 01:03Z; DECISIONS D-067; ledger `ledger.d/claude--rework-spectral-k-sheltered.jsonl`.
- Served heights move at merge only at Rodeo Beach, Fort Point and Pismo Beach Pier.
