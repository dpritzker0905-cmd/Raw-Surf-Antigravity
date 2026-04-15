"""
Test Suite for Unified Photo Hub - Iteration 84
Tests:
1. On-Demand Settings - Full Gallery toggle and 100 photo limit
2. Bookings Manager - Resolution-tiered pricing (Web/Standard/High)
3. Pricing API endpoints for both On-Demand and General Bookings
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials from iteration 83
TEST_PRO_EMAIL = "kelly@surf.com"
TEST_PRO_PASSWORD = "test-shaka"
TEST_ONDEMAND_PRO_ID = "21e9ac18-72de-4bec-a85d-72f5c4687771"


class TestOnDemandSettingsAPI:
    """Test On-Demand Settings API - Full Gallery toggle and photos included"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test session"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        # Use the known Approved Pro photographer ID
        self.user_id = TEST_ONDEMAND_PRO_ID
    
    def test_get_on_demand_settings_returns_full_gallery_field(self):
        """GET /api/photographer/{id}/on-demand-settings returns on_demand_full_gallery field"""
        response = self.session.get(f"{BASE_URL}/api/photographer/{self.user_id}/on-demand-settings")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        # Verify on_demand_full_gallery field exists
        assert "on_demand_full_gallery" in data, "Missing on_demand_full_gallery field"
        assert isinstance(data["on_demand_full_gallery"], bool), "on_demand_full_gallery should be boolean"
        
        # Verify on_demand_photos_included field exists
        assert "on_demand_photos_included" in data, "Missing on_demand_photos_included field"
        assert isinstance(data["on_demand_photos_included"], int), "on_demand_photos_included should be int"
        
        print(f"✓ on_demand_full_gallery: {data['on_demand_full_gallery']}")
        print(f"✓ on_demand_photos_included: {data['on_demand_photos_included']}")
    
    def test_post_on_demand_settings_accepts_full_gallery(self):
        """POST /api/photographer/{id}/on-demand-settings accepts on_demand_full_gallery"""
        # First, get current settings
        get_response = self.session.get(f"{BASE_URL}/api/photographer/{self.user_id}/on-demand-settings")
        current_settings = get_response.json() if get_response.status_code == 200 else {}
        
        # Toggle full gallery to True
        payload = {
            "base_rate": current_settings.get("base_rate", 75),
            "peak_pricing_enabled": current_settings.get("peak_pricing_enabled", False),
            "peak_multiplier": current_settings.get("peak_multiplier", 1.5),
            "claimed_spots": current_settings.get("claimed_spots", []),
            "on_demand_photos_included": 50,  # Test higher value (removed 20 limit)
            "on_demand_full_gallery": True
        }
        
        response = self.session.post(f"{BASE_URL}/api/photographer/{self.user_id}/on-demand-settings", json=payload)
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert data.get("success") == True, "Expected success: true"
        
        # Verify the change persisted
        verify_response = self.session.get(f"{BASE_URL}/api/photographer/{self.user_id}/on-demand-settings")
        verify_data = verify_response.json()
        
        assert verify_data["on_demand_full_gallery"] == True, "Full gallery should be True"
        assert verify_data["on_demand_photos_included"] == 50, "Photos included should be 50"
        
        print("✓ Full gallery toggle saved successfully")
        print(f"✓ Photos included set to 50 (above old 20 limit)")
    
    def test_on_demand_settings_allows_100_photos(self):
        """Test that on_demand_photos_included can be set to 100 (removed 20 limit)"""
        payload = {
            "base_rate": 75,
            "peak_pricing_enabled": False,
            "peak_multiplier": 1.5,
            "claimed_spots": [],
            "on_demand_photos_included": 100,  # Max value per new requirement
            "on_demand_full_gallery": False
        }
        
        response = self.session.post(f"{BASE_URL}/api/photographer/{self.user_id}/on-demand-settings", json=payload)
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        # Verify
        verify_response = self.session.get(f"{BASE_URL}/api/photographer/{self.user_id}/on-demand-settings")
        verify_data = verify_response.json()
        
        assert verify_data["on_demand_photos_included"] == 100, "Should allow 100 photos"
        print("✓ 100 photos allowed (20 limit removed)")


class TestBookingsPricingAPI:
    """Test Bookings Manager Pricing API - Resolution-tiered pricing"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test session"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        # Use the known Approved Pro photographer ID
        self.user_id = TEST_ONDEMAND_PRO_ID
    
    def test_get_pricing_returns_booking_tier_fields(self):
        """GET /api/photographer/{id}/pricing returns booking_price_web, booking_price_standard, booking_price_high"""
        response = self.session.get(f"{BASE_URL}/api/photographer/{self.user_id}/pricing")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        # Verify all booking tier pricing fields exist
        required_fields = [
            "booking_price_web",
            "booking_price_standard", 
            "booking_price_high",
            "booking_photos_included",
            "booking_full_gallery"
        ]
        
        for field in required_fields:
            assert field in data, f"Missing field: {field}"
        
        # Verify types
        assert isinstance(data["booking_price_web"], (int, float)), "booking_price_web should be numeric"
        assert isinstance(data["booking_price_standard"], (int, float)), "booking_price_standard should be numeric"
        assert isinstance(data["booking_price_high"], (int, float)), "booking_price_high should be numeric"
        assert isinstance(data["booking_photos_included"], int), "booking_photos_included should be int"
        assert isinstance(data["booking_full_gallery"], bool), "booking_full_gallery should be bool"
        
        print(f"✓ booking_price_web: ${data['booking_price_web']}")
        print(f"✓ booking_price_standard: ${data['booking_price_standard']}")
        print(f"✓ booking_price_high: ${data['booking_price_high']}")
        print(f"✓ booking_photos_included: {data['booking_photos_included']}")
        print(f"✓ booking_full_gallery: {data['booking_full_gallery']}")
    
    def test_put_pricing_accepts_booking_tier_fields(self):
        """PUT /api/photographer/{id}/pricing accepts and saves all booking tier pricing fields"""
        # Set custom tier pricing
        payload = {
            "booking_price_web": 4.0,
            "booking_price_standard": 7.0,
            "booking_price_high": 15.0,
            "booking_photos_included": 10,
            "booking_full_gallery": True
        }
        
        response = self.session.put(f"{BASE_URL}/api/photographer/{self.user_id}/pricing", json=payload)
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        # Verify response contains updated pricing
        assert "pricing" in data, "Response should contain pricing object"
        pricing = data["pricing"]
        
        assert pricing["booking_price_web"] == 4.0, "booking_price_web should be 4.0"
        assert pricing["booking_price_standard"] == 7.0, "booking_price_standard should be 7.0"
        assert pricing["booking_price_high"] == 15.0, "booking_price_high should be 15.0"
        assert pricing["booking_photos_included"] == 10, "booking_photos_included should be 10"
        assert pricing["booking_full_gallery"] == True, "booking_full_gallery should be True"
        
        # Verify persistence with GET
        verify_response = self.session.get(f"{BASE_URL}/api/photographer/{self.user_id}/pricing")
        verify_data = verify_response.json()
        
        assert verify_data["booking_price_web"] == 4.0, "Persisted booking_price_web should be 4.0"
        assert verify_data["booking_price_standard"] == 7.0, "Persisted booking_price_standard should be 7.0"
        assert verify_data["booking_price_high"] == 15.0, "Persisted booking_price_high should be 15.0"
        assert verify_data["booking_photos_included"] == 10, "Persisted booking_photos_included should be 10"
        assert verify_data["booking_full_gallery"] == True, "Persisted booking_full_gallery should be True"
        
        print("✓ All booking tier pricing fields saved and persisted correctly")
    
    def test_pricing_parity_with_on_demand_and_live(self):
        """Verify pricing structure parity between General Bookings, On-Demand, and Live Sessions"""
        # Get pricing endpoint
        pricing_response = self.session.get(f"{BASE_URL}/api/photographer/{self.user_id}/pricing")
        assert pricing_response.status_code == 200
        pricing_data = pricing_response.json()
        
        # Get gallery pricing endpoint (for On-Demand/Live)
        gallery_response = self.session.get(f"{BASE_URL}/api/photographer/{self.user_id}/gallery-pricing")
        assert gallery_response.status_code == 200
        gallery_data = gallery_response.json()
        
        # Verify both have resolution tiers
        # General Bookings has: booking_price_web, booking_price_standard, booking_price_high
        assert "booking_price_web" in pricing_data
        assert "booking_price_standard" in pricing_data
        assert "booking_price_high" in pricing_data
        
        # Gallery/On-Demand has: photo_pricing.web, photo_pricing.standard, photo_pricing.high
        assert "photo_pricing" in gallery_data
        assert "web" in gallery_data["photo_pricing"]
        assert "standard" in gallery_data["photo_pricing"]
        assert "high" in gallery_data["photo_pricing"]
        
        print("✓ Pricing parity verified - both have Web/Standard/High resolution tiers")


class TestPhotoToolsDrawerLabels:
    """Test that Photo Tools drawer has correct labels (verified via API structure)"""
    
    def test_api_endpoints_exist_for_drawer_items(self):
        """Verify all API endpoints exist for Photo Tools drawer menu items"""
        session = requests.Session()
        
        # These endpoints should exist for the drawer menu items
        endpoints_to_check = [
            # Bookings Manager - bookings endpoint
            f"/api/photographer/{TEST_ONDEMAND_PRO_ID}/bookings",
            # On-Demand Settings
            f"/api/photographer/{TEST_ONDEMAND_PRO_ID}/on-demand-settings",
            # Pricing endpoint
            f"/api/photographer/{TEST_ONDEMAND_PRO_ID}/pricing",
        ]
        
        # Just verify endpoints don't return 404 (they may require auth)
        for endpoint in endpoints_to_check:
            response = session.get(f"{BASE_URL}{endpoint}")
            # Accept any status except 404 (endpoint exists)
            assert response.status_code != 404, f"Endpoint {endpoint} not found (404)"
            print(f"✓ Endpoint exists: {endpoint} (status: {response.status_code})")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
