"""The glyph precompute REFUSES to rate when the size climatology cannot be read (2026-09-29).

At 02:48Z on 2026-09-29 the precompute's prefetcher drew HTTP 429 "too many connections" from Supabase Storage,
the size-climatology read got the same 429 and returned None, and the GFS pass rated all 1,821 spots on the
global default while RATING_LOCAL_SIZE said local ("0 spots have a size reference"). The frames were served for
~9 h; the sim parity monitor measured 32 of 48 spots a level apart (Trestles 63.4 served vs 38.7). The write-back
already refused to fold onto an unreadable base (the 2026-07-30 self-erase guard); the read had no guard.

These pin: a failed read is told apart from an absent object; a failure is retried with backoff; a pass that
still cannot read it bakes NOTHING and the model keeps its previous frames; an absent climatology still rates on
the global default (the designed bootstrap); and the 02:48Z sequence (429, then 200) now rates WITH references.
"""
import asyncio
import os
import time
from datetime import datetime, timezone

os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")

import pytest
import requests

from services.weather_pipeline import spot_ratings_precompute as pc
from services.weather_pipeline import spot_size_climatology as ssc

BASE = datetime(2026, 9, 29, 3, 0, tzinfo=timezone.utc)
SPOTS = [{"id": "trestles", "name": "Trestles", "latitude": 33.38, "longitude": -117.59},
         {"id": "wedge", "name": "The Wedge", "latitude": 33.59, "longitude": -117.88}]


class _Resp:
    def __init__(self, status, body=None, bad_json=False):
        self.status_code, self._body, self._bad = status, body, bad_json

    def json(self):
        if self._bad:
            raise ValueError("not json")
        return self._body


@pytest.fixture
def storage(monkeypatch):
    """A scripted Supabase Storage: each GET pops the next response (or raises it)."""
    monkeypatch.setenv("SUPABASE_URL", "https://storage.example.invalid")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "test-not-a-key")
    monkeypatch.setattr(ssc, "_l2_cache", {"obj": None, "ts": 0.0})
    script, calls = [], []

    def fake_get(url, headers=None, timeout=None):
        calls.append(url)
        r = script.pop(0)
        if isinstance(r, Exception):
            raise r
        return r

    monkeypatch.setattr(requests, "get", fake_get)
    return script, calls


CLIM = {"spots": {}}


@pytest.mark.parametrize("resp,status", [
    (_Resp(200, CLIM), "ok"),
    (_Resp(404), "absent"),
    (_Resp(400, {"statusCode": "404", "error": "not_found"}), "absent"),    # Storage's other not-found spelling
    (_Resp(400, {"statusCode": "403", "error": "Unauthorized"}), "unavailable"),
    (_Resp(429, {"error": "too_many_connections"}), "unavailable"),      # the 2026-09-29 02:48Z response
    (_Resp(503), "unavailable"),
    (_Resp(200, bad_json=True), "unavailable"),
    (_Resp(200, ["not", "a", "blob"]), "unavailable"),
    (requests.Timeout("read timed out"), "unavailable"),
])
def test_a_failed_read_is_told_apart_from_an_absent_object(storage, resp, status):
    script, _ = storage
    script.append(resp)
    obj, got = ssc.load_size_climatology_l2_status()
    assert got == status and (obj is CLIM) == (status == "ok")


def test_no_supabase_config_is_absent_not_a_failure(monkeypatch):
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    assert ssc.load_size_climatology_l2_status() == (None, "absent")


def test_the_plain_loader_keeps_its_contract(storage):
    script, _ = storage
    script.extend([_Resp(200, CLIM), _Resp(429)])
    assert ssc.load_size_climatology_l2() is CLIM
    assert ssc.load_size_climatology_l2() is None


def test_a_transient_failure_is_retried_with_backoff_then_cached(storage):
    script, calls = storage
    script.extend([_Resp(429), _Resp(503), _Resp(200, CLIM)])
    slept = []
    assert ssc.load_size_climatology_for_rating(sleep=slept.append) == (CLIM, "ok")
    assert slept == [3.0, 6.0] and len(calls) == 3
    assert ssc.load_size_climatology_for_rating(sleep=slept.append) == (CLIM, "ok")     # served from the cache
    assert len(calls) == 3


def test_a_persistent_failure_is_reported_and_never_cached(storage):
    script, calls = storage
    script.extend([_Resp(429)] * 3)
    slept = []
    assert ssc.load_size_climatology_for_rating(sleep=slept.append) == (None, "unavailable")
    assert len(calls) == 3 and slept == [3.0, 6.0] and ssc._l2_cache["obj"] is None


def test_an_absent_object_is_not_retried(storage):
    script, calls = storage
    script.append(_Resp(404))
    assert ssc.load_size_climatology_for_rating(sleep=lambda s: None) == (None, "absent")
    assert len(calls) == 1


# ── the precompute pass ──────────────────────────────────────────────────────────────────────────────

@pytest.fixture
def rated(monkeypatch):
    """Record the reference each spot was rated with; the fake proves the pass did (or did not) rate."""
    seen = []

    async def fake_rate(resolver, spot, model, valid_time, reference_size_m=None):
        seen.append((spot["id"], reference_size_m))
        return {"spot_id": spot["id"], "name": spot["name"], "latitude": spot["latitude"],
                "longitude": spot["longitude"], "score": 50.0, "level": "fair", "reference_size_m": reference_size_m}

    monkeypatch.setattr(pc, "rate_one_spot", fake_rate)
    monkeypatch.setenv("RATING_LOCAL_SIZE", "1")
    monkeypatch.delenv("RATING_TIDE", raising=False)
    return seen


def _loader(monkeypatch, result):
    monkeypatch.setattr(ssc, "load_size_climatology_for_rating", lambda *a, **k: result)


def test_an_unreadable_climatology_refuses_the_pass_and_rates_nothing(monkeypatch, rated):
    _loader(monkeypatch, (None, "unavailable"))
    obj = asyncio.run(pc.precompute_spot_ratings(None, SPOTS, ["GFS"], [0], base_dt=BASE))
    assert obj["refused"] == "size_reference_unavailable" and obj["frames"] == []
    assert rated == []                                    # no spot was rated on the global default


def test_a_loader_that_raises_also_refuses(monkeypatch, rated):
    def boom(*a, **k):
        raise RuntimeError("storage down")
    monkeypatch.setattr(ssc, "load_size_climatology_for_rating", boom)
    obj = asyncio.run(pc.precompute_spot_ratings(None, SPOTS, ["GFS"], [0], base_dt=BASE))
    assert obj.get("refused") and rated == []


def test_a_readable_climatology_rates_every_spot_on_its_own_reference(monkeypatch, rated):
    _loader(monkeypatch, ({"spots": {}}, "ok"))
    monkeypatch.setattr(ssc, "reference_map", lambda clim, **kw: {"trestles": 1.709, "wedge": 1.431})
    obj = asyncio.run(pc.precompute_spot_ratings(None, SPOTS, ["GFS"], [0], base_dt=BASE))
    assert "refused" not in obj and sorted(rated) == [("trestles", 1.709), ("wedge", 1.431)]


def test_an_absent_climatology_still_rates_on_the_global_default(monkeypatch, rated):
    _loader(monkeypatch, (None, "absent"))
    obj = asyncio.run(pc.precompute_spot_ratings(None, SPOTS, ["GFS"], [0], base_dt=BASE))
    assert "refused" not in obj and sorted(rated) == [("trestles", None), ("wedge", None)]


def test_the_0248z_sequence_now_rates_with_references(storage, rated, monkeypatch):
    """Replay: the first read draws the 429, the retry reads the blob. Before the fix this pass rated both spots
    on the global default; now it waits out the 429 and rates each on its own reference."""
    script, _ = storage
    blob = {"spots": {"trestles": {}, "wedge": {}}}
    script.extend([_Resp(429, {"error": "too_many_connections"}), _Resp(200, blob)])
    monkeypatch.setattr(time, "sleep", lambda s: None)                  # the backoff, without the wait
    monkeypatch.setattr(ssc, "reference_map",
                        lambda clim, **kw: {"trestles": 1.709, "wedge": 1.431} if clim is blob else {})
    obj = asyncio.run(pc.precompute_spot_ratings(None, SPOTS, ["GFS"], [0], base_dt=BASE))
    assert "refused" not in obj and sorted(rated) == [("trestles", 1.709), ("wedge", 1.431)]


# ── the per-model loop ───────────────────────────────────────────────────────────────────────────────

def test_a_refused_model_keeps_its_previous_frames_and_the_others_go_live(monkeypatch):
    prev = [{"model": "GFS", "valid_time": "2026-09-29T00:00:00Z", "spots": [{"spot_id": "trestles", "score": 37.5}]},
            {"model": "ICON", "valid_time": "2026-09-29T00:00:00Z", "spots": [{"spot_id": "trestles", "score": 40.0}]}]
    fresh_icon = {"model": "ICON", "valid_time": "2026-09-29T03:00:00Z", "spots": [{"spot_id": "trestles", "score": 41.0}]}

    async def fake_pass(resolver, spots, models, hours, **kw):
        if models == ["GFS"]:
            refused = pc.build_l2_object([])
            refused["refused"] = "size_reference_unavailable"
            return refused
        return pc.build_l2_object([fresh_icon])

    uploads = []
    monkeypatch.setenv("SPOT_RATINGS_PRECOMPUTE_MODELS", "GFS,ICON")
    monkeypatch.setenv("RATING_OBS_GATE", "0")
    monkeypatch.setenv("RATING_SIZE_CLIMATOLOGY", "0")
    # The coverage guard would also stop an EMPTY refused pass; floor 0 isolates the refusal guard itself.
    monkeypatch.setenv("SPOT_RATINGS_MIN_COVERAGE", "0")
    monkeypatch.setattr(pc, "fetch_active_spots_via_rest", lambda *a, **k: SPOTS)
    monkeypatch.setattr(pc, "_make_point_resolver", lambda: None)
    monkeypatch.setattr("services.weather_pipeline.store.ProductStore", lambda *a, **k: object())
    monkeypatch.setattr(pc, "load_spot_ratings_l2", lambda: {"frames": prev})
    monkeypatch.setattr(pc, "upload_spot_ratings_l2", lambda store, obj: uploads.append(obj))
    monkeypatch.setattr(pc, "precompute_spot_ratings", fake_pass)

    n_spots, n_frames = pc.run_spot_ratings_precompute()
    assert len(uploads) == 1                                        # only ICON's checkpoint was uploaded
    live = {(f["model"], f["valid_time"]) for f in uploads[0]["frames"]}
    assert live == {("GFS", "2026-09-29T00:00:00Z"), ("ICON", "2026-09-29T03:00:00Z")}
    assert n_frames == 2
