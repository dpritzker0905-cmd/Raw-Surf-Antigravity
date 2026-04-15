"""
Test Service Area & Travel Fees for Photographer Pricing
Tests the new fields: service_radius_miles, home_latitude, home_longitude, charges_travel_fees, travel_surcharges
"""
import pytest
import requests
import os
import uuid

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://raw-surf-os.preview.emergentagent.com')


class TestServiceAreaPricing:
    """Test Service Area & Travel Fees in Photographer Pricing"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test data - login and get photographer ID"""
        # Login to get a photographer user
        login_response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "test_photographer_221@test.com",
            "password": "TestPass123!"
        })
        
        if login_response.status_code != 200:
            # Try to create the photographer user
            signup_response = requests.post(f"{BASE_URL}/api/auth/signup", json={
                "email": "test_photographer_221@test.com",
                "password": "TestPass123!",
                "full_name": "Test Photographer 221",
                "role": "Photographer"
            })
            if signup_response.status_code == 200:
                self.user_data = signup_response.json()
                self.user_id = self.user_data.get('id')
            else:
                pytest.skip("Could not login or create photographer user")
        else:
            self.user_data = login_response.json()
            # Response returns user directly, not wrapped in 'user' object
            self.user_id = self.user_data.get('id')
        
        if not self.user_id:
            pytest.skip("No user ID in login response")
    
    def test_get_pricing_returns_service_area_fields(self):
        """GET /api/photographer/{id}/pricing should return service area fields"""
        response = requests.get(f"{BASE_URL}/api/photographer/{self.user_id}/pricing")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        
        # Verify service area fields exist in response
        assert 'service_radius_miles' in data, "service_radius_miles field missing"
        assert 'home_latitude' in data, "home_latitude field missing"
        assert 'home_longitude' in data, "home_longitude field missing"
        assert 'charges_travel_fees' in data, "charges_travel_fees field missing"
        assert 'travel_surcharges' in data, "travel_surcharges field missing"
        
        # Verify default values
        assert data['service_radius_miles'] == 25.0 or data['service_radius_miles'] >= 5, "service_radius_miles should have valid default"
        assert isinstance(data['charges_travel_fees'], bool), "charges_travel_fees should be boolean"
        
        print(f"✓ GET pricing returns service area fields: service_radius={data['service_radius_miles']}, charges_travel={data['charges_travel_fees']}")
    
    def test_update_service_radius_miles(self):
        """PUT /api/photographer/{id}/pricing should update service_radius_miles"""
        # Update service radius
        update_response = requests.put(f"{BASE_URL}/api/photographer/{self.user_id}/pricing", json={
            "service_radius_miles": 50.0
        })
        
        assert update_response.status_code == 200, f"Expected 200, got {update_response.status_code}: {update_response.text}"
        
        # Verify the update
        get_response = requests.get(f"{BASE_URL}/api/photographer/{self.user_id}/pricing")
        data = get_response.json()
        
        assert data['service_radius_miles'] == 50.0, f"Expected 50.0, got {data['service_radius_miles']}"
        
        print(f"✓ Updated service_radius_miles to 50.0")
        
        # Reset to default
        requests.put(f"{BASE_URL}/api/photographer/{self.user_id}/pricing", json={
            "service_radius_miles": 25.0
        })
    
    def test_update_home_location(self):
        """PUT /api/photographer/{id}/pricing should update home_latitude and home_longitude"""
        # Update home location (using a test location - San Diego area)
        test_lat = 32.7157
        test_lng = -117.1611
        
        update_response = requests.put(f"{BASE_URL}/api/photographer/{self.user_id}/pricing", json={
            "home_latitude": test_lat,
            "home_longitude": test_lng
        })
        
        assert update_response.status_code == 200, f"Expected 200, got {update_response.status_code}: {update_response.text}"
        
        # Verify the update
        get_response = requests.get(f"{BASE_URL}/api/photographer/{self.user_id}/pricing")
        data = get_response.json()
        
        assert data['home_latitude'] == test_lat, f"Expected {test_lat}, got {data['home_latitude']}"
        assert data['home_longitude'] == test_lng, f"Expected {test_lng}, got {data['home_longitude']}"
        
        print(f"✓ Updated home location to ({test_lat}, {test_lng})")
    
    def test_update_charges_travel_fees(self):
        """PUT /api/photographer/{id}/pricing should update charges_travel_fees"""
        # Enable travel fees
        update_response = requests.put(f"{BASE_URL}/api/photographer/{self.user_id}/pricing", json={
            "charges_travel_fees": True
        })
        
        assert update_response.status_code == 200, f"Expected 200, got {update_response.status_code}: {update_response.text}"
        
        # Verify the update
        get_response = requests.get(f"{BASE_URL}/api/photographer/{self.user_id}/pricing")
        data = get_response.json()
        
        assert data['charges_travel_fees'] == True, f"Expected True, got {data['charges_travel_fees']}"
        
        print(f"✓ Updated charges_travel_fees to True")
        
        # Reset to default
        requests.put(f"{BASE_URL}/api/photographer/{self.user_id}/pricing", json={
            "charges_travel_fees": False
        })
    
    def test_update_travel_surcharges(self):
        """PUT /api/photographer/{id}/pricing should update travel_surcharges tiers"""
        # Set travel surcharge tiers
        test_surcharges = [
            {"min_miles": 0, "max_miles": 10, "surcharge": 0},
            {"min_miles": 10, "max_miles": 25, "surcharge": 25},
            {"min_miles": 25, "max_miles": 50, "surcharge": 50},
            {"min_miles": 50, "max_miles": 100, "surcharge": 100}
        ]
        
        update_response = requests.put(f"{BASE_URL}/api/photographer/{self.user_id}/pricing", json={
            "travel_surcharges": test_surcharges
        })
        
        assert update_response.status_code == 200, f"Expected 200, got {update_response.status_code}: {update_response.text}"
        
        # Verify the update
        get_response = requests.get(f"{BASE_URL}/api/photographer/{self.user_id}/pricing")
        data = get_response.json()
        
        assert data['travel_surcharges'] is not None, "travel_surcharges should not be None"
        assert len(data['travel_surcharges']) == 4, f"Expected 4 tiers, got {len(data['travel_surcharges'])}"
        
        # Verify tier values
        assert data['travel_surcharges'][0]['surcharge'] == 0, "First tier surcharge should be 0"
        assert data['travel_surcharges'][1]['surcharge'] == 25, "Second tier surcharge should be 25"
        assert data['travel_surcharges'][2]['surcharge'] == 50, "Third tier surcharge should be 50"
        assert data['travel_surcharges'][3]['surcharge'] == 100, "Fourth tier surcharge should be 100"
        
        print(f"✓ Updated travel_surcharges with 4 tiers")
    
    def test_full_service_area_update(self):
        """PUT /api/photographer/{id}/pricing should update all service area fields together"""
        # Update all service area fields at once
        update_data = {
            "service_radius_miles": 75.0,
            "home_latitude": 28.5383,
            "home_longitude": -80.6050,
            "charges_travel_fees": True,
            "travel_surcharges": [
                {"min_miles": 0, "max_miles": 15, "surcharge": 0},
                {"min_miles": 15, "max_miles": 30, "surcharge": 20},
                {"min_miles": 30, "max_miles": 75, "surcharge": 40}
            ]
        }
        
        update_response = requests.put(f"{BASE_URL}/api/photographer/{self.user_id}/pricing", json=update_data)
        
        assert update_response.status_code == 200, f"Expected 200, got {update_response.status_code}: {update_response.text}"
        
        # Verify all fields updated
        get_response = requests.get(f"{BASE_URL}/api/photographer/{self.user_id}/pricing")
        data = get_response.json()
        
        assert data['service_radius_miles'] == 75.0, f"service_radius_miles mismatch"
        assert data['home_latitude'] == 28.5383, f"home_latitude mismatch"
        assert data['home_longitude'] == -80.6050, f"home_longitude mismatch"
        assert data['charges_travel_fees'] == True, f"charges_travel_fees mismatch"
        assert len(data['travel_surcharges']) == 3, f"travel_surcharges count mismatch"
        
        print(f"✓ Full service area update successful")
        
        # Reset to defaults
        requests.put(f"{BASE_URL}/api/photographer/{self.user_id}/pricing", json={
            "service_radius_miles": 25.0,
            "charges_travel_fees": False
        })
    
    def test_service_radius_validation(self):
        """Service radius should be clamped between 5 and 200 miles"""
        # Test minimum clamping
        update_response = requests.put(f"{BASE_URL}/api/photographer/{self.user_id}/pricing", json={
            "service_radius_miles": 1.0  # Below minimum
        })
        
        assert update_response.status_code == 200
        
        get_response = requests.get(f"{BASE_URL}/api/photographer/{self.user_id}/pricing")
        data = get_response.json()
        
        # Should be clamped to minimum of 5
        assert data['service_radius_miles'] >= 5, f"service_radius_miles should be at least 5, got {data['service_radius_miles']}"
        
        print(f"✓ Service radius validation working (min clamping)")
        
        # Reset
        requests.put(f"{BASE_URL}/api/photographer/{self.user_id}/pricing", json={
            "service_radius_miles": 25.0
        })


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
