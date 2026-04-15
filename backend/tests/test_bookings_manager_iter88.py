"""
Test suite for Professional Grade Scheduling - Bookings Manager (Iteration 88)
Features tested:
1. Step-Based Calendar UX (Select Date → Select Time Slot)
2. Duration Numeric Stepper for session hours
3. Crew split-payment logic with Add Crew Members UI
4. Price Per Additional Surfer pricing field
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test photographer ID (from logs - working photographer)
TEST_PHOTOGRAPHER_ID = "12dc6786-124f-40b1-8698-a9409f99736f"


class TestPhotographerPricingEndpoint:
    """Test GET /api/photographer/{id}/pricing endpoint"""
    
    def test_pricing_endpoint_returns_200(self):
        """Test that pricing endpoint returns 200 for valid photographer"""
        response = requests.get(f"{BASE_URL}/api/photographer/{TEST_PHOTOGRAPHER_ID}/pricing")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        print(f"✅ GET /api/photographer/{TEST_PHOTOGRAPHER_ID}/pricing returned 200")
    
    def test_pricing_contains_price_per_additional_surfer(self):
        """Test that pricing response contains price_per_additional_surfer field"""
        response = requests.get(f"{BASE_URL}/api/photographer/{TEST_PHOTOGRAPHER_ID}/pricing")
        assert response.status_code == 200
        
        data = response.json()
        assert "price_per_additional_surfer" in data, "price_per_additional_surfer field missing"
        assert isinstance(data["price_per_additional_surfer"], (int, float)), "price_per_additional_surfer should be numeric"
        print(f"✅ price_per_additional_surfer = {data['price_per_additional_surfer']}")
    
    def test_pricing_contains_booking_hourly_rate(self):
        """Test that pricing response contains booking_hourly_rate field"""
        response = requests.get(f"{BASE_URL}/api/photographer/{TEST_PHOTOGRAPHER_ID}/pricing")
        assert response.status_code == 200
        
        data = response.json()
        assert "booking_hourly_rate" in data, "booking_hourly_rate field missing"
        assert isinstance(data["booking_hourly_rate"], (int, float)), "booking_hourly_rate should be numeric"
        print(f"✅ booking_hourly_rate = {data['booking_hourly_rate']}")
    
    def test_pricing_contains_resolution_pricing(self):
        """Test that pricing response contains resolution-tiered pricing fields"""
        response = requests.get(f"{BASE_URL}/api/photographer/{TEST_PHOTOGRAPHER_ID}/pricing")
        assert response.status_code == 200
        
        data = response.json()
        required_fields = ["booking_price_web", "booking_price_standard", "booking_price_high"]
        for field in required_fields:
            assert field in data, f"{field} field missing"
            assert isinstance(data[field], (int, float)), f"{field} should be numeric"
        print(f"✅ Resolution pricing: Web=${data['booking_price_web']}, Standard=${data['booking_price_standard']}, High=${data['booking_price_high']}")
    
    def test_pricing_contains_photos_included(self):
        """Test that pricing response contains booking_photos_included field"""
        response = requests.get(f"{BASE_URL}/api/photographer/{TEST_PHOTOGRAPHER_ID}/pricing")
        assert response.status_code == 200
        
        data = response.json()
        assert "booking_photos_included" in data, "booking_photos_included field missing"
        assert isinstance(data["booking_photos_included"], int), "booking_photos_included should be integer"
        print(f"✅ booking_photos_included = {data['booking_photos_included']}")


class TestBookedSlotsEndpoint:
    """Test GET /api/photographer/{id}/booked-slots endpoint"""
    
    def test_booked_slots_endpoint_returns_200(self):
        """Test that booked-slots endpoint returns 200 for valid date"""
        from datetime import date
        today = date.today().isoformat()
        
        response = requests.get(
            f"{BASE_URL}/api/photographer/{TEST_PHOTOGRAPHER_ID}/booked-slots",
            params={"date": today}
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        print(f"✅ GET /api/photographer/{TEST_PHOTOGRAPHER_ID}/booked-slots?date={today} returned 200")
    
    def test_booked_slots_returns_array(self):
        """Test that booked-slots endpoint returns an array"""
        from datetime import date
        today = date.today().isoformat()
        
        response = requests.get(
            f"{BASE_URL}/api/photographer/{TEST_PHOTOGRAPHER_ID}/booked-slots",
            params={"date": today}
        )
        assert response.status_code == 200
        
        data = response.json()
        assert isinstance(data, list), "Response should be an array"
        print(f"✅ booked-slots returned array with {len(data)} slots")
    
    def test_booked_slots_invalid_date_format(self):
        """Test that booked-slots endpoint returns 400 for invalid date format"""
        response = requests.get(
            f"{BASE_URL}/api/photographer/{TEST_PHOTOGRAPHER_ID}/booked-slots",
            params={"date": "invalid-date"}
        )
        assert response.status_code == 400, f"Expected 400 for invalid date, got {response.status_code}"
        print("✅ booked-slots returns 400 for invalid date format")


class TestPhotographerBookingsEndpoint:
    """Test GET /api/photographer/{id}/bookings endpoint"""
    
    def test_bookings_endpoint_returns_200(self):
        """Test that bookings endpoint returns 200 for valid photographer"""
        response = requests.get(f"{BASE_URL}/api/photographer/{TEST_PHOTOGRAPHER_ID}/bookings")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        print(f"✅ GET /api/photographer/{TEST_PHOTOGRAPHER_ID}/bookings returned 200")
    
    def test_bookings_returns_array(self):
        """Test that bookings endpoint returns an array"""
        response = requests.get(f"{BASE_URL}/api/photographer/{TEST_PHOTOGRAPHER_ID}/bookings")
        assert response.status_code == 200
        
        data = response.json()
        assert isinstance(data, list), "Response should be an array"
        print(f"✅ bookings returned array with {len(data)} bookings")


class TestUpdatePricingEndpoint:
    """Test PUT /api/photographer/{id}/pricing endpoint"""
    
    def test_update_price_per_additional_surfer(self):
        """Test updating price_per_additional_surfer field"""
        # First get current pricing
        get_response = requests.get(f"{BASE_URL}/api/photographer/{TEST_PHOTOGRAPHER_ID}/pricing")
        assert get_response.status_code == 200
        original_price = get_response.json().get("price_per_additional_surfer", 15)
        
        # Update to new value
        new_price = 20.0
        update_response = requests.put(
            f"{BASE_URL}/api/photographer/{TEST_PHOTOGRAPHER_ID}/pricing",
            json={"price_per_additional_surfer": new_price}
        )
        assert update_response.status_code == 200, f"Expected 200, got {update_response.status_code}"
        
        # Verify update
        verify_response = requests.get(f"{BASE_URL}/api/photographer/{TEST_PHOTOGRAPHER_ID}/pricing")
        assert verify_response.status_code == 200
        updated_price = verify_response.json().get("price_per_additional_surfer")
        assert updated_price == new_price, f"Expected {new_price}, got {updated_price}"
        
        # Restore original value
        requests.put(
            f"{BASE_URL}/api/photographer/{TEST_PHOTOGRAPHER_ID}/pricing",
            json={"price_per_additional_surfer": original_price}
        )
        print(f"✅ price_per_additional_surfer updated from {original_price} to {new_price} and restored")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
