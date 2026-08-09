"""R11-04 (Report 11.0) — series frames must carry run/upstream identity, and the response
must census the runs it mixed.

THE DEFECT THIS PINS: grid_series frames stripped run_time/upstream_provider/source_dataset/
estimate_basis — all four served by the per-hour /grid lane — so (1) one series response could
mix MODEL RUNS across adjacent hours with no disclosure (each hour resolves independently
against a manifest that legitimately holds two run generations mid-ingest), and (2) the
frontend's model->dataset guess (FALSIFIED for EURO, measured 2026-08-03) stayed the active
provenance path for every series-committed frame because `frame.upstream_provider` was never
present. These are SERIALIZATION assertions: the data existed on the resolved product at the
exact line the frame dict was built.
"""
import asyncio
from datetime import datetime, timedelta, timezone

from services.weather_pipeline.grid_series_helper import build_grid_series
from services.weather_pipeline.schemas import (
    NormalizedProduct, NormalizedGrid, GridVector, CoverageBounds,
)

_BASE_RUN = datetime(2026, 8, 9, 6, 0, tzinfo=timezone.utc)


def _product(run_time, upstream="ecmwf", dataset="ecmwf_wam"):
    cov = CoverageBounds(west=-82.0, south=26.0, east=-78.0, north=30.0)
    grid = NormalizedGrid(bounds=cov, cols=2, rows=2,
                          vectors=[GridVector(lat=27.0, lng=-80.0, speed=1.0)])
    p = NormalizedProduct(
        model="GFS", provider="open-meteo", domain="marine", layer="waves",
        run_time=run_time, valid_time=datetime.now(timezone.utc),
        is_forecast_authoritative=True, is_estimated=False, coverage=cov, grid=grid,
        value_kind="wave_height", value_unit="m", display_unit_hint="ft",
        source_variables=[], freshness_sec=1800, product_id="gfs_test.json",
    )
    # Optional provenance fields, exactly as the live resolver attaches them.
    p.upstream_provider = upstream
    p.source_dataset = dataset
    return p


class _FakeVP:
    normalizer = None


def _build(resolve, hours="0,3"):
    return asyncio.run(build_grid_series(
        resolve, _FakeVP(), "GFS", "marine", "waves",
        "-82.0,26.0,-78.0,30.0", hours))


def test_series_frames_carry_run_and_upstream_identity():
    async def resolve(*, model, domain, layer, valid_time, bbox,
                      surf=False, background_tasks=None, request=None):
        return _product(_BASE_RUN)

    resp = _build(resolve)
    assert resp["frame_count"] == 2
    for f in resp["frames"]:
        assert f["run_time"] == "2026-08-09T06:00:00Z"
        assert f["upstream_provider"] == "ecmwf"
        assert f["source_dataset"] == "ecmwf_wam"
        # Absent basis serializes as None, never a KeyError — additive contract.
        assert "estimate_basis" in f and f["estimate_basis"] is None


def test_run_census_flags_a_mixed_run_page():
    calls = {"n": 0}

    async def resolve(*, model, domain, layer, valid_time, bbox,
                      surf=False, background_tasks=None, request=None):
        # Second hour resolves from a NEWER run — the mid-ingest interleave, by construction.
        calls["n"] += 1
        return _product(_BASE_RUN + timedelta(hours=6 * (calls["n"] - 1)))

    resp = _build(resolve)
    census = resp["run_census"]
    assert census["mixed_runs"] is True
    assert census["distinct_runs"] == 2
    assert census["min_run_time"] == "2026-08-09T06:00:00Z"
    assert census["max_run_time"] == "2026-08-09T12:00:00Z"


def test_run_census_is_calm_on_a_single_run_page():
    async def resolve(*, model, domain, layer, valid_time, bbox,
                      surf=False, background_tasks=None, request=None):
        return _product(_BASE_RUN)

    resp = _build(resolve)
    assert resp["run_census"]["mixed_runs"] is False
    assert resp["run_census"]["distinct_runs"] == 1


def test_missing_provenance_stays_additive_none():
    async def resolve(*, model, domain, layer, valid_time, bbox,
                      surf=False, background_tasks=None, request=None):
        p = _product(_BASE_RUN)
        # A product with no upstream attribution (e.g. a legacy manifest entry).
        p.upstream_provider = None
        p.source_dataset = None
        return p

    resp = _build(resolve)
    f = resp["frames"][0]
    assert f["upstream_provider"] is None and f["source_dataset"] is None
    # run census still works off run_time alone
    assert resp["run_census"]["distinct_runs"] == 1
