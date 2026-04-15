"""
Test Location Filtering Feature for Surf Spots
Tests the new /api/surf-spots/locations endpoint and state_province filtering
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://raw-surf-os.preview.emergentagent.com')


class TestLocationFilteringEndpoints:
    """Tests for the location filtering feature"""
    
    def test_locations_endpoint_returns_countries(self):
        """Test that /api/surf-spots/locations returns countries with spot counts"""
        response = requests.get(f"{BASE_URL}/api/surf-spots/locations")
        
        assert response.status_code == 200
        data = response.json()
        
        # Verify structure
        assert "countries" in data
        assert "total_countries" in data
        assert isinstance(data["countries"], list)
        assert data["total_countries"] > 0
        
        # Verify country structure
        if len(data["countries"]) > 0:
            country = data["countries"][0]
            assert "name" in country
            assert "spot_count" in country
            assert "states" in country
            assert isinstance(country["states"], list)
    
    def test_locations_endpoint_has_usa(self):
        """Test that USA is in the countries list with states"""
        response = requests.get(f"{BASE_URL}/api/surf-spots/locations")
        
        assert response.status_code == 200
        data = response.json()
        
        # Find USA
        usa = next((c for c in data["countries"] if c["name"] == "USA"), None)
        assert usa is not None, "USA should be in the countries list"
        assert usa["spot_count"] > 0, "USA should have spots"
        assert len(usa["states"]) > 0, "USA should have states"
        
        # Verify Florida is in USA states
        florida = next((s for s in usa["states"] if s["name"] == "Florida"), None)
        assert florida is not None, "Florida should be in USA states"
        assert florida["spot_count"] > 0, "Florida should have spots"
    
    def test_surf_spots_filter_by_country(self):
        """Test filtering surf spots by country"""
        response = requests.get(f"{BASE_URL}/api/surf-spots", params={"country": "USA"})
        
        assert response.status_code == 200
        data = response.json()
        
        assert isinstance(data, list)
        assert len(data) > 0, "Should return spots for USA"
        
        # Verify all spots are from USA
        for spot in data:
            assert spot["country"] == "USA", f"Spot {spot['name']} should be from USA"
    
    def test_surf_spots_filter_by_country_and_state(self):
        """Test filtering surf spots by country and state_province"""
        response = requests.get(
            f"{BASE_URL}/api/surf-spots", 
            params={"country": "USA", "state_province": "Florida"}
        )
        
        assert response.status_code == 200
        data = response.json()
        
        assert isinstance(data, list)
        assert len(data) > 0, "Should return spots for Florida"
        
        # Verify all spots are from Florida
        for spot in data:
            assert spot["country"] == "USA", f"Spot {spot['name']} should be from USA"
            assert spot["state_province"] == "Florida", f"Spot {spot['name']} should be from Florida"
    
    def test_surf_spots_filter_returns_expected_count(self):
        """Test that filtering returns expected number of spots"""
        # Get USA spots
        usa_response = requests.get(f"{BASE_URL}/api/surf-spots", params={"country": "USA"})
        usa_spots = usa_response.json()
        
        # Get Florida spots
        florida_response = requests.get(
            f"{BASE_URL}/api/surf-spots", 
            params={"country": "USA", "state_province": "Florida"}
        )
        florida_spots = florida_response.json()
        
        # Florida should have fewer spots than all of USA
        assert len(florida_spots) < len(usa_spots), "Florida should have fewer spots than all of USA"
        assert len(florida_spots) > 0, "Florida should have some spots"
    
    def test_surf_spots_response_structure(self):
        """Test that surf spots response has required fields"""
        response = requests.get(
            f"{BASE_URL}/api/surf-spots", 
            params={"country": "USA", "state_province": "Florida"}
        )
        
        assert response.status_code == 200
        data = response.json()
        
        if len(data) > 0:
            spot = data[0]
            # Required fields
            assert "id" in spot
            assert "name" in spot
            assert "latitude" in spot
            assert "longitude" in spot
            assert "country" in spot
            assert "state_province" in spot
            assert "is_active" in spot
    
    def test_locations_endpoint_has_multiple_countries(self):
        """Test that locations endpoint returns multiple countries"""
        response = requests.get(f"{BASE_URL}/api/surf-spots/locations")
        
        assert response.status_code == 200
        data = response.json()
        
        # Should have many countries (based on context: 71 countries)
        assert data["total_countries"] >= 50, f"Expected at least 50 countries, got {data['total_countries']}"
    
    def test_australia_has_states(self):
        """Test that Australia has states in the locations response"""
        response = requests.get(f"{BASE_URL}/api/surf-spots/locations")
        
        assert response.status_code == 200
        data = response.json()
        
        # Find Australia
        australia = next((c for c in data["countries"] if c["name"] == "Australia"), None)
        assert australia is not None, "Australia should be in the countries list"
        assert len(australia["states"]) > 0, "Australia should have states"
        
        # Verify New South Wales is in Australia states
        nsw = next((s for s in australia["states"] if s["name"] == "New South Wales"), None)
        assert nsw is not None, "New South Wales should be in Australia states"
    
    def test_empty_country_returns_all_spots(self):
        """Test that empty country parameter returns all spots"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        
        assert response.status_code == 200
        data = response.json()
        
        # Should return many spots
        assert len(data) > 100, f"Expected many spots, got {len(data)}"
    
    def test_invalid_country_returns_empty(self):
        """Test that invalid country returns empty list"""
        response = requests.get(f"{BASE_URL}/api/surf-spots", params={"country": "InvalidCountry123"})
        
        assert response.status_code == 200
        data = response.json()
        
        assert isinstance(data, list)
        assert len(data) == 0, "Invalid country should return empty list"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
