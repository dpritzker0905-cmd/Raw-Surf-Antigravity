"""
Test file for Photographer Bookings Manager and Live Sessions Manager APIs
Tests: GET/POST photographer bookings, PATCH booking status, Go Live/End Session, Live photographers
"""
import pytest
import requests
import os
from datetime import datetime, timedelta

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://raw-surf-os.preview.emergentagent.com')

# Test credentials
PHOTOGRAPHER_EMAIL = "test-photographer@test.com"
PHOTOGRAPHER_PASSWORD = "test123"
SURFER_EMAIL = "test-shaka@test.com"
SURFER_PASSWORD = "test123"


@pytest.fixture(scope="module")
def api_client():
    """Shared requests session"""
    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})
    return session


@pytest.fixture(scope="module")
def photographer_user(api_client):
    """Login and get photographer user"""
    response = api_client.post(f"{BASE_URL}/api/auth/login", json={
        "email": PHOTOGRAPHER_EMAIL,
        "password": PHOTOGRAPHER_PASSWORD
    })
    if response.status_code == 200:
        return response.json()
    pytest.skip(f"Photographer login failed: {response.status_code} - {response.text}")


@pytest.fixture(scope="module")
def surfer_user(api_client):
    """Login and get surfer user"""
    response = api_client.post(f"{BASE_URL}/api/auth/login", json={
        "email": SURFER_EMAIL,
        "password": SURFER_PASSWORD
    })
    if response.status_code == 200:
        return response.json()
    pytest.skip(f"Surfer login failed: {response.status_code} - {response.text}")


class TestPhotographerBookingsAPI:
    """Tests for Photographer Bookings Manager APIs"""
    
    def test_get_photographer_bookings(self, api_client, photographer_user):
        """GET /api/photographer/{id}/bookings - Get photographer bookings"""
        photographer_id = photographer_user.get("user", {}).get("id") or photographer_user.get("id")
        
        response = api_client.get(f"{BASE_URL}/api/photographer/{photographer_id}/bookings")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert isinstance(data, list), "Response should be a list"
        
        print(f"✅ GET photographer bookings: {len(data)} bookings found")
        
        # Verify structure if bookings exist
        if len(data) > 0:
            booking = data[0]
            expected_fields = ["id", "photographer_id", "location", "session_date", "status", 
                            "max_participants", "allow_splitting", "split_mode"]
            for field in expected_fields:
                assert field in booking, f"Missing field: {field}"
            print(f"✅ Booking structure verified: {list(booking.keys())}")
    
    
    def test_create_booking_session(self, api_client, photographer_user):
        """POST /api/photographer/{id}/bookings - Create new booking session"""
        photographer_id = photographer_user.get("user", {}).get("id") or photographer_user.get("id")
        
        # Create a booking for tomorrow
        tomorrow = (datetime.now() + timedelta(days=1)).isoformat()
        
        booking_data = {
            "location": "TEST_Pipeline_North_Shore",
            "session_date": tomorrow,
            "duration": 90,
            "max_participants": 4,
            "price_per_person": 30.0,
            "description": "Test booking from automated tests",
            "allow_splitting": True,
            "split_mode": "friends_only"
        }
        
        response = api_client.post(f"{BASE_URL}/api/photographer/{photographer_id}/bookings", json=booking_data)
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data.get("id"), "Booking should have an ID"
        assert data.get("location") == "TEST_Pipeline_North_Shore", "Location mismatch"
        assert data.get("allow_splitting") == True, "allow_splitting should be True"
        assert data.get("split_mode") == "friends_only", "split_mode should be friends_only"
        assert data.get("status") == "Confirmed", "Photographer-created bookings should be auto-confirmed"
        
        # Should have invite code if splitting is allowed
        assert data.get("invite_code"), "Should have invite code when allow_splitting is True"
        assert len(data.get("invite_code", "")) == 6, "Invite code should be 6 characters"
        
        print(f"✅ Created booking: {data.get('id')} with invite code: {data.get('invite_code')}")
        
        # Store for cleanup
        return data
    
    
    def test_create_booking_open_nearby_mode(self, api_client, photographer_user):
        """POST /api/photographer/{id}/bookings - Create booking with open_nearby mode"""
        photographer_id = photographer_user.get("user", {}).get("id") or photographer_user.get("id")
        
        # Create a booking for day after tomorrow
        future_date = (datetime.now() + timedelta(days=2)).isoformat()
        
        booking_data = {
            "location": "TEST_Sunset_Beach",
            "session_date": future_date,
            "duration": 60,
            "max_participants": 8,
            "price_per_person": 25.0,
            "allow_splitting": True,
            "split_mode": "open_nearby",
            "latitude": 21.6777,
            "longitude": -158.0392,
            "proximity_radius": 10.0
        }
        
        response = api_client.post(f"{BASE_URL}/api/photographer/{photographer_id}/bookings", json=booking_data)
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data.get("split_mode") == "open_nearby", "split_mode should be open_nearby"
        assert data.get("invite_code"), "Should have invite code for open_nearby mode"
        
        print(f"✅ Created open_nearby booking: {data.get('id')}")
        
        return data
    
    
    def test_update_booking_status(self, api_client, photographer_user):
        """PATCH /api/bookings/{id}/status - Update booking status"""
        photographer_id = photographer_user.get("user", {}).get("id") or photographer_user.get("id")
        
        # First create a booking
        tomorrow = (datetime.now() + timedelta(days=3)).isoformat()
        booking_data = {
            "location": "TEST_Status_Test_Location",
            "session_date": tomorrow,
            "duration": 60,
            "max_participants": 2,
            "price_per_person": 25.0,
            "allow_splitting": False
        }
        
        create_response = api_client.post(f"{BASE_URL}/api/photographer/{photographer_id}/bookings", json=booking_data)
        assert create_response.status_code == 200, f"Failed to create booking: {create_response.text}"
        
        booking_id = create_response.json().get("id")
        
        # Test updating status to Cancelled
        update_response = api_client.patch(f"{BASE_URL}/api/bookings/{booking_id}/status", json={
            "status": "Cancelled"
        })
        
        assert update_response.status_code == 200, f"Expected 200, got {update_response.status_code}: {update_response.text}"
        
        data = update_response.json()
        assert data.get("status") == "Cancelled", f"Status should be Cancelled, got {data.get('status')}"
        
        print(f"✅ Updated booking {booking_id} status to Cancelled")
    
    
    def test_update_booking_status_invalid(self, api_client, photographer_user):
        """PATCH /api/bookings/{id}/status - Test invalid status value"""
        photographer_id = photographer_user.get("user", {}).get("id") or photographer_user.get("id")
        
        # First create a booking
        tomorrow = (datetime.now() + timedelta(days=4)).isoformat()
        booking_data = {
            "location": "TEST_Invalid_Status_Test",
            "session_date": tomorrow,
            "duration": 60,
            "max_participants": 2,
            "price_per_person": 25.0
        }
        
        create_response = api_client.post(f"{BASE_URL}/api/photographer/{photographer_id}/bookings", json=booking_data)
        assert create_response.status_code == 200, f"Failed to create booking: {create_response.text}"
        
        booking_id = create_response.json().get("id")
        
        # Test invalid status
        update_response = api_client.patch(f"{BASE_URL}/api/bookings/{booking_id}/status", json={
            "status": "InvalidStatus"
        })
        
        assert update_response.status_code == 400, f"Expected 400 for invalid status, got {update_response.status_code}"
        
        print(f"✅ Invalid status rejected with 400")


class TestLiveSessionsAPI:
    """Tests for Live Sessions Manager APIs"""
    
    def test_get_active_session_none(self, api_client, photographer_user):
        """GET /api/photographer/{id}/active-session - Get active session (no session)"""
        photographer_id = photographer_user.get("user", {}).get("id") or photographer_user.get("id")
        
        response = api_client.get(f"{BASE_URL}/api/photographer/{photographer_id}/active-session")
        
        # Can be 200 with null/empty or the session data
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        print(f"✅ Active session check: {'Session active' if data else 'No active session'}")
    
    
    def test_get_live_photographers(self, api_client):
        """GET /api/photographers/live - Get all live photographers"""
        response = api_client.get(f"{BASE_URL}/api/photographers/live")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert isinstance(data, list), "Response should be a list"
        
        print(f"✅ Live photographers: {len(data)} currently shooting")
        
        # Verify structure if any are live
        if len(data) > 0:
            photographer = data[0]
            expected_fields = ["id", "full_name", "location", "session_price"]
            for field in expected_fields:
                assert field in photographer, f"Missing field: {field}"
            print(f"✅ Live photographer structure verified")
    
    
    def test_get_live_photographers_with_coords(self, api_client):
        """GET /api/photographers/live - With coordinates filter"""
        response = api_client.get(
            f"{BASE_URL}/api/photographers/live",
            params={
                "latitude": 21.6777,
                "longitude": -158.0392,
                "radius": 50
            }
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        print(f"✅ Live photographers near coords: {len(data)} found")


class TestUserBookingsAPI:
    """Tests for User Bookings APIs"""
    
    def test_get_all_bookings(self, api_client):
        """GET /api/bookings - Get all bookings"""
        response = api_client.get(f"{BASE_URL}/api/bookings")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert isinstance(data, list), "Response should be a list"
        
        print(f"✅ All bookings: {len(data)} total")
    
    
    def test_get_user_bookings(self, api_client, surfer_user):
        """GET /api/bookings/user/{id} - Get user's bookings"""
        user_id = surfer_user.get("user", {}).get("id") or surfer_user.get("id")
        
        response = api_client.get(f"{BASE_URL}/api/bookings/user/{user_id}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert isinstance(data, list), "Response should be a list"
        
        print(f"✅ User bookings: {len(data)} for surfer")
    
    
    def test_get_user_live_sessions(self, api_client, surfer_user):
        """GET /api/sessions/user/{id} - Get user's live sessions"""
        user_id = surfer_user.get("user", {}).get("id") or surfer_user.get("id")
        
        response = api_client.get(f"{BASE_URL}/api/sessions/user/{user_id}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert isinstance(data, list), "Response should be a list"
        
        print(f"✅ User live sessions: {len(data)}")
    
    
    def test_get_user_invites(self, api_client, surfer_user):
        """GET /api/bookings/invites/{id} - Get user's pending invites"""
        user_id = surfer_user.get("user", {}).get("id") or surfer_user.get("id")
        
        response = api_client.get(f"{BASE_URL}/api/bookings/invites/{user_id}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert isinstance(data, list), "Response should be a list"
        
        print(f"✅ User pending invites: {len(data)}")


class TestJoinByCodeAPI:
    """Tests for Join by Invite Code functionality"""
    
    def test_join_by_invalid_code(self, api_client, surfer_user):
        """POST /api/bookings/join-by-code - Invalid invite code"""
        user_id = surfer_user.get("user", {}).get("id") or surfer_user.get("id")
        
        response = api_client.post(
            f"{BASE_URL}/api/bookings/join-by-code",
            params={
                "user_id": user_id,
                "invite_code": "INVALID"
            }
        )
        
        assert response.status_code == 404, f"Expected 404 for invalid code, got {response.status_code}"
        
        print(f"✅ Invalid invite code rejected with 404")


class TestCleanup:
    """Cleanup test data"""
    
    def test_cleanup_test_bookings(self, api_client, photographer_user):
        """Clean up test bookings created during tests"""
        photographer_id = photographer_user.get("user", {}).get("id") or photographer_user.get("id")
        
        # Get all bookings
        response = api_client.get(f"{BASE_URL}/api/photographer/{photographer_id}/bookings")
        
        if response.status_code == 200:
            bookings = response.json()
            test_bookings = [b for b in bookings if "TEST_" in b.get("location", "")]
            
            for booking in test_bookings:
                cancel_response = api_client.patch(
                    f"{BASE_URL}/api/bookings/{booking['id']}/status",
                    json={"status": "Cancelled"}
                )
                if cancel_response.status_code == 200:
                    print(f"✅ Cancelled test booking: {booking['id']}")
        
        print(f"✅ Cleanup completed")
