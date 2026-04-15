"""
Test Meta Graph API Integration Endpoints
Tests for Facebook/Instagram direct sharing via Meta Graph API

Endpoints tested:
- GET /api/meta/oauth-url - Returns Meta OAuth URL for user authentication
- GET /api/meta/status - Returns user's Meta connection status
- DELETE /api/meta/disconnect - Disconnects Meta accounts from user profile
- POST /api/meta/share-to-facebook - Share a post to Facebook Page
- POST /api/meta/share-to-instagram - Share a post to Instagram
"""

import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test user credentials from previous iterations
TEST_USER_ID = "12dc6786-124f-40b1-8698-a9409f99736f"
TEST_USER_EMAIL = "dpritzker0905@gmail.com"
META_APP_ID = "1756771322019642"


class TestMetaOAuthURL:
    """Test GET /api/meta/oauth-url endpoint"""
    
    def test_oauth_url_returns_valid_url(self):
        """Test that OAuth URL endpoint returns a valid Meta OAuth URL"""
        response = requests.get(
            f"{BASE_URL}/api/meta/oauth-url",
            params={"user_id": TEST_USER_ID}
        )
        
        # Should return 200 OK
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        
        # Verify response structure
        assert "oauth_url" in data, "Response should contain oauth_url"
        assert "redirect_uri" in data, "Response should contain redirect_uri"
        
        # Verify OAuth URL contains required components
        oauth_url = data["oauth_url"]
        assert "facebook.com" in oauth_url, "OAuth URL should point to Facebook"
        assert "dialog/oauth" in oauth_url, "OAuth URL should be OAuth dialog"
        assert f"client_id={META_APP_ID}" in oauth_url, "OAuth URL should contain app ID"
        assert "response_type=code" in oauth_url, "OAuth URL should request code"
        
        # Verify required scopes are present
        assert "pages_manage_posts" in oauth_url, "Should request pages_manage_posts scope"
        assert "instagram_content_publish" in oauth_url, "Should request instagram_content_publish scope"
        
        print(f"✓ OAuth URL generated successfully")
        print(f"  OAuth URL: {oauth_url[:100]}...")
        print(f"  Redirect URI: {data['redirect_uri']}")
    
    def test_oauth_url_with_custom_redirect(self):
        """Test OAuth URL with custom redirect URI"""
        custom_redirect = "https://example.com/callback"
        response = requests.get(
            f"{BASE_URL}/api/meta/oauth-url",
            params={
                "user_id": TEST_USER_ID,
                "redirect_uri": custom_redirect
            }
        )
        
        assert response.status_code == 200
        data = response.json()
        
        # Verify custom redirect is used
        assert data["redirect_uri"] == custom_redirect
        assert custom_redirect in data["oauth_url"]
        
        print(f"✓ Custom redirect URI accepted: {custom_redirect}")


class TestMetaConnectionStatus:
    """Test GET /api/meta/status endpoint"""
    
    def test_status_for_existing_user(self):
        """Test status endpoint returns proper structure for existing user"""
        response = requests.get(
            f"{BASE_URL}/api/meta/status",
            params={"user_id": TEST_USER_ID}
        )
        
        # Should return 200 OK
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        
        # Verify response structure matches MetaAccountInfo model
        assert "facebook_connected" in data, "Response should contain facebook_connected"
        assert "instagram_connected" in data, "Response should contain instagram_connected"
        assert "pages" in data, "Response should contain pages list"
        
        # Verify types
        assert isinstance(data["facebook_connected"], bool), "facebook_connected should be boolean"
        assert isinstance(data["instagram_connected"], bool), "instagram_connected should be boolean"
        assert isinstance(data["pages"], list), "pages should be a list"
        
        # Optional fields
        if data["facebook_connected"]:
            assert "facebook_name" in data, "Should have facebook_name when connected"
        if data["instagram_connected"]:
            assert "instagram_username" in data, "Should have instagram_username when connected"
        
        print(f"✓ Meta status retrieved successfully")
        print(f"  Facebook connected: {data['facebook_connected']}")
        print(f"  Instagram connected: {data['instagram_connected']}")
        print(f"  Pages: {len(data['pages'])}")
    
    def test_status_for_nonexistent_user(self):
        """Test status endpoint returns 404 for non-existent user"""
        response = requests.get(
            f"{BASE_URL}/api/meta/status",
            params={"user_id": "nonexistent-user-id-12345"}
        )
        
        # Should return 404 Not Found
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        
        print(f"✓ Correctly returns 404 for non-existent user")


class TestMetaDisconnect:
    """Test DELETE /api/meta/disconnect endpoint"""
    
    def test_disconnect_for_existing_user(self):
        """Test disconnect endpoint works for existing user"""
        response = requests.delete(
            f"{BASE_URL}/api/meta/disconnect",
            params={"user_id": TEST_USER_ID}
        )
        
        # Should return 200 OK
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        
        # Verify response structure
        assert "success" in data, "Response should contain success field"
        assert data["success"] == True, "success should be True"
        assert "message" in data, "Response should contain message"
        
        print(f"✓ Meta disconnect successful")
        print(f"  Message: {data['message']}")
    
    def test_disconnect_for_nonexistent_user(self):
        """Test disconnect endpoint returns 404 for non-existent user"""
        response = requests.delete(
            f"{BASE_URL}/api/meta/disconnect",
            params={"user_id": "nonexistent-user-id-12345"}
        )
        
        # Should return 404 Not Found
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        
        print(f"✓ Correctly returns 404 for non-existent user")


class TestShareToFacebook:
    """Test POST /api/meta/share-to-facebook endpoint"""
    
    def test_share_without_connection_returns_error(self):
        """Test that sharing without Meta connection returns appropriate error"""
        # First ensure user is disconnected
        requests.delete(
            f"{BASE_URL}/api/meta/disconnect",
            params={"user_id": TEST_USER_ID}
        )
        
        # Try to share
        response = requests.post(
            f"{BASE_URL}/api/meta/share-to-facebook",
            params={"user_id": TEST_USER_ID},
            json={
                "post_id": "test-post-id",
                "platform": "facebook"
            }
        )
        
        # Should return 400 Bad Request (no Facebook Page connected)
        assert response.status_code == 400, f"Expected 400, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "detail" in data, "Error response should contain detail"
        assert "Facebook Page" in data["detail"] or "connect" in data["detail"].lower(), \
            f"Error should mention Facebook Page connection: {data['detail']}"
        
        print(f"✓ Correctly returns error when not connected")
        print(f"  Error: {data['detail']}")
    
    def test_share_with_invalid_post_id(self):
        """Test sharing with invalid post ID returns 404"""
        response = requests.post(
            f"{BASE_URL}/api/meta/share-to-facebook",
            params={"user_id": TEST_USER_ID},
            json={
                "post_id": "nonexistent-post-id-12345",
                "platform": "facebook"
            }
        )
        
        # Should return 400 (no connection) or 404 (post not found)
        # Since user is not connected, we expect 400 first
        assert response.status_code in [400, 404], f"Expected 400 or 404, got {response.status_code}"
        
        print(f"✓ Correctly handles invalid post ID (status: {response.status_code})")


class TestShareToInstagram:
    """Test POST /api/meta/share-to-instagram endpoint"""
    
    def test_share_without_connection_returns_error(self):
        """Test that sharing without Meta connection returns appropriate error"""
        # First ensure user is disconnected
        requests.delete(
            f"{BASE_URL}/api/meta/disconnect",
            params={"user_id": TEST_USER_ID}
        )
        
        # Try to share
        response = requests.post(
            f"{BASE_URL}/api/meta/share-to-instagram",
            params={"user_id": TEST_USER_ID},
            json={
                "post_id": "test-post-id",
                "platform": "instagram"
            }
        )
        
        # Should return 400 Bad Request (no Instagram account connected)
        assert response.status_code == 400, f"Expected 400, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "detail" in data, "Error response should contain detail"
        assert "Instagram" in data["detail"] or "connect" in data["detail"].lower(), \
            f"Error should mention Instagram connection: {data['detail']}"
        
        print(f"✓ Correctly returns error when not connected")
        print(f"  Error: {data['detail']}")
    
    def test_share_with_nonexistent_user(self):
        """Test sharing with non-existent user returns 404"""
        response = requests.post(
            f"{BASE_URL}/api/meta/share-to-instagram",
            params={"user_id": "nonexistent-user-id-12345"},
            json={
                "post_id": "test-post-id",
                "platform": "instagram"
            }
        )
        
        # Should return 404 Not Found
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        
        print(f"✓ Correctly returns 404 for non-existent user")


class TestMetaOAuthCallback:
    """Test GET /api/meta/callback endpoint (OAuth callback handler)"""
    
    def test_callback_without_credentials_returns_error(self):
        """Test that callback without proper credentials returns error"""
        # This tests the error handling when Meta credentials are not configured
        # or when the code is invalid
        response = requests.get(
            f"{BASE_URL}/api/meta/callback",
            params={
                "code": "invalid-test-code",
                "state": TEST_USER_ID
            }
        )
        
        # Should return 400 or 500 (depending on whether credentials are configured)
        # The actual Meta API call will fail with invalid code
        assert response.status_code in [400, 500], f"Expected 400 or 500, got {response.status_code}"
        
        print(f"✓ Callback correctly handles invalid code (status: {response.status_code})")


class TestMetaIntegrationFlow:
    """Test the complete Meta integration flow"""
    
    def test_full_flow_without_oauth(self):
        """Test the flow: check status -> disconnect -> check status again"""
        # Step 1: Check initial status
        status_response = requests.get(
            f"{BASE_URL}/api/meta/status",
            params={"user_id": TEST_USER_ID}
        )
        assert status_response.status_code == 200
        initial_status = status_response.json()
        print(f"Step 1: Initial status - FB: {initial_status['facebook_connected']}, IG: {initial_status['instagram_connected']}")
        
        # Step 2: Disconnect (should work even if not connected)
        disconnect_response = requests.delete(
            f"{BASE_URL}/api/meta/disconnect",
            params={"user_id": TEST_USER_ID}
        )
        assert disconnect_response.status_code == 200
        print(f"Step 2: Disconnect successful")
        
        # Step 3: Check status after disconnect
        final_status_response = requests.get(
            f"{BASE_URL}/api/meta/status",
            params={"user_id": TEST_USER_ID}
        )
        assert final_status_response.status_code == 200
        final_status = final_status_response.json()
        
        # After disconnect, should not be connected
        assert final_status["facebook_connected"] == False, "Should not be connected to Facebook after disconnect"
        assert final_status["instagram_connected"] == False, "Should not be connected to Instagram after disconnect"
        print(f"Step 3: Final status - FB: {final_status['facebook_connected']}, IG: {final_status['instagram_connected']}")
        
        # Step 4: Get OAuth URL (to verify it's available)
        oauth_response = requests.get(
            f"{BASE_URL}/api/meta/oauth-url",
            params={"user_id": TEST_USER_ID}
        )
        assert oauth_response.status_code == 200
        oauth_data = oauth_response.json()
        assert "oauth_url" in oauth_data
        print(f"Step 4: OAuth URL available for reconnection")
        
        print(f"✓ Full integration flow completed successfully")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
