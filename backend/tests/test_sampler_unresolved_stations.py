"""SAMPLER_UNRESOLVED_STATIONS (2026-11-14): NDBC 46267, by name, returns "no data"; nothing else moves.

The defect, reproduced: GFS-Wave 0.25 deg marks the inner Strait of Juan de Fuca land, so every bracketing corner of the
station (48.171 N, 123.600 W) is land and the sampler read the strait-mouth cell off Cape Flattery (48.5 N, 124.25 W),
0.73 deg away: open-Pacific swell for a sheltered buoy, +1.47..+1.52 m vs Open-Meteo best_match over 14 days (Actions
43339322792). The wet/land pattern is the one measured around the buoy on 2026-11-12.
"""
from datetime import datetime, timezone

import pytest

from services.weather_pipeline import unresolved_stations as us
from services.weather_pipeline.sampler import PointSampler
from services.weather_pipeline.schemas import CoverageBounds, GridVector, NormalizedGrid, NormalizedProduct

BUOY_46267 = (48.171, -123.600)
WET_STRAIT = {(48.5, -125.25): 4.44, (48.5, -125.0): 4.01, (48.5, -124.75): 3.27, (48.5, -124.5): 2.24, (48.5, -124.25): 2.24,
              (48.25, -125.25): 4.65, (48.25, -125.0): 4.29, (48.0, -125.25): 4.78, (48.0, -125.0): 4.47,
              (47.75, -125.25): 4.91, (47.75, -125.0): 4.63, (47.75, -124.75): 4.17}


def _strait(wet=None, domain="marine", layer="waves"):
    wet = WET_STRAIT if wet is None else wet
    south, north, west, east, res = 47.75, 48.5, -125.25, -123.0, 0.25
    cov = CoverageBounds(west=west, south=south, east=east, north=north)
    vectors = []
    n_lat, n_lng = int(round((north - south) / res)) + 1, int(round((east - west) / res)) + 1
    for i in range(n_lat):
        for j in range(n_lng):
            la, lo = round(south + i * res, 2), round(west + j * res, 2)
            h = wet.get((la, lo))
            vectors.append(GridVector(lat=la, lng=lo, speed=h or 0.0, direction=290.0 if h else 0.0, u=0.0, v=0.0,
                                      period=13.0 if h else 0.0, is_valid=h is not None))
    now = datetime.now(timezone.utc)
    return NormalizedProduct(
        model="GFS", provider="noaa", domain=domain, layer=layer, run_time=now, valid_time=now,
        is_forecast_authoritative=True, is_estimated=False, coverage=cov,
        grid=NormalizedGrid(bounds=cov, cols=n_lng, rows=n_lat, vectors=vectors),
        value_kind="wave_height", value_unit="m", display_unit_hint="ft",
        product_id="gfs_marine_waves_us_pacific_northwest_test.json", source_variables=[layer], freshness_sec=3600,
        region_id="us_pacific_northwest", coverage_mode="regional_tile",
    )


def test_the_named_station_returns_no_data_and_says_why(monkeypatch):
    monkeypatch.delenv("SAMPLER_UNRESOLVED_STATIONS", raising=False)
    resp = PointSampler().sample_point(_strait(), *BUOY_46267)
    assert resp.point.interpolation_method == "unavailable"
    text = " ".join(str(w) for w in (resp.warnings or [])) + str(getattr(resp, "message", "")) + str(resp)
    assert "NDBC-46267" in text and "SAMPLER_UNRESOLVED_STATIONS" in text


def test_the_kill_switch_restores_the_old_far_water_read_exactly(monkeypatch):
    monkeypatch.setenv("SAMPLER_UNRESOLVED_STATIONS", "0")
    resp = PointSampler().sample_point(_strait(), *BUOY_46267)
    assert resp.point.interpolation_method == "nearest_ocean_coarse_masked"
    assert (resp.point.sampled_lat, resp.point.sampled_lng) == (48.5, -124.25) and resp.point.speed == pytest.approx(2.24)


@pytest.mark.parametrize("dlat, dlng", [(0.05, 0.0), (0.0, -0.05), (-0.04, 0.04), (0.0, 0.6)])
def test_nothing_else_moves_a_point_beside_the_station_reads_exactly_as_before(monkeypatch, dlat, dlng):
    """The null arm: the same all-land-corner branch, a few kilometres off the published position, with the switch on
    and off, gives the identical answer. The entry is the STATION, not its neighbourhood."""
    point = (BUOY_46267[0] + dlat, BUOY_46267[1] - dlng)
    assert us.station_at(*point) is None
    monkeypatch.delenv("SAMPLER_UNRESOLVED_STATIONS", raising=False)
    on = PointSampler().sample_point(_strait(), *point).point
    monkeypatch.setenv("SAMPLER_UNRESOLVED_STATIONS", "0")
    off = PointSampler().sample_point(_strait(), *point).point
    assert (on.interpolation_method, on.sampled_lat, on.sampled_lng, on.speed) == \
           (off.interpolation_method, off.sampled_lat, off.sampled_lng, off.speed)


def test_the_entry_lapses_by_itself_on_a_grid_that_gives_the_station_a_wet_corner(monkeypatch):
    """A model that resolves the strait puts water in a bracketing cell; the station then takes the ordinary path."""
    monkeypatch.delenv("SAMPLER_UNRESOLVED_STATIONS", raising=False)
    resolved = dict(WET_STRAIT)
    resolved[(48.25, -123.5)] = 0.6
    resp = PointSampler().sample_point(_strait(resolved), *BUOY_46267)
    assert resp.point.interpolation_method != "unavailable" and resp.point.speed == pytest.approx(0.6)


def test_a_non_marine_product_is_untouched(monkeypatch):
    monkeypatch.delenv("SAMPLER_UNRESOLVED_STATIONS", raising=False)
    on = PointSampler().sample_point(_strait(domain="wind", layer="wind"), *BUOY_46267).point
    monkeypatch.setenv("SAMPLER_UNRESOLVED_STATIONS", "0")
    off = PointSampler().sample_point(_strait(domain="wind", layer="wind"), *BUOY_46267).point
    assert (on.interpolation_method, on.sampled_lat, on.sampled_lng) == (off.interpolation_method, off.sampled_lat, off.sampled_lng)


def test_every_entry_carries_its_reason_and_evidence_and_the_radius_is_the_station_not_a_region():
    assert us.MATCH_RADIUS_DEG <= 0.05
    assert [s["id"] for s in us.UNRESOLVED_STATIONS] == ["NDBC-46267"]        # adding a station is a reviewed change
    for s in us.UNRESOLVED_STATIONS:
        assert all(isinstance(s.get(k), str) and len(s[k]) > 20 for k in ("reason", "evidence")) and s["name"]
        assert us.station_at(s["lat"], s["lng"]) is s
    assert us.station_at(53.27, -9.07) is None                                   # Galway Bay: a real spot's water, untouched
