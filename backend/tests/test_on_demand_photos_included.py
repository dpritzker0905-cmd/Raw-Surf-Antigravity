"""
Test On-Demand Photos Included Feature - Iteration 80
Tests the new 'on_demand_photos_included' field across:
1. Gallery Pricing API (GET and PUT)
2. On-Demand Settings API (GET and POST)
"""

import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://raw-surf-os.preview.emergentagent.com').rstrip('/')
PHOTOGRAPHER_ID = "34305abe-3880-410f-ab29-d4afd9a15242"


class TestGalleryPricingAPI:
    """Tests for Gallery Pricing API with on_demand_photos_included"""
    
    def test_gallery_pricing_returns_on_demand_photos_included(self):
        """Test that GET gallery-pricing returns on_demand_photos_included in session_pricing"""
        response = requests.get(f"{BASE_URL}/api/photographer/{PHOTOGRAPHER_ID}/gallery-pricing")
        assert response.status_code == 200, f"API failed: {response.text}"
        
        data = response.json()
        assert "session_pricing" in data, "Response missing 'session_pricing'"
        
        session_pricing = data["session_pricing"]
        assert "on_demand_photos_included" in session_pricing, "session_pricing missing 'on_demand_photos_included'"
        assert isinstance(session_pricing["on_demand_photos_included"], int), "on_demand_photos_included should be integer"
        
        print(f"✓ Gallery Pricing returns on_demand_photos_included: {session_pricing['on_demand_photos_included']}")
    
    def test_gallery_pricing_accepts_on_demand_photos_included(self):
        """Test that PUT gallery-pricing accepts and saves on_demand_photos_included"""
        test_value = 5
        
        # Update the value
        update_response = requests.put(
            f"{BASE_URL}/api/photographer/{PHOTOGRAPHER_ID}/gallery-pricing",
            json={"on_demand_photos_included": test_value}
        )
        assert update_response.status_code == 200, f"Update failed: {update_response.text}"
        
        # Verify the update in response
        update_data = update_response.json()
        assert "session_pricing" in update_data, "Update response missing 'session_pricing'"
        assert update_data["session_pricing"]["on_demand_photos_included"] == test_value
        
        # Verify persistence with GET
        verify_response = requests.get(f"{BASE_URL}/api/photographer/{PHOTOGRAPHER_ID}/gallery-pricing")
        verify_data = verify_response.json()
        assert verify_data["session_pricing"]["on_demand_photos_included"] == test_value
        
        print(f"✓ Gallery Pricing accepts and persists on_demand_photos_included: {test_value}")


class TestOnDemandSettingsAPI:
    """Tests for On-Demand Settings API with on_demand_photos_included"""
    
    def test_on_demand_settings_returns_on_demand_photos_included(self):
        """Test that GET on-demand-settings returns on_demand_photos_included"""
        response = requests.get(f"{BASE_URL}/api/photographer/{PHOTOGRAPHER_ID}/on-demand-settings")
        assert response.status_code == 200, f"API failed: {response.text}"
        
        data = response.json()
        assert "on_demand_photos_included" in data, "Response missing 'on_demand_photos_included'"
        assert isinstance(data["on_demand_photos_included"], int), "on_demand_photos_included should be integer"
        
        print(f"✓ On-Demand Settings returns on_demand_photos_included: {data['on_demand_photos_included']}")
    
    def test_on_demand_settings_accepts_on_demand_photos_included(self):
        """Test that POST on-demand-settings accepts and saves on_demand_photos_included"""
        test_value = 7
        
        # Update the value
        update_response = requests.post(
            f"{BASE_URL}/api/photographer/{PHOTOGRAPHER_ID}/on-demand-settings",
            json={
                "base_rate": 75,
                "peak_pricing_enabled": False,
                "peak_multiplier": 1.5,
                "claimed_spots": [],
                "on_demand_photos_included": test_value
            }
        )
        assert update_response.status_code == 200, f"Update failed: {update_response.text}"
        
        # Verify persistence with GET
        verify_response = requests.get(f"{BASE_URL}/api/photographer/{PHOTOGRAPHER_ID}/on-demand-settings")
        verify_data = verify_response.json()
        assert verify_data["on_demand_photos_included"] == test_value
        
        print(f"✓ On-Demand Settings accepts and persists on_demand_photos_included: {test_value}")


class TestPhotosIncludedCrossBothAPIs:
    """Test that both APIs read/write to the same field"""
    
    def test_field_sync_between_apis(self):
        """Test that updating via one API reflects in the other"""
        # Set value via Gallery Pricing
        gallery_value = 4
        requests.put(
            f"{BASE_URL}/api/photographer/{PHOTOGRAPHER_ID}/gallery-pricing",
            json={"on_demand_photos_included": gallery_value}
        )
        
        # Verify via On-Demand Settings
        ondemand_response = requests.get(f"{BASE_URL}/api/photographer/{PHOTOGRAPHER_ID}/on-demand-settings")
        ondemand_data = ondemand_response.json()
        assert ondemand_data["on_demand_photos_included"] == gallery_value, \
            f"On-Demand Settings not synced. Expected {gallery_value}, got {ondemand_data['on_demand_photos_included']}"
        
        # Set different value via On-Demand Settings
        ondemand_value = 8
        requests.post(
            f"{BASE_URL}/api/photographer/{PHOTOGRAPHER_ID}/on-demand-settings",
            json={
                "base_rate": 75,
                "peak_pricing_enabled": False,
                "peak_multiplier": 1.5,
                "claimed_spots": [],
                "on_demand_photos_included": ondemand_value
            }
        )
        
        # Verify via Gallery Pricing
        gallery_response = requests.get(f"{BASE_URL}/api/photographer/{PHOTOGRAPHER_ID}/gallery-pricing")
        gallery_data = gallery_response.json()
        assert gallery_data["session_pricing"]["on_demand_photos_included"] == ondemand_value, \
            f"Gallery Pricing not synced. Expected {ondemand_value}, got {gallery_data['session_pricing']['on_demand_photos_included']}"
        
        print(f"✓ Both APIs read/write to the same field - sync verified!")


# Reset test data
@pytest.fixture(scope="module", autouse=True)
def reset_test_data():
    """Reset on_demand_photos_included to default value after tests"""
    yield
    # Reset to default value of 3
    requests.put(
        f"{BASE_URL}/api/photographer/{PHOTOGRAPHER_ID}/gallery-pricing",
        json={"on_demand_photos_included": 3}
    )
