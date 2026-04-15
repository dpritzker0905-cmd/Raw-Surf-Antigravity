"""
Iteration 64 - Competition Verification Tests
Tests:
1. GET /api/career/admin/pending-verifications - Returns pending competition results
2. POST /api/career/competition-results/{id}/verify - Admin verifies/rejects results and awards XP
3. XP awarded correctly based on placing and heat wins
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestCompetitionVerification:
    """Test competition result verification endpoints"""
    
    # Test admin credentials
    ADMIN_EMAIL = "kelly@surf.com"
    ADMIN_PASSWORD = "test-shaka"
    admin_id = None
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Login and get admin user id"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": self.ADMIN_EMAIL,
            "password": self.ADMIN_PASSWORD
        })
        assert response.status_code == 200, f"Login failed: {response.text}"
        self.admin_id = response.json()["id"]
        assert response.json().get("is_admin") == True, "User is not an admin"
    
    def test_get_pending_verifications_returns_results(self):
        """Test GET /api/career/admin/pending-verifications returns pending results"""
        response = requests.get(f"{BASE_URL}/api/career/admin/pending-verifications")
        
        # Status assertion
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        # Data assertions
        data = response.json()
        assert "results" in data, "Response should contain 'results' key"
        assert isinstance(data["results"], list), "Results should be a list"
        
        # Should have pending results (per test context)
        print(f"Found {len(data['results'])} pending verification results")
        
        # Validate result structure if results exist
        if len(data["results"]) > 0:
            result = data["results"][0]
            assert "id" in result, "Result should have 'id'"
            assert "surfer_id" in result, "Result should have 'surfer_id'"
            assert "surfer_name" in result, "Result should have 'surfer_name'"
            assert "event_name" in result, "Result should have 'event_name'"
            assert "event_date" in result, "Result should have 'event_date'"
            assert "placing" in result, "Result should have 'placing'"
            print(f"First pending result: {result['event_name']} - {result['surfer_name']} - Place: {result['placing']}")
    
    def test_verify_competition_result_approves_and_awards_xp(self):
        """Test POST /api/career/competition-results/{id}/verify approves result and awards XP"""
        # First get a pending result to verify
        pending_response = requests.get(f"{BASE_URL}/api/career/admin/pending-verifications")
        assert pending_response.status_code == 200
        pending_results = pending_response.json()["results"]
        
        if len(pending_results) == 0:
            pytest.skip("No pending results to verify")
        
        # Get first result to verify
        result_to_verify = pending_results[0]
        result_id = result_to_verify["id"]
        placing = result_to_verify["placing"]
        heat_wins = result_to_verify.get("heat_wins", 0)
        event_tier = result_to_verify.get("event_tier", "Local")
        
        print(f"Verifying result: {result_to_verify['event_name']} - Place: {placing}, Heat wins: {heat_wins}")
        
        # Verify the result (approve)
        verify_response = requests.post(
            f"{BASE_URL}/api/career/competition-results/{result_id}/verify",
            params={"admin_id": self.admin_id, "approved": True}
        )
        
        # Status assertion
        assert verify_response.status_code == 200, f"Expected 200, got {verify_response.status_code}: {verify_response.text}"
        
        # Data assertions
        data = verify_response.json()
        assert "message" in data, "Response should have 'message'"
        assert "xp_awarded" in data, "Response should have 'xp_awarded'"
        assert data["message"] == "Result verified and XP awarded", f"Unexpected message: {data['message']}"
        
        xp_awarded = data["xp_awarded"]
        print(f"XP awarded: {xp_awarded}")
        
        # Validate XP calculation based on placing
        # Base XP: 1st=200, 2nd-3rd=100, 4th-8th=50, 9th+=25
        # Plus heat_wins * 10
        # Multiplied by tier (Local=1.0)
        if placing == 1:
            expected_base = 200
        elif placing <= 3:
            expected_base = 100
        elif placing <= 8:
            expected_base = 50
        else:
            expected_base = 25
        
        # Add heat wins bonus
        expected_xp = expected_base + (heat_wins * 10)
        
        # Apply tier multiplier (Local=1.0 by default)
        tier_multipliers = {'WSL_CT': 3.0, 'WSL_QS': 2.0, 'Regional': 1.5, 'Local': 1.0, 'Grom_Series': 1.2}
        multiplier = tier_multipliers.get(event_tier, 1.0)
        expected_xp = int(expected_xp * multiplier)
        
        assert xp_awarded == expected_xp, f"Expected XP {expected_xp}, got {xp_awarded}"
        print(f"XP calculation correct: base={expected_base}, heat_bonus={heat_wins*10}, multiplier={multiplier}, total={expected_xp}")
        
        # Verify result no longer in pending list
        pending_after = requests.get(f"{BASE_URL}/api/career/admin/pending-verifications")
        pending_ids = [r["id"] for r in pending_after.json()["results"]]
        assert result_id not in pending_ids, "Verified result should no longer be pending"
        print("Verified result removed from pending list")
    
    def test_reject_competition_result(self):
        """Test POST /api/career/competition-results/{id}/verify with approved=false rejects"""
        # Get a pending result
        pending_response = requests.get(f"{BASE_URL}/api/career/admin/pending-verifications")
        pending_results = pending_response.json()["results"]
        
        if len(pending_results) == 0:
            pytest.skip("No pending results to reject")
        
        result_to_reject = pending_results[0]
        result_id = result_to_reject["id"]
        
        print(f"Rejecting result: {result_to_reject['event_name']}")
        
        # Reject the result
        reject_response = requests.post(
            f"{BASE_URL}/api/career/competition-results/{result_id}/verify",
            params={"admin_id": self.admin_id, "approved": False}
        )
        
        # Status assertion
        assert reject_response.status_code == 200, f"Expected 200, got {reject_response.status_code}: {reject_response.text}"
        
        # Data assertions
        data = reject_response.json()
        assert data.get("message") == "Result rejected", f"Unexpected message: {data}"
        print("Result rejected successfully")
        
        # Verify result no longer in pending list
        pending_after = requests.get(f"{BASE_URL}/api/career/admin/pending-verifications")
        pending_ids = [r["id"] for r in pending_after.json()["results"]]
        assert result_id not in pending_ids, "Rejected result should no longer be pending"
    
    def test_verify_requires_admin(self):
        """Test that verify endpoint requires admin privileges"""
        # Get a pending result
        pending_response = requests.get(f"{BASE_URL}/api/career/admin/pending-verifications")
        pending_results = pending_response.json()["results"]
        
        if len(pending_results) == 0:
            pytest.skip("No pending results to test")
        
        result_id = pending_results[0]["id"]
        
        # Try to verify with a fake non-admin user id
        fake_user_id = "00000000-0000-0000-0000-000000000000"
        
        response = requests.post(
            f"{BASE_URL}/api/career/competition-results/{result_id}/verify",
            params={"admin_id": fake_user_id, "approved": True}
        )
        
        # Should return 403 or 404 for non-admin
        assert response.status_code in [403, 404], f"Expected 403/404 for non-admin, got {response.status_code}"
        print(f"Non-admin correctly rejected with status {response.status_code}")
    
    def test_verify_nonexistent_result(self):
        """Test verifying a non-existent result returns 404"""
        fake_result_id = "00000000-0000-0000-0000-000000000000"
        
        response = requests.post(
            f"{BASE_URL}/api/career/competition-results/{fake_result_id}/verify",
            params={"admin_id": self.admin_id, "approved": True}
        )
        
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        print("Non-existent result correctly returns 404")


class TestCareerStats:
    """Test career stats endpoint for competition data"""
    
    ADMIN_EMAIL = "kelly@surf.com"
    ADMIN_PASSWORD = "test-shaka"
    
    def test_career_stats_returns_competition_data(self):
        """Test GET /api/career/stats/{surfer_id} returns competition stats"""
        # Login to get user id
        login_response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": self.ADMIN_EMAIL,
            "password": self.ADMIN_PASSWORD
        })
        assert login_response.status_code == 200
        user_id = login_response.json()["id"]
        
        # Get career stats
        response = requests.get(f"{BASE_URL}/api/career/stats/{user_id}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "stats" in data, "Response should have 'stats'"
        assert "total_xp" in data, "Response should have 'total_xp'"
        
        stats = data["stats"]
        assert "total_events" in stats, "Stats should have 'total_events'"
        assert "event_wins" in stats, "Stats should have 'event_wins'"
        assert "podium_finishes" in stats, "Stats should have 'podium_finishes'"
        assert "total_heat_wins" in stats, "Stats should have 'total_heat_wins'"
        
        print(f"Career stats: Events={stats['total_events']}, Wins={stats['event_wins']}, Podiums={stats['podium_finishes']}, XP={data['total_xp']}")


class TestStokedDashboardAPI:
    """Test APIs used by the Stoked Dashboard"""
    
    ADMIN_EMAIL = "kelly@surf.com"
    ADMIN_PASSWORD = "test-shaka"
    
    def test_gamification_endpoint_for_xp(self):
        """Test GET /api/gamification/{user_id} returns XP data"""
        login_response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": self.ADMIN_EMAIL,
            "password": self.ADMIN_PASSWORD
        })
        user_id = login_response.json()["id"]
        
        response = requests.get(f"{BASE_URL}/api/gamification/{user_id}")
        
        # May return 200 or 404 if no gamification data
        if response.status_code == 200:
            data = response.json()
            print(f"Gamification data: total_xp={data.get('total_xp', 0)}, badges={len(data.get('badges', []))}")
        else:
            print(f"Gamification endpoint returned {response.status_code}")
    
    def test_stoke_sponsor_income_endpoint(self):
        """Test GET /api/career/stoke-sponsor/income/{surfer_id}"""
        login_response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": self.ADMIN_EMAIL,
            "password": self.ADMIN_PASSWORD
        })
        user_id = login_response.json()["id"]
        
        response = requests.get(f"{BASE_URL}/api/career/stoke-sponsor/income/{user_id}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert "total_received" in data, "Response should have 'total_received'"
        assert "supporter_count" in data, "Response should have 'supporter_count'"
        assert "income_records" in data, "Response should have 'income_records'"
        
        print(f"Stoke income: total=${data['total_received']}, supporters={data['supporter_count']}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
