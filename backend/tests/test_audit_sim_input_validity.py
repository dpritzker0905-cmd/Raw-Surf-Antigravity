"""WEA-05 boundary: unknown/non-finite fields are not measured zero."""
import copy
import math
import pytest
from services.weather_pipeline import sim_forecast as forecast

FIELDS = [
    ('marine', 'speed', 'swell_height_m'), ('marine', 'period', 'swell_period_sec'),
    ('marine', 'direction', 'swell_direction_deg'), ('wind', 'speed', 'wind_speed_knots'),
    ('wind', 'direction', 'wind_direction_deg'),
]

@pytest.fixture
def payloads(monkeypatch):
    monkeypatch.setenv('SIM_LIVE_FORECAST', '1')
    monkeypatch.setenv('SIM_STRICT_INPUTS', '1')
    monkeypatch.setattr(forecast, '_is_down', lambda: False)
    forecast._FORECAST_CACHE.clear()
    data = {
        'marine': {'point': {'speed': 1.5, 'period': 12.0, 'direction': 90.0}},
        'wind': {'point': {'speed': 6.0, 'direction': 180.0}},
    }
    monkeypatch.setattr(forecast, 'fetch_point', lambda domain, *args: copy.deepcopy(data[domain]))
    yield data
    forecast._FORECAST_CACHE.clear()

def fetch():
    return forecast.fetch_live_forecast(28.0, -80.0, '2026-10-03T12:00:00Z')

@pytest.mark.parametrize('domain,field,key', FIELDS)
@pytest.mark.parametrize('invalid', [None, float('nan'), float('inf'), float('-inf'), True, 'bad'])
def test_unknown_or_nonfinite_field_refuses_baseline(payloads, domain, field, key, invalid):
    payloads[domain]['point'][field] = invalid
    baseline, provenance = fetch()
    assert baseline is None
    assert provenance['reason']
    assert provenance['product_identity'][domain]['requested_valid_time'] == '2026-10-03T12:00:00Z'

@pytest.mark.parametrize('domain,field,key', FIELDS)
def test_absent_required_field_is_not_zero(payloads, domain, field, key):
    del payloads[domain]['point'][field]
    baseline, provenance = fetch()
    assert baseline is None
    assert provenance['reason']

@pytest.mark.parametrize('domain,field,invalid', [
    ('marine', 'speed', -1), ('wind', 'speed', -1), ('marine', 'period', -1),
    ('marine', 'period', 0), ('marine', 'direction', -1), ('wind', 'direction', 361),
])
def test_out_of_domain_field_refuses_baseline(payloads, domain, field, invalid):
    payloads[domain]['point'][field] = invalid
    assert fetch()[0] is None

@pytest.mark.parametrize('domain', ['marine', 'wind'])
@pytest.mark.parametrize('point', [[], 'unknown', 7])
def test_malformed_point_degrades_without_raising(payloads, domain, point):
    payloads[domain]['point'] = point
    baseline, provenance = fetch()
    assert baseline is None
    assert provenance['reason']

@pytest.mark.parametrize('domain,field,key', FIELDS)
def test_finite_single_input_perturbation_preserves_other_inputs(payloads, domain, field, key):
    baseline, _ = fetch()
    forecast._FORECAST_CACHE.clear()
    payloads[domain]['point'][field] += 0.25
    changed, _ = fetch()
    assert math.isclose(changed[key] - baseline[key], 0.25)
    assert {k: v for k, v in changed.items() if k != key} == {k: v for k, v in baseline.items() if k != key}

@pytest.mark.parametrize('domain,field,key', [FIELDS[2], FIELDS[3], FIELDS[4]])
def test_measured_zero_is_preserved(payloads, domain, field, key):
    payloads[domain]['point'][field] = 0
    assert fetch()[0][key] == 0

def test_calm_zero_height_and_period_are_preserved(payloads):
    payloads['marine']['point'].update(speed=0, period=0)
    baseline, _ = fetch()
    assert baseline['swell_height_m'] == baseline['swell_period_sec'] == 0

def test_numeric_strings_remain_compatible(payloads):
    payloads['marine']['point']['period'] = '12.0'
    assert fetch()[0]['swell_period_sec'] == 12



def test_disabled_flag_preserves_legacy_missing_direction(payloads, monkeypatch):
    monkeypatch.delenv('SIM_STRICT_INPUTS')
    del payloads['marine']['point']['direction']
    assert fetch()[0]['swell_direction_deg'] == 0


def test_flag_null_control_on_complete_valid_input(payloads, monkeypatch):
    enabled = fetch()
    forecast._FORECAST_CACHE.clear()
    monkeypatch.setenv('SIM_STRICT_INPUTS', '0')
    assert fetch() == enabled

def test_enabling_strict_inputs_cannot_reuse_legacy_invalid_cache(payloads, monkeypatch):
    monkeypatch.setenv('SIM_STRICT_INPUTS', '0')
    del payloads['marine']['point']['direction']
    assert fetch()[0]['swell_direction_deg'] == 0
    monkeypatch.setenv('SIM_STRICT_INPUTS', '1')
    assert fetch()[0] is None


def test_disabling_strict_inputs_restores_legacy_lane_without_cached_refusal(payloads, monkeypatch):
    del payloads['marine']['point']['direction']
    assert fetch()[0] is None
    monkeypatch.setenv('SIM_STRICT_INPUTS', '0')
    assert fetch()[0]['swell_direction_deg'] == 0


def test_cache_peek_cannot_enrich_strict_lane_from_invalid_legacy_lane(payloads, monkeypatch):
    monkeypatch.setenv('SIM_STRICT_INPUTS', '0')
    del payloads['marine']['point']['direction']
    fetch()
    monkeypatch.setenv('SIM_STRICT_INPUTS', '1')
    assert forecast.peek_live_forecast(28.0, -80.0, '2026-10-03T12:00:00Z') is None
