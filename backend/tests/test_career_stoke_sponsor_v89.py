"""
test_career_stoke_sponsor_v89.py — v89 Endpoint Contract Tests

Validates the career_stoke_sponsor.py module extracted during v88 decomposition.
Covers:
  - POST /api/career/stoke-sponsor/contribute    (contribution + XP award)
  - GET  /api/career/stoke-sponsor/eligible-surfers (eligible surfer listing)
  - GET  /api/career/stoke-sponsor/my-contributions/{id} (photographer history)
  - GET  /api/career/stoke-sponsor/income/{id}    (surfer income history)
  - GET  /api/career/stoke-sponsor/leaderboard    (leaderboard)
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


# ============ ELIGIBLE SURFERS ============

class TestEligibleSurfers:
    """GET /api/career/stoke-sponsor/eligible-surfers"""

    def test_get_eligible_surfers(self, api_client, admin_user):
        """Should return eligible surfers list for photographer"""
        user_id = admin_user.get("id")
        response = api_client.get(
            f"{BASE_URL}/api/career/stoke-sponsor/eligible-surfers",
            params={"photographer_id": user_id}
        )
        assert response.status_code == 200
        data = response.json()
        assert "eligible_surfers" in data
        assert isinstance(data["eligible_surfers"], list)

    def test_eligible_surfers_tier_filter(self, api_client, admin_user):
        """Should support tier_filter parameter"""
        user_id = admin_user.get("id")
        for tier in ['grom_rising', 'competitive', 'pro_elite']:
            response = api_client.get(
                f"{BASE_URL}/api/career/stoke-sponsor/eligible-surfers",
                params={"photographer_id": user_id, "tier_filter": tier}
            )
            assert response.status_code == 200, (
                f"Tier filter '{tier}' should work, got {response.status_code}"
            )


# ============ CONTRIBUTIONS ============

class TestContributions:
    """POST /api/career/stoke-sponsor/contribute"""

    def test_contribute_insufficient_credits(self, api_client, admin_user, regular_user):
        """Contribution with insufficient credits should fail gracefully"""
        response = api_client.post(
            f"{BASE_URL}/api/career/stoke-sponsor/contribute",
            params={"photographer_id": admin_user.get("id")},
            json={
                "surfer_id": regular_user.get("id"),
                "amount": 999999.99,
                "message": "Test contribution"
            }
        )
        # Should fail with 400 (insufficient credits) or succeed if credits exist
        assert response.status_code in [200, 400], (
            f"Expected 200 or 400, got {response.status_code}: {response.text}"
        )

    def test_contribute_nonexistent_surfer(self, api_client, admin_user):
        """Contribution to non-existent surfer should return 404"""
        response = api_client.post(
            f"{BASE_URL}/api/career/stoke-sponsor/contribute",
            params={"photographer_id": admin_user.get("id")},
            json={
                "surfer_id": "00000000-0000-0000-0000-000000000000",
                "amount": 5.00,
                "message": "Test"
            }
        )
        assert response.status_code in [404, 400]


# ============ PHOTOGRAPHER CONTRIBUTIONS HISTORY ============

class TestContributionsHistory:
    """GET /api/career/stoke-sponsor/my-contributions/{user_id}"""

    def test_get_contributions(self, api_client, admin_user):
        """Should return contributions history for photographer"""
        user_id = admin_user.get("id")
        response = api_client.get(
            f"{BASE_URL}/api/career/stoke-sponsor/my-contributions/{user_id}"
        )
        assert response.status_code == 200
        data = response.json()
        assert "total_contributed" in data
        assert "contribution_count" in data
        assert "contributions" in data
        assert isinstance(data["contributions"], list)


# ============ SURFER INCOME ============

class TestSurferIncome:
    """GET /api/career/stoke-sponsor/income/{user_id}"""

    def test_get_income(self, api_client, regular_user):
        """Should return income history for surfer"""
        user_id = regular_user.get("id")
        response = api_client.get(
            f"{BASE_URL}/api/career/stoke-sponsor/income/{user_id}"
        )
        assert response.status_code == 200
        data = response.json()
        assert "total_received" in data
        assert "supporter_count" in data
        assert "income_records" in data


# ============ LEADERBOARD ============

class TestLeaderboard:
    """GET /api/career/stoke-sponsor/leaderboard"""

    def test_get_leaderboard(self, api_client):
        """Should return leaderboard data"""
        response = api_client.get(
            f"{BASE_URL}/api/career/stoke-sponsor/leaderboard"
        )
        assert response.status_code == 200

    def test_leaderboard_time_range(self, api_client):
        """Should support time_range parameter"""
        for time_range in ['week', 'month', 'all_time']:
            response = api_client.get(
                f"{BASE_URL}/api/career/stoke-sponsor/leaderboard",
                params={"time_range": time_range}
            )
            assert response.status_code == 200, (
                f"time_range={time_range} should work"
            )


# ============ ROUTER HEALTH ============

class TestStokeSponsorRouterHealth:
    """Verify all career_stoke_sponsor endpoints are mounted"""

    def test_all_endpoints_reachable(self, api_client, admin_user):
        """Smoke test: all stoke sponsor endpoints respond (not 405)"""
        user_id = admin_user.get("id")
        endpoints = [
            f"/api/career/stoke-sponsor/eligible-surfers?photographer_id={user_id}",
            f"/api/career/stoke-sponsor/my-contributions/{user_id}",
            f"/api/career/stoke-sponsor/income/{user_id}",
            f"/api/career/stoke-sponsor/leaderboard",
        ]
        for path in endpoints:
            r = api_client.get(f"{BASE_URL}{path}")
            assert r.status_code != 405, (
                f"GET {path} returned 405 — endpoint not mounted"
            )
