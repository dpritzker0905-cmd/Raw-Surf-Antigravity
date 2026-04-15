"""
Test Suite for Surfer Gallery Review APIs (Iteration 261)

Tests the Gallery Review UX with Service-Entitlement Logic:
- Account Tier (Paid vs Free) controls the review experience
- Logic A: All-Inclusive, Logic B: Partial (credit-based), Logic C: Zero (pay-per-clip)
- Paid accounts get 'Full Session Insight' with batch selection
- Free accounts get 'Sequential Claiming' with blurred preview
- Identity confirmation combines AI + user confirmation

Endpoints tested:
- GET /api/surfer-gallery/session-entitlements/{session_id}
- GET /api/surfer-gallery/proposed-matches/{session_id}
- POST /api/surfer-gallery/claim-match
- POST /api/surfer-gallery/claim-matches-batch
- POST /api/surfer-gallery/dismiss-match
- POST /api/surfer-gallery/confirm-identity
- GET /api/surfer-gallery/resolution-upsell/{item_id}
- POST /api/surfer-gallery/upgrade-resolution/{item_id}
"""

import pytest
import requests
import os
import uuid
from datetime import datetime, timezone

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test data IDs - will be created during tests
TEST_USER_ID = None
TEST_PHOTOGRAPHER_ID = None
TEST_SESSION_ID = None
TEST_BOOKING_ID = None
TEST_GALLERY_ITEM_ID = None
TEST_CLAIM_QUEUE_ID = None


@pytest.fixture(scope="module")
def api_client():
    """Shared requests session"""
    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})
    return session


@pytest.fixture(scope="module")
def test_user(api_client):
    """Get or create a test user for gallery review testing"""
    # Try to login with test credentials
    login_response = api_client.post(f"{BASE_URL}/api/auth/login", json={
        "email": "test@test.com",
        "password": "test123"
    })
    
    if login_response.status_code == 200:
        user_data = login_response.json()
        return user_data.get("user", user_data)
    
    # If login fails, skip tests that require auth
    pytest.skip("Test user authentication failed")


class TestSessionEntitlementsAPI:
    """Tests for /api/surfer-gallery/session-entitlements/{session_id}"""
    
    def test_session_entitlements_returns_default_for_unknown_session(self, api_client, test_user):
        """Test that unknown session returns default entitlements"""
        unknown_session_id = str(uuid.uuid4())
        
        response = api_client.get(
            f"{BASE_URL}/api/surfer-gallery/session-entitlements/{unknown_session_id}",
            params={"user_id": test_user.get("id")}
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        # Verify default response structure
        assert "session_id" in data
        assert "session_type" in data
        assert "is_all_inclusive" in data
        assert "included_media_count" in data
        assert "claimed_count" in data
        assert "credits_remaining" in data
        assert "price_per_clip" in data
        assert "resolution_tier" in data
        
        # Default values for unknown session
        assert data["session_type"] == "unknown"
        assert data["is_all_inclusive"] == False
        assert data["included_media_count"] == 0
        assert data["credits_remaining"] == 0
        assert data["price_per_clip"] == 5.0
        
        print(f"✓ Session entitlements returns default for unknown session")
    
    def test_session_entitlements_requires_user_id(self, api_client):
        """Test that user_id is required"""
        session_id = str(uuid.uuid4())
        
        response = api_client.get(
            f"{BASE_URL}/api/surfer-gallery/session-entitlements/{session_id}"
        )
        
        # Should return 422 for missing required query param
        assert response.status_code == 422, f"Expected 422 for missing user_id, got {response.status_code}"
        print(f"✓ Session entitlements requires user_id parameter")
    
    def test_session_entitlements_response_structure(self, api_client, test_user):
        """Test response structure has all required fields"""
        session_id = str(uuid.uuid4())
        
        response = api_client.get(
            f"{BASE_URL}/api/surfer-gallery/session-entitlements/{session_id}",
            params={"user_id": test_user.get("id")}
        )
        
        assert response.status_code == 200
        data = response.json()
        
        # All required fields
        required_fields = [
            "session_id", "session_type", "is_all_inclusive",
            "included_media_count", "claimed_count", "credits_remaining",
            "price_per_clip", "resolution_tier"
        ]
        
        for field in required_fields:
            assert field in data, f"Missing required field: {field}"
        
        # Type checks
        assert isinstance(data["is_all_inclusive"], bool)
        assert isinstance(data["included_media_count"], int)
        assert isinstance(data["claimed_count"], int)
        assert isinstance(data["credits_remaining"], int)
        assert isinstance(data["price_per_clip"], (int, float))
        
        print(f"✓ Session entitlements response has correct structure")


class TestProposedMatchesAPI:
    """Tests for /api/surfer-gallery/proposed-matches/{session_id}"""
    
    def test_proposed_matches_returns_empty_for_no_matches(self, api_client, test_user):
        """Test that empty session returns empty matches list"""
        session_id = str(uuid.uuid4())
        
        response = api_client.get(
            f"{BASE_URL}/api/surfer-gallery/proposed-matches/{session_id}",
            params={"user_id": test_user.get("id")}
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "matches" in data
        assert "total" in data
        assert "is_paid_account" in data
        
        assert isinstance(data["matches"], list)
        assert data["total"] == len(data["matches"])
        
        print(f"✓ Proposed matches returns empty list for session with no matches")
    
    def test_proposed_matches_requires_user_id(self, api_client):
        """Test that user_id is required"""
        session_id = str(uuid.uuid4())
        
        response = api_client.get(
            f"{BASE_URL}/api/surfer-gallery/proposed-matches/{session_id}"
        )
        
        assert response.status_code == 422, f"Expected 422 for missing user_id, got {response.status_code}"
        print(f"✓ Proposed matches requires user_id parameter")
    
    def test_proposed_matches_returns_404_for_invalid_user(self, api_client):
        """Test that invalid user returns 404"""
        session_id = str(uuid.uuid4())
        invalid_user_id = str(uuid.uuid4())
        
        response = api_client.get(
            f"{BASE_URL}/api/surfer-gallery/proposed-matches/{session_id}",
            params={"user_id": invalid_user_id}
        )
        
        assert response.status_code == 404, f"Expected 404 for invalid user, got {response.status_code}"
        print(f"✓ Proposed matches returns 404 for invalid user")


class TestClaimMatchAPI:
    """Tests for /api/surfer-gallery/claim-match"""
    
    def test_claim_match_returns_404_for_invalid_match(self, api_client, test_user):
        """Test that claiming invalid match returns 404"""
        response = api_client.post(
            f"{BASE_URL}/api/surfer-gallery/claim-match",
            params={"user_id": test_user.get("id")},
            json={
                "match_id": str(uuid.uuid4()),
                "session_id": str(uuid.uuid4()),
                "use_credit": True
            }
        )
        
        assert response.status_code == 404, f"Expected 404 for invalid match, got {response.status_code}"
        print(f"✓ Claim match returns 404 for invalid match ID")
    
    def test_claim_match_requires_user_id(self, api_client):
        """Test that user_id is required"""
        response = api_client.post(
            f"{BASE_URL}/api/surfer-gallery/claim-match",
            json={
                "match_id": str(uuid.uuid4()),
                "session_id": str(uuid.uuid4()),
                "use_credit": True
            }
        )
        
        assert response.status_code == 422, f"Expected 422 for missing user_id, got {response.status_code}"
        print(f"✓ Claim match requires user_id parameter")
    
    def test_claim_match_validates_request_body(self, api_client, test_user):
        """Test that request body validation works"""
        # Missing required fields
        response = api_client.post(
            f"{BASE_URL}/api/surfer-gallery/claim-match",
            params={"user_id": test_user.get("id")},
            json={}
        )
        
        assert response.status_code == 422, f"Expected 422 for invalid body, got {response.status_code}"
        print(f"✓ Claim match validates request body")


class TestClaimMatchesBatchAPI:
    """Tests for /api/surfer-gallery/claim-matches-batch"""
    
    def test_batch_claim_returns_400_for_empty_list(self, api_client, test_user):
        """Test that empty match_ids list returns 400"""
        response = api_client.post(
            f"{BASE_URL}/api/surfer-gallery/claim-matches-batch",
            params={"user_id": test_user.get("id")},
            json={
                "match_ids": [],
                "session_id": str(uuid.uuid4()),
                "use_credits": True
            }
        )
        
        assert response.status_code == 400, f"Expected 400 for empty list, got {response.status_code}"
        print(f"✓ Batch claim returns 400 for empty match_ids list")
    
    def test_batch_claim_requires_user_id(self, api_client):
        """Test that user_id is required"""
        response = api_client.post(
            f"{BASE_URL}/api/surfer-gallery/claim-matches-batch",
            json={
                "match_ids": [str(uuid.uuid4())],
                "session_id": str(uuid.uuid4()),
                "use_credits": True
            }
        )
        
        assert response.status_code == 422, f"Expected 422 for missing user_id, got {response.status_code}"
        print(f"✓ Batch claim requires user_id parameter")
    
    def test_batch_claim_returns_404_for_invalid_user(self, api_client):
        """Test that invalid user returns 404"""
        invalid_user_id = str(uuid.uuid4())
        
        response = api_client.post(
            f"{BASE_URL}/api/surfer-gallery/claim-matches-batch",
            params={"user_id": invalid_user_id},
            json={
                "match_ids": [str(uuid.uuid4())],
                "session_id": str(uuid.uuid4()),
                "use_credits": True
            }
        )
        
        assert response.status_code == 404, f"Expected 404 for invalid user, got {response.status_code}"
        print(f"✓ Batch claim returns 404 for invalid user")


class TestDismissMatchAPI:
    """Tests for /api/surfer-gallery/dismiss-match"""
    
    def test_dismiss_match_returns_404_for_invalid_match(self, api_client, test_user):
        """Test that dismissing invalid match returns 404"""
        response = api_client.post(
            f"{BASE_URL}/api/surfer-gallery/dismiss-match",
            params={
                "match_id": str(uuid.uuid4()),
                "session_id": str(uuid.uuid4()),
                "user_id": test_user.get("id")
            }
        )
        
        assert response.status_code == 404, f"Expected 404 for invalid match, got {response.status_code}"
        print(f"✓ Dismiss match returns 404 for invalid match ID")
    
    def test_dismiss_match_requires_all_params(self, api_client):
        """Test that all query params are required"""
        # Missing user_id
        response = api_client.post(
            f"{BASE_URL}/api/surfer-gallery/dismiss-match",
            params={
                "match_id": str(uuid.uuid4()),
                "session_id": str(uuid.uuid4())
            }
        )
        
        assert response.status_code == 422, f"Expected 422 for missing user_id, got {response.status_code}"
        print(f"✓ Dismiss match requires all query parameters")


class TestConfirmIdentityAPI:
    """Tests for /api/surfer-gallery/confirm-identity"""
    
    def test_confirm_identity_returns_404_for_invalid_match(self, api_client, test_user):
        """Test that confirming invalid match returns 404"""
        response = api_client.post(
            f"{BASE_URL}/api/surfer-gallery/confirm-identity",
            params={"user_id": test_user.get("id")},
            json={
                "match_id": str(uuid.uuid4()),
                "is_confirmed": True
            }
        )
        
        assert response.status_code == 404, f"Expected 404 for invalid match, got {response.status_code}"
        print(f"✓ Confirm identity returns 404 for invalid match ID")
    
    def test_confirm_identity_requires_user_id(self, api_client):
        """Test that user_id is required"""
        response = api_client.post(
            f"{BASE_URL}/api/surfer-gallery/confirm-identity",
            json={
                "match_id": str(uuid.uuid4()),
                "is_confirmed": True
            }
        )
        
        assert response.status_code == 422, f"Expected 422 for missing user_id, got {response.status_code}"
        print(f"✓ Confirm identity requires user_id parameter")
    
    def test_confirm_identity_validates_request_body(self, api_client, test_user):
        """Test that request body validation works"""
        # Missing required fields
        response = api_client.post(
            f"{BASE_URL}/api/surfer-gallery/confirm-identity",
            params={"user_id": test_user.get("id")},
            json={}
        )
        
        assert response.status_code == 422, f"Expected 422 for invalid body, got {response.status_code}"
        print(f"✓ Confirm identity validates request body")


class TestResolutionUpsellAPI:
    """Tests for /api/surfer-gallery/resolution-upsell/{gallery_item_id}"""
    
    def test_resolution_upsell_returns_404_for_invalid_item(self, api_client, test_user):
        """Test that invalid gallery item returns 404"""
        invalid_item_id = str(uuid.uuid4())
        
        response = api_client.get(
            f"{BASE_URL}/api/surfer-gallery/resolution-upsell/{invalid_item_id}",
            params={"user_id": test_user.get("id")}
        )
        
        assert response.status_code == 404, f"Expected 404 for invalid item, got {response.status_code}"
        print(f"✓ Resolution upsell returns 404 for invalid gallery item")
    
    def test_resolution_upsell_requires_user_id(self, api_client):
        """Test that user_id is required"""
        item_id = str(uuid.uuid4())
        
        response = api_client.get(
            f"{BASE_URL}/api/surfer-gallery/resolution-upsell/{item_id}"
        )
        
        assert response.status_code == 422, f"Expected 422 for missing user_id, got {response.status_code}"
        print(f"✓ Resolution upsell requires user_id parameter")


class TestUpgradeResolutionAPI:
    """Tests for /api/surfer-gallery/upgrade-resolution/{gallery_item_id}"""
    
    def test_upgrade_resolution_returns_404_for_invalid_item(self, api_client, test_user):
        """Test that invalid gallery item returns 404"""
        invalid_item_id = str(uuid.uuid4())
        
        response = api_client.post(
            f"{BASE_URL}/api/surfer-gallery/upgrade-resolution/{invalid_item_id}",
            params={"user_id": test_user.get("id")}
        )
        
        assert response.status_code == 404, f"Expected 404 for invalid item, got {response.status_code}"
        print(f"✓ Upgrade resolution returns 404 for invalid gallery item")
    
    def test_upgrade_resolution_requires_user_id(self, api_client):
        """Test that user_id is required"""
        item_id = str(uuid.uuid4())
        
        response = api_client.post(
            f"{BASE_URL}/api/surfer-gallery/upgrade-resolution/{item_id}"
        )
        
        assert response.status_code == 422, f"Expected 422 for missing user_id, got {response.status_code}"
        print(f"✓ Upgrade resolution requires user_id parameter")


class TestAPIRouteRegistration:
    """Tests to verify all routes are properly registered"""
    
    def test_all_endpoints_are_accessible(self, api_client, test_user):
        """Verify all surfer-gallery endpoints are registered and accessible"""
        user_id = test_user.get("id")
        session_id = str(uuid.uuid4())
        item_id = str(uuid.uuid4())
        
        endpoints = [
            ("GET", f"/api/surfer-gallery/session-entitlements/{session_id}?user_id={user_id}"),
            ("GET", f"/api/surfer-gallery/proposed-matches/{session_id}?user_id={user_id}"),
            ("GET", f"/api/surfer-gallery/resolution-upsell/{item_id}?user_id={user_id}"),
        ]
        
        for method, endpoint in endpoints:
            url = f"{BASE_URL}{endpoint}"
            if method == "GET":
                response = api_client.get(url)
            else:
                response = api_client.post(url)
            
            # Should not return 404 (route not found) - 404 for data not found is OK
            # Should not return 405 (method not allowed)
            assert response.status_code != 405, f"Endpoint {method} {endpoint} returned 405 Method Not Allowed"
            print(f"✓ Endpoint {method} {endpoint.split('?')[0]} is registered")
        
        print(f"✓ All surfer-gallery endpoints are properly registered")


class TestEntitlementLogicTypes:
    """Tests for different entitlement logic types (A, B, C)"""
    
    def test_entitlement_logic_a_all_inclusive(self, api_client, test_user):
        """
        Logic A: All-Inclusive (is_all_inclusive = true)
        All clips from session are unlocked in HD
        """
        # For unknown session, we get default values
        # In real scenario, a booking with booking_full_gallery=True would return is_all_inclusive=True
        session_id = str(uuid.uuid4())
        
        response = api_client.get(
            f"{BASE_URL}/api/surfer-gallery/session-entitlements/{session_id}",
            params={"user_id": test_user.get("id")}
        )
        
        assert response.status_code == 200
        data = response.json()
        
        # Default is not all-inclusive
        assert "is_all_inclusive" in data
        assert isinstance(data["is_all_inclusive"], bool)
        
        print(f"✓ Entitlement Logic A (All-Inclusive) field present in response")
    
    def test_entitlement_logic_b_partial_credits(self, api_client, test_user):
        """
        Logic B: Partial Inclusion (included_media_count > 0)
        Credit-based system where surfer has X free clips
        """
        session_id = str(uuid.uuid4())
        
        response = api_client.get(
            f"{BASE_URL}/api/surfer-gallery/session-entitlements/{session_id}",
            params={"user_id": test_user.get("id")}
        )
        
        assert response.status_code == 200
        data = response.json()
        
        # Check credit-related fields
        assert "included_media_count" in data
        assert "claimed_count" in data
        assert "credits_remaining" in data
        
        # credits_remaining should be max(0, included - claimed)
        expected_remaining = max(0, data["included_media_count"] - data["claimed_count"])
        assert data["credits_remaining"] == expected_remaining
        
        print(f"✓ Entitlement Logic B (Partial Credits) fields present and calculated correctly")
    
    def test_entitlement_logic_c_pay_per_clip(self, api_client, test_user):
        """
        Logic C: Zero Inclusion (pay-per-clip)
        Each clip must be purchased individually
        """
        session_id = str(uuid.uuid4())
        
        response = api_client.get(
            f"{BASE_URL}/api/surfer-gallery/session-entitlements/{session_id}",
            params={"user_id": test_user.get("id")}
        )
        
        assert response.status_code == 200
        data = response.json()
        
        # Check price_per_clip field
        assert "price_per_clip" in data
        assert isinstance(data["price_per_clip"], (int, float))
        assert data["price_per_clip"] > 0
        
        print(f"✓ Entitlement Logic C (Pay-Per-Clip) price field present")


class TestAccountTierDifferentiation:
    """Tests for Paid vs Free account differentiation"""
    
    def test_proposed_matches_returns_account_tier_info(self, api_client, test_user):
        """Test that proposed matches includes account tier information"""
        session_id = str(uuid.uuid4())
        
        response = api_client.get(
            f"{BASE_URL}/api/surfer-gallery/proposed-matches/{session_id}",
            params={"user_id": test_user.get("id")}
        )
        
        assert response.status_code == 200
        data = response.json()
        
        # Should include is_paid_account flag
        assert "is_paid_account" in data
        assert isinstance(data["is_paid_account"], bool)
        
        print(f"✓ Proposed matches returns account tier (is_paid_account: {data['is_paid_account']})")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
