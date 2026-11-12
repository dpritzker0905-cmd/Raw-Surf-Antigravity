"""Flip blocker 1 (2026-11-12): the scheduled jobs' identity. With WEATHER_TIER_CLAMP on, a forecast read without an
account is refused; the jobs carry X-Raw-Service-Key = env WEATHER_SERVICE_KEY instead. Pins: fail closed without a
(long enough) configured key, constant-time match, premium and unthrottled when matched, the key never sent to a
foreign host, and every live job's step carries the secret."""
import pathlib
import re

from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from services import runtime_flags as rf
from services import weather_account_rate_limit as RL
from services import weather_service_identity as SVC
from services import weather_tier_clamp as C
from scripts import _service_auth as SA

KEY = "k" * 40
REPO = pathlib.Path(__file__).resolve().parents[2]


def _h(value):
    return [(b"x-raw-service-key", value.encode())]


def test_no_configured_key_means_no_service_identity(monkeypatch):
    monkeypatch.delenv(SVC.ENV, raising=False)
    assert SVC.from_headers(_h(KEY)) is None
    monkeypatch.setenv(SVC.ENV, "")
    assert SVC.from_headers(_h("")) is None


def test_a_short_configured_key_is_ignored(monkeypatch):
    monkeypatch.setenv(SVC.ENV, "x" * (SVC.MIN_KEY_LEN - 1))
    assert SVC.from_headers(_h("x" * (SVC.MIN_KEY_LEN - 1))) is None


def test_only_the_exact_key_matches(monkeypatch):
    monkeypatch.setenv(SVC.ENV, KEY)
    assert SVC.from_headers(_h(KEY)) == (SVC.SERVICE_UID, "premium")
    assert SVC.from_headers(_h(KEY[:-1])) is None
    assert SVC.from_headers(_h(KEY + "x")) is None
    assert SVC.from_headers([]) is None
    assert SVC.from_headers([(b"authorization", ("Bearer " + KEY).encode())]) is None   # only its own header


def _app(monkeypatch, key_env=KEY):
    monkeypatch.setenv("RUNTIME_FLAGS_MANIFEST", "0")
    monkeypatch.setenv(C.FLAG, "1")
    monkeypatch.setenv(RL.FLAG, "1")
    if key_env is None:
        monkeypatch.delenv(SVC.ENV, raising=False)
    else:
        monkeypatch.setenv(SVC.ENV, key_env)
    rf._reset_for_tests(lambda: None)
    monkeypatch.setattr(RL, "LIMITER", RL.AccountLimiter({"reads": (1.0, 0.0001)}))
    app = FastAPI()

    @app.get("/api/weather/grid")
    async def grid(request: Request):
        return {"model": request.query_params.get("model")}

    async def nobody(auth):
        return None, "guest"

    app.add_middleware(C.WeatherTierClampMiddleware, identity_fn=nobody)
    return TestClient(app)


def test_clamp_on_the_job_key_reads_as_premium_and_is_not_rate_limited(monkeypatch):
    client = _app(monkeypatch)
    hdr = {"X-Raw-Service-Key": KEY}
    rs = [client.get("/api/weather/grid?model=EURO", headers=hdr) for _ in range(5)]   # limiter allows ONE
    assert [r.status_code for r in rs] == [200] * 5
    assert rs[0].json() == {"model": "EURO"}                                             # premium: not clamped to GFS


def test_clamp_on_without_or_with_a_wrong_key_is_refused(monkeypatch):
    client = _app(monkeypatch)
    assert client.get("/api/weather/grid").status_code == 401
    assert client.get("/api/weather/grid", headers={"X-Raw-Service-Key": "nope" * 10}).status_code == 401


def test_clamp_on_and_no_key_on_the_server_the_header_opens_nothing(monkeypatch):
    client = _app(monkeypatch, key_env=None)
    assert client.get("/api/weather/grid", headers={"X-Raw-Service-Key": KEY}).status_code == 401


def test_jobs_send_the_key_only_to_our_backend(monkeypatch):
    monkeypatch.setenv(SA.ENV, KEY)
    live = "https://raw-surf-antigravity.onrender.com/api/weather/point?x=1"
    assert SA.service_headers(live, {"User-Agent": "u"}) == {"User-Agent": "u", SA.HEADER: KEY}
    assert SA.HEADER in SA.service_headers("http://localhost:8000/api/weather/point")
    for foreign in ("http://raw-surf-antigravity.onrender.com/x",            # not https
                    "https://raw-surf-antigravity.onrender.com.evil.test/x",
                    "https://evil.test/?h=raw-surf-antigravity.onrender.com",
                    "https://www.ndbc.noaa.gov/data/realtime2/46025.txt"):
        assert SA.HEADER not in SA.service_headers(foreign), foreign
    monkeypatch.delenv(SA.ENV)
    assert SA.service_headers(live) == {}


def test_server_and_client_agree_on_the_name_and_header():
    assert SA.ENV == SVC.ENV
    assert SA.HEADER.lower().encode() == SVC.HEADER


LIVE_JOBS = {   # workflow -> the script its step runs against the live backend
    "forecast-calibration-census.yml": "verify_point_spot_reference.py",
    "nearshore-validation.yml": "run_nearshore_validation.py",
    "sim-parity-monitor.yml": "sim_health_probe.py",
}
PROBES = ("same_model_parity_probe.py", "tier_resolution_delta.py")


def _step_running(text, script):
    """The YAML text of the one step whose `run:` invokes `script` (steps start at '      - ')."""
    steps = re.split(r"\n(?=      - )", text)
    hits = [s for s in steps if re.search(r"python3? scripts/" + re.escape(script), s)]
    assert len(hits) == 1, (script, len(hits))
    return hits[0]


def test_every_live_job_step_carries_the_secret_by_name():
    for wf, script in LIVE_JOBS.items():
        step = _step_running((REPO / ".github" / "workflows" / wf).read_text(encoding="utf-8"), script)
        assert "WEATHER_SERVICE_KEY: ${{ secrets.WEATHER_SERVICE_KEY }}" in step, wf


def test_every_live_script_sends_the_header_on_each_request():
    for script in list(LIVE_JOBS.values()) + list(PROBES):
        src = (REPO / "backend" / "scripts" / script).read_text(encoding="utf-8")
        assert "from _service_auth import service_headers" in src, script
        n_requests = len(re.findall(r"urllib\.request\.Request\(", src))
        assert n_requests >= 1 and len(re.findall(r"headers=service_headers\(", src)) == n_requests, script
