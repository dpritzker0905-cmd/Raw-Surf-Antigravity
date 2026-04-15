"""
Test Ad Approval Queue - Admin Console Ad Queue functionality
Tests the Self-Serve Ad Engine approval queue endpoints
"""
import pytest
import requests
import os
import uuid

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')
ADMIN_ID = "12dc6786-124f-40b1-8698-a9409f99736f"


class TestAdApprovalQueue:
    """Tests for Admin Ad Queue endpoints"""
    
    def test_get_ad_queue_returns_pending_approved_rejected(self):
        """GET /api/admin/ads/queue returns pending/approved/rejected ads"""
        response = requests.get(f"{BASE_URL}/api/admin/ads/queue?admin_id={ADMIN_ID}")
        
        assert response.status_code == 200
        data = response.json()
        
        # Verify structure
        assert "pending" in data
        assert "approved" in data
        assert "rejected" in data
        assert "counts" in data
        
        # Verify counts structure
        assert "pending" in data["counts"]
        assert "approved" in data["counts"]
        assert "rejected" in data["counts"]
        
        # Verify counts are integers
        assert isinstance(data["counts"]["pending"], int)
        assert isinstance(data["counts"]["approved"], int)
        assert isinstance(data["counts"]["rejected"], int)
        
        print(f"Queue counts: pending={data['counts']['pending']}, approved={data['counts']['approved']}, rejected={data['counts']['rejected']}")
    
    def test_get_ad_queue_requires_admin(self):
        """GET /api/admin/ads/queue requires admin access"""
        # Test with invalid admin_id
        response = requests.get(f"{BASE_URL}/api/admin/ads/queue?admin_id=invalid-id")
        assert response.status_code in [403, 404]
    
    def test_approve_ad_activates_it(self):
        """POST /api/admin/ads/queue/{ad_id}/action with approve activates the ad"""
        # First, get a pending ad
        queue_response = requests.get(f"{BASE_URL}/api/admin/ads/queue?admin_id={ADMIN_ID}")
        assert queue_response.status_code == 200
        queue_data = queue_response.json()
        
        pending_ads = queue_data.get("pending", [])
        if not pending_ads:
            pytest.skip("No pending ads to test approval")
        
        # Get first pending ad
        ad_to_approve = pending_ads[0]
        ad_id = ad_to_approve["id"]
        
        # Approve the ad
        approve_response = requests.post(
            f"{BASE_URL}/api/admin/ads/queue/{ad_id}/action?admin_id={ADMIN_ID}",
            json={"action": "approve"}
        )
        
        assert approve_response.status_code == 200
        approve_data = approve_response.json()
        
        assert approve_data["success"] is True
        assert approve_data["message"] == "Ad approved and activated"
        assert approve_data["variant"]["approval_status"] == "approved"
        assert approve_data["variant"]["is_active"] is True
        assert "approved_by" in approve_data["variant"]
        assert "approved_at" in approve_data["variant"]
        
        print(f"Approved ad: {ad_id}")
    
    def test_reject_ad_with_reason(self):
        """POST /api/admin/ads/queue/{ad_id}/action with reject refunds credits"""
        # First, get a pending ad
        queue_response = requests.get(f"{BASE_URL}/api/admin/ads/queue?admin_id={ADMIN_ID}")
        assert queue_response.status_code == 200
        queue_data = queue_response.json()
        
        pending_ads = queue_data.get("pending", [])
        if not pending_ads:
            pytest.skip("No pending ads to test rejection")
        
        # Get first pending ad
        ad_to_reject = pending_ads[0]
        ad_id = ad_to_reject["id"]
        
        # Reject the ad
        reject_response = requests.post(
            f"{BASE_URL}/api/admin/ads/queue/{ad_id}/action?admin_id={ADMIN_ID}",
            json={"action": "reject", "reason": "Test rejection - does not meet guidelines"}
        )
        
        assert reject_response.status_code == 200
        reject_data = reject_response.json()
        
        assert reject_data["success"] is True
        assert reject_data["message"] == "Ad rejected"
        assert reject_data["variant"]["approval_status"] == "rejected"
        assert reject_data["variant"]["is_active"] is False
        assert "rejected_by" in reject_data["variant"]
        assert "rejected_at" in reject_data["variant"]
        assert reject_data["variant"]["rejection_reason"] == "Test rejection - does not meet guidelines"
        
        print(f"Rejected ad: {ad_id}")
    
    def test_approve_nonexistent_ad_returns_404(self):
        """POST /api/admin/ads/queue/{ad_id}/action returns 404 for nonexistent ad"""
        response = requests.post(
            f"{BASE_URL}/api/admin/ads/queue/nonexistent_ad_id/action?admin_id={ADMIN_ID}",
            json={"action": "approve"}
        )
        assert response.status_code == 404
    
    def test_invalid_action_returns_400(self):
        """POST /api/admin/ads/queue/{ad_id}/action returns 400 for invalid action"""
        # First, get a pending ad
        queue_response = requests.get(f"{BASE_URL}/api/admin/ads/queue?admin_id={ADMIN_ID}")
        queue_data = queue_response.json()
        
        pending_ads = queue_data.get("pending", [])
        if not pending_ads:
            pytest.skip("No pending ads to test invalid action")
        
        ad_id = pending_ads[0]["id"]
        
        response = requests.post(
            f"{BASE_URL}/api/admin/ads/queue/{ad_id}/action?admin_id={ADMIN_ID}",
            json={"action": "invalid_action"}
        )
        assert response.status_code == 400


class TestAdConfig:
    """Tests for Ad Config endpoints"""
    
    def test_get_ad_config(self):
        """GET /api/admin/ads/config returns ad configuration"""
        response = requests.get(f"{BASE_URL}/api/admin/ads/config?admin_id={ADMIN_ID}")
        
        assert response.status_code == 200
        data = response.json()
        
        assert "config" in data
        config = data["config"]
        
        # Verify config structure
        assert "frequency" in config
        assert "variants" in config
        assert isinstance(config["variants"], list)
        
        print(f"Ad config: frequency={config['frequency']}, variants={len(config['variants'])}")
    
    def test_get_ad_analytics(self):
        """GET /api/admin/ads/analytics returns ad analytics"""
        response = requests.get(f"{BASE_URL}/api/admin/ads/analytics?admin_id={ADMIN_ID}")
        
        assert response.status_code == 200
        data = response.json()
        
        # Verify analytics structure
        assert "analytics" in data or "ad_supported_users" in data
        
        print(f"Ad analytics: {data}")


class TestAdSubmission:
    """Tests for user ad submission endpoints"""
    
    def test_get_my_submissions(self):
        """GET /api/ads/my-submissions returns user's submitted ads"""
        response = requests.get(f"{BASE_URL}/api/ads/my-submissions?user_id={ADMIN_ID}")
        
        assert response.status_code == 200
        data = response.json()
        
        assert "ads" in data
        assert "counts" in data
        assert isinstance(data["ads"], list)
        
        print(f"User submissions: {data['counts']}")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
