"""
Test Feed Reactions and Notifications for iteration 34
- Test POST /api/posts/{post_id}/reactions
- Test POST /api/notifications (for reaction notifications)
- Test reaction displays inline with likes count
"""
import pytest
import requests
import os
import json

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials
USER1_EMAIL = "kelly@surf.com"
USER1_PASSWORD = "test-shaka"
USER2_EMAIL = "photographer@surf.com"
USER2_PASSWORD = "password123"

# Valid surf emojis
VALID_REACTIONS = ['🤙', '🌊', '❤️', '🔥']

class TestFeedReactions:
    """Test Feed Reaction Picker functionality"""
    
    @pytest.fixture(scope="class")
    def session(self):
        """Create requests session"""
        return requests.Session()
    
    @pytest.fixture(scope="class")
    def user1_token(self, session):
        """Login user 1 (kelly@surf.com)"""
        response = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": USER1_EMAIL,
            "password": USER1_PASSWORD
        })
        if response.status_code != 200:
            pytest.skip(f"Login failed for {USER1_EMAIL}")
        data = response.json()
        # Response returns id directly, not wrapped in user object
        return {"user_id": data.get("id"), "full_name": data.get("full_name")}
    
    @pytest.fixture(scope="class")
    def user2_token(self, session):
        """Login user 2 (photographer@surf.com)"""
        response = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": USER2_EMAIL,
            "password": USER2_PASSWORD
        })
        if response.status_code != 200:
            pytest.skip(f"Login failed for {USER2_EMAIL}")
        data = response.json()
        return {"user_id": data.get("id"), "full_name": data.get("full_name")}
    
    @pytest.fixture(scope="class")
    def sample_post(self, session, user1_token):
        """Get a sample post to test reactions"""
        response = session.get(f"{BASE_URL}/api/posts", params={"user_id": user1_token["user_id"]})
        assert response.status_code == 200
        posts = response.json()
        assert len(posts) > 0, "No posts available for testing"
        return posts[0]
    
    def test_add_shaka_reaction(self, session, user1_token, sample_post):
        """Test adding 🤙 shaka reaction to a post"""
        response = session.post(
            f"{BASE_URL}/api/posts/{sample_post['id']}/reactions?user_id={user1_token['user_id']}",
            json={"emoji": "🤙"}
        )
        assert response.status_code == 200, f"Failed to add shaka: {response.text}"
        data = response.json()
        assert data.get("action") in ["added", "removed"], f"Unexpected action: {data}"
    
    def test_add_wave_reaction(self, session, user1_token, sample_post):
        """Test adding 🌊 wave reaction to a post"""
        response = session.post(
            f"{BASE_URL}/api/posts/{sample_post['id']}/reactions?user_id={user1_token['user_id']}",
            json={"emoji": "🌊"}
        )
        assert response.status_code == 200
    
    def test_add_heart_reaction(self, session, user1_token, sample_post):
        """Test adding ❤️ heart reaction to a post"""
        response = session.post(
            f"{BASE_URL}/api/posts/{sample_post['id']}/reactions?user_id={user1_token['user_id']}",
            json={"emoji": "❤️"}
        )
        assert response.status_code == 200
    
    def test_add_fire_reaction(self, session, user1_token, sample_post):
        """Test adding 🔥 fire reaction to a post"""
        response = session.post(
            f"{BASE_URL}/api/posts/{sample_post['id']}/reactions?user_id={user1_token['user_id']}",
            json={"emoji": "🔥"}
        )
        assert response.status_code == 200
    
    def test_invalid_emoji_rejected(self, session, user1_token, sample_post):
        """Test that invalid emoji is rejected with 400"""
        response = session.post(
            f"{BASE_URL}/api/posts/{sample_post['id']}/reactions?user_id={user1_token['user_id']}",
            json={"emoji": "👍"}  # Invalid emoji
        )
        assert response.status_code == 400, f"Expected 400 for invalid emoji, got {response.status_code}"
    
    def test_reactions_in_posts_response(self, session, user1_token):
        """Test that reactions array is included in posts response"""
        response = session.get(f"{BASE_URL}/api/posts", params={"user_id": user1_token["user_id"]})
        assert response.status_code == 200
        posts = response.json()
        # Check first post has reactions field
        if len(posts) > 0:
            assert "reactions" in posts[0], "reactions field missing from post"
            # Verify reactions structure
            for reaction in posts[0].get("reactions", []):
                assert "emoji" in reaction
                assert "user_id" in reaction
                assert "user_name" in reaction


class TestNotifications:
    """Test Notifications API for post reactions"""
    
    @pytest.fixture(scope="class")
    def session(self):
        """Create requests session"""
        return requests.Session()
    
    @pytest.fixture(scope="class")
    def user1_token(self, session):
        """Login user 1"""
        response = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": USER1_EMAIL,
            "password": USER1_PASSWORD
        })
        if response.status_code != 200:
            pytest.skip(f"Login failed for {USER1_EMAIL}")
        data = response.json()
        return {"user_id": data.get("id"), "full_name": data.get("full_name")}
    
    @pytest.fixture(scope="class")
    def user2_token(self, session):
        """Login user 2"""
        response = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": USER2_EMAIL,
            "password": USER2_PASSWORD
        })
        if response.status_code != 200:
            pytest.skip(f"Login failed for {USER2_EMAIL}")
        data = response.json()
        return {"user_id": data.get("id"), "full_name": data.get("full_name")}
    
    def test_create_reaction_notification(self, session, user1_token, user2_token):
        """Test POST /api/notifications creates notification for post reaction"""
        notification_data = {
            "user_id": user2_token["user_id"],  # Notification goes to user2
            "type": "post_reaction",
            "title": "Kelly Slater reacted 🤙",
            "message": "Kelly Slater reacted with 🤙 to your post",
            "data": {
                "post_id": "test-post-123",
                "reactor_id": user1_token["user_id"],
                "reactor_name": "Kelly Slater",
                "emoji": "🤙"
            }
        }
        
        response = session.post(f"{BASE_URL}/api/notifications", json=notification_data)
        assert response.status_code == 200, f"Failed to create notification: {response.text}"
        data = response.json()
        assert data.get("success") == True
        assert "notification_id" in data
    
    def test_get_notifications(self, session, user2_token):
        """Test GET /api/notifications/{user_id} returns notifications"""
        response = session.get(f"{BASE_URL}/api/notifications/{user2_token['user_id']}")
        assert response.status_code == 200
        notifications = response.json()
        assert isinstance(notifications, list)
        # Verify notification structure
        if len(notifications) > 0:
            notif = notifications[0]
            assert "id" in notif
            assert "type" in notif
            assert "title" in notif
            assert "is_read" in notif
    
    def test_get_unread_count(self, session, user2_token):
        """Test unread notification count endpoint"""
        response = session.get(f"{BASE_URL}/api/notifications/{user2_token['user_id']}/unread-count")
        assert response.status_code == 200
        data = response.json()
        assert "unread_count" in data


class TestSurfSpots:
    """Test Surf Spots API for Map Page shooter count"""
    
    @pytest.fixture(scope="class")
    def session(self):
        """Create requests session"""
        return requests.Session()
    
    def test_get_surf_spots(self, session):
        """Test GET /api/surf-spots returns spots with active_photographers_count"""
        response = session.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        spots = response.json()
        assert isinstance(spots, list)
        assert len(spots) > 0, "No surf spots returned"
        
        # Verify spot structure includes active_photographers_count
        spot = spots[0]
        assert "id" in spot
        assert "name" in spot
        assert "active_photographers_count" in spot, "active_photographers_count missing from spot"
    
    def test_surf_spot_has_required_fields(self, session):
        """Test that surf spots have all required fields for Map Page"""
        response = session.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        spots = response.json()
        
        required_fields = ["id", "name", "region", "latitude", "longitude", "active_photographers_count"]
        for spot in spots[:5]:  # Check first 5 spots
            for field in required_fields:
                assert field in spot, f"Missing field: {field} in spot {spot.get('name')}"


class TestLivePhotographers:
    """Test Live Photographers API for Map Page"""
    
    @pytest.fixture(scope="class")
    def session(self):
        """Create requests session"""
        return requests.Session()
    
    def test_get_live_photographers(self, session):
        """Test GET /api/live-photographers"""
        response = session.get(f"{BASE_URL}/api/live-photographers")
        assert response.status_code == 200
        photographers = response.json()
        assert isinstance(photographers, list)
        
        # Verify photographer structure if any are live
        if len(photographers) > 0:
            photog = photographers[0]
            assert "id" in photog
            assert "full_name" in photog


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
