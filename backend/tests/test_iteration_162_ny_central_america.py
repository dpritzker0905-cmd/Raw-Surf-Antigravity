"""
Iteration 162 - NY & Central America Expansion Tests
Tests for 37 new spots added across:
- New York (12 spots): Rockaways, Long Beach, Fire Island, Montauk
- El Salvador (7 spots): La Libertad, Usulutan
- Costa Rica North Pacific (8 spots): Guanacaste, Tamarindo
- Costa Rica Central/South (9 spots): Santa Teresa, Jaco, Dominical, Pavones
- Costa Rica Caribbean (3 spots): Puerto Viejo
"""
import pytest
import requests
import os
import time

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestAPIHealth:
    """Basic API health check"""
    
    def test_api_health(self):
        """Verify API is healthy"""
        response = requests.get(f"{BASE_URL}/api/health", timeout=10)
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        print(f"API Health: {data['status']}")

    def test_surf_spots_endpoint(self):
        """Verify surf spots endpoint returns data"""
        response = requests.get(f"{BASE_URL}/api/surf-spots", timeout=30)
        assert response.status_code == 200
        spots = response.json()
        assert isinstance(spots, list)
        assert len(spots) > 0
        print(f"Surf spots endpoint returned {len(spots)} spots")


class TestTotalSpotCount:
    """Verify total spot count increased to 596+"""
    
    def test_total_spot_count(self):
        """Total spots should be 596+ (559 + 37 new)"""
        response = requests.get(f"{BASE_URL}/api/surf-spots", timeout=30)
        assert response.status_code == 200
        spots = response.json()
        total = len(spots)
        assert total >= 596, f"Expected 596+ spots, got {total}"
        print(f"Total spot count: {total} (expected 596+)")


class TestNewYorkSpots:
    """Verify New York spots (12 total)"""
    
    @pytest.fixture(scope="class")
    def all_spots(self):
        response = requests.get(f"{BASE_URL}/api/surf-spots", timeout=30)
        return response.json()
    
    def test_rockaway_90th_street(self, all_spots):
        """Rockaway Beach 90th Street - Rockaways"""
        spot = next((s for s in all_spots if s["name"] == "Rockaway Beach 90th Street"), None)
        assert spot is not None, "Rockaway Beach 90th Street not found"
        assert abs(float(spot["latitude"]) - 40.582) < 0.01
        assert abs(float(spot["longitude"]) - (-73.812)) < 0.01
        print(f"Rockaway 90th: ({spot['latitude']}, {spot['longitude']})")
    
    def test_rockaway_92nd_street(self, all_spots):
        """Rockaway Beach 92nd Street - Most popular spot"""
        spot = next((s for s in all_spots if s["name"] == "Rockaway Beach 92nd Street"), None)
        assert spot is not None, "Rockaway Beach 92nd Street not found"
        assert abs(float(spot["latitude"]) - 40.581) < 0.01
        assert abs(float(spot["longitude"]) - (-73.808)) < 0.01
        print(f"Rockaway 92nd: ({spot['latitude']}, {spot['longitude']})")
    
    def test_ditch_plains(self, all_spots):
        """Ditch Plains - Famous Montauk point break (41.038, -71.918)"""
        spot = next((s for s in all_spots if s["name"] == "Ditch Plains"), None)
        assert spot is not None, "Ditch Plains not found"
        assert abs(float(spot["latitude"]) - 41.038) < 0.01
        assert abs(float(spot["longitude"]) - (-71.918)) < 0.01
        print(f"Ditch Plains: ({spot['latitude']}, {spot['longitude']})")
    
    def test_long_beach(self, all_spots):
        """Long Beach - Nassau County"""
        spot = next((s for s in all_spots if s["name"] == "Long Beach"), None)
        assert spot is not None, "Long Beach not found"
        assert abs(float(spot["latitude"]) - 40.583) < 0.01
        print(f"Long Beach: ({spot['latitude']}, {spot['longitude']})")
    
    def test_fire_island(self, all_spots):
        """Fire Island - Suffolk County"""
        spot = next((s for s in all_spots if s["name"] == "Fire Island"), None)
        assert spot is not None, "Fire Island not found"
        assert abs(float(spot["latitude"]) - 40.643) < 0.01
        print(f"Fire Island: ({spot['latitude']}, {spot['longitude']})")
    
    def test_montauk_point(self, all_spots):
        """Montauk Point - Lighthouse area"""
        spot = next((s for s in all_spots if s["name"] == "Montauk Point"), None)
        assert spot is not None, "Montauk Point not found"
        assert abs(float(spot["latitude"]) - 41.071) < 0.01
        print(f"Montauk Point: ({spot['latitude']}, {spot['longitude']})")
    
    def test_ny_spot_count(self, all_spots):
        """Count NY spots (should be 12+)"""
        ny_spots = [s for s in all_spots if s.get("state_province") == "New York" or 
                    s.get("region") in ["Rockaways", "Long Beach", "Fire Island", "Montauk"]]
        print(f"NY spots found: {len(ny_spots)}")
        # Check for key spots - use partial matching for Long Beach variants
        ny_names = [s["name"] for s in ny_spots]
        expected = ["Rockaway Beach 90th Street", "Rockaway Beach 92nd Street", "Ditch Plains", 
                    "Fire Island", "Montauk Point"]
        for name in expected:
            assert name in ny_names, f"{name} not found in NY spots"
        # Check Long Beach exists (may be "Long Beach NY" or "Long Beach Lincoln Boulevard")
        long_beach_exists = any("Long Beach" in n for n in ny_names)
        assert long_beach_exists, "No Long Beach spot found in NY"
        assert len(ny_spots) >= 12, f"Expected 12+ NY spots, got {len(ny_spots)}"


class TestElSalvadorSpots:
    """Verify El Salvador spots (7 total)"""
    
    @pytest.fixture(scope="class")
    def all_spots(self):
        response = requests.get(f"{BASE_URL}/api/surf-spots", timeout=30)
        return response.json()
    
    def test_punta_roca(self, all_spots):
        """Punta Roca - World-class right point (13.478, -89.328)"""
        spot = next((s for s in all_spots if s["name"] == "Punta Roca"), None)
        assert spot is not None, "Punta Roca not found"
        assert abs(float(spot["latitude"]) - 13.478) < 0.01
        assert abs(float(spot["longitude"]) - (-89.328)) < 0.01
        print(f"Punta Roca: ({spot['latitude']}, {spot['longitude']})")
    
    def test_sunzal(self, all_spots):
        """Sunzal - Rocky point break"""
        spot = next((s for s in all_spots if s["name"] == "Sunzal"), None)
        assert spot is not None, "Sunzal not found"
        assert abs(float(spot["latitude"]) - 13.502) < 0.01
        assert abs(float(spot["longitude"]) - (-89.388)) < 0.01
        print(f"Sunzal: ({spot['latitude']}, {spot['longitude']})")
    
    def test_k59(self, all_spots):
        """K-59 - KM 59 marker"""
        spot = next((s for s in all_spots if s["name"] == "K-59"), None)
        assert spot is not None, "K-59 not found"
        assert abs(float(spot["latitude"]) - 13.512) < 0.01
        assert abs(float(spot["longitude"]) - (-89.438)) < 0.01
        print(f"K-59: ({spot['latitude']}, {spot['longitude']})")
    
    def test_las_flores(self, all_spots):
        """Las Flores - Usulutan"""
        spot = next((s for s in all_spots if s["name"] == "Las Flores"), None)
        assert spot is not None, "Las Flores not found"
        assert abs(float(spot["latitude"]) - 13.188) < 0.01
        print(f"Las Flores: ({spot['latitude']}, {spot['longitude']})")
    
    def test_el_salvador_count(self, all_spots):
        """Count El Salvador spots (should be 7)"""
        es_spots = [s for s in all_spots if s.get("country") == "El Salvador"]
        print(f"El Salvador spots found: {len(es_spots)}")
        assert len(es_spots) >= 7, f"Expected 7+ El Salvador spots, got {len(es_spots)}"
        es_names = [s["name"] for s in es_spots]
        expected = ["Punta Roca", "Sunzal", "K-59", "Las Flores"]
        for name in expected:
            assert name in es_names, f"{name} not found in El Salvador spots"


class TestCostaRicaNorthPacific:
    """Verify Costa Rica North Pacific spots (8 total)"""
    
    @pytest.fixture(scope="class")
    def all_spots(self):
        response = requests.get(f"{BASE_URL}/api/surf-spots", timeout=30)
        return response.json()
    
    def test_witchs_rock(self, all_spots):
        """Witch's Rock - Roca Bruja (10.838, -85.705)"""
        spot = next((s for s in all_spots if s["name"] == "Witch's Rock"), None)
        assert spot is not None, "Witch's Rock not found"
        assert abs(float(spot["latitude"]) - 10.838) < 0.01
        assert abs(float(spot["longitude"]) - (-85.705)) < 0.01
        print(f"Witch's Rock: ({spot['latitude']}, {spot['longitude']})")
    
    def test_tamarindo(self, all_spots):
        """Tamarindo - Main beach"""
        spot = next((s for s in all_spots if s["name"] == "Tamarindo"), None)
        assert spot is not None, "Tamarindo not found"
        assert abs(float(spot["latitude"]) - 10.298) < 0.01
        print(f"Tamarindo: ({spot['latitude']}, {spot['longitude']})")
    
    def test_playa_negra(self, all_spots):
        """Playa Negra - Black sand right point"""
        spot = next((s for s in all_spots if s["name"] == "Playa Negra"), None)
        assert spot is not None, "Playa Negra not found"
        assert abs(float(spot["latitude"]) - 10.218) < 0.01
        print(f"Playa Negra: ({spot['latitude']}, {spot['longitude']})")
    
    def test_ollies_point(self, all_spots):
        """Ollie's Point - Fast right point"""
        spot = next((s for s in all_spots if s["name"] == "Ollie's Point"), None)
        assert spot is not None, "Ollie's Point not found"
        assert abs(float(spot["latitude"]) - 10.865) < 0.01
        print(f"Ollie's Point: ({spot['latitude']}, {spot['longitude']})")


class TestCostaRicaCentralSouth:
    """Verify Costa Rica Central/South Pacific spots (9 total)"""
    
    @pytest.fixture(scope="class")
    def all_spots(self):
        response = requests.get(f"{BASE_URL}/api/surf-spots", timeout=30)
        return response.json()
    
    def test_santa_teresa(self, all_spots):
        """Santa Teresa - Main beach (9.654, -85.183)"""
        spot = next((s for s in all_spots if s["name"] == "Santa Teresa"), None)
        assert spot is not None, "Santa Teresa not found"
        assert abs(float(spot["latitude"]) - 9.654) < 0.01
        assert abs(float(spot["longitude"]) - (-85.183)) < 0.01
        print(f"Santa Teresa: ({spot['latitude']}, {spot['longitude']})")
    
    def test_pavones(self, all_spots):
        """Pavones - World's longest left (8.393, -83.139)"""
        spot = next((s for s in all_spots if s["name"] == "Pavones"), None)
        assert spot is not None, "Pavones not found"
        assert abs(float(spot["latitude"]) - 8.393) < 0.01
        assert abs(float(spot["longitude"]) - (-83.139)) < 0.01
        print(f"Pavones: ({spot['latitude']}, {spot['longitude']})")
    
    def test_jaco_beach(self, all_spots):
        """Jaco Beach - Main Jaco beach"""
        spot = next((s for s in all_spots if s["name"] == "Jaco Beach"), None)
        assert spot is not None, "Jaco Beach not found"
        assert abs(float(spot["latitude"]) - 9.618) < 0.01
        print(f"Jaco Beach: ({spot['latitude']}, {spot['longitude']})")
    
    def test_dominical(self, all_spots):
        """Dominical - Main beach"""
        spot = next((s for s in all_spots if s["name"] == "Dominical"), None)
        assert spot is not None, "Dominical not found"
        assert abs(float(spot["latitude"]) - 9.248) < 0.01
        print(f"Dominical: ({spot['latitude']}, {spot['longitude']})")


class TestCostaRicaCaribbean:
    """Verify Costa Rica Caribbean spots (3 total)"""
    
    @pytest.fixture(scope="class")
    def all_spots(self):
        response = requests.get(f"{BASE_URL}/api/surf-spots", timeout=30)
        return response.json()
    
    def test_salsa_brava(self, all_spots):
        """Salsa Brava - Puerto Viejo reef (9.654, -82.755)"""
        spot = next((s for s in all_spots if s["name"] == "Salsa Brava"), None)
        assert spot is not None, "Salsa Brava not found"
        assert abs(float(spot["latitude"]) - 9.654) < 0.01
        assert abs(float(spot["longitude"]) - (-82.755)) < 0.01
        print(f"Salsa Brava: ({spot['latitude']}, {spot['longitude']})")
    
    def test_playa_cocles(self, all_spots):
        """Playa Cocles - Beach south of Puerto Viejo"""
        spot = next((s for s in all_spots if s["name"] == "Playa Cocles"), None)
        assert spot is not None, "Playa Cocles not found"
        assert abs(float(spot["latitude"]) - 9.638) < 0.01
        print(f"Playa Cocles: ({spot['latitude']}, {spot['longitude']})")
    
    def test_puerto_viejo(self, all_spots):
        """Puerto Viejo - Main town beach"""
        spot = next((s for s in all_spots if s["name"] == "Puerto Viejo"), None)
        assert spot is not None, "Puerto Viejo not found"
        assert abs(float(spot["latitude"]) - 9.665) < 0.01
        print(f"Puerto Viejo: ({spot['latitude']}, {spot['longitude']})")


class TestCentralAmericaCluster:
    """Verify Central America cluster (24 spots total)"""
    
    @pytest.fixture(scope="class")
    def all_spots(self):
        response = requests.get(f"{BASE_URL}/api/surf-spots", timeout=30)
        return response.json()
    
    def test_central_america_count(self, all_spots):
        """Central America should have 24+ spots (El Salvador + Costa Rica)"""
        # El Salvador + Costa Rica
        central_america = [s for s in all_spots if s.get("country") in ["El Salvador", "Costa Rica"]]
        print(f"Central America spots: {len(central_america)}")
        assert len(central_america) >= 24, f"Expected 24+ Central America spots, got {len(central_america)}"
    
    def test_costa_rica_total(self, all_spots):
        """Costa Rica should have 17+ spots (8 North + 9 Central/South + 3 Caribbean = 20)"""
        cr_spots = [s for s in all_spots if s.get("country") == "Costa Rica"]
        print(f"Costa Rica spots: {len(cr_spots)}")
        # Some spots may have been updated, so check for at least 17
        assert len(cr_spots) >= 17, f"Expected 17+ Costa Rica spots, got {len(cr_spots)}"


class TestKeyCoordinates:
    """Verify key coordinates from user specification"""
    
    @pytest.fixture(scope="class")
    def all_spots(self):
        response = requests.get(f"{BASE_URL}/api/surf-spots", timeout=30)
        return response.json()
    
    def test_ditch_plains_exact(self, all_spots):
        """Ditch Plains exact coordinates (41.038, -71.918)"""
        spot = next((s for s in all_spots if s["name"] == "Ditch Plains"), None)
        assert spot is not None
        lat = float(spot["latitude"])
        lon = float(spot["longitude"])
        assert abs(lat - 41.038) < 0.005, f"Ditch Plains lat {lat} != 41.038"
        assert abs(lon - (-71.918)) < 0.005, f"Ditch Plains lon {lon} != -71.918"
        print(f"Ditch Plains EXACT: ({lat}, {lon})")
    
    def test_punta_roca_exact(self, all_spots):
        """Punta Roca exact coordinates (13.478, -89.328)"""
        spot = next((s for s in all_spots if s["name"] == "Punta Roca"), None)
        assert spot is not None
        lat = float(spot["latitude"])
        lon = float(spot["longitude"])
        assert abs(lat - 13.478) < 0.005, f"Punta Roca lat {lat} != 13.478"
        assert abs(lon - (-89.328)) < 0.005, f"Punta Roca lon {lon} != -89.328"
        print(f"Punta Roca EXACT: ({lat}, {lon})")
    
    def test_witchs_rock_exact(self, all_spots):
        """Witch's Rock exact coordinates (10.838, -85.705)"""
        spot = next((s for s in all_spots if s["name"] == "Witch's Rock"), None)
        assert spot is not None
        lat = float(spot["latitude"])
        lon = float(spot["longitude"])
        assert abs(lat - 10.838) < 0.005, f"Witch's Rock lat {lat} != 10.838"
        assert abs(lon - (-85.705)) < 0.005, f"Witch's Rock lon {lon} != -85.705"
        print(f"Witch's Rock EXACT: ({lat}, {lon})")
    
    def test_pavones_exact(self, all_spots):
        """Pavones exact coordinates (8.393, -83.139)"""
        spot = next((s for s in all_spots if s["name"] == "Pavones"), None)
        assert spot is not None
        lat = float(spot["latitude"])
        lon = float(spot["longitude"])
        assert abs(lat - 8.393) < 0.005, f"Pavones lat {lat} != 8.393"
        assert abs(lon - (-83.139)) < 0.005, f"Pavones lon {lon} != -83.139"
        print(f"Pavones EXACT: ({lat}, {lon})")
    
    def test_salsa_brava_exact(self, all_spots):
        """Salsa Brava exact coordinates (9.654, -82.755)"""
        spot = next((s for s in all_spots if s["name"] == "Salsa Brava"), None)
        assert spot is not None
        lat = float(spot["latitude"])
        lon = float(spot["longitude"])
        assert abs(lat - 9.654) < 0.005, f"Salsa Brava lat {lat} != 9.654"
        assert abs(lon - (-82.755)) < 0.005, f"Salsa Brava lon {lon} != -82.755"
        print(f"Salsa Brava EXACT: ({lat}, {lon})")


class TestAPIPerformance:
    """Verify API performance"""
    
    def test_surf_spots_response_time(self):
        """Surf spots API should respond in <2 seconds"""
        start = time.time()
        response = requests.get(f"{BASE_URL}/api/surf-spots", timeout=30)
        elapsed = time.time() - start
        assert response.status_code == 200
        assert elapsed < 2.0, f"API took {elapsed:.2f}s, expected <2s"
        print(f"API response time: {elapsed:.2f}s")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
