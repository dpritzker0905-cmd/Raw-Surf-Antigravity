"""ECMWF_WAVE_LAND_CENTRE_BLOCK: a EURO wave node whose own native cell is land takes direction and period from the block its
height already uses, within a reach of the coast, so it carries ECMWF's own sea values instead of being dropped.

WHY THIS EXISTS (2026-10-23, the owner: "queue the EURO own-values fix (block-sampled direction/period) dark")
--------------------------------------------------------------------------------------------------------------
The 2-deg EURO height is block-meaned (ECMWF_WAVE_SCALAR_BLOCKMEAN), direction and period were point-sampled at the node's own
native cell, and the normalizer drops a vector with no direction, so that drop IS EURO's coarse land mask today. The lead's
regression review set the rules pinned here: the fetcher's OWN slice (8x8, one native cell NW of centre), pp1d (peak) only and
mwp only when the whole block has no pp1d, direction and period from the same window and never a valid vector without a
period (0b5182436), a reach so land-centred nodes ~1 deg inland are not validated, bounded memory, the native 0.25-deg tiles
untouched, and provenance (landCentreBlockNodes).

These tests run the REAL decode loop over stub GRIB messages (pygrib and the ECMWF client stubbed, as
test_ecmwf_period_bands_decode.py does).
"""
import os
import sys
import types
from datetime import datetime, timezone

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

np = pytest.importorskip("numpy")
from services import ecmwf_opendata_fetcher as f  # noqa: E402
from services._fetch_common import energy_mean_direction_block, energy_mean_scalar_block  # noqa: E402

LATS = np.round(np.arange(40.0, 29.99, -0.25), 2)      # GRIB order: north to south
LONS = np.round(np.arange(0.0, 10.01, 0.25), 2)
T0 = datetime(2026, 10, 23, 0, 0, 0)
ISLET = (34.0, 4.0)         # land centre, nearest sea 2 native cells away: inside the default reach
BIG_ISLAND = (32.0, 8.0)    # land centre, nearest sea 4 cells away (the block's edge): outside the default reach
ALL_LAND = (38.0, 8.0)      # a node whose whole block is land
OPEN_SEA = (32.0, 2.0)


def _fields(no_pp1d_near=None, no_period_near=None):
    la, lo = np.meshgrid(LATS, LONS, indexing="ij")
    land = (((np.abs(la - ISLET[0]) <= 0.25) & (np.abs(lo - ISLET[1]) <= 0.25))
            | ((np.abs(la - BIG_ISLAND[0]) <= 0.75) & (np.abs(lo - BIG_ISLAND[1]) <= 0.75))
            | ((la >= 36.0) & (lo >= 6.0)))
    swh = np.where(land, np.nan, 1.0 + 0.05 * (la - 30.0))
    mwd = np.where(land, np.nan, np.where(lo < 4.0, 250.0, 290.0))       # two directions: the circular mean is weighted
    pp1d = np.where(land, np.nan, 8.0 + 0.2 * lo)
    mwp = np.where(land, np.nan, 6.0 + 0.1 * lo)
    for near, names in ((no_pp1d_near, ("pp1d",)), (no_period_near, ("pp1d", "mwp"))):
        if near is not None:
            box = (np.abs(la - near[0]) <= 1.25) & (np.abs(lo - near[1]) <= 1.25)
            for n in names:
                arr = pp1d if n == "pp1d" else mwp
                arr[box] = np.nan
    return {"swh": swh, "mwd": mwd, "pp1d": pp1d, "mwp": mwp}


class _Msg:
    def __init__(self, name, arr):
        self.shortName, self.validDate, self._arr, self.analDate = name, T0, arr, T0

    @property
    def values(self):
        return self._arr.copy()

    def latlons(self):
        return np.meshgrid(LATS, LONS, indexing="ij")


def _install(monkeypatch, fields, order):
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


def _fetch(monkeypatch, on, order=("swh", "mwd", "pp1d", "mwp"), reach=None, fields=None, resolution=2.0):
    monkeypatch.setenv("ECMWF_WAVE_ENSEMBLE", "0")
    monkeypatch.setenv("ECMWF_WAVE_SCALAR_BLOCKMEAN", "1")
    monkeypatch.delenv("REGRID_NATIVE_CELL", raising=False)
    monkeypatch.setenv("ECMWF_WAVE_LAND_CENTRE_BLOCK", "1" if on else "0")
    if reach is None:
        monkeypatch.delenv("ECMWF_WAVE_LAND_CENTRE_REACH", raising=False)
    else:
        monkeypatch.setenv("ECMWF_WAVE_LAND_CENTRE_REACH", str(reach))
    fields = fields or _fields()
    _install(monkeypatch, fields, order)
    points, ok, failed, times = f.fetch_global_coarse({"bbox": {"south": 30.0, "north": 40.0, "west": 0.0, "east": 10.0},
                                                       "resolution": resolution, "forecast_days": 1, "layer": "waves"})
    assert points and times, "the stub did not produce a decodable fetch"
    return {(round(p["latitude"], 2), round(p["longitude"], 2)): p for p in points}, fields


def _rc(node):
    return int(np.argmin(np.abs(LATS - node[0]))), int(np.argmin(np.abs(LONS - node[1])))


def _want(fields, node, period="pp1d"):
    """The oracle: the production reductions on the fetcher's own slice (energy_mean_height_block's block)."""
    r, c = _rc(node)
    return (energy_mean_direction_block(fields["mwd"], fields["swh"], r, c, 4, True),
            energy_mean_scalar_block(fields[period], fields["swh"], r, c, 4, True))


def test_flag_off_the_land_centre_node_has_a_height_but_no_direction(monkeypatch):
    by, _ = _fetch(monkeypatch, on=False)
    h = by[ISLET]["hourly"]
    assert h["wave_height"][0] is not None and h["wave_direction"][0] is None   # dropped by the normalizer today
    assert "__land_centre_block" not in by[ISLET]


@pytest.mark.parametrize("order", [("swh", "mwd", "pp1d", "mwp"), ("mwd", "pp1d", "mwp", "swh"), ("pp1d", "swh", "mwp", "mwd")])
def test_flag_on_a_coastal_land_centre_node_takes_direction_and_pp1d_from_the_height_block(monkeypatch, order):
    by, fields = _fetch(monkeypatch, on=True, order=order)
    d, p = _want(fields, ISLET)
    h = by[ISLET]["hourly"]
    assert h["wave_direction"][0] == pytest.approx(round(d, 2), abs=0.01) and 250.0 < h["wave_direction"][0] < 290.0
    assert h["wave_period"][0] == pytest.approx(p, abs=0.01)                # pp1d, the peak, from the same window
    assert by[ISLET]["__land_centre_block"] == [0]


def test_the_reach_keeps_nodes_whose_nearest_sea_is_at_the_block_edge_masked(monkeypatch):
    by, _ = _fetch(monkeypatch, on=True)                                     # default reach 2 cells (0.5 deg)
    assert by[BIG_ISLAND]["hourly"]["wave_direction"][0] is None
    by, fields = _fetch(monkeypatch, on=True, reach=4)                       # the whole block
    assert by[BIG_ISLAND]["hourly"]["wave_direction"][0] == pytest.approx(round(_want(fields, BIG_ISLAND)[0], 2), abs=0.01)


def test_mwp_only_when_the_whole_block_has_no_pp1d_and_no_period_means_no_validation(monkeypatch):
    fields = _fields(no_pp1d_near=ISLET)
    by, fields = _fetch(monkeypatch, on=True, fields=fields)
    assert by[ISLET]["hourly"]["wave_period"][0] == pytest.approx(_want(fields, ISLET, "mwp")[1], abs=0.01)   # block mwp
    fields = _fields(no_period_near=ISLET)
    by, _ = _fetch(monkeypatch, on=True, fields=fields)
    h = by[ISLET]["hourly"]
    assert h["wave_direction"][0] is None and h["wave_period"][0] is None    # never a valid vector without a period


def test_open_sea_and_all_land_nodes_are_unchanged_and_native_tiles_are_untouched(monkeypatch):
    off, _ = _fetch(monkeypatch, on=False)
    on, _ = _fetch(monkeypatch, on=True)
    assert on[OPEN_SEA] == off[OPEN_SEA]                                     # a sea centre keeps its own cell
    assert on[ALL_LAND]["hourly"]["wave_height"][0] is None and on[ALL_LAND]["hourly"]["wave_direction"][0] is None
    changed = [k for k in on if on[k]["hourly"] != off[k]["hourly"]]
    assert ISLET in changed and all(off[k]["hourly"]["wave_direction"][0] is None for k in changed)
    nat_off, _ = _fetch(monkeypatch, on=False, resolution=0.25)
    nat_on, _ = _fetch(monkeypatch, on=True, resolution=0.25)
    assert nat_on == nat_off                                                  # the 0.25-deg native tiles: out of scope


def test_the_normalizer_records_the_nodes_in_grid_diagnostics(monkeypatch):
    from services.weather_pipeline.normalizer import WeatherNormalizer
    bbox = {"south": 30.0, "north": 40.0, "west": 0.0, "east": 10.0}
    for on, want in ((False, None), (True, True)):
        by, _ = _fetch(monkeypatch, on=on)
        product = WeatherNormalizer().normalize("EURO", "open-meteo", "marine", "waves", list(by.values()), bbox, 2.0,
                                                T0.replace(tzinfo=timezone.utc), region_id="global_mid")
        n = product.grid.diagnostics.get("landCentreBlockNodes")
        islet = next(v for v in product.grid.vectors if (v.lat, v.lng) == ISLET)
        if want:
            assert n == sum(1 for p in by.values() if p.get("__land_centre_block")) >= 1 and islet.is_valid and islet.period > 0
        else:
            assert n is None and not islet.is_valid                           # flag off: byte-identical diagnostics


def test_block_slice_is_the_heights_own_window():
    a = np.arange(41 * 41, dtype=float).reshape(41, 41)
    blk, centre = f.block_slice(a, 20, 20, 4)
    assert blk.shape == (8, 8) and centre == (4, 4) and blk[0, 0] == a[16, 16] and blk[7, 7] == a[23, 23]   # NW-offset 8x8
