"""
Test Active Duty / On-Demand Navigation Bug Fixes - Iteration 93

Tests:
1. POST /api/photographer/{id}/on-demand-toggle endpoint
2. GET /api/photographer/{id}/on-demand-status endpoint
3. GET /api/photographers/live endpoint
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials from iteration 92
PHOTOGRAPHER_ID = "12dc6786-124f-40b1-8698-a9409f99736f"  # Approved Pro
PHOTOGRAPHER_EMAIL = "photographer@surf.com"
PHOTOGRAPHER_PASSWORD = "test-shaka"


class TestOnDemandToggleAPI:
    """Test the on-demand toggle endpoint"""
    
    def test_on_demand_toggle_enable(self):
        """Test enabling on-demand mode"""
        response = requests.post(
            f"{BASE_URL}/api/photographer/{PHOTOGRAPHER_ID}/on-demand-toggle",
            json={"is_available": True}
        )
        print(f"Toggle Enable Response: {response.status_code} - {response.text}")
        
        # Should return 200 OK
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "success" in data or "on_demand_active" in data
        
    def test_on_demand_toggle_disable(self):
        """Test disabling on-demand mode"""
        response = requests.post(
            f"{BASE_URL}/api/photographer/{PHOTOGRAPHER_ID}/on-demand-toggle",
            json={"is_available": False}
        )
        print(f"Toggle Disable Response: {response.status_code} - {response.text}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "success" in data or "on_demand_active" in data
        
    def test_on_demand_toggle_rejects_wrong_field_name(self):
        """Test toggle rejects wrong field name (on_demand_available instead of is_available)"""
        response = requests.post(
            f"{BASE_URL}/api/photographer/{PHOTOGRAPHER_ID}/on-demand-toggle",
            json={"on_demand_available": True}
        )
        print(f"Toggle with wrong field: {response.status_code} - {response.text}")
        
        # Should reject with 422 - field is_available is required
        assert response.status_code == 422, f"Expected 422, got {response.status_code}: {response.text}"


class TestOnDemandStatusAPI:
    """Test the on-demand status endpoint"""
    
    def test_get_on_demand_status(self):
        """Test getting on-demand status"""
        response = requests.get(
            f"{BASE_URL}/api/photographer/{PHOTOGRAPHER_ID}/on-demand-status"
        )
        print(f"Status Response: {response.status_code} - {response.text}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        # Should have is_available or on_demand_available or on_demand_active
        assert any(key in data for key in ['is_available', 'on_demand_available', 'on_demand_active']), \
            f"Expected availability field in response: {data}"


class TestLivePhotographersAPI:
    """Test the live photographers endpoint"""
    
    def test_get_live_photographers(self):
        """Test getting live photographers list"""
        response = requests.get(f"{BASE_URL}/api/photographers/live")
        print(f"Live Photographers Response: {response.status_code} - {response.text[:500]}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert isinstance(data, list), f"Expected list, got {type(data)}"


class TestPhotographerBookingsAPI:
    """Test photographer bookings endpoint with today filter"""
    
    def test_get_photographer_bookings(self):
        """Test getting photographer bookings"""
        response = requests.get(
            f"{BASE_URL}/api/photographer/{PHOTOGRAPHER_ID}/bookings"
        )
        print(f"Bookings Response: {response.status_code}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"


class TestHealthCheck:
    """Basic health check"""
    
    def test_api_health(self):
        """Test API is running"""
        response = requests.get(f"{BASE_URL}/api/")
        print(f"Health Check: {response.status_code}")
        
        assert response.status_code == 200, f"API not healthy: {response.status_code}"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
