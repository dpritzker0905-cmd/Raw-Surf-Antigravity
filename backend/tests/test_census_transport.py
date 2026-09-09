"""Observed Storage 429 must recover boundedly without hiding refusals or verdicts."""
import importlib.util
import os
from pathlib import Path
import time
import json
from datetime import datetime, timedelta, timezone
from email.utils import format_datetime
import sys

import pytest

ROOT = Path(__file__).resolve().parents[2]


def load(name):
    prior = os.getcwd()
    spec = importlib.util.spec_from_file_location(name, ROOT / 'backend/scripts' / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(module)
    finally:
        os.chdir(prior)
    return module


class Response:
    def __init__(self, status, payload, headers=None):
        self.status_code, self.payload, self.headers = status, payload, headers or {}
        self.text = 'body with secret-test-token-never-log'
        self.closed = False

    def json(self):
        return self.payload

    def close(self):
        self.closed = True


class Session:
    def __init__(self, *responses):
        self.responses, self.calls = list(responses), []

    def get(self, *args, **kwargs):
        self.calls.append((args, kwargs))
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response


def test_observed_storage_throttle_then_success_is_logged_and_recovered(monkeypatch, capsys):
    gonogo = load('local_size_gonogo')
    sleeps = []
    monkeypatch.setattr(time, 'sleep', sleeps.append)
    refused = Response(429, {'code': 'SlowDown', 'error': 'too_many_connections'}, {'Retry-After': '0'})
    accepted = Response(200, {'spots': {'sentinel': {'reference_size_m': 1.2}}})
    session = Session(refused, accepted)
    result = gonogo._get_json(session, 'https://example.test/private', 'secret-test-token-never-log', 'served ratings blob')
    assert result == accepted.payload
    assert len(session.calls) == 2 and refused.closed and accepted.closed
    output = capsys.readouterr()
    assert '429' in output.err and 'recovered' in output.err
    assert 'secret-test-token-never-log' not in output.err + output.out
    assert output.out == '' and len(sleeps) == 1


@pytest.mark.parametrize('status', [429, 502, 503, 504])
def test_persistent_refusal_stops_after_three_gets(status, monkeypatch, capsys):
    from scripts.census_http import CensusReadError, get_json
    sleeps = []
    monkeypatch.setattr(time, 'sleep', sleeps.append)
    replies = [Response(status, {}) for _ in range(3)]
    session = Session(*replies)
    with pytest.raises(CensusReadError, match='exhausted 3 attempts'):
        get_json(session, 'private-url', {'apikey': 'secret-test-token-never-log'}, 'fixture')
    assert len(session.calls) == 3 and len(sleeps) == 2 and all(r.closed for r in replies)
    assert 2 <= sleeps[0] <= 3 and 4 <= sleeps[1] <= 5
    output = capsys.readouterr()
    assert output.err.count('refused') == 2 and 'recovered' not in output.err


def test_exhausted_transport_reaches_gonogo_infrastructure_exit(monkeypatch):
    gonogo = load('local_size_gonogo')
    monkeypatch.setattr(time, 'sleep', lambda _: None)
    session = Session(*(Response(429, {}) for _ in range(3)))
    monkeypatch.setattr(gonogo, 'main', lambda: gonogo._get_json(session, 'private-url', 'test-key', 'fixture'))
    assert gonogo.cli() == 2 and len(session.calls) == 3


@pytest.mark.parametrize('status', [400, 401, 403, 404, 500])
def test_permanent_errors_are_not_retried(status):
    from scripts.census_http import CensusReadError, get_json
    response = Response(status, {})
    session = Session(response)
    with pytest.raises(CensusReadError, match='not retryable'):
        get_json(session, 'private-url', {}, 'fixture')
    assert len(session.calls) == 1 and response.closed


def test_retry_after_is_respected_or_refused_without_early_retry(monkeypatch):
    from scripts.census_http import CensusReadError, get_json, retry_delay
    sleeps = []
    monkeypatch.setattr(time, 'sleep', sleeps.append)
    session = Session(Response(429, {}, {'Retry-After': '9'}), Response(200, {}))
    get_json(session, 'private-url', {}, 'fixture')
    assert sleeps == [9]
    assert 8 <= retry_delay({'Retry-After': format_datetime(datetime.now(timezone.utc)+timedelta(seconds=10))}, 1) <= 10
    assert 2 <= retry_delay({'Retry-After': 'invalid'}, 1) <= 3
    too_long = Session(Response(429, {}, {'Retry-After': '3600'}))
    with pytest.raises(CensusReadError, match='bounded census wait'):
        get_json(too_long, 'private-url', {}, 'fixture')
    assert len(too_long.calls) == 1 and sleeps == [9]


def test_transport_timeout_is_bounded_and_does_not_echo_credentials(monkeypatch, capsys):
    import requests
    from scripts.census_http import get_json
    monkeypatch.setattr(time, 'sleep', lambda _: None)
    session = Session(requests.exceptions.Timeout('secret-test-token-never-log'), Response(200, {'ok': True}))
    assert get_json(session, 'private-url', {}, 'fixture') == {'ok': True}
    assert 'secret-test-token-never-log' not in capsys.readouterr().err


def test_malformed_json_is_refused_without_retry(monkeypatch):
    from scripts.census_http import CensusReadError, get_json
    response = Response(200, {})
    monkeypatch.setattr(response, 'json', lambda: (_ for _ in ()).throw(ValueError('secret-test-token-never-log')))
    session = Session(response)
    with pytest.raises(CensusReadError, match='invalid JSON') as caught:
        get_json(session, 'private-url', {}, 'fixture')
    assert len(session.calls) == 1 and response.closed
    assert 'secret-test-token-never-log' not in str(caught.value)


@pytest.mark.parametrize('name,flag', [('climatology_drift_census', '--fail-on-drift'), ('served_freshness_census', '--fail-on-stale')])
@pytest.mark.parametrize('bad', [False, True])
def test_one_observation_produces_json_summary_and_unchanged_verdict(name, flag, bad, monkeypatch, capsys, tmp_path):
    module = load(name)
    now = datetime(2026, 9, 9, tzinfo=timezone.utc)
    class Clock:
        @staticmethod
        def now(_):
            return now
        fromisoformat = datetime.fromisoformat
    monkeypatch.setattr(module, 'datetime', Clock)
    if name.startswith('climatology'):
        baseline = {'written_at': now.isoformat(), 'references': {'a': .6, 'b': .7}, 'histogram': module.histogram([.6, .7])}
        path = tmp_path/'baseline.json'; path.write_text(json.dumps(baseline))
        monkeypatch.setattr(module, 'BASELINE_PATH', str(path))
        # Reference selection is independently tested; this control holds it fixed.
        monkeypatch.setattr(module, 'refs_of', lambda _: {'a': 3.1, 'b': 3.2} if bad else baseline['references'])
        payload = {'updated_at': now.isoformat(), 'spots': {'a': {}, 'b': {}}}
        expected_text = 'PSI vs baseline'
    else:
        stamp = (now-timedelta(hours=60 if bad else 3)).isoformat()
        payload = {'generated_at': now.isoformat(), 'frames': [{'runs': [[stamp, stamp]], 'spots': [{'name': 'control', 'run': 0}]}]}
        expected_text = 'RUN AGE'
    calls = []
    monkeypatch.setattr(module, '_fetch_json', lambda *_: calls.append(1) or payload)
    monkeypatch.setenv('SUPABASE_URL', 'https://fixture.test')
    monkeypatch.setenv('SUPABASE_SERVICE_ROLE_KEY', 'test-fixture')
    outputs = []
    for extra in [[], ['--summary-to-stderr']]:
        monkeypatch.setattr(sys, 'argv', [name, flag, '--json', *extra])
        assert module.main() == int(bad)
        output = capsys.readouterr()
        outputs.append(json.loads(output.out))
        if extra:
            assert expected_text in output.err
    assert len(calls) == 2 and outputs[0] == outputs[1]


def test_workflow_fetches_each_report_once_and_keeps_its_gate():
    import yaml
    data = yaml.safe_load((ROOT/'.github/workflows/forecast-calibration-census.yml').read_text(encoding='utf-8'))
    for script, gate in [('climatology_drift_census.py', '--fail-on-drift'), ('served_freshness_census.py', '--fail-on-stale')]:
        commands = [s['run'] for s in data['jobs']['census']['steps'] if script in s.get('run', '')]
        assert len(commands) == 1 and commands[0].count(script) == 1
        assert all(flag in commands[0] for flag in [gate, '--json', '--summary-to-stderr'])
