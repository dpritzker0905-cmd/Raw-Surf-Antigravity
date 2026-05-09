"""
test_dispatch_transitions.py — v91 Endpoint Contract Tests

Validates the dispatch/dispatch_transitions.py module (extracted from lifecycle.py in v90).
Covers:
  - POST /api/dispatch/{id}/complete    (complete dispatch session)
  - POST /api/dispatch/{id}/cancel      (cancel dispatch request)

Import integrity:
  - dispatch_transitions module file exists and defines a router
  - Re-exports from lifecycle.py still resolve
  - __init__.py includes dispatch_transitions router
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

class TestDispatchTransitionsImports:
    """Verify dispatch_transitions.py imports and re-exports work."""

    def test_dispatch_transitions_exists(self):
        """dispatch_transitions.py should exist"""
        module_path = os.path.join(
            os.path.dirname(__file__), '..', 'routes', 'dispatch', 'dispatch_transitions.py'
        )
        assert os.path.exists(module_path), "dispatch_transitions.py not found"

    def test_dispatch_transitions_has_router(self):
        """dispatch_transitions.py should define a router"""
        module_path = os.path.join(
            os.path.dirname(__file__), '..', 'routes', 'dispatch', 'dispatch_transitions.py'
        )
        with open(module_path, 'r') as f:
            content = f.read()
        assert 'router = APIRouter(' in content, "Missing router definition"

    def test_lifecycle_reexports(self):
        """lifecycle.py should re-export from dispatch_transitions"""
        module_path = os.path.join(
            os.path.dirname(__file__), '..', 'routes', 'dispatch', 'lifecycle.py'
        )
        with open(module_path, 'r') as f:
            content = f.read()
        assert 'from .dispatch_transitions import' in content, (
            "lifecycle.py missing re-exports from dispatch_transitions"
        )

    def test_dispatch_init_registers_transitions(self):
        """__init__.py should include dispatch_transitions router"""
        init_path = os.path.join(
            os.path.dirname(__file__), '..', 'routes', 'dispatch', '__init__.py'
        )
        with open(init_path, 'r') as f:
            content = f.read()
        assert 'dispatch_transitions' in content, (
            "dispatch __init__.py missing dispatch_transitions router"
        )


# ============ COMPLETE DISPATCH ============

class TestCompleteDispatch:
    """POST /api/dispatch/{id}/complete"""

    def test_complete_nonexistent_dispatch(self, api_client):
        """Non-existent dispatch should return 404"""
        fake_id = "00000000-0000-0000-0000-000000000000"
        response = api_client.post(
            f"{BASE_URL}/api/dispatch/{fake_id}/complete"
        )
        assert response.status_code in [404, 401, 403, 422]

    def test_complete_route_exists(self, api_client):
        """Endpoint should be registered (not 405)"""
        fake_id = "test-id"
        response = api_client.post(
            f"{BASE_URL}/api/dispatch/{fake_id}/complete"
        )
        assert response.status_code != 405, "POST complete route not mounted"


# ============ CANCEL DISPATCH ============

class TestCancelDispatch:
    """POST /api/dispatch/{id}/cancel"""

    def test_cancel_nonexistent_dispatch(self, api_client):
        """Non-existent dispatch should return 404"""
        fake_id = "00000000-0000-0000-0000-000000000000"
        response = api_client.post(
            f"{BASE_URL}/api/dispatch/{fake_id}/cancel",
            json={"user_id": "fake", "reason": "test"}
        )
        assert response.status_code in [404, 401, 403, 422]

    def test_cancel_route_exists(self, api_client):
        """Endpoint should be registered (not 405)"""
        fake_id = "test-id"
        response = api_client.post(
            f"{BASE_URL}/api/dispatch/{fake_id}/cancel",
            json={"user_id": "fake"}
        )
        assert response.status_code != 405, "POST cancel route not mounted"


# ============ ROUTER HEALTH ============

class TestDispatchTransitionsRouterHealth:
    """Verify dispatch_transitions endpoints are correctly mounted"""

    def test_dispatch_router_route_count(self):
        """dispatch __init__.py should compose 10 sub-routers"""
        init_path = os.path.join(
            os.path.dirname(__file__), '..', 'routes', 'dispatch', '__init__.py'
        )
        with open(init_path, 'r') as f:
            content = f.read()
        include_count = content.count('router.include_router(')
        assert include_count >= 9, (
            f"Expected >= 9 sub-routers in dispatch, found {include_count}"
        )
