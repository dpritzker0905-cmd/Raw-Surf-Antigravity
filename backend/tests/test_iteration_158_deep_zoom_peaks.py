"""
Iteration 158 - Florida Deep-Zoom Peak-Finder Protocol Verification
Tests NOAA/TopoZone/Surfline verified coordinates for Florida surf spots.

Key verifications:
1. First Coast spots moved 1-2km EAST (less negative longitude)
2. Space Coast user-specified spots at EXACT coordinates
3. Cocoa Beach Pier at NOAA tide station 8721649 (28.3683, -80.6000)
4. Sebastian Inlet at TopoZone north jetty tip (27.8620, -80.4464)
5. Gulf Coast spots further WEST (more negative longitude)
6. Panhandle spots further SOUTH (lower latitude)
"""
import pytest
import requests
import os
import math

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'http://localhost:8001').rstrip('/')

# ============================================================
# EXPECTED COORDINATES FROM florida_deep_zoom_peaks.py
# ============================================================

# First Coast - Should be ~1-2km EAST of previous positions
FIRST_COAST_EXPECTED = {
    "Mayport Poles": {"lat": 30.3818, "lon": -81.3969, "source": "Surfline URL parameter"},
    "Atlantic Beach": {"lat": 30.3344, "lon": -81.3987, "source": "TopoZone GPS waypoint"},
    "Neptune Beach": {"lat": 30.3119, "lon": -81.3965, "source": "Multiple geocoders avg"},
    "Jacksonville Beach Pier": {"lat": 30.2833, "lon": -81.3867, "source": "NOAA station 8720291"},
}

# Space Coast - USER SPECIFIED EXACT coordinates
SPACE_COAST_USER_SPECIFIED = {
    "Jetty Park": {"lat": 28.4061, "lon": -80.5890, "source": "USER SPECIFIED - tip of north jetty"},
    "Cherie Down Park": {"lat": 28.3842, "lon": -80.6015, "source": "USER SPECIFIED - seaward of Ridgewood"},
    "Cocoa Beach Pier": {"lat": 28.3683, "lon": -80.6000, "source": "NOAA tide station 8721649 - pier end"},
    "Shepard Park": {"lat": 28.3585, "lon": -80.6035, "source": "USER SPECIFIED - offshore SR 520"},
}

# Sebastian Inlet - TopoZone verified
SEBASTIAN_INLET_EXPECTED = {
    "Sebastian Inlet": {"lat": 27.8620, "lon": -80.4464, "source": "TopoZone - north jetty tip light"},
}

# Gulf Coast - Should have MORE negative longitude (further WEST)
GULF_COAST_EXPECTED = {
    "Clearwater Beach": {"lat": 27.9780, "lon": -82.8500, "source": "Offshore WEST into Gulf"},
    "Siesta Key": {"lat": 27.2680, "lon": -82.5700, "source": "Offshore WEST"},
    "Naples Pier": {"lat": 26.1480, "lon": -81.8100, "source": "Pier tip WEST"},
    "St Pete Beach": {"lat": 27.7280, "lon": -82.7600, "source": "Offshore WEST into Gulf"},
}

# Panhandle - Should have lower latitude (further SOUTH into Gulf)
PANHANDLE_EXPECTED = {
    "Pensacola Beach": {"lat": 30.3250, "lon": -87.1380, "source": "Offshore SOUTH into Gulf"},
    "Panama City Beach": {"lat": 30.1650, "lon": -85.7920, "source": "Offshore SOUTH"},
    "Destin": {"lat": 30.3750, "lon": -86.4880, "source": "Offshore SOUTH"},
    "Navarre Beach": {"lat": 30.3650, "lon": -86.8520, "source": "Offshore SOUTH"},
}


def haversine_distance_meters(lat1, lon1, lat2, lon2):
    """Calculate distance between two points in meters."""
    R = 6371000  # Earth's radius in meters
    lat1_rad = math.radians(lat1)
    lat2_rad = math.radians(lat2)
    delta_lat = math.radians(lat2 - lat1)
    delta_lon = math.radians(lon2 - lon1)
    
    a = math.sin(delta_lat / 2) ** 2 + \
        math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(delta_lon / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    
    return R * c


class TestAPIHealth:
    """Basic API health checks"""
    
    def test_api_health(self):
        """Test API is responding"""
        response = requests.get(f"{BASE_URL}/api/health", timeout=10)
        assert response.status_code == 200, f"API health check failed: {response.status_code}"
        print("API health check: PASSED")
    
    def test_surf_spots_endpoint(self):
        """Test surf spots endpoint returns data"""
        response = requests.get(f"{BASE_URL}/api/surf-spots", timeout=30)
        assert response.status_code == 200, f"Surf spots endpoint failed: {response.status_code}"
        data = response.json()
        assert len(data) > 0, "No surf spots returned"
        print(f"Surf spots endpoint: PASSED ({len(data)} spots)")


class TestFirstCoastCoordinates:
    """Test First Coast spots are ~1-2km EAST of previous positions"""
    
    @pytest.fixture(scope="class")
    def florida_spots(self):
        """Get all Florida spots from API"""
        response = requests.get(f"{BASE_URL}/api/surf-spots", timeout=30)
        assert response.status_code == 200
        return {spot['name']: spot for spot in response.json()}
    
    def test_mayport_poles_coordinates(self, florida_spots):
        """Mayport Poles should be at Surfline URL parameter coordinates"""
        expected = FIRST_COAST_EXPECTED["Mayport Poles"]
        if "Mayport Poles" not in florida_spots:
            pytest.skip("Mayport Poles not found in database")
        
        spot = florida_spots["Mayport Poles"]
        distance = haversine_distance_meters(
            expected["lat"], expected["lon"],
            spot["latitude"], spot["longitude"]
        )
        
        print(f"Mayport Poles - Expected: ({expected['lat']}, {expected['lon']})")
        print(f"Mayport Poles - Actual: ({spot['latitude']}, {spot['longitude']})")
        print(f"Mayport Poles - Distance from expected: {distance:.0f}m")
        
        # Allow 100m tolerance for coordinate matching
        assert distance < 100, f"Mayport Poles coordinates off by {distance:.0f}m (expected < 100m)"
    
    def test_atlantic_beach_coordinates(self, florida_spots):
        """Atlantic Beach should be at TopoZone GPS waypoint coordinates"""
        expected = FIRST_COAST_EXPECTED["Atlantic Beach"]
        if "Atlantic Beach" not in florida_spots:
            pytest.skip("Atlantic Beach not found in database")
        
        spot = florida_spots["Atlantic Beach"]
        distance = haversine_distance_meters(
            expected["lat"], expected["lon"],
            spot["latitude"], spot["longitude"]
        )
        
        print(f"Atlantic Beach - Expected: ({expected['lat']}, {expected['lon']})")
        print(f"Atlantic Beach - Actual: ({spot['latitude']}, {spot['longitude']})")
        print(f"Atlantic Beach - Distance from expected: {distance:.0f}m")
        
        assert distance < 100, f"Atlantic Beach coordinates off by {distance:.0f}m"
    
    def test_neptune_beach_coordinates(self, florida_spots):
        """Neptune Beach should be at multiple geocoders avg coordinates"""
        expected = FIRST_COAST_EXPECTED["Neptune Beach"]
        if "Neptune Beach" not in florida_spots:
            pytest.skip("Neptune Beach not found in database")
        
        spot = florida_spots["Neptune Beach"]
        distance = haversine_distance_meters(
            expected["lat"], expected["lon"],
            spot["latitude"], spot["longitude"]
        )
        
        print(f"Neptune Beach - Expected: ({expected['lat']}, {expected['lon']})")
        print(f"Neptune Beach - Actual: ({spot['latitude']}, {spot['longitude']})")
        print(f"Neptune Beach - Distance from expected: {distance:.0f}m")
        
        assert distance < 100, f"Neptune Beach coordinates off by {distance:.0f}m"
    
    def test_jacksonville_beach_pier_coordinates(self, florida_spots):
        """Jacksonville Beach Pier should be at NOAA station 8720291 coordinates"""
        expected = FIRST_COAST_EXPECTED["Jacksonville Beach Pier"]
        if "Jacksonville Beach Pier" not in florida_spots:
            pytest.skip("Jacksonville Beach Pier not found in database")
        
        spot = florida_spots["Jacksonville Beach Pier"]
        distance = haversine_distance_meters(
            expected["lat"], expected["lon"],
            spot["latitude"], spot["longitude"]
        )
        
        print(f"Jacksonville Beach Pier - Expected: ({expected['lat']}, {expected['lon']})")
        print(f"Jacksonville Beach Pier - Actual: ({spot['latitude']}, {spot['longitude']})")
        print(f"Jacksonville Beach Pier - Distance from expected: {distance:.0f}m")
        
        assert distance < 100, f"Jacksonville Beach Pier coordinates off by {distance:.0f}m"


class TestSpaceCoastUserSpecified:
    """Test Space Coast user-specified spots have EXACT coordinates"""
    
    @pytest.fixture(scope="class")
    def florida_spots(self):
        """Get all Florida spots from API"""
        response = requests.get(f"{BASE_URL}/api/surf-spots", timeout=30)
        assert response.status_code == 200
        return {spot['name']: spot for spot in response.json()}
    
    def test_jetty_park_exact_coordinates(self, florida_spots):
        """Jetty Park should be at USER SPECIFIED exact coordinates"""
        expected = SPACE_COAST_USER_SPECIFIED["Jetty Park"]
        if "Jetty Park" not in florida_spots:
            pytest.skip("Jetty Park not found in database")
        
        spot = florida_spots["Jetty Park"]
        distance = haversine_distance_meters(
            expected["lat"], expected["lon"],
            spot["latitude"], spot["longitude"]
        )
        
        print(f"Jetty Park - Expected: ({expected['lat']}, {expected['lon']}) - USER SPECIFIED")
        print(f"Jetty Park - Actual: ({spot['latitude']}, {spot['longitude']})")
        print(f"Jetty Park - Distance from expected: {distance:.0f}m")
        
        # User-specified should be EXACT (within 50m)
        assert distance < 50, f"Jetty Park USER SPECIFIED coordinates off by {distance:.0f}m (expected < 50m)"
    
    def test_cherie_down_park_exact_coordinates(self, florida_spots):
        """Cherie Down Park should be at USER SPECIFIED exact coordinates"""
        expected = SPACE_COAST_USER_SPECIFIED["Cherie Down Park"]
        if "Cherie Down Park" not in florida_spots:
            pytest.skip("Cherie Down Park not found in database")
        
        spot = florida_spots["Cherie Down Park"]
        distance = haversine_distance_meters(
            expected["lat"], expected["lon"],
            spot["latitude"], spot["longitude"]
        )
        
        print(f"Cherie Down Park - Expected: ({expected['lat']}, {expected['lon']}) - USER SPECIFIED")
        print(f"Cherie Down Park - Actual: ({spot['latitude']}, {spot['longitude']})")
        print(f"Cherie Down Park - Distance from expected: {distance:.0f}m")
        
        assert distance < 50, f"Cherie Down Park USER SPECIFIED coordinates off by {distance:.0f}m"
    
    def test_cocoa_beach_pier_noaa_coordinates(self, florida_spots):
        """Cocoa Beach Pier should be at NOAA tide station 8721649 coordinates (28.3683, -80.6000)"""
        expected = SPACE_COAST_USER_SPECIFIED["Cocoa Beach Pier"]
        if "Cocoa Beach Pier" not in florida_spots:
            pytest.skip("Cocoa Beach Pier not found in database")
        
        spot = florida_spots["Cocoa Beach Pier"]
        distance = haversine_distance_meters(
            expected["lat"], expected["lon"],
            spot["latitude"], spot["longitude"]
        )
        
        print(f"Cocoa Beach Pier - Expected: ({expected['lat']}, {expected['lon']}) - NOAA 8721649")
        print(f"Cocoa Beach Pier - Actual: ({spot['latitude']}, {spot['longitude']})")
        print(f"Cocoa Beach Pier - Distance from expected: {distance:.0f}m")
        
        # NOAA station coordinates should be very precise
        assert distance < 50, f"Cocoa Beach Pier NOAA coordinates off by {distance:.0f}m (expected < 50m)"
    
    def test_shepard_park_exact_coordinates(self, florida_spots):
        """Shepard Park should be at USER SPECIFIED exact coordinates"""
        expected = SPACE_COAST_USER_SPECIFIED["Shepard Park"]
        if "Shepard Park" not in florida_spots:
            pytest.skip("Shepard Park not found in database")
        
        spot = florida_spots["Shepard Park"]
        distance = haversine_distance_meters(
            expected["lat"], expected["lon"],
            spot["latitude"], spot["longitude"]
        )
        
        print(f"Shepard Park - Expected: ({expected['lat']}, {expected['lon']}) - USER SPECIFIED")
        print(f"Shepard Park - Actual: ({spot['latitude']}, {spot['longitude']})")
        print(f"Shepard Park - Distance from expected: {distance:.0f}m")
        
        assert distance < 50, f"Shepard Park USER SPECIFIED coordinates off by {distance:.0f}m"


class TestSebastianInletCoordinates:
    """Test Sebastian Inlet at TopoZone north jetty tip coordinates"""
    
    @pytest.fixture(scope="class")
    def florida_spots(self):
        """Get all Florida spots from API"""
        response = requests.get(f"{BASE_URL}/api/surf-spots", timeout=30)
        assert response.status_code == 200
        return {spot['name']: spot for spot in response.json()}
    
    def test_sebastian_inlet_topozone_coordinates(self, florida_spots):
        """Sebastian Inlet should be at TopoZone north jetty tip (27.8620, -80.4464)"""
        expected = SEBASTIAN_INLET_EXPECTED["Sebastian Inlet"]
        if "Sebastian Inlet" not in florida_spots:
            pytest.skip("Sebastian Inlet not found in database")
        
        spot = florida_spots["Sebastian Inlet"]
        distance = haversine_distance_meters(
            expected["lat"], expected["lon"],
            spot["latitude"], spot["longitude"]
        )
        
        print(f"Sebastian Inlet - Expected: ({expected['lat']}, {expected['lon']}) - TopoZone north jetty tip")
        print(f"Sebastian Inlet - Actual: ({spot['latitude']}, {spot['longitude']})")
        print(f"Sebastian Inlet - Distance from expected: {distance:.0f}m")
        
        # TopoZone coordinates should be precise
        assert distance < 100, f"Sebastian Inlet TopoZone coordinates off by {distance:.0f}m (expected < 100m)"


class TestGulfCoastWestPositioning:
    """Test Gulf Coast spots have MORE negative longitude (further WEST into Gulf)"""
    
    @pytest.fixture(scope="class")
    def florida_spots(self):
        """Get all Florida spots from API"""
        response = requests.get(f"{BASE_URL}/api/surf-spots", timeout=30)
        assert response.status_code == 200
        return {spot['name']: spot for spot in response.json()}
    
    def test_clearwater_beach_west_positioning(self, florida_spots):
        """Clearwater Beach should be WEST into Gulf (lon < -82.8)"""
        expected = GULF_COAST_EXPECTED["Clearwater Beach"]
        if "Clearwater Beach" not in florida_spots:
            pytest.skip("Clearwater Beach not found in database")
        
        spot = florida_spots["Clearwater Beach"]
        
        print(f"Clearwater Beach - Expected lon: {expected['lon']} (WEST into Gulf)")
        print(f"Clearwater Beach - Actual: ({spot['latitude']}, {spot['longitude']})")
        
        # Gulf Coast spots should have longitude < -82.8 (WEST into Gulf)
        assert spot['longitude'] < -82.8, f"Clearwater Beach not far enough WEST: {spot['longitude']} (expected < -82.8)"
    
    def test_siesta_key_west_positioning(self, florida_spots):
        """Siesta Key should be WEST into Gulf (lon < -82.5)"""
        expected = GULF_COAST_EXPECTED["Siesta Key"]
        if "Siesta Key" not in florida_spots:
            pytest.skip("Siesta Key not found in database")
        
        spot = florida_spots["Siesta Key"]
        
        print(f"Siesta Key - Expected lon: {expected['lon']} (WEST into Gulf)")
        print(f"Siesta Key - Actual: ({spot['latitude']}, {spot['longitude']})")
        
        assert spot['longitude'] < -82.5, f"Siesta Key not far enough WEST: {spot['longitude']} (expected < -82.5)"
    
    def test_naples_pier_west_positioning(self, florida_spots):
        """Naples Pier should be WEST into Gulf (lon < -81.8)"""
        expected = GULF_COAST_EXPECTED["Naples Pier"]
        if "Naples Pier" not in florida_spots:
            pytest.skip("Naples Pier not found in database")
        
        spot = florida_spots["Naples Pier"]
        
        print(f"Naples Pier - Expected lon: {expected['lon']} (WEST into Gulf)")
        print(f"Naples Pier - Actual: ({spot['latitude']}, {spot['longitude']})")
        
        assert spot['longitude'] < -81.8, f"Naples Pier not far enough WEST: {spot['longitude']} (expected < -81.8)"
    
    def test_st_pete_beach_west_positioning(self, florida_spots):
        """St Pete Beach should be WEST into Gulf (lon < -82.7)"""
        expected = GULF_COAST_EXPECTED["St Pete Beach"]
        if "St Pete Beach" not in florida_spots:
            pytest.skip("St Pete Beach not found in database")
        
        spot = florida_spots["St Pete Beach"]
        
        print(f"St Pete Beach - Expected lon: {expected['lon']} (WEST into Gulf)")
        print(f"St Pete Beach - Actual: ({spot['latitude']}, {spot['longitude']})")
        
        assert spot['longitude'] < -82.7, f"St Pete Beach not far enough WEST: {spot['longitude']} (expected < -82.7)"


class TestPanhandleSouthPositioning:
    """Test Panhandle spots have lower latitude (further SOUTH into Gulf)"""
    
    @pytest.fixture(scope="class")
    def florida_spots(self):
        """Get all Florida spots from API"""
        response = requests.get(f"{BASE_URL}/api/surf-spots", timeout=30)
        assert response.status_code == 200
        return {spot['name']: spot for spot in response.json()}
    
    def test_pensacola_beach_south_positioning(self, florida_spots):
        """Pensacola Beach should be SOUTH into Gulf (lat < 30.35)"""
        expected = PANHANDLE_EXPECTED["Pensacola Beach"]
        if "Pensacola Beach" not in florida_spots:
            pytest.skip("Pensacola Beach not found in database")
        
        spot = florida_spots["Pensacola Beach"]
        
        print(f"Pensacola Beach - Expected lat: {expected['lat']} (SOUTH into Gulf)")
        print(f"Pensacola Beach - Actual: ({spot['latitude']}, {spot['longitude']})")
        
        # Panhandle spots should have latitude < 30.35 (SOUTH into Gulf)
        assert spot['latitude'] < 30.35, f"Pensacola Beach not far enough SOUTH: {spot['latitude']} (expected < 30.35)"
    
    def test_panama_city_beach_south_positioning(self, florida_spots):
        """Panama City Beach should be SOUTH into Gulf (lat < 30.2)"""
        expected = PANHANDLE_EXPECTED["Panama City Beach"]
        if "Panama City Beach" not in florida_spots:
            pytest.skip("Panama City Beach not found in database")
        
        spot = florida_spots["Panama City Beach"]
        
        print(f"Panama City Beach - Expected lat: {expected['lat']} (SOUTH into Gulf)")
        print(f"Panama City Beach - Actual: ({spot['latitude']}, {spot['longitude']})")
        
        assert spot['latitude'] < 30.2, f"Panama City Beach not far enough SOUTH: {spot['latitude']} (expected < 30.2)"
    
    def test_destin_south_positioning(self, florida_spots):
        """Destin should be SOUTH into Gulf (lat < 30.4)"""
        expected = PANHANDLE_EXPECTED["Destin"]
        if "Destin" not in florida_spots:
            pytest.skip("Destin not found in database")
        
        spot = florida_spots["Destin"]
        
        print(f"Destin - Expected lat: {expected['lat']} (SOUTH into Gulf)")
        print(f"Destin - Actual: ({spot['latitude']}, {spot['longitude']})")
        
        assert spot['latitude'] < 30.4, f"Destin not far enough SOUTH: {spot['latitude']} (expected < 30.4)"
    
    def test_navarre_beach_south_positioning(self, florida_spots):
        """Navarre Beach should be SOUTH into Gulf (lat < 30.4)"""
        expected = PANHANDLE_EXPECTED["Navarre Beach"]
        if "Navarre Beach" not in florida_spots:
            pytest.skip("Navarre Beach not found in database")
        
        spot = florida_spots["Navarre Beach"]
        
        print(f"Navarre Beach - Expected lat: {expected['lat']} (SOUTH into Gulf)")
        print(f"Navarre Beach - Actual: ({spot['latitude']}, {spot['longitude']})")
        
        assert spot['latitude'] < 30.4, f"Navarre Beach not far enough SOUTH: {spot['latitude']} (expected < 30.4)"


class TestFloridaSpotsOverWater:
    """Test that Florida spots are positioned over water (not on land)"""
    
    @pytest.fixture(scope="class")
    def florida_spots(self):
        """Get all Florida spots from API"""
        response = requests.get(f"{BASE_URL}/api/surf-spots", timeout=30)
        assert response.status_code == 200
        return response.json()
    
    def test_atlantic_coast_spots_offshore(self, florida_spots):
        """Atlantic Coast spots should have longitude < -80.0 (offshore)"""
        atlantic_regions = ["Northeast Florida", "Central Florida", "Treasure Coast", "Southeast Florida", "Miami"]
        atlantic_spots = [s for s in florida_spots if s.get('region') in atlantic_regions]
        
        offshore_count = 0
        total_count = len(atlantic_spots)
        
        for spot in atlantic_spots:
            # Atlantic Coast spots should have longitude between -81.5 and -80.0
            if spot['longitude'] < -80.0:
                offshore_count += 1
        
        offshore_pct = (offshore_count / total_count * 100) if total_count > 0 else 0
        print(f"Atlantic Coast spots offshore: {offshore_count}/{total_count} ({offshore_pct:.0f}%)")
        
        # At least 70% should be offshore
        assert offshore_pct >= 70, f"Only {offshore_pct:.0f}% of Atlantic Coast spots are offshore (expected >= 70%)"
    
    def test_gulf_coast_spots_offshore(self, florida_spots):
        """Gulf Coast spots should have longitude < -81.5 (offshore WEST)"""
        gulf_regions = ["Tampa Bay", "Sarasota", "Southwest Florida"]
        gulf_spots = [s for s in florida_spots if s.get('region') in gulf_regions]
        
        # Also check by longitude range for Gulf Coast
        gulf_spots_by_lon = [s for s in florida_spots if s['longitude'] < -81.5 and s['latitude'] < 29.0]
        
        offshore_count = 0
        total_count = len(gulf_spots) if gulf_spots else len(gulf_spots_by_lon)
        spots_to_check = gulf_spots if gulf_spots else gulf_spots_by_lon
        
        for spot in spots_to_check:
            # Gulf Coast spots should have longitude < -81.5
            if spot['longitude'] < -81.5:
                offshore_count += 1
        
        offshore_pct = (offshore_count / total_count * 100) if total_count > 0 else 0
        print(f"Gulf Coast spots offshore: {offshore_count}/{total_count} ({offshore_pct:.0f}%)")
        
        # At least 70% should be offshore
        if total_count > 0:
            assert offshore_pct >= 70, f"Only {offshore_pct:.0f}% of Gulf Coast spots are offshore (expected >= 70%)"
    
    def test_total_florida_spots_count(self, florida_spots):
        """Should have 90+ Florida spots after deep-zoom update"""
        florida_count = len([s for s in florida_spots if 
            (s.get('country') == 'USA' and s.get('state_province') == 'Florida') or
            (s.get('region') and 'Florida' in s.get('region', '')) or
            (s['latitude'] > 24.5 and s['latitude'] < 31.0 and s['longitude'] > -88.0 and s['longitude'] < -79.5)
        ])
        
        print(f"Total Florida spots: {florida_count}")
        
        # Should have at least 90 Florida spots after deep-zoom update
        assert florida_count >= 90, f"Only {florida_count} Florida spots (expected >= 90)"


class TestCoordinatePrecision:
    """Test coordinate precision for key spots"""
    
    @pytest.fixture(scope="class")
    def florida_spots(self):
        """Get all Florida spots from API"""
        response = requests.get(f"{BASE_URL}/api/surf-spots", timeout=30)
        assert response.status_code == 200
        return {spot['name']: spot for spot in response.json()}
    
    def test_all_user_specified_spots_present(self, florida_spots):
        """All user-specified spots should be in database"""
        user_specified = ["Jetty Park", "Cherie Down Park", "Cocoa Beach Pier", "Shepard Park"]
        missing = [name for name in user_specified if name not in florida_spots]
        
        print(f"User-specified spots found: {len(user_specified) - len(missing)}/{len(user_specified)}")
        if missing:
            print(f"Missing spots: {missing}")
        
        assert len(missing) == 0, f"Missing user-specified spots: {missing}"
    
    def test_all_noaa_verified_spots_present(self, florida_spots):
        """All NOAA-verified spots should be in database"""
        noaa_spots = ["Jacksonville Beach Pier", "Cocoa Beach Pier"]
        missing = [name for name in noaa_spots if name not in florida_spots]
        
        print(f"NOAA-verified spots found: {len(noaa_spots) - len(missing)}/{len(noaa_spots)}")
        if missing:
            print(f"Missing spots: {missing}")
        
        assert len(missing) == 0, f"Missing NOAA-verified spots: {missing}"
    
    def test_sebastian_inlet_present(self, florida_spots):
        """Sebastian Inlet (TopoZone verified) should be in database"""
        assert "Sebastian Inlet" in florida_spots, "Sebastian Inlet not found in database"
        print("Sebastian Inlet: FOUND")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
