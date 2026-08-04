"""A TRANSIENT FAILURE WAS MEMOIZED FOR THE FULL POSITIVE TTL — 60x the breaker it outlived.

Found by an external deep audit of the weather-sim advisor (2026-08-03, snapshot `e9bd7d55`),
reproduced here with controls.

`fetch_live_forecast` builds `(None, {"reason": ...})` when either leg is missing and then calls
`_remember(key, out)` UNCONDITIONALLY. `(None, reason)` is a perfectly good cached object, so every
later call for that (lat, lng, valid_time) recalls the failure for `_FORECAST_CACHE_TTL_S` = 3600 s,
while the circuit breaker that caused it cools down in `DOWN_COOLDOWN_S` = 60 s.

⭐⭐⭐ WHY THIS IS WORSE THAN A CACHE BUG. MASTER AUDIT 1.0 §2b established that ONE transient
timeout silently changes which spot `find_best_spot` recommends — the breaker drops the TAIL of a
nearest-first candidate list, and at Jeffreys Bay the two FARTHEST candidates are ranks 1 and 2 by
quality. That finding priced the blast radius as a 60 s window and offered "the breaker cools down"
as the reason it self-heals. **With the failure cached, the window is an HOUR per key and the
self-healing does not happen.** The audit's own remedy was wrong by 60x.

⭐⭐ AND THE COMPOUND, measured here and in neither finding alone: inside a two-leg forecast the
FAILING leg calls `_mark_down()` and the HEALTHY leg then calls `_mark_up()`, so the breaker reads
UP while the cache holds the absence. **Health says up, the answer says missing, for an hour** —
which is exactly how this survives unnoticed.

THE FIX: negative entries get their own short TTL, tied to the breaker cooldown. Not "never cache"
— the cache is also what stops a 12-spot scan re-paying an 8 s timeout twelve times, and the breaker
cannot be relied on for that because a healthy sibling leg clears it (above). A successful retry
overwrites the negative entry outright.
"""
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import services.weather_pipeline.sim_forecast as SF  # noqa: E402

VT = "2026-08-03T18:00:00Z"
LAT, LNG = 27.8608, -80.4472
GOOD_MARINE = {"point": {"speed": 1.2, "period": 12.0, "direction": 80.0},
               "valid_time": VT, "run_time": "2026-08-03T12:00:00Z", "product_id": "p"}
GOOD_WIND = {"point": {"speed": 6.0, "direction": 250.0}, "run_time": "2026-08-03T12:00:00Z"}


def _install(fail_marine_times, monkeypatch):
    """A provider whose marine leg fails the first `fail_marine_times` calls, then recovers."""
    state = {"n": 0}

    def fetch_point(domain, layer, lat, lng, valid_time):
        if domain == "marine":
            state["n"] += 1
            if state["n"] <= fail_marine_times:
                SF._mark_down()               # what the real fetch_point does on failure
                return None
        SF._mark_up()
        return GOOD_MARINE if domain == "marine" else GOOD_WIND

    monkeypatch.setattr(SF, "fetch_point", fetch_point)
    SF._FORECAST_CACHE.clear()
    SF._mark_up()
    return state


def test_a_transient_failure_does_not_survive_the_breaker_cooldown(monkeypatch):
    """★ THE FAILING INSTANCE. One blip, provider fully healthy afterwards — the retry must reach
    it rather than recalling the failure for an hour."""
    _install(1, monkeypatch)

    baseline, prov = SF.fetch_live_forecast(LAT, LNG, VT)
    assert baseline is None and "no marine" in prov["reason"]     # the blip happened

    # the negative entry must not outlive the outage it records
    assert SF.NEGATIVE_CACHE_TTL_S <= SF.DOWN_COOLDOWN_S, (
        "a negative entry may not outlive the circuit breaker that caused it")

    # simulate the breaker cooling down, without sleeping
    monkeypatch.setattr(SF.time, "monotonic",
                        lambda _t0=time.monotonic(): _t0 + SF.NEGATIVE_CACHE_TTL_S + 1.0)

    baseline2, _ = SF.fetch_live_forecast(LAT, LNG, VT)
    assert baseline2 is not None, (
        "the healthy retry still recalled the cached failure — the absence outlives the outage")
    assert baseline2["swell_height_m"] == 1.2


def test_a_SUCCESS_still_lives_the_full_hour_the_control(monkeypatch):
    """THE CONTROL. The short TTL must apply to failures ONLY. If positive entries also expired in
    60 s, a what-if sweep over one spot would re-fetch constantly and this 'fix' would be a
    performance regression wearing a correctness fix's clothes."""
    _install(0, monkeypatch)

    baseline, _ = SF.fetch_live_forecast(LAT, LNG, VT)
    assert baseline is not None

    monkeypatch.setattr(SF.time, "monotonic",
                        lambda _t0=time.monotonic(): _t0 + SF.NEGATIVE_CACHE_TTL_S + 1.0)
    # well past the NEGATIVE ttl, nowhere near the positive one: must still be a hit
    assert SF._recall((round(LAT, 4), round(LNG, 4), VT)) is not None


def test_the_failure_is_still_cached_briefly_so_a_scan_does_not_re_pay_the_timeout(monkeypatch):
    """⚠️ NOT 'never cache failures'. A 12-spot scan against an unreachable app would otherwise
    re-pay the 8 s timeout per spot — the pile-up the breaker exists for, and the breaker cannot be
    trusted here because a healthy sibling leg clears it (see the compound test below)."""
    state = _install(99, monkeypatch)       # provider stays down

    SF.fetch_live_forecast(LAT, LNG, VT)
    n_after_first = state["n"]
    SF.fetch_live_forecast(LAT, LNG, VT)    # immediately again, inside the negative TTL
    assert state["n"] == n_after_first, "the immediate retry re-dialled a known-down provider"


def test_the_healthy_leg_clears_the_breaker_while_the_absence_persists(monkeypatch):
    """⭐⭐ THE COMPOUND, and the reason this survived unnoticed: the FAILING leg marks the lane
    down and the HEALTHY leg marks it back up, so the breaker reads UP. Health and answer disagree.
    Pinned so that if the breaker is ever split per endpoint family, this test says so."""
    _install(1, monkeypatch)

    baseline, _ = SF.fetch_live_forecast(LAT, LNG, VT)
    assert baseline is None                      # the composite failed
    assert SF._is_down() is False, (
        "breaker semantics changed — re-derive the negative-TTL argument, which rests on the "
        "breaker NOT being a reliable signal that the lane is down")


def test_a_successful_retry_overwrites_the_negative_entry(monkeypatch):
    """A recovered forecast must replace the failure, not sit beside it."""
    _install(1, monkeypatch)
    SF.fetch_live_forecast(LAT, LNG, VT)
    monkeypatch.setattr(SF.time, "monotonic",
                        lambda _t0=time.monotonic(): _t0 + SF.NEGATIVE_CACHE_TTL_S + 1.0)
    SF.fetch_live_forecast(LAT, LNG, VT)

    cached = SF._recall((round(LAT, 4), round(LNG, 4), VT))
    assert cached is not None and cached[0] is not None, "the negative entry was not replaced"
