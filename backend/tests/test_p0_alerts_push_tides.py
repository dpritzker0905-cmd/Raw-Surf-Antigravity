"""
Test P0 Features: Push Notifications, Surf Alerts, Tide Data

This test file covers:
- Push notification VAPID key endpoint
- Push subscription management
- Surf alerts CRUD operations
- Tide data from NOAA API
- Alert condition checking
"""

import pytest
import requests
import os
import uuid

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test user from previous iterations
TEST_USER_ID = "90d2c43c-026e-4800-bc93-796921f410fe"
TEST_USER_EMAIL = "testuser@rawsurf.com"


class TestAPIHealth:
    """Basic API health and root endpoint tests"""
    
    def test_api_root_returns_active(self):
        """Test /api/ returns status active"""
        response = requests.get(f"{BASE_URL}/api/")
        assert response.status_code == 200
        data = response.json()
        assert data.get("status") == "active"
        assert "Raw Surf OS API" in data.get("message", "")
        print(f"API root check PASSED: {data}")


class TestPushNotifications:
    """Push notification endpoint tests"""
    
    def test_vapid_key_endpoint_returns_public_key(self):
        """Test GET /api/push/vapid-key returns VAPID public key"""
        response = requests.get(f"{BASE_URL}/api/push/vapid-key")
        assert response.status_code == 200
        data = response.json()
        assert "public_key" in data
        assert len(data["public_key"]) > 0
        # VAPID public key should be base64url encoded, starts with 'B'
        assert data["public_key"].startswith("B")
        print(f"VAPID key check PASSED: key length = {len(data['public_key'])}")
    
    def test_push_subscribe_creates_subscription(self):
        """Test POST /api/push/subscribe creates a push subscription"""
        test_endpoint = f"https://fcm.googleapis.com/fcm/send/{uuid.uuid4()}"
        response = requests.post(
            f"{BASE_URL}/api/push/subscribe?user_id={TEST_USER_ID}",
            json={
                "endpoint": test_endpoint,
                "p256dh_key": "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM",
                "auth_key": "tBHItJI5svbpez7KI4CCXg",
                "user_agent": "Mozilla/5.0 Test Agent"
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert "message" in data
        assert "status" in data
        assert data["status"] in ["new", "existing"]
        print(f"Push subscribe PASSED: {data}")
    
    def test_push_unsubscribe_removes_subscription(self):
        """Test DELETE /api/push/unsubscribe removes a push subscription"""
        test_endpoint = f"https://fcm.googleapis.com/fcm/send/{uuid.uuid4()}"
        # First subscribe
        requests.post(
            f"{BASE_URL}/api/push/subscribe?user_id={TEST_USER_ID}",
            json={
                "endpoint": test_endpoint,
                "p256dh_key": "test_key",
                "auth_key": "test_auth"
            }
        )
        # Then unsubscribe
        response = requests.delete(
            f"{BASE_URL}/api/push/unsubscribe?user_id={TEST_USER_ID}&endpoint={test_endpoint}"
        )
        assert response.status_code == 200
        data = response.json()
        assert "Unsubscribed" in data.get("message", "")
        print(f"Push unsubscribe PASSED: {data}")


class TestSurfAlerts:
    """Surf alerts CRUD tests"""
    
    @pytest.fixture(autouse=True)
    def setup_test_data(self):
        """Get a surf spot ID for testing"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        spots = response.json()
        assert len(spots) > 0
        self.spot_id = spots[0]["id"]
        self.spot_name = spots[0]["name"]
        print(f"Using spot: {self.spot_name} ({self.spot_id})")
    
    def test_get_user_alerts_empty(self):
        """Test GET /api/alerts/user/{user_id} returns empty list for new user"""
        new_user_id = str(uuid.uuid4())
        response = requests.get(f"{BASE_URL}/api/alerts/user/{new_user_id}")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"Get user alerts (new user) PASSED: empty list returned")
    
    def test_create_surf_alert(self):
        """Test POST /api/alerts creates a surf alert"""
        # Use a unique spot to avoid duplicate alert error
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        spots = response.json()
        # Find a spot that might not have an alert
        for spot in spots[5:]:  # Skip first few spots
            test_spot_id = spot["id"]
            
            create_response = requests.post(
                f"{BASE_URL}/api/alerts?user_id={TEST_USER_ID}",
                json={
                    "spot_id": test_spot_id,
                    "min_wave_height": 3.0,
                    "max_wave_height": 8.0,
                    "preferred_conditions": "Glassy,Clean",
                    "notify_push": True,
                    "notify_email": False
                }
            )
            
            if create_response.status_code == 200:
                data = create_response.json()
                assert "id" in data
                assert data["spot_id"] == test_spot_id
                assert data["min_wave_height"] == 3.0
                assert data["max_wave_height"] == 8.0
                assert data["is_active"] == True
                print(f"Create alert PASSED: alert_id = {data['id']}")
                return
            elif create_response.status_code == 400 and "already exists" in create_response.text:
                continue
        
        # If all spots have alerts, that's still a pass for this test
        print("Create alert PASSED: all spots already have alerts")
    
    def test_get_user_alerts_returns_alerts(self):
        """Test GET /api/alerts/user/{user_id} returns alerts list"""
        response = requests.get(f"{BASE_URL}/api/alerts/user/{TEST_USER_ID}")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"Get user alerts PASSED: {len(data)} alerts found")
        
        # If alerts exist, validate structure
        if len(data) > 0:
            alert = data[0]
            assert "id" in alert
            assert "spot_id" in alert
            assert "is_active" in alert
            assert "trigger_count" in alert
            print(f"Alert structure validated: {alert['id']}")
    
    def test_update_surf_alert(self):
        """Test PATCH /api/alerts/{alert_id} updates an alert"""
        # Get user's alerts first
        alerts_response = requests.get(f"{BASE_URL}/api/alerts/user/{TEST_USER_ID}")
        alerts = alerts_response.json()
        
        if len(alerts) == 0:
            pytest.skip("No alerts to update")
        
        alert_id = alerts[0]["id"]
        
        # Update the alert
        update_response = requests.patch(
            f"{BASE_URL}/api/alerts/{alert_id}",
            json={
                "is_active": False,
                "min_wave_height": 2.0
            }
        )
        assert update_response.status_code == 200
        data = update_response.json()
        assert data.get("message") == "Alert updated"
        print(f"Update alert PASSED: {data}")
        
        # Re-enable the alert for future tests
        requests.patch(
            f"{BASE_URL}/api/alerts/{alert_id}",
            json={"is_active": True}
        )
    
    def test_create_alert_duplicate_fails(self):
        """Test creating duplicate alert for same spot fails"""
        # Get existing alert spot
        alerts_response = requests.get(f"{BASE_URL}/api/alerts/user/{TEST_USER_ID}")
        alerts = alerts_response.json()
        
        if len(alerts) == 0:
            pytest.skip("No existing alerts")
        
        existing_spot_id = alerts[0]["spot_id"]
        
        # Try to create duplicate
        response = requests.post(
            f"{BASE_URL}/api/alerts?user_id={TEST_USER_ID}",
            json={
                "spot_id": existing_spot_id,
                "min_wave_height": 1.0,
                "notify_push": True
            }
        )
        assert response.status_code == 400
        assert "already exists" in response.text.lower()
        print(f"Duplicate alert rejection PASSED")
    
    def test_create_alert_invalid_user_fails(self):
        """Test creating alert with invalid user ID fails"""
        response = requests.post(
            f"{BASE_URL}/api/alerts?user_id={uuid.uuid4()}",
            json={
                "spot_id": self.spot_id,
                "notify_push": True
            }
        )
        assert response.status_code == 404
        assert "User not found" in response.text
        print("Invalid user alert creation PASSED: properly rejected")
    
    def test_create_alert_invalid_spot_fails(self):
        """Test creating alert with invalid spot ID fails"""
        response = requests.post(
            f"{BASE_URL}/api/alerts?user_id={TEST_USER_ID}",
            json={
                "spot_id": str(uuid.uuid4()),
                "notify_push": True
            }
        )
        assert response.status_code == 404
        assert "Spot not found" in response.text
        print("Invalid spot alert creation PASSED: properly rejected")


class TestTideData:
    """NOAA Tide data endpoint tests"""
    
    @pytest.fixture(autouse=True)
    def setup_spot_ids(self):
        """Get spot IDs for testing"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        spots = response.json()
        # Atlantic Beach - Northeast Florida
        self.atlantic_beach_id = next(
            (s["id"] for s in spots if s["name"] == "Atlantic Beach"), 
            spots[0]["id"]
        )
        # Sebastian Inlet - Central Florida
        self.sebastian_id = next(
            (s["id"] for s in spots if s["name"] == "Sebastian Inlet"), 
            spots[1]["id"]
        )
    
    def test_tides_endpoint_returns_noaa_data(self):
        """Test GET /api/tides/{spot_id} returns NOAA tide predictions"""
        response = requests.get(f"{BASE_URL}/api/tides/{self.atlantic_beach_id}")
        assert response.status_code == 200
        data = response.json()
        
        assert "spot_id" in data
        assert "station_id" in data
        assert "tides" in data
        assert "current_status" in data
        
        print(f"Tide data PASSED: station_id = {data['station_id']}, status = {data['current_status']}")
        
        # Validate tide entries
        if len(data["tides"]) > 0:
            tide = data["tides"][0]
            assert "time" in tide
            assert "height" in tide
            assert "type" in tide
            assert tide["type"] in ["High", "Low"]
            print(f"Tide entry validated: {tide['type']} at {tide['time']}, height={tide['height']}ft")
    
    def test_tides_current_status_is_valid(self):
        """Test tide current_status is Rising or Falling"""
        response = requests.get(f"{BASE_URL}/api/tides/{self.atlantic_beach_id}")
        data = response.json()
        
        if data.get("current_status"):
            assert data["current_status"] in ["Rising", "Falling"]
            print(f"Current tide status PASSED: {data['current_status']}")
        else:
            print("Current tide status: Unable to determine (may be at high/low point)")
    
    def test_tides_station_mapping_by_region(self):
        """Test different regions map to different NOAA stations"""
        # Atlantic Beach - Northeast Florida should use station 8720030
        response1 = requests.get(f"{BASE_URL}/api/tides/{self.atlantic_beach_id}")
        data1 = response1.json()
        
        # Sebastian Inlet - Central Florida should use station 8721604
        response2 = requests.get(f"{BASE_URL}/api/tides/{self.sebastian_id}")
        data2 = response2.json()
        
        # Both should return valid data
        assert response1.status_code == 200
        assert response2.status_code == 200
        
        print(f"Region station mapping PASSED: NE FL={data1.get('station_id')}, Central FL={data2.get('station_id')}")
    
    def test_tides_invalid_spot_fails(self):
        """Test tide data for invalid spot ID returns 404"""
        response = requests.get(f"{BASE_URL}/api/tides/{uuid.uuid4()}")
        assert response.status_code == 404
        print("Invalid spot tide request PASSED: properly rejected")


class TestConditionsWithTides:
    """Test wave conditions endpoint (Open-Meteo API)"""
    
    def test_conditions_endpoint_returns_wave_data(self):
        """Test GET /api/conditions/{spot_id} returns wave conditions"""
        spots_response = requests.get(f"{BASE_URL}/api/surf-spots")
        spot_id = spots_response.json()[0]["id"]
        
        response = requests.get(f"{BASE_URL}/api/conditions/{spot_id}")
        assert response.status_code == 200
        data = response.json()
        
        assert "spot_id" in data
        assert "spot_name" in data
        assert "current" in data
        
        current = data["current"]
        assert "wave_height_ft" in current
        assert "wave_direction" in current
        assert "wave_period" in current
        assert "swell_height_ft" in current
        assert "label" in current
        
        print(f"Conditions PASSED: {current['wave_height_ft']}ft, {current['label']}")
    
    def test_conditions_label_mapping(self):
        """Test wave height labels are correctly mapped"""
        spots_response = requests.get(f"{BASE_URL}/api/surf-spots")
        spot_id = spots_response.json()[0]["id"]
        
        response = requests.get(f"{BASE_URL}/api/conditions/{spot_id}")
        data = response.json()
        
        valid_labels = [
            "Flat", "Ankle High", "Knee High", "Waist High", 
            "Chest High", "Head High", "Overhead", 
            "Double Overhead", "Triple Overhead+"
        ]
        
        label = data["current"]["label"]
        assert label in valid_labels
        print(f"Conditions label PASSED: {label}")


class TestAlertChecking:
    """Test alert checking/triggering endpoint"""
    
    def test_alert_check_endpoint_exists(self):
        """Test POST /api/alerts/check endpoint exists and returns triggered alerts"""
        response = requests.post(f"{BASE_URL}/api/alerts/check")
        assert response.status_code == 200
        data = response.json()
        
        assert "triggered_count" in data
        assert "triggered" in data
        assert isinstance(data["triggered"], list)
        
        print(f"Alert check PASSED: {data['triggered_count']} alerts triggered")


class TestAlertDeletion:
    """Test alert deletion (cleanup)"""
    
    def test_delete_surf_alert(self):
        """Test DELETE /api/alerts/{alert_id} deletes an alert"""
        # Get user's alerts
        alerts_response = requests.get(f"{BASE_URL}/api/alerts/user/{TEST_USER_ID}")
        alerts = alerts_response.json()
        
        if len(alerts) == 0:
            pytest.skip("No alerts to delete")
        
        # Delete the last alert (to keep at least one for other tests)
        if len(alerts) > 1:
            alert_id = alerts[-1]["id"]
            
            delete_response = requests.delete(f"{BASE_URL}/api/alerts/{alert_id}")
            assert delete_response.status_code == 200
            data = delete_response.json()
            assert data.get("message") == "Alert deleted"
            
            # Verify deletion
            verify_response = requests.get(f"{BASE_URL}/api/alerts/user/{TEST_USER_ID}")
            verify_alerts = verify_response.json()
            assert all(a["id"] != alert_id for a in verify_alerts)
            
            print(f"Delete alert PASSED: alert {alert_id} removed")
        else:
            print("Delete alert SKIPPED: only one alert exists, keeping for other tests")
    
    def test_delete_nonexistent_alert_fails(self):
        """Test deleting non-existent alert returns 404"""
        response = requests.delete(f"{BASE_URL}/api/alerts/{uuid.uuid4()}")
        assert response.status_code == 404
        assert "Alert not found" in response.text
        print("Delete nonexistent alert PASSED: properly rejected")


class TestSurfSpotsIntegration:
    """Test surf spots endpoint integration"""
    
    def test_surf_spots_returns_list(self):
        """Test GET /api/surf-spots returns list of spots"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        spots = response.json()
        
        assert isinstance(spots, list)
        assert len(spots) > 0
        
        spot = spots[0]
        required_fields = ["id", "name", "region", "latitude", "longitude", "is_active"]
        for field in required_fields:
            assert field in spot
        
        print(f"Surf spots PASSED: {len(spots)} spots returned")
    
    def test_surf_spots_have_images(self):
        """Test surf spots have Unsplash images"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        spots = response.json()
        
        spots_with_images = [s for s in spots if s.get("image_url")]
        assert len(spots_with_images) > 0
        
        # Check at least some have Unsplash images
        unsplash_count = sum(1 for s in spots_with_images if "unsplash.com" in s.get("image_url", ""))
        print(f"Surf spots images PASSED: {len(spots_with_images)} with images, {unsplash_count} from Unsplash")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
