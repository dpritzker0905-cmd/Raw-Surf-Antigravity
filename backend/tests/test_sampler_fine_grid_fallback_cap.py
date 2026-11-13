"""SAMPLER_FINE_GRID_FALLBACK_CAP (2026-11-12): on a fine grid the all-land-corner fallback keeps the cell-scale reach.

The defect, reproduced: GFS-Wave 0.25 deg marks the inner Strait of Juan de Fuca land, so every bracketing corner of NDBC
46267 (48.171 N, 123.600 W) is land and the sampler took the 1-deg-floor branch to the strait-mouth cell off Cape
Flattery (48.5 N, 124.25 W), 0.73 deg away: open-Pacific swell for a sheltered buoy, +1.47..+1.52 m vs Open-Meteo
best_match over 14 days (Actions 43339322792). The wet/land pattern below is the one measured from Open-Meteo
`ncep_gfswave025` around the buoy on 2026-11-12.
"""
from datetime import datetime, timezone

import pytest

from services.weather_pipeline.sampler import FALLBACK_REACH_EPS_DEG, PointSampler
from services.weather_pipeline.schemas import CoverageBounds, GridVector, NormalizedGrid, NormalizedProduct
from services.weather_pipeline.forecast_skill import rows_from_calibration_report

BUOY_46267 = (48.171, -123.600)
# Measured 2026-11-12 (Open-Meteo ncep_gfswave025, mean Hs over a day): wet cells in a 47.75..48.5 x -125.25..-123 window.
WET_STRAIT = {(48.5, -125.25): 4.44, (48.5, -125.0): 4.01, (48.5, -124.75): 3.27, (48.5, -124.5): 2.24, (48.5, -124.25): 2.24,
              (48.25, -125.25): 4.65, (48.25, -125.0): 4.29, (48.0, -125.25): 4.78, (48.0, -125.0): 4.47,
              (47.75, -125.25): 4.91, (47.75, -125.0): 4.63, (47.75, -124.75): 4.17}


def _grid(wet, south, north, west, east, res, layer="waves"):
    cov = CoverageBounds(west=west, south=south, east=east, north=north)
    vectors = []
    n_lat = int(round((north - south) / res)) + 1
    n_lng = int(round((east - west) / res)) + 1
    for i in range(n_lat):
        for j in range(n_lng):
            la, lo = round(south + i * res, 2), round(west + j * res, 2)
            h = wet.get((la, lo))
            vectors.append(GridVector(lat=la, lng=lo, speed=h or 0.0, direction=290.0 if h else 0.0, u=0.0, v=0.0,
                                      period=13.0 if h else 0.0, is_valid=h is not None))
    now = datetime.now(timezone.utc)
    return NormalizedProduct(
        model="GFS", provider="noaa", domain="marine", layer=layer, run_time=now, valid_time=now,
        is_forecast_authoritative=True, is_estimated=False, coverage=cov,
        grid=NormalizedGrid(bounds=cov, cols=n_lng, rows=n_lat, vectors=vectors),
        value_kind="wave_height", value_unit="m", display_unit_hint="ft",
        product_id="gfs_marine_waves_us_pacific_northwest_test.json", source_variables=[layer], freshness_sec=3600,
        region_id="us_pacific_northwest", coverage_mode="regional_tile",
    )


def _strait():
    return _grid(WET_STRAIT, 47.75, 48.5, -125.25, -123.0, 0.25)


def test_46267_no_longer_reads_the_strait_mouth(monkeypatch):
    monkeypatch.delenv("SAMPLER_FINE_GRID_FALLBACK_CAP", raising=False)
    resp = PointSampler().sample_point(_strait(), *BUOY_46267)
    assert resp.point.interpolation_method == "unavailable"


def test_kill_switch_restores_the_old_read_exactly(monkeypatch):
    monkeypatch.setenv("SAMPLER_FINE_GRID_FALLBACK_CAP", "0")
    resp = PointSampler().sample_point(_strait(), *BUOY_46267)
    assert resp.point.interpolation_method == "nearest_ocean_coarse_masked"
    assert (resp.point.sampled_lat, resp.point.sampled_lng) == (48.5, -124.25)
    assert resp.point.speed == pytest.approx(2.24)


def test_a_spot_just_inside_the_reach_is_still_served(monkeypatch):
    """The closest measured spot sits 0.373 deg from water against 0.375 (Inch Beach, uk_ireland); it must not flip."""
    monkeypatch.delenv("SAMPLER_FINE_GRID_FALLBACK_CAP", raising=False)
    wet = {(52.5, -10.0): 0.7}
    resp = PointSampler().sample_point(_grid(wet, 51.75, 52.75, -10.5, -9.5, 0.25), 52.128, -9.978)
    assert resp.point.interpolation_method == "nearest_ocean_coarse_masked" and resp.point.speed == pytest.approx(0.7)


def test_the_reach_boundary_is_inclusive():
    assert FALLBACK_REACH_EPS_DEG > 0 and FALLBACK_REACH_EPS_DEG < 1e-3


def test_coarse_grids_keep_the_one_degree_floor(monkeypatch):
    """The floor's own case: on a 2-deg grid an open-ocean point can have all-land corners (Gulf of Mexico)."""
    monkeypatch.delenv("SAMPLER_FINE_GRID_FALLBACK_CAP", raising=False)
    wet = {(28.0, -90.0): 1.1}          # 2.55 deg from the point: past the 1-deg floor, inside 1.5 cells (3 deg)
    resp = PointSampler().sample_point(_grid(wet, 20.0, 30.0, -100.0, -80.0, 2.0), 27.5, -92.5)
    assert resp.point.interpolation_method == "nearest_ocean_coarse_masked" and resp.point.speed == pytest.approx(1.1)


def test_a_half_degree_grid_is_not_fine_and_keeps_the_floor(monkeypatch):
    """The floor binds only where 1.5 cells < 1 deg. At 0.5 deg (reach 0.75) water 0.9 deg away is still served: the
    fine-grid threshold is strict (< 0.5), so raising it would change this case."""
    monkeypatch.delenv("SAMPLER_FINE_GRID_FALLBACK_CAP", raising=False)
    wet = {(39.0, -9.5): 1.3}
    resp = PointSampler().sample_point(_grid(wet, 37.0, 41.0, -11.0, -7.0, 0.5), 38.3, -8.9)
    assert resp.point.interpolation_method == "nearest_ocean_coarse_masked" and resp.point.speed == pytest.approx(1.3)


def test_only_the_marine_domain_is_capped(monkeypatch):
    """Wind and pressure have no land mask to cross; the cap is the marine total field's (LongCat review, 2026-11-13)."""
    monkeypatch.delenv("SAMPLER_FINE_GRID_FALLBACK_CAP", raising=False)
    prod = _strait()
    prod.domain = "weather"
    resp = PointSampler().sample_point(prod, *BUOY_46267)
    assert resp.point.interpolation_method == "nearest_ocean_coarse_masked"


def test_a_real_half_degree_tile_axis_is_not_fine():
    """Copernicus regional tiles are stored at 0.5 deg (scheduler: res_to_save = 0.5). Their axis, built by the real
    generator over a real pilot bbox, must read as NOT fine: the sampler's grid_res is the min positive latitude step."""
    from services.noaa_gfs_wave_fetcher import _coarse_axis
    from services.weather_pipeline.sampler import FINE_GRID_RES_MAX_DEG
    from services.weather_pipeline.pilot_regions import WORLDWIDE_COASTAL_REGIONS
    for name in ("hawaii", "iberia_west", "us_northeast"):          # whole-degree and fractional (-76.1, 44.6) edges
        bb = WORLDWIDE_COASTAL_REGIONS[name]
        lats = _coarse_axis(float(bb["south"]), float(bb["north"]), 0.5)
        assert not (min(b - a for a, b in zip(lats, lats[1:])) < FINE_GRID_RES_MAX_DEG), name
        fine = _coarse_axis(float(bb["south"]), float(bb["north"]), 0.25)
        assert min(b - a for a, b in zip(fine, fine[1:])) < FINE_GRID_RES_MAX_DEG, name


def test_unavailable_says_why(monkeypatch):
    monkeypatch.delenv("SAMPLER_FINE_GRID_FALLBACK_CAP", raising=False)
    resp = PointSampler().sample_point(_strait(), *BUOY_46267)
    assert "SAMPLER_FINE_GRID_FALLBACK_CAP" in " ".join(str(x) for x in (resp.warnings or []) + [getattr(resp, "message", "")]
                                                         + [getattr(resp, "reason", "") or ""])


def test_skill_rows_record_the_serve_path_and_omit_it_when_unknown():
    report = {"spots": [
        {"buoy_id": "46267", "residual": {"model_hs_m": 2.24},
         "served": {"product": "gfs_marine_waves_us_pacific_northwest_20261112T180000Z.json", "cycle": "2026-11-12T12:00:00Z",
                    "interp": "nearest_ocean_coarse_masked", "sampled": [48.5, -124.25]}},
        {"buoy_id": "46211", "residual": {"model_hs_m": 3.4},
         "served": {"product": "gfs_marine_waves_us_pacific_northwest_20261112T180000Z.json", "cycle": "2026-11-12T12:00:00Z"}},
    ]}
    rows = {r["buoy_id"]: r for r in rows_from_calibration_report(report, "2026-11-13T18:00:00Z", 24.0)}
    assert rows["46267"]["interp"] == "nearest_ocean_coarse_masked" and rows["46267"]["sampled"] == [48.5, -124.25]
    assert "interp" not in rows["46211"] and "sampled" not in rows["46211"]
