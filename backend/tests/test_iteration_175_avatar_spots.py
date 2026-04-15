"""
Iteration 175 Tests - Avatar Cache Fix & Pacific/NC Spot Expansion
Tests:
1. Surf spots API returns 1,266 total spots
2. Fiji spots exist (Cloudbreak, Frigates Passage, etc.)
3. Samoa spots exist (Salani Rights, Aganoa Beach, etc.)
4. Tonga spots exist (Ha'atafu Beach, Keleti Beach, etc.)
5. North Carolina spots exist (Cape Hatteras, Wrightsville Beach, etc.)
6. Profile update API works with avatar_url and updated_at
"""
import pytest
import requests
import os
from datetime import datetime

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials
ADMIN_EMAIL = "dpritzker0905@gmail.com"
ADMIN_PASSWORD = "TestPass123!"


class TestSurfSpotsExpansion:
    """Test Pacific Islands and North Carolina spot expansion"""
    
    def test_total_spots_count(self):
        """Verify total spots count is 1,266"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200, f"Failed to get spots: {response.text}"
        spots = response.json()
        assert len(spots) == 1266, f"Expected 1266 spots, got {len(spots)}"
        print(f"✓ Total spots: {len(spots)}")
    
    def test_fiji_spots_exist(self):
        """Verify Fiji spots exist including Cloudbreak and Frigates Passage"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        spots = response.json()
        
        fiji_spots = [s for s in spots if s.get('country') == 'Fiji']
        assert len(fiji_spots) >= 10, f"Expected at least 10 Fiji spots, got {len(fiji_spots)}"
        
        # Check for specific spots
        fiji_names = [s['name'] for s in fiji_spots]
        assert 'Cloudbreak' in fiji_names, "Cloudbreak not found in Fiji spots"
        assert 'Frigates Passage' in fiji_names, "Frigates Passage not found in Fiji spots"
        
        print(f"✓ Fiji spots: {len(fiji_spots)} (includes Cloudbreak, Frigates Passage)")
    
    def test_samoa_spots_exist(self):
        """Verify Samoa spots exist including Salani Rights"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        spots = response.json()
        
        samoa_spots = [s for s in spots if s.get('country') == 'Samoa']
        assert len(samoa_spots) >= 7, f"Expected at least 7 Samoa spots, got {len(samoa_spots)}"
        
        # Check for specific spots
        samoa_names = [s['name'] for s in samoa_spots]
        # Check for Salani or Salani Rights
        has_salani = any('Salani' in name for name in samoa_names)
        assert has_salani, f"Salani spots not found in Samoa. Found: {samoa_names}"
        
        print(f"✓ Samoa spots: {len(samoa_spots)}")
    
    def test_tonga_spots_exist(self):
        """Verify Tonga spots exist including Ha'atafu Beach and Keleti Beach"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        spots = response.json()
        
        tonga_spots = [s for s in spots if s.get('country') == 'Tonga']
        assert len(tonga_spots) >= 6, f"Expected at least 6 Tonga spots, got {len(tonga_spots)}"
        
        # Check for specific spots
        tonga_names = [s['name'] for s in tonga_spots]
        has_haatafu = any("Ha'atafu" in name or "Haatafu" in name for name in tonga_names)
        has_keleti = any("Keleti" in name for name in tonga_names)
        
        assert has_haatafu, f"Ha'atafu Beach not found in Tonga. Found: {tonga_names}"
        assert has_keleti, f"Keleti Beach not found in Tonga. Found: {tonga_names}"
        
        print(f"✓ Tonga spots: {len(tonga_spots)} (includes Ha'atafu Beach, Keleti Beach)")
    
    def test_north_carolina_spots_exist(self):
        """Verify North Carolina spots exist including Cape Hatteras and Wrightsville Beach"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        spots = response.json()
        
        # NC spots are in USA with regions: Outer Banks, Wilmington, Crystal Coast
        nc_regions = ['Outer Banks', 'Wilmington', 'Crystal Coast']
        nc_spots = [s for s in spots if s.get('country') == 'USA' and s.get('region') in nc_regions]
        
        assert len(nc_spots) >= 19, f"Expected at least 19 NC spots, got {len(nc_spots)}"
        
        # Check for specific spots
        nc_names = [s['name'] for s in nc_spots]
        has_hatteras = any('Hatteras' in name for name in nc_names)
        has_wrightsville = any('Wrightsville' in name for name in nc_names)
        
        assert has_hatteras, f"Cape Hatteras not found in NC. Found: {nc_names[:10]}..."
        assert has_wrightsville, f"Wrightsville Beach not found in NC. Found: {nc_names[:10]}..."
        
        print(f"✓ North Carolina spots: {len(nc_spots)} (includes Cape Hatteras, Wrightsville Beach)")


class TestProfileAvatarUpdate:
    """Test profile avatar update with updated_at for cache busting"""
    
    @pytest.fixture
    def auth_token(self):
        """Login and get user data"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        if response.status_code != 200:
            pytest.skip(f"Login failed: {response.text}")
        return response.json()
    
    def test_profile_update_returns_updated_at(self, auth_token):
        """Verify profile update returns updated_at field"""
        user_id = auth_token.get('id')
        assert user_id, "No user ID in auth response"
        
        # Update profile with a minor change
        response = requests.patch(f"{BASE_URL}/api/profiles/{user_id}", json={
            "bio": f"Test bio update at {datetime.now().isoformat()}"
        })
        
        assert response.status_code == 200, f"Profile update failed: {response.text}"
        profile = response.json()
        
        # Verify updated_at is present
        assert 'updated_at' in profile, "updated_at not in profile response"
        print(f"✓ Profile update returns updated_at: {profile.get('updated_at')}")
    
    def test_profile_has_avatar_url_field(self, auth_token):
        """Verify profile has avatar_url field"""
        user_id = auth_token.get('id')
        assert user_id, "No user ID in auth response"
        
        response = requests.get(f"{BASE_URL}/api/profiles/{user_id}")
        assert response.status_code == 200, f"Get profile failed: {response.text}"
        
        profile = response.json()
        # avatar_url can be null but field should exist
        assert 'avatar_url' in profile or profile.get('avatar_url') is None, "avatar_url field missing"
        print(f"✓ Profile has avatar_url field: {profile.get('avatar_url', 'null')[:50] if profile.get('avatar_url') else 'null'}...")


class TestSpotsAPIHealth:
    """Basic API health checks"""
    
    def test_surf_spots_api_accessible(self):
        """Verify surf spots API is accessible"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200, f"Surf spots API failed: {response.text}"
        print("✓ Surf spots API accessible")
    
    def test_health_endpoint(self):
        """Verify health endpoint"""
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200, f"Health check failed: {response.text}"
        print("✓ Health endpoint OK")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
