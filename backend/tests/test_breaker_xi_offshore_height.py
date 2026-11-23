"""Bug hunt 2026-11-22 item G (dormant): the breaker-type Iribarren number was fed the BREAKING height.

`surf_transform.iribarren(slope, Hs, Tp)` is the DEEP-WATER surf-similarity number xi0 = tan(beta) / sqrt(H0 / L0): its
H0 is the offshore significant height (its own docstring, Battjes 1974). `spot_ratings.rate_one_spot` passed `surf_h`,
the nearshore breaking height, so xi0 came out wrong by sqrt(surf_h / offshore_h) (the report: about 21% low at
Pipeline, 0.319 -> 0.253). The factor is behind RATING_BREAKER_TYPE, OFF, so nothing served moves; this fixes the input
before that flag is ever turned on."""
import asyncio
import os
import sys
from datetime import datetime, timezone

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.weather_pipeline import bathymetry  # noqa: E402
from services.weather_pipeline import spot_ratings as SPR  # noqa: E402
from services.weather_pipeline import surf_transform  # noqa: E402
from tests.test_spot_hub_rate_one_spot import TRESTLES, FakeResolver, _height_at  # noqa: E402

VT = "2026-11-03T21:00:00Z"


@pytest.fixture
def seen(monkeypatch):
    for k in ("RATING_OBS_GATE", "RATING_LOCAL_SIZE", "RATING_TIDE"):
        monkeypatch.setenv(k, "0")
    monkeypatch.setenv("RATING_BREAKER_TYPE", "1")
    monkeypatch.setattr(bathymetry, "bed_slope_at", lambda lat, lng: 0.05)
    calls = []
    real = surf_transform.iribarren

    def spy(slope, h, tp):
        calls.append((slope, h, tp))
        return real(slope, h, tp)
    monkeypatch.setattr(surf_transform, "iribarren", spy)
    return calls


def test_iribarren_gets_the_offshore_height_not_the_breaking_height(seen):
    asyncio.run(SPR.rate_one_spot(FakeResolver(), TRESTLES, "GFS", VT))
    assert seen, "RATING_BREAKER_TYPE=1 must compute xi"
    dt = datetime(2026, 11, 3, 21, tzinfo=timezone.utc)
    offshore, breaking = _height_at(dt) * 0.9, _height_at(dt) + 0.01234      # FakeResolver's point.speed / surf_height_m
    slope, h, _tp = seen[-1]
    assert slope == 0.05
    assert h == pytest.approx(offshore) and h != pytest.approx(breaking)


def test_flag_off_computes_nothing(seen, monkeypatch):
    monkeypatch.setenv("RATING_BREAKER_TYPE", "0")
    asyncio.run(SPR.rate_one_spot(FakeResolver(), TRESTLES, "GFS", VT))
    assert seen == []
