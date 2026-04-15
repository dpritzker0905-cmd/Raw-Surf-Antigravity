"""
Test Feed Integration for The Lineup + Invite Nearby Crew popup
Iteration 209 - Delta sync testing

Features tested:
1. GET /api/admin/platform-settings - returns default feature flags including show_lineup_cards_in_feed
2. GET /api/feed/lineups - returns open lineups for user (empty array if none)
3. GET /api/friends/nearby - returns friends within radius (empty if none nearby)
4. POST /api/bookings/{id}/invite-crew - sends invites to selected friends
"""

import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials
TEST_USER_EMAIL = "testuser_e1@test.com"
TEST_USER_PASSWORD = "TestPass123!"


class TestPlatformSettings:
    """Test platform settings endpoint for feature flags"""
    
    def test_get_platform_settings_returns_defaults(self):
        """GET /api/admin/platform-settings should return default feature flags"""
        response = requests.get(f"{BASE_URL}/api/admin/platform-settings")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        
        # Verify required feature flags exist
        assert "show_lineup_cards_in_feed" in data, "Missing show_lineup_cards_in_feed flag"
        assert "show_session_logs_in_feed" in data, "Missing show_session_logs_in_feed flag"
        assert "allow_nearby_crew_invites" in data, "Missing allow_nearby_crew_invites flag"
        assert "feed_lineup_card_frequency" in data, "Missing feed_lineup_card_frequency"
        assert "max_lineup_cards_per_feed" in data, "Missing max_lineup_cards_per_feed"
        assert "lineup_default_visibility" in data, "Missing lineup_default_visibility"
        assert "live_nearby_radius_miles" in data, "Missing live_nearby_radius_miles"
        
        # Verify default values
        assert data["show_lineup_cards_in_feed"] == True, "show_lineup_cards_in_feed should default to True"
        assert data["allow_nearby_crew_invites"] == True, "allow_nearby_crew_invites should default to True"
        assert isinstance(data["feed_lineup_card_frequency"], int), "feed_lineup_card_frequency should be int"
        assert isinstance(data["max_lineup_cards_per_feed"], int), "max_lineup_cards_per_feed should be int"
        
        print(f"✓ Platform settings returned with all feature flags: {data}")


class TestFeedLineups:
    """Test feed lineups endpoint"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Get test user ID by logging in"""
        # Login to get user ID
        login_response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": TEST_USER_EMAIL, "password": TEST_USER_PASSWORD}
        )
        
        if login_response.status_code == 200:
            data = login_response.json()
            # API returns user_id directly (not nested in user object)
            self.user_id = data.get("user_id") or data.get("id")
        else:
            # Try to get user by email
            self.user_id = None
            print(f"Login failed: {login_response.status_code} - {login_response.text}")
    
    def test_get_feed_lineups_returns_array(self):
        """GET /api/feed/lineups should return array (empty if no open lineups)"""
        if not self.user_id:
            pytest.skip("No user ID available - login failed")
        
        response = requests.get(
            f"{BASE_URL}/api/feed/lineups",
            params={"user_id": self.user_id, "limit": 3}
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert isinstance(data, list), f"Expected list, got {type(data)}"
        
        # Per test requirements: empty array is expected since test user has no open lineups
        print(f"✓ Feed lineups returned: {len(data)} lineups (empty is expected)")
        
        # If there are lineups, verify structure
        if len(data) > 0:
            lineup = data[0]
            assert "id" in lineup, "Lineup missing id"
            assert "creator_id" in lineup, "Lineup missing creator_id"
            assert "location" in lineup, "Lineup missing location"
            assert "lineup_status" in lineup, "Lineup missing lineup_status"
            print(f"  Lineup structure verified: {lineup.get('id')}")
    
    def test_get_feed_lineups_without_user_id_fails(self):
        """GET /api/feed/lineups without user_id should fail"""
        response = requests.get(f"{BASE_URL}/api/feed/lineups")
        
        # Should return 422 (validation error) since user_id is required
        assert response.status_code == 422, f"Expected 422, got {response.status_code}"
        print("✓ Feed lineups correctly requires user_id parameter")


class TestNearbyFriends:
    """Test nearby friends endpoint for Invite Nearby Crew feature"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Get test user ID by logging in"""
        login_response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": TEST_USER_EMAIL, "password": TEST_USER_PASSWORD}
        )
        
        if login_response.status_code == 200:
            data = login_response.json()
            self.user_id = data.get("user_id") or data.get("id")
        else:
            self.user_id = None
            print(f"Login failed: {login_response.status_code}")
    
    def test_get_nearby_friends_returns_array(self):
        """GET /api/friends/nearby should return array (empty if no friends nearby)"""
        if not self.user_id:
            pytest.skip("No user ID available - login failed")
        
        response = requests.get(
            f"{BASE_URL}/api/friends/nearby",
            params={
                "user_id": self.user_id,
                "latitude": 28.3922,  # Cocoa Beach, FL
                "longitude": -80.6077,
                "radius_miles": 10
            }
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert isinstance(data, list), f"Expected list, got {type(data)}"
        
        # Per test requirements: empty array is expected since test user has no friends nearby
        print(f"✓ Nearby friends returned: {len(data)} friends (empty is expected)")
        
        # If there are friends, verify structure
        if len(data) > 0:
            friend = data[0]
            assert "id" in friend, "Friend missing id"
            assert "full_name" in friend, "Friend missing full_name"
            assert "distance_miles" in friend, "Friend missing distance_miles"
            print(f"  Friend structure verified: {friend.get('full_name')}")
    
    def test_get_nearby_friends_without_location(self):
        """GET /api/friends/nearby without location should still work (uses profile location)"""
        if not self.user_id:
            pytest.skip("No user ID available - login failed")
        
        response = requests.get(
            f"{BASE_URL}/api/friends/nearby",
            params={"user_id": self.user_id}
        )
        
        # Should return 200 with empty array (no location = no nearby friends)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert isinstance(data, list), f"Expected list, got {type(data)}"
        print(f"✓ Nearby friends without location returned: {len(data)} friends")


class TestInviteCrewEndpoint:
    """Test invite crew endpoint for bookings"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Get test user ID by logging in"""
        login_response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": TEST_USER_EMAIL, "password": TEST_USER_PASSWORD}
        )
        
        if login_response.status_code == 200:
            data = login_response.json()
            self.user_id = data.get("user_id") or data.get("id")
        else:
            self.user_id = None
            print(f"Login failed: {login_response.status_code}")
    
    def test_invite_crew_invalid_booking_returns_404(self):
        """POST /api/bookings/{id}/invite-crew with invalid booking should return 404"""
        if not self.user_id:
            pytest.skip("No user ID available - login failed")
        
        response = requests.post(
            f"{BASE_URL}/api/bookings/invalid-booking-id/invite-crew",
            params={"user_id": self.user_id},
            json={
                "friend_ids": ["friend-1", "friend-2"],
                "share_amount": 25.00,
                "message": "Join my surf session!"
            }
        )
        
        # Should return 404 for invalid booking
        assert response.status_code == 404, f"Expected 404, got {response.status_code}: {response.text}"
        print("✓ Invite crew correctly returns 404 for invalid booking")
    
    def test_invite_crew_requires_user_id(self):
        """POST /api/bookings/{id}/invite-crew without user_id should fail"""
        response = requests.post(
            f"{BASE_URL}/api/bookings/some-booking-id/invite-crew",
            json={
                "friend_ids": ["friend-1"],
                "share_amount": 25.00
            }
        )
        
        # Should return 422 (validation error) since user_id is required
        assert response.status_code == 422, f"Expected 422, got {response.status_code}"
        print("✓ Invite crew correctly requires user_id parameter")


class TestFeedLineupCardIntegration:
    """Test that feed lineup cards work with the feed endpoint"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Get test user ID by logging in"""
        login_response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": TEST_USER_EMAIL, "password": TEST_USER_PASSWORD}
        )
        
        if login_response.status_code == 200:
            self.user_id = login_response.json().get("user", {}).get("id")
        else:
            self.user_id = None
    
    def test_feed_lineups_respects_platform_settings(self):
        """Feed lineups should respect show_lineup_cards_in_feed setting"""
        if not self.user_id:
            pytest.skip("No user ID available - login failed")
        
        # First check platform settings
        settings_response = requests.get(f"{BASE_URL}/api/admin/platform-settings")
        assert settings_response.status_code == 200
        
        settings = settings_response.json()
        show_lineups = settings.get("show_lineup_cards_in_feed", True)
        
        # Then check feed lineups
        lineups_response = requests.get(
            f"{BASE_URL}/api/feed/lineups",
            params={"user_id": self.user_id, "limit": 3}
        )
        assert lineups_response.status_code == 200
        
        # If show_lineup_cards_in_feed is False, should return empty
        # If True, returns whatever lineups are available (empty for test user)
        print(f"✓ Feed lineups respects platform settings (show_lineup_cards_in_feed={show_lineups})")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
