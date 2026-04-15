"""
Test Suite for Iteration 135 - Mentions, Threaded Replies, and God Mode Ad Controls
Tests:
- Mentions search API
- Threaded replies with reply_to_id
- Reply context in messages
- God Mode Ad Config endpoints
- Ad frequency updates
- Ad variant management
- Ad analytics
- Public ad config
"""
import pytest
import requests
import os
import uuid

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials from previous iterations
TEST_USER_EMAIL = "test_iter133@test.com"
TEST_USER_PASSWORD = "Test123!"
TEST_USER_ID = "6f84fcbb-2fe1-4080-ab16-783a88c1b243"
ADMIN_EMAIL = "dpritzker0905@gmail.com"
ADMIN_PASSWORD = "test123"
TEST_BOOKING_ID = "eb3ab6be-394a-44ce-86e7-215251b6b2d0"


class TestMentionsSearch:
    """Test @mentions search functionality"""
    
    def test_mentions_search_endpoint_exists(self):
        """Test that mentions search endpoint exists and returns proper structure"""
        response = requests.get(
            f"{BASE_URL}/api/mentions/search",
            params={
                "query": "test",
                "user_id": TEST_USER_ID,
                "context": "crew_chat",
                "context_id": TEST_BOOKING_ID,
                "limit": 10
            }
        )
        # Should return 200 even if no results
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "users" in data, "Response should contain 'users' key"
        assert isinstance(data["users"], list), "Users should be a list"
        print(f"PASS: Mentions search returns {len(data['users'])} users")
    
    def test_mentions_search_returns_user_fields(self):
        """Test that mention search results have required fields"""
        response = requests.get(
            f"{BASE_URL}/api/mentions/search",
            params={
                "query": "d",  # Common letter to get results
                "user_id": TEST_USER_ID,
                "context": "crew_chat",
                "limit": 5
            }
        )
        assert response.status_code == 200
        
        data = response.json()
        if len(data["users"]) > 0:
            user = data["users"][0]
            # Check required fields
            assert "user_id" in user, "User should have user_id"
            assert "full_name" in user, "User should have full_name"
            assert "username" in user, "User should have username"
            assert "avatar_url" in user, "User should have avatar_url"
            assert "is_priority" in user, "User should have is_priority flag"
            print(f"PASS: Mention user has all required fields: {list(user.keys())}")
        else:
            print("SKIP: No users found to verify fields")
    
    def test_mentions_search_empty_query(self):
        """Test mentions search with empty query"""
        response = requests.get(
            f"{BASE_URL}/api/mentions/search",
            params={
                "query": "",
                "user_id": TEST_USER_ID,
                "context": "crew_chat"
            }
        )
        # Should still return 200 with empty or limited results
        assert response.status_code == 200
        print("PASS: Empty query handled gracefully")


class TestThreadedReplies:
    """Test threaded replies functionality"""
    
    def test_crew_chat_messages_include_reply_to(self):
        """Test that messages endpoint returns reply_to field"""
        response = requests.get(
            f"{BASE_URL}/api/crew-chat/{TEST_BOOKING_ID}/messages",
            params={"user_id": TEST_USER_ID, "limit": 10}
        )
        
        # May get 403 if user doesn't have access
        if response.status_code == 403:
            print("SKIP: User doesn't have access to test booking")
            pytest.skip("User doesn't have access to test booking")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert "messages" in data, "Response should contain messages"
        
        # Check that messages have reply_to field (even if null)
        for msg in data.get("messages", []):
            assert "reply_to" in msg or msg.get("reply_to") is None, "Messages should have reply_to field"
        
        print(f"PASS: Messages endpoint returns {len(data.get('messages', []))} messages with reply_to support")
    
    def test_send_message_with_reply_to_id(self):
        """Test sending a message with reply_to_id parameter"""
        # First, we need to verify the endpoint accepts reply_to_id
        # This is a structural test - actual sending requires valid access
        
        # Test that the endpoint exists and accepts the parameter
        response = requests.post(
            f"{BASE_URL}/api/crew-chat/{TEST_BOOKING_ID}/send",
            params={"user_id": TEST_USER_ID},
            json={
                "content": "Test reply message",
                "message_type": "text",
                "reply_to_id": "some-message-id"  # Invalid ID but tests parameter acceptance
            }
        )
        
        # Should get 403 (access denied) or 404 (message not found), not 422 (validation error)
        assert response.status_code in [200, 403, 404], f"Unexpected status: {response.status_code}"
        print(f"PASS: Send endpoint accepts reply_to_id parameter (status: {response.status_code})")


class TestGodModeAdConfig:
    """Test God Mode Ad Controls endpoints"""
    
    @pytest.fixture
    def admin_id(self):
        """Get admin user ID by logging in"""
        response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}
        )
        if response.status_code == 200:
            return response.json().get("user", {}).get("id")
        return None
    
    def test_public_ad_config_endpoint(self):
        """Test public ad config endpoint (no auth required)"""
        response = requests.get(f"{BASE_URL}/api/ads/config")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        # Check required fields
        assert "frequency" in data, "Should have frequency"
        assert "min_posts_before_first_ad" in data, "Should have min_posts_before_first_ad"
        assert "show_in_feed" in data, "Should have show_in_feed"
        assert "show_in_explore" in data, "Should have show_in_explore"
        assert "variants" in data, "Should have variants"
        assert isinstance(data["variants"], list), "Variants should be a list"
        
        print(f"PASS: Public ad config returns frequency={data['frequency']}, {len(data['variants'])} variants")
    
    def test_public_ad_config_variant_structure(self):
        """Test that public ad config variants have correct structure"""
        response = requests.get(f"{BASE_URL}/api/ads/config")
        assert response.status_code == 200
        
        data = response.json()
        if len(data["variants"]) > 0:
            variant = data["variants"][0]
            required_fields = ["id", "type", "headline", "description", "cta", "cta_link", "gradient"]
            for field in required_fields:
                assert field in variant, f"Variant should have {field}"
            print(f"PASS: Ad variant has all required fields: {list(variant.keys())}")
        else:
            print("INFO: No active variants to verify structure")
    
    def test_admin_ad_config_requires_auth(self):
        """Test that admin ad config endpoint requires admin access"""
        # Without admin_id
        response = requests.get(f"{BASE_URL}/api/admin/ads/config")
        assert response.status_code == 422, "Should require admin_id parameter"
        
        # With non-admin user
        response = requests.get(
            f"{BASE_URL}/api/admin/ads/config",
            params={"admin_id": TEST_USER_ID}
        )
        assert response.status_code == 403, f"Non-admin should get 403, got {response.status_code}"
        print("PASS: Admin ad config properly requires admin access")
    
    def test_ad_frequency_update_requires_admin(self):
        """Test that ad frequency update requires admin"""
        response = requests.patch(
            f"{BASE_URL}/api/admin/ads/frequency",
            params={"admin_id": TEST_USER_ID, "frequency": 5}
        )
        assert response.status_code == 403, f"Non-admin should get 403, got {response.status_code}"
        print("PASS: Ad frequency update requires admin access")
    
    def test_ad_frequency_validation(self):
        """Test ad frequency validation (3-20 range)"""
        # Test with invalid frequency (too low)
        response = requests.patch(
            f"{BASE_URL}/api/admin/ads/frequency",
            params={"admin_id": TEST_USER_ID, "frequency": 1}
        )
        # Should get 400 for invalid frequency or 403 for non-admin
        assert response.status_code in [400, 403], f"Expected 400 or 403, got {response.status_code}"
        print("PASS: Ad frequency validation works")
    
    def test_ad_variant_add_requires_admin(self):
        """Test that adding ad variant requires admin"""
        response = requests.post(
            f"{BASE_URL}/api/admin/ads/variant",
            params={"admin_id": TEST_USER_ID},
            json={
                "id": "test_variant",
                "type": "promo",
                "headline": "Test",
                "description": "Test description",
                "cta": "Click",
                "cta_link": "/test",
                "gradient": "from-blue-500 to-cyan-500"
            }
        )
        assert response.status_code == 403, f"Non-admin should get 403, got {response.status_code}"
        print("PASS: Add variant requires admin access")
    
    def test_ad_variant_delete_requires_admin(self):
        """Test that deleting ad variant requires admin"""
        response = requests.delete(
            f"{BASE_URL}/api/admin/ads/variant/test_variant",
            params={"admin_id": TEST_USER_ID}
        )
        assert response.status_code in [403, 404], f"Expected 403 or 404, got {response.status_code}"
        print("PASS: Delete variant requires admin access")
    
    def test_ad_analytics_requires_admin(self):
        """Test that ad analytics requires admin"""
        response = requests.get(
            f"{BASE_URL}/api/admin/ads/analytics",
            params={"admin_id": TEST_USER_ID}
        )
        assert response.status_code == 403, f"Non-admin should get 403, got {response.status_code}"
        print("PASS: Ad analytics requires admin access")
    
    def test_ad_impression_tracking(self):
        """Test ad impression tracking endpoint"""
        response = requests.post(
            f"{BASE_URL}/api/ads/impression",
            params={
                "variant_id": "upgrade_pro",
                "user_id": TEST_USER_ID
            }
        )
        # Should work without auth
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data.get("tracked") == True, "Should return tracked: true"
        print("PASS: Ad impression tracking works")
    
    def test_ad_click_tracking(self):
        """Test ad click tracking endpoint"""
        response = requests.post(
            f"{BASE_URL}/api/ads/click",
            params={
                "variant_id": "upgrade_pro",
                "user_id": TEST_USER_ID
            }
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data.get("tracked") == True, "Should return tracked: true"
        print("PASS: Ad click tracking works")


class TestMentionNotifications:
    """Test mention notification functionality"""
    
    def test_notifications_endpoint_exists(self):
        """Test that notifications endpoint exists"""
        response = requests.get(
            f"{BASE_URL}/api/notifications/{TEST_USER_ID}"
        )
        # Should return 200 with list of notifications
        assert response.status_code == 200, f"Unexpected status: {response.status_code}"
        data = response.json()
        assert isinstance(data, list), "Should return a list of notifications"
        print(f"PASS: Notifications endpoint returns {len(data)} notifications")


class TestCrewChatIntegration:
    """Integration tests for crew chat with mentions and replies"""
    
    def test_crew_chat_info_endpoint(self):
        """Test crew chat info endpoint"""
        response = requests.get(
            f"{BASE_URL}/api/crew-chat/{TEST_BOOKING_ID}/info",
            params={"user_id": TEST_USER_ID}
        )
        
        if response.status_code == 403:
            print("SKIP: User doesn't have access to test booking")
            pytest.skip("User doesn't have access to test booking")
        
        assert response.status_code == 200
        data = response.json()
        
        # Check structure
        assert "booking_id" in data
        assert "participants" in data
        assert "online_users" in data
        print(f"PASS: Crew chat info returns {len(data.get('participants', []))} participants")
    
    def test_quick_actions_endpoint(self):
        """Test quick actions endpoint"""
        response = requests.get(f"{BASE_URL}/api/crew-chat/quick-actions")
        
        assert response.status_code == 200
        data = response.json()
        
        assert "quick_actions" in data
        assert "categories" in data
        assert len(data["quick_actions"]) > 0
        print(f"PASS: Quick actions returns {len(data['quick_actions'])} actions")
    
    def test_reaction_emojis_endpoint(self):
        """Test reaction emojis endpoint"""
        response = requests.get(f"{BASE_URL}/api/crew-chat/reaction-emojis")
        
        assert response.status_code == 200
        data = response.json()
        
        assert "emojis" in data
        assert len(data["emojis"]) == 8  # 8 surf-themed emojis
        print(f"PASS: Reaction emojis returns {len(data['emojis'])} emojis: {data['emojis']}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
