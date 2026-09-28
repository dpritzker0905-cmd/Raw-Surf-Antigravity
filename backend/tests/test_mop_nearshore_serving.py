"""California spots can break from CDIP MOP's nearshore sea (roadmap stage 4, behind SURF_NEARSHORE_MOP).

#124 measured MOP at 0.101 m MAE against our parametric chain's 0.246 m at the CDIP buoys. With the flag on
(default OFF), a point on a covered California spot takes MOP's forecast at the spot's cell (#125) from the
ingest's blob (#126) as the INPUT to the one breaking step. These pin: the transform is the chain's own
Komar branch minus the losses MOP already models (parity with `estimate_surf`); the flag off is byte-identical;
an unusable MOP input falls back to the parametric chain; and the served height says which model it is.
"""
from datetime import datetime, timezone

import pytest

from services.weather_pipeline import mop_nearshore as MOP
from services.weather_pipeline import mop_serving as SERVE
from services.weather_pipeline import surf_transform as ST


@pytest.fixture
def clean(monkeypatch):
    for k in ("SURF_NEARSHORE_MOP", "SURF_REFRACTION_KR", "SURF_V3_KOMAR", "SURF_TIDE_DEPTH", "SURF_BREAK_DEPTH",
              "SURF_HEIGHT_H110", "SURF_CAP_SEAM_MONOTONE", "SURF_V3_EXPOSURE", "SURF_V3_MAGNETS", "SURF_V3_JACK_MAX"):
        monkeypatch.delenv(k, raising=False)
    SERVE._reset_for_test()
    yield monkeypatch
    SERVE._reset_for_test()


@pytest.mark.parametrize("hs,tp,cell,shelf,width,brk", [
    (1.0, 12.0, 10.0, 60.0, 15.0, 3.0),      # unsaturated
    (2.4, 16.0, 9.2, 80.0, 8.0, 2.0),        # the depth cap binds
    (0.5, 7.0, 14.0, 40.0, 30.0, 4.0),       # short-period chop
])
def test_the_transform_is_the_chains_own_minus_what_mop_already_models(clean, hs, tp, cell, shelf, width, brk):
    """With shelf friction, refraction, exposure and magnets neutralised, `estimate_surf` fed the cell's
    unrefracted deep-water equivalent must return exactly what the nearshore transform does."""
    clean.setenv("SURF_REFRACTION_KR", "1.0")
    clean.setattr(ST, "shelf_dissipation", lambda *a, **k: 1.0)
    h0 = hs / ST.shoaling_coefficient(tp, cell)
    served = ST.estimate_surf(h0, tp, shelf, coastal=True, shelf_width_km=width, swell_from_deg=None,
                              shore_normal_deg=None, magnet_factor=1.0, break_depth_m=brk)
    assert MOP.estimate_surf_from_nearshore(hs, tp, cell, shelf, width, brk) == pytest.approx(served)


def test_unusable_inputs_give_way_to_the_parametric_chain(clean):
    assert MOP.estimate_surf_from_nearshore(None, 12.0, 10.0, 60.0, 15.0, 3.0) == (None, "unknown")
    assert MOP.estimate_surf_from_nearshore(1.0, 12.0, 0.0, 60.0, 15.0, 3.0) == (None, "unknown")
    assert MOP.estimate_surf_from_nearshore(0.0, 12.0, 10.0, 60.0, 15.0, 3.0) == (0.0, "calm")


ENTRY = {"times": ["2026-09-28T03:00:00Z", "2026-09-28T09:00:00Z", "2026-09-28T15:00:00Z"],
         "hs": [1.0, 1.6, None], "tp": [12.0, 14.0, 15.0], "dp": [270.0, 275.0, 280.0], "depth_m": 9.9}


def test_the_sea_is_interpolated_inside_the_run_and_never_extrapolated():
    at = lambda h: MOP.nearshore_at(ENTRY, datetime(2026, 9, 28, h, tzinfo=timezone.utc))  # noqa: E731
    assert at(6)["hs"] == pytest.approx(1.3) and at(6)["tp"] == 12.0 and at(8)["tp"] == 14.0
    assert at(3)["hs"] == 1.0 and at(6)["depth_m"] == 9.9
    assert at(2) is None, "before the run"
    assert at(12) is None, "a bracketing value is missing"
    assert at(18) is None, "after the run"


def test_the_composition_takes_mop_when_given_and_is_unchanged_without_it(clean):
    from services.weather_pipeline.surf_point import estimate_surf_at, resolve_surf_geometry
    lat, lng = 36.9514, -122.0263                                        # Steamer Lane
    g = resolve_surf_geometry(lat, lng)
    if g.shore_normal_deg is None:
        pytest.skip("geometry assets unavailable")
    base = estimate_surf_at(lat, lng, 1.5, 13.0, 280.0, geometry=g)
    assert estimate_surf_at(lat, lng, 1.5, 13.0, 280.0, geometry=g, nearshore=None) == base
    mop = estimate_surf_at(lat, lng, 1.5, 13.0, 280.0, geometry=g, nearshore={"hs": 0.8, "tp": 13.0, "depth_m": 9.9})
    assert mop == MOP.estimate_surf_from_nearshore(0.8, 13.0, 9.9, g.depth_m, g.shelf_width_km, g.break_depth_m)
    assert mop != base
    bad = estimate_surf_at(lat, lng, 1.5, 13.0, 280.0, geometry=g, nearshore={"hs": None, "tp": 13.0, "depth_m": 9.9})
    assert bad == base, "an unusable MOP sea falls back to the parametric chain"


def _resp():
    from services.weather_pipeline.schemas import NormalizedPointDetail, NormalizedPointResponse
    return NormalizedPointResponse(
        model="GFS", provider="open-meteo", domain="marine", layer="waves",
        run_time="2026-09-28T00:00:00Z", valid_time="2026-09-28T06:00:00Z",
        is_forecast_authoritative=True, is_estimated=False, value_kind="wave_height", value_unit="m",
        display_unit_hint="ft", source_variables=["wave_height"], freshness_sec=0,
        point=NormalizedPointDetail(requested_lat=36.9514, requested_lng=-122.0263, sampled_lat=36.95,
                                    sampled_lng=-122.03, speed=1.5, direction=280.0, period=13.0,
                                    interpolation_method="nearest"))


async def _no_parts(*a, **k):
    return None


@pytest.mark.asyncio
async def test_flag_off_never_asks_and_the_height_says_parametric(clean):
    from services.weather_pipeline.point_surf_augment import augment_with_surf
    asked = []

    async def spy(*a, **k):
        asked.append(a)
        return {"hs": 0.8, "tp": 13.0, "depth_m": 9.9}

    clean.setattr(SERVE, "nearshore_for_point", spy)
    r = await augment_with_surf(_resp(), "GFS", "marine", "waves", 36.9514, -122.0263, "2026-09-28T06:00:00Z", _no_parts)
    assert asked == [] and r.surf_source == "parametric" and r.surf_height_m is not None


@pytest.mark.asyncio
async def test_flag_on_the_height_breaks_from_mop_and_says_so(clean):
    from services.weather_pipeline.point_surf_augment import augment_with_surf
    from services.weather_pipeline.surf_point import resolve_surf_geometry
    clean.setenv("SURF_NEARSHORE_MOP", "1")

    async def mop(lat, lng, vt):
        return {"hs": 0.8, "tp": 13.0, "depth_m": 9.9}

    clean.setattr(SERVE, "nearshore_for_point", mop)
    r = await augment_with_surf(_resp(), "GFS", "marine", "waves", 36.9514, -122.0263, "2026-09-28T06:00:00Z", _no_parts)
    g = resolve_surf_geometry(36.9514, -122.0263)
    want, _ = MOP.estimate_surf_from_nearshore(0.8, 13.0, 9.9, g.depth_m, g.shelf_width_km, g.break_depth_m)
    assert r.surf_source == "cdip_mop" and r.surf_height_m == pytest.approx(round(want, 4))


def test_a_point_is_a_covered_spot_only_when_it_stands_on_one(clean):
    spots = SERVE._spot_index()
    assert spots, "the committed table has covered spots"
    for lat, lng, sid in spots[:10]:
        assert SERVE.spot_for_point(lat, lng) == sid, "a spot's own coordinates are that spot"
    # A point 0.35-0.9 km from a spot (inside the cheap bounding box, so only the RADIUS can reject it),
    # verified against the table itself to be > SPOT_MATCH_KM from every covered spot.
    near_miss = next(((la, lo + d) for la, lo, _ in spots for d in (0.005, -0.005, 0.007, -0.007)
                      if 0.35 < SERVE._km(la, lo + d, la, lo) < 0.9
                      and min(SERVE._km(la, lo + d, a, b) for a, b, _ in spots) > SERVE.SPOT_MATCH_KM), None)
    assert near_miss, "no near-miss point found to exercise the radius"
    assert SERVE.spot_for_point(*near_miss) is None
    assert SERVE.spot_for_point(0.0, 0.0) is None


@pytest.mark.asyncio
async def test_the_flag_off_reads_nothing(clean):
    assert await SERVE.nearshore_for_point(36.9514, -122.0263, "2026-09-28T06:00:00Z") is None
