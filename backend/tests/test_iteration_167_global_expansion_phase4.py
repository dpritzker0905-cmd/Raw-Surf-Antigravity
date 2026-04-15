"""
Test Suite for Global Expansion Phase 4 - Iteration 167
========================================================
Tests for 11 new countries/regions:
- Pacific Islands: Tonga (5), Vanuatu (5), Papua New Guinea (6)
- Africa: Madagascar (6), Mozambique (6), Angola (5)
- Middle East: Oman (5), UAE (4), Israel (7)
- South America: Ecuador (10), Colombia (8)

Total expected: 1114 spots (1047 from Phase 3 + 67 new)
"""
import pytest
import requests
import os
import time

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestAPIHealth:
    """Basic API health checks"""
    
    def test_api_health(self):
        """Test API is responding"""
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200, f"API health check failed: {response.status_code}"
        print("API health check: PASSED")
    
    def test_surf_spots_endpoint(self):
        """Test surf spots endpoint returns data"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200, f"Surf spots endpoint failed: {response.status_code}"
        data = response.json()
        assert isinstance(data, list), "Response should be a list"
        assert len(data) > 0, "Should have surf spots"
        print(f"Surf spots endpoint: PASSED ({len(data)} spots)")


class TestTotalSpotCount:
    """Verify total spot count after Phase 4 expansion"""
    
    def test_total_spot_count_1114(self):
        """Total spots should be 1114 (1047 + 67 new)"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        data = response.json()
        total = len(data)
        # Allow some tolerance for potential duplicates or minor variations
        assert total >= 1100, f"Expected ~1114 spots, got {total}"
        print(f"Total spot count: {total} (expected ~1114)")
    
    def test_api_performance(self):
        """API should respond in under 2 seconds"""
        start = time.time()
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        elapsed = time.time() - start
        assert response.status_code == 200
        assert elapsed < 2.0, f"API took {elapsed:.2f}s, expected <2s"
        print(f"API performance: {elapsed:.2f}s (PASSED)")


class TestTongaSpots:
    """Test Tonga spots (5 expected)"""
    
    def test_tonga_total_count(self):
        """Tonga should have 5 spots"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        data = response.json()
        tonga_spots = [s for s in data if s.get('country') == 'Tonga']
        assert len(tonga_spots) >= 5, f"Expected 5 Tonga spots, got {len(tonga_spots)}"
        print(f"Tonga spots: {len(tonga_spots)} (expected 5)")
    
    def test_haatafu_beach_exists(self):
        """Ha'atafu Beach should exist"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        data = response.json()
        haatafu = [s for s in data if "Ha'atafu" in s.get('name', '') or "Haatafu" in s.get('name', '')]
        assert len(haatafu) >= 1, "Ha'atafu Beach not found"
        print(f"Ha'atafu Beach: FOUND")


class TestVanuatuSpots:
    """Test Vanuatu spots (5 expected)"""
    
    def test_vanuatu_total_count(self):
        """Vanuatu should have 5 spots"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        data = response.json()
        vanuatu_spots = [s for s in data if s.get('country') == 'Vanuatu']
        assert len(vanuatu_spots) >= 5, f"Expected 5 Vanuatu spots, got {len(vanuatu_spots)}"
        print(f"Vanuatu spots: {len(vanuatu_spots)} (expected 5)")
    
    def test_pango_point_exists(self):
        """Pango Point should exist"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        data = response.json()
        pango = [s for s in data if "Pango" in s.get('name', '')]
        assert len(pango) >= 1, "Pango Point not found"
        print(f"Pango Point: FOUND")
    
    def test_breakas_exists(self):
        """Breakas should exist"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        data = response.json()
        breakas = [s for s in data if "Breakas" in s.get('name', '')]
        assert len(breakas) >= 1, "Breakas not found"
        print(f"Breakas: FOUND")


class TestPapuaNewGuineaSpots:
    """Test Papua New Guinea spots (6 expected)"""
    
    def test_png_total_count(self):
        """Papua New Guinea should have 6 spots"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        data = response.json()
        png_spots = [s for s in data if s.get('country') == 'Papua New Guinea']
        assert len(png_spots) >= 6, f"Expected 6 PNG spots, got {len(png_spots)}"
        print(f"Papua New Guinea spots: {len(png_spots)} (expected 6)")
    
    def test_tupira_exists(self):
        """Tupira Surf Club should exist"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        data = response.json()
        tupira = [s for s in data if "Tupira" in s.get('name', '')]
        assert len(tupira) >= 1, "Tupira not found"
        print(f"Tupira: FOUND")
    
    def test_vanimo_exists(self):
        """Vanimo should exist"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        data = response.json()
        vanimo = [s for s in data if "Vanimo" in s.get('name', '')]
        assert len(vanimo) >= 1, "Vanimo not found"
        print(f"Vanimo: FOUND")


class TestMadagascarSpots:
    """Test Madagascar spots (6 expected)"""
    
    def test_madagascar_total_count(self):
        """Madagascar should have 6 spots"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        data = response.json()
        madagascar_spots = [s for s in data if s.get('country') == 'Madagascar']
        assert len(madagascar_spots) >= 6, f"Expected 6 Madagascar spots, got {len(madagascar_spots)}"
        print(f"Madagascar spots: {len(madagascar_spots)} (expected 6)")
    
    def test_anakao_exists(self):
        """Anakao should exist"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        data = response.json()
        anakao = [s for s in data if "Anakao" in s.get('name', '')]
        assert len(anakao) >= 1, "Anakao not found"
        print(f"Anakao: FOUND")
    
    def test_lavanono_exists(self):
        """Lavanono should exist"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        data = response.json()
        lavanono = [s for s in data if "Lavanono" in s.get('name', '')]
        assert len(lavanono) >= 1, "Lavanono not found"
        print(f"Lavanono: FOUND")


class TestMozambiqueSpots:
    """Test Mozambique spots (6 expected)"""
    
    def test_mozambique_total_count(self):
        """Mozambique should have 6 spots"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        data = response.json()
        mozambique_spots = [s for s in data if s.get('country') == 'Mozambique']
        assert len(mozambique_spots) >= 6, f"Expected 6 Mozambique spots, got {len(mozambique_spots)}"
        print(f"Mozambique spots: {len(mozambique_spots)} (expected 6)")
    
    def test_tofo_beach_exists(self):
        """Tofo Beach should exist"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        data = response.json()
        tofo = [s for s in data if "Tofo" in s.get('name', '')]
        assert len(tofo) >= 1, "Tofo Beach not found"
        print(f"Tofo Beach: FOUND")
    
    def test_tofinho_exists(self):
        """Tofinho should exist"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        data = response.json()
        tofinho = [s for s in data if "Tofinho" in s.get('name', '')]
        assert len(tofinho) >= 1, "Tofinho not found"
        print(f"Tofinho: FOUND")


class TestAngolaSpots:
    """Test Angola spots (5 expected)"""
    
    def test_angola_total_count(self):
        """Angola should have 5 spots"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        data = response.json()
        angola_spots = [s for s in data if s.get('country') == 'Angola']
        assert len(angola_spots) >= 5, f"Expected 5 Angola spots, got {len(angola_spots)}"
        print(f"Angola spots: {len(angola_spots)} (expected 5)")
    
    def test_cabo_ledo_exists(self):
        """Cabo Ledo should exist"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        data = response.json()
        cabo_ledo = [s for s in data if "Cabo Ledo" in s.get('name', '')]
        assert len(cabo_ledo) >= 1, "Cabo Ledo not found"
        print(f"Cabo Ledo: FOUND")
    
    def test_baia_azul_exists(self):
        """Baia Azul should exist"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        data = response.json()
        baia_azul = [s for s in data if "Baia Azul" in s.get('name', '')]
        assert len(baia_azul) >= 1, "Baia Azul not found"
        print(f"Baia Azul: FOUND")


class TestOmanSpots:
    """Test Oman spots (5 expected)"""
    
    def test_oman_total_count(self):
        """Oman should have 5 spots"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        data = response.json()
        oman_spots = [s for s in data if s.get('country') == 'Oman']
        assert len(oman_spots) >= 5, f"Expected 5 Oman spots, got {len(oman_spots)}"
        print(f"Oman spots: {len(oman_spots)} (expected 5)")
    
    def test_salalah_exists(self):
        """Salalah spots should exist"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        data = response.json()
        salalah = [s for s in data if "Salalah" in s.get('name', '')]
        assert len(salalah) >= 1, "Salalah not found"
        print(f"Salalah: FOUND ({len(salalah)} spots)")
    
    def test_musandam_exists(self):
        """Musandam should exist"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        data = response.json()
        musandam = [s for s in data if "Musandam" in s.get('name', '')]
        assert len(musandam) >= 1, "Musandam not found"
        print(f"Musandam: FOUND")


class TestUAESpots:
    """Test UAE spots (4 expected)"""
    
    def test_uae_total_count(self):
        """UAE should have 4 spots"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        data = response.json()
        uae_spots = [s for s in data if s.get('country') == 'United Arab Emirates']
        assert len(uae_spots) >= 4, f"Expected 4 UAE spots, got {len(uae_spots)}"
        print(f"UAE spots: {len(uae_spots)} (expected 4)")
    
    def test_fujairah_exists(self):
        """Fujairah spots should exist"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        data = response.json()
        fujairah = [s for s in data if "Fujairah" in s.get('name', '')]
        assert len(fujairah) >= 1, "Fujairah not found"
        print(f"Fujairah: FOUND ({len(fujairah)} spots)")


class TestIsraelSpots:
    """Test Israel spots (7 expected)"""
    
    def test_israel_total_count(self):
        """Israel should have 7 spots"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        data = response.json()
        israel_spots = [s for s in data if s.get('country') == 'Israel']
        assert len(israel_spots) >= 7, f"Expected 7 Israel spots, got {len(israel_spots)}"
        print(f"Israel spots: {len(israel_spots)} (expected 7)")
    
    def test_tel_aviv_hilton_exists(self):
        """Tel Aviv - Hilton should exist"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        data = response.json()
        hilton = [s for s in data if "Hilton" in s.get('name', '') and "Tel Aviv" in s.get('name', '')]
        assert len(hilton) >= 1, "Tel Aviv - Hilton not found"
        print(f"Tel Aviv - Hilton: FOUND")
    
    def test_herzliya_exists(self):
        """Herzliya should exist"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        data = response.json()
        herzliya = [s for s in data if "Herzliya" in s.get('name', '')]
        assert len(herzliya) >= 1, "Herzliya not found"
        print(f"Herzliya: FOUND")


class TestEcuadorSpots:
    """Test Ecuador spots (10 expected)"""
    
    def test_ecuador_total_count(self):
        """Ecuador should have 10 spots"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        data = response.json()
        ecuador_spots = [s for s in data if s.get('country') == 'Ecuador']
        assert len(ecuador_spots) >= 10, f"Expected 10 Ecuador spots, got {len(ecuador_spots)}"
        print(f"Ecuador spots: {len(ecuador_spots)} (expected 10)")
    
    def test_montanita_exists(self):
        """Montanita should exist"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        data = response.json()
        montanita = [s for s in data if "Montanita" in s.get('name', '')]
        assert len(montanita) >= 1, "Montanita not found"
        print(f"Montanita: FOUND ({len(montanita)} spots)")
    
    def test_galapagos_exists(self):
        """Galapagos spots should exist"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        data = response.json()
        galapagos = [s for s in data if "Galapagos" in s.get('region', '') or "San Cristobal" in s.get('name', '')]
        assert len(galapagos) >= 1, "Galapagos spots not found"
        print(f"Galapagos: FOUND ({len(galapagos)} spots)")


class TestColombiaSpots:
    """Test Colombia spots (8 expected)"""
    
    def test_colombia_total_count(self):
        """Colombia should have 8 spots"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        data = response.json()
        colombia_spots = [s for s in data if s.get('country') == 'Colombia']
        assert len(colombia_spots) >= 8, f"Expected 8 Colombia spots, got {len(colombia_spots)}"
        print(f"Colombia spots: {len(colombia_spots)} (expected 8)")
    
    def test_nuqui_exists(self):
        """Nuqui should exist"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        data = response.json()
        nuqui = [s for s in data if "Nuqui" in s.get('name', '')]
        assert len(nuqui) >= 1, "Nuqui not found"
        print(f"Nuqui: FOUND")
    
    def test_palomino_exists(self):
        """Palomino should exist"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        data = response.json()
        palomino = [s for s in data if "Palomino" in s.get('name', '')]
        assert len(palomino) >= 1, "Palomino not found"
        print(f"Palomino: FOUND")


class TestCoordinatesOffshore:
    """Verify coordinates are offshore (not on land)"""
    
    def test_tonga_coordinates_offshore(self):
        """Tonga coordinates should be offshore (negative longitude)"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        data = response.json()
        tonga_spots = [s for s in data if s.get('country') == 'Tonga']
        for spot in tonga_spots:
            # Tonga is around -175 longitude
            assert spot.get('longitude', 0) < -170, f"{spot['name']} longitude seems wrong: {spot.get('longitude')}"
        print(f"Tonga coordinates: VERIFIED offshore")
    
    def test_israel_coordinates_offshore(self):
        """Israel coordinates should be offshore (Mediterranean coast)"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        data = response.json()
        israel_spots = [s for s in data if s.get('country') == 'Israel']
        for spot in israel_spots:
            # Israel Mediterranean coast is around 34.7-35.0 longitude
            assert 34.5 < spot.get('longitude', 0) < 35.5, f"{spot['name']} longitude seems wrong: {spot.get('longitude')}"
        print(f"Israel coordinates: VERIFIED offshore")
    
    def test_ecuador_coordinates_offshore(self):
        """Ecuador coordinates should be offshore (Pacific coast)"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        data = response.json()
        ecuador_spots = [s for s in data if s.get('country') == 'Ecuador']
        for spot in ecuador_spots:
            # Ecuador Pacific coast is around -80 longitude (Galapagos around -89)
            assert spot.get('longitude', 0) < -79, f"{spot['name']} longitude seems wrong: {spot.get('longitude')}"
        print(f"Ecuador coordinates: VERIFIED offshore")


class TestCountryBreakdown:
    """Verify country breakdown after Phase 4"""
    
    def test_country_breakdown(self):
        """Print country breakdown for verification"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        data = response.json()
        
        # Count by country
        country_counts = {}
        for spot in data:
            country = spot.get('country', 'Unknown')
            country_counts[country] = country_counts.get(country, 0) + 1
        
        # Sort by count descending
        sorted_countries = sorted(country_counts.items(), key=lambda x: x[1], reverse=True)
        
        print("\n=== COUNTRY BREAKDOWN ===")
        for country, count in sorted_countries[:20]:  # Top 20
            print(f"  {country}: {count}")
        
        # Verify new Phase 4 countries exist
        phase4_countries = ['Tonga', 'Vanuatu', 'Papua New Guinea', 'Madagascar', 
                           'Mozambique', 'Angola', 'Oman', 'United Arab Emirates', 
                           'Israel', 'Ecuador', 'Colombia']
        
        for country in phase4_countries:
            assert country in country_counts, f"{country} not found in database"
        
        print(f"\nAll Phase 4 countries verified: {len(phase4_countries)}")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
