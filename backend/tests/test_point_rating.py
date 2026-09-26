"""The infobox's surf quality comes from the reference chain, not the browser (A15-05(b), 2026-09-26).

`MapForecastOverlay.js` graded the badge with `surfRating.js::computeSurfRating`, a JS mirror fed the
backend's breaking height but the BROWSER's Open-Meteo wind and no `break_depth_m`, so the badge and
the glyph beside it could disagree about one spot-hour. `/api/weather/point-rating` answers instead:
the precomputed frame the glyph reads at a catalogued spot, `rate_one_spot` + the observation gate
elsewhere. These tests pin that it derives nothing of its own.
"""
import ast
import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.weather_pipeline import point_rating as PR  # noqa: E402
from services.weather_pipeline import rating_confirmation as RC  # noqa: E402
from services.weather_pipeline import spot_ratings as SPR  # noqa: E402
from services.weather_pipeline.spot_ratings_precompute import select_precomputed_laddered  # noqa: E402

VT = "2026-09-26T18:00:00Z"
PIPELINE = (21.6650, -158.0533)


def _item(spot_id, lat, lng, score, level):
    return {"spot_id": spot_id, "name": spot_id, "latitude": lat, "longitude": lng, "score": score,
            "level": level, "confidence": "high", "surf_height_m": 1.9, "period_s": 14.0,
            "why": "6ft @ 14s", "limiter": "wind_period_blend", "limiter_f": 0.81,
            "confirmed": None, "raw_score": score}


def _l2(*spots, vt=VT, model="GFS"):
    return {"frames": [{"model": model, "valid_time": vt, "spots": list(spots)}]}


@pytest.fixture(autouse=True)
def _fresh_cache(monkeypatch):
    PR._CACHE.clear()
    monkeypatch.setattr(PR, "_INFLIGHT", 0)
    monkeypatch.delenv("POINT_RATING_MAX_CONCURRENT", raising=False)
    # The real gate reads the L2 ratings object over the network; tests that care replace this.
    monkeypatch.setattr(RC, "gate_single_model_surface", lambda s, *a: (s, None, None, s))
    yield
    PR._CACHE.clear()


def _live_spy(monkeypatch, score=80.0, level="good"):
    calls = []

    async def fake_rate_one_spot(resolver, spot, model, valid_time, reference_size_m=None):
        calls.append({"spot": spot, "model": model, "valid_time": valid_time, "ref": reference_size_m})
        return _item(str(spot["id"]), spot["latitude"], spot["longitude"], score, level)

    monkeypatch.setattr(SPR, "rate_one_spot", fake_rate_one_spot)
    return calls


def _no_live(monkeypatch):
    async def boom(*a, **k):
        raise AssertionError("a catalogued spot must be answered from the frame, not recomputed")
    monkeypatch.setattr(SPR, "rate_one_spot", boom)


# ── 1. A catalogued spot: the glyph's own frame item, verbatim ─────────────────────────────────

async def test_a_catalogued_spot_gets_the_glyph_frame_item_verbatim(monkeypatch):
    _no_live(monkeypatch)
    pipe = _item("pipeline", *PIPELINE, 55.5, "fair")
    other = _item("sunset", 21.6782, -158.0417, 72.0, "good")        # 1.9 km away: the nearer one wins
    obj = _l2(pipe, other)
    item, source, served = await PR.rate_point(None, 21.6690, -158.0533, "GFS", VT, load_l2=lambda: obj)
    assert (source, served) == ("precomputed", VT)
    glyph = select_precomputed_laddered(obj, (-158.06, 21.66, -158.05, 21.67), "GFS", VT)[0]
    assert item == next(s for s in glyph if s["spot_id"] == "pipeline"), (
        "the infobox must serve exactly the item /spot-ratings serves the glyph for this spot")


async def test_the_stale_ladder_is_the_glyph_ladder_and_says_which_hour(monkeypatch):
    _no_live(monkeypatch)
    obj = _l2(_item("pipeline", *PIPELINE, 55.5, "fair"), vt="2026-09-26T15:00:00Z")   # 3 h away
    item, source, served = await PR.rate_point(None, *PIPELINE, "GFS", VT, load_l2=lambda: obj)
    assert item["spot_id"] == "pipeline"
    assert (source, served) == ("precomputed_stale", "2026-09-26T15:00:00Z")


async def test_the_match_crosses_the_antimeridian(monkeypatch):
    _no_live(monkeypatch)
    obj = _l2(_item("dateline", -16.5, -179.995, 40.0, "poor_fair"))
    item, source, _ = await PR.rate_point(None, -16.5, 179.995, "GFS", VT, load_l2=lambda: obj)
    assert item["spot_id"] == "dateline" and source == "precomputed"


# ── 2. Anywhere else: rate_one_spot, then the hub's observation gate, nothing else ─────────────

async def test_beyond_match_km_the_live_lane_is_rate_one_spot_plus_the_gate(monkeypatch):
    calls = _live_spy(monkeypatch, score=80.0, level="good")

    async def fake_ref(lat, lng):
        return 1.37
    monkeypatch.setattr(PR, "local_reference_at", fake_ref)
    gate_args = []

    def fake_gate(score, lat, lng, valid_time):
        gate_args.append((score, lat, lng, valid_time))
        return 69.9, "fair_good", None, round(score, 1)
    monkeypatch.setattr(RC, "gate_single_model_surface", fake_gate)

    obj = _l2(_item("pipeline", *PIPELINE, 55.5, "fair"))
    lat, lng = 21.7100, -158.0533                                       # 5 km north of Pipeline
    item, source, served = await PR.rate_point(None, lat, lng, "EURO", VT, load_l2=lambda: obj)
    assert (source, served) == ("live", None)
    assert len(calls) == 1
    c = calls[0]
    assert (c["spot"]["latitude"], c["spot"]["longitude"], c["model"], c["valid_time"], c["ref"]) == (
        lat, lng, "EURO", VT, 1.37), "the live lane must rate THIS coordinate with its size reference"
    assert gate_args == [(80.0, lat, lng, VT)], "the observation gate must see the ungated score"
    assert (item["score"], item["level"], item["raw_score"], item["confirmed"]) == (
        69.9, "fair_good", 80.0, None), "the capped verdict is displayed; the raw score stays auditable"


async def test_no_frame_for_the_hour_is_answered_live(monkeypatch):
    calls = _live_spy(monkeypatch)
    item, source, _ = await PR.rate_point(None, *PIPELINE, "GFS", VT, load_l2=lambda: None)
    assert source == "live" and len(calls) == 1 and item["score"] is not None


def test_the_live_lane_derives_nothing_of_its_own():
    """ONE FORECAST COMPOSITION, structurally: the module never calls the engine directly."""
    tree = ast.parse(Path(PR.__file__).read_text(encoding="utf-8"))
    called = {(n.func.attr if isinstance(n.func, ast.Attribute) else getattr(n.func, "id", None))
              for n in ast.walk(tree) if isinstance(n, ast.Call)}
    named = {n.id for n in ast.walk(tree) if isinstance(n, ast.Name)}
    # the gate is handed to asyncio.to_thread, so it is referenced rather than called directly
    assert "rate_one_spot" in called and "gate_single_model_surface" in named
    assert not called & {"compute_surf_rating", "rating_score", "estimate_surf_at", "estimate_surf"}, (
        "point_rating must answer through rate_one_spot, not re-derive a rating")


# ── 3. Cost bounds on a 1-CPU box ────────────────────────────────────────────────────────────

async def test_live_answers_are_cached_per_coordinate_and_hour(monkeypatch):
    calls = _live_spy(monkeypatch)
    for _ in range(3):
        await PR.rate_point(None, 30.0, -80.0, "GFS", VT, load_l2=lambda: None)
    assert len(calls) == 1, "a re-view of the same coordinate+hour must not recompute"
    await PR.rate_point(None, 30.0, -80.0, "GFS", "2026-09-26T19:00:00Z", load_l2=lambda: None)
    await PR.rate_point(None, 30.0, -80.0, "ICON", VT, load_l2=lambda: None)
    assert len(calls) == 3, "a new hour or model is a new answer"


async def test_the_live_lane_sheds_load_beyond_the_cap_but_frames_still_answer(monkeypatch):
    _live_spy(monkeypatch)
    monkeypatch.setenv("POINT_RATING_MAX_CONCURRENT", "0")
    with pytest.raises(PR.PointRatingAtCapacity):
        await PR.rate_point(None, 30.0, -80.0, "GFS", VT, load_l2=lambda: None)
    obj = _l2(_item("pipeline", *PIPELINE, 55.5, "fair"))
    item, source, _ = await PR.rate_point(None, *PIPELINE, "GFS", VT, load_l2=lambda: obj)
    assert item["spot_id"] == "pipeline" and source == "precomputed"


# ── 4. One size reference for the infobox and the point payload ──────────────────────────────

async def test_the_reference_is_spot_first_then_cell_and_off_without_the_flag(monkeypatch):
    from services.weather_pipeline import grid_size_climatology as GSC
    from services.weather_pipeline import spot_size_climatology as SSC
    monkeypatch.setattr(GSC, "load_grid_size_climatology_l2_cached", lambda *a, **k: {"cells": {}})
    monkeypatch.setattr(GSC, "reference_for", lambda clim, la, ln: 2.22)
    monkeypatch.setattr(SSC, "reference_for_coordinate", lambda la, ln, **k: 1.11)
    monkeypatch.delenv("RATING_LOCAL_SIZE", raising=False)
    assert await PR.local_reference_at(*PIPELINE) is None, "flag off is the global curve"
    monkeypatch.setenv("RATING_LOCAL_SIZE", "1")
    assert await PR.local_reference_at(*PIPELINE) == 1.11
    monkeypatch.setattr(SSC, "reference_for_coordinate", lambda la, ln, **k: None)
    assert await PR.local_reference_at(*PIPELINE) == 2.22


def test_the_point_payload_reads_the_same_reference_helper():
    from services.weather_pipeline import point_surf_augment as PSA
    src = Path(PSA.__file__).read_text(encoding="utf-8")
    assert "local_reference_at" in src and "reference_for_coordinate(" not in src, (
        "point_surf_augment must read the reference through point_rating.local_reference_at, or "
        "the infobox's rating and the exact-point payload can grade against two references")


# ── 5. The route ──────────────────────────────────────────────────────────────────────────────

async def test_the_route_serves_the_glyph_item_shape_and_503s_at_capacity(monkeypatch):
    from fastapi import HTTPException
    from routes import weather_point_rating as R
    _live_spy(monkeypatch)
    monkeypatch.setattr(RC, "gate_single_model_surface", lambda s, *a: (s, "good", "good", s))

    async def no_frames(resolver, lat, lng, model, valid_time):
        return await PR.rate_point(resolver, lat, lng, model, valid_time, load_l2=lambda: None)
    monkeypatch.setattr(R, "rate_point", no_frames)
    out = await R.get_point_rating(lat=30.0, lng=-80.0, valid_time=VT, model="GFS")
    assert out.source == "live" and out.valid_time == VT
    assert out.rating.score == 80.0 and out.rating.limiter == "wind_period_blend", (
        "the rating must travel as the glyph's SpotRatingItem, fields intact")
    monkeypatch.setenv("POINT_RATING_MAX_CONCURRENT", "0")
    with pytest.raises(HTTPException) as e:
        await R.get_point_rating(lat=31.0, lng=-80.0, valid_time=VT, model="GFS")
    assert e.value.status_code == 503
