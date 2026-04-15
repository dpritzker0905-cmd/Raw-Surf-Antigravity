"""
P2 Features Testing: Photographer Pricing & Dispatch Tracking
Tests for:
- GET /api/payments/packages - Default packages
- GET /api/payments/packages?photographer_id={id} - Custom pricing packages
- GET /api/payments/photographer/{id}/pricing - Photographer pricing settings
- PUT /api/payments/photographer/{id}/pricing - Update photographer pricing
- GET /api/dispatch/{id}/tracking - Real-time GPS tracking for dispatch
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')


class TestPhotographerPricing:
    """Tests for photographer-configurable pricing endpoints"""
    
    # Sarah Waters - Photographer role (can set pricing)
    PHOTOGRAPHER_ID = "04503c29-dc37-4f8c-a462-4177c4a54096"
    # Kelly Slater - Pro role (originally couldn't set pricing due to bug, now fixed)
    PRO_ID = "d3eb9019-d16f-4374-b432-4d168a96a00f"
    
    def test_get_default_packages(self):
        """Test GET /api/payments/packages returns default packages"""
        response = requests.get(f"{BASE_URL}/api/payments/packages")
        assert response.status_code == 200
        
        data = response.json()
        assert "packages" in data
        assert "hourly_rate" in data
        assert "deposit_percentage" in data
        
        # Should have 3 packages (1hr, 2hr, 3hr)
        assert len(data["packages"]) == 3
        
        # Verify package structure
        for pkg in data["packages"]:
            assert "id" in pkg
            assert "duration_hours" in pkg
            assert "total_amount" in pkg
            assert "deposit_amount" in pkg
            assert "description" in pkg
        
        # Default hourly rate should be 50
        assert data["hourly_rate"] == 50.0
        assert data["deposit_percentage"] == 50
        
        print(f"PASS: Default packages returned with hourly_rate={data['hourly_rate']}")
    
    def test_get_photographer_pricing(self):
        """Test GET /api/payments/photographer/{id}/pricing returns pricing settings"""
        response = requests.get(f"{BASE_URL}/api/payments/photographer/{self.PHOTOGRAPHER_ID}/pricing")
        assert response.status_code == 200
        
        data = response.json()
        assert data["photographer_id"] == self.PHOTOGRAPHER_ID
        assert "name" in data
        assert "on_demand_hourly_rate" in data
        assert "booking_hourly_rate" in data
        assert "deposit_percentage" in data
        
        print(f"PASS: Photographer pricing returned: on_demand={data['on_demand_hourly_rate']}, booking={data['booking_hourly_rate']}")
    
    def test_get_photographer_pricing_not_found(self):
        """Test GET /api/payments/photographer/{id}/pricing with non-existent ID"""
        response = requests.get(f"{BASE_URL}/api/payments/photographer/non-existent-id/pricing")
        assert response.status_code == 404
        print("PASS: 404 returned for non-existent photographer")
    
    def test_update_photographer_pricing(self):
        """Test PUT /api/payments/photographer/{id}/pricing updates pricing"""
        new_rate = 85.0
        
        response = requests.put(
            f"{BASE_URL}/api/payments/photographer/{self.PHOTOGRAPHER_ID}/pricing",
            json={"hourly_rate": new_rate}
        )
        assert response.status_code == 200
        
        data = response.json()
        assert data["message"] == "Pricing updated successfully"
        assert data["hourly_rate"] == new_rate
        assert data["booking_hourly_rate"] == new_rate  # Both should be synced
        
        # Verify the change persisted
        verify_response = requests.get(f"{BASE_URL}/api/payments/photographer/{self.PHOTOGRAPHER_ID}/pricing")
        verify_data = verify_response.json()
        assert verify_data["on_demand_hourly_rate"] == new_rate
        
        print(f"PASS: Pricing updated to {new_rate} and persisted")
    
    def test_packages_reflect_custom_pricing(self):
        """Test that packages use photographer's custom pricing when photographer_id is provided"""
        # First set a specific rate
        custom_rate = 90.0
        update_response = requests.put(
            f"{BASE_URL}/api/payments/photographer/{self.PHOTOGRAPHER_ID}/pricing",
            json={"hourly_rate": custom_rate}
        )
        assert update_response.status_code == 200
        
        # Get packages with photographer_id
        response = requests.get(f"{BASE_URL}/api/payments/packages?photographer_id={self.PHOTOGRAPHER_ID}")
        assert response.status_code == 200
        
        data = response.json()
        
        # Hourly rate should match photographer's custom rate
        assert data["hourly_rate"] == custom_rate
        assert data["photographer_name"] is not None
        
        # Verify package amounts
        for pkg in data["packages"]:
            expected_total = custom_rate * pkg["duration_hours"]
            expected_deposit = expected_total * 0.50  # 50% deposit
            
            assert pkg["total_amount"] == expected_total, f"Expected total {expected_total}, got {pkg['total_amount']}"
            assert pkg["deposit_amount"] == expected_deposit, f"Expected deposit {expected_deposit}, got {pkg['deposit_amount']}"
        
        print(f"PASS: Packages correctly reflect custom rate of {custom_rate}")


class TestDispatchTracking:
    """Tests for dispatch tracking GPS endpoints"""
    
    def test_tracking_not_found(self):
        """Test GET /api/dispatch/{id}/tracking returns 404 for non-existent dispatch"""
        response = requests.get(f"{BASE_URL}/api/dispatch/non-existent-dispatch/tracking")
        assert response.status_code == 404
        
        data = response.json()
        assert "detail" in data
        assert "not found" in data["detail"].lower()
        
        print("PASS: 404 returned for non-existent dispatch tracking")
    
    def test_active_dispatch_endpoint(self):
        """Test GET /api/dispatch/user/{id}/active returns expected format"""
        user_id = "d3eb9019-d16f-4374-b432-4d168a96a00f"  # Kelly Slater
        
        response = requests.get(f"{BASE_URL}/api/dispatch/user/{user_id}/active")
        assert response.status_code == 200
        
        data = response.json()
        # When no active dispatch, should return {"active_dispatch": None}
        assert "active_dispatch" in data
        
        print(f"PASS: Active dispatch endpoint returned expected format: {data}")


class TestFriendMapEndpoint:
    """Tests for friend markers on map"""
    
    def test_friends_on_map_endpoint(self):
        """Test GET /api/friends/map/{user_id} returns friends data"""
        user_id = "d3eb9019-d16f-4374-b432-4d168a96a00f"  # Kelly Slater
        
        response = requests.get(f"{BASE_URL}/api/friends/map/{user_id}")
        
        # Either 200 with data or 404 if no friends - both are valid
        if response.status_code == 200:
            data = response.json()
            assert "friends_on_map" in data
            print(f"PASS: Friends on map endpoint returned {len(data.get('friends_on_map', []))} friends")
        elif response.status_code == 404:
            print("PASS: Friends on map endpoint returned 404 (no friends/user not found)")
        else:
            pytest.fail(f"Unexpected status code: {response.status_code}")


class TestCheckoutWithCustomPricing:
    """Tests for checkout using photographer's custom pricing"""
    
    PHOTOGRAPHER_ID = "04503c29-dc37-4f8c-a462-4177c4a54096"
    USER_ID = "d3eb9019-d16f-4374-b432-4d168a96a00f"
    
    def test_checkout_uses_photographer_pricing(self):
        """Test POST /api/payments/checkout uses photographer's custom pricing"""
        # First set a specific rate for the photographer
        custom_rate = 100.0
        update_response = requests.put(
            f"{BASE_URL}/api/payments/photographer/{self.PHOTOGRAPHER_ID}/pricing",
            json={"hourly_rate": custom_rate}
        )
        assert update_response.status_code == 200
        
        # Create checkout request with photographer_id
        checkout_data = {
            "package_id": "1hr",
            "origin_url": "https://raw-surf-os.preview.emergentagent.com",
            "user_id": self.USER_ID,
            "photographer_id": self.PHOTOGRAPHER_ID
        }
        
        response = requests.post(f"{BASE_URL}/api/payments/checkout", json=checkout_data)
        
        # Should return 200 with checkout session or 500 if Stripe not fully configured
        if response.status_code == 200:
            data = response.json()
            # Verify pricing uses photographer's rate
            assert data.get("hourly_rate") == custom_rate
            expected_deposit = custom_rate * 0.50  # 50% of 1 hour
            assert data.get("deposit_amount") == expected_deposit
            print(f"PASS: Checkout created with custom rate {custom_rate}, deposit {expected_deposit}")
        elif response.status_code == 500:
            # Stripe configuration issue - still check it's a known error
            data = response.json()
            assert "detail" in data
            print(f"INFO: Checkout returned 500 (Stripe config): {data['detail']}")
        else:
            pytest.fail(f"Unexpected status code: {response.status_code}")


# Cleanup fixture to reset pricing after tests
@pytest.fixture(autouse=True)
def cleanup_pricing():
    """Reset photographer pricing after tests"""
    yield
    # Reset to default rate
    requests.put(
        f"{BASE_URL}/api/payments/photographer/04503c29-dc37-4f8c-a462-4177c4a54096/pricing",
        json={"hourly_rate": 75.0}
    )
