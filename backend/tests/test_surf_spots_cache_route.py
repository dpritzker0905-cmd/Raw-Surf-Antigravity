"""
/api/surf-spots at the ROUTE level — the cache is only worth anything if a hit touches no database.

The companion suite (test_surf_spots_cache.py) proves the cache module behaves. It could pass in
full while the route ignored the cache entirely, or consulted it AFTER doing the expensive work.
⭐ THE LOAD-BEARING ASSERTION HERE IS A QUERY COUNT: the scarce resource on this service is an
8-connection pool on a single event loop, so "served from cache" has to mean "acquired nothing and
executed nothing", not merely "returned the right bytes".
"""
import uuid
import pytest
from fastapi.testclient import TestClient

from server import app
from database import get_db
from core.security import get_optional_user_id_from_jwt_or_query
from routes.surf_spots import spots_cache


class _Spot:
    """
    The attribute surface the handler reads off a SurfSpot row.

    ⚠️ `id` is a STRING, matching `models/spots.py: id = Column(String(36))`. A first draft of this
    fake used a `uuid.UUID` and every test failed on `SurfSpotResponse.id: str` — Pydantic v2 does
    not coerce UUID to str. That was the FAKE being unfaithful, not the route being broken, and it
    is the reason to read the column type rather than assume the conventional one.
    """
    def __init__(self, name):
        self.id = str(uuid.uuid4())
        self.name = name
        self.region = "Space Coast"
        self.latitude = 28.1
        self.longitude = -80.6
        self.description = None
        self.difficulty = "intermediate"
        self.best_tide = None
        self.best_swell = None
        self.image_url = None
        self.is_active = True
        self.country = "USA"
        self.state_province = "Florida"
        self.wave_type = "beach_break"


class _Result:
    def __init__(self, rows):
        self._rows = rows

    def scalars(self):
        return self

    def all(self):
        return self._rows

    def fetchall(self):
        return []                      # no photographers shooting

    def scalar_one_or_none(self):
        return None


class _CountingSession:
    """Counts every execute() so a cache hit can be asserted to perform zero."""
    def __init__(self, spots):
        self.executes = 0
        self._spots = spots

    async def execute(self, *_args, **_kwargs):
        self.executes += 1
        return _Result(self._spots)


@pytest.fixture
def session():
    s = _CountingSession([_Spot("Sebastian Inlet"), _Spot("Spanish House")])

    async def _override():
        yield s

    app.dependency_overrides[get_db] = _override
    app.dependency_overrides[get_optional_user_id_from_jwt_or_query] = lambda: None
    spots_cache._reset_for_test()
    yield s
    app.dependency_overrides.pop(get_db, None)
    app.dependency_overrides.pop(get_optional_user_id_from_jwt_or_query, None)
    spots_cache._reset_for_test()


@pytest.fixture
def client():
    return TestClient(app)


def test_first_call_queries_the_database_and_second_does_not(session, client):
    first = client.get("/api/surf-spots")
    assert first.status_code == 200
    assert len(first.json()) == 2
    after_first = session.executes
    # POSITIVE CONTROL: if this were 0 the "second call does 0" assertion would be vacuous.
    assert after_first > 0, "the cold call must actually hit the database"

    second = client.get("/api/surf-spots")
    assert second.status_code == 200
    assert second.json() == first.json(), "a hit must be byte-identical, not merely similar"
    assert session.executes == after_first, (
        "THE WHOLE POINT: a cache hit must acquire no connection and execute no query"
    )


def test_the_hit_carries_an_etag_and_cache_control(session, client):
    r = client.get("/api/surf-spots")
    assert r.headers.get("etag")
    cc = r.headers.get("cache-control", "")
    assert "max-age=" in cc
    # `private` because active_photographers_count is a live signal about where people are — it must
    # never be held by a shared proxy.
    assert "private" in cc


def test_if_none_match_gets_a_304_with_no_body_and_no_query(session, client):
    first = client.get("/api/surf-spots")
    etag = first.headers["etag"]
    before = session.executes

    r = client.get("/api/surf-spots", headers={"If-None-Match": etag})
    assert r.status_code == 304
    assert r.content == b""
    assert session.executes == before, "a revalidation must not reach the database either"


def test_a_stale_etag_gets_the_full_body(session, client):
    client.get("/api/surf-spots")
    r = client.get("/api/surf-spots", headers={"If-None-Match": '"not-the-current-etag"'})
    assert r.status_code == 200
    assert len(r.json()) == 2


# ─────────────────────────────────────────────────────────────────────────────
# The restrictions, exercised through the real route rather than the predicate.
# ─────────────────────────────────────────────────────────────────────────────
def test_a_geofenced_request_is_never_served_from_cache(session, client):
    client.get("/api/surf-spots")                     # warm the slot
    before = session.executes

    r = client.get("/api/surf-spots?user_lat=28.1&user_lon=-80.6")
    assert r.status_code == 200
    assert session.executes > before, (
        "a geofenced request must do its own work — serving it from the shared slot would leak one "
        "user's Privacy Shield view to another"
    )
    # And it must carry the per-user fields the cached payload cannot have.
    assert all("distance_miles" in row for row in r.json())


@pytest.mark.parametrize("qs", [
    "region=Space+Coast",
    "country=USA",
    "state_province=Florida",
    "viewport_only=true&min_lat=28.0&max_lat=28.4&min_lon=-80.8&max_lon=-80.4",
])
def test_filtered_requests_bypass_the_cache(session, client, qs):
    client.get("/api/surf-spots")
    before = session.executes
    assert client.get(f"/api/surf-spots?{qs}").status_code == 200
    assert session.executes > before, f"{qs} must not be answered from the unfiltered slot"


def test_a_filtered_request_never_POISONS_the_slot(session, client):
    """The mirror-image defect: a narrow result being stored and then served as the catalogue."""
    assert client.get("/api/surf-spots?region=Space+Coast").status_code == 200
    assert spots_cache.get() is None, "a filtered response must not populate the shared slot"


def test_no_profile_query_without_coordinates(session, client):
    """
    visibility_radius feeds is_within_geofence and nothing else, and that only runs when both
    coordinates are present — so without them the Profile lookup was dead work on every poll. Two
    executes = the spot query + the active-counts query, and no third.
    """
    app.dependency_overrides[get_optional_user_id_from_jwt_or_query] = lambda: "some-user-id"
    r = client.get("/api/surf-spots")
    assert r.status_code == 200
    assert session.executes == 2, f"expected spots + counts only, got {session.executes} queries"


def test_the_profile_query_still_runs_when_it_is_actually_needed(session, client):
    """THE CONTROL for the test above — the optimisation must not have removed a real lookup."""
    app.dependency_overrides[get_optional_user_id_from_jwt_or_query] = lambda: "some-user-id"
    r = client.get("/api/surf-spots?user_lat=28.1&user_lon=-80.6")
    assert r.status_code == 200
    assert session.executes == 3, f"expected spots + profile + counts, got {session.executes}"


def test_kill_switch_restores_the_uncached_path(session, client, monkeypatch):
    monkeypatch.setenv("SURF_SPOTS_CACHE", "0")
    first = client.get("/api/surf-spots")
    before = session.executes
    second = client.get("/api/surf-spots")
    assert second.status_code == 200
    assert second.json() == first.json()
    assert session.executes > before, "with the cache off every call must query again"
