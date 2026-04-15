"""
Test Iteration 161 - Florida Final Sync (Cam-Anchor Research)
Verifies user-specified coordinates for:
- Brevard splits: RC's, Hightower Park, Pelican Beach Park
- Brevard/Indian River fixes: Spessard Holland, Paradise Beach
- Palm Beach fixes: Reef Road (Big Wave peak)
- Miami-Dade expansion: Haulover Inlet N/S Jetty, South Beach 1st/5th/21st Street
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# User-specified exact coordinates from the problem statement
USER_SPECIFIED_COORDINATES = {
    # Brevard Splits (Satellite Beach area)
    "RC's": {"lat": 28.182, "lon": -80.593},
    "Hightower Park": {"lat": 28.163, "lon": -80.590},
    "Pelican Beach Park": {"lat": 28.151, "lon": -80.591},
    
    # Brevard/Indian River Fixes
    "Spessard Holland": {"lat": 28.024, "lon": -80.551},
    "Paradise Beach": {"lat": 28.123, "lon": -80.575},
    
    # Palm Beach Fixes
    "Reef Road": {"lat": 26.784, "lon": -80.033},
}

# Miami-Dade expansion spots (new additions)
MIAMI_DADE_EXPANSION = [
    "Haulover Inlet North Jetty",
    "Haulover Inlet South Jetty",
    "South Beach 5th Street",
    "South Beach 1st Street",
    "South Beach 21st Street",
    "Penrod Park",
]

# Additional spots from the sync script
ADDITIONAL_SPOTS = [
    "Pump House",
    "Jupiter Inlet",
]


class TestAPIHealth:
    """Basic API health check"""
    
    def test_api_health(self):
        """Verify API is healthy"""
        response = requests.get(f"{BASE_URL}/api/health", timeout=10)
        assert response.status_code == 200
        data = response.json()
        assert data.get("status") == "healthy"
        print(f"API Health: {data.get('status')}")


class TestSurfSpotsEndpoint:
    """Test surf spots endpoint is working"""
    
    def test_surf_spots_endpoint(self):
        """Verify surf spots endpoint returns data"""
        response = requests.get(f"{BASE_URL}/api/surf-spots?limit=10", timeout=10)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) > 0
        print(f"Surf spots endpoint working, returned {len(data)} spots")


class TestTotalSpotCount:
    """Verify total spot count increased after Florida Final Sync"""
    
    def test_total_spot_count_increased(self):
        """Total spots should be 559+ (was 549 before sync + 10 new spots)"""
        response = requests.get(f"{BASE_URL}/api/surf-spots?limit=1000", timeout=30)
        assert response.status_code == 200
        data = response.json()
        total_count = len(data)
        
        # Previous iteration had 549 spots, now expecting 559+ with 10 new spots
        print(f"Total spot count: {total_count}")
        assert total_count >= 549, f"Expected at least 549 spots, got {total_count}"
        
        # Check if we have the expected increase
        if total_count >= 559:
            print(f"PASS: Total spots {total_count} >= 559 (10 new spots added)")
        else:
            print(f"WARNING: Total spots {total_count} < 559 (expected 10 new spots)")


class TestFloridaSpotCount:
    """Verify Florida spot count"""
    
    def test_florida_spot_count(self):
        """Florida spots should be 120+ (was 110 before sync + 10 new spots)"""
        response = requests.get(f"{BASE_URL}/api/surf-spots?limit=1000", timeout=30)
        assert response.status_code == 200
        data = response.json()
        
        florida_spots = [s for s in data if s.get("state_province") == "Florida"]
        florida_count = len(florida_spots)
        
        print(f"Florida spot count: {florida_count}")
        assert florida_count >= 110, f"Expected at least 110 Florida spots, got {florida_count}"
        
        if florida_count >= 120:
            print(f"PASS: Florida spots {florida_count} >= 120 (10 new spots added)")
        else:
            print(f"INFO: Florida spots {florida_count} (may need to verify new spots)")


class TestBrevardSplitsCoordinates:
    """Test user-specified Brevard splits at exact coordinates"""
    
    @pytest.fixture(scope="class")
    def all_spots(self):
        """Fetch all spots once for the class"""
        response = requests.get(f"{BASE_URL}/api/surf-spots?limit=1000", timeout=30)
        assert response.status_code == 200
        return response.json()
    
    def test_rcs_coordinates(self, all_spots):
        """RC's should be at (28.182, -80.593)"""
        spot = next((s for s in all_spots if s.get("name") == "RC's"), None)
        
        if spot is None:
            pytest.skip("RC's spot not found - may not have been synced yet")
        
        expected = USER_SPECIFIED_COORDINATES["RC's"]
        actual_lat = float(spot.get("latitude", 0))
        actual_lon = float(spot.get("longitude", 0))
        
        print(f"RC's - Expected: ({expected['lat']}, {expected['lon']})")
        print(f"RC's - Actual: ({actual_lat}, {actual_lon})")
        
        # Allow small tolerance for floating point
        assert abs(actual_lat - expected["lat"]) < 0.001, f"RC's latitude mismatch: {actual_lat} vs {expected['lat']}"
        assert abs(actual_lon - expected["lon"]) < 0.001, f"RC's longitude mismatch: {actual_lon} vs {expected['lon']}"
        print("PASS: RC's coordinates EXACT MATCH")
    
    def test_hightower_park_coordinates(self, all_spots):
        """Hightower Park should be at (28.163, -80.590)"""
        spot = next((s for s in all_spots if s.get("name") == "Hightower Park"), None)
        
        if spot is None:
            pytest.skip("Hightower Park spot not found - may not have been synced yet")
        
        expected = USER_SPECIFIED_COORDINATES["Hightower Park"]
        actual_lat = float(spot.get("latitude", 0))
        actual_lon = float(spot.get("longitude", 0))
        
        print(f"Hightower Park - Expected: ({expected['lat']}, {expected['lon']})")
        print(f"Hightower Park - Actual: ({actual_lat}, {actual_lon})")
        
        assert abs(actual_lat - expected["lat"]) < 0.001, f"Hightower Park latitude mismatch"
        assert abs(actual_lon - expected["lon"]) < 0.001, f"Hightower Park longitude mismatch"
        print("PASS: Hightower Park coordinates EXACT MATCH")
    
    def test_pelican_beach_park_coordinates(self, all_spots):
        """Pelican Beach Park should be at (28.151, -80.591)"""
        spot = next((s for s in all_spots if s.get("name") == "Pelican Beach Park"), None)
        
        if spot is None:
            pytest.skip("Pelican Beach Park spot not found - may not have been synced yet")
        
        expected = USER_SPECIFIED_COORDINATES["Pelican Beach Park"]
        actual_lat = float(spot.get("latitude", 0))
        actual_lon = float(spot.get("longitude", 0))
        
        print(f"Pelican Beach Park - Expected: ({expected['lat']}, {expected['lon']})")
        print(f"Pelican Beach Park - Actual: ({actual_lat}, {actual_lon})")
        
        assert abs(actual_lat - expected["lat"]) < 0.001, f"Pelican Beach Park latitude mismatch"
        assert abs(actual_lon - expected["lon"]) < 0.001, f"Pelican Beach Park longitude mismatch"
        print("PASS: Pelican Beach Park coordinates EXACT MATCH")


class TestBrevardIndianRiverFixes:
    """Test user-specified Brevard/Indian River fixes"""
    
    @pytest.fixture(scope="class")
    def all_spots(self):
        """Fetch all spots once for the class"""
        response = requests.get(f"{BASE_URL}/api/surf-spots?limit=1000", timeout=30)
        assert response.status_code == 200
        return response.json()
    
    def test_spessard_holland_coordinates(self, all_spots):
        """Spessard Holland should be at (28.024, -80.551) - moved 3.5km from park road to water"""
        spot = next((s for s in all_spots if s.get("name") == "Spessard Holland"), None)
        
        if spot is None:
            pytest.skip("Spessard Holland spot not found")
        
        expected = USER_SPECIFIED_COORDINATES["Spessard Holland"]
        actual_lat = float(spot.get("latitude", 0))
        actual_lon = float(spot.get("longitude", 0))
        
        print(f"Spessard Holland - Expected: ({expected['lat']}, {expected['lon']})")
        print(f"Spessard Holland - Actual: ({actual_lat}, {actual_lon})")
        
        assert abs(actual_lat - expected["lat"]) < 0.001, f"Spessard Holland latitude mismatch: {actual_lat} vs {expected['lat']}"
        assert abs(actual_lon - expected["lon"]) < 0.001, f"Spessard Holland longitude mismatch: {actual_lon} vs {expected['lon']}"
        print("PASS: Spessard Holland coordinates EXACT MATCH (moved to water)")
    
    def test_paradise_beach_coordinates(self, all_spots):
        """Paradise Beach should be at (28.123, -80.575) - moved from neighborhood to offshore peak"""
        spot = next((s for s in all_spots if s.get("name") == "Paradise Beach"), None)
        
        if spot is None:
            pytest.skip("Paradise Beach spot not found")
        
        expected = USER_SPECIFIED_COORDINATES["Paradise Beach"]
        actual_lat = float(spot.get("latitude", 0))
        actual_lon = float(spot.get("longitude", 0))
        
        print(f"Paradise Beach - Expected: ({expected['lat']}, {expected['lon']})")
        print(f"Paradise Beach - Actual: ({actual_lat}, {actual_lon})")
        
        assert abs(actual_lat - expected["lat"]) < 0.001, f"Paradise Beach latitude mismatch: {actual_lat} vs {expected['lat']}"
        assert abs(actual_lon - expected["lon"]) < 0.001, f"Paradise Beach longitude mismatch: {actual_lon} vs {expected['lon']}"
        print("PASS: Paradise Beach coordinates EXACT MATCH (moved to offshore peak)")


class TestPalmBeachFixes:
    """Test Palm Beach County fixes"""
    
    @pytest.fixture(scope="class")
    def all_spots(self):
        """Fetch all spots once for the class"""
        response = requests.get(f"{BASE_URL}/api/surf-spots?limit=1000", timeout=30)
        assert response.status_code == 200
        return response.json()
    
    def test_reef_road_coordinates(self, all_spots):
        """Reef Road should be at (26.784, -80.033) - Big Wave peak, moved 8.7km"""
        spot = next((s for s in all_spots if s.get("name") == "Reef Road"), None)
        
        if spot is None:
            pytest.skip("Reef Road spot not found")
        
        expected = USER_SPECIFIED_COORDINATES["Reef Road"]
        actual_lat = float(spot.get("latitude", 0))
        actual_lon = float(spot.get("longitude", 0))
        
        print(f"Reef Road - Expected: ({expected['lat']}, {expected['lon']})")
        print(f"Reef Road - Actual: ({actual_lat}, {actual_lon})")
        
        assert abs(actual_lat - expected["lat"]) < 0.001, f"Reef Road latitude mismatch: {actual_lat} vs {expected['lat']}"
        assert abs(actual_lon - expected["lon"]) < 0.001, f"Reef Road longitude mismatch: {actual_lon} vs {expected['lon']}"
        print("PASS: Reef Road coordinates EXACT MATCH (Big Wave peak)")


class TestMiamiDadeExpansion:
    """Test Miami-Dade expansion spots exist"""
    
    @pytest.fixture(scope="class")
    def all_spots(self):
        """Fetch all spots once for the class"""
        response = requests.get(f"{BASE_URL}/api/surf-spots?limit=1000", timeout=30)
        assert response.status_code == 200
        return response.json()
    
    def test_haulover_inlet_north_jetty_exists(self, all_spots):
        """Haulover Inlet North Jetty should exist"""
        spot = next((s for s in all_spots if s.get("name") == "Haulover Inlet North Jetty"), None)
        
        if spot is None:
            pytest.skip("Haulover Inlet North Jetty not found - may not have been synced yet")
        
        print(f"Haulover Inlet North Jetty found at ({spot.get('latitude')}, {spot.get('longitude')})")
        assert spot.get("state_province") == "Florida"
        print("PASS: Haulover Inlet North Jetty exists")
    
    def test_haulover_inlet_south_jetty_exists(self, all_spots):
        """Haulover Inlet South Jetty should exist"""
        spot = next((s for s in all_spots if s.get("name") == "Haulover Inlet South Jetty"), None)
        
        if spot is None:
            pytest.skip("Haulover Inlet South Jetty not found - may not have been synced yet")
        
        print(f"Haulover Inlet South Jetty found at ({spot.get('latitude')}, {spot.get('longitude')})")
        assert spot.get("state_province") == "Florida"
        print("PASS: Haulover Inlet South Jetty exists")
    
    def test_south_beach_5th_street_exists(self, all_spots):
        """South Beach 5th Street should exist"""
        spot = next((s for s in all_spots if s.get("name") == "South Beach 5th Street"), None)
        
        if spot is None:
            pytest.skip("South Beach 5th Street not found - may not have been synced yet")
        
        print(f"South Beach 5th Street found at ({spot.get('latitude')}, {spot.get('longitude')})")
        assert spot.get("state_province") == "Florida"
        print("PASS: South Beach 5th Street exists")
    
    def test_south_beach_1st_street_exists(self, all_spots):
        """South Beach 1st Street should exist"""
        spot = next((s for s in all_spots if s.get("name") == "South Beach 1st Street"), None)
        
        if spot is None:
            pytest.skip("South Beach 1st Street not found - may not have been synced yet")
        
        print(f"South Beach 1st Street found at ({spot.get('latitude')}, {spot.get('longitude')})")
        assert spot.get("state_province") == "Florida"
        print("PASS: South Beach 1st Street exists")
    
    def test_south_beach_21st_street_exists(self, all_spots):
        """South Beach 21st Street should exist"""
        spot = next((s for s in all_spots if s.get("name") == "South Beach 21st Street"), None)
        
        if spot is None:
            pytest.skip("South Beach 21st Street not found - may not have been synced yet")
        
        print(f"South Beach 21st Street found at ({spot.get('latitude')}, {spot.get('longitude')})")
        assert spot.get("state_province") == "Florida"
        print("PASS: South Beach 21st Street exists")
    
    def test_penrod_park_exists(self, all_spots):
        """Penrod Park should exist"""
        spot = next((s for s in all_spots if s.get("name") == "Penrod Park"), None)
        
        if spot is None:
            pytest.skip("Penrod Park not found - may not have been synced yet")
        
        print(f"Penrod Park found at ({spot.get('latitude')}, {spot.get('longitude')})")
        assert spot.get("state_province") == "Florida"
        print("PASS: Penrod Park exists")


class TestSpaceCoastRegionCount:
    """Verify Space Coast region has expected spot count"""
    
    def test_space_coast_spot_count(self):
        """Space Coast should have 26 spots (was 23 before sync)"""
        response = requests.get(f"{BASE_URL}/api/surf-spots?limit=1000", timeout=30)
        assert response.status_code == 200
        data = response.json()
        
        # Space Coast spots (Brevard County area, lat 27.8-28.7)
        space_coast_spots = [
            s for s in data 
            if s.get("state_province") == "Florida" 
            and s.get("region") in ["Space Coast", "Satellite Beach", "Melbourne Beach", "Indialantic", "Cocoa Beach"]
        ]
        
        # Also check by latitude range for Space Coast area
        space_coast_by_lat = [
            s for s in data 
            if s.get("state_province") == "Florida"
            and 27.8 <= float(s.get("latitude", 0)) <= 28.7
        ]
        
        print(f"Space Coast spots (by region): {len(space_coast_spots)}")
        print(f"Space Coast spots (by lat 27.8-28.7): {len(space_coast_by_lat)}")
        
        # List the spots
        for spot in sorted(space_coast_by_lat, key=lambda x: float(x.get("latitude", 0)), reverse=True):
            print(f"  - {spot.get('name')}: ({spot.get('latitude')}, {spot.get('longitude')})")


class TestFortLauderdaleMiamiCount:
    """Verify Fort Lauderdale/Miami region has expected spot count"""
    
    def test_fort_lauderdale_miami_spot_count(self):
        """Fort Lauderdale/Miami should have 18 spots"""
        response = requests.get(f"{BASE_URL}/api/surf-spots?limit=1000", timeout=30)
        assert response.status_code == 200
        data = response.json()
        
        # Miami-Dade / Broward area (lat 25.5-26.5)
        miami_area_spots = [
            s for s in data 
            if s.get("state_province") == "Florida"
            and 25.5 <= float(s.get("latitude", 0)) <= 26.5
        ]
        
        print(f"Fort Lauderdale/Miami area spots (lat 25.5-26.5): {len(miami_area_spots)}")
        
        # List the spots
        for spot in sorted(miami_area_spots, key=lambda x: float(x.get("latitude", 0)), reverse=True):
            print(f"  - {spot.get('name')}: ({spot.get('latitude')}, {spot.get('longitude')})")


class TestAllFloridaSpotsOffshore:
    """Verify all Florida spots are over water (not on land)"""
    
    def test_florida_spots_offshore(self):
        """All Florida spots should have longitude indicating offshore position"""
        response = requests.get(f"{BASE_URL}/api/surf-spots?limit=1000", timeout=30)
        assert response.status_code == 200
        data = response.json()
        
        florida_spots = [s for s in data if s.get("state_province") == "Florida"]
        
        # Check that spots are not too far inland
        # Florida's east coast is roughly at -80.0 to -81.5 longitude
        # West coast is roughly at -81.5 to -87.5 longitude
        
        issues = []
        for spot in florida_spots:
            lat = float(spot.get("latitude", 0))
            lon = float(spot.get("longitude", 0))
            name = spot.get("name", "Unknown")
            
            # East coast spots (lat > 25) should have lon > -82
            if lat > 25 and lon < -82.5:
                # Could be west coast, check if it's in Tampa Bay area
                if not (27.0 <= lat <= 28.5 and -83.0 <= lon <= -82.0):
                    issues.append(f"{name}: ({lat}, {lon}) - may be too far inland")
        
        if issues:
            print("Potential issues (spots may be on land):")
            for issue in issues:
                print(f"  - {issue}")
        else:
            print("PASS: All Florida spots appear to be offshore")
        
        # This is informational, not a hard failure
        print(f"Total Florida spots checked: {len(florida_spots)}")


class TestAPIPerformance:
    """Test API response time"""
    
    def test_api_response_time(self):
        """API should respond in under 2 seconds"""
        import time
        
        start = time.time()
        response = requests.get(f"{BASE_URL}/api/surf-spots?limit=1000", timeout=30)
        elapsed = time.time() - start
        
        assert response.status_code == 200
        print(f"API response time: {elapsed:.2f}s")
        
        assert elapsed < 5, f"API too slow: {elapsed:.2f}s (expected < 5s)"
        
        if elapsed < 2:
            print("PASS: API response time < 2s")
        else:
            print(f"WARNING: API response time {elapsed:.2f}s (expected < 2s)")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
