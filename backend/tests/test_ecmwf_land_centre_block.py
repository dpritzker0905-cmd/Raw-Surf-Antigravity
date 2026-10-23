"""ECMWF_WAVE_LAND_CENTRE_BLOCK: a EURO wave node whose own native cell is land takes direction and period from the block its
height already uses, so it is no longer dropped as masked.

WHY THIS EXISTS (2026-10-23, the owner: "queue the EURO own-values fix (block-sampled direction/period) dark")
--------------------------------------------------------------------------------------------------------------
The 2-deg EURO height is block-meaned (ECMWF_WAVE_SCALAR_BLOCKMEAN), direction and period were point-sampled at the node's own
native cell, and the normalizer drops a vector with no direction. Measured on ECMWF open data (cycle 2026-10-23 00Z): all 868 EURO
2-deg nodes that GFS calls sea but EURO masked have a LAND centre cell, and 847 of them hold ECMWF sea in their own block. So
the Gulf, the Med, the Baltic and the Red Sea showed GFS donor values (coarse_gulf_fill) where EURO's own values existed.

These tests run the REAL decode loop over stub GRIB messages (pygrib and the ECMWF client stubbed, as
test_ecmwf_period_bands_decode.py does): an island whose centre cell is land inside a sea block, an all-land block, open sea.
"""
import os
import sys
import types
from datetime import datetime

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

np = pytest.importorskip("numpy")
from services import ecmwf_opendata_fetcher as f  # noqa: E402
from services._fetch_common import energy_mean_direction_block, energy_mean_scalar_block  # noqa: E402

LATS = np.round(np.arange(40.0, 29.99, -0.25), 2)      # GRIB order: north to south
LONS = np.round(np.arange(0.0, 10.01, 0.25), 2)
T0 = datetime(2026, 10, 23, 0, 0, 0)
ISLAND = (34.0, 4.0)        # a land centre cell inside a sea block
ALL_LAND = (38.0, 8.0)      # a node whose whole 2-deg block is land
OPEN_SEA = (32.0, 2.0)


def _fields():
    la, lo = np.meshgrid(LATS, LONS, indexing="ij")
    land = ((np.abs(la - ISLAND[0]) <= 0.5) & (np.abs(lo - ISLAND[1]) <= 0.5)) | ((la >= 35.0) & (lo >= 6.0))
    swh = np.where(land, np.nan, 1.0 + 0.05 * (la - 30.0))
    mwd = np.where(land, np.nan, np.where(lo < 4.0, 250.0, 290.0))      # two directions: the circular mean is weighted
    pp1d = np.where(land, np.nan, 8.0 + 0.2 * lo)
    mwp = np.where(land, np.nan, 6.0 + 0.1 * lo)
    return {"swh": swh, "mwd": mwd, "pp1d": pp1d, "mwp": mwp}


class _Msg:
    def __init__(self, name, arr):
        self.shortName, self.validDate, self._arr, self.analDate = name, T0, arr, T0

    @property
    def values(self):
        return self._arr.copy()

    def latlons(self):
        la, lo = np.meshgrid(LATS, LONS, indexing="ij")
        return la, lo


def _install(monkeypatch, order):
    fields = _fields()
    msgs = [_Msg(name, fields[name]) for name in order]

    class _Grbs:
        def __iter__(self):
            return iter(msgs)

        def close(self):
            pass
    fake_pygrib = types.ModuleType("pygrib")
    fake_pygrib.open = lambda path: _Grbs()
    monkeypatch.setitem(sys.modules, "pygrib", fake_pygrib)

    class _Client:
        def __init__(self, *a, **k):
            pass

        def retrieve(self, **kw):
            open(kw["target"], "wb").write(b"GRIB-stub")
    od = types.ModuleType("ecmwf.opendata")
    od.Client = _Client
    monkeypatch.setitem(sys.modules, "ecmwf.opendata", od)
    monkeypatch.setitem(sys.modules, "ecmwf", types.ModuleType("ecmwf"))
    sys.modules["ecmwf"].opendata = od
    return fields


def _fetch(monkeypatch, on, order=("swh", "mwd", "pp1d", "mwp")):
    monkeypatch.setenv("ECMWF_WAVE_ENSEMBLE", "0")
    monkeypatch.setenv("ECMWF_WAVE_SCALAR_BLOCKMEAN", "1")
    monkeypatch.delenv("REGRID_NATIVE_CELL", raising=False)
    monkeypatch.setenv("ECMWF_WAVE_LAND_CENTRE_BLOCK", "1" if on else "0")
    fields = _install(monkeypatch, order)
    points, ok, failed, times = f.fetch_global_coarse({"bbox": {"south": 30.0, "north": 40.0, "west": 0.0, "east": 10.0},
                                                       "resolution": 2.0, "forecast_days": 1, "layer": "waves"})
    assert points and times, "the stub did not produce a decodable fetch"
    by = {(round(p["latitude"], 2), round(p["longitude"], 2)): p["hourly"] for p in points}
    return by, fields


def _rc(node):
    return int(np.argmin(np.abs(LATS - node[0]))), int(np.argmin(np.abs(LONS - node[1])))


def test_flag_off_the_land_centre_node_has_a_height_but_no_direction(monkeypatch):
    by, _ = _fetch(monkeypatch, on=False)
    island = by[ISLAND]
    assert island["wave_height"][0] is not None             # the height is block-meaned already
    assert island["wave_direction"][0] is None              # ...but the direction was the land cell's: the node is dropped


@pytest.mark.parametrize("order", [("swh", "mwd", "pp1d", "mwp"), ("mwd", "pp1d", "mwp", "swh")])
def test_flag_on_the_land_centre_node_takes_direction_and_period_from_its_block(monkeypatch, order):
    by, fields = _fetch(monkeypatch, on=True, order=order)  # either message order: the pair resolves when both arrived
    r, c = _rc(ISLAND)
    island = by[ISLAND]
    want_d = energy_mean_direction_block(fields["mwd"], fields["swh"], r, c, 4, True)
    want_p = energy_mean_scalar_block(fields["pp1d"], fields["swh"], r, c, 4, True)
    assert island["wave_direction"][0] == pytest.approx(round(want_d, 2), abs=0.01)
    assert 250.0 < island["wave_direction"][0] < 290.0       # a weighted circular mean of the two, not either one
    assert island["wave_period"][0] == pytest.approx(want_p, abs=0.01)


def test_open_sea_and_all_land_nodes_are_unchanged(monkeypatch):
    off, _ = _fetch(monkeypatch, on=False)
    on, _ = _fetch(monkeypatch, on=True)
    assert on[OPEN_SEA] == off[OPEN_SEA]                    # a sea centre keeps its own cell: byte-identical
    assert on[ALL_LAND]["wave_height"][0] is None and on[ALL_LAND]["wave_direction"][0] is None   # land stays land
    changed = [k for k in on if on[k] != off[k]]
    assert ISLAND in changed and all(off[k]["wave_direction"][0] is None for k in changed)   # only dropped nodes change


def test_the_helper_fills_only_nan_nodes_with_the_block_value():
    fields = _fields()
    im = [_rc(ISLAND), _rc(OPEN_SEA), _rc(ALL_LAND)]
    vals = [float("nan"), 123.0, float("nan")]
    out, n = f.fill_land_centre(vals, im, fields["mwd"], fields["swh"], 4, "d")
    assert n == 1 and out[1] == 123.0 and out[2] != out[2] and out[0] == out[0]
    assert vals[0] != vals[0]                                # the input list is not written to
