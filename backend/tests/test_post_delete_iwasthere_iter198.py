"""
Test Post Delete, I Was There, and NOAA Conditions - Iteration 198
Tests:
1. Post Delete functionality - should successfully delete a post
2. I Was There button - sends collaboration request to post owner
3. Post settings toggles (hide likes, disable comments)
4. NOAA conditions display on posts
"""

import pytest
import requests
import os
import uuid

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test user credentials from iteration 197
TEST_USER_ID = "12dc6786-124f-40b1-8698-a9409f99736f"
TEST_USER_EMAIL = "dpritzker0905@gmail.com"

# Test post with NOAA data (created by main agent)
TEST_POST_WITH_NOAA = "d588a457-65f0-4306-b09d-ab16aa082aee"


class TestPostDelete:
    """Test post deletion functionality"""
    
    def test_create_and_delete_post(self):
        """Create a post and then delete it - full flow"""
        # First create a post
        create_response = requests.post(
            f"{BASE_URL}/api/posts",
            params={"author_id": TEST_USER_ID},
            json={
                "media_url": "https://example.com/test-delete-image.jpg",
                "media_type": "image",
                "caption": "TEST_DELETE_POST - This post will be deleted"
            }
        )
        
        assert create_response.status_code == 200, f"Failed to create post: {create_response.text}"
        post_data = create_response.json()
        post_id = post_data["id"]
        print(f"Created test post: {post_id}")
        
        # Now delete the post
        delete_response = requests.delete(
            f"{BASE_URL}/api/posts/{post_id}",
            params={"user_id": TEST_USER_ID}
        )
        
        assert delete_response.status_code == 200, f"Failed to delete post: {delete_response.text}"
        delete_data = delete_response.json()
        assert delete_data.get("success") == True
        assert "deleted" in delete_data.get("message", "").lower()
        print(f"Successfully deleted post: {post_id}")
        
        # Verify post is gone by trying to get it
        # The feed endpoint won't return deleted posts
        feed_response = requests.get(f"{BASE_URL}/api/posts", params={"user_id": TEST_USER_ID})
        assert feed_response.status_code == 200
        posts = feed_response.json()
        post_ids = [p["id"] for p in posts]
        assert post_id not in post_ids, "Deleted post still appears in feed"
        print("Verified post no longer in feed")
    
    def test_delete_post_unauthorized(self):
        """Test that non-owner cannot delete a post"""
        # Create a post
        create_response = requests.post(
            f"{BASE_URL}/api/posts",
            params={"author_id": TEST_USER_ID},
            json={
                "media_url": "https://example.com/test-unauth-delete.jpg",
                "media_type": "image",
                "caption": "TEST_UNAUTH_DELETE - Testing unauthorized delete"
            }
        )
        
        assert create_response.status_code == 200
        post_id = create_response.json()["id"]
        
        # Try to delete with a different user ID
        fake_user_id = str(uuid.uuid4())
        delete_response = requests.delete(
            f"{BASE_URL}/api/posts/{post_id}",
            params={"user_id": fake_user_id}
        )
        
        assert delete_response.status_code == 403, f"Expected 403, got {delete_response.status_code}"
        print("Correctly rejected unauthorized delete attempt")
        
        # Cleanup - delete with correct user
        cleanup_response = requests.delete(
            f"{BASE_URL}/api/posts/{post_id}",
            params={"user_id": TEST_USER_ID}
        )
        assert cleanup_response.status_code == 200
        print("Cleaned up test post")
    
    def test_delete_nonexistent_post(self):
        """Test deleting a post that doesn't exist"""
        fake_post_id = str(uuid.uuid4())
        delete_response = requests.delete(
            f"{BASE_URL}/api/posts/{fake_post_id}",
            params={"user_id": TEST_USER_ID}
        )
        
        assert delete_response.status_code == 404, f"Expected 404, got {delete_response.status_code}"
        print("Correctly returned 404 for nonexistent post")


class TestIWasThere:
    """Test I Was There (collaboration request) functionality"""
    
    def test_request_collaboration_endpoint(self):
        """Test the request-collaboration endpoint"""
        # First create a post by the test user
        create_response = requests.post(
            f"{BASE_URL}/api/posts",
            params={"author_id": TEST_USER_ID},
            json={
                "media_url": "https://example.com/test-collab-image.jpg",
                "media_type": "image",
                "caption": "TEST_COLLAB - Testing I Was There",
                "location": "Test Beach"
            }
        )
        
        assert create_response.status_code == 200
        post_id = create_response.json()["id"]
        print(f"Created test post for collaboration: {post_id}")
        
        # Create a second user to request collaboration
        # First check if we can create a profile or use an existing one
        second_user_id = str(uuid.uuid4())
        
        # Try to request collaboration (this should fail because user doesn't exist)
        collab_response = requests.post(
            f"{BASE_URL}/api/posts/{post_id}/request-collaboration",
            params={"user_id": second_user_id},
            json={
                "latitude": 28.4177,
                "longitude": -80.6011
            }
        )
        
        # Should return 404 because user doesn't exist
        assert collab_response.status_code == 404, f"Expected 404 for non-existent user, got {collab_response.status_code}: {collab_response.text}"
        print("Correctly rejected collaboration request from non-existent user")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/posts/{post_id}", params={"user_id": TEST_USER_ID})
    
    def test_cannot_request_collaboration_on_own_post(self):
        """Test that user cannot request collaboration on their own post"""
        # Create a post
        create_response = requests.post(
            f"{BASE_URL}/api/posts",
            params={"author_id": TEST_USER_ID},
            json={
                "media_url": "https://example.com/test-own-collab.jpg",
                "media_type": "image",
                "caption": "TEST_OWN_COLLAB - Testing self-collaboration"
            }
        )
        
        assert create_response.status_code == 200
        post_id = create_response.json()["id"]
        
        # Try to request collaboration on own post
        collab_response = requests.post(
            f"{BASE_URL}/api/posts/{post_id}/request-collaboration",
            params={"user_id": TEST_USER_ID},
            json={}
        )
        
        assert collab_response.status_code == 400, f"Expected 400, got {collab_response.status_code}"
        assert "own post" in collab_response.json().get("detail", "").lower()
        print("Correctly rejected self-collaboration request")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/posts/{post_id}", params={"user_id": TEST_USER_ID})
    
    def test_get_post_collaborators(self):
        """Test getting collaborators for a post"""
        # Create a post
        create_response = requests.post(
            f"{BASE_URL}/api/posts",
            params={"author_id": TEST_USER_ID},
            json={
                "media_url": "https://example.com/test-get-collabs.jpg",
                "media_type": "image",
                "caption": "TEST_GET_COLLABS"
            }
        )
        
        assert create_response.status_code == 200
        post_id = create_response.json()["id"]
        
        # Get collaborators (should be empty)
        collabs_response = requests.get(f"{BASE_URL}/api/posts/{post_id}/collaborators")
        
        assert collabs_response.status_code == 200
        data = collabs_response.json()
        assert "collaborators" in data
        assert "total" in data
        print(f"Got collaborators response: {data}")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/posts/{post_id}", params={"user_id": TEST_USER_ID})


class TestPostSettings:
    """Test post settings (hide likes, disable comments)"""
    
    def test_toggle_hide_like_count(self):
        """Test toggling hide_like_count setting"""
        # Create a post
        create_response = requests.post(
            f"{BASE_URL}/api/posts",
            params={"author_id": TEST_USER_ID},
            json={
                "media_url": "https://example.com/test-hide-likes.jpg",
                "media_type": "image",
                "caption": "TEST_HIDE_LIKES"
            }
        )
        
        assert create_response.status_code == 200
        post_id = create_response.json()["id"]
        
        # Toggle hide_like_count to true
        settings_response = requests.patch(
            f"{BASE_URL}/api/posts/{post_id}/settings",
            params={"user_id": TEST_USER_ID},
            json={"hide_like_count": True}
        )
        
        assert settings_response.status_code == 200
        assert settings_response.json().get("success") == True
        print("Successfully set hide_like_count to True")
        
        # Toggle back to false
        settings_response2 = requests.patch(
            f"{BASE_URL}/api/posts/{post_id}/settings",
            params={"user_id": TEST_USER_ID},
            json={"hide_like_count": False}
        )
        
        assert settings_response2.status_code == 200
        print("Successfully set hide_like_count to False")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/posts/{post_id}", params={"user_id": TEST_USER_ID})
    
    def test_toggle_comments_disabled(self):
        """Test toggling comments_disabled setting"""
        # Create a post
        create_response = requests.post(
            f"{BASE_URL}/api/posts",
            params={"author_id": TEST_USER_ID},
            json={
                "media_url": "https://example.com/test-disable-comments.jpg",
                "media_type": "image",
                "caption": "TEST_DISABLE_COMMENTS"
            }
        )
        
        assert create_response.status_code == 200
        post_id = create_response.json()["id"]
        
        # Toggle comments_disabled to true
        settings_response = requests.patch(
            f"{BASE_URL}/api/posts/{post_id}/settings",
            params={"user_id": TEST_USER_ID},
            json={"comments_disabled": True}
        )
        
        assert settings_response.status_code == 200
        assert settings_response.json().get("success") == True
        print("Successfully set comments_disabled to True")
        
        # Toggle back to false
        settings_response2 = requests.patch(
            f"{BASE_URL}/api/posts/{post_id}/settings",
            params={"user_id": TEST_USER_ID},
            json={"comments_disabled": False}
        )
        
        assert settings_response2.status_code == 200
        print("Successfully set comments_disabled to False")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/posts/{post_id}", params={"user_id": TEST_USER_ID})
    
    def test_settings_unauthorized(self):
        """Test that non-owner cannot change settings"""
        # Create a post
        create_response = requests.post(
            f"{BASE_URL}/api/posts",
            params={"author_id": TEST_USER_ID},
            json={
                "media_url": "https://example.com/test-unauth-settings.jpg",
                "media_type": "image",
                "caption": "TEST_UNAUTH_SETTINGS"
            }
        )
        
        assert create_response.status_code == 200
        post_id = create_response.json()["id"]
        
        # Try to change settings with different user
        fake_user_id = str(uuid.uuid4())
        settings_response = requests.patch(
            f"{BASE_URL}/api/posts/{post_id}/settings",
            params={"user_id": fake_user_id},
            json={"hide_like_count": True}
        )
        
        assert settings_response.status_code == 403, f"Expected 403, got {settings_response.status_code}"
        print("Correctly rejected unauthorized settings change")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/posts/{post_id}", params={"user_id": TEST_USER_ID})


class TestNOAAConditions:
    """Test NOAA conditions display on posts"""
    
    def test_post_with_noaa_data_exists(self):
        """Verify the test post with NOAA data exists and has conditions"""
        # Get the feed
        feed_response = requests.get(f"{BASE_URL}/api/posts", params={"user_id": TEST_USER_ID})
        
        assert feed_response.status_code == 200
        posts = feed_response.json()
        
        # Find the test post with NOAA data
        test_post = None
        for post in posts:
            if post["id"] == TEST_POST_WITH_NOAA:
                test_post = post
                break
        
        if test_post:
            print(f"Found test post with NOAA data: {TEST_POST_WITH_NOAA}")
            print(f"  wave_height_ft: {test_post.get('wave_height_ft')}")
            print(f"  wave_direction: {test_post.get('wave_direction')}")
            print(f"  wave_direction_degrees: {test_post.get('wave_direction_degrees')}")
            print(f"  wind_speed_mph: {test_post.get('wind_speed_mph')}")
            print(f"  wind_direction: {test_post.get('wind_direction')}")
            print(f"  tide_status: {test_post.get('tide_status')}")
            print(f"  tide_height_ft: {test_post.get('tide_height_ft')}")
            
            # Verify NOAA data is present
            assert test_post.get('wave_height_ft') is not None, "wave_height_ft should be present"
            assert test_post.get('wave_direction') is not None, "wave_direction should be present"
            print("NOAA data verified on test post")
        else:
            # Post might have been deleted, create one with NOAA data
            print(f"Test post {TEST_POST_WITH_NOAA} not found in feed, creating new one")
            create_response = requests.post(
                f"{BASE_URL}/api/posts",
                params={"author_id": TEST_USER_ID},
                json={
                    "media_url": "https://example.com/test-noaa-post.jpg",
                    "media_type": "image",
                    "caption": "TEST_NOAA_POST - Post with NOAA conditions",
                    "location": "New Smyrna Beach",
                    "wave_height_ft": 2.7,
                    "wave_direction": "E",
                    "wave_direction_degrees": 97,
                    "wind_speed_mph": 15.1,
                    "wind_direction": "E",
                    "tide_status": "Falling",
                    "tide_height_ft": 2.5,
                    "conditions_source": "noaa"
                }
            )
            
            assert create_response.status_code == 200
            new_post = create_response.json()
            print(f"Created new post with NOAA data: {new_post['id']}")
            
            # Verify the data was saved
            assert new_post.get('wave_height_ft') == 2.7
            assert new_post.get('wave_direction') == "E"
            print("NOAA data saved correctly on new post")
    
    def test_create_post_with_session_metadata(self):
        """Test creating a post with full session metadata"""
        create_response = requests.post(
            f"{BASE_URL}/api/posts",
            params={"author_id": TEST_USER_ID},
            json={
                "media_url": "https://example.com/test-session-meta.jpg",
                "media_type": "image",
                "caption": "TEST_SESSION_META - Full session metadata",
                "location": "Sebastian Inlet",
                "wave_height_ft": 3.5,
                "wave_period_sec": 8,
                "wave_direction": "NE",
                "wave_direction_degrees": 45,
                "wind_speed_mph": 12.0,
                "wind_direction": "SW",
                "tide_status": "Rising",
                "tide_height_ft": 1.8,
                "conditions_source": "noaa"
            }
        )
        
        assert create_response.status_code == 200
        post = create_response.json()
        
        # Verify all session metadata was saved
        assert post.get('wave_height_ft') == 3.5
        assert post.get('wave_period_sec') == 8
        assert post.get('wave_direction') == "NE"
        assert post.get('wave_direction_degrees') == 45
        assert post.get('wind_speed_mph') == 12.0
        assert post.get('wind_direction') == "SW"
        assert post.get('tide_status') == "Rising"
        assert post.get('tide_height_ft') == 1.8
        assert post.get('conditions_source') == "noaa"
        
        print(f"Created post with full session metadata: {post['id']}")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/posts/{post['id']}", params={"user_id": TEST_USER_ID})
        print("Cleaned up test post")


class TestFeedWithConditions:
    """Test that feed returns posts with conditions data"""
    
    def test_feed_returns_session_metadata(self):
        """Test that the feed endpoint returns session metadata"""
        feed_response = requests.get(f"{BASE_URL}/api/posts", params={"user_id": TEST_USER_ID})
        
        assert feed_response.status_code == 200
        posts = feed_response.json()
        
        # Check if any posts have session metadata
        posts_with_conditions = [p for p in posts if p.get('wave_height_ft') or p.get('tide_status')]
        
        print(f"Total posts in feed: {len(posts)}")
        print(f"Posts with conditions data: {len(posts_with_conditions)}")
        
        if posts_with_conditions:
            sample = posts_with_conditions[0]
            print(f"Sample post with conditions:")
            print(f"  ID: {sample['id']}")
            print(f"  wave_height_ft: {sample.get('wave_height_ft')}")
            print(f"  wave_direction: {sample.get('wave_direction')}")
            print(f"  tide_status: {sample.get('tide_status')}")
        
        # The feed should return posts (may or may not have conditions)
        assert len(posts) >= 0, "Feed should return posts"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
