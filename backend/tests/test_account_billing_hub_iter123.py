"""
Test Account & Billing Hub Endpoints - Iteration 123
Tests for:
- GET /api/subscriptions/account-billing/{user_id} - Account billing status
- POST /api/subscriptions/toggle-status/{user_id} - Surfer status toggle
- POST /api/subscriptions/upgrade-tier/{user_id} - Tier upgrade with Stripe
- POST /api/subscriptions/grom-tier/{parent_id} - Grom subscription management
- POST /api/subscriptions/apply-pro/{user_id} - Pro vetting application
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test user IDs from review request
COMP_SURFER_ID = "0e42ce7f-c289-4ed8-a407-9697c2ad4cb7"
GROM_PARENT_ID = "fc495a58-ccfa-4cd3-8641-5d90e11619be"


class TestAccountBillingEndpoint:
    """Test /api/subscriptions/account-billing/{user_id}"""
    
    def test_get_account_billing_comp_surfer(self):
        """P0: Verify account-billing returns correct data for Comp Surfer"""
        response = requests.get(f"{BASE_URL}/api/subscriptions/account-billing/{COMP_SURFER_ID}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        
        # Verify required fields exist
        assert "user_id" in data, "Missing user_id"
        assert "role" in data, "Missing role"
        assert "current_status" in data, "Missing current_status"
        assert "available_tiers" in data, "Missing available_tiers"
        assert "current_tier_id" in data, "Missing current_tier_id"
        
        # Verify available_tiers structure
        tiers = data["available_tiers"]
        assert "tier_1" in tiers, "Missing tier_1 in available_tiers"
        assert "tier_2" in tiers, "Missing tier_2 in available_tiers"
        assert "tier_3" in tiers, "Missing tier_3 in available_tiers"
        
        # Verify tier details
        tier_1 = tiers["tier_1"]
        assert tier_1["name"] == "Tier 1 - Free", f"Unexpected tier_1 name: {tier_1['name']}"
        assert tier_1["price"] == 0, f"Unexpected tier_1 price: {tier_1['price']}"
        
        tier_2 = tiers["tier_2"]
        assert tier_2["name"] == "Tier 2 - Basic", f"Unexpected tier_2 name: {tier_2['name']}"
        assert tier_2["price"] == 4.99, f"Unexpected tier_2 price: {tier_2['price']}"
        
        tier_3 = tiers["tier_3"]
        assert tier_3["name"] == "Tier 3 - Premium", f"Unexpected tier_3 name: {tier_3['name']}"
        assert tier_3["price"] == 14.99, f"Unexpected tier_3 price: {tier_3['price']}"
        
        print(f"✓ Account billing data for Comp Surfer: role={data['role']}, status={data['current_status']}, tier={data['current_tier_id']}")
    
    def test_get_account_billing_grom_parent(self):
        """P0: Verify account-billing returns linked_groms for Grom Parent"""
        response = requests.get(f"{BASE_URL}/api/subscriptions/account-billing/{GROM_PARENT_ID}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        
        # Verify Grom Parent specific fields
        assert data["role"] == "Grom Parent", f"Expected 'Grom Parent', got {data['role']}"
        assert "linked_groms" in data, "Missing linked_groms for Grom Parent"
        
        # Verify linked_groms is a list
        linked_groms = data["linked_groms"]
        assert isinstance(linked_groms, list), f"linked_groms should be list, got {type(linked_groms)}"
        
        # If there are linked groms, verify structure
        if len(linked_groms) > 0:
            grom = linked_groms[0]
            assert "id" in grom, "Missing id in linked grom"
            assert "full_name" in grom, "Missing full_name in linked grom"
            assert "subscription_tier" in grom, "Missing subscription_tier in linked grom"
            assert "tier_id" in grom, "Missing tier_id in linked grom"
            print(f"✓ Grom Parent has {len(linked_groms)} linked Grom(s): {[g['full_name'] for g in linked_groms]}")
        else:
            print(f"✓ Grom Parent has no linked Groms (empty list)")
        
        print(f"✓ Account billing data for Grom Parent: role={data['role']}, linked_groms={len(linked_groms)}")
    
    def test_get_account_billing_invalid_user(self):
        """Verify 404 for non-existent user"""
        response = requests.get(f"{BASE_URL}/api/subscriptions/account-billing/invalid-user-id-12345")
        
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        print("✓ Returns 404 for invalid user ID")


class TestSurferStatusToggle:
    """Test /api/subscriptions/toggle-status/{user_id}"""
    
    def test_toggle_status_to_competitive(self):
        """P0: Verify toggle to competitive status"""
        response = requests.post(
            f"{BASE_URL}/api/subscriptions/toggle-status/{COMP_SURFER_ID}",
            json={"status": "competitive"}
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data["success"] == True, "Expected success=True"
        assert data["new_status"] == "competitive", f"Expected 'competitive', got {data['new_status']}"
        assert "elite_tier" in data, "Missing elite_tier in response"
        
        print(f"✓ Toggled to competitive: elite_tier={data['elite_tier']}, role={data.get('role')}")
    
    def test_toggle_status_to_regular(self):
        """P0: Verify toggle to regular status"""
        response = requests.post(
            f"{BASE_URL}/api/subscriptions/toggle-status/{COMP_SURFER_ID}",
            json={"status": "regular"}
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data["success"] == True, "Expected success=True"
        assert data["new_status"] == "regular", f"Expected 'regular', got {data['new_status']}"
        
        print(f"✓ Toggled to regular: elite_tier={data.get('elite_tier')}, role={data.get('role')}")
    
    def test_toggle_status_invalid_status(self):
        """Verify 400 for invalid status value"""
        response = requests.post(
            f"{BASE_URL}/api/subscriptions/toggle-status/{COMP_SURFER_ID}",
            json={"status": "invalid_status"}
        )
        
        assert response.status_code == 400, f"Expected 400, got {response.status_code}"
        print("✓ Returns 400 for invalid status value")
    
    def test_toggle_status_grom_parent_forbidden(self):
        """Verify Grom Parent cannot toggle surfer status"""
        response = requests.post(
            f"{BASE_URL}/api/subscriptions/toggle-status/{GROM_PARENT_ID}",
            json={"status": "competitive"}
        )
        
        assert response.status_code == 403, f"Expected 403, got {response.status_code}: {response.text}"
        print("✓ Grom Parent correctly forbidden from toggling surfer status")


class TestTierUpgrade:
    """Test /api/subscriptions/upgrade-tier/{user_id}"""
    
    def test_upgrade_to_free_tier(self):
        """P1: Verify switching to free tier (instant, no Stripe)"""
        response = requests.post(
            f"{BASE_URL}/api/subscriptions/upgrade-tier/{COMP_SURFER_ID}",
            json={
                "tier_id": "tier_1",
                "origin_url": "https://raw-surf-os.preview.emergentagent.com"
            }
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data["success"] == True, "Expected success=True"
        assert data["checkout_url"] is None, "Free tier should not have checkout_url"
        assert data["tier_id"] == "tier_1", f"Expected tier_1, got {data['tier_id']}"
        
        print(f"✓ Switched to free tier: {data['message']}")
    
    def test_upgrade_to_paid_tier_returns_checkout_url(self):
        """P1: Verify paid tier upgrade initiates Stripe checkout"""
        response = requests.post(
            f"{BASE_URL}/api/subscriptions/upgrade-tier/{COMP_SURFER_ID}",
            json={
                "tier_id": "tier_2",
                "origin_url": "https://raw-surf-os.preview.emergentagent.com"
            }
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data["success"] == True, "Expected success=True"
        assert "checkout_url" in data, "Missing checkout_url for paid tier"
        assert data["checkout_url"] is not None, "checkout_url should not be None for paid tier"
        # Stripe checkout URL may use custom domain (checkout.raw.surf) or stripe.com
        assert "checkout" in data["checkout_url"].lower() or "stripe" in data["checkout_url"].lower(), \
            f"Expected checkout URL, got {data['checkout_url']}"
        assert "cs_test" in data["checkout_url"], f"Expected Stripe test session ID in URL"
        
        print(f"✓ Paid tier upgrade returns Stripe checkout URL: {data['checkout_url'][:50]}...")
    
    def test_upgrade_invalid_tier(self):
        """Verify 400 for invalid tier"""
        response = requests.post(
            f"{BASE_URL}/api/subscriptions/upgrade-tier/{COMP_SURFER_ID}",
            json={
                "tier_id": "invalid_tier",
                "origin_url": "https://raw-surf-os.preview.emergentagent.com"
            }
        )
        
        assert response.status_code == 400, f"Expected 400, got {response.status_code}"
        print("✓ Returns 400 for invalid tier")


class TestGromTierManagement:
    """Test /api/subscriptions/grom-tier/{parent_id}"""
    
    def test_grom_tier_requires_grom_parent(self):
        """Verify only Grom Parents can manage Grom subscriptions"""
        # Try with non-parent user
        response = requests.post(
            f"{BASE_URL}/api/subscriptions/grom-tier/{COMP_SURFER_ID}",
            json={
                "grom_id": "some-grom-id",
                "tier_id": "tier_1",
                "origin_url": "https://raw-surf-os.preview.emergentagent.com"
            }
        )
        
        assert response.status_code == 403, f"Expected 403, got {response.status_code}: {response.text}"
        print("✓ Non-parent correctly forbidden from managing Grom subscriptions")
    
    def test_grom_tier_invalid_grom(self):
        """Verify 403 when Grom is not linked to parent"""
        response = requests.post(
            f"{BASE_URL}/api/subscriptions/grom-tier/{GROM_PARENT_ID}",
            json={
                "grom_id": "invalid-grom-id-12345",
                "tier_id": "tier_1",
                "origin_url": "https://raw-surf-os.preview.emergentagent.com"
            }
        )
        
        assert response.status_code == 403, f"Expected 403, got {response.status_code}: {response.text}"
        print("✓ Returns 403 for Grom not linked to parent")


class TestProVettingApplication:
    """Test /api/subscriptions/apply-pro/{user_id}"""
    
    def test_apply_pro_sets_pending_status(self):
        """P2: Verify apply-pro sets pending status for Comp Surfer"""
        # First ensure user is competitive
        requests.post(
            f"{BASE_URL}/api/subscriptions/toggle-status/{COMP_SURFER_ID}",
            json={"status": "competitive"}
        )
        
        # Apply for Pro
        response = requests.post(f"{BASE_URL}/api/subscriptions/apply-pro/{COMP_SURFER_ID}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data["success"] == True, "Expected success=True"
        assert data["status"] == "pending", f"Expected 'pending', got {data['status']}"
        assert "current_elite_tier" in data, "Missing current_elite_tier"
        
        print(f"✓ Pro application submitted: status={data['status']}, elite_tier={data['current_elite_tier']}")
    
    def test_apply_pro_grom_parent_forbidden(self):
        """Verify Grom Parent cannot apply for Pro"""
        response = requests.post(f"{BASE_URL}/api/subscriptions/apply-pro/{GROM_PARENT_ID}")
        
        assert response.status_code == 403, f"Expected 403, got {response.status_code}: {response.text}"
        print("✓ Grom Parent correctly forbidden from applying for Pro")


class TestSubscriptionPlans:
    """Test /api/subscriptions/plans endpoint"""
    
    def test_get_subscription_plans(self):
        """Verify subscription plans endpoint returns correct structure"""
        response = requests.get(f"{BASE_URL}/api/subscriptions/plans")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        
        # Verify surfer plans exist
        assert "surfer" in data, "Missing surfer plans"
        assert "monthly" in data["surfer"], "Missing surfer monthly plans"
        assert "annual" in data["surfer"], "Missing surfer annual plans"
        
        # Verify photographer plans exist
        assert "photographer" in data, "Missing photographer plans"
        
        print(f"✓ Subscription plans returned: surfer monthly={len(data['surfer']['monthly'])}, annual={len(data['surfer']['annual'])}")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
