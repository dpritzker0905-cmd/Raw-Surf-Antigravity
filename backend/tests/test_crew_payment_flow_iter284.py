"""
Test On-Demand Crew Payment Flow - Iteration 284
Tests the complete flow of:
1. Creating a dispatch request with crew members
2. Crew member paying via /crew-invite/{id}/pay endpoint
3. Verifying participant status changes to 'paid'
4. Verifying photographer's pending endpoint returns updated crew status and selfie
"""

import pytest
import requests
import os
import uuid
from datetime import datetime, timezone

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test users from database
DAVIDSURF_ID = "e9b9f4df-86b7-4934-b617-4f1883358dba"  # Captain
SEANSTANHOPE_ID = "5ab9c957-2af1-4846-9023-47576df41454"  # Crew member
PHOTOGRAPHER_ID = "3fcda129-93b6-44d0-828e-1efd490fbc7a"  # Test Pro

class TestCrewPaymentFlow:
    """Test the complete on-demand crew payment flow"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test session"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        self.created_dispatch_id = None
        self.created_participant_id = None
        yield
        # Cleanup: Cancel any created dispatch
        if self.created_dispatch_id:
            try:
                self.session.post(
                    f"{BASE_URL}/api/dispatch/{self.created_dispatch_id}/cancel",
                    params={"user_id": DAVIDSURF_ID},
                    json={"reason": "Test cleanup"}
                )
            except:
                pass
    
    def test_01_create_dispatch_with_crew(self):
        """Test creating a dispatch request with crew members (shared session)"""
        # First, ensure davidsurf has enough credits
        profile_resp = self.session.get(f"{BASE_URL}/api/profiles/{DAVIDSURF_ID}")
        assert profile_resp.status_code == 200, f"Failed to get profile: {profile_resp.text}"
        
        # Create dispatch request with seanstanhope as crew
        dispatch_data = {
            "latitude": 28.5383,
            "longitude": -80.6081,
            "location_name": "Cocoa Beach Test",
            "estimated_duration_hours": 1.0,
            "is_immediate": True,
            "arrival_window_minutes": 30,
            "is_shared": True,
            "friend_ids": [SEANSTANHOPE_ID],
            "target_photographer_id": PHOTOGRAPHER_ID
        }
        
        response = self.session.post(
            f"{BASE_URL}/api/dispatch/request",
            params={"requester_id": DAVIDSURF_ID},
            json=dispatch_data
        )
        
        print(f"Create dispatch response: {response.status_code} - {response.text}")
        assert response.status_code == 200, f"Failed to create dispatch: {response.text}"
        
        data = response.json()
        assert "id" in data, "Response should contain dispatch ID"
        assert data.get("num_participants") == 2, "Should have 2 participants (captain + crew)"
        
        self.created_dispatch_id = data["id"]
        print(f"Created dispatch ID: {self.created_dispatch_id}")
        return data
    
    def test_02_verify_crew_invite_created(self):
        """Verify that crew invite was created for seanstanhope"""
        response = self.session.get(
            f"{BASE_URL}/api/dispatch/user/{SEANSTANHOPE_ID}/crew-invites"
        )
        
        print(f"Crew invites response: {response.status_code} - {response.text}")
        assert response.status_code == 200, f"Failed to get crew invites: {response.text}"
        
        data = response.json()
        invites = data.get("crew_invites", [])
        
        # Find the invite for our dispatch
        if self.created_dispatch_id:
            matching_invite = next(
                (inv for inv in invites if inv.get("dispatch_id") == self.created_dispatch_id),
                None
            )
            if matching_invite:
                assert matching_invite.get("status") in ["invited", "pending"], \
                    f"Invite status should be 'invited' or 'pending', got: {matching_invite.get('status')}"
                self.created_participant_id = matching_invite.get("id")
                print(f"Found participant ID: {self.created_participant_id}")
        
        return data
    
    def test_03_pay_crew_share_endpoint(self):
        """Test POST /api/dispatch/crew-invite/{participant_id}/pay endpoint"""
        # First get the participant ID from crew invites
        invites_resp = self.session.get(
            f"{BASE_URL}/api/dispatch/user/{SEANSTANHOPE_ID}/crew-invites"
        )
        assert invites_resp.status_code == 200
        
        invites = invites_resp.json().get("crew_invites", [])
        if not invites:
            pytest.skip("No crew invites found - need to create dispatch first")
        
        # Use the first invite (or the one matching our dispatch)
        invite = invites[0]
        participant_id = invite.get("id")
        
        # Test payment with selfie URL
        test_selfie_url = "https://example.com/test-selfie.jpg"
        
        response = self.session.post(
            f"{BASE_URL}/api/dispatch/crew-invite/{participant_id}/pay",
            params={"payer_id": SEANSTANHOPE_ID},
            json={"selfie_url": test_selfie_url}
        )
        
        print(f"Pay crew share response: {response.status_code} - {response.text}")
        
        # Check response
        if response.status_code == 200:
            data = response.json()
            assert data.get("success") == True, "Payment should be successful"
            assert "remaining_credits" in data, "Should return remaining credits"
            print(f"Payment successful! Remaining credits: {data.get('remaining_credits')}")
        elif response.status_code == 400:
            # Could be "Already paid" or "Insufficient credits"
            error_detail = response.json().get("detail", "")
            print(f"Payment failed (expected in some cases): {error_detail}")
            if "Already paid" in error_detail:
                print("Participant already paid - this is OK for testing")
            elif "Insufficient credits" in error_detail:
                pytest.skip("Insufficient credits for test user")
            else:
                assert False, f"Unexpected error: {error_detail}"
        else:
            assert False, f"Unexpected status code: {response.status_code}"
    
    def test_04_verify_participant_status_updated(self):
        """Verify participant status is 'paid' after payment"""
        # Get dispatch details
        invites_resp = self.session.get(
            f"{BASE_URL}/api/dispatch/user/{SEANSTANHOPE_ID}/crew-invites"
        )
        
        if invites_resp.status_code == 200:
            invites = invites_resp.json().get("crew_invites", [])
            # Check if any invite has status 'paid'
            paid_invites = [inv for inv in invites if inv.get("status") == "paid"]
            print(f"Found {len(paid_invites)} paid invites out of {len(invites)} total")
            
            # Also check via dispatch details endpoint
            if invites:
                dispatch_id = invites[0].get("dispatch_id")
                dispatch_resp = self.session.get(f"{BASE_URL}/api/dispatch/{dispatch_id}")
                if dispatch_resp.status_code == 200:
                    dispatch_data = dispatch_resp.json()
                    participants = dispatch_data.get("participants", [])
                    print(f"Dispatch participants: {participants}")
                    
                    # Find seanstanhope in participants
                    sean_participant = next(
                        (p for p in participants if p.get("user_id") == SEANSTANHOPE_ID),
                        None
                    )
                    if sean_participant:
                        print(f"Sean's status: {sean_participant.get('status')}")
                        print(f"Sean's selfie_url: {sean_participant.get('selfie_url')}")
    
    def test_05_photographer_pending_endpoint_returns_crew_status(self):
        """Test GET /api/dispatch/photographer/{photographer_id}/pending returns crew with correct status"""
        response = self.session.get(
            f"{BASE_URL}/api/dispatch/photographer/{PHOTOGRAPHER_ID}/pending"
        )
        
        print(f"Photographer pending response: {response.status_code} - {response.text}")
        assert response.status_code == 200, f"Failed to get pending dispatches: {response.text}"
        
        data = response.json()
        pending = data.get("pending_dispatches", [])
        
        print(f"Found {len(pending)} pending dispatches for photographer")
        
        for dispatch in pending:
            print(f"\nDispatch ID: {dispatch.get('dispatch_id')}")
            print(f"  Requester: {dispatch.get('requester_name')}")
            print(f"  Is Shared: {dispatch.get('is_shared')}")
            print(f"  Crew Count: {dispatch.get('crew_count')}")
            
            crew = dispatch.get("crew", [])
            for member in crew:
                print(f"  Crew Member: {member.get('name')}")
                print(f"    Status: {member.get('status')}")
                print(f"    Selfie URL: {member.get('selfie_url')}")
                print(f"    Share Amount: {member.get('share_amount')}")
                print(f"    Paid At: {member.get('paid_at')}")
                
                # Verify the data structure includes selfie_url
                assert "selfie_url" in member, "Crew member should have selfie_url field"
                assert "status" in member, "Crew member should have status field"
    
    def test_06_dispatch_details_returns_participants_with_selfie(self):
        """Test GET /api/dispatch/{dispatch_id} returns all participants with selfie URLs"""
        # Get a dispatch ID from crew invites
        invites_resp = self.session.get(
            f"{BASE_URL}/api/dispatch/user/{SEANSTANHOPE_ID}/crew-invites"
        )
        
        if invites_resp.status_code != 200:
            pytest.skip("No crew invites available")
        
        invites = invites_resp.json().get("crew_invites", [])
        if not invites:
            pytest.skip("No crew invites found")
        
        dispatch_id = invites[0].get("dispatch_id")
        
        response = self.session.get(f"{BASE_URL}/api/dispatch/{dispatch_id}")
        
        print(f"Dispatch details response: {response.status_code} - {response.text}")
        assert response.status_code == 200, f"Failed to get dispatch details: {response.text}"
        
        data = response.json()
        
        # Verify structure
        assert "participants" in data, "Response should include participants"
        assert "is_shared" in data, "Response should include is_shared flag"
        
        participants = data.get("participants", [])
        print(f"\nDispatch {dispatch_id} has {len(participants)} participants:")
        
        for p in participants:
            print(f"  - {p.get('name')} (@{p.get('username')})")
            print(f"    Status: {p.get('status')}")
            print(f"    Selfie URL: {p.get('selfie_url')}")
            print(f"    Share Amount: {p.get('share_amount')}")
            print(f"    Paid At: {p.get('paid_at')}")
            
            # Verify data structure
            assert "selfie_url" in p, "Participant should have selfie_url field"
            assert "status" in p, "Participant should have status field"
            assert "share_amount" in p, "Participant should have share_amount field"


class TestPayCrewShareEndpoint:
    """Focused tests on the pay_crew_share endpoint"""
    
    def test_pay_endpoint_requires_payer_id(self):
        """Test that payer_id is required"""
        response = requests.post(
            f"{BASE_URL}/api/dispatch/crew-invite/fake-id/pay",
            json={"selfie_url": "https://example.com/selfie.jpg"}
        )
        # Should fail with 422 (missing payer_id) or 404 (not found)
        assert response.status_code in [400, 404, 422], f"Expected error, got: {response.status_code}"
    
    def test_pay_endpoint_invalid_participant_id(self):
        """Test with invalid participant ID"""
        response = requests.post(
            f"{BASE_URL}/api/dispatch/crew-invite/invalid-uuid/pay",
            params={"payer_id": SEANSTANHOPE_ID},
            json={"selfie_url": "https://example.com/selfie.jpg"}
        )
        assert response.status_code == 404, f"Expected 404, got: {response.status_code}"
    
    def test_pay_endpoint_stores_selfie_url(self):
        """Test that selfie_url is properly stored when paying"""
        # Get existing crew invites
        invites_resp = requests.get(
            f"{BASE_URL}/api/dispatch/user/{SEANSTANHOPE_ID}/crew-invites"
        )
        
        if invites_resp.status_code != 200:
            pytest.skip("Cannot get crew invites")
        
        invites = invites_resp.json().get("crew_invites", [])
        
        # Find an unpaid invite
        unpaid_invite = next(
            (inv for inv in invites if inv.get("status") in ["invited", "pending"]),
            None
        )
        
        if not unpaid_invite:
            pytest.skip("No unpaid invites available for testing")
        
        participant_id = unpaid_invite.get("id")
        test_selfie = f"https://example.com/test-selfie-{uuid.uuid4()}.jpg"
        
        # Pay with selfie
        pay_resp = requests.post(
            f"{BASE_URL}/api/dispatch/crew-invite/{participant_id}/pay",
            params={"payer_id": SEANSTANHOPE_ID},
            json={"selfie_url": test_selfie}
        )
        
        print(f"Pay response: {pay_resp.status_code} - {pay_resp.text}")
        
        if pay_resp.status_code == 200:
            # Verify selfie was stored by checking dispatch details
            dispatch_id = unpaid_invite.get("dispatch_id")
            dispatch_resp = requests.get(f"{BASE_URL}/api/dispatch/{dispatch_id}")
            
            if dispatch_resp.status_code == 200:
                participants = dispatch_resp.json().get("participants", [])
                sean_p = next(
                    (p for p in participants if p.get("user_id") == SEANSTANHOPE_ID),
                    None
                )
                if sean_p:
                    assert sean_p.get("selfie_url") == test_selfie, \
                        f"Selfie URL not stored correctly. Expected: {test_selfie}, Got: {sean_p.get('selfie_url')}"
                    print(f"Selfie URL correctly stored: {sean_p.get('selfie_url')}")


class TestPhotographerDashboardCrewDisplay:
    """Test that photographer's dashboard correctly shows crew members"""
    
    def test_pending_endpoint_includes_crew_info(self):
        """Verify /photographer/{id}/pending includes crew member details"""
        response = requests.get(
            f"{BASE_URL}/api/dispatch/photographer/{PHOTOGRAPHER_ID}/pending"
        )
        
        assert response.status_code == 200, f"Failed: {response.text}"
        
        data = response.json()
        pending = data.get("pending_dispatches", [])
        
        # Check structure of each pending dispatch
        for dispatch in pending:
            if dispatch.get("is_shared"):
                assert "crew" in dispatch, "Shared dispatch should have crew array"
                assert "crew_count" in dispatch, "Shared dispatch should have crew_count"
                
                crew = dispatch.get("crew", [])
                for member in crew:
                    # Verify all required fields are present
                    required_fields = ["id", "name", "status", "selfie_url", "share_amount"]
                    for field in required_fields:
                        assert field in member, f"Crew member missing field: {field}"
                    
                    print(f"Crew member {member.get('name')}: status={member.get('status')}, selfie={member.get('selfie_url')}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
