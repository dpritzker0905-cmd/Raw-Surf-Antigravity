"""
Career Hub & Stoke Sponsor API Tests - Iteration 61
Tests for Tiered Career Hubs (The Peak, The Inside) and Stoke Sponsor system

Features tested:
- Career Stats API: GET /api/career/stats/{user_id}
- Competition Results: GET /api/career/competition-results/{user_id}
- Competition Results POST: POST /api/career/competition-results
- Sponsorships: GET /api/career/sponsorships/{user_id}
- Stoke Sponsor eligible surfers: GET /api/career/stoke-sponsor/eligible-surfers
- Stoke Sponsor income: GET /api/career/stoke-sponsor/income/{user_id}
- Stoke Sponsor contributions: GET /api/career/stoke-sponsor/my-contributions/{user_id}
"""
import pytest
import requests
import os
from datetime import date

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials
ADMIN_EMAIL = "kelly@surf.com"
ADMIN_PASSWORD = "test-shaka"
REGULAR_EMAIL = "sarah@waters.com"
REGULAR_PASSWORD = "test-shaka"


@pytest.fixture(scope="module")
def api_client():
    """Shared requests session"""
    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})
    return session


@pytest.fixture(scope="module")
def admin_user(api_client):
    """Login as admin user and return user data"""
    response = api_client.post(f"{BASE_URL}/api/auth/login", json={
        "email": ADMIN_EMAIL,
        "password": ADMIN_PASSWORD
    })
    if response.status_code == 200:
        data = response.json()
        # Login returns user object directly (not wrapped in "user" key)
        return data if "id" in data else data.get("user")
    pytest.skip(f"Admin login failed: {response.status_code}")


@pytest.fixture(scope="module")
def regular_user(api_client):
    """Login as regular user and return user data"""
    response = api_client.post(f"{BASE_URL}/api/auth/login", json={
        "email": REGULAR_EMAIL,
        "password": REGULAR_PASSWORD
    })
    if response.status_code == 200:
        data = response.json()
        # Login returns user object directly (not wrapped in "user" key)
        return data if "id" in data else data.get("user")
    pytest.skip(f"Regular user login failed: {response.status_code}")


class TestCareerStats:
    """Tests for Career Stats API endpoint"""
    
    def test_get_career_stats_valid_user(self, api_client, admin_user):
        """GET /api/career/stats/{user_id} - should return career stats for valid user"""
        user_id = admin_user.get("id")
        response = api_client.get(f"{BASE_URL}/api/career/stats/{user_id}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "surfer_id" in data, "Response should contain surfer_id"
        assert "stats" in data, "Response should contain stats object"
        assert "total_xp" in data, "Response should contain total_xp"
        assert data["surfer_id"] == user_id
        
        # Verify stats structure
        stats = data.get("stats", {})
        expected_keys = ["total_events", "event_wins", "podium_finishes", "total_heat_wins"]
        for key in expected_keys:
            assert key in stats, f"Stats should contain {key}"
    
    def test_get_career_stats_invalid_user(self, api_client):
        """GET /api/career/stats/{user_id} - should return 404 for non-existent user"""
        fake_user_id = "00000000-0000-0000-0000-000000000000"
        response = api_client.get(f"{BASE_URL}/api/career/stats/{fake_user_id}")
        
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"


class TestCompetitionResults:
    """Tests for Competition Results API endpoints"""
    
    def test_get_competition_results(self, api_client, admin_user):
        """GET /api/career/competition-results/{user_id} - should return results list"""
        user_id = admin_user.get("id")
        response = api_client.get(f"{BASE_URL}/api/career/competition-results/{user_id}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "results" in data, "Response should contain results array"
        assert isinstance(data["results"], list), "Results should be a list"
    
    def test_add_competition_result(self, api_client, admin_user):
        """POST /api/career/competition-results - should create a new competition result"""
        user_id = admin_user.get("id")
        
        result_data = {
            "event_name": "TEST_Pipeline Masters 2025",
            "event_date": str(date.today()),
            "event_location": "Pipeline, Oahu",
            "event_tier": "Local",
            "placing": 3,
            "total_competitors": 32,
            "heat_wins": 2,
            "avg_wave_score": 7.5,
            "season_points_earned": 100
        }
        
        response = api_client.post(
            f"{BASE_URL}/api/career/competition-results?surfer_id={user_id}",
            json=result_data
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "message" in data, "Response should contain message"
        assert "id" in data, "Response should contain result id"
        assert data.get("status") == "pending", "New result should be pending verification"
    
    def test_add_competition_result_with_missing_fields(self, api_client, admin_user):
        """POST /api/career/competition-results - test with minimal required fields"""
        user_id = admin_user.get("id")
        
        minimal_data = {
            "event_name": "TEST_Mini Comp",
            "event_date": str(date.today()),
            "placing": 1
        }
        
        response = api_client.post(
            f"{BASE_URL}/api/career/competition-results?surfer_id={user_id}",
            json=minimal_data
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"


class TestSponsorships:
    """Tests for Sponsorships API endpoints"""
    
    def test_get_sponsorships(self, api_client, admin_user):
        """GET /api/career/sponsorships/{user_id} - should return sponsorships list"""
        user_id = admin_user.get("id")
        response = api_client.get(f"{BASE_URL}/api/career/sponsorships/{user_id}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "sponsorships" in data, "Response should contain sponsorships array"
        assert isinstance(data["sponsorships"], list), "Sponsorships should be a list"
    
    def test_add_sponsorship(self, api_client, admin_user):
        """POST /api/career/sponsorships - should create a new sponsorship"""
        user_id = admin_user.get("id")
        
        sponsor_data = {
            "sponsor_name": "TEST_Local Surf Shop",
            "sponsor_type": "local_shop",
            "sponsorship_tier": "supporting"
        }
        
        response = api_client.post(
            f"{BASE_URL}/api/career/sponsorships?surfer_id={user_id}",
            json=sponsor_data
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "message" in data, "Response should contain message"
        assert "id" in data, "Response should contain sponsorship id"
    
    def test_get_sponsorships_includes_all_active(self, api_client, admin_user):
        """GET /api/career/sponsorships/{user_id} - should include active_only param"""
        user_id = admin_user.get("id")
        
        # Get active only (default)
        response = api_client.get(f"{BASE_URL}/api/career/sponsorships/{user_id}?active_only=true")
        assert response.status_code == 200
        
        # Get all including inactive
        response = api_client.get(f"{BASE_URL}/api/career/sponsorships/{user_id}?active_only=false")
        assert response.status_code == 200


class TestStokeSponsorSystem:
    """Tests for Stoke Sponsor System - Photographers supporting Surfers"""
    
    def test_get_eligible_surfers(self, api_client, admin_user):
        """GET /api/career/stoke-sponsor/eligible-surfers - should return list of surfers"""
        user_id = admin_user.get("id")
        response = api_client.get(f"{BASE_URL}/api/career/stoke-sponsor/eligible-surfers?photographer_id={user_id}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "eligible_surfers" in data, "Response should contain eligible_surfers array"
        assert isinstance(data["eligible_surfers"], list), "Eligible surfers should be a list"
        
        # If there are surfers, verify structure
        if len(data["eligible_surfers"]) > 0:
            surfer = data["eligible_surfers"][0]
            assert "id" in surfer, "Surfer should have id"
            assert "full_name" in surfer, "Surfer should have full_name"
    
    def test_get_eligible_surfers_with_tier_filter(self, api_client, admin_user):
        """GET /api/career/stoke-sponsor/eligible-surfers - test tier filtering"""
        user_id = admin_user.get("id")
        
        # Test various tier filters
        for tier in ['grom_rising', 'competitive', 'pro_elite']:
            response = api_client.get(
                f"{BASE_URL}/api/career/stoke-sponsor/eligible-surfers?photographer_id={user_id}&tier_filter={tier}"
            )
            assert response.status_code == 200, f"Tier filter {tier} should work"
    
    def test_get_stoke_sponsor_income(self, api_client, admin_user):
        """GET /api/career/stoke-sponsor/income/{user_id} - should return income records"""
        user_id = admin_user.get("id")
        response = api_client.get(f"{BASE_URL}/api/career/stoke-sponsor/income/{user_id}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "total_received" in data, "Response should contain total_received"
        assert "supporter_count" in data, "Response should contain supporter_count"
        assert "income_records" in data, "Response should contain income_records array"
    
    def test_get_photographer_contributions(self, api_client, admin_user):
        """GET /api/career/stoke-sponsor/my-contributions/{user_id} - should return contributions"""
        user_id = admin_user.get("id")
        response = api_client.get(f"{BASE_URL}/api/career/stoke-sponsor/my-contributions/{user_id}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "total_contributed" in data, "Response should contain total_contributed"
        assert "contribution_count" in data, "Response should contain contribution_count"
        assert "contributions" in data, "Response should contain contributions array"


class TestElitePhotographers:
    """Tests for Elite Photographers endpoint"""
    
    def test_get_elite_photographers(self, api_client):
        """GET /api/career/elite-photographers - should return photographer list"""
        response = api_client.get(f"{BASE_URL}/api/career/elite-photographers")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "elite_photographers" in data, "Response should contain elite_photographers array"


class TestGoldPassSlots:
    """Tests for Gold Pass booking slots"""
    
    def test_get_gold_pass_available_slots(self, api_client, admin_user):
        """GET /api/career/gold-pass/available - should return available slots"""
        user_id = admin_user.get("id")
        response = api_client.get(f"{BASE_URL}/api/career/gold-pass/available?surfer_id={user_id}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "is_elite" in data, "Response should indicate elite status"
        assert "slots" in data, "Response should contain slots array"


class TestHealthCheck:
    """Basic health check for career API router"""
    
    def test_career_api_router_accessible(self, api_client, admin_user):
        """Verify career API router is properly mounted and accessible"""
        user_id = admin_user.get("id")
        
        # Test multiple endpoints to confirm router is working
        endpoints = [
            f"/api/career/stats/{user_id}",
            f"/api/career/competition-results/{user_id}",
            f"/api/career/sponsorships/{user_id}",
        ]
        
        for endpoint in endpoints:
            response = api_client.get(f"{BASE_URL}{endpoint}")
            assert response.status_code == 200, f"Endpoint {endpoint} should be accessible"
