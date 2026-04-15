"""
Iteration 153 - PRECISION COORDINATE FIX VERIFICATION
Tests for 145 spot precision fixes with Surfline/mondo.surf verified coordinates.
All pins should be positioned at OFFSHORE PEAK, not on land/beach/neighborhood.

COORDINATE VALIDATION RULES:
1) Australian east coast = positive longitude (150-155)
2) Florida Atlantic coast = negative longitude around -80.4 to -80.7
3) Pacific islands (Hawaii) = negative longitude around -155 to -160
4) Indonesia = positive longitude around 114-117
5) Western Europe (France/Portugal/Spain) = negative longitude around -1 to -9
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestPrecisionCoordinateFix:
    """Test precision coordinate fixes for surf spots"""
    
    # =========================================================================
    # TOTAL SPOT COUNT
    # =========================================================================
    def test_total_spot_count_389(self):
        """Verify total spots is 389"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        data = response.json()
        spots = data.get('spots', data) if isinstance(data, dict) else data
        total = len(spots)
        print(f"Total spots: {total}")
        assert total >= 389, f"Expected at least 389 spots, got {total}"
    
    # =========================================================================
    # HAWAII - Negative longitude around -155 to -160
    # =========================================================================
    def test_pipeline_hawaii_coordinates(self):
        """Pipeline Hawaii: 21.664, -158.054 (offshore reef)"""
        response = requests.get(f"{BASE_URL}/api/surf-spots", params={"search": "Pipeline"})
        assert response.status_code == 200
        data = response.json()
        spots = data.get('spots', data) if isinstance(data, dict) else data
        
        pipeline = None
        for spot in spots:
            if spot.get('name') == 'Pipeline' and spot.get('country') == 'USA':
                pipeline = spot
                break
        
        assert pipeline is not None, "Pipeline spot not found"
        lat = float(pipeline.get('latitude', 0))
        lon = float(pipeline.get('longitude', 0))
        
        print(f"Pipeline: ({lat}, {lon})")
        # Verify offshore reef coordinates
        assert abs(lat - 21.664) < 0.01, f"Pipeline latitude should be ~21.664, got {lat}"
        assert abs(lon - (-158.054)) < 0.01, f"Pipeline longitude should be ~-158.054, got {lon}"
        # Hawaii should have negative longitude
        assert lon < 0, f"Hawaii longitude should be negative, got {lon}"
    
    # =========================================================================
    # INDONESIA - Positive longitude around 114-117
    # =========================================================================
    def test_uluwatu_bali_coordinates(self):
        """Uluwatu Bali: -8.8166, 115.0862 (offshore reef)"""
        response = requests.get(f"{BASE_URL}/api/surf-spots", params={"search": "Uluwatu"})
        assert response.status_code == 200
        data = response.json()
        spots = data.get('spots', data) if isinstance(data, dict) else data
        
        uluwatu = None
        for spot in spots:
            if 'Uluwatu' in spot.get('name', ''):
                uluwatu = spot
                break
        
        assert uluwatu is not None, "Uluwatu spot not found"
        lat = float(uluwatu.get('latitude', 0))
        lon = float(uluwatu.get('longitude', 0))
        
        print(f"Uluwatu: ({lat}, {lon})")
        # Verify offshore reef coordinates
        assert abs(lat - (-8.8166)) < 0.01, f"Uluwatu latitude should be ~-8.8166, got {lat}"
        assert abs(lon - 115.0862) < 0.01, f"Uluwatu longitude should be ~115.0862, got {lon}"
        # Indonesia should have positive longitude
        assert lon > 0, f"Indonesia longitude should be positive, got {lon}"
        assert 114 <= lon <= 117, f"Indonesia longitude should be 114-117, got {lon}"
    
    # =========================================================================
    # AUSTRALIA - Positive longitude (east coast ~150-155)
    # =========================================================================
    def test_bells_beach_australia_coordinates(self):
        """Bells Beach Australia: -38.3718, 144.281 (positive longitude for east coast)"""
        response = requests.get(f"{BASE_URL}/api/surf-spots", params={"search": "Bells Beach"})
        assert response.status_code == 200
        data = response.json()
        spots = data.get('spots', data) if isinstance(data, dict) else data
        
        bells = None
        for spot in spots:
            if 'Bells Beach' in spot.get('name', ''):
                bells = spot
                break
        
        assert bells is not None, "Bells Beach spot not found"
        lat = float(bells.get('latitude', 0))
        lon = float(bells.get('longitude', 0))
        
        print(f"Bells Beach: ({lat}, {lon})")
        # Bells Beach is in Victoria, Australia - longitude should be positive
        assert lon > 0, f"Australian longitude should be positive, got {lon}"
        # Victoria coast is around 144-145
        assert 140 <= lon <= 155, f"Australian longitude should be 140-155, got {lon}"
    
    def test_snapper_rocks_gold_coast_coordinates(self):
        """Snapper Rocks Gold Coast: -28.1625, 153.55 (Superbank start)"""
        response = requests.get(f"{BASE_URL}/api/surf-spots", params={"search": "Snapper"})
        assert response.status_code == 200
        data = response.json()
        spots = data.get('spots', data) if isinstance(data, dict) else data
        
        snapper = None
        for spot in spots:
            if 'Snapper' in spot.get('name', ''):
                snapper = spot
                break
        
        assert snapper is not None, "Snapper Rocks spot not found"
        lat = float(snapper.get('latitude', 0))
        lon = float(snapper.get('longitude', 0))
        
        print(f"Snapper Rocks: ({lat}, {lon})")
        # Gold Coast is around 153-154 longitude
        assert lon > 0, f"Australian longitude should be positive, got {lon}"
        assert 150 <= lon <= 155, f"Gold Coast longitude should be 150-155, got {lon}"
        assert abs(lat - (-28.1625)) < 0.01, f"Snapper latitude should be ~-28.1625, got {lat}"
    
    def test_all_australian_spots_positive_longitude(self):
        """All Australian spots should have positive longitude (east coast)"""
        response = requests.get(f"{BASE_URL}/api/surf-spots", params={"country": "Australia"})
        assert response.status_code == 200
        data = response.json()
        spots = data.get('spots', data) if isinstance(data, dict) else data
        
        negative_lon_spots = []
        for spot in spots:
            lon = float(spot.get('longitude', 0))
            if lon < 0:
                negative_lon_spots.append(f"{spot.get('name')}: {lon}")
        
        print(f"Australian spots with negative longitude: {negative_lon_spots}")
        assert len(negative_lon_spots) == 0, f"Australian spots should have positive longitude: {negative_lon_spots}"
    
    # =========================================================================
    # FRANCE - Negative longitude around -1 to -9
    # =========================================================================
    def test_hossegor_la_graviere_france_coordinates(self):
        """Hossegor La Graviere France: 43.68, -1.439 (offshore beach break)"""
        response = requests.get(f"{BASE_URL}/api/surf-spots", params={"search": "Hossegor"})
        assert response.status_code == 200
        data = response.json()
        spots = data.get('spots', data) if isinstance(data, dict) else data
        
        hossegor = None
        for spot in spots:
            name = spot.get('name', '')
            if 'Hossegor' in name or 'Gravière' in name or 'Graviere' in name:
                hossegor = spot
                break
        
        if hossegor is None:
            # Try broader search
            response = requests.get(f"{BASE_URL}/api/surf-spots", params={"country": "France"})
            data = response.json()
            spots = data.get('spots', data) if isinstance(data, dict) else data
            for spot in spots:
                name = spot.get('name', '')
                if 'Hossegor' in name or 'Gravière' in name or 'Graviere' in name:
                    hossegor = spot
                    break
        
        assert hossegor is not None, "Hossegor La Graviere spot not found"
        lat = float(hossegor.get('latitude', 0))
        lon = float(hossegor.get('longitude', 0))
        
        print(f"Hossegor: ({lat}, {lon})")
        # France Atlantic coast should have negative longitude
        assert lon < 0, f"France Atlantic coast longitude should be negative, got {lon}"
        assert -10 <= lon <= 0, f"France longitude should be -10 to 0, got {lon}"
    
    # =========================================================================
    # PORTUGAL - Negative longitude around -9
    # =========================================================================
    def test_nazare_portugal_coordinates(self):
        """Nazaré Portugal: 39.605, -9.085 (big wave canyon)"""
        response = requests.get(f"{BASE_URL}/api/surf-spots", params={"search": "Nazare"})
        assert response.status_code == 200
        data = response.json()
        spots = data.get('spots', data) if isinstance(data, dict) else data
        
        nazare = None
        for spot in spots:
            name = spot.get('name', '')
            if 'Nazaré' in name or 'Nazare' in name:
                nazare = spot
                break
        
        if nazare is None:
            # Try broader search
            response = requests.get(f"{BASE_URL}/api/surf-spots", params={"country": "Portugal"})
            data = response.json()
            spots = data.get('spots', data) if isinstance(data, dict) else data
            for spot in spots:
                name = spot.get('name', '')
                if 'Nazaré' in name or 'Nazare' in name:
                    nazare = spot
                    break
        
        assert nazare is not None, "Nazare spot not found"
        lat = float(nazare.get('latitude', 0))
        lon = float(nazare.get('longitude', 0))
        
        print(f"Nazare: ({lat}, {lon})")
        # Portugal should have negative longitude
        assert lon < 0, f"Portugal longitude should be negative, got {lon}"
        assert abs(lon - (-9.085)) < 0.1, f"Nazare longitude should be ~-9.085, got {lon}"
    
    # =========================================================================
    # FLORIDA - Negative longitude around -80.4 to -80.7
    # =========================================================================
    def test_sebastian_inlet_florida_coordinates(self):
        """Sebastian Inlet Florida: 27.8562, -80.4417 (First Peak)"""
        response = requests.get(f"{BASE_URL}/api/surf-spots", params={"search": "Sebastian"})
        assert response.status_code == 200
        data = response.json()
        spots = data.get('spots', data) if isinstance(data, dict) else data
        
        sebastian = None
        for spot in spots:
            if 'Sebastian' in spot.get('name', ''):
                sebastian = spot
                break
        
        assert sebastian is not None, "Sebastian Inlet spot not found"
        lat = float(sebastian.get('latitude', 0))
        lon = float(sebastian.get('longitude', 0))
        
        print(f"Sebastian Inlet: ({lat}, {lon})")
        # Florida Atlantic coast should have negative longitude around -80.4 to -80.7
        assert lon < 0, f"Florida longitude should be negative, got {lon}"
        assert -81 <= lon <= -80, f"Florida longitude should be -81 to -80, got {lon}"
        assert abs(lat - 27.8562) < 0.01, f"Sebastian latitude should be ~27.8562, got {lat}"
        assert abs(lon - (-80.4417)) < 0.01, f"Sebastian longitude should be ~-80.4417, got {lon}"
    
    def test_cocoa_beach_pier_florida_coordinates(self):
        """Cocoa Beach Pier Florida: 28.3676, -80.6012 (NOAA verified)"""
        response = requests.get(f"{BASE_URL}/api/surf-spots", params={"search": "Cocoa Beach"})
        assert response.status_code == 200
        data = response.json()
        spots = data.get('spots', data) if isinstance(data, dict) else data
        
        cocoa = None
        for spot in spots:
            if 'Cocoa Beach Pier' in spot.get('name', ''):
                cocoa = spot
                break
        
        assert cocoa is not None, "Cocoa Beach Pier spot not found"
        lat = float(cocoa.get('latitude', 0))
        lon = float(cocoa.get('longitude', 0))
        
        print(f"Cocoa Beach Pier: ({lat}, {lon})")
        assert abs(lat - 28.3676) < 0.01, f"Cocoa Beach latitude should be ~28.3676, got {lat}"
        assert abs(lon - (-80.6012)) < 0.01, f"Cocoa Beach longitude should be ~-80.6012, got {lon}"
    
    def test_jetty_park_florida_coordinates(self):
        """Jetty Park Florida: 28.4061, -80.589 (North Jetty tip)"""
        response = requests.get(f"{BASE_URL}/api/surf-spots", params={"search": "Jetty Park"})
        assert response.status_code == 200
        data = response.json()
        spots = data.get('spots', data) if isinstance(data, dict) else data
        
        jetty = None
        for spot in spots:
            if 'Jetty Park' in spot.get('name', ''):
                jetty = spot
                break
        
        assert jetty is not None, "Jetty Park spot not found"
        lat = float(jetty.get('latitude', 0))
        lon = float(jetty.get('longitude', 0))
        
        print(f"Jetty Park: ({lat}, {lon})")
        assert abs(lat - 28.4061) < 0.01, f"Jetty Park latitude should be ~28.4061, got {lat}"
        assert abs(lon - (-80.589)) < 0.01, f"Jetty Park longitude should be ~-80.589, got {lon}"
    
    # =========================================================================
    # PERU - Negative longitude around -79
    # =========================================================================
    def test_chicama_peru_coordinates(self):
        """Chicama Peru: -7.71, -79.455 (world's longest left)"""
        response = requests.get(f"{BASE_URL}/api/surf-spots", params={"search": "Chicama"})
        assert response.status_code == 200
        data = response.json()
        spots = data.get('spots', data) if isinstance(data, dict) else data
        
        chicama = None
        for spot in spots:
            if 'Chicama' in spot.get('name', ''):
                chicama = spot
                break
        
        assert chicama is not None, "Chicama spot not found"
        lat = float(chicama.get('latitude', 0))
        lon = float(chicama.get('longitude', 0))
        
        print(f"Chicama: ({lat}, {lon})")
        # Peru should have negative longitude
        assert lon < 0, f"Peru longitude should be negative, got {lon}"
        assert abs(lat - (-7.71)) < 0.1, f"Chicama latitude should be ~-7.71, got {lat}"
        assert abs(lon - (-79.455)) < 0.1, f"Chicama longitude should be ~-79.455, got {lon}"
    
    # =========================================================================
    # CHILE - Negative longitude around -72
    # =========================================================================
    def test_punta_de_lobos_chile_coordinates(self):
        """Punta de Lobos Chile: -34.428, -72.04 (big wave point)"""
        response = requests.get(f"{BASE_URL}/api/surf-spots", params={"search": "Punta de Lobos"})
        assert response.status_code == 200
        data = response.json()
        spots = data.get('spots', data) if isinstance(data, dict) else data
        
        punta = None
        for spot in spots:
            if 'Punta de Lobos' in spot.get('name', '') or 'Lobos' in spot.get('name', ''):
                punta = spot
                break
        
        assert punta is not None, "Punta de Lobos spot not found"
        lat = float(punta.get('latitude', 0))
        lon = float(punta.get('longitude', 0))
        
        print(f"Punta de Lobos: ({lat}, {lon})")
        # Chile should have negative longitude
        assert lon < 0, f"Chile longitude should be negative, got {lon}"
        assert abs(lat - (-34.428)) < 0.1, f"Punta de Lobos latitude should be ~-34.428, got {lat}"
        assert abs(lon - (-72.04)) < 0.1, f"Punta de Lobos longitude should be ~-72.04, got {lon}"
    
    # =========================================================================
    # TOTAL SPOT COUNT VERIFICATION
    # =========================================================================
    def test_spot_count_at_least_389(self):
        """Verify total spots is at least 389"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        data = response.json()
        spots = data.get('spots', data) if isinstance(data, dict) else data
        total = len(spots)
        print(f"Total spots in database: {total}")
        assert total >= 389, f"Expected at least 389 spots, got {total}"
    
    # =========================================================================
    # COORDINATE VALIDATION - FLORIDA SPOTS OFFSHORE
    # =========================================================================
    def test_florida_spots_offshore_longitude(self):
        """Florida Atlantic coast spots should have longitude around -80.0 to -81.5"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        data = response.json()
        spots = data.get('spots', data) if isinstance(data, dict) else data
        
        # Filter to only Florida spots
        florida_spots = [s for s in spots if s.get('state_province') == 'Florida']
        
        issues = []
        for spot in florida_spots:
            lon = float(spot.get('longitude', 0))
            lat = float(spot.get('latitude', 0))
            name = spot.get('name', '')
            
            # Florida Atlantic coast should be -80.0 to -81.5
            if lon > -79.5 or lon < -82.0:
                issues.append(f"{name}: lon={lon}")
        
        print(f"Florida spots count: {len(florida_spots)}")
        print(f"Florida spots with potential issues: {issues}")
        # Allow some tolerance for edge cases
        assert len(issues) <= 5, f"Too many Florida spots with wrong longitude: {issues}"
    
    def test_hawaii_spots_negative_longitude(self):
        """Hawaii spots should have negative longitude around -155 to -160"""
        response = requests.get(f"{BASE_URL}/api/surf-spots", params={"search": "Hawaii"})
        if response.status_code != 200:
            response = requests.get(f"{BASE_URL}/api/surf-spots")
        
        data = response.json()
        spots = data.get('spots', data) if isinstance(data, dict) else data
        
        hawaii_spots = [s for s in spots if s.get('region', '').lower() == 'hawaii' or 
                        s.get('state_province', '').lower() == 'hawaii' or
                        'hawaii' in s.get('name', '').lower()]
        
        issues = []
        for spot in hawaii_spots:
            lon = float(spot.get('longitude', 0))
            name = spot.get('name', '')
            
            if lon > 0:  # Hawaii should have negative longitude
                issues.append(f"{name}: lon={lon}")
        
        print(f"Hawaii spots with positive longitude (wrong): {issues}")
        assert len(issues) == 0, f"Hawaii spots should have negative longitude: {issues}"


class TestRegionalCoordinateValidation:
    """Test coordinate validation by region"""
    
    def test_indonesia_positive_longitude(self):
        """Indonesia spots should have positive longitude (114-117)"""
        response = requests.get(f"{BASE_URL}/api/surf-spots", params={"country": "Indonesia"})
        assert response.status_code == 200
        data = response.json()
        spots = data.get('spots', data) if isinstance(data, dict) else data
        
        issues = []
        for spot in spots:
            lon = float(spot.get('longitude', 0))
            name = spot.get('name', '')
            
            if lon < 0:  # Indonesia should have positive longitude
                issues.append(f"{name}: lon={lon}")
        
        print(f"Indonesia spots with negative longitude (wrong): {issues}")
        assert len(issues) == 0, f"Indonesia spots should have positive longitude: {issues}"
    
    def test_western_europe_negative_longitude(self):
        """Western Europe (France/Portugal/Spain) should have negative longitude"""
        countries = ['France', 'Portugal', 'Spain']
        
        for country in countries:
            response = requests.get(f"{BASE_URL}/api/surf-spots", params={"country": country})
            if response.status_code != 200:
                continue
            
            data = response.json()
            spots = data.get('spots', data) if isinstance(data, dict) else data
            
            issues = []
            for spot in spots:
                lon = float(spot.get('longitude', 0))
                name = spot.get('name', '')
                
                # Atlantic coast of Western Europe should have negative longitude
                if lon > 0:
                    issues.append(f"{name}: lon={lon}")
            
            print(f"{country} spots with positive longitude: {issues}")
            # Allow some tolerance for Mediterranean spots
            assert len(issues) <= 2, f"{country} Atlantic coast spots should have negative longitude: {issues}"


@pytest.fixture
def api_client():
    """Shared requests session"""
    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})
    return session
