"""
POINT_SKIP_NATIVE_COPERNICUS gate (2026-07-05, the precompute cap-death layer 3).

Cron truth, layered: (1) the empty WEATHER_PROXY_URL secret broke every proxied point fetch
(fixed ab45f3e8); (2) with the proxy healthy, ~300 serial native CMEMS per-point subset
downloads at ~5.7s each ate 28.5 min (run 28753314599); (3) under that request volume CMEMS
began throttling — run 28754458502 burned 138 × the FULL 25s subprocess timeout (57.5 of its
60 minutes) while the open-meteo proxy fallback answered every point sub-second. Batch lanes
(precompute.yml, forecast-ingest.yml calibration tail) therefore set
POINT_SKIP_NATIVE_COPERNICUS=1 to route EURO marine points straight to the provider fallback.
Live /point serving keeps native-first authority (flag unset on the serve box).
"""
import inspect
import re


def test_euro_native_point_branch_honors_the_skip_gate():
    """The gate must sit INSIDE the EURO native branch, BEFORE the fetch_euro_marine import/call,
    raising into the existing except -> provider-fallback path (no new control flow)."""
    from services.weather_pipeline import point_resolution
    src = inspect.getsource(point_resolution)
    gate = src.find('POINT_SKIP_NATIVE_COPERNICUS')
    fetch = src.find('from services.copernicus_marine_service import fetch_euro_marine')
    assert gate != -1, "the skip gate is missing from point_resolution"
    assert fetch != -1, "the native CMEMS point fetch import moved — re-anchor the gate"
    assert gate < fetch, "the gate must run BEFORE the native CMEMS fetch, not after"


def test_batch_workflows_guard_the_cmems_point_volume():
    """Every cron lane that fires per-point EURO fetches must guard the CMEMS volume ONE way:
    either SKIP native points (proxy fallback) or SPATIALLY BATCH them (one subset per spot
    cluster, native authority). Rollout COMPLETE 2026-07-06: precompute.yml proved the batched
    lane (run 28771531702: 107/107 boxes, 977 points, 0 failed, 25m27s total) and
    forecast-ingest.yml flipped to batching the same day. Setting BOTH in one lane is a bug:
    the skip flag turns the pre-warm into a wasted no-op. The serve box sets NEITHER (live
    /point keeps native-first authority)."""
    import pathlib
    root = pathlib.Path(__file__).resolve().parents[2]
    for wf in ("precompute.yml", "forecast-ingest.yml"):
        text = (root / ".github" / "workflows" / wf).read_text(encoding="utf-8")
        skips = bool(re.search(r"POINT_SKIP_NATIVE_COPERNICUS:\s*'1'", text))
        batches = bool(re.search(r"POINT_BATCH_NATIVE_COPERNICUS:\s*'1'", text))
        assert skips or batches, f"{wf} must guard the CMEMS point volume (skip OR batch)"
        assert not (skips and batches), f"{wf} sets BOTH flags — the skip makes batching a wasted no-op"
