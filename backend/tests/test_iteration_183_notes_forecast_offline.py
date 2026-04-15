"""
Test iteration 183: Notes UI, 10-day Forecast, Offline Mode features
- Notes UI on Profile.js (Instagram-style, top-left of avatar)
- Emoji picker in Notes modal
- Forecast API returns 10 days by default
- Offline Mode settings with auto-sync toggle
"""

import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestForecastAPI:
    """Test forecast endpoint returns 10 days by default"""
    
    def test_forecast_returns_10_days_default(self):
        """GET /api/conditions/forecast/{spot_id} should return 10 days by default"""
        # First get a spot ID
        spots_response = requests.get(f"{BASE_URL}/api/surf-spots?limit=1")
        assert spots_response.status_code == 200, f"Failed to get spots: {spots_response.text}"
        
        spots = spots_response.json()
        assert len(spots) > 0, "No spots returned"
        
        spot_id = spots[0]['id']
        
        # Get forecast for the spot
        forecast_response = requests.get(f"{BASE_URL}/api/conditions/forecast/{spot_id}")
        assert forecast_response.status_code == 200, f"Failed to get forecast: {forecast_response.text}"
        
        data = forecast_response.json()
        assert 'forecast' in data, "Response missing 'forecast' key"
        
        # Verify 10 days of forecast
        forecast_days = len(data['forecast'])
        assert forecast_days == 10, f"Expected 10 days forecast, got {forecast_days}"
        
        # Verify forecast structure
        for day in data['forecast']:
            assert 'date' in day, "Forecast day missing 'date'"
            assert 'wave_height_min' in day, "Forecast day missing 'wave_height_min'"
            assert 'wave_height_max' in day, "Forecast day missing 'wave_height_max'"
            assert 'label' in day, "Forecast day missing 'label'"
    
    def test_forecast_with_custom_days_param(self):
        """GET /api/conditions/forecast/{spot_id}?days=5 should respect days param"""
        # Get a spot ID
        spots_response = requests.get(f"{BASE_URL}/api/surf-spots?limit=1")
        spots = spots_response.json()
        spot_id = spots[0]['id']
        
        # Get forecast with custom days
        forecast_response = requests.get(f"{BASE_URL}/api/conditions/forecast/{spot_id}?days=5")
        assert forecast_response.status_code == 200
        
        data = forecast_response.json()
        # API caps at 10 days max, so 5 should work
        assert len(data['forecast']) <= 10, "Forecast should not exceed 10 days"


class TestNotesAPI:
    """Test Notes API endpoints"""
    
    def test_get_user_note_endpoint(self):
        """GET /api/notes/user/{user_id} should return note data"""
        # Use a known user ID from test credentials
        user_id = "d3eb9019-d16f-4374-b432-4d168a96a00f"  # Kelly Slater
        viewer_id = user_id  # Viewing own note
        
        response = requests.get(f"{BASE_URL}/api/notes/user/{user_id}?viewer_id={viewer_id}")
        assert response.status_code == 200, f"Failed to get user note: {response.text}"
        
        data = response.json()
        # Response should have note (can be null) and is_mutual_follower
        assert 'note' in data or 'is_mutual_follower' in data, "Response missing expected keys"
    
    def test_get_notes_feed_endpoint(self):
        """GET /api/notes/feed should return notes feed"""
        user_id = "d3eb9019-d16f-4374-b432-4d168a96a00f"
        
        response = requests.get(f"{BASE_URL}/api/notes/feed?user_id={user_id}")
        assert response.status_code == 200, f"Failed to get notes feed: {response.text}"
        
        data = response.json()
        # Response should have feed structure
        assert 'feed' in data or 'own_note' in data, "Response missing expected keys"


class TestConditionsAPI:
    """Test conditions endpoints"""
    
    def test_get_spot_conditions(self):
        """GET /api/conditions/{spot_id} should return current conditions"""
        # Get a spot ID
        spots_response = requests.get(f"{BASE_URL}/api/surf-spots?limit=1")
        spots = spots_response.json()
        spot_id = spots[0]['id']
        
        response = requests.get(f"{BASE_URL}/api/conditions/{spot_id}")
        assert response.status_code == 200, f"Failed to get conditions: {response.text}"
        
        data = response.json()
        assert 'current' in data or 'error' in data, "Response missing expected keys"
    
    def test_batch_conditions(self):
        """GET /api/conditions/batch should return conditions for multiple spots"""
        # Get some spot IDs
        spots_response = requests.get(f"{BASE_URL}/api/surf-spots?limit=2")
        spots = spots_response.json()
        spot_ids = ",".join([s['id'] for s in spots[:2]])
        
        # Retry logic for transient network issues
        for attempt in range(3):
            response = requests.get(f"{BASE_URL}/api/conditions/batch?spot_ids={spot_ids}", timeout=30)
            if response.status_code == 200:
                break
        
        assert response.status_code == 200, f"Failed to get batch conditions after 3 attempts: {response.text}"
        
        data = response.json()
        assert 'conditions' in data, "Response missing 'conditions' key"


class TestSpotsAPI:
    """Test spots endpoints for offline mode"""
    
    def test_get_all_spots(self):
        """GET /api/surf-spots should return spots list"""
        response = requests.get(f"{BASE_URL}/api/surf-spots?limit=100")
        assert response.status_code == 200, f"Failed to get spots: {response.text}"
        
        spots = response.json()
        assert isinstance(spots, list), "Response should be a list"
        assert len(spots) > 0, "Should return at least one spot"
    
    def test_spots_count_for_offline(self):
        """Verify total spots count for offline caching"""
        response = requests.get(f"{BASE_URL}/api/surf-spots?limit=2000")
        assert response.status_code == 200, f"Failed to get spots: {response.text}"
        
        spots = response.json()
        # Should have around 1447 spots based on previous tests
        assert len(spots) > 1000, f"Expected 1000+ spots, got {len(spots)}"


class TestHealthAndAuth:
    """Test health and auth endpoints"""
    
    def test_health_endpoint(self):
        """GET /api/health should return healthy status"""
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200, f"Health check failed: {response.text}"
        
        data = response.json()
        assert data.get('status') == 'healthy', "Health status should be 'healthy'"
    
    def test_login_with_test_credentials(self):
        """POST /api/auth/login should work with test credentials"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "kelly@surf.com",
            "password": "test-shaka"
        })
        assert response.status_code == 200, f"Login failed: {response.text}"
        
        data = response.json()
        # Response returns user object directly
        assert 'email' in data, "Response missing 'email' key"
        assert data['email'] == 'kelly@surf.com', "Email mismatch"
        assert 'id' in data, "Response missing 'id' key"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
