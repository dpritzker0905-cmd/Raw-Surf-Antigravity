# 2026-11-25 · claude · tide-a-harcon-v2 pre-registered (before any v2 data)

Append-only. Stamps come from `date -u`.

## 00:17Z: the v2 gate, with the fresh stations, the exclusion set and the pre-flight set frozen

- **Why:** v1 is CLOSED as VOID (run 45504466320; the advisor's independent re-score). David chose "New test v2"
  (dialog at about 23:2xZ, relayed by the director).
- **Gate:** `gates/tide-a-harcon-v2.md`.
  - The candidate, metric, bar, measurability, precedence, C1, C3, C4, pacing, R1, R2 and the one-run rule are
    VERBATIM from v1.
  - **C2** is a pipeline-break detector: the candidate's own synthesis, verbatim, on a 6-min grid, with FIXED a-priori
    bars of 0.05 m and 10 min, justified by break sizes. The asymmetry is disclosed.
  - **C5** (phase negation and ×100 at every scored station) is VOID-only.
  - **The pre-flight** runs on 383 seen stations over [2027-07-01, 2027-07-15): own-constants identities plus four
    planted breaks only. PASS needs ≥ 300 tested, ≤ 1 % over the bars, and each break failing at ≥ 95 %; else STOP.
  - **The v2 window** is [2027-07-15, 2027-07-29).
- **The advisor's rulings on C2** (three, the last binding) are recorded in the gate's §1, §6 and §10. SubQ and
  Reflection reviewed the first draft.
- **Frozen** (script `scripts/tide_datum/a_harcon_v2_select.py`, v1's rule with seed 20261127):
  - `research/tide-a-harcon-v2-excluded.json`: 490 ids, sha256 `533dad64…`;
  - `research/tide-a-harcon-v2-preflight-set.json`: 383, sha256 `485ecd18…`;
  - `research/tide-a-harcon-v2-stations.json`: sha256 `829af882…`, frozen 00:17Z. It has 20 + 10 per stratum out of
    708 eligible, with 0 overlap with the exclusion set.
- **Not done:** the instrument PR (6-min C2, C5, the pre-flight script, the window and identities-only tests, and the
  tag-gated workflows). Then two tags, each on David's typed word: the pre-flight, then v2.
