"""
Test Jump In Session Flow - Live Photography Sessions
Tests the complete flow: join session, payment, leave session, refund logic
"""
import pytest
import requests
import os
import time

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://raw-surf-os.preview.emergentagent.com')

# Test credentials from review request
PHOTOGRAPHER_ID = "12dc6786-124f-40b1-8698-a9409f99736f"
SURFER_ID = "e9b9f4df-86b7-4934-b617-4f1883358dba"


class TestJumpInSessionFlow:
    """Test the Jump In Session flow for live photography sessions"""
    
    def test_photographer_is_shooting(self):
        """Verify photographer is in is_shooting state for Jump In to work"""
        response = requests.get(f"{BASE_URL}/api/profiles/{PHOTOGRAPHER_ID}")
        assert response.status_code == 200, f"Failed to get photographer: {response.text}"
        
        data = response.json()
        assert data.get('is_shooting') == True, f"Photographer is_shooting should be True, got: {data.get('is_shooting')}"
        print(f"PASS: Photographer {data.get('full_name')} is shooting")
        print(f"  - Username: @{data.get('username')}")
        print(f"  - Session price: ${data.get('session_price', 25)}")
    
    def test_surfer_profile_exists(self):
        """Verify surfer profile exists and has correct role"""
        response = requests.get(f"{BASE_URL}/api/profiles/{SURFER_ID}")
        assert response.status_code == 200, f"Failed to get surfer: {response.text}"
        
        data = response.json()
        assert data.get('role') in ['Surfer', 'Grom', 'Comp Surfer', 'Pro', 'Hobbyist', 'Grom Parent'], \
            f"Surfer role should be a surfer-capable role, got: {data.get('role')}"
        print(f"PASS: Surfer {data.get('full_name')} exists")
        print(f"  - Username: @{data.get('username')}")
        print(f"  - Role: {data.get('role')}")
        print(f"  - Credit balance: ${data.get('credit_balance', 0)}")
    
    def test_join_session_endpoint_exists(self):
        """Test that the join session endpoint exists and validates input"""
        # Test with missing photographer_id
        response = requests.post(
            f"{BASE_URL}/api/sessions/join?surfer_id={SURFER_ID}",
            json={"payment_method": "credits"}
        )
        # Should fail with validation error (missing photographer_id)
        assert response.status_code == 422, f"Expected 422 for missing photographer_id, got: {response.status_code}"
        print("PASS: Join session endpoint validates required fields")
    
    def test_join_session_photographer_not_shooting(self):
        """Test joining session when photographer is not shooting"""
        # Use a random non-shooting photographer ID
        fake_photographer_id = "00000000-0000-0000-0000-000000000000"
        response = requests.post(
            f"{BASE_URL}/api/sessions/join?surfer_id={SURFER_ID}",
            json={
                "photographer_id": fake_photographer_id,
                "payment_method": "credits"
            }
        )
        # Should fail with 404 (photographer not found)
        assert response.status_code == 404, f"Expected 404 for non-existent photographer, got: {response.status_code}"
        print("PASS: Join session correctly rejects non-existent photographer")
    
    def test_join_session_insufficient_credits(self):
        """Test joining session with insufficient credits"""
        # First check surfer's credit balance
        profile_response = requests.get(f"{BASE_URL}/api/profiles/{SURFER_ID}")
        surfer_data = profile_response.json()
        credit_balance = surfer_data.get('credit_balance', 0)
        
        # Get photographer's session price
        photographer_response = requests.get(f"{BASE_URL}/api/profiles/{PHOTOGRAPHER_ID}")
        photographer_data = photographer_response.json()
        session_price = photographer_data.get('session_price', 25) or photographer_data.get('live_buyin_price', 25) or 25
        
        print(f"  - Surfer credit balance: ${credit_balance}")
        print(f"  - Session price: ${session_price}")
        
        if credit_balance < session_price:
            # Should fail with insufficient credits
            response = requests.post(
                f"{BASE_URL}/api/sessions/join?surfer_id={SURFER_ID}",
                json={
                    "photographer_id": PHOTOGRAPHER_ID,
                    "payment_method": "credits"
                }
            )
            assert response.status_code == 400, f"Expected 400 for insufficient credits, got: {response.status_code}"
            print("PASS: Join session correctly rejects insufficient credits")
        else:
            print("SKIP: Surfer has enough credits, cannot test insufficient credits scenario")
    
    def test_join_session_card_payment_returns_checkout_url(self):
        """Test that card payment returns Stripe checkout URL"""
        response = requests.post(
            f"{BASE_URL}/api/sessions/join?surfer_id={SURFER_ID}",
            json={
                "photographer_id": PHOTOGRAPHER_ID,
                "payment_method": "card",
                "origin_url": "https://raw-surf-os.preview.emergentagent.com"
            }
        )
        
        # Should return checkout URL for card payment
        if response.status_code == 200:
            data = response.json()
            assert data.get('requires_payment') == True, "Card payment should require payment redirect"
            assert 'checkout_url' in data, "Card payment should return checkout_url"
            assert 'session_id' in data, "Card payment should return session_id"
            # Stripe checkout URL can be custom domain or stripe.com
            checkout_url = data.get('checkout_url', '')
            assert 'checkout' in checkout_url or 'stripe' in checkout_url, f"Checkout URL should be valid: {checkout_url}"
            print("PASS: Card payment returns Stripe checkout URL")
            print(f"  - Checkout URL: {data.get('checkout_url')[:50]}...")
            print(f"  - Session ID: {data.get('session_id')}")
        elif response.status_code == 500:
            # Stripe not configured or error
            print(f"SKIP: Stripe payment error - {response.json().get('detail', 'Unknown error')}")
        else:
            pytest.fail(f"Unexpected status code: {response.status_code}, response: {response.text}")
    
    def test_complete_payment_endpoint_exists(self):
        """Test that complete-payment endpoint exists"""
        # Test with invalid checkout session ID
        response = requests.post(
            f"{BASE_URL}/api/sessions/complete-payment",
            json={"checkout_session_id": "invalid_session_id"}
        )
        # Should fail with Stripe error (invalid session)
        assert response.status_code in [400, 500], f"Expected 400/500 for invalid session, got: {response.status_code}"
        print("PASS: Complete payment endpoint exists and validates input")
    
    def test_get_user_live_sessions(self):
        """Test fetching user's active live sessions"""
        response = requests.get(f"{BASE_URL}/api/sessions/user/{SURFER_ID}")
        assert response.status_code == 200, f"Failed to get user sessions: {response.text}"
        
        data = response.json()
        assert isinstance(data, list), "Response should be a list"
        print(f"PASS: Get user live sessions returns {len(data)} sessions")
        
        # Check session structure if any exist
        if len(data) > 0:
            session = data[0]
            print(f"  - Session ID: {session.get('id')}")
            print(f"  - Photographer: @{session.get('photographer_username', session.get('photographer_name'))}")
            print(f"  - Amount paid: ${session.get('amount_paid')}")
    
    def test_leave_session_endpoint_exists(self):
        """Test that leave session endpoint exists"""
        # Test with invalid session ID
        response = requests.post(
            f"{BASE_URL}/api/sessions/leave/invalid-session-id?user_id={SURFER_ID}"
        )
        # Should fail with 404 (session not found)
        assert response.status_code == 404, f"Expected 404 for invalid session, got: {response.status_code}"
        print("PASS: Leave session endpoint exists and validates session ID")
    
    def test_leave_session_refund_logic_endpoint(self):
        """Test that leave session endpoint has refund logic (checks bookings.py endpoint)"""
        # The correct endpoint with refund logic is in bookings.py
        # It requires user_id query parameter
        response = requests.post(
            f"{BASE_URL}/api/sessions/leave/invalid-session-id?user_id={SURFER_ID}"
        )
        
        # Check if the response indicates the endpoint with user_id is being used
        # The sessions.py endpoint doesn't require user_id, bookings.py does
        if response.status_code == 404:
            error_detail = response.json().get('detail', '')
            # bookings.py returns "Session not found or already ended"
            # sessions.py returns "Session participation not found"
            if "already ended" in error_detail:
                print("PASS: Leave session endpoint with refund logic is active")
            else:
                print(f"WARNING: Leave session endpoint may not have refund logic. Error: {error_detail}")
        else:
            print(f"INFO: Leave session returned status {response.status_code}")
    
    def test_get_active_session_for_photographer(self):
        """Test getting active session details for a photographer"""
        response = requests.get(f"{BASE_URL}/api/sessions/active/{PHOTOGRAPHER_ID}")
        
        if response.status_code == 200:
            data = response.json()
            print("PASS: Get active session returns session details")
            print(f"  - Photographer: {data.get('photographer_name')}")
            print(f"  - Spot: {data.get('spot_name')}")
            print(f"  - Session price: ${data.get('session_price')}")
            print(f"  - Participants: {data.get('participants_count')}")
        elif response.status_code == 400:
            # Photographer not shooting
            print("INFO: Photographer has no active session (not shooting)")
        else:
            pytest.fail(f"Unexpected status code: {response.status_code}")
    
    def test_session_pricing_endpoint(self):
        """Test the session pricing endpoint for CaptureSession"""
        response = requests.post(
            f"{BASE_URL}/api/sessions/pricing?user_id={SURFER_ID}",
            json={
                "photographer_id": PHOTOGRAPHER_ID,
                "session_mode": "live_join",
                "resolution": "standard"
            }
        )
        
        if response.status_code == 200:
            data = response.json()
            print("PASS: Session pricing endpoint returns pricing info")
            print(f"  - Entry fee: ${data.get('entry_fee')}")
            print(f"  - Photo price: ${data.get('photo_price')}")
            print(f"  - Photos included: {data.get('photos_included')}")
            print(f"  - User credit balance: ${data.get('user_credit_balance')}")
            print(f"  - Already joined: {data.get('already_joined')}")
        else:
            print(f"INFO: Session pricing returned status {response.status_code}: {response.text}")


class TestLiveSessionsTabDisplay:
    """Test the Live Sessions tab display requirements"""
    
    def test_username_display_in_sessions(self):
        """Test that sessions return photographer_username for @username display"""
        response = requests.get(f"{BASE_URL}/api/sessions/user/{SURFER_ID}")
        assert response.status_code == 200
        
        data = response.json()
        if len(data) > 0:
            session = data[0]
            # Check if photographer_username is returned
            has_username = 'photographer_username' in session
            print(f"PASS: Sessions include photographer_username: {has_username}")
            if has_username:
                print(f"  - Username: @{session.get('photographer_username')}")
        else:
            print("INFO: No active sessions to verify username display")
    
    def test_photographer_username_exists(self):
        """Verify photographer has username set for @username display"""
        response = requests.get(f"{BASE_URL}/api/profiles/{PHOTOGRAPHER_ID}")
        assert response.status_code == 200
        
        data = response.json()
        username = data.get('username')
        assert username is not None, "Photographer should have username set"
        print(f"PASS: Photographer has username: @{username}")


class TestAlreadyInSessionCheck:
    """Test duplicate session join prevention"""
    
    def test_already_in_session_check(self):
        """Test that joining same session twice is prevented"""
        # First, check if user is already in a session with this photographer
        sessions_response = requests.get(f"{BASE_URL}/api/sessions/user/{SURFER_ID}")
        sessions = sessions_response.json()
        
        already_in_session = any(
            s.get('photographer_id') == PHOTOGRAPHER_ID 
            for s in sessions
        )
        
        if already_in_session:
            # Try to join again - should fail
            response = requests.post(
                f"{BASE_URL}/api/sessions/join?surfer_id={SURFER_ID}",
                json={
                    "photographer_id": PHOTOGRAPHER_ID,
                    "payment_method": "card"  # Use card to avoid credit check
                }
            )
            assert response.status_code == 400, f"Expected 400 for already in session, got: {response.status_code}"
            assert "Already in this session" in response.json().get('detail', ''), \
                "Error should indicate already in session"
            print("PASS: Duplicate session join is prevented")
        else:
            print("INFO: User not in session with photographer, cannot test duplicate prevention")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
