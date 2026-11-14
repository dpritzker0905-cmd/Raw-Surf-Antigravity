# 2026-11-13: the calibration serve path is recorded (Fable repair lead)

Append-only. Branch `fable/serve-path-logging`. Split out of #852 (which is on HOLD: its reach cap would send 7 surf
spots to no data on NOAA's native mask; see `2026-11-13-fable-strait-fallback.md` on that branch).

- **What:** each calibration row's `served` block gains `interp` (the sampler's `interpolation_method`) and `sampled`
  (the cell it read, 3 dp), and each skill-ledger row copies them (`skill_attribution.serve_path`). Absent = not recorded.
- **Why:** NDBC 46267's +1.5 m (per-buoy split, Actions 43339322792) was tied to the nearest-ocean fallback by
  elimination, and two land masks disagree on WHICH cell it read ((48.5, -124.25) on Open-Meteo's copy, (48.5, -124.5)
  on NOAA's native field). With this, the next split reads the served cell from the rows. Also lets 51202's
  chain-added +0.08 m be split by path.
- **No served number moves.** It reads two attributes already on the response. Cost: ~40 bytes per row.
  Kill: `CALIBRATION_SERVE_PATH=0` (the `served` block is then exactly as before; pinned).
- **Tests:** `test_skill_attribution.py`: the `served` block with and without the kill switch; the ledger row carries the
  keys and omits them when unknown. Chain lane +1 test.
