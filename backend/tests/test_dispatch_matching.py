"""
test_dispatch_matching.py — v91 Endpoint Contract Tests
Validates dispatch/dispatch_matching.py (extracted from sessions.py in v90).
"""
import pytest
import os
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')


@pytest.fixture(scope="module")
def api_client():
    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})
    return session


class TestDispatchMatchingImports:
    def test_dispatch_matching_exists(self):
        path = os.path.join(os.path.dirname(__file__), '..', 'routes', 'dispatch', 'dispatch_matching.py')
        assert os.path.exists(path)

    def test_has_router(self):
        path = os.path.join(os.path.dirname(__file__), '..', 'routes', 'dispatch', 'dispatch_matching.py')
        with open(path) as f:
            assert 'router = APIRouter(' in f.read()

    def test_sessions_reexports(self):
        path = os.path.join(os.path.dirname(__file__), '..', 'routes', 'dispatch', 'sessions.py')
        with open(path) as f:
            assert 'from .dispatch_matching import' in f.read()

    def test_init_registers(self):
        path = os.path.join(os.path.dirname(__file__), '..', 'routes', 'dispatch', '__init__.py')
        with open(path) as f:
            assert 'dispatch_matching' in f.read()


class TestPaymentSuccess:
    def test_payment_success_requires_params(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/dispatch/payment-success")
        assert r.status_code in [400, 422]

    def test_payment_success_route_exists(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/dispatch/payment-success", params={"session_id": "test", "dispatch_id": "test"})
        assert r.status_code != 405


class TestBackgroundTasks:
    def test_process_dispatch_notifications_defined(self):
        path = os.path.join(os.path.dirname(__file__), '..', 'routes', 'dispatch', 'dispatch_matching.py')
        with open(path) as f:
            content = f.read()
        assert 'async def process_dispatch_notifications' in content

    def test_notify_crew_members_defined(self):
        path = os.path.join(os.path.dirname(__file__), '..', 'routes', 'dispatch', 'dispatch_matching.py')
        with open(path) as f:
            content = f.read()
        assert 'async def notify_crew_members' in content
