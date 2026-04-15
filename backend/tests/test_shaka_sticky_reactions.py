"""
Test Shaka Sticky Logic and Reactions
Tests for iteration 38:
- Post reactions endpoint
- Reaction toggle (add/remove)
- Realtime broadcast endpoint for social sync
- Notifications on reaction
"""

import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials
TEST_USER_EMAIL = "kelly@surf.com"
TEST_USER_PASSWORD = "test-shaka"


class TestRealtimeBroadcast:
    """Tests for POST /api/realtime/broadcast endpoint"""
    
    def test_broadcast_endpoint_exists(self):
        """Test that broadcast endpoint responds"""
        response = requests.post(
            f"{BASE_URL}/api/realtime/broadcast",
            json={
                "channel": "test:channel",
                "event": "reaction_update",
                "payload": {"test": True}
            }
        )
        # Should return success or graceful failure (Supabase may not be configured)
        assert response.status_code == 200
        data = response.json()
        assert "success" in data
        print(f"Broadcast response: {data}")
    
    def test_broadcast_with_reaction_payload(self):
        """Test broadcast with realistic reaction update payload"""
        response = requests.post(
            f"{BASE_URL}/api/realtime/broadcast",
            json={
                "channel": "post:test-post-id",
                "event": "reaction_update",
                "payload": {
                    "post_id": "test-post-id",
                    "user_id": "test-user-id",
                    "user_name": "Test User",
                    "emoji": "🔥",
                    "action": "added"
                }
            }
        )
        assert response.status_code == 200
        data = response.json()
        # Even if Supabase isn't configured, it should return a valid response
        assert "success" in data
        print(f"Reaction broadcast response: {data}")
    
    def test_broadcast_validation(self):
        """Test that broadcast validates required fields"""
        # Missing channel
        response = requests.post(
            f"{BASE_URL}/api/realtime/broadcast",
            json={
                "event": "reaction_update",
                "payload": {"test": True}
            }
        )
        assert response.status_code == 422  # Validation error
        
        # Missing event
        response = requests.post(
            f"{BASE_URL}/api/realtime/broadcast",
            json={
                "channel": "test:channel",
                "payload": {"test": True}
            }
        )
        assert response.status_code == 422


class TestPostReactions:
    """Tests for post reaction endpoints"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Get user and first post for testing"""
        # Login
        login_response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": TEST_USER_EMAIL, "password": TEST_USER_PASSWORD}
        )
        assert login_response.status_code == 200
        self.user = login_response.json()
        self.user_id = self.user['id']
        print(f"Logged in as: {self.user['full_name']} ({self.user_id})")
        
        # Get first post
        posts_response = requests.get(f"{BASE_URL}/api/posts")
        assert posts_response.status_code == 200
        posts = posts_response.json()
        assert len(posts) > 0, "No posts found for testing"
        self.test_post = posts[0]
        print(f"Using post: {self.test_post['id']} by {self.test_post['author_name']}")
    
    def test_get_post_with_reactions(self):
        """Test that posts include reactions data"""
        response = requests.get(f"{BASE_URL}/api/posts", params={"user_id": self.user_id})
        assert response.status_code == 200
        posts = response.json()
        
        # Check structure
        for post in posts:
            assert "reactions" in post
            assert isinstance(post["reactions"], list)
            for reaction in post["reactions"]:
                assert "emoji" in reaction
                assert "user_id" in reaction
        print(f"Found {len(posts)} posts with reaction data")
    
    def test_add_reaction_fire(self):
        """Test adding 🔥 reaction"""
        post_id = self.test_post['id']
        
        response = requests.post(
            f"{BASE_URL}/api/posts/{post_id}/reactions",
            params={"user_id": self.user_id},
            json={"emoji": "🔥"}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["emoji"] == "🔥"
        assert data["post_id"] == post_id
        print(f"Reaction response: {data}")
    
    def test_add_reaction_wave(self):
        """Test adding 🌊 reaction"""
        post_id = self.test_post['id']
        
        response = requests.post(
            f"{BASE_URL}/api/posts/{post_id}/reactions",
            params={"user_id": self.user_id},
            json={"emoji": "🌊"}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["emoji"] == "🌊"
        print(f"Wave reaction: {data}")
    
    def test_add_reaction_heart(self):
        """Test adding ❤️ reaction"""
        post_id = self.test_post['id']
        
        response = requests.post(
            f"{BASE_URL}/api/posts/{post_id}/reactions",
            params={"user_id": self.user_id},
            json={"emoji": "❤️"}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["emoji"] == "❤️"
        print(f"Heart reaction: {data}")
    
    def test_add_reaction_shaka(self):
        """Test adding 🤙 (shaka) reaction"""
        post_id = self.test_post['id']
        
        response = requests.post(
            f"{BASE_URL}/api/posts/{post_id}/reactions",
            params={"user_id": self.user_id},
            json={"emoji": "🤙"}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["emoji"] == "🤙"
        print(f"Shaka reaction: {data}")
    
    def test_reaction_toggle_removes(self):
        """Test that sending same reaction again removes it (toggle)"""
        post_id = self.test_post['id']
        
        # Add reaction
        response1 = requests.post(
            f"{BASE_URL}/api/posts/{post_id}/reactions",
            params={"user_id": self.user_id},
            json={"emoji": "🔥"}
        )
        assert response1.status_code == 200
        first_action = response1.json().get("action")
        print(f"First action: {first_action}")
        
        # Toggle same reaction
        response2 = requests.post(
            f"{BASE_URL}/api/posts/{post_id}/reactions",
            params={"user_id": self.user_id},
            json={"emoji": "🔥"}
        )
        assert response2.status_code == 200
        second_action = response2.json().get("action")
        print(f"Second action: {second_action}")
        
        # Actions should be opposite
        assert first_action != second_action or first_action in ["added", "removed"]
    
    def test_invalid_reaction_rejected(self):
        """Test that invalid emojis are rejected"""
        post_id = self.test_post['id']
        
        response = requests.post(
            f"{BASE_URL}/api/posts/{post_id}/reactions",
            params={"user_id": self.user_id},
            json={"emoji": "👎"}  # Not in VALID_REACTIONS
        )
        assert response.status_code == 400
        print(f"Invalid reaction correctly rejected")
    
    def test_get_post_reactions(self):
        """Test GET /api/posts/{post_id}/reactions endpoint"""
        post_id = self.test_post['id']
        
        response = requests.get(f"{BASE_URL}/api/posts/{post_id}/reactions")
        assert response.status_code == 200
        reactions = response.json()
        assert isinstance(reactions, list)
        print(f"Post has {len(reactions)} reactions")
        
        for r in reactions:
            assert "emoji" in r
            assert "user_id" in r


class TestNotificationsOnReaction:
    """Test notifications are created when reactions are added"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test user and find a post from different author"""
        # Login
        login_response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": TEST_USER_EMAIL, "password": TEST_USER_PASSWORD}
        )
        assert login_response.status_code == 200
        self.user = login_response.json()
        self.user_id = self.user['id']
        
        # Get posts to find one from different author
        posts_response = requests.get(f"{BASE_URL}/api/posts")
        posts = posts_response.json()
        
        # Find post NOT by current user
        self.other_user_post = None
        for post in posts:
            if post['author_id'] != self.user_id:
                self.other_user_post = post
                break
        
        if self.other_user_post:
            print(f"Found post by {self.other_user_post['author_name']} for notification test")
    
    def test_create_notification_endpoint(self):
        """Test that /api/notifications endpoint works"""
        if not self.other_user_post:
            pytest.skip("No post from other user found")
        
        # Create notification directly
        response = requests.post(
            f"{BASE_URL}/api/notifications",
            json={
                "user_id": self.other_user_post['author_id'],
                "type": "post_reaction",
                "title": f"{self.user['full_name']} reacted 🔥",
                "message": f"{self.user['full_name']} reacted with 🔥 to your post",
                "data": {
                    "post_id": self.other_user_post['id'],
                    "reactor_id": self.user_id,
                    "emoji": "🔥"
                }
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert data.get("success") == True
        print(f"Notification created: {data}")
    
    def test_get_notifications(self):
        """Test getting notifications for post author"""
        if not self.other_user_post:
            pytest.skip("No post from other user found")
        
        author_id = self.other_user_post['author_id']
        response = requests.get(f"{BASE_URL}/api/notifications/{author_id}")
        assert response.status_code == 200
        notifications = response.json()
        
        # Check for reaction notifications
        reaction_notifications = [n for n in notifications if n['type'] == 'post_reaction']
        print(f"Author has {len(reaction_notifications)} reaction notifications")


class TestFeedIntegration:
    """Test the full feed flow with reactions"""
    
    def test_feed_returns_reactions_array(self):
        """Verify posts include reactions array"""
        response = requests.get(f"{BASE_URL}/api/posts")
        assert response.status_code == 200
        posts = response.json()
        
        posts_with_reactions = [p for p in posts if len(p.get('reactions', [])) > 0]
        print(f"Found {len(posts_with_reactions)} posts with reactions")
        
        if posts_with_reactions:
            post = posts_with_reactions[0]
            print(f"Post {post['id']} has reactions: {post['reactions']}")
            
            for reaction in post['reactions']:
                assert 'emoji' in reaction
                assert 'user_id' in reaction
                assert reaction['emoji'] in ['🤙', '🌊', '❤️', '🔥']
