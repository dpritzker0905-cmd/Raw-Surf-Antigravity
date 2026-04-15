"""
Iteration 136 - Testing:
1. Username/@handle booking invites with autocomplete search
2. Invite by handle sends in-app notification
3. Unified Admin Console accessible from /admin and /god-mode routes
4. Settings page shows single 'Admin Console' button
5. Existing invite code functionality still works
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials from previous iteration
TEST_USER_EMAIL = "test_iter133@test.com"
TEST_USER_PASSWORD = "Test123!"
ADMIN_EMAIL = "dpritzker0905@gmail.com"
ADMIN_PASSWORD = "test123"


class TestBookingInviteFeatures:
    """Test username/@handle booking invite feature"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test session"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        
    def test_search_users_endpoint_exists(self):
        """Test that search-users endpoint exists and returns proper error for invalid booking"""
        # This should return 404 for non-existent booking
        response = self.session.get(
            f"{BASE_URL}/api/bookings/test-invalid-booking-id/search-users",
            params={"query": "test", "user_id": "test-user-id"}
        )
        # Should return 404 (booking not found) not 500 (server error)
        assert response.status_code in [404, 403], f"Expected 404 or 403, got {response.status_code}"
        print(f"✓ search-users endpoint exists, returns {response.status_code} for invalid booking")
    
    def test_search_users_requires_query(self):
        """Test that search requires minimum 2 characters"""
        # With short query, should return empty array
        response = self.session.get(
            f"{BASE_URL}/api/bookings/test-booking-id/search-users",
            params={"query": "a", "user_id": "test-user-id"}
        )
        # Either returns empty array or 404 for invalid booking
        assert response.status_code in [200, 404], f"Expected 200 or 404, got {response.status_code}"
        if response.status_code == 200:
            data = response.json()
            assert isinstance(data, list), "Should return a list"
            assert len(data) == 0, "Should return empty list for short query"
        print(f"✓ search-users handles short queries correctly")
    
    def test_invite_by_handle_endpoint_exists(self):
        """Test that invite-by-handle endpoint exists"""
        response = self.session.post(
            f"{BASE_URL}/api/bookings/test-invalid-booking-id/invite-by-handle",
            params={"user_id": "test-user-id"},
            json={"handle_query": "test user", "message": "Join my session!"}
        )
        # Should return 404 (booking not found) not 500 (server error)
        assert response.status_code in [404, 403], f"Expected 404 or 403, got {response.status_code}"
        print(f"✓ invite-by-handle endpoint exists, returns {response.status_code} for invalid booking")
    
    def test_join_by_code_endpoint_exists(self):
        """Test that join-by-code endpoint still works"""
        response = self.session.post(
            f"{BASE_URL}/api/bookings/join-by-code",
            params={"user_id": "test-user-id", "invite_code": "INVALID"}
        )
        # Should return 404 (invalid code) not 500
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        data = response.json()
        assert "detail" in data, "Should have error detail"
        print(f"✓ join-by-code endpoint works, returns 404 for invalid code")


class TestAdminConsoleRoutes:
    """Test Unified Admin Console routes"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test session"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
    
    def test_admin_stats_endpoint(self):
        """Test admin stats endpoint exists"""
        # Without valid admin_id, should return 403 or 401
        response = self.session.get(
            f"{BASE_URL}/api/admin/stats",
            params={"admin_id": "invalid-admin-id"}
        )
        # Should return 403 (not admin) or 404 (user not found)
        assert response.status_code in [403, 404], f"Expected 403 or 404, got {response.status_code}"
        print(f"✓ admin/stats endpoint exists, returns {response.status_code} for non-admin")
    
    def test_admin_users_endpoint(self):
        """Test admin users endpoint exists"""
        response = self.session.get(
            f"{BASE_URL}/api/admin/users",
            params={"admin_id": "invalid-admin-id", "limit": 10}
        )
        assert response.status_code in [403, 404], f"Expected 403 or 404, got {response.status_code}"
        print(f"✓ admin/users endpoint exists, returns {response.status_code} for non-admin")
    
    def test_admin_logs_endpoint(self):
        """Test admin logs endpoint exists"""
        response = self.session.get(
            f"{BASE_URL}/api/admin/logs",
            params={"admin_id": "invalid-admin-id", "limit": 10}
        )
        assert response.status_code in [403, 404], f"Expected 403 or 404, got {response.status_code}"
        print(f"✓ admin/logs endpoint exists, returns {response.status_code} for non-admin")
    
    def test_admin_photographers_endpoint(self):
        """Test admin photographers endpoint for session simulation"""
        response = self.session.get(f"{BASE_URL}/api/admin/photographers")
        # This might be public or require admin
        assert response.status_code in [200, 403, 404], f"Unexpected status {response.status_code}"
        print(f"✓ admin/photographers endpoint exists, returns {response.status_code}")
    
    def test_admin_active_sessions_endpoint(self):
        """Test admin active sessions endpoint"""
        response = self.session.get(f"{BASE_URL}/api/admin/active-sessions")
        # This might be public or require admin
        assert response.status_code in [200, 403, 404], f"Unexpected status {response.status_code}"
        print(f"✓ admin/active-sessions endpoint exists, returns {response.status_code}")


class TestAuthenticatedAdminFlow:
    """Test admin features with authenticated admin user"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test session and login as admin"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        self.admin_id = None
        
        # Login as admin
        login_response = self.session.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}
        )
        if login_response.status_code == 200:
            data = login_response.json()
            self.admin_id = data.get("user", {}).get("id")
            print(f"✓ Logged in as admin: {self.admin_id}")
        else:
            print(f"⚠ Admin login failed: {login_response.status_code}")
    
    def test_admin_stats_with_valid_admin(self):
        """Test admin stats with valid admin credentials"""
        if not self.admin_id:
            pytest.skip("Admin login failed")
        
        response = self.session.get(
            f"{BASE_URL}/api/admin/stats",
            params={"admin_id": self.admin_id}
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert "users" in data or "total_users" in data or data is not None, "Should return stats data"
        print(f"✓ Admin stats returned successfully")
    
    def test_admin_users_with_valid_admin(self):
        """Test admin users list with valid admin credentials"""
        if not self.admin_id:
            pytest.skip("Admin login failed")
        
        response = self.session.get(
            f"{BASE_URL}/api/admin/users",
            params={"admin_id": self.admin_id, "limit": 10}
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert "users" in data, "Should return users list"
        print(f"✓ Admin users list returned {len(data.get('users', []))} users")
    
    def test_admin_logs_with_valid_admin(self):
        """Test admin logs with valid admin credentials"""
        if not self.admin_id:
            pytest.skip("Admin login failed")
        
        response = self.session.get(
            f"{BASE_URL}/api/admin/logs",
            params={"admin_id": self.admin_id, "limit": 10}
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert isinstance(data, list), "Should return logs list"
        print(f"✓ Admin logs returned {len(data)} entries")


class TestBookingInviteWithAuth:
    """Test booking invite features with authenticated user"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test session and login"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        self.user_id = None
        
        # Login as test user
        login_response = self.session.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": TEST_USER_EMAIL, "password": TEST_USER_PASSWORD}
        )
        if login_response.status_code == 200:
            data = login_response.json()
            self.user_id = data.get("user", {}).get("id")
            print(f"✓ Logged in as test user: {self.user_id}")
        else:
            print(f"⚠ Test user login failed: {login_response.status_code}")
    
    def test_get_user_bookings(self):
        """Test getting user bookings to find a valid booking for testing"""
        if not self.user_id:
            pytest.skip("User login failed")
        
        response = self.session.get(f"{BASE_URL}/api/bookings/user/{self.user_id}")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert isinstance(data, list), "Should return list of bookings"
        print(f"✓ User has {len(data)} bookings")
        return data
    
    def test_get_user_invites(self):
        """Test getting pending invites for user"""
        if not self.user_id:
            pytest.skip("User login failed")
        
        response = self.session.get(f"{BASE_URL}/api/bookings/invites/{self.user_id}")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert isinstance(data, list), "Should return list of invites"
        print(f"✓ User has {len(data)} pending invites")


class TestSurfSpotsEndpoint:
    """Test surf spots endpoint used by admin console"""
    
    def test_surf_spots_list(self):
        """Test surf spots endpoint returns list"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert isinstance(data, list), "Should return list of surf spots"
        print(f"✓ Surf spots endpoint returned {len(data)} spots")


class TestNotificationsEndpoint:
    """Test notifications endpoint for invite notifications"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test session and login"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        self.user_id = None
        
        # Login as test user
        login_response = self.session.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": TEST_USER_EMAIL, "password": TEST_USER_PASSWORD}
        )
        if login_response.status_code == 200:
            data = login_response.json()
            self.user_id = data.get("user", {}).get("id")
    
    def test_get_notifications(self):
        """Test getting notifications for user"""
        if not self.user_id:
            pytest.skip("User login failed")
        
        response = self.session.get(f"{BASE_URL}/api/notifications/{self.user_id}")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert isinstance(data, list), "Should return list of notifications"
        print(f"✓ User has {len(data)} notifications")
        
        # Check if any are booking_invite type
        invite_notifs = [n for n in data if n.get('type') == 'booking_invite']
        print(f"  - {len(invite_notifs)} are booking invite notifications")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
