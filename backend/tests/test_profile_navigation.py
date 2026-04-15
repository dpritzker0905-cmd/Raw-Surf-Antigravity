"""
Tests for Profile Navigation and Follow/Unfollow functionality
Testing the fix for viewing other users' profiles and follow/unfollow each other
"""
import pytest
import requests
import os
import uuid

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test user prefix for cleanup
TEST_PREFIX = "TEST_profile_nav_"


class TestProfileEndpoints:
    """Test profile endpoints for viewing own and other users' profiles"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test users"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        
        # Create first test user
        self.user1_email = f"{TEST_PREFIX}user1_{uuid.uuid4().hex[:6]}@example.com"
        self.user1_password = "TestPass123!"
        response1 = self.session.post(f"{BASE_URL}/api/auth/signup", json={
            "email": self.user1_email,
            "password": self.user1_password,
            "full_name": f"{TEST_PREFIX}User One",
            "role": "Surfer"
        })
        if response1.status_code == 200:
            self.user1 = response1.json()
            self.user1_id = self.user1.get('user', {}).get('id') or self.user1.get('id')
        else:
            pytest.skip("Could not create test user 1")
        
        # Create second test user
        self.user2_email = f"{TEST_PREFIX}user2_{uuid.uuid4().hex[:6]}@example.com"
        self.user2_password = "TestPass456!"
        response2 = self.session.post(f"{BASE_URL}/api/auth/signup", json={
            "email": self.user2_email,
            "password": self.user2_password,
            "full_name": f"{TEST_PREFIX}User Two",
            "role": "Photographer"
        })
        if response2.status_code == 200:
            self.user2 = response2.json()
            self.user2_id = self.user2.get('user', {}).get('id') or self.user2.get('id')
        else:
            pytest.skip("Could not create test user 2")
        
        yield
        
        # Cleanup - unfollow if following
        try:
            self.session.delete(f"{BASE_URL}/api/follow/{self.user2_id}?follower_id={self.user1_id}")
            self.session.delete(f"{BASE_URL}/api/follow/{self.user1_id}?follower_id={self.user2_id}")
        except:
            pass

    def test_get_own_profile(self):
        """Test GET /api/profiles/{userId} - View own profile"""
        response = self.session.get(f"{BASE_URL}/api/profiles/{self.user1_id}")
        
        assert response.status_code == 200, f"Failed to get own profile: {response.text}"
        
        data = response.json()
        assert "id" in data, "Profile should have id"
        assert data["id"] == self.user1_id, "Profile id should match"
        assert "full_name" in data, "Profile should have full_name"
        assert "role" in data, "Profile should have role"
        print(f"SUCCESS: Own profile retrieved - {data.get('full_name')}")

    def test_get_other_user_profile(self):
        """Test GET /api/profiles/{userId} - View another user's profile"""
        response = self.session.get(f"{BASE_URL}/api/profiles/{self.user2_id}")
        
        assert response.status_code == 200, f"Failed to get other user's profile: {response.text}"
        
        data = response.json()
        assert "id" in data, "Profile should have id"
        assert data["id"] == self.user2_id, "Profile id should match the other user"
        assert "full_name" in data, "Profile should have full_name"
        print(f"SUCCESS: Other user's profile retrieved - {data.get('full_name')}")

    def test_get_profile_stats(self):
        """Test GET /api/profile/{userId}/stats - Profile stats for any user"""
        response = self.session.get(f"{BASE_URL}/api/profile/{self.user2_id}/stats")
        
        assert response.status_code == 200, f"Failed to get profile stats: {response.text}"
        
        data = response.json()
        assert "posts" in data, "Stats should have posts count"
        assert "videos" in data, "Stats should have videos count"
        print(f"SUCCESS: Profile stats retrieved - posts: {data.get('posts')}")

    def test_get_nonexistent_profile(self):
        """Test GET /api/profiles/{userId} - Non-existent user"""
        fake_id = str(uuid.uuid4())
        response = self.session.get(f"{BASE_URL}/api/profiles/{fake_id}")
        
        assert response.status_code == 404, f"Should return 404 for non-existent profile, got: {response.status_code}"
        print("SUCCESS: Returns 404 for non-existent profile")


class TestFollowUnfollowEndpoints:
    """Test follow and unfollow functionality between users"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test users"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        
        # Create first test user
        self.user1_email = f"{TEST_PREFIX}follower_{uuid.uuid4().hex[:6]}@example.com"
        self.user1_password = "TestPass123!"
        response1 = self.session.post(f"{BASE_URL}/api/auth/signup", json={
            "email": self.user1_email,
            "password": self.user1_password,
            "full_name": f"{TEST_PREFIX}Follower User",
            "role": "Surfer"
        })
        if response1.status_code == 200:
            self.user1 = response1.json()
            self.user1_id = self.user1.get('user', {}).get('id') or self.user1.get('id')
        else:
            pytest.skip("Could not create test user 1")
        
        # Create second test user
        self.user2_email = f"{TEST_PREFIX}target_{uuid.uuid4().hex[:6]}@example.com"
        self.user2_password = "TestPass456!"
        response2 = self.session.post(f"{BASE_URL}/api/auth/signup", json={
            "email": self.user2_email,
            "password": self.user2_password,
            "full_name": f"{TEST_PREFIX}Target User",
            "role": "Photographer"
        })
        if response2.status_code == 200:
            self.user2 = response2.json()
            self.user2_id = self.user2.get('user', {}).get('id') or self.user2.get('id')
        else:
            pytest.skip("Could not create test user 2")
        
        yield
        
        # Cleanup - unfollow if following
        try:
            self.session.delete(f"{BASE_URL}/api/follow/{self.user2_id}?follower_id={self.user1_id}")
        except:
            pass

    def test_follow_user(self):
        """Test POST /api/follow/{userId} - Follow another user"""
        response = self.session.post(
            f"{BASE_URL}/api/follow/{self.user2_id}?follower_id={self.user1_id}"
        )
        
        assert response.status_code == 200, f"Failed to follow user: {response.text}"
        
        data = response.json()
        assert "message" in data, "Response should have message"
        print(f"SUCCESS: Follow user - {data.get('message')}")

    def test_cannot_follow_self(self):
        """Test POST /api/follow/{userId} - Cannot follow yourself"""
        response = self.session.post(
            f"{BASE_URL}/api/follow/{self.user1_id}?follower_id={self.user1_id}"
        )
        
        assert response.status_code == 400, f"Should return 400 when following self, got: {response.status_code}"
        print("SUCCESS: Cannot follow yourself - returns 400")

    def test_cannot_follow_twice(self):
        """Test POST /api/follow/{userId} - Cannot follow same user twice"""
        # First follow
        self.session.post(f"{BASE_URL}/api/follow/{self.user2_id}?follower_id={self.user1_id}")
        
        # Try to follow again
        response = self.session.post(
            f"{BASE_URL}/api/follow/{self.user2_id}?follower_id={self.user1_id}"
        )
        
        assert response.status_code == 400, f"Should return 400 when already following, got: {response.status_code}"
        print("SUCCESS: Cannot follow twice - returns 400")

    def test_unfollow_user(self):
        """Test DELETE /api/follow/{userId} - Unfollow a user"""
        # First follow
        self.session.post(f"{BASE_URL}/api/follow/{self.user2_id}?follower_id={self.user1_id}")
        
        # Then unfollow
        response = self.session.delete(
            f"{BASE_URL}/api/follow/{self.user2_id}?follower_id={self.user1_id}"
        )
        
        assert response.status_code == 200, f"Failed to unfollow user: {response.text}"
        
        data = response.json()
        assert "message" in data, "Response should have message"
        print(f"SUCCESS: Unfollow user - {data.get('message')}")

    def test_cannot_unfollow_when_not_following(self):
        """Test DELETE /api/follow/{userId} - Cannot unfollow if not following"""
        response = self.session.delete(
            f"{BASE_URL}/api/follow/{self.user2_id}?follower_id={self.user1_id}"
        )
        
        assert response.status_code == 400, f"Should return 400 when not following, got: {response.status_code}"
        print("SUCCESS: Cannot unfollow when not following - returns 400")


class TestFollowersFollowingEndpoints:
    """Test fetching followers and following lists"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test users"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        
        # Create first test user
        self.user1_email = f"{TEST_PREFIX}main_{uuid.uuid4().hex[:6]}@example.com"
        response1 = self.session.post(f"{BASE_URL}/api/auth/signup", json={
            "email": self.user1_email,
            "password": "TestPass123!",
            "full_name": f"{TEST_PREFIX}Main User",
            "role": "Surfer"
        })
        if response1.status_code == 200:
            self.user1 = response1.json()
            self.user1_id = self.user1.get('user', {}).get('id') or self.user1.get('id')
        else:
            pytest.skip("Could not create test user 1")
        
        # Create second test user  
        self.user2_email = f"{TEST_PREFIX}other_{uuid.uuid4().hex[:6]}@example.com"
        response2 = self.session.post(f"{BASE_URL}/api/auth/signup", json={
            "email": self.user2_email,
            "password": "TestPass456!",
            "full_name": f"{TEST_PREFIX}Other User",
            "role": "Photographer"
        })
        if response2.status_code == 200:
            self.user2 = response2.json()
            self.user2_id = self.user2.get('user', {}).get('id') or self.user2.get('id')
        else:
            pytest.skip("Could not create test user 2")
        
        yield
        
        # Cleanup
        try:
            self.session.delete(f"{BASE_URL}/api/follow/{self.user2_id}?follower_id={self.user1_id}")
        except:
            pass

    def test_get_followers_list(self):
        """Test GET /api/followers/{userId} - Get followers list"""
        # First user1 follows user2
        self.session.post(f"{BASE_URL}/api/follow/{self.user2_id}?follower_id={self.user1_id}")
        
        # Get user2's followers
        response = self.session.get(f"{BASE_URL}/api/followers/{self.user2_id}")
        
        assert response.status_code == 200, f"Failed to get followers: {response.text}"
        
        data = response.json()
        assert isinstance(data, list), "Followers should be a list"
        
        # Check that user1 is in the followers list
        follower_ids = [f.get('id') for f in data]
        assert self.user1_id in follower_ids, "User1 should be in user2's followers"
        
        # Check follower data structure
        if len(data) > 0:
            follower = data[0]
            assert "id" in follower, "Follower should have id"
            assert "full_name" in follower, "Follower should have full_name"
        
        print(f"SUCCESS: Got followers list - count: {len(data)}")

    def test_get_following_list(self):
        """Test GET /api/following/{userId} - Get following list"""
        # First user1 follows user2
        self.session.post(f"{BASE_URL}/api/follow/{self.user2_id}?follower_id={self.user1_id}")
        
        # Get user1's following list
        response = self.session.get(f"{BASE_URL}/api/following/{self.user1_id}")
        
        assert response.status_code == 200, f"Failed to get following: {response.text}"
        
        data = response.json()
        assert isinstance(data, list), "Following should be a list"
        
        # Check that user2 is in the following list
        following_ids = [f.get('id') for f in data]
        assert self.user2_id in following_ids, "User2 should be in user1's following list"
        
        print(f"SUCCESS: Got following list - count: {len(data)}")

    def test_followers_count_updates_on_follow(self):
        """Test that follower count increases when followed"""
        # Get initial followers count
        initial_response = self.session.get(f"{BASE_URL}/api/followers/{self.user2_id}")
        initial_count = len(initial_response.json()) if initial_response.status_code == 200 else 0
        
        # Follow user
        self.session.post(f"{BASE_URL}/api/follow/{self.user2_id}?follower_id={self.user1_id}")
        
        # Get updated followers count
        updated_response = self.session.get(f"{BASE_URL}/api/followers/{self.user2_id}")
        assert updated_response.status_code == 200
        updated_count = len(updated_response.json())
        
        assert updated_count == initial_count + 1, f"Followers count should increase by 1"
        print(f"SUCCESS: Followers count updated from {initial_count} to {updated_count}")

    def test_followers_count_updates_on_unfollow(self):
        """Test that follower count decreases when unfollowed"""
        # First follow
        self.session.post(f"{BASE_URL}/api/follow/{self.user2_id}?follower_id={self.user1_id}")
        
        # Get count after following
        after_follow_response = self.session.get(f"{BASE_URL}/api/followers/{self.user2_id}")
        after_follow_count = len(after_follow_response.json())
        
        # Unfollow
        self.session.delete(f"{BASE_URL}/api/follow/{self.user2_id}?follower_id={self.user1_id}")
        
        # Get count after unfollowing
        after_unfollow_response = self.session.get(f"{BASE_URL}/api/followers/{self.user2_id}")
        assert after_unfollow_response.status_code == 200
        after_unfollow_count = len(after_unfollow_response.json())
        
        assert after_unfollow_count == after_follow_count - 1, f"Followers count should decrease by 1"
        print(f"SUCCESS: Followers count updated from {after_follow_count} to {after_unfollow_count}")


class TestFollowNonexistentUser:
    """Test error handling for following non-existent users"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        
        # Create a test user
        self.user_email = f"{TEST_PREFIX}exists_{uuid.uuid4().hex[:6]}@example.com"
        response = self.session.post(f"{BASE_URL}/api/auth/signup", json={
            "email": self.user_email,
            "password": "TestPass123!",
            "full_name": f"{TEST_PREFIX}Existing User",
            "role": "Surfer"
        })
        if response.status_code == 200:
            self.user = response.json()
            self.user_id = self.user.get('user', {}).get('id') or self.user.get('id')
        else:
            pytest.skip("Could not create test user")

    def test_follow_nonexistent_user(self):
        """Test POST /api/follow/{userId} - Non-existent user to follow"""
        fake_id = str(uuid.uuid4())
        response = self.session.post(
            f"{BASE_URL}/api/follow/{fake_id}?follower_id={self.user_id}"
        )
        
        assert response.status_code == 404, f"Should return 404 for non-existent user, got: {response.status_code}"
        print("SUCCESS: Returns 404 for non-existent user to follow")

    def test_follow_with_nonexistent_follower(self):
        """Test POST /api/follow/{userId} - Non-existent follower"""
        fake_follower_id = str(uuid.uuid4())
        response = self.session.post(
            f"{BASE_URL}/api/follow/{self.user_id}?follower_id={fake_follower_id}"
        )
        
        assert response.status_code == 404, f"Should return 404 for non-existent follower, got: {response.status_code}"
        print("SUCCESS: Returns 404 for non-existent follower")
