"""MARINE_REGIONAL_TILE_FIRST: inside a GFS pilot box, a viewport the stored tile FULLY covers is served from that tile (dark).

The owner, 2026-10-23 18:13 EDT: "Yes: make the stored NOAA GFS tile the single zoom 7-9 source inside the pilot boxes (server dark
flag + client bundles), retire the Open-Meteo lane there, and flip both together after live parity passes."
The live parity read (2026-10-23) found the dynamic cache (Steps 1-2) answering a box the florida_east_coast tile fully covers, on a
different lattice. These tests pin: flag off = today's path; flag on = the tile, decided by the client's own rule (staticRegional.js
pickRegionalTile + regionalClipWindow), with partial covers, a snapped box outside the data, other models, surf and ties all left on
today's path; the dark-period diff is sampled and capped; the GFS/ICON live series lane is skipped inside a pilot box.
"""
import asyncio
import types
from datetime import datetime, timezone

import pytest

from services.weather_pipeline import grid_resolver
from services.weather_pipeline import regional_tile_first as tf
from services.weather_pipeline.schemas import CoverageBounds, GridVector, NormalizedGrid, NormalizedProduct

_VT = "2026-10-23T12:00:00Z"
_VT_DT = datetime(2026, 10, 23, 12, tzinfo=timezone.utc)
FL = CoverageBounds(west=-85.0, south=24.0, east=-79.0, north=31.0)               # REGIONAL_CONFIGS["florida_east_coast"]
SEMA = CoverageBounds(west=-82.0, south=31.0, east=-74.4, north=37.5)             # us_southeast_midatlantic: a non-whole-degree edge


def _lattice(c, res=0.25, speed=1.0):
    cols, rows = int(round((c.east - c.west) / res)) + 1, int(round((c.north - c.south) / res)) + 1
    vecs = [GridVector(lat=round(c.south + r * res, 4), lng=round(c.west + k * res, 4), speed=speed + r / 100.0, direction=90.0,
                       u=-1.0, v=0.0, period=9.0, is_valid=True) for r in range(rows) for k in range(cols)]
    return NormalizedGrid(bounds=c, cols=cols, rows=rows, vectors=vecs)


def _product(model, grid, coverage, pid, run="2026-10-23T12:00:00Z"):
    p = NormalizedProduct(model=model, provider="noaa", domain="marine", layer="waves", run_time=_VT_DT, valid_time=_VT_DT,
                          is_forecast_authoritative=True, is_estimated=False, coverage=coverage, grid=grid, value_kind="wave_height",
                          value_unit="m", display_unit_hint="ft", source_variables=[], freshness_sec=1800, product_id=pid)
    p.model_run_time = run
    return p


def _item(region, c, model="GFS"):
    return types.SimpleNamespace(model=model, domain="marine", layer="waves", valid_time_start=_VT_DT, is_estimated=False,
                                 coverage=c, resolution=0.25, filename=f"{model.lower()}_marine_waves_{region}.json",
                                 region_id=region, coverage_mode="regional_tile")


class _Store:
    def __init__(self, items, products):
        self._items, self._products, self.loaded = items, products, []

    def get_manifest(self):
        return types.SimpleNamespace(products=self._items)

    def load_product(self, filename, **kw):
        self.loaded.append(filename)
        p = self._products.get(filename)
        return p.model_copy() if p is not None else None


class _Viewport:
    def __init__(self, dynamic):
        self.ACTIVE_REVALIDATIONS, self._dynamic, self.cache_asks = set(), dynamic, 0

    def is_viewport_enabled(self, *a, **k):
        return True

    async def get_cached_dynamic_product(self, **k):
        self.cache_asks += 1
        return self._dynamic

    async def _find_any_cached_product(self, *a, **k):
        return None

    async def _revalidate_fetch(self, *a, **k):
        pass

    async def fetch_viewport_grid_upstream(self, **k):
        return None


def _dynamic(model="GFS", bounds=CoverageBounds(west=-83.0, south=27.0, east=-80.0, north=30.0)):
    """The Open-Meteo viewport product the dynamic cache holds: same 0.25-deg-ish spacing, a different lattice (13 x 11)."""
    g = _lattice(bounds, res=0.25, speed=2.0)
    g = NormalizedGrid(bounds=bounds, cols=13, rows=11, vectors=g.vectors[::2])
    return _product(model, g, bounds, f"viewport_{model.lower()}_marine_waves_dyn.json", run="2026-10-23T06:00:00Z")


def _world(model="GFS"):
    items = [_item("florida_east_coast", FL, model), _item("us_southeast_midatlantic", SEMA, model)]
    products = {i.filename: _product(model, _lattice(i.coverage), i.coverage, i.filename) for i in items}
    return _Store(items, products)


def _resolve(store, vp, monkeypatch, bbox, model="GFS", surf=False):
    import services.weather_pipeline.store as store_mod
    monkeypatch.setattr(store_mod, "is_test_environment", lambda: False)
    return asyncio.run(grid_resolver.resolve_grid(store, vp, model=model, domain="marine", layer="waves", valid_time=_VT,
                                                  bbox=bbox, surf=surf))


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    for k in ("MARINE_REGIONAL_TILE_FIRST", "MARINE_TILE_FIRST_DIFF_SAMPLE", "MARINE_TILE_FIRST_DIFF_MAX_PER_HOUR",
              "GFS_ICON_SERIES_FASTPATH", "MARINE_DYNCACHE_PREFER_FINE_REGIONAL"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv("MARINE_TILE_FIRST_DIFF_SAMPLE", "0")      # the dark diff stays out of the resolver tests
    tf.TILE_FIRST_STATS.clear()
    tf._DIFF_WINDOW.update(hour=None, n=0)


INSIDE = "-82.6,27.6,-80.4,29.4"       # snapped -83,27,-80,30: inside the FL data; the served window covers it


def test_flag_off_the_dynamic_cache_answers_as_today(monkeypatch):
    vp = _Viewport(_dynamic())
    out = _resolve(_world(), vp, monkeypatch, INSIDE)
    assert out.product_id == "viewport_gfs_marine_waves_dyn.json" and vp.cache_asks == 1


def test_flag_on_a_fully_covered_box_is_served_from_the_tile_and_the_dynamic_cache_is_never_asked(monkeypatch):
    monkeypatch.setenv("MARINE_REGIONAL_TILE_FIRST", "1")
    vp = _Viewport(_dynamic())
    out = _resolve(_world(), vp, monkeypatch, INSIDE)
    assert out.product_id == "gfs_marine_waves_florida_east_coast.json" and vp.cache_asks == 0
    b = out.grid.bounds
    assert (b.west, b.south, b.east, b.north) == (-83.0, 27.0, -80.0, 30.0) and (out.grid.cols, out.grid.rows) == (13, 13)
    assert out.partial_coverage is False and out.coverage_scope == "regional"
    assert tf.TILE_FIRST_STATS["served_tile"] == 1


@pytest.mark.parametrize("bbox, why", [
    ("-80.5,27.0,-78.5,29.0", "no_tile"),              # pokes past the tile's -79 edge: no tile contains it
    ("-76.0,32.0,-74.5,34.0", "snap_outside_data"),    # inside SEMA, but its snapped east -74 is past the data's -74.4
])
def test_flag_on_anything_short_of_a_full_cover_keeps_today_s_path(monkeypatch, bbox, why):
    monkeypatch.setenv("MARINE_REGIONAL_TILE_FIRST", "1")
    vp = _Viewport(_dynamic())
    out = _resolve(_world(), vp, monkeypatch, bbox)
    assert out.product_id == "viewport_gfs_marine_waves_dyn.json" and vp.cache_asks == 1
    assert tf.TILE_FIRST_STATS[f"declined_{why}"] == 1


@pytest.mark.parametrize("model, surf", [("ICON", False), ("GFS", True)])
def test_flag_on_other_models_and_surf_keep_today_s_path(monkeypatch, model, surf):
    monkeypatch.setenv("MARINE_REGIONAL_TILE_FIRST", "1")
    assert tf.covering_tile(_world(model), model, "marine", "waves", surf, INSIDE, _world(model)._items, [])[0] is None
    assert tf.decide(_world(model), model, "marine", "waves", surf, INSIDE, _world(model)._items, []) is None


def test_the_tile_is_the_smallest_containing_one_and_a_tie_is_no_tile():
    big = _item("big", CoverageBounds(west=-90.0, south=20.0, east=-70.0, north=40.0))
    fl = _item("florida_east_coast", FL)
    assert tf.pick_tile([big, fl], -82.0, 27.0, -81.0, 28.0) is fl
    twin = _item("twin", CoverageBounds(west=-84.0, south=24.0, east=-78.0, north=31.0))    # same area as FL, also contains it
    assert tf.pick_tile([fl, twin], -82.0, 27.0, -81.0, 28.0) is None
    world = _item("global_mid", CoverageBounds(west=-180.0, south=-80.0, east=180.0, north=84.0))
    assert tf.pick_tile([world], -82.0, 27.0, -81.0, 28.0) is None                          # world tiers are not regional


def test_a_broken_decision_falls_back_to_today_s_path(monkeypatch):
    monkeypatch.setenv("MARINE_REGIONAL_TILE_FIRST", "1")

    class _Broken(_Store):
        def load_product(self, filename, **kw):
            raise OSError("disk gone")
    w = _world()
    assert tf.decide(_Broken(w._items, w._products), "GFS", "marine", "waves", False, INSIDE, w._items, []) is None
    assert tf.TILE_FIRST_STATS["declined_error"] == 1


def test_the_dark_diff_is_sampled_capped_and_compares_the_same_nodes(monkeypatch):
    monkeypatch.setenv("MARINE_TILE_FIRST_DIFF_SAMPLE", "1")
    monkeypatch.setenv("MARINE_TILE_FIRST_DIFF_MAX_PER_HOUR", "1")
    w = _world()
    args = (w, "GFS", "marine", "waves", False, INSIDE, w._items, [], _dynamic())
    out = tf.maybe_log_diff(*args, rng=lambda: 0.0, now=3600.0 * 10)
    assert out["tile"] == "gfs_marine_waves_florida_east_coast.json" and out["tile_lattice"] == [13, 13]
    assert out["dynamic_lattice"] == [13, 11] and out["common_nodes"] > 0 and out["dH_m_p50_p90_max"][0] > 0.5   # the dynamic stub carries 2.x m, the tile 1.x m
    assert (out["tile_run"], out["dynamic_run"]) == ("2026-10-23T12:00:00Z", "2026-10-23T06:00:00Z")
    assert tf.maybe_log_diff(*args, rng=lambda: 0.0, now=3600.0 * 10 + 5) is None                # the hourly cap
    assert tf.TILE_FIRST_STATS["diff_skipped_cap"] == 1 and tf.TILE_FIRST_STATS["diff_logged"] == 1
    monkeypatch.setenv("MARINE_TILE_FIRST_DIFF_SAMPLE", "0.5")
    assert tf.maybe_log_diff(*args, rng=lambda: 0.99, now=3600.0 * 11) is None                   # sampled out
    monkeypatch.setenv("MARINE_REGIONAL_TILE_FIRST", "1")
    assert tf.maybe_log_diff(*args, rng=lambda: 0.0, now=3600.0 * 12) is None                    # flag on: the tile is served


def test_the_live_series_lane_is_skipped_inside_a_pilot_box_only_with_the_flag(monkeypatch):
    assert not tf.skips_live_series("GFS", "marine", "waves", False, INSIDE)
    monkeypatch.setenv("MARINE_REGIONAL_TILE_FIRST", "1")
    assert tf.skips_live_series("GFS", "marine", "swell_1", False, INSIDE)
    assert not tf.skips_live_series("GFS", "marine", "waves", False, "-60,10,-50,20")             # open Atlantic: no pilot box
    assert not tf.skips_live_series("ICON", "marine", "waves", False, INSIDE)
    assert not tf.skips_live_series("GFS", "marine", "waves", True, INSIDE)


def test_the_stats_report_the_flag_and_counts(monkeypatch):
    monkeypatch.setenv("MARINE_REGIONAL_TILE_FIRST", "1")
    tf.decide(_world(), "GFS", "marine", "waves", False, INSIDE, _world()._items, [])
    s = tf.tile_first_stats()
    assert s["enabled"] is True and s["counts"] == {"served_tile": 1} and s["diff_cap_per_hour"] == 30


def test_flag_on_the_client_s_tile_is_served_even_if_today_s_selection_drifts(monkeypatch):
    """Today's selection also lands on the smallest containing tile, so the two agree; the flag must not RELY on that. With the
    selection forced to the world tier (a future drift), the tile the client reads is still the tile served."""
    world_c = CoverageBounds(west=-180.0, south=-80.0, east=180.0, north=84.0)
    fl, world = _item("florida_east_coast", FL), _item("global_coarse", world_c)
    world.resolution, world.coverage_mode = 10.0, "global_tile"
    coarse = _product("GFS", NormalizedGrid(bounds=world_c, cols=37, rows=17, vectors=[GridVector(lat=28.0, lng=-82.0, speed=5.0)]),
                      world_c, world.filename)
    store = _Store([fl, world], {fl.filename: _product("GFS", _lattice(FL), FL, fl.filename), world.filename: coarse})
    monkeypatch.setattr(grid_resolver, "select_best_candidate", lambda *a, **k: world)
    monkeypatch.setattr(grid_resolver, "prefer_overlapping_marine_region", lambda item, *a, **k: item)   # no rescue either
    monkeypatch.setenv("MARINE_REGIONAL_TILE_FIRST", "1")
    out = _resolve(store, _Viewport(None), monkeypatch, INSIDE)
    assert out.product_id == fl.filename and (out.grid.cols, out.grid.rows) == (13, 13)


def test_flag_on_a_snapped_box_inside_the_data_whose_served_window_misses_the_request_is_partial(monkeypatch):
    """A lattice offset half a cell (nodes at x.125): the snapped box -83..-80 lies inside the data, but the served window starts at
    -82.875, west of which the request (-82.95) reaches: Step 3 would label it partial, so the tile is not claimed."""
    offset = CoverageBounds(west=-84.875, south=24.125, east=-79.125, north=30.875)
    fl = _item("florida_east_coast", FL)
    store = _Store([fl], {fl.filename: _product("GFS", _lattice(offset), FL, fl.filename)})
    assert tf.covering_tile(store, "GFS", "marine", "waves", False, "-82.95,27.6,-80.4,29.4", [fl], []) == (None, "partial_cover")
    assert tf.covering_tile(store, "GFS", "marine", "waves", False, "-82.8,27.6,-80.4,29.4", [fl], [])[0] is fl
