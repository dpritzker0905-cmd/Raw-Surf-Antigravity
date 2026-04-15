"""
Test suite for Surf Spots Explore feature
Tests the /explore/surf-spots endpoint with real-time conditions and forecasts
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestSurfSpotsExplore:
    """Tests for the Surf Spots tab in Explore"""
    
    def test_surf_spots_endpoint_returns_200(self):
        """Test that surf-spots endpoint returns 200"""
        response = requests.get(f"{BASE_URL}/api/explore/surf-spots?limit=5")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        print("✓ Surf spots endpoint returns 200")
    
    def test_surf_spots_returns_spots_array(self):
        """Test that response contains spots array"""
        response = requests.get(f"{BASE_URL}/api/explore/surf-spots?limit=5")
        data = response.json()
        
        assert "spots" in data, "Response should contain 'spots' key"
        assert isinstance(data["spots"], list), "spots should be a list"
        print(f"✓ Response contains spots array with {len(data['spots'])} spots")
    
    def test_surf_spots_returns_regions(self):
        """Test that response contains regions for filtering"""
        response = requests.get(f"{BASE_URL}/api/explore/surf-spots?limit=5")
        data = response.json()
        
        assert "regions" in data, "Response should contain 'regions' key"
        assert isinstance(data["regions"], list), "regions should be a list"
        print(f"✓ Response contains {len(data['regions'])} regions for filtering")
    
    def test_spot_has_required_fields(self):
        """Test that each spot has required fields"""
        response = requests.get(f"{BASE_URL}/api/explore/surf-spots?limit=5")
        data = response.json()
        
        required_fields = ["id", "name", "region", "latitude", "longitude"]
        
        for spot in data["spots"][:3]:  # Check first 3 spots
            for field in required_fields:
                assert field in spot, f"Spot missing required field: {field}"
        
        print("✓ All spots have required fields (id, name, region, lat, lng)")
    
    def test_spot_has_current_conditions(self):
        """Test that spots have current_conditions with wave data"""
        response = requests.get(f"{BASE_URL}/api/explore/surf-spots?limit=5")
        data = response.json()
        
        spots_with_conditions = 0
        for spot in data["spots"]:
            if spot.get("current_conditions"):
                conditions = spot["current_conditions"]
                assert "wave_height_ft" in conditions, "Conditions should have wave_height_ft"
                assert "wave_direction" in conditions, "Conditions should have wave_direction"
                assert "wave_period" in conditions, "Conditions should have wave_period"
                assert "label" in conditions, "Conditions should have label"
                spots_with_conditions += 1
        
        assert spots_with_conditions > 0, "At least one spot should have conditions"
        print(f"✓ {spots_with_conditions} spots have current conditions with wave data")
    
    def test_spot_has_forecast_array(self):
        """Test that spots have forecast array with daily data"""
        response = requests.get(f"{BASE_URL}/api/explore/surf-spots?limit=5")
        data = response.json()
        
        spots_with_forecast = 0
        for spot in data["spots"]:
            if spot.get("forecast"):
                forecast = spot["forecast"]
                assert isinstance(forecast, list), "Forecast should be a list"
                assert len(forecast) >= 1, "Forecast should have at least 1 day"
                
                # Check first forecast day
                day = forecast[0]
                assert "date" in day, "Forecast day should have date"
                assert "wave_height_max" in day, "Forecast day should have wave_height_max"
                assert "label" in day, "Forecast day should have label"
                spots_with_forecast += 1
        
        assert spots_with_forecast > 0, "At least one spot should have forecast"
        print(f"✓ {spots_with_forecast} spots have forecast arrays")
    
    def test_forecast_days_allowed_field(self):
        """Test that spots have forecast_days_allowed for tiered access"""
        response = requests.get(f"{BASE_URL}/api/explore/surf-spots?limit=5&subscription_tier=free")
        data = response.json()
        
        for spot in data["spots"][:3]:
            assert "forecast_days_allowed" in spot, "Spot should have forecast_days_allowed"
            assert spot["forecast_days_allowed"] == 3, "Free tier should get 3 days"
        
        print("✓ Free tier gets 3 days forecast access")
    
    def test_paid_tier_gets_more_forecast_days(self):
        """Test that paid tier gets 7 days forecast"""
        response = requests.get(f"{BASE_URL}/api/explore/surf-spots?limit=5&subscription_tier=paid")
        data = response.json()
        
        for spot in data["spots"][:3]:
            assert spot.get("forecast_days_allowed") == 7, "Paid tier should get 7 days"
        
        print("✓ Paid tier gets 7 days forecast access")
    
    def test_premium_tier_gets_max_forecast_days(self):
        """Test that premium tier gets 10 days forecast"""
        response = requests.get(f"{BASE_URL}/api/explore/surf-spots?limit=5&subscription_tier=premium")
        data = response.json()
        
        for spot in data["spots"][:3]:
            assert spot.get("forecast_days_allowed") == 10, "Premium tier should get 10 days"
        
        print("✓ Premium tier gets 10 days forecast access")
    
    def test_region_filter_works(self):
        """Test that region filter returns spots from that region"""
        # First get all regions
        response = requests.get(f"{BASE_URL}/api/explore/surf-spots?limit=50")
        data = response.json()
        
        if data.get("regions") and len(data["regions"]) > 0:
            test_region = data["regions"][0]
            
            # Filter by region
            filtered_response = requests.get(f"{BASE_URL}/api/explore/surf-spots?region={test_region}&limit=10")
            filtered_data = filtered_response.json()
            
            for spot in filtered_data["spots"]:
                assert spot["region"] == test_region, f"Spot region {spot['region']} doesn't match filter {test_region}"
            
            print(f"✓ Region filter works - filtered by '{test_region}'")
        else:
            pytest.skip("No regions available to test filter")
    
    def test_conditions_label_values(self):
        """Test that conditions labels are valid surf condition descriptions"""
        valid_labels = [
            "Flat", "Ankle High", "Knee High", "Waist High", 
            "Chest High", "Head High", "Overhead", 
            "Double Overhead", "Triple Overhead+"
        ]
        
        response = requests.get(f"{BASE_URL}/api/explore/surf-spots?limit=10")
        data = response.json()
        
        for spot in data["spots"]:
            if spot.get("current_conditions"):
                label = spot["current_conditions"].get("label")
                assert label in valid_labels, f"Invalid conditions label: {label}"
        
        print("✓ All conditions labels are valid surf descriptions")
    
    def test_wave_height_is_in_feet(self):
        """Test that wave heights are in feet (reasonable range)"""
        response = requests.get(f"{BASE_URL}/api/explore/surf-spots?limit=10")
        data = response.json()
        
        for spot in data["spots"]:
            if spot.get("current_conditions"):
                wave_height = spot["current_conditions"].get("wave_height_ft")
                if wave_height is not None:
                    assert 0 <= wave_height <= 50, f"Wave height {wave_height}ft seems unreasonable"
        
        print("✓ Wave heights are in reasonable range (0-50ft)")


class TestExploreSpotDetails:
    """Tests for individual spot details endpoint"""
    
    def test_spot_details_endpoint(self):
        """Test that spot details endpoint works"""
        # First get a spot ID
        response = requests.get(f"{BASE_URL}/api/explore/surf-spots?limit=1")
        data = response.json()
        
        if data.get("spots") and len(data["spots"]) > 0:
            spot_id = data["spots"][0]["id"]
            
            details_response = requests.get(f"{BASE_URL}/api/explore/spot-details/{spot_id}")
            assert details_response.status_code == 200, f"Expected 200, got {details_response.status_code}"
            
            details = details_response.json()
            assert details.get("id") == spot_id, "Spot ID should match"
            assert "current_conditions" in details, "Should have current_conditions"
            assert "forecast" in details, "Should have forecast"
            
            print(f"✓ Spot details endpoint works for spot: {details.get('name')}")
        else:
            pytest.skip("No spots available to test details")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
