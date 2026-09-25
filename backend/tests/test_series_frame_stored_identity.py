"""
A15-09 / A15-10 (audit 15.0, 2026-09-25): a series frame must say WHICH stored product it is, so
the client can ask `/point` for the value of the very frame it drew.

Measured live: `/grid_series` frames carried no product_id / region_id / upstream_model, so the
frontend minted `series_GFS_waves_h0` and the infobox fell back to a diagnostic that goes stale on
the series path. The infobox then sampled a different product from the one on the map.

Second half: `/point` with an id whose file is not (yet) loadable on this box used to answer a
grid MISS (speed None: a blank infobox). It now falls through to automatic selection, exactly as
the temporal-swap branch above it already did.
"""
import asyncio
from types import SimpleNamespace as S

import pytest

from services.weather_pipeline.point_resolution import PointResolutionService
from tests.test_grid_series_frame_provenance import _build, _product, _BASE_RUN
from tests.test_dynamic_cycle_selection import fixture


def test_series_frames_name_the_stored_product_they_came_from():
    async def resolve(*, model, domain, layer, valid_time, bbox,
                      surf=False, background_tasks=None, request=None):
        p = _product(_BASE_RUN, upstream="noaa", dataset="ncep_gfswave025")
        p.product_id = "gfs_marine_waves_florida_east_coast_20260809T060000Z.json"
        p.region_id = "florida_east_coast"
        p.upstream_model = "ncep_gfswave025"
        return p

    resp = _build(resolve)
    assert resp["frame_count"] == 2
    for f in resp["frames"]:
        assert f["product_id"] == "gfs_marine_waves_florida_east_coast_20260809T060000Z.json"
        assert f["region_id"] == "florida_east_coast"
        assert f["upstream_model"] == "ncep_gfswave025"


def test_a_product_without_an_id_serializes_none_never_a_guess():
    async def resolve(*, model, domain, layer, valid_time, bbox,
                      surf=False, background_tasks=None, request=None):
        p = _product(_BASE_RUN)
        p.product_id = None
        return p

    for f in _build(resolve)["frames"]:
        assert f["product_id"] is None
        assert f["region_id"] is None


@pytest.mark.asyncio
@pytest.mark.parametrize("missing", ["not_on_disk", "empty_grid"])
async def test_point_with_an_unloadable_id_falls_through_instead_of_blanking(monkeypatch, missing):
    async def passthrough(response, *args):
        return response
    monkeypatch.setattr('services.weather_pipeline.point_resolution.augment_with_surf', passthrough)
    old, new, item = fixture()
    requested = "viewport_gfs_marine_waves_not_written_yet.json"

    def load(name):
        if name == requested:
            if missing == "not_on_disk":
                return None
            empty = new.model_copy(deep=True)
            empty.grid.vectors = []
            return empty
        return {old.product_id: old, new.product_id: new}[name]

    store = S(get_manifest=lambda: S(products=[item]), load_product=load)
    resolver = PointResolutionService(store=store, provider=S(),
                                      dynamic_index=S(find_product_containing=lambda **kw: None))
    response = await resolver.resolve_point('GFS', 'marine', 'waves', 28, -80, new.valid_time.isoformat(),
                                            grid_product_id=requested)
    assert not isinstance(response, dict) and hasattr(response, "point"), "a real sample, not a miss"
    assert response.product_id == new.product_id
    assert response.point.speed == 2


@pytest.mark.asyncio
async def test_a_loadable_id_is_still_honoured_strictly(monkeypatch):
    async def passthrough(response, *args):
        return response
    monkeypatch.setattr('services.weather_pipeline.point_resolution.augment_with_surf', passthrough)
    old, new, item = fixture()
    store = S(get_manifest=lambda: S(products=[item]),
              load_product=lambda name: {old.product_id: old, new.product_id: new}[name])
    resolver = PointResolutionService(store=store, provider=S(),
                                      dynamic_index=S(find_product_containing=lambda **kw: None))
    response = await resolver.resolve_point('GFS', 'marine', 'waves', 28, -80, new.valid_time.isoformat(),
                                            grid_product_id=old.product_id)
    assert response.product_id == old.product_id      # the drawn product, even though `new` is newer
    assert response.point.speed == 1
