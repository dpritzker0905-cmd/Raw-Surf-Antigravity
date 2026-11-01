"""configure_logfire never stops the API from booting (2026-10-21 Render deploy failure).

Render had LOGFIRE_ENABLED=1 and no LOGFIRE_TOKEN; logfire.configure raised LogfireConfigError at import time
of server.py and the deploy failed. These tests use a stand-in logfire module, so they never touch the real
SDK's global state, credentials or network.
"""
import sys
import types

import pytest

from services.logfire_setup import configure_logfire


class _FakeConfigError(Exception):
    pass


def _install_fake_logfire(monkeypatch, *, configure_raises=False):
    calls = {"configure": 0, "fastapi": [], "metrics": 0}
    mod = types.ModuleType("logfire")
    exc_mod = types.ModuleType("logfire.exceptions")
    exc_mod.LogfireConfigError = _FakeConfigError

    def configure(**kwargs):
        calls["configure"] += 1
        calls["configure_kwargs"] = kwargs
        if configure_raises:
            raise _FakeConfigError("no credential")

    def instrument_fastapi(app, **kwargs):
        calls["fastapi"].append(kwargs)

    def instrument_system_metrics(**kwargs):
        calls["metrics"] += 1

    mod.configure = configure
    mod.instrument_fastapi = instrument_fastapi
    mod.instrument_system_metrics = instrument_system_metrics
    mod.exceptions = exc_mod
    monkeypatch.setitem(sys.modules, "logfire", mod)
    monkeypatch.setitem(sys.modules, "logfire.exceptions", exc_mod)
    return calls


def test_disabled_does_not_touch_logfire(monkeypatch):
    monkeypatch.delenv("LOGFIRE_ENABLED", raising=False)
    calls = _install_fake_logfire(monkeypatch)
    assert configure_logfire(object()) is False
    assert calls["configure"] == 0 and calls["fastapi"] == [] and calls["metrics"] == 0


def test_missing_credential_warns_and_boots(monkeypatch, caplog):
    # The exact Render state: enabled, no token, so configure raises LogfireConfigError.
    monkeypatch.setenv("LOGFIRE_ENABLED", "1")
    monkeypatch.delenv("LOGFIRE_TOKEN", raising=False)
    calls = _install_fake_logfire(monkeypatch, configure_raises=True)
    with caplog.at_level("WARNING", logger="services.logfire_setup"):
        assert configure_logfire(object()) is False
    assert calls["configure"] == 1
    assert calls["fastapi"] == [] and calls["metrics"] == 0  # nothing half-instrumented
    assert "LOGFIRE_TOKEN" in caplog.text


def test_any_setup_error_warns_and_boots(monkeypatch, caplog):
    # A user-level `logfire auth` file without a project makes configure try a network lookup; a TLS failure there
    # raised requests' SSLError (2026-10-21, this repo's dev machine), not LogfireConfigError.
    monkeypatch.setenv("LOGFIRE_ENABLED", "1")
    calls = _install_fake_logfire(monkeypatch)

    def boom(app, **kwargs):
        raise RuntimeError("network")

    sys.modules["logfire"].instrument_fastapi = boom
    with caplog.at_level("WARNING", logger="services.logfire_setup"):
        assert configure_logfire(object()) is False
    assert calls["configure"] == 1 and calls["metrics"] == 0
    assert "RuntimeError" in caplog.text


def test_missing_package_warns_and_boots(monkeypatch, caplog):
    monkeypatch.setenv("LOGFIRE_ENABLED", "1")
    monkeypatch.setitem(sys.modules, "logfire", None)  # import logfire -> ImportError
    with caplog.at_level("WARNING", logger="services.logfire_setup"):
        assert configure_logfire(object()) is False
    assert "unavailable" in caplog.text


def test_configured_instruments_without_headers(monkeypatch):
    monkeypatch.setenv("LOGFIRE_ENABLED", "1")
    calls = _install_fake_logfire(monkeypatch)
    assert configure_logfire(object(), local_only=True) is True
    assert calls["configure_kwargs"]["send_to_logfire"] is False
    assert len(calls["fastapi"]) == 1 and calls["fastapi"][0]["capture_headers"] is False
    assert calls["metrics"] == 1


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-q"]))
