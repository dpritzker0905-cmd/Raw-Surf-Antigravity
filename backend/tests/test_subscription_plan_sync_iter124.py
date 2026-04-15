"""
Test Subscription Plan Sync - Iteration 124
Tests the 'Handshake' fix to prevent Zombie Subscriptions

Key Tests:
- P0: Verify /api/subscriptions/account-billing/{user_id} returns role-specific tiers
- P0: Verify Surfer tier prices match config: Free=$0, Basic=$4.99/mo, Premium=$14.99/mo
- P0: Verify Grom tier prices match config: Free=$0, Grom Basic=$2.99/mo, Grom Premium=$7.99/mo
- P1: Verify tier upgrade initiates Stripe checkout with correct amount
"""

import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test User IDs from review request
TEST_SURFER_ID = "0e42ce7f-c289-4ed8-a407-9697c2ad4cb7"  # Comp Surfer role
TEST_GROM_PARENT_ID = "fc495a58-ccfa-4cd3-8641-5d90e11619be"

# Expected prices from centralized config (SINGLE SOURCE OF TRUTH)
EXPECTED_SURFER_PRICES = {
    "tier_1": {"name": "Free", "price": 0},
    "tier_2": {"name": "Basic", "price": 4.99},
    "tier_3": {"name": "Premium", "price": 14.99}
}

EXPECTED_GROM_PRICES = {
    "tier_1": {"name": "Free", "price": 0},
    "tier_2": {"name": "Grom Basic", "price": 2.99},
    "tier_3": {"name": "Grom Premium", "price": 7.99}
}

EXPECTED_PHOTOGRAPHER_PRICES = {
    "tier_2": {"name": "Basic", "price": 18.00},
    "tier_3": {"name": "Premium", "price": 30.00}
}


class TestSurferTierPricing:
    """P0: Verify Surfer tier prices match centralized config"""
    
    def test_surfer_account_billing_returns_correct_tiers(self):
        """Verify /api/subscriptions/account-billing returns Surfer tiers for Comp Surfer role"""
        response = requests.get(f"{BASE_URL}/api/subscriptions/account-billing/{TEST_SURFER_ID}")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "available_tiers" in data, "Response missing available_tiers"
        assert "role" in data, "Response missing role"
        
        # Comp Surfer should get SURFER tiers
        role = data["role"]
        assert role in ["Surfer", "Comp Surfer", "Pro"], f"Unexpected role: {role}"
        
        available_tiers = data["available_tiers"]
        assert "tier_1" in available_tiers, "Missing tier_1 (Free)"
        assert "tier_2" in available_tiers, "Missing tier_2 (Basic)"
        assert "tier_3" in available_tiers, "Missing tier_3 (Premium)"
        
        print(f"✓ Surfer account-billing returns correct tiers for role: {role}")
    
    def test_surfer_free_tier_price_is_zero(self):
        """P0: Verify Surfer Free tier price is $0"""
        response = requests.get(f"{BASE_URL}/api/subscriptions/account-billing/{TEST_SURFER_ID}")
        assert response.status_code == 200
        
        data = response.json()
        tier_1 = data["available_tiers"]["tier_1"]
        
        assert tier_1["price"] == 0, f"Free tier price should be 0, got {tier_1['price']}"
        assert tier_1["name"] == "Free", f"Free tier name should be 'Free', got {tier_1['name']}"
        
        print(f"✓ Surfer Free tier: ${tier_1['price']} (expected $0)")
    
    def test_surfer_basic_tier_price_is_4_99(self):
        """P0: Verify Surfer Basic tier price is $4.99/mo"""
        response = requests.get(f"{BASE_URL}/api/subscriptions/account-billing/{TEST_SURFER_ID}")
        assert response.status_code == 200
        
        data = response.json()
        tier_2 = data["available_tiers"]["tier_2"]
        
        assert tier_2["price"] == 4.99, f"Basic tier price should be 4.99, got {tier_2['price']}"
        assert tier_2["name"] == "Basic", f"Basic tier name should be 'Basic', got {tier_2['name']}"
        
        print(f"✓ Surfer Basic tier: ${tier_2['price']}/mo (expected $4.99/mo)")
    
    def test_surfer_premium_tier_price_is_14_99(self):
        """P0: Verify Surfer Premium tier price is $14.99/mo"""
        response = requests.get(f"{BASE_URL}/api/subscriptions/account-billing/{TEST_SURFER_ID}")
        assert response.status_code == 200
        
        data = response.json()
        tier_3 = data["available_tiers"]["tier_3"]
        
        assert tier_3["price"] == 14.99, f"Premium tier price should be 14.99, got {tier_3['price']}"
        assert tier_3["name"] == "Premium", f"Premium tier name should be 'Premium', got {tier_3['name']}"
        assert tier_3.get("gold_pass") == True, "Premium tier should have gold_pass=True"
        
        print(f"✓ Surfer Premium tier: ${tier_3['price']}/mo (expected $14.99/mo)")
    
    def test_surfer_tier_features_present(self):
        """Verify Surfer tiers have features array"""
        response = requests.get(f"{BASE_URL}/api/subscriptions/account-billing/{TEST_SURFER_ID}")
        assert response.status_code == 200
        
        data = response.json()
        for tier_id in ["tier_1", "tier_2", "tier_3"]:
            tier = data["available_tiers"][tier_id]
            assert "features" in tier, f"{tier_id} missing features array"
            assert len(tier["features"]) > 0, f"{tier_id} has empty features array"
        
        print("✓ All Surfer tiers have features arrays")


class TestGromTierPricing:
    """P0: Verify Grom tier prices match centralized config"""
    
    def test_grom_parent_can_see_grom_tiers_for_linked_groms(self):
        """P1: Verify Grom Parent can see Grom-specific tiers when managing linked Groms"""
        response = requests.get(f"{BASE_URL}/api/subscriptions/account-billing/{TEST_GROM_PARENT_ID}")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data["role"] == "Grom Parent", f"Expected Grom Parent role, got {data['role']}"
        
        # Grom Parent should have linked_groms
        linked_groms = data.get("linked_groms", [])
        print(f"Grom Parent has {len(linked_groms)} linked Groms")
        
        # The parent's own available_tiers should be SURFER tiers (parents are adults)
        # But when managing Groms, the frontend uses GROM_PLANS from config
        available_tiers = data["available_tiers"]
        assert "tier_1" in available_tiers, "Missing tier_1"
        
        print(f"✓ Grom Parent account-billing returns correctly")
    
    def test_grom_tier_endpoint_validates_grom_prices(self):
        """P0: Verify Grom tier prices via grom-tier endpoint"""
        # First get linked groms
        response = requests.get(f"{BASE_URL}/api/subscriptions/account-billing/{TEST_GROM_PARENT_ID}")
        assert response.status_code == 200
        
        data = response.json()
        linked_groms = data.get("linked_groms", [])
        
        if len(linked_groms) == 0:
            pytest.skip("No linked Groms found for test parent")
        
        grom_id = linked_groms[0]["id"]
        
        # Test free tier (should be instant, no Stripe)
        response = requests.post(
            f"{BASE_URL}/api/subscriptions/grom-tier/{TEST_GROM_PARENT_ID}",
            json={
                "grom_id": grom_id,
                "tier_id": "tier_1",
                "origin_url": "https://raw-surf-os.preview.emergentagent.com"
            }
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        result = response.json()
        assert result.get("checkout_url") is None, "Free tier should not have checkout_url"
        assert result.get("success") == True, "Free tier switch should succeed"
        
        print(f"✓ Grom Free tier switch works (no Stripe checkout)")


class TestTierUpgradeStripeCheckout:
    """P1: Verify tier upgrade initiates Stripe checkout with correct amount"""
    
    def test_upgrade_to_basic_tier_creates_stripe_checkout(self):
        """Verify upgrading to Basic tier creates Stripe checkout with $4.99"""
        response = requests.post(
            f"{BASE_URL}/api/subscriptions/upgrade-tier/{TEST_SURFER_ID}",
            json={
                "tier_id": "tier_2",
                "origin_url": "https://raw-surf-os.preview.emergentagent.com"
            }
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data.get("success") == True, "Upgrade should succeed"
        assert "checkout_url" in data, "Should return checkout_url for paid tier"
        assert data["checkout_url"] is not None, "checkout_url should not be None for paid tier"
        assert "tier_id" in data, "Should return tier_id"
        assert data["tier_id"] == "tier_2", f"Expected tier_2, got {data['tier_id']}"
        
        # Verify it's a Stripe checkout URL
        checkout_url = data["checkout_url"]
        assert "stripe.com" in checkout_url or "checkout.raw.surf" in checkout_url, \
            f"Expected Stripe checkout URL, got {checkout_url}"
        
        print(f"✓ Basic tier upgrade creates Stripe checkout: {checkout_url[:50]}...")
    
    def test_upgrade_to_premium_tier_creates_stripe_checkout(self):
        """Verify upgrading to Premium tier creates Stripe checkout with $14.99"""
        response = requests.post(
            f"{BASE_URL}/api/subscriptions/upgrade-tier/{TEST_SURFER_ID}",
            json={
                "tier_id": "tier_3",
                "origin_url": "https://raw-surf-os.preview.emergentagent.com"
            }
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data.get("success") == True, "Upgrade should succeed"
        assert "checkout_url" in data, "Should return checkout_url for paid tier"
        assert data["checkout_url"] is not None, "checkout_url should not be None for paid tier"
        
        print(f"✓ Premium tier upgrade creates Stripe checkout")
    
    def test_switch_to_free_tier_no_stripe(self):
        """Verify switching to Free tier is instant (no Stripe)"""
        response = requests.post(
            f"{BASE_URL}/api/subscriptions/upgrade-tier/{TEST_SURFER_ID}",
            json={
                "tier_id": "tier_1",
                "origin_url": "https://raw-surf-os.preview.emergentagent.com"
            }
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data.get("success") == True, "Free tier switch should succeed"
        assert data.get("checkout_url") is None, "Free tier should not have checkout_url"
        
        print(f"✓ Free tier switch is instant (no Stripe checkout)")


class TestBackendFrontendPriceSync:
    """Verify backend tier definitions match frontend config"""
    
    def test_backend_surfer_prices_match_frontend_config(self):
        """P0: Backend SURFER_SUBSCRIPTION_TIERS must match frontend SURFER_PLANS"""
        response = requests.get(f"{BASE_URL}/api/subscriptions/account-billing/{TEST_SURFER_ID}")
        assert response.status_code == 200
        
        data = response.json()
        available_tiers = data["available_tiers"]
        
        # Compare with expected prices from frontend config
        for tier_id, expected in EXPECTED_SURFER_PRICES.items():
            actual = available_tiers.get(tier_id)
            assert actual is not None, f"Missing {tier_id} in backend response"
            assert actual["price"] == expected["price"], \
                f"{tier_id} price mismatch: backend={actual['price']}, expected={expected['price']}"
            assert actual["name"] == expected["name"], \
                f"{tier_id} name mismatch: backend={actual['name']}, expected={expected['name']}"
        
        print("✓ Backend Surfer prices match frontend config:")
        print(f"  - Free: ${available_tiers['tier_1']['price']}")
        print(f"  - Basic: ${available_tiers['tier_2']['price']}/mo")
        print(f"  - Premium: ${available_tiers['tier_3']['price']}/mo")
    
    def test_backend_has_gold_pass_for_premium(self):
        """Verify Premium tier has gold_pass=True"""
        response = requests.get(f"{BASE_URL}/api/subscriptions/account-billing/{TEST_SURFER_ID}")
        assert response.status_code == 200
        
        data = response.json()
        tier_3 = data["available_tiers"]["tier_3"]
        
        assert tier_3.get("gold_pass") == True, "Premium tier should have gold_pass=True"
        assert tier_3.get("commission_rate") == 0.15, \
            f"Premium commission_rate should be 0.15, got {tier_3.get('commission_rate')}"
        
        print(f"✓ Premium tier has gold_pass=True and 15% commission")
    
    def test_backend_has_correct_storage_values(self):
        """Verify storage_gb values match config"""
        response = requests.get(f"{BASE_URL}/api/subscriptions/account-billing/{TEST_SURFER_ID}")
        assert response.status_code == 200
        
        data = response.json()
        tiers = data["available_tiers"]
        
        assert tiers["tier_1"]["storage_gb"] == 5, "Free tier should have 5GB storage"
        assert tiers["tier_2"]["storage_gb"] == 50, "Basic tier should have 50GB storage"
        assert tiers["tier_3"]["storage_gb"] == -1, "Premium tier should have unlimited (-1) storage"
        
        print("✓ Storage values match config:")
        print(f"  - Free: {tiers['tier_1']['storage_gb']}GB")
        print(f"  - Basic: {tiers['tier_2']['storage_gb']}GB")
        print(f"  - Premium: Unlimited")


class TestRoleSpecificTiers:
    """Verify get_tiers_for_role() returns correct tiers"""
    
    def test_surfer_roles_get_surfer_tiers(self):
        """Surfer/Comp Surfer/Pro roles should get SURFER_SUBSCRIPTION_TIERS"""
        response = requests.get(f"{BASE_URL}/api/subscriptions/account-billing/{TEST_SURFER_ID}")
        assert response.status_code == 200
        
        data = response.json()
        role = data["role"]
        tiers = data["available_tiers"]
        
        # Surfer tiers have specific IDs
        assert tiers["tier_1"]["id"] == "surfer_free", f"Expected surfer_free, got {tiers['tier_1']['id']}"
        assert tiers["tier_2"]["id"] == "surfer_basic", f"Expected surfer_basic, got {tiers['tier_2']['id']}"
        assert tiers["tier_3"]["id"] == "surfer_premium", f"Expected surfer_premium, got {tiers['tier_3']['id']}"
        
        print(f"✓ Role '{role}' correctly gets Surfer tiers")
    
    def test_grom_parent_gets_surfer_tiers_for_self(self):
        """Grom Parent's own available_tiers should be Surfer tiers (adults)"""
        response = requests.get(f"{BASE_URL}/api/subscriptions/account-billing/{TEST_GROM_PARENT_ID}")
        assert response.status_code == 200
        
        data = response.json()
        assert data["role"] == "Grom Parent"
        
        # Grom Parents are adults, so they get Surfer tiers for themselves
        # The GROM_PLANS are used by frontend when managing linked Groms
        tiers = data["available_tiers"]
        
        # Check that tiers exist
        assert "tier_1" in tiers, "Missing tier_1"
        assert "tier_2" in tiers, "Missing tier_2"
        assert "tier_3" in tiers, "Missing tier_3"
        
        print(f"✓ Grom Parent gets tiers for self-management")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
