"""
test_message_threads.py — v91 Endpoint Contract Tests
Validates messages/message_threads.py (extracted from conversations.py in v90).
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


class TestMessageThreadsImports:
    def test_message_threads_exists(self):
        path = os.path.join(os.path.dirname(__file__), '..', 'routes', 'messages', 'message_threads.py')
        assert os.path.exists(path)

    def test_has_router(self):
        path = os.path.join(os.path.dirname(__file__), '..', 'routes', 'messages', 'message_threads.py')
        with open(path) as f:
            assert 'router = APIRouter()' in f.read()

    def test_conversations_reexports(self):
        path = os.path.join(os.path.dirname(__file__), '..', 'routes', 'messages', 'conversations.py')
        with open(path) as f:
            assert 'from .message_threads import' in f.read()

    def test_init_registers(self):
        path = os.path.join(os.path.dirname(__file__), '..', 'routes', 'messages', '__init__.py')
        with open(path) as f:
            assert 'message_threads' in f.read()


class TestGromZone:
    def test_route_exists(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/messages/grom-zone/available-groms/test-id")
        assert r.status_code != 405

    def test_family_members_route(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/messages/grom-zone/family-members/test-id")
        assert r.status_code != 405


class TestFamilyConversations:
    def test_route_exists(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/messages/conversations/test-id/family")
        assert r.status_code != 405


class TestStartConversation:
    def test_route_exists(self, api_client):
        r = api_client.post(f"{BASE_URL}/api/messages/start-conversation", params={"sender_id": "a", "recipient_id": "b"})
        assert r.status_code != 405


class TestDeclineMessage:
    def test_route_exists(self, api_client):
        r = api_client.post(f"{BASE_URL}/api/messages/decline/test-id", params={"user_id": "a"})
        assert r.status_code != 405
