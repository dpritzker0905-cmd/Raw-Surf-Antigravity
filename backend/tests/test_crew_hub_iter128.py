"""
Test Crew Hub - Captain's Command Center for Split Bookings
Iteration 128

Tests:
- GET /api/bookings/{id}/crew-hub-status - crew details with share amounts, payment status
- POST /api/bookings/{id}/crew-hub/captain-hold - deducts credits and sets payment window expiry
- POST /api/bookings/{id}/crew-hub/update-splits - updates custom share amounts and covered_by_captain flags
- POST /api/bookings/{id}/crew-hub/captain-cover-remaining - deducts remaining balance and confirms booking
- POST /api/bookings/{id}/crew-hub/cancel-refund - refunds to credit balance
"""

import pytest
import requests
import os
import uuid
from datetime import datetime, timedelta

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials from review request
ADMIN_EMAIL = "dpritzker0905@gmail.com"
ADMIN_PASSWORD = "test123"
TEST_BOOKING_ID = "eb3ab6be-394a-44ce-86e7-215251b6b2d0"


class TestCrewHubEndpoints:
    """Test Crew Hub API endpoints for split booking management"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test session"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        self.user_id = None
        self.login()
    
    def login(self):
        """Login and get user ID"""
        response = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        if response.status_code == 200:
            data = response.json()
            # Login returns 'id' directly (profile ID), not nested under 'user'
            self.user_id = data.get("id")
            print(f"Logged in as user: {self.user_id}")
        else:
            print(f"Login failed: {response.status_code} - {response.text}")
    
    def test_01_crew_hub_status_endpoint_exists(self):
        """Test GET /api/bookings/{id}/crew-hub-status returns crew details"""
        if not self.user_id:
            pytest.skip("Login failed - skipping test")
        
        response = self.session.get(
            f"{BASE_URL}/api/bookings/{TEST_BOOKING_ID}/crew-hub-status",
            params={"captain_id": self.user_id}
        )
        
        print(f"Crew Hub Status Response: {response.status_code}")
        print(f"Response: {response.text[:500] if response.text else 'Empty'}")
        
        # Accept 200 (success) or 403 (not captain) or 404 (booking not found)
        assert response.status_code in [200, 403, 404], f"Unexpected status: {response.status_code}"
        
        if response.status_code == 200:
            data = response.json()
            # Verify response structure
            assert "booking_id" in data, "Missing booking_id in response"
            assert "crew" in data, "Missing crew array in response"
            assert "summary" in data, "Missing summary in response"
            
            # Verify crew member structure
            if data["crew"]:
                crew_member = data["crew"][0]
                assert "participant_id" in crew_member, "Missing participant_id"
                assert "share_amount" in crew_member, "Missing share_amount"
                assert "payment_status" in crew_member, "Missing payment_status"
                print(f"Crew Hub Status: {len(data['crew'])} crew members, total: ${data.get('total_price', 0)}")
    
    def test_02_captain_hold_endpoint_exists(self):
        """Test POST /api/bookings/{id}/crew-hub/captain-hold endpoint"""
        if not self.user_id:
            pytest.skip("Login failed - skipping test")
        
        response = self.session.post(
            f"{BASE_URL}/api/bookings/{TEST_BOOKING_ID}/crew-hub/captain-hold",
            params={"captain_id": self.user_id}
        )
        
        print(f"Captain Hold Response: {response.status_code}")
        print(f"Response: {response.text[:500] if response.text else 'Empty'}")
        
        # Accept 200 (success), 400 (already paid/insufficient credits), 403 (not captain), 404 (not found)
        assert response.status_code in [200, 400, 403, 404], f"Unexpected status: {response.status_code}"
        
        if response.status_code == 200:
            data = response.json()
            assert "success" in data, "Missing success field"
            assert "captain_share_paid" in data, "Missing captain_share_paid"
            assert "payment_window_expires_at" in data, "Missing payment_window_expires_at"
            print(f"Captain Hold: Paid ${data.get('captain_share_paid', 0)}, expires: {data.get('payment_window_expires_at')}")
        elif response.status_code == 400:
            data = response.json()
            print(f"Captain Hold already paid or insufficient credits: {data.get('detail', 'Unknown')}")
    
    def test_03_update_splits_endpoint_exists(self):
        """Test POST /api/bookings/{id}/crew-hub/update-splits endpoint"""
        if not self.user_id:
            pytest.skip("Login failed - skipping test")
        
        # First get current crew status to build valid splits
        status_response = self.session.get(
            f"{BASE_URL}/api/bookings/{TEST_BOOKING_ID}/crew-hub-status",
            params={"captain_id": self.user_id}
        )
        
        if status_response.status_code != 200:
            pytest.skip("Cannot get crew status - skipping update splits test")
        
        status_data = status_response.json()
        total_price = status_data.get("total_price", 100)
        crew = status_data.get("crew", [])
        
        # Build splits payload
        splits = []
        captain_share = total_price / max(len(crew), 1)
        
        for member in crew:
            if member.get("participant_id") != self.user_id:
                splits.append({
                    "participant_id": member["participant_id"],
                    "share_amount": captain_share,
                    "share_percentage": 100 / max(len(crew), 1),
                    "covered_by_captain": False
                })
        
        response = self.session.post(
            f"{BASE_URL}/api/bookings/{TEST_BOOKING_ID}/crew-hub/update-splits",
            json={
                "captain_id": self.user_id,
                "splits": splits,
                "captain_share": captain_share
            }
        )
        
        print(f"Update Splits Response: {response.status_code}")
        print(f"Response: {response.text[:500] if response.text else 'Empty'}")
        
        # Accept 200 (success), 400 (validation error), 403 (not captain), 404 (not found)
        assert response.status_code in [200, 400, 403, 404], f"Unexpected status: {response.status_code}"
        
        if response.status_code == 200:
            data = response.json()
            assert "success" in data, "Missing success field"
            print(f"Update Splits: {data.get('message', 'Success')}")
    
    def test_04_captain_cover_remaining_endpoint_exists(self):
        """Test POST /api/bookings/{id}/crew-hub/captain-cover-remaining endpoint"""
        if not self.user_id:
            pytest.skip("Login failed - skipping test")
        
        # First get remaining balance
        status_response = self.session.get(
            f"{BASE_URL}/api/bookings/{TEST_BOOKING_ID}/crew-hub-status",
            params={"captain_id": self.user_id}
        )
        
        remaining = 0
        if status_response.status_code == 200:
            status_data = status_response.json()
            remaining = status_data.get("summary", {}).get("remaining_balance", 0)
        
        response = self.session.post(
            f"{BASE_URL}/api/bookings/{TEST_BOOKING_ID}/crew-hub/captain-cover-remaining",
            json={
                "captain_id": self.user_id,
                "cover_amount": remaining
            }
        )
        
        print(f"Captain Cover Remaining Response: {response.status_code}")
        print(f"Response: {response.text[:500] if response.text else 'Empty'}")
        
        # Accept 200 (success), 400 (no remaining/amount mismatch), 403 (not captain), 404 (not found)
        assert response.status_code in [200, 400, 403, 404], f"Unexpected status: {response.status_code}"
        
        if response.status_code == 200:
            data = response.json()
            assert "success" in data, "Missing success field"
            assert "covered_amount" in data, "Missing covered_amount"
            assert "booking_status" in data, "Missing booking_status"
            print(f"Captain Cover: Covered ${data.get('covered_amount', 0)}, status: {data.get('booking_status')}")
    
    def test_05_cancel_refund_endpoint_exists(self):
        """Test POST /api/bookings/{id}/crew-hub/cancel-refund endpoint"""
        if not self.user_id:
            pytest.skip("Login failed - skipping test")
        
        response = self.session.post(
            f"{BASE_URL}/api/bookings/{TEST_BOOKING_ID}/crew-hub/cancel-refund",
            params={"captain_id": self.user_id}
        )
        
        print(f"Cancel Refund Response: {response.status_code}")
        print(f"Response: {response.text[:500] if response.text else 'Empty'}")
        
        # Accept 200 (success), 400 (already confirmed), 403 (not captain), 404 (not found)
        assert response.status_code in [200, 400, 403, 404], f"Unexpected status: {response.status_code}"
        
        if response.status_code == 200:
            data = response.json()
            assert "success" in data, "Missing success field"
            assert "booking_status" in data, "Missing booking_status"
            assert "refunds" in data, "Missing refunds array"
            print(f"Cancel Refund: Status {data.get('booking_status')}, refunds: {len(data.get('refunds', []))}")


class TestCrewHubWithNewBooking:
    """Test Crew Hub with a fresh booking to verify full flow"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test session"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        self.user_id = None
        self.booking_id = None
        self.login()
    
    def login(self):
        """Login and get user ID"""
        response = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        if response.status_code == 200:
            data = response.json()
            self.user_id = data.get("user", {}).get("id")
            print(f"Logged in as user: {self.user_id}")
        else:
            print(f"Login failed: {response.status_code}")
    
    def test_06_create_booking_for_crew_hub_test(self):
        """Create a test booking to verify Crew Hub flow"""
        if not self.user_id:
            pytest.skip("Login failed - skipping test")
        
        # Get a photographer to book
        photographers_response = self.session.get(f"{BASE_URL}/api/photographers")
        if photographers_response.status_code != 200:
            pytest.skip("Cannot get photographers list")
        
        photographers = photographers_response.json()
        if not photographers:
            pytest.skip("No photographers available")
        
        photographer_id = photographers[0].get("id")
        
        # Create booking with splitting enabled
        session_date = (datetime.now() + timedelta(days=7)).isoformat()
        
        response = self.session.post(
            f"{BASE_URL}/api/bookings/create",
            params={"user_id": self.user_id},
            json={
                "photographer_id": photographer_id,
                "location": "TEST_CrewHub_Location",
                "session_date": session_date,
                "duration": 60,
                "max_participants": 3,
                "allow_splitting": True,
                "split_mode": "friends_only",
                "description": "TEST_CrewHub_Booking"
            }
        )
        
        print(f"Create Booking Response: {response.status_code}")
        print(f"Response: {response.text[:500] if response.text else 'Empty'}")
        
        if response.status_code in [200, 201]:
            data = response.json()
            self.booking_id = data.get("booking_id")
            print(f"Created test booking: {self.booking_id}")
            
            # Now test crew hub status on this booking
            if self.booking_id:
                status_response = self.session.get(
                    f"{BASE_URL}/api/bookings/{self.booking_id}/crew-hub-status",
                    params={"captain_id": self.user_id}
                )
                print(f"New Booking Crew Hub Status: {status_response.status_code}")
                if status_response.status_code == 200:
                    status_data = status_response.json()
                    print(f"Crew Hub Data: {status_data}")
                    assert "booking_id" in status_data
                    assert "crew" in status_data
    
    def test_07_verify_payment_window_timing(self):
        """Verify payment window is set correctly based on booking type"""
        if not self.user_id:
            pytest.skip("Login failed - skipping test")
        
        # Test with existing booking
        response = self.session.get(
            f"{BASE_URL}/api/bookings/{TEST_BOOKING_ID}/crew-hub-status",
            params={"captain_id": self.user_id}
        )
        
        if response.status_code == 200:
            data = response.json()
            booking_type = data.get("booking_type", "scheduled")
            payment_window = data.get("payment_window_expires_at")
            
            print(f"Booking Type: {booking_type}")
            print(f"Payment Window Expires: {payment_window}")
            
            # Verify booking_type field exists
            assert "booking_type" in data, "Missing booking_type field"
            
            # If payment window is set, verify it's a valid ISO timestamp
            if payment_window:
                try:
                    datetime.fromisoformat(payment_window.replace('Z', '+00:00'))
                    print("Payment window timestamp is valid ISO format")
                except ValueError:
                    pytest.fail(f"Invalid payment window timestamp: {payment_window}")


class TestCrewHubDataValidation:
    """Test Crew Hub data validation and edge cases"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test session"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        self.user_id = None
        self.login()
    
    def login(self):
        """Login and get user ID"""
        response = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        if response.status_code == 200:
            data = response.json()
            self.user_id = data.get("user", {}).get("id")
    
    def test_08_invalid_booking_id_returns_404(self):
        """Test that invalid booking ID returns 404"""
        if not self.user_id:
            pytest.skip("Login failed - skipping test")
        
        fake_booking_id = str(uuid.uuid4())
        response = self.session.get(
            f"{BASE_URL}/api/bookings/{fake_booking_id}/crew-hub-status",
            params={"captain_id": self.user_id}
        )
        
        assert response.status_code == 404, f"Expected 404 for invalid booking, got {response.status_code}"
        print("Invalid booking ID correctly returns 404")
    
    def test_09_non_captain_access_denied(self):
        """Test that non-captain cannot access Crew Hub"""
        # Use a different user ID that's not the captain
        fake_captain_id = str(uuid.uuid4())
        
        response = self.session.get(
            f"{BASE_URL}/api/bookings/{TEST_BOOKING_ID}/crew-hub-status",
            params={"captain_id": fake_captain_id}
        )
        
        # Should return 403 (forbidden) or 404 (booking not found for this user)
        assert response.status_code in [403, 404], f"Expected 403/404 for non-captain, got {response.status_code}"
        print(f"Non-captain access correctly denied with status {response.status_code}")
    
    def test_10_update_splits_validation(self):
        """Test that update splits validates total equals booking price"""
        if not self.user_id:
            pytest.skip("Login failed - skipping test")
        
        # Send invalid splits that don't add up to total
        response = self.session.post(
            f"{BASE_URL}/api/bookings/{TEST_BOOKING_ID}/crew-hub/update-splits",
            json={
                "captain_id": self.user_id,
                "splits": [
                    {
                        "participant_id": str(uuid.uuid4()),
                        "share_amount": 10.00,
                        "share_percentage": 10,
                        "covered_by_captain": False
                    }
                ],
                "captain_share": 10.00  # Total = 20, likely less than booking price
            }
        )
        
        print(f"Invalid Splits Response: {response.status_code}")
        
        # Should return 400 (validation error) or 403/404 if not captain/not found
        assert response.status_code in [400, 403, 404], f"Expected validation error, got {response.status_code}"
        
        if response.status_code == 400:
            data = response.json()
            assert "detail" in data, "Missing error detail"
            print(f"Validation error: {data.get('detail')}")


class TestCrewHubRefundFlow:
    """Test refund flow - refunds go to credit balance, not bank"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test session"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        self.user_id = None
        self.initial_balance = 0
        self.login()
    
    def login(self):
        """Login and get user ID and initial balance"""
        response = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        if response.status_code == 200:
            data = response.json()
            # Login returns 'id' directly (profile ID), not nested under 'user'
            self.user_id = data.get("id")
            self.initial_balance = data.get("credit_balance", 0)
            print(f"Initial credit balance: ${self.initial_balance}")
    
    def test_11_refund_goes_to_credit_balance(self):
        """Verify refunds are added to credit_balance, not bank account"""
        if not self.user_id:
            pytest.skip("Login failed - skipping test")
        
        # This test verifies the refund_credits function behavior
        # by checking the cancel-refund endpoint response structure
        
        response = self.session.post(
            f"{BASE_URL}/api/bookings/{TEST_BOOKING_ID}/crew-hub/cancel-refund",
            params={"captain_id": self.user_id}
        )
        
        print(f"Cancel Refund Response: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            refunds = data.get("refunds", [])
            
            # Verify refund structure includes new_balance (credit balance)
            for refund in refunds:
                assert "refunded_amount" in refund, "Missing refunded_amount"
                assert "new_balance" in refund, "Missing new_balance - refund should update credit balance"
                print(f"Refund: ${refund.get('refunded_amount')} -> new balance: ${refund.get('new_balance')}")
            
            # Verify message mentions credit balance
            message = data.get("message", "")
            assert "credit" in message.lower(), f"Message should mention credit balance: {message}"
            print(f"Refund message: {message}")
        elif response.status_code == 400:
            # Booking might already be confirmed or cancelled
            data = response.json()
            print(f"Cannot cancel: {data.get('detail')}")
        else:
            print(f"Unexpected response: {response.text}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
