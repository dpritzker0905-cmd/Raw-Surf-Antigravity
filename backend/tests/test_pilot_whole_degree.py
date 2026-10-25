"""GFS_PILOT_WHOLE_DEGREE_BOUNDS (dark, 2026-10-25): GFS pilot tiles stored out to whole degrees on their fractional edges.

Mid-zoom's clean-store matrix (2026-10-24): at the Biscay north edge one session was answered 7 times by the stored tile and 7 times by
the dynamic cache. The tile's data stops at 48.8 N while the server's dynamic cache and MARINE_REGIONAL_TILE_FIRST work on the 1-deg
snapped box (north 49), so tile-first declines every view north of 48.0 and the cache state picks the source per hour.
Pins: the padding (which edges move, which stay: no edge moves into another box), the flag (off = the configs unchanged), the resolver
(unpadded: the source follows the cache state; padded: the tile whatever the cache holds), and the series-lane skip in the band.
"""
import asyncio
import types
from datetime import datetime, timezone

import pytest

from services.weather_pipeline import grid_resolver
from services.weather_pipeline import pilot_regions as pr
from services.weather_pipeline import regional_tile_first as tf
from services.weather_pipeline.schemas import CoverageBounds, GridVector, NormalizedGrid, NormalizedProduct

_VT = "2026-10-23T12:00:00Z"
_VT_DT = datetime(2026, 10, 23, 12, tzinfo=timezone.utc)
EDGE_BOX = "-3.5,48.1,-2.5,48.7"            # inside france_biscay; snapped (1 deg) to -4,48,-2,49: past the 48.8 N data edge
EXPECTED = {                                 # every fractional edge outward to the next whole degree, except into another box
    "us_southeast_midatlantic": (-82.0, 31.0, -74.0, 37.5),   # north 37.5 stays: us_northeast starts there
    "azores": (-30.0, 36.0, -24.0, 41.0),
    "us_northeast": (-77.0, 37.5, -69.0, 45.0),              # south 37.5 stays: us_southeast_midatlantic ends there
    "france_biscay": (-6.0, 42.0, 1.0, 49.0),
}


def _b(c):
    return (c["west"], c["south"], c["east"], c["north"])


def test_the_padding_moves_every_fractional_edge_outward_except_into_another_box():
    boxes = pr.all_gfs_pilot_boxes()
    padded = pr.pad_whole_degree(boxes)
    assert {rid: _b(c) for rid, c in padded.items() if _b(c) != _b(boxes[rid])} == EXPECTED
    for rid, c in padded.items():                                  # whole degrees everywhere but the two shared 37.5 N edges
        frac = [v for v in _b(c) if abs(v - round(v)) > 1e-9]
        assert frac == ([] if rid not in ("us_southeast_midatlantic", "us_northeast") else [37.5]), rid
        assert c["resolution"] == boxes[rid]["resolution"]
    ids = sorted(padded)
    for i, a in enumerate(ids):                                    # still no two boxes share any interior
        for b in ids[i + 1:]:
            assert not pr._overlaps_interior(padded[a], padded[b]), (a, b)
    assert _b(boxes["france_biscay"]) == (-6.0, 42.5, 1.0, 48.8)   # pure: the configs are never written


def test_the_flag_gates_the_gfs_pass_only(monkeypatch):
    monkeypatch.setattr(pr, "get_all_pilot_regions", lambda: {**pr.REGIONAL_CONFIGS, **pr.WORLDWIDE_COASTAL_REGIONS})
    monkeypatch.delenv("GFS_PILOT_WHOLE_DEGREE_BOUNDS", raising=False)
    off = pr.get_gfs_marine_pilot_regions()
    assert _b(off["france_biscay"]) == (-6.0, 42.5, 1.0, 48.8) and _b(off["azores"]) == (-29.8, 36.0, -24.0, 40.1)
    monkeypatch.setenv("GFS_PILOT_WHOLE_DEGREE_BOUNDS", "1")
    on = pr.get_gfs_marine_pilot_regions()
    assert set(on) == set(off)
    assert {rid: _b(on[rid]) for rid in EXPECTED if rid in on} == {rid: v for rid, v in EXPECTED.items() if rid in on}
    assert _b(pr.get_all_pilot_regions()["france_biscay"]) == (-6.0, 42.5, 1.0, 48.8)   # ICON / EURO pilots: unchanged


def test_the_series_lane_skip_covers_the_padded_band_only_with_the_flag(monkeypatch):
    monkeypatch.delenv("GFS_PILOT_WHOLE_DEGREE_BOUNDS", raising=False)
    assert tf.inside_pilot_box("-3.5,48.1,-2.5,48.9") is False      # north 48.9: past 48.8, inside the padded 49
    assert tf.inside_pilot_box(EDGE_BOX) is True
    monkeypatch.setenv("GFS_PILOT_WHOLE_DEGREE_BOUNDS", "1")
    assert tf.inside_pilot_box("-3.5,48.1,-2.5,48.9") is True
    assert tf.inside_pilot_box("-3.5,48.1,-2.5,49.1") is False      # past the padded tile too: today's path


# ── the resolver: which source answers the edge box ────────────────────────────────────────────────────────────────────────
def _lattice(c, res=0.25):
    cols, rows = int(round((c.east - c.west) / res)) + 1, int(round((c.north - c.south) / res)) + 1
    vecs = [GridVector(lat=round(c.south + r * res, 4), lng=round(c.west + k * res, 4), speed=1.0 + r / 100.0, direction=90.0,
                       u=-1.0, v=0.0, period=9.0, is_valid=True) for r in range(rows) for k in range(cols)]
    return NormalizedGrid(bounds=c, cols=cols, rows=rows, vectors=vecs)


def _product(c, pid):
    p = NormalizedProduct(model="GFS", provider="noaa", domain="marine", layer="waves", run_time=_VT_DT, valid_time=_VT_DT,
                          is_forecast_authoritative=True, is_estimated=False, coverage=c, grid=_lattice(c), value_kind="wave_height",
                          value_unit="m", display_unit_hint="ft", source_variables=[], freshness_sec=1800, product_id=pid)
    p.model_run_time = "2026-10-23T12:00:00Z"
    return p


class _Store:
    def __init__(self, c):
        self.item = types.SimpleNamespace(model="GFS", domain="marine", layer="waves", valid_time_start=_VT_DT, is_estimated=False,
                                          coverage=c, resolution=0.25, filename="gfs_marine_waves_france_biscay.json",
                                          region_id="france_biscay", coverage_mode="regional_tile")
        self.product = _product(c, self.item.filename)

    def get_manifest(self):
        return types.SimpleNamespace(products=[self.item])

    def load_product(self, filename, **kw):
        return self.product.model_copy() if filename == self.item.filename else None


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


def _dynamic():
    c = CoverageBounds(west=-4.0, south=48.0, east=-2.0, north=49.0)
    p = _product(c, "dyn_viewport_gfs")
    p.is_dynamic_viewport_product, p.coverage_mode = True, "viewport"
    return p


def _source(monkeypatch, tile, cache_hit):
    import services.weather_pipeline.store as store_mod
    monkeypatch.setattr(store_mod, "is_test_environment", lambda: False)
    monkeypatch.setenv("MARINE_REGIONAL_TILE_FIRST", "1")
    vp = _Viewport(_dynamic() if cache_hit else None)
    out = asyncio.run(grid_resolver.resolve_grid(_Store(tile), vp, model="GFS", domain="marine", layer="waves", valid_time=_VT,
                                                 bbox=EDGE_BOX))
    return getattr(out, "product_id", None) or (out.get("product_id") if isinstance(out, dict) else None)


@pytest.mark.parametrize("padded, want", [(False, {True: "dyn_viewport_gfs", False: "gfs_marine_waves_france_biscay.json"}),
                                          (True, {True: "gfs_marine_waves_france_biscay.json",
                                                  False: "gfs_marine_waves_france_biscay.json"})])
def test_the_edge_box_source_follows_the_cache_unpadded_and_is_the_tile_padded(monkeypatch, padded, want):
    b = EXPECTED["france_biscay"] if padded else (-6.0, 42.5, 1.0, 48.8)
    tile = CoverageBounds(west=b[0], south=b[1], east=b[2], north=b[3])
    got = {hit: _source(monkeypatch, tile, hit) for hit in (True, False)}
    assert got == want            # unpadded: two sources by cache state (the matrix's mix); padded: one source, the stored tile
