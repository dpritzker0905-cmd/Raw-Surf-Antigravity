"""
Open-Meteo shared 429 CIRCUIT BREAKER (2026-07-24, the Render restart-under-load).

Render crash-log signature: a burst of ICON marine work on a 512 MB / 1-CPU box interleaved with a
storm of POST /v1/marine that all 429, each retrying with 8·attempt backoff (up to 120 s HELD per
request), then a 9 s silent gap and a no-traceback restart — an OOM/health-timeout kill. N held 429
requests pin connections + task state + buffers on a tiny box and hammer an already-rate-limited
upstream. The breaker makes the FIRST 429 open a shared cooldown so every other request fails FAST to
the caller's existing stored/cached fallback (the SAME RuntimeError the retry-exhaustion path raises),
in ~0 s instead of up to 120 s.

These tests assert the REAL invariant — the breaker's open/closed state machine and its kill switch —
not a log string. The state is time.monotonic-based, so tests drive it by monkeypatching the clock,
never by sleeping.
"""
import time

import pytest

from services.weather_pipeline.providers.open_meteo_provider import OpenMeteoProvider


@pytest.fixture(autouse=True)
def _reset_breaker(monkeypatch):
    # Each test starts with the breaker closed and the kill switch unset.
    monkeypatch.delenv("OPEN_METEO_BREAKER_DISABLED", raising=False)
    monkeypatch.delenv("OPEN_METEO_BREAKER_COOLDOWN_SEC", raising=False)
    OpenMeteoProvider._rate_limited_until = 0.0
    yield
    OpenMeteoProvider._rate_limited_until = 0.0


def _fake_clock(monkeypatch, value):
    monkeypatch.setattr(
        "services.weather_pipeline.providers.open_meteo_provider.time.monotonic",
        lambda: value,
    )


def test_closed_by_default():
    assert OpenMeteoProvider._breaker_open() is False


def test_trip_opens_the_breaker(monkeypatch):
    _fake_clock(monkeypatch, 1000.0)
    OpenMeteoProvider._trip_breaker()
    # Immediately after tripping, still inside the cooldown → open.
    assert OpenMeteoProvider._breaker_open() is True


def test_breaker_closes_after_the_cooldown(monkeypatch):
    monkeypatch.setenv("OPEN_METEO_BREAKER_COOLDOWN_SEC", "30")
    _fake_clock(monkeypatch, 1000.0)
    OpenMeteoProvider._trip_breaker()
    assert OpenMeteoProvider._breaker_open() is True

    _fake_clock(monkeypatch, 1029.9)          # still inside 30 s
    assert OpenMeteoProvider._breaker_open() is True

    _fake_clock(monkeypatch, 1030.1)          # past the cooldown
    assert OpenMeteoProvider._breaker_open() is False


def test_kill_switch_forces_closed_even_when_tripped(monkeypatch):
    _fake_clock(monkeypatch, 1000.0)
    OpenMeteoProvider._trip_breaker()
    assert OpenMeteoProvider._breaker_open() is True

    # The kill switch must make the breaker a no-op regardless of the tripped timestamp,
    # restoring the pre-fix per-request retry behaviour for a clean live A/B.
    monkeypatch.setenv("OPEN_METEO_BREAKER_DISABLED", "1")
    assert OpenMeteoProvider._breaker_open() is False


def test_kill_switch_makes_trip_a_noop(monkeypatch):
    monkeypatch.setenv("OPEN_METEO_BREAKER_DISABLED", "1")
    _fake_clock(monkeypatch, 1000.0)
    OpenMeteoProvider._trip_breaker()
    # With the kill switch set, tripping stores nothing, so even clearing the switch leaves it closed.
    monkeypatch.delenv("OPEN_METEO_BREAKER_DISABLED", raising=False)
    _fake_clock(monkeypatch, 1000.0)
    assert OpenMeteoProvider._breaker_open() is False


def test_cooldown_is_env_tunable(monkeypatch):
    monkeypatch.setenv("OPEN_METEO_BREAKER_COOLDOWN_SEC", "5")
    _fake_clock(monkeypatch, 2000.0)
    OpenMeteoProvider._trip_breaker()
    _fake_clock(monkeypatch, 2004.0)          # inside 5 s
    assert OpenMeteoProvider._breaker_open() is True
    _fake_clock(monkeypatch, 2005.1)          # past 5 s
    assert OpenMeteoProvider._breaker_open() is False


def test_malformed_cooldown_falls_back_to_default(monkeypatch):
    monkeypatch.setenv("OPEN_METEO_BREAKER_COOLDOWN_SEC", "not-a-number")
    _fake_clock(monkeypatch, 3000.0)
    OpenMeteoProvider._trip_breaker()          # must not raise
    _fake_clock(monkeypatch, 3029.0)           # inside the 30 s default
    assert OpenMeteoProvider._breaker_open() is True
