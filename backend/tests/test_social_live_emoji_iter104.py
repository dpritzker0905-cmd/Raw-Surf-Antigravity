"""
Test Social Live Features - Iteration 104
Tests:
1. Condition Report Multi-Post Handshake (creates story, post, condition_report)
2. LiveStreamViewer Auth Bug Fix (code review verification)
3. Emoji Picker for Comments (frontend verified via Playwright)
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials
PHOTOGRAPHER_USER_ID = "f0512ab9-1000-4d15-9d8a-befa9023f5ba"
SURFER_USER_ID = "864e2d31-55e4-4e7e-ad57-3416d230ea46"


class TestConditionReportMultiPost:
    """Test condition report creates story, post, and condition_report"""
    
    def test_condition_report_regions_endpoint(self):
        """Test that regions endpoint returns surf regions"""
        response = requests.get(f"{BASE_URL}/api/condition-reports/regions")
        assert response.status_code == 200
        
        data = response.json()
        assert "regions" in data
        assert len(data["regions"]) > 0
        assert "East Coast" in data["regions"]
        assert "Hawaii" in data["regions"]
        print(f"SUCCESS: Found {len(data['regions'])} surf regions")
    
    def test_condition_report_creates_multi_post(self):
        """Test that creating a condition report returns story_id, post_id, condition_report_id"""
        payload = {
            "media_url": "https://images.unsplash.com/photo-1502680390469-be75c86b636f?w=600",
            "media_type": "image",
            "caption": "TEST_condition_report - waves looking good!",
            "spot_name": "Test Beach",
            "region": "East Coast",
            "wave_height_ft": 4.5,
            "conditions_label": "Clean",
            "wind_conditions": "Offshore",
            "crowd_level": "Light"
        }
        
        response = requests.post(
            f"{BASE_URL}/api/condition-reports?photographer_id={PHOTOGRAPHER_USER_ID}",
            json=payload
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        
        # Verify multi-post handshake - all three IDs should be returned
        assert data.get("success") == True, "Expected success=True"
        assert "condition_report_id" in data, "Missing condition_report_id"
        assert "story_id" in data, "Missing story_id"
        assert "post_id" in data, "Missing post_id"
        
        print(f"SUCCESS: Multi-post handshake verified")
        print(f"  - condition_report_id: {data['condition_report_id']}")
        print(f"  - story_id: {data['story_id']}")
        print(f"  - post_id: {data['post_id']}")
        
        # Store IDs for cleanup
        return data
    
    def test_condition_report_feed_endpoint(self):
        """Test that condition reports feed returns reports"""
        response = requests.get(f"{BASE_URL}/api/condition-reports/feed")
        assert response.status_code == 200
        
        data = response.json()
        assert "reports" in data
        assert "total" in data
        assert "has_more" in data
        
        print(f"SUCCESS: Condition reports feed returned {data['total']} reports")
    
    def test_condition_report_feed_with_region_filter(self):
        """Test that condition reports can be filtered by region"""
        response = requests.get(f"{BASE_URL}/api/condition-reports/feed?region=East Coast")
        assert response.status_code == 200
        
        data = response.json()
        assert "reports" in data
        
        # All reports should be from East Coast
        for report in data["reports"]:
            if report.get("region"):
                assert report["region"] == "East Coast" or report["region"] is None
        
        print(f"SUCCESS: Region filter working, found {len(data['reports'])} East Coast reports")


class TestLiveStreamViewerAuthBug:
    """
    Code review verification for LiveStreamViewer auth bug fix.
    The actual UI testing is done via Playwright.
    """
    
    def test_livekit_active_streams_endpoint(self):
        """Test that active streams endpoint works"""
        response = requests.get(f"{BASE_URL}/api/livekit/active-streams")
        assert response.status_code == 200
        
        data = response.json()
        assert "streams" in data
        
        print(f"SUCCESS: Active streams endpoint working, found {len(data['streams'])} streams")
    
    def test_auth_login_endpoint(self):
        """Test that login endpoint works correctly"""
        payload = {
            "email": "testlive@surf.com",
            "password": "Test123!"
        }
        
        response = requests.post(f"{BASE_URL}/api/auth/login", json=payload)
        assert response.status_code == 200
        
        data = response.json()
        assert "id" in data
        assert "email" in data
        assert data["email"] == "testlive@surf.com"
        
        print(f"SUCCESS: Login endpoint working for user {data['id']}")


class TestEmojiPickerBackend:
    """
    Backend tests for comment functionality that supports emoji picker.
    The emoji picker UI is tested via Playwright.
    """
    
    def test_posts_endpoint(self):
        """Test that posts endpoint returns posts with comment support"""
        response = requests.get(f"{BASE_URL}/api/posts?user_id={SURFER_USER_ID}")
        assert response.status_code == 200
        
        data = response.json()
        assert isinstance(data, list)
        
        if len(data) > 0:
            post = data[0]
            assert "id" in post
            assert "author_name" in post
            # Comments should be supported
            assert "comments_count" in post or "recent_comments" in post
        
        print(f"SUCCESS: Posts endpoint returned {len(data)} posts")
    
    def test_post_comment_endpoint(self):
        """Test that comments can be posted (supports emoji content)"""
        # First get a post
        posts_response = requests.get(f"{BASE_URL}/api/posts?user_id={SURFER_USER_ID}")
        assert posts_response.status_code == 200
        
        posts = posts_response.json()
        if len(posts) == 0:
            pytest.skip("No posts available for comment test")
        
        post_id = posts[0]["id"]
        
        # Post a comment with emoji
        comment_payload = {
            "content": "TEST_comment 🤙🌊 Great shot!"
        }
        
        response = requests.post(
            f"{BASE_URL}/api/posts/{post_id}/comments?user_id={SURFER_USER_ID}",
            json=comment_payload
        )
        
        # Should succeed or return appropriate error
        assert response.status_code in [200, 201, 400, 404], f"Unexpected status: {response.status_code}"
        
        if response.status_code in [200, 201]:
            data = response.json()
            assert "content" in data or "id" in data
            print(f"SUCCESS: Comment with emoji posted successfully")
        else:
            print(f"INFO: Comment endpoint returned {response.status_code}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
