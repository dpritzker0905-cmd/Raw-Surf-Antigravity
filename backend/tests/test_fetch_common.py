"""
Unit tests for services/_fetch_common.py — the shared fetcher/service utilities.

These pin the exact numeric behaviour of the helpers extracted from the per-source fetchers, so the
existing fetchers can be migrated onto them with provable behaviour-preservation. Pure-Python / numpy
only — no pygrib, runs on any dev box.
"""
import math
import os
import sys

import numpy as np
import pytest

from services import _fetch_common as fc


# ─────────────────────────── coarse_axis ───────────────────────────
def test_coarse_axis_half_open_and_rounding():
    # half-open [lo, hi): includes lo, excludes hi
    assert fc.coarse_axis(-180.0, 180.0, 10.0)[0] == -180.0
    ax = fc.coarse_axis(-80.0, 85.0, 10.0)
    assert ax[0] == -80.0
    assert 85.0 not in ax            # half-open upper bound
    assert ax[-1] == 80.0
    assert len(ax) == 17             # -80..80 step 10


def test_coarse_axis_matches_legacy_impl():
    # behaviourally identical to the inlined `_coarse_axis` every fetcher shipped
    def legacy(lo, hi, step):
        vals = []
        v = lo
        while v < hi - 1e-9:
            vals.append(round(v, 4))
            v += step
        return vals
    for lo, hi, step in [(-180.0, 180.0, 10.0), (-80.0, 85.0, 10.0), (24.0, 31.0, 0.25)]:
        assert fc.coarse_axis(lo, hi, step) == legacy(lo, hi, step)


# ─────────────────────────── sanitizers ───────────────────────────
def test_sanitize_pressure_hpa():
    assert fc.sanitize_pressure_hpa(101325.0) == 1013.25   # Pa -> hPa
    assert fc.sanitize_pressure_hpa(float("nan")) is None
    assert fc.sanitize_pressure_hpa(9.96921e36) is None     # CMEMS-style _FillValue leak -> dropped
    assert fc.sanitize_pressure_hpa(50000.0) is None        # 500 hPa < 800 floor
    assert fc.sanitize_pressure_hpa(120000.0) is None       # 1200 hPa > 1100 ceil


def test_sanitize_speed_height_period_direction():
    assert fc.sanitize_speed_ms(12.3456789) == 12.3457
    assert fc.sanitize_speed_ms(-1.0) is None
    assert fc.sanitize_speed_ms(999.0) is None
    assert fc.sanitize_height_m(2.5) == 2.5
    assert fc.sanitize_height_m(31.0) is None
    assert fc.sanitize_period_s(11.0) == 11.0
    assert fc.sanitize_period_s(41.0) is None
    assert fc.sanitize_direction_deg(370.0) == 10.0
    assert fc.sanitize_direction_deg(-10.0) == 350.0
    assert fc.sanitize_direction_deg(float("nan")) is None


def test_meteo_wind_dir_cardinals():
    # wind FROM north: v negative (blowing south) -> 0 deg
    assert fc.meteo_wind_dir(0.0, -1.0) == pytest.approx(0.0, abs=1e-6)
    # wind FROM east: u negative (blowing west) -> 90 deg
    assert fc.meteo_wind_dir(-1.0, 0.0) == pytest.approx(90.0, abs=1e-6)
    # wind FROM south: v positive -> 180 deg
    assert fc.meteo_wind_dir(0.0, 1.0) == pytest.approx(180.0, abs=1e-6)
    # wind FROM west: u positive -> 270 deg
    assert fc.meteo_wind_dir(1.0, 0.0) == pytest.approx(270.0, abs=1e-6)


# ─────────────────────────── regular-grid NN ───────────────────────────
def test_build_regular_nn_picks_nearest():
    lat1d = np.array([-90.0, -45.0, 0.0, 45.0, 90.0])
    lon1d = np.array([-180.0, -90.0, 0.0, 90.0])
    idx = fc.build_regular_nn([1.0, 44.0], [1.0, -179.0], lat1d, lon1d)
    # row-major: (lat,lon) pairs => (1,1),(1,-179),(44,1),(44,-179)
    assert idx[0] == (2, 2)     # lat 1->0(idx2), lon 1->0(idx2)
    assert idx[1] == (2, 0)     # lon -179->-180(idx0)
    assert idx[2] == (3, 2)     # lat 44->45(idx3)
    assert idx[3] == (3, 0)


def test_build_regular_nn_360_wrap():
    # a 0..350 source grid: query lon -170 must wrap to 190 -> nearest 190
    lat1d = np.array([0.0, 10.0])
    lon1d = np.array([0.0, 90.0, 180.0, 190.0, 270.0])
    idx = fc.build_regular_nn([0.0], [-170.0], lat1d, lon1d)   # is_360 auto-detected (max>180)
    assert idx[0] == (0, 3)     # -170 % 360 = 190 -> col 3


# ─────────────────────────── icosahedral NN ───────────────────────────
def _cloud():
    # a small synthetic "cell cloud": equator ring + both poles
    clat = np.array([0.0, 0.0, 0.0, 0.0, 89.9, -89.9])
    clon = np.array([0.0, 90.0, 180.0, -90.0, 0.0, 0.0])
    return clat, clon


def test_build_icosahedral_nn_degrees():
    clat, clon = _cloud()
    # single-point calls (the map is a full outer-lats x inner-lons grid, so one point => one index)
    assert fc.build_icosahedral_nn([1.0], [1.0], clat, clon) == [0]       # near (0,0) equator cell
    assert fc.build_icosahedral_nn([88.0], [5.0], clat, clon) == [4]      # north pole cell (3D NN, robust)
    assert fc.build_icosahedral_nn([0.0], [179.0], clat, clon) == [2]     # (0,180) antimeridian cell
    assert fc.build_icosahedral_nn([-88.0], [200.0], clat, clon) == [5]   # south pole, lon-convention agnostic


def test_build_icosahedral_nn_radians_autodetect():
    clat, clon = _cloud()
    # same cloud expressed in radians must auto-detect and give identical indices
    idx_deg = fc.build_icosahedral_nn([1.0], [1.0], clat, clon)
    idx_rad = fc.build_icosahedral_nn([1.0], [1.0], np.radians(clat), np.radians(clon))
    assert idx_deg == idx_rad == [0]


# ─────────────────────────── point dict ───────────────────────────
def test_make_point_dict_shape():
    p = fc.make_point_dict(12.0, -34.0, "dwd",
                           {"time": "iso8601", "pressure_msl": "hPa"},
                           {"time": ["2026-06-27T00:00:00Z"], "pressure_msl": [1013.0]})
    assert p["latitude"] == 12.0 and p["longitude"] == -34.0
    assert p["__provider"] == "dwd"
    assert p["hourly"]["pressure_msl"] == [1013.0]
    assert p["timezone"] == "GMT"


# ─────────────────────────── async subprocess runner ───────────────────────────
@pytest.mark.asyncio
async def test_runner_returns_none_in_test_env(monkeypatch):
    monkeypatch.setenv("NODE_ENV", "test")
    out = await fc.run_fetcher_subprocess("nonexistent.py", {"west": 0}, 10.0, 2, "X", "x")
    assert out is None          # short-circuit every service depends on


@pytest.mark.asyncio
async def test_runner_spawns_and_parses(monkeypatch, tmp_path):
    # force the non-test branch and point at a tiny real fetcher script that echoes a payload back
    monkeypatch.setattr(fc, "is_test_environment", lambda: False)
    fake = tmp_path / "fake_fetcher.py"
    fake.write_text(
        "import json,sys\n"
        "p=json.loads(sys.argv[1])\n"
        "open(p['output_path'],'w').write(json.dumps([{'latitude':1.0,'longitude':2.0}]))\n"
        "print('SUMMARY: points=1')\n"
    )
    out = await fc.run_fetcher_subprocess(str(fake), {"west": 0}, 10.0, 2, "FAKE", "fake")
    assert out == [{"latitude": 1.0, "longitude": 2.0}]
