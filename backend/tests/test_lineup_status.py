"""
Test suite for Lineup Status endpoint - POST /api/bookings/{id}/lineup/status
Tests the open/closed booking logic for sessions
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://raw-surf-os.preview.emergentagent.com')


class TestLineupStatusEndpoint:
    """Tests for POST /api/bookings/{booking_id}/lineup/status endpoint"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test data"""
        # Login to get user info
        login_response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": "testuser_e1@test.com", "password": "TestPass123!"}
        )
        assert login_response.status_code == 200, f"Login failed: {login_response.text}"
        self.user = login_response.json()
        self.user_id = self.user['id']
        
        # Get user's bookings to find one with lineup enabled
        bookings_response = requests.get(f"{BASE_URL}/api/bookings/user/{self.user_id}")
        assert bookings_response.status_code == 200, f"Failed to get bookings: {bookings_response.text}"
        
        bookings = bookings_response.json()
        # Find a booking where user is creator
        self.booking = next(
            (b for b in bookings if b.get('creator_id') == self.user_id and b.get('status') in ['Pending', 'Confirmed']),
            None
        )
    
    def test_toggle_status_to_closed(self):
        """Test toggling lineup status to closed"""
        if not self.booking:
            pytest.skip("No suitable booking found for testing")
        
        response = requests.post(
            f"{BASE_URL}/api/bookings/{self.booking['id']}/lineup/status",
            params={"user_id": self.user_id},
            json={"status": "closed"}
        )
        
        assert response.status_code == 200, f"Failed to close lineup: {response.text}"
        data = response.json()
        
        assert "message" in data
        assert data["lineup_status"] == "closed"
        assert data["allow_splitting"] == False
        print(f"SUCCESS: Lineup status toggled to closed - {data}")
    
    def test_toggle_status_to_open(self):
        """Test toggling lineup status to open"""
        if not self.booking:
            pytest.skip("No suitable booking found for testing")
        
        response = requests.post(
            f"{BASE_URL}/api/bookings/{self.booking['id']}/lineup/status",
            params={"user_id": self.user_id},
            json={"status": "open"}
        )
        
        assert response.status_code == 200, f"Failed to open lineup: {response.text}"
        data = response.json()
        
        assert "message" in data
        assert data["lineup_status"] in ["open", "filling", "ready"]
        assert data["allow_splitting"] == True
        print(f"SUCCESS: Lineup status toggled to open - {data}")
    
    def test_invalid_status_value(self):
        """Test that invalid status values are rejected"""
        if not self.booking:
            pytest.skip("No suitable booking found for testing")
        
        response = requests.post(
            f"{BASE_URL}/api/bookings/{self.booking['id']}/lineup/status",
            params={"user_id": self.user_id},
            json={"status": "invalid_status"}
        )
        
        assert response.status_code == 400, f"Expected 400 for invalid status, got {response.status_code}"
        print(f"SUCCESS: Invalid status correctly rejected")
    
    def test_unauthorized_user(self):
        """Test that non-captain/non-photographer cannot change status"""
        if not self.booking:
            pytest.skip("No suitable booking found for testing")
        
        # Use a random user ID that's not the creator
        fake_user_id = "00000000-0000-0000-0000-000000000000"
        
        response = requests.post(
            f"{BASE_URL}/api/bookings/{self.booking['id']}/lineup/status",
            params={"user_id": fake_user_id},
            json={"status": "closed"}
        )
        
        assert response.status_code == 403, f"Expected 403 for unauthorized user, got {response.status_code}"
        print(f"SUCCESS: Unauthorized user correctly rejected")
    
    def test_nonexistent_booking(self):
        """Test that nonexistent booking returns 404"""
        fake_booking_id = "00000000-0000-0000-0000-000000000000"
        
        response = requests.post(
            f"{BASE_URL}/api/bookings/{fake_booking_id}/lineup/status",
            params={"user_id": self.user_id},
            json={"status": "open"}
        )
        
        assert response.status_code == 404, f"Expected 404 for nonexistent booking, got {response.status_code}"
        print(f"SUCCESS: Nonexistent booking correctly returns 404")
    
    def test_missing_status_body(self):
        """Test that missing status body returns error"""
        if not self.booking:
            pytest.skip("No suitable booking found for testing")
        
        response = requests.post(
            f"{BASE_URL}/api/bookings/{self.booking['id']}/lineup/status",
            params={"user_id": self.user_id},
            json={}
        )
        
        # Should return 422 (validation error) or 400
        assert response.status_code in [400, 422], f"Expected 400/422 for missing status, got {response.status_code}"
        print(f"SUCCESS: Missing status body correctly rejected")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
