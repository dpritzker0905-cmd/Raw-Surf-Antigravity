"""
Iteration 151 - Forecast Badge, Tiered Access, Buoy Sync & Map Search Tests
Tests for:
1. GET /api/conditions/forecast/{spot_id} - 7-day forecast with wave heights, labels, periods
2. GET /api/conditions/{spot_id} - Current conditions with swell data
3. Map Search functionality (frontend component verification)
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestForecastEndpoint:
    """Tests for the 7-day forecast endpoint"""
    
    @pytest.fixture(scope="class")
    def valid_spot_id(self):
        """Get a valid spot ID from the surf-spots endpoint"""
        response = requests.get(f"{BASE_URL}/api/surf-spots?limit=1")
        assert response.status_code == 200
        spots = response.json()
        assert len(spots) > 0, "No surf spots found"
        return spots[0]['id']
    
    def test_forecast_endpoint_returns_200(self, valid_spot_id):
        """Test that forecast endpoint returns 200 for valid spot"""
        response = requests.get(f"{BASE_URL}/api/conditions/forecast/{valid_spot_id}")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        print(f"✅ Forecast endpoint returned 200 for spot {valid_spot_id}")
    
    def test_forecast_returns_7_days(self, valid_spot_id):
        """Test that forecast returns 7 days of data"""
        response = requests.get(f"{BASE_URL}/api/conditions/forecast/{valid_spot_id}")
        assert response.status_code == 200
        data = response.json()
        
        assert 'forecast' in data, "Response missing 'forecast' field"
        forecast = data['forecast']
        assert len(forecast) == 7, f"Expected 7 days, got {len(forecast)}"
        print(f"✅ Forecast returns 7 days of data")
    
    def test_forecast_contains_required_fields(self, valid_spot_id):
        """Test that each forecast day contains required fields"""
        response = requests.get(f"{BASE_URL}/api/conditions/forecast/{valid_spot_id}")
        assert response.status_code == 200
        data = response.json()
        
        required_fields = ['date', 'wave_height_min', 'wave_height_max', 'wave_direction', 
                          'wave_period', 'swell_height_ft', 'label']
        
        for day in data['forecast']:
            for field in required_fields:
                assert field in day, f"Missing field '{field}' in forecast day"
        
        print(f"✅ All forecast days contain required fields: {required_fields}")
    
    def test_forecast_wave_heights_are_numeric(self, valid_spot_id):
        """Test that wave heights are numeric values"""
        response = requests.get(f"{BASE_URL}/api/conditions/forecast/{valid_spot_id}")
        assert response.status_code == 200
        data = response.json()
        
        for day in data['forecast']:
            assert isinstance(day['wave_height_min'], (int, float)), "wave_height_min should be numeric"
            assert isinstance(day['wave_height_max'], (int, float)), "wave_height_max should be numeric"
            assert day['wave_height_min'] <= day['wave_height_max'], "min should be <= max"
        
        print(f"✅ Wave heights are valid numeric values")
    
    def test_forecast_labels_are_valid(self, valid_spot_id):
        """Test that forecast labels are valid condition labels"""
        valid_labels = ["Flat", "Ankle High", "Knee High", "Waist High", "Chest High", 
                       "Head High", "Overhead", "Double Overhead", "Triple Overhead+"]
        
        response = requests.get(f"{BASE_URL}/api/conditions/forecast/{valid_spot_id}")
        assert response.status_code == 200
        data = response.json()
        
        for day in data['forecast']:
            assert day['label'] in valid_labels, f"Invalid label: {day['label']}"
        
        print(f"✅ All forecast labels are valid")
    
    def test_forecast_includes_source_and_timestamp(self, valid_spot_id):
        """Test that forecast includes source attribution and timestamp"""
        response = requests.get(f"{BASE_URL}/api/conditions/forecast/{valid_spot_id}")
        assert response.status_code == 200
        data = response.json()
        
        assert 'source' in data, "Missing 'source' field"
        assert 'updated_at' in data, "Missing 'updated_at' field"
        assert data['source'] == "Open-Meteo Marine API", f"Unexpected source: {data['source']}"
        
        print(f"✅ Forecast includes source: {data['source']}")
    
    def test_forecast_invalid_spot_returns_404(self):
        """Test that invalid spot ID returns 404"""
        response = requests.get(f"{BASE_URL}/api/conditions/forecast/invalid-spot-id-12345")
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        print(f"✅ Invalid spot ID returns 404")


class TestCurrentConditionsEndpoint:
    """Tests for the current conditions endpoint"""
    
    @pytest.fixture(scope="class")
    def valid_spot_id(self):
        """Get a valid spot ID from the surf-spots endpoint"""
        response = requests.get(f"{BASE_URL}/api/surf-spots?limit=1")
        assert response.status_code == 200
        spots = response.json()
        assert len(spots) > 0, "No surf spots found"
        return spots[0]['id']
    
    def test_conditions_endpoint_returns_200(self, valid_spot_id):
        """Test that conditions endpoint returns 200 for valid spot"""
        response = requests.get(f"{BASE_URL}/api/conditions/{valid_spot_id}")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        print(f"✅ Conditions endpoint returned 200 for spot {valid_spot_id}")
    
    def test_conditions_contains_current_data(self, valid_spot_id):
        """Test that conditions response contains current data"""
        response = requests.get(f"{BASE_URL}/api/conditions/{valid_spot_id}")
        assert response.status_code == 200
        data = response.json()
        
        assert 'current' in data, "Response missing 'current' field"
        current = data['current']
        
        required_fields = ['wave_height_ft', 'wave_direction', 'wave_period', 
                          'swell_height_ft', 'swell_direction', 'swell_period', 'label', 'updated_at']
        
        for field in required_fields:
            assert field in current, f"Missing field '{field}' in current conditions"
        
        print(f"✅ Current conditions contain all required fields")
    
    def test_conditions_contains_swell_data(self, valid_spot_id):
        """Test that conditions include swell data from Open-Meteo Marine API"""
        response = requests.get(f"{BASE_URL}/api/conditions/{valid_spot_id}")
        assert response.status_code == 200
        data = response.json()
        
        current = data['current']
        assert 'swell_height_ft' in current, "Missing swell_height_ft"
        assert 'swell_direction' in current, "Missing swell_direction"
        assert 'swell_period' in current, "Missing swell_period"
        
        # Verify swell data is numeric
        assert isinstance(current['swell_height_ft'], (int, float)), "swell_height_ft should be numeric"
        
        print(f"✅ Swell data present: {current['swell_height_ft']}ft @ {current['swell_period']}s")
    
    def test_conditions_includes_hourly_forecast(self, valid_spot_id):
        """Test that conditions include short-term hourly forecast"""
        response = requests.get(f"{BASE_URL}/api/conditions/{valid_spot_id}")
        assert response.status_code == 200
        data = response.json()
        
        assert 'forecast' in data, "Response missing 'forecast' field"
        forecast = data['forecast']
        assert len(forecast) > 0, "Hourly forecast is empty"
        assert len(forecast) <= 6, f"Expected max 6 hours, got {len(forecast)}"
        
        # Verify hourly forecast structure
        for hour in forecast:
            assert 'time' in hour, "Missing 'time' in hourly forecast"
            assert 'wave_height_ft' in hour, "Missing 'wave_height_ft' in hourly forecast"
            assert 'label' in hour, "Missing 'label' in hourly forecast"
        
        print(f"✅ Hourly forecast contains {len(forecast)} hours")
    
    def test_conditions_invalid_spot_returns_404(self):
        """Test that invalid spot ID returns 404"""
        response = requests.get(f"{BASE_URL}/api/conditions/invalid-spot-id-12345")
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        print(f"✅ Invalid spot ID returns 404")


class TestSurfSpotsEndpoint:
    """Tests for surf spots endpoint (used by map search)"""
    
    def test_surf_spots_returns_spots(self):
        """Test that surf-spots endpoint returns spots"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        spots = response.json()
        assert len(spots) > 0, "No surf spots returned"
        print(f"✅ Surf spots endpoint returned {len(spots)} spots")
    
    def test_surf_spots_contain_search_fields(self):
        """Test that spots contain fields needed for search (name, region, country)"""
        response = requests.get(f"{BASE_URL}/api/surf-spots?limit=5")
        assert response.status_code == 200
        spots = response.json()
        
        for spot in spots:
            assert 'name' in spot, "Missing 'name' field"
            assert 'region' in spot, "Missing 'region' field"
            assert 'country' in spot, "Missing 'country' field"
            assert 'latitude' in spot, "Missing 'latitude' field"
            assert 'longitude' in spot, "Missing 'longitude' field"
        
        print(f"✅ Spots contain all search-related fields")
    
    def test_surf_spots_total_count(self):
        """Test that we have expected number of spots (307 from iteration 150)"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        spots = response.json()
        assert len(spots) >= 300, f"Expected at least 300 spots, got {len(spots)}"
        print(f"✅ Total spots: {len(spots)}")


class TestBatchConditionsEndpoint:
    """Tests for batch conditions endpoint"""
    
    @pytest.fixture(scope="class")
    def valid_spot_ids(self):
        """Get multiple valid spot IDs"""
        response = requests.get(f"{BASE_URL}/api/surf-spots?limit=3")
        assert response.status_code == 200
        spots = response.json()
        return [spot['id'] for spot in spots]
    
    def test_batch_conditions_returns_200(self, valid_spot_ids):
        """Test batch conditions endpoint"""
        spot_ids_str = ",".join(valid_spot_ids)
        response = requests.get(f"{BASE_URL}/api/conditions/batch?spot_ids={spot_ids_str}")
        assert response.status_code == 200
        data = response.json()
        
        assert 'conditions' in data, "Missing 'conditions' field"
        print(f"✅ Batch conditions returned for {len(data['conditions'])} spots")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
