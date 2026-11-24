# 2026-11-24 · claude · tide-a-harcon-v1-2: VOID (a tested C2 identity mismatch)

Append-only. Stamps come from `date -u`.

## 23:11Z: run 45504466320, tag `tide-a-harcon-v1-2` on `bd6fc24c9`

- **Dispatch:** the director pushed the tag at 22:49:18Z on David's typed word (dialog at about 22:49Z). David also
  adopted the R1 no-outcome rule. This is the ONE registered re-run allowed by the advisor's ruling that v1-1 was NO
  RUN (infra). The head is #1285 with amendment 3 (the paced, fail-closed CO-OPS access) plus the advisor's L2.
- **The run:** download 22:50:57–22:52:07Z; gate 22:52:29–23:08:40Z. Every step succeeded: C1, the instrument,
  the scorer, Outcome and the upload.
- **The pacing worked:** 447 CO-OPS requests, all 200, no infrastructure class, every request on its first attempt.
- **The artifact was downloaded ONCE** (23:10Z). `outcome.json`: `{"status": "scored", "verdict": "VOID"}`.

### Verdict: VOID

Under the gate's precedence (amendment 1 / §11):
1. **C1 (the finder) PASSED.** It found 50 rows, with none over the bar and none missing.
2. **C2 (the own-constants identity) had TESTED MISMATCHES**, which are VOID anywhere:
   - 31 of 80 tested records failed (13 donors used, 18 scored stations).
   - **22 failed on time only.** Their median |t| was 2.15–4.7 min against the 2.0 min bar, with height within
     0.01 m.
   - **9 failed on height.** Their median |h| was 0.011–0.029 m against 0.01 m; the largest was 8410834 at 0.0287 m.
   - Across all 80 tested records: median |h| 0.0044 m, median |t| 1.67 min.
3. **C3 (the blend identities) PASSED.** **C4 (leave-one-out) PASSED.**
4. **Measurability, reported:** it would have FAILED in HARBOR_BAY on its own (n = 17 < 19, and a harcon matching loss
   at 8773767). OPEN_COAST had n = 19. Tested mismatches come first, so the verdict is VOID.
   - Replacements: none.
   - Near twins: 8570280 (Ocean City), donor 8570283 at 0.752 km, w = 1.

**What it says:** the instrument, not the candidate, failed. The own-constants synthesis (pyTMD with the GOT nodal
corrections, no inferred minors, plus NOAA's SA/SSA/M1/M3/S1 convention), run through the served finder on an hourly
series, does not reproduce NOAA's High/Low within 2 min and 0.01 m at those records. For comparison, C1's finder rows
(on NOAA's OWN hourly curve) had time medians of 0.4–4 min. So the 2.0 min C2 time bar sits at or below the hourly
finder's own resolution for about a third of the records. That is a diagnosis for the advisor, not a ruling.

### Reported only (the verdict is VOID; these decide nothing)

These are tidal-band numbers over the n stations MEASURED under fes.

| Stratum | n | P90_h fes → harcon (m) | P90_t fes → harcon (min) | wins h / t | worse |
|---|---|---|---|---|---|
| HARBOR_BAY | 17 | 0.3276 → 0.2442 | 102.7 → 75.2 | 8 / 12 | 5 |
| OPEN_COAST | 19 | 1.2759 → 0.4257 | 96.4 → 59.8 | 10 / 11 | 6 |

- **Event-level p90, tidal band:**
  - HARBOR_BAY: fes 0.3167 m / 100.9 min (866 events); harcon 0.1378 m / 75.3 min (921 events).
  - OPEN_COAST: fes 0.9728 m / 97.5 min (993 events); harcon 0.3746 m / 70.5 min (988 events).
  - The signed medians are within ±0.0023 m.
- **Raw band** (seasonal included):
  - HARBOR_BAY: P90_h 0.3276 → 0.2442 m, P90_t 102.7 → 75.2 min.
  - OPEN_COAST: P90_h 1.2725 → 0.4257 m, P90_t 96.4 → 59.5 min.
- **Donors:** 40 used. Distance min 0.752 km, median 8.36 km, max 24.87 km. w = 1 at 23 stations; blended at 17.
- **The MLLW-retest forecast** (HARBOR_BAY stations with per-event p90 ≤ 0.08 m): fes 8, harcon 11, out of 20.

### Evidence (research/, this commit)

- `tide-a-harcon-v1-2-score-45504466320.json` (sha256 `48c5c5c4…`)
- `tide-a-harcon-v1-2-outcome-45504466320.json` (`66decb5d…`)
- `tide-a-harcon-v1-2-run-45504466320.json` (sha256 `d108ba74…`, 2.9 MB, committed raw so the record outlives the artifact)
- `tide-a-harcon-v1-2-finder-45504466320.json` (`e94ba13e…`)
- `tide-a-harcon-v1-2-coops-requests-45504466320.jsonl` (`1861b0ee…`)

The workflow artifact `tide-a-harcon-v1` is retained
for 30 days.

### No re-run

The gate allows no re-run, and v1-2 was the one registered re-run. #1149 (the MLLW display) stays a DRAFT with
SURF_TIDE_MLLW_US held at '0'. SURF_TIDE_A_HARCON stays OFF. What follows (a gate v2 with a C2 identity that fits the
hourly finder's resolution, or otherwise) is the advisor's and David's call.
