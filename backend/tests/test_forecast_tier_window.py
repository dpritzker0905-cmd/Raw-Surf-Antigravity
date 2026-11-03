"""The hub endpoints send each tier the app resolver's window, and no more (spot-hub phase 1, 2026-11-03).

`services/forecast_tier_window.py` is the server-side ECHO of LayerAccessResolver.js, so the first tests read that
JS file and pin the numbers and the tier mapping to it: if the resolver moves, the echo goes red instead of drifting
into a second ladder. The rest pin the rolling-72 h rule at the boundary, the locked-date previews, the kill switch,
and that `/explore/spot-details` keeps its request shape (forecast_days=11) while trimming what it sends.
"""
import os
import re
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

from services import forecast_tier_window as W
from services.weather_pipeline.capabilities import WEATHER_CAPABILITIES

RESOLVER_JS = os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "src", "components", "map",
                           "LayerAccessResolver.js")
NOW = datetime(2026, 11, 3, 4, 55, tzinfo=timezone.utc)
ROWS = [{"date": f"2026-11-{d:02d}", "wave_height_max": 3.0} for d in range(4, 14)]   # tomorrow-first, 10 rows


def _resolver_days():
    src = open(RESOLVER_JS, encoding="utf-8").read()
    block = src[src.index("TIER_ACCESS = {"):src.index("};", src.index("TIER_ACCESS = {"))]
    return {m.group(1): int(m.group(2)) for m in re.finditer(r"(\w+):\s*\{[^}]*?forecastDays:\s*(\d+)", block)}


def test_tier_days_are_the_resolvers_numbers():
    assert _resolver_days() == W.TIER_FORECAST_DAYS


@pytest.mark.parametrize("raw,tier", [
    ("free", "free"), ("tier_1", "free"), ("basic", "basic"), ("paid", "basic"), ("tier_2", "basic"),
    ("premium", "premium"), ("pro", "premium"), ("admin", "premium"), ("tier_3", "premium"), ("tier_4", "premium"),
    ("gold", "guest"), (None, "guest"), ("", "guest"), ("anything", "guest"),
])
def test_canonical_tier_follows_getUserTier(raw, tier):
    assert W.canonical_tier(raw) == tier


def test_resolver_js_still_has_the_rules_this_mirrors():
    # The substring rules canonical_tier copies; a reworded getUserTier must re-check the mirror.
    src = open(RESOLVER_JS, encoding="utf-8").read()
    for needle in ("includes('free')", "=== 'tier_1'", "includes('basic')", "includes('paid')", "=== 'tier_2'",
                   "includes('premium')", "includes('pro')", "includes('parent')", "includes('admin')",
                   "['tier_3', 'tier_4']"):
        assert needle in src, needle


def test_horizon_is_tier_days_clamped_by_capabilities():
    gfs_waves = max(c["max_forecast_hours"] for c in WEATHER_CAPABILITIES
                    if c["model"] == "GFS" and c["layer"] == "waves")
    assert W.tier_horizon_hours("free", "GFS") == 72
    assert W.tier_horizon_hours("basic", "GFS") == 168
    assert W.tier_horizon_hours("premium", "GFS") == min(14, gfs_waves // 24) * 24
    short = [{"model": "ICON", "domain": "marine", "layer": "waves", "max_forecast_hours": 168}]
    assert W.tier_horizon_hours("premium", "ICON", short) == 168
    assert W.tier_horizon_hours("premium", "EURO", short) == 336   # no row for the model: the tier's days


def test_free_window_is_rolling_72h_at_the_boundary():
    sent, withheld = W.split_forecast_rows(ROWS, 72, NOW)          # 04:55Z: Nov 6 12Z is 79 h out
    assert [r["date"] for r in sent] == ["2026-11-04", "2026-11-05"]
    assert withheld[0] == "2026-11-06" and len(withheld) == 8
    sent, _ = W.split_forecast_rows(ROWS, 72, NOW.replace(hour=12, minute=0))   # exactly 72 h: open
    assert [r["date"] for r in sent][-1] == "2026-11-06"
    sent, withheld = W.split_forecast_rows([{"date": "bad"}, {"wave_height_max": 9}] + ROWS, 72, NOW)
    assert len(sent) == 2 and len(withheld) == 8                     # an unplaceable row cannot bypass the window


def test_apply_window_trims_names_and_counts(monkeypatch):
    monkeypatch.delenv("SPOT_FORECAST_TIER_HORIZON", raising=False)
    payload = {"forecast": list(ROWS)}
    W.apply_tier_window(payload, "basic", "GFS", NOW)
    assert len(payload["forecast"]) == 6 and payload["forecast_horizon_hours"] == 168
    assert payload["forecast_locked_dates"] == [f"2026-11-{d:02d}" for d in range(10, 14)]
    assert payload["forecast_days_allowed"] == 6
    assert all(isinstance(d, str) for d in payload["forecast_locked_dates"])   # dates only, no data


def test_kill_switch_restores_the_full_payload_and_the_old_figures(monkeypatch):
    monkeypatch.setenv("SPOT_FORECAST_TIER_HORIZON", "0")
    payload = {"forecast": list(ROWS)}
    W.apply_tier_window(payload, "free", "GFS", NOW)
    assert payload == {"forecast": ROWS}
    assert [W.days_allowed(t) for t in ("free", "basic", "premium", "gold")] == [3, 7, 10, 10]
    monkeypatch.setenv("SPOT_FORECAST_TIER_HORIZON", "1")
    assert [W.days_allowed(t) for t in ("free", "basic", "premium", "gold")] == [3, 7, 14, 3]


def _db():
    from routes.explore_discover import spot_details  # noqa: F401 - the module under test below
    spot = SimpleNamespace(id="tier-spot", name="Tier beach", region="Coast", difficulty=None, image_url=None,
                           latitude=28.4, longitude=-80.6, description=None, best_tide=None)
    first = Mock()
    first.scalar_one_or_none.return_value = spot
    empty = Mock()
    empty.scalars.return_value.all.return_value = []
    return SimpleNamespace(execute=AsyncMock(side_effect=[first, empty, empty, empty, empty]))


@pytest.mark.asyncio
async def test_spot_details_sends_free_only_its_window_with_the_same_request(monkeypatch):
    from routes.explore_discover import spot_details as route
    monkeypatch.delenv("SPOT_FORECAST_TIER_HORIZON", raising=False)
    resolver = AsyncMock(return_value={"current_conditions": {"wave_height_ft": 2.0}, "forecast": list(ROWS)})
    monkeypatch.setattr(route.point_resolution_service, "resolve_spot_conditions", resolver)
    real_split = W.split_forecast_rows
    monkeypatch.setattr(W, "split_forecast_rows", lambda rows, hours, now=None: real_split(rows, hours, NOW))
    out = await route.get_spot_details("tier-spot", subscription_tier="free", model="GFS", db=_db())
    resolver.assert_awaited_once_with(model="GFS", lat=28.4, lng=-80.6, forecast_days=11, spot_id="tier-spot")
    assert [r["date"] for r in out["forecast"]] == ["2026-11-04", "2026-11-05"]
    assert len(out["forecast_locked_dates"]) == 8 and out["forecast_horizon_hours"] == 72
    assert out["forecast_status"] == "ready"
