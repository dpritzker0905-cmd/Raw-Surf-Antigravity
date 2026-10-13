"""/api/health publishes `serving_gates` (audit 14.1, 2026-09-23) so the product run-age census can
grade a deliberately unserved lane as GATED instead of paging on it forever. Source-shape checks,
the convention of test_health_peak_memory.py (calling the route needs a live DB)."""
import ast
import os

from services.weather_pipeline.island_gate import island_serving_armed

_SRC = open(os.path.join(os.path.dirname(__file__), "..", "routes", "health.py"), encoding="utf-8").read()


def test_the_health_payload_declares_serving_gates():
    tree = ast.parse(_SRC)
    keys = {k.value for n in ast.walk(tree) if isinstance(n, ast.Dict)
            for k in n.keys if isinstance(k, ast.Constant)}
    assert "serving_gates" in keys


def test_the_gate_is_read_through_the_resolvers_own_function():
    # One source of truth: the monitor must read the SAME switch the serving path reads.
    assert "from services.weather_pipeline.island_gate import island_serving_armed" in _SRC
    assert '{"island": bool(island_serving_armed())}' in _SRC


def test_island_serving_defaults_disarmed_and_arms_only_on_1(monkeypatch):
    monkeypatch.delenv("COPERNICUS_ISLAND_SERVE", raising=False)
    assert island_serving_armed() is False
    monkeypatch.setenv("COPERNICUS_ISLAND_SERVE", "1")
    assert island_serving_armed() is True
    monkeypatch.setenv("COPERNICUS_ISLAND_SERVE", "0")
    assert island_serving_armed() is False
