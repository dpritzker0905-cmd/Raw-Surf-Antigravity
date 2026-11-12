"""Flip blocker 3 (2026-11-12): the precomputed spot ratings per tier, behind signed URLs. Pins: each tier's copy holds
only its models and window (by the one ladder), premium's object is latest.json, a failed copy never breaks the main
upload, the signature is shared per tier and cached, and the route answers accounts only, only with the clamp on."""
from datetime import datetime, timedelta, timezone

from fastapi import FastAPI
from fastapi.testclient import TestClient

from services import forecast_tier_window as FTW
from services import runtime_flags as rf
from services import spot_ratings_entitlement as SRE
from services import weather_account_rate_limit as RL
from services import weather_tier_clamp as C

NOW = datetime(2026, 11, 12, 12, tzinfo=timezone.utc)


def _vt(h):
    return (NOW + timedelta(hours=h)).strftime("%Y-%m-%dT%H:%M:%SZ")


OBJ = {"version": 3, "generated_at": NOW.isoformat(), "frames": [
    {"model": "GFS", "valid_time": _vt(0), "spots": [1]},
    {"model": "GFS", "valid_time": _vt(3), "spots": [2]},
    {"model": "EURO", "valid_time": _vt(0), "spots": [3]},
    {"model": "ICON", "valid_time": _vt(0), "spots": [4]},
    {"model": "GFS", "valid_time": _vt(24 * 20), "spots": [5]},     # beyond every window
    {"model": "GFS", "valid_time": "not a time", "spots": [6]},     # unparseable: left out
]}


def _models(o):
    return sorted({(f["model"], f["spots"][0]) for f in o["frames"]})


def test_each_tier_copy_holds_only_its_models_and_window():
    for tier in ("free", "basic", "premium"):
        out = SRE.tier_object(OBJ, tier)
        assert out["tier"] == tier and out["generated_at"] == OBJ["generated_at"]
        for f in out["frames"]:
            assert f["model"] in FTW.allowed_models(tier)
            vt = datetime.fromisoformat(f["valid_time"].replace("Z", "+00:00"))
            assert vt <= NOW + timedelta(hours=FTW.tier_horizon_hours(tier, f["model"]))
        assert 5 not in [s for f in out["frames"] for s in f["spots"]] and 6 not in [s for f in out["frames"] for s in f["spots"]]
    assert _models(SRE.tier_object(OBJ, "free")) == [("GFS", 1), ("GFS", 2)]
    assert "guest" not in SRE.TIER_KEYS and "guest" not in SRE.WRITTEN      # no object for a caller without an account


def test_premium_reads_latest_json_and_only_free_and_basic_are_copied():
    assert SRE.TIER_KEYS["premium"] == "spot_ratings/latest.json"
    assert SRE.WRITTEN == ("free", "basic")
    assert len(set(SRE.TIER_KEYS.values())) == 3


class _Store:
    def __init__(self, fail=()):
        self.uploads, self.fail = [], fail

    def _upload_to_supabase(self, key, data):
        if key in self.fail:
            raise RuntimeError("boom")
        self.uploads.append((key, data))


def test_a_failed_copy_is_skipped_never_raised():
    store = _Store(fail=("spot_ratings/tier/free.json",))
    assert SRE.upload_tier_objects(store, OBJ) == ["spot_ratings/tier/basic.json"]
    assert [k for k, _ in store.uploads] == ["spot_ratings/tier/basic.json"]


def test_one_signature_per_tier_shared_and_refreshed(monkeypatch):
    monkeypatch.setattr(SRE, "_sign_cache", {})
    calls, t = [], [0.0]

    def sign(path, exp):
        calls.append((path, exp))
        return f"https://sb.test/sign/{path}?token={len(calls)}"

    clock = lambda: t[0]                                   # noqa: E731
    a = SRE.signed_url("free", sign=sign, clock=clock)
    b = SRE.signed_url("tier_1", sign=sign, clock=clock)   # same canonical tier: the same URL, no second call
    assert a == b and calls == [("spot_ratings/tier/free.json", SRE.SIGN_EXPIRES_S)]
    SRE.signed_url("premium", sign=sign, clock=clock)
    assert calls[-1][0] == "spot_ratings/latest.json"
    t[0] = SRE.SIGN_CACHE_S + 1
    assert SRE.signed_url("free", sign=sign, clock=clock) != a and len(calls) == 3
    assert SRE.signed_url("guest", sign=sign, clock=clock) is None and len(calls) == 3
    assert SRE.SIGN_EXPIRES_S - SRE.SIGN_CACHE_S >= 600   # a cached URL always has at least 10 minutes left


def _client(monkeypatch, on="1", tier=("u1", "basic")):
    monkeypatch.setenv("RUNTIME_FLAGS_MANIFEST", "0")
    monkeypatch.setenv(C.FLAG, on)
    monkeypatch.setenv(RL.FLAG, "1")
    rf._reset_for_tests(lambda: None)
    monkeypatch.setattr(RL, "LIMITER", RL.AccountLimiter({"frame-urls": (2.0, 0.0001)}))

    async def identity(auth, *a, **k):
        return tier if auth == "Bearer t" else (None, "guest")

    monkeypatch.setattr(C, "resolve_identity", identity)
    monkeypatch.setattr(SRE, "signed_url", lambda t: f"https://sb.test/{SRE.TIER_KEYS[t]}?token=x")
    from routes import weather_spot_ratings_url as R
    app = FastAPI()
    app.include_router(R.router, prefix="/api")
    return TestClient(app)


def test_route_accounts_only_with_the_clamp_on(monkeypatch):
    client = _client(monkeypatch)
    r = client.get("/api/weather/spot-ratings-url", headers={"Authorization": "Bearer t"})
    assert r.status_code == 200 and r.json()["tier"] == "basic"
    assert r.json()["url"] == "https://sb.test/spot_ratings/tier/basic.json?token=x"
    assert "private" in r.headers["cache-control"] and r.headers["vary"] == "Authorization"
    g = client.get("/api/weather/spot-ratings-url")
    assert g.status_code == 401 and g.headers["x-raw-tier-clamp"] == "account" and "url" not in g.json()


def test_route_is_signing_limited_per_account(monkeypatch):
    client = _client(monkeypatch)
    h = {"Authorization": "Bearer t"}
    assert [client.get("/api/weather/spot-ratings-url", headers=h).status_code for _ in range(3)] == [200, 200, 429]


def test_route_is_404_while_the_clamp_is_off(monkeypatch):
    client = _client(monkeypatch, on="0")
    assert client.get("/api/weather/spot-ratings-url", headers={"Authorization": "Bearer t"}).status_code == 404


def test_the_route_is_mounted_in_the_real_app():
    import server
    assert "/api/weather/spot-ratings-url" in {getattr(r, "path", "") for r in server.app.routes}
