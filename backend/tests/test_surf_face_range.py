"""SURF_FACE_RANGE (ON by default, kill '0'): the H1/3 to H1/10 surf face range beside the served height.

ON by the owner's typed word, 2026-11-17: "if it goes into dev, it needs to be on, not dark". NOT SCORED: the gate
(docs/weather-program/log/2026-11-16-fable-surf-face-range-gate.md) needs physical breaker truth and is not runnable.
What these pin:

  ON    (the default) the height, the regime, the score and the level are what they were (the flag is additive);
        HIGH is the served height itself; LOW is the same chain with no highest-tenth factor, through the same
        cap, never above HIGH, and monotone in the offshore height. /point and the rated row SERVE both fields,
        and they survive the wire model (`SpotRatingItem`) and the precomputed frame.
  KILL  ('0') no range is computed, the chain is not called a second time, both /point fields are null, the rated
        row has no such key, and every other served value is identical.
"""
import os
import sys
import threading
from datetime import datetime, timezone

import pytest

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from services import runtime_flags as rf
from services.weather_pipeline import surf_height_convention as conv
from services.weather_pipeline import surf_point
from services.weather_pipeline.schemas import NormalizedPointDetail, NormalizedPointResponse

# The pipeline sweep point (CLAUDE.md): 14 s from 315 deg, only the swell height varied.
LAT, LNG, TP, DIR = 21.6650, -158.0500, 14.0, 315.0
T0 = datetime(2026, 11, 16, tzinfo=timezone.utc)
SWEEP = [0.25 + 0.25 * i for i in range(48)]        # 0.25 .. 12.0 m, the interior and both ends
FLAG = "SURF_FACE_RANGE"


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    for k in (FLAG, "SURF_HEIGHT_H110", "SURF_CAP_SEAM_MONOTONE", "RUNTIME_FLAGS_MANIFEST"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv("RUNTIME_FLAGS_MANIFEST", "0")   # the code default and the env only; no bucket read
    rf._reset_for_tests()
    yield
    rf._reset_for_tests()


def _served(hs, geo):
    return surf_point.estimate_surf_at(LAT, LNG, hs, TP, swell_from_deg=DIR, geometry=geo)


def _range(hs, geo):
    h, regime = _served(hs, geo)
    return surf_point.surf_face_range_at(LAT, LNG, hs, TP, h, regime, swell_from_deg=DIR, geometry=geo), h, regime


def test_the_flag_is_guarded_its_code_default_is_on_and_the_kill_works(monkeypatch):
    assert rf.GUARDED[FLAG] == "1"
    assert rf.flag(FLAG) == "1"
    monkeypatch.setenv(FLAG, "0")
    rf._reset_for_tests()
    assert rf.flag(FLAG) == "0"


def test_the_flag_is_registered_on_for_the_admin_table_and_blind_for_the_guardrail():
    from routes.admin.surf_forecast import _RATING_FLAGS
    import scripts.flag_guardrail as fg
    assert _RATING_FLAGS[FLAG][0] == "1" and "kill '0'" in _RATING_FLAGS[FLAG][1]
    assert fg.COVERAGE[FLAG][0] == fg.BLIND


def test_killed_no_range_is_computed_and_the_chain_is_never_called_a_second_time(monkeypatch):
    monkeypatch.setenv(FLAG, "0")
    geo = surf_point.resolve_surf_geometry(LAT, LNG)
    h, regime = _served(1.0, geo)
    calls = []
    real = surf_point.estimate_surf_at
    monkeypatch.setattr(surf_point, "estimate_surf_at", lambda *a, **k: calls.append(1) or real(*a, **k))
    assert surf_point.surf_face_range_at(LAT, LNG, 1.0, TP, h, regime, swell_from_deg=DIR, geometry=geo) is None
    assert calls == []


def test_the_served_height_is_identical_killed_on_and_after_a_range_was_computed(monkeypatch):
    geo = surf_point.resolve_surf_geometry(LAT, LNG)
    monkeypatch.setenv(FLAG, "0")
    off = [_served(hs, geo) for hs in SWEEP]
    monkeypatch.setenv(FLAG, "1")
    on = []
    for hs in SWEEP:
        rng, h, regime = _range(hs, geo)
        assert rng is not None
        on.append(_served(hs, geo))                 # read again AFTER the low end ran under the other statistic
    assert on == off                                # exact equality, height and regime, all 48 levels


def test_on_high_is_the_served_height_and_low_is_the_same_chain_without_the_factor(monkeypatch):
    monkeypatch.setenv(FLAG, "1")
    geo = surf_point.resolve_surf_geometry(LAT, LNG)
    seen_unsaturated = seen_breaking = False
    for hs in SWEEP:
        (low, high), h, regime = _range(hs, geo)
        assert high == h                                            # HIGH is DEFINED as the served number
        assert 0.0 < low <= high
        if regime == "breaking":
            seen_breaking = True
            assert low >= high / conv.H110_OVER_HS - 1e-9           # between the unfactored height and the cap
        else:
            seen_unsaturated = True
            assert low == pytest.approx(high / conv.H110_OVER_HS, rel=1e-12)
    assert seen_unsaturated and seen_breaking, "the sweep must cross the cap, or the cap branch is untested"


def test_deep_in_the_cap_both_ends_are_the_cap(monkeypatch):
    monkeypatch.setenv(FLAG, "1")
    geo = surf_point.resolve_surf_geometry(LAT, LNG)
    (low, high), _h, regime = _range(12.0, geo)
    assert regime == "breaking" and low == high


def test_both_ends_are_monotone_in_the_offshore_height(monkeypatch):
    monkeypatch.setenv(FLAG, "1")
    geo = surf_point.resolve_surf_geometry(LAT, LNG)
    prev_low = prev_high = 0.0
    for i in range(1, 1201):                                        # 0.01 m steps: the MC-01 seam class
        (low, high), _h, _r = _range(0.01 * i, geo)
        assert low >= prev_low - 1e-12 and high >= prev_high - 1e-12, (0.01 * i, prev_low, low, prev_high, high)
        prev_low, prev_high = low, high


def test_with_the_convention_off_the_range_collapses_to_one_number(monkeypatch):
    monkeypatch.setenv(FLAG, "1")
    monkeypatch.setenv("SURF_HEIGHT_H110", "0")
    geo = surf_point.resolve_surf_geometry(LAT, LNG)
    (low, high), _h, _r = _range(1.0, geo)
    assert low == high


@pytest.mark.parametrize("height,regime", [(None, "shelf"), (1.0, "open_ocean"), (1.0, "calm"), (1.0, "unknown"),
                                           (1.0, None), (0.0, "shelf"), (float("nan"), "shelf")])
def test_no_range_where_there_is_no_surf(monkeypatch, height, regime):
    monkeypatch.setenv(FLAG, "1")
    geo = surf_point.resolve_surf_geometry(LAT, LNG)
    assert surf_point.surf_face_range_at(LAT, LNG, 1.0, TP, height, regime, swell_from_deg=DIR, geometry=geo) is None


def test_the_statistic_switch_is_scoped_restored_on_error_and_invisible_to_other_threads():
    assert conv.enabled() is True
    with pytest.raises(RuntimeError):
        with conv.significant_statistic():
            assert conv.enabled() is False
            other = []
            t = threading.Thread(target=lambda: other.append(conv.enabled()))
            t.start(); t.join()
            assert other == [True]                                  # another thread still publishes H1/10
            raise RuntimeError("boom")
    assert conv.enabled() is True


def _response(hs):
    return NormalizedPointResponse(
        model="GFS", provider="t", domain="marine", layer="waves", run_time=T0, valid_time=T0,
        is_forecast_authoritative=True, is_estimated=False,
        point=NormalizedPointDetail(requested_lat=LAT, requested_lng=LNG, sampled_lat=LAT, sampled_lng=LNG,
                                    speed=hs, period=TP, direction=DIR, interpolation_method="t"),
        value_kind="wave_height", value_unit="m", display_unit_hint="ft",
        source_variables=["wave_height"], freshness_sec=1800)


async def _resolve(monkeypatch, hs):
    from services.weather_pipeline.point_resolution import PointResolutionService
    svc = PointResolutionService()

    async def fake_marine(**kw):
        return _response(hs)

    monkeypatch.setattr(svc, "_resolve_point_internal", fake_marine)
    return await svc.resolve_point("GFS", "marine", "waves", LAT, LNG, "2026-11-16T00:00:00Z")


@pytest.mark.asyncio
async def test_the_point_lane_serves_the_range_by_default_and_the_kill_moves_nothing_else(monkeypatch):
    import json
    on = await _resolve(monkeypatch, 1.0)                           # no env: the code default
    monkeypatch.setenv(FLAG, "0")
    off = await _resolve(monkeypatch, 1.0)
    assert off.surf_height_m is not None and off.surf_face_low_m is None and off.surf_face_high_m is None
    assert on.surf_face_high_m == on.surf_height_m == off.surf_height_m
    assert on.surf_face_low_m == pytest.approx(on.surf_height_m / conv.H110_OVER_HS, abs=1e-4)
    j_on, j_off = json.loads(on.model_dump_json()), json.loads(off.model_dump_json())
    assert j_on["surf_face_low_m"] == on.surf_face_low_m and j_on["surf_face_high_m"] == on.surf_face_high_m   # SERVED
    assert j_off["surf_face_low_m"] is None and j_off["surf_face_high_m"] is None
    for j in (j_on, j_off):
        j.pop("surf_face_low_m"), j.pop("surf_face_high_m")
    assert j_on == j_off                                            # every other /point key identical, on or killed


@pytest.mark.asyncio
async def test_no_range_is_served_where_the_point_is_not_surf(monkeypatch):
    """Open ocean: the height is the model's own, no chain ran, so there is no face and no range."""
    from services.weather_pipeline.point_resolution import PointResolutionService
    svc = PointResolutionService()

    async def fake_marine(**kw):
        r = _response(2.0)
        r.point.requested_lat = r.point.sampled_lat = 30.0
        r.point.requested_lng = r.point.sampled_lng = -150.0
        return r

    monkeypatch.setattr(svc, "_resolve_point_internal", fake_marine)
    out = await svc.resolve_point("GFS", "marine", "waves", 30.0, -150.0, "2026-11-16T00:00:00Z")
    assert out.surf_face_low_m is None and out.surf_face_high_m is None


class _Resolver:
    def __init__(self, face):
        self.face = face

    async def resolve_point(self, **kw):
        if kw["domain"] == "marine":
            r = _response(1.0)
            r.surf_height_m = 1.2
            if self.face:
                r.surf_face_low_m, r.surf_face_high_m = self.face
            return r
        r = _response(8.0)
        r.domain, r.layer = "wind", "wind"
        return r


@pytest.mark.asyncio
async def test_the_rating_row_gains_two_keys_and_nothing_else_moves():
    from services.weather_pipeline import spot_ratings
    spot = {"id": "t1", "name": "sweep", "latitude": LAT, "longitude": LNG}
    off = await spot_ratings.rate_one_spot(_Resolver(None), spot, "GFS", "2026-11-16T00:00:00Z")
    on = await spot_ratings.rate_one_spot(_Resolver((0.9449, 1.2)), spot, "GFS", "2026-11-16T00:00:00Z")
    assert "surf_face_low_m" not in off and "surf_face_high_m" not in off
    assert on["surf_face_low_m"] == 0.945 and on["surf_face_high_m"] == 1.2
    assert on["surf_face_high_m"] == on["surf_height_m"]
    rest = {k: v for k, v in on.items() if not k.startswith("surf_face_")}
    assert rest == off                                              # score, level, height: every other key equal


async def _precomputed_wire_rows(monkeypatch):
    """END TO END with the code default: the real point service (only its data read is faked), the real
    `rate_one_spot`, the precompute's frame builder, then the wire model and the endpoint's frame selector."""
    import json
    from routes.weather import SpotRatingItem
    from services.weather_pipeline import spot_ratings_precompute as pc
    from services.weather_pipeline.point_resolution import PointResolutionService
    for k in ("SURF_PARTITIONS", "RATING_TIDE", "RATING_BREAKER_TYPE", "RATING_LOCAL_SIZE"):
        monkeypatch.setenv(k, "0")
    svc = PointResolutionService()

    async def fake_internal(model, domain, layer, *a, **kw):
        r = _response(1.0 if domain == "marine" else 8.0)
        r.domain, r.layer = domain, layer
        return r

    monkeypatch.setattr(svc, "_resolve_point_internal", fake_internal)
    spots = [{"id": "t1", "name": "sweep", "latitude": LAT, "longitude": LNG}]
    obj = await pc.precompute_spot_ratings(svc, spots, ["GFS"], [0], base_dt=T0)
    obj = json.loads(json.dumps(obj, default=str))                  # what is uploaded
    picked = pc.select_precomputed(obj, (LNG - 1, LAT - 1, LNG + 1, LAT + 1), "GFS", "2026-11-16T00:00:00Z")   # w, s, e, n
    return [SpotRatingItem(**row).model_dump() for row in picked]


@pytest.mark.asyncio
async def test_end_to_end_the_range_reaches_the_precomputed_frame_and_survives_the_wire_model(monkeypatch):
    rows = await _precomputed_wire_rows(monkeypatch)                # no env: the code default is ON
    assert len(rows) == 1
    row = rows[0]
    assert row["surf_height_m"] is not None and row["score"] is not None
    assert row["surf_face_high_m"] == row["surf_height_m"]
    assert 0.0 < row["surf_face_low_m"] < row["surf_face_high_m"]
    assert row["surf_face_low_m"] == pytest.approx(row["surf_height_m"] / conv.H110_OVER_HS, abs=2e-3)
    monkeypatch.setenv(FLAG, "0")
    rf._reset_for_tests()
    killed = (await _precomputed_wire_rows(monkeypatch))[0]
    assert killed["surf_face_low_m"] is None and killed["surf_face_high_m"] is None
    for r in (row, killed):
        r.pop("surf_face_low_m"), r.pop("surf_face_high_m")
    assert row == killed                                            # score, level, height: nothing else moves
