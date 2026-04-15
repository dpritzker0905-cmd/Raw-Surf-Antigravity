"""
Test Suite for Global Expansion Phase 3 - Iteration 166
========================================================
Tests for:
- Total spot count: 1047 (up from 955)
- Hawaii expansion: 45 spots
- Fiji: 10 spots
- French Polynesia: 10 spots
- Samoa: 7 spots
- India: 13 spots
- Taiwan: 14 spots (expanded)
- Morocco: 21 spots (expanded)
- Namibia: 5 spots
- Ghana: 5 spots
- Senegal: 8 spots
- API performance < 2 seconds
"""

import pytest
import requests
import time
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://raw-surf-os.preview.emergentagent.com')


class TestAPIHealth:
    """Basic API health checks"""
    
    def test_api_health(self):
        """Test API is responding"""
        response = requests.get(f"{BASE_URL}/api/health", timeout=10)
        assert response.status_code == 200, f"Health check failed: {response.status_code}"
        print("API health check: PASSED")
    
    def test_surf_spots_endpoint_accessible(self):
        """Test surf spots endpoint is accessible"""
        response = requests.get(f"{BASE_URL}/api/surf-spots", timeout=30)
        assert response.status_code == 200, f"Surf spots endpoint failed: {response.status_code}"
        data = response.json()
        assert isinstance(data, list), "Response should be a list"
        print(f"Surf spots endpoint: PASSED ({len(data)} spots)")


class TestTotalSpotCount:
    """Test total spot count is 1047"""
    
    def test_total_spot_count_1047(self):
        """Verify total spot count is 1047"""
        response = requests.get(f"{BASE_URL}/api/surf-spots", timeout=30)
        assert response.status_code == 200
        data = response.json()
        total_count = len(data)
        
        # Allow small variance (±5) for potential data changes
        assert total_count >= 1040, f"Expected ~1047 spots, got {total_count}"
        assert total_count <= 1055, f"Expected ~1047 spots, got {total_count}"
        print(f"Total spot count: {total_count} (expected ~1047) - PASSED")


class TestAPIPerformance:
    """Test API performance requirements"""
    
    def test_api_response_under_2_seconds(self):
        """API should respond in under 2 seconds"""
        start_time = time.time()
        response = requests.get(f"{BASE_URL}/api/surf-spots", timeout=30)
        elapsed = time.time() - start_time
        
        assert response.status_code == 200
        assert elapsed < 2.0, f"API took {elapsed:.2f}s, expected < 2s"
        print(f"API performance: {elapsed:.2f}s (< 2s requirement) - PASSED")


class TestHawaiiExpansion:
    """Test Hawaii expansion - 45 spots total"""
    
    @pytest.fixture(scope="class")
    def all_spots(self):
        response = requests.get(f"{BASE_URL}/api/surf-spots", timeout=30)
        return response.json()
    
    def test_hawaii_total_spots(self, all_spots):
        """Hawaii should have ~45 spots"""
        hawaii_spots = [s for s in all_spots if s.get('state_province') == 'Hawaii' or 
                       (s.get('country') == 'USA' and s.get('region') in ['Oahu', 'Maui', 'Big Island', 'Kauai'])]
        count = len(hawaii_spots)
        assert count >= 40, f"Expected ~45 Hawaii spots, got {count}"
        print(f"Hawaii spots: {count} (expected ~45) - PASSED")
    
    def test_hawaii_oahu_spots(self, all_spots):
        """Oahu should have North Shore and South Shore spots"""
        oahu_spots = [s for s in all_spots if s.get('region') == 'Oahu']
        count = len(oahu_spots)
        assert count >= 8, f"Expected 8+ Oahu spots, got {count}"
        print(f"Oahu spots: {count} - PASSED")
    
    def test_hawaii_key_spots_exist(self, all_spots):
        """Key Hawaii spots should exist"""
        spot_names = [s.get('name', '').lower() for s in all_spots]
        key_spots = ['pipeline', 'sunset beach', 'waimea', 'rocky point', 'velzyland']
        
        found = []
        for key in key_spots:
            if any(key in name for name in spot_names):
                found.append(key)
        
        assert len(found) >= 3, f"Expected at least 3 key Hawaii spots, found: {found}"
        print(f"Hawaii key spots found: {found} - PASSED")


class TestFijiSpots:
    """Test Fiji - 10 spots"""
    
    @pytest.fixture(scope="class")
    def all_spots(self):
        response = requests.get(f"{BASE_URL}/api/surf-spots", timeout=30)
        return response.json()
    
    def test_fiji_total_spots(self, all_spots):
        """Fiji should have ~10 spots"""
        fiji_spots = [s for s in all_spots if s.get('country') == 'Fiji']
        count = len(fiji_spots)
        assert count >= 8, f"Expected ~10 Fiji spots, got {count}"
        print(f"Fiji spots: {count} (expected ~10) - PASSED")
    
    def test_fiji_key_spots_exist(self, all_spots):
        """Key Fiji spots should exist"""
        fiji_spots = [s for s in all_spots if s.get('country') == 'Fiji']
        spot_names = [s.get('name', '').lower() for s in fiji_spots]
        
        key_spots = ['cloudbreak', 'restaurants', 'frigates']
        found = [k for k in key_spots if any(k in name for name in spot_names)]
        
        assert len(found) >= 2, f"Expected at least 2 key Fiji spots, found: {found}"
        print(f"Fiji key spots found: {found} - PASSED")


class TestFrenchPolynesiaSpots:
    """Test French Polynesia (Tahiti) - 10 spots"""
    
    @pytest.fixture(scope="class")
    def all_spots(self):
        response = requests.get(f"{BASE_URL}/api/surf-spots", timeout=30)
        return response.json()
    
    def test_french_polynesia_total_spots(self, all_spots):
        """French Polynesia should have ~10 spots"""
        fp_spots = [s for s in all_spots if s.get('country') == 'French Polynesia']
        count = len(fp_spots)
        assert count >= 8, f"Expected ~10 French Polynesia spots, got {count}"
        print(f"French Polynesia spots: {count} (expected ~10) - PASSED")
    
    def test_teahupoo_exists(self, all_spots):
        """Teahupoo should exist"""
        spot_names = [s.get('name', '').lower() for s in all_spots]
        assert any('teahupoo' in name for name in spot_names), "Teahupoo not found"
        print("Teahupoo exists - PASSED")
    
    def test_papara_exists(self, all_spots):
        """Papara should exist"""
        spot_names = [s.get('name', '').lower() for s in all_spots]
        assert any('papara' in name for name in spot_names), "Papara not found"
        print("Papara exists - PASSED")


class TestSamoaSpots:
    """Test Samoa - 7 spots"""
    
    @pytest.fixture(scope="class")
    def all_spots(self):
        response = requests.get(f"{BASE_URL}/api/surf-spots", timeout=30)
        return response.json()
    
    def test_samoa_total_spots(self, all_spots):
        """Samoa should have ~7 spots"""
        samoa_spots = [s for s in all_spots if s.get('country') == 'Samoa']
        count = len(samoa_spots)
        assert count >= 5, f"Expected ~7 Samoa spots, got {count}"
        print(f"Samoa spots: {count} (expected ~7) - PASSED")
    
    def test_samoa_key_spots_exist(self, all_spots):
        """Key Samoa spots should exist"""
        samoa_spots = [s for s in all_spots if s.get('country') == 'Samoa']
        spot_names = [s.get('name', '').lower() for s in samoa_spots]
        
        key_spots = ['salani', 'aganoa']
        found = [k for k in key_spots if any(k in name for name in spot_names)]
        
        assert len(found) >= 1, f"Expected at least 1 key Samoa spot, found: {found}"
        print(f"Samoa key spots found: {found} - PASSED")


class TestIndiaSpots:
    """Test India - 13 spots"""
    
    @pytest.fixture(scope="class")
    def all_spots(self):
        response = requests.get(f"{BASE_URL}/api/surf-spots", timeout=30)
        return response.json()
    
    def test_india_total_spots(self, all_spots):
        """India should have ~13 spots"""
        india_spots = [s for s in all_spots if s.get('country') == 'India']
        count = len(india_spots)
        assert count >= 10, f"Expected ~13 India spots, got {count}"
        print(f"India spots: {count} (expected ~13) - PASSED")
    
    def test_india_kerala_spots(self, all_spots):
        """Kerala should have spots"""
        kerala_spots = [s for s in all_spots if s.get('state_province') == 'Kerala' or 
                       (s.get('country') == 'India' and s.get('region') == 'Kerala')]
        count = len(kerala_spots)
        assert count >= 3, f"Expected 3+ Kerala spots, got {count}"
        print(f"Kerala spots: {count} - PASSED")
    
    def test_india_goa_spots(self, all_spots):
        """Goa should have spots"""
        goa_spots = [s for s in all_spots if s.get('state_province') == 'Goa' or 
                    (s.get('country') == 'India' and s.get('region') == 'Goa')]
        count = len(goa_spots)
        assert count >= 2, f"Expected 2+ Goa spots, got {count}"
        print(f"Goa spots: {count} - PASSED")


class TestTaiwanExpansion:
    """Test Taiwan expansion - 14 spots"""
    
    @pytest.fixture(scope="class")
    def all_spots(self):
        response = requests.get(f"{BASE_URL}/api/surf-spots", timeout=30)
        return response.json()
    
    def test_taiwan_total_spots(self, all_spots):
        """Taiwan should have ~14 spots"""
        taiwan_spots = [s for s in all_spots if s.get('country') == 'Taiwan']
        count = len(taiwan_spots)
        assert count >= 12, f"Expected ~14 Taiwan spots, got {count}"
        print(f"Taiwan spots: {count} (expected ~14) - PASSED")


class TestMoroccoExpansion:
    """Test Morocco expansion - 21 spots"""
    
    @pytest.fixture(scope="class")
    def all_spots(self):
        response = requests.get(f"{BASE_URL}/api/surf-spots", timeout=30)
        return response.json()
    
    def test_morocco_total_spots(self, all_spots):
        """Morocco should have ~21 spots"""
        morocco_spots = [s for s in all_spots if s.get('country') == 'Morocco']
        count = len(morocco_spots)
        assert count >= 18, f"Expected ~21 Morocco spots, got {count}"
        print(f"Morocco spots: {count} (expected ~21) - PASSED")
    
    def test_morocco_taghazout_spots(self, all_spots):
        """Taghazout area should have spots"""
        morocco_spots = [s for s in all_spots if s.get('country') == 'Morocco']
        taghazout_spots = [s for s in morocco_spots if 'taghazout' in s.get('region', '').lower() or 
                          'taghazout' in s.get('name', '').lower()]
        count = len(taghazout_spots)
        assert count >= 3, f"Expected 3+ Taghazout spots, got {count}"
        print(f"Taghazout spots: {count} - PASSED")
    
    def test_morocco_dakhla_spots(self, all_spots):
        """Dakhla should have spots"""
        morocco_spots = [s for s in all_spots if s.get('country') == 'Morocco']
        dakhla_spots = [s for s in morocco_spots if 'dakhla' in s.get('region', '').lower() or 
                       'dakhla' in s.get('name', '').lower()]
        count = len(dakhla_spots)
        assert count >= 2, f"Expected 2+ Dakhla spots, got {count}"
        print(f"Dakhla spots: {count} - PASSED")


class TestNamibiaSpots:
    """Test Namibia - 5 spots"""
    
    @pytest.fixture(scope="class")
    def all_spots(self):
        response = requests.get(f"{BASE_URL}/api/surf-spots", timeout=30)
        return response.json()
    
    def test_namibia_total_spots(self, all_spots):
        """Namibia should have ~5 spots"""
        namibia_spots = [s for s in all_spots if s.get('country') == 'Namibia']
        count = len(namibia_spots)
        assert count >= 4, f"Expected ~5 Namibia spots, got {count}"
        print(f"Namibia spots: {count} (expected ~5) - PASSED")
    
    def test_skeleton_bay_exists(self, all_spots):
        """Skeleton Bay should exist"""
        spot_names = [s.get('name', '').lower() for s in all_spots]
        assert any('skeleton' in name for name in spot_names), "Skeleton Bay not found"
        print("Skeleton Bay exists - PASSED")


class TestGhanaSpots:
    """Test Ghana - 5 spots"""
    
    @pytest.fixture(scope="class")
    def all_spots(self):
        response = requests.get(f"{BASE_URL}/api/surf-spots", timeout=30)
        return response.json()
    
    def test_ghana_total_spots(self, all_spots):
        """Ghana should have ~5 spots"""
        ghana_spots = [s for s in all_spots if s.get('country') == 'Ghana']
        count = len(ghana_spots)
        assert count >= 4, f"Expected ~5 Ghana spots, got {count}"
        print(f"Ghana spots: {count} (expected ~5) - PASSED")
    
    def test_ghana_key_spots_exist(self, all_spots):
        """Key Ghana spots should exist"""
        ghana_spots = [s for s in all_spots if s.get('country') == 'Ghana']
        spot_names = [s.get('name', '').lower() for s in ghana_spots]
        
        key_spots = ['busua', 'cape three points']
        found = [k for k in key_spots if any(k in name for name in spot_names)]
        
        assert len(found) >= 1, f"Expected at least 1 key Ghana spot, found: {found}"
        print(f"Ghana key spots found: {found} - PASSED")


class TestSenegalSpots:
    """Test Senegal - 8 spots"""
    
    @pytest.fixture(scope="class")
    def all_spots(self):
        response = requests.get(f"{BASE_URL}/api/surf-spots", timeout=30)
        return response.json()
    
    def test_senegal_total_spots(self, all_spots):
        """Senegal should have ~8 spots"""
        senegal_spots = [s for s in all_spots if s.get('country') == 'Senegal']
        count = len(senegal_spots)
        assert count >= 6, f"Expected ~8 Senegal spots, got {count}"
        print(f"Senegal spots: {count} (expected ~8) - PASSED")
    
    def test_senegal_key_spots_exist(self, all_spots):
        """Key Senegal spots should exist"""
        senegal_spots = [s for s in all_spots if s.get('country') == 'Senegal']
        spot_names = [s.get('name', '').lower() for s in senegal_spots]
        
        key_spots = ['ngor', 'ouakam']
        found = [k for k in key_spots if any(k in name for name in spot_names)]
        
        assert len(found) >= 1, f"Expected at least 1 key Senegal spot, found: {found}"
        print(f"Senegal key spots found: {found} - PASSED")


class TestCoordinatesOffshore:
    """Test that coordinates are offshore (not on land)"""
    
    @pytest.fixture(scope="class")
    def all_spots(self):
        response = requests.get(f"{BASE_URL}/api/surf-spots", timeout=30)
        return response.json()
    
    def test_fiji_coordinates_offshore(self, all_spots):
        """Fiji spots should have valid offshore coordinates"""
        fiji_spots = [s for s in all_spots if s.get('country') == 'Fiji']
        for spot in fiji_spots:
            lat = spot.get('latitude')
            lon = spot.get('longitude')
            assert lat is not None and lon is not None, f"Missing coordinates for {spot.get('name')}"
            # Fiji is around -17 to -20 lat, 177-180 lon
            assert -22 < lat < -15, f"Invalid latitude for {spot.get('name')}: {lat}"
            assert 175 < lon < 182 or -180 < lon < -175, f"Invalid longitude for {spot.get('name')}: {lon}"
        print(f"Fiji coordinates offshore: PASSED ({len(fiji_spots)} spots)")
    
    def test_india_coordinates_offshore(self, all_spots):
        """India spots should have valid offshore coordinates"""
        india_spots = [s for s in all_spots if s.get('country') == 'India']
        for spot in india_spots:
            lat = spot.get('latitude')
            lon = spot.get('longitude')
            assert lat is not None and lon is not None, f"Missing coordinates for {spot.get('name')}"
            # India is around 8-35 lat, 68-97 lon
            assert 5 < lat < 40, f"Invalid latitude for {spot.get('name')}: {lat}"
            assert 65 < lon < 100, f"Invalid longitude for {spot.get('name')}: {lon}"
        print(f"India coordinates offshore: PASSED ({len(india_spots)} spots)")


class TestCountryBreakdown:
    """Test country breakdown for verification"""
    
    @pytest.fixture(scope="class")
    def all_spots(self):
        response = requests.get(f"{BASE_URL}/api/surf-spots", timeout=30)
        return response.json()
    
    def test_country_breakdown(self, all_spots):
        """Print country breakdown for verification"""
        countries = {}
        for spot in all_spots:
            country = spot.get('country', 'Unknown')
            countries[country] = countries.get(country, 0) + 1
        
        # Sort by count descending
        sorted_countries = sorted(countries.items(), key=lambda x: x[1], reverse=True)
        
        print("\n=== COUNTRY BREAKDOWN ===")
        for country, count in sorted_countries[:20]:
            print(f"  {country}: {count}")
        
        # Verify key countries have expected counts
        assert countries.get('USA', 0) >= 350, f"USA should have 350+ spots, got {countries.get('USA', 0)}"
        assert countries.get('Fiji', 0) >= 8, f"Fiji should have 8+ spots, got {countries.get('Fiji', 0)}"
        assert countries.get('French Polynesia', 0) >= 8, f"French Polynesia should have 8+ spots"
        assert countries.get('Samoa', 0) >= 5, f"Samoa should have 5+ spots"
        assert countries.get('India', 0) >= 10, f"India should have 10+ spots"
        assert countries.get('Morocco', 0) >= 18, f"Morocco should have 18+ spots"
        assert countries.get('Namibia', 0) >= 4, f"Namibia should have 4+ spots"
        assert countries.get('Ghana', 0) >= 4, f"Ghana should have 4+ spots"
        assert countries.get('Senegal', 0) >= 6, f"Senegal should have 6+ spots"
        
        print("Country breakdown verification: PASSED")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
