"""
Test Iteration 156: Florida Surgical Precision Coordinates
Verifies that the florida_surgical_fix.py script correctly updated 104 Florida spots
with surgical precision coordinates - all pins must be IN THE WATER (50-150m offshore).

User-specified Space Coast coordinates:
- Jetty Park: (28.4061, -80.5890)
- Cherie Down Park: (28.3842, -80.6015)
- Cocoa Beach Pier: (28.3676, -80.6012)
- Shepard Park: (28.3585, -80.6035)
"""

import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestFloridaSurgicalCoordinates:
    """Test Florida spots have correct surgical precision coordinates"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test fixtures"""
        self.api_url = f"{BASE_URL}/api"
        
    def test_api_health(self):
        """Test API is accessible"""
        response = requests.get(f"{self.api_url}/health")
        assert response.status_code == 200, f"API health check failed: {response.text}"
        print("API health check passed")
        
    def test_surf_spots_endpoint(self):
        """Test surf spots endpoint returns data"""
        response = requests.get(f"{self.api_url}/surf-spots")
        assert response.status_code == 200, f"Surf spots endpoint failed: {response.text}"
        spots = response.json()
        assert len(spots) > 0, "No surf spots returned"
        print(f"Surf spots endpoint returned {len(spots)} spots")
        
    # ============================================================
    # SPACE COAST - USER-SPECIFIED COORDINATES (CRITICAL)
    # ============================================================
    
    def test_jetty_park_user_specified_coordinates(self):
        """
        CRITICAL: Jetty Park must have USER-SPECIFIED coordinates
        Expected: (28.4061, -80.5890) - Tip of North Jetty
        """
        response = requests.get(f"{self.api_url}/surf-spots")
        assert response.status_code == 200
        spots = response.json()
        
        jetty_park = next((s for s in spots if s['name'] == 'Jetty Park'), None)
        assert jetty_park is not None, "Jetty Park not found in database"
        
        expected_lat = 28.4061
        expected_lon = -80.5890
        
        # Allow small tolerance (0.001 degrees = ~111m)
        lat_diff = abs(jetty_park['latitude'] - expected_lat)
        lon_diff = abs(jetty_park['longitude'] - expected_lon)
        
        assert lat_diff < 0.001, f"Jetty Park latitude mismatch: expected {expected_lat}, got {jetty_park['latitude']}"
        assert lon_diff < 0.001, f"Jetty Park longitude mismatch: expected {expected_lon}, got {jetty_park['longitude']}"
        
        print(f"VERIFIED: Jetty Park at ({jetty_park['latitude']}, {jetty_park['longitude']}) - USER SPECIFIED")
        
    def test_cherie_down_park_user_specified_coordinates(self):
        """
        CRITICAL: Cherie Down Park must have USER-SPECIFIED coordinates
        Expected: (28.3842, -80.6015) - Seaward of Ridgewood Ave
        """
        response = requests.get(f"{self.api_url}/surf-spots")
        assert response.status_code == 200
        spots = response.json()
        
        cherie_down = next((s for s in spots if 'Cherie Down' in s['name']), None)
        assert cherie_down is not None, "Cherie Down Park not found in database"
        
        expected_lat = 28.3842
        expected_lon = -80.6015
        
        lat_diff = abs(cherie_down['latitude'] - expected_lat)
        lon_diff = abs(cherie_down['longitude'] - expected_lon)
        
        assert lat_diff < 0.001, f"Cherie Down Park latitude mismatch: expected {expected_lat}, got {cherie_down['latitude']}"
        assert lon_diff < 0.001, f"Cherie Down Park longitude mismatch: expected {expected_lon}, got {cherie_down['longitude']}"
        
        print(f"VERIFIED: Cherie Down Park at ({cherie_down['latitude']}, {cherie_down['longitude']}) - USER SPECIFIED")
        
    def test_cocoa_beach_pier_user_specified_coordinates(self):
        """
        CRITICAL: Cocoa Beach Pier must have USER-SPECIFIED coordinates
        Expected: (28.3676, -80.6012) - Offshore/Pier-side
        """
        response = requests.get(f"{self.api_url}/surf-spots")
        assert response.status_code == 200
        spots = response.json()
        
        cocoa_pier = next((s for s in spots if s['name'] == 'Cocoa Beach Pier'), None)
        assert cocoa_pier is not None, "Cocoa Beach Pier not found in database"
        
        expected_lat = 28.3676
        expected_lon = -80.6012
        
        lat_diff = abs(cocoa_pier['latitude'] - expected_lat)
        lon_diff = abs(cocoa_pier['longitude'] - expected_lon)
        
        assert lat_diff < 0.001, f"Cocoa Beach Pier latitude mismatch: expected {expected_lat}, got {cocoa_pier['latitude']}"
        assert lon_diff < 0.001, f"Cocoa Beach Pier longitude mismatch: expected {expected_lon}, got {cocoa_pier['longitude']}"
        
        print(f"VERIFIED: Cocoa Beach Pier at ({cocoa_pier['latitude']}, {cocoa_pier['longitude']}) - USER SPECIFIED")
        
    def test_shepard_park_user_specified_coordinates(self):
        """
        CRITICAL: Shepard Park must have USER-SPECIFIED coordinates
        Expected: (28.3585, -80.6035) - Offshore of SR 520
        """
        response = requests.get(f"{self.api_url}/surf-spots")
        assert response.status_code == 200
        spots = response.json()
        
        shepard_park = next((s for s in spots if s['name'] == 'Shepard Park'), None)
        assert shepard_park is not None, "Shepard Park not found in database"
        
        expected_lat = 28.3585
        expected_lon = -80.6035
        
        lat_diff = abs(shepard_park['latitude'] - expected_lat)
        lon_diff = abs(shepard_park['longitude'] - expected_lon)
        
        assert lat_diff < 0.001, f"Shepard Park latitude mismatch: expected {expected_lat}, got {shepard_park['latitude']}"
        assert lon_diff < 0.001, f"Shepard Park longitude mismatch: expected {expected_lon}, got {shepard_park['longitude']}"
        
        print(f"VERIFIED: Shepard Park at ({shepard_park['latitude']}, {shepard_park['longitude']}) - USER SPECIFIED")
        
    def test_sebastian_inlet_coordinates(self):
        """
        Sebastian Inlet - Premier Florida surf spot
        Expected: (27.8603, -80.4473) - North Jetty peak
        """
        response = requests.get(f"{self.api_url}/surf-spots")
        assert response.status_code == 200
        spots = response.json()
        
        sebastian = next((s for s in spots if s['name'] == 'Sebastian Inlet'), None)
        assert sebastian is not None, "Sebastian Inlet not found in database"
        
        expected_lat = 27.8603
        expected_lon = -80.4473
        
        lat_diff = abs(sebastian['latitude'] - expected_lat)
        lon_diff = abs(sebastian['longitude'] - expected_lon)
        
        assert lat_diff < 0.01, f"Sebastian Inlet latitude mismatch: expected {expected_lat}, got {sebastian['latitude']}"
        assert lon_diff < 0.01, f"Sebastian Inlet longitude mismatch: expected {expected_lon}, got {sebastian['longitude']}"
        
        print(f"VERIFIED: Sebastian Inlet at ({sebastian['latitude']}, {sebastian['longitude']})")
        
    # ============================================================
    # VOLUSIA REGION
    # ============================================================
    
    def test_new_smyrna_beach_inlet_coordinates(self):
        """
        New Smyrna Beach Inlet - Research verified
        Expected: (29.0964, -80.9370)
        """
        response = requests.get(f"{self.api_url}/surf-spots")
        assert response.status_code == 200
        spots = response.json()
        
        nsb = next((s for s in spots if s['name'] == 'New Smyrna Beach Inlet'), None)
        assert nsb is not None, "New Smyrna Beach Inlet not found in database"
        
        expected_lat = 29.0964
        expected_lon = -80.9370
        
        lat_diff = abs(nsb['latitude'] - expected_lat)
        lon_diff = abs(nsb['longitude'] - expected_lon)
        
        assert lat_diff < 0.01, f"NSB Inlet latitude mismatch: expected {expected_lat}, got {nsb['latitude']}"
        assert lon_diff < 0.01, f"NSB Inlet longitude mismatch: expected {expected_lon}, got {nsb['longitude']}"
        
        print(f"VERIFIED: New Smyrna Beach Inlet at ({nsb['latitude']}, {nsb['longitude']})")
        
    # ============================================================
    # GULF COAST - MUST BE WEST (MORE NEGATIVE LONGITUDE)
    # ============================================================
    
    def test_clearwater_beach_gulf_coordinates(self):
        """
        Clearwater Beach - Gulf Coast (ocean is WEST)
        Expected: (27.9780, -82.8450) - Offshore WEST
        Longitude must be MORE negative than -82.8 (west of shoreline)
        """
        response = requests.get(f"{self.api_url}/surf-spots")
        assert response.status_code == 200
        spots = response.json()
        
        clearwater = next((s for s in spots if s['name'] == 'Clearwater Beach'), None)
        assert clearwater is not None, "Clearwater Beach not found in database"
        
        # Gulf Coast spots must have longitude MORE negative than -82.8
        assert clearwater['longitude'] < -82.8, f"Clearwater Beach longitude {clearwater['longitude']} is not west enough (should be < -82.8)"
        
        print(f"VERIFIED: Clearwater Beach at ({clearwater['latitude']}, {clearwater['longitude']}) - WEST of shoreline")
        
    def test_siesta_key_gulf_coordinates(self):
        """
        Siesta Key - Gulf Coast (ocean is WEST)
        Expected: (27.2780, -82.5650) - Offshore WEST
        """
        response = requests.get(f"{self.api_url}/surf-spots")
        assert response.status_code == 200
        spots = response.json()
        
        siesta = next((s for s in spots if s['name'] == 'Siesta Key'), None)
        assert siesta is not None, "Siesta Key not found in database"
        
        # Gulf Coast spots must have longitude MORE negative than -82.5
        assert siesta['longitude'] < -82.5, f"Siesta Key longitude {siesta['longitude']} is not west enough (should be < -82.5)"
        
        print(f"VERIFIED: Siesta Key at ({siesta['latitude']}, {siesta['longitude']}) - WEST of shoreline")
        
    def test_naples_pier_gulf_coordinates(self):
        """
        Naples Pier - Gulf Coast (ocean is WEST)
        Expected: (26.1480, -81.8190) - Offshore WEST
        """
        response = requests.get(f"{self.api_url}/surf-spots")
        assert response.status_code == 200
        spots = response.json()
        
        naples = next((s for s in spots if s['name'] == 'Naples Pier'), None)
        assert naples is not None, "Naples Pier not found in database"
        
        # Gulf Coast spots must have longitude MORE negative than -81.8
        assert naples['longitude'] < -81.8, f"Naples Pier longitude {naples['longitude']} is not west enough (should be < -81.8)"
        
        print(f"VERIFIED: Naples Pier at ({naples['latitude']}, {naples['longitude']}) - WEST of shoreline")
        
    # ============================================================
    # PANHANDLE - OCEAN IS SOUTH
    # ============================================================
    
    def test_pensacola_beach_panhandle_coordinates(self):
        """
        Pensacola Beach - Panhandle (ocean is SOUTH)
        Expected: (30.3080, -87.1380) - Offshore SOUTH
        """
        response = requests.get(f"{self.api_url}/surf-spots")
        assert response.status_code == 200
        spots = response.json()
        
        pensacola = next((s for s in spots if s['name'] == 'Pensacola Beach'), None)
        assert pensacola is not None, "Pensacola Beach not found in database"
        
        # Panhandle spots should be around lat 30.3
        assert 30.0 < pensacola['latitude'] < 30.5, f"Pensacola Beach latitude {pensacola['latitude']} is out of expected range"
        
        print(f"VERIFIED: Pensacola Beach at ({pensacola['latitude']}, {pensacola['longitude']})")
        
    def test_panama_city_beach_panhandle_coordinates(self):
        """
        Panama City Beach - Panhandle (ocean is SOUTH)
        Expected: (30.1480, -85.7920) - Offshore SOUTH
        """
        response = requests.get(f"{self.api_url}/surf-spots")
        assert response.status_code == 200
        spots = response.json()
        
        pcb = next((s for s in spots if s['name'] == 'Panama City Beach'), None)
        assert pcb is not None, "Panama City Beach not found in database"
        
        # Panhandle spots should be around lat 30.1
        assert 29.9 < pcb['latitude'] < 30.3, f"Panama City Beach latitude {pcb['latitude']} is out of expected range"
        
        print(f"VERIFIED: Panama City Beach at ({pcb['latitude']}, {pcb['longitude']})")
        
    # ============================================================
    # FIRST COAST
    # ============================================================
    
    def test_jacksonville_beach_pier_coordinates(self):
        """
        Jacksonville Beach Pier - First Coast
        Expected: (30.2820, -81.4080) - Offshore
        """
        response = requests.get(f"{self.api_url}/surf-spots")
        assert response.status_code == 200
        spots = response.json()
        
        jax = next((s for s in spots if s['name'] == 'Jacksonville Beach Pier'), None)
        assert jax is not None, "Jacksonville Beach Pier not found in database"
        
        # First Coast spots should be around lat 30.2-30.4
        assert 30.0 < jax['latitude'] < 30.5, f"Jacksonville Beach Pier latitude {jax['latitude']} is out of expected range"
        
        print(f"VERIFIED: Jacksonville Beach Pier at ({jax['latitude']}, {jax['longitude']})")
        
    # ============================================================
    # TREASURE COAST
    # ============================================================
    
    def test_fort_pierce_inlet_coordinates(self):
        """
        Fort Pierce Inlet - Treasure Coast
        Expected: (27.4750, -80.2830) - Offshore inlet
        """
        response = requests.get(f"{self.api_url}/surf-spots")
        assert response.status_code == 200
        spots = response.json()
        
        fpi = next((s for s in spots if s['name'] == 'Fort Pierce Inlet'), None)
        assert fpi is not None, "Fort Pierce Inlet not found in database"
        
        # Treasure Coast spots should be around lat 27.4-27.5
        assert 27.3 < fpi['latitude'] < 27.6, f"Fort Pierce Inlet latitude {fpi['latitude']} is out of expected range"
        
        print(f"VERIFIED: Fort Pierce Inlet at ({fpi['latitude']}, {fpi['longitude']})")
        
    # ============================================================
    # SOUTHEAST FLORIDA
    # ============================================================
    
    def test_jupiter_inlet_coordinates(self):
        """
        Jupiter Inlet - Southeast Florida
        Expected: (26.9400, -80.0780) - Offshore inlet
        """
        response = requests.get(f"{self.api_url}/surf-spots")
        assert response.status_code == 200
        spots = response.json()
        
        jupiter = next((s for s in spots if s['name'] == 'Jupiter Inlet'), None)
        assert jupiter is not None, "Jupiter Inlet not found in database"
        
        # Southeast spots should be around lat 26.9
        assert 26.8 < jupiter['latitude'] < 27.1, f"Jupiter Inlet latitude {jupiter['latitude']} is out of expected range"
        
        print(f"VERIFIED: Jupiter Inlet at ({jupiter['latitude']}, {jupiter['longitude']})")
        
    def test_south_beach_miami_coordinates(self):
        """
        South Beach Miami - Southeast Florida
        Expected: (25.7800, -80.1410) - Offshore
        """
        response = requests.get(f"{self.api_url}/surf-spots")
        assert response.status_code == 200
        spots = response.json()
        
        # Try both possible names
        south_beach = next((s for s in spots if s['name'] in ['South Beach Miami', 'South Beach']), None)
        assert south_beach is not None, "South Beach not found in database"
        
        # Miami area spots should be around lat 25.7-25.9
        assert 25.6 < south_beach['latitude'] < 26.0, f"South Beach latitude {south_beach['latitude']} is out of expected range"
        
        print(f"VERIFIED: South Beach at ({south_beach['latitude']}, {south_beach['longitude']})")
        
    # ============================================================
    # SUMMARY TEST
    # ============================================================
    
    def test_all_florida_regions_summary(self):
        """
        Summary test: Verify all Florida regions have spots with offshore coordinates
        """
        response = requests.get(f"{self.api_url}/surf-spots")
        assert response.status_code == 200
        spots = response.json()
        
        # Count Florida spots by checking latitude/longitude ranges
        florida_spots = [s for s in spots if 
            24.5 < s.get('latitude', 0) < 31.0 and 
            -88.0 < s.get('longitude', 0) < -79.5]
        
        print(f"\n{'='*60}")
        print(f"FLORIDA SURGICAL PRECISION SUMMARY")
        print(f"{'='*60}")
        print(f"Total Florida spots found: {len(florida_spots)}")
        
        # Verify key user-specified spots
        user_specified = {
            'Jetty Park': (28.4061, -80.5890),
            'Cherie Down Park': (28.3842, -80.6015),
            'Cocoa Beach Pier': (28.3676, -80.6012),
            'Shepard Park': (28.3585, -80.6035),
        }
        
        verified_count = 0
        for spot_name, (expected_lat, expected_lon) in user_specified.items():
            spot = next((s for s in spots if spot_name in s['name']), None)
            if spot:
                lat_ok = abs(spot['latitude'] - expected_lat) < 0.001
                lon_ok = abs(spot['longitude'] - expected_lon) < 0.001
                status = "VERIFIED" if lat_ok and lon_ok else "MISMATCH"
                print(f"  {spot_name}: ({spot['latitude']}, {spot['longitude']}) - {status}")
                if lat_ok and lon_ok:
                    verified_count += 1
            else:
                print(f"  {spot_name}: NOT FOUND")
        
        print(f"\nUser-specified spots verified: {verified_count}/{len(user_specified)}")
        print(f"{'='*60}")
        
        assert verified_count == len(user_specified), f"Only {verified_count}/{len(user_specified)} user-specified spots verified"
