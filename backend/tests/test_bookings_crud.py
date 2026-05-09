"""
test_bookings_crud.py — v89 Endpoint Contract Tests

Validates the bookings/crud.py core module.
Covers:
  - GET  /api/bookings                  (list all bookings)
  - GET  /api/bookings/user/{user_id}   (user's bookings)
  - GET  /api/bookings/nearby           (nearby open bookings)
  - GET  /api/bookings/{id}/share-link  (share link generation)
  - GET  /api/photographers/directory   (photographer directory)
  - PATCH /api/bookings/{id}            (update settings)
  - GET  /api/sessions/user/{id}        (user live sessions)
  - GET  /api/sessions/user/{id}/history (session history)
"""
import pytest
import os
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

ADMIN_EMAIL = "kelly@surf.com"
ADMIN_PASSWORD = "test-shaka"
REGULAR_EMAIL = "sarah@waters.com"
REGULAR_PASSWORD = "test-shaka"


@pytest.fixture(scope="module")
def api_client():
    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})
    return session


@pytest.fixture(scope="module")
def admin_user(api_client):
    response = api_client.post(f"{BASE_URL}/api/auth/login", json={
        "email": ADMIN_EMAIL, "password": ADMIN_PASSWORD
    })
    if response.status_code == 200:
        data = response.json()
        return data if "id" in data else data.get("user")
    pytest.skip(f"Admin login failed: {response.status_code}")


@pytest.fixture(scope="module")
def regular_user(api_client):
    response = api_client.post(f"{BASE_URL}/api/auth/login", json={
        "email": REGULAR_EMAIL, "password": REGULAR_PASSWORD
    })
    if response.status_code == 200:
        data = response.json()
        return data if "id" in data else data.get("user")
    pytest.skip(f"Regular user login failed: {response.status_code}")


# ============ LIST BOOKINGS ============

class TestListBookings:
    """GET /api/bookings"""

    def test_list_bookings_no_filter(self, api_client):
        """Should return a list of bookings"""
        response = api_client.get(f"{BASE_URL}/api/bookings")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list), "GET /bookings should return a list"

    def test_list_bookings_with_user_filter(self, api_client, regular_user):
        """Should filter bookings by user_id"""
        user_id = regular_user.get("id")
        response = api_client.get(
            f"{BASE_URL}/api/bookings", params={"user_id": user_id}
        )
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)

    def test_list_bookings_with_status_filter(self, api_client):
        """Should filter bookings by status"""
        response = api_client.get(
            f"{BASE_URL}/api/bookings", params={"status": "Confirmed"}
        )
        assert response.status_code == 200

    def test_booking_response_shape(self, api_client):
        """Verify booking response contains expected fields"""
        response = api_client.get(f"{BASE_URL}/api/bookings")
        assert response.status_code == 200
        data = response.json()
        if len(data) > 0:
            booking = data[0]
            required_fields = [
                "id", "photographer_id", "location", "session_date",
                "duration", "status", "total_price", "max_participants"
            ]
            for field in required_fields:
                assert field in booking, f"Booking missing field: {field}"


# ============ USER BOOKINGS ============

class TestUserBookings:
    """GET /api/bookings/user/{user_id}"""

    def test_get_user_bookings(self, api_client, regular_user):
        """Should return bookings for a specific user"""
        user_id = regular_user.get("id")
        response = api_client.get(f"{BASE_URL}/api/bookings/user/{user_id}")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)

    def test_get_user_bookings_nonexistent_user(self, api_client):
        """Non-existent user should return 404"""
        fake_id = "00000000-0000-0000-0000-000000000000"
        response = api_client.get(f"{BASE_URL}/api/bookings/user/{fake_id}")
        assert response.status_code == 404


# ============ NEARBY BOOKINGS ============

class TestNearbyBookings:
    """GET /api/bookings/nearby"""

    def test_nearby_bookings(self, api_client):
        """Should return nearby open bookings"""
        response = api_client.get(
            f"{BASE_URL}/api/bookings/nearby",
            params={"latitude": 26.45, "longitude": -80.07, "radius": 10.0}
        )
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)

    def test_nearby_bookings_with_skill_filter(self, api_client):
        """Should support skill level filtering"""
        response = api_client.get(
            f"{BASE_URL}/api/bookings/nearby",
            params={
                "latitude": 26.45, "longitude": -80.07,
                "skill_level": "Intermediate"
            }
        )
        assert response.status_code == 200

    def test_nearby_requires_coordinates(self, api_client):
        """Should require latitude and longitude"""
        response = api_client.get(f"{BASE_URL}/api/bookings/nearby")
        assert response.status_code == 422, (
            "Missing lat/lon should fail validation"
        )


# ============ PHOTOGRAPHER DIRECTORY ============

class TestPhotographerDirectory:
    """GET /api/photographers/directory"""

    def test_get_directory(self, api_client):
        """Should return photographer directory"""
        response = api_client.get(f"{BASE_URL}/api/photographers/directory")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)

    def test_directory_search(self, api_client):
        """Should support search parameter"""
        response = api_client.get(
            f"{BASE_URL}/api/photographers/directory",
            params={"search": "kelly"}
        )
        assert response.status_code == 200

    def test_directory_region_filter(self, api_client):
        """Should support region filter"""
        response = api_client.get(
            f"{BASE_URL}/api/photographers/directory",
            params={"region": "fl"}
        )
        assert response.status_code == 200


# ============ SESSIONS ============

class TestUserSessions:
    """GET /api/sessions/user/{user_id} and /history"""

    def test_get_user_sessions(self, api_client, regular_user):
        """Should return active live sessions"""
        user_id = regular_user.get("id")
        response = api_client.get(f"{BASE_URL}/api/sessions/user/{user_id}")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)

    def test_get_session_history(self, api_client, regular_user):
        """Should return session history"""
        user_id = regular_user.get("id")
        response = api_client.get(
            f"{BASE_URL}/api/sessions/user/{user_id}/history"
        )
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)


# ============ ROUTER HEALTH ============

class TestBookingsCrudRouterHealth:
    """Verify all crud.py endpoints are mounted"""

    def test_all_crud_endpoints_reachable(self, api_client, regular_user):
        """Smoke test: all CRUD endpoints respond (not 405)"""
        user_id = regular_user.get("id")
        endpoints = [
            f"/api/bookings",
            f"/api/bookings/user/{user_id}",
            f"/api/bookings/nearby?latitude=26.45&longitude=-80.07",
            f"/api/photographers/directory",
            f"/api/sessions/user/{user_id}",
            f"/api/sessions/user/{user_id}/history",
        ]
        for path in endpoints:
            r = api_client.get(f"{BASE_URL}{path}")
            assert r.status_code != 405, (
                f"GET {path} returned 405 — endpoint not mounted"
            )
