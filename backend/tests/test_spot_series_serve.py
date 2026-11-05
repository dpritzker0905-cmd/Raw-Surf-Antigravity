"""Spot-hub phase 4: the READ route for the CI-rated chart series (`spot_series_serve.py`,
`routes/weather_spot_series.py`). Pins: the private bucket's proxy sends only the tier's window (free 72 h rolling,
basic 7 d, premium 14 d) and names locked days by date only; the numbers are the shard's, byte for byte (no
re-derivation, the ungated score never leaves CI); a shard is read once per generation and concurrent viewers share
one read; an unpublished series costs one read a minute; and the kill switch."""
import asyncio
import gzip
import json
import os
import sys
from datetime import datetime, timedelta, timezone

import pytest

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND)

from services.weather_pipeline import spot_series as SS  # noqa: E402
from services.weather_pipeline import spot_series_serve as SV  # noqa: E402
from services.weather_pipeline.spot_hub_composition import frame_plan  # noqa: E402

BASE = datetime(2026, 11, 4, 12, 0, tzinfo=timezone.utc)
NOW = BASE + timedelta(hours=4, minutes=20)      # the series is 4 h old when it is viewed
SPOT, LNG = "spot-abc", -117.6                   # Trestles-like: solar offset -8 h


def _rows(lng=LNG, tide_until_h=72):
    times = [BASE] + frame_plan(lng, BASE, 336)
    rows = []
    for i, vt in enumerate(times):
        h = (vt - BASE).total_seconds() / 3600
        score = 20.0 + (i * 7) % 75
        from services.weather_pipeline.surf_rating import score_to_level
        rows.append({"valid_time": vt.strftime("%Y-%m-%dT%H:00:00Z"), "surf_height_m": 0.5 + 0.03 * i,
                     "score": score, "raw_score": score + 1.5, "level": score_to_level(score),
                     "wind_kt": 4 + i % 15, "wind_word": SS.WIND_WORDS[i % 3], "primary_swell_hs_m": 1.1,
                     "tide": {"height_m": 0.4 + 0.01 * i} if h <= tide_until_h else None})
    return rows


def _objects(generated_at=datetime(2026, 11, 4, 13, 0, tzinfo=timezone.utc), base=BASE, models=("GFS", "EURO")):
    by = {m: {SPOT: {"off": -8, "rows": _rows()}, "other": {"off": 2, "rows": _rows(30.0)}} for m in models}
    return SS.build_shards(by, base, generated_at)


class Store:
    def __init__(self, objects):
        self.objects, self.gets = dict(objects), []

    def __call__(self, key, cb):
        self.gets.append((key, cb))
        return self.objects.get(key)


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv("RUNTIME_FLAGS_MANIFEST", "0")
    monkeypatch.delenv("SPOT_HUB_CHARTS", raising=False)
    monkeypatch.delenv("SPOT_FORECAST_TIER_HORIZON", raising=False)
    SV._reset_for_tests()
    yield
    SV._reset_for_tests()


def _serve(store, tier="free", model="GFS", spot=SPOT, now=NOW):
    SV._fetcher = store
    return asyncio.run(SV.spot_series_payload(spot, model, tier, now=now))


def _shard_rec(objects, model="GFS", spot=SPOT):
    return json.loads(gzip.decompress(objects[SS.shard_key(model, SS.shard_of(spot))]))["spots"][spot]


# ── the tier window ───────────────────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("tier,hours,open_days", [("free", 72, 3), ("guest", 72, 3), ("basic", 168, 7),
                                                   ("premium", 336, 14)])
def test_only_the_tiers_rolling_window_is_sent(tier, hours, open_days):
    status, body = _serve(Store(_objects()), tier=tier)
    assert status == 200 and body["horizon_hours"] == hours
    last = max(datetime.fromisoformat(v.replace("Z", "+00:00")) for v in body["valid_times"])
    assert last <= NOW + timedelta(hours=hours)
    assert body["window_end"] == (NOW + timedelta(hours=hours)).strftime("%Y-%m-%dT%H:%M:%SZ")
    assert len(body["daily_dates"]) == open_days
    assert len(body["daily_dates"]) + len(body["locked_dates"]) == 14
    # Every frame of an open local day is inside the window (owner: today + 2 full local days for free).
    end_of_last_open = datetime.fromisoformat(body["daily_dates"][-1]).replace(tzinfo=timezone.utc) \
        + timedelta(days=1, hours=8)          # local midnight at -8 h, in UTC
    assert end_of_last_open <= NOW + timedelta(hours=hours) + timedelta(hours=1)


def test_free_sees_the_leftover_hours_past_its_last_daily_column_in_the_hourly_frames():
    _, body = _serve(Store(_objects()))
    local_dates = {(datetime.fromisoformat(v.replace("Z", "+00:00")) - timedelta(hours=8)).date().isoformat()
                   for v in body["valid_times"]}
    beyond = local_dates - set(body["daily_dates"])
    assert beyond, "the rolling 72 h reaches into the day after the last daily column"
    assert beyond.isdisjoint(set(body["locked_dates"][1:]))


def test_locked_days_are_named_by_date_only():
    _, body = _serve(Store(_objects()))
    assert all(isinstance(d, str) and len(d) == 10 for d in body["locked_dates"])
    assert body["locked_dates"][0] > body["daily_dates"][-1]
    assert set(body) >= {"locked_dates", "daily_dates"} and "spots" not in body


def test_a_model_the_tier_may_not_use_falls_back_to_its_first_model():
    _, body = _serve(Store(_objects()), tier="free", model="EURO")
    assert body["model"] == "GFS" and body["requested_model"] == "EURO" and body["model_allowed"] is False
    _, body = _serve(Store(_objects()), tier="premium", model="euro")
    assert body["model"] == "EURO" and body["model_allowed"] is True


# ── the numbers are the shard's ───────────────────────────────────────────────────────────────────────────

def test_the_served_columns_are_the_shards_columns_sliced_never_rederived():
    objects = _objects()
    rec = _shard_rec(objects)
    _, body = _serve(Store(objects), tier="premium")
    t0 = rec["t"].index(body["frames"]["t"][0])
    n = len(body["frames"]["t"])
    for col in SV.SERVED_COLS:
        assert body["frames"][col] == rec[col][t0:t0 + n], col
    assert "r" not in body["frames"], "the ungated score stays in CI: the hub shows the gated verdict"
    assert body["utc_offset_hours"] == rec["off"] == -8


def test_the_first_frame_is_the_latest_at_or_before_now():
    _, body = _serve(Store(_objects()))
    vts = [datetime.fromisoformat(v.replace("Z", "+00:00")) for v in body["valid_times"]]
    assert vts[0] <= NOW < vts[1]
    assert vts == sorted(vts)


def test_tide_until_names_the_last_frame_with_a_tide():
    _, body = _serve(Store(_objects()), tier="premium")
    td, vts = body["frames"]["td"], body["valid_times"]
    last = max(i for i, v in enumerate(td) if v is not None)
    assert body["tide_until"] == vts[last]
    assert all(v is None for v in td[last + 1:]) and len(td) > last + 1


# ── cost on the one box ───────────────────────────────────────────────────────────────────────────────────

def test_a_shard_is_read_once_per_generation_and_a_republish_is_a_new_key():
    store = Store(_objects())
    for tier in ("free", "basic", "premium", "free"):
        _serve(store, tier=tier)
    shard_gets = [g for g in store.gets if g[0].endswith(".json.gz")]
    assert len(shard_gets) == 1 and SV.stats()["shard_hits"] == 3
    assert shard_gets[0][1] == SV.generation_of(SV._state["index"])      # the generation is the cache-buster
    # Republish: a new index generation reads the shard again (never a stale hit).
    store.objects.update(_objects(generated_at=datetime(2026, 11, 4, 17, 0, tzinfo=timezone.utc)))
    SV._state["index_at"] = -1e9
    _serve(store)
    assert len([g for g in store.gets if g[0].endswith(".json.gz")]) == 2


def test_concurrent_viewers_share_one_read():
    store = Store(_objects())
    SV._fetcher = store

    async def go():
        return await asyncio.gather(*[SV.spot_series_payload(SPOT, "GFS", "free", now=NOW) for _ in range(12)])
    out = asyncio.run(go())
    assert all(s == 200 for s, _ in out)
    assert len([g for g in store.gets if g[0].endswith(".json.gz")]) == 1
    assert len([g for g in store.gets if g[0].endswith("index.json")]) == 1


def test_an_unpublished_series_costs_one_read_a_minute():
    store = Store({})
    for _ in range(5):
        status, body = _serve(store)
        assert status == 404 and body["status"] == "unpublished"
    assert len(store.gets) == 1


def test_the_shard_cache_is_bounded(monkeypatch):
    monkeypatch.setenv("SPOT_SERIES_SHARD_CACHE", "1")
    store = Store(_objects())
    _serve(store, spot=SPOT)
    _serve(store, spot="other")
    assert SV.stats()["shards_cached"] == 1 or SS.shard_of(SPOT) == SS.shard_of("other")


def test_a_storage_outage_keeps_the_last_good_index():
    store = Store(_objects())
    _serve(store)

    def broken(key, cb):
        raise ConnectionError("storage down")
    SV._state["index_at"] = -1e9
    status, _ = _serve(broken)
    assert status == 200


@pytest.mark.parametrize("spot,model,want", [("nope", "GFS", "spot_not_found"), (SPOT, "ICON", "model_unavailable")])
def test_misses_say_why(spot, model, want):
    status, body = _serve(Store(_objects()), tier="premium", model=model, spot=spot)
    assert status == 404 and body["status"] == want


# ── kill switch and route ─────────────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("value,on", [(None, True), ("1", True), ("0", False)])
def test_spot_hub_charts_defaults_on_and_0_kills(monkeypatch, value, on):
    if value is not None:
        monkeypatch.setenv("SPOT_HUB_CHARTS", value)
    store = Store(_objects())
    status, body = _serve(store)
    assert (status == 200) is on
    if not on:
        assert body["status"] == "disabled" and store.gets == []


def test_the_flag_is_registered_with_its_default():
    import ast
    src = open(os.path.join(BACKEND, "routes", "admin", "surf_forecast.py"), encoding="utf-8").read()
    for node in ast.walk(ast.parse(src)):
        if isinstance(node, ast.Assign) and any(getattr(t, "id", None) == "_RATING_FLAGS" for t in node.targets):
            reg = ast.literal_eval(node.value)
    assert reg["SPOT_HUB_CHARTS"][0] == "1" and reg["SPOT_HUB_CHARTS"][2] == "Render env"


def test_the_route_serves_through_the_weather_router():
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from routes.weather_spot_series import router
    SV._fetcher = Store(_objects())
    app = FastAPI()
    app.include_router(router, prefix="/api/weather")
    r = TestClient(app).get(f"/api/weather/spot-series/{SPOT}", params={"model": "GFS", "subscription_tier": "free"})
    assert r.status_code == 200 and r.json()["status"] == "ok" and r.json()["horizon_hours"] == 72
    assert "max-age=300" in r.headers["cache-control"]
    src = open(os.path.join(BACKEND, "routes", "weather.py"), encoding="utf-8").read()
    assert "include_router(spot_series_router)" in src
