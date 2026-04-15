"""
Test Privacy Shield & Global Spot Sync - Iteration 145
Tests:
- GET /api/surf-spots with geofencing based on subscription tier
- GET /api/surf-spots/{id} with Privacy Shield (active_photographers only if within geofence)
- GET /api/admin/spots/stats for global spot statistics
- Database: 80 spots across 13 countries
- Privacy Shield visibility radii: Free=1mi, Basic=10mi, Premium=unlimited
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials
ADMIN_ID = "12dc6786-124f-40b1-8698-a9409f99736f"
ADMIN_EMAIL = "dpritzker0905@gmail.com"
ADMIN_PASSWORD = "TestPass123!"

# Test location: Miami Beach
MIAMI_LAT = 25.7617
MIAMI_LON = -80.1918


class TestGlobalSpotDatabase:
    """Test that 80 spots are imported across 13 countries"""
    
    def test_total_spot_count(self):
        """Verify 80 spots are in the database"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        spots = response.json()
        assert len(spots) == 80, f"Expected 80 spots, got {len(spots)}"
        print(f"✓ Total spots: {len(spots)}")
    
    def test_spots_by_country_distribution(self):
        """Verify spots are distributed across expected countries"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        
        spots = response.json()
        countries = {}
        for spot in spots:
            country = spot.get('country', 'Unknown')
            countries[country] = countries.get(country, 0) + 1
        
        # Expected distribution based on import script
        expected_countries = {
            'USA': 44,
            'Australia': 8,
            'Indonesia': 7,
            'Portugal': 4,
            'France': 3,
            'Costa Rica': 3,
            'South Africa': 2,
            'Japan': 2,
            'Spain': 2,
            'Mexico': 2,
            'Peru': 1,
            'Brazil': 1,
            'Chile': 1
        }
        
        assert len(countries) == 13, f"Expected 13 countries, got {len(countries)}"
        
        for country, expected_count in expected_countries.items():
            actual_count = countries.get(country, 0)
            assert actual_count == expected_count, f"{country}: expected {expected_count}, got {actual_count}"
        
        print(f"✓ Spots by country: {countries}")
    
    def test_spots_have_required_fields(self):
        """Verify spots have new global fields (country, state_province, wave_type)"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        
        spots = response.json()
        for spot in spots[:10]:  # Check first 10 spots
            assert 'country' in spot, f"Spot {spot['name']} missing 'country' field"
            assert 'state_province' in spot, f"Spot {spot['name']} missing 'state_province' field"
            assert 'wave_type' in spot, f"Spot {spot['name']} missing 'wave_type' field"
            assert 'is_within_geofence' in spot, f"Spot {spot['name']} missing 'is_within_geofence' field"
            assert 'distance_miles' in spot, f"Spot {spot['name']} missing 'distance_miles' field"
        
        print("✓ All spots have required global fields")
    
    def test_filter_by_country(self):
        """Test filtering spots by country"""
        response = requests.get(f"{BASE_URL}/api/surf-spots?country=Australia")
        assert response.status_code == 200
        
        spots = response.json()
        assert len(spots) == 8, f"Expected 8 Australian spots, got {len(spots)}"
        
        for spot in spots:
            assert spot['country'] == 'Australia', f"Spot {spot['name']} has country {spot['country']}"
        
        print(f"✓ Country filter works: {len(spots)} Australian spots")


class TestPrivacyShieldGeofencing:
    """Test Privacy Shield visibility radius based on subscription tier"""
    
    def test_free_tier_1_mile_radius(self):
        """Free tier users (no user_id) should have 1 mile visibility radius"""
        response = requests.get(
            f"{BASE_URL}/api/surf-spots",
            params={
                'user_lat': MIAMI_LAT,
                'user_lon': MIAMI_LON
                # No user_id = free tier
            }
        )
        assert response.status_code == 200
        
        spots = response.json()
        within_geofence = [s for s in spots if s.get('is_within_geofence')]
        outside_geofence = [s for s in spots if not s.get('is_within_geofence')]
        
        # Free tier (1 mile) - South Beach is 4.42 mi away, so nothing should be within geofence
        assert len(within_geofence) == 0, f"Free tier should have 0 spots within 1mi, got {len(within_geofence)}"
        assert len(outside_geofence) == 80, f"All 80 spots should be outside geofence for free tier"
        
        # Verify distance is calculated
        for spot in spots[:5]:
            assert spot.get('distance_miles') is not None, f"Spot {spot['name']} missing distance"
        
        print(f"✓ Free tier (1mi): {len(within_geofence)} within, {len(outside_geofence)} outside")
    
    def test_basic_tier_10_mile_radius(self):
        """Basic tier users should have 10 mile visibility radius"""
        response = requests.get(
            f"{BASE_URL}/api/surf-spots",
            params={
                'user_lat': MIAMI_LAT,
                'user_lon': MIAMI_LON,
                'user_id': ADMIN_ID  # Admin has basic tier
            }
        )
        assert response.status_code == 200
        
        spots = response.json()
        within_geofence = [s for s in spots if s.get('is_within_geofence')]
        outside_geofence = [s for s in spots if not s.get('is_within_geofence')]
        
        # Basic tier (10 miles) - South Beach at 4.42mi should be within
        assert len(within_geofence) >= 1, f"Basic tier should have at least 1 spot within 10mi"
        
        # Verify South Beach is within geofence
        south_beach = next((s for s in spots if 'South Beach' in s['name']), None)
        assert south_beach is not None, "South Beach not found"
        assert south_beach['is_within_geofence'] == True, "South Beach should be within geofence for basic tier"
        assert south_beach['distance_miles'] < 10, f"South Beach distance {south_beach['distance_miles']} should be < 10mi"
        
        # Verify Haulover Beach (10.79mi) is outside geofence
        haulover = next((s for s in spots if 'Haulover' in s['name']), None)
        assert haulover is not None, "Haulover Beach not found"
        assert haulover['is_within_geofence'] == False, "Haulover Beach should be outside geofence for basic tier"
        assert haulover['distance_miles'] > 10, f"Haulover distance {haulover['distance_miles']} should be > 10mi"
        
        print(f"✓ Basic tier (10mi): {len(within_geofence)} within, {len(outside_geofence)} outside")
    
    def test_geofence_affects_photographer_count(self):
        """Spots outside geofence should have active_photographers_count = 0"""
        response = requests.get(
            f"{BASE_URL}/api/surf-spots",
            params={
                'user_lat': MIAMI_LAT,
                'user_lon': MIAMI_LON
                # Free tier
            }
        )
        assert response.status_code == 200
        
        spots = response.json()
        outside_geofence = [s for s in spots if not s.get('is_within_geofence')]
        
        # All spots outside geofence should have 0 photographers (Privacy Shield)
        for spot in outside_geofence:
            assert spot['active_photographers_count'] == 0, \
                f"Spot {spot['name']} outside geofence should have 0 photographers, got {spot['active_photographers_count']}"
        
        print("✓ Privacy Shield: Spots outside geofence show 0 photographers")


class TestSingleSpotPrivacyShield:
    """Test GET /api/surf-spots/{id} with Privacy Shield"""
    
    def test_spot_within_geofence_shows_photographers(self):
        """Spot within geofence should show active_photographers list"""
        # First get South Beach ID
        response = requests.get(f"{BASE_URL}/api/surf-spots?country=USA")
        spots = response.json()
        south_beach = next((s for s in spots if 'South Beach' in s['name']), None)
        assert south_beach is not None, "South Beach not found"
        
        # Get single spot with basic tier user (10mi radius)
        response = requests.get(
            f"{BASE_URL}/api/surf-spots/{south_beach['id']}",
            params={
                'user_lat': MIAMI_LAT,
                'user_lon': MIAMI_LON,
                'user_id': ADMIN_ID
            }
        )
        assert response.status_code == 200
        
        spot = response.json()
        assert spot['is_within_geofence'] == True, "South Beach should be within geofence"
        assert spot['visibility_radius_miles'] == 10.0, f"Basic tier should have 10mi radius, got {spot['visibility_radius_miles']}"
        assert 'active_photographers' in spot, "Should have active_photographers field"
        assert spot['active_photographers'] is not None, "active_photographers should not be null when within geofence"
        assert isinstance(spot['active_photographers'], list), "active_photographers should be a list"
        assert spot['upgrade_required'] == False, "upgrade_required should be False when within geofence"
        
        print(f"✓ Spot within geofence: active_photographers={spot['active_photographers']}, upgrade_required={spot['upgrade_required']}")
    
    def test_spot_outside_geofence_hides_photographers(self):
        """Spot outside geofence should hide active_photographers list"""
        # First get Haulover Beach ID (10.79mi from Miami)
        response = requests.get(f"{BASE_URL}/api/surf-spots?country=USA")
        spots = response.json()
        haulover = next((s for s in spots if 'Haulover' in s['name']), None)
        assert haulover is not None, "Haulover Beach not found"
        
        # Get single spot with basic tier user (10mi radius) - Haulover is 10.79mi away
        response = requests.get(
            f"{BASE_URL}/api/surf-spots/{haulover['id']}",
            params={
                'user_lat': MIAMI_LAT,
                'user_lon': MIAMI_LON,
                'user_id': ADMIN_ID
            }
        )
        assert response.status_code == 200
        
        spot = response.json()
        assert spot['is_within_geofence'] == False, "Haulover should be outside geofence for basic tier"
        assert spot['visibility_radius_miles'] == 10.0, f"Basic tier should have 10mi radius"
        assert spot['active_photographers'] is None, "active_photographers should be null when outside geofence"
        assert spot['active_photographers_count'] == 0, "active_photographers_count should be 0 when outside geofence"
        assert spot['upgrade_required'] == True, "upgrade_required should be True when outside geofence"
        
        print(f"✓ Spot outside geofence: active_photographers=null, upgrade_required=True")
    
    def test_free_tier_single_spot(self):
        """Free tier should have 1mi visibility radius on single spot"""
        # Get South Beach (4.42mi from Miami)
        response = requests.get(f"{BASE_URL}/api/surf-spots?country=USA")
        spots = response.json()
        south_beach = next((s for s in spots if 'South Beach' in s['name']), None)
        
        # Get single spot with free tier (no user_id)
        response = requests.get(
            f"{BASE_URL}/api/surf-spots/{south_beach['id']}",
            params={
                'user_lat': MIAMI_LAT,
                'user_lon': MIAMI_LON
                # No user_id = free tier
            }
        )
        assert response.status_code == 200
        
        spot = response.json()
        assert spot['visibility_radius_miles'] == 1.0, f"Free tier should have 1mi radius, got {spot['visibility_radius_miles']}"
        assert spot['is_within_geofence'] == False, "South Beach (4.42mi) should be outside 1mi geofence"
        assert spot['upgrade_required'] == True, "upgrade_required should be True for free tier"
        
        print(f"✓ Free tier single spot: visibility_radius=1mi, upgrade_required=True")


class TestAdminSpotStats:
    """Test GET /api/admin/spots/stats endpoint"""
    
    def test_admin_stats_returns_correct_totals(self):
        """Admin stats should return correct total and country breakdown"""
        response = requests.get(
            f"{BASE_URL}/api/admin/spots/stats",
            params={'admin_id': ADMIN_ID}
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        stats = response.json()
        
        # Verify total spots
        assert stats['total_spots'] == 80, f"Expected 80 total spots, got {stats['total_spots']}"
        
        # Verify by_country structure
        assert 'by_country' in stats, "Missing by_country field"
        assert isinstance(stats['by_country'], list), "by_country should be a list"
        
        # Verify USA is first (most spots)
        assert stats['by_country'][0]['country'] == 'USA', "USA should be first"
        assert stats['by_country'][0]['count'] == 44, f"USA should have 44 spots, got {stats['by_country'][0]['count']}"
        
        print(f"✓ Admin stats: total={stats['total_spots']}, countries={len(stats['by_country'])}")
    
    def test_admin_stats_by_tier(self):
        """Admin stats should return tier breakdown"""
        response = requests.get(
            f"{BASE_URL}/api/admin/spots/stats",
            params={'admin_id': ADMIN_ID}
        )
        assert response.status_code == 200
        
        stats = response.json()
        
        # Verify by_tier structure
        assert 'by_tier' in stats, "Missing by_tier field"
        
        # Verify tier counts add up to total
        tier_total = sum(stats['by_tier'].values())
        assert tier_total == 80, f"Tier totals should sum to 80, got {tier_total}"
        
        print(f"✓ Admin stats by tier: {stats['by_tier']}")
    
    def test_admin_stats_requires_admin(self):
        """Admin stats should require admin access"""
        # Test with non-existent user
        response = requests.get(
            f"{BASE_URL}/api/admin/spots/stats",
            params={'admin_id': 'non-existent-user-id'}
        )
        assert response.status_code in [403, 404], f"Expected 403/404 for non-admin, got {response.status_code}"
        
        print("✓ Admin stats requires admin access")


class TestDistanceCalculation:
    """Test haversine distance calculation accuracy"""
    
    def test_distance_calculation_accuracy(self):
        """Verify distance calculations are accurate"""
        response = requests.get(
            f"{BASE_URL}/api/surf-spots",
            params={
                'user_lat': MIAMI_LAT,
                'user_lon': MIAMI_LON
            }
        )
        assert response.status_code == 200
        
        spots = response.json()
        
        # Find South Beach and verify distance
        south_beach = next((s for s in spots if 'South Beach' in s['name']), None)
        assert south_beach is not None
        
        # South Beach is approximately 4.4 miles from Miami Beach
        assert 4.0 <= south_beach['distance_miles'] <= 5.0, \
            f"South Beach distance should be ~4.4mi, got {south_beach['distance_miles']}"
        
        # Find Haulover Beach and verify distance
        haulover = next((s for s in spots if 'Haulover' in s['name']), None)
        assert haulover is not None
        
        # Haulover is approximately 10.8 miles from Miami Beach
        assert 10.0 <= haulover['distance_miles'] <= 11.5, \
            f"Haulover distance should be ~10.8mi, got {haulover['distance_miles']}"
        
        print(f"✓ Distance calculations accurate: South Beach={south_beach['distance_miles']}mi, Haulover={haulover['distance_miles']}mi")


class TestViewportFiltering:
    """Test viewport-based filtering for map performance"""
    
    def test_viewport_filtering(self):
        """Test filtering spots by viewport bounds"""
        # Florida viewport
        response = requests.get(
            f"{BASE_URL}/api/surf-spots",
            params={
                'viewport_only': True,
                'min_lat': 24.5,
                'max_lat': 31.0,
                'min_lon': -82.0,
                'max_lon': -79.5
            }
        )
        assert response.status_code == 200
        
        spots = response.json()
        
        # Should only return Florida spots
        for spot in spots:
            assert 24.5 <= spot['latitude'] <= 31.0, f"Spot {spot['name']} latitude out of bounds"
            assert -82.0 <= spot['longitude'] <= -79.5, f"Spot {spot['name']} longitude out of bounds"
        
        print(f"✓ Viewport filtering: {len(spots)} spots in Florida viewport")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
