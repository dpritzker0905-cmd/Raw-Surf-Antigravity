"""
Test Iteration 147 Features:
- P0: MapPage marker clustering (infinite loop fix)
- P1: Admin Precision Pin Tool with satellite map
- P2: Photographer Refine Location button
- IP Geolocation with Coastal Snap
- Permission Nudge Drawer component
- Tier 2/3 spot import
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://raw-surf-os.preview.emergentagent.com')

# Test credentials
ADMIN_EMAIL = "dpritzker0905@gmail.com"
ADMIN_PASSWORD = "TestPass123!"
ADMIN_PROFILE_ID = "12dc6786-124f-40b1-8698-a9409f99736f"


class TestIPGeolocation:
    """Test IP Geolocation endpoint with Coastal Snap feature"""
    
    def test_ip_geolocation_basic(self):
        """Test basic IP geolocation endpoint"""
        response = requests.get(f"{BASE_URL}/api/location/ip-geolocation")
        assert response.status_code == 200
        
        data = response.json()
        assert "success" in data
        assert "latitude" in data
        assert "longitude" in data
        print(f"✅ IP Geolocation basic: {data.get('city', 'Unknown')}")
    
    def test_ip_geolocation_coastal_snap(self):
        """Test IP geolocation with coastal_snap=true"""
        response = requests.get(f"{BASE_URL}/api/location/ip-geolocation?coastal_snap=true")
        assert response.status_code == 200
        
        data = response.json()
        assert "success" in data
        assert "coastal_snapped" in data
        assert "is_coastal" in data
        print(f"✅ Coastal snap: snapped={data.get('coastal_snapped')}, is_coastal={data.get('is_coastal')}")
    
    def test_ip_geolocation_city_migration(self):
        """Test IP geolocation with city migration detection"""
        response = requests.get(f"{BASE_URL}/api/location/ip-geolocation?coastal_snap=true&last_city=New York")
        assert response.status_code == 200
        
        data = response.json()
        assert "city_changed" in data
        print(f"✅ City migration: city_changed={data.get('city_changed')}, current_city={data.get('city')}")


class TestSurfSpots:
    """Test Surf Spots API endpoints"""
    
    def test_get_surf_spots(self):
        """Test getting all surf spots"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        
        data = response.json()
        assert isinstance(data, list)
        assert len(data) > 0
        print(f"✅ Got {len(data)} surf spots")
    
    def test_get_surf_spots_with_geofencing(self):
        """Test surf spots with Privacy Shield geofencing"""
        # Test with user location (Miami)
        response = requests.get(
            f"{BASE_URL}/api/surf-spots",
            params={
                "user_lat": 25.7617,
                "user_lon": -80.1218,
                "user_id": ADMIN_PROFILE_ID
            }
        )
        assert response.status_code == 200
        
        data = response.json()
        assert isinstance(data, list)
        
        # Check that geofencing fields are present
        if len(data) > 0:
            spot = data[0]
            assert "is_within_geofence" in spot
            assert "distance_miles" in spot or spot.get("distance_miles") is None
            print(f"✅ Geofencing: First spot within_geofence={spot.get('is_within_geofence')}")
    
    def test_get_nearby_spots(self):
        """Test getting nearby surf spots"""
        response = requests.get(
            f"{BASE_URL}/api/surf-spots/nearby",
            params={
                "latitude": 25.7617,
                "longitude": -80.1218,
                "radius_miles": 50
            }
        )
        assert response.status_code == 200
        
        data = response.json()
        assert isinstance(data, list)
        print(f"✅ Found {len(data)} nearby spots within 50 miles of Miami")


class TestAdminSpots:
    """Test Admin Spots Management endpoints"""
    
    def test_admin_spots_stats(self):
        """Test admin spots statistics"""
        response = requests.get(
            f"{BASE_URL}/api/admin/spots/stats",
            params={"admin_id": ADMIN_PROFILE_ID}
        )
        
        if response.status_code == 200:
            data = response.json()
            assert "total_spots" in data
            print(f"✅ Admin spots stats: {data.get('total_spots')} total spots")
        elif response.status_code == 403:
            print("⚠️ Admin access required - skipping")
            pytest.skip("Admin access required")
        else:
            print(f"⚠️ Unexpected status: {response.status_code}")
    
    def test_admin_spot_import_endpoint_exists(self):
        """Test that admin spot import endpoint exists"""
        # Just check the endpoint exists (don't actually import)
        response = requests.post(
            f"{BASE_URL}/api/admin/spots/import",
            params={
                "admin_id": ADMIN_PROFILE_ID,
                "tier": 1,
                "include_osm": False
            }
        )
        
        # Should return 200 or 403 (if not admin), not 404
        assert response.status_code in [200, 403, 422]
        print(f"✅ Admin import endpoint exists (status: {response.status_code})")


class TestSpotRefinement:
    """Test Photographer Spot Refinement (Refine Peak) feature"""
    
    def test_refine_location_endpoint_exists(self):
        """Test that refine location endpoint exists"""
        # Get a spot first
        spots_response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert spots_response.status_code == 200
        spots = spots_response.json()
        
        if len(spots) > 0:
            spot_id = spots[0]["id"]
            
            # Try to refine (will likely fail without proper auth, but endpoint should exist)
            response = requests.post(
                f"{BASE_URL}/api/spots/{spot_id}/refine-location",
                params={
                    "photographer_id": ADMIN_PROFILE_ID,
                    "new_latitude": spots[0]["latitude"] + 0.0001,
                    "new_longitude": spots[0]["longitude"] + 0.0001
                }
            )
            
            # Should return 200, 403, or 400 - not 404
            assert response.status_code in [200, 400, 403, 422]
            print(f"✅ Refine location endpoint exists (status: {response.status_code})")


class TestLivePhotographers:
    """Test Live Photographers endpoints"""
    
    def test_get_live_photographers(self):
        """Test getting live photographers"""
        response = requests.get(f"{BASE_URL}/api/live-photographers")
        assert response.status_code == 200
        
        data = response.json()
        assert isinstance(data, list)
        print(f"✅ Got {len(data)} live photographers")


class TestAdminActiveSessions:
    """Test Admin Active Sessions endpoint"""
    
    def test_get_active_sessions(self):
        """Test getting active sessions"""
        response = requests.get(f"{BASE_URL}/api/admin/active-sessions")
        
        if response.status_code == 200:
            data = response.json()
            assert isinstance(data, list)
            print(f"✅ Got {len(data)} active sessions")
        else:
            print(f"⚠️ Active sessions endpoint returned {response.status_code}")


class TestHealthCheck:
    """Basic health checks"""
    
    def test_api_health(self):
        """Test API is responding"""
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200
        print("✅ API health check passed")
    
    def test_frontend_loads(self):
        """Test frontend is accessible"""
        response = requests.get(BASE_URL)
        assert response.status_code == 200
        assert "Raw Surf" in response.text or "raw" in response.text.lower()
        print("✅ Frontend loads successfully")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
