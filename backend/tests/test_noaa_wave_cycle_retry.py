"""WI06: a recoverable probe refusal must not masquerade as an absent newer cycle."""
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace as S

import pytest

from services.noaa_gfs_wave_fetcher import _pick_cycle

NEWEST = datetime(2026, 10, 6, 6, tzinfo=timezone.utc)


@pytest.mark.parametrize('failure', [500, 502, 503, 504, 429, 'timeout'])
@pytest.mark.parametrize('endpoint', ['f000', 'f120'])
def test_transient_first_or_final_probe_recovers_newest(monkeypatch, failure, endpoint):
    monkeypatch.setenv('NOAA_WAVE_CYCLE_RETRY', '1')
    failed = False
    calls = []

    def head(url, **kwargs):
        nonlocal failed
        calls.append(url)
        if '/gfs.20261006/06/' in url and url.endswith(endpoint + '.grib2.idx') and not failed:
            failed = True
            if failure == 'timeout':
                raise TimeoutError('offline fixture')
            return S(status_code=failure, headers={})
        return S(status_code=200, headers={})

    actual, prefix = _pick_cycle(S(head=head), NEWEST + timedelta(hours=5), 120)
    assert actual == NEWEST and '/gfs.20261006/06/' in prefix
    assert len(calls) == 3


@pytest.mark.parametrize('flag', [None, '0', 'true'])
def test_unset_off_noncanonical_retains_legacy_cycle_selection(monkeypatch, flag):
    if flag is None:
        monkeypatch.delenv('NOAA_WAVE_CYCLE_RETRY', raising=False)
    else:
        monkeypatch.setenv('NOAA_WAVE_CYCLE_RETRY', flag)
    calls = []

    def head(url, **kwargs):
        calls.append((url, kwargs))
        return S(status_code=500 if '/gfs.20261006/06/' in url else 200)

    assert _pick_cycle(S(head=head), NEWEST + timedelta(hours=5), 120)[0] == NEWEST - timedelta(hours=6)
    assert len(calls) == 4 and all(k['timeout'] == 60 for _, k in calls)


@pytest.mark.parametrize('status', [404, 401, 403, 400])
def test_terminal_refusal_is_not_retried(monkeypatch, status):
    monkeypatch.setenv('NOAA_WAVE_CYCLE_RETRY', '1')
    calls = []

    def head(url, **kwargs):
        calls.append(url)
        return S(status_code=status if '/gfs.20261006/06/' in url else 200, headers={})

    assert _pick_cycle(S(head=head), NEWEST + timedelta(hours=5), 120)[0] == NEWEST - timedelta(hours=6)
    assert len([u for u in calls if '/gfs.20261006/06/' in u]) == 1


def test_all_missing_cycles_remain_unavailable(monkeypatch):
    monkeypatch.setenv('NOAA_WAVE_CYCLE_RETRY', '1')
    calls = []
    client = S(head=lambda url, **kwargs: calls.append(url) or S(status_code=404, headers={}))
    assert _pick_cycle(client, NEWEST, 120) == (None, None)
    assert len(calls) == 7


@pytest.fixture
def clock(monkeypatch):
    from services import _fetch_wave_cycle as policy
    monkeypatch.setenv('NOAA_WAVE_CYCLE_RETRY', '1')
    state = S(now=0.0, sleeps=[])
    monkeypatch.setattr(policy.time, 'monotonic', lambda: state.now)

    def sleep(seconds):
        state.sleeps.append(seconds)
        state.now += seconds

    monkeypatch.setattr(policy.time, 'sleep', sleep)
    monkeypatch.setattr(policy.random, 'uniform', lambda lo, hi: 0.2)
    return state


def test_total_budget_rejects_late_success_and_limits_calls(clock):
    calls = []

    def head(url, **kwargs):
        calls.append(kwargs['timeout'])
        clock.now += 13
        return S(status_code=200, headers={})

    assert _pick_cycle(S(head=head), NEWEST, 120) == (None, None)
    assert calls == [3.0] and clock.sleeps == []


def test_continuous_timeouts_do_not_multiply_full_socket_timeout(clock):
    calls = []

    def head(url, **kwargs):
        calls.append(kwargs['timeout'])
        clock.now += kwargs['timeout']
        raise TimeoutError('offline budget fixture')

    assert _pick_cycle(S(head=head), NEWEST, 120) == (None, None)
    assert len(calls) == 4 and clock.now == 12.0
    assert max(calls) <= 3 and len(clock.sleeps) == 2


@pytest.mark.parametrize('hint', ['30', 'nan', 'Wed, 07 Oct 2026 00:00:00 GMT', 'bad'])
def test_excessive_or_unparsed_retry_after_is_not_ignored(clock, hint):
    calls = []

    def head(url, **kwargs):
        calls.append(url)
        return S(status_code=429, headers={'Retry-After': hint})

    assert _pick_cycle(S(head=head), NEWEST, 120) == (None, None)
    assert len(calls) == 1 and clock.sleeps == []


def test_numeric_retry_after_and_closed_responses(clock):
    responses = []

    def head(url, **kwargs):
        r = S(status_code=503 if not responses else 200, headers={'Retry-After': '1'}, closed=False)
        r.close = lambda: setattr(r, 'closed', True)
        responses.append(r)
        return r

    assert _pick_cycle(S(head=head), NEWEST, 120)[0] == NEWEST
    assert clock.sleeps == [1.0] and len(responses) == 3
    assert all(r.closed for r in responses)


def test_unexpected_exception_not_retried(clock):
    calls = []

    def head(url, **kwargs):
        calls.append(url)
        raise ValueError('malformed offline response')

    assert _pick_cycle(S(head=head), NEWEST, 120) == (None, None)
    assert len(calls) == 7 and clock.sleeps == []


@pytest.mark.parametrize('error_name', ['Timeout', 'ConnectionError'])
def test_actual_requests_transport_exceptions_are_retried(clock, error_name):
    import requests
    calls = []

    def head(url, **kwargs):
        calls.append(url)
        if len(calls) == 1:
            raise getattr(requests, error_name)('offline transport fixture')
        return S(status_code=200, headers={})

    assert _pick_cycle(S(head=head), NEWEST, 120)[0] == NEWEST
    assert len(calls) == 3 and clock.sleeps == [0.2]


def test_repeated_server_failure_has_finite_attempts(clock):
    calls = []
    client = S(head=lambda url, **kwargs: calls.append(url) or S(status_code=503, headers={}))
    assert _pick_cycle(client, NEWEST, 120) == (None, None)
    assert len(calls) == 14 and len(clock.sleeps) == 7


def test_final_endpoint_late_success_cannot_certify_complete_cycle(clock):
    calls = []

    def head(url, **kwargs):
        calls.append(url)
        if len(calls) == 2:
            clock.now = 13
        return S(status_code=200, headers={})

    assert _pick_cycle(S(head=head), NEWEST, 120) == (None, None)
    assert len(calls) == 2
