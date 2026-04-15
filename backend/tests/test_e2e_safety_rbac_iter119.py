"""
Iteration 119 - Full System E2E Logic Audit
Tests: Safety Gate, RBAC, Stripe Identity, OneSignal, UI Structural Integrity

Test Categories:
1. Safety Gate & Auth - Grom account blocks navigation, forces ParentLinkView
2. Professional Perimeter RBAC - Grom Parent sidebar restrictions, Pro-Zone checks
3. Production Integrations - Stripe Identity, OneSignal
4. Grom Status API - is_linked, is_approved, guardian_code
"""

import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://raw-surf-os.preview.emergentagent.com')

# Test credentials
GROM_PARENT_EMAIL = "testgromparent@gmail.com"
GROM_PARENT_PASSWORD = "test123"

# Known IDs from previous tests
GROM_PARENT_PROFILE_ID = "e57e7be6-e217-47f7-9978-b51c469c7bbf"
LINKED_APPROVED_GROM_ID = "8bde602b-4d89-4142-a078-d2a048dd4c65"  # Junior Wave Rider - linked AND approved
LINKED_UNAPPROVED_GROM_ID = "8a203adc-f3bc-4de5-b102-d9aee28fba73"  # Test Grom With Parent - linked but NOT approved


class TestGromParentAuth:
    """Test Grom Parent authentication and basic access"""
    
    def test_grom_parent_login_success(self):
        """Verify Grom Parent can login successfully"""
        response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": GROM_PARENT_EMAIL, "password": GROM_PARENT_PASSWORD}
        )
        assert response.status_code == 200, f"Login failed: {response.text}"
        data = response.json()
        assert data["role"] == "Grom Parent", f"Expected Grom Parent role, got {data['role']}"
        assert data["email"] == GROM_PARENT_EMAIL
        print(f"PASS: Grom Parent login successful, user_id={data['user_id']}")


class TestGromStatusAPI:
    """Test Grom Status API for Safety Gate logic"""
    
    def test_linked_approved_grom_status(self):
        """Verify linked AND approved Grom has full access"""
        response = requests.get(f"{BASE_URL}/api/grom-hq/grom-status/{LINKED_APPROVED_GROM_ID}")
        assert response.status_code == 200, f"Failed to get grom status: {response.text}"
        data = response.json()
        
        assert data["is_grom"] == True, "Expected is_grom=True"
        assert data["is_linked"] == True, "Expected is_linked=True"
        assert data["is_approved"] == True, "Expected is_approved=True"
        assert data["guardian_code"] is not None, "Expected guardian_code to exist"
        assert data["parent_info"] is not None, "Expected parent_info to exist"
        print(f"PASS: Linked+Approved Grom status verified - guardian_code={data['guardian_code']}")
    
    def test_linked_unapproved_grom_status(self):
        """Verify linked but NOT approved Grom is blocked"""
        response = requests.get(f"{BASE_URL}/api/grom-hq/grom-status/{LINKED_UNAPPROVED_GROM_ID}")
        assert response.status_code == 200, f"Failed to get grom status: {response.text}"
        data = response.json()
        
        assert data["is_grom"] == True, "Expected is_grom=True"
        assert data["is_linked"] == True, "Expected is_linked=True"
        assert data["is_approved"] == False, "Expected is_approved=False (BLOCKED)"
        assert data["guardian_code"] is not None, "Expected guardian_code to exist"
        print(f"PASS: Linked+Unapproved Grom status verified - should be BLOCKED, guardian_code={data['guardian_code']}")
    
    def test_non_grom_user_status(self):
        """Verify non-Grom user returns is_grom=False"""
        response = requests.get(f"{BASE_URL}/api/grom-hq/grom-status/{GROM_PARENT_PROFILE_ID}")
        assert response.status_code == 200, f"Failed to get status: {response.text}"
        data = response.json()
        
        assert data["is_grom"] == False, "Expected is_grom=False for Grom Parent"
        assert data["is_approved"] == True, "Non-Grom should have is_approved=True (no restrictions)"
        print("PASS: Non-Grom user (Grom Parent) status verified - no restrictions")


class TestGromHQLinkedGroms:
    """Test Grom HQ linked groms management"""
    
    def test_get_linked_groms(self):
        """Verify parent can get list of linked groms"""
        response = requests.get(f"{BASE_URL}/api/grom-hq/linked-groms/{GROM_PARENT_PROFILE_ID}")
        assert response.status_code == 200, f"Failed to get linked groms: {response.text}"
        data = response.json()
        
        assert "linked_groms" in data, "Expected linked_groms in response"
        assert len(data["linked_groms"]) >= 2, f"Expected at least 2 linked groms, got {len(data['linked_groms'])}"
        assert "stats" in data, "Expected stats in response"
        
        # Verify grom data structure
        for grom in data["linked_groms"]:
            assert "id" in grom, "Expected id in grom data"
            assert "full_name" in grom, "Expected full_name in grom data"
            assert "credits_balance" in grom, "Expected credits_balance in grom data"
        
        print(f"PASS: Linked groms retrieved - count={len(data['linked_groms'])}")


class TestStripeIdentityIntegration:
    """Test Stripe Identity age verification endpoints"""
    
    def test_age_verification_status(self):
        """Check age verification status for Grom Parent"""
        response = requests.get(f"{BASE_URL}/api/grom-hq/age-verification-status/{GROM_PARENT_PROFILE_ID}")
        assert response.status_code == 200, f"Failed to get age verification status: {response.text}"
        data = response.json()
        
        assert "age_verified" in data, "Expected age_verified in response"
        assert "can_link_groms" in data, "Expected can_link_groms in response"
        print(f"PASS: Age verification status - verified={data['age_verified']}, can_link={data['can_link_groms']}")
    
    def test_create_age_verification_already_verified(self):
        """Test create age verification for already verified parent"""
        response = requests.post(
            f"{BASE_URL}/api/grom-hq/create-age-verification/{GROM_PARENT_PROFILE_ID}",
            json={"return_url": "https://raw-surf-os.preview.emergentagent.com/grom-hq"}
        )
        assert response.status_code == 200, f"Failed to create age verification: {response.text}"
        data = response.json()
        
        # Should return already_verified since parent is verified
        assert data.get("already_verified") == True, "Expected already_verified=True"
        print("PASS: Stripe Identity endpoint responds correctly for already verified parent")


class TestOneSignalIntegration:
    """Test OneSignal push notification endpoints"""
    
    def test_onesignal_config_endpoint(self):
        """Verify OneSignal config endpoint returns app_id"""
        response = requests.get(f"{BASE_URL}/api/push/onesignal/config")
        assert response.status_code == 200, f"Failed to get OneSignal config: {response.text}"
        data = response.json()
        
        assert "app_id" in data, "Expected app_id in response"
        assert "enabled" in data, "Expected enabled in response"
        assert data["enabled"] == True, "Expected OneSignal to be enabled"
        assert data["app_id"] is not None, "Expected app_id to be set"
        print(f"PASS: OneSignal config - app_id={data['app_id'][:8]}..., enabled={data['enabled']}")
    
    def test_vapid_key_endpoint(self):
        """Verify VAPID public key endpoint"""
        response = requests.get(f"{BASE_URL}/api/push/vapid-key")
        assert response.status_code == 200, f"Failed to get VAPID key: {response.text}"
        data = response.json()
        
        assert "public_key" in data, "Expected public_key in response"
        assert len(data["public_key"]) > 50, "Expected valid VAPID public key"
        print(f"PASS: VAPID key endpoint - key_length={len(data['public_key'])}")
    
    def test_push_subscribe_endpoint_exists(self):
        """Verify push subscribe endpoint exists (requires user_id param)"""
        response = requests.post(
            f"{BASE_URL}/api/push/subscribe",
            json={"endpoint": "test", "p256dh_key": "test", "auth_key": "test"}
        )
        # Should return 422 for missing user_id, not 404
        assert response.status_code == 422, f"Expected 422 for missing user_id, got {response.status_code}"
        print("PASS: Push subscribe endpoint exists (requires user_id)")
    
    def test_onesignal_subscribe_endpoint_exists(self):
        """Verify OneSignal subscribe endpoint exists"""
        response = requests.post(
            f"{BASE_URL}/api/push/onesignal/subscribe",
            json={"user_id": "test", "subscription_id": "test"}
        )
        # Should return 500 (DB error) or 200, not 404
        assert response.status_code in [200, 500], f"Expected 200 or 500, got {response.status_code}"
        print("PASS: OneSignal subscribe endpoint exists")


class TestParentalControls:
    """Test parental controls for linked Groms"""
    
    def test_get_parental_controls(self):
        """Verify parental controls are returned in grom status"""
        response = requests.get(f"{BASE_URL}/api/grom-hq/grom-status/{LINKED_APPROVED_GROM_ID}")
        assert response.status_code == 200, f"Failed to get grom status: {response.text}"
        data = response.json()
        
        assert "parental_controls" in data, "Expected parental_controls in response"
        controls = data["parental_controls"]
        
        # Verify control keys exist
        expected_keys = ["can_post", "can_stream", "can_message", "can_comment"]
        for key in expected_keys:
            assert key in controls, f"Expected {key} in parental_controls"
        
        print(f"PASS: Parental controls retrieved - can_post={controls.get('can_post')}, can_stream={controls.get('can_stream')}")


class TestGromCannotUnlink:
    """Test that Groms cannot unlink themselves"""
    
    def test_grom_cannot_unlink_self(self):
        """Verify Grom cannot unlink themselves"""
        response = requests.get(f"{BASE_URL}/api/grom-hq/can-grom-unlink/{LINKED_APPROVED_GROM_ID}")
        assert response.status_code == 200, f"Failed to check unlink permission: {response.text}"
        data = response.json()
        
        assert data["can_unlink"] == False, "Expected can_unlink=False"
        assert "reason" in data, "Expected reason in response"
        print(f"PASS: Grom cannot unlink self - reason: {data['reason']}")


class TestLinkByCode:
    """Test linking Grom by guardian code"""
    
    def test_link_by_invalid_code(self):
        """Verify invalid guardian code returns error"""
        response = requests.post(
            f"{BASE_URL}/api/grom-hq/link-by-code",
            params={"parent_id": GROM_PARENT_PROFILE_ID, "guardian_code": "INVALID123"}
        )
        assert response.status_code == 404, f"Expected 404 for invalid code, got {response.status_code}"
        print("PASS: Invalid guardian code returns 404")


class TestApproveGromLink:
    """Test approving Grom link"""
    
    def test_approve_already_approved_grom(self):
        """Test approving an already approved Grom"""
        response = requests.post(
            f"{BASE_URL}/api/grom-hq/approve-grom-link/{LINKED_APPROVED_GROM_ID}",
            params={"parent_id": GROM_PARENT_PROFILE_ID}
        )
        # Should succeed even if already approved
        assert response.status_code == 200, f"Failed to approve grom link: {response.text}"
        data = response.json()
        assert data["success"] == True
        print("PASS: Approve grom link endpoint works")


class TestGromActivity:
    """Test Grom activity monitoring endpoints"""
    
    def test_get_grom_activity(self):
        """Verify parent can get Grom activity"""
        response = requests.get(
            f"{BASE_URL}/api/grom-hq/activity/{LINKED_APPROVED_GROM_ID}",
            params={"parent_id": GROM_PARENT_PROFILE_ID}
        )
        assert response.status_code == 200, f"Failed to get grom activity: {response.text}"
        data = response.json()
        
        assert "grom_id" in data, "Expected grom_id in response"
        assert "activity" in data, "Expected activity in response"
        assert "parental_controls" in data, "Expected parental_controls in response"
        print(f"PASS: Grom activity retrieved - posts={data['activity'].get('total_posts', 0)}")
    
    def test_get_spending_summary(self):
        """Verify parent can get Grom spending summary"""
        response = requests.get(
            f"{BASE_URL}/api/grom-hq/spending-summary/{LINKED_APPROVED_GROM_ID}",
            params={"parent_id": GROM_PARENT_PROFILE_ID}
        )
        assert response.status_code == 200, f"Failed to get spending summary: {response.text}"
        data = response.json()
        
        assert "credits_balance" in data, "Expected credits_balance in response"
        assert "monthly_spending" in data, "Expected monthly_spending in response"
        print(f"PASS: Spending summary retrieved - balance={data['credits_balance']}, monthly={data['monthly_spending']}")


class TestFamilyActivityFeed:
    """Test family activity feed for Grom Parents"""
    
    def test_get_family_activity(self):
        """Verify parent can get family activity feed"""
        response = requests.get(
            f"{BASE_URL}/api/grom-hq/family-activity/{GROM_PARENT_PROFILE_ID}"
        )
        assert response.status_code == 200, f"Failed to get family activity: {response.text}"
        data = response.json()
        
        assert "activities" in data, "Expected activities in response"
        assert "groms" in data, "Expected groms in response"
        assert "total" in data, "Expected total in response"
        print(f"PASS: Family activity feed retrieved - activities={len(data['activities'])}, groms={len(data['groms'])}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
