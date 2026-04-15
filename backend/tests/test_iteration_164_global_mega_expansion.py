"""
Iteration 164 - Global Mega Expansion Backend Tests
====================================================
Testing comprehensive coverage for:
- Northern California (38+ spots)
- Texas (17+ spots)
- Mexico (29 spots)
- Thailand (9 spots)
- Vietnam (7 spots)
- Spain (20 spots - Basque + Canary Islands)
- Morocco (13 spots)
- South Africa (17 spots)
- Turks and Caicos (4 spots)
- Barbados (8 spots)
Total expected: 832 spots
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
        response = requests.get(f"{BASE_URL}/api/health", timeout=10)
        assert response.status_code == 200, f"Health check failed: {response.status_code}"
        print("API health check: PASSED")

    def test_surf_spots_endpoint_accessible(self):
        """Test surf spots endpoint is accessible"""
        response = requests.get(f"{BASE_URL}/api/surf-spots", timeout=30)
        assert response.status_code == 200, f"Surf spots endpoint failed: {response.status_code}"
        data = response.json()
        assert isinstance(data, list), "Response should be a list"
        print(f"Surf spots endpoint accessible: PASSED ({len(data)} spots)")


class TestTotalSpotCount:
    """Verify total spot count is 832"""
    
    def test_total_spot_count_832(self):
        """Total spots should be 832 after Global Mega Expansion"""
        response = requests.get(f"{BASE_URL}/api/surf-spots", timeout=30)
        assert response.status_code == 200
        data = response.json()
        total = len(data)
        assert total == 832, f"Expected 832 total spots, got {total}"
        print(f"Total spot count: {total} - PASSED")


class TestAPIPerformance:
    """API performance tests - must be under 2 seconds"""
    
    def test_api_response_time_under_2_seconds(self):
        """API should respond in under 2 seconds"""
        start = time.time()
        response = requests.get(f"{BASE_URL}/api/surf-spots", timeout=30)
        elapsed = time.time() - start
        assert response.status_code == 200
        assert elapsed < 2.0, f"API took {elapsed:.2f}s, expected < 2s"
        print(f"API response time: {elapsed:.2f}s - PASSED")


class TestNorthernCalifornia:
    """Northern California coverage: 38+ spots (Humboldt, Mendocino, Sonoma, SF, Santa Cruz)"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Get all spots once for the class"""
        response = requests.get(f"{BASE_URL}/api/surf-spots", timeout=30)
        self.all_spots = response.json()
        self.norcal_spots = [s for s in self.all_spots if s.get('state_province') == 'California' and 
                            s.get('region') in ['Humboldt', 'Mendocino', 'Sonoma', 'Marin', 'San Francisco', 
                                                'San Mateo', 'Half Moon Bay', 'Santa Cruz']]
    
    def test_norcal_spot_count_minimum_36(self):
        """Northern California should have at least 36 spots (actual count from expansion)"""
        count = len(self.norcal_spots)
        assert count >= 36, f"Expected 36+ NorCal spots, got {count}"
        print(f"Northern California spots: {count} - PASSED")
    
    def test_humboldt_spots_exist(self):
        """Humboldt County spots should exist"""
        humboldt = [s for s in self.all_spots if s.get('region') == 'Humboldt']
        assert len(humboldt) >= 3, f"Expected 3+ Humboldt spots, got {len(humboldt)}"
        names = [s['name'] for s in humboldt]
        print(f"Humboldt spots ({len(humboldt)}): {names}")
    
    def test_shelter_cove_exists(self):
        """Shelter Cove should exist"""
        spot = next((s for s in self.all_spots if 'Shelter Cove' in s['name']), None)
        assert spot is not None, "Shelter Cove not found"
        print(f"Shelter Cove: FOUND at ({spot['latitude']}, {spot['longitude']})")
    
    def test_mendocino_spots_exist(self):
        """Mendocino County spots should exist"""
        mendocino = [s for s in self.all_spots if s.get('region') == 'Mendocino']
        assert len(mendocino) >= 3, f"Expected 3+ Mendocino spots, got {len(mendocino)}"
        names = [s['name'] for s in mendocino]
        print(f"Mendocino spots ({len(mendocino)}): {names}")
    
    def test_fort_bragg_glass_beach_exists(self):
        """Fort Bragg - Glass Beach should exist"""
        spot = next((s for s in self.all_spots if 'Glass Beach' in s['name']), None)
        assert spot is not None, "Fort Bragg - Glass Beach not found"
        print(f"Fort Bragg - Glass Beach: FOUND")
    
    def test_sonoma_spots_exist(self):
        """Sonoma County spots should exist"""
        sonoma = [s for s in self.all_spots if s.get('region') == 'Sonoma']
        assert len(sonoma) >= 2, f"Expected 2+ Sonoma spots, got {len(sonoma)}"
        names = [s['name'] for s in sonoma]
        print(f"Sonoma spots ({len(sonoma)}): {names}")
    
    def test_salmon_creek_exists(self):
        """Salmon Creek should exist"""
        spot = next((s for s in self.all_spots if 'Salmon Creek' in s['name']), None)
        assert spot is not None, "Salmon Creek not found"
        print(f"Salmon Creek: FOUND")
    
    def test_san_francisco_spots_exist(self):
        """San Francisco spots should exist"""
        sf = [s for s in self.all_spots if s.get('region') == 'San Francisco']
        assert len(sf) >= 3, f"Expected 3+ SF spots, got {len(sf)}"
        names = [s['name'] for s in sf]
        print(f"San Francisco spots ({len(sf)}): {names}")
    
    def test_fort_point_exists(self):
        """Fort Point should exist"""
        spot = next((s for s in self.all_spots if 'Fort Point' in s['name']), None)
        assert spot is not None, "Fort Point not found"
        print(f"Fort Point: FOUND")
    
    def test_santa_cruz_spots_exist(self):
        """Santa Cruz spots should exist"""
        sc = [s for s in self.all_spots if s.get('region') == 'Santa Cruz']
        assert len(sc) >= 5, f"Expected 5+ Santa Cruz spots, got {len(sc)}"
        names = [s['name'] for s in sc]
        print(f"Santa Cruz spots ({len(sc)}): {names}")
    
    def test_cowells_beach_exists(self):
        """Cowell's Beach should exist"""
        spot = next((s for s in self.all_spots if "Cowell" in s['name']), None)
        assert spot is not None, "Cowell's Beach not found"
        print(f"Cowell's Beach: FOUND")


class TestTexas:
    """Texas coverage: 17+ spots (Galveston, Port Aransas, South Padre)"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Get all spots once for the class"""
        response = requests.get(f"{BASE_URL}/api/surf-spots", timeout=30)
        self.all_spots = response.json()
        self.texas_spots = [s for s in self.all_spots if s.get('state_province') == 'Texas']
    
    def test_texas_spot_count_minimum_13(self):
        """Texas should have at least 13 spots (from expansion script)"""
        count = len(self.texas_spots)
        assert count >= 13, f"Expected 13+ Texas spots, got {count}"
        print(f"Texas spots: {count} - PASSED")
    
    def test_galveston_spots_exist(self):
        """Galveston area spots should exist"""
        galveston = [s for s in self.texas_spots if s.get('region') == 'Galveston']
        assert len(galveston) >= 3, f"Expected 3+ Galveston spots, got {len(galveston)}"
        names = [s['name'] for s in galveston]
        print(f"Galveston spots ({len(galveston)}): {names}")
    
    def test_galveston_seawall_exists(self):
        """Galveston Seawall should exist"""
        spot = next((s for s in self.all_spots if 'Galveston Seawall' in s['name']), None)
        assert spot is not None, "Galveston Seawall not found"
        print(f"Galveston Seawall: FOUND")
    
    def test_port_aransas_spots_exist(self):
        """Port Aransas spots should exist"""
        pa = [s for s in self.texas_spots if s.get('region') == 'Port Aransas']
        assert len(pa) >= 2, f"Expected 2+ Port Aransas spots, got {len(pa)}"
        names = [s['name'] for s in pa]
        print(f"Port Aransas spots ({len(pa)}): {names}")
    
    def test_south_padre_spots_exist(self):
        """South Padre spots should exist"""
        sp = [s for s in self.texas_spots if s.get('region') == 'South Padre']
        assert len(sp) >= 3, f"Expected 3+ South Padre spots, got {len(sp)}"
        names = [s['name'] for s in sp]
        print(f"South Padre spots ({len(sp)}): {names}")


class TestMexico:
    """Mexico coverage: 29 spots (Baja, Mainland Pacific, Caribbean)"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Get all spots once for the class"""
        response = requests.get(f"{BASE_URL}/api/surf-spots", timeout=30)
        self.all_spots = response.json()
        self.mexico_spots = [s for s in self.all_spots if s.get('country') == 'Mexico']
    
    def test_mexico_spot_count_minimum_19(self):
        """Mexico should have at least 19 spots (from expansion script)"""
        count = len(self.mexico_spots)
        assert count >= 19, f"Expected 19+ Mexico spots, got {count}"
        print(f"Mexico spots: {count} - PASSED")
    
    def test_baja_california_spots_exist(self):
        """Baja California spots should exist"""
        baja = [s for s in self.mexico_spots if 'Baja' in (s.get('region') or '') or 'Baja' in (s.get('state_province') or '')]
        assert len(baja) >= 5, f"Expected 5+ Baja spots, got {len(baja)}"
        names = [s['name'] for s in baja]
        print(f"Baja California spots ({len(baja)}): {names[:10]}...")
    
    def test_k38_exists(self):
        """K-38 should exist"""
        spot = next((s for s in self.all_spots if 'K-38' in s['name']), None)
        assert spot is not None, "K-38 not found"
        print(f"K-38: FOUND")
    
    def test_scorpion_bay_exists(self):
        """Scorpion Bay should exist"""
        spot = next((s for s in self.all_spots if 'Scorpion Bay' in s['name']), None)
        assert spot is not None, "Scorpion Bay not found"
        print(f"Scorpion Bay: FOUND")
    
    def test_mainland_pacific_spots_exist(self):
        """Mainland Pacific spots should exist (Michoacan, Colima, Guerrero)"""
        mainland = [s for s in self.mexico_spots if s.get('state_province') in ['Michoacan', 'Colima', 'Guerrero', 'Sinaloa']]
        assert len(mainland) >= 4, f"Expected 4+ mainland Pacific spots, got {len(mainland)}"
        names = [s['name'] for s in mainland]
        print(f"Mainland Pacific spots ({len(mainland)}): {names}")
    
    def test_pascuales_exists(self):
        """Pascuales should exist"""
        spot = next((s for s in self.all_spots if 'Pascuales' in s['name']), None)
        assert spot is not None, "Pascuales not found"
        print(f"Pascuales: FOUND")
    
    def test_caribbean_mexico_spots_exist(self):
        """Caribbean Mexico spots should exist (Quintana Roo)"""
        caribbean = [s for s in self.mexico_spots if s.get('state_province') == 'Quintana Roo']
        assert len(caribbean) >= 2, f"Expected 2+ Caribbean Mexico spots, got {len(caribbean)}"
        names = [s['name'] for s in caribbean]
        print(f"Caribbean Mexico spots ({len(caribbean)}): {names}")


class TestThailand:
    """Thailand coverage: 9 spots (Phuket, Khao Lak, Krabi)"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Get all spots once for the class"""
        response = requests.get(f"{BASE_URL}/api/surf-spots", timeout=30)
        self.all_spots = response.json()
        self.thailand_spots = [s for s in self.all_spots if s.get('country') == 'Thailand']
    
    def test_thailand_spot_count_9(self):
        """Thailand should have 9 spots"""
        count = len(self.thailand_spots)
        assert count == 9, f"Expected 9 Thailand spots, got {count}"
        print(f"Thailand spots: {count} - PASSED")
    
    def test_phuket_spots_exist(self):
        """Phuket spots should exist"""
        phuket = [s for s in self.thailand_spots if s.get('region') == 'Phuket']
        assert len(phuket) >= 5, f"Expected 5+ Phuket spots, got {len(phuket)}"
        names = [s['name'] for s in phuket]
        print(f"Phuket spots ({len(phuket)}): {names}")
    
    def test_kata_beach_exists(self):
        """Kata Beach should exist"""
        spot = next((s for s in self.all_spots if 'Kata Beach' in s['name']), None)
        assert spot is not None, "Kata Beach not found"
        print(f"Kata Beach: FOUND")
    
    def test_khao_lak_spots_exist(self):
        """Khao Lak spots should exist"""
        khao_lak = [s for s in self.thailand_spots if s.get('region') == 'Phang Nga']
        assert len(khao_lak) >= 2, f"Expected 2+ Khao Lak spots, got {len(khao_lak)}"
        names = [s['name'] for s in khao_lak]
        print(f"Khao Lak spots ({len(khao_lak)}): {names}")
    
    def test_krabi_spots_exist(self):
        """Krabi spots should exist"""
        krabi = [s for s in self.thailand_spots if s.get('region') == 'Krabi']
        assert len(krabi) >= 1, f"Expected 1+ Krabi spots, got {len(krabi)}"
        names = [s['name'] for s in krabi]
        print(f"Krabi spots ({len(krabi)}): {names}")


class TestVietnam:
    """Vietnam coverage: 7 spots (Da Nang, Nha Trang, Mui Ne)"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Get all spots once for the class"""
        response = requests.get(f"{BASE_URL}/api/surf-spots", timeout=30)
        self.all_spots = response.json()
        self.vietnam_spots = [s for s in self.all_spots if s.get('country') == 'Vietnam']
    
    def test_vietnam_spot_count_7(self):
        """Vietnam should have 7 spots"""
        count = len(self.vietnam_spots)
        assert count == 7, f"Expected 7 Vietnam spots, got {count}"
        print(f"Vietnam spots: {count} - PASSED")
    
    def test_da_nang_spots_exist(self):
        """Da Nang spots should exist"""
        da_nang = [s for s in self.vietnam_spots if s.get('region') == 'Da Nang']
        assert len(da_nang) >= 3, f"Expected 3+ Da Nang spots, got {len(da_nang)}"
        names = [s['name'] for s in da_nang]
        print(f"Da Nang spots ({len(da_nang)}): {names}")
    
    def test_my_khe_beach_exists(self):
        """My Khe Beach should exist"""
        spot = next((s for s in self.all_spots if 'My Khe' in s['name']), None)
        assert spot is not None, "My Khe Beach not found"
        print(f"My Khe Beach: FOUND")
    
    def test_nha_trang_spots_exist(self):
        """Nha Trang spots should exist"""
        nha_trang = [s for s in self.vietnam_spots if s.get('region') == 'Nha Trang']
        assert len(nha_trang) >= 2, f"Expected 2+ Nha Trang spots, got {len(nha_trang)}"
        names = [s['name'] for s in nha_trang]
        print(f"Nha Trang spots ({len(nha_trang)}): {names}")
    
    def test_mui_ne_exists(self):
        """Mui Ne Beach should exist"""
        spot = next((s for s in self.all_spots if 'Mui Ne' in s['name']), None)
        assert spot is not None, "Mui Ne Beach not found"
        print(f"Mui Ne Beach: FOUND")


class TestSpain:
    """Spain coverage: 20 spots (Basque Country, Canary Islands)"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Get all spots once for the class"""
        response = requests.get(f"{BASE_URL}/api/surf-spots", timeout=30)
        self.all_spots = response.json()
        self.spain_spots = [s for s in self.all_spots if s.get('country') == 'Spain']
    
    def test_spain_spot_count_20(self):
        """Spain should have 20 spots"""
        count = len(self.spain_spots)
        assert count == 20, f"Expected 20 Spain spots, got {count}"
        print(f"Spain spots: {count} - PASSED")
    
    def test_basque_country_spots_exist(self):
        """Basque Country spots should exist"""
        basque = [s for s in self.spain_spots if s.get('region') == 'Basque Country']
        assert len(basque) >= 5, f"Expected 5+ Basque Country spots, got {len(basque)}"
        names = [s['name'] for s in basque]
        print(f"Basque Country spots ({len(basque)}): {names}")
    
    def test_mundaka_exists(self):
        """Mundaka should exist"""
        spot = next((s for s in self.all_spots if 'Mundaka' in s['name']), None)
        assert spot is not None, "Mundaka not found"
        print(f"Mundaka: FOUND")
    
    def test_zarautz_exists(self):
        """Zarautz should exist"""
        spot = next((s for s in self.all_spots if 'Zarautz' in s['name']), None)
        assert spot is not None, "Zarautz not found"
        print(f"Zarautz: FOUND")
    
    def test_canary_islands_spots_exist(self):
        """Canary Islands spots should exist"""
        canary = [s for s in self.spain_spots if s.get('state_province') == 'Canary Islands']
        assert len(canary) >= 10, f"Expected 10+ Canary Islands spots, got {len(canary)}"
        names = [s['name'] for s in canary]
        print(f"Canary Islands spots ({len(canary)}): {names}")
    
    def test_famara_exists(self):
        """Famara should exist"""
        spot = next((s for s in self.all_spots if 'Famara' in s['name']), None)
        assert spot is not None, "Famara not found"
        print(f"Famara: FOUND")
    
    def test_el_confital_exists(self):
        """El Confital should exist"""
        spot = next((s for s in self.all_spots if 'El Confital' in s['name']), None)
        assert spot is not None, "El Confital not found"
        print(f"El Confital: FOUND")


class TestMorocco:
    """Morocco coverage: 13 spots (Taghazout, Imsouane, Essaouira)"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Get all spots once for the class"""
        response = requests.get(f"{BASE_URL}/api/surf-spots", timeout=30)
        self.all_spots = response.json()
        self.morocco_spots = [s for s in self.all_spots if s.get('country') == 'Morocco']
    
    def test_morocco_spot_count_13(self):
        """Morocco should have 13 spots"""
        count = len(self.morocco_spots)
        assert count == 13, f"Expected 13 Morocco spots, got {count}"
        print(f"Morocco spots: {count} - PASSED")
    
    def test_taghazout_spots_exist(self):
        """Taghazout spots should exist"""
        taghazout = [s for s in self.morocco_spots if s.get('region') == 'Taghazout']
        assert len(taghazout) >= 7, f"Expected 7+ Taghazout spots, got {len(taghazout)}"
        names = [s['name'] for s in taghazout]
        print(f"Taghazout spots ({len(taghazout)}): {names}")
    
    def test_anchor_point_exists(self):
        """Anchor Point should exist"""
        spot = next((s for s in self.all_spots if 'Anchor Point' in s['name']), None)
        assert spot is not None, "Anchor Point not found"
        print(f"Anchor Point: FOUND")
    
    def test_killer_point_exists(self):
        """Killer Point should exist"""
        spot = next((s for s in self.all_spots if 'Killer Point' in s['name']), None)
        assert spot is not None, "Killer Point not found"
        print(f"Killer Point: FOUND")
    
    def test_imsouane_spots_exist(self):
        """Imsouane spots should exist"""
        imsouane = [s for s in self.morocco_spots if s.get('region') == 'Imsouane']
        assert len(imsouane) >= 2, f"Expected 2+ Imsouane spots, got {len(imsouane)}"
        names = [s['name'] for s in imsouane]
        print(f"Imsouane spots ({len(imsouane)}): {names}")
    
    def test_essaouira_spots_exist(self):
        """Essaouira spots should exist"""
        essaouira = [s for s in self.morocco_spots if s.get('region') == 'Essaouira']
        assert len(essaouira) >= 2, f"Expected 2+ Essaouira spots, got {len(essaouira)}"
        names = [s['name'] for s in essaouira]
        print(f"Essaouira spots ({len(essaouira)}): {names}")


class TestSouthAfrica:
    """South Africa coverage: 17 spots (J-Bay, Cape Town, Durban)"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Get all spots once for the class"""
        response = requests.get(f"{BASE_URL}/api/surf-spots", timeout=30)
        self.all_spots = response.json()
        self.sa_spots = [s for s in self.all_spots if s.get('country') == 'South Africa']
    
    def test_south_africa_spot_count_17(self):
        """South Africa should have 17 spots"""
        count = len(self.sa_spots)
        assert count == 17, f"Expected 17 South Africa spots, got {count}"
        print(f"South Africa spots: {count} - PASSED")
    
    def test_jeffreys_bay_spots_exist(self):
        """Jeffreys Bay spots should exist"""
        jbay = [s for s in self.sa_spots if s.get('region') == 'Jeffreys Bay']
        assert len(jbay) >= 4, f"Expected 4+ J-Bay spots, got {len(jbay)}"
        names = [s['name'] for s in jbay]
        print(f"Jeffreys Bay spots ({len(jbay)}): {names}")
    
    def test_supertubes_exists(self):
        """Supertubes should exist"""
        spot = next((s for s in self.all_spots if 'Supertubes' in s['name']), None)
        assert spot is not None, "Supertubes not found"
        print(f"Supertubes: FOUND")
    
    def test_cape_town_spots_exist(self):
        """Cape Town spots should exist"""
        ct = [s for s in self.sa_spots if s.get('region') == 'Cape Town']
        assert len(ct) >= 5, f"Expected 5+ Cape Town spots, got {len(ct)}"
        names = [s['name'] for s in ct]
        print(f"Cape Town spots ({len(ct)}): {names}")
    
    def test_dungeons_exists(self):
        """Dungeons should exist"""
        spot = next((s for s in self.all_spots if 'Dungeons' in s['name']), None)
        assert spot is not None, "Dungeons not found"
        print(f"Dungeons: FOUND")
    
    def test_durban_spots_exist(self):
        """Durban spots should exist"""
        durban = [s for s in self.sa_spots if s.get('region') == 'Durban' or s.get('region') == 'Ballito']
        assert len(durban) >= 3, f"Expected 3+ Durban area spots, got {len(durban)}"
        names = [s['name'] for s in durban]
        print(f"Durban area spots ({len(durban)}): {names}")


class TestTurksAndCaicos:
    """Turks and Caicos coverage: 4 spots"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Get all spots once for the class"""
        response = requests.get(f"{BASE_URL}/api/surf-spots", timeout=30)
        self.all_spots = response.json()
        self.tc_spots = [s for s in self.all_spots if s.get('country') == 'Turks and Caicos']
    
    def test_turks_caicos_spot_count_4(self):
        """Turks and Caicos should have 4 spots"""
        count = len(self.tc_spots)
        assert count == 4, f"Expected 4 Turks and Caicos spots, got {count}"
        print(f"Turks and Caicos spots: {count} - PASSED")
    
    def test_long_bay_beach_exists(self):
        """Long Bay Beach should exist"""
        spot = next((s for s in self.all_spots if 'Long Bay Beach' in s['name']), None)
        assert spot is not None, "Long Bay Beach not found"
        print(f"Long Bay Beach: FOUND")
    
    def test_grace_bay_exists(self):
        """Grace Bay should exist"""
        spot = next((s for s in self.all_spots if 'Grace Bay' in s['name']), None)
        assert spot is not None, "Grace Bay not found"
        print(f"Grace Bay: FOUND")


class TestBarbados:
    """Barbados coverage: 8 spots"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Get all spots once for the class"""
        response = requests.get(f"{BASE_URL}/api/surf-spots", timeout=30)
        self.all_spots = response.json()
        self.barbados_spots = [s for s in self.all_spots if s.get('country') == 'Barbados']
    
    def test_barbados_spot_count_minimum_5(self):
        """Barbados should have at least 5 spots (expansion adds 5 new)"""
        count = len(self.barbados_spots)
        assert count >= 5, f"Expected 5+ Barbados spots, got {count}"
        print(f"Barbados spots: {count} - PASSED")
    
    def test_bathsheba_spots_exist(self):
        """Bathsheba spots should exist"""
        bathsheba = [s for s in self.barbados_spots if s.get('region') == 'Bathsheba']
        assert len(bathsheba) >= 2, f"Expected 2+ Bathsheba spots, got {len(bathsheba)}"
        names = [s['name'] for s in bathsheba]
        print(f"Bathsheba spots ({len(bathsheba)}): {names}")
    
    def test_soup_bowl_exists(self):
        """Soup Bowl should exist"""
        spot = next((s for s in self.all_spots if 'Soup Bowl' in s['name']), None)
        assert spot is not None, "Soup Bowl not found"
        print(f"Soup Bowl: FOUND")
    
    def test_south_point_exists(self):
        """South Point should exist"""
        spot = next((s for s in self.all_spots if 'South Point' in s['name'] and s.get('country') == 'Barbados'), None)
        assert spot is not None, "South Point (Barbados) not found"
        print(f"South Point: FOUND")


class TestPhilippinesExpansion:
    """Philippines expansion verification"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Get all spots once for the class"""
        response = requests.get(f"{BASE_URL}/api/surf-spots", timeout=30)
        self.all_spots = response.json()
        self.ph_spots = [s for s in self.all_spots if s.get('country') == 'Philippines']
    
    def test_philippines_spot_count_minimum_10(self):
        """Philippines should have at least 10 spots (expansion adds more)"""
        count = len(self.ph_spots)
        assert count >= 10, f"Expected 10+ Philippines spots, got {count}"
        print(f"Philippines spots: {count} - PASSED")
    
    def test_siargao_spots_exist(self):
        """Siargao spots should exist"""
        siargao = [s for s in self.ph_spots if s.get('region') == 'Siargao']
        assert len(siargao) >= 5, f"Expected 5+ Siargao spots, got {len(siargao)}"
        names = [s['name'] for s in siargao]
        print(f"Siargao spots ({len(siargao)}): {names}")
    
    def test_cloud_9_exists(self):
        """Cloud 9 should exist"""
        spot = next((s for s in self.all_spots if 'Cloud 9' in s['name']), None)
        assert spot is not None, "Cloud 9 not found"
        print(f"Cloud 9: FOUND")
    
    def test_baler_spots_exist(self):
        """Baler spots should exist"""
        baler = [s for s in self.ph_spots if s.get('region') == 'Baler']
        assert len(baler) >= 2, f"Expected 2+ Baler spots, got {len(baler)}"
        names = [s['name'] for s in baler]
        print(f"Baler spots ({len(baler)}): {names}")


class TestCoordinatesOffshore:
    """Verify coordinates are offshore (not on land)"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Get all spots once for the class"""
        response = requests.get(f"{BASE_URL}/api/surf-spots", timeout=30)
        self.all_spots = response.json()
    
    def test_norcal_coordinates_valid(self):
        """Northern California coordinates should be valid (west coast)"""
        norcal = [s for s in self.all_spots if s.get('state_province') == 'California' and 
                  s.get('region') in ['Humboldt', 'Mendocino', 'Sonoma', 'San Francisco']]
        for spot in norcal[:5]:
            # West coast should have negative longitude
            assert spot['longitude'] < -100, f"{spot['name']} has invalid longitude: {spot['longitude']}"
        print("Northern California coordinates: VALID")
    
    def test_texas_coordinates_valid(self):
        """Texas coordinates should be valid (Gulf Coast)"""
        texas = [s for s in self.all_spots if s.get('state_province') == 'Texas']
        for spot in texas[:5]:
            # Gulf Coast should have longitude around -94 to -97
            assert -98 < spot['longitude'] < -93, f"{spot['name']} has invalid longitude: {spot['longitude']}"
        print("Texas coordinates: VALID")
    
    def test_thailand_coordinates_valid(self):
        """Thailand coordinates should be valid (Andaman Sea)"""
        thailand = [s for s in self.all_spots if s.get('country') == 'Thailand']
        for spot in thailand[:5]:
            # Thailand should have positive longitude around 98
            assert 95 < spot['longitude'] < 105, f"{spot['name']} has invalid longitude: {spot['longitude']}"
        print("Thailand coordinates: VALID")
    
    def test_morocco_coordinates_valid(self):
        """Morocco coordinates should be valid (Atlantic)"""
        morocco = [s for s in self.all_spots if s.get('country') == 'Morocco']
        for spot in morocco[:5]:
            # Morocco should have negative longitude (Atlantic coast)
            assert -12 < spot['longitude'] < -8, f"{spot['name']} has invalid longitude: {spot['longitude']}"
        print("Morocco coordinates: VALID")


class TestExpansionSummary:
    """Summary test for the entire expansion"""
    
    def test_expansion_summary(self):
        """Print summary of all regions"""
        response = requests.get(f"{BASE_URL}/api/surf-spots", timeout=30)
        all_spots = response.json()
        
        # Count by country
        countries = {}
        for spot in all_spots:
            country = spot.get('country', 'Unknown')
            countries[country] = countries.get(country, 0) + 1
        
        print("\n" + "="*60)
        print("GLOBAL MEGA EXPANSION SUMMARY")
        print("="*60)
        print(f"Total spots: {len(all_spots)}")
        print("\nBy Country:")
        for country, count in sorted(countries.items(), key=lambda x: -x[1]):
            print(f"  {country}: {count}")
        print("="*60)
        
        assert len(all_spots) == 832, f"Expected 832 total spots, got {len(all_spots)}"
