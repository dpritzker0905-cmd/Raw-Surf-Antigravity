"""T-01 (audit 14.1) — a GFS/ICON marine scrub is served from the STORED direct-pipeline products
(NOAA GRIB / DWD) when they cover every requested hour exactly, instead of a live Open-Meteo fetch.
Coverage matrix carried over from unmerged PR #43; routing + recovery tests are new."""
import asyncio
from datetime import datetime, timezone, timedelta
from types import SimpleNamespace as NS

import pytest

from services.weather_pipeline import grid_series_helper
from services.weather_pipeline.grid_series_helper import _build_grid_series_impl
from services.weather_pipeline.schemas import NormalizedProduct, NormalizedGrid, GridVector, CoverageBounds
from services.weather_pipeline.series_source_policy import has_stored_series_coverage, recover_missing_hours

BASE = datetime(2026, 9, 23, 0, tzinfo=timezone.utc)
FL = NS(west=-82, south=26, east=-78, north=30)


def product(hour, **changes):
    # Mirrors a real NOAA-direct manifest row: provider stays the "open-meteo" render key.
    fields = dict(model="GFS", domain="marine", layer="waves", provider="open-meteo",
                  upstream_provider="noaa", is_test_fixture=False, is_estimated=False,
                  is_forecast_authoritative=True, resolution=0.25, coverage=FL,
                  valid_time_start=BASE + timedelta(hours=hour))
    fields.update(changes)
    return NS(**fields)


def vp_with(products):
    return NS(store=NS(get_manifest=lambda: NS(products=products)), normalizer=None)


def covered(products, bbox="-81,27,-80,28", hours=(0, 3)):
    return asyncio.run(has_stored_series_coverage(vp_with(products), "GFS", "marine", "waves", bbox, list(hours), BASE))


def test_stored_direct_products_cover_the_page():
    assert covered([product(0), product(3)])


def test_provider_open_meteo_render_key_does_not_disqualify_a_direct_product():
    # The trap this module documents: provider is the render-whitelist key, upstream_provider is origin.
    assert covered([product(0, provider="open-meteo"), product(3, provider="open-meteo")])


@pytest.mark.parametrize("change", [
    {"upstream_provider": "open-meteo"}, {"upstream_provider": None},
    {"resolution": 2}, {"resolution": 0}, {"resolution": None}, {"is_estimated": True},
    {"is_test_fixture": True}, {"is_forecast_authoritative": False},
    {"model": "ICON"}, {"layer": "swell_1"}, {"domain": "wind"},
    {"valid_time_start": BASE + timedelta(hours=4)},   # a nearby product is a substitution, not coverage
])
def test_one_changed_dimension_keeps_the_live_lane(change):
    assert not covered([product(0), product(3, **change)])


def test_missing_hour_or_partial_coverage_keeps_the_live_lane():
    assert not covered([product(0)])
    assert not covered([product(0), product(3)], "-85,27,-80,28")


def test_anchor_plus_3k_offsets_never_match_3_hourly_products():
    # Why the frontend T-01 fix (PR #67) is the precondition: offsets 1,4 from a 00Z base -> 01Z/04Z.
    assert not covered([product(h) for h in range(0, 12, 3)], hours=(1, 4))
    assert covered([product(h) for h in range(0, 12, 3)], hours=(0, 3, 6))


def test_manifest_failure_keeps_the_live_lane():
    def boom():
        raise RuntimeError("store down")
    vp = NS(store=NS(get_manifest=boom))
    assert not asyncio.run(has_stored_series_coverage(vp, "GFS", "marine", "waves", "-81,27,-80,28", [0], BASE))


def test_recovery_fills_only_missing_hours_and_never_replaces_stored():
    stored = [{"hour_offset": 0, "vectors": [1], "provider": "stored"}]

    async def live(hours):
        return {"frames": [{"hour_offset": h, "vectors": [1], "provider": "live"} for h in (0, 3, 6)]}

    added = asyncio.run(recover_missing_hours(live, stored, [0, 3], wait_s=1))
    assert added == 1
    assert {f["hour_offset"]: f["provider"] for f in stored} == {0: "stored", 3: "live"}


def test_recovery_failure_keeps_stored_frames():
    stored = [{"hour_offset": 0, "vectors": [1]}]

    async def live(hours):
        raise TimeoutError

    assert asyncio.run(recover_missing_hours(live, stored, [0, 3], wait_s=1)) == 0
    assert len(stored) == 1


# ── routing, end to end through the series builder ─────────────────────────────────────────────
def _stored_product(valid_time):
    cov = CoverageBounds(west=-82.0, south=26.0, east=-78.0, north=30.0)
    grid = NormalizedGrid(bounds=cov, cols=2, rows=2, vectors=[GridVector(lat=27.0, lng=-80.0, speed=1.0)])
    return NormalizedProduct(
        model="GFS", provider="open-meteo", domain="marine", layer="waves", run_time=BASE,
        valid_time=datetime.fromisoformat(valid_time.replace("Z", "+00:00")),
        is_forecast_authoritative=True, is_estimated=False, coverage=cov, grid=grid,
        value_kind="wave_height", value_unit="m", display_unit_hint="ft", source_variables=[],
        freshness_sec=1800, product_id="gfs_marine_waves_florida_east_coast.json")


def _run_series(monkeypatch, manifest_products, hours="0,3"):
    calls = {"live": 0, "stored": 0}

    async def live(viewport_service, model, layer, bbox, hour_list, base):
        calls["live"] += 1
        return {"frames": [{"hour_offset": h, "vectors": [1], "provider": "open-meteo-live",
                            "bounds": {"west": -82, "south": 26, "east": -78, "north": 30}} for h in hour_list],
                "frame_count": len(hour_list), "base_time": "x", "bounds": None, "cols": 2, "rows": 2,
                "model": model, "domain": "marine", "layer": layer}

    async def resolve(*, model, domain, layer, valid_time, bbox, surf=False, background_tasks=None, request=None):
        calls["stored"] += 1
        return _stored_product(valid_time)

    monkeypatch.setenv("GFS_ICON_SERIES_FASTPATH", "1")
    monkeypatch.setattr(grid_series_helper, "_build_openmeteo_marine_series", live)
    out = asyncio.run(_build_grid_series_impl(resolve, vp_with(manifest_products), "GFS", "marine", "waves",
                                              "-81,27,-80,28", hours, base_anchor=BASE))
    return out, calls


def test_exact_stored_coverage_serves_stored_frames_without_a_live_fetch(monkeypatch):
    out, calls = _run_series(monkeypatch, [product(0), product(3)])
    assert calls["live"] == 0
    assert calls["stored"] == 2
    assert out["frame_count"] == 2


def test_incomplete_stored_coverage_keeps_the_live_lane(monkeypatch):
    out, calls = _run_series(monkeypatch, [product(0)])
    assert calls["live"] == 1
    assert all(f["provider"] == "open-meteo-live" for f in out["frames"])
