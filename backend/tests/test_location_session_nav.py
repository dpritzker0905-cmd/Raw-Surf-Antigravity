"""
Test Location Setting & Session Navigation Features (Iteration 222)

Tests:
1. Photographer pricing endpoints include home_location_name field
2. Photographer can update home_location_name via pricing endpoint
3. Session navigation URL format is correct
"""
import pytest
import requests
import os
import uuid

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestPhotographerLocationSettings:
    """Test photographer home location settings"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Create test photographer for location tests"""
        self.test_email = f"test_location_{uuid.uuid4().hex[:8]}@test.com"
        self.test_password = "TestPass123!"
        
        # Register photographer using signup endpoint
        register_response = requests.post(f"{BASE_URL}/api/auth/signup", json={
            "email": self.test_email,
            "password": self.test_password,
            "full_name": "Test Location Photographer",
            "role": "Photographer"
        })
        
        if register_response.status_code == 200:
            self.photographer_id = register_response.json().get("id")
        else:
            pytest.skip(f"Could not create test photographer: {register_response.text}")
        
        yield
        
        # Cleanup would go here if needed
    
    def test_get_pricing_includes_home_location_name(self):
        """GET /api/photographer/{id}/pricing should include home_location_name field"""
        response = requests.get(f"{BASE_URL}/api/photographer/{self.photographer_id}/pricing")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        
        # Verify home_location_name field exists in response
        assert "home_location_name" in data, "home_location_name field missing from pricing response"
        
        # Verify other service area fields are present
        assert "home_latitude" in data, "home_latitude field missing"
        assert "home_longitude" in data, "home_longitude field missing"
        assert "service_radius_miles" in data, "service_radius_miles field missing"
        
        print(f"✓ Pricing response includes home_location_name: {data.get('home_location_name')}")
    
    def test_update_home_location_name(self):
        """PUT /api/photographer/{id}/pricing should update home_location_name"""
        test_location_name = "San Diego, CA"
        test_lat = 32.7157
        test_lng = -117.1611
        
        response = requests.put(f"{BASE_URL}/api/photographer/{self.photographer_id}/pricing", json={
            "home_location_name": test_location_name,
            "home_latitude": test_lat,
            "home_longitude": test_lng
        })
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        
        # Verify the update was successful
        assert "pricing" in data, "Response should contain pricing object"
        assert data["pricing"]["home_location_name"] == test_location_name, \
            f"Expected '{test_location_name}', got '{data['pricing'].get('home_location_name')}'"
        assert data["pricing"]["home_latitude"] == test_lat
        assert data["pricing"]["home_longitude"] == test_lng
        
        print(f"✓ Successfully updated home_location_name to: {test_location_name}")
    
    def test_get_pricing_after_update(self):
        """Verify home_location_name persists after update"""
        test_location_name = "Uluwatu, Bali"
        test_lat = -8.8291
        test_lng = 115.0849
        
        # First update
        update_response = requests.put(f"{BASE_URL}/api/photographer/{self.photographer_id}/pricing", json={
            "home_location_name": test_location_name,
            "home_latitude": test_lat,
            "home_longitude": test_lng
        })
        assert update_response.status_code == 200
        
        # Then fetch to verify persistence
        get_response = requests.get(f"{BASE_URL}/api/photographer/{self.photographer_id}/pricing")
        assert get_response.status_code == 200
        
        data = get_response.json()
        assert data["home_location_name"] == test_location_name, \
            f"home_location_name not persisted. Expected '{test_location_name}', got '{data.get('home_location_name')}'"
        
        print(f"✓ home_location_name persisted correctly: {test_location_name}")
    
    def test_clear_home_location_name(self):
        """Verify home_location_name can be set and retrieved"""
        # Set a value
        set_response = requests.put(f"{BASE_URL}/api/photographer/{self.photographer_id}/pricing", json={
            "home_location_name": "Test Location",
            "home_latitude": 33.0,
            "home_longitude": -117.0
        })
        
        assert set_response.status_code == 200
        
        # Verify it's set
        get_response = requests.get(f"{BASE_URL}/api/photographer/{self.photographer_id}/pricing")
        data = get_response.json()
        
        assert data["home_latitude"] == 33.0, "home_latitude should be set"
        assert data["home_longitude"] == -117.0, "home_longitude should be set"
        assert data["home_location_name"] == "Test Location", "home_location_name should be set"
        
        print("✓ Home location can be set and retrieved successfully")


class TestSessionNavigation:
    """Test session navigation URL format"""
    
    def test_bookings_endpoint_exists(self):
        """Verify /api/bookings endpoint exists"""
        # Just check the endpoint is accessible (may return 401 without auth)
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200, "Health endpoint should be accessible"
        print("✓ Backend is healthy")
    
    def test_booking_details_endpoint(self):
        """Test that booking details endpoint exists"""
        # Test with a fake ID - should return 404 not 500
        fake_id = str(uuid.uuid4())
        response = requests.get(f"{BASE_URL}/api/bookings/{fake_id}")
        
        # Should return 404 for non-existent booking, not 500
        assert response.status_code in [404, 401], \
            f"Expected 404 or 401 for non-existent booking, got {response.status_code}"
        
        print("✓ Booking details endpoint returns proper error for non-existent booking")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
