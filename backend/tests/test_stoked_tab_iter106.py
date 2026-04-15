"""
Test Stoked Tab API - Iteration 106
Tests the /api/stoked/{user_id} endpoint for surfer users
"""

import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://raw-surf-os.preview.emergentagent.com')

# Test credentials
SURFER_EMAIL = "testsurfer@gmail.com"
SURFER_PASSWORD = "test123456"
PHOTOGRAPHER_EMAIL = "photog@surf.com"
PHOTOGRAPHER_PASSWORD = "Test123!"


class TestStokedTabAPI:
    """Tests for the Stoked Tab API endpoint"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test fixtures"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
    
    def login_user(self, email, password):
        """Helper to login and get user data"""
        response = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": email,
            "password": password
        })
        if response.status_code == 200:
            return response.json()
        return None
    
    def test_stoked_endpoint_returns_data_for_surfer(self):
        """Test that /api/stoked/{user_id} returns correct data for surfer users"""
        # Login as surfer
        user_data = self.login_user(SURFER_EMAIL, SURFER_PASSWORD)
        assert user_data is not None, "Failed to login as surfer"
        assert user_data.get("role") == "Surfer", f"Expected Surfer role, got {user_data.get('role')}"
        
        profile_id = user_data.get("id")
        assert profile_id is not None, "Profile ID not found in login response"
        
        # Call stoked endpoint
        response = self.session.get(f"{BASE_URL}/api/stoked/{profile_id}")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        
        # Verify is_eligible is True for surfer
        assert data.get("is_eligible") == True, "Surfer should be eligible for Stoked tab"
        
        # Verify required fields exist
        assert "user_id" in data, "user_id field missing"
        assert "role" in data, "role field missing"
        assert "credits" in data, "credits field missing"
        assert "stoke_level" in data, "stoke_level field missing"
        assert "supporters" in data, "supporters field missing"
        assert "gear_purchases" in data, "gear_purchases field missing"
        assert "session_purchases" in data, "session_purchases field missing"
        assert "credit_uses" in data, "credit_uses field missing"
        
        print(f"✅ Stoked endpoint returns correct data for surfer user")
    
    def test_stoked_endpoint_credits_structure(self):
        """Test that credits object has correct structure"""
        user_data = self.login_user(SURFER_EMAIL, SURFER_PASSWORD)
        profile_id = user_data.get("id")
        
        response = self.session.get(f"{BASE_URL}/api/stoked/{profile_id}")
        data = response.json()
        
        credits = data.get("credits", {})
        assert "total_received" in credits, "total_received missing from credits"
        assert "available_balance" in credits, "available_balance missing from credits"
        assert "times_supported" in credits, "times_supported missing from credits"
        
        # Verify types
        assert isinstance(credits["total_received"], (int, float)), "total_received should be numeric"
        assert isinstance(credits["available_balance"], (int, float)), "available_balance should be numeric"
        assert isinstance(credits["times_supported"], int), "times_supported should be integer"
        
        print(f"✅ Credits structure is correct: {credits}")
    
    def test_stoked_endpoint_stoke_level_structure(self):
        """Test that stoke_level object has correct structure"""
        user_data = self.login_user(SURFER_EMAIL, SURFER_PASSWORD)
        profile_id = user_data.get("id")
        
        response = self.session.get(f"{BASE_URL}/api/stoked/{profile_id}")
        data = response.json()
        
        stoke_level = data.get("stoke_level", {})
        assert "current" in stoke_level, "current level missing"
        assert "next" in stoke_level, "next level missing"
        assert "progress_percent" in stoke_level, "progress_percent missing"
        assert "credits_to_next" in stoke_level, "credits_to_next missing"
        
        # Verify current level structure
        current = stoke_level.get("current", {})
        assert "name" in current, "current level name missing"
        assert "emoji" in current, "current level emoji missing"
        assert "min" in current, "current level min missing"
        
        print(f"✅ Stoke level structure is correct: {stoke_level['current']['name']}")
    
    def test_stoked_endpoint_supporters_structure(self):
        """Test that supporters object has correct structure"""
        user_data = self.login_user(SURFER_EMAIL, SURFER_PASSWORD)
        profile_id = user_data.get("id")
        
        response = self.session.get(f"{BASE_URL}/api/stoked/{profile_id}")
        data = response.json()
        
        supporters = data.get("supporters", {})
        assert "total_count" in supporters, "total_count missing from supporters"
        assert "list" in supporters, "list missing from supporters"
        assert isinstance(supporters["list"], list), "supporters list should be an array"
        
        print(f"✅ Supporters structure is correct: {supporters['total_count']} supporters")
    
    def test_stoked_endpoint_purchases_structure(self):
        """Test that gear_purchases and session_purchases have correct structure"""
        user_data = self.login_user(SURFER_EMAIL, SURFER_PASSWORD)
        profile_id = user_data.get("id")
        
        response = self.session.get(f"{BASE_URL}/api/stoked/{profile_id}")
        data = response.json()
        
        # Gear purchases
        gear = data.get("gear_purchases", {})
        assert "total_spent" in gear, "total_spent missing from gear_purchases"
        assert "count" in gear, "count missing from gear_purchases"
        assert "list" in gear, "list missing from gear_purchases"
        
        # Session purchases
        sessions = data.get("session_purchases", {})
        assert "total_spent" in sessions, "total_spent missing from session_purchases"
        assert "count" in sessions, "count missing from session_purchases"
        assert "list" in sessions, "list missing from session_purchases"
        
        print(f"✅ Purchases structure is correct: {gear['count']} gear, {sessions['count']} sessions")
    
    def test_stoked_endpoint_credit_uses_structure(self):
        """Test that credit_uses array has correct structure"""
        user_data = self.login_user(SURFER_EMAIL, SURFER_PASSWORD)
        profile_id = user_data.get("id")
        
        response = self.session.get(f"{BASE_URL}/api/stoked/{profile_id}")
        data = response.json()
        
        credit_uses = data.get("credit_uses", [])
        assert isinstance(credit_uses, list), "credit_uses should be an array"
        assert len(credit_uses) > 0, "credit_uses should not be empty"
        
        # Verify each credit use has required fields
        for use in credit_uses:
            assert "icon" in use, "icon missing from credit use"
            assert "title" in use, "title missing from credit use"
            assert "description" in use, "description missing from credit use"
        
        print(f"✅ Credit uses structure is correct: {len(credit_uses)} uses available")
    
    def test_stoked_endpoint_not_eligible_for_photographer(self):
        """Test that /api/stoked/{user_id} returns is_eligible=false for photographer"""
        # Login as photographer
        user_data = self.login_user(PHOTOGRAPHER_EMAIL, PHOTOGRAPHER_PASSWORD)
        assert user_data is not None, "Failed to login as photographer"
        assert user_data.get("role") == "Photographer", f"Expected Photographer role, got {user_data.get('role')}"
        
        profile_id = user_data.get("id")
        
        # Call stoked endpoint
        response = self.session.get(f"{BASE_URL}/api/stoked/{profile_id}")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        
        # Verify is_eligible is False for photographer
        assert data.get("is_eligible") == False, "Photographer should NOT be eligible for Stoked tab"
        assert "message" in data, "Message should be present for non-eligible users"
        
        print(f"✅ Photographer correctly marked as not eligible: {data.get('message')}")
    
    def test_stoked_endpoint_returns_404_for_invalid_user(self):
        """Test that /api/stoked/{user_id} returns 404 for non-existent user"""
        fake_id = "00000000-0000-0000-0000-000000000000"
        
        response = self.session.get(f"{BASE_URL}/api/stoked/{fake_id}")
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        
        print(f"✅ Returns 404 for non-existent user")
    
    def test_stoked_endpoint_role_flags(self):
        """Test that role flags are correctly set"""
        user_data = self.login_user(SURFER_EMAIL, SURFER_PASSWORD)
        profile_id = user_data.get("id")
        
        response = self.session.get(f"{BASE_URL}/api/stoked/{profile_id}")
        data = response.json()
        
        # For a Surfer role, is_surfer should be True
        assert data.get("is_surfer") == True, "is_surfer should be True for Surfer role"
        assert data.get("is_grom") == False, "is_grom should be False for Surfer role"
        assert data.get("is_competitive") == False, "is_competitive should be False for Surfer role"
        assert data.get("is_pro") == False, "is_pro should be False for Surfer role"
        
        print(f"✅ Role flags are correctly set for Surfer")


class TestStokedTabIntegration:
    """Integration tests for Stoked Tab with other endpoints"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test fixtures"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
    
    def test_profile_endpoint_exists(self):
        """Test that profile endpoint works for surfer user"""
        # Login
        response = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": SURFER_EMAIL,
            "password": SURFER_PASSWORD
        })
        user_data = response.json()
        profile_id = user_data.get("id")
        
        # Get profile
        response = self.session.get(f"{BASE_URL}/api/profiles/{profile_id}")
        assert response.status_code == 200, f"Profile endpoint failed: {response.status_code}"
        
        profile = response.json()
        assert profile.get("role") == "Surfer", "Profile role should be Surfer"
        
        print(f"✅ Profile endpoint works for surfer user")
    
    def test_impact_public_endpoint_for_surfer(self):
        """Test that impact/public endpoint works for surfer (should return is_photographer=false)"""
        response = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": SURFER_EMAIL,
            "password": SURFER_PASSWORD
        })
        user_data = response.json()
        profile_id = user_data.get("id")
        
        # Get impact score
        response = self.session.get(f"{BASE_URL}/api/impact/public/{profile_id}")
        assert response.status_code == 200, f"Impact endpoint failed: {response.status_code}"
        
        data = response.json()
        # Surfer should not be a photographer
        assert data.get("is_photographer") == False, "Surfer should not be marked as photographer"
        
        print(f"✅ Impact/public endpoint correctly identifies surfer as non-photographer")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
