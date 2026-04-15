"""
Test Sprint Features - Iteration 94
Tests for:
1. POST /api/photographer/{id}/on-demand-toggle - accepts spot_id and spot_name parameters
2. GET /api/photographer/{id}/on-demand-status - returns spot_name and spot_id
3. POST /api/dispatch/request - enforces current-day-only for immediate requests
"""
import pytest
import requests
import os
from datetime import datetime, timedelta, timezone

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test photographer ID from previous iteration
TEST_PHOTOGRAPHER_ID = "12dc6786-124f-40b1-8698-a9409f99736f"

# Valid spot ID from database (Sebastian Inlet)
VALID_SPOT_ID = "de43d26a-dbe9-4239-ba03-db6fb45c402a"
VALID_SPOT_NAME = "Sebastian Inlet"


class TestOnDemandToggleWithSpot:
    """Test on-demand-toggle endpoint accepts spot_id and spot_name parameters"""
    
    def test_on_demand_toggle_with_spot_params(self):
        """POST /api/photographer/{id}/on-demand-toggle should accept spot_id and spot_name"""
        response = requests.post(
            f"{BASE_URL}/api/photographer/{TEST_PHOTOGRAPHER_ID}/on-demand-toggle",
            json={
                "is_available": True,
                "spot_id": VALID_SPOT_ID,
                "spot_name": VALID_SPOT_NAME,
                "latitude": 27.8603,
                "longitude": -80.4473
            }
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        # Verify response structure
        assert "success" in data, "Response should contain 'success' field"
        assert data["success"] == True, "Toggle should succeed"
        assert "is_available" in data, "Response should contain 'is_available' field"
        assert data["is_available"] == True, "Should be available after toggle on"
        
        # Verify spot_name is returned
        assert "spot_name" in data, "Response should contain 'spot_name' field"
        assert data["spot_name"] == VALID_SPOT_NAME, f"spot_name should be '{VALID_SPOT_NAME}', got {data.get('spot_name')}"
        
        print(f"SUCCESS: on-demand-toggle accepts spot_id and spot_name - Response: {data}")
    
    def test_on_demand_toggle_disable(self):
        """POST /api/photographer/{id}/on-demand-toggle should clear spot info when disabling"""
        response = requests.post(
            f"{BASE_URL}/api/photographer/{TEST_PHOTOGRAPHER_ID}/on-demand-toggle",
            json={
                "is_available": False
            }
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        assert data["success"] == True, "Toggle should succeed"
        assert data["is_available"] == False, "Should be unavailable after toggle off"
        
        print(f"SUCCESS: on-demand-toggle disable works - Response: {data}")


class TestOnDemandStatusReturnsSpot:
    """Test on-demand-status endpoint returns spot_name and spot_id"""
    
    def test_on_demand_status_returns_spot_info(self):
        """GET /api/photographer/{id}/on-demand-status should return spot_name and spot_id"""
        # First enable on-demand with spot info
        toggle_response = requests.post(
            f"{BASE_URL}/api/photographer/{TEST_PHOTOGRAPHER_ID}/on-demand-toggle",
            json={
                "is_available": True,
                "spot_id": VALID_SPOT_ID,
                "spot_name": VALID_SPOT_NAME,
                "latitude": 27.8603,
                "longitude": -80.4473
            }
        )
        assert toggle_response.status_code == 200, f"Toggle failed: {toggle_response.text}"
        
        # Now check status
        response = requests.get(
            f"{BASE_URL}/api/photographer/{TEST_PHOTOGRAPHER_ID}/on-demand-status"
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        # Verify response structure
        assert "is_available" in data, "Response should contain 'is_available' field"
        assert data["is_available"] == True, "Should be available"
        
        # Verify spot_name is returned
        assert "spot_name" in data, "Response should contain 'spot_name' field"
        assert data["spot_name"] == VALID_SPOT_NAME, f"spot_name should be '{VALID_SPOT_NAME}', got {data.get('spot_name')}"
        
        # Verify spot_id is returned
        assert "spot_id" in data, "Response should contain 'spot_id' field"
        
        # Verify coordinates are returned
        assert "latitude" in data, "Response should contain 'latitude' field"
        assert "longitude" in data, "Response should contain 'longitude' field"
        
        print(f"SUCCESS: on-demand-status returns spot info - Response: {data}")
    
    def test_on_demand_status_when_disabled(self):
        """GET /api/photographer/{id}/on-demand-status should return is_available=False when disabled"""
        # First disable on-demand
        toggle_response = requests.post(
            f"{BASE_URL}/api/photographer/{TEST_PHOTOGRAPHER_ID}/on-demand-toggle",
            json={"is_available": False}
        )
        assert toggle_response.status_code == 200
        
        # Check status
        response = requests.get(
            f"{BASE_URL}/api/photographer/{TEST_PHOTOGRAPHER_ID}/on-demand-status"
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        assert data["is_available"] == False, "Should be unavailable"
        
        print(f"SUCCESS: on-demand-status shows disabled state - Response: {data}")


class TestDispatchCurrentDayEnforcement:
    """Test dispatch request enforces current-day-only for immediate requests"""
    
    def test_dispatch_immediate_future_date_rejected(self):
        """POST /api/dispatch/request should reject immediate requests for future dates"""
        # Get a future date (tomorrow)
        tomorrow = datetime.now(timezone.utc) + timedelta(days=1)
        
        response = requests.post(
            f"{BASE_URL}/api/dispatch/request?requester_id={TEST_PHOTOGRAPHER_ID}",
            json={
                "latitude": 21.6659,
                "longitude": -158.0539,
                "location_name": "Pipeline Beach",
                "estimated_duration_hours": 1.0,
                "is_immediate": True,
                "requested_start_time": tomorrow.isoformat()
            }
        )
        
        # Should be rejected with 400 error
        assert response.status_code == 400, f"Expected 400 for future date immediate request, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "detail" in data, "Error response should contain 'detail' field"
        assert "today only" in data["detail"].lower() or "current" in data["detail"].lower(), \
            f"Error message should mention 'today only' or 'current', got: {data['detail']}"
        
        print(f"SUCCESS: Immediate request for future date rejected - Error: {data['detail']}")
    
    def test_dispatch_scheduled_requires_24h_lead(self):
        """POST /api/dispatch/request should require 24h lead time for scheduled requests"""
        # Get a time less than 24 hours from now
        in_12_hours = datetime.now(timezone.utc) + timedelta(hours=12)
        
        response = requests.post(
            f"{BASE_URL}/api/dispatch/request?requester_id={TEST_PHOTOGRAPHER_ID}",
            json={
                "latitude": 21.6659,
                "longitude": -158.0539,
                "location_name": "Pipeline Beach",
                "estimated_duration_hours": 1.0,
                "is_immediate": False,
                "requested_start_time": in_12_hours.isoformat()
            }
        )
        
        # Should be rejected with 400 error
        assert response.status_code == 400, f"Expected 400 for scheduled request with <24h lead time, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "detail" in data, "Error response should contain 'detail' field"
        assert "24" in data["detail"], f"Error message should mention '24 hours', got: {data['detail']}"
        
        print(f"SUCCESS: Scheduled request with <24h lead time rejected - Error: {data['detail']}")


class TestOnDemandToggleCleanup:
    """Cleanup test - disable on-demand after tests"""
    
    def test_cleanup_disable_on_demand(self):
        """Cleanup: Disable on-demand for test photographer"""
        response = requests.post(
            f"{BASE_URL}/api/photographer/{TEST_PHOTOGRAPHER_ID}/on-demand-toggle",
            json={"is_available": False}
        )
        
        assert response.status_code == 200, f"Cleanup failed: {response.text}"
        print("SUCCESS: Cleanup completed - on-demand disabled")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
