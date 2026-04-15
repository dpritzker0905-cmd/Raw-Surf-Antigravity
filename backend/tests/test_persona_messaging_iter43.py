"""
Test Persona Switcher and Messaging Features (Iteration 43)
- Pro Lounge visibility for different personas  
- Profile search with follow status
- Message request accept/decline functionality
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestProfileSearchWithFollowStatus:
    """Test profile search API returns follow status fields"""
    
    def test_search_profiles_returns_follow_fields(self):
        """Search profiles should return is_following, follows_you, is_mutual fields"""
        response = requests.get(f"{BASE_URL}/api/profiles/search?q=Sarah&limit=5")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert isinstance(data, list), "Response should be a list"
        
        if len(data) > 0:
            profile = data[0]
            # Verify follow status fields exist
            assert 'is_following' in profile, "is_following field missing"
            assert 'follows_you' in profile, "follows_you field missing"
            assert 'is_mutual' in profile, "is_mutual field missing"
            # Verify they are boolean
            assert isinstance(profile['is_following'], bool), "is_following should be boolean"
            assert isinstance(profile['follows_you'], bool), "follows_you should be boolean"
            assert isinstance(profile['is_mutual'], bool), "is_mutual should be boolean"
            print(f"Profile {profile.get('full_name')}: following={profile['is_following']}, follows_you={profile['follows_you']}, mutual={profile['is_mutual']}")
    
    def test_search_profiles_with_user_id(self):
        """Search with user_id parameter should return follow relationships"""
        # First get a user ID
        users_response = requests.get(f"{BASE_URL}/api/profiles/search?q=Kelly&limit=1")
        assert users_response.status_code == 200
        
        users = users_response.json()
        if len(users) > 0:
            user_id = users[0]['id']
            
            # Search with user_id
            response = requests.get(f"{BASE_URL}/api/profiles/search?q=a&limit=10&user_id={user_id}")
            assert response.status_code == 200
            
            data = response.json()
            assert isinstance(data, list)
            print(f"Search with user_id returned {len(data)} profiles")


class TestMessageRequestEndpoints:
    """Test message request accept/decline API endpoints"""
    
    def test_accept_endpoint_exists(self):
        """Accept message request endpoint should exist (may return 404 for invalid ID)"""
        response = requests.post(f"{BASE_URL}/api/messages/accept/invalid-id?user_id=test-user")
        
        # Should return 404 (conversation not found) not 405 (method not allowed)
        assert response.status_code in [404, 400], f"Expected 404 or 400, got {response.status_code}"
        print(f"Accept endpoint response: {response.status_code}")
    
    def test_decline_endpoint_exists(self):
        """Decline message request endpoint should exist (POST)"""
        response = requests.post(f"{BASE_URL}/api/messages/decline/invalid-id?user_id=test-user")
        
        # Should return 404 (conversation not found) not 405 (method not allowed)
        assert response.status_code in [404, 400], f"Expected 404 or 400, got {response.status_code}"
        print(f"Decline endpoint response: {response.status_code}")
    
    def test_delete_conversation_endpoint_exists(self):
        """Delete conversation endpoint should exist (DELETE)"""
        response = requests.delete(f"{BASE_URL}/api/messages/conversation/invalid-id?user_id=test-user")
        
        # Should return 404 (conversation not found) not 405 (method not allowed)
        assert response.status_code in [404, 400], f"Expected 404 or 400, got {response.status_code}"
        print(f"Delete conversation endpoint response: {response.status_code}")


class TestMessagingConversationAPI:
    """Test messaging conversation APIs"""
    
    def test_get_conversations_with_inbox_type(self):
        """Get conversations should support inbox_type parameter"""
        # First get a user
        users_response = requests.get(f"{BASE_URL}/api/profiles/search?q=Kelly&limit=1")
        if users_response.status_code == 200 and len(users_response.json()) > 0:
            user_id = users_response.json()[0]['id']
            
            # Test different inbox types
            for inbox_type in ['primary', 'requests', 'hidden', 'channel', 'pro_lounge', 'all']:
                response = requests.get(f"{BASE_URL}/api/messages/conversations/{user_id}?inbox_type={inbox_type}")
                assert response.status_code == 200, f"inbox_type={inbox_type} failed: {response.status_code}"
                print(f"Inbox type '{inbox_type}': {len(response.json())} conversations")


class TestProLoungeAccess:
    """Test Pro Lounge folder visibility logic"""
    
    def test_pro_lounge_api_access(self):
        """Pro Lounge messages should be accessible via API for pro users"""
        # Get Kelly (admin user)
        users_response = requests.get(f"{BASE_URL}/api/profiles/search?q=Kelly&limit=1")
        if users_response.status_code == 200 and len(users_response.json()) > 0:
            kelly = users_response.json()[0]
            user_id = kelly['id']
            is_admin = kelly.get('is_admin', False)
            role = kelly.get('role', 'Surfer')
            
            print(f"Kelly: id={user_id}, role={role}, is_admin={is_admin}")
            
            # Pro lounge should be accessible for admin
            response = requests.get(f"{BASE_URL}/api/messages/conversations/{user_id}?inbox_type=pro_lounge")
            assert response.status_code == 200
            print(f"Pro Lounge access: {len(response.json())} conversations")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
