"""
Test Crew Leaderboard API Endpoints - Iteration 192
Tests for:
- GET /api/crew/leaderboard - Get leaderboard with metric filter
- GET /api/users/{id}/crew-summary - Get user crew statistics
- PUT /api/crew/{hash}/settings - Update crew privacy
- POST /api/crew/update-stats - Trigger stats update after booking
"""

import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')


class TestCrewLeaderboardEndpoints:
    """Test Crew Leaderboard API endpoints"""
    
    def test_get_leaderboard_default_metric(self):
        """Test GET /api/crew/leaderboard with default metric (total_sessions)"""
        response = requests.get(f"{BASE_URL}/api/crew/leaderboard")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "leaderboard" in data, "Response should contain 'leaderboard' key"
        assert "metric" in data, "Response should contain 'metric' key"
        assert "total_crews" in data, "Response should contain 'total_crews' key"
        assert data["metric"] == "total_sessions", "Default metric should be total_sessions"
        
        # Leaderboard should be a list
        assert isinstance(data["leaderboard"], list), "Leaderboard should be a list"
        print(f"✓ Leaderboard returned {len(data['leaderboard'])} crews with metric: {data['metric']}")
    
    def test_get_leaderboard_money_saved_metric(self):
        """Test GET /api/crew/leaderboard with total_money_saved metric"""
        response = requests.get(f"{BASE_URL}/api/crew/leaderboard?metric=total_money_saved")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data["metric"] == "total_money_saved", "Metric should be total_money_saved"
        print(f"✓ Leaderboard with money_saved metric returned {len(data['leaderboard'])} crews")
    
    def test_get_leaderboard_current_streak_metric(self):
        """Test GET /api/crew/leaderboard with current_streak metric"""
        response = requests.get(f"{BASE_URL}/api/crew/leaderboard?metric=current_streak")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data["metric"] == "current_streak", "Metric should be current_streak"
        print(f"✓ Leaderboard with current_streak metric returned {len(data['leaderboard'])} crews")
    
    def test_get_leaderboard_with_limit(self):
        """Test GET /api/crew/leaderboard with custom limit"""
        response = requests.get(f"{BASE_URL}/api/crew/leaderboard?limit=5")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert len(data["leaderboard"]) <= 5, "Leaderboard should respect limit parameter"
        print(f"✓ Leaderboard with limit=5 returned {len(data['leaderboard'])} crews")
    
    def test_get_leaderboard_with_min_crew_size(self):
        """Test GET /api/crew/leaderboard with min_crew_size filter"""
        response = requests.get(f"{BASE_URL}/api/crew/leaderboard?min_crew_size=3")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        # All crews should have at least 3 members
        for entry in data["leaderboard"]:
            if "crew_size" in entry:
                assert entry["crew_size"] >= 3, f"Crew size should be >= 3, got {entry['crew_size']}"
        print(f"✓ Leaderboard with min_crew_size=3 returned {len(data['leaderboard'])} crews")
    
    def test_get_leaderboard_entry_structure(self):
        """Test that leaderboard entries have correct structure"""
        response = requests.get(f"{BASE_URL}/api/crew/leaderboard?limit=1")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        if len(data["leaderboard"]) > 0:
            entry = data["leaderboard"][0]
            # Check required fields
            assert "rank" in entry, "Entry should have 'rank'"
            assert "crew_id" in entry, "Entry should have 'crew_id'"
            assert "members" in entry, "Entry should have 'members'"
            assert "metric_value" in entry, "Entry should have 'metric_value'"
            assert "metric_name" in entry, "Entry should have 'metric_name'"
            print(f"✓ Leaderboard entry structure is correct: rank={entry['rank']}, metric_value={entry['metric_value']}")
        else:
            print("✓ Leaderboard is empty (no crews yet)")


class TestUserCrewSummary:
    """Test User Crew Summary endpoint"""
    
    @pytest.fixture
    def test_user_id(self):
        """Get a test user ID from profiles"""
        response = requests.get(f"{BASE_URL}/api/profiles?limit=1")
        if response.status_code == 200:
            profiles = response.json()
            if isinstance(profiles, list) and len(profiles) > 0:
                return profiles[0].get("id")
            elif isinstance(profiles, dict) and "profiles" in profiles and len(profiles["profiles"]) > 0:
                return profiles["profiles"][0].get("id")
        return None
    
    def test_get_user_crew_summary(self, test_user_id):
        """Test GET /api/users/{id}/crew-summary"""
        if not test_user_id:
            pytest.skip("No test user available")
        
        response = requests.get(f"{BASE_URL}/api/users/{test_user_id}/crew-summary")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        # Check required fields
        assert "user_id" in data, "Response should contain 'user_id'"
        assert "total_crew_sessions" in data, "Response should contain 'total_crew_sessions'"
        assert "total_unique_buddies" in data, "Response should contain 'total_unique_buddies'"
        assert "total_saved_via_splits" in data, "Response should contain 'total_saved_via_splits'"
        assert "badges" in data, "Response should contain 'badges'"
        assert "top_crews" in data, "Response should contain 'top_crews'"
        
        # Validate data types
        assert isinstance(data["total_crew_sessions"], int), "total_crew_sessions should be int"
        assert isinstance(data["total_unique_buddies"], int), "total_unique_buddies should be int"
        assert isinstance(data["total_saved_via_splits"], (int, float)), "total_saved_via_splits should be numeric"
        assert isinstance(data["badges"], list), "badges should be a list"
        assert isinstance(data["top_crews"], list), "top_crews should be a list"
        
        print(f"✓ User crew summary: sessions={data['total_crew_sessions']}, buddies={data['total_unique_buddies']}, saved=${data['total_saved_via_splits']}")
    
    def test_get_user_crew_summary_invalid_user(self):
        """Test GET /api/users/{id}/crew-summary with invalid user ID"""
        fake_user_id = "00000000-0000-0000-0000-000000000000"
        response = requests.get(f"{BASE_URL}/api/users/{fake_user_id}/crew-summary")
        
        # Should return 200 with empty/default stats (not 404)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data["total_crew_sessions"] == 0, "New user should have 0 crew sessions"
        print("✓ Invalid user returns empty crew summary")


class TestCrewSettings:
    """Test Crew Settings endpoint"""
    
    def test_update_crew_settings_not_found(self):
        """Test PUT /api/crew/{hash}/settings with non-existent crew"""
        fake_hash = "nonexistent_crew_hash_12345"
        response = requests.put(
            f"{BASE_URL}/api/crew/{fake_hash}/settings?user_id=test_user",
            json={"is_public": False}
        )
        
        assert response.status_code == 404, f"Expected 404, got {response.status_code}: {response.text}"
        print("✓ Non-existent crew returns 404")


class TestCrewStatsUpdate:
    """Test Crew Stats Update endpoint"""
    
    def test_update_stats_booking_not_found(self):
        """Test POST /api/crew/update-stats with non-existent booking"""
        fake_booking_id = "00000000-0000-0000-0000-000000000000"
        response = requests.post(
            f"{BASE_URL}/api/crew/update-stats?booking_id={fake_booking_id}"
        )
        
        assert response.status_code == 404, f"Expected 404, got {response.status_code}: {response.text}"
        print("✓ Non-existent booking returns 404")


class TestCrewStatsDetail:
    """Test Crew Stats Detail endpoint"""
    
    def test_get_crew_stats_not_found(self):
        """Test GET /api/crew/stats/{hash} with non-existent crew"""
        fake_hash = "nonexistent_crew_hash_12345"
        response = requests.get(f"{BASE_URL}/api/crew/stats/{fake_hash}")
        
        assert response.status_code == 404, f"Expected 404, got {response.status_code}: {response.text}"
        print("✓ Non-existent crew stats returns 404")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
