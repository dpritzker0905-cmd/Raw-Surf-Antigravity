"""
Test suite for elite_tier field in ProfileResponse and Trophy badge functionality
Iteration 122 - Testing:
1. P0: /api/profiles/{id} returns elite_tier field
2. P1: Profile shows Trophy 'Competes' badge for grom_rising elite_tier
3. P1: GalleryItemModal extraction works correctly
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://raw-surf-os.preview.emergentagent.com')

# Test Grom profile ID from the request
TEST_GROM_PROFILE_ID = "fe32f32d-bf4e-4fb7-b78e-04059811ea34"


class TestEliteTierAPI:
    """Test elite_tier field in profile API responses"""
    
    def test_profile_response_contains_elite_tier_field(self):
        """P0: Verify /api/profiles/{id} returns elite_tier field in JSON response"""
        response = requests.get(f"{BASE_URL}/api/profiles/{TEST_GROM_PROFILE_ID}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        
        # Verify elite_tier field exists in response
        assert "elite_tier" in data, "elite_tier field missing from profile response"
        
        # Verify other expected fields are present
        assert "id" in data
        assert "full_name" in data
        assert "role" in data
        assert data["role"] == "Grom", f"Expected role 'Grom', got {data['role']}"
        
        print(f"✓ Profile {TEST_GROM_PROFILE_ID} has elite_tier field: {data['elite_tier']}")
    
    def test_profile_response_structure(self):
        """Verify ProfileResponse model structure matches expected fields"""
        response = requests.get(f"{BASE_URL}/api/profiles/{TEST_GROM_PROFILE_ID}")
        
        assert response.status_code == 200
        data = response.json()
        
        # Check all expected fields from ProfileResponse model
        expected_fields = [
            "id", "user_id", "email", "full_name", "role", 
            "subscription_tier", "elite_tier", "credit_balance",
            "bio", "avatar_url", "is_verified", "is_live", "is_private",
            "is_approved_pro", "location", "company_name", "portfolio_url",
            "instagram_url", "website_url", "hourly_rate", "session_price",
            "accepts_donations", "skill_level", "stance", "home_break",
            "created_at", "on_demand_active", "on_demand_hourly_rate"
        ]
        
        for field in expected_fields:
            assert field in data, f"Missing field: {field}"
        
        print(f"✓ All {len(expected_fields)} expected fields present in ProfileResponse")
    
    def test_elite_tier_can_be_null(self):
        """Verify elite_tier can be null (default state)"""
        response = requests.get(f"{BASE_URL}/api/profiles/{TEST_GROM_PROFILE_ID}")
        
        assert response.status_code == 200
        data = response.json()
        
        # elite_tier should be null or a valid string
        elite_tier = data.get("elite_tier")
        assert elite_tier is None or isinstance(elite_tier, str), \
            f"elite_tier should be null or string, got {type(elite_tier)}"
        
        print(f"✓ elite_tier value is valid: {elite_tier}")
    
    def test_profile_search_endpoint(self):
        """Verify profile search endpoint works"""
        response = requests.get(f"{BASE_URL}/api/profiles/search?q=grom&limit=5")
        
        assert response.status_code == 200
        data = response.json()
        
        assert isinstance(data, list), "Search should return a list"
        assert len(data) > 0, "Should find at least one grom profile"
        
        # Verify search result structure
        first_result = data[0]
        assert "id" in first_result
        assert "full_name" in first_result
        assert "role" in first_result
        
        print(f"✓ Profile search returned {len(data)} results")
    
    def test_profile_not_found(self):
        """Verify 404 for non-existent profile"""
        fake_id = "00000000-0000-0000-0000-000000000000"
        response = requests.get(f"{BASE_URL}/api/profiles/{fake_id}")
        
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        print("✓ Non-existent profile returns 404")


class TestGalleryEndpoints:
    """Test gallery endpoints to verify GalleryItemModal extraction works"""
    
    def test_gallery_photographer_endpoint(self):
        """Verify gallery photographer endpoint exists"""
        # Use a known photographer ID or test with the grom profile
        response = requests.get(f"{BASE_URL}/api/gallery/photographer/{TEST_GROM_PROFILE_ID}?viewer_id={TEST_GROM_PROFILE_ID}")
        
        # Should return 200 with empty array or gallery items
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert isinstance(data, list), "Gallery should return a list"
        
        print(f"✓ Gallery endpoint returned {len(data)} items")
    
    def test_galleries_endpoint(self):
        """Verify galleries endpoint exists"""
        response = requests.get(f"{BASE_URL}/api/galleries/photographer/{TEST_GROM_PROFILE_ID}")
        
        # Should return 200 with empty array or galleries
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert isinstance(data, list), "Galleries should return a list"
        
        print(f"✓ Galleries endpoint returned {len(data)} galleries")


class TestHealthCheck:
    """Basic health checks"""
    
    def test_api_health(self):
        """Verify API is responding"""
        response = requests.get(f"{BASE_URL}/api/health")
        
        assert response.status_code == 200, f"Health check failed: {response.status_code}"
        print("✓ API health check passed")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
