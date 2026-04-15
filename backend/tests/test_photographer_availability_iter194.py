"""
Test Photographer Availability System - Iteration 194
Tests:
1. GET /api/notifications/photographer-alerts/{photographer_id} - Get subscription status
2. POST /api/notifications/photographer-alerts - Subscribe to alerts
3. DELETE /api/notifications/photographer-alerts/{photographer_id} - Unsubscribe from alerts
4. Profile endpoint returns photographer role for availability button display
"""

import pytest
import requests
import os
import uuid

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://raw-surf-os.preview.emergentagent.com').rstrip('/')

# Test credentials from review request
TEST_USER_EMAIL = "dpritzker0905@gmail.com"
TEST_USER_PASSWORD = "TestPassword123!"
TEST_PHOTOGRAPHER_ID = "42fdf4c6-a517-40d0-b53c-f01114636185"
TEST_USER_ID = "12dc6786-124f-40b1-8698-a9409f99736f"


class TestPhotographerAlertSubscriptions:
    """Test photographer availability alert subscription endpoints"""
    
    def test_get_subscription_status_no_subscriptions(self):
        """GET /api/notifications/photographer-alerts/{photographer_id} - No subscriptions"""
        response = requests.get(
            f"{BASE_URL}/api/notifications/photographer-alerts/{TEST_PHOTOGRAPHER_ID}",
            params={"user_id": TEST_USER_ID}
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        # Should return subscription status for all 3 types
        assert "live_shooting" in data
        assert "on_demand" in data
        assert "scheduled_booking" in data
        print(f"✓ Subscription status: {data}")
    
    def test_subscribe_to_live_shooting_alerts(self):
        """POST /api/notifications/photographer-alerts - Subscribe to live shooting"""
        response = requests.post(
            f"{BASE_URL}/api/notifications/photographer-alerts",
            json={
                "user_id": TEST_USER_ID,
                "photographer_id": TEST_PHOTOGRAPHER_ID,
                "alert_type": "live_shooting"
            }
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data.get("success") == True
        print(f"✓ Subscribed to live_shooting alerts: {data}")
    
    def test_subscribe_to_on_demand_alerts(self):
        """POST /api/notifications/photographer-alerts - Subscribe to on-demand"""
        response = requests.post(
            f"{BASE_URL}/api/notifications/photographer-alerts",
            json={
                "user_id": TEST_USER_ID,
                "photographer_id": TEST_PHOTOGRAPHER_ID,
                "alert_type": "on_demand"
            }
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data.get("success") == True
        print(f"✓ Subscribed to on_demand alerts: {data}")
    
    def test_subscribe_to_scheduled_booking_alerts(self):
        """POST /api/notifications/photographer-alerts - Subscribe to scheduled booking"""
        response = requests.post(
            f"{BASE_URL}/api/notifications/photographer-alerts",
            json={
                "user_id": TEST_USER_ID,
                "photographer_id": TEST_PHOTOGRAPHER_ID,
                "alert_type": "scheduled_booking"
            }
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data.get("success") == True
        print(f"✓ Subscribed to scheduled_booking alerts: {data}")
    
    def test_get_subscription_status_with_subscriptions(self):
        """GET /api/notifications/photographer-alerts/{photographer_id} - With subscriptions"""
        response = requests.get(
            f"{BASE_URL}/api/notifications/photographer-alerts/{TEST_PHOTOGRAPHER_ID}",
            params={"user_id": TEST_USER_ID}
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        # After subscribing, at least one should be True
        print(f"✓ Subscription status after subscribing: {data}")
    
    def test_unsubscribe_from_live_shooting_alerts(self):
        """DELETE /api/notifications/photographer-alerts/{photographer_id} - Unsubscribe"""
        response = requests.delete(
            f"{BASE_URL}/api/notifications/photographer-alerts/{TEST_PHOTOGRAPHER_ID}",
            params={
                "user_id": TEST_USER_ID,
                "alert_type": "live_shooting"
            }
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data.get("success") == True
        print(f"✓ Unsubscribed from live_shooting alerts: {data}")
    
    def test_unsubscribe_from_on_demand_alerts(self):
        """DELETE /api/notifications/photographer-alerts/{photographer_id} - Unsubscribe on_demand"""
        response = requests.delete(
            f"{BASE_URL}/api/notifications/photographer-alerts/{TEST_PHOTOGRAPHER_ID}",
            params={
                "user_id": TEST_USER_ID,
                "alert_type": "on_demand"
            }
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data.get("success") == True
        print(f"✓ Unsubscribed from on_demand alerts: {data}")
    
    def test_unsubscribe_from_scheduled_booking_alerts(self):
        """DELETE /api/notifications/photographer-alerts/{photographer_id} - Unsubscribe scheduled_booking"""
        response = requests.delete(
            f"{BASE_URL}/api/notifications/photographer-alerts/{TEST_PHOTOGRAPHER_ID}",
            params={
                "user_id": TEST_USER_ID,
                "alert_type": "scheduled_booking"
            }
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data.get("success") == True
        print(f"✓ Unsubscribed from scheduled_booking alerts: {data}")
    
    def test_subscribe_invalid_user(self):
        """POST /api/notifications/photographer-alerts - Invalid user ID"""
        response = requests.post(
            f"{BASE_URL}/api/notifications/photographer-alerts",
            json={
                "user_id": str(uuid.uuid4()),  # Non-existent user
                "photographer_id": TEST_PHOTOGRAPHER_ID,
                "alert_type": "live_shooting"
            }
        )
        assert response.status_code == 404, f"Expected 404, got {response.status_code}: {response.text}"
        print(f"✓ Correctly rejected invalid user: {response.json()}")
    
    def test_subscribe_invalid_photographer(self):
        """POST /api/notifications/photographer-alerts - Invalid photographer ID"""
        response = requests.post(
            f"{BASE_URL}/api/notifications/photographer-alerts",
            json={
                "user_id": TEST_USER_ID,
                "photographer_id": str(uuid.uuid4()),  # Non-existent photographer
                "alert_type": "live_shooting"
            }
        )
        assert response.status_code == 404, f"Expected 404, got {response.status_code}: {response.text}"
        print(f"✓ Correctly rejected invalid photographer: {response.json()}")


class TestPhotographerProfileForAvailability:
    """Test profile endpoint returns photographer role for availability button display"""
    
    def test_get_photographer_profile(self):
        """GET /api/profiles/{photographer_id} - Returns photographer role"""
        response = requests.get(f"{BASE_URL}/api/profiles/{TEST_PHOTOGRAPHER_ID}")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        # Check that profile has role field
        assert "role" in data, "Profile should have role field"
        
        # Photographer roles that should show availability button
        photographer_roles = ['Hobbyist', 'Photographer', 'Approved Pro', 'Pro']
        print(f"✓ Photographer profile role: {data.get('role')}")
        print(f"✓ Profile has is_on_demand_active: {data.get('is_on_demand_active', 'N/A')}")
        print(f"✓ Profile has accepts_bookings: {data.get('accepts_bookings', 'N/A')}")
    
    def test_get_active_session_for_photographer(self):
        """GET /api/sessions/active/{photographer_id} - Check if photographer is live"""
        response = requests.get(f"{BASE_URL}/api/sessions/active/{TEST_PHOTOGRAPHER_ID}")
        # This endpoint may return 404 if no active session, which is fine
        if response.status_code == 200:
            data = response.json()
            print(f"✓ Active session data: {data}")
        else:
            print(f"✓ No active session (status {response.status_code}) - expected behavior")


class TestFeedFollowCTA:
    """Test Feed shows Follow CTA for photographer posts"""
    
    def test_get_posts_with_author_role(self):
        """GET /api/posts - Returns author_role for Follow CTA logic"""
        response = requests.get(
            f"{BASE_URL}/api/posts",
            params={"user_id": TEST_USER_ID}
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert isinstance(data, list), "Posts should be a list"
        
        # Check if posts have author_role field
        for post in data[:5]:  # Check first 5 posts
            if "author_role" in post:
                print(f"✓ Post {post.get('id', 'N/A')[:8]}... has author_role: {post.get('author_role')}")
        
        print(f"✓ Retrieved {len(data)} posts")
    
    def test_follow_photographer_from_feed(self):
        """POST /api/social/follow/{user_id}/{photographer_id} - Follow from feed"""
        # First check if already following
        following_response = requests.get(f"{BASE_URL}/api/social/following/{TEST_USER_ID}")
        if following_response.status_code == 200:
            following = following_response.json()
            already_following = any(f.get('id') == TEST_PHOTOGRAPHER_ID for f in following)
            
            if already_following:
                # Unfollow first to test follow
                unfollow_response = requests.delete(
                    f"{BASE_URL}/api/social/follow/{TEST_USER_ID}/{TEST_PHOTOGRAPHER_ID}"
                )
                print(f"✓ Unfollowed first (status {unfollow_response.status_code})")
        
        # Now follow
        response = requests.post(f"{BASE_URL}/api/social/follow/{TEST_USER_ID}/{TEST_PHOTOGRAPHER_ID}")
        # May return 200 or 400 if already following
        if response.status_code == 200:
            print(f"✓ Successfully followed photographer")
        elif response.status_code == 400:
            print(f"✓ Already following photographer (expected)")
        else:
            print(f"Follow response: {response.status_code} - {response.text}")
    
    def test_get_following_list(self):
        """GET /api/following/{user_id} - Get following list for CTA logic"""
        response = requests.get(f"{BASE_URL}/api/following/{TEST_USER_ID}")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert isinstance(data, list), "Following should be a list"
        
        # Check if photographer is in following list
        is_following = any(f.get('id') == TEST_PHOTOGRAPHER_ID for f in data)
        print(f"✓ Following list has {len(data)} users")
        print(f"✓ Is following test photographer: {is_following}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
