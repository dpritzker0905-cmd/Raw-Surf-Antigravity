"""
Tests for P1 and P2 Features:
- Check In & Streaks endpoints
- Explore page search and trending endpoints
- Feed/Posts with likes (shaka)
- Follow/Followers/Following endpoints
"""

import pytest
import requests
import os
from datetime import datetime

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://raw-surf-os.preview.emergentagent.com').rstrip('/')

# Test credentials
TEST_USER_ID = "90d2c43c-026e-4800-bc93-796921f410fe"
TEST_USER_EMAIL = "testuser@rawsurf.com"

class TestCheckInAndStreaks:
    """Tests for Check In and Streak functionality"""

    def test_get_streak_for_existing_user(self):
        """GET /api/streak/{user_id} returns streak info"""
        response = requests.get(f"{BASE_URL}/api/streak/{TEST_USER_ID}")
        assert response.status_code == 200
        data = response.json()
        assert "current_streak" in data
        assert "longest_streak" in data
        assert "total_check_ins" in data
        assert "checked_in_today" in data
        print(f"PASS: Streak response - current: {data['current_streak']}, longest: {data['longest_streak']}, checked_in_today: {data['checked_in_today']}")

    def test_get_streak_for_nonexistent_user(self):
        """GET /api/streak/{user_id} returns zeros for new user"""
        response = requests.get(f"{BASE_URL}/api/streak/nonexistent-user-id-12345")
        assert response.status_code == 200
        data = response.json()
        assert data["current_streak"] == 0
        assert data["longest_streak"] == 0
        assert data["total_check_ins"] == 0
        assert data["checked_in_today"] == False
        print("PASS: Nonexistent user returns zero streak")

    def test_get_user_check_ins(self):
        """GET /api/check-ins/{user_id} returns check-in history"""
        response = requests.get(f"{BASE_URL}/api/check-ins/{TEST_USER_ID}")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        if len(data) > 0:
            check_in = data[0]
            assert "id" in check_in
            assert "created_at" in check_in
            print(f"PASS: Found {len(data)} check-ins for user")
        else:
            print("PASS: User has no check-ins yet")

    def test_check_in_requires_user_id(self):
        """POST /api/check-in without user_id should fail"""
        response = requests.post(
            f"{BASE_URL}/api/check-in",
            json={"spot_name": "Test Beach"}
        )
        # Should fail without user_id query parameter
        assert response.status_code in [404, 422]
        print("PASS: Check-in requires user_id parameter")

    def test_check_in_with_valid_user(self):
        """POST /api/check-in creates a check-in (may fail if already checked in today)"""
        response = requests.post(
            f"{BASE_URL}/api/check-in?user_id={TEST_USER_ID}",
            json={
                "spot_name": "Test Beach",
                "conditions": "Clean",
                "wave_height": "2-3ft",
                "notes": "Test check-in from pytest"
            }
        )
        # Either 200 (success) or 400 (already checked in today)
        assert response.status_code in [200, 400]
        if response.status_code == 200:
            data = response.json()
            assert "current_streak" in data
            assert "id" in data
            print(f"PASS: Check-in created, streak: {data['current_streak']}")
        else:
            # Already checked in today
            assert "Already checked in today" in response.json().get("detail", "")
            print("PASS: Already checked in today - expected behavior")


class TestExploreSearch:
    """Tests for Explore page search functionality"""

    def test_explore_search_spots(self):
        """GET /api/explore/search?q=sebastian returns spots"""
        response = requests.get(f"{BASE_URL}/api/explore/search", params={"q": "sebastian", "type": "spots"})
        assert response.status_code == 200
        data = response.json()
        assert "spots" in data
        assert isinstance(data["spots"], list)
        # Sebastian Inlet should be in results if seeded
        if len(data["spots"]) > 0:
            spot_names = [s["name"] for s in data["spots"]]
            print(f"PASS: Found spots: {spot_names}")
        else:
            print("PASS: Search returned empty (spots may not be seeded)")

    def test_explore_search_all(self):
        """GET /api/explore/search?q=test&type=all returns mixed results"""
        response = requests.get(f"{BASE_URL}/api/explore/search", params={"q": "test", "type": "all"})
        assert response.status_code == 200
        data = response.json()
        assert "users" in data
        assert "spots" in data
        assert "posts" in data
        print(f"PASS: Search all - users: {len(data['users'])}, spots: {len(data['spots'])}, posts: {len(data['posts'])}")

    def test_explore_search_users(self):
        """GET /api/explore/search?q=sarah&type=users returns users"""
        response = requests.get(f"{BASE_URL}/api/explore/search", params={"q": "sarah", "type": "users"})
        assert response.status_code == 200
        data = response.json()
        assert "users" in data
        if len(data["users"]) > 0:
            user = data["users"][0]
            assert "id" in user
            assert "full_name" in user
            print(f"PASS: Found user: {user['full_name']}")
        else:
            print("PASS: No users found matching 'sarah'")


class TestExploreTrending:
    """Tests for Explore trending functionality"""

    def test_explore_trending_returns_data(self):
        """GET /api/explore/trending returns trending data"""
        response = requests.get(f"{BASE_URL}/api/explore/trending")
        assert response.status_code == 200
        data = response.json()
        assert "live_now" in data
        assert "trending_spots" in data
        assert "trending_posts" in data
        print(f"PASS: Trending - live: {len(data['live_now'])}, spots: {len(data['trending_spots'])}, posts: {len(data['trending_posts'])}")

    def test_trending_live_now_structure(self):
        """Verify live_now users have correct structure"""
        response = requests.get(f"{BASE_URL}/api/explore/trending")
        assert response.status_code == 200
        data = response.json()
        if len(data["live_now"]) > 0:
            user = data["live_now"][0]
            assert "id" in user
            assert "full_name" in user
            print(f"PASS: Live user structure valid - {user.get('full_name')}")
        else:
            print("PASS: No live users currently (expected)")


class TestFeedAndPosts:
    """Tests for Feed and Posts functionality"""

    def test_get_posts(self):
        """GET /api/posts returns feed posts"""
        response = requests.get(f"{BASE_URL}/api/posts")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        if len(data) > 0:
            post = data[0]
            assert "id" in post
            assert "author_name" in post
            assert "image_url" in post
            assert "likes_count" in post
            print(f"PASS: Found {len(data)} posts in feed")
        else:
            print("PASS: No posts in feed yet")

    def test_like_post_shaka(self):
        """POST /api/posts/{post_id}/like increments likes count"""
        # First get a post
        posts_response = requests.get(f"{BASE_URL}/api/posts")
        if posts_response.status_code == 200 and len(posts_response.json()) > 0:
            post_id = posts_response.json()[0]["id"]
            original_likes = posts_response.json()[0]["likes_count"]
            
            # Like the post (shaka)
            like_response = requests.post(f"{BASE_URL}/api/posts/{post_id}/like")
            assert like_response.status_code == 200
            data = like_response.json()
            assert "likes_count" in data
            assert data["likes_count"] == original_likes + 1
            print(f"PASS: Shaka (like) works - likes now: {data['likes_count']}")
        else:
            # Create a test post first
            pytest.skip("No posts available to test like functionality")


class TestFollowSystem:
    """Tests for Follow/Followers/Following functionality"""

    def test_get_followers(self):
        """GET /api/followers/{user_id} returns followers list"""
        response = requests.get(f"{BASE_URL}/api/followers/{TEST_USER_ID}")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"PASS: User has {len(data)} followers")

    def test_get_following(self):
        """GET /api/following/{user_id} returns following list"""
        response = requests.get(f"{BASE_URL}/api/following/{TEST_USER_ID}")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"PASS: User follows {len(data)} users")


class TestSurfSpots:
    """Tests for Surf Spots functionality"""

    def test_get_surf_spots(self):
        """GET /api/surf-spots returns list of spots"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        if len(data) > 0:
            spot = data[0]
            assert "id" in spot
            assert "name" in spot
            assert "latitude" in spot
            assert "longitude" in spot
            print(f"PASS: Found {len(data)} surf spots")
        else:
            print("PASS: No surf spots seeded yet")


class TestProfileEndpoints:
    """Tests for Profile-related endpoints"""

    def test_get_profile(self):
        """GET /api/profiles/{profile_id} returns profile"""
        response = requests.get(f"{BASE_URL}/api/profiles/{TEST_USER_ID}")
        assert response.status_code == 200
        data = response.json()
        assert data["id"] == TEST_USER_ID
        assert "full_name" in data
        assert "role" in data
        assert "credit_balance" in data
        print(f"PASS: Profile loaded - {data['full_name']}, role: {data['role']}")

    def test_update_profile(self):
        """PATCH /api/profiles/{profile_id} updates profile"""
        # First get current bio
        get_response = requests.get(f"{BASE_URL}/api/profiles/{TEST_USER_ID}")
        original_bio = get_response.json().get("bio", "")
        
        # Update bio
        test_bio = f"Test bio updated at {datetime.now().isoformat()}"
        response = requests.patch(
            f"{BASE_URL}/api/profiles/{TEST_USER_ID}",
            json={"bio": test_bio}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["bio"] == test_bio
        
        # Restore original bio
        requests.patch(
            f"{BASE_URL}/api/profiles/{TEST_USER_ID}",
            json={"bio": original_bio}
        )
        print("PASS: Profile update works")


class TestHealthCheck:
    """Basic health check tests"""

    def test_api_health(self):
        """GET /api/ returns healthy status"""
        response = requests.get(f"{BASE_URL}/api/")
        assert response.status_code == 200
        data = response.json()
        assert data.get("status") == "active"
        print("PASS: API is healthy")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
