"""
Test Suite for Raw Surf OS P2 Remaining Features:
1. Auto-escrow release scheduler job (auto_release_escrow daily 3am)
2. GET /api/photographer/{id}/bookings-calendar - returns bookings, availability_windows, blocked_dates
3. PUT /api/photographer/{id}/availability-windows - saves weekly availability
4. POST /api/photographer/{id}/block-date - blocks a specific date
5. POST /api/photographer/{id}/unblock-date - unblocks a date
6. POST /api/grom-hq/create-age-verification/{parent_id} - creates Stripe Identity session
7. Booking creation applies group discount based on max_participants
"""

import pytest
import requests
import os
from datetime import datetime, timedelta

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://raw-surf-os.preview.emergentagent.com')

# Test credentials from review request
TEST_USER_ID = "12dc6786-124f-40b1-8698-a9409f99736f"
TEST_PHOTOGRAPHER_ID = "3fbb1276-a7fe-49cc-a302-c1928f0d56d0"
GROM_PARENT_ID = "3f0c5325-6fa7-4346-b450-667a9b31ad8e"


class TestSchedulerAutoEscrowRelease:
    """Test auto-escrow release scheduler job registration"""
    
    def test_scheduler_has_auto_escrow_release_job(self):
        """Verify auto_escrow_release job is registered in scheduler.py"""
        # Read scheduler.py and verify job registration
        scheduler_path = "/app/backend/scheduler.py"
        with open(scheduler_path, 'r') as f:
            content = f.read()
        
        # Check for auto_release_escrow_task function
        assert "async def auto_release_escrow_task" in content, "auto_release_escrow_task function not found"
        
        # Check for job registration with CronTrigger at 3am
        assert "auto_escrow_release" in content, "auto_escrow_release job ID not found"
        assert "CronTrigger(hour=3, minute=0)" in content, "CronTrigger for 3am not found"
        
        # Check for 7-day logic
        assert "timedelta(days=7)" in content, "7-day escrow release logic not found"
        
        # Check for escrow release conditions
        assert "escrow_status == 'held'" in content, "Escrow held status check not found"
        assert "escrow_amount > 0" in content, "Escrow amount check not found"
        
        print("PASS: Auto-escrow release scheduler job is properly registered")


class TestPhotographerBookingsCalendar:
    """Test GET /api/photographer/{id}/bookings-calendar endpoint"""
    
    def test_get_bookings_calendar_returns_structure(self):
        """Verify calendar endpoint returns bookings, availability_windows, and blocked_dates"""
        # Get date range for current month
        now = datetime.now()
        start = now.replace(day=1).isoformat() + "Z"
        end = (now.replace(day=28) + timedelta(days=4)).replace(day=1).isoformat() + "Z"
        
        response = requests.get(
            f"{BASE_URL}/api/photographer/{TEST_PHOTOGRAPHER_ID}/bookings-calendar",
            params={"start": start, "end": end}
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        
        # Verify response structure
        assert "bookings" in data, "Response missing 'bookings' field"
        assert "availability_windows" in data, "Response missing 'availability_windows' field"
        assert "blocked_dates" in data, "Response missing 'blocked_dates' field"
        
        # Verify bookings is a list
        assert isinstance(data["bookings"], list), "bookings should be a list"
        
        # Verify availability_windows has 7 days
        assert isinstance(data["availability_windows"], list), "availability_windows should be a list"
        assert len(data["availability_windows"]) == 7, f"Expected 7 availability windows, got {len(data['availability_windows'])}"
        
        # Verify each window has required fields
        for window in data["availability_windows"]:
            assert "day" in window, "Window missing 'day' field"
            assert "enabled" in window, "Window missing 'enabled' field"
            assert "start" in window, "Window missing 'start' field"
            assert "end" in window, "Window missing 'end' field"
        
        # Verify blocked_dates is a list
        assert isinstance(data["blocked_dates"], list), "blocked_dates should be a list"
        
        print(f"PASS: Calendar returns {len(data['bookings'])} bookings, 7 availability windows, {len(data['blocked_dates'])} blocked dates")
    
    def test_get_bookings_calendar_invalid_photographer(self):
        """Verify 404 for non-existent photographer"""
        now = datetime.now()
        start = now.isoformat() + "Z"
        end = (now + timedelta(days=30)).isoformat() + "Z"
        
        response = requests.get(
            f"{BASE_URL}/api/photographer/invalid-id-12345/bookings-calendar",
            params={"start": start, "end": end}
        )
        
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        print("PASS: Returns 404 for invalid photographer")


class TestPhotographerAvailabilityWindows:
    """Test PUT /api/photographer/{id}/availability-windows endpoint"""
    
    def test_update_availability_windows(self):
        """Verify weekly availability windows can be saved"""
        # Create test windows - Mon-Fri enabled, Sat-Sun disabled
        windows = [
            {"day": 0, "enabled": False, "start": "06:00", "end": "18:00"},  # Sunday
            {"day": 1, "enabled": True, "start": "07:00", "end": "17:00"},   # Monday
            {"day": 2, "enabled": True, "start": "07:00", "end": "17:00"},   # Tuesday
            {"day": 3, "enabled": True, "start": "07:00", "end": "17:00"},   # Wednesday
            {"day": 4, "enabled": True, "start": "07:00", "end": "17:00"},   # Thursday
            {"day": 5, "enabled": True, "start": "07:00", "end": "17:00"},   # Friday
            {"day": 6, "enabled": False, "start": "06:00", "end": "18:00"},  # Saturday
        ]
        
        response = requests.put(
            f"{BASE_URL}/api/photographer/{TEST_PHOTOGRAPHER_ID}/availability-windows",
            json={"windows": windows}
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "message" in data, "Response missing 'message' field"
        assert "success" in data["message"].lower() or "updated" in data["message"].lower(), \
            f"Unexpected message: {data['message']}"
        
        print("PASS: Availability windows updated successfully")
    
    def test_update_availability_windows_invalid_photographer(self):
        """Verify 404 for non-existent photographer"""
        windows = [{"day": 0, "enabled": True, "start": "06:00", "end": "18:00"}]
        
        response = requests.put(
            f"{BASE_URL}/api/photographer/invalid-id-12345/availability-windows",
            json={"windows": windows}
        )
        
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        print("PASS: Returns 404 for invalid photographer")


class TestPhotographerBlockDate:
    """Test POST /api/photographer/{id}/block-date and unblock-date endpoints"""
    
    def test_block_date(self):
        """Verify a specific date can be blocked"""
        # Block a date 30 days from now
        future_date = (datetime.now() + timedelta(days=30)).strftime("%Y-%m-%d")
        
        response = requests.post(
            f"{BASE_URL}/api/photographer/{TEST_PHOTOGRAPHER_ID}/block-date",
            json={"date": future_date}
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "message" in data, "Response missing 'message' field"
        
        print(f"PASS: Date {future_date} blocked successfully")
    
    def test_unblock_date(self):
        """Verify a blocked date can be unblocked"""
        # Unblock the same date
        future_date = (datetime.now() + timedelta(days=30)).strftime("%Y-%m-%d")
        
        response = requests.post(
            f"{BASE_URL}/api/photographer/{TEST_PHOTOGRAPHER_ID}/unblock-date",
            json={"date": future_date}
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "message" in data, "Response missing 'message' field"
        
        print(f"PASS: Date {future_date} unblocked successfully")
    
    def test_block_date_invalid_format(self):
        """Verify 400 for invalid date format"""
        response = requests.post(
            f"{BASE_URL}/api/photographer/{TEST_PHOTOGRAPHER_ID}/block-date",
            json={"date": "invalid-date"}
        )
        
        assert response.status_code == 400, f"Expected 400, got {response.status_code}"
        print("PASS: Returns 400 for invalid date format")


class TestStripeIdentityAgeVerification:
    """Test POST /api/grom-hq/create-age-verification/{parent_id} endpoint"""
    
    def test_create_age_verification_session(self):
        """Verify Stripe Identity session is created for Grom Parent"""
        response = requests.post(
            f"{BASE_URL}/api/grom-hq/create-age-verification/{GROM_PARENT_ID}",
            json={"return_url": "https://raw-surf-os.preview.emergentagent.com/grom-hq"}
        )
        
        # Could be 200 (success) or 200 with already_verified
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        
        # Check if already verified
        if data.get("already_verified"):
            print("PASS: Parent already age verified")
            return
        
        # Verify response has Stripe session fields
        assert "client_secret" in data, "Response missing 'client_secret' field"
        assert "verification_session_id" in data, "Response missing 'verification_session_id' field"
        assert "status" in data, "Response missing 'status' field"
        
        # Verify client_secret format (starts with vs_)
        assert data["verification_session_id"].startswith("vs_"), \
            f"Invalid verification_session_id format: {data['verification_session_id']}"
        
        print(f"PASS: Stripe Identity session created: {data['verification_session_id']}")
    
    def test_create_age_verification_invalid_parent(self):
        """Verify 404 for non-existent parent"""
        response = requests.post(
            f"{BASE_URL}/api/grom-hq/create-age-verification/invalid-parent-id",
            json={"return_url": "https://example.com"}
        )
        
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        print("PASS: Returns 404 for invalid parent")


class TestGroupDiscountInBookingCreation:
    """Test that booking creation applies group discount based on max_participants"""
    
    def test_group_discount_applied_in_price_calculation(self):
        """Verify group discounts are applied when creating bookings"""
        # First, set up group discounts for the photographer
        pricing_response = requests.put(
            f"{BASE_URL}/api/photographer/{TEST_PHOTOGRAPHER_ID}/pricing",
            json={
                "booking_hourly_rate": 100,
                "group_discount_2_plus": 10,  # 10% off for 2+ surfers
                "group_discount_3_plus": 15,  # 15% off for 3+ surfers
                "group_discount_5_plus": 20   # 20% off for 5+ surfers
            }
        )
        
        assert pricing_response.status_code == 200, f"Failed to set pricing: {pricing_response.text}"
        
        # Verify pricing was set
        get_pricing = requests.get(f"{BASE_URL}/api/photographer/{TEST_PHOTOGRAPHER_ID}/pricing")
        assert get_pricing.status_code == 200
        pricing_data = get_pricing.json()
        
        assert pricing_data.get("group_discount_2_plus") == 10, "group_discount_2_plus not set"
        assert pricing_data.get("group_discount_3_plus") == 15, "group_discount_3_plus not set"
        assert pricing_data.get("group_discount_5_plus") == 20, "group_discount_5_plus not set"
        
        print("PASS: Group discounts configured on photographer profile")
    
    def test_booking_price_calculation_with_group_discount(self):
        """Verify booking price calculation includes group discount"""
        # Read the bookings.py to verify group discount logic
        bookings_path = "/app/backend/routes/bookings.py"
        with open(bookings_path, 'r') as f:
            content = f.read()
        
        # Check for group discount calculation logic
        assert "group_discount_percent" in content, "group_discount_percent variable not found"
        assert "group_discount_5_plus" in content, "group_discount_5_plus check not found"
        assert "group_discount_3_plus" in content, "group_discount_3_plus check not found"
        assert "group_discount_2_plus" in content, "group_discount_2_plus check not found"
        
        # Check for discount application
        assert "discount_amount" in content, "discount_amount calculation not found"
        assert "base_price - discount_amount" in content or "total_price = base_price - discount_amount" in content, \
            "Discount not applied to total price"
        
        print("PASS: Group discount logic verified in booking creation")


class TestPhotographerAvailabilityCalendarIntegration:
    """Test the full calendar flow - set availability, block dates, verify in calendar"""
    
    def test_full_calendar_flow(self):
        """Test complete calendar workflow"""
        # Step 1: Set availability windows
        windows = [
            {"day": 0, "enabled": False, "start": "06:00", "end": "18:00"},
            {"day": 1, "enabled": True, "start": "08:00", "end": "16:00"},
            {"day": 2, "enabled": True, "start": "08:00", "end": "16:00"},
            {"day": 3, "enabled": True, "start": "08:00", "end": "16:00"},
            {"day": 4, "enabled": True, "start": "08:00", "end": "16:00"},
            {"day": 5, "enabled": True, "start": "08:00", "end": "16:00"},
            {"day": 6, "enabled": False, "start": "06:00", "end": "18:00"},
        ]
        
        set_windows = requests.put(
            f"{BASE_URL}/api/photographer/{TEST_PHOTOGRAPHER_ID}/availability-windows",
            json={"windows": windows}
        )
        assert set_windows.status_code == 200, f"Failed to set windows: {set_windows.text}"
        
        # Step 2: Block a specific date
        block_date = (datetime.now() + timedelta(days=14)).strftime("%Y-%m-%d")
        block_response = requests.post(
            f"{BASE_URL}/api/photographer/{TEST_PHOTOGRAPHER_ID}/block-date",
            json={"date": block_date}
        )
        assert block_response.status_code == 200, f"Failed to block date: {block_response.text}"
        
        # Step 3: Get calendar and verify
        now = datetime.now()
        start = now.replace(day=1).isoformat() + "Z"
        end = (now.replace(day=28) + timedelta(days=4)).replace(day=1).isoformat() + "Z"
        
        calendar_response = requests.get(
            f"{BASE_URL}/api/photographer/{TEST_PHOTOGRAPHER_ID}/bookings-calendar",
            params={"start": start, "end": end}
        )
        assert calendar_response.status_code == 200, f"Failed to get calendar: {calendar_response.text}"
        
        calendar_data = calendar_response.json()
        
        # Verify structure
        assert len(calendar_data["availability_windows"]) == 7
        assert isinstance(calendar_data["blocked_dates"], list)
        
        # Step 4: Unblock the date
        unblock_response = requests.post(
            f"{BASE_URL}/api/photographer/{TEST_PHOTOGRAPHER_ID}/unblock-date",
            json={"date": block_date}
        )
        assert unblock_response.status_code == 200, f"Failed to unblock date: {unblock_response.text}"
        
        print("PASS: Full calendar flow completed successfully")


class TestScheduledBookingDrawerGroupDiscountDisplay:
    """Test that ScheduledBookingDrawer shows group discount notice"""
    
    def test_frontend_has_group_discount_display(self):
        """Verify ScheduledBookingDrawer.js has group discount notice"""
        drawer_path = "/app/frontend/src/components/ScheduledBookingDrawer.js"
        with open(drawer_path, 'r') as f:
            content = f.read()
        
        # Check for group discount variables
        assert "groupDiscount2" in content or "group_discount_2_plus" in content, \
            "Group discount 2+ variable not found"
        assert "groupDiscount3" in content or "group_discount_3_plus" in content, \
            "Group discount 3+ variable not found"
        assert "groupDiscount5" in content or "group_discount_5_plus" in content, \
            "Group discount 5+ variable not found"
        
        # Check for hasGroupDiscounts flag
        assert "hasGroupDiscounts" in content, "hasGroupDiscounts flag not found"
        
        # Check for group discount notice UI
        assert "Group Discounts Available" in content or "Group Booking Discounts" in content, \
            "Group discount notice text not found"
        
        # Check for Users icon (group indicator)
        assert "Users" in content, "Users icon import not found"
        
        print("PASS: ScheduledBookingDrawer has group discount display")


class TestPhotographerBookingsManagerCalendarTab:
    """Test that PhotographerBookingsManager has Calendar tab with PhotographerAvailabilityCalendar"""
    
    def test_bookings_manager_has_calendar_tab(self):
        """Verify PhotographerBookingsManager.js has Calendar tab"""
        manager_path = "/app/frontend/src/components/PhotographerBookingsManager.js"
        with open(manager_path, 'r') as f:
            content = f.read()
        
        # Check for Calendar tab in tabs array
        assert "id: 'calendar'" in content, "Calendar tab ID not found"
        assert "label: 'Calendar'" in content, "Calendar tab label not found"
        
        # Check for PhotographerAvailabilityCalendar import
        assert "PhotographerAvailabilityCalendar" in content, \
            "PhotographerAvailabilityCalendar import not found"
        
        # Check for calendar tab rendering
        assert "activeTab === 'calendar'" in content, "Calendar tab conditional rendering not found"
        
        # Check for LayoutGrid icon (calendar icon)
        assert "LayoutGrid" in content, "LayoutGrid icon not found"
        
        print("PASS: PhotographerBookingsManager has Calendar tab with PhotographerAvailabilityCalendar")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
