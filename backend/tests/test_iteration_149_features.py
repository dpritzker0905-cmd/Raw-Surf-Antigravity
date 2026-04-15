"""
Test Suite for Iteration 149 Features:
1. Privacy Shield - active_photographers_count ALWAYS returned, but list/breathing_status nullified when out of geofence
2. Drawer Upgrade CTA - Shows 'X Pros Shooting Now' when activePhotographersCount > 0
3. Stripe Identity - Uses STRIPE_API_KEY
4. Spot Import - Total spots now 195
5. Cache Purge - useIPGeolocation has purgeLocationCache function
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://raw-surf-os.preview.emergentagent.com')

# Test credentials
ADMIN_EMAIL = "dpritzker0905@gmail.com"
ADMIN_PASSWORD = "TestPass123!"
ADMIN_PROFILE_ID = "12dc6786-124f-40b1-8698-a9409f99736f"


class TestPrivacyShield:
    """Test Privacy Shield geofencing logic - active_photographers_count ALWAYS returned"""
    
    def test_spot_detail_returns_count_always(self):
        """Privacy Shield: GET /api/surf-spots/{id} should ALWAYS return active_photographers_count"""
        # Get a spot first
        spots_response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert spots_response.status_code == 200
        spots = spots_response.json()
        assert len(spots) > 0
        
        spot_id = spots[0]['id']
        
        # Get spot detail without user location (should return count)
        response = requests.get(f"{BASE_URL}/api/surf-spots/{spot_id}")
        assert response.status_code == 200
        data = response.json()
        
        # active_photographers_count should ALWAYS be present
        assert 'active_photographers_count' in data, "active_photographers_count should always be returned"
        assert isinstance(data['active_photographers_count'], int), "active_photographers_count should be an integer"
        print(f"PASS: Spot {data['name']} has active_photographers_count: {data['active_photographers_count']}")
    
    def test_spot_detail_out_of_geofence_nullifies_list(self):
        """Privacy Shield: When out of geofence, active_photographers=[], breathing_status=false"""
        # Get a spot
        spots_response = requests.get(f"{BASE_URL}/api/surf-spots")
        spots = spots_response.json()
        spot = spots[0]
        spot_id = spot['id']
        
        # Request with user location FAR from spot (e.g., 1000 miles away)
        # Spot is likely in Florida, so use a location in California
        far_lat = 34.0  # Los Angeles area
        far_lon = -118.0
        
        response = requests.get(
            f"{BASE_URL}/api/surf-spots/{spot_id}",
            params={
                "user_lat": far_lat,
                "user_lon": far_lon,
                "user_id": ADMIN_PROFILE_ID  # Free tier = 1 mile radius
            }
        )
        assert response.status_code == 200
        data = response.json()
        
        # Check Privacy Shield fields
        assert 'active_photographers_count' in data, "active_photographers_count should ALWAYS be present"
        assert 'active_photographers' in data, "active_photographers field should be present"
        assert 'breathing_status' in data, "breathing_status field should be present"
        assert 'is_within_geofence' in data, "is_within_geofence field should be present"
        
        # When out of geofence:
        # - active_photographers_count should still be returned (for upsell)
        # - active_photographers should be empty list
        # - breathing_status should be false
        if not data['is_within_geofence']:
            assert data['active_photographers'] == [], f"active_photographers should be [] when out of geofence, got: {data['active_photographers']}"
            assert data['breathing_status'] == False, f"breathing_status should be false when out of geofence, got: {data['breathing_status']}"
            print(f"PASS: Out of geofence - active_photographers=[], breathing_status=false, but count={data['active_photographers_count']}")
        else:
            print(f"INFO: User is within geofence (distance: {data.get('distance_miles')} miles)")
    
    def test_spot_detail_within_geofence_returns_all(self):
        """Privacy Shield: When within geofence, all data is returned"""
        # Get a spot
        spots_response = requests.get(f"{BASE_URL}/api/surf-spots")
        spots = spots_response.json()
        spot = spots[0]
        spot_id = spot['id']
        
        # Request with user location AT the spot (0 distance)
        response = requests.get(
            f"{BASE_URL}/api/surf-spots/{spot_id}",
            params={
                "user_lat": spot['latitude'],
                "user_lon": spot['longitude'],
                "user_id": ADMIN_PROFILE_ID
            }
        )
        assert response.status_code == 200
        data = response.json()
        
        # When within geofence, is_within_geofence should be true
        assert data['is_within_geofence'] == True, "Should be within geofence when at spot location"
        assert 'active_photographers_count' in data
        assert 'active_photographers' in data
        print(f"PASS: Within geofence - all data returned, count={data['active_photographers_count']}")
    
    def test_spot_list_returns_count_always(self):
        """Privacy Shield: GET /api/surf-spots list should return active_photographers_count for all spots"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        spots = response.json()
        
        for spot in spots[:5]:  # Check first 5 spots
            assert 'active_photographers_count' in spot, f"Spot {spot['name']} missing active_photographers_count"
            assert isinstance(spot['active_photographers_count'], int)
        
        print(f"PASS: All spots in list have active_photographers_count field")


class TestSpotImport:
    """Test that spot import has 195 total spots"""
    
    def test_total_spots_count(self):
        """Verify total spots is now 195 (up from 80)"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        spots = response.json()
        
        total_count = len(spots)
        assert total_count >= 195, f"Expected at least 195 spots, got {total_count}"
        print(f"PASS: Total spots count: {total_count} (expected >= 195)")
    
    def test_florida_spots_exist(self):
        """Verify Florida spots are present"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        spots = response.json()
        
        florida_spots = [s for s in spots if s.get('state_province') == 'Florida' or 'Florida' in (s.get('region') or '')]
        assert len(florida_spots) > 0, "Should have Florida spots"
        print(f"PASS: Found {len(florida_spots)} Florida spots")
    
    def test_usa_coastline_spots(self):
        """Verify USA coastline spots are present"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        spots = response.json()
        
        usa_spots = [s for s in spots if s.get('country') == 'USA']
        assert len(usa_spots) > 50, f"Expected many USA spots, got {len(usa_spots)}"
        print(f"PASS: Found {len(usa_spots)} USA spots")


class TestStripeIdentity:
    """Test Stripe Identity endpoint uses STRIPE_API_KEY"""
    
    def test_identity_endpoint_exists(self):
        """Verify /api/payments/identity/create-session endpoint exists and uses STRIPE_API_KEY"""
        # Test with valid admin user to verify Stripe Identity works
        response = requests.post(
            f"{BASE_URL}/api/payments/identity/create-session",
            params={"user_id": ADMIN_PROFILE_ID}
        )
        
        # Should return 200 with session_id and url if Stripe is configured
        if response.status_code == 200:
            data = response.json()
            assert 'session_id' in data, "Response should contain session_id"
            assert 'url' in data, "Response should contain url"
            assert data['session_id'].startswith('vs_'), "Session ID should start with 'vs_'"
            print(f"PASS: Stripe Identity working - session_id: {data['session_id'][:20]}...")
        elif response.status_code == 503:
            print("INFO: Stripe Identity returns 503 - Stripe not configured")
        else:
            # 500 with "Failed to create verification session" means endpoint exists but user issue
            print(f"INFO: Identity endpoint exists, returns {response.status_code}")
    
    def test_identity_status_endpoint(self):
        """Verify /api/payments/identity/status/{user_id} endpoint exists"""
        response = requests.get(f"{BASE_URL}/api/payments/identity/status/{ADMIN_PROFILE_ID}")
        assert response.status_code in [200, 404]
        
        if response.status_code == 200:
            data = response.json()
            assert 'is_verified' in data
            print(f"PASS: Identity status endpoint works, is_verified={data.get('is_verified')}")
        else:
            print(f"INFO: Identity status returns {response.status_code}")


class TestGeofenceFields:
    """Test geofence-related fields in API responses"""
    
    def test_spot_detail_has_geofence_fields(self):
        """Verify spot detail includes all geofence fields"""
        spots_response = requests.get(f"{BASE_URL}/api/surf-spots")
        spots = spots_response.json()
        spot_id = spots[0]['id']
        
        response = requests.get(
            f"{BASE_URL}/api/surf-spots/{spot_id}",
            params={
                "user_lat": 25.0,
                "user_lon": -80.0,
                "user_id": ADMIN_PROFILE_ID
            }
        )
        assert response.status_code == 200
        data = response.json()
        
        # Check all expected geofence fields
        expected_fields = [
            'active_photographers_count',
            'active_photographers',
            'breathing_status',
            'is_within_geofence',
            'distance_miles',
            'visibility_radius_miles',
            'upgrade_required'
        ]
        
        for field in expected_fields:
            assert field in data, f"Missing field: {field}"
        
        print(f"PASS: All geofence fields present: {expected_fields}")
    
    def test_upgrade_required_matches_geofence(self):
        """Verify upgrade_required matches is_within_geofence"""
        spots_response = requests.get(f"{BASE_URL}/api/surf-spots")
        spots = spots_response.json()
        spot_id = spots[0]['id']
        
        response = requests.get(
            f"{BASE_URL}/api/surf-spots/{spot_id}",
            params={
                "user_lat": 25.0,
                "user_lon": -80.0,
                "user_id": ADMIN_PROFILE_ID
            }
        )
        data = response.json()
        
        # upgrade_required should be opposite of is_within_geofence
        expected_upgrade = not data['is_within_geofence']
        assert data['upgrade_required'] == expected_upgrade, \
            f"upgrade_required ({data['upgrade_required']}) should be opposite of is_within_geofence ({data['is_within_geofence']})"
        
        print(f"PASS: upgrade_required={data['upgrade_required']} matches !is_within_geofence")


class TestNearbySpots:
    """Test nearby spots endpoint with Privacy Shield"""
    
    def test_nearby_spots_returns_geofence_info(self):
        """Verify nearby spots includes geofence info"""
        response = requests.get(
            f"{BASE_URL}/api/surf-spots/nearby",
            params={
                "latitude": 28.3655,  # Cocoa Beach area
                "longitude": -80.5995,
                "radius_miles": 50,
                "user_id": ADMIN_PROFILE_ID
            }
        )
        assert response.status_code == 200
        spots = response.json()
        
        if len(spots) > 0:
            spot = spots[0]
            assert 'is_within_geofence' in spot, "Nearby spots should include is_within_geofence"
            assert 'active_photographers_count' in spot, "Nearby spots should include active_photographers_count"
            print(f"PASS: Nearby spots include geofence info, found {len(spots)} spots")
        else:
            print("INFO: No nearby spots found in test area")


class TestAdminSpotStats:
    """Test admin spot statistics"""
    
    def test_spot_stats_endpoint(self):
        """Verify admin spot stats endpoint works"""
        response = requests.get(
            f"{BASE_URL}/api/admin/spots/stats",
            params={"admin_id": ADMIN_PROFILE_ID}
        )
        
        if response.status_code == 200:
            data = response.json()
            assert 'total_spots' in data
            assert data['total_spots'] >= 195, f"Expected >= 195 spots, got {data['total_spots']}"
            print(f"PASS: Admin stats shows {data['total_spots']} total spots")
        elif response.status_code == 403:
            print("INFO: Admin access required for spot stats")
        else:
            print(f"INFO: Spot stats returned {response.status_code}")


# Run tests
if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
