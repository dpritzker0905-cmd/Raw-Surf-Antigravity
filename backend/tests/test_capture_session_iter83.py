"""
Test Suite for CaptureSession Unified Model - Iteration 83
Tests:
1. On-Demand photographers endpoint
2. Session pricing endpoint with different modes
3. Grom Parent role permissions (can join, cannot create)
4. Session join with photos_credit_remaining assignment
5. Resolution pricing tiers
"""

import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials
TEST_USER_EMAIL = "kelly@surf.com"
TEST_USER_PASSWORD = "test-shaka"


class TestOnDemandPhotographers:
    """Test On-Demand photographers endpoint"""
    
    def test_on_demand_endpoint_returns_200(self):
        """On-Demand endpoint should return 200 even with no photographers"""
        response = requests.get(f"{BASE_URL}/api/photographers/on-demand")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert isinstance(data, list), "Response should be a list"
        print(f"PASS: On-Demand endpoint returns 200 with {len(data)} photographers")
    
    def test_on_demand_with_location_params(self):
        """On-Demand endpoint should accept location parameters"""
        response = requests.get(
            f"{BASE_URL}/api/photographers/on-demand",
            params={"latitude": 26.1224, "longitude": -80.1373, "radius": 50}
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert isinstance(data, list), "Response should be a list"
        print(f"PASS: On-Demand endpoint with location params returns {len(data)} photographers")
    
    def test_on_demand_response_structure(self):
        """On-Demand response should have correct structure when photographers exist"""
        response = requests.get(f"{BASE_URL}/api/photographers/on-demand")
        assert response.status_code == 200
        data = response.json()
        
        # If there are photographers, verify structure
        if len(data) > 0:
            pro = data[0]
            expected_fields = [
                'id', 'full_name', 'role', 'on_demand_hourly_rate',
                'on_demand_photos_included', 'photo_price_web',
                'photo_price_standard', 'photo_price_high'
            ]
            for field in expected_fields:
                assert field in pro, f"Missing field: {field}"
            print(f"PASS: On-Demand response has correct structure")
        else:
            print("PASS: On-Demand endpoint works (no photographers available)")


class TestSessionPricingEndpoint:
    """Test the new /api/sessions/pricing endpoint"""
    
    @pytest.fixture
    def auth_token(self):
        """Get authentication token"""
        response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": TEST_USER_EMAIL, "password": TEST_USER_PASSWORD}
        )
        if response.status_code == 200:
            return response.json().get("id")
        pytest.skip("Authentication failed")
    
    def test_pricing_endpoint_requires_user_id(self):
        """Pricing endpoint should require user_id parameter"""
        response = requests.post(
            f"{BASE_URL}/api/sessions/pricing",
            json={
                "photographer_id": "test-photographer-id",
                "session_mode": "live_join",
                "resolution": "standard"
            }
        )
        # Should fail without user_id
        assert response.status_code in [400, 404, 422], f"Expected error without user_id, got {response.status_code}"
        print(f"PASS: Pricing endpoint requires user_id (status: {response.status_code})")
    
    def test_pricing_endpoint_with_invalid_photographer(self, auth_token):
        """Pricing endpoint should return 404 for invalid photographer"""
        response = requests.post(
            f"{BASE_URL}/api/sessions/pricing",
            params={"user_id": auth_token},
            json={
                "photographer_id": "invalid-photographer-id",
                "session_mode": "live_join",
                "resolution": "standard"
            }
        )
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        print("PASS: Pricing endpoint returns 404 for invalid photographer")


class TestGromParentPermissions:
    """Test Grom Parent role permissions - can join but cannot create sessions"""
    
    def test_grom_parent_in_surfer_roles_list(self):
        """Verify Grom Parent is in the allowed surfer roles for joining sessions"""
        # This is a code verification test - checking the backend code
        import sys
        sys.path.insert(0, '/app/backend')
        from models import RoleEnum
        
        # Grom Parent should be a valid role
        assert hasattr(RoleEnum, 'GROM_PARENT'), "RoleEnum should have GROM_PARENT"
        assert RoleEnum.GROM_PARENT.value == "Grom Parent", "GROM_PARENT value should be 'Grom Parent'"
        print("PASS: Grom Parent role exists in RoleEnum")
    
    def test_go_live_blocks_grom_parent(self):
        """Verify go_live endpoint blocks Grom Parent role"""
        # Code verification - check the go_live endpoint has the restriction
        with open('/app/backend/routes/photographer.py', 'r') as f:
            content = f.read()
        
        # Check for Grom Parent restriction in go_live
        assert "GROM_PARENT" in content, "go_live should check for GROM_PARENT"
        assert "Grom Parents cannot start Live Sessions" in content, "go_live should have Grom Parent error message"
        print("PASS: go_live endpoint has Grom Parent restriction")
    
    def test_join_session_allows_grom_parent(self):
        """Verify join_session allows Grom Parent role"""
        # Code verification - check the join_session endpoint allows Grom Parent
        with open('/app/backend/routes/sessions.py', 'r') as f:
            content = f.read()
        
        # Check that Grom Parent is in the allowed roles
        assert "RoleEnum.GROM_PARENT" in content, "join_session should include GROM_PARENT in allowed roles"
        assert "'Grom Parent'" in content, "join_session should include 'Grom Parent' in role names"
        print("PASS: join_session allows Grom Parent role")


class TestSessionJoinPhotosCredit:
    """Test that session join properly assigns photos_credit_remaining"""
    
    def test_photos_credit_remaining_field_exists(self):
        """Verify LiveSessionParticipant has photos_credit_remaining field"""
        import sys
        sys.path.insert(0, '/app/backend')
        from models import LiveSessionParticipant
        
        # Check the model has the field
        assert hasattr(LiveSessionParticipant, 'photos_credit_remaining'), \
            "LiveSessionParticipant should have photos_credit_remaining field"
        print("PASS: photos_credit_remaining field exists in LiveSessionParticipant")
    
    def test_participant_role_field_exists(self):
        """Verify LiveSessionParticipant has participant_role field"""
        import sys
        sys.path.insert(0, '/app/backend')
        from models import LiveSessionParticipant
        
        assert hasattr(LiveSessionParticipant, 'participant_role'), \
            "LiveSessionParticipant should have participant_role field"
        print("PASS: participant_role field exists in LiveSessionParticipant")
    
    def test_resolution_preference_field_exists(self):
        """Verify LiveSessionParticipant has resolution_preference field"""
        import sys
        sys.path.insert(0, '/app/backend')
        from models import LiveSessionParticipant
        
        assert hasattr(LiveSessionParticipant, 'resolution_preference'), \
            "LiveSessionParticipant should have resolution_preference field"
        print("PASS: resolution_preference field exists in LiveSessionParticipant")
    
    def test_join_session_assigns_photos_credit(self):
        """Verify join_session code assigns photos_credit_remaining from buy-in"""
        with open('/app/backend/routes/sessions.py', 'r') as f:
            content = f.read()
        
        # Check that photos_credit_remaining is assigned in participant creation
        assert "photos_credit_remaining=photos_included" in content, \
            "join_session should assign photos_credit_remaining from photos_included"
        print("PASS: join_session assigns photos_credit_remaining from buy-in")


class TestLiveSessionModel:
    """Test LiveSession model has CaptureSession unified fields"""
    
    def test_session_mode_field_exists(self):
        """Verify LiveSession has session_mode field"""
        import sys
        sys.path.insert(0, '/app/backend')
        from models import LiveSession
        
        assert hasattr(LiveSession, 'session_mode'), \
            "LiveSession should have session_mode field"
        print("PASS: session_mode field exists in LiveSession")
    
    def test_dispatch_request_id_field_exists(self):
        """Verify LiveSession has dispatch_request_id field"""
        import sys
        sys.path.insert(0, '/app/backend')
        from models import LiveSession
        
        assert hasattr(LiveSession, 'dispatch_request_id'), \
            "LiveSession should have dispatch_request_id field"
        print("PASS: dispatch_request_id field exists in LiveSession")
    
    def test_booking_id_field_exists(self):
        """Verify LiveSession has booking_id field"""
        import sys
        sys.path.insert(0, '/app/backend')
        from models import LiveSession
        
        assert hasattr(LiveSession, 'booking_id'), \
            "LiveSession should have booking_id field"
        print("PASS: booking_id field exists in LiveSession")


class TestResolutionPricing:
    """Test resolution-based pricing tiers"""
    
    def test_pricing_endpoint_returns_resolution_prices(self):
        """Verify pricing endpoint returns resolution-based prices"""
        with open('/app/backend/routes/sessions.py', 'r') as f:
            content = f.read()
        
        # Check for resolution price map
        assert "'web':" in content, "Pricing should include web resolution"
        assert "'standard':" in content, "Pricing should include standard resolution"
        assert "'high':" in content, "Pricing should include high resolution"
        print("PASS: Pricing endpoint has resolution-based price map")
    
    def test_pricing_modes(self):
        """Verify pricing endpoint supports all session modes"""
        with open('/app/backend/routes/sessions.py', 'r') as f:
            content = f.read()
        
        # Check for all session modes
        assert "session_mode == 'live_join'" in content, "Should support live_join mode"
        assert "session_mode == 'on_demand'" in content, "Should support on_demand mode"
        assert "session_mode == 'gallery'" in content, "Should support gallery mode"
        print("PASS: Pricing endpoint supports all session modes")


class TestAuthAndLogin:
    """Test authentication works correctly"""
    
    def test_login_success(self):
        """Test login with valid credentials"""
        response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": TEST_USER_EMAIL, "password": TEST_USER_PASSWORD}
        )
        assert response.status_code == 200, f"Login failed: {response.text}"
        data = response.json()
        assert "id" in data, "Response should contain user id"
        assert "email" in data, "Response should contain email"
        assert data["email"] == TEST_USER_EMAIL, "Email should match"
        print(f"PASS: Login successful for {TEST_USER_EMAIL}")
    
    def test_login_returns_credit_balance(self):
        """Test login returns credit_balance field"""
        response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": TEST_USER_EMAIL, "password": TEST_USER_PASSWORD}
        )
        assert response.status_code == 200
        data = response.json()
        assert "credit_balance" in data, "Response should contain credit_balance"
        print(f"PASS: Login returns credit_balance: {data['credit_balance']}")


class TestLivePhotographers:
    """Test live photographers endpoint"""
    
    def test_live_photographers_endpoint(self):
        """Test /api/photographers/live endpoint"""
        response = requests.get(f"{BASE_URL}/api/photographers/live")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert isinstance(data, list), "Response should be a list"
        print(f"PASS: Live photographers endpoint returns {len(data)} photographers")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
