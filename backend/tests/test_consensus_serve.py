"""CONSENSUS_SERVE (2026-09-29): D-009's "one switch" that serves the equal-mean consensus in place of GFS waves.

These pin the switch's contract on real product types:
  * OFF: the serving view is the store, value for value;
  * ON: a GFS `regional_tile` waves frame loads as its CONSENSUS twin (same region, valid time AND run), with GFS's
    own vector wherever the consensus did not blend (`is_valid=False`), honestly stamped;
  * never for another model, layer, tier, an older-run twin, or a grid that is not the same grid;
  * `serve_raw()` answers raw (the ledger's GFS_RAW baseline);
  * the SEAM: the routes' store and the CI resolver are the serving view, ingest's store is NOT, and the ingest
    modules that load GFS never import the switch (swapped there, the consensus would be built from itself);
  * declared '0' in both lanes that write spot ratings and run the ledger.
"""
import ast
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
import yaml

from services.weather_pipeline import consensus_serve as S
from services.weather_pipeline.schemas import (CoverageBounds, GridVector, ManifestProduct, NormalizedGrid,
                                               NormalizedProduct, PipelineManifest)

BACKEND = Path(__file__).resolve().parents[1]
RUN = datetime(2026, 9, 29, 12, tzinfo=timezone.utc)
VT = RUN + timedelta(hours=24)
BOX = CoverageBounds(west=-81.0, south=26.0, east=-80.0, north=27.0)


def _grid(speeds, valid=None):
    vs = []
    for i, sp in enumerate(speeds):
        vs.append(GridVector(lat=26.0 + 0.5 * (i // 2), lng=-81.0 + 0.5 * (i % 2), speed=sp, direction=90.0 + i,
                             period=10.0, is_valid=True if valid is None else valid[i]))
    return NormalizedGrid(bounds=BOX, cols=2, rows=2, vectors=vs)


def _product(model, speeds, valid=None, layer="waves", run=RUN, pid=None):
    return NormalizedProduct(
        model=model, provider="noaa" if model == "GFS" else "raw-surf", domain="marine", layer=layer, run_time=run,
        valid_time=VT, is_forecast_authoritative=True, is_estimated=False, coverage=BOX, grid=_grid(speeds, valid),
        value_kind="height", value_unit="m", display_unit_hint="ft", source_variables=["swh"], freshness_sec=0,
        product_id=pid, upstream_model=("equal mean of GFS, EURO, ICON" if model == "CONSENSUS" else None),
        source_dataset=("consensus:equal_mean" if model == "CONSENSUS" else None))


def _item(model, fn, mode="regional_tile", run=RUN, region="fl", layer="waves"):
    return ManifestProduct(model=model, provider="x", domain="marine", layer=layer, run_time=run, valid_time_start=VT,
                           valid_time_end=VT, resolution=0.25, freshness_sec=0, is_forecast_authoritative=True,
                           coverage=BOX, filename=fn, region_id=region, coverage_mode=mode)


class _Store:
    """A ProductStore stand-in: a manifest and products by filename, counting loads."""

    def __init__(self, products, items):
        self.products, self.loads, self.cache_dir = products, [], Path("/nowhere")
        self.manifest = PipelineManifest(last_manifest_update=RUN, products=items)

    def get_manifest(self):
        return self.manifest

    def load_product(self, filename, stride=None):
        self.loads.append(filename)
        p = self.products.get(filename)
        return p.model_copy() if p is not None else None


def _view(monkeypatch, on="1", gfs_speeds=(1.0, 2.0, 3.0, 4.0), cons_valid=(True, True, False, True), **kw):
    monkeypatch.setenv("CONSENSUS_SERVE", on)
    S._index = None
    products = {"gfs.json": _product("GFS", list(gfs_speeds)),
                "cons.json": _product("CONSENSUS", [1.5, 2.5, 9.9, 4.5], valid=list(cons_valid), pid="cons.json"),
                **kw.pop("products", {})}
    items = kw.pop("items", [_item("GFS", "gfs.json"), _item("CONSENSUS", "cons.json")])
    raw = _Store(products, items)
    return S.served_store(raw), raw


def test_off_the_view_is_the_store(monkeypatch):
    view, raw = _view(monkeypatch, on="0")
    got = view.load_product("gfs.json")
    assert [v.speed for v in got.grid.vectors] == [1.0, 2.0, 3.0, 4.0] and got.upstream_model is None
    assert raw.loads == ["gfs.json"]                       # the twin is never even read


def test_on_a_regional_gfs_frame_serves_its_twin_and_gfs_where_it_did_not_blend(monkeypatch):
    view, _raw = _view(monkeypatch)
    got = view.load_product("gfs.json")
    assert [v.speed for v in got.grid.vectors] == [1.5, 2.5, 3.0, 4.5]      # cell 2 unblended -> GFS's own 3.0
    assert all(v.is_valid for v in got.grid.vectors)
    assert got.model == "GFS" and got.provider == "noaa"                    # the lane the frontend asked for
    assert got.upstream_model == "equal mean of GFS, EURO, ICON" and got.source_dataset == "consensus:equal_mean"
    assert got.grid.diagnostics["served_consensus"] == {"twin_product": "cons.json", "cells": 4, "cells_served_gfs": 1}


@pytest.mark.parametrize("items,why", [
    ([_item("GFS", "gfs.json")], "no twin"),
    ([_item("GFS", "gfs.json"), _item("CONSENSUS", "cons.json", run=RUN - timedelta(hours=6))], "an older run"),
    ([_item("GFS", "gfs.json", mode="global_mid"), _item("CONSENSUS", "cons.json")], "not a regional tile"),
    ([_item("GFS", "gfs.json"), _item("CONSENSUS", "cons.json", region="other")], "another region"),
])
def test_on_without_a_same_run_twin_it_serves_gfs(monkeypatch, items, why):
    view, _raw = _view(monkeypatch, items=items)
    assert [v.speed for v in view.load_product("gfs.json").grid.vectors] == [1.0, 2.0, 3.0, 4.0], why


def test_on_other_models_and_layers_are_untouched(monkeypatch):
    view, raw = _view(monkeypatch, products={"euro.json": _product("EURO", [7.0, 7.0, 7.0, 7.0]),
                                             "wind.json": _product("GFS", [5.0, 5.0, 5.0, 5.0], layer="wind")})
    assert view.load_product("euro.json").grid.vectors[0].speed == 7.0
    assert view.load_product("wind.json").grid.vectors[0].speed == 5.0
    assert "cons.json" not in raw.loads


def test_a_twin_on_another_grid_is_refused_not_assumed(monkeypatch):
    view, raw = _view(monkeypatch)
    bad = _product("CONSENSUS", [9.0, 9.0, 9.0, 9.0], pid="cons.json")
    bad.grid.vectors[1].lng += 0.25
    raw.products["cons.json"] = bad
    assert [v.speed for v in view.load_product("gfs.json").grid.vectors] == [1.0, 2.0, 3.0, 4.0]


def test_serve_raw_answers_raw_even_when_on(monkeypatch):
    view, _raw = _view(monkeypatch)
    with S.serve_raw():
        assert view.load_product("gfs.json").grid.vectors[0].speed == 1.0
    assert view.load_product("gfs.json").grid.vectors[0].speed == 1.5


def test_merged_frames_are_cached_and_each_caller_gets_its_own_copy(monkeypatch):
    view, raw = _view(monkeypatch)
    a = view.load_product("gfs.json")
    a.product_id = "mutated by a caller"
    b = view.load_product("gfs.json")                      # a cache HIT
    b.product_id = "mutated by a second caller"
    c = view.load_product("gfs.json")                      # another hit: must not see either caller's edit
    assert c.product_id not in ("mutated by a caller", "mutated by a second caller")
    assert c.grid.vectors[0].speed == 1.5
    assert raw.loads.count("cons.json") == 1                # the twin was read once


def test_the_switch_is_off_unless_set_to_one(monkeypatch):
    monkeypatch.delenv("CONSENSUS_SERVE", raising=False)
    assert S.enabled() is False
    for v, want in (("0", False), ("", False), ("true", False), ("1", True)):
        monkeypatch.setenv("CONSENSUS_SERVE", v)
        assert S.enabled() is want, v


def test_a_waves_listed_file_that_loads_as_another_layer_is_not_swapped(monkeypatch):
    """Defence in depth: the twin index lists GFS WAVES frames, and the loaded product must agree before a swap."""
    view, raw = _view(monkeypatch)
    raw.products["gfs.json"] = _product("GFS", [1.0, 2.0, 3.0, 4.0], layer="swell")
    assert [v.speed for v in view.load_product("gfs.json").grid.vectors] == [1.0, 2.0, 3.0, 4.0]


def test_attribute_writes_reach_the_store_and_load_product_can_be_monkeypatched(monkeypatch):
    view, raw = _view(monkeypatch)
    view.cache_dir = Path("/elsewhere")
    assert raw.cache_dir == Path("/elsewhere") and view.cache_dir == Path("/elsewhere")
    with monkeypatch.context() as m:
        m.setattr(view, "load_product", lambda fn, stride=None: "fake")
        assert view.load_product("gfs.json") == "fake"
    assert view.load_product("gfs.json").grid.vectors[0].speed == 1.5    # the undo did not loop into itself
    assert S.served_store(view) is view


def test_the_serving_surfaces_get_the_view_and_ingest_does_not():
    import routes.weather
    from services.weather_pipeline.scheduler import WeatherPipelineScheduler
    from services.weather_pipeline.spot_ratings_precompute import _make_point_resolver
    assert isinstance(routes.weather.store, S.ServedStore)
    assert isinstance(_make_point_resolver().store, S.ServedStore)
    assert not isinstance(WeatherPipelineScheduler().store, S.ServedStore)


@pytest.mark.parametrize("module", ["consensus_ingest", "euro_wind_extension", "icon_marine_extension", "lattice_fill",
                                    "scheduler_helpers", "scheduler", "coarse_gulf_fill", "store", "store_helpers"])
def test_no_ingest_module_imports_the_switch(module):
    """Swapped at ingest, the consensus would be rebuilt from itself (module docstring)."""
    tree = ast.parse((BACKEND / "services" / "weather_pipeline" / f"{module}.py").read_text(encoding="utf-8"))
    names = {n.module for n in ast.walk(tree) if isinstance(n, ast.ImportFrom) and n.module}
    names |= {a.name for n in ast.walk(tree) if isinstance(n, ast.Import) for a in n.names}
    assert not any("consensus_serve" in n for n in names), module


def test_the_ledger_keeps_a_raw_gfs_lane_only_while_the_consensus_is_served(monkeypatch):
    from services.weather_pipeline import forecast_skill as fs
    monkeypatch.delenv("CONSENSUS_SERVE", raising=False)
    assert fs.GFS_RAW not in fs.compare_models("GFS")
    monkeypatch.setenv("CONSENSUS_SERVE", "1")
    assert fs.GFS_RAW in fs.compare_models("GFS") and fs.GFS_RAW not in fs.compare_models("EURO")
    assert fs.source_for(fs.GFS_RAW, "GFS") == "raw_surf:GFS_RAW"


def test_the_raw_lane_resolves_gfs_under_serve_raw(monkeypatch):
    import asyncio
    from services.weather_pipeline import buoy_calibration as bc
    from services.weather_pipeline import forecast_skill as fs
    monkeypatch.setenv("CONSENSUS_SERVE", "1")
    monkeypatch.setenv("FORECAST_SKILL_COMPARE_MODELS", "")
    monkeypatch.setenv("FORECAST_SKILL_PERSISTENCE", "0")
    seen = []

    async def fake_calibrate(resolver, spots, model, target):
        seen.append((model, S.enabled()))
        return {"spots": []}

    async def no_coords():
        return {}
    monkeypatch.setattr(bc, "calibrate_spots", fake_calibrate)
    monkeypatch.setattr(bc, "fetch_ndbc_station_coords", no_coords)
    monkeypatch.setattr(bc, "load_calibration_rows_l2", lambda *a, **k: ([], False))
    monkeypatch.setattr(bc, "upload_calibration_l2", lambda *a, **k: None)
    try:
        asyncio.run(fs.run_skill_ledger(None, None, [], "GFS", {"spots": []}))
    except Exception:
        pass                                              # only the lane resolution is under test here
    assert ("GFS", True) in seen and ("GFS", False) in seen   # served lane ON; the GFS_RAW lane under serve_raw
    assert all(m == "GFS" for m, _ in seen)                   # GFS_RAW resolves the GFS model, raw


def test_end_to_end_a_gfs_point_serves_the_built_consensus_through_the_real_resolver(monkeypatch):
    """The REAL chain: the production shadow builder makes the twin from GFS/EURO/ICON products, the production
    manifest helper lists it, and the production PointResolutionService answers /point?model=GFS through the view.
    Florida: GFS 0.8 m, EURO 1.0 m, ICON 1.2 m -> the equal mean 1.0 m."""
    import asyncio
    from services.weather_pipeline.point_resolution import PointResolutionService
    from services.weather_pipeline.sampler import PointSampler
    from services.weather_pipeline.store_helpers import _build_manifest_item, _build_product_filename
    from tests.test_consensus_ingest import T0, _build, _scene

    class NoUpstream:
        async def fetch_point(self, *a, **k):
            raise AssertionError("a stored frame covers this point; the upstream must not be called")

    raw = _scene()
    _, batches = _build(raw)
    for shadow, res in batches[T0][0]:
        fn = _build_product_filename(shadow)
        shadow.product_id = fn
        raw.files[fn] = shadow
        raw.manifest.products.append(_build_manifest_item(shadow, fn, res, False))
    S._index = None
    svc = PointResolutionService(store=S.served_store(raw), sampler=PointSampler(), provider=NoUpstream())

    def hs():
        return asyncio.run(svc.resolve_point("GFS", "marine", "waves", 28.0, -80.0, T0.isoformat())).point.speed

    monkeypatch.setenv("CONSENSUS_SERVE", "0")
    assert hs() == pytest.approx(0.8)                    # dark: GFS, as served today
    monkeypatch.setenv("CONSENSUS_SERVE", "1")
    assert hs() == pytest.approx(1.0)                    # on: the built equal mean
    with S.serve_raw():
        assert hs() == pytest.approx(0.8)                # the ledger's raw baseline


def test_both_rating_lanes_declare_the_switch_dark_and_equal():
    values = {}
    for wf in ("forecast-ingest.yml", "precompute.yml"):
        d = yaml.safe_load((BACKEND.parent / ".github" / "workflows" / wf).read_text(encoding="utf-8"))
        found = [st["env"]["CONSENSUS_SERVE"] for j in d["jobs"].values() for st in j.get("steps", [])
                 if isinstance(st, dict) and "CONSENSUS_SERVE" in (st.get("env") or {})]
        assert len(found) == 1, wf
        values[wf] = found[0]
    assert set(values.values()) == {"0"}, values
