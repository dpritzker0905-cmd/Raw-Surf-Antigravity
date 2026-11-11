"""Audit SRV-1 / SRV-4 / SRV-6 (2026-11-10): /point product-id allow-list, bounded per-file state, truthTag memo,
and the per-IP limit on the /spot-ratings live path. Offline: stubs at the store / resolver boundary only."""
import asyncio
import json
import threading
import time
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient
from starlette.requests import Request

import routes.weather as weather
from core import rate_limiter
from services.weather_pipeline import point_truth_tag
from services.weather_pipeline.bounded_dict import BoundedDict
from services.weather_pipeline.point_product_id import is_bare_product_filename
from services.weather_pipeline.store import ProductStore

GOOD = "gfs_marine_waves_global_mid_20261110T000000Z.json"
DYN = "viewport_gfs_marine_waves_abc123.json"
BAD_IDS = ["../avatars/a.json", "..\\avatars\\a.json", "/etc/passwd", "C:\\x\\a.json", "a/b.json", "..", "a..b.json",
           "chat_media/secret.json", "x.json/../../y.json", "%2e%2e/a.json", ".hidden.json", "noext", "a" * 300 + ".json"]
PARAMS = {"model": "GFS", "domain": "marine", "layer": "waves", "lat": 30.0, "lng": -80.0,
          "valid_time": "2026-11-10T00:00:00Z"}


@pytest.fixture
def client(monkeypatch):
    calls = []

    async def resolve(**kw):
        calls.append(kw)
        return JSONResponse({"source": "offline", "product_id": None})

    manifest = SimpleNamespace(products=[SimpleNamespace(filename=GOOD)])
    monkeypatch.setattr(weather, "store", SimpleNamespace(get_manifest=lambda: manifest))
    monkeypatch.setattr(weather, "dynamic_index", SimpleNamespace(_load_index=lambda: [{"product_id": DYN}]))
    monkeypatch.setattr(weather, "point_resolution_service", SimpleNamespace(resolve_point=resolve))
    app = FastAPI()
    app.include_router(weather.router, prefix="/api")
    with TestClient(app, raise_server_exceptions=False) as c:
        yield c, calls


@pytest.mark.parametrize("bad", BAD_IDS)
def test_unsafe_ids_are_400_and_never_reach_the_resolver(client, bad):
    c, calls = client
    r = c.get("/api/weather/point", params={**PARAMS, "grid_product_id": bad})
    assert r.status_code == 400, r.text
    assert calls == []
    assert not is_bare_product_filename(bad)


def test_unknown_but_well_formed_name_is_400(client):
    c, calls = client
    r = c.get("/api/weather/point", params={**PARAMS, "grid_product_id": "nope_20261110T000000Z.json"})
    assert r.status_code == 400
    assert calls == []


@pytest.mark.parametrize("good", [GOOD, DYN])
def test_valid_manifest_or_dynamic_id_still_samples(client, good):
    c, calls = client
    r = c.get("/api/weather/point", params={**PARAMS, "grid_product_id": good})
    assert r.status_code == 200, r.text
    assert calls and calls[0]["grid_product_id"] == good


def test_no_hint_is_unchanged(client):
    c, _ = client
    assert c.get("/api/weather/point", params=PARAMS).status_code == 200


def test_membership_kill_switch_keeps_the_shape_check(client, monkeypatch):
    c, _ = client
    monkeypatch.setenv("POINT_PRODUCT_ID_MEMBERSHIP", "0")
    assert c.get("/api/weather/point", params={**PARAMS, "grid_product_id": "nope_x.json"}).status_code == 200
    assert c.get("/api/weather/point", params={**PARAMS, "grid_product_id": "../a.json"}).status_code == 400


def test_per_file_state_stays_bounded_over_10000_ids():
    locks = BoundedDict(4096, lambda lk: not lk.locked())
    neg = BoundedDict(4096)
    held = threading.Lock()
    held.acquire()
    locks["held.json"] = held
    for i in range(10_000):
        locks[f"id{i}.json"] = threading.Lock()
        neg[f"id{i}.json"] = float(i)
    assert len(locks) <= 4096 and len(neg) == 4096
    assert "held.json" in locks, "a held lock must never be evicted"
    assert "id9999.json" in neg and "id0.json" not in neg
    assert isinstance(ProductStore._download_locks, BoundedDict)
    assert isinstance(ProductStore._l2_negative_cache, BoundedDict)


def test_fetch_l2_to_disk_refuses_paths(tmp_path):
    from services.weather_pipeline.store_helpers import fetch_l2_to_disk
    for bad in ("../x.json", "a/b.json", "a\\b.json", ""):
        assert fetch_l2_to_disk(SimpleNamespace(cache_dir=tmp_path), bad) is False


# SRV-4 ----------------------------------------------------------------------------------------------------
def _product(n=3000):
    vec = [SimpleNamespace(lat=i * 0.01, lng=i * 0.02, speed=1.0 + i % 7, u=0.1, v=0.2, period=9.0, is_valid=True)
           for i in range(n)]
    t = datetime(2026, 11, 10, tzinfo=timezone.utc)
    return SimpleNamespace(model="GFS", domain="marine", layer="waves", valid_time=t, run_time=t, product_id=GOOD,
                           provider="p", upstream_model=None, is_dynamic_viewport_product=False, coverage_scope=None,
                           requested_bbox=None, served_bbox="0,0,1,1", coverage_mode="global_tile",
                           grid=SimpleNamespace(cols=n, rows=1, vectors=vec))


def test_truth_tag_is_hashed_once_per_product(tmp_path, monkeypatch):
    point_truth_tag._memo.clear()
    prod = _product()
    store = SimpleNamespace(cache_dir=tmp_path, load_product=lambda pid: prod)
    n = {"c": 0}
    real = point_truth_tag.compute_truth_tag

    def counting(**k):
        n["c"] += 1
        return real(**k)

    monkeypatch.setattr(point_truth_tag, "compute_truth_tag", counting)

    def resp():
        return JSONResponse({"source": "grid_file", "product_id": GOOD})

    async def go():
        t0 = time.perf_counter()
        first = await point_truth_tag.attach_point_truth(resp(), store, "marine", GOOD, None)
        t1 = time.perf_counter()
        second = await point_truth_tag.attach_point_truth(resp(), store, "marine", GOOD, None)
        t2 = time.perf_counter()
        return first, second, t1 - t0, t2 - t1

    first, second, cold, warm = asyncio.run(go())
    a, b = json.loads(first.body)["truthTag"], json.loads(second.body)["truthTag"]
    assert a["dataHash"] == b["dataHash"] and a["traceId"] == b["traceId"]
    assert n["c"] == 2, "source + crop hashed once for the first ask, zero times for the second"
    assert warm < cold / 5, (cold, warm)
    assert json.loads(first.body)["gridPointParity"]["status"] == "MATCH"


# SRV-6 ----------------------------------------------------------------------------------------------------
def test_spot_ratings_live_path_is_limited_per_ip(monkeypatch):
    rate_limiter._request_log.clear()
    monkeypatch.setenv("SPOT_RATINGS_LIVE_PER_IP_MAX", "3")
    monkeypatch.setenv("SPOT_RATINGS_LIVE_MAX_CONCURRENT", "0")      # an allowed call then 503s at the cap (no compute)
    monkeypatch.setattr("services.weather_pipeline.spot_ratings_precompute.select_precomputed_laddered",
                        lambda *a, **k: (None, "precomputed", None))
    monkeypatch.setattr(weather, "load_spot_ratings_l2_cached", lambda: None)
    weather._LIVE_RATINGS_CACHE.clear()

    def call(ip):
        req = Request({"type": "http", "headers": [], "client": (ip, 1)})
        try:
            asyncio.run(weather.get_spot_ratings(bbox="0,0,1,1", valid_time="2030-01-01T00:00:00Z", model="GFS",
                                                 limit=5, db=None, request=req))
        except Exception as e:
            return e.status_code

    codes = [call("198.51.100.9") for _ in range(5)]
    assert codes == [503, 503, 503, 429, 429], codes
    assert call("198.51.100.10") == 503, "another IP has its own budget"
