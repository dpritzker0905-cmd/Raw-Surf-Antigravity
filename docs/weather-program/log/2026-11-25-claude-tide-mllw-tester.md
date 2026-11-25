# 2026-11-25 · claude · tide-mllw-tester-v1: the pre-registration (DRAFT)

Append-only. Stamps come from `date -u`.

## 02:19Z: draft gate `gates/tide-mllw-tester-v1.md` (David's decision A; the advisor's binding requirements)

- **Scope:** a datum-only tester for `SURF_TIDE_MLLW_US`.
  - It runs report-only for 14 days on the SHADOW block (`datum_for(..., enabled=True)`), leave-one-out on the
    monitor's own sheet.
  - A PASS opens a `tide-mllw-proposal` issue assigned to the owner and never flips the flag (D-087).
  - Once David re-enables the flag, WORSE (two strikes ≥ 24 h apart) and breaches disable it (D-090), through
    decide().
- **The statistic:** per monitor, the signed MEAN over hourly t of displayed MLLW − NOAA MLLW prediction −
  `mean_level_included_m` (the block's disclosed rise since the epoch). The raw mean is reported.
  - Per window, F is the median over monitors.
  - Bar: |F| ≤ 0.02 m per D-source stratum (MODEL / SHEET).
- **The review (SubQ subq-savant-1.4 and Reflection Beam-1.0, public text only), adopted:**
  - mean, not median, per window;
  - strata by D source, assigned from inputs before any prediction is read;
  - the fleet count rule;
  - WORSE needs both 7-day halves;
  - FLEET BREACH on the full window;
  - a wiring bound on the mean term;
  - 13 planted controls and boundary tests.
  - Null-simulation calibration was NOT adopted (the bars are a priori).
- **Not yet done:**
  - the station freeze (script + frozen JSON, metadata only);
  - the advisor's read of this draft;
  - the code PR (TIDE_DATUM family, the build's monitor keys, the issue/countdown, the tests);
  - the Switch Board panel PR.
