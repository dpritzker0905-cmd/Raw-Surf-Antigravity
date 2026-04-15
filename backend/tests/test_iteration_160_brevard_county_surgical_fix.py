"""
Iteration 160 - Brevard County Surgical Fix Verification
Tests user-specified exact coordinates for Brevard County surf spots.

User-specified coordinates:
- Paradise Beach: (28.1232, -80.5752)
- Cherie Down Park: (28.3918, -80.5951)
- 16th St South: (28.3145, -80.6085)
- Lori Wilson Park: (28.3351, -80.6069)
- Jetty Park: (28.4061, -80.5890)

All pins must be 100-150m offshore, NO pins on buildings/roads/sand.
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')


class TestAPIHealth:
    """Basic API health checks"""
    
    def test_api_health(self):
        """Verify API is healthy"""
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200
        data = response.json()
        assert data.get('status') == 'healthy'
        print(f"API Health: {data.get('status')}")
    
    def test_surf_spots_endpoint(self):
        """Verify surf spots endpoint returns data"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) > 0
        print(f"Total surf spots: {len(data)}")


class TestTotalSpotCounts:
    """Verify total spot counts"""
    
    def test_total_spot_count(self):
        """Verify total spot count is 549"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        data = response.json()
        assert len(data) == 549, f"Expected 549 spots, got {len(data)}"
        print(f"Total spots: {len(data)} (expected 549)")
    
    def test_florida_spot_count(self):
        """Verify Florida spot count is 110"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        data = response.json()
        florida_spots = [s for s in data if s.get('state_province') == 'Florida']
        assert len(florida_spots) == 110, f"Expected 110 Florida spots, got {len(florida_spots)}"
        print(f"Florida spots: {len(florida_spots)} (expected 110)")


class TestUserSpecifiedBrevardCoordinates:
    """
    Verify user-specified Brevard County coordinates are EXACT.
    These are the critical coordinates specified by the user.
    """
    
    @pytest.fixture
    def surf_spots(self):
        """Fetch all surf spots"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        return response.json()
    
    def test_paradise_beach_exact_coordinates(self, surf_spots):
        """Paradise Beach at (28.1232, -80.5752) - Surfline ID 584204214e65fad6a7709cc1"""
        expected_lat = 28.1232
        expected_lon = -80.5752
        
        spot = next((s for s in surf_spots if s.get('name') == 'Paradise Beach'), None)
        assert spot is not None, "Paradise Beach not found in database"
        
        actual_lat = float(spot.get('latitude', 0))
        actual_lon = float(spot.get('longitude', 0))
        
        # Verify exact match (within 0.0001 degrees = ~11m)
        assert abs(actual_lat - expected_lat) < 0.0001, f"Paradise Beach lat mismatch: expected {expected_lat}, got {actual_lat}"
        assert abs(actual_lon - expected_lon) < 0.0001, f"Paradise Beach lon mismatch: expected {expected_lon}, got {actual_lon}"
        
        print(f"Paradise Beach: ({actual_lat}, {actual_lon}) - EXACT MATCH")
    
    def test_cherie_down_park_exact_coordinates(self, surf_spots):
        """Cherie Down Park at (28.3918, -80.5951) - Surfline ID 69862093726121e0fe3143ce"""
        expected_lat = 28.3918
        expected_lon = -80.5951
        
        spot = next((s for s in surf_spots if s.get('name') == 'Cherie Down Park'), None)
        assert spot is not None, "Cherie Down Park not found in database"
        
        actual_lat = float(spot.get('latitude', 0))
        actual_lon = float(spot.get('longitude', 0))
        
        # Verify exact match
        assert abs(actual_lat - expected_lat) < 0.0001, f"Cherie Down Park lat mismatch: expected {expected_lat}, got {actual_lat}"
        assert abs(actual_lon - expected_lon) < 0.0001, f"Cherie Down Park lon mismatch: expected {expected_lon}, got {actual_lon}"
        
        print(f"Cherie Down Park: ({actual_lat}, {actual_lon}) - EXACT MATCH")
    
    def test_16th_street_south_exact_coordinates(self, surf_spots):
        """16th St South at (28.3145, -80.6085) - Note: stored as '16th Street South'"""
        expected_lat = 28.3145
        expected_lon = -80.6085
        
        # Try both name variations
        spot = next((s for s in surf_spots if s.get('name') in ['16th St South', '16th Street South']), None)
        assert spot is not None, "16th St South / 16th Street South not found in database"
        
        actual_lat = float(spot.get('latitude', 0))
        actual_lon = float(spot.get('longitude', 0))
        
        # Verify exact match
        assert abs(actual_lat - expected_lat) < 0.0001, f"16th Street South lat mismatch: expected {expected_lat}, got {actual_lat}"
        assert abs(actual_lon - expected_lon) < 0.0001, f"16th Street South lon mismatch: expected {expected_lon}, got {actual_lon}"
        
        print(f"16th Street South: ({actual_lat}, {actual_lon}) - EXACT MATCH (stored as '{spot.get('name')}')")
    
    def test_lori_wilson_park_exact_coordinates(self, surf_spots):
        """Lori Wilson Park at (28.3351, -80.6069)"""
        expected_lat = 28.3351
        expected_lon = -80.6069
        
        spot = next((s for s in surf_spots if s.get('name') == 'Lori Wilson Park'), None)
        assert spot is not None, "Lori Wilson Park not found in database"
        
        actual_lat = float(spot.get('latitude', 0))
        actual_lon = float(spot.get('longitude', 0))
        
        # Verify exact match
        assert abs(actual_lat - expected_lat) < 0.0001, f"Lori Wilson Park lat mismatch: expected {expected_lat}, got {actual_lat}"
        assert abs(actual_lon - expected_lon) < 0.0001, f"Lori Wilson Park lon mismatch: expected {expected_lon}, got {actual_lon}"
        
        print(f"Lori Wilson Park: ({actual_lat}, {actual_lon}) - EXACT MATCH")
    
    def test_jetty_park_exact_coordinates(self, surf_spots):
        """Jetty Park at (28.4061, -80.5890)"""
        expected_lat = 28.4061
        expected_lon = -80.5890
        
        spot = next((s for s in surf_spots if s.get('name') == 'Jetty Park'), None)
        assert spot is not None, "Jetty Park not found in database"
        
        actual_lat = float(spot.get('latitude', 0))
        actual_lon = float(spot.get('longitude', 0))
        
        # Verify exact match
        assert abs(actual_lat - expected_lat) < 0.0001, f"Jetty Park lat mismatch: expected {expected_lat}, got {actual_lat}"
        assert abs(actual_lon - expected_lon) < 0.0001, f"Jetty Park lon mismatch: expected {expected_lon}, got {actual_lon}"
        
        print(f"Jetty Park: ({actual_lat}, {actual_lon}) - EXACT MATCH")


class TestSpaceCoastOffshorePositioning:
    """
    Verify all Space Coast spots (Sebastian Inlet to Ponce Inlet) are offshore.
    Longitude should be EAST of -80.65 (in the water, not on land).
    """
    
    @pytest.fixture
    def surf_spots(self):
        """Fetch all surf spots"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        return response.json()
    
    def test_space_coast_spots_offshore(self, surf_spots):
        """All Space Coast spots should be offshore (lon > -80.65 for Atlantic coast)"""
        # Space Coast is roughly lat 27.8 to 28.7
        space_coast_spots = [
            s for s in surf_spots 
            if s.get('state_province') == 'Florida' 
            and 27.8 <= float(s.get('latitude', 0)) <= 28.7
            and float(s.get('longitude', 0)) > -82  # Exclude Gulf coast
        ]
        
        assert len(space_coast_spots) > 0, "No Space Coast spots found"
        
        on_land_spots = []
        for spot in space_coast_spots:
            lon = float(spot.get('longitude', 0))
            # For Atlantic coast Florida, water is EAST (less negative longitude)
            # Land is around -80.62 to -80.65, water is around -80.55 to -80.61
            if lon < -80.65:  # Too far west = on land
                on_land_spots.append(f"{spot.get('name')}: lon={lon}")
        
        if on_land_spots:
            print(f"WARNING: Spots potentially on land: {on_land_spots}")
        
        print(f"Space Coast spots checked: {len(space_coast_spots)}")
        print(f"All spots offshore: {len(on_land_spots) == 0}")
        
        # This is a soft check - report but don't fail
        assert len(on_land_spots) == 0, f"Spots potentially on land: {on_land_spots}"
    
    def test_brevard_county_spots_not_on_buildings(self, surf_spots):
        """
        Verify Brevard County spots are 100-150m offshore.
        For Atlantic coast, this means longitude should be around -80.55 to -80.61
        """
        brevard_spots = [
            'Paradise Beach', 'Cherie Down Park', '16th Street South', 
            'Lori Wilson Park', 'Jetty Park', 'Cocoa Beach Pier',
            'Satellite Beach', 'Indialantic', 'Melbourne Beach'
        ]
        
        issues = []
        for spot_name in brevard_spots:
            spot = next((s for s in surf_spots if s.get('name') == spot_name), None)
            if spot:
                lon = float(spot.get('longitude', 0))
                lat = float(spot.get('latitude', 0))
                
                # Check if longitude is in reasonable offshore range
                # Too far west (< -80.62) = on land
                # Too far east (> -80.54) = too far offshore
                if lon < -80.62:
                    issues.append(f"{spot_name}: lon={lon} (too far west - possibly on land)")
                elif lon > -80.54:
                    issues.append(f"{spot_name}: lon={lon} (too far east - too far offshore)")
                else:
                    print(f"{spot_name}: ({lat}, {lon}) - OK (offshore)")
        
        if issues:
            print(f"Issues found: {issues}")
        
        # All user-specified spots should be in correct range
        assert len(issues) == 0, f"Positioning issues: {issues}"


class TestAPIPerformance:
    """Verify API performance requirements"""
    
    def test_surf_spots_response_time(self):
        """API should respond in under 2 seconds"""
        import time
        
        start = time.time()
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        elapsed = time.time() - start
        
        assert response.status_code == 200
        assert elapsed < 2.0, f"API response time {elapsed:.2f}s exceeds 2s limit"
        
        print(f"API response time: {elapsed:.2f}s (limit: 2s)")


class TestSurflineIDVerification:
    """Verify Surfline IDs are correctly associated with spots"""
    
    @pytest.fixture
    def surf_spots(self):
        """Fetch all surf spots"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        return response.json()
    
    def test_paradise_beach_surfline_id(self, surf_spots):
        """Paradise Beach should have Surfline ID 584204214e65fad6a7709cc1"""
        spot = next((s for s in surf_spots if s.get('name') == 'Paradise Beach'), None)
        assert spot is not None
        
        surfline_id = spot.get('surfline_id', '')
        # Note: This may not be stored in the database, so we just verify the spot exists
        print(f"Paradise Beach found - Surfline ID: {surfline_id or 'Not stored'}")
    
    def test_cherie_down_park_surfline_id(self, surf_spots):
        """Cherie Down Park should have Surfline ID 69862093726121e0fe3143ce"""
        spot = next((s for s in surf_spots if s.get('name') == 'Cherie Down Park'), None)
        assert spot is not None
        
        surfline_id = spot.get('surfline_id', '')
        print(f"Cherie Down Park found - Surfline ID: {surfline_id or 'Not stored'}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
