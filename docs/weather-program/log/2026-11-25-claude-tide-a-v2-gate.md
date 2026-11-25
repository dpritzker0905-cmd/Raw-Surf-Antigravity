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

## 00:21Z: gate amendment 1 (PRE-DATA), after the advisor's HOLD on #1296 at `b193da863`

- **The advisor verified** v1's incorporation, the selector, the station set reproduced IDENTICALLY (`829af882…`), 0
  overlaps, the stamps before data, the disjoint half-open windows, and C2 and the pre-flight as ruled.
- **The one flaw:** C5's P1 (phase negation) can PASS C2 at a station whose M2 phase is near 0° or 180°, and so VOID a
  sound run.
- **Gate §11:**
  - P1 becomes +90° added to every phase_GMT;
  - P2 (×100) is kept;
  - P3 (a +60 min time shift) is added;
  - C5 stays VOID-only;
  - the pre-flight's sign-flip plant stays, with its ≥ 95 % threshold.

## 00:29Z: the v2 instrument PR, with gate §12 (amendment 2, PRE-DATA)

- **#1296** has PASS-WITH-LIMITS at `627155af3`. Its binding limit L1: a +90° P1 moves M2 events about 3.1 h, beyond
  `match_events`' 3 h window. So at M2-dominated stations P1 matches NOTHING, and C2 reads "untestable".
- **Gate §12 (stamped 00:25Z):** a planted break FAILS C2 iff C2's status is not PASS (a mismatch, or untestable).
  It is pinned by a test on an M2-only station, where the +90° break gives 0 matched events and counts as FAIL.
- **The code:**
  - `a_harcon_v2.py`: the fixed bars (0.05 m, 10 min) copied from the gate text; the half-open windows; the 6-min
    identity (`events_rows_fine` keeps the minutes); the plants; `c2_status`, `plant_fails`, `preflight_verdict`,
    `c5_verdict`; and the minors diagnostic (reported only, "unavailable" when pyTMD lacks the call).
  - `a_harcon_v2_preflight.py`: identities and four plants only, no candidate arm (pinned).
  - `a_harcon_v2_preflight_ok.py`: refuses the v2 run without a committed pre-flight PASS that recomputes from its
    own records.
  - The instrument gains `--c2-grid-min 6` and `--c5`; v1's defaults are unchanged.
  - The scorer gains `--v2` (the fixed bars; C5 with the tested mismatches, before measurability).
  - The workflow is `tide-a-harcon-v2.yml`: numbered pre-flight and v2 tags only. The pre-flight installs no PyFES.
- **Tests:** `tests/test_a_harcon_v2.py`, 21 (chain lane; fragment +21, +1 file). The tide suites give 124 passed,
  twice.
- **Smoke test** on a SEEN station over a PAST window, no gate data read:
  - NOAA's own 6-min curve through the fine path gives 11 of 11 matched, median 0.004 m and 1.0 min;
  - a +60 min plant gives a mismatch, so the plant fails.
  - pyTMD is not installed locally, so `harcon_eval` itself runs only in CI.
- **Not done:** the pre-flight tag (David's word), committing its result, then the v2 tag (David's word).

## 01:54Z: §13, amendment 3 (PRE-DATA): constants the pinned pyTMD cannot synthesise

- **Trigger:** pre-flight 1 (run 45519746500) was NO RUN (#1301). pyTMD 3.1.0 raised `Unsupported constituent: mln2`.
- **The advisor's ruling, relayed by the director:** skip the station or donor, never drop constituents.
  - An unsupported donor counts as "no usable constants" (v1's replacement cause, same cap).
  - An unsupported scored station is replaced within the cap.
  - An unsupported pre-flight station is NOT TESTED and listed; the ≥ 300 floor binds.
  - The stop rule: two consecutive `no_run_unknown` runs mean stop.
- **Pre-data scan, inputs only** (`a_harcon_v2_unsupported_scan.py` under `paced_run.py`): 478 `harcon.json` reads,
  run locally with the pinned pyTMD 3.1.0 (a scratch venv).
  - Candidates 60/60 OK; prefix donors 59/59 OK; pre-flight 382/383 OK.
  - The one unsupported station is 9455920, ANCHORAGE, Knik Arm (the station pre-flight 1 crashed on).
  - Output: `research/tide-a-harcon-v2-unsupported.json`, sha256 `850a02cd…ff887978` (the committed LF bytes; the CRLF file the scan wrote on Windows hashed `00065605…eb86e348`).
  - No synthesised value was kept, and no prediction, water level or window data was read.
- **Next:** the instrument PR that implements §13 (its own gate), then pre-flight 2 on David's typed word.

## 02:02Z: the §13 instrument (its own PR, stacked on the §13 amendment)

- **`a_harcon_v2.synth_ok(hc, synth)`:** (ok, error) for the verbatim synthesis at 2000-01-01. "Cannot synthesise"
  means exactly that it raises; the constants are never altered.
- **Pre-flight:** before any truth is read, a station whose synthesis raises becomes `{"c2": "not_tested", ...}`.
  - `preflight_verdict` lists `not_tested`; the station is never a record, and the ≥ 300 floor binds.
- **Run (v2 only, `--c2-grid-min 6`):**
  - an unsupported donor's constants read as none, i.e. "donor has no constants" (v1's replacement cause, same cap);
  - an unsupported scored station gets `unsupported_constants`. The scorer's `resolve` replaces it with the cause "own
    constants cannot be synthesised (v2 §13)", within the cap;
  - the run JSON lists every unsupported id.
  - v1 (grid 60) is unchanged.
- **Tests:** +6 in `test_a_harcon_v2.py` (chain lane; 49 passed twice with `test_a_harcon_instrument.py`).

## 02:22Z: the §13 scan's request log (the advisor's limit on #1304)

- **Committed:** the scan's own `paced_run` request audit, byte-identical, as
  `research/tide-a-harcon-v2-unsupported-requests.jsonl`. The committed LF bytes hash sha256
  `7ab060910b8dd5fc4023ac8957833fdefde6ea205a0fa742be5bd2d9c91aa630`. The file as written on Windows had CRLF line
  endings and hashed `ab8cec4d…6e67efb5`; the content is identical.
- **What it shows:** 478 requests, ALL to `/mdapi/prod/webapi/stations/<id>/harcon.json`, one per station, all HTTP
  200. There was no `datagetter` call, so no prediction, water level or window data was read. That is the proof the
  scan read harcon constants only.
