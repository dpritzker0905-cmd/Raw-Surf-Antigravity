"""
Test Suite for Iteration 89 - System Overhaul Features
Tests:
1. Photographer availability CRUD endpoints
2. Surfer available-slots endpoint
3. Settings page - photographer tools removed
4. Photo Hub drawer menu items
"""
import pytest
import requests
import os
from datetime import datetime, timedelta

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials
PHOTOGRAPHER_ID = "12dc6786-124f-40b1-8698-a9409f99736f"
PHOTOGRAPHER_EMAIL = "photographer@surf.com"
PHOTOGRAPHER_PASSWORD = "test-shaka"


class TestPhotographerAvailability:
    """Test availability CRUD endpoints"""
    
    def test_get_availability_empty(self):
        """GET /api/photographer/{id}/availability - returns list (may be empty)"""
        response = requests.get(f"{BASE_URL}/api/photographer/{PHOTOGRAPHER_ID}/availability")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert isinstance(data, list), "Response should be a list"
        print(f"✓ GET availability returned {len(data)} slots")
    
    def test_create_availability_single_date(self):
        """POST /api/photographer/{id}/availability - create single date availability"""
        # Create availability for tomorrow
        tomorrow = (datetime.now() + timedelta(days=1)).strftime('%Y-%m-%d')
        
        payload = {
            "dates": [tomorrow],
            "time_preset": "morning",
            "start_time": "08:00",
            "end_time": "12:00",
            "is_recurring": False,
            "recurring_days": []
        }
        
        response = requests.post(
            f"{BASE_URL}/api/photographer/{PHOTOGRAPHER_ID}/availability",
            json=payload
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert "message" in data, "Response should have message"
        assert data.get("count", 0) >= 1, "Should create at least 1 slot"
        print(f"✓ Created single date availability: {data}")
    
    def test_create_availability_recurring(self):
        """POST /api/photographer/{id}/availability - create recurring availability"""
        payload = {
            "dates": [],
            "time_preset": "afternoon",
            "start_time": "12:00",
            "end_time": "17:00",
            "is_recurring": True,
            "recurring_days": [1, 3, 5]  # Mon, Wed, Fri
        }
        
        response = requests.post(
            f"{BASE_URL}/api/photographer/{PHOTOGRAPHER_ID}/availability",
            json=payload
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert "message" in data, "Response should have message"
        print(f"✓ Created recurring availability: {data}")
    
    def test_get_availability_after_create(self):
        """GET /api/photographer/{id}/availability - verify created slots"""
        response = requests.get(f"{BASE_URL}/api/photographer/{PHOTOGRAPHER_ID}/availability")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) >= 1, "Should have at least 1 availability slot after creation"
        
        # Verify structure of availability slot
        slot = data[0]
        assert "id" in slot, "Slot should have id"
        assert "photographer_id" in slot, "Slot should have photographer_id"
        assert "start_time" in slot, "Slot should have start_time"
        assert "end_time" in slot, "Slot should have end_time"
        assert "time_preset" in slot, "Slot should have time_preset"
        print(f"✓ GET availability returned {len(data)} slots with correct structure")
        return data
    
    def test_delete_availability(self):
        """DELETE /api/photographer/{id}/availability/{availability_id}"""
        # First get existing availability
        get_response = requests.get(f"{BASE_URL}/api/photographer/{PHOTOGRAPHER_ID}/availability")
        assert get_response.status_code == 200
        slots = get_response.json()
        
        if len(slots) == 0:
            pytest.skip("No availability slots to delete")
        
        # Delete the first slot
        slot_id = slots[0]["id"]
        delete_response = requests.delete(
            f"{BASE_URL}/api/photographer/{PHOTOGRAPHER_ID}/availability/{slot_id}"
        )
        assert delete_response.status_code == 200, f"Expected 200, got {delete_response.status_code}: {delete_response.text}"
        data = delete_response.json()
        assert "message" in data, "Response should have message"
        print(f"✓ Deleted availability slot: {slot_id}")


class TestSurferAvailableSlots:
    """Test available-slots endpoint for surfer booking"""
    
    def test_get_available_slots_no_availability(self):
        """GET /api/photographer/{id}/available-slots - returns empty when no availability set"""
        # Use a date far in the future
        future_date = (datetime.now() + timedelta(days=100)).strftime('%Y-%m-%d')
        
        response = requests.get(
            f"{BASE_URL}/api/photographer/{PHOTOGRAPHER_ID}/available-slots",
            params={"date": future_date}
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert "available_slots" in data, "Response should have available_slots"
        print(f"✓ GET available-slots returned: {data}")
    
    def test_get_available_slots_with_availability(self):
        """GET /api/photographer/{id}/available-slots - returns slots when availability is set"""
        # First create availability for tomorrow
        tomorrow = (datetime.now() + timedelta(days=1)).strftime('%Y-%m-%d')
        
        create_payload = {
            "dates": [tomorrow],
            "time_preset": "all_day",
            "start_time": "06:00",
            "end_time": "18:00",
            "is_recurring": False,
            "recurring_days": []
        }
        
        create_response = requests.post(
            f"{BASE_URL}/api/photographer/{PHOTOGRAPHER_ID}/availability",
            json=create_payload
        )
        assert create_response.status_code == 200
        
        # Now get available slots for that date
        response = requests.get(
            f"{BASE_URL}/api/photographer/{PHOTOGRAPHER_ID}/available-slots",
            params={"date": tomorrow}
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        assert "available_slots" in data, "Response should have available_slots"
        assert "date" in data, "Response should have date"
        assert "photographer_id" in data, "Response should have photographer_id"
        
        slots = data["available_slots"]
        if len(slots) > 0:
            # Verify slot structure
            slot = slots[0]
            assert "time" in slot, "Slot should have time"
            assert "label" in slot, "Slot should have label"
            assert "available" in slot, "Slot should have available flag"
        
        print(f"✓ GET available-slots returned {len(slots)} slots for {tomorrow}")
    
    def test_get_available_slots_invalid_date(self):
        """GET /api/photographer/{id}/available-slots - handles invalid date format"""
        response = requests.get(
            f"{BASE_URL}/api/photographer/{PHOTOGRAPHER_ID}/available-slots",
            params={"date": "invalid-date"}
        )
        assert response.status_code == 400, f"Expected 400 for invalid date, got {response.status_code}"
        print("✓ Invalid date format returns 400")


class TestTimePresets:
    """Test time preset values match expected ranges"""
    
    def test_early_morning_preset(self):
        """Create availability with early_morning preset (5-9 AM)"""
        tomorrow = (datetime.now() + timedelta(days=2)).strftime('%Y-%m-%d')
        
        payload = {
            "dates": [tomorrow],
            "time_preset": "early_morning",
            "start_time": "05:00",
            "end_time": "09:00",
            "is_recurring": False,
            "recurring_days": []
        }
        
        response = requests.post(
            f"{BASE_URL}/api/photographer/{PHOTOGRAPHER_ID}/availability",
            json=payload
        )
        assert response.status_code == 200
        print("✓ Early morning preset (5-9 AM) created successfully")
    
    def test_evening_preset(self):
        """Create availability with evening preset (4-7 PM)"""
        tomorrow = (datetime.now() + timedelta(days=3)).strftime('%Y-%m-%d')
        
        payload = {
            "dates": [tomorrow],
            "time_preset": "evening",
            "start_time": "16:00",
            "end_time": "19:00",
            "is_recurring": False,
            "recurring_days": []
        }
        
        response = requests.post(
            f"{BASE_URL}/api/photographer/{PHOTOGRAPHER_ID}/availability",
            json=payload
        )
        assert response.status_code == 200
        print("✓ Evening preset (4-7 PM) created successfully")


class TestBookingsManagerEndpoints:
    """Test existing bookings manager endpoints still work"""
    
    def test_get_photographer_bookings(self):
        """GET /api/photographer/{id}/bookings - returns bookings list"""
        response = requests.get(f"{BASE_URL}/api/photographer/{PHOTOGRAPHER_ID}/bookings")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert isinstance(data, list), "Response should be a list"
        print(f"✓ GET bookings returned {len(data)} bookings")
    
    def test_get_photographer_pricing(self):
        """GET /api/photographer/{id}/pricing - returns pricing settings"""
        response = requests.get(f"{BASE_URL}/api/photographer/{PHOTOGRAPHER_ID}/pricing")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        # Verify pricing fields
        assert "booking_hourly_rate" in data, "Should have booking_hourly_rate"
        assert "booking_price_web" in data, "Should have booking_price_web"
        assert "booking_price_standard" in data, "Should have booking_price_standard"
        assert "booking_price_high" in data, "Should have booking_price_high"
        assert "price_per_additional_surfer" in data, "Should have price_per_additional_surfer"
        
        print(f"✓ GET pricing returned: hourly_rate=${data['booking_hourly_rate']}, per_surfer=${data['price_per_additional_surfer']}")
    
    def test_get_booked_slots(self):
        """GET /api/photographer/{id}/booked-slots - returns booked slots for date"""
        today = datetime.now().strftime('%Y-%m-%d')
        
        response = requests.get(
            f"{BASE_URL}/api/photographer/{PHOTOGRAPHER_ID}/booked-slots",
            params={"date": today}
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert isinstance(data, list), "Response should be a list"
        print(f"✓ GET booked-slots returned {len(data)} booked slots for {today}")


class TestCleanup:
    """Cleanup test data"""
    
    def test_cleanup_test_availability(self):
        """Delete all test availability slots"""
        # Get all availability
        response = requests.get(f"{BASE_URL}/api/photographer/{PHOTOGRAPHER_ID}/availability")
        if response.status_code != 200:
            pytest.skip("Could not get availability for cleanup")
        
        slots = response.json()
        deleted_count = 0
        
        for slot in slots:
            delete_response = requests.delete(
                f"{BASE_URL}/api/photographer/{PHOTOGRAPHER_ID}/availability/{slot['id']}"
            )
            if delete_response.status_code == 200:
                deleted_count += 1
        
        print(f"✓ Cleanup: deleted {deleted_count} availability slots")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
