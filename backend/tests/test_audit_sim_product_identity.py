"""Perturb served time/cycle independently of requested hour and preserve both domains."""
import pytest
from services.weather_pipeline import sim_forecast as forecast


@pytest.mark.parametrize('served,alignment', [
    ('2026-10-02T09:00:00Z', 'mixed'), ('2026-10-02T12:00:00Z', 'aligned'), (None, 'unknown')])
def test_forecast_preserves_served_time_and_model_cycle(monkeypatch, served, alignment):
    requested = '2026-10-02T12:00:00Z'
    marine = dict(point={'speed': 1.0, 'period': 12.0, 'direction': 90.0},
                  valid_time=requested, served_valid_time=served, frame_offset_hours=-3 if alignment == 'mixed' else 0,
                  run_time='2026-10-02T10:00:00Z', model_run_time='2026-10-02T06:00:00Z',
                  product_id='marine-product', is_estimated=True, source='synthetic-marine')
    wind = dict(point={'speed': 5.0, 'direction': 270.0}, valid_time=requested,
                served_valid_time=requested, frame_offset_hours=0, run_time='2026-10-02T11:00:00Z',
                model_run_time='2026-10-02T00:00:00Z', product_id='wind-product',
                is_estimated=False, source='synthetic-wind')
    monkeypatch.setenv('SIM_LIVE_FORECAST', '1')
    monkeypatch.setattr(forecast, '_is_down', lambda: False)
    monkeypatch.setattr(forecast, 'fetch_point', lambda domain, *args:
                        marine.copy() if domain == 'marine' else wind.copy())
    forecast._FORECAST_CACHE.clear()
    try:
        baseline, provenance = forecast.fetch_live_forecast(28.0, -80.0, requested)
        assert baseline == {'swell_height_m': 1.0, 'swell_period_sec': 12.0, 'swell_direction_deg': 90.0,
                            'wind_speed_knots': 5.0, 'wind_direction_deg': 270.0}
        assert provenance['valid_time'] == requested
        assert provenance['run_time'] == '2026-10-02T10:00:00Z'
        assert provenance['wind_run_time'] == '2026-10-02T11:00:00Z'
        identities = provenance['product_identity']
        assert identities['marine']['requested_valid_time'] == requested
        assert identities['marine']['served_valid_time'] == served
        assert identities['marine']['model_run_time'] == '2026-10-02T06:00:00Z'
        assert identities['marine']['is_estimated'] is True
        assert identities['wind']['product_id'] == 'wind-product'
        assert identities['wind']['model_run_time'] == '2026-10-02T00:00:00Z'
        assert identities['wind']['is_estimated'] is False
        assert provenance['time_alignment'] == alignment
    finally:
        forecast._FORECAST_CACHE.clear()
