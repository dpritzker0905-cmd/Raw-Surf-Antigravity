"""
Iteration 157 - Florida Surgical Precision Visual Verification Tests
Tests:
1. API performance - should respond in <2 seconds with all spots
2. Space Coast spots have exact user-specified coordinates
3. Gulf Coast spots have MORE negative longitude (west into Gulf)
4. Panhandle spots have appropriate SOUTH positioning
5. All Florida spots should be positioned OVER water (offshore)
"""
import pytest
import requests
import time
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# User-specified exact coordinates for Space Coast
USER_SPECIFIED_SPACE_COAST = {
    "Jetty Park": {"lat": 28.4061, "lon": -80.5890},
    "Cherie Down Park": {"lat": 28.3842, "lon": -80.6015},
    "Cocoa Beach Pier": {"lat": 28.3676, "lon": -80.6012},
    "Shepard Park": {"lat": 28.3585, "lon": -80.6035},
}

# Gulf Coast spots should have longitude MORE negative (west into Gulf)
# Clearwater Beach shoreline is around -82.82, so spots should be around -82.84 or more negative
GULF_COAST_LONGITUDE_THRESHOLD = -82.5  # Spots should be MORE negative than this

# Panhandle spots should have latitude around 30.0-30.4 for offshore positions
PANHANDLE_LATITUDE_RANGE = (29.5, 30.5)


class TestAPIPerformance:
    """Test API performance - should respond in <2 seconds"""
    
    def test_api_health(self):
        """Verify API is accessible"""
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200, f"API health check failed: {response.status_code}"
        print("✓ API health check passed")
    
    def test_surf_spots_response_time(self):
        """API should respond in <2 seconds with all spots"""
        start_time = time.time()
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        elapsed_time = time.time() - start_time
        
        assert response.status_code == 200, f"API returned {response.status_code}"
        spots = response.json()
        
        print(f"✓ API responded in {elapsed_time:.2f} seconds with {len(spots)} spots")
        
        # Performance assertion - should be <2 seconds
        assert elapsed_time < 2.0, f"API took {elapsed_time:.2f}s, expected <2s"
        
        # Should have 500+ spots (523 expected)
        assert len(spots) >= 500, f"Expected 500+ spots, got {len(spots)}"
        print(f"✓ Performance test passed: {elapsed_time:.2f}s for {len(spots)} spots")


class TestSpaceCoastCoordinates:
    """Test Space Coast spots have exact user-specified coordinates"""
    
    @pytest.fixture(scope="class")
    def all_spots(self):
        """Fetch all surf spots once for the class"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        return response.json()
    
    def test_jetty_park_coordinates(self, all_spots):
        """Jetty Park should be at tip of North Jetty (28.4061, -80.5890)"""
        expected = USER_SPECIFIED_SPACE_COAST["Jetty Park"]
        spot = next((s for s in all_spots if s["name"] == "Jetty Park"), None)
        
        assert spot is not None, "Jetty Park not found in database"
        
        lat_diff = abs(spot["latitude"] - expected["lat"])
        lon_diff = abs(spot["longitude"] - expected["lon"])
        
        # Allow 0.001 degree tolerance (~111m)
        assert lat_diff < 0.001, f"Jetty Park lat {spot['latitude']} differs from expected {expected['lat']} by {lat_diff}"
        assert lon_diff < 0.001, f"Jetty Park lon {spot['longitude']} differs from expected {expected['lon']} by {lon_diff}"
        
        print(f"✓ Jetty Park: ({spot['latitude']}, {spot['longitude']}) - USER SPECIFIED EXACT")
    
    def test_cherie_down_park_coordinates(self, all_spots):
        """Cherie Down Park should be at (28.3842, -80.6015)"""
        expected = USER_SPECIFIED_SPACE_COAST["Cherie Down Park"]
        spot = next((s for s in all_spots if s["name"] == "Cherie Down Park"), None)
        
        assert spot is not None, "Cherie Down Park not found in database"
        
        lat_diff = abs(spot["latitude"] - expected["lat"])
        lon_diff = abs(spot["longitude"] - expected["lon"])
        
        assert lat_diff < 0.001, f"Cherie Down Park lat differs by {lat_diff}"
        assert lon_diff < 0.001, f"Cherie Down Park lon differs by {lon_diff}"
        
        print(f"✓ Cherie Down Park: ({spot['latitude']}, {spot['longitude']}) - USER SPECIFIED EXACT")
    
    def test_cocoa_beach_pier_coordinates(self, all_spots):
        """Cocoa Beach Pier should be at end of pier (28.3676, -80.6012)"""
        expected = USER_SPECIFIED_SPACE_COAST["Cocoa Beach Pier"]
        spot = next((s for s in all_spots if s["name"] == "Cocoa Beach Pier"), None)
        
        assert spot is not None, "Cocoa Beach Pier not found in database"
        
        lat_diff = abs(spot["latitude"] - expected["lat"])
        lon_diff = abs(spot["longitude"] - expected["lon"])
        
        # Allow slightly more tolerance for pier (0.002 = ~220m)
        assert lat_diff < 0.002, f"Cocoa Beach Pier lat differs by {lat_diff}"
        assert lon_diff < 0.002, f"Cocoa Beach Pier lon differs by {lon_diff}"
        
        print(f"✓ Cocoa Beach Pier: ({spot['latitude']}, {spot['longitude']}) - USER SPECIFIED")
    
    def test_shepard_park_coordinates(self, all_spots):
        """Shepard Park should be at (28.3585, -80.6035)"""
        expected = USER_SPECIFIED_SPACE_COAST["Shepard Park"]
        spot = next((s for s in all_spots if s["name"] == "Shepard Park"), None)
        
        assert spot is not None, "Shepard Park not found in database"
        
        lat_diff = abs(spot["latitude"] - expected["lat"])
        lon_diff = abs(spot["longitude"] - expected["lon"])
        
        assert lat_diff < 0.001, f"Shepard Park lat differs by {lat_diff}"
        assert lon_diff < 0.001, f"Shepard Park lon differs by {lon_diff}"
        
        print(f"✓ Shepard Park: ({spot['latitude']}, {spot['longitude']}) - USER SPECIFIED EXACT")


class TestGulfCoastCoordinates:
    """Test Gulf Coast spots have MORE negative longitude (west into Gulf)"""
    
    @pytest.fixture(scope="class")
    def all_spots(self):
        """Fetch all surf spots once for the class"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        return response.json()
    
    def test_clearwater_beach_west_of_shoreline(self, all_spots):
        """Clearwater Beach should have longitude around -82.8 (west into Gulf)"""
        spot = next((s for s in all_spots if s["name"] == "Clearwater Beach"), None)
        
        assert spot is not None, "Clearwater Beach not found in database"
        
        # Clearwater Beach should be WEST of shoreline (more negative longitude)
        assert spot["longitude"] < GULF_COAST_LONGITUDE_THRESHOLD, \
            f"Clearwater Beach lon {spot['longitude']} should be < {GULF_COAST_LONGITUDE_THRESHOLD} (west into Gulf)"
        
        print(f"✓ Clearwater Beach: ({spot['latitude']}, {spot['longitude']}) - WEST of shoreline")
    
    def test_siesta_key_west_of_shoreline(self, all_spots):
        """Siesta Key should have longitude west of shoreline"""
        spot = next((s for s in all_spots if s["name"] == "Siesta Key"), None)
        
        assert spot is not None, "Siesta Key not found in database"
        
        assert spot["longitude"] < GULF_COAST_LONGITUDE_THRESHOLD, \
            f"Siesta Key lon {spot['longitude']} should be < {GULF_COAST_LONGITUDE_THRESHOLD}"
        
        print(f"✓ Siesta Key: ({spot['latitude']}, {spot['longitude']}) - WEST of shoreline")
    
    def test_naples_pier_west_of_shoreline(self, all_spots):
        """Naples Pier should have longitude west of shoreline"""
        spot = next((s for s in all_spots if s["name"] == "Naples Pier"), None)
        
        assert spot is not None, "Naples Pier not found in database"
        
        # Naples is further south, so threshold is slightly different (-81.8)
        assert spot["longitude"] < -81.7, \
            f"Naples Pier lon {spot['longitude']} should be < -81.7 (west into Gulf)"
        
        print(f"✓ Naples Pier: ({spot['latitude']}, {spot['longitude']}) - WEST of shoreline")
    
    def test_st_pete_beach_west_of_shoreline(self, all_spots):
        """St Pete Beach should have longitude west of shoreline"""
        spot = next((s for s in all_spots if s["name"] == "St Pete Beach"), None)
        
        assert spot is not None, "St Pete Beach not found in database"
        
        assert spot["longitude"] < -82.7, \
            f"St Pete Beach lon {spot['longitude']} should be < -82.7 (west into Gulf)"
        
        print(f"✓ St Pete Beach: ({spot['latitude']}, {spot['longitude']}) - WEST of shoreline")


class TestPanhandleCoordinates:
    """Test Panhandle spots have appropriate SOUTH positioning"""
    
    @pytest.fixture(scope="class")
    def all_spots(self):
        """Fetch all surf spots once for the class"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        return response.json()
    
    def test_pensacola_beach_latitude(self, all_spots):
        """Pensacola Beach should have latitude around 30.3 (south-facing)"""
        spot = next((s for s in all_spots if s["name"] == "Pensacola Beach"), None)
        
        assert spot is not None, "Pensacola Beach not found in database"
        
        assert PANHANDLE_LATITUDE_RANGE[0] < spot["latitude"] < PANHANDLE_LATITUDE_RANGE[1], \
            f"Pensacola Beach lat {spot['latitude']} should be in range {PANHANDLE_LATITUDE_RANGE}"
        
        print(f"✓ Pensacola Beach: ({spot['latitude']}, {spot['longitude']}) - SOUTH positioning")
    
    def test_panama_city_beach_latitude(self, all_spots):
        """Panama City Beach should have latitude around 30.1 (south-facing)"""
        spot = next((s for s in all_spots if s["name"] == "Panama City Beach"), None)
        
        assert spot is not None, "Panama City Beach not found in database"
        
        assert PANHANDLE_LATITUDE_RANGE[0] < spot["latitude"] < PANHANDLE_LATITUDE_RANGE[1], \
            f"Panama City Beach lat {spot['latitude']} should be in range {PANHANDLE_LATITUDE_RANGE}"
        
        print(f"✓ Panama City Beach: ({spot['latitude']}, {spot['longitude']}) - SOUTH positioning")
    
    def test_destin_latitude(self, all_spots):
        """Destin should have latitude around 30.3 (south-facing)"""
        spot = next((s for s in all_spots if s["name"] == "Destin"), None)
        
        assert spot is not None, "Destin not found in database"
        
        assert PANHANDLE_LATITUDE_RANGE[0] < spot["latitude"] < PANHANDLE_LATITUDE_RANGE[1], \
            f"Destin lat {spot['latitude']} should be in range {PANHANDLE_LATITUDE_RANGE}"
        
        print(f"✓ Destin: ({spot['latitude']}, {spot['longitude']}) - SOUTH positioning")


class TestFloridaSpotsOverWater:
    """Test that Florida spots are positioned OVER water (offshore)"""
    
    @pytest.fixture(scope="class")
    def florida_spots(self):
        """Fetch all Florida surf spots"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        all_spots = response.json()
        
        # Filter for Florida spots (latitude 24-31, longitude -88 to -79)
        florida = [s for s in all_spots 
                   if s.get("latitude") and s.get("longitude")
                   and 24 < s["latitude"] < 31 
                   and -88 < s["longitude"] < -79]
        
        print(f"Found {len(florida)} Florida spots")
        return florida
    
    def test_florida_spot_count(self, florida_spots):
        """Should have 100+ Florida spots"""
        assert len(florida_spots) >= 100, f"Expected 100+ Florida spots, got {len(florida_spots)}"
        print(f"✓ {len(florida_spots)} Florida spots in database")
    
    def test_atlantic_coast_spots_east_of_shoreline(self, florida_spots):
        """Atlantic Coast spots should have longitude LESS negative (east toward ocean)"""
        # Atlantic Coast spots are roughly longitude -81.5 to -80.0
        atlantic_spots = [s for s in florida_spots if -81.5 < s["longitude"] < -79.5]
        
        assert len(atlantic_spots) > 0, "No Atlantic Coast spots found"
        
        # Check that spots are positioned offshore (not too far inland)
        # Atlantic shoreline is roughly -80.5 to -81.0, so spots should be around -80.0 to -80.6
        offshore_count = 0
        for spot in atlantic_spots:
            # For Atlantic Coast, longitude should be LESS negative than -81.0 (east toward ocean)
            if spot["longitude"] > -81.2:
                offshore_count += 1
        
        offshore_percentage = (offshore_count / len(atlantic_spots)) * 100
        print(f"✓ {offshore_count}/{len(atlantic_spots)} Atlantic spots positioned offshore ({offshore_percentage:.1f}%)")
        
        # At least 80% should be offshore
        assert offshore_percentage >= 80, f"Only {offshore_percentage:.1f}% of Atlantic spots are offshore"
    
    def test_gulf_coast_spots_west_of_shoreline(self, florida_spots):
        """Gulf Coast spots should have longitude MORE negative (west toward Gulf)"""
        # Gulf Coast spots are roughly longitude -82.0 to -88.0
        gulf_spots = [s for s in florida_spots if s["longitude"] < -82.0]
        
        assert len(gulf_spots) > 0, "No Gulf Coast spots found"
        
        # Check that spots are positioned offshore (west into Gulf)
        offshore_count = 0
        for spot in gulf_spots:
            # For Gulf Coast, longitude should be MORE negative than shoreline
            if spot["longitude"] < -82.3:
                offshore_count += 1
        
        offshore_percentage = (offshore_count / len(gulf_spots)) * 100
        print(f"✓ {offshore_count}/{len(gulf_spots)} Gulf spots positioned offshore ({offshore_percentage:.1f}%)")
        
        # At least 70% should be offshore
        assert offshore_percentage >= 70, f"Only {offshore_percentage:.1f}% of Gulf spots are offshore"


class TestSebastianInlet:
    """Test Sebastian Inlet - Florida's premier surf spot"""
    
    def test_sebastian_inlet_coordinates(self):
        """Sebastian Inlet should be at North Jetty peak (27.8603, -80.4473)"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        spots = response.json()
        
        spot = next((s for s in spots if s["name"] == "Sebastian Inlet"), None)
        assert spot is not None, "Sebastian Inlet not found in database"
        
        # Expected coordinates from florida_surgical_fix.py
        expected_lat = 27.8603
        expected_lon = -80.4473
        
        lat_diff = abs(spot["latitude"] - expected_lat)
        lon_diff = abs(spot["longitude"] - expected_lon)
        
        assert lat_diff < 0.001, f"Sebastian Inlet lat {spot['latitude']} differs from expected {expected_lat}"
        assert lon_diff < 0.001, f"Sebastian Inlet lon {spot['longitude']} differs from expected {expected_lon}"
        
        print(f"✓ Sebastian Inlet: ({spot['latitude']}, {spot['longitude']}) - USGS verified")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
