"""EURO's CMEMS swell periods near coasts (2026-09-27).

Probed live: EURO's swell_1 at Steamer Lane read 0.94 m at 3.79 s and wind waves 0.90 m at 1.22 s, a wave
steeper than water can stand, while Open-Meteo's copy of the same model (MFWAM) had swell at 6-12 s. The
10 deg CMEMS node at 40N 120W is inland; it carried a 1.41 m swell with a 0.0 s period. The fetcher
block-means heights and directions over +-5 deg of longitude (so a land-centred node keeps a height
borrowed from its ocean columns) but point-sampled periods, and the normalizer stores the missing period
as 0.0 on that valid vector. Bilinear sampling then averaged the zero in: the inland node carries 55% of
the weight at Steamer Lane, and 3.791 / 1.0 = 3.79 s is exactly what was served; without it, 8.50 s.

Fixed at the source (the period is energy-weighted over the height's own window, as the NOAA and GWAM
fetchers already do) and at the consumer (a zero period is not period evidence).
"""
import sys
import types
from datetime import datetime, timedelta, timezone

import numpy as np
import pytest

from services import copernicus_global_fetcher as CGF
from services.weather_pipeline.sampler import PointSampler
from services.weather_pipeline.schemas import CoverageBounds, GridVector, NormalizedGrid, NormalizedProduct


# ── the window ──────────────────────────────────────────────────────────────────────────────────

def test_a_land_centred_node_takes_the_period_of_its_ocean_columns():
    h = np.full((2, 3, 41), 2.0)
    p = np.full((2, 3, 41), 11.0)
    h[:, :, 20:], p[:, :, 20:] = np.nan, np.nan          # the sampled column and everything east is land
    out = CGF.energy_mean_period_lonspan(p, h, 20, 10)
    assert out.shape == (2,) and np.allclose(out, 11.0)


def test_the_period_is_weighted_by_energy():
    h = np.full((1, 1, 41), np.nan)
    p = np.full((1, 1, 41), np.nan)
    h[0, 0, 19], p[0, 0, 19] = 1.0, 8.0
    h[0, 0, 20], p[0, 0, 20] = 3.0, 14.0
    # E = H^2: (1*8 + 9*14) / 10 = 13.4, not the plain mean 11.0
    assert CGF.energy_mean_period_lonspan(p, h, 20, 1)[0] == pytest.approx(13.4)


def test_cells_without_energy_carry_no_period_and_true_land_stays_empty():
    h = np.full((1, 2, 41), 1.0)
    p = np.full((1, 2, 41), 9.0)
    h[:, :, :20], p[:, :, :20] = 0.0, 3.0                 # calm subcells: a period with no energy behind it
    assert CGF.energy_mean_period_lonspan(p, h, 25, 10)[0] == pytest.approx(9.0)
    land = np.full((1, 2, 41), np.nan)
    assert np.isnan(CGF.energy_mean_period_lonspan(land, land, 20, 10)[0])
    # an all-calm window has no energy to weight by: the point sample, as energy_mean_scalar_block does
    calm = np.zeros((1, 2, 41))
    assert CGF.energy_mean_period_lonspan(np.full((1, 2, 41), 3.0), calm, 20, 10)[0] == pytest.approx(3.0)


def test_every_period_is_paired_with_its_own_windowed_height():
    periods = {om for _, om, _ in CGF.VARIABLE_MAP if "period" in om}
    assert periods == set(CGF.PERIOD_TO_HEIGHT)
    heights = {om for _, om, _ in CGF.VARIABLE_MAP}
    for per, hgt in CGF.PERIOD_TO_HEIGHT.items():
        assert hgt in heights and hgt in CGF.HEIGHT_VARS, per


# ── the fetcher, end to end, on a land-centred node ─────────────────────────────────────────────

class _Var:
    def __init__(self, data, units=None):
        self._d, self.units = data, units

    def __getitem__(self, k):
        return self._d[k]


def _fake_modules(monkeypatch):
    lons = np.round(np.arange(-130.0, -120.0 + 1e-9, 1.0 / 12.0), 4)      # 0.083 deg, like the dataset
    lats = np.array([39.96, 40.04])
    t0 = datetime(2026, 9, 27, 9, tzinfo=timezone.utc)
    land = lons > -122.0                                              # the node at -120 sits on land
    shape = (2, len(lats), len(lons))

    def field(v):
        a = np.full(shape, v, dtype=float)
        a[:, :, land] = np.nan
        return np.ma.masked_invalid(a)

    variables = {"latitude": _Var(lats), "longitude": _Var(lons),
                 "time": _Var(np.array([0.0, 3.0]), units="hours since 2026-09-27 09:00:00")}
    for cop, om, _ in CGF.VARIABLE_MAP:
        variables[cop] = _Var(field(12.0 if "period" in om else 270.0 if "direction" in om else 1.4))

    nc4 = types.ModuleType("netCDF4")
    nc4.Dataset = lambda path, mode="r": types.SimpleNamespace(variables=variables, close=lambda: None)
    nc4.num2date = lambda vals, units=None: [t0 + timedelta(hours=float(v)) for v in vals]
    cm = types.ModuleType("copernicusmarine")
    cm.subset = lambda **kw: None
    monkeypatch.setitem(sys.modules, "netCDF4", nc4)
    monkeypatch.setitem(sys.modules, "copernicusmarine", cm)


def _node(points, lon):
    (pt,) = [p for p in points if p["longitude"] == lon]
    return pt["hourly"]


PAYLOAD = {"username": "u", "password": "p", "resolution": 10.0,
           "bbox": {"west": -130.0, "east": -120.0, "south": 40.0, "north": 40.0},
           "start_datetime": "2026-09-27T09:00:00", "end_datetime": "2026-09-27T12:00:00"}


def test_the_fetcher_emits_the_period_of_the_sea_its_height_describes(monkeypatch):
    monkeypatch.delenv("COPERNICUS_SCALAR_BLOCKMEAN", raising=False)
    _fake_modules(monkeypatch)
    points, ok, failed, _ = CGF.fetch_global_coarse(PAYLOAD)
    assert (ok, failed) == (1, 0)
    inland = _node(points, -120.0)
    assert inland["swell_wave_height"] == [pytest.approx(1.4)] * 2, "the height survives on its ocean columns"
    for per in CGF.PERIOD_TO_HEIGHT:
        assert inland[per] == [pytest.approx(12.0)] * 2, f"{per} must come from the same window, not the land cell"


def test_the_kill_switch_reverts_heights_and_periods_together(monkeypatch):
    monkeypatch.setenv("COPERNICUS_SCALAR_BLOCKMEAN", "0")
    _fake_modules(monkeypatch)
    points, _, _, _ = CGF.fetch_global_coarse(PAYLOAD)
    inland = _node(points, -120.0)
    assert inland["swell_wave_height"] == [None, None] and inland["swell_wave_period"] == [None, None]


# ── the consumer: a zero period is not period evidence ──────────────────────────────────────────

def _product(corners, layer="swell_1"):
    cov = CoverageBounds(west=-130.0, south=30.0, east=-120.0, north=40.0)
    vectors = [GridVector(lat=la, lng=lo, speed=sp, direction=270.0, u=0.0, v=0.0, period=per, is_valid=ok)
               for (la, lo), (sp, per, ok) in corners.items()]
    return NormalizedProduct(
        model="EURO", provider="copernicus", domain="marine", layer=layer,
        run_time=datetime.now(timezone.utc), valid_time=datetime.now(timezone.utc),
        is_forecast_authoritative=True, is_estimated=False, coverage=cov,
        grid=NormalizedGrid(bounds=cov, cols=2, rows=2, vectors=vectors),
        value_kind="wave_height", value_unit="m", display_unit_hint="m",
        product_id=f"euro_marine_{layer}_global_coarse_test.json", source_variables=["VHM0_SW1"],
        freshness_sec=3600, region_id="global_coarse", coverage_mode="global_tile")


# The live corners at 2026-09-27T09Z (EURO swell_1): the inland node has height and no period.
LIVE = {(30.0, -130.0): (1.0577, 9.98, True), (30.0, -120.0): (1.2891, 7.31, True),
        (40.0, -130.0): (1.193, 9.9, True), (40.0, -120.0): (1.4064, 0.0, True)}


def test_steamer_lanes_period_comes_from_the_corners_that_have_one():
    pt = PointSampler().sample_point(_product(LIVE), 36.9514, -122.0263).point
    assert pt.interpolation_method == "bilinear"
    assert pt.period == pytest.approx(8.50, abs=0.01), "3.79 s was the inland zero averaged in"


def test_the_masked_branch_ignores_a_zero_period_too():
    corners = dict(LIVE)
    corners[(30.0, -130.0)] = (0.0, 0.0, False)
    pt = PointSampler().sample_point(_product(corners), 36.9514, -122.0263).point
    assert pt.interpolation_method == "bilinear_ocean_masked"
    assert pt.period > 7.3


def test_a_layer_with_no_period_anywhere_still_reads_zero():
    corners = {k: (sp, 0.0, ok) for k, (sp, _, ok) in LIVE.items()}
    assert PointSampler().sample_point(_product(corners), 36.9514, -122.0263).point.period == 0.0
