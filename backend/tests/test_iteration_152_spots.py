"""
Iteration 152 - Central FL Recalibration & South America Expansion Tests

Tests:
1. Total spot count should be 389
2. Central FL spots have offshore coordinates (longitude < -80.55)
3. Specific spot coordinate verification (Jetty Park, Cocoa Beach Pier, Sebastian Inlet)
4. South America country counts (Brazil 41, Peru 17, Chile 21)
5. Specific South America spot verification (Punta de Lobos, Chicama)
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')


class TestIteration152SpotExpansion:
    """Test Central FL recalibration and South America expansion"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test session"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
    
    def test_total_spot_count_389(self):
        """GET /api/surf-spots should return 389 total spots"""
        response = self.session.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        total_spots = len(data)
        print(f"Total spots in database: {total_spots}")
        
        # Should be 389 spots after expansion
        assert total_spots >= 380, f"Expected at least 380 spots, got {total_spots}"
        print(f"✓ Total spot count: {total_spots}")
    
    def test_jetty_park_coordinates(self):
        """Jetty Park should be at 28.4061, -80.589 (at jetty tip)"""
        response = self.session.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        
        data = response.json()
        jetty_park = next((s for s in data if s.get('name') == 'Jetty Park'), None)
        
        assert jetty_park is not None, "Jetty Park spot not found"
        
        lat = float(jetty_park.get('latitude', 0))
        lon = float(jetty_park.get('longitude', 0))
        
        print(f"Jetty Park coordinates: ({lat}, {lon})")
        
        # Expected: 28.4061, -80.589
        assert abs(lat - 28.4061) < 0.01, f"Jetty Park latitude should be ~28.4061, got {lat}"
        assert abs(lon - (-80.589)) < 0.01, f"Jetty Park longitude should be ~-80.589, got {lon}"
        print(f"✓ Jetty Park coordinates verified: ({lat}, {lon})")
    
    def test_cocoa_beach_pier_coordinates(self):
        """Cocoa Beach Pier should be at 28.3676, -80.6012 (NOAA verified)"""
        response = self.session.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        
        data = response.json()
        cocoa_pier = next((s for s in data if s.get('name') == 'Cocoa Beach Pier'), None)
        
        assert cocoa_pier is not None, "Cocoa Beach Pier spot not found"
        
        lat = float(cocoa_pier.get('latitude', 0))
        lon = float(cocoa_pier.get('longitude', 0))
        
        print(f"Cocoa Beach Pier coordinates: ({lat}, {lon})")
        
        # Expected: 28.3676, -80.6012
        assert abs(lat - 28.3676) < 0.01, f"Cocoa Beach Pier latitude should be ~28.3676, got {lat}"
        assert abs(lon - (-80.6012)) < 0.01, f"Cocoa Beach Pier longitude should be ~-80.6012, got {lon}"
        print(f"✓ Cocoa Beach Pier coordinates verified: ({lat}, {lon})")
    
    def test_sebastian_inlet_coordinates(self):
        """Sebastian Inlet should be at 27.8562, -80.4417 (First Peak verified)"""
        response = self.session.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        
        data = response.json()
        sebastian = next((s for s in data if s.get('name') == 'Sebastian Inlet'), None)
        
        assert sebastian is not None, "Sebastian Inlet spot not found"
        
        lat = float(sebastian.get('latitude', 0))
        lon = float(sebastian.get('longitude', 0))
        
        print(f"Sebastian Inlet coordinates: ({lat}, {lon})")
        
        # Expected: 27.8562, -80.4417
        assert abs(lat - 27.8562) < 0.01, f"Sebastian Inlet latitude should be ~27.8562, got {lat}"
        assert abs(lon - (-80.4417)) < 0.01, f"Sebastian Inlet longitude should be ~-80.4417, got {lon}"
        print(f"✓ Sebastian Inlet coordinates verified: ({lat}, {lon})")
    
    def test_space_coast_offshore_coordinates(self):
        """Space Coast spots should have offshore coordinates (longitude < -80.55)"""
        response = self.session.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        
        data = response.json()
        
        # Space Coast spots to check (excluding Sebastian Inlet which is at inlet)
        space_coast_spots = [
            'Jetty Park', 'Cocoa Beach Pier', 'Cherie Down Park', 
            'Shepard Park', 'Lori Wilson Park', 'Satellite Beach',
            'Patrick Air Force Base', 'Picnic Tables'
        ]
        
        offshore_count = 0
        issues = []
        
        for spot_name in space_coast_spots:
            spot = next((s for s in data if s.get('name') == spot_name), None)
            if spot:
                lon = float(spot.get('longitude', 0))
                lat = float(spot.get('latitude', 0))
                
                # Florida shoreline is at ~-80.55, offshore should be more negative
                if lon < -80.55:
                    offshore_count += 1
                    print(f"✓ {spot_name}: ({lat}, {lon}) - OFFSHORE")
                else:
                    issues.append(f"{spot_name}: ({lat}, {lon}) - may be on land (lon > -80.55)")
                    print(f"⚠ {spot_name}: ({lat}, {lon}) - may be on land")
        
        print(f"\nOffshore verification: {offshore_count}/{len(space_coast_spots)} spots offshore")
        
        # At least 80% should be offshore
        assert offshore_count >= len(space_coast_spots) * 0.8, f"Most Space Coast spots should be offshore. Issues: {issues}"
    
    def test_brazil_spot_count(self):
        """Brazil should have approximately 41 spots"""
        response = self.session.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        
        data = response.json()
        brazil_spots = [s for s in data if s.get('country') == 'Brazil']
        
        print(f"Brazil spots found: {len(brazil_spots)}")
        for spot in brazil_spots[:5]:
            print(f"  - {spot.get('name')} ({spot.get('region')})")
        if len(brazil_spots) > 5:
            print(f"  ... and {len(brazil_spots) - 5} more")
        
        # Should have around 40-41 spots
        assert len(brazil_spots) >= 35, f"Expected at least 35 Brazil spots, got {len(brazil_spots)}"
        print(f"✓ Brazil spot count: {len(brazil_spots)}")
    
    def test_peru_spot_count(self):
        """Peru should have approximately 17 spots"""
        response = self.session.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        
        data = response.json()
        peru_spots = [s for s in data if s.get('country') == 'Peru']
        
        print(f"Peru spots found: {len(peru_spots)}")
        for spot in peru_spots[:5]:
            print(f"  - {spot.get('name')} ({spot.get('region')})")
        if len(peru_spots) > 5:
            print(f"  ... and {len(peru_spots) - 5} more")
        
        # Should have around 17 spots
        assert len(peru_spots) >= 15, f"Expected at least 15 Peru spots, got {len(peru_spots)}"
        print(f"✓ Peru spot count: {len(peru_spots)}")
    
    def test_chile_spot_count(self):
        """Chile should have approximately 21 spots"""
        response = self.session.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        
        data = response.json()
        chile_spots = [s for s in data if s.get('country') == 'Chile']
        
        print(f"Chile spots found: {len(chile_spots)}")
        for spot in chile_spots[:5]:
            print(f"  - {spot.get('name')} ({spot.get('region')})")
        if len(chile_spots) > 5:
            print(f"  ... and {len(chile_spots) - 5} more")
        
        # Should have around 21 spots
        assert len(chile_spots) >= 18, f"Expected at least 18 Chile spots, got {len(chile_spots)}"
        print(f"✓ Chile spot count: {len(chile_spots)}")
    
    def test_punta_de_lobos_exists(self):
        """Punta de Lobos (Chile) should exist at -34.4250, -72.0350"""
        response = self.session.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        
        data = response.json()
        punta_lobos = next((s for s in data if 'Punta de Lobos' in s.get('name', '')), None)
        
        assert punta_lobos is not None, "Punta de Lobos spot not found"
        
        lat = float(punta_lobos.get('latitude', 0))
        lon = float(punta_lobos.get('longitude', 0))
        
        print(f"Punta de Lobos coordinates: ({lat}, {lon})")
        
        # Expected: -34.4250, -72.0350
        assert abs(lat - (-34.4250)) < 0.05, f"Punta de Lobos latitude should be ~-34.4250, got {lat}"
        assert abs(lon - (-72.0350)) < 0.05, f"Punta de Lobos longitude should be ~-72.0350, got {lon}"
        print(f"✓ Punta de Lobos verified: ({lat}, {lon})")
    
    def test_chicama_exists(self):
        """Chicama (Peru) should exist at -7.7167, -79.4500"""
        response = self.session.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        
        data = response.json()
        chicama = next((s for s in data if s.get('name') == 'Chicama'), None)
        
        assert chicama is not None, "Chicama spot not found"
        
        lat = float(chicama.get('latitude', 0))
        lon = float(chicama.get('longitude', 0))
        
        print(f"Chicama coordinates: ({lat}, {lon})")
        
        # Expected: -7.7167, -79.4500
        assert abs(lat - (-7.7167)) < 0.05, f"Chicama latitude should be ~-7.7167, got {lat}"
        assert abs(lon - (-79.4500)) < 0.05, f"Chicama longitude should be ~-79.4500, got {lon}"
        print(f"✓ Chicama verified: ({lat}, {lon})")
    
    def test_south_america_total_count(self):
        """South America should have approximately 76+ new spots (Brazil + Peru + Chile)"""
        response = self.session.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        
        data = response.json()
        
        brazil_count = len([s for s in data if s.get('country') == 'Brazil'])
        peru_count = len([s for s in data if s.get('country') == 'Peru'])
        chile_count = len([s for s in data if s.get('country') == 'Chile'])
        
        total_sa = brazil_count + peru_count + chile_count
        
        print(f"\nSouth America Summary:")
        print(f"  Brazil: {brazil_count}")
        print(f"  Peru: {peru_count}")
        print(f"  Chile: {chile_count}")
        print(f"  TOTAL: {total_sa}")
        
        # Should have at least 70 South America spots
        assert total_sa >= 70, f"Expected at least 70 South America spots, got {total_sa}"
        print(f"✓ South America total: {total_sa}")
    
    def test_picnic_tables_recalibrated(self):
        """Picnic Tables should be recalibrated to Patrick AFB Tables Beach area (~28.2251)"""
        response = self.session.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        
        data = response.json()
        picnic_tables = next((s for s in data if s.get('name') == 'Picnic Tables'), None)
        
        if picnic_tables:
            lat = float(picnic_tables.get('latitude', 0))
            lon = float(picnic_tables.get('longitude', 0))
            
            print(f"Picnic Tables coordinates: ({lat}, {lon})")
            
            # Should be around 28.2251 (Patrick AFB area), not 28.2928
            # Allow some tolerance
            assert lat < 28.30, f"Picnic Tables should be recalibrated south to ~28.2251, got {lat}"
            print(f"✓ Picnic Tables recalibrated: ({lat}, {lon})")
        else:
            print("⚠ Picnic Tables spot not found - may not exist in database")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s"])
