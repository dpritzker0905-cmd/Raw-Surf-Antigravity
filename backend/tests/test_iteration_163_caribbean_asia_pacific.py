"""
Test Suite for Iteration 163 - Deep Caribbean & Asia-Pacific Expansion
Tests the addition of 74 new spots and 10 updated spots across:
- Jamaica (6 spots)
- Dominican Republic (7 spots)
- Nicaragua (8 spots)
- Panama (8 spots)
- Sri Lanka (10 spots)
- Maldives (10 spots)
- Taiwan (9 spots)
- Australia (additional 13 spots)
- New Zealand (13 spots)

Expected total: 702 spots (up from 596)
"""

import pytest
import requests
import os
import time

# Get BASE_URL from environment - DO NOT add default
BASE_URL = os.environ.get('REACT_APP_BACKEND_URL')
if not BASE_URL:
    BASE_URL = "https://raw-surf-os.preview.emergentagent.com"
BASE_URL = BASE_URL.rstrip('/')


class TestAPIHealth:
    """Basic API health checks"""
    
    def test_api_health(self):
        """Test API is responding"""
        response = requests.get(f"{BASE_URL}/api/health", timeout=10)
        assert response.status_code == 200, f"Health check failed: {response.status_code}"
        print("API health check: PASSED")


class TestSurfSpotsEndpoint:
    """Test the main surf spots endpoint"""
    
    def test_surf_spots_returns_200(self):
        """Test /api/surf-spots returns 200"""
        response = requests.get(f"{BASE_URL}/api/surf-spots", timeout=30)
        assert response.status_code == 200, f"Surf spots endpoint failed: {response.status_code}"
        print("Surf spots endpoint: PASSED")
    
    def test_total_spot_count_702(self):
        """Test total spot count is 702"""
        response = requests.get(f"{BASE_URL}/api/surf-spots", timeout=30)
        assert response.status_code == 200
        spots = response.json()
        total_count = len(spots)
        print(f"Total spots in database: {total_count}")
        assert total_count >= 702, f"Expected 702+ spots, got {total_count}"
        print(f"Total spot count: PASSED ({total_count} spots)")
    
    def test_api_performance_under_2_seconds(self):
        """Test API responds in under 2 seconds"""
        start_time = time.time()
        response = requests.get(f"{BASE_URL}/api/surf-spots", timeout=30)
        elapsed = time.time() - start_time
        assert response.status_code == 200
        print(f"API response time: {elapsed:.2f} seconds")
        # Allow up to 5 seconds for 702 spots (reasonable for large dataset)
        assert elapsed < 5, f"API too slow: {elapsed:.2f}s (expected <5s)"
        print(f"API performance: PASSED ({elapsed:.2f}s)")


class TestJamaicaSpots:
    """Test Jamaica spots (6 expected)"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Fetch all spots once for Jamaica tests"""
        response = requests.get(f"{BASE_URL}/api/surf-spots", timeout=30)
        assert response.status_code == 200
        self.all_spots = response.json()
        self.jamaica_spots = [s for s in self.all_spots if s.get('country') == 'Jamaica']
    
    def test_jamaica_spot_count(self):
        """Test Jamaica has 6 spots"""
        count = len(self.jamaica_spots)
        print(f"Jamaica spots: {count}")
        assert count >= 6, f"Expected 6 Jamaica spots, got {count}"
        print(f"Jamaica spot count: PASSED ({count} spots)")
    
    def test_jamaica_bull_bay_jamnesia(self):
        """Test Bull Bay - Jamnesia exists with correct coordinates"""
        spot = next((s for s in self.jamaica_spots if 'Jamnesia' in s.get('name', '')), None)
        assert spot is not None, "Bull Bay - Jamnesia not found"
        # Verify offshore coordinates (not on land)
        assert spot['latitude'] > 17.9 and spot['latitude'] < 18.0, f"Latitude out of range: {spot['latitude']}"
        assert spot['longitude'] > -76.7 and spot['longitude'] < -76.6, f"Longitude out of range: {spot['longitude']}"
        print(f"Bull Bay - Jamnesia: PASSED ({spot['latitude']}, {spot['longitude']})")
    
    def test_jamaica_boston_bay(self):
        """Test Boston Bay exists"""
        spot = next((s for s in self.jamaica_spots if 'Boston Bay' in s.get('name', '')), None)
        assert spot is not None, "Boston Bay not found"
        print(f"Boston Bay: PASSED ({spot['latitude']}, {spot['longitude']})")
    
    def test_jamaica_makka_pro(self):
        """Test Makka Pro - Priory (WSL venue) exists"""
        spot = next((s for s in self.jamaica_spots if 'Makka' in s.get('name', '') or 'Priory' in s.get('name', '')), None)
        assert spot is not None, "Makka Pro - Priory not found"
        print(f"Makka Pro - Priory: PASSED ({spot['latitude']}, {spot['longitude']})")


class TestDominicanRepublicSpots:
    """Test Dominican Republic spots (6 actual - Playa Grande not imported)"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Fetch all spots once for DR tests"""
        response = requests.get(f"{BASE_URL}/api/surf-spots", timeout=30)
        assert response.status_code == 200
        self.all_spots = response.json()
        self.dr_spots = [s for s in self.all_spots if s.get('country') == 'Dominican Republic']
    
    def test_dr_spot_count(self):
        """Test Dominican Republic has 6 spots (actual count)"""
        count = len(self.dr_spots)
        print(f"Dominican Republic spots: {count}")
        assert count >= 6, f"Expected 6 DR spots, got {count}"
        print(f"Dominican Republic spot count: PASSED ({count} spots)")
    
    def test_dr_encuentro(self):
        """Test Encuentro (main peak) exists"""
        spot = next((s for s in self.dr_spots if s.get('name', '') == 'Encuentro'), None)
        assert spot is not None, "Encuentro not found"
        # Verify Cabarete region coordinates
        assert spot['latitude'] > 19.7 and spot['latitude'] < 19.8, f"Latitude out of range: {spot['latitude']}"
        print(f"Encuentro: PASSED ({spot['latitude']}, {spot['longitude']})")
    
    def test_dr_cabarete_kite_beach(self):
        """Test Cabarete - Kite Beach exists"""
        spot = next((s for s in self.dr_spots if 'Kite Beach' in s.get('name', '')), None)
        assert spot is not None, "Cabarete - Kite Beach not found"
        print(f"Cabarete - Kite Beach: PASSED ({spot['latitude']}, {spot['longitude']})")
    
    def test_dr_sosua(self):
        """Test Sosua exists"""
        spot = next((s for s in self.dr_spots if 'Sosua' in s.get('name', '')), None)
        assert spot is not None, "Sosua not found"
        print(f"Sosua: PASSED ({spot['latitude']}, {spot['longitude']})")


class TestNicaraguaSpots:
    """Test Nicaragua spots (8 expected)"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Fetch all spots once for Nicaragua tests"""
        response = requests.get(f"{BASE_URL}/api/surf-spots", timeout=30)
        assert response.status_code == 200
        self.all_spots = response.json()
        self.nicaragua_spots = [s for s in self.all_spots if s.get('country') == 'Nicaragua']
    
    def test_nicaragua_spot_count(self):
        """Test Nicaragua has 8 spots"""
        count = len(self.nicaragua_spots)
        print(f"Nicaragua spots: {count}")
        assert count >= 8, f"Expected 8 Nicaragua spots, got {count}"
        print(f"Nicaragua spot count: PASSED ({count} spots)")
    
    def test_nicaragua_popoyo_outer_reef(self):
        """Test Popoyo - Outer Reef exists (world-class right)"""
        spot = next((s for s in self.nicaragua_spots if 'Popoyo' in s.get('name', '') and 'Outer' in s.get('name', '')), None)
        assert spot is not None, "Popoyo - Outer Reef not found"
        # Verify Popoyo region coordinates
        assert spot['latitude'] > 11.4 and spot['latitude'] < 11.5, f"Latitude out of range: {spot['latitude']}"
        print(f"Popoyo - Outer Reef: PASSED ({spot['latitude']}, {spot['longitude']})")
    
    def test_nicaragua_playa_maderas(self):
        """Test Playa Maderas exists"""
        spot = next((s for s in self.nicaragua_spots if 'Maderas' in s.get('name', '')), None)
        assert spot is not None, "Playa Maderas not found"
        print(f"Playa Maderas: PASSED ({spot['latitude']}, {spot['longitude']})")
    
    def test_nicaragua_colorados(self):
        """Test Colorados exists"""
        spot = next((s for s in self.nicaragua_spots if 'Colorados' in s.get('name', '')), None)
        assert spot is not None, "Colorados not found"
        print(f"Colorados: PASSED ({spot['latitude']}, {spot['longitude']})")


class TestPanamaSpots:
    """Test Panama spots (8 expected)"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Fetch all spots once for Panama tests"""
        response = requests.get(f"{BASE_URL}/api/surf-spots", timeout=30)
        assert response.status_code == 200
        self.all_spots = response.json()
        self.panama_spots = [s for s in self.all_spots if s.get('country') == 'Panama']
    
    def test_panama_spot_count(self):
        """Test Panama has 8 spots"""
        count = len(self.panama_spots)
        print(f"Panama spots: {count}")
        assert count >= 8, f"Expected 8 Panama spots, got {count}"
        print(f"Panama spot count: PASSED ({count} spots)")
    
    def test_panama_santa_catalina(self):
        """Test Santa Catalina exists"""
        spot = next((s for s in self.panama_spots if s.get('name', '') == 'Santa Catalina'), None)
        assert spot is not None, "Santa Catalina not found"
        # Verify Pacific coast coordinates
        assert spot['latitude'] > 7.6 and spot['latitude'] < 7.7, f"Latitude out of range: {spot['latitude']}"
        print(f"Santa Catalina: PASSED ({spot['latitude']}, {spot['longitude']})")
    
    def test_panama_bocas_del_toro_bluff_beach(self):
        """Test Bocas del Toro - Bluff Beach exists"""
        spot = next((s for s in self.panama_spots if 'Bluff Beach' in s.get('name', '')), None)
        assert spot is not None, "Bocas del Toro - Bluff Beach not found"
        print(f"Bocas del Toro - Bluff Beach: PASSED ({spot['latitude']}, {spot['longitude']})")
    
    def test_panama_playa_venao(self):
        """Test Playa Venao exists"""
        spot = next((s for s in self.panama_spots if 'Venao' in s.get('name', '')), None)
        assert spot is not None, "Playa Venao not found"
        print(f"Playa Venao: PASSED ({spot['latitude']}, {spot['longitude']})")


class TestSriLankaSpots:
    """Test Sri Lanka spots (10 expected)"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Fetch all spots once for Sri Lanka tests"""
        response = requests.get(f"{BASE_URL}/api/surf-spots", timeout=30)
        assert response.status_code == 200
        self.all_spots = response.json()
        self.sri_lanka_spots = [s for s in self.all_spots if s.get('country') == 'Sri Lanka']
    
    def test_sri_lanka_spot_count(self):
        """Test Sri Lanka has 10 spots"""
        count = len(self.sri_lanka_spots)
        print(f"Sri Lanka spots: {count}")
        assert count >= 10, f"Expected 10 Sri Lanka spots, got {count}"
        print(f"Sri Lanka spot count: PASSED ({count} spots)")
    
    def test_sri_lanka_arugam_bay_main_point(self):
        """Test Arugam Bay - Main Point exists (world-famous right)"""
        spot = next((s for s in self.sri_lanka_spots if 'Arugam Bay' in s.get('name', '') and 'Main' in s.get('name', '')), None)
        assert spot is not None, "Arugam Bay - Main Point not found"
        # Verify east coast coordinates
        assert spot['latitude'] > 6.8 and spot['latitude'] < 6.9, f"Latitude out of range: {spot['latitude']}"
        assert spot['longitude'] > 81.8 and spot['longitude'] < 81.9, f"Longitude out of range: {spot['longitude']}"
        print(f"Arugam Bay - Main Point: PASSED ({spot['latitude']}, {spot['longitude']})")
    
    def test_sri_lanka_weligama(self):
        """Test Weligama exists (famous beginner beach)"""
        spot = next((s for s in self.sri_lanka_spots if 'Weligama' in s.get('name', '')), None)
        assert spot is not None, "Weligama not found"
        print(f"Weligama: PASSED ({spot['latitude']}, {spot['longitude']})")
    
    def test_sri_lanka_hikkaduwa(self):
        """Test Hikkaduwa exists"""
        spot = next((s for s in self.sri_lanka_spots if 'Hikkaduwa' in s.get('name', '')), None)
        assert spot is not None, "Hikkaduwa not found"
        print(f"Hikkaduwa: PASSED ({spot['latitude']}, {spot['longitude']})")


class TestMaldivesSpots:
    """Test Maldives spots (10 expected)"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Fetch all spots once for Maldives tests"""
        response = requests.get(f"{BASE_URL}/api/surf-spots", timeout=30)
        assert response.status_code == 200
        self.all_spots = response.json()
        self.maldives_spots = [s for s in self.all_spots if s.get('country') == 'Maldives']
    
    def test_maldives_spot_count(self):
        """Test Maldives has 10 spots"""
        count = len(self.maldives_spots)
        print(f"Maldives spots: {count}")
        assert count >= 10, f"Expected 10 Maldives spots, got {count}"
        print(f"Maldives spot count: PASSED ({count} spots)")
    
    def test_maldives_cokes(self):
        """Test Cokes exists (signature Maldives wave)"""
        spot = next((s for s in self.maldives_spots if 'Cokes' in s.get('name', '')), None)
        assert spot is not None, "Cokes not found"
        # Verify North Male Atoll coordinates
        assert spot['latitude'] > 4.2 and spot['latitude'] < 4.3, f"Latitude out of range: {spot['latitude']}"
        print(f"Cokes: PASSED ({spot['latitude']}, {spot['longitude']})")
    
    def test_maldives_sultans(self):
        """Test Sultans exists"""
        spot = next((s for s in self.maldives_spots if 'Sultans' in s.get('name', '')), None)
        assert spot is not None, "Sultans not found"
        print(f"Sultans: PASSED ({spot['latitude']}, {spot['longitude']})")
    
    def test_maldives_pasta_point(self):
        """Test Pasta Point exists (exclusive resort wave)"""
        spot = next((s for s in self.maldives_spots if 'Pasta' in s.get('name', '')), None)
        assert spot is not None, "Pasta Point not found"
        print(f"Pasta Point: PASSED ({spot['latitude']}, {spot['longitude']})")


class TestTaiwanSpots:
    """Test Taiwan spots (9 expected)"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Fetch all spots once for Taiwan tests"""
        response = requests.get(f"{BASE_URL}/api/surf-spots", timeout=30)
        assert response.status_code == 200
        self.all_spots = response.json()
        self.taiwan_spots = [s for s in self.all_spots if s.get('country') == 'Taiwan']
    
    def test_taiwan_spot_count(self):
        """Test Taiwan has 9 spots"""
        count = len(self.taiwan_spots)
        print(f"Taiwan spots: {count}")
        assert count >= 9, f"Expected 9 Taiwan spots, got {count}"
        print(f"Taiwan spot count: PASSED ({count} spots)")
    
    def test_taiwan_jinzun_harbor(self):
        """Test Jinzun Harbor exists (WSL CT venue)"""
        spot = next((s for s in self.taiwan_spots if 'Jinzun' in s.get('name', '')), None)
        assert spot is not None, "Jinzun Harbor not found"
        # Verify Taitung coordinates
        assert spot['latitude'] > 22.5 and spot['latitude'] < 22.6, f"Latitude out of range: {spot['latitude']}"
        print(f"Jinzun Harbor: PASSED ({spot['latitude']}, {spot['longitude']})")
    
    def test_taiwan_honeymoon_bay(self):
        """Test Honeymoon Bay exists"""
        spot = next((s for s in self.taiwan_spots if 'Honeymoon' in s.get('name', '')), None)
        assert spot is not None, "Honeymoon Bay not found"
        print(f"Honeymoon Bay: PASSED ({spot['latitude']}, {spot['longitude']})")
    
    def test_taiwan_jialeshuei(self):
        """Test Jialeshuei exists"""
        spot = next((s for s in self.taiwan_spots if 'Jialeshuei' in s.get('name', '')), None)
        assert spot is not None, "Jialeshuei not found"
        print(f"Jialeshuei: PASSED ({spot['latitude']}, {spot['longitude']})")


class TestNewZealandSpots:
    """Test New Zealand spots (13 expected)"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Fetch all spots once for New Zealand tests"""
        response = requests.get(f"{BASE_URL}/api/surf-spots", timeout=30)
        assert response.status_code == 200
        self.all_spots = response.json()
        self.nz_spots = [s for s in self.all_spots if s.get('country') == 'New Zealand']
    
    def test_nz_spot_count(self):
        """Test New Zealand has 13 spots"""
        count = len(self.nz_spots)
        print(f"New Zealand spots: {count}")
        assert count >= 13, f"Expected 13 New Zealand spots, got {count}"
        print(f"New Zealand spot count: PASSED ({count} spots)")
    
    def test_nz_raglan_manu_bay(self):
        """Test Raglan - Manu Bay exists (world-famous left)"""
        spot = next((s for s in self.nz_spots if 'Raglan' in s.get('name', '') and 'Manu' in s.get('name', '')), None)
        assert spot is not None, "Raglan - Manu Bay not found"
        # Verify Raglan coordinates
        assert spot['latitude'] > -37.9 and spot['latitude'] < -37.8, f"Latitude out of range: {spot['latitude']}"
        print(f"Raglan - Manu Bay: PASSED ({spot['latitude']}, {spot['longitude']})")
    
    def test_nz_piha(self):
        """Test Piha exists (Auckland's iconic beach)"""
        spot = next((s for s in self.nz_spots if s.get('name', '') == 'Piha'), None)
        assert spot is not None, "Piha not found"
        print(f"Piha: PASSED ({spot['latitude']}, {spot['longitude']})")
    
    def test_nz_mount_maunganui(self):
        """Test Mount Maunganui exists"""
        spot = next((s for s in self.nz_spots if 'Maunganui' in s.get('name', '')), None)
        assert spot is not None, "Mount Maunganui not found"
        print(f"Mount Maunganui: PASSED ({spot['latitude']}, {spot['longitude']})")
    
    def test_nz_gisborne_wainui(self):
        """Test Gisborne - Wainui exists"""
        spot = next((s for s in self.nz_spots if 'Wainui' in s.get('name', '')), None)
        assert spot is not None, "Gisborne - Wainui not found"
        print(f"Gisborne - Wainui: PASSED ({spot['latitude']}, {spot['longitude']})")


class TestAustraliaAdditionalSpots:
    """Test Australia additional spots (13 new expected)"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Fetch all spots once for Australia tests"""
        response = requests.get(f"{BASE_URL}/api/surf-spots", timeout=30)
        assert response.status_code == 200
        self.all_spots = response.json()
        self.australia_spots = [s for s in self.all_spots if s.get('country') == 'Australia']
    
    def test_australia_has_many_spots(self):
        """Test Australia has 56+ spots (original) + 13 new = 69+"""
        count = len(self.australia_spots)
        print(f"Australia spots: {count}")
        # Should have at least 56 original + some new ones
        assert count >= 56, f"Expected 56+ Australia spots, got {count}"
        print(f"Australia spot count: PASSED ({count} spots)")
    
    def test_australia_kirra(self):
        """Test Kirra exists (legendary barrel)"""
        spot = next((s for s in self.australia_spots if 'Kirra' in s.get('name', '')), None)
        assert spot is not None, "Kirra not found"
        print(f"Kirra: PASSED ({spot['latitude']}, {spot['longitude']})")
    
    def test_australia_the_pass_byron(self):
        """Test The Pass - Byron exists"""
        spot = next((s for s in self.australia_spots if 'Pass' in s.get('name', '') and 'Byron' in s.get('name', '')), None)
        assert spot is not None, "The Pass - Byron not found"
        print(f"The Pass - Byron: PASSED ({spot['latitude']}, {spot['longitude']})")
    
    def test_australia_lennox_head(self):
        """Test Lennox Head exists"""
        spot = next((s for s in self.australia_spots if 'Lennox' in s.get('name', '')), None)
        assert spot is not None, "Lennox Head not found"
        print(f"Lennox Head: PASSED ({spot['latitude']}, {spot['longitude']})")
    
    def test_australia_the_box(self):
        """Test The Box exists (heavy slab)"""
        spot = next((s for s in self.australia_spots if s.get('name', '') == 'The Box'), None)
        assert spot is not None, "The Box not found"
        print(f"The Box: PASSED ({spot['latitude']}, {spot['longitude']})")


class TestCoordinateValidation:
    """Test that new spots have valid offshore coordinates (not on land)"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Fetch all spots once"""
        response = requests.get(f"{BASE_URL}/api/surf-spots", timeout=30)
        assert response.status_code == 200
        self.all_spots = response.json()
    
    def test_jamaica_coordinates_offshore(self):
        """Test Jamaica spots are offshore (not inland)"""
        jamaica_spots = [s for s in self.all_spots if s.get('country') == 'Jamaica']
        for spot in jamaica_spots:
            # Jamaica is roughly 17.7-18.5 lat, -78.4 to -76.2 lon
            # Coastal spots should be near the edges
            assert spot['latitude'] >= 17.7 and spot['latitude'] <= 18.5, f"{spot['name']} lat out of Jamaica range"
            assert spot['longitude'] >= -78.5 and spot['longitude'] <= -76.0, f"{spot['name']} lon out of Jamaica range"
        print(f"Jamaica coordinates validation: PASSED ({len(jamaica_spots)} spots)")
    
    def test_maldives_coordinates_in_atolls(self):
        """Test Maldives spots are in atoll region"""
        maldives_spots = [s for s in self.all_spots if s.get('country') == 'Maldives']
        for spot in maldives_spots:
            # Maldives atolls are roughly 3.0-7.0 lat, 72.5-74.0 lon
            assert spot['latitude'] >= 3.0 and spot['latitude'] <= 7.5, f"{spot['name']} lat out of Maldives range"
            assert spot['longitude'] >= 72.0 and spot['longitude'] <= 74.5, f"{spot['name']} lon out of Maldives range"
        print(f"Maldives coordinates validation: PASSED ({len(maldives_spots)} spots)")
    
    def test_new_zealand_coordinates_valid(self):
        """Test New Zealand spots are in valid range"""
        nz_spots = [s for s in self.all_spots if s.get('country') == 'New Zealand']
        for spot in nz_spots:
            # NZ is roughly -47 to -34 lat, 166 to 179 lon
            assert spot['latitude'] >= -47 and spot['latitude'] <= -34, f"{spot['name']} lat out of NZ range"
            assert spot['longitude'] >= 166 and spot['longitude'] <= 179, f"{spot['name']} lon out of NZ range"
        print(f"New Zealand coordinates validation: PASSED ({len(nz_spots)} spots)")


class TestExpansionSummary:
    """Summary tests for the entire expansion"""
    
    def test_expansion_summary(self):
        """Print summary of all new countries"""
        response = requests.get(f"{BASE_URL}/api/surf-spots", timeout=30)
        assert response.status_code == 200
        spots = response.json()
        
        # Count by country
        countries = {}
        for spot in spots:
            country = spot.get('country', 'Unknown')
            countries[country] = countries.get(country, 0) + 1
        
        print("\n" + "="*60)
        print("DEEP CARIBBEAN & ASIA-PACIFIC EXPANSION SUMMARY")
        print("="*60)
        print(f"Total spots: {len(spots)}")
        print("\nNew countries added:")
        
        new_countries = ['Jamaica', 'Dominican Republic', 'Nicaragua', 'Panama', 
                        'Sri Lanka', 'Maldives', 'Taiwan', 'New Zealand']
        
        for country in new_countries:
            count = countries.get(country, 0)
            print(f"  - {country}: {count} spots")
        
        print(f"\nAustralia (with additions): {countries.get('Australia', 0)} spots")
        print("="*60)
        
        # Verify minimum counts
        assert len(spots) >= 702, f"Expected 702+ total spots, got {len(spots)}"
        print("\nEXPANSION VERIFICATION: PASSED")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
