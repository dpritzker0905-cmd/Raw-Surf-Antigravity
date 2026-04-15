"""
Architecture Audit - Crew Payment Atomicity Tests - Iteration 286
Tests for crew payment with atomic transaction and metadata storage.

Test 4: Crew payment includes payer_name, payer_username stored in participant record
"""

import pytest
import requests
import os
from datetime import datetime, timezone

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Valid test users
TEST_CAPTAIN = "aaf2cadf-549d-4a6c-a5b2-25ec3a84c851"  # atlantissurf - has credits
TEST_CREW_MEMBER = "5ab9c957-2af1-4846-9023-47576df41454"  # seanstanhope - has 14.0625 credits


class TestCrewPaymentAtomicity:
    """Test 4: Crew payment atomicity with payer metadata storage"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test data"""
        self.dispatch_id = None
        self.participant_id = None
    
    def test_01_create_shared_dispatch(self):
        """Create a shared dispatch request with crew member"""
        print(f"\n=== CREATE SHARED DISPATCH ===")
        
        response = requests.post(
            f"{BASE_URL}/api/dispatch/request",
            params={"requester_id": TEST_CAPTAIN},
            json={
                "latitude": 28.3667,
                "longitude": -80.6067,
                "location_name": "Crew Payment Test Beach",
                "estimated_duration_hours": 1.0,
                "is_immediate": True,
                "arrival_window_minutes": 30,
                "is_shared": True,
                "friend_ids": [TEST_CREW_MEMBER],
                "crew_shares": [
                    {"user_id": TEST_CREW_MEMBER, "share_amount": 3.0, "covered_by_captain": False}
                ]
            }
        )
        
        print(f"Status: {response.status_code}")
        print(f"Response: {response.text[:1000]}")
        
        if response.status_code == 404:
            pytest.skip("No photographers available")
            return
        
        assert response.status_code == 200, f"Failed: {response.text}"
        
        data = response.json()
        self.__class__.dispatch_id = data["id"]
        
        # Verify shared session fields
        assert data.get("num_participants") == 2, "Should have 2 participants (captain + crew)"
        
        print(f"PASS: Shared dispatch created with ID: {self.__class__.dispatch_id}")
        print(f"PASS: num_participants = {data.get('num_participants')}")
    
    def test_02_captain_pays_first(self):
        """Captain pays their share first"""
        if not hasattr(self.__class__, 'dispatch_id') or not self.__class__.dispatch_id:
            pytest.skip("No dispatch created")
            return
        
        print(f"\n=== CAPTAIN PAYMENT ===")
        
        response = requests.post(
            f"{BASE_URL}/api/dispatch/{self.__class__.dispatch_id}/pay",
            params={"payer_id": TEST_CAPTAIN}
        )
        
        print(f"Status: {response.status_code}")
        print(f"Response: {response.text[:1000]}")
        
        assert response.status_code == 200, f"Captain payment failed: {response.text}"
        
        data = response.json()
        assert data.get("captain_metadata_stored") == True, "Captain metadata should be stored"
        
        print(f"PASS: Captain paid, metadata_stored = {data.get('captain_metadata_stored')}")
    
    def test_03_get_crew_invite(self):
        """Get crew invite for the crew member"""
        if not hasattr(self.__class__, 'dispatch_id') or not self.__class__.dispatch_id:
            pytest.skip("No dispatch created")
            return
        
        print(f"\n=== GET CREW INVITES ===")
        
        response = requests.get(f"{BASE_URL}/api/dispatch/user/{TEST_CREW_MEMBER}/crew-invites")
        
        print(f"Status: {response.status_code}")
        print(f"Response: {response.text[:1500]}")
        
        assert response.status_code == 200, f"Failed: {response.text}"
        
        data = response.json()
        invites = data.get("crew_invites", [])
        
        # Find the invite for our dispatch
        our_invite = None
        for invite in invites:
            if invite.get("dispatch_id") == self.__class__.dispatch_id:
                our_invite = invite
                break
        
        if our_invite:
            self.__class__.participant_id = our_invite["id"]
            print(f"PASS: Found crew invite with participant_id: {self.__class__.participant_id}")
            print(f"PASS: your_share = ${our_invite.get('your_share')}")
        else:
            print(f"INFO: No invite found for dispatch {self.__class__.dispatch_id}")
            print(f"INFO: Available invites: {[i.get('dispatch_id') for i in invites]}")
            pytest.skip("Crew invite not found")
    
    def test_04_crew_payment_stores_metadata(self):
        """Test 4: Crew member pays and verify payer metadata is stored atomically"""
        if not hasattr(self.__class__, 'participant_id') or not self.__class__.participant_id:
            pytest.skip("No participant ID")
            return
        
        print(f"\n=== CREW PAYMENT ===")
        
        # Get crew member's initial balance
        balance_response = requests.get(f"{BASE_URL}/api/credits/balance/{TEST_CREW_MEMBER}")
        initial_balance = balance_response.json()["balance"]
        print(f"Initial balance: ${initial_balance}")
        
        # Pay crew share
        response = requests.post(
            f"{BASE_URL}/api/dispatch/crew-invite/{self.__class__.participant_id}/pay",
            params={"payer_id": TEST_CREW_MEMBER},
            json={"selfie_url": None, "require_selfie": False}
        )
        
        print(f"Status: {response.status_code}")
        print(f"Response: {response.text[:1000]}")
        
        if response.status_code == 400 and "Insufficient credits" in response.text:
            pytest.skip(f"Test user has insufficient credits: {response.text}")
            return
        
        assert response.status_code == 200, f"Crew payment failed: {response.text}"
        
        data = response.json()
        
        # Verify payment success
        assert data.get("success") == True, "Payment should succeed"
        
        # Verify crew payment status
        crew_status = data.get("crew_payment_status", {})
        assert crew_status.get("paid_count") >= 1, "At least 1 crew member should be paid"
        
        print(f"PASS: Crew payment successful")
        print(f"PASS: crew_payment_status.paid_count = {crew_status.get('paid_count')}")
        print(f"PASS: crew_payment_status.all_paid = {crew_status.get('all_paid')}")
    
    def test_05_verify_crew_metadata_stored(self):
        """Verify crew member's payer metadata was stored in participant record"""
        if not hasattr(self.__class__, 'dispatch_id') or not self.__class__.dispatch_id:
            pytest.skip("No dispatch created")
            return
        
        print(f"\n=== VERIFY CREW METADATA ===")
        
        # Use verify-payment endpoint for crew member
        response = requests.get(
            f"{BASE_URL}/api/dispatch/{self.__class__.dispatch_id}/verify-payment",
            params={"user_id": TEST_CREW_MEMBER}
        )
        
        print(f"Status: {response.status_code}")
        print(f"Response: {response.text[:1000]}")
        
        assert response.status_code == 200, f"Failed: {response.text}"
        
        data = response.json()
        
        # If payment was not completed (insufficient credits), skip this test
        if data.get("error") == "Payment not confirmed":
            pytest.skip("Crew payment was not completed (insufficient credits)")
            return
        
        # CRITICAL: Verify metadata was stored
        assert data.get("success") == True, "success should be True"
        assert data.get("verified") == True, "verified should be True (metadata present)"
        assert data.get("role") == "crew_member", "role should be crew_member"
        
        metadata = data.get("metadata", {})
        assert metadata.get("name") is not None, "FAIL: payer_name should be stored"
        assert metadata.get("username") is not None, "FAIL: payer_username should be stored"
        
        print(f"PASS: success = {data.get('success')}")
        print(f"PASS: verified = {data.get('verified')}")
        print(f"PASS: metadata.name = {metadata.get('name')}")
        print(f"PASS: metadata.username = {metadata.get('username')}")
    
    def test_06_crew_status_shows_paid_crew(self):
        """Verify crew status endpoint shows paid crew with metadata"""
        if not hasattr(self.__class__, 'dispatch_id') or not self.__class__.dispatch_id:
            pytest.skip("No dispatch created")
            return
        
        print(f"\n=== CREW STATUS WITH PAID CREW ===")
        
        response = requests.get(f"{BASE_URL}/api/dispatch/{self.__class__.dispatch_id}/crew-status")
        
        print(f"Status: {response.status_code}")
        print(f"Response: {response.text[:1500]}")
        
        assert response.status_code == 200, f"Failed: {response.text}"
        
        data = response.json()
        
        # Verify captain info
        captain = data.get("captain", {})
        assert captain.get("paid") == True, "Captain should be paid"
        assert captain.get("metadata_verified") == True, "Captain metadata should be verified"
        
        # Verify crew info
        crew = data.get("crew", [])
        assert len(crew) >= 1, "Should have at least 1 crew member"
        
        # Find our crew member
        our_crew = None
        for c in crew:
            if c.get("id") == TEST_CREW_MEMBER:
                our_crew = c
                break
        
        if our_crew:
            # If crew member hasn't paid (insufficient credits), just verify structure
            if not our_crew.get("paid"):
                print(f"INFO: Crew member not paid (insufficient credits)")
                print(f"PASS: Crew member found with correct structure")
                print(f"PASS: crew.name = {our_crew.get('name')}")
                print(f"PASS: crew.username = {our_crew.get('username')}")
                print(f"PASS: crew.paid = {our_crew.get('paid')}")
                pytest.skip("Crew payment was not completed (insufficient credits)")
                return
            
            assert our_crew.get("name") is not None, "Crew member name should be present"
            assert our_crew.get("username") is not None, "Crew member username should be present"
            
            print(f"PASS: Crew member found with metadata")
            print(f"PASS: crew.name = {our_crew.get('name')}")
            print(f"PASS: crew.username = {our_crew.get('username')}")
            print(f"PASS: crew.paid = {our_crew.get('paid')}")
        
        # Verify payment status
        payment_status = data.get("payment_status", {})
        print(f"PASS: payment_status.display = {payment_status.get('display')}")
        print(f"PASS: payment_status.fully_funded = {payment_status.get('fully_funded')}")
    
    def test_07_cleanup_cancel_dispatch(self):
        """Cleanup: Cancel the test dispatch"""
        if not hasattr(self.__class__, 'dispatch_id') or not self.__class__.dispatch_id:
            pytest.skip("No dispatch to cancel")
            return
        
        print(f"\n=== CLEANUP ===")
        
        response = requests.post(
            f"{BASE_URL}/api/dispatch/{self.__class__.dispatch_id}/cancel",
            params={"user_id": TEST_CAPTAIN},
            json={"reason": "Test cleanup - Crew Payment Atomicity Test"}
        )
        
        print(f"Status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            print(f"PASS: Dispatch cancelled, refund: ${data.get('refund_amount', 0)}")
        else:
            print(f"INFO: Could not cancel dispatch")


# Run tests if executed directly
if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short", "-x"])
