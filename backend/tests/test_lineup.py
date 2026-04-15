"""
Test suite for The Lineup - Surf Session Lobby System
Tests the lineup endpoints: GET /lineups, POST /lineup/open, /lineup/join, /lineup/leave, /lineup/lock, /lineup/close
"""
import pytest
import requests
import os
from datetime import datetime, timedelta

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials
TEST_EMAIL = "testuser_e1@test.com"
TEST_PASSWORD = "TestPass123!"


class TestLineupEndpoints:
    """Test The Lineup - Surf Session Lobby System endpoints"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test fixtures"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        
    def get_user_id(self):
        """Helper to login and get user ID"""
        response = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": TEST_EMAIL,
            "password": TEST_PASSWORD
        })
        if response.status_code == 200:
            data = response.json()
            # Login returns user directly, not wrapped in "user" object
            return data.get("id")
        return None
        
    def test_01_get_lineups_returns_array(self):
        """GET /api/bookings/lineups - should return array (empty if no lineups)"""
        user_id = self.get_user_id()
        if not user_id:
            pytest.skip("Login failed")
        
        response = self.session.get(f"{BASE_URL}/api/bookings/lineups", params={
            "user_id": user_id
        })
        
        print(f"GET /api/bookings/lineups status: {response.status_code}")
        print(f"Response: {response.text[:500] if response.text else 'empty'}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert isinstance(data, list), "Response should be a list"
        print(f"Lineups count: {len(data)}")
    
    def test_02_open_lineup_requires_valid_booking(self):
        """POST /api/bookings/{id}/lineup/open - should fail with invalid booking ID"""
        user_id = self.get_user_id()
        if not user_id:
            pytest.skip("Login failed")
        
        response = self.session.post(
            f"{BASE_URL}/api/bookings/fake-booking-id/lineup/open",
            params={"user_id": user_id},
            json={"visibility": "friends", "min_crew": 2}
        )
        
        print(f"Open lineup with fake ID status: {response.status_code}")
        print(f"Response: {response.text}")
        
        # Should return 404 for non-existent booking
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        assert "not found" in response.text.lower()
    
    def test_03_join_lineup_requires_valid_booking(self):
        """POST /api/bookings/{id}/lineup/join - should fail with invalid booking ID"""
        user_id = self.get_user_id()
        if not user_id:
            pytest.skip("Login failed")
        
        response = self.session.post(
            f"{BASE_URL}/api/bookings/fake-booking-id/lineup/join",
            params={"user_id": user_id}
        )
        
        print(f"Join lineup with fake ID status: {response.status_code}")
        print(f"Response: {response.text}")
        
        # Should return 404 for non-existent booking
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        assert "not found" in response.text.lower()
    
    def test_04_leave_lineup_requires_valid_booking(self):
        """POST /api/bookings/{id}/lineup/leave - should fail with invalid booking ID"""
        user_id = self.get_user_id()
        if not user_id:
            pytest.skip("Login failed")
        
        response = self.session.post(
            f"{BASE_URL}/api/bookings/fake-booking-id/lineup/leave",
            params={"user_id": user_id}
        )
        
        print(f"Leave lineup with fake ID status: {response.status_code}")
        print(f"Response: {response.text}")
        
        # Should return 404 for non-existent booking
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        assert "not found" in response.text.lower()
    
    def test_05_lock_lineup_requires_valid_booking(self):
        """POST /api/bookings/{id}/lineup/lock - should fail with invalid booking ID"""
        user_id = self.get_user_id()
        if not user_id:
            pytest.skip("Login failed")
        
        response = self.session.post(
            f"{BASE_URL}/api/bookings/fake-booking-id/lineup/lock",
            params={"user_id": user_id}
        )
        
        print(f"Lock lineup with fake ID status: {response.status_code}")
        print(f"Response: {response.text}")
        
        # Should return 404 for non-existent booking
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        assert "not found" in response.text.lower()
    
    def test_06_close_lineup_requires_valid_booking(self):
        """POST /api/bookings/{id}/lineup/close - should fail with invalid booking ID"""
        user_id = self.get_user_id()
        if not user_id:
            pytest.skip("Login failed")
        
        response = self.session.post(
            f"{BASE_URL}/api/bookings/fake-booking-id/lineup/close",
            params={"user_id": user_id}
        )
        
        print(f"Close lineup with fake ID status: {response.status_code}")
        print(f"Response: {response.text}")
        
        # Should return 404 for non-existent booking
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        assert "not found" in response.text.lower()


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
