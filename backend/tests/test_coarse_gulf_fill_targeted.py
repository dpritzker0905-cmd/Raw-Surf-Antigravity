"""MARINE_GULF_FILL_MID_TARGETED: on the 2-deg world grid, fill a masked EURO/ICON cell only from the same-layer GFS 2-deg value at
the SAME node, and only where that node is sea.

WHY THIS EXISTS (2026-10-23, the owner's decision 09:56 EDT)
------------------------------------------------------------
The fill was built for the 10-deg tier (coarse_gulf_fill docstring). On the 2-deg global_mid its 8-deg reach from GFS 10-deg cells
painted coast, land and ice (live 2026-10-22: EURO 2,465 of 4,689 masked cells, ICON 1,708 of 3,788). Switching it off would
blank real sea: EURO's own 2-deg grid masks 870 GFS-sea nodes (Gulf of Mexico 15/59, Mediterranean 44/113, Baltic 26/45, ...).
The owner: "build the targeted fill dark (only fill EURO/ICON 2-deg cells where GFS 2-deg is sea, stop painting land/ice), then
show me the before/after before switching it on". These tests pin the rule, its donor, its provenance, that the 10-deg tier is
untouched, the flag order, and the /capabilities report.
"""
import asyncio
import types
from datetime import datetime, timezone

import pytest

from services.weather_pipeline import coarse_gulf_fill as gf
from services.weather_pipeline.capabilities import get_weather_capabilities
from services.weather_pipeline.schemas import CoverageBounds, GridVector, NormalizedGrid, NormalizedProduct

_VT = "2026-10-23T00:00:00Z"
_VT_DT = datetime(2026, 10, 23, tzinfo=timezone.utc)
_WORLD = CoverageBounds(west=-180.0, south=-80.0, east=180.0, north=84.0)
SEA_GULF = (26.0, -90.0)        # masked by EURO, sea in GFS 2-deg: must be filled from GFS 2-deg
INLAND_TX = (32.0, -98.0)       # masked by EURO and by GFS 2-deg (land): must stay masked
COAST_NEAR = (30.0, -84.0)      # masked by EURO; GFS 2-deg is sea only one node away (28, -84): no reach, stays masked
OPEN_SEA = (0.0, 0.0)           # valid in EURO: untouched


def _vec(latlng, speed, valid=True, direction=200.0, period=9.0):
    la, lo = latlng
    if not valid:
        return GridVector(lat=la, lng=lo, speed=0.0, is_valid=False)
    return GridVector(lat=la, lng=lo, speed=speed, direction=direction, u=-0.5, v=0.7, period=period, is_valid=True)


def _product(model, region, layer, vectors, cols, filename):
    grid = NormalizedGrid(bounds=_WORLD, cols=cols, rows=83, vectors=vectors)
    return NormalizedProduct(
        model=model, provider="open-meteo", domain="marine", layer=layer, run_time=_VT_DT, valid_time=_VT_DT,
        is_forecast_authoritative=True, is_estimated=False, coverage=_WORLD, grid=grid, value_kind="wave_height",
        value_unit="m", display_unit_hint="ft", source_variables=[], freshness_sec=1800,
        resolution=2.0 if region == "global_mid" else 10.0, region_id=region, product_id=filename)


def _recipient(model="EURO", layer="waves", region="global_mid"):
    vecs = [_vec(SEA_GULF, 0, False), _vec(INLAND_TX, 0, False), _vec(COAST_NEAR, 0, False), _vec(OPEN_SEA, 1.5)]
    return _product(model, region, layer, vecs, 181 if region == "global_mid" else 37, f"{model.lower()}_{layer}_{region}.json")


class _Store:
    """The donors the fill can reach: GFS global_mid (2-deg) and global_coarse (10-deg), for waves and swell_1."""

    def __init__(self, mid_vt=_VT):
        self.products, self.items = {}, []
        for layer, mid_speed, coarse_speed in (("waves", 1.25, 3.0), ("swell_1", 0.75, 2.0)):
            mid = [_vec(SEA_GULF, mid_speed, direction=111.0, period=7.5), _vec(INLAND_TX, 0, False),
                   _vec((28.0, -84.0), 0.9), _vec(COAST_NEAR, 0, False)]
            coarse = [_vec((25.0, -90.0), coarse_speed), _vec((30.0, -95.0), coarse_speed), _vec((30.0, -85.0), coarse_speed)]
            for region, vecs, vt in (("global_mid", mid, mid_vt), ("global_coarse", coarse, _VT)):
                name = f"gfs_marine_{layer}_{region}.json"
                self.products[name] = _product("GFS", region, layer, vecs, 181 if region == "global_mid" else 37, name)
                self.items.append(types.SimpleNamespace(model="GFS", domain="marine", layer=layer, region_id=region,
                                                        valid_time_start=vt, filename=name))

    def get_manifest(self):
        return types.SimpleNamespace(products=self.items)

    def load_product(self, filename):
        return self.products.get(filename)


def _fill(product, store=None):
    return asyncio.run(gf.fill_coarse_enclosed_sea_from_gfs_served(product, store or _Store(), product.model, "marine",
                                                                    product.layer))


def _by_node(product):
    return {(v.lat, v.lng): v for v in product.grid.vectors}


@pytest.fixture(autouse=True)
def _flags(monkeypatch):
    for k in ("MARINE_GULF_FILL_MID", "MARINE_GULF_FILL_MID_TARGETED", "MARINE_COARSE_GULF_FILL"):
        monkeypatch.delenv(k, raising=False)


@pytest.mark.parametrize("model", ["EURO", "ICON"])
def test_targeted_fills_only_where_the_gfs_2deg_node_is_sea_with_its_own_values(monkeypatch, model):
    monkeypatch.setenv("MARINE_GULF_FILL_MID_TARGETED", "1")
    src = _recipient(model)
    out = _fill(src)
    cells = _by_node(out)
    gulf = cells[SEA_GULF]
    assert gulf.is_valid and (gulf.speed, gulf.direction, gulf.period) == (1.25, 111.0, 7.5)   # the GFS 2-deg value, not 10-deg
    assert not cells[INLAND_TX].is_valid                       # land in GFS too: no paint
    assert not cells[COAST_NEAR].is_valid                      # no reach: a sea node next door does not fill it
    assert cells[OPEN_SEA].speed == 1.5
    assert out.coarse_fill == {"donor_model": "GFS", "layer": "waves", "mode": "targeted", "donor_region": "global_mid",
                               "donor_product": "gfs_marine_waves_global_mid.json", "cells_filled": 1, "cells_masked": 3,
                               "cells_total": 4}
    assert all(not v.is_valid for v in src.grid.vectors[:3])   # the input (possibly the cache's) is never written to


def test_today_s_fill_paints_land_the_targeted_one_does_not(monkeypatch):
    legacy = _by_node(_fill(_recipient()))
    assert legacy[INLAND_TX].is_valid and legacy[INLAND_TX].speed == 3.0     # the 8-deg reach from a 10-deg cell
    monkeypatch.setenv("MARINE_GULF_FILL_MID_TARGETED", "1")
    assert not _by_node(_fill(_recipient()))[INLAND_TX].is_valid


def test_the_donor_is_the_same_layer(monkeypatch):
    monkeypatch.setenv("MARINE_GULF_FILL_MID_TARGETED", "1")
    out = _fill(_recipient(layer="swell_1"))
    assert _by_node(out)[SEA_GULF].speed == 0.75 and out.coarse_fill["donor_product"] == "gfs_marine_swell_1_global_mid.json"


def test_the_10deg_tier_keeps_today_s_fill_under_the_targeted_flag(monkeypatch):
    monkeypatch.setenv("MARINE_GULF_FILL_MID_TARGETED", "1")
    out = _fill(_recipient(region="global_coarse"))
    assert out.coarse_fill["cells_filled"] == 3 and "mode" not in out.coarse_fill   # every masked cell, from the 10-deg donor


def test_fill_off_wins_over_targeted_and_a_missing_donor_serves_the_grid_as_stored(monkeypatch):
    monkeypatch.setenv("MARINE_GULF_FILL_MID_TARGETED", "1")
    stale = _Store(mid_vt="2026-10-23T09:00:00Z")              # GFS 2-deg 9 h away: no honest donor
    src = _recipient()
    assert _fill(src, stale) is src
    monkeypatch.setenv("MARINE_GULF_FILL_MID", "0")
    assert _fill(src) is src and gf.gulf_fill_mid_mode() == "off"


def test_capabilities_report_the_mode(monkeypatch):
    def rows():
        return [r for r in get_weather_capabilities() if r.get("domain") == "marine" and r.get("model") in ("EURO", "ICON")]
    assert rows() and all((r["gulf_fill_mid"], r["gulf_fill_mid_mode"]) == (True, "legacy") for r in rows())
    monkeypatch.setenv("MARINE_GULF_FILL_MID_TARGETED", "1")
    assert all((r["gulf_fill_mid"], r["gulf_fill_mid_mode"]) == (True, "targeted") for r in rows())   # the client guard stays
    monkeypatch.setenv("MARINE_GULF_FILL_MID", "0")
    assert all((r["gulf_fill_mid"], r["gulf_fill_mid_mode"]) == (False, "off") for r in rows())
    assert all("gulf_fill_mid_mode" not in r for r in get_weather_capabilities() if r.get("model") == "GFS")
