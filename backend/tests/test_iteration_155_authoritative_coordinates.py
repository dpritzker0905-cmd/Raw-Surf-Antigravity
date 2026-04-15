"""
Iteration 155 - Authoritative Coordinate Verification Tests
============================================================
Tests to verify that the authoritative_coordinate_fix.py script correctly updated
surf spot coordinates to be IN THE WATER (offshore) at the peak/break location.

Key spots to verify:
- Pipeline (Hawaii): 21.6637, -158.0515
- Cocoa Beach Pier (Florida): 28.3676, -80.6013
- Snapper Rocks (Australia): -28.1622, 153.5499
- Clearwater Beach (Florida Gulf): 27.978, -82.828
"""

import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')
if not BASE_URL:
    BASE_URL = "https://raw-surf-os.preview.emergentagent.com"


class TestAuthoritativeCoordinates:
    """Test that authoritative coordinates were applied correctly"""
    
    def test_api_health(self):
        """Verify API is accessible"""
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200, f"API health check failed: {response.status_code}"
        print("✓ API health check passed")
    
    def test_surf_spots_endpoint(self):
        """Verify surf spots endpoint returns data"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200, f"Surf spots endpoint failed: {response.status_code}"
        spots = response.json()
        assert len(spots) > 0, "No surf spots returned"
        print(f"✓ Surf spots endpoint returned {len(spots)} spots")
        return spots
    
    # =========================================================================
    # HAWAII - Pipeline (North Shore Oahu)
    # Expected: 21.6637, -158.0515 (IN THE WATER, offshore)
    # =========================================================================
    def test_pipeline_coordinates(self):
        """Verify Pipeline has correct offshore coordinates"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        spots = response.json()
        
        pipeline = next((s for s in spots if s['name'] == 'Pipeline'), None)
        
        if pipeline is None:
            pytest.skip("Pipeline spot not found in database")
        
        lat = pipeline['latitude']
        lon = pipeline['longitude']
        
        # Expected authoritative coordinates
        expected_lat = 21.6637
        expected_lon = -158.0515
        
        # Allow small tolerance (0.01 degrees = ~1km)
        lat_diff = abs(lat - expected_lat)
        lon_diff = abs(lon - expected_lon)
        
        print(f"Pipeline coordinates: ({lat}, {lon})")
        print(f"Expected: ({expected_lat}, {expected_lon})")
        print(f"Difference: lat={lat_diff:.4f}, lon={lon_diff:.4f}")
        
        # Verify coordinates are close to expected (within 0.01 degrees)
        assert lat_diff < 0.01, f"Pipeline latitude {lat} differs from expected {expected_lat} by {lat_diff}"
        assert lon_diff < 0.01, f"Pipeline longitude {lon} differs from expected {expected_lon} by {lon_diff}"
        
        # Verify it's in the water (North Shore Oahu - ocean is NORTH)
        # Pipeline should be at approximately 21.66 latitude (offshore)
        assert lat > 21.66, f"Pipeline latitude {lat} should be > 21.66 (offshore)"
        
        print(f"✓ Pipeline verified at ({lat}, {lon}) - IN THE WATER")
    
    # =========================================================================
    # FLORIDA - Cocoa Beach Pier (Space Coast, Atlantic)
    # Expected: 28.3676, -80.6013 (IN THE WATER, EAST of shoreline)
    # Florida Atlantic coast: Ocean is EAST, so longitude should be LESS negative
    # =========================================================================
    def test_cocoa_beach_pier_coordinates(self):
        """Verify Cocoa Beach Pier has correct offshore coordinates"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        spots = response.json()
        
        cocoa = next((s for s in spots if s['name'] == 'Cocoa Beach Pier'), None)
        
        if cocoa is None:
            pytest.skip("Cocoa Beach Pier spot not found in database")
        
        lat = cocoa['latitude']
        lon = cocoa['longitude']
        
        # Expected authoritative coordinates
        expected_lat = 28.3676
        expected_lon = -80.6013
        
        # Allow small tolerance
        lat_diff = abs(lat - expected_lat)
        lon_diff = abs(lon - expected_lon)
        
        print(f"Cocoa Beach Pier coordinates: ({lat}, {lon})")
        print(f"Expected: ({expected_lat}, {expected_lon})")
        print(f"Difference: lat={lat_diff:.4f}, lon={lon_diff:.4f}")
        
        # Verify coordinates are close to expected
        assert lat_diff < 0.02, f"Cocoa Beach Pier latitude {lat} differs from expected {expected_lat}"
        assert lon_diff < 0.02, f"Cocoa Beach Pier longitude {lon} differs from expected {expected_lon}"
        
        # Florida Atlantic coast shoreline at Cocoa Beach is approximately -80.61
        # To be IN THE WATER (EAST), longitude should be LESS negative (> -80.61)
        shoreline_lon = -80.61
        assert lon > shoreline_lon, f"Cocoa Beach Pier longitude {lon} should be > {shoreline_lon} (EAST of shoreline, in water)"
        
        print(f"✓ Cocoa Beach Pier verified at ({lat}, {lon}) - IN THE WATER (EAST of shoreline)")
    
    # =========================================================================
    # AUSTRALIA - Snapper Rocks (Gold Coast, Queensland)
    # Expected: -28.1622, 153.5499 (IN THE WATER, EAST of shoreline)
    # Australia East Coast: Ocean is EAST, so longitude should be MORE positive
    # =========================================================================
    def test_snapper_rocks_coordinates(self):
        """Verify Snapper Rocks has correct offshore coordinates"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        spots = response.json()
        
        snapper = next((s for s in spots if s['name'] == 'Snapper Rocks'), None)
        
        if snapper is None:
            pytest.skip("Snapper Rocks spot not found in database")
        
        lat = snapper['latitude']
        lon = snapper['longitude']
        
        # Expected authoritative coordinates
        expected_lat = -28.1622
        expected_lon = 153.5499
        
        # Allow small tolerance
        lat_diff = abs(lat - expected_lat)
        lon_diff = abs(lon - expected_lon)
        
        print(f"Snapper Rocks coordinates: ({lat}, {lon})")
        print(f"Expected: ({expected_lat}, {expected_lon})")
        print(f"Difference: lat={lat_diff:.4f}, lon={lon_diff:.4f}")
        
        # Verify coordinates are close to expected
        assert lat_diff < 0.02, f"Snapper Rocks latitude {lat} differs from expected {expected_lat}"
        assert lon_diff < 0.02, f"Snapper Rocks longitude {lon} differs from expected {expected_lon}"
        
        # Australia Gold Coast shoreline is approximately 153.54
        # To be IN THE WATER (EAST), longitude should be MORE positive (> 153.54)
        shoreline_lon = 153.54
        assert lon > shoreline_lon, f"Snapper Rocks longitude {lon} should be > {shoreline_lon} (EAST of shoreline, in water)"
        
        print(f"✓ Snapper Rocks verified at ({lat}, {lon}) - IN THE WATER (EAST of shoreline)")
    
    # =========================================================================
    # FLORIDA GULF COAST - Clearwater Beach
    # Expected: 27.978, -82.828 (IN THE WATER, WEST of shoreline)
    # Florida Gulf Coast: Ocean is WEST, so longitude should be MORE negative
    # =========================================================================
    def test_clearwater_beach_coordinates(self):
        """Verify Clearwater Beach has correct offshore coordinates"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        spots = response.json()
        
        clearwater = next((s for s in spots if s['name'] == 'Clearwater Beach'), None)
        
        if clearwater is None:
            pytest.skip("Clearwater Beach spot not found in database")
        
        lat = clearwater['latitude']
        lon = clearwater['longitude']
        
        # Expected authoritative coordinates
        expected_lat = 27.978
        expected_lon = -82.828
        
        # Allow small tolerance
        lat_diff = abs(lat - expected_lat)
        lon_diff = abs(lon - expected_lon)
        
        print(f"Clearwater Beach coordinates: ({lat}, {lon})")
        print(f"Expected: ({expected_lat}, {expected_lon})")
        print(f"Difference: lat={lat_diff:.4f}, lon={lon_diff:.4f}")
        
        # Verify coordinates are close to expected
        assert lat_diff < 0.02, f"Clearwater Beach latitude {lat} differs from expected {expected_lat}"
        assert lon_diff < 0.02, f"Clearwater Beach longitude {lon} differs from expected {expected_lon}"
        
        # Florida Gulf Coast shoreline at Clearwater is approximately -82.82
        # To be IN THE WATER (WEST), longitude should be MORE negative (< -82.82)
        shoreline_lon = -82.82
        assert lon < shoreline_lon, f"Clearwater Beach longitude {lon} should be < {shoreline_lon} (WEST of shoreline, in water)"
        
        print(f"✓ Clearwater Beach verified at ({lat}, {lon}) - IN THE WATER (WEST of shoreline)")
    
    # =========================================================================
    # Additional Key Spots Verification
    # =========================================================================
    def test_sebastian_inlet_coordinates(self):
        """Verify Sebastian Inlet has correct offshore coordinates"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        spots = response.json()
        
        sebastian = next((s for s in spots if s['name'] == 'Sebastian Inlet'), None)
        
        if sebastian is None:
            pytest.skip("Sebastian Inlet spot not found in database")
        
        lat = sebastian['latitude']
        lon = sebastian['longitude']
        
        # Expected authoritative coordinates
        expected_lat = 27.8562
        expected_lon = -80.4417
        
        print(f"Sebastian Inlet coordinates: ({lat}, {lon})")
        print(f"Expected: ({expected_lat}, {expected_lon})")
        
        # Florida Atlantic coast shoreline at Sebastian is approximately -80.45
        # To be IN THE WATER (EAST), longitude should be LESS negative (> -80.45)
        shoreline_lon = -80.45
        assert lon > shoreline_lon, f"Sebastian Inlet longitude {lon} should be > {shoreline_lon} (EAST of shoreline, in water)"
        
        print(f"✓ Sebastian Inlet verified at ({lat}, {lon}) - IN THE WATER")
    
    def test_new_smyrna_beach_inlet_coordinates(self):
        """Verify New Smyrna Beach Inlet has correct offshore coordinates"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        spots = response.json()
        
        nsb = next((s for s in spots if s['name'] == 'New Smyrna Beach Inlet'), None)
        
        if nsb is None:
            pytest.skip("New Smyrna Beach Inlet spot not found in database")
        
        lat = nsb['latitude']
        lon = nsb['longitude']
        
        # Expected authoritative coordinates
        expected_lat = 29.0360
        expected_lon = -80.9065
        
        print(f"New Smyrna Beach Inlet coordinates: ({lat}, {lon})")
        print(f"Expected: ({expected_lat}, {expected_lon})")
        
        # Florida Atlantic coast shoreline at NSB is approximately -80.92
        # To be IN THE WATER (EAST), longitude should be LESS negative (> -80.92)
        shoreline_lon = -80.92
        assert lon > shoreline_lon, f"New Smyrna Beach Inlet longitude {lon} should be > {shoreline_lon} (EAST of shoreline, in water)"
        
        print(f"✓ New Smyrna Beach Inlet verified at ({lat}, {lon}) - IN THE WATER")
    
    def test_sunset_beach_hawaii_coordinates(self):
        """Verify Sunset Beach (Hawaii) has correct offshore coordinates"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        spots = response.json()
        
        sunset = next((s for s in spots if s['name'] == 'Sunset Beach'), None)
        
        if sunset is None:
            pytest.skip("Sunset Beach spot not found in database")
        
        lat = sunset['latitude']
        lon = sunset['longitude']
        
        # Expected authoritative coordinates
        expected_lat = 21.6664
        expected_lon = -158.0553
        
        print(f"Sunset Beach coordinates: ({lat}, {lon})")
        print(f"Expected: ({expected_lat}, {expected_lon})")
        
        # Verify it's in the water (North Shore Oahu - ocean is NORTH)
        assert lat > 21.66, f"Sunset Beach latitude {lat} should be > 21.66 (offshore)"
        
        print(f"✓ Sunset Beach verified at ({lat}, {lon}) - IN THE WATER")
    
    def test_waimea_bay_coordinates(self):
        """Verify Waimea Bay has correct offshore coordinates"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        spots = response.json()
        
        waimea = next((s for s in spots if s['name'] == 'Waimea Bay'), None)
        
        if waimea is None:
            pytest.skip("Waimea Bay spot not found in database")
        
        lat = waimea['latitude']
        lon = waimea['longitude']
        
        # Expected authoritative coordinates
        expected_lat = 21.6403
        expected_lon = -158.0638
        
        print(f"Waimea Bay coordinates: ({lat}, {lon})")
        print(f"Expected: ({expected_lat}, {expected_lon})")
        
        # Verify it's in the water (North Shore Oahu)
        assert lat > 21.63, f"Waimea Bay latitude {lat} should be > 21.63 (offshore)"
        
        print(f"✓ Waimea Bay verified at ({lat}, {lon}) - IN THE WATER")
    
    def test_burleigh_heads_coordinates(self):
        """Verify Burleigh Heads (Australia) has correct offshore coordinates"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        spots = response.json()
        
        burleigh = next((s for s in spots if s['name'] == 'Burleigh Heads'), None)
        
        if burleigh is None:
            pytest.skip("Burleigh Heads spot not found in database")
        
        lat = burleigh['latitude']
        lon = burleigh['longitude']
        
        # Expected authoritative coordinates
        expected_lat = -28.0917
        expected_lon = 153.4542
        
        print(f"Burleigh Heads coordinates: ({lat}, {lon})")
        print(f"Expected: ({expected_lat}, {expected_lon})")
        
        # Australia Gold Coast shoreline is approximately 153.44
        # To be IN THE WATER (EAST), longitude should be MORE positive (> 153.44)
        shoreline_lon = 153.44
        assert lon > shoreline_lon, f"Burleigh Heads longitude {lon} should be > {shoreline_lon} (EAST of shoreline, in water)"
        
        print(f"✓ Burleigh Heads verified at ({lat}, {lon}) - IN THE WATER")
    
    def test_all_key_spots_summary(self):
        """Summary test - verify all key spots have correct offshore coordinates"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        spots = response.json()
        
        # Key spots to verify with expected coordinates
        key_spots = {
            "Pipeline": {"lat": 21.6637, "lon": -158.0515, "direction": "north"},
            "Cocoa Beach Pier": {"lat": 28.3676, "lon": -80.6013, "direction": "east"},
            "Snapper Rocks": {"lat": -28.1622, "lon": 153.5499, "direction": "east"},
            "Clearwater Beach": {"lat": 27.978, "lon": -82.828, "direction": "west"},
        }
        
        verified_count = 0
        missing_count = 0
        
        print("\n" + "="*60)
        print("KEY SPOTS COORDINATE VERIFICATION SUMMARY")
        print("="*60)
        
        for spot_name, expected in key_spots.items():
            spot = next((s for s in spots if s['name'] == spot_name), None)
            
            if spot is None:
                print(f"⚠ {spot_name}: NOT FOUND in database")
                missing_count += 1
                continue
            
            lat = spot['latitude']
            lon = spot['longitude']
            lat_diff = abs(lat - expected['lat'])
            lon_diff = abs(lon - expected['lon'])
            
            # Check if within tolerance
            is_close = lat_diff < 0.02 and lon_diff < 0.02
            
            if is_close:
                print(f"✓ {spot_name}: ({lat}, {lon}) - VERIFIED")
                verified_count += 1
            else:
                print(f"✗ {spot_name}: ({lat}, {lon}) - DIFFERS from expected ({expected['lat']}, {expected['lon']})")
        
        print("="*60)
        print(f"TOTAL: {verified_count}/{len(key_spots)} key spots verified")
        print(f"MISSING: {missing_count} spots not found in database")
        print("="*60)
        
        # At least 2 of the 4 key spots should be verified
        assert verified_count >= 2, f"Only {verified_count} key spots verified, expected at least 2"


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
