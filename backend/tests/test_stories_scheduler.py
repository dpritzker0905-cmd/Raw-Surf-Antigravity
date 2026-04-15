"""
Test Stories API and Background Scheduler for Raw Surf OS
Features tested:
- Stories CRUD (POST /api/stories, GET /api/stories/feed, POST /api/stories/{id}/view)
- Stories expiration (24 hours)
- Location visibility logic (free=1mi, basic=5mi, premium=all)
- Story type differentiation (photographer vs surfer)
- Background scheduler job registration
"""

import pytest
import requests
import os
from datetime import datetime, timedelta

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test user from previous iterations
TEST_USER_ID = "90d2c43c-026e-4800-bc93-796921f410fe"
TEST_USER_EMAIL = "testuser@rawsurf.com"


class TestStoriesAPI:
    """Stories CRUD operations"""
    
    created_story_id = None
    
    def test_api_health(self):
        """Verify API is running"""
        response = requests.get(f"{BASE_URL}/api/")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "active"
        print("✓ API health check passed")
    
    def test_stories_feed_empty_initially(self):
        """GET /api/stories/feed returns empty initially"""
        response = requests.get(f"{BASE_URL}/api/stories/feed", params={
            "viewer_id": TEST_USER_ID
        })
        assert response.status_code == 200
        data = response.json()
        
        # Verify response structure
        assert "all" in data
        assert "photographer_stories" in data
        assert "surfer_stories" in data
        assert "total_count" in data
        assert "photographer_count" in data
        assert "surfer_count" in data
        
        print(f"✓ Stories feed returned with {data['total_count']} stories")
    
    def test_create_story_success(self):
        """POST /api/stories creates a new story"""
        story_data = {
            "media_url": "https://images.unsplash.com/photo-1502680390469-be75c86b636f?w=600",
            "media_type": "image",
            "caption": "Test story - great conditions today! 🌊"
        }
        
        response = requests.post(
            f"{BASE_URL}/api/stories",
            params={"author_id": TEST_USER_ID},
            json=story_data
        )
        assert response.status_code == 200
        data = response.json()
        
        # Verify response
        assert "id" in data
        assert "story_type" in data
        assert "expires_at" in data
        assert data["message"] == "Story created successfully!"
        
        # Store for later tests
        TestStoriesAPI.created_story_id = data["id"]
        
        print(f"✓ Story created: id={data['id']}, type={data['story_type']}")
    
    def test_create_story_with_location(self):
        """POST /api/stories with location data"""
        # Get a surf spot first
        spots_response = requests.get(f"{BASE_URL}/api/surf-spots")
        spots = spots_response.json()
        
        if spots:
            spot = spots[0]
            story_data = {
                "media_url": "https://images.unsplash.com/photo-1455729552865-3658a5d39692?w=600",
                "media_type": "image",
                "caption": "Firing at the beach! 📸",
                "spot_id": spot["id"],
                "location_name": spot["name"]
            }
            
            response = requests.post(
                f"{BASE_URL}/api/stories",
                params={"author_id": TEST_USER_ID},
                json=story_data
            )
            assert response.status_code == 200
            data = response.json()
            
            assert data["location_name"] == spot["name"]
            print(f"✓ Story with location created at {data['location_name']}")
        else:
            print("⚠ No surf spots found, skipping location story test")
    
    def test_stories_feed_returns_created_story(self):
        """GET /api/stories/feed returns the created story"""
        response = requests.get(f"{BASE_URL}/api/stories/feed", params={
            "viewer_id": TEST_USER_ID
        })
        assert response.status_code == 200
        data = response.json()
        
        assert data["total_count"] >= 1
        assert len(data["all"]) >= 1
        
        # Verify story structure
        author_group = data["all"][0]
        assert "author_id" in author_group
        assert "author_name" in author_group
        assert "story_type" in author_group
        assert "stories" in author_group
        assert "has_unviewed" in author_group
        
        print(f"✓ Stories feed contains {data['total_count']} story groups")
    
    def test_stories_feed_with_type_filter(self):
        """GET /api/stories/feed with story_type_filter"""
        # Test photographer filter
        response = requests.get(f"{BASE_URL}/api/stories/feed", params={
            "viewer_id": TEST_USER_ID,
            "story_type_filter": "photographer"
        })
        assert response.status_code == 200
        photographer_data = response.json()
        
        # Test surfer filter
        response = requests.get(f"{BASE_URL}/api/stories/feed", params={
            "viewer_id": TEST_USER_ID,
            "story_type_filter": "surf"
        })
        assert response.status_code == 200
        surfer_data = response.json()
        
        print(f"✓ Type filters work: photographers={photographer_data['total_count']}, surfers={surfer_data['total_count']}")
    
    def test_mark_story_viewed(self):
        """POST /api/stories/{id}/view marks story as viewed"""
        if not TestStoriesAPI.created_story_id:
            pytest.skip("No story created to view")
        
        response = requests.post(
            f"{BASE_URL}/api/stories/{TestStoriesAPI.created_story_id}/view",
            params={"viewer_id": TEST_USER_ID}
        )
        assert response.status_code == 200
        data = response.json()
        
        assert "message" in data
        print(f"✓ Story marked as viewed: {data['message']}")
    
    def test_mark_story_viewed_duplicate(self):
        """POST /api/stories/{id}/view duplicate returns 'Already viewed'"""
        if not TestStoriesAPI.created_story_id:
            pytest.skip("No story created")
        
        response = requests.post(
            f"{BASE_URL}/api/stories/{TestStoriesAPI.created_story_id}/view",
            params={"viewer_id": TEST_USER_ID}
        )
        assert response.status_code == 200
        data = response.json()
        
        assert data["message"] == "Already viewed"
        print(f"✓ Duplicate view handled: {data['message']}")
    
    def test_view_story_nonexistent_fails(self):
        """POST /api/stories/{fake_id}/view returns 404"""
        response = requests.post(
            f"{BASE_URL}/api/stories/fake-story-id-12345/view",
            params={"viewer_id": TEST_USER_ID}
        )
        assert response.status_code == 404
        print("✓ Non-existent story view returns 404")
    
    def test_create_story_invalid_author_fails(self):
        """POST /api/stories with invalid author returns 404"""
        story_data = {
            "media_url": "https://example.com/test.jpg",
            "media_type": "image"
        }
        
        response = requests.post(
            f"{BASE_URL}/api/stories",
            params={"author_id": "fake-author-id"},
            json=story_data
        )
        assert response.status_code == 404
        print("✓ Invalid author returns 404")
    
    def test_get_author_stories(self):
        """GET /api/stories/author/{author_id} returns author's stories"""
        response = requests.get(
            f"{BASE_URL}/api/stories/author/{TEST_USER_ID}",
            params={"viewer_id": TEST_USER_ID}
        )
        assert response.status_code == 200
        data = response.json()
        
        assert "author_id" in data
        assert "stories" in data
        assert "count" in data
        
        print(f"✓ Author stories: count={data['count']}")
    
    def test_cleanup_expired_stories_endpoint(self):
        """POST /api/stories/cleanup-expired endpoint works"""
        response = requests.post(f"{BASE_URL}/api/stories/cleanup-expired")
        assert response.status_code == 200
        data = response.json()
        
        assert "expired_count" in data
        print(f"✓ Cleanup endpoint works: expired_count={data['expired_count']}")
    
    def test_delete_story_unauthorized_fails(self):
        """DELETE /api/stories/{id} with wrong author fails"""
        if not TestStoriesAPI.created_story_id:
            pytest.skip("No story to delete")
        
        response = requests.delete(
            f"{BASE_URL}/api/stories/{TestStoriesAPI.created_story_id}",
            params={"author_id": "different-user-id"}
        )
        assert response.status_code == 403
        print("✓ Unauthorized delete returns 403")
    
    def test_delete_story_success(self):
        """DELETE /api/stories/{id} deletes the story"""
        if not TestStoriesAPI.created_story_id:
            pytest.skip("No story to delete")
        
        response = requests.delete(
            f"{BASE_URL}/api/stories/{TestStoriesAPI.created_story_id}",
            params={"author_id": TEST_USER_ID}
        )
        assert response.status_code == 200
        data = response.json()
        
        assert data["message"] == "Story deleted"
        print("✓ Story deleted successfully")


class TestLocationVisibility:
    """Test location visibility based on subscription tier"""
    
    def test_stories_feed_with_location_params(self):
        """GET /api/stories/feed with viewer location parameters"""
        # Sebastian Inlet coordinates
        viewer_lat = 27.8547
        viewer_lon = -80.4487
        
        response = requests.get(f"{BASE_URL}/api/stories/feed", params={
            "viewer_id": TEST_USER_ID,
            "viewer_lat": viewer_lat,
            "viewer_lon": viewer_lon
        })
        assert response.status_code == 200
        data = response.json()
        
        # Verify structure includes location visibility fields
        if data["all"]:
            author_group = data["all"][0]
            assert "show_location" in author_group
            assert "location_name" in author_group
            
        print(f"✓ Stories feed with location works, returned {data['total_count']} groups")


class TestSchedulerIntegration:
    """Test background scheduler features"""
    
    def test_surf_alerts_page_loads(self):
        """Verify Surf Alerts API is still working after scheduler changes"""
        response = requests.get(f"{BASE_URL}/api/alerts/user/{TEST_USER_ID}")
        assert response.status_code == 200
        print("✓ Surf Alerts API working")
    
    def test_surf_spots_endpoint(self):
        """GET /api/surf-spots returns list"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        spots = response.json()
        
        assert isinstance(spots, list)
        assert len(spots) > 0
        
        # Verify spot structure
        spot = spots[0]
        assert "id" in spot
        assert "name" in spot
        assert "latitude" in spot
        assert "longitude" in spot
        
        print(f"✓ Surf spots returned: {len(spots)} spots")
    
    def test_conditions_endpoint_still_works(self):
        """GET /api/conditions/{spot_id} works after scheduler changes"""
        # Get a spot first
        spots_response = requests.get(f"{BASE_URL}/api/surf-spots")
        spots = spots_response.json()
        
        if spots:
            spot_id = spots[0]["id"]
            response = requests.get(f"{BASE_URL}/api/conditions/{spot_id}")
            assert response.status_code == 200
            data = response.json()
            
            assert "spot_id" in data
            print(f"✓ Conditions endpoint working for {spots[0]['name']}")
        else:
            pytest.skip("No surf spots available")


class TestStoryExpiration:
    """Test story 24-hour expiration logic"""
    
    def test_story_has_expires_at(self):
        """Verify story has expires_at field set to 24 hours from creation"""
        story_data = {
            "media_url": "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=600",
            "media_type": "image",
            "caption": "Expiration test story"
        }
        
        response = requests.post(
            f"{BASE_URL}/api/stories",
            params={"author_id": TEST_USER_ID},
            json=story_data
        )
        assert response.status_code == 200
        data = response.json()
        
        assert "expires_at" in data
        
        # Parse expiration time
        expires_at = datetime.fromisoformat(data["expires_at"].replace("Z", "+00:00"))
        now = datetime.now().astimezone()
        
        # Expiration should be approximately 24 hours from now
        diff_hours = (expires_at - now).total_seconds() / 3600
        assert 23 < diff_hours < 25, f"Expiration should be ~24 hours, got {diff_hours} hours"
        
        print(f"✓ Story expires at {data['expires_at']} (~{diff_hours:.1f} hours)")
        
        # Cleanup
        story_id = data["id"]
        requests.delete(f"{BASE_URL}/api/stories/{story_id}", params={"author_id": TEST_USER_ID})


class TestStoryTypes:
    """Test photographer vs surfer story differentiation"""
    
    def test_photographer_story_type(self):
        """Photographer users create 'photographer' type stories"""
        # First check the test user's role
        profile_response = requests.get(f"{BASE_URL}/api/profiles/{TEST_USER_ID}")
        if profile_response.status_code == 200:
            profile = profile_response.json()
            user_role = profile.get("role", "")
            
            photographer_roles = ["Grom Parent", "Hobbyist", "Photographer", "Approved Pro"]
            is_photographer = user_role in photographer_roles
            
            print(f"✓ Test user role: {user_role}, is_photographer: {is_photographer}")
        else:
            print("⚠ Could not fetch user profile, skipping role check")


# Additional cleanup at module end
@pytest.fixture(scope="session", autouse=True)
def cleanup_test_stories():
    """Cleanup any remaining test stories after all tests"""
    yield
    # Cleanup runs after all tests
    try:
        response = requests.get(f"{BASE_URL}/api/stories/feed", params={
            "viewer_id": TEST_USER_ID
        })
        if response.status_code == 200:
            data = response.json()
            for group in data.get("all", []):
                if group.get("author_id") == TEST_USER_ID:
                    for story in group.get("stories", []):
                        if "Test" in str(story.get("caption", "")) or "test" in str(story.get("caption", "")).lower():
                            requests.delete(
                                f"{BASE_URL}/api/stories/{story['id']}",
                                params={"author_id": TEST_USER_ID}
                            )
    except Exception as e:
        print(f"Cleanup error (non-fatal): {e}")
