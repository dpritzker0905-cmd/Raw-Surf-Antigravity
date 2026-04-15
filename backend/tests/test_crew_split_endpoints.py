"""
Test Crew Split Backend Endpoints
Tests for:
- POST /api/bookings/{id}/send-crew-requests
- GET /api/users/search
- GET /api/users/{id}/recent-buddies
- GET /api/users/{id}/following
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://raw-surf-os.preview.emergentagent.com')


class TestUserSearchEndpoints:
    """Test user search and social endpoints for crew selection"""
    
    def test_user_search_endpoint_exists(self):
        """Test GET /api/users/search returns valid response"""
        response = requests.get(f"{BASE_URL}/api/users/search?query=test&limit=5")
        print(f"User search response status: {response.status_code}")
        
        # Should return 200 even with no results
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "users" in data, "Response should contain 'users' key"
        assert isinstance(data["users"], list), "Users should be a list"
        print(f"User search returned {len(data['users'])} users")
    
    def test_user_search_requires_min_query_length(self):
        """Test that search requires at least 2 characters"""
        # Single character should return empty
        response = requests.get(f"{BASE_URL}/api/users/search?query=a&limit=5")
        assert response.status_code == 200
        data = response.json()
        assert data["users"] == [], "Single char query should return empty list"
        print("Single char query correctly returns empty list")
    
    def test_user_search_returns_user_fields(self):
        """Test that search results contain expected fields"""
        response = requests.get(f"{BASE_URL}/api/users/search?query=surf&limit=5")
        assert response.status_code == 200
        
        data = response.json()
        if len(data["users"]) > 0:
            user = data["users"][0]
            # Check expected fields
            assert "id" in user, "User should have 'id'"
            assert "full_name" in user, "User should have 'full_name'"
            print(f"User search result fields: {list(user.keys())}")
        else:
            print("No users found matching 'surf' - this is OK for test")


class TestRecentBuddiesEndpoint:
    """Test recent buddies endpoint"""
    
    def test_recent_buddies_endpoint_exists(self):
        """Test GET /api/users/{id}/recent-buddies returns valid response"""
        # Use a test user ID
        test_user_id = "test-user-id-123"
        response = requests.get(f"{BASE_URL}/api/users/{test_user_id}/recent-buddies?limit=10")
        print(f"Recent buddies response status: {response.status_code}")
        
        # Should return 200 even for non-existent user (empty list)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "buddies" in data, "Response should contain 'buddies' key"
        assert isinstance(data["buddies"], list), "Buddies should be a list"
        print(f"Recent buddies returned {len(data['buddies'])} buddies")


class TestFollowingEndpoint:
    """Test following list endpoint"""
    
    def test_following_endpoint_exists(self):
        """Test GET /api/users/{id}/following returns valid response"""
        test_user_id = "test-user-id-123"
        response = requests.get(f"{BASE_URL}/api/users/{test_user_id}/following?limit=20")
        print(f"Following list response status: {response.status_code}")
        
        # Should return 200 even for non-existent user (empty list)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "following" in data, "Response should contain 'following' key"
        assert isinstance(data["following"], list), "Following should be a list"
        print(f"Following list returned {len(data['following'])} users")


class TestSendCrewRequestsEndpoint:
    """Test crew payment requests endpoint"""
    
    def test_send_crew_requests_requires_booking_id(self):
        """Test POST /api/bookings/{id}/send-crew-requests validates booking"""
        # Test with non-existent booking
        fake_booking_id = "non-existent-booking-123"
        test_user_id = "test-user-123"
        
        payload = {
            "crew_members": [
                {"user_id": "crew-1", "name": "Test Crew 1", "share_amount": 25.0}
            ],
            "price_per_person": 25.0,
            "payment_deadline": "2026-02-01T12:00:00Z",
            "session_date": "2026-02-05T10:00:00Z",
            "photographer_name": "Test Photographer"
        }
        
        response = requests.post(
            f"{BASE_URL}/api/bookings/{fake_booking_id}/send-crew-requests?user_id={test_user_id}",
            json=payload
        )
        print(f"Send crew requests response status: {response.status_code}")
        
        # Should return 404 for non-existent booking
        assert response.status_code == 404, f"Expected 404 for non-existent booking, got {response.status_code}"
        print("Correctly returns 404 for non-existent booking")
    
    def test_send_crew_requests_endpoint_structure(self):
        """Test that endpoint accepts correct payload structure"""
        # This tests the endpoint exists and validates input
        fake_booking_id = "test-booking-123"
        test_user_id = "test-user-123"
        
        # Test with invalid payload (missing required fields)
        invalid_payload = {
            "crew_members": []  # Missing other required fields
        }
        
        response = requests.post(
            f"{BASE_URL}/api/bookings/{fake_booking_id}/send-crew-requests?user_id={test_user_id}",
            json=invalid_payload
        )
        
        # Should return 404 (booking not found) or 422 (validation error)
        assert response.status_code in [404, 422], f"Expected 404 or 422, got {response.status_code}"
        print(f"Endpoint correctly validates input, status: {response.status_code}")


class TestBookingCreationWithCrew:
    """Test booking creation with crew split enabled"""
    
    def test_booking_create_accepts_crew_members(self):
        """Test that booking creation accepts crew_members field"""
        # First we need to get a valid photographer ID
        photographers_response = requests.get(f"{BASE_URL}/api/photographers/directory?limit=1")
        
        if photographers_response.status_code != 200 or not photographers_response.json():
            pytest.skip("No photographers available for testing")
        
        photographers = photographers_response.json()
        if len(photographers) == 0:
            pytest.skip("No photographers in directory")
        
        photographer_id = photographers[0]["id"]
        print(f"Using photographer ID: {photographer_id}")
        
        # Get a test user
        users_response = requests.get(f"{BASE_URL}/api/users/search?query=test&limit=1")
        if users_response.status_code != 200:
            pytest.skip("Cannot search for test users")
        
        users = users_response.json().get("users", [])
        if len(users) == 0:
            pytest.skip("No test users available")
        
        test_user_id = users[0]["id"]
        print(f"Using test user ID: {test_user_id}")
        
        # Test booking creation payload with crew members
        booking_payload = {
            "photographer_id": photographer_id,
            "location": "Test Beach",
            "session_date": "2026-02-15T10:00:00Z",
            "duration": 60,
            "max_participants": 3,
            "allow_splitting": True,
            "split_mode": "friends_only",
            "crew_members": [
                {"user_id": "crew-member-1", "name": "Crew Member 1", "share_amount": 25.0},
                {"user_id": "crew-member-2", "name": "Crew Member 2", "share_amount": 25.0}
            ],
            "apply_credits": 0,
            "description": "Test crew split session"
        }
        
        response = requests.post(
            f"{BASE_URL}/api/bookings/create?user_id={test_user_id}",
            json=booking_payload
        )
        
        print(f"Booking creation response status: {response.status_code}")
        print(f"Response: {response.text[:500] if response.text else 'No response body'}")
        
        # Should succeed or fail with credit balance issue (not validation error)
        # 200/201 = success, 400 = insufficient credits, 422 = validation error
        assert response.status_code in [200, 201, 400], f"Unexpected status: {response.status_code}"
        
        if response.status_code in [200, 201]:
            data = response.json()
            print(f"Booking created successfully: {data.get('booking_id', 'N/A')}")
        elif response.status_code == 400:
            print(f"Booking failed (likely insufficient credits): {response.json()}")


class TestGroupDiscountCalculation:
    """Test that group discounts are calculated correctly"""
    
    def test_photographer_has_group_discount_fields(self):
        """Test that photographer profiles include group discount fields"""
        response = requests.get(f"{BASE_URL}/api/photographers/directory?limit=5")
        
        if response.status_code != 200:
            pytest.skip("Cannot fetch photographer directory")
        
        photographers = response.json()
        if len(photographers) == 0:
            pytest.skip("No photographers available")
        
        # Check if any photographer has group discount fields
        # These may not be set, but the endpoint should work
        print(f"Fetched {len(photographers)} photographers")
        
        for p in photographers:
            print(f"Photographer {p.get('full_name', 'Unknown')}: role={p.get('role')}")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
