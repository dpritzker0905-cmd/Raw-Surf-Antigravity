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
- **Workflow:** `tide-a-harcon.yml`. Only a push of a tag `tide-a-harcon-v1-*` starts it (David's word, via the
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
- **Smoke test, 21:50Z.** The CO-OPS path (`truth_at`, `noaa_msl`, centring, `events_rows`) ran on a SEEN station
  (The Battery, 8518750) over a PAST window (2026-11-01..04), so no gate station or window was read.
  - NOAA's own hourly curve, centred and run through the served finder, reproduces NOAA's 11 High/Low events: 11 of
    11 matched, median |h| 0.0007 m, median |t| 1.7 min.
  - pyTMD and PyFES are not installed locally, so `harcon_eval` and `fes_eval` (code the earlier tide gates already
    use) run only in CI.
