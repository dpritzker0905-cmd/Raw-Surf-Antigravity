"""
/api/surf-spots response cache — and the cost it removes is BIMODAL with the process's age.

THE DEFECT THIS PINS, WITH THE PROCESS AGE STATED — because the first draft of this file led with
only the bad half, and a number from a 14-hour-old process is not a property of the code:

    process up 13h42m   n=2085   10.2% 5xx   avg 5,848 ms   p90 36,653 ms   (~24% of the box)
    process up  4h05m   n= 755    0.0% 5xx   avg   372 ms   p90  1,000 ms   (under HIGHER load)

Same route, same code, hours apart. The 10.2% is the owner-visible "Couldn't load surf spots"
toast — real, and real only in the degraded state. ⭐⭐ A LATENCY FIGURE FROM THIS SERVICE IS
MEANINGLESS WITHOUT THE PROCESS AGE BESIDE IT.

What IS unconditional is the waste: a 1,773-row catalogue that changes on the order of days was
re-queried, re-materialised into ORM rows, validated TWICE (once into models, once again by
`response_model`) and re-serialised on every 30-second poll, with no caching headers at all
(`cf-cache-status: DYNAMIC`, no ETag) so nothing upstream could help.

⭐ WHY IT IS NOT A SURF-SPOTS PROBLEM. The service runs ONE uvicorn worker with 17 scheduler jobs
in-process, against a 2,048 MB cgroup limit, and an 8-connection DB pool with pool_timeout=20.
On the degraded process **21 unrelated routes stalled in the same 20-45 s band**, which is a shared
resource, not per-route work. Removing this route's ability to become the box's largest consumer is
therefore headroom for all of them — but as INSURANCE against that state recurring, not as a
present-tense win.

⚠️ THESE TESTS CANNOT MEASURE THE IMPROVEMENT. There is no local backend or DB, and the production
effect can only be read from the live telemetry after a deploy. What they CAN prove is the set of
invariants the win depends on: that a hit touches no database, that the payload did not change
shape, that geofenced and filtered requests are never served from cache, and that the kill switch
restores the old path exactly.
"""
import json
import pytest

from routes.surf_spots import spots_cache


@pytest.fixture(autouse=True)
def _clean_cache(monkeypatch):
    monkeypatch.delenv("SURF_SPOTS_CACHE", raising=False)
    monkeypatch.delenv("SURF_SPOTS_CACHE_TTL", raising=False)
    spots_cache._reset_for_test()
    yield
    spots_cache._reset_for_test()


# ─────────────────────────────────────────────────────────────────────────────
# RESTRICTION 1: only the non-geofenced, unfiltered catalogue is cacheable.
# This is a PRIVACY property, not a tuning choice — with coordinates the payload carries per-user
# distance_miles / is_within_geofence computed against that user's subscription-tier radius.
# ─────────────────────────────────────────────────────────────────────────────
BASE = dict(user_lat=None, user_lon=None, region=None, country=None,
            state_province=None, viewport_only=False)


def test_the_plain_catalogue_is_cacheable():
    """The positive control. Without it every negative below could pass vacuously."""
    assert spots_cache.is_cacheable(**BASE) is True


@pytest.mark.parametrize("override", [
    {"user_lat": 28.1},                      # lat alone
    {"user_lon": -80.6},                     # lon alone
    {"user_lat": 28.1, "user_lon": -80.6},   # the real geofenced request
    {"region": "Charleston"},
    {"country": "USA"},
    {"state_province": "Florida"},
    {"viewport_only": True},
])
def test_anything_that_changes_the_payload_is_NOT_cacheable(override):
    assert spots_cache.is_cacheable(**{**BASE, **override}) is False


def test_a_single_coordinate_still_disables_the_cache():
    # The handler only geofences when BOTH are present, so lat-alone produces the same bytes as the
    # plain catalogue and would be *safe* to cache. It is refused anyway: the safety of this cache
    # must not depend on a subtle agreement with a condition written elsewhere in another file.
    assert spots_cache.is_cacheable(**{**BASE, "user_lat": 28.1}) is False


# ─────────────────────────────────────────────────────────────────────────────
# Store / get / expire
# ─────────────────────────────────────────────────────────────────────────────
def test_stores_and_returns_the_exact_bytes():
    body = spots_cache.serialize([{"id": "a", "name": "Spot"}])
    etag = spots_cache.store(body, now=1000.0)
    hit = spots_cache.get(now=1000.0)
    assert hit is not None
    assert hit == (etag, body)
    assert json.loads(hit[1]) == [{"id": "a", "name": "Spot"}]


def test_a_miss_before_anything_is_stored():
    assert spots_cache.get() is None


def test_expires_at_the_ttl_and_not_before():
    body = spots_cache.serialize([{"id": "a"}])
    spots_cache.store(body, now=1000.0)
    assert spots_cache.get(now=1029.9) is not None     # still inside 30 s
    assert spots_cache.get(now=1030.0) is None         # boundary is exclusive
    assert spots_cache.get(now=1000.0) is None, "an expired slot must be dropped, not resurrected"


def test_ttl_is_tunable(monkeypatch):
    monkeypatch.setenv("SURF_SPOTS_CACHE_TTL", "5")
    spots_cache.store(spots_cache.serialize([{"id": "a"}]), now=1000.0)
    assert spots_cache.get(now=1004.9) is not None
    assert spots_cache.get(now=1005.0) is None


def test_a_malformed_ttl_falls_back_to_the_default_rather_than_disabling_the_cache(monkeypatch):
    monkeypatch.setenv("SURF_SPOTS_CACHE_TTL", "not-a-number")
    assert spots_cache.ttl_seconds() == spots_cache.DEFAULT_TTL_SECONDS
    spots_cache.store(spots_cache.serialize([{"id": "a"}]), now=1000.0)
    assert spots_cache.get(now=1010.0) is not None


def test_invalidate_drops_the_slot():
    spots_cache.store(spots_cache.serialize([{"id": "a"}]), now=1000.0)
    spots_cache.invalidate()
    assert spots_cache.get(now=1000.0) is None


# ─────────────────────────────────────────────────────────────────────────────
# The kill switch must restore the previous behaviour EXACTLY.
# ─────────────────────────────────────────────────────────────────────────────
def test_kill_switch_makes_every_read_a_miss(monkeypatch):
    spots_cache.store(spots_cache.serialize([{"id": "a"}]), now=1000.0)
    assert spots_cache.get(now=1000.0) is not None      # control: it WAS cached
    monkeypatch.setenv("SURF_SPOTS_CACHE", "0")
    assert spots_cache.get(now=1000.0) is None


def test_kill_switch_also_refuses_to_store(monkeypatch):
    monkeypatch.setenv("SURF_SPOTS_CACHE", "0")
    etag = spots_cache.store(spots_cache.serialize([{"id": "a"}]), now=1000.0)
    assert etag, "an ETag is still returned so the response shape does not change"
    monkeypatch.delenv("SURF_SPOTS_CACHE")
    assert spots_cache.get(now=1000.0) is None, "nothing may have been retained while disabled"


def test_only_the_literal_zero_disables_it(monkeypatch):
    # A typo'd value must not silently disable a cache the service depends on for headroom.
    for value in ("1", "true", "", "no"):
        monkeypatch.setenv("SURF_SPOTS_CACHE", value)
        assert spots_cache.cache_enabled() is True, f"{value!r} should not disable the cache"
    monkeypatch.setenv("SURF_SPOTS_CACHE", "0")
    assert spots_cache.cache_enabled() is False


# ─────────────────────────────────────────────────────────────────────────────
# ETag
# ─────────────────────────────────────────────────────────────────────────────
def test_etag_is_stable_for_identical_bytes_and_differs_otherwise():
    a = spots_cache.serialize([{"id": "a"}])
    b = spots_cache.serialize([{"id": "b"}])
    assert spots_cache.store(a) == spots_cache.store(a)
    assert spots_cache.store(a) != spots_cache.store(b)


def test_etag_is_a_quoted_http_token():
    # An unquoted ETag is not a valid entity-tag and clients may refuse to echo it in
    # If-None-Match, which would silently cost every 304 this change is meant to produce.
    etag = spots_cache.store(spots_cache.serialize([{"id": "a"}]))
    assert etag.startswith('"') and etag.endswith('"') and len(etag) > 2


# ─────────────────────────────────────────────────────────────────────────────
# Serialisation must not change the payload's shape.
# ─────────────────────────────────────────────────────────────────────────────
def test_serialize_is_compact_but_semantically_identical():
    payload = [{"id": "a", "name": "Spot", "latitude": 28.1, "active_photographers_count": 0}]
    body = spots_cache.serialize(payload)
    assert json.loads(body) == payload, "round-trip must be lossless"
    assert b", " not in body and b'": ' not in body, "compact separators drop wire bytes for free"


def test_serialize_matches_what_the_route_previously_returned():
    """
    The route used to return model instances and let `response_model` serialise them; it now
    serialises once itself. ⭐ THE RISK BEING PINNED is payload DRIFT — a field appearing, vanishing
    or changing type would break every client silently, and no other test here would notice.
    """
    from fastapi.encoders import jsonable_encoder
    from routes.surf_spots.schemas import SurfSpotResponse

    spot = SurfSpotResponse(
        id="28c43742-b5dd-4bee-b7e9-4dbfdd033492", name="10th Street Folly", region="Charleston",
        latitude=32.665, longitude=-79.928, description=None, difficulty="intermediate",
        best_tide=None, best_swell=None, image_url=None, is_active=True,
        active_photographers_count=0, country="USA", state_province="South Carolina",
        wave_type=None, is_within_geofence=True, distance_miles=None,
    )
    decoded = json.loads(spots_cache.serialize(jsonable_encoder([spot])))

    assert decoded == [spot.model_dump()], "the cached bytes must equal the model's own dump"
    assert set(decoded[0]) == set(SurfSpotResponse.model_fields), "no field may appear or vanish"


# ─────────────────────────────────────────────────────────────────────────────
# DRIFT GUARD: every catalogue mutation must invalidate.
# ─────────────────────────────────────────────────────────────────────────────
def test_every_commit_in_admin_spots_invalidates_the_cache():
    """
    Binds to `await db.commit()` rather than to a list of route names, because a route added later
    will use the same commit idiom and would otherwise leave the catalogue stale with nothing
    failing. ⭐ Guard the MUTATION POINT, not the caller.
    """
    import inspect
    from routes.surf_spots import admin_spots

    src = inspect.getsource(admin_spots)
    lines = src.splitlines()
    commits = [i for i, line in enumerate(lines) if line.strip() == "await db.commit()"]
    assert commits, "positive control — this file must still contain commits for the test to mean anything"

    missing = []
    for i in commits:
        window = "\n".join(lines[i:i + 6])          # commit + its comment + the invalidate call
        if "spots_cache.invalidate()" not in window:
            missing.append(i + 1)
    assert missing == [], f"commit without a cache invalidation at line(s) {missing}"
