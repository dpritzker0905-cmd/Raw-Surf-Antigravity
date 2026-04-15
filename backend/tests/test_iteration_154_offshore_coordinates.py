"""
Test Iteration 154 - Verify Florida surf spots are EAST of shoreline (in the ocean)

Key insight: Florida's Atlantic coast faces EAST. To be in the water:
- Longitude must be LESS negative (more positive)
- Example: Daytona shoreline at -81.02, water at -80.98 (EAST of shoreline)

Florida coastline reference:
- Jacksonville: -81.40
- St Augustine: -81.28
- Flagler: -81.13
- Daytona: -81.02
- New Smyrna: -80.92
- Space Coast: -80.61
- Melbourne: -80.56
- Sebastian: -80.45
- Vero: -80.37
- Jupiter: -80.07
- Miami: -80.12

All pins should be 0.02-0.04 degrees EAST (less negative) of these shoreline values.
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Florida shoreline reference longitudes (approximate)
SHORELINE_REFERENCE = {
    "Jacksonville": -81.40,
    "St Augustine": -81.28,
    "Flagler": -81.13,
    "Daytona": -81.02,
    "New Smyrna": -80.92,
    "Space Coast": -80.61,
    "Melbourne": -80.56,
    "Sebastian": -80.45,
    "Vero": -80.37,
    "Jupiter": -80.07,
    "Miami": -80.12,
}


class TestFloridaOffshoreCoordinates:
    """Verify Florida surf spots are positioned EAST of shoreline (in the ocean)"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test session"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
    
    def test_api_health(self):
        """Test API is accessible"""
        response = self.session.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200, f"API health check failed: {response.status_code}"
        print("API health check passed")
    
    def test_daytona_beach_coordinates(self):
        """
        Daytona Beach: Expected 29.2118, -80.98
        Shoreline at -81.02, so -80.98 is EAST (in the water)
        """
        response = self.session.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        
        spots = response.json()
        daytona = next((s for s in spots if "Daytona Beach" in s.get("name", "") and "Shores" not in s.get("name", "")), None)
        
        if daytona:
            lat = float(daytona.get("latitude", 0))
            lon = float(daytona.get("longitude", 0))
            
            # Verify latitude is approximately correct
            assert 29.0 < lat < 29.5, f"Daytona Beach latitude {lat} out of expected range"
            
            # Verify longitude is EAST of shoreline (-81.02)
            # Less negative = more EAST = in the water
            shoreline = SHORELINE_REFERENCE["Daytona"]
            assert lon > shoreline, f"Daytona Beach longitude {lon} is WEST of shoreline {shoreline} - should be in water!"
            
            print(f"Daytona Beach: ({lat}, {lon}) - EAST of shoreline {shoreline} ✓")
        else:
            pytest.skip("Daytona Beach spot not found in database")
    
    def test_daytona_beach_shores_coordinates(self):
        """
        Daytona Beach Shores: Expected 29.1628, -80.94
        Should be EAST of Daytona shoreline (-81.02)
        """
        response = self.session.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        
        spots = response.json()
        daytona_shores = next((s for s in spots if "Daytona Beach Shores" in s.get("name", "")), None)
        
        if daytona_shores:
            lat = float(daytona_shores.get("latitude", 0))
            lon = float(daytona_shores.get("longitude", 0))
            
            shoreline = SHORELINE_REFERENCE["Daytona"]
            assert lon > shoreline, f"Daytona Beach Shores longitude {lon} is WEST of shoreline {shoreline} - should be in water!"
            
            print(f"Daytona Beach Shores: ({lat}, {lon}) - EAST of shoreline {shoreline} ✓")
        else:
            pytest.skip("Daytona Beach Shores spot not found in database")
    
    def test_ormond_beach_coordinates(self):
        """
        Ormond Beach: Expected 29.2868, -80.99
        Should be EAST of Daytona shoreline (-81.02)
        """
        response = self.session.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        
        spots = response.json()
        ormond = next((s for s in spots if "Ormond Beach" in s.get("name", "")), None)
        
        if ormond:
            lat = float(ormond.get("latitude", 0))
            lon = float(ormond.get("longitude", 0))
            
            shoreline = SHORELINE_REFERENCE["Daytona"]
            assert lon > shoreline, f"Ormond Beach longitude {lon} is WEST of shoreline {shoreline} - should be in water!"
            
            print(f"Ormond Beach: ({lat}, {lon}) - EAST of shoreline {shoreline} ✓")
        else:
            pytest.skip("Ormond Beach spot not found in database")
    
    def test_cocoa_beach_pier_coordinates(self):
        """
        Cocoa Beach Pier: Expected 28.3678, -80.58
        Space Coast shoreline at -80.61, so -80.58 is EAST (in the water)
        """
        response = self.session.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        
        spots = response.json()
        cocoa = next((s for s in spots if "Cocoa Beach" in s.get("name", "") and "Pier" in s.get("name", "")), None)
        
        if cocoa:
            lat = float(cocoa.get("latitude", 0))
            lon = float(cocoa.get("longitude", 0))
            
            shoreline = SHORELINE_REFERENCE["Space Coast"]
            assert lon > shoreline, f"Cocoa Beach Pier longitude {lon} is WEST of shoreline {shoreline} - should be in water!"
            
            print(f"Cocoa Beach Pier: ({lat}, {lon}) - EAST of shoreline {shoreline} ✓")
        else:
            pytest.skip("Cocoa Beach Pier spot not found in database")
    
    def test_jetty_park_coordinates(self):
        """
        Jetty Park: Expected 28.4065, -80.57
        Space Coast shoreline at -80.61, so -80.57 is EAST (in the water)
        """
        response = self.session.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        
        spots = response.json()
        jetty = next((s for s in spots if "Jetty Park" in s.get("name", "")), None)
        
        if jetty:
            lat = float(jetty.get("latitude", 0))
            lon = float(jetty.get("longitude", 0))
            
            shoreline = SHORELINE_REFERENCE["Space Coast"]
            assert lon > shoreline, f"Jetty Park longitude {lon} is WEST of shoreline {shoreline} - should be in water!"
            
            print(f"Jetty Park: ({lat}, {lon}) - EAST of shoreline {shoreline} ✓")
        else:
            pytest.skip("Jetty Park spot not found in database")
    
    def test_sebastian_inlet_coordinates(self):
        """
        Sebastian Inlet: Expected 27.8562, -80.42
        Sebastian shoreline at -80.45, so -80.42 is EAST (in the water)
        """
        response = self.session.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        
        spots = response.json()
        sebastian = next((s for s in spots if "Sebastian Inlet" in s.get("name", "")), None)
        
        if sebastian:
            lat = float(sebastian.get("latitude", 0))
            lon = float(sebastian.get("longitude", 0))
            
            shoreline = SHORELINE_REFERENCE["Sebastian"]
            assert lon > shoreline, f"Sebastian Inlet longitude {lon} is WEST of shoreline {shoreline} - should be in water!"
            
            print(f"Sebastian Inlet: ({lat}, {lon}) - EAST of shoreline {shoreline} ✓")
        else:
            pytest.skip("Sebastian Inlet spot not found in database")
    
    def test_jacksonville_beach_pier_coordinates(self):
        """
        Jacksonville Beach Pier: Expected 30.2858, -81.36
        Jacksonville shoreline at -81.40, so -81.36 is EAST (in the water)
        """
        response = self.session.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        
        spots = response.json()
        jax = next((s for s in spots if "Jacksonville Beach" in s.get("name", "") and "Pier" in s.get("name", "")), None)
        
        if jax:
            lat = float(jax.get("latitude", 0))
            lon = float(jax.get("longitude", 0))
            
            shoreline = SHORELINE_REFERENCE["Jacksonville"]
            assert lon > shoreline, f"Jacksonville Beach Pier longitude {lon} is WEST of shoreline {shoreline} - should be in water!"
            
            print(f"Jacksonville Beach Pier: ({lat}, {lon}) - EAST of shoreline {shoreline} ✓")
        else:
            pytest.skip("Jacksonville Beach Pier spot not found in database")
    
    def test_miami_south_beach_coordinates(self):
        """
        Miami South Beach: Expected 25.7848, -80.10
        Miami shoreline at -80.12, so -80.10 is EAST (in the water)
        """
        response = self.session.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        
        spots = response.json()
        miami = next((s for s in spots if "Miami" in s.get("name", "") and "South Beach" in s.get("name", "")), None)
        
        if miami:
            lat = float(miami.get("latitude", 0))
            lon = float(miami.get("longitude", 0))
            
            shoreline = SHORELINE_REFERENCE["Miami"]
            assert lon > shoreline, f"Miami South Beach longitude {lon} is WEST of shoreline {shoreline} - should be in water!"
            
            print(f"Miami South Beach: ({lat}, {lon}) - EAST of shoreline {shoreline} ✓")
        else:
            pytest.skip("Miami South Beach spot not found in database")
    
    def test_all_florida_spots_offshore(self):
        """
        Verify ALL Florida spots have longitude EAST of their respective shoreline.
        This is the comprehensive test to ensure no pins are on land.
        
        Updated shoreline mapping based on spot names for accuracy.
        """
        response = self.session.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        
        spots = response.json()
        florida_spots = [s for s in spots if s.get("region") == "Florida" or s.get("state") == "Florida"]
        
        if not florida_spots:
            # Try filtering by country and checking name
            florida_spots = [s for s in spots if s.get("country") == "USA" and 
                           any(fl in s.get("name", "") for fl in ["Florida", "Jacksonville", "Daytona", "Cocoa", "Sebastian", "Miami", "Palm Beach", "Vero", "Melbourne", "New Smyrna", "St Augustine", "Flagler"])]
        
        print(f"\nFound {len(florida_spots)} Florida spots to verify")
        
        on_land_spots = []
        verified_spots = []
        
        for spot in florida_spots:
            name = spot.get("name", "Unknown")
            lat = float(spot.get("latitude", 0))
            lon = float(spot.get("longitude", 0))
            
            # Determine shoreline based on spot NAME for accuracy
            name_lower = name.lower()
            if "jacksonville" in name_lower:
                shoreline = SHORELINE_REFERENCE["Jacksonville"]
                area = "Jacksonville"
            elif "st augustine" in name_lower or "st. augustine" in name_lower:
                shoreline = SHORELINE_REFERENCE["St Augustine"]
                area = "St Augustine"
            elif "flagler" in name_lower:
                shoreline = SHORELINE_REFERENCE["Flagler"]
                area = "Flagler"
            elif "daytona" in name_lower or "ormond" in name_lower:
                shoreline = SHORELINE_REFERENCE["Daytona"]
                area = "Daytona"
            elif "new smyrna" in name_lower:
                shoreline = SHORELINE_REFERENCE["New Smyrna"]
                area = "New Smyrna"
            elif "cocoa" in name_lower or "jetty park" in name_lower:
                shoreline = SHORELINE_REFERENCE["Space Coast"]
                area = "Space Coast"
            elif "melbourne" in name_lower:
                shoreline = SHORELINE_REFERENCE["Melbourne"]
                area = "Melbourne"
            elif "sebastian" in name_lower:
                shoreline = SHORELINE_REFERENCE["Sebastian"]
                area = "Sebastian"
            elif "vero" in name_lower:
                shoreline = SHORELINE_REFERENCE["Vero"]
                area = "Vero"
            elif "jupiter" in name_lower or "palm beach" in name_lower:
                shoreline = SHORELINE_REFERENCE["Jupiter"]
                area = "Jupiter"
            elif "miami" in name_lower:
                shoreline = SHORELINE_REFERENCE["Miami"]
                area = "Miami"
            else:
                # Fallback to latitude-based for unknown spots
                if lat > 30.0:
                    shoreline = SHORELINE_REFERENCE["Jacksonville"]
                    area = "Jacksonville"
                elif lat > 29.5:
                    shoreline = SHORELINE_REFERENCE["St Augustine"]
                    area = "St Augustine"
                elif lat > 29.0:
                    shoreline = SHORELINE_REFERENCE["Daytona"]
                    area = "Daytona"
                elif lat > 28.5:
                    shoreline = SHORELINE_REFERENCE["Space Coast"]
                    area = "Space Coast"
                elif lat > 27.5:
                    shoreline = SHORELINE_REFERENCE["Sebastian"]
                    area = "Sebastian"
                elif lat > 26.5:
                    shoreline = SHORELINE_REFERENCE["Jupiter"]
                    area = "Jupiter"
                else:
                    shoreline = SHORELINE_REFERENCE["Miami"]
                    area = "Miami"
            
            # Check if spot is EAST of shoreline (in the water)
            if lon > shoreline:
                verified_spots.append(f"{name}: ({lat}, {lon}) - EAST of {area} shoreline {shoreline} ✓")
            else:
                on_land_spots.append(f"{name}: ({lat}, {lon}) - WEST of {area} shoreline {shoreline} - ON LAND!")
        
        # Print results
        print(f"\nVerified offshore: {len(verified_spots)}")
        for v in verified_spots[:10]:  # Show first 10
            print(f"  {v}")
        if len(verified_spots) > 10:
            print(f"  ... and {len(verified_spots) - 10} more")
        
        if on_land_spots:
            print(f"\n⚠️ ON LAND (need fixing): {len(on_land_spots)}")
            for ol in on_land_spots:
                print(f"  {ol}")
        
        # Assert no spots are on land
        assert len(on_land_spots) == 0, f"Found {len(on_land_spots)} spots ON LAND: {on_land_spots}"
        print(f"\n✓ All {len(verified_spots)} Florida spots verified as offshore!")


class TestSpecificCoordinateValues:
    """Test the exact coordinate values mentioned in the fix"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test session"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
    
    def test_expected_coordinates_summary(self):
        """
        Summary test: Print all Florida spots with their coordinates
        for manual verification against expected values.
        """
        response = self.session.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        
        spots = response.json()
        
        # Expected coordinates from the fix
        expected = {
            "Daytona Beach": {"lat": 29.2118, "lon": -80.98, "shoreline": -81.02},
            "Daytona Beach Shores": {"lat": 29.1628, "lon": -80.94, "shoreline": -81.02},
            "Ormond Beach": {"lat": 29.2868, "lon": -80.99, "shoreline": -81.02},
            "Cocoa Beach Pier": {"lat": 28.3678, "lon": -80.58, "shoreline": -80.61},
            "Jetty Park": {"lat": 28.4065, "lon": -80.57, "shoreline": -80.61},
            "Sebastian Inlet": {"lat": 27.8562, "lon": -80.42, "shoreline": -80.45},
            "Jacksonville Beach Pier": {"lat": 30.2858, "lon": -81.36, "shoreline": -81.40},
            "Miami South Beach": {"lat": 25.7848, "lon": -80.10, "shoreline": -80.12},
        }
        
        print("\n=== EXPECTED vs ACTUAL COORDINATES ===")
        print("(All should be EAST of shoreline = less negative longitude)\n")
        
        for name, exp in expected.items():
            # Find spot in database
            spot = next((s for s in spots if name in s.get("name", "")), None)
            
            if spot:
                actual_lat = float(spot.get("latitude", 0))
                actual_lon = float(spot.get("longitude", 0))
                
                # Check if in water (EAST of shoreline)
                in_water = actual_lon > exp["shoreline"]
                status = "✓ IN WATER" if in_water else "✗ ON LAND"
                
                print(f"{name}:")
                print(f"  Expected: ({exp['lat']}, {exp['lon']})")
                print(f"  Actual:   ({actual_lat}, {actual_lon})")
                print(f"  Shoreline: {exp['shoreline']}")
                print(f"  Status: {status}")
                print()
            else:
                print(f"{name}: NOT FOUND in database")
                print()
        
        print("=== END COORDINATE VERIFICATION ===")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
