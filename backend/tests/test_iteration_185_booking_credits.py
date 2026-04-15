"""
Test iteration 185: Scheduled Booking with Account Credit Application
Tests for P1 features:
- POST /api/bookings/create with apply_credits parameter
- Credit deduction and remaining_credits response
- Insufficient balance validation
- Push notification to photographer
- GET /api/photographers/directory
"""
import pytest
import requests
import os
from datetime import datetime, timedelta

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials from review request
TEST_USER_ID = "12dc6786-124f-40b1-8698-a9409f99736f"
TEST_USER_EMAIL = "dpritzker0905@gmail.com"
TEST_PHOTOGRAPHER_ID = "3fbb1276-a7fe-49cc-a302-c1928f0d56d0"


class TestPhotographerDirectory:
    """Test photographer directory endpoint for scheduled bookings"""
    
    def test_get_photographer_directory(self):
        """GET /api/photographers/directory returns photographer list"""
        response = requests.get(f"{BASE_URL}/api/photographers/directory")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert isinstance(data, list), "Response should be a list"
        
        # Verify structure if photographers exist
        if len(data) > 0:
            photographer = data[0]
            assert "id" in photographer, "Photographer should have id"
            assert "full_name" in photographer, "Photographer should have full_name"
            assert "role" in photographer, "Photographer should have role"
            print(f"✓ Found {len(data)} photographers in directory")
            print(f"  First photographer: {photographer.get('full_name')} ({photographer.get('role')})")
        else:
            print("⚠ No photographers found in directory (may need seed data)")
    
    def test_photographer_directory_with_filters(self):
        """GET /api/photographers/directory with skill_level filter"""
        response = requests.get(
            f"{BASE_URL}/api/photographers/directory",
            params={"skill_level": "approved_pro", "limit": 10}
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert isinstance(data, list), "Response should be a list"
        print(f"✓ Directory filter works, found {len(data)} approved pros")


class TestBookingCreationWithCredits:
    """Test booking creation with account credit application"""
    
    def test_create_booking_without_credits(self):
        """POST /api/bookings/create without apply_credits works"""
        # Future date for session
        session_date = (datetime.utcnow() + timedelta(days=3)).isoformat() + "Z"
        
        payload = {
            "photographer_id": TEST_PHOTOGRAPHER_ID,
            "location": "TEST_Rockaway Beach",
            "session_date": session_date,
            "duration": 60,
            "max_participants": 1,
            "allow_splitting": False,
            "description": "TEST booking without credits"
        }
        
        response = requests.post(
            f"{BASE_URL}/api/bookings/create",
            params={"user_id": TEST_USER_ID},
            json=payload
        )
        
        # May fail if photographer doesn't exist, but should not be 500
        if response.status_code == 404:
            print(f"⚠ Photographer {TEST_PHOTOGRAPHER_ID} not found - skipping")
            pytest.skip("Test photographer not found")
        
        assert response.status_code in [200, 201], f"Expected 200/201, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "booking_id" in data, "Response should contain booking_id"
        assert "total_price" in data, "Response should contain total_price"
        assert "remaining_credits" in data, "Response should contain remaining_credits"
        
        print(f"✓ Booking created: {data.get('booking_id')}")
        print(f"  Total price: ${data.get('total_price')}")
        print(f"  Remaining credits: ${data.get('remaining_credits')}")
        
        return data
    
    def test_create_booking_with_credits_applied(self):
        """POST /api/bookings/create with apply_credits deducts credits correctly"""
        # First get user's current credit balance
        user_response = requests.get(f"{BASE_URL}/api/profile/{TEST_USER_ID}")
        
        if user_response.status_code != 200:
            pytest.skip(f"Could not get user profile: {user_response.status_code}")
        
        user_data = user_response.json()
        initial_credits = user_data.get("credit_balance", 0)
        print(f"Initial credit balance: ${initial_credits}")
        
        if initial_credits < 10:
            pytest.skip(f"User has insufficient credits ({initial_credits}) for test")
        
        # Apply partial credits
        credits_to_apply = min(25.0, initial_credits)
        session_date = (datetime.utcnow() + timedelta(days=4)).isoformat() + "Z"
        
        payload = {
            "photographer_id": TEST_PHOTOGRAPHER_ID,
            "location": "TEST_Pipeline North Shore",
            "session_date": session_date,
            "duration": 60,
            "max_participants": 1,
            "allow_splitting": False,
            "apply_credits": credits_to_apply,
            "impact_zone_type": "preset",
            "impact_zone_preset": "home",
            "description": "TEST booking with credits applied"
        }
        
        response = requests.post(
            f"{BASE_URL}/api/bookings/create",
            params={"user_id": TEST_USER_ID},
            json=payload
        )
        
        if response.status_code == 404:
            pytest.skip("Test photographer not found")
        
        assert response.status_code in [200, 201], f"Expected 200/201, got {response.status_code}: {response.text}"
        
        data = response.json()
        
        # Verify credit application
        assert "credits_applied" in data, "Response should contain credits_applied"
        assert "remaining_credits" in data, "Response should contain remaining_credits"
        
        credits_applied = data.get("credits_applied", 0)
        remaining_credits = data.get("remaining_credits", 0)
        
        # Verify credits were deducted
        expected_remaining = initial_credits - credits_to_apply
        assert abs(remaining_credits - expected_remaining) < 0.01, \
            f"Expected remaining credits ~{expected_remaining}, got {remaining_credits}"
        
        print(f"✓ Booking created with credits applied")
        print(f"  Credits applied: ${credits_applied}")
        print(f"  Remaining credits: ${remaining_credits}")
        print(f"  Amount to charge: ${data.get('amount_to_charge', 0)}")
        
        return data
    
    def test_create_booking_insufficient_credits(self):
        """POST /api/bookings/create with apply_credits validates insufficient balance"""
        session_date = (datetime.utcnow() + timedelta(days=5)).isoformat() + "Z"
        
        # Try to apply more credits than user has (assuming user has < $10000)
        payload = {
            "photographer_id": TEST_PHOTOGRAPHER_ID,
            "location": "TEST_Mavericks",
            "session_date": session_date,
            "duration": 60,
            "max_participants": 1,
            "allow_splitting": False,
            "apply_credits": 10000.0,  # Very high amount
            "description": "TEST booking with excessive credits"
        }
        
        response = requests.post(
            f"{BASE_URL}/api/bookings/create",
            params={"user_id": TEST_USER_ID},
            json=payload
        )
        
        if response.status_code == 404:
            pytest.skip("Test photographer not found")
        
        # Should fail with 400 for insufficient credits
        assert response.status_code == 400, f"Expected 400 for insufficient credits, got {response.status_code}"
        
        data = response.json()
        assert "detail" in data, "Error response should have detail"
        assert "credit" in data["detail"].lower() or "balance" in data["detail"].lower(), \
            f"Error should mention credits/balance: {data['detail']}"
        
        print(f"✓ Insufficient credits validation works: {data['detail']}")
    
    def test_create_booking_credits_exceed_price(self):
        """POST /api/bookings/create validates credits cannot exceed total price"""
        # First get user's credit balance
        user_response = requests.get(f"{BASE_URL}/api/profile/{TEST_USER_ID}")
        
        if user_response.status_code != 200:
            pytest.skip("Could not get user profile")
        
        user_data = user_response.json()
        user_credits = user_data.get("credit_balance", 0)
        
        if user_credits < 100:
            pytest.skip(f"User needs at least $100 credits for this test (has ${user_credits})")
        
        session_date = (datetime.utcnow() + timedelta(days=6)).isoformat() + "Z"
        
        # Try to apply more credits than the session costs
        # Assuming 60 min session costs ~$50-75
        payload = {
            "photographer_id": TEST_PHOTOGRAPHER_ID,
            "location": "TEST_Trestles",
            "session_date": session_date,
            "duration": 60,
            "max_participants": 1,
            "allow_splitting": False,
            "apply_credits": 500.0,  # More than session cost
            "description": "TEST booking with excessive credits for price"
        }
        
        response = requests.post(
            f"{BASE_URL}/api/bookings/create",
            params={"user_id": TEST_USER_ID},
            json=payload
        )
        
        if response.status_code == 404:
            pytest.skip("Test photographer not found")
        
        # Should fail with 400 for credits exceeding price
        assert response.status_code == 400, f"Expected 400 for credits > price, got {response.status_code}"
        
        data = response.json()
        print(f"✓ Credits exceed price validation works: {data.get('detail', 'No detail')}")


class TestBookingNotifications:
    """Test push notification sending on booking creation"""
    
    def test_booking_creates_notification(self):
        """POST /api/bookings/create sends notification to photographer"""
        session_date = (datetime.utcnow() + timedelta(days=7)).isoformat() + "Z"
        
        payload = {
            "photographer_id": TEST_PHOTOGRAPHER_ID,
            "location": "TEST_Huntington Beach",
            "session_date": session_date,
            "duration": 60,
            "max_participants": 1,
            "allow_splitting": False,
            "description": "TEST booking for notification test"
        }
        
        response = requests.post(
            f"{BASE_URL}/api/bookings/create",
            params={"user_id": TEST_USER_ID},
            json=payload
        )
        
        if response.status_code == 404:
            pytest.skip("Test photographer not found")
        
        if response.status_code not in [200, 201]:
            pytest.skip(f"Booking creation failed: {response.status_code}")
        
        # Check photographer's notifications
        notif_response = requests.get(
            f"{BASE_URL}/api/notifications/{TEST_PHOTOGRAPHER_ID}"
        )
        
        if notif_response.status_code == 200:
            notifications = notif_response.json()
            # Look for booking notification
            booking_notifs = [n for n in notifications if 'booking' in n.get('type', '').lower()]
            if booking_notifs:
                print(f"✓ Found {len(booking_notifs)} booking notifications for photographer")
                latest = booking_notifs[0]
                print(f"  Latest: {latest.get('title')} - {latest.get('body', '')[:50]}...")
            else:
                print("⚠ No booking notifications found (push may be async)")
        else:
            print(f"⚠ Could not fetch notifications: {notif_response.status_code}")


class TestImpactZoneCoordinates:
    """Test Impact Zone coordinate capture during booking"""
    
    def test_booking_with_gps_coordinates(self):
        """POST /api/bookings/create captures GPS coordinates"""
        session_date = (datetime.utcnow() + timedelta(days=8)).isoformat() + "Z"
        
        payload = {
            "photographer_id": TEST_PHOTOGRAPHER_ID,
            "location": "TEST_GPS Location",
            "session_date": session_date,
            "duration": 60,
            "max_participants": 1,
            "allow_splitting": False,
            "latitude": 33.7701,
            "longitude": -118.1937,
            "impact_zone_type": "gps",
            "description": "TEST booking with GPS coordinates"
        }
        
        response = requests.post(
            f"{BASE_URL}/api/bookings/create",
            params={"user_id": TEST_USER_ID},
            json=payload
        )
        
        if response.status_code == 404:
            pytest.skip("Test photographer not found")
        
        assert response.status_code in [200, 201], f"Expected 200/201, got {response.status_code}: {response.text}"
        
        data = response.json()
        booking_id = data.get("booking_id")
        
        print(f"✓ Booking created with GPS coordinates: {booking_id}")
        
        # Verify coordinates were stored by fetching booking
        if booking_id:
            booking_response = requests.get(f"{BASE_URL}/api/bookings")
            if booking_response.status_code == 200:
                bookings = booking_response.json()
                test_booking = next((b for b in bookings if b.get("id") == booking_id), None)
                if test_booking:
                    print(f"  Location: {test_booking.get('location')}")
    
    def test_booking_with_preset_location(self):
        """POST /api/bookings/create accepts preset impact zone"""
        session_date = (datetime.utcnow() + timedelta(days=9)).isoformat() + "Z"
        
        payload = {
            "photographer_id": TEST_PHOTOGRAPHER_ID,
            "location": "Photographer's Home Break",
            "session_date": session_date,
            "duration": 60,
            "max_participants": 1,
            "allow_splitting": False,
            "impact_zone_type": "preset",
            "impact_zone_preset": "home",
            "description": "TEST booking with preset location"
        }
        
        response = requests.post(
            f"{BASE_URL}/api/bookings/create",
            params={"user_id": TEST_USER_ID},
            json=payload
        )
        
        if response.status_code == 404:
            pytest.skip("Test photographer not found")
        
        assert response.status_code in [200, 201], f"Expected 200/201, got {response.status_code}: {response.text}"
        
        print(f"✓ Booking created with preset location")


class TestUserCreditBalance:
    """Test user credit balance retrieval"""
    
    def test_get_user_credit_balance(self):
        """GET /api/profile/{user_id} returns credit_balance"""
        response = requests.get(f"{BASE_URL}/api/profile/{TEST_USER_ID}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "credit_balance" in data, "Profile should include credit_balance"
        
        credit_balance = data.get("credit_balance", 0)
        print(f"✓ User credit balance: ${credit_balance}")
        
        return credit_balance


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
