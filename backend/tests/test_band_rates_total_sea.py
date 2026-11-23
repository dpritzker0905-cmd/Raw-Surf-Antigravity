"""Bug hunt 2026-11-22 item D: the map rating band rates the TOTAL sea on every marine layer, like the glyphs.

`apply_surf_overlay` ran the band on whatever layer was shown, so over Swell 1 / Swell 2 / Wind Waves it graded that ONE
partition as if it were the whole sea (one point: total 85.3, swell_1 98.6, wind_waves 61.0), while the glyph beside it
rates `waves`. The owner, 2026-11-22: "Rate the whole sea".

Fix (ONE FORECAST COMPOSITION, nothing re-derived): on a partition layer each cell is rated on the total-sea product the
POINT RESOLVER would answer that cell from (`manifest_point_selection`, as the band's wind and the glyph's point already
are), through the unchanged band chain. The partition's own height (phys_speed), period, direction and u/v are restored,
so the wave animation under the band is the partition's, as before. Guarded flag BAND_RATES_TOTAL_SEA, ON; kill '0'."""
import asyncio
import os
import sys
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services import runtime_flags as RF  # noqa: E402
from services.weather_pipeline.grid_resolver_surf import apply_surf_overlay  # noqa: E402
from services.weather_pipeline.schemas import (  # noqa: E402
    CoverageBounds, GridVector, ManifestProduct, NormalizedGrid, NormalizedProduct)

NOW = datetime(2026, 11, 22, 12, 0, tzinfo=timezone.utc)
BOX = (-81.5, 26.5, -79.5, 29.5)                       # Florida's Atlantic coast: coastal and open-ocean cells
CELLS = [(26.5 + 0.25 * i, -81.5 + 0.25 * j) for i in range(13) for j in range(9)]
TOTAL = dict(speed=2.0, period=10.0, direction=80.0)   # the whole sea
SWELL1 = dict(speed=1.0, period=15.0, direction=95.0, u=0.3, v=-0.2)   # one partition


def _product(layer, field):
    w, s, e, n = BOX
    vecs = [GridVector(lat=la, lng=ln, **field) for la, ln in CELLS]
    return NormalizedProduct(
        model="GFS", provider="open-meteo", domain="marine", layer=layer, run_time=NOW, valid_time=NOW,
        is_forecast_authoritative=True, is_estimated=False, coverage=CoverageBounds(west=w, south=s, east=e, north=n),
        grid=NormalizedGrid(bounds=CoverageBounds(west=w, south=s, east=e, north=n), cols=9, rows=13, vectors=vecs),
        value_kind="wave_height", value_unit="m", display_unit_hint="ft", source_variables=["wave_height"],
        freshness_sec=3600)


def _manifest(with_waves=True):
    w, s, e, n = BOX
    prods = [] if not with_waves else [ManifestProduct(
        model="GFS", provider="open-meteo", domain="marine", layer="waves", run_time=NOW, valid_time_start=NOW,
        valid_time_end=NOW + timedelta(hours=1), resolution=0.25, freshness_sec=3600, is_forecast_authoritative=True,
        region_id="florida_east_coast", coverage=CoverageBounds(west=w, south=s, east=e, north=n),
        filename="gfs_marine_waves_florida_east_coast_20261122T120000Z.json")]
    return SimpleNamespace(products=prods)


class _Store:
    def __init__(self):
        self.loads = []

    def load_product(self, filename):
        self.loads.append(filename)
        return _product("waves", TOTAL)


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    for k in ("RATING_LOCAL_SIZE", "RATING_OBS_GATE"):   # both read Supabase L2 blobs: off for an offline test
        monkeypatch.setenv(k, "0")
    for k in ("BAND_RATES_TOTAL_SEA", "SURF_TRANSFORM", "SURF_RATING", "COPERNICUS_ISLAND_SERVE"):
        monkeypatch.delenv(k, raising=False)


def _band(layer, field, manifest=None, store=None):
    return asyncio.run(apply_surf_overlay(
        _product(layer, field), store=store or _Store(), manifest=manifest or _manifest(), model="GFS",
        domain="marine", layer=layer, surf=True, target_dt=NOW))


def _rated(p):
    return {(v.lat, v.lng): v for v in p.grid.vectors if v.is_valid and v.phys_speed is not None}


def test_flag_is_guarded_and_on():
    assert RF.GUARDED["BAND_RATES_TOTAL_SEA"] == "1"


@pytest.mark.parametrize("layer", ["swell_1", "swell_2", "wind_waves"])
def test_a_partition_band_scores_exactly_the_total_sea_band(layer):
    total = _rated(_band("waves", TOTAL))
    part = _rated(_band(layer, SWELL1))
    assert len(total) >= 3, "the fixture must rate some coastal cells"
    assert set(part) == set(total)
    for k, v in total.items():
        assert part[k].speed == v.speed, f"{layer} {k}: band {part[k].speed} != total-sea band {v.speed}"


def test_the_partition_keeps_its_own_height_period_direction_and_motion():
    for v in _band("swell_1", SWELL1).grid.vectors:
        assert (v.period, v.direction, v.u, v.v) == (15.0, 95.0, 0.3, -0.2)
        if v.phys_speed is not None:
            assert v.phys_speed == 1.0                       # crests animate the partition, as before
        if v.phys_speed is None or not v.is_valid:
            assert v.speed == 1.0                            # unrated and masked cells keep the honest partition height


def test_the_waves_layer_is_byte_identical_and_loads_nothing_extra():
    store = _Store()
    asyncio.run(apply_surf_overlay(_product("waves", TOTAL), store=store, manifest=_manifest(), model="GFS",
                                   domain="marine", layer="waves", surf=True, target_dt=NOW))
    assert store.loads == []


def test_no_total_sea_product_means_no_partition_rating():
    out = _band("swell_1", SWELL1, manifest=_manifest(with_waves=False))
    assert _rated(out) == {}, "with no total sea to rate, the band must not grade the partition as the sea"
    assert out.grid.diagnostics["surf_transform"]["total_sea"] == "unavailable"
    assert all(v.speed == 1.0 for v in out.grid.vectors)


def test_the_tag_says_what_was_rated():
    tag = _band("swell_1", SWELL1).grid.diagnostics["surf_transform"]
    assert tag["total_sea"] == "waves" and tag["value_kind"] == "surf_rating"


def test_kill_switch_rates_the_partition_again(monkeypatch):
    monkeypatch.setenv("BAND_RATES_TOTAL_SEA", "0")
    total = _rated(_band("waves", TOTAL))
    part = _rated(_band("swell_1", SWELL1))
    assert any(part[k].speed != total[k].speed for k in set(part) & set(total)) or set(part) != set(total)


# ── Second-opinion follow-ups (Reflection, 2026-11-23; log in research/bug-hunt-D-second-opinions-2026-11-23.md) ──────────

class _MixedStore(_Store):
    """A total sea that is calm (0 m) in the west half and 2 m in the east half."""

    def load_product(self, filename):
        self.loads.append(filename)
        p = _product("waves", TOTAL)
        for v in p.grid.vectors:
            if v.lng < -80.5:
                v.speed = 0.0
        return p


def test_a_calm_total_sea_cell_is_unrated_partition_not_a_neighbours_swell():
    """A 0 m total-sea node is a real calm, not 'no data': the cell stays the (valid, unrated) partition. It must not borrow
    the nearest NONZERO node's swell, nor be masked as unavailable."""
    out = _band("swell_1", SWELL1, store=_MixedStore())
    west = [v for v in out.grid.vectors if v.lng < -80.6]
    assert west and all(v.speed == 1.0 for v in west)
    assert not any(v.phys_speed is not None and v.is_valid for v in west), "a calm total sea was rated"
    assert all(v.is_valid for v in west if v.phys_speed is None), "a calm cell was masked as if it had no data"


def test_a_failing_rating_restores_the_partition(monkeypatch):
    """If the rating throws after the swap, the served grid must still be the partition, never total-sea values under a
    partition label."""
    from services.weather_pipeline import surf_rating

    def boom(*a, **k):
        raise RuntimeError("rating failed")
    monkeypatch.setattr(surf_rating, "rating_transform_grid", boom)
    out = _band("swell_1", SWELL1)
    assert "surf_skip_reason" in (out.grid.diagnostics or {})
    for v in out.grid.vectors:
        assert (v.speed, v.period, v.direction, v.phys_speed, v.is_valid) == (1.0, 15.0, 95.0, None, True)


def test_the_shared_cached_product_is_never_mutated():
    src = _product("swell_1", SWELL1)
    before = [v.model_dump() for v in src.grid.vectors]
    asyncio.run(apply_surf_overlay(src, store=_Store(), manifest=_manifest(), model="GFS", domain="marine",
                                   layer="swell_1", surf=True, target_dt=NOW))
    assert [v.model_dump() for v in src.grid.vectors] == before
