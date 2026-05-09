"""
test_lineup_seats.py — v91 Endpoint Contract Tests

Validates the bookings/lineup_seats.py module (extracted from lineup.py in v90).
Covers:
  - POST  /api/bookings/{id}/lineup/status          (toggle lineup status)
  - POST  /api/bookings/{id}/lineup/remove-member    (remove crew member)
  - PATCH /api/bookings/{id}/reservation-settings    (update seat settings)
  - GET   /api/bookings/{id}/reservation-settings    (get seat settings)

Import integrity:
  - lineup_seats module exists and defines a router
  - Re-exports from lineup.py still resolve
  - __init__.py includes lineup_seats router
"""
import pytest
import os
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

ADMIN_EMAIL = "kelly@surf.com"
ADMIN_PASSWORD = "test-shaka"


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


# ============ IMPORT INTEGRITY ============

class TestLineupSeatsImports:
    """Verify lineup_seats.py imports and re-exports work."""

    def test_lineup_seats_exists(self):
        """lineup_seats.py should exist"""
        module_path = os.path.join(
            os.path.dirname(__file__), '..', 'routes', 'bookings', 'lineup_seats.py'
        )
        assert os.path.exists(module_path), "lineup_seats.py not found"

    def test_lineup_seats_has_router(self):
        """lineup_seats.py should define a router"""
        module_path = os.path.join(
            os.path.dirname(__file__), '..', 'routes', 'bookings', 'lineup_seats.py'
        )
        with open(module_path, 'r') as f:
            content = f.read()
        assert 'router = APIRouter()' in content, "Missing router definition"

    def test_lineup_reexports(self):
        """lineup.py should re-export from lineup_seats"""
        module_path = os.path.join(
            os.path.dirname(__file__), '..', 'routes', 'bookings', 'lineup.py'
        )
        with open(module_path, 'r') as f:
            content = f.read()
        assert 'from .lineup_seats import' in content, (
            "lineup.py missing re-exports from lineup_seats"
        )

    def test_bookings_init_registers_lineup_seats(self):
        """__init__.py should include lineup_seats router"""
        init_path = os.path.join(
            os.path.dirname(__file__), '..', 'routes', 'bookings', '__init__.py'
        )
        with open(init_path, 'r') as f:
            content = f.read()
        assert 'lineup_seats' in content, (
            "bookings __init__.py missing lineup_seats router"
        )


# ============ LINEUP STATUS TOGGLE ============

class TestLineupStatus:
    """POST /api/bookings/{id}/lineup/status"""

    def test_status_toggle_requires_body(self, api_client):
        """Should reject empty POST body"""
        fake_id = "test-booking-id"
        response = api_client.post(
            f"{BASE_URL}/api/bookings/{fake_id}/lineup/status"
        )
        assert response.status_code in [400, 404, 422]

    def test_status_toggle_route_exists(self, api_client):
        """Endpoint should be registered"""
        fake_id = "test-booking-id"
        response = api_client.post(
            f"{BASE_URL}/api/bookings/{fake_id}/lineup/status",
            json={"status": "open"}
        )
        assert response.status_code != 405, "POST lineup/status route not mounted"

    def test_status_invalid_value(self, api_client):
        """Should reject invalid status values"""
        fake_id = "test-booking-id"
        response = api_client.post(
            f"{BASE_URL}/api/bookings/{fake_id}/lineup/status",
            json={"status": "invalid_value"}
        )
        assert response.status_code in [400, 404]


# ============ REMOVE MEMBER ============

class TestRemoveMember:
    """POST /api/bookings/{id}/lineup/remove-member"""

    def test_remove_member_route_exists(self, api_client):
        """Endpoint should be registered"""
        fake_id = "test-booking-id"
        response = api_client.post(
            f"{BASE_URL}/api/bookings/{fake_id}/lineup/remove-member",
            json={"member_id": "fake-member"}
        )
        assert response.status_code != 405, "POST remove-member route not mounted"


# ============ RESERVATION SETTINGS ============

class TestReservationSettings:
    """PATCH/GET /api/bookings/{id}/reservation-settings"""

    def test_get_settings_nonexistent(self, api_client):
        """Non-existent booking should return 404"""
        fake_id = "00000000-0000-0000-0000-000000000000"
        response = api_client.get(
            f"{BASE_URL}/api/bookings/{fake_id}/reservation-settings"
        )
        assert response.status_code in [404, 401]

    def test_get_settings_route_exists(self, api_client):
        """GET endpoint should be registered"""
        fake_id = "test-id"
        response = api_client.get(
            f"{BASE_URL}/api/bookings/{fake_id}/reservation-settings"
        )
        assert response.status_code != 405, "GET reservation-settings not mounted"

    def test_patch_settings_route_exists(self, api_client):
        """PATCH endpoint should be registered"""
        fake_id = "test-id"
        response = api_client.patch(
            f"{BASE_URL}/api/bookings/{fake_id}/reservation-settings",
            json={"waitlist_enabled": True}
        )
        assert response.status_code != 405, "PATCH reservation-settings not mounted"
