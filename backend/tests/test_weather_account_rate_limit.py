"""#782/#783: the per-account limit (owner 2026-11-12: "a per-account limit on signing requests"). Under the limit
passes, over it is 429 with Retry-After, accounts are independent, memory is bounded, the kill switch removes it, and the
clamp middleware applies it to the clamped reads (and only to verified accounts)."""
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from services import runtime_flags as rf
from services import weather_account_rate_limit as RL
from services import weather_tier_clamp as C


class Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


def test_under_the_limit_passes_and_over_it_waits_for_one_token():
    clk = Clock()
    lim = RL.AccountLimiter({"x": (3.0, 0.5)}, clock=clk)
    assert [lim.check("x", "u1") for _ in range(3)] == [None, None, None]
    assert lim.check("x", "u1") == 2                    # empty: one token back in 1 / 0.5 = 2 s
    clk.t += 2
    assert lim.check("x", "u1") is None and lim.check("x", "u1") == 2


def test_distinct_accounts_are_independent_and_anonymous_is_never_counted():
    lim = RL.AccountLimiter({"x": (1.0, 0.01)}, clock=Clock())
    assert lim.check("x", "a") is None and lim.check("x", "a") is not None
    assert lim.check("x", "b") is None                  # another account still has its own bucket
    assert lim.check("x", None) is None and lim.size("x") == 2


def test_memory_stays_bounded_lru_evicts_the_least_recent_account():
    lim = RL.AccountLimiter({"x": (1.0, 0.0001)}, max_keys=100, clock=Clock())
    for i in range(1000):
        lim.check("x", f"user-{i}")
    assert lim.size("x") == 100
    assert lim.check("x", "user-999") is not None       # recent: still limited
    assert lim.check("x", "user-0") is None             # evicted long ago: starts again with a full bucket


def test_the_shipped_numbers_sit_well_above_normal_use():
    """A map load pins 1-3 indexes (one /frame-urls each) and makes ~10-30 weather reads (module docstring)."""
    cap_f, rate_f = RL.LANES["frame-urls"]
    cap_r, rate_r = RL.LANES["reads"]
    assert cap_f >= 20 * 3 and rate_f * 60 >= 6          # 20 back-to-back map loads; 6 new indexes a minute
    assert cap_r >= 20 * 30 and rate_r >= 1.0            # 20 cold loads; continuous panning
    assert RL.MAX_KEYS <= 10_000


def _flags(monkeypatch, **on):
    monkeypatch.setenv("RUNTIME_FLAGS_MANIFEST", "0")
    for k, v in on.items():
        monkeypatch.setenv(k, v)
    rf._reset_for_tests(lambda: None)


def test_the_kill_switch_removes_the_limit_and_the_default_is_on(monkeypatch):
    _flags(monkeypatch)
    monkeypatch.delenv(RL.FLAG, raising=False)
    assert rf.GUARDED[RL.FLAG] == "1" and RL.enabled()
    lim = RL.AccountLimiter({"reads": (1.0, 0.0001)}, clock=Clock())
    assert RL.retry_after("reads", "u", lim) is None and RL.retry_after("reads", "u", lim) is not None
    _flags(monkeypatch, **{RL.FLAG: "0"})
    assert RL.retry_after("reads", "u", lim) is None


def test_the_clamp_middleware_answers_429_with_retry_after_per_account(monkeypatch):
    _flags(monkeypatch, **{C.FLAG: "1", RL.FLAG: "1"})
    monkeypatch.setattr(RL, "LIMITER", RL.AccountLimiter({"reads": (2.0, 0.25)}, clock=Clock()))
    app = FastAPI()

    @app.get("/api/weather/grid")
    async def grid(request: Request):
        return {"ok": True}

    async def identity(auth):
        return {"Bearer a": ("user-a", "premium"), "Bearer b": ("user-b", "free")}.get(auth, (None, "guest"))

    app.add_middleware(C.WeatherTierClampMiddleware, identity_fn=identity)
    client = TestClient(app)
    a = {"Authorization": "Bearer a"}
    assert [client.get("/api/weather/grid", headers=a).status_code for _ in range(2)] == [200, 200]
    r = client.get("/api/weather/grid", headers=a)
    assert r.status_code == 429 and r.headers["retry-after"] == "4"
    assert r.json() == {"detail": "rate_limited", "retry_after_s": 4} and r.headers["x-raw-tier-clamp"] == "rate_limited"
    assert r.headers["cache-control"] == "private, no-store"
    assert client.get("/api/weather/grid", headers={"Authorization": "Bearer b"}).status_code == 200   # independent
    assert client.get("/api/weather/grid").status_code == 401                                       # signed out: 401 first
    assert client.get("/api/weather/capabilities").status_code == 404                               # public routes: never limited


def test_held_off_the_middleware_never_limits(monkeypatch):
    _flags(monkeypatch, **{C.FLAG: "0", RL.FLAG: "1"})
    monkeypatch.setattr(RL, "LIMITER", RL.AccountLimiter({"reads": (1.0, 0.0001)}, clock=Clock()))
    app = FastAPI()

    @app.get("/api/weather/grid")
    async def grid():
        return {"ok": True}

    async def identity(auth):
        return ("user-a", "premium")

    app.add_middleware(C.WeatherTierClampMiddleware, identity_fn=identity)
    client = TestClient(app)
    assert {client.get("/api/weather/grid").status_code for _ in range(5)} == {200}


def test_the_429_is_readable_cross_origin_by_the_notice():
    """The client keys its notice on X-Raw-Tier-Clamp: rate_limited and reads Retry-After: both must be exposed."""
    import server
    cors = next(m for m in server.app.user_middleware if m.cls.__name__ == "CORSMiddleware")
    exposed = {h.lower() for h in cors.kwargs.get("expose_headers", [])}
    assert {"x-raw-tier-clamp", "retry-after"} <= exposed
