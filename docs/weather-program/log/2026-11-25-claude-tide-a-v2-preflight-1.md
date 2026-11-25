# 2026-11-25 · claude · tide-a-harcon-v2 pre-flight 1: NO RUN (the instrument crashed; no output)

Append-only. Stamps come from `date -u`.

## 01:17Z: run 45519746500, tag `tide-a-harcon-v2-preflight-1` on `9c1bb8a54` (#1298 head)

- **Dispatch:** the director pushed the tag at 00:39:17Z on David's typed word ("Yes, run pre-flight"). Gate
  `gates/tide-a-harcon-v2.md` §6 (the outcome-blind pre-flight: 383 seen stations, window [2027-07-01, 2027-07-15),
  own-constants identities plus the four planted breaks only, no candidate arm).
- **The run:** job `preflight` 00:40:07–01:15:25Z. The pre-flight step FAILED (exit 1); the Outcome (R2) step and the
  upload succeeded. `download` and `gate` were skipped (pre-flight tags run only the pre-flight).
- **The artifact was downloaded ONCE** (01:15Z), `tide-a-harcon-v2-preflight`. It holds NO pre-flight JSON:
  - `outcome.json`: `{"status": "no_run_unknown", "step": "pre-flight (a timeout or a crash before its output)"}`,
    committed byte-identical as `research/tide-a-harcon-v2-preflight-outcome-45519746500.json`
    (sha256 `6920933624c3cbe73ddb01b742adb6db1721172f0e16fb1ad0e8580e36a30451`);
  - `coops_requests.jsonl`: 1041 CO-OPS requests, ALL 200, every one on its first attempt; committed byte-identical
    as `research/tide-a-harcon-v2-preflight-coops-requests-45519746500.jsonl`
    (sha256 `572b7cb0b4729caa4f8c003d546c64ab9ec5b6ace77cef3f3c19eff149798811`).
- **There is no `research/tide-a-harcon-v2-preflight-result.json`:** the run wrote none, so none is committed, and
  `a_harcon_v2_preflight_ok.py` still refuses a v2 run (it needs a committed PASS).

### Verdict: NO RUN (R1). Not a PASS, not a FAIL.

- **Cause (the failed step's log, read once):** the candidate's own synthesis, `tide_fes/arms.harcon_eval` →
  pyTMD `predict(..., corrections="GOT")`, raised `ValueError: Unsupported constituent: mln2` (pyTMD's
  `constituents.coefficients_table` has no MLN2). A pre-flight station's CO-OPS harmonic constants include MLN2, and
  the synthesis does not drop constituents pyTMD cannot evaluate. The crash came right after station 9455920's three
  requests (the audit's last rows), i.e. inside `V2.c2_rows` for that station, before any JSON was written.
- **R1:** no score from a complete run JSON exists, and no outcome-bearing quantity was printed or uploaded (the log
  holds the traceback only; no count, median, status or plant result). So this is NO RUN, and nothing from it is a
  result.
- **Pacing:** clean (1041 requests, all 200, no infrastructure class).

### What this does NOT do

- **No re-run, no retuning, no fix in this PR.** The gate's pre-flight is one shot on David's word, and a new run (or an
  instrument fix) needs the advisor's ruling and David's word. The record only.
- **A finding for that ruling (not acted on):** the same synthesis serves the candidate arm. Any station whose
  constants carry a constituent pyTMD lacks (MLN2 seen here) would crash a v2 run in the same place, and the served
  `SURF_TIDE_A_HARCON` build path should be checked for the same failure. `SURF_TIDE_A_HARCON` stays OFF;
  `SURF_TIDE_MLLW_US` stays OFF; #1149 stays DRAFT.
