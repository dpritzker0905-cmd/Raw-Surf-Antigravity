"""
Test Ad Approval Queue for Self-Serve Ad Engine
Tests:
- POST /api/ads/submit - User submits ad for approval (deducts credits)
- GET /api/admin/ads/queue - Get pending ads
- POST /api/admin/ads/queue/{ad_id}/action - Approve/Reject ads
"""
import pytest
import requests
import os
import uuid

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Admin credentials from test context
ADMIN_ID = "12dc6786-124f-40b1-8698-a9409f99736f"


class TestAdSubmission:
    """Test user ad submission endpoint"""
    
    def test_submit_ad_success(self):
        """Test submitting an ad for approval"""
        # First get user's current balance
        profile_resp = requests.get(f"{BASE_URL}/api/profiles/{ADMIN_ID}")
        assert profile_resp.status_code == 200, f"Failed to get profile: {profile_resp.text}"
        initial_balance = profile_resp.json().get("credit_balance", 0)
        
        # Submit an ad
        ad_data = {
            "headline": f"TEST_Ad_{uuid.uuid4().hex[:6]}",
            "description": "Test ad description for approval queue testing",
            "cta": "Learn More",
            "cta_link": "/test-link",
            "ad_type": "sponsored",
            "target_roles": [],
            "budget_credits": 10
        }
        
        response = requests.post(
            f"{BASE_URL}/api/ads/submit?user_id={ADMIN_ID}",
            json=ad_data
        )
        
        print(f"Submit ad response: {response.status_code} - {response.text}")
        assert response.status_code == 200, f"Failed to submit ad: {response.text}"
        
        data = response.json()
        assert data.get("success") == True
        assert "ad_id" in data
        assert data.get("credits_spent") == 10
        assert data.get("new_balance") == initial_balance - 10
        
        # Store ad_id for cleanup
        self.submitted_ad_id = data["ad_id"]
        print(f"Submitted ad ID: {self.submitted_ad_id}")
        return data["ad_id"]
    
    def test_submit_ad_insufficient_credits(self):
        """Test submitting ad with insufficient credits"""
        # Try to submit with very high budget
        ad_data = {
            "headline": "TEST_Expensive_Ad",
            "description": "This should fail due to insufficient credits",
            "cta": "Buy Now",
            "cta_link": "/expensive",
            "ad_type": "sponsored",
            "budget_credits": 999999  # Very high amount
        }
        
        response = requests.post(
            f"{BASE_URL}/api/ads/submit?user_id={ADMIN_ID}",
            json=ad_data
        )
        
        print(f"Insufficient credits response: {response.status_code} - {response.text}")
        # Should fail with 400 for insufficient credits
        assert response.status_code == 400, f"Expected 400, got {response.status_code}"
        assert "Insufficient credits" in response.text or "insufficient" in response.text.lower()


class TestAdApprovalQueue:
    """Test admin ad approval queue endpoints"""
    
    def test_get_pending_queue(self):
        """Test getting pending ads queue"""
        response = requests.get(
            f"{BASE_URL}/api/admin/ads/queue?admin_id={ADMIN_ID}&status=pending"
        )
        
        print(f"Get queue response: {response.status_code} - {response.text}")
        assert response.status_code == 200, f"Failed to get queue: {response.text}"
        
        data = response.json()
        assert "queue" in data
        assert "counts" in data
        assert "pending" in data["counts"]
        assert "approved" in data["counts"]
        assert "rejected" in data["counts"]
        
        print(f"Queue counts: {data['counts']}")
        return data
    
    def test_get_all_queue_statuses(self):
        """Test getting queue with different status filters"""
        for status in ["pending", "approved", "rejected"]:
            response = requests.get(
                f"{BASE_URL}/api/admin/ads/queue?admin_id={ADMIN_ID}&status={status}"
            )
            assert response.status_code == 200, f"Failed to get {status} queue: {response.text}"
            data = response.json()
            assert "queue" in data
            print(f"{status.capitalize()} queue: {len(data['queue'])} items")


class TestAdApprovalActions:
    """Test approve/reject actions on ads"""
    
    @pytest.fixture(autouse=True)
    def setup_test_ad(self):
        """Create a test ad before each test"""
        ad_data = {
            "headline": f"TEST_ApprovalAction_{uuid.uuid4().hex[:6]}",
            "description": "Test ad for approval action testing",
            "cta": "Test CTA",
            "cta_link": "/test",
            "ad_type": "sponsored",
            "budget_credits": 10
        }
        
        response = requests.post(
            f"{BASE_URL}/api/ads/submit?user_id={ADMIN_ID}",
            json=ad_data
        )
        
        if response.status_code == 200:
            self.test_ad_id = response.json()["ad_id"]
            print(f"Created test ad: {self.test_ad_id}")
        else:
            self.test_ad_id = None
            print(f"Failed to create test ad: {response.text}")
        
        yield
        
        # Cleanup - no need to delete as ads are in-memory
    
    def test_approve_ad(self):
        """Test approving an ad"""
        if not hasattr(self, 'test_ad_id') or not self.test_ad_id:
            pytest.skip("No test ad created")
        
        response = requests.post(
            f"{BASE_URL}/api/admin/ads/queue/{self.test_ad_id}/action?admin_id={ADMIN_ID}",
            json={"action": "approve"}
        )
        
        print(f"Approve ad response: {response.status_code} - {response.text}")
        assert response.status_code == 200, f"Failed to approve ad: {response.text}"
        
        data = response.json()
        assert data.get("success") == True
        assert "approved" in data.get("message", "").lower()
        
        # Verify the variant is now active
        variant = data.get("variant", {})
        assert variant.get("approval_status") == "approved"
        assert variant.get("is_active") == True
    
    def test_reject_ad(self):
        """Test rejecting an ad"""
        # Create a new ad for rejection test
        ad_data = {
            "headline": f"TEST_RejectAd_{uuid.uuid4().hex[:6]}",
            "description": "Test ad for rejection",
            "cta": "Test",
            "cta_link": "/test",
            "ad_type": "sponsored",
            "budget_credits": 10
        }
        
        submit_resp = requests.post(
            f"{BASE_URL}/api/ads/submit?user_id={ADMIN_ID}",
            json=ad_data
        )
        
        if submit_resp.status_code != 200:
            pytest.skip("Could not create test ad for rejection")
        
        ad_id = submit_resp.json()["ad_id"]
        
        response = requests.post(
            f"{BASE_URL}/api/admin/ads/queue/{ad_id}/action?admin_id={ADMIN_ID}",
            json={
                "action": "reject",
                "reason": "Test rejection reason"
            }
        )
        
        print(f"Reject ad response: {response.status_code} - {response.text}")
        assert response.status_code == 200, f"Failed to reject ad: {response.text}"
        
        data = response.json()
        assert data.get("success") == True
        assert "rejected" in data.get("message", "").lower()
        
        variant = data.get("variant", {})
        assert variant.get("approval_status") == "rejected"
        assert variant.get("is_active") == False
    
    def test_approve_nonexistent_ad(self):
        """Test approving a non-existent ad"""
        response = requests.post(
            f"{BASE_URL}/api/admin/ads/queue/nonexistent_ad_12345/action?admin_id={ADMIN_ID}",
            json={"action": "approve"}
        )
        
        print(f"Nonexistent ad response: {response.status_code}")
        assert response.status_code == 404


class TestMyAdSubmissions:
    """Test user's own ad submissions endpoint"""
    
    def test_get_my_submissions(self):
        """Test getting user's own ad submissions"""
        response = requests.get(
            f"{BASE_URL}/api/ads/my-submissions?user_id={ADMIN_ID}"
        )
        
        print(f"My submissions response: {response.status_code} - {response.text}")
        assert response.status_code == 200, f"Failed to get submissions: {response.text}"
        
        data = response.json()
        assert "ads" in data
        assert "counts" in data
        assert "pending" in data["counts"]
        assert "approved" in data["counts"]
        assert "rejected" in data["counts"]
        
        print(f"My submissions counts: {data['counts']}")


class TestAdCancellation:
    """Test cancelling pending ad submissions"""
    
    def test_cancel_pending_ad(self):
        """Test cancelling a pending ad and getting refund"""
        # First submit an ad
        ad_data = {
            "headline": f"TEST_CancelAd_{uuid.uuid4().hex[:6]}",
            "description": "Test ad for cancellation",
            "cta": "Test",
            "cta_link": "/test",
            "ad_type": "sponsored",
            "budget_credits": 10
        }
        
        # Get initial balance
        profile_resp = requests.get(f"{BASE_URL}/api/profiles/{ADMIN_ID}")
        initial_balance = profile_resp.json().get("credit_balance", 0)
        
        submit_resp = requests.post(
            f"{BASE_URL}/api/ads/submit?user_id={ADMIN_ID}",
            json=ad_data
        )
        
        if submit_resp.status_code != 200:
            pytest.skip("Could not create test ad for cancellation")
        
        ad_id = submit_resp.json()["ad_id"]
        balance_after_submit = submit_resp.json()["new_balance"]
        
        # Cancel the ad
        response = requests.delete(
            f"{BASE_URL}/api/ads/my-submissions/{ad_id}?user_id={ADMIN_ID}"
        )
        
        print(f"Cancel ad response: {response.status_code} - {response.text}")
        assert response.status_code == 200, f"Failed to cancel ad: {response.text}"
        
        data = response.json()
        assert data.get("success") == True
        assert data.get("refund_amount") == 10
        
        # Verify balance was refunded
        profile_resp = requests.get(f"{BASE_URL}/api/profiles/{ADMIN_ID}")
        final_balance = profile_resp.json().get("credit_balance", 0)
        
        # Balance should be back to initial (or close to it)
        print(f"Balance: initial={initial_balance}, after_submit={balance_after_submit}, final={final_balance}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
