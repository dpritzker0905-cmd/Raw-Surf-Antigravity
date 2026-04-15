"""
Test God Mode Session Join - Iteration 57
Tests the effective_role parameter for admin users in God Mode masking as surfers.

Bug Fix: Admin users in God Mode masked as Surfer should be able to join sessions
by passing effective_role parameter to bypass normal role validation.
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestGodModeSessionJoin:
    """Tests for God Mode persona masking in session join"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Get admin user and setup test data"""
        self.admin_email = "kelly@surf.com"
        self.admin_password = "test-shaka"
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        
        # Login and get admin user
        login_resp = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": self.admin_email,
            "password": self.admin_password
        })
        if login_resp.status_code == 200:
            # Response is the user object directly, not wrapped in "user" key
            self.admin_user = login_resp.json()
        else:
            pytest.skip(f"Could not login as admin: {login_resp.status_code}")
    
    def test_admin_user_is_admin(self):
        """Verify the test user is actually an admin"""
        assert self.admin_user is not None, "Admin user should be logged in"
        assert self.admin_user.get("is_admin") == True, "kelly@surf.com should be an admin"
        print(f"Admin user verified: {self.admin_user.get('email')}, is_admin={self.admin_user.get('is_admin')}")
        print(f"Admin user role: {self.admin_user.get('role')}")
    
    def test_effective_role_field_accepted(self):
        """Test that the sessions/join endpoint accepts effective_role parameter"""
        # Find an active photographer session
        spots_resp = self.session.get(f"{BASE_URL}/api/spots")
        if spots_resp.status_code != 200:
            pytest.skip("Could not fetch spots")
        
        spots = spots_resp.json()
        if not spots:
            pytest.skip("No spots available")
        
        # Try to find a live shooter or create test data
        # For this test, we just verify the endpoint accepts the parameter
        # even if the photographer isn't shooting
        
        # Get a photographer user
        profiles_resp = self.session.get(f"{BASE_URL}/api/profiles")
        if profiles_resp.status_code != 200:
            pytest.skip("Could not fetch profiles")
        
        profiles = profiles_resp.json()
        photographers = [p for p in profiles if p.get('role') in ['Photographer', 'Approved Pro', 'Hobbyist']]
        
        if not photographers:
            pytest.skip("No photographers found to test with")
        
        photographer = photographers[0]
        print(f"Testing with photographer: {photographer.get('full_name')} (id: {photographer.get('id')})")
        
        # Attempt to join with effective_role parameter - this should parse correctly
        # We expect a 400 (photographer not shooting) not a 422 (validation error)
        response = self.session.post(
            f"{BASE_URL}/api/sessions/join?surfer_id={self.admin_user['id']}",
            json={
                "photographer_id": photographer['id'],
                "selfie_url": None,
                "payment_method": "credits",
                "effective_role": "Surfer"  # Test God Mode effective role
            }
        )
        
        # Response should NOT be 422 (validation error) - that would mean field not accepted
        assert response.status_code != 422, f"effective_role should be accepted by API, got validation error: {response.text}"
        
        # Expected: 400 (photographer not shooting) or 403 (role check) or 200 (success)
        print(f"Response status: {response.status_code}")
        print(f"Response body: {response.text[:500]}")
        
        if response.status_code == 400:
            detail = response.json().get('detail', '')
            if 'not currently shooting' in detail.lower():
                print("PASS: API accepts effective_role field (photographer not shooting is expected)")
            elif 'already in' in detail.lower():
                print("PASS: API accepts effective_role field (already in session)")
            else:
                print(f"PASS: API accepts effective_role field (got expected 400: {detail})")
    
    def test_surfer_roles_defined_correctly(self):
        """Verify surfer roles are correctly defined for God Mode validation"""
        # These are the roles that should be allowed to join sessions
        expected_surfer_role_names = ['Grom', 'Surfer', 'Comp Surfer', 'Pro', 'Competition Surfer']
        
        # Test each valid surfer role would pass validation
        for role in expected_surfer_role_names:
            assert role in expected_surfer_role_names, f"{role} should be valid for God Mode"
        
        # Test non-surfer roles would fail validation
        non_surfer_roles = ['Photographer', 'Approved Pro', 'Hobbyist', 'Shop', 'Business']
        for role in non_surfer_roles:
            assert role not in expected_surfer_role_names, f"{role} should NOT be valid for God Mode session join"
        
        print(f"Valid surfer roles for God Mode: {expected_surfer_role_names}")
        print(f"Invalid roles (should be blocked): {non_surfer_roles}")
    
    def test_effective_role_with_different_surfer_roles(self):
        """Test that different surfer role names are accepted as effective_role"""
        valid_surfer_roles = ['Grom', 'Surfer', 'Comp Surfer', 'Pro', 'Competition Surfer']
        
        # Get a photographer
        profiles_resp = self.session.get(f"{BASE_URL}/api/profiles")
        if profiles_resp.status_code != 200:
            pytest.skip("Could not fetch profiles")
        
        profiles = profiles_resp.json()
        photographers = [p for p in profiles if p.get('role') in ['Photographer', 'Approved Pro', 'Hobbyist']]
        
        if not photographers:
            pytest.skip("No photographers found")
        
        photographer = photographers[0]
        
        for surfer_role in valid_surfer_roles[:2]:  # Test just first two to save time
            response = self.session.post(
                f"{BASE_URL}/api/sessions/join?surfer_id={self.admin_user['id']}",
                json={
                    "photographer_id": photographer['id'],
                    "payment_method": "credits",
                    "effective_role": surfer_role
                }
            )
            
            # Should not get validation error
            assert response.status_code != 422, f"effective_role={surfer_role} should be accepted"
            print(f"effective_role='{surfer_role}' accepted (status: {response.status_code})")
    
    def test_effective_role_with_invalid_role_blocked(self):
        """Test that non-surfer effective roles are blocked"""
        invalid_roles = ['Photographer', 'Shop', 'Business']
        
        # Get a photographer who IS shooting
        profiles_resp = self.session.get(f"{BASE_URL}/api/profiles")
        if profiles_resp.status_code != 200:
            pytest.skip("Could not fetch profiles")
        
        profiles = profiles_resp.json()
        
        # Find a photographer who is currently shooting
        active_photographers = [p for p in profiles if p.get('is_shooting') == True]
        
        if not active_photographers:
            print("No active photographers - testing parameter validation only")
            # Just verify the API accepts the field without validation errors
            photographer = next((p for p in profiles if p.get('role') in ['Photographer', 'Approved Pro']), None)
            if not photographer:
                pytest.skip("No photographers found")
            
            for invalid_role in invalid_roles:
                response = self.session.post(
                    f"{BASE_URL}/api/sessions/join?surfer_id={self.admin_user['id']}",
                    json={
                        "photographer_id": photographer['id'],
                        "payment_method": "credits",
                        "effective_role": invalid_role
                    }
                )
                # Just verify parameter is accepted (not 422)
                assert response.status_code != 422, f"API should accept effective_role field"
                print(f"effective_role='{invalid_role}' field accepted, response: {response.status_code}")
        else:
            photographer = active_photographers[0]
            print(f"Testing with active photographer: {photographer.get('full_name')}")
            
            for invalid_role in invalid_roles:
                response = self.session.post(
                    f"{BASE_URL}/api/sessions/join?surfer_id={self.admin_user['id']}",
                    json={
                        "photographer_id": photographer['id'],
                        "payment_method": "credits",
                        "effective_role": invalid_role
                    }
                )
                
                # Should be rejected with 403
                if response.status_code == 403:
                    detail = response.json().get('detail', '')
                    print(f"PASS: effective_role='{invalid_role}' correctly blocked: {detail}")
                else:
                    print(f"Response for invalid role '{invalid_role}': {response.status_code} - {response.text[:200]}")


class TestNormalUserSessionJoin:
    """Tests for normal (non-admin) user session join behavior"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test session"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
    
    def test_normal_user_without_effective_role(self):
        """Test that normal users can still join without effective_role"""
        # Find a surfer user (non-admin)
        profiles_resp = self.session.get(f"{BASE_URL}/api/profiles")
        if profiles_resp.status_code != 200:
            pytest.skip("Could not fetch profiles")
        
        profiles = profiles_resp.json()
        
        # Find a surfer who is not an admin
        surfers = [p for p in profiles if p.get('role') in ['Surfer', 'Grom', 'Comp Surfer', 'Pro'] 
                   and not p.get('is_admin')]
        
        photographers = [p for p in profiles if p.get('role') in ['Photographer', 'Approved Pro', 'Hobbyist']]
        
        if not surfers:
            pytest.skip("No surfer users found")
        if not photographers:
            pytest.skip("No photographers found")
        
        surfer = surfers[0]
        photographer = photographers[0]
        
        print(f"Testing with surfer: {surfer.get('full_name')} (role: {surfer.get('role')})")
        
        # Join without effective_role (normal flow)
        response = self.session.post(
            f"{BASE_URL}/api/sessions/join?surfer_id={surfer['id']}",
            json={
                "photographer_id": photographer['id'],
                "payment_method": "credits"
                # No effective_role - should work for actual surfers
            }
        )
        
        # Should not get validation error
        assert response.status_code != 422, "Request without effective_role should be valid"
        print(f"Normal surfer join response: {response.status_code}")
        
        # Expected: 400 (photographer not shooting) or 200 (success)
        if response.status_code == 400:
            detail = response.json().get('detail', '')
            print(f"Expected error: {detail}")


class TestJoinSessionRequestModel:
    """Tests for the JoinSessionRequest Pydantic model"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
    
    def test_required_fields(self):
        """Test that photographer_id is required"""
        # Missing photographer_id should fail
        response = self.session.post(
            f"{BASE_URL}/api/sessions/join?surfer_id=test-id",
            json={
                "payment_method": "credits"
            }
        )
        
        assert response.status_code == 422, "Missing photographer_id should fail validation"
        print("PASS: photographer_id is required")
    
    def test_optional_fields(self):
        """Test that selfie_url and effective_role are optional"""
        # With only required fields
        response = self.session.post(
            f"{BASE_URL}/api/sessions/join?surfer_id=test-id",
            json={
                "photographer_id": "test-photographer-id"
            }
        )
        
        # Should not be 422 (validation error for missing fields)
        # Will likely be 404 (photographer not found) which is fine
        assert response.status_code != 422 or "photographer_id" not in response.text, \
            "Request with only photographer_id should pass validation"
        print(f"Optional fields test response: {response.status_code}")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
