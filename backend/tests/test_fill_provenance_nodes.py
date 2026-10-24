"""MARINE_FILL_PROVENANCE_NODES: the Gulf fill's stamp names WHICH cells came from GFS, so a client can mark them (dark).

WHY THIS EXISTS (2026-10-23, the lead's item 2 of the own-values order)
-----------------------------------------------------------------------
`coarse_fill` said how many EURO/ICON cells were substituted from GFS, never which ones, so no client could draw the non-colour
cue the owner's state-of-the-art plan asks for on a substituted cell ("GFS substitute, not EURO/ICON; peak period"). And series
frames dropped the stamp entirely, although /grid always carried it. With the flag on, the stamp carries `filled_idx` (indices
into the response's own grid.vectors, bounded) on /grid AND on series frames, re-pointed when a series frame is decimated.
Off (the default), every response is byte-identical to before.
"""
import asyncio
import types
from datetime import datetime, timezone

import pytest

from services.weather_pipeline import coarse_gulf_fill as gf
from services.weather_pipeline.grid_series_helper import _apply_build_stride, build_grid_series
from services.weather_pipeline.schemas import CoverageBounds, GridVector, NormalizedGrid, NormalizedProduct

_VT_DT = datetime(2026, 10, 23, tzinfo=timezone.utc)
_WORLD = CoverageBounds(west=-180.0, south=-80.0, east=180.0, north=84.0)
SEA_GULF, INLAND_TX, OPEN_SEA = (26.0, -90.0), (32.0, -98.0), (0.0, 0.0)


def _vec(latlng, speed, valid=True):
    la, lo = latlng
    if not valid:
        return GridVector(lat=la, lng=lo, speed=0.0, is_valid=False)
    return GridVector(lat=la, lng=lo, speed=speed, direction=200.0, u=-0.5, v=0.7, period=9.0, is_valid=True)


def _product(model, region, layer, vectors, cols, rows=83, bounds=_WORLD, filename=None):
    grid = NormalizedGrid(bounds=bounds, cols=cols, rows=rows, vectors=vectors)
    return NormalizedProduct(
        model=model, provider="open-meteo", domain="marine", layer=layer, run_time=_VT_DT, valid_time=_VT_DT,
        is_forecast_authoritative=True, is_estimated=False, coverage=bounds, grid=grid, value_kind="wave_height",
        value_unit="m", display_unit_hint="ft", source_variables=[], freshness_sec=1800,
        resolution=2.0 if region == "global_mid" else 10.0, region_id=region, product_id=filename or f"{model}.json")


class _Store:
    def __init__(self):
        mid = [_vec(SEA_GULF, 1.25), _vec(INLAND_TX, 0, False), _vec(OPEN_SEA, 2.0)]
        coarse = [_vec((25.0, -90.0), 3.0), _vec((30.0, -95.0), 3.0)]
        self.products, self.items = {}, []
        for region, vecs, cols in (("global_mid", mid, 181), ("global_coarse", coarse, 37)):
            name = f"gfs_marine_waves_{region}.json"
            self.products[name] = _product("GFS", region, "waves", vecs, cols, filename=name)
            self.items.append(types.SimpleNamespace(model="GFS", domain="marine", layer="waves", region_id=region,
                                                    valid_time_start="2026-10-23T00:00:00Z", filename=name))

    def get_manifest(self):
        return types.SimpleNamespace(products=self.items)

    def load_product(self, filename):
        return self.products.get(filename)


def _recipient(region="global_mid"):
    vecs = [_vec(OPEN_SEA, 1.5), _vec(SEA_GULF, 0, False), _vec((10.0, 10.0), 1.0), _vec(INLAND_TX, 0, False)]
    return _product("EURO", region, "waves", vecs, 181 if region == "global_mid" else 37)


def _fill(product):
    return asyncio.run(gf.fill_coarse_enclosed_sea_from_gfs_served(product, _Store(), "EURO", "marine", "waves"))


@pytest.fixture(autouse=True)
def _flags(monkeypatch):
    for k in ("MARINE_FILL_PROVENANCE_NODES", "MARINE_FILL_PROVENANCE_MAX", "MARINE_GULF_FILL_MID", "MARINE_GULF_FILL_MID_TARGETED",
              "MARINE_COARSE_GULF_FILL", "SERIES_DECIMATE_MODE"):
        monkeypatch.delenv(k, raising=False)
    gf._DONOR_LRU.clear()
    gf.TARGETED_NO_FILL.clear()
    gf._LAST_NO_FILL.clear()


@pytest.mark.parametrize("targeted", [False, True])
def test_flag_off_the_stamp_is_exactly_as_before(monkeypatch, targeted):
    if targeted:
        monkeypatch.setenv("MARINE_GULF_FILL_MID_TARGETED", "1")
    out = _fill(_recipient())
    assert out.coarse_fill["cells_filled"] >= 1
    assert not {"filled_idx", "filled_idx_truncated", "filled_idx_pooling"} & set(out.coarse_fill)


@pytest.mark.parametrize("targeted, want", [(True, [1]), (False, [1, 3])])
def test_flag_on_filled_idx_names_exactly_the_substituted_cells(monkeypatch, targeted, want):
    """Targeted: only the Gulf node (GFS 2-deg sea). Legacy: the Gulf AND inland Texas (its 8-deg reach paints land); either
    way each index is a cell that was masked in the input and is valid in the output, and nothing else is listed."""
    monkeypatch.setenv("MARINE_FILL_PROVENANCE_NODES", "1")
    if targeted:
        monkeypatch.setenv("MARINE_GULF_FILL_MID_TARGETED", "1")
    src = _recipient()
    out = _fill(src)
    idx = out.coarse_fill["filled_idx"]
    assert idx == want and len(idx) == out.coarse_fill["cells_filled"]
    for i in idx:
        assert not src.grid.vectors[i].is_valid and out.grid.vectors[i].is_valid
    assert "filled_idx_truncated" not in out.coarse_fill


def test_the_list_is_bounded_and_says_so(monkeypatch):
    monkeypatch.setenv("MARINE_FILL_PROVENANCE_NODES", "1")
    monkeypatch.setenv("MARINE_FILL_PROVENANCE_MAX", "1")
    out = _fill(_recipient())                       # legacy fills 2 cells
    assert out.coarse_fill["filled_idx"] == [1] and out.coarse_fill["filled_idx_truncated"] is True
    assert out.coarse_fill["cells_filled"] == 2     # the count stays the truth


def _lattice(cols=6, rows=4, filled=((0, 4), (1, 2), (2, 2), (2, 3), (3, 5))):
    """A cols x rows lattice (south row first) whose cells at (row, col) in `filled` carry a filled_idx stamp."""
    vecs = [GridVector(lat=float(r), lng=float(c), speed=1.0 + r + c / 10.0, direction=90.0, u=-1.0, v=0.0, period=9.0,
                       is_valid=True) for r in range(rows) for c in range(cols)]
    p = _product("EURO", "global_mid", "waves", vecs, cols, rows,
                 bounds=CoverageBounds(west=0.0, south=0.0, east=float(cols - 1), north=float(rows - 1)))
    p.coarse_fill = {"donor_model": "GFS", "cells_filled": len(filled), "filled_idx": [r * cols + c for r, c in filled]}
    return p


def test_a_decimated_series_frame_points_filled_idx_at_the_same_nodes(monkeypatch):
    monkeypatch.setenv("MARINE_FILL_PROVENANCE_NODES", "1")
    p = _lattice()
    before = dict(p.coarse_fill)
    assert _apply_build_stride(p, 2, "stride")
    named = {(p.grid.vectors[i].lat, p.grid.vectors[i].lng) for i in p.coarse_fill["filled_idx"]}
    kept = {(v.lat, v.lng) for v in p.grid.vectors}
    want = {(float(r), float(c)) for r, c in ((0, 4), (1, 2), (2, 2), (2, 3), (3, 5))} & kept
    assert want == {(0.0, 4.0), (2.0, 2.0)}                                      # two survive the stride, three are dropped
    assert named == want and len(p.coarse_fill["filled_idx"]) == len(want)
    assert before["filled_idx"] == [4, 8, 14, 15, 23] and p.coarse_fill is not before   # a new dict; the old one is untouched


def test_max_pooling_is_declared_not_hidden():
    p = _lattice()
    out = gf.remap_filled_idx(p.coarse_fill, p.grid.vectors, p.grid.vectors[::2], mode="max")
    assert out["filled_idx_pooling"] == "max"


class _FakeVP:
    normalizer = None


@pytest.mark.parametrize("on", [False, True])
def test_series_frames_carry_the_stamp_only_with_the_flag(monkeypatch, on):
    """/grid always carried coarse_fill; series frames dropped it. With the flag they carry it; off they are as before."""
    if on:
        monkeypatch.setenv("MARINE_FILL_PROVENANCE_NODES", "1")

    async def resolve(*, model, domain, layer, valid_time, bbox, surf=False, background_tasks=None, request=None):
        p = _product("EURO", "global_mid", "waves", [_vec(SEA_GULF, 1.0)], 1, 1)
        p.coarse_fill = {"donor_model": "GFS", "cells_filled": 1, "filled_idx": [0]}
        return p

    resp = asyncio.run(build_grid_series(resolve, _FakeVP(), "EURO", "marine", "waves", "-180,-80,180,84", "0,3"))
    assert resp["frame_count"] == 2
    for f in resp["frames"]:
        assert ("coarse_fill" in f) is on
        if on:
            assert f["coarse_fill"]["filled_idx"] == [0]
