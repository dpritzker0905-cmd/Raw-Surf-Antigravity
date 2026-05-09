"""
test_moderation_reports.py — v89 Endpoint Contract Tests

Validates the moderation_reports.py module extracted during v88 decomposition.
Covers:
  - GET  /api/admin/payout-holds           (list payout holds)
  - POST /api/admin/payout-holds           (create hold)
  - POST /api/admin/payout-holds/{id}/release (release hold)
  - GET  /api/admin/audit-logs             (audit log listing)
  - GET  /api/admin/audit-logs/stats       (audit stats)
  - POST /api/reports/submit               (user report submission)
  - POST /api/disputes/submit              (user dispute submission)
  - GET  /api/disputes/my-disputes         (user dispute history)
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
def admin_auth(api_client):
    """Login as admin and return auth headers + user data"""
    response = api_client.post(f"{BASE_URL}/api/auth/login", json={
        "email": ADMIN_EMAIL, "password": ADMIN_PASSWORD
    })
    if response.status_code == 200:
        data = response.json()
        token = data.get("access_token") or data.get("token")
        user = data if "id" in data else data.get("user")
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        return {"user": user, "headers": headers}
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


# ============ PAYOUT HOLDS (ADMIN) ============

class TestPayoutHolds:
    """Admin payout hold management endpoints"""

    def test_get_payout_holds(self, api_client, admin_auth):
        """GET /api/admin/payout-holds — should return holds list"""
        response = api_client.get(
            f"{BASE_URL}/api/admin/payout-holds",
            headers=admin_auth["headers"]
        )
        assert response.status_code == 200, (
            f"Expected 200, got {response.status_code}: {response.text}"
        )
        data = response.json()
        assert "holds" in data, "Response must contain 'holds' key"
        assert "total_held_amount" in data, "Response must contain 'total_held_amount'"
        assert isinstance(data["holds"], list)

    def test_create_payout_hold_missing_photographer(self, api_client, admin_auth):
        """POST /api/admin/payout-holds — non-existent photographer returns 404"""
        response = api_client.post(
            f"{BASE_URL}/api/admin/payout-holds",
            headers=admin_auth["headers"],
            json={
                "photographer_id": "00000000-0000-0000-0000-000000000000",
                "amount": 50.00,
                "reason": "test_hold"
            }
        )
        assert response.status_code == 404, (
            f"Expected 404 for fake photographer, got {response.status_code}"
        )

    def test_release_nonexistent_hold(self, api_client, admin_auth):
        """POST /api/admin/payout-holds/{id}/release — non-existent hold returns 404"""
        response = api_client.post(
            f"{BASE_URL}/api/admin/payout-holds/00000000-0000-0000-0000-000000000000/release",
            headers=admin_auth["headers"],
            json={"release_notes": "test release"}
        )
        assert response.status_code == 404


# ============ AUDIT LOGS (ADMIN) ============

class TestAuditLogs:
    """Admin audit log viewing endpoints"""

    def test_get_audit_logs(self, api_client, admin_auth):
        """GET /api/admin/audit-logs — should return logs list"""
        response = api_client.get(
            f"{BASE_URL}/api/admin/audit-logs",
            headers=admin_auth["headers"]
        )
        assert response.status_code == 200
        data = response.json()
        assert "logs" in data, "Response must contain 'logs' key"
        assert isinstance(data["logs"], list)

    def test_audit_logs_filter_by_category(self, api_client, admin_auth):
        """GET /api/admin/audit-logs?category=financial — category filter"""
        response = api_client.get(
            f"{BASE_URL}/api/admin/audit-logs",
            headers=admin_auth["headers"],
            params={"category": "financial"}
        )
        assert response.status_code == 200

    def test_audit_log_stats(self, api_client, admin_auth):
        """GET /api/admin/audit-logs/stats — should return stats summary"""
        response = api_client.get(
            f"{BASE_URL}/api/admin/audit-logs/stats",
            headers=admin_auth["headers"]
        )
        assert response.status_code == 200
        data = response.json()
        assert "period_days" in data
        assert "by_category" in data
        assert "total_admin_actions" in data


# ============ USER-FACING REPORTS ============

class TestUserReports:
    """User-facing report submission endpoints"""

    def test_submit_report_missing_reporter(self, api_client):
        """POST /api/reports/submit — non-existent reporter returns 404"""
        response = api_client.post(
            f"{BASE_URL}/api/reports/submit",
            json={
                "reporter_id": "00000000-0000-0000-0000-000000000000",
                "report_type": "harassment",
                "reason": "test report"
            }
        )
        assert response.status_code == 404

    def test_submit_report_valid(self, api_client, regular_user):
        """POST /api/reports/submit — valid report returns 200 with id"""
        response = api_client.post(
            f"{BASE_URL}/api/reports/submit",
            json={
                "reporter_id": regular_user.get("id"),
                "report_type": "content",
                "reason": "inappropriate_content",
                "description": "Test report from v89 contract tests"
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert "id" in data, "Response must contain report 'id'"
        assert data.get("status") == "submitted"


# ============ USER-FACING DISPUTES ============

class TestUserDisputes:
    """User-facing dispute submission and history"""

    def test_submit_dispute_missing_complainant(self, api_client):
        """POST /api/disputes/submit — non-existent user returns 404"""
        response = api_client.post(
            f"{BASE_URL}/api/disputes/submit",
            json={
                "complainant_id": "00000000-0000-0000-0000-000000000000",
                "dispute_type": "payment",
                "subject": "Test dispute",
                "description": "Test description"
            }
        )
        assert response.status_code == 404

    def test_submit_dispute_valid(self, api_client, regular_user):
        """POST /api/disputes/submit — valid dispute returns 200"""
        response = api_client.post(
            f"{BASE_URL}/api/disputes/submit",
            json={
                "complainant_id": regular_user.get("id"),
                "dispute_type": "service_quality",
                "subject": "v89 Contract Test Dispute",
                "description": "Test dispute from automated v89 contract tests"
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert "id" in data
        assert data.get("status") == "submitted"

    def test_get_my_disputes(self, api_client, regular_user):
        """GET /api/disputes/my-disputes — returns dispute list"""
        user_id = regular_user.get("id")
        response = api_client.get(
            f"{BASE_URL}/api/disputes/my-disputes",
            params={"user_id": user_id}
        )
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list), "my-disputes should return a list"


# ============ ROUTER HEALTH ============

class TestModerationReportsRouterHealth:
    """Verify all moderation_reports endpoints are mounted"""

    def test_all_endpoints_reachable(self, api_client, admin_auth, regular_user):
        """Smoke test: all endpoints respond (not 405 Method Not Allowed)"""
        fake_id = "00000000-0000-0000-0000-000000000000"
        endpoints = [
            ("GET", f"/api/admin/payout-holds", admin_auth["headers"]),
            ("GET", f"/api/admin/audit-logs", admin_auth["headers"]),
            ("GET", f"/api/admin/audit-logs/stats", admin_auth["headers"]),
            ("GET", f"/api/disputes/my-disputes?user_id={regular_user.get('id')}", {}),
        ]
        for method, path, headers in endpoints:
            r = api_client.get(f"{BASE_URL}{path}", headers=headers)
            assert r.status_code != 405, (
                f"{method} {path} returned 405 — endpoint not mounted"
            )
