"""Actual real-forecast tool: default now and explicit hour share the served gate."""
from types import SimpleNamespace
from unittest.mock import Mock
import pytest
import weather_sim_mcp as M


@pytest.fixture
def tool(monkeypatch):
    monkeypatch.setenv('SIM_FORECAST_SERVED_GATE', '1')
    spot = dict(name='Fixture', latitude=28, longitude=-80)
    monkeypatch.setattr(M.sim_spots, 'resolve', lambda name: SimpleNamespace(spot=spot, candidates=[], identity_source='test'))
    baseline = dict(swell_height_m=1.5, swell_period_sec=12, swell_direction_deg=90, wind_speed_knots=5, wind_direction_deg=270)
    provenance = {'model': 'GFS', 'valid_time': '2026-10-04T12:00:00Z'}
    monkeypatch.setattr(M, '_baseline_with_source', lambda *args: (baseline, 'live_forecast', provenance))
    monkeypatch.setattr(M, '_geometry_payload', lambda *args: {})
    monkeypatch.setattr(M.sim_observed, 'served_tide', lambda *args: None)
    monkeypatch.setattr(M.sim_observed, 'parity', lambda *args: {})
    rating = Mock(side_effect=lambda *args, **kwargs: {'quality_rating': 95.9 if kwargs['valid_time'] is None else 69.9})
    monkeypatch.setattr(M, 'calculate_surf_rating', rating)
    return getattr(M.get_weather_forecast, 'fn', M.get_weather_forecast), provenance, rating


def test_default_now_equals_explicit_served_hour(tool):
    call, provenance, rating = tool
    assert call('Fixture')['wave_simulation'] == call('Fixture', provenance['valid_time'])['wave_simulation'] == {'quality_rating': 69.9}
    assert all(c.kwargs['valid_time'] == provenance['valid_time'] for c in rating.call_args_list)


def test_actual_join_uses_served_time_instead_of_requested_time(tool):
    call, provenance, rating = tool
    provenance['product_identity'] = {d: {'served_valid_time': '2026-10-04T09:00:00Z'} for d in ('marine', 'wind')}
    call('Fixture', provenance['valid_time'])
    assert rating.call_args.kwargs['valid_time'] == '2026-10-04T09:00:00Z'


@pytest.mark.parametrize('invalid', [None, '', 'bad', '2026-10-04T12:00:00'])
def test_unknown_time_refuses_ungated_quality(tool, invalid):
    call, provenance, rating = tool
    provenance['valid_time'] = invalid
    result = call('Fixture')
    assert result['quality_status'] == 'unavailable_served_time' and 'wave_simulation' not in result
    rating.assert_not_called()


def test_mixed_domain_frames_refuse_quality(tool):
    call, provenance, rating = tool
    provenance['product_identity'] = {'marine': {'served_valid_time': '2026-10-04T09:00:00Z'}, 'wind': {'served_valid_time': provenance['valid_time']}}
    assert call('Fixture')['quality_status'] == 'unavailable_served_time'; rating.assert_not_called()


def test_default_off_preserves_legacy_now(tool, monkeypatch):
    call, _, rating = tool
    monkeypatch.delenv('SIM_FORECAST_SERVED_GATE')
    assert call('Fixture')['wave_simulation']['quality_rating'] == 95.9
    assert rating.call_args.kwargs['valid_time'] is None
