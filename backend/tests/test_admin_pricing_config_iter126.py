"""
Test Admin Pricing Configuration - God Mode Pricing Editor
Tests for iteration 126: Real-time pricing configuration editing

Features tested:
- GET /api/subscriptions/config - Public pricing endpoint
- GET /api/admin/pricing/config - Admin pricing config with metadata
- POST /api/admin/pricing/update - Update pricing configuration
- POST /api/admin/pricing/reset - Reset to defaults
- GET /api/admin/pricing/history - Pricing version history
"""

import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials from review request
ADMIN_EMAIL = "dpritzker0905@gmail.com"
ADMIN_PASSWORD = "test123"


def get_admin_id():
    """Helper to get admin user ID by logging in"""
    response = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": ADMIN_EMAIL,
        "password": ADMIN_PASSWORD
    })
    if response.status_code != 200:
        return None
    
    data = response.json()
    # Login returns user directly, not wrapped in 'user' object
    admin_id = data.get("id")
    if not admin_id or not data.get("is_admin"):
        return None
    
    return admin_id


class TestPublicPricingConfig:
    """Test public pricing configuration endpoint"""
    
    def test_public_pricing_config_returns_200(self):
        """GET /api/subscriptions/config should return 200"""
        response = requests.get(f"{BASE_URL}/api/subscriptions/config")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        print("PASS: Public pricing config returns 200")
    
    def test_public_pricing_config_structure(self):
        """Verify pricing config has correct structure"""
        response = requests.get(f"{BASE_URL}/api/subscriptions/config")
        assert response.status_code == 200
        
        data = response.json()
        assert "pricing" in data, "Response should have 'pricing' key"
        assert "credit_rate" in data, "Response should have 'credit_rate' key"
        assert "currency" in data, "Response should have 'currency' key"
        
        assert data["credit_rate"] == 1, "Credit rate should be 1 (1:1 ratio)"
        assert data["currency"] == "USD", "Currency should be USD"
        print("PASS: Public pricing config has correct structure")
    
    def test_public_pricing_has_all_5_roles(self):
        """Verify pricing includes all 5 role tiers"""
        response = requests.get(f"{BASE_URL}/api/subscriptions/config")
        assert response.status_code == 200
        
        pricing = response.json()["pricing"]
        expected_roles = ["surfer", "grom", "photographer", "grom_parent", "hobbyist"]
        
        for role in expected_roles:
            assert role in pricing, f"Missing role: {role}"
            assert "role_label" in pricing[role], f"Role {role} missing role_label"
            assert "tiers" in pricing[role], f"Role {role} missing tiers"
        
        print(f"PASS: All 5 roles present: {expected_roles}")
    
    def test_surfer_pricing_tiers(self):
        """Verify Surfer has correct pricing: $0/$5/$10"""
        response = requests.get(f"{BASE_URL}/api/subscriptions/config")
        pricing = response.json()["pricing"]
        
        surfer = pricing["surfer"]
        assert surfer["role_label"] == "Surfer"
        
        tiers = surfer["tiers"]
        assert tiers["tier_1"]["price"] == 0, "Surfer Free should be $0"
        assert tiers["tier_2"]["price"] == 5, "Surfer Basic should be $5"
        assert tiers["tier_3"]["price"] == 10, "Surfer Premium should be $10"
        
        print("PASS: Surfer pricing correct: $0/$5/$10")
    
    def test_grom_pricing_tiers(self):
        """Verify Grom has correct pricing: $0/$3/$8"""
        response = requests.get(f"{BASE_URL}/api/subscriptions/config")
        pricing = response.json()["pricing"]
        
        grom = pricing["grom"]
        assert grom["role_label"] == "Grom"
        
        tiers = grom["tiers"]
        assert tiers["tier_1"]["price"] == 0, "Grom Free should be $0"
        assert tiers["tier_2"]["price"] == 3, "Grom Basic should be $3"
        assert tiers["tier_3"]["price"] == 8, "Grom Premium should be $8"
        
        print("PASS: Grom pricing correct: $0/$3/$8")
    
    def test_photographer_pricing_tiers(self):
        """Verify Photographer has correct pricing: $18/$30 (no free tier)"""
        response = requests.get(f"{BASE_URL}/api/subscriptions/config")
        pricing = response.json()["pricing"]
        
        photographer = pricing["photographer"]
        assert photographer["role_label"] == "Photographer"
        
        tiers = photographer["tiers"]
        # Photographer has no tier_1 (free)
        assert "tier_1" not in tiers, "Photographer should not have free tier"
        assert tiers["tier_2"]["price"] == 18, "Photographer Basic should be $18"
        assert tiers["tier_3"]["price"] == 30, "Photographer Premium should be $30"
        
        print("PASS: Photographer pricing correct: $18/$30")
    
    def test_grom_parent_pricing_tiers(self):
        """Verify Grom Parent has correct pricing: $0/$5/$10"""
        response = requests.get(f"{BASE_URL}/api/subscriptions/config")
        pricing = response.json()["pricing"]
        
        grom_parent = pricing["grom_parent"]
        assert grom_parent["role_label"] == "Grom Parent"
        
        tiers = grom_parent["tiers"]
        assert tiers["tier_1"]["price"] == 0, "Grom Parent Free should be $0"
        assert tiers["tier_2"]["price"] == 5, "Grom Parent Basic should be $5"
        assert tiers["tier_3"]["price"] == 10, "Grom Parent Premium should be $10"
        
        print("PASS: Grom Parent pricing correct: $0/$5/$10")
    
    def test_hobbyist_pricing_tiers(self):
        """Verify Hobbyist has correct pricing: $0/$5 (no premium tier)"""
        response = requests.get(f"{BASE_URL}/api/subscriptions/config")
        pricing = response.json()["pricing"]
        
        hobbyist = pricing["hobbyist"]
        assert hobbyist["role_label"] == "Hobbyist"
        
        tiers = hobbyist["tiers"]
        assert tiers["tier_1"]["price"] == 0, "Hobbyist Free should be $0"
        assert tiers["tier_2"]["price"] == 5, "Hobbyist Basic should be $5"
        # Hobbyist has no tier_3 (premium)
        assert "tier_3" not in tiers, "Hobbyist should not have premium tier"
        
        print("PASS: Hobbyist pricing correct: $0/$5")


class TestAdminPricingConfig:
    """Test admin pricing configuration endpoints"""
    
    def test_admin_pricing_config_returns_200(self):
        """GET /api/admin/pricing/config should return 200 for admin"""
        admin_id = get_admin_id()
        if not admin_id:
            pytest.skip("Admin login failed")
        
        response = requests.get(f"{BASE_URL}/api/admin/pricing/config?admin_id={admin_id}")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        print("PASS: Admin pricing config returns 200")
    
    def test_admin_pricing_config_structure(self):
        """Verify admin pricing config has metadata"""
        admin_id = get_admin_id()
        if not admin_id:
            pytest.skip("Admin login failed")
        
        response = requests.get(f"{BASE_URL}/api/admin/pricing/config?admin_id={admin_id}")
        assert response.status_code == 200
        
        data = response.json()
        assert "pricing" in data, "Response should have 'pricing' key"
        assert "version" in data, "Response should have 'version' key"
        assert "is_from_db" in data, "Response should have 'is_from_db' key"
        
        print(f"PASS: Admin pricing config has metadata - version: {data['version']}, is_from_db: {data['is_from_db']}")
    
    def test_admin_pricing_config_has_all_roles(self):
        """Verify admin pricing config has all 5 roles"""
        admin_id = get_admin_id()
        if not admin_id:
            pytest.skip("Admin login failed")
        
        response = requests.get(f"{BASE_URL}/api/admin/pricing/config?admin_id={admin_id}")
        assert response.status_code == 200
        
        pricing = response.json()["pricing"]
        expected_roles = ["surfer", "grom", "photographer", "grom_parent", "hobbyist"]
        
        for role in expected_roles:
            assert role in pricing, f"Missing role: {role}"
        
        print(f"PASS: Admin pricing config has all 5 roles")
    
    def test_admin_pricing_config_requires_admin(self):
        """GET /api/admin/pricing/config should return 403 for non-admin"""
        # Use a fake/non-admin ID
        response = requests.get(f"{BASE_URL}/api/admin/pricing/config?admin_id=fake-non-admin-id")
        assert response.status_code in [403, 404], f"Expected 403/404 for non-admin, got {response.status_code}"
        print("PASS: Admin pricing config requires admin access")


class TestAdminPricingUpdate:
    """Test admin pricing update functionality"""
    
    def test_admin_pricing_update_returns_200(self):
        """POST /api/admin/pricing/update should return 200 for admin"""
        admin_id = get_admin_id()
        if not admin_id:
            pytest.skip("Admin login failed")
        
        # Get current pricing first
        current = requests.get(f"{BASE_URL}/api/admin/pricing/config?admin_id={admin_id}")
        current_version = current.json().get("version", 0)
        
        # Update with same data (no actual change)
        response = requests.post(
            f"{BASE_URL}/api/admin/pricing/update?admin_id={admin_id}",
            json={}  # Empty update - no changes
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data.get("success") == True, "Update should return success=true"
        assert data.get("version") == current_version + 1, "Version should increment"
        
        print(f"PASS: Admin pricing update returns 200, new version: {data.get('version')}")
    
    def test_admin_pricing_update_requires_admin(self):
        """POST /api/admin/pricing/update should return 403 for non-admin"""
        response = requests.post(
            f"{BASE_URL}/api/admin/pricing/update?admin_id=fake-non-admin-id",
            json={}
        )
        assert response.status_code in [403, 404], f"Expected 403/404 for non-admin, got {response.status_code}"
        print("PASS: Admin pricing update requires admin access")


class TestAdminPricingHistory:
    """Test admin pricing history endpoint"""
    
    def test_admin_pricing_history_returns_200(self):
        """GET /api/admin/pricing/history should return 200 for admin"""
        admin_id = get_admin_id()
        if not admin_id:
            pytest.skip("Admin login failed")
        
        response = requests.get(f"{BASE_URL}/api/admin/pricing/history?admin_id={admin_id}")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        print("PASS: Admin pricing history returns 200")
    
    def test_admin_pricing_history_structure(self):
        """Verify pricing history has correct structure"""
        admin_id = get_admin_id()
        if not admin_id:
            pytest.skip("Admin login failed")
        
        response = requests.get(f"{BASE_URL}/api/admin/pricing/history?admin_id={admin_id}")
        assert response.status_code == 200
        
        data = response.json()
        assert "history" in data, "Response should have 'history' key"
        
        history = data["history"]
        if len(history) > 0:
            entry = history[0]
            assert "version" in entry, "History entry should have 'version'"
            assert "is_active" in entry, "History entry should have 'is_active'"
            print(f"PASS: Pricing history has {len(history)} entries, latest version: {entry['version']}")
        else:
            print("PASS: Pricing history is empty (using defaults)")


class TestAdminPricingReset:
    """Test admin pricing reset functionality"""
    
    def test_admin_pricing_reset_returns_200(self):
        """POST /api/admin/pricing/reset should return 200 for admin"""
        admin_id = get_admin_id()
        if not admin_id:
            pytest.skip("Admin login failed")
        
        response = requests.post(f"{BASE_URL}/api/admin/pricing/reset?admin_id={admin_id}")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data.get("success") == True, "Reset should return success=true"
        assert "pricing" in data, "Reset should return pricing data"
        
        print(f"PASS: Admin pricing reset returns 200, version: {data.get('version')}")
    
    def test_admin_pricing_reset_restores_defaults(self):
        """Verify reset restores default pricing values"""
        admin_id = get_admin_id()
        if not admin_id:
            pytest.skip("Admin login failed")
        
        response = requests.post(f"{BASE_URL}/api/admin/pricing/reset?admin_id={admin_id}")
        assert response.status_code == 200
        
        pricing = response.json()["pricing"]
        
        # Verify default values
        assert pricing["surfer"]["tiers"]["tier_1"]["price"] == 0
        assert pricing["surfer"]["tiers"]["tier_2"]["price"] == 5
        assert pricing["surfer"]["tiers"]["tier_3"]["price"] == 10
        
        assert pricing["grom"]["tiers"]["tier_1"]["price"] == 0
        assert pricing["grom"]["tiers"]["tier_2"]["price"] == 3
        assert pricing["grom"]["tiers"]["tier_3"]["price"] == 8
        
        print("PASS: Reset restores default pricing values")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
