"""The forecast-window alert mirrors must equal their sources, and the flag must be declared where it is flipped.

`services/surf_alert_windows.py` copies three things it does not own: the alert UI's time windows, tide states and
condition ids (frontend/src/components/alerts/surfAlertConstants.js) and the tier ladder
(frontend/src/components/map/LayerAccessResolver.js, the ONLY place tier policy may live). Each copy is parsed
back out of its source here, so editing one side without the other fails CI instead of silently mis-gating.
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
RESOLVER_JS = os.path.join(REPO, "frontend", "src", "components", "map", "LayerAccessResolver.js")


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


def test_the_tier_ladder_equals_layer_access_resolver():
    src = _read(RESOLVER_JS)
    m = re.search(r"var TIER_ACCESS = \{(.*?)\n\};", src, re.S)
    assert m
    js = {}
    for tier, models, days in re.findall(r"(\w+):\s*\{\s*models:\s*\[([^\]]*)\],\s*forecastDays:\s*(\d+)",
                                         m.group(1)):
        js[tier] = {"models": tuple(re.findall(r"'([^']+)'", models)), "forecast_days": int(days)}
    assert js == W.TIER_ACCESS


@pytest.mark.parametrize("raw,tier", [
    (None, "guest"), ("", "guest"), ("guest", "guest"), ("free", "free"), ("tier_1", "free"),
    ("basic", "basic"), ("paid", "basic"), ("tier_2", "basic"), ("premium", "premium"), ("pro", "premium"),
    ("parent", "premium"), ("admin", "premium"), ("tier_3", "premium"), ("tier_4", "premium"),
    ("gold", "guest"), ("FREE_TRIAL", "free"), ("Premium Annual", "premium"),
])
def test_canonical_tier_follows_get_user_tier(raw, tier):
    assert W.canonical_tier(raw) == tier


def test_get_user_tier_still_has_the_branches_this_mirror_copies():
    """If getUserTier gains or loses a keyword, the parametrized table above is stale: fail here."""
    body = _read(RESOLVER_JS).split("export function getUserTier", 1)[1].split("\n}\n", 1)[0]
    keywords = sorted(set(re.findall(r"includes\('([^']+)'\)", body)))
    assert keywords == ["admin", "basic", "free", "paid", "parent", "premium", "pro"]
    assert sorted(set(re.findall(r"'(tier_\d)'", body))) == ["tier_1", "tier_2", "tier_3", "tier_4"]


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
