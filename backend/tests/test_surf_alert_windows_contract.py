"""The forecast-window alert mirrors must equal their sources, and the flag must be declared where it is flipped.

`services/surf_alert_windows.py` copies what it does not own from the alert UI: time windows, tide states and
condition ids (frontend/src/components/alerts/surfAlertConstants.js). Each copy is parsed back out of its source
here, so editing one side without the other fails CI instead of silently mis-gating. The TIER ladder is not copied:
alerts read the backend's one echo of LayerAccessResolver, services/forecast_tier_window.py, which
tests/test_forecast_tier_window.py pins to the JS; the last test here pins that alerts use it.
"""
import ast
import os
import re
import sys

import pytest

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.dirname(backend_dir)
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from services import surf_alert_windows as W  # noqa: E402

CONSTANTS_JS = os.path.join(REPO, "frontend", "src", "components", "alerts", "surfAlertConstants.js")


def _read(path):
    if not os.path.exists(path):
        pytest.skip(f"{path} not in this checkout")
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def _block(src, name):
    m = re.search(name + r"\s*=\s*\[(.*?)\n\];", src, re.S)
    assert m, f"{name} not found"
    return m.group(1)


def _hour(text):
    n, ampm = re.fullmatch(r"(\d+)(am|pm)", text.strip()).groups()
    n = int(n) % 12
    return n + (12 if ampm == "pm" else 0)


def test_time_windows_equal_the_alert_ui():
    rows = re.findall(r"id:\s*'([^']+)'.*?time:\s*'([^']+)'", _block(_read(CONSTANTS_JS), "TIME_WINDOWS"))
    ui = {wid: tuple(_hour(t) for t in span.split("-")) for wid, span in rows}
    assert ui == W.TIME_WINDOW_HOURS


def test_tide_states_equal_the_alert_ui():
    ids = re.findall(r"id:\s*'([^']+)'", _block(_read(CONSTANTS_JS), "TIDE_STATES"))
    assert sorted(ids) == sorted(W.TIDE_LEVEL_STATES + W.TIDE_TREND_STATES)
    for level in W.TIDE_LEVEL_STATES:
        assert W.SR.parse_best_tide(level), f"{level} has no band in surf_rating._TIDE_BANDS"


def test_every_condition_the_ui_offers_is_either_evaluated_or_named_unevaluated():
    ids = set(re.findall(r"id:\s*'([^']+)'", _block(_read(CONSTANTS_JS), "SURF_CONDITIONS")))
    evaluated = {c for axis in W.CONDITION_AXES.values() for c in axis}
    assert ids == evaluated | set(W.UNEVALUATED_CONDITIONS)
    assert not evaluated & set(W.UNEVALUATED_CONDITIONS)


# ── the flag ────────────────────────────────────────────────────────────────────────────────────────────
def _registry():
    tree = ast.parse(_read(os.path.join(backend_dir, "routes", "admin", "surf_forecast.py")))
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and any(getattr(t, "id", None) == "_RATING_FLAGS" for t in node.targets):
            return ast.literal_eval(node.value)
    raise AssertionError("_RATING_FLAGS not found")


def test_the_flag_is_registered_default_off_with_both_lanes_named():
    default, _controls, where = _registry()[W.FLAG]
    assert default == "0" and "precompute" in where and "Render" in where


def test_precompute_yml_declares_the_flag_at_its_default():
    src = _read(os.path.join(REPO, ".github", "workflows", "precompute.yml"))
    assert re.search(r"\n\s+ALERTS_FORECAST_WINDOWS:\s*'0'", src)


def test_every_alert_window_knob_is_read_with_a_safe_default(monkeypatch):
    for k, bad in (("ALERTS_FORECAST_HORIZON_H", "999"), ("ALERTS_WINDOW_MIN_HOURS", "x"),
                   ("ALERTS_WINDOW_MIN_LEVEL", "superb"), ("ALERTS_HORIZON_MAX_AGE_H", "-3"),
                   ("ALERTS_NOTIFY_LEAD_H", "200")):
        monkeypatch.setenv(k, bad)
    assert (W.configured_horizon_h(), W.min_window_hours(), W.min_level(), W.max_horizon_age_h(),
            W.notify_lead_h()) == (72, 2, "fair", 12, 24)
    monkeypatch.setenv(W.FLAG, "1")
    assert W.enabled()
    monkeypatch.setenv(W.FLAG, "true")
    assert not W.enabled()


def test_alerts_keep_no_tier_ladder_and_read_the_one_echo():
    from services import forecast_tier_window as FTW
    src = _read(os.path.join(backend_dir, "services", "surf_alert_windows.py"))
    assert "TIER_ACCESS" not in src and "forecast_days" not in src and "forecastDays" not in src
    assert W.canonical_tier is FTW.canonical_tier
    assert W.resolve_model_lane(None, "free", ["EURO", "GFS"], "EURO") == ("GFS", "first_permitted")
    assert W.horizon_h("free", "GFS") == min(W.configured_horizon_h(), FTW.tier_horizon_hours("free", "GFS"))
