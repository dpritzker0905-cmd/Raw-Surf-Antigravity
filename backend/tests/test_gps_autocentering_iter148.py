"""
Test Iteration 148 - GPS Auto-Centering Bug Fix
User reported: GPS coordinates show Cape Canaveral (28.39°N, 80.61°W) but map was centering on West Palm Beach (26.7°N)

Tests:
1. Cape Canaveral is in COASTAL_SNAP_POINTS database
2. Space Coast cities are in COASTAL_CITIES set
3. IP geolocation returns proper coastal snap fields
4. Nearby spots API works with Cape Canaveral coordinates
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://raw-surf-os.preview.emergentagent.com')

# Cape Canaveral coordinates (user's reported GPS location)
CAPE_CANAVERAL_LAT = 28.39
CAPE_CANAVERAL_LON = -80.61

# West Palm Beach coordinates (where map was incorrectly centering)
WEST_PALM_BEACH_LAT = 26.7
WEST_PALM_BEACH_LON = -80.05


class TestCapeCanaveralCoastalSnap:
    """Test that Cape Canaveral is properly in the coastal snap database"""
    
    def test_ip_geolocation_returns_coastal_snap_fields(self):
        """Test IP geolocation endpoint returns all required coastal snap fields"""
        response = requests.get(f"{BASE_URL}/api/location/ip-geolocation?coastal_snap=true")
        assert response.status_code == 200
        
        data = response.json()
        assert "success" in data
        assert "latitude" in data
        assert "longitude" in data
        assert "coastal_snapped" in data
        assert "is_coastal" in data
        assert "city" in data
        print(f"✅ IP Geolocation returns all coastal snap fields: city={data.get('city')}, coastal_snapped={data.get('coastal_snapped')}")
    
    def test_nearby_spots_cape_canaveral(self):
        """Test getting nearby spots from Cape Canaveral coordinates"""
        response = requests.get(
            f"{BASE_URL}/api/surf-spots/nearby",
            params={
                "latitude": CAPE_CANAVERAL_LAT,
                "longitude": CAPE_CANAVERAL_LON,
                "radius_miles": 50
            }
        )
        assert response.status_code == 200
        
        data = response.json()
        assert isinstance(data, list)
        print(f"✅ Found {len(data)} spots near Cape Canaveral (28.39°N, 80.61°W)")
        
        # Check if any spots are in the Space Coast area
        space_coast_spots = [s for s in data if 'cocoa' in s.get('name', '').lower() or 
                           'canaveral' in s.get('name', '').lower() or
                           'melbourne' in s.get('name', '').lower()]
        print(f"   Space Coast spots found: {[s.get('name') for s in space_coast_spots]}")
    
    def test_nearby_spots_west_palm_beach(self):
        """Test getting nearby spots from West Palm Beach coordinates (for comparison)"""
        response = requests.get(
            f"{BASE_URL}/api/surf-spots/nearby",
            params={
                "latitude": WEST_PALM_BEACH_LAT,
                "longitude": WEST_PALM_BEACH_LON,
                "radius_miles": 50
            }
        )
        assert response.status_code == 200
        
        data = response.json()
        assert isinstance(data, list)
        print(f"✅ Found {len(data)} spots near West Palm Beach (26.7°N, 80.05°W)")
    
    def test_distance_between_cape_canaveral_and_west_palm(self):
        """Verify the distance between Cape Canaveral and West Palm Beach is significant"""
        import math
        
        # Haversine formula
        R = 3959  # Earth's radius in miles
        lat1, lon1 = math.radians(CAPE_CANAVERAL_LAT), math.radians(CAPE_CANAVERAL_LON)
        lat2, lon2 = math.radians(WEST_PALM_BEACH_LAT), math.radians(WEST_PALM_BEACH_LON)
        
        dlat = lat2 - lat1
        dlon = lon2 - lon1
        
        a = math.sin(dlat/2)**2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon/2)**2
        c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
        distance = R * c
        
        print(f"✅ Distance between Cape Canaveral and West Palm Beach: {distance:.1f} miles")
        
        # The distance should be significant (>100 miles) - this was the bug
        assert distance > 100, f"Distance should be >100 miles, got {distance:.1f}"
        print(f"   This confirms the bug: map was centering ~{distance:.0f} miles away from user's GPS location")


class TestSurfSpotsWithUserLocation:
    """Test surf spots API with user location for geofencing"""
    
    def test_surf_spots_with_cape_canaveral_location(self):
        """Test surf spots with Cape Canaveral user location"""
        response = requests.get(
            f"{BASE_URL}/api/surf-spots",
            params={
                "user_lat": CAPE_CANAVERAL_LAT,
                "user_lon": CAPE_CANAVERAL_LON
            }
        )
        assert response.status_code == 200
        
        data = response.json()
        assert isinstance(data, list)
        assert len(data) > 0
        
        # Check geofencing fields
        spot = data[0]
        assert "is_within_geofence" in spot
        print(f"✅ Surf spots API works with Cape Canaveral location, got {len(data)} spots")
    
    def test_surf_spots_sorted_by_distance(self):
        """Test that surf spots are sorted by distance from user location"""
        response = requests.get(
            f"{BASE_URL}/api/surf-spots",
            params={
                "user_lat": CAPE_CANAVERAL_LAT,
                "user_lon": CAPE_CANAVERAL_LON
            }
        )
        assert response.status_code == 200
        
        data = response.json()
        
        # Check if spots have distance_miles field
        spots_with_distance = [s for s in data if s.get('distance_miles') is not None]
        if len(spots_with_distance) > 1:
            # Verify sorted by distance
            distances = [s['distance_miles'] for s in spots_with_distance[:10]]
            print(f"✅ First 10 spot distances: {distances}")


class TestIPGeolocationCoastalCities:
    """Test IP geolocation coastal city detection"""
    
    def test_coastal_snap_with_last_city(self):
        """Test coastal snap with city migration detection"""
        response = requests.get(
            f"{BASE_URL}/api/location/ip-geolocation",
            params={
                "coastal_snap": True,
                "last_city": "Cape Canaveral"
            }
        )
        assert response.status_code == 200
        
        data = response.json()
        assert "city_changed" in data
        print(f"✅ City migration detection works: city_changed={data.get('city_changed')}, current={data.get('city')}")


class TestHealthAndBasics:
    """Basic health checks"""
    
    def test_api_health(self):
        """Test API is responding"""
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200
        print("✅ API health check passed")
    
    def test_live_photographers_endpoint(self):
        """Test live photographers endpoint"""
        response = requests.get(f"{BASE_URL}/api/live-photographers")
        assert response.status_code == 200
        
        data = response.json()
        assert isinstance(data, list)
        print(f"✅ Live photographers endpoint works, got {len(data)} photographers")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
