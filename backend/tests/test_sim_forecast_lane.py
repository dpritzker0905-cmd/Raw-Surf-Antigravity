"""The LIVE forecast lane — `services/weather_pipeline/sim_forecast.py`.

Split out of `test_weather_sim_mcp.py` on 2026-07-28: that file had reached 792 lines against the
800-LOC ratchet, so the next test added there would have failed CI. The seam is the same one
`5d8babe4` used on the source — the forecast lane is cohesive, has no MCP dependency and is useful
to any out-of-process caller — so the tests now follow the module they exercise.

Before 2026-07-27 `get_weather_forecast` answered for 3 of 1547 spots (0.2%) and returned
`forecast: null` for the rest. These stub the HTTP leg: the mapping and the precedence are what
must not drift, and they are exactly what a network cannot exercise deterministically.
"""
import os
import sys

import pytest

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

import weather_sim_mcp
from services.weather_pipeline import sim_forecast


@pytest.fixture(autouse=True)
def _hermetic(monkeypatch):
    """No network, and no state carried between tests.

    ⚠️ `_SIM_OVERRIDES` must be cleared too. It is module-global and a staged override OUTRANKS the
    live forecast, so one test staging a scenario silently changed what a later test observed —
    splitting this file out reordered the suite and turned that latent leak into a failure."""
    monkeypatch.setenv("SIM_LIVE_FORECAST", "0")
    monkeypatch.setenv("SIM_LIVE_CATALOG", "0")
    sim_forecast._FORECAST_CACHE.clear()
    sim_forecast._CATALOG_CACHE.clear()
    weather_sim_mcp._SIM_OVERRIDES.clear()
    yield
    sim_forecast._FORECAST_CACHE.clear()
    sim_forecast._CATALOG_CACHE.clear()
    weather_sim_mcp._SIM_OVERRIDES.clear()


def _db_available():
    return bool(weather_sim_mcp.query_spots_from_db(limit=1))


# ── The live forecast lane: every catalog spot can now be forecast, not just the three ───────
# Before 2026-07-27 `get_weather_forecast` answered for 3 of 1547 spots (0.2%) and returned
# `forecast: null` for the rest. These stub the HTTP leg — the mapping and precedence are what
# must not drift, and they are what the network cannot be trusted to exercise deterministically.

def _stub_points(monkeypatch, marine=None, wind=None):
    """Stand in for /api/weather/point with fixed payloads, per domain."""
    marine = marine if marine is not None else {
        "point": {"speed": 2.0, "period": 14.0, "direction": 300.0},
        "surf_height_m": 3.0, "valid_time": "2026-07-27T19:00:00Z",
        "run_time": "2026-07-27T18:00:00Z", "product_id": "stub", "is_forecast_authoritative": True}
    wind = wind if wind is not None else {
        "point": {"speed": 7.0, "period": 0.0, "direction": 45.0}}

    def fake(domain, layer, lat, lng, valid_time):
        return marine if domain == "marine" else wind

    monkeypatch.setenv("SIM_LIVE_FORECAST", "1")
    monkeypatch.setattr(sim_forecast, "fetch_point", fake)
    sim_forecast._FORECAST_CACHE.clear()


def test_a_catalog_spot_gets_a_real_forecast_from_the_app(monkeypatch):
    """THE feature: a spot with no hand-tuned baseline is forecast from the app's own point lane."""
    if not _db_available():
        pytest.skip("dev.db unavailable in this environment")
    candidates = [s for s in weather_sim_mcp.query_spots_from_db(limit=400)
                  if s["name"] not in weather_sim_mcp.MOCK_SPOTS]
    assert candidates
    _stub_points(monkeypatch)
    res = weather_sim_mcp.get_weather_forecast(candidates[0]["name"])
    assert res["baseline_source"] == "live_forecast"
    assert res["forecast"]["swell_height_m"] == 2.0        # marine point.speed = OFFSHORE Hs
    assert res["forecast"]["swell_period_sec"] == 14.0
    assert res["forecast"]["swell_direction_deg"] == 300.0
    assert res["forecast"]["wind_speed_knots"] == 7.0      # that endpoint reports knots already
    assert res["forecast"]["wind_direction_deg"] == 45.0
    assert res["wave_simulation"]["breaking_height_ft"] > 0


def test_live_forecast_outranks_the_invented_catalog_defaults(monkeypatch):
    """A real forecast beats a hardcoded constant — but never beats an explicit override."""
    _stub_points(monkeypatch)
    try:
        live = weather_sim_mcp.get_weather_forecast("Mavericks")
        assert live["baseline_source"] == "live_forecast"
        assert live["forecast"]["swell_height_m"] == 2.0

        weather_sim_mcp.simulate_weather_change(
            spot_name="Mavericks", wind_speed_knots=5.0, wind_direction_deg=100.0,
            swell_height_m=4.2, swell_period_sec=18.0, swell_direction_deg=290.0,
            caller_role="admin")
        staged = weather_sim_mcp.get_weather_forecast("Mavericks")
        assert staged["baseline_source"] == "simulated_override"
        assert staged["forecast"]["swell_height_m"] == 4.2
    finally:
        weather_sim_mcp.clear_simulation_overrides()


def test_a_half_answer_is_refused_rather_than_half_invented(monkeypatch):
    """Both legs are required. With marine but no wind the vector would have to invent a wind, and
    an invented wind is exactly how a blown-out day reads clean."""
    _stub_points(monkeypatch, wind={"point": {"speed": None, "direction": None}})
    res = weather_sim_mcp.get_weather_forecast("Mavericks")
    assert res["baseline_source"] == "catalog_default"      # falls back, does not fabricate
    assert "wind" in res["forecast_provenance"]["reason"]


def test_live_forecast_reports_parity_with_the_height_the_app_serves(monkeypatch):
    """The app serves its own breaking height; the sim computes one from the offshore Hs. Divergence
    between them is the defect `cf2efb48` was written to end, so the payload must expose it."""
    _stub_points(monkeypatch)
    res = weather_sim_mcp.get_weather_forecast("Mavericks")
    assert res["parity"]["served_surf_height_m"] == 3.0
    assert res["parity"]["sim_breaking_height_m"] > 0
    assert isinstance(res["parity"]["delta_pct"], float)


# ── The catalogue: the app's live spots, not a drifted local snapshot ────────────────────────
# `dev.db` still holds Bethune Beach at 28.998,-80.926 — the coordinate the owner caught by eye and
# production was corrected AWAY from, 7 km off — and still lists the deactivated inland duplicate
# `New Smyrna Beach Inlet` as active. Serving a live forecast at a stale coordinate is worse than
# serving none: it is wrong with full confidence.

def test_catalog_prefers_the_apps_live_spots(monkeypatch):
    """The live catalogue must win over the local snapshot, and say so."""
    monkeypatch.setenv("SIM_LIVE_CATALOG", "1")
    sim_forecast._CATALOG_CACHE.clear()
    monkeypatch.setattr(sim_forecast, "fetch_catalog", lambda: [
        {"id": "x1", "name": "Bethune Beach", "region": "Volusia",
         "latitude": 28.950892, "longitude": -80.83899}])
    res = weather_sim_mcp.get_surf_spots(query="Bethune")
    assert res["source"] == "live_catalog"
    # The CORRECTED coordinate, not the snapshot's 28.998 which is ~7 km away. Compared with a
    # tolerance because the response rounds to 5 dp (~1 m) to keep the payload inside a client's
    # size budget — that rounding must never be confused with a stale value.
    assert abs(res["spots"][0]["latitude"] - 28.950892) < 1e-4
    assert abs(res["spots"][0]["longitude"] - (-80.83899)) < 1e-4


def test_catalog_falls_back_to_the_snapshot_when_the_app_is_unreachable(monkeypatch):
    """Offline must still answer — from the snapshot, named honestly as a snapshot."""
    monkeypatch.setattr(sim_forecast, "fetch_catalog", lambda: None)
    if not _db_available():
        pytest.skip("dev.db unavailable in this environment")
    res = weather_sim_mcp.get_surf_spots(limit=3)
    assert res["source"] == "surf_spots_snapshot"
    assert res["returned"] >= 1


def test_catalog_kill_switch_and_failure_never_raise(monkeypatch):
    """SIM_LIVE_CATALOG=0 restores the snapshot path; a raising fetch must not break the tool."""
    monkeypatch.setenv("SIM_LIVE_CATALOG", "0")
    sim_forecast._CATALOG_CACHE.clear()
    assert sim_forecast.fetch_catalog() is None

    monkeypatch.setenv("SIM_LIVE_CATALOG", "1")
    sim_forecast._CATALOG_CACHE.clear()

    def boom(*a, **k):
        raise RuntimeError("connection refused")

    monkeypatch.setattr(sim_forecast.urllib.request, "urlopen", boom)
    assert sim_forecast.fetch_catalog() is None          # degraded, not raised


# ── The live lane must never dominate the response time (2026-07-27) ─────────────────────────
# Measured against an unreachable app, the 30 s timeout made `get_surf_spots` block 42.2 s and
# `get_weather_forecast` 42.1 s — past the point where an MCP client reports a TIMEOUT instead of an
# answer, so the sim looked broken while being merely patient. The host is a free Render instance
# that cold-starts in ~50 s, so slow is a NORMAL state here.

def test_the_live_timeout_is_short_enough_for_a_client_budget():
    """Two sequential fetches must still fit inside any sane client timeout."""
    assert sim_forecast.TIMEOUT_S <= 10, sim_forecast.TIMEOUT_S


def test_a_failure_opens_the_breaker_so_the_next_call_is_instant(monkeypatch):
    """THE regression: without this, EVERY tool call re-pays the full timeout — and
    `get_weather_forecast` makes two requests, so an outage costs double."""
    monkeypatch.setenv("SIM_LIVE_FORECAST", "1")
    monkeypatch.setenv("SIM_LIVE_CATALOG", "1")
    sim_forecast._FORECAST_CACHE.clear()
    sim_forecast._CATALOG_CACHE.clear()
    sim_forecast._mark_up()

    calls = []

    def slow_and_failing(*a, **k):
        calls.append(1)
        raise OSError("unreachable")

    monkeypatch.setattr(sim_forecast.urllib.request, "urlopen", slow_and_failing)
    assert sim_forecast.fetch_catalog() is None
    assert len(calls) == 1
    # Breaker is now open: further attempts must not touch the network at all.
    assert sim_forecast.fetch_catalog() is None
    assert sim_forecast.fetch_live_forecast(37.5, -122.5)[0] is None
    assert len(calls) == 1, f"the breaker did not hold — {len(calls)} network attempts"
    sim_forecast._mark_up()


def test_a_recovered_app_closes_the_breaker(monkeypatch):
    """An outage must not latch: one success re-opens the live lane."""
    sim_forecast._mark_down()
    assert sim_forecast._is_down()
    _stub_points(monkeypatch)                     # a working fetch_point
    sim_forecast._mark_up()
    assert not sim_forecast._is_down()
    assert weather_sim_mcp.get_weather_forecast("Mavericks")["baseline_source"] == "live_forecast"


def test_the_catalogue_prefetch_never_blocks_or_raises(monkeypatch):
    """It runs at server START. A slow or dead app must delay nothing — the tools fall back."""
    monkeypatch.setenv("SIM_LIVE_CATALOG", "1")
    sim_forecast._CATALOG_CACHE.clear()
    sim_forecast._mark_up()
    monkeypatch.setattr(sim_forecast.urllib.request, "urlopen",
                        lambda *a, **k: (_ for _ in ()).throw(OSError("down")))
    t = sim_forecast.prefetch_catalog_async()
    assert t is not None
    t.join(timeout=10)
    assert not t.is_alive(), "the prefetch thread did not finish"
    sim_forecast._mark_up()

    monkeypatch.setenv("SIM_LIVE_CATALOG", "0")
    assert sim_forecast.prefetch_catalog_async() is None      # honours the kill switch


def test_live_forecast_kill_switch(monkeypatch):
    """SIM_LIVE_FORECAST=0 restores the pre-07-27 behaviour exactly."""
    _stub_points(monkeypatch)
    monkeypatch.setenv("SIM_LIVE_FORECAST", "0")
    sim_forecast._FORECAST_CACHE.clear()
    assert weather_sim_mcp.get_weather_forecast("Mavericks")["baseline_source"] == "catalog_default"


def test_a_failed_fetch_never_raises_out_of_the_tool(monkeypatch):
    """A forecast is an ENRICHMENT: the app being down must degrade the answer, not break the tool."""
    def boom(domain, layer, lat, lng, valid_time):
        raise RuntimeError("connection refused")

    monkeypatch.setenv("SIM_LIVE_FORECAST", "1")
    monkeypatch.setattr(sim_forecast, "fetch_point", boom)
    sim_forecast._FORECAST_CACHE.clear()
    with pytest.raises(RuntimeError):
        sim_forecast.fetch_point("marine", "waves", 0, 0, "")   # the stub really does raise
    monkeypatch.setattr(sim_forecast, "fetch_point",
                        lambda *a, **k: None)                       # what the real one returns
    res = weather_sim_mcp.get_weather_forecast("Mavericks")
    assert res["baseline_source"] == "catalog_default"



def test_the_hourly_cache_does_not_grow_without_bound(monkeypatch):
    """Entries do NOT expire as the hour turns — the KEY changes, so a stale entry becomes
    unreachable and is never freed. Something has to bound it.

    ⚠️ THIS TEST USED TO ASSERT [2, 2, 2] — one hour retained, every other hour dropped on each
    store. That bounded the cache, but it made a TIME SERIES the one access pattern the cache
    actively defeats (measured: 16 frames re-fetched on every pass). The bound is now a CAP, so
    many hours coexist; what must still hold is that the total never exceeds it."""
    _stub_points(monkeypatch)
    monkeypatch.setattr(sim_forecast, "_FORECAST_CACHE_MAX", 4)
    hours = ["2026-07-28T01:00:00Z", "2026-07-28T02:00:00Z", "2026-07-28T03:00:00Z"]
    seen = []
    for hour in hours:
        monkeypatch.setattr(sim_forecast, "current_valid_time", lambda h=hour: h)
        sim_forecast.fetch_live_forecast(37.0, -122.0)
        sim_forecast.fetch_live_forecast(38.0, -123.0)
        seen.append(len(sim_forecast._FORECAST_CACHE))
    assert seen == [2, 4, 4], seen                       # grows to the cap, then holds AT it
    assert len(sim_forecast._FORECAST_CACHE) <= 4


def test_the_cache_evicts_OLDEST_first_so_a_forward_scan_keeps_what_it_needs(monkeypatch):
    """FIFO, not LRU. Walking a series forward in time evicts the past hours first, which is the
    order a forecast scan wants — the hours already behind it are the ones it will not re-ask."""
    _stub_points(monkeypatch)
    monkeypatch.setattr(sim_forecast, "_FORECAST_CACHE_MAX", 3)
    for i in range(1, 6):
        hour = f"2026-07-28T0{i}:00:00Z"
        sim_forecast.fetch_live_forecast(37.0, -122.0, hour)
    held = sorted(k[2] for k in sim_forecast._FORECAST_CACHE)
    assert held == ["2026-07-28T03:00:00Z", "2026-07-28T04:00:00Z", "2026-07-28T05:00:00Z"], held


def test_an_entry_older_than_the_TTL_is_not_served(monkeypatch):
    """A TTL is load-bearing NOW and was not before: wiping every other hour on each store gave
    freshness by accident. Holding many hours, an entry for a FUTURE hour would otherwise outlive
    the ingest that supersedes it and be served stamped with the OLD run_time — worse than a miss,
    because it looks authoritative."""
    _stub_points(monkeypatch)
    hour = "2026-07-28T01:00:00Z"
    first = sim_forecast.fetch_live_forecast(37.0, -122.0, hour)
    assert first[0] is not None
    key = (37.0, -122.0, hour)
    assert sim_forecast._recall(key) is not None
    # ⚠️ Entries carry their OWN ttl since 2026-08-03: a FAILURE is capped at the breaker cooldown
    # while a success keeps the full hour, so the stamp is (when, value, ttl). This test still
    # asserts the POSITIVE path — and reads the stored ttl back rather than assuming the constant,
    # so it stays honest if the policy changes again.
    stamped_at, out, ttl = sim_forecast._FORECAST_CACHE[key]
    assert ttl == sim_forecast._FORECAST_CACHE_TTL_S, (
        "a SUCCESS was stamped with the negative ttl — the short TTL must apply to failures only")
    sim_forecast._FORECAST_CACHE[key] = (stamped_at - ttl - 1, out, ttl)
    assert sim_forecast._recall(key) is None, "an expired entry must not be served"
    assert key not in sim_forecast._FORECAST_CACHE, "expiring must also free it"


# ── The time dimension: a forecast tool that could only answer "right now" ────────────────────
# Measured 2026-07-28, /api/weather/point serves authoritative frames at this coordinate out to at
# least +168 h. "Is tomorrow morning better?" is the question a surfer actually asks, and it was
# not being asked.

def test_a_future_hour_is_requested_from_the_app(monkeypatch):
    seen = {}

    def fake(domain, layer, lat, lng, valid_time):
        seen[domain] = valid_time
        return ({"point": {"speed": 2.0, "period": 14.0, "direction": 300.0},
                 "surf_height_m": 3.0} if domain == "marine"
                else {"point": {"speed": 7.0, "direction": 45.0}})

    monkeypatch.setenv("SIM_LIVE_FORECAST", "1")
    monkeypatch.setattr(sim_forecast, "fetch_point", fake)
    sim_forecast._FORECAST_CACHE.clear()
    res = weather_sim_mcp.get_weather_forecast("Mavericks", valid_time="2026-07-29T15:00:00Z")
    assert res["requested_valid_time"] == "2026-07-29T15:00:00Z"
    assert seen == {"marine": "2026-07-29T15:00:00Z", "wind": "2026-07-29T15:00:00Z"}
    assert res["baseline_source"] == "live_forecast"


def test_a_malformed_hour_is_refused_before_any_network_call(monkeypatch):
    """A bad hour would otherwise spend the full timeout and come back empty — which reads
    identically to 'this spot has no data'."""
    def explode(*a, **k):
        raise AssertionError("must not dial with a malformed valid_time")

    monkeypatch.setenv("SIM_LIVE_FORECAST", "1")
    monkeypatch.setattr(sim_forecast, "fetch_point", explode)
    res = weather_sim_mcp.get_weather_forecast("Mavericks", valid_time="tomorrow-ish")
    assert "ISO-8601" in res["error"]


def test_different_hours_are_cached_separately(monkeypatch):
    """The cache key carries the hour, so asking for +24 h must not return the current hour."""
    calls = []

    def fake(domain, layer, lat, lng, valid_time):
        calls.append(valid_time)
        speed = 2.0 if valid_time.startswith("2026-07-28") else 5.0
        return ({"point": {"speed": speed, "period": 14.0, "direction": 300.0},
                 "surf_height_m": 3.0} if domain == "marine"
                else {"point": {"speed": 7.0, "direction": 45.0}})

    monkeypatch.setenv("SIM_LIVE_FORECAST", "1")
    monkeypatch.setattr(sim_forecast, "fetch_point", fake)
    sim_forecast._FORECAST_CACHE.clear()
    a = weather_sim_mcp.get_weather_forecast("Mavericks", valid_time="2026-07-28T01:00:00Z")
    b = weather_sim_mcp.get_weather_forecast("Mavericks", valid_time="2026-07-29T01:00:00Z")
    assert a["forecast"]["swell_height_m"] == 2.0
    assert b["forecast"]["swell_height_m"] == 5.0


def test_a_staged_override_masking_a_requested_hour_says_so(monkeypatch):
    """An override is timeless and still wins — but a requested hour that silently changed nothing
    would be the worse surprise."""
    _stub_points(monkeypatch)
    try:
        weather_sim_mcp.simulate_weather_change(
            spot_name="Mavericks", wind_speed_knots=5.0, wind_direction_deg=100.0,
            swell_height_m=4.2, swell_period_sec=18.0, swell_direction_deg=290.0,
            caller_role="admin")
        res = weather_sim_mcp.get_weather_forecast("Mavericks",
                                                   valid_time="2026-07-29T15:00:00Z")
        assert res["baseline_source"] == "simulated_override"
        assert "masking" in res["forecast_provenance"]["note"]
    finally:
        weather_sim_mcp.clear_simulation_overrides()
