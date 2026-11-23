"""Bug hunt 2026-11-22 item E: the spot hub's "now" and the map's "Now" are ONE rule.

The hub floored the UTC hour (`spot_hub_composition.current_valid_time`) while the map rounds to the nearest hour
(`getSeriesAnchorMs`, frontend/src/components/map/backendWeatherServiceClient.js). With nearest-pick on 3-hourly
products, at 10:40Z the hub showed the 09Z product and the map 12Z (30 of every 180 minutes).

Both sides read the SAME fixture, frontend/src/tests/fixtures/now-anchor-parity.json; the Jest half is
frontend/src/tests/nowAnchorParity.test.js. Kill switch HUB_NOW_NEAREST_HOUR='0' restores the floor."""
import json
import os
import sys
from datetime import datetime, timezone

import pytest

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.dirname(BACKEND)
sys.path.insert(0, BACKEND)

from services import runtime_flags as RF  # noqa: E402
from services.weather_pipeline import sim_forecast as SIM  # noqa: E402
from services.weather_pipeline import spot_hub_composition as HUB  # noqa: E402

FIXTURE = os.path.join(REPO, "frontend", "src", "tests", "fixtures", "now-anchor-parity.json")


def _parse(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def _cases():
    with open(FIXTURE, encoding="utf-8") as fh:
        return json.load(fh)["cases"]


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.delenv("HUB_NOW_NEAREST_HOUR", raising=False)


def test_flag_is_guarded_and_on():
    assert RF.GUARDED["HUB_NOW_NEAREST_HOUR"] == "1"


@pytest.mark.parametrize("case", _cases(), ids=lambda c: c["now"])
def test_hub_now_matches_the_map_anchor(case):
    assert HUB.current_valid_time(_parse(case["now"])) == _parse(case["anchor"])


@pytest.mark.parametrize("case", _cases(), ids=lambda c: c["now"])
def test_sim_now_matches_the_map_anchor(case):
    """The sim's default sample hour is the same "now" (it floored too)."""
    assert SIM.current_valid_time(_parse(case["now"])) == _parse(case["anchor"]).strftime("%Y-%m-%dT%H:%M:%SZ")


def test_the_reported_case_hub_and_map_pick_the_same_3_hourly_product():
    now = _parse("2026-11-22T10:40:00Z")
    products = [_parse(f"2026-11-22T{h:02d}:00:00Z") for h in (6, 9, 12, 15)]
    hub = HUB.current_valid_time(now)
    nearest = min(products, key=lambda p: abs((p - hub).total_seconds()))
    assert nearest == _parse("2026-11-22T12:00:00Z")


def test_kill_switch_restores_the_floor(monkeypatch):
    monkeypatch.setenv("HUB_NOW_NEAREST_HOUR", "0")
    assert HUB.current_valid_time(_parse("2026-11-22T10:40:00Z")) == _parse("2026-11-22T10:00:00Z")
    assert SIM.current_valid_time(_parse("2026-11-22T10:40:00Z")) == "2026-11-22T10:00:00Z"
