"""WEA-02: one observed tide/parity frame must share the actual baseline hour/model."""
import copy
import io
import json
from urllib.parse import parse_qs, urlparse
import pytest
from services.weather_pipeline import sim_observed as observed

ASKED = '2026-10-03T12:00:00Z'
SERVED = '2026-10-03T09:00:00Z'
SPOT = {'id': 'test-break', 'latitude': 28.0, 'longitude': -80.0}
SIM = {'breaking_height_ft': 3.28084, 'quality_rating': 70.0, 'quality_label': 'good'}

@pytest.fixture
def frames(monkeypatch):
    monkeypatch.setenv('SIM_SERVED_TIME_MATCH', '1')
    monkeypatch.setenv('SIM_OBSERVED', '1')
    monkeypatch.setenv('SIM_SERVED_TIDE', '1')
    monkeypatch.setattr(observed, '_cache', {})
    provenance = {'valid_time': ASKED, 'model': 'GFS', 'served_surf_height_m': 1.0,
                  'product_identity': {domain: {'served_valid_time': SERVED} for domain in ('marine', 'wind')}}
    payload = {'model': 'GFS', 'valid_time': SERVED, 'served_valid_time': SERVED, 'source': 'precomputed',
               'spots': [{'spot_id': SPOT['id'], 'score': 70.0, 'level': 'good',
                          'tide': {'norm': 0.5, 'height_m': 0.0, 'trend': 'rising'}}]}
    calls = []
    def urlopen(req, timeout=None):
        calls.append(parse_qs(urlparse(req.full_url).query))
        return io.BytesIO(json.dumps(payload).encode())
    monkeypatch.setattr(observed.urllib.request, 'urlopen', urlopen)
    return provenance, payload, calls

@pytest.mark.parametrize('model', ['GFS', 'ICON', 'EURO'])
@pytest.mark.parametrize('actual', [SERVED, '2026-10-03T15:00:00Z'])
def test_tide_and_parity_request_actual_hour_model_once(frames, model, actual):
    prov, payload, calls = frames
    prov['model'] = payload['model'] = model
    for item in prov['product_identity'].values():
        item['served_valid_time'] = actual
    payload['served_valid_time'] = actual
    assert observed.served_tide(SPOT, prov, 'live_forecast', ASKED)['norm'] == 0.5
    out = observed.parity(SIM, SPOT, prov, 'live_forecast', ASKED)
    assert out['quality']['delta'] == 0
    assert calls == [{'bbox': ['-80.02,27.98,-79.98,28.02'], 'valid_time': [actual], 'model': [model], 'limit': ['20']}]

@pytest.mark.parametrize('bad', [None, 'bad', '2026-10-03T09:00:00', '2026-10-03T10:00:00Z'])
@pytest.mark.parametrize('domain', ['marine', 'wind'])
def test_unknown_or_mixed_baseline_cannot_reuse_tide_or_quality(frames, domain, bad):
    prov, _, calls = frames
    prov['product_identity'][domain]['served_valid_time'] = bad
    assert observed.served_tide(SPOT, prov, 'live_forecast', ASKED) is None
    out = observed.parity(SIM, SPOT, prov, 'live_forecast', ASKED)
    assert out['time_comparison']['status'] == 'unavailable'
    assert 'quality' not in out and 'delta_pct' not in out
    assert calls == []

@pytest.mark.parametrize('actual', [None, 'bad', '2026-10-03T10:00:00Z'])
def test_rating_stale_fallback_does_not_claim_same_hour_or_supply_tide(frames, actual):
    prov, payload, calls = frames
    payload['served_valid_time'] = actual
    assert observed.served_tide(SPOT, prov, 'live_forecast', ASKED) is None
    out = observed.parity(SIM, SPOT, prov, 'live_forecast', ASKED)
    assert 'quality' not in out
    assert out['time_comparison']['status'] == 'unavailable'
    assert len(calls) == 1

@pytest.mark.parametrize('model', [None, 'ICON'])
def test_unknown_or_different_observed_model_is_not_comparable(frames, model):
    prov, payload, _ = frames
    payload['model'] = model
    assert observed.served_tide(SPOT, prov, 'live_forecast', ASKED) is None
    assert 'quality' not in observed.parity(SIM, SPOT, prov, 'live_forecast', ASKED)

def test_equal_instants_with_different_iso_spellings_are_comparable(frames):
    prov, payload, calls = frames
    prov['product_identity']['wind']['served_valid_time'] = '2026-10-03T11:00:00+02:00'
    payload['served_valid_time'] = '2026-10-03T09:00:00+00:00'
    assert observed.served_tide(SPOT, prov, 'live_forecast', ASKED)['norm'] == 0.5
    assert observed.parity(SIM, SPOT, prov, 'live_forecast', ASKED)['quality']['delta'] == 0
    assert len(calls) == 1 and calls[0]['valid_time'] == [SERVED]

def test_requested_hour_perturbation_cannot_move_actual_comparison(frames):
    prov, _, calls = frames
    before = observed.parity(SIM, SPOT, prov, 'live_forecast', ASKED)
    changed = copy.deepcopy(prov)
    changed['valid_time'] = '2026-10-03T18:00:00Z'
    after = observed.parity(SIM, SPOT, changed, 'live_forecast', changed['valid_time'])
    assert after['quality'] == before['quality']
    assert after['delta_pct'] == before['delta_pct']
    assert len(calls) == 1

def test_default_off_preserves_legacy_request_hour_and_tide(frames, monkeypatch):
    prov, payload, calls = frames
    monkeypatch.delenv('SIM_SERVED_TIME_MATCH')
    payload['served_valid_time'] = '2026-10-03T06:00:00Z'
    assert observed.served_tide(SPOT, prov, 'live_forecast', ASKED)['norm'] == 0.5
    assert 'quality' in observed.parity(SIM, SPOT, prov, 'live_forecast', ASKED)
    assert len(calls) == 1 and calls[0]['valid_time'] == [ASKED]

@pytest.mark.parametrize('source', ['catalogue_default', 'staged_override'])
def test_nonlive_composition_is_not_compared(frames, source):
    prov, _, calls = frames
    assert observed.served_tide(SPOT, prov, source, ASKED) is None
    assert observed.parity(SIM, SPOT, prov, source, ASKED) is None
    assert calls == []
