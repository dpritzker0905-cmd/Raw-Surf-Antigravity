"""
Test Suite for Iteration 195 Features:
1. Surf Conditions API (Open-Meteo integration)
2. Post Menu APIs (settings, edit, delete, report)
3. User Favorites API
"""

import pytest
import requests
import os
import uuid

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials from review request
TEST_USER_EMAIL = "dpritzker0905@gmail.com"
TEST_USER_PASSWORD = "TestPassword123!"
TEST_USER_ID = "12dc6786-124f-40b1-8698-a9409f99736f"


class TestSurfConditionsAPI:
    """Test surf conditions auto-fetch from Open-Meteo"""
    
    def test_get_surf_conditions_by_spot_name(self):
        """Test GET /api/surf-conditions?spot_name=new_smyrna"""
        response = requests.get(f"{BASE_URL}/api/surf-conditions", params={
            "spot_name": "new_smyrna"
        })
        print(f"Surf conditions by spot_name response: {response.status_code}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        print(f"Surf conditions data: {data}")
        
        # Verify response structure
        assert "source" in data, "Response should have 'source' field"
        assert data.get("source") in ["open-meteo", "auto", "error"], f"Unexpected source: {data.get('source')}"
        
        # If successful, should have wave data
        if data.get("source") != "error":
            assert "spot_name" in data, "Should include spot_name"
            assert "coordinates" in data, "Should include coordinates"
            # Wave data may or may not be present depending on API response
            print(f"Wave height: {data.get('wave_height_ft')}")
            print(f"Wave period: {data.get('wave_period_sec')}")
            print(f"Wave direction: {data.get('wave_direction')}")
    
    def test_get_surf_conditions_by_coordinates(self):
        """Test GET /api/surf-conditions?latitude=X&longitude=Y"""
        # New Smyrna Beach coordinates
        response = requests.get(f"{BASE_URL}/api/surf-conditions", params={
            "latitude": 29.0258,
            "longitude": -80.9278
        })
        print(f"Surf conditions by coordinates response: {response.status_code}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        print(f"Surf conditions data: {data}")
        
        # Verify response structure
        assert "source" in data, "Response should have 'source' field"
        assert "fetched_at" in data, "Response should have 'fetched_at' timestamp"
    
    def test_get_surf_conditions_known_spots(self):
        """Test GET /api/surf-conditions/known-spots"""
        response = requests.get(f"{BASE_URL}/api/surf-conditions/known-spots")
        print(f"Known spots response: {response.status_code}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "spots" in data, "Response should have 'spots' array"
        
        spots = data["spots"]
        assert len(spots) > 0, "Should have at least one known spot"
        
        # Verify spot structure
        first_spot = spots[0]
        assert "key" in first_spot, "Spot should have 'key'"
        assert "name" in first_spot, "Spot should have 'name'"
        assert "lat" in first_spot, "Spot should have 'lat'"
        assert "lon" in first_spot, "Spot should have 'lon'"
        
        # Check for specific spots mentioned in requirements
        spot_keys = [s["key"] for s in spots]
        print(f"Found {len(spots)} known spots")
        print(f"Sample spots: {spot_keys[:5]}")
        
        # Verify some expected spots exist
        expected_spots = ["pipeline", "mavericks", "new_smyrna"]
        for expected in expected_spots:
            assert expected in spot_keys, f"Expected spot '{expected}' not found"
    
    def test_surf_conditions_missing_params(self):
        """Test GET /api/surf-conditions without required params"""
        response = requests.get(f"{BASE_URL}/api/surf-conditions")
        print(f"Missing params response: {response.status_code}")
        
        # Should return 400 or 422 for missing parameters
        assert response.status_code in [400, 422], f"Expected 400/422, got {response.status_code}"


class TestPostSettingsAPI:
    """Test post settings toggle APIs"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test data - create a test post"""
        self.test_post_id = None
        self.created_post = False
        
        # Try to create a test post
        try:
            response = requests.post(f"{BASE_URL}/api/posts", params={
                "author_id": TEST_USER_ID
            }, json={
                "caption": "TEST_iter195_post_settings",
                "media_url": "https://example.com/test.jpg",
                "media_type": "image"
            })
            if response.status_code in [200, 201]:
                data = response.json()
                self.test_post_id = data.get("id")
                self.created_post = True
                print(f"Created test post: {self.test_post_id}")
        except Exception as e:
            print(f"Could not create test post: {e}")
        
        yield
        
        # Cleanup
        if self.created_post and self.test_post_id:
            try:
                requests.delete(f"{BASE_URL}/api/posts/{self.test_post_id}", params={
                    "user_id": TEST_USER_ID
                })
            except:
                pass
    
    def test_toggle_hide_like_count(self):
        """Test PATCH /api/posts/{post_id}/settings - hide_like_count"""
        if not self.test_post_id:
            pytest.skip("No test post available")
        
        # Toggle hide_like_count ON
        response = requests.patch(
            f"{BASE_URL}/api/posts/{self.test_post_id}/settings",
            params={"user_id": TEST_USER_ID},
            json={"hide_like_count": True}
        )
        print(f"Hide like count ON response: {response.status_code}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data.get("success") == True, "Should return success"
        
        # Toggle hide_like_count OFF
        response = requests.patch(
            f"{BASE_URL}/api/posts/{self.test_post_id}/settings",
            params={"user_id": TEST_USER_ID},
            json={"hide_like_count": False}
        )
        assert response.status_code == 200
    
    def test_toggle_comments_disabled(self):
        """Test PATCH /api/posts/{post_id}/settings - comments_disabled"""
        if not self.test_post_id:
            pytest.skip("No test post available")
        
        # Toggle comments_disabled ON
        response = requests.patch(
            f"{BASE_URL}/api/posts/{self.test_post_id}/settings",
            params={"user_id": TEST_USER_ID},
            json={"comments_disabled": True}
        )
        print(f"Comments disabled ON response: {response.status_code}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        # Toggle comments_disabled OFF
        response = requests.patch(
            f"{BASE_URL}/api/posts/{self.test_post_id}/settings",
            params={"user_id": TEST_USER_ID},
            json={"comments_disabled": False}
        )
        assert response.status_code == 200
    
    def test_settings_unauthorized(self):
        """Test settings update by non-owner returns 403"""
        if not self.test_post_id:
            pytest.skip("No test post available")
        
        fake_user_id = str(uuid.uuid4())
        response = requests.patch(
            f"{BASE_URL}/api/posts/{self.test_post_id}/settings",
            params={"user_id": fake_user_id},
            json={"hide_like_count": True}
        )
        print(f"Unauthorized settings response: {response.status_code}")
        
        assert response.status_code == 403, f"Expected 403, got {response.status_code}"


class TestPostEditAPI:
    """Test post edit API"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test data - create a test post"""
        self.test_post_id = None
        self.created_post = False
        
        try:
            response = requests.post(f"{BASE_URL}/api/posts", params={
                "author_id": TEST_USER_ID
            }, json={
                "caption": "TEST_iter195_original_caption",
                "media_url": "https://example.com/test.jpg",
                "media_type": "image"
            })
            if response.status_code in [200, 201]:
                data = response.json()
                self.test_post_id = data.get("id")
                self.created_post = True
                print(f"Created test post for edit: {self.test_post_id}")
        except Exception as e:
            print(f"Could not create test post: {e}")
        
        yield
        
        if self.created_post and self.test_post_id:
            try:
                requests.delete(f"{BASE_URL}/api/posts/{self.test_post_id}", params={
                    "user_id": TEST_USER_ID
                })
            except:
                pass
    
    def test_edit_post_caption(self):
        """Test PATCH /api/posts/{post_id} - edit caption"""
        if not self.test_post_id:
            pytest.skip("No test post available")
        
        new_caption = "TEST_iter195_updated_caption"
        response = requests.patch(
            f"{BASE_URL}/api/posts/{self.test_post_id}",
            params={"user_id": TEST_USER_ID},
            json={"caption": new_caption}
        )
        print(f"Edit caption response: {response.status_code}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data.get("success") == True, "Should return success"
    
    def test_edit_post_unauthorized(self):
        """Test edit by non-owner returns 403"""
        if not self.test_post_id:
            pytest.skip("No test post available")
        
        fake_user_id = str(uuid.uuid4())
        response = requests.patch(
            f"{BASE_URL}/api/posts/{self.test_post_id}",
            params={"user_id": fake_user_id},
            json={"caption": "hacked"}
        )
        print(f"Unauthorized edit response: {response.status_code}")
        
        assert response.status_code == 403, f"Expected 403, got {response.status_code}"


class TestPostDeleteAPI:
    """Test post delete API"""
    
    def test_delete_post(self):
        """Test DELETE /api/posts/{post_id}"""
        # Create a post to delete
        create_response = requests.post(f"{BASE_URL}/api/posts", params={
            "author_id": TEST_USER_ID
        }, json={
            "caption": "TEST_iter195_to_delete",
            "media_url": "https://example.com/test.jpg",
            "media_type": "image"
        })
        
        if create_response.status_code not in [200, 201]:
            pytest.skip("Could not create test post")
        
        post_id = create_response.json().get("id")
        print(f"Created post to delete: {post_id}")
        
        # Delete the post
        response = requests.delete(
            f"{BASE_URL}/api/posts/{post_id}",
            params={"user_id": TEST_USER_ID}
        )
        print(f"Delete post response: {response.status_code}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data.get("success") == True, "Should return success"
        
        # Verify post is deleted - check via posts list
        # Note: GET /api/posts/{post_id} returns 405 (no single post endpoint)
        # So we verify by checking the posts list
        list_response = requests.get(f"{BASE_URL}/api/posts", params={"limit": 100})
        if list_response.status_code == 200:
            post_ids = [p.get("id") for p in list_response.json()]
            assert post_id not in post_ids, "Deleted post should not appear in posts list"
    
    def test_delete_post_unauthorized(self):
        """Test delete by non-owner returns 403"""
        # Create a post
        create_response = requests.post(f"{BASE_URL}/api/posts", params={
            "author_id": TEST_USER_ID
        }, json={
            "caption": "TEST_iter195_unauthorized_delete",
            "media_url": "https://example.com/test.jpg",
            "media_type": "image"
        })
        
        if create_response.status_code not in [200, 201]:
            pytest.skip("Could not create test post")
        
        post_id = create_response.json().get("id")
        
        try:
            fake_user_id = str(uuid.uuid4())
            response = requests.delete(
                f"{BASE_URL}/api/posts/{post_id}",
                params={"user_id": fake_user_id}
            )
            print(f"Unauthorized delete response: {response.status_code}")
            
            assert response.status_code == 403, f"Expected 403, got {response.status_code}"
        finally:
            # Cleanup
            requests.delete(f"{BASE_URL}/api/posts/{post_id}", params={"user_id": TEST_USER_ID})


class TestPostReportAPI:
    """Test post report API"""
    
    def test_report_post(self):
        """Test POST /api/posts/{post_id}/report"""
        # First, get an existing post to report
        posts_response = requests.get(f"{BASE_URL}/api/posts", params={"limit": 1})
        
        if posts_response.status_code != 200 or not posts_response.json():
            pytest.skip("No posts available to report")
        
        post_id = posts_response.json()[0].get("id")
        print(f"Reporting post: {post_id}")
        
        response = requests.post(
            f"{BASE_URL}/api/posts/{post_id}/report",
            json={
                "reporter_id": TEST_USER_ID,
                "reason": "Spam or scam",
                "description": "TEST_iter195_report - please ignore"
            }
        )
        print(f"Report post response: {response.status_code}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data.get("success") == True, "Should return success"
    
    def test_report_nonexistent_post(self):
        """Test reporting a non-existent post returns 404"""
        fake_post_id = str(uuid.uuid4())
        response = requests.post(
            f"{BASE_URL}/api/posts/{fake_post_id}/report",
            json={
                "reporter_id": TEST_USER_ID,
                "reason": "Spam"
            }
        )
        print(f"Report nonexistent post response: {response.status_code}")
        
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"


class TestUserFavoritesAPI:
    """Test user favorites API"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup - get a post to favorite"""
        self.test_post_id = None
        
        # Get an existing post
        posts_response = requests.get(f"{BASE_URL}/api/posts", params={"limit": 1})
        if posts_response.status_code == 200 and posts_response.json():
            self.test_post_id = posts_response.json()[0].get("id")
            print(f"Using post for favorites test: {self.test_post_id}")
        
        yield
        
        # Cleanup - remove from favorites if added
        if self.test_post_id:
            try:
                requests.delete(
                    f"{BASE_URL}/api/users/{TEST_USER_ID}/favorites/{self.test_post_id}"
                )
            except:
                pass
    
    def test_add_to_favorites(self):
        """Test POST /api/users/{user_id}/favorites"""
        if not self.test_post_id:
            pytest.skip("No post available for favorites test")
        
        # First remove if already favorited
        requests.delete(f"{BASE_URL}/api/users/{TEST_USER_ID}/favorites/{self.test_post_id}")
        
        response = requests.post(
            f"{BASE_URL}/api/users/{TEST_USER_ID}/favorites",
            json={"post_id": self.test_post_id}
        )
        print(f"Add to favorites response: {response.status_code}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data.get("success") == True, "Should return success"
    
    def test_add_duplicate_favorite(self):
        """Test adding same post to favorites twice returns 409"""
        if not self.test_post_id:
            pytest.skip("No post available for favorites test")
        
        # First remove if already favorited
        requests.delete(f"{BASE_URL}/api/users/{TEST_USER_ID}/favorites/{self.test_post_id}")
        
        # Add first time
        requests.post(
            f"{BASE_URL}/api/users/{TEST_USER_ID}/favorites",
            json={"post_id": self.test_post_id}
        )
        
        # Add second time - should return 409
        response = requests.post(
            f"{BASE_URL}/api/users/{TEST_USER_ID}/favorites",
            json={"post_id": self.test_post_id}
        )
        print(f"Duplicate favorite response: {response.status_code}")
        
        assert response.status_code == 409, f"Expected 409, got {response.status_code}"
    
    def test_remove_from_favorites(self):
        """Test DELETE /api/users/{user_id}/favorites/{post_id}"""
        if not self.test_post_id:
            pytest.skip("No post available for favorites test")
        
        # First add to favorites
        requests.post(
            f"{BASE_URL}/api/users/{TEST_USER_ID}/favorites",
            json={"post_id": self.test_post_id}
        )
        
        # Remove from favorites
        response = requests.delete(
            f"{BASE_URL}/api/users/{TEST_USER_ID}/favorites/{self.test_post_id}"
        )
        print(f"Remove from favorites response: {response.status_code}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
    
    def test_get_user_favorites(self):
        """Test GET /api/users/{user_id}/favorites"""
        response = requests.get(f"{BASE_URL}/api/users/{TEST_USER_ID}/favorites")
        print(f"Get favorites response: {response.status_code}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert isinstance(data, list), "Should return a list"
        
        if len(data) > 0:
            # Verify structure
            first = data[0]
            assert "id" in first, "Favorite should have 'id'"
            assert "post_id" in first, "Favorite should have 'post_id'"
            print(f"User has {len(data)} favorites")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
