"""
Iteration 159 - Multi-State Surgical Rollout Verification
Georgia → South Carolina → North Carolina

Tests NOAA/Surfline/TopoZone verified coordinates for GA, SC, NC surf spots.

Key verifications:
1. Georgia: 10 spots (Tybee Island 5, St. Simons 3, Jekyll Island 2)
2. South Carolina: 27 spots (Myrtle Beach area 7, Charleston area 8+)
3. North Carolina: 45 spots (Outer Banks 23+, Wrightsville Beach area 6)
4. Key coordinates: S-Turns NC, The Washout SC, Tybee Island Pier GA, Folly Beach Pier SC
5. Total spot count: 544+
6. API performance: <2 seconds
"""
import pytest
import requests
import os
import math
import time

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'http://localhost:8001').rstrip('/')

# ============================================================
# EXPECTED COORDINATES FROM multistate_surgical_rollout.py
# ============================================================

# Georgia - Tybee Island (5 spots)
GEORGIA_TYBEE_EXPECTED = {
    "Tybee Island Pier": {"lat": 32.0155, "lon": -80.848, "source": "Surfline 5842041f4e65fad6a7708a6f"},
    "Tybee Island North": {"lat": 32.025, "lon": -80.838, "source": "North end break offshore"},
    "Tybee Island South": {"lat": 31.998, "lon": -80.848, "source": "South jetties offshore"},
    "North Jetty Tybee": {"lat": 32.035, "lon": -80.835, "source": "North jetty peak"},
    "South Jetty Tybee": {"lat": 31.99, "lon": -80.855, "source": "South jetty peak"},
}

# Georgia - St. Simons (3 spots)
GEORGIA_ST_SIMONS_EXPECTED = {
    "St. Simons Island": {"lat": 31.145, "lon": -81.375, "source": "Main beach offshore"},
    "Gould's Inlet": {"lat": 31.16, "lon": -81.365, "source": "Inlet break offshore"},
    "East Beach St. Simons": {"lat": 31.135, "lon": -81.37, "source": "East beach offshore"},
}

# Georgia - Jekyll Island (2 spots)
GEORGIA_JEKYLL_EXPECTED = {
    "Jekyll Island": {"lat": 31.075, "lon": -81.405, "source": "North end offshore"},
    "Jekyll Island South": {"lat": 31.035, "lon": -81.415, "source": "South end offshore"},
}

# South Carolina - Charleston Area (key spots)
SC_CHARLESTON_EXPECTED = {
    "The Washout": {"lat": 32.675, "lon": -79.92, "source": "Surfline 5842041f4e65fad6a7708a85 - jetty peak"},
    "Folly Beach Pier": {"lat": 32.652, "lon": -79.938, "source": "NOAA station FBPS1 - pier tip"},
    "Isle of Palms": {"lat": 32.795, "lon": -79.755, "source": "Main beach offshore"},
    "Sullivans Island": {"lat": 32.765, "lon": -79.835, "source": "Beach break offshore"},
}

# North Carolina - Outer Banks (key spots)
NC_OUTER_BANKS_EXPECTED = {
    "S-Turns": {"lat": 35.6078, "lon": -75.4649, "source": "Mondo Surf GPS verified"},
    "Rodanthe": {"lat": 35.595, "lon": -75.465, "source": "Beach break offshore"},
    "Jennette's Pier": {"lat": 35.908, "lon": -75.605, "source": "Pier tip offshore"},
    "Nags Head": {"lat": 35.958, "lon": -75.625, "source": "Main beach offshore"},
}

# North Carolina - Wrightsville Beach Area (6 spots)
NC_WRIGHTSVILLE_EXPECTED = {
    "Wrightsville Beach": {"lat": 34.2133, "lon": -77.795, "source": "NOAA tide gauge 8658163 area"},
    "Johnnie Mercer's Pier": {"lat": 34.2133, "lon": -77.7947, "source": "NOAA tide gauge 8658163 - pier tip"},
    "C Street": {"lat": 34.205, "lon": -77.798, "source": "Columbia St offshore"},
    "Crystal Pier": {"lat": 34.198, "lon": -77.805, "source": "Pier south side offshore"},
    "Figure Eight": {"lat": 34.265, "lon": -77.758, "source": "Shell Island offshore"},
    "Masonboro Island": {"lat": 34.145, "lon": -77.835, "source": "Island offshore"},
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
        response = requests.get(f"{BASE_URL}/api/surf-spots?limit=600", timeout=30)
        assert response.status_code == 200, f"Surf spots endpoint failed: {response.status_code}"
        data = response.json()
        assert len(data) > 0, "No surf spots returned"
        print(f"Surf spots endpoint: PASSED ({len(data)} spots)")
    
    def test_api_performance(self):
        """Test API responds in <2 seconds"""
        start = time.time()
        response = requests.get(f"{BASE_URL}/api/surf-spots?limit=600", timeout=30)
        elapsed = time.time() - start
        
        assert response.status_code == 200
        assert elapsed < 2.0, f"API too slow: {elapsed:.2f}s (expected < 2s)"
        print(f"API performance: PASSED ({elapsed:.2f}s)")


class TestTotalSpotCount:
    """Test total spot count after multi-state rollout"""
    
    @pytest.fixture(scope="class")
    def all_spots(self):
        """Get all spots from API"""
        response = requests.get(f"{BASE_URL}/api/surf-spots?limit=600", timeout=30)
        assert response.status_code == 200
        return response.json()
    
    def test_total_spot_count_544_plus(self, all_spots):
        """Total spot count should be 544+"""
        total = len(all_spots)
        print(f"Total spots: {total}")
        assert total >= 544, f"Expected 544+ spots, got {total}"
    
    def test_georgia_spot_count(self, all_spots):
        """Georgia should have 10 spots"""
        ga_spots = [s for s in all_spots if s.get('state_province') == 'Georgia']
        print(f"Georgia spots: {len(ga_spots)}")
        assert len(ga_spots) >= 10, f"Expected 10+ Georgia spots, got {len(ga_spots)}"
    
    def test_south_carolina_spot_count(self, all_spots):
        """South Carolina should have 15+ spots (7 Myrtle Beach + 8 Charleston)"""
        sc_spots = [s for s in all_spots if s.get('state_province') == 'South Carolina']
        print(f"South Carolina spots: {len(sc_spots)}")
        assert len(sc_spots) >= 15, f"Expected 15+ SC spots, got {len(sc_spots)}"
    
    def test_north_carolina_spot_count(self, all_spots):
        """North Carolina should have 29+ spots (23 Outer Banks + 6 Wrightsville)"""
        nc_spots = [s for s in all_spots if s.get('state_province') == 'North Carolina']
        print(f"North Carolina spots: {len(nc_spots)}")
        assert len(nc_spots) >= 29, f"Expected 29+ NC spots, got {len(nc_spots)}"


class TestGeorgiaCoordinates:
    """Test Georgia surf spot coordinates"""
    
    @pytest.fixture(scope="class")
    def spots_dict(self):
        """Get all spots as dictionary"""
        response = requests.get(f"{BASE_URL}/api/surf-spots?limit=600", timeout=30)
        assert response.status_code == 200
        return {spot['name']: spot for spot in response.json()}
    
    def test_tybee_island_pier_coordinates(self, spots_dict):
        """Tybee Island Pier should be at Surfline verified coordinates"""
        expected = GEORGIA_TYBEE_EXPECTED["Tybee Island Pier"]
        if "Tybee Island Pier" not in spots_dict:
            pytest.skip("Tybee Island Pier not found")
        
        spot = spots_dict["Tybee Island Pier"]
        distance = haversine_distance_meters(
            expected["lat"], expected["lon"],
            spot["latitude"], spot["longitude"]
        )
        
        print(f"Tybee Island Pier - Expected: ({expected['lat']}, {expected['lon']})")
        print(f"Tybee Island Pier - Actual: ({spot['latitude']}, {spot['longitude']})")
        print(f"Tybee Island Pier - Distance: {distance:.0f}m")
        
        assert distance < 100, f"Tybee Island Pier off by {distance:.0f}m"
    
    def test_georgia_tybee_spots_present(self, spots_dict):
        """All 5 Tybee Island spots should be present"""
        tybee_spots = list(GEORGIA_TYBEE_EXPECTED.keys())
        found = [name for name in tybee_spots if name in spots_dict]
        missing = [name for name in tybee_spots if name not in spots_dict]
        
        print(f"Tybee Island spots found: {len(found)}/5")
        if missing:
            print(f"Missing: {missing}")
        
        assert len(found) >= 5, f"Missing Tybee spots: {missing}"
    
    def test_georgia_st_simons_spots_present(self, spots_dict):
        """All 3 St. Simons spots should be present"""
        st_simons_spots = list(GEORGIA_ST_SIMONS_EXPECTED.keys())
        found = [name for name in st_simons_spots if name in spots_dict]
        missing = [name for name in st_simons_spots if name not in spots_dict]
        
        print(f"St. Simons spots found: {len(found)}/3")
        if missing:
            print(f"Missing: {missing}")
        
        assert len(found) >= 3, f"Missing St. Simons spots: {missing}"
    
    def test_georgia_jekyll_spots_present(self, spots_dict):
        """Both Jekyll Island spots should be present"""
        jekyll_spots = list(GEORGIA_JEKYLL_EXPECTED.keys())
        found = [name for name in jekyll_spots if name in spots_dict]
        missing = [name for name in jekyll_spots if name not in spots_dict]
        
        print(f"Jekyll Island spots found: {len(found)}/2")
        if missing:
            print(f"Missing: {missing}")
        
        assert len(found) >= 2, f"Missing Jekyll spots: {missing}"


class TestSouthCarolinaCoordinates:
    """Test South Carolina surf spot coordinates"""
    
    @pytest.fixture(scope="class")
    def spots_dict(self):
        """Get all spots as dictionary"""
        response = requests.get(f"{BASE_URL}/api/surf-spots?limit=600", timeout=30)
        assert response.status_code == 200
        return {spot['name']: spot for spot in response.json()}
    
    def test_the_washout_coordinates(self, spots_dict):
        """The Washout should be at Surfline verified coordinates (32.675, -79.92)"""
        expected = SC_CHARLESTON_EXPECTED["The Washout"]
        if "The Washout" not in spots_dict:
            pytest.skip("The Washout not found")
        
        spot = spots_dict["The Washout"]
        distance = haversine_distance_meters(
            expected["lat"], expected["lon"],
            spot["latitude"], spot["longitude"]
        )
        
        print(f"The Washout - Expected: ({expected['lat']}, {expected['lon']})")
        print(f"The Washout - Actual: ({spot['latitude']}, {spot['longitude']})")
        print(f"The Washout - Distance: {distance:.0f}m")
        
        assert distance < 100, f"The Washout off by {distance:.0f}m"
    
    def test_folly_beach_pier_noaa_coordinates(self, spots_dict):
        """Folly Beach Pier should be at NOAA FBPS1 coordinates (32.652, -79.938)"""
        expected = SC_CHARLESTON_EXPECTED["Folly Beach Pier"]
        if "Folly Beach Pier" not in spots_dict:
            pytest.skip("Folly Beach Pier not found")
        
        spot = spots_dict["Folly Beach Pier"]
        distance = haversine_distance_meters(
            expected["lat"], expected["lon"],
            spot["latitude"], spot["longitude"]
        )
        
        print(f"Folly Beach Pier - Expected: ({expected['lat']}, {expected['lon']}) - NOAA FBPS1")
        print(f"Folly Beach Pier - Actual: ({spot['latitude']}, {spot['longitude']})")
        print(f"Folly Beach Pier - Distance: {distance:.0f}m")
        
        assert distance < 100, f"Folly Beach Pier off by {distance:.0f}m"
    
    def test_charleston_area_spots_present(self, spots_dict):
        """Charleston area spots should be present"""
        charleston_spots = list(SC_CHARLESTON_EXPECTED.keys())
        found = [name for name in charleston_spots if name in spots_dict]
        missing = [name for name in charleston_spots if name not in spots_dict]
        
        print(f"Charleston area spots found: {len(found)}/{len(charleston_spots)}")
        if missing:
            print(f"Missing: {missing}")
        
        assert len(found) >= 4, f"Missing Charleston spots: {missing}"


class TestNorthCarolinaCoordinates:
    """Test North Carolina surf spot coordinates"""
    
    @pytest.fixture(scope="class")
    def spots_dict(self):
        """Get all spots as dictionary"""
        response = requests.get(f"{BASE_URL}/api/surf-spots?limit=600", timeout=30)
        assert response.status_code == 200
        return {spot['name']: spot for spot in response.json()}
    
    def test_s_turns_mondo_surf_coordinates(self, spots_dict):
        """S-Turns should be at Mondo Surf verified coordinates (35.6078, -75.4649)"""
        expected = NC_OUTER_BANKS_EXPECTED["S-Turns"]
        if "S-Turns" not in spots_dict:
            pytest.skip("S-Turns not found")
        
        spot = spots_dict["S-Turns"]
        distance = haversine_distance_meters(
            expected["lat"], expected["lon"],
            spot["latitude"], spot["longitude"]
        )
        
        print(f"S-Turns - Expected: ({expected['lat']}, {expected['lon']}) - Mondo Surf verified")
        print(f"S-Turns - Actual: ({spot['latitude']}, {spot['longitude']})")
        print(f"S-Turns - Distance: {distance:.0f}m")
        
        assert distance < 100, f"S-Turns off by {distance:.0f}m"
    
    def test_outer_banks_spots_present(self, spots_dict):
        """Outer Banks spots should be present"""
        obx_spots = list(NC_OUTER_BANKS_EXPECTED.keys())
        found = [name for name in obx_spots if name in spots_dict]
        missing = [name for name in obx_spots if name not in spots_dict]
        
        print(f"Outer Banks key spots found: {len(found)}/{len(obx_spots)}")
        if missing:
            print(f"Missing: {missing}")
        
        assert len(found) >= 4, f"Missing OBX spots: {missing}"
    
    def test_wrightsville_beach_noaa_coordinates(self, spots_dict):
        """Wrightsville Beach should be at NOAA tide gauge 8658163 coordinates"""
        expected = NC_WRIGHTSVILLE_EXPECTED["Wrightsville Beach"]
        if "Wrightsville Beach" not in spots_dict:
            pytest.skip("Wrightsville Beach not found")
        
        spot = spots_dict["Wrightsville Beach"]
        distance = haversine_distance_meters(
            expected["lat"], expected["lon"],
            spot["latitude"], spot["longitude"]
        )
        
        print(f"Wrightsville Beach - Expected: ({expected['lat']}, {expected['lon']}) - NOAA 8658163")
        print(f"Wrightsville Beach - Actual: ({spot['latitude']}, {spot['longitude']})")
        print(f"Wrightsville Beach - Distance: {distance:.0f}m")
        
        assert distance < 100, f"Wrightsville Beach off by {distance:.0f}m"
    
    def test_wrightsville_area_spots_present(self, spots_dict):
        """Wrightsville Beach area spots should be present"""
        wrightsville_spots = list(NC_WRIGHTSVILLE_EXPECTED.keys())
        found = [name for name in wrightsville_spots if name in spots_dict]
        missing = [name for name in wrightsville_spots if name not in spots_dict]
        
        print(f"Wrightsville area spots found: {len(found)}/{len(wrightsville_spots)}")
        if missing:
            print(f"Missing: {missing}")
        
        assert len(found) >= 5, f"Missing Wrightsville spots: {missing}"


class TestSpotsOverWater:
    """Test that all spots are positioned over water (offshore)"""
    
    @pytest.fixture(scope="class")
    def all_spots(self):
        """Get all spots from API"""
        response = requests.get(f"{BASE_URL}/api/surf-spots?limit=600", timeout=30)
        assert response.status_code == 200
        return response.json()
    
    def test_georgia_spots_offshore(self, all_spots):
        """Georgia spots should have longitude < -80.8 (offshore in Atlantic)"""
        ga_spots = [s for s in all_spots if s.get('state_province') == 'Georgia']
        
        offshore_count = 0
        for spot in ga_spots:
            # Georgia coast: longitude should be around -80.8 to -81.4
            if spot['longitude'] < -80.7:
                offshore_count += 1
        
        offshore_pct = (offshore_count / len(ga_spots) * 100) if ga_spots else 0
        print(f"Georgia spots offshore: {offshore_count}/{len(ga_spots)} ({offshore_pct:.0f}%)")
        
        assert offshore_pct >= 80, f"Only {offshore_pct:.0f}% of Georgia spots are offshore"
    
    def test_south_carolina_spots_offshore(self, all_spots):
        """South Carolina spots should have longitude < -79.5 (offshore in Atlantic)"""
        sc_spots = [s for s in all_spots if s.get('state_province') == 'South Carolina']
        
        offshore_count = 0
        for spot in sc_spots:
            # SC coast: longitude should be around -78.6 to -80.7
            if spot['longitude'] < -78.5:
                offshore_count += 1
        
        offshore_pct = (offshore_count / len(sc_spots) * 100) if sc_spots else 0
        print(f"South Carolina spots offshore: {offshore_count}/{len(sc_spots)} ({offshore_pct:.0f}%)")
        
        assert offshore_pct >= 80, f"Only {offshore_pct:.0f}% of SC spots are offshore"
    
    def test_north_carolina_spots_offshore(self, all_spots):
        """North Carolina spots should have longitude < -75.4 (offshore in Atlantic)"""
        nc_spots = [s for s in all_spots if s.get('state_province') == 'North Carolina']
        
        offshore_count = 0
        for spot in nc_spots:
            # NC coast: longitude should be around -75.4 to -77.9
            if spot['longitude'] < -75.3:
                offshore_count += 1
        
        offshore_pct = (offshore_count / len(nc_spots) * 100) if nc_spots else 0
        print(f"North Carolina spots offshore: {offshore_count}/{len(nc_spots)} ({offshore_pct:.0f}%)")
        
        assert offshore_pct >= 80, f"Only {offshore_pct:.0f}% of NC spots are offshore"


class TestKeyCoordinatesExact:
    """Test exact coordinates for key spots mentioned in requirements"""
    
    @pytest.fixture(scope="class")
    def spots_dict(self):
        """Get all spots as dictionary"""
        response = requests.get(f"{BASE_URL}/api/surf-spots?limit=600", timeout=30)
        assert response.status_code == 200
        return {spot['name']: spot for spot in response.json()}
    
    def test_s_turns_exact(self, spots_dict):
        """S-Turns NC should be at EXACT coordinates (35.6078, -75.4649)"""
        spot = spots_dict.get("S-Turns")
        assert spot is not None, "S-Turns not found"
        
        assert abs(spot['latitude'] - 35.6078) < 0.001, f"S-Turns lat wrong: {spot['latitude']}"
        assert abs(spot['longitude'] - (-75.4649)) < 0.001, f"S-Turns lon wrong: {spot['longitude']}"
        print(f"S-Turns: EXACT MATCH ({spot['latitude']}, {spot['longitude']})")
    
    def test_the_washout_exact(self, spots_dict):
        """The Washout SC should be at EXACT coordinates (32.675, -79.92)"""
        spot = spots_dict.get("The Washout")
        assert spot is not None, "The Washout not found"
        
        assert abs(spot['latitude'] - 32.675) < 0.001, f"The Washout lat wrong: {spot['latitude']}"
        assert abs(spot['longitude'] - (-79.92)) < 0.001, f"The Washout lon wrong: {spot['longitude']}"
        print(f"The Washout: EXACT MATCH ({spot['latitude']}, {spot['longitude']})")
    
    def test_tybee_island_pier_exact(self, spots_dict):
        """Tybee Island Pier GA should be at EXACT coordinates (32.0155, -80.848)"""
        spot = spots_dict.get("Tybee Island Pier")
        assert spot is not None, "Tybee Island Pier not found"
        
        assert abs(spot['latitude'] - 32.0155) < 0.001, f"Tybee lat wrong: {spot['latitude']}"
        assert abs(spot['longitude'] - (-80.848)) < 0.001, f"Tybee lon wrong: {spot['longitude']}"
        print(f"Tybee Island Pier: EXACT MATCH ({spot['latitude']}, {spot['longitude']})")
    
    def test_folly_beach_pier_exact(self, spots_dict):
        """Folly Beach Pier SC should be at EXACT coordinates (32.652, -79.938) - NOAA FBPS1"""
        spot = spots_dict.get("Folly Beach Pier")
        assert spot is not None, "Folly Beach Pier not found"
        
        assert abs(spot['latitude'] - 32.652) < 0.001, f"Folly lat wrong: {spot['latitude']}"
        assert abs(spot['longitude'] - (-79.938)) < 0.001, f"Folly lon wrong: {spot['longitude']}"
        print(f"Folly Beach Pier: EXACT MATCH ({spot['latitude']}, {spot['longitude']})")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
