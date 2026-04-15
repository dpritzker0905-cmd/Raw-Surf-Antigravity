"""
Backend tests for iteration 55:
- Gamification API endpoints (badges, XP)
- Gallery pricing API with session participant info
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://raw-surf-os.preview.emergentagent.com')


class TestGamificationAPI:
    """Tests for gamification endpoints - badges and XP"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Get a test user ID"""
        # Login to get user info
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "kelly@surf.com",
            "password": "test-shaka"
        })
        if response.status_code == 200:
            self.user_id = response.json().get('id')
            self.user_data = response.json()
        else:
            pytest.skip("Login failed - cannot test gamification")
    
    def test_gamification_user_stats_endpoint_exists(self):
        """Test GET /api/gamification/user/{user_id} returns valid response"""
        response = requests.get(f"{BASE_URL}/api/gamification/user/{self.user_id}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        # Validate response structure
        assert "total_xp" in data, "Missing total_xp field"
        assert "badges" in data, "Missing badges field"
        assert "recent_xp_transactions" in data, "Missing recent_xp_transactions field"
        
        # Validate types
        assert isinstance(data["total_xp"], int), "total_xp should be integer"
        assert isinstance(data["badges"], list), "badges should be list"
        assert isinstance(data["recent_xp_transactions"], list), "recent_xp_transactions should be list"
        
        print(f"Gamification stats: total_xp={data['total_xp']}, badges count={len(data['badges'])}")
    
    def test_gamification_with_photographer_user(self):
        """Test gamification endpoint with a photographer user"""
        # Get photographer profiles
        profiles_response = requests.get(f"{BASE_URL}/api/profiles")
        assert profiles_response.status_code == 200
        
        profiles = profiles_response.json()
        photographer = next((p for p in profiles if p.get('role') == 'Photographer'), None)
        
        if photographer:
            response = requests.get(f"{BASE_URL}/api/gamification/user/{photographer['id']}")
            assert response.status_code == 200
            
            data = response.json()
            assert "total_xp" in data
            assert "badges" in data
            print(f"Photographer {photographer['full_name']} - XP: {data['total_xp']}, Badges: {len(data['badges'])}")
    
    def test_gamification_nonexistent_user(self):
        """Test gamification endpoint with non-existent user returns valid (empty) response"""
        fake_user_id = "00000000-0000-0000-0000-000000000000"
        response = requests.get(f"{BASE_URL}/api/gamification/user/{fake_user_id}")
        
        # Should still return 200 with empty data
        assert response.status_code == 200
        data = response.json()
        assert data["total_xp"] == 0
        assert data["badges"] == []


class TestGalleryPricingAPI:
    """Tests for gallery pricing endpoint with session participant info"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Get test user and gallery item"""
        # Login
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "kelly@surf.com",
            "password": "test-shaka"
        })
        if response.status_code == 200:
            self.user_id = response.json().get('id')
        else:
            pytest.skip("Login failed")
        
        # Get photographer
        profiles = requests.get(f"{BASE_URL}/api/profiles").json()
        self.photographer = next((p for p in profiles if p.get('role') == 'Photographer'), None)
        
        if self.photographer:
            # Get gallery items
            gallery_response = requests.get(
                f"{BASE_URL}/api/gallery/photographer/{self.photographer['id']}?viewer_id={self.user_id}"
            )
            if gallery_response.status_code == 200:
                gallery = gallery_response.json()
                if gallery:
                    self.gallery_item_id = gallery[0]['id']
                else:
                    self.gallery_item_id = None
            else:
                self.gallery_item_id = None
    
    def test_gallery_pricing_endpoint_structure(self):
        """Test GET /api/gallery/item/{item_id}/pricing returns correct structure"""
        if not self.gallery_item_id:
            pytest.skip("No gallery items available")
        
        response = requests.get(
            f"{BASE_URL}/api/gallery/item/{self.gallery_item_id}/pricing?viewer_id={self.user_id}"
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        
        # Validate base structure
        assert "item_id" in data, "Missing item_id"
        assert "media_type" in data, "Missing media_type"
        assert "pricing" in data, "Missing pricing"
        assert "preview_url" in data, "Missing preview_url"
        
        # Validate session participant fields (NEW for this iteration)
        assert "is_session_participant" in data, "Missing is_session_participant field"
        assert "session_photos_included" in data, "Missing session_photos_included field"
        assert "photos_already_claimed" in data, "Missing photos_already_claimed field"
        assert "is_free_from_session" in data, "Missing is_free_from_session field"
        assert "session_price_override" in data, "Missing session_price_override field"
        
        print(f"Gallery pricing includes session participant info: is_session_participant={data['is_session_participant']}")
    
    def test_gallery_pricing_tiers(self):
        """Test that pricing tiers are returned correctly"""
        if not self.gallery_item_id:
            pytest.skip("No gallery items available")
        
        response = requests.get(
            f"{BASE_URL}/api/gallery/item/{self.gallery_item_id}/pricing?viewer_id={self.user_id}"
        )
        
        assert response.status_code == 200
        data = response.json()
        
        pricing = data.get("pricing", {})
        assert "type" in pricing, "Missing pricing type"
        assert "tiers" in pricing, "Missing pricing tiers"
        
        tiers = pricing.get("tiers", [])
        assert len(tiers) >= 1, "Should have at least one pricing tier"
        
        # Validate tier structure
        for tier in tiers:
            assert "tier" in tier, "Tier missing 'tier' field"
            assert "label" in tier, "Tier missing 'label' field"
            assert "price" in tier, "Tier missing 'price' field"
            assert "is_purchased" in tier, "Tier missing 'is_purchased' field"
            # Session deal indicator (NEW)
            assert "is_session_deal" in tier, "Tier missing 'is_session_deal' field"
        
        print(f"Gallery pricing tiers: {[t['tier'] for t in tiers]}")
    
    def test_gallery_pricing_without_viewer(self):
        """Test pricing endpoint works without viewer_id"""
        if not self.gallery_item_id:
            pytest.skip("No gallery items available")
        
        response = requests.get(
            f"{BASE_URL}/api/gallery/item/{self.gallery_item_id}/pricing"
        )
        
        assert response.status_code == 200
        data = response.json()
        
        # Should still return full structure
        assert "is_session_participant" in data
        assert data["is_session_participant"] == False, "Without viewer_id, should not be session participant"


class TestProfileWithGamification:
    """Tests for profile endpoint including gamification stats"""
    
    def test_profile_loads(self):
        """Test that profile endpoint works"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "kelly@surf.com",
            "password": "test-shaka"
        })
        assert response.status_code == 200
        user_id = response.json().get('id')
        
        profile_response = requests.get(f"{BASE_URL}/api/profiles/{user_id}")
        assert profile_response.status_code == 200
        
        profile = profile_response.json()
        assert "id" in profile
        assert "full_name" in profile
        assert "role" in profile
        
        print(f"Profile loaded: {profile['full_name']} ({profile['role']})")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
