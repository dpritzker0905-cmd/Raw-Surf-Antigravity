"""Commitment 228 (owner report 2026-09-30 22:18Z): far-zoom FORECAST hours showed no swell until zoom-in.

Replayed live with the client's exact world page (GLOBAL_REQUEST_BBOX, 48 three-hourly offsets): 30 of 48 frames
alone, 16 of 48 beside its sibling page; OVERALL_DEADLINE (20 s) cut the tail of every page. Profiled on the live
manifest + 16 real global_mid files: 10.3 of 12.9 s was the mid tier deep-copying the whole ~15k-cell world clip
into its clip cache (sized for "tiny" clips before MAX_SPAN went to 400), and the per-cell steps after it ran on
cells grid_series then threw away. These tests pin the four changes, each of which serves the SAME cells:

  1. A series frame is strided inside the tier with grid_series' own `decimate_vectors`, so it is the frame the
     series would have built, `load_stride` stamped so the series does not stride it twice.
  2. A strided frame never touches the clip cache (its key has no stride) or the shared diagnostics dict.
  3. A clip above MARINE_MID_CLIP_CACHE_MAX_VECTORS is not deep-copied into the cache; small clips still are.
  4. find_candidates runs the island gate only on rows that already match model/domain/layer.
  5. The live Open-Meteo lane is skipped when its grid would be COARSER than stored products covering every hour.

Real-data equivalence (not in CI, the files are 2.35 MB each): 288 frames / 623,616 cells from 16 live global_mid
products, old code vs new at strides 2, 3 and 4, byte-identical (log 2026-09-30-c188, commitment 228).
"""
import asyncio
import copy
import inspect
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace as NS

import pytest

from services.weather_pipeline import grid_series_helper, mid_res_tier
from services.weather_pipeline.grid_series_helper import _build_grid_series_impl, _load_stride_of
from services.weather_pipeline.schemas import (
    CoverageBounds, GridVector, ManifestProduct, NormalizedGrid, NormalizedProduct,
)
from services.weather_pipeline.series_coordinates import generate_series_coords, series_resolution
from services.weather_pipeline.series_source_policy import live_lane_cannot_beat_stored
from services.weather_pipeline.series_vector_budget import decimate_vectors

TARGET = datetime(2026, 9, 30, 21, 0, tzinfo=timezone.utc)
WORLD = CoverageBounds(west=-180.0, south=-80.0, east=180.0, north=85.0)
WORLD_BBOX = "-180.0000,-80.0000,180.0000,85.0000"     # the client's GLOBAL_REQUEST_BBOX


def _mid_item():
    return ManifestProduct(
        model="GFS", provider="open-meteo", domain="marine", layer="waves",
        run_time=TARGET, valid_time_start=TARGET, valid_time_end=TARGET,
        resolution=5.0, freshness_sec=3600, is_forecast_authoritative=True,
        coverage=WORLD, filename="gfs_marine_waves_global_mid_test.json",
        product_id="gfs_marine_waves_global_mid_test.json",
        region_id="global_mid", coverage_mode="global_tile",
    )


def _world_product(res=5.0, diagnostics=None):
    """A rectangular, row-major (lat then lng ascending) world grid, as global_mid files are."""
    vectors = []
    lat = WORLD.south
    while lat <= WORLD.north:
        lng = WORLD.west
        while lng <= WORLD.east:
            # Distinct values per cell, so a wrong cell selection cannot compare equal by accident.
            vectors.append(GridVector(lat=lat, lng=lng, speed=round(1.0 + (lat + 90) / 100 + (lng + 180) / 1000, 4),
                                      direction=90.0, u=-1.0, v=0.0, period=10.0))
            lng += res
        lat += res
    return NormalizedProduct(
        model="GFS", provider="open-meteo", domain="marine", layer="waves",
        run_time=TARGET, valid_time=TARGET, is_forecast_authoritative=True,
        is_estimated=False, coverage=WORLD,
        grid=NormalizedGrid(bounds=WORLD, cols=int((WORLD.east - WORLD.west) / res) + 1,
                            rows=int((WORLD.north - WORLD.south) / res) + 1, vectors=vectors,
                            diagnostics=diagnostics if diagnostics is not None else {}),
        value_kind="wave_height", value_unit="m", display_unit_hint="ft",
        product_id="p.json", source_variables=["wave_height"], freshness_sec=3600,
        region_id="global_mid", coverage_mode="global_tile", resolution=res,
    )


class _Store:
    """Hands out a shallow copy over SHARED vectors and a SHARED diagnostics dict, as ProductStore's L1 does."""

    def __init__(self, product):
        self.product = product

    def load_product(self, filename):
        p = self.product.model_copy()
        p.grid = p.grid.model_copy()
        return p


@pytest.fixture(autouse=True)
def _fresh_tier_state(monkeypatch):
    # The tier keeps a module-level clip cache and a loop-bound semaphore; each test gets its own.
    monkeypatch.delattr(mid_res_tier, "_CLIP_CACHE", raising=False)
    monkeypatch.delattr(mid_res_tier, "_LOAD_SEM", raising=False)
    for k in ("MARINE_MID_CLIP_CACHE_MAX_VECTORS", "MARINE_MID_SERIES_STRIDE", "MARINE_MID_RES_TIER"):
        monkeypatch.delenv(k, raising=False)


def _serve(store, *, bbox=WORLD_BBOX, series_stride=None):
    from services.weather_pipeline.route_helpers import parse_bbox
    w, s, e, n = parse_bbox(bbox)
    return asyncio.run(mid_res_tier.try_serve_mid_res_tier(
        store, model="GFS", domain="marine", layer="waves", bbox=bbox,
        req_w=w, req_s=s, req_e=e, req_n=n, mid_auth=[(_mid_item(), 0)], mid_est=[],
        current_product=None, series_stride=series_stride,
    ))


def _cells(vectors):
    return [v.model_dump() for v in vectors]


@pytest.mark.parametrize("stride", [2, 3, 4])
def test_a_series_frame_is_exactly_the_frame_grid_series_would_have_built(stride):
    store = _Store(_world_product())
    full = _serve(store)
    strided = _serve(store, series_stride=stride)
    expected = decimate_vectors(full.grid.vectors, full.grid.cols, full.grid.rows, stride)
    assert expected is not None, "precondition: the fixture is a full rectangular grid"
    assert _cells(strided.grid.vectors) == _cells(expected[0])
    assert (strided.grid.cols, strided.grid.rows) == (expected[1], expected[2])
    assert strided.grid.bounds == full.grid.bounds, "decimate_vectors never moves bounds; neither may the tier"
    # The series reads this to skip its own stride; without it the frame comes back stride^2 too coarse.
    assert _load_stride_of(strided.grid) == stride


def test_a_strided_frame_never_reaches_the_clip_cache_or_the_shared_diagnostics():
    store = _Store(_world_product(diagnostics={"source": "l1"}))
    shared = store.product.grid.diagnostics   # the model's OWN dict (pydantic copied the one passed in)
    small = "-60.0000,20.0000,-40.0000,40.0000"          # a band clip: small enough to be cacheable
    strided = _serve(store, bbox=small, series_stride=3)
    assert strided.grid.diagnostics.get("load_stride") == 3
    assert "load_stride" not in shared and "mid_res_tier" not in shared, (
        "the stride stamp leaked into the L1 product's diagnostics: a later FULL read would look strided")
    assert not getattr(mid_res_tier, "_CLIP_CACHE", {}), "a strided clip was cached under a stride-less key"
    full = _serve(store, bbox=small)                      # /grid reads the same key: it must get the full clip
    assert full.grid.cols > strided.grid.cols and full.grid.rows > strided.grid.rows


def test_a_world_clip_is_not_deep_copied_but_a_small_one_still_is(monkeypatch):
    calls = []
    real = copy.deepcopy
    monkeypatch.setattr(copy, "deepcopy", lambda obj, *a, **k: calls.append(type(obj).__name__) or real(obj, *a, **k))
    monkeypatch.setenv("MARINE_MID_CLIP_CACHE_MAX_VECTORS", "1000")   # the 5 deg world fixture has 2,482 cells
    store = _Store(_world_product())
    world = _serve(store)
    assert len(world.grid.vectors) > 1000
    assert calls == [], "a world-size clip was deep-copied into the clip cache (the measured 10.3 s)"
    _serve(store, bbox="-60.0000,20.0000,-40.0000,40.0000")
    assert calls == ["NormalizedProduct"], "a small clip must still be cached exactly as before"


def test_a_world_clip_served_twice_is_the_same_grid_with_or_without_the_cache():
    store = _Store(_world_product())
    first, second = _serve(store), _serve(store)
    assert _cells(first.grid.vectors) == _cells(second.grid.vectors)
    assert (first.grid.cols, first.grid.rows, first.grid.bounds) == (second.grid.cols, second.grid.rows, second.grid.bounds)


@pytest.mark.parametrize("value", [None, "x", 0, 1, -3])
def test_an_unusable_stride_serves_the_full_clip(value):
    store = _Store(_world_product())
    full = _serve(store)
    got = _serve(store, series_stride=value)
    assert (got.grid.cols, got.grid.rows) == (full.grid.cols, full.grid.rows)
    assert "load_stride" not in (got.grid.diagnostics or {})


@pytest.mark.parametrize("value,expected", [(3, 3), (2, 2), (1, 1), (0, 1), (-3, 1), ("4", 4), ("x", 1), (None, 1)])
def test_the_stride_helper_returns_a_usable_stride_or_1(value, expected):
    # The contract every caller relies on: never a stride below 2 except the "none" value 1.
    assert mid_res_tier._series_stride(value) == expected


def test_the_series_stride_kill_switch_restores_the_full_clip(monkeypatch):
    monkeypatch.setenv("MARINE_MID_SERIES_STRIDE", "0")
    store = _Store(_world_product())
    got = _serve(store, series_stride=3)
    assert (got.grid.cols, got.grid.rows) == (73, 34)


def test_resolve_grid_hands_the_stride_to_the_tier_never_for_surf_and_skips_the_series_truth_tag():
    # The tier is gated off under pytest (is_test_environment), so the wiring is pinned at the source.
    from services.weather_pipeline import grid_resolver
    src = inspect.getsource(grid_resolver.resolve_grid)
    assert 'series_stride=None if surf else _load_kw(series_stride).get("stride")' in src
    assert "and not _load_kw(series_stride):" in src


# ── 4. the island gate after the cheap match ───────────────────────────────────────────────────────
def test_find_candidates_gates_only_matching_rows_and_returns_the_same_set(monkeypatch):
    from services.weather_pipeline import grid_resolver_selection, island_gate
    seen = []
    real = island_gate.is_island_gated
    monkeypatch.setattr(island_gate, "is_island_gated", lambda p: seen.append(p.region_id) or real(p))

    def row(model, region, hours=0):
        return NS(model=model, domain="marine", layer="waves", region_id=region, is_estimated=False,
                  valid_time_start=TARGET + timedelta(hours=hours))
    rows = [row("EURO", f"r{i}") for i in range(50)] + [row("GFS", "global_mid"), row("GFS", "island_x"),
                                                         row("GFS", "global_coarse", hours=9)]
    auth, est = grid_resolver_selection.find_candidates(NS(products=rows), "GFS", "marine", "waves", TARGET)
    assert sorted(seen) == ["global_coarse", "global_mid", "island_x"], "the gate ran on non-matching rows"
    assert [p.region_id for p, _ in auth] == ["global_mid"] and est == [], "island and off-time rows must stay out"


# ── 5. the live lane at a world bbox ────────────────────────────────────────────────────────────────
BASE = datetime(2026, 9, 30, 21, tzinfo=timezone.utc)


def _stored(hour, **changes):
    fields = dict(model="GFS", domain="marine", layer="waves", provider="open-meteo", upstream_provider="noaa",
                  is_test_fixture=False, is_estimated=False, is_forecast_authoritative=True, resolution=2.0,
                  coverage=NS(west=-180, south=-80, east=180, north=85),
                  valid_time_start=BASE + timedelta(hours=hour))
    fields.update(changes)
    return NS(**fields)


def _vp(products):
    return NS(store=NS(get_manifest=lambda: NS(products=products)), normalizer=None)


def _cannot_beat(products, bbox=WORLD_BBOX, hours=(0, 3)):
    return asyncio.run(live_lane_cannot_beat_stored(_vp(products), "GFS", "marine", "waves", bbox, list(hours), BASE))


def test_a_world_live_grid_cannot_beat_stored_2deg_products_covering_every_hour():
    assert series_resolution(-180, -80, 180, 85) == 15.0, "precondition: the live world grid is 15 deg"
    assert _cannot_beat([_stored(0), _stored(3)])


def test_any_doubt_keeps_the_live_lane(monkeypatch):
    assert not _cannot_beat([_stored(0)]), "an hour without a stored product"
    assert not _cannot_beat([_stored(0), _stored(3, upstream_provider="open-meteo")])
    assert not _cannot_beat([_stored(0), _stored(3, resolution=20.0)]), "stored no finer than live"
    assert not _cannot_beat([_stored(0), _stored(3)], bbox="-81,27,-80,28"), "a regional bbox is T-01's call"
    assert series_resolution(-100, 0, -60, 40) == 2.0
    assert not _cannot_beat([_stored(0), _stored(3, coverage=NS(west=-100, south=0, east=-60, north=40))],
                            bbox="-100,0,-60,40"), "EQUAL resolution is not coarser"
    monkeypatch.setenv("SERIES_LIVE_SKIP_COARSE", "0")
    assert not _cannot_beat([_stored(0), _stored(3)])


def test_a_world_series_page_never_waits_on_the_live_lane(monkeypatch):
    calls = {"live": 0, "stored": 0}

    async def live(*a, **k):
        calls["live"] += 1
        return None

    async def resolve(*, model, domain, layer, valid_time, bbox, surf=False, background_tasks=None, request=None):
        calls["stored"] += 1
        return _world_product()

    monkeypatch.setenv("GFS_ICON_SERIES_FASTPATH", "1")
    monkeypatch.setattr(grid_series_helper, "_build_openmeteo_marine_series", live)
    out = asyncio.run(_build_grid_series_impl(resolve, _vp([_stored(0), _stored(3)]), "GFS", "marine", "waves",
                                              WORLD_BBOX, "0,3", base_anchor=BASE))
    assert calls == {"live": 0, "stored": 2}
    assert out["frame_count"] == 2


@pytest.mark.parametrize("bbox", [(-180, -80, 180, 85), (-81, 27, -80, 28), (-100, 0, -60, 40), (170, -10, -170, 10),
                                  (-84, 24, -76, 32), (0, 0, 0.1, 0.1)])
def test_series_resolution_is_the_resolution_generate_series_coords_uses(bbox):
    assert series_resolution(*bbox) == generate_series_coords(*bbox)[0]
