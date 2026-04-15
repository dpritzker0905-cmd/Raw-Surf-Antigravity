"""
Iteration 172 Backend Tests - Spot Sync & Wave Conditions
Tests:
1. Wave conditions API returns wave_height_ft
2. New spots exist: Beach 91st Street, El Tunco, Playa Bonita
3. Fixed coordinates: Rockaway Beach NY at 40.583,-73.798
4. Total spots count ~1210
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestWaveConditionsAPI:
    """Test wave conditions endpoint returns wave height data"""
    
    def test_wave_conditions_returns_wave_height(self):
        """GET /api/conditions/{spot_id} returns wave_height_ft"""
        # Use sample spot ID from test credentials
        spot_id = "ee2aab59-ca93-41bc-ab6e-9e9623d0717e"
        response = requests.get(f"{BASE_URL}/api/conditions/{spot_id}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert "current" in data, "Response should have 'current' field"
        assert "wave_height_ft" in data["current"], "current should have wave_height_ft"
        assert isinstance(data["current"]["wave_height_ft"], (int, float)), "wave_height_ft should be numeric"
        assert data["current"]["wave_height_ft"] >= 0, "wave_height_ft should be non-negative"
        
        print(f"Wave height: {data['current']['wave_height_ft']}ft")


class TestSpotSync:
    """Test spot sync - new spots and coordinate fixes"""
    
    def test_total_spots_count(self):
        """Total spots should be ~1210"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        
        spots = response.json()
        assert len(spots) >= 1200, f"Expected ~1210 spots, got {len(spots)}"
        print(f"Total spots: {len(spots)}")
    
    def test_beach_91st_street_exists(self):
        """Beach 91st Street (NY) should exist in database"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        
        spots = response.json()
        beach_91st = [s for s in spots if "91st" in s.get("name", "").lower()]
        
        assert len(beach_91st) > 0, "Beach 91st Street should exist"
        spot = beach_91st[0]
        assert spot["region"] == "Rockaways", f"Expected Rockaways region, got {spot['region']}"
        print(f"Found: {spot['name']} - {spot['region']}")
    
    def test_el_tunco_exists(self):
        """El Tunco (El Salvador) should exist in database"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        
        spots = response.json()
        el_tunco = [s for s in spots if "tunco" in s.get("name", "").lower()]
        
        assert len(el_tunco) > 0, "El Tunco should exist"
        spot = el_tunco[0]
        assert spot["region"] == "La Libertad", f"Expected La Libertad region, got {spot['region']}"
        print(f"Found: {spot['name']} - {spot['region']}")
    
    def test_playa_bonita_exists(self):
        """Playa Bonita (Costa Rica) should exist in database"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        
        spots = response.json()
        playa_bonita = [s for s in spots if "playa bonita" in s.get("name", "").lower()]
        
        assert len(playa_bonita) > 0, "Playa Bonita should exist"
        spot = playa_bonita[0]
        assert spot["region"] == "Limon", f"Expected Limon region, got {spot['region']}"
        print(f"Found: {spot['name']} - {spot['region']}")
    
    def test_rockaway_beach_coordinates_fixed(self):
        """Rockaway Beach NY should have correct coordinates (not SF)"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        
        spots = response.json()
        rockaway = [s for s in spots if s.get("name") == "Rockaway Beach" and s.get("region") == "Rockaways"]
        
        assert len(rockaway) > 0, "Rockaway Beach (Rockaways) should exist"
        spot = rockaway[0]
        
        # Should be near 40.583, -73.798 (NY), NOT 37.x, -122.x (SF)
        assert 40.5 < spot["latitude"] < 40.7, f"Latitude should be ~40.583 (NY), got {spot['latitude']}"
        assert -74.0 < spot["longitude"] < -73.5, f"Longitude should be ~-73.798 (NY), got {spot['longitude']}"
        
        print(f"Rockaway Beach coordinates: {spot['latitude']}, {spot['longitude']} (CORRECT - NY)")


class TestHealthEndpoint:
    """Basic health check"""
    
    def test_health_endpoint(self):
        """Health endpoint should return healthy status"""
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200
        
        data = response.json()
        assert data["status"] == "healthy"
        print(f"Health check passed: {data['status']}")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
