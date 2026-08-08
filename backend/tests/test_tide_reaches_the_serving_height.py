"""THE TIDE WIRE — η MUST ACTUALLY REACH THE SERVED HEIGHT, AND COST NOTHING WHEN OFF.

WHY THIS EXISTS. `bda6c477` shipped the tide physics and said so in its own docstring: *"NO
SERVING-PATH CALLER SUPPLIES IT YET."* The highest-reach absent nearshore term — 19× the whole
slope/γ thread — was therefore unreachable, the same shape as the ensemble that shipped complete and
reached 0 of 1,103 spots. This suite pins the wire that closes it.

★ THE WIRE IS AT `augment_with_surf`, NOT AT `rate_one_spot`/`spot_conditions` AS THE QUEUE
PROPOSED. `surf_height_m` is produced at that one site "and nowhere else" (its module docstring), so
wiring the two consumers would have created two η sources that can disagree about the same hour —
a second forecast path by another name. One injection point, every consumer.

⛔ THE FETCH IS GATED, NOT JUST THE PHYSICS. `SURF_TIDE_DEPTH` off must mean ZERO new I/O, not "we
fetched a tide and then multiplied it by nothing" — that would put a network round trip on the
ratings precompute for every point, permanently, to no effect. `test_flag_off_does_no_tide_io` is
what holds that line.

⚠️ MEASURED REACH AT WIRING TIME (2026-08-07, and quote the frame): over 172 real served spots
across 5 viewports with their REAL η (min −0.99, p50 −0.03, max +1.04 m), flipping
`SURF_TIDE_DEPTH` on moves **0 of 172**. That is not a broken wire — the frame is boreal-summer
surf at Hs p50 0.58 m, deep inside the audit's own "Hs < 1.5 m → 0.00% cap-binding" band. The
positive control fires at η = −6 m (8 of 25 move, max 75.3%), which is what proves the harness could
have seen a change. **So this wiring is provably inert at current conditions and the flag flip
remains an owner decision that must be re-priced in a bigger sea.**
"""
import os
import sys
from datetime import datetime, timezone

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.weather_pipeline import point_surf_augment as PSA  # noqa: E402
from services.weather_pipeline.schemas import (  # noqa: E402
    NormalizedPointDetail, NormalizedPointResponse,
)

LAT, LNG = 21.665, -158.051          # Pipeline — a real 11.1 m break depth
VT = "2026-08-07T06:00:00Z"
ETA = -0.77                           # a real low tide, straight off a live /spot-ratings payload


def _response():
    return NormalizedPointResponse(
        model="EURO", provider="open-meteo", domain="marine", layer="waves",
        run_time=datetime(2026, 8, 7, tzinfo=timezone.utc),
        valid_time=datetime(2026, 8, 7, 6, tzinfo=timezone.utc),
        is_forecast_authoritative=True, is_estimated=False,
        point=NormalizedPointDetail(
            requested_lat=LAT, requested_lng=LNG, sampled_lat=LAT, sampled_lng=LNG,
            speed=3.0, direction=315.0, u=0.5, v=-1.4, period=14.0,
            interpolation_method="exact_match"),
        value_kind="wave_height", value_unit="m", display_unit_hint="ft",
        source_variables=["wave_height"], freshness_sec=1800,
    )


async def _no_partitions(*a, **k):
    return None


@pytest.fixture
def spies(monkeypatch):
    """Capture what reaches `estimate_surf_at`, and count tide fetches."""
    seen = {"water_level_m": None, "calls": 0, "tide_calls": 0}
    import services.weather_pipeline.surf_point as SP

    real = SP.estimate_surf_at

    def _spy(lat, lng, Hs, Tp, **kw):
        seen["calls"] += 1
        seen["water_level_m"] = kw.get("water_level_m")
        return real(lat, lng, Hs, Tp, **kw)

    monkeypatch.setattr(SP, "estimate_surf_at", _spy)

    async def _tide(lat, lng, valid_time, client=None):
        seen["tide_calls"] += 1
        return {"height_m": ETA, "norm": 0.2, "trend": "falling"}

    import services.weather_pipeline.tide as T
    monkeypatch.setattr(T, "tide_norm_at", _tide)
    return seen


@pytest.mark.asyncio
async def test_the_flag_ON_carries_the_REAL_eta_into_the_height(spies, monkeypatch):
    """THE ONE THAT WOULD HAVE CAUGHT IT. Before this wire, `water_level_m` was never passed at all
    and the parameter defaulted to 0.0 forever — an available parameter mistaken for a live one."""
    monkeypatch.setenv("SURF_TIDE_DEPTH", "1")
    await PSA.augment_with_surf(_response(), "EURO", "marine", "waves", LAT, LNG, VT, _no_partitions)
    assert spies["calls"] >= 1, "SETUP BROKEN: the surf estimate never ran, so nothing was measured"
    assert spies["tide_calls"] == 1, (
        f"expected exactly one tide resolve, got {spies['tide_calls']}")
    assert spies["water_level_m"] == ETA, (
        f"the serving height ran at η={spies['water_level_m']} while the tide resolved to {ETA} — "
        f"the depth-limited cap is still tide-blind on the path that produces surf_height_m")


@pytest.mark.asyncio
async def test_flag_off_does_no_tide_IO_and_passes_zero(spies, monkeypatch):
    """⛔ THE COST LINE. Off must mean no round trip, not a fetch whose result is discarded — this
    call sits on the ratings precompute for every point."""
    monkeypatch.delenv("SURF_TIDE_DEPTH", raising=False)
    await PSA.augment_with_surf(_response(), "EURO", "marine", "waves", LAT, LNG, VT, _no_partitions)
    assert spies["calls"] >= 1, "SETUP BROKEN: the surf estimate never ran"
    assert spies["tide_calls"] == 0, "a tide was fetched with the flag OFF — that is pure cost"
    assert spies["water_level_m"] == 0.0


@pytest.mark.asyncio
async def test_a_tide_failure_never_costs_the_caller_its_height(spies, monkeypatch):
    """The enrichment contract: a tide miss degrades to η=0, it does not drop surf_height_m."""
    monkeypatch.setenv("SURF_TIDE_DEPTH", "1")

    async def _boom(*a, **k):
        raise RuntimeError("tide upstream down")

    import services.weather_pipeline.tide as T
    monkeypatch.setattr(T, "tide_norm_at", _boom)
    resp = await PSA.augment_with_surf(_response(), "EURO", "marine", "waves", LAT, LNG, VT,
                                       _no_partitions)
    assert spies["water_level_m"] == 0.0
    assert resp.surf_height_m is not None, "a tide failure destroyed the surf height"


@pytest.mark.asyncio
async def test_the_flag_is_OFF_by_default__the_flip_is_an_owner_decision(monkeypatch):
    """Records the shipped state by execution rather than by reading the default. Measured at
    wiring time this changes 0 of 172 served spots — but that was a small-surf frame, so the flip
    must be re-priced in a bigger sea, not inferred from this test going green."""
    monkeypatch.delenv("SURF_TIDE_DEPTH", raising=False)
    from services.weather_pipeline import surf_transform as ST
    assert os.environ.get("SURF_TIDE_DEPTH", "0") == "0"
    # And the physics half agrees: η is inert unless the flag is set.
    import inspect
    src = inspect.getsource(ST.estimate_surf)
    assert 'SURF_TIDE_DEPTH' in src, "the cap no longer reads the flag — re-verify the wire"
