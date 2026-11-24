# 2026-11-24 · claude · tide-a-harcon-v1 instrument (step 3 of 4, part 1)

Append-only. Stamps come from `date -u`.

## 21:44Z: the A instrument, its scorer and the tag-only workflow, before any data

- **Gate:** `gates/tide-a-harcon-v1.md`, with its PRE-DATA provenance note. #1273's L1: use the vendored inputs;
  vendor `match` and `finder_check` verbatim; predictions only.
- **Vendored verbatim from #1171's head `1d92f7564`:**
  - `scripts/tide_datum/a_harcon_vendor.py`: `noaa_seasonal_harcon`, `remove_seasonal`, `match_events`, `p90` and
    `match`, cut by function from `git show`, so they are byte-identical (sha256 `5898192090e9…`);
  - `scripts/tide_datum/finder_check.py`: the whole file (sha256 `274899005f0e…`, equal to the blob).
  - A test pins both hashes.
- **The instrument, `a_harcon_parity.py`:**
  - the fes arm (FES2022b with long-period equilibrium; tidal band without Sa/Ssa);
  - the leave-one-out donor prefix: every other type-R station within d < 25 km, nearest first, up to the first
    non-candidate. The scorer's donor is always in that prefix;
  - the blend with w(d), using the same function as C3;
  - truth: NOAA High/Low with `datum=MSL`, with each side centred on its own window mean (NOAA by its hourly curve);
  - C2 at every candidate and every donor in the prefix; C3 at w = 0 and w = 1.
- **The scorer, `a_harcon_score.py`** (pure):
  - precedence: finder (VOID), then measurability (FAIL, never VOID), then identities (C2, C3, C4: VOID), then the
    nine legs;
  - replacement in the frozen order, with donors re-selected after each replacement;
  - reported: event-level p90, the raw band, donors, near twins (Ocean City 8570280 → 8570283, 0.752 km), and the
    forecast for the MLLW retest.
- **Workflow:** `tide-a-harcon.yml`. Only a push of a numbered tag `tide-a-harcon-v1-[0-9]*` starts it (David's word, via the
  director). Its jobs:
  - the AVISO download;
  - the C1 finder (the vendored `finder_check.py --stations`);
  - the instrument;
  - the scorer;
  - the artifact.
  It writes no bucket, serves nothing, and has no backend.
- **Tests:** `tests/test_a_harcon_instrument.py`, 17 tests (estate lane; floor fragment +17). Not run against live
  data: it is predictions only, and the tag needs David's word.
- **Next:** the two-arm table build (`am_h`, serve selection by flag, T6), as its own PR.
- **Smoke test, 21:47Z (restamped from 21:50Z, which was ahead of its 21:47:08Z commit).** The CO-OPS path (`truth_at`, `noaa_msl`, centring, `events_rows`) ran on a SEEN station
  (The Battery, 8518750) over a PAST window (2026-11-01..04), so no gate station or window was read.
  - NOAA's own hourly curve, centred and run through the served finder, reproduces NOAA's 11 High/Low events: 11 of
    11 matched, median |h| 0.0007 m, median |t| 1.7 min.
  - pyTMD and PyFES are not installed locally, so `harcon_eval` and `fes_eval` (code the earlier tide gates already
    use) run only in CI.

## 21:56Z: the advisor's HOLD on #1285 at 74d2ca457 (three items), fixed

1. **Precedence, as ruled on #1270 §11 and #1171.** The order is now:
   - the finder (VOID);
   - TESTED mismatches (a C2 mismatch, C3 above tolerance, C4): VOID anywhere, BEFORE the measurability return;
   - measurability: FAIL, with untestable identities treated as vacuous;
   - vacuity: in a full run only, a C2 untestable or a missing C3 is VOID.

   `c3_bad` is split into `mismatch` and `missing`. Tests, +5:
   - thin + mismatch → VOID (C2 at a station, C2 at a donor, C3);
   - thin + untestable → FAIL;
   - full + untestable C2 (at a station, at a donor) → VOID;
   - full + missing C3 → VOID;
   - a planted FAIL stays FAIL.

   The old test that expected a thin stratum with a mismatch to FAIL now covers the loss alone.
2. **The smoke-test heading** is restamped to 21:47Z (it was 21:50Z, ahead of its 21:47:08Z commit). This is my own
   unmerged text, edited in place on the director's instruction.
3. **The tag glob** is narrowed to `tide-a-harcon-v1-[0-9]*`, so only a numbered tag starts the run; a test pins it.
   The base-tag idea was withdrawn by the advisor.

- **Fragment:** estate +22 (was +17).
- **Checks:** the instrument, tide_own, workflow-condition and tide_window suites give 74 passed, twice.

## 22:24Z: amendment 2 (PRE-DATA), the pacing and error-handling fix, after v1-1 = NO RUN (infra)

- **The ruling, relayed by the director:** v1-1 = NO RUN (infra). ONE registered re-run, `tide-a-harcon-v1-2`, is
  allowed on David's typed word, on this fixed head. The record is #1287.
- **Gate §10, amendment 2:** every CO-OPS call is paced (≥ 2 s apart; 403, 429, 5xx, connection, timeout and
  truncated or non-JSON bodies back off exponentially with jitter, honour Retry-After, and are bounded at 600 s); then
  a HARNESS failure. A 400 or 404 is a harness failure at once.
  - **C1:** the verbatim `finder_check.py`, one station at a time (`paced_finder.py`). A failure is recorded and the
    output is always written. A missing row at a scored station is C1 VOID.
  - **The instrument:** run through `paced_run.py`. A harness failure is recorded per station; the JSON is atomic,
    with `complete` and `harness_failures`.
  - **The scorer:** a harness failure or an incomplete run is VOID, right after C1.
  - **Verifying the diff:** `git diff -w` shows the instrument change is the `try`/`except HarnessFailure` around the
    per-station body, the truth failure raised as a harness failure, and the atomic write. The indentation is the only
    other change.
- **Tests:** `tests/test_coops_pacing.py`, 13 (estate lane):
  - spacing; backoff; Retry-After; the bound; a 400; a truncated body vs a 200 error-JSON; other hosts;
  - the failure escaping the real `get_json` and the verbatim `finder_check`;
  - the per-station runner; the scorer VOIDs; the workflow; the fixed constants and the hash.
- The instrument tests' workflow assertion now names `paced_finder.py`.
