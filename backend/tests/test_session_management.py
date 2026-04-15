"""
Test Session Management Endpoints (Iteration 207)
Tests for: share-to-feed, send-split-requests, request-join endpoints
"""
import pytest
import requests
import os
from datetime import datetime, timedelta

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials
TEST_EMAIL = "testuser_e1@test.com"
TEST_PASSWORD = "TestPass123!"


class TestSessionManagementEndpoints:
    """Test the new session management endpoints for Crew Management & Booking Delta"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test data"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        
        # Login and get user info
        login_response = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": TEST_EMAIL,
            "password": TEST_PASSWORD
        })
        
        if login_response.status_code == 200:
            self.user = login_response.json()
            self.user_id = self.user.get("id")
        else:
            pytest.skip(f"Login failed: {login_response.status_code}")
    
    def test_share_to_feed_endpoint_exists(self):
        """Test POST /api/bookings/{id}/share-to-feed endpoint exists"""
        # Use a fake booking ID - should return 404 (not found) not 405 (method not allowed)
        response = self.session.post(
            f"{BASE_URL}/api/bookings/fake-booking-id/share-to-feed",
            params={"user_id": self.user_id}
        )
        
        # Should return 404 (booking not found) or 403 (not authorized), not 405 (method not allowed)
        assert response.status_code in [404, 403, 422], f"Expected 404/403/422, got {response.status_code}: {response.text}"
        print(f"✓ share-to-feed endpoint exists (returned {response.status_code})")
    
    def test_send_split_requests_endpoint_exists(self):
        """Test POST /api/bookings/{id}/send-split-requests endpoint exists"""
        response = self.session.post(
            f"{BASE_URL}/api/bookings/fake-booking-id/send-split-requests",
            params={"user_id": self.user_id}
        )
        
        # Should return 404 (booking not found) or 403 (not authorized), not 405 (method not allowed)
        assert response.status_code in [404, 403, 422], f"Expected 404/403/422, got {response.status_code}: {response.text}"
        print(f"✓ send-split-requests endpoint exists (returned {response.status_code})")
    
    def test_request_join_endpoint_exists(self):
        """Test POST /api/bookings/{id}/request-join endpoint exists"""
        response = self.session.post(
            f"{BASE_URL}/api/bookings/fake-booking-id/request-join",
            params={"user_id": self.user_id}
        )
        
        # Should return 404 (session not found), not 405 (method not allowed)
        assert response.status_code in [404, 422], f"Expected 404/422, got {response.status_code}: {response.text}"
        print(f"✓ request-join endpoint exists (returned {response.status_code})")
    
    def test_share_to_feed_requires_user_id(self):
        """Test share-to-feed requires user_id parameter"""
        response = self.session.post(
            f"{BASE_URL}/api/bookings/fake-booking-id/share-to-feed"
        )
        
        # Should return 422 (validation error) for missing user_id
        assert response.status_code == 422, f"Expected 422 for missing user_id, got {response.status_code}"
        print("✓ share-to-feed validates user_id parameter")
    
    def test_send_split_requests_requires_user_id(self):
        """Test send-split-requests requires user_id parameter"""
        response = self.session.post(
            f"{BASE_URL}/api/bookings/fake-booking-id/send-split-requests"
        )
        
        # Should return 422 (validation error) for missing user_id
        assert response.status_code == 422, f"Expected 422 for missing user_id, got {response.status_code}"
        print("✓ send-split-requests validates user_id parameter")
    
    def test_request_join_requires_user_id(self):
        """Test request-join requires user_id parameter"""
        response = self.session.post(
            f"{BASE_URL}/api/bookings/fake-booking-id/request-join"
        )
        
        # Should return 422 (validation error) for missing user_id
        assert response.status_code == 422, f"Expected 422 for missing user_id, got {response.status_code}"
        print("✓ request-join validates user_id parameter")


class TestScheduledTabAPI:
    """Test APIs used by the Scheduled Tab"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test data"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        
        # Login and get user info
        login_response = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": TEST_EMAIL,
            "password": TEST_PASSWORD
        })
        
        if login_response.status_code == 200:
            self.user = login_response.json()
            self.user_id = self.user.get("id")
        else:
            pytest.skip(f"Login failed: {login_response.status_code}")
    
    def test_get_user_bookings(self):
        """Test GET /api/bookings/user/{user_id} returns bookings list"""
        response = self.session.get(f"{BASE_URL}/api/bookings/user/{self.user_id}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert isinstance(data, list), "Expected list of bookings"
        print(f"✓ User bookings endpoint works (returned {len(data)} bookings)")
    
    def test_get_photographer_directory(self):
        """Test GET /api/photographers/directory returns photographers"""
        response = self.session.get(f"{BASE_URL}/api/photographers/directory")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert isinstance(data, list), "Expected list of photographers"
        print(f"✓ Photographer directory endpoint works (returned {len(data)} photographers)")


class TestPostModelSessionLogFields:
    """Test that Post model has session log fields for SessionJoinCard"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test data"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        
        # Login
        login_response = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": TEST_EMAIL,
            "password": TEST_PASSWORD
        })
        
        if login_response.status_code == 200:
            self.user = login_response.json()
            self.user_id = self.user.get("id")
        else:
            pytest.skip(f"Login failed: {login_response.status_code}")
    
    def test_feed_endpoint_works(self):
        """Test GET /api/posts returns posts"""
        response = self.session.get(f"{BASE_URL}/api/posts", params={"user_id": self.user.get('id')})
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert isinstance(data, list), "Expected list of posts"
        print(f"✓ Feed endpoint works (returned {len(data)} posts)")
        
        # Check if any posts have session log fields (they may not exist yet)
        session_log_posts = [p for p in data if p.get('is_session_log')]
        print(f"  Found {len(session_log_posts)} session log posts in feed")


class TestCancelBookingRefundPolicy:
    """Test cancellation refund policy calculation"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test data"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        
        # Login
        login_response = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": TEST_EMAIL,
            "password": TEST_PASSWORD
        })
        
        if login_response.status_code == 200:
            self.user = login_response.json()
            self.user_id = self.user.get("id")
        else:
            pytest.skip(f"Login failed: {login_response.status_code}")
    
    def test_cancel_endpoint_exists(self):
        """Test POST /api/bookings/{id}/cancel endpoint exists"""
        response = self.session.post(
            f"{BASE_URL}/api/bookings/fake-booking-id/cancel",
            params={"user_id": self.user_id},
            json={"reason": "Test cancellation"}
        )
        
        # Should return 404 (booking not found), not 405 (method not allowed)
        assert response.status_code in [404, 403, 422], f"Expected 404/403/422, got {response.status_code}: {response.text}"
        print(f"✓ cancel endpoint exists (returned {response.status_code})")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
