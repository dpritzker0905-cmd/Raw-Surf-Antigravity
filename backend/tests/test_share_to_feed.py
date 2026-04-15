"""
Test Share to Feed functionality for bookings
Tests:
1. Share booking to feed - success with spots_left info
2. Share already-shared booking - returns 400 with friendly message
3. Share booking by non-creator - returns 403
4. Share non-existent booking - returns 404
"""
import pytest
import requests
import os
import uuid
from datetime import datetime, timedelta

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://raw-surf-os.preview.emergentagent.com')

# Test user ID from requirements
TEST_USER_ID = "cfb3858b-757d-44a1-8a3a-b17f862a5aa2"


class TestShareToFeed:
    """Test share-to-feed endpoint for bookings"""
    
    @pytest.fixture
    def api_client(self):
        """Shared requests session"""
        session = requests.Session()
        session.headers.update({"Content-Type": "application/json"})
        return session
    
    @pytest.fixture
    def photographer_id(self, api_client):
        """Get a photographer ID for creating test bookings"""
        response = api_client.get(f"{BASE_URL}/api/photographers/directory?limit=1")
        assert response.status_code == 200
        photographers = response.json()
        if photographers:
            return photographers[0]["id"]
        pytest.skip("No photographers available for testing")
    
    @pytest.fixture
    def new_booking(self, api_client, photographer_id):
        """Create a new booking for testing share-to-feed"""
        session_date = (datetime.now() + timedelta(days=7)).isoformat() + "Z"
        response = api_client.post(
            f"{BASE_URL}/api/bookings/create?user_id={TEST_USER_ID}",
            json={
                "photographer_id": photographer_id,
                "location": f"TEST_Share_Location_{uuid.uuid4().hex[:8]}",
                "session_date": session_date,
                "duration": 60,
                "max_participants": 3,
                "allow_splitting": True,
                "split_mode": "friends_only"
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert "booking_id" in data
        return data["booking_id"]
    
    def test_share_booking_to_feed_success(self, api_client, new_booking):
        """Test successful share to feed returns spots_left info"""
        response = api_client.post(
            f"{BASE_URL}/api/bookings/{new_booking}/share-to-feed?user_id={TEST_USER_ID}"
        )
        
        # Status code assertion
        assert response.status_code == 200
        
        # Data assertions - validate response structure and values
        data = response.json()
        assert "message" in data
        assert data["message"] == "Session posted to feed"
        assert "post_id" in data
        assert "spots_left" in data
        assert isinstance(data["spots_left"], int)
        assert data["spots_left"] >= 0
        print(f"✓ Share to feed success: spots_left={data['spots_left']}")
    
    def test_share_already_shared_booking_returns_400(self, api_client, new_booking):
        """Test sharing already-shared booking returns 400 with friendly message"""
        # First share (should succeed)
        first_response = api_client.post(
            f"{BASE_URL}/api/bookings/{new_booking}/share-to-feed?user_id={TEST_USER_ID}"
        )
        # May already be shared from previous test, so accept both 200 and 400
        
        # Second share attempt (should fail with 400)
        response = api_client.post(
            f"{BASE_URL}/api/bookings/{new_booking}/share-to-feed?user_id={TEST_USER_ID}"
        )
        
        # Status code assertion
        assert response.status_code == 400
        
        # Data assertions - validate error message
        data = response.json()
        assert "detail" in data
        # Check for "already posted" or "already shared" in message (case insensitive)
        error_msg = data["detail"].lower()
        assert "already posted" in error_msg or "already shared" in error_msg
        print(f"✓ Already shared returns 400: {data['detail']}")
    
    def test_share_booking_by_non_creator_returns_403(self, api_client, new_booking):
        """Test sharing booking by non-creator returns 403"""
        # Use a different user ID
        other_user_id = "00000000-0000-0000-0000-000000000000"
        
        response = api_client.post(
            f"{BASE_URL}/api/bookings/{new_booking}/share-to-feed?user_id={other_user_id}"
        )
        
        # Status code assertion
        assert response.status_code == 403
        
        # Data assertions
        data = response.json()
        assert "detail" in data
        assert "creator" in data["detail"].lower() or "authorized" in data["detail"].lower()
        print(f"✓ Non-creator returns 403: {data['detail']}")
    
    def test_share_nonexistent_booking_returns_404(self, api_client):
        """Test sharing non-existent booking returns 404"""
        fake_booking_id = str(uuid.uuid4())
        
        response = api_client.post(
            f"{BASE_URL}/api/bookings/{fake_booking_id}/share-to-feed?user_id={TEST_USER_ID}"
        )
        
        # Status code assertion
        assert response.status_code == 404
        
        # Data assertions
        data = response.json()
        assert "detail" in data
        assert "not found" in data["detail"].lower()
        print(f"✓ Non-existent booking returns 404: {data['detail']}")


class TestGPSFallbackSpotsEndpoint:
    """Test surf-spots endpoint used by GPS fallback feature"""
    
    @pytest.fixture
    def api_client(self):
        """Shared requests session"""
        session = requests.Session()
        session.headers.update({"Content-Type": "application/json"})
        return session
    
    def test_get_nearby_spots_with_coordinates(self, api_client):
        """Test fetching nearby spots with GPS coordinates"""
        # Use coordinates near a known surf area (e.g., Huntington Beach, CA)
        response = api_client.get(
            f"{BASE_URL}/api/surf-spots/nearby",
            params={
                "latitude": 33.6595,
                "longitude": -117.9988,
                "radius_miles": 50
            }
        )
        
        # Status code assertion
        assert response.status_code == 200
        
        # Data assertions
        data = response.json()
        assert isinstance(data, list)
        print(f"✓ Nearby spots endpoint works: {len(data)} spots found")
    
    def test_get_spots_general_list(self, api_client):
        """Test fetching general spots list (fallback when no GPS)"""
        response = api_client.get(
            f"{BASE_URL}/api/surf-spots",
            params={"limit": 30}
        )
        
        # Status code assertion
        assert response.status_code == 200
        
        # Data assertions
        data = response.json()
        assert isinstance(data, list)
        print(f"✓ General spots endpoint works: {len(data)} spots returned")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
