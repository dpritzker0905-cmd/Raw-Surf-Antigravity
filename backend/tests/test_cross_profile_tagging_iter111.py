"""
Cross-Profile Tagging Tests (Iteration 111)
Tests for Parent -> Grom tagging feature:
- GET /api/gallery/linked-groms/{parent_id} - returns linked Groms
- GET /api/gallery/grom-highlights/{parent_id} - returns tagged photos
- POST /api/gallery/tag-grom - creates PhotoTag with access_granted=true
- DELETE /api/gallery/untag-grom/{gallery_item_id}/{grom_id} - removes PhotoTag
- GET /api/gallery/grom-profile-photos/{grom_id} - returns photos tagged with Grom
- Role checks: Only Grom Parents can use tagging endpoints
- Authorization: Parents can only tag their linked Grom (not other Groms)
"""

import pytest
import requests
import os
import uuid

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://raw-surf-os.preview.emergentagent.com')

# Test credentials from iteration 110
GROM_PARENT_EMAIL = "testgromparent@gmail.com"
GROM_PARENT_PASSWORD = "test123"
GROM_PARENT_ID = "e57e7be6-e217-47f7-9978-b51c469c7bbf"

LINKED_GROM_ID = "8bde602b-4d89-4142-a078-d2a048dd4c65"  # Junior Wave Rider
LINKED_GROM_NAME = "Junior Wave Rider"

# Non-Grom Parent user for negative tests
NON_GROM_PARENT_EMAIL = "testphotographer@gmail.com"
NON_GROM_PARENT_PASSWORD = "test123"


@pytest.fixture(scope="module")
def api_client():
    """Shared requests session"""
    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})
    return session


@pytest.fixture(scope="module")
def grom_parent_auth(api_client):
    """Authenticate as Grom Parent"""
    response = api_client.post(f"{BASE_URL}/api/auth/login", json={
        "email": GROM_PARENT_EMAIL,
        "password": GROM_PARENT_PASSWORD
    })
    if response.status_code == 200:
        data = response.json()
        return {
            "user_id": data.get("user", {}).get("id") or GROM_PARENT_ID,
            "token": data.get("token"),
            "user": data.get("user")
        }
    pytest.skip(f"Grom Parent authentication failed: {response.status_code}")


class TestLinkedGromsEndpoint:
    """Tests for GET /api/gallery/linked-groms/{parent_id}"""
    
    def test_get_linked_groms_success(self, api_client, grom_parent_auth):
        """Grom Parent can get their linked Groms"""
        parent_id = grom_parent_auth["user_id"]
        response = api_client.get(f"{BASE_URL}/api/gallery/linked-groms/{parent_id}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "groms" in data, "Response should contain 'groms' key"
        assert isinstance(data["groms"], list), "groms should be a list"
        
        # Verify linked Grom is in the list
        grom_ids = [g["id"] for g in data["groms"]]
        assert LINKED_GROM_ID in grom_ids, f"Linked Grom {LINKED_GROM_ID} should be in the list"
        
        # Verify Grom data structure
        for grom in data["groms"]:
            assert "id" in grom, "Grom should have 'id'"
            assert "name" in grom, "Grom should have 'name'"
            assert "is_approved" in grom, "Grom should have 'is_approved'"
        
        print(f"SUCCESS: Found {len(data['groms'])} linked Groms")
    
    def test_get_linked_groms_non_grom_parent_fails(self, api_client):
        """Non-Grom Parent cannot access linked-groms endpoint"""
        # Use a random ID that's not a Grom Parent
        fake_parent_id = str(uuid.uuid4())
        response = api_client.get(f"{BASE_URL}/api/gallery/linked-groms/{fake_parent_id}")
        
        # Should return 404 (not found) or 403 (forbidden)
        assert response.status_code in [403, 404], f"Expected 403/404, got {response.status_code}"
        print(f"SUCCESS: Non-Grom Parent blocked with {response.status_code}")


class TestGromHighlightsEndpoint:
    """Tests for GET /api/gallery/grom-highlights/{parent_id}"""
    
    def test_get_grom_highlights_success(self, api_client, grom_parent_auth):
        """Grom Parent can get Grom Highlights"""
        parent_id = grom_parent_auth["user_id"]
        response = api_client.get(f"{BASE_URL}/api/gallery/grom-highlights/{parent_id}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "items" in data, "Response should contain 'items' key"
        assert "total" in data, "Response should contain 'total' key"
        assert isinstance(data["items"], list), "items should be a list"
        
        print(f"SUCCESS: Got {len(data['items'])} Grom Highlights (total: {data['total']})")
    
    def test_get_grom_highlights_with_grom_filter(self, api_client, grom_parent_auth):
        """Grom Parent can filter highlights by specific Grom"""
        parent_id = grom_parent_auth["user_id"]
        response = api_client.get(
            f"{BASE_URL}/api/gallery/grom-highlights/{parent_id}?grom_id={LINKED_GROM_ID}"
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "items" in data, "Response should contain 'items' key"
        
        # All items should be for the specified Grom
        for item in data["items"]:
            assert item.get("grom_id") == LINKED_GROM_ID, f"Item should be for Grom {LINKED_GROM_ID}"
        
        print(f"SUCCESS: Filtered highlights for Grom {LINKED_GROM_ID}")
    
    def test_get_grom_highlights_non_grom_parent_fails(self, api_client):
        """Non-Grom Parent cannot access grom-highlights endpoint"""
        fake_parent_id = str(uuid.uuid4())
        response = api_client.get(f"{BASE_URL}/api/gallery/grom-highlights/{fake_parent_id}")
        
        assert response.status_code in [403, 404], f"Expected 403/404, got {response.status_code}"
        print(f"SUCCESS: Non-Grom Parent blocked with {response.status_code}")


class TestTagGromEndpoint:
    """Tests for POST /api/gallery/tag-grom"""
    
    @pytest.fixture
    def test_gallery_item(self, api_client, grom_parent_auth):
        """Create a test gallery item for tagging tests"""
        parent_id = grom_parent_auth["user_id"]
        
        # Create a gallery item
        response = api_client.post(
            f"{BASE_URL}/api/gallery?photographer_id={parent_id}",
            json={
                "original_url": "https://example.com/test-photo.jpg",
                "preview_url": "https://example.com/test-photo-preview.jpg",
                "media_type": "image",
                "title": f"TEST_TagGrom_{uuid.uuid4().hex[:8]}",
                "is_for_sale": False
            }
        )
        
        if response.status_code in [200, 201]:
            data = response.json()
            yield data.get("id")
            # Cleanup: delete the item
            api_client.delete(f"{BASE_URL}/api/gallery/item/{data.get('id')}?photographer_id={parent_id}")
        else:
            pytest.skip(f"Could not create test gallery item: {response.status_code}")
    
    def test_tag_grom_success(self, api_client, grom_parent_auth, test_gallery_item):
        """Grom Parent can tag their linked Grom in a photo"""
        parent_id = grom_parent_auth["user_id"]
        
        response = api_client.post(
            f"{BASE_URL}/api/gallery/tag-grom?parent_id={parent_id}",
            json={
                "gallery_item_id": test_gallery_item,
                "grom_id": LINKED_GROM_ID
            }
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "message" in data, "Response should contain 'message'"
        assert data.get("grom_id") == LINKED_GROM_ID, "Response should contain correct grom_id"
        
        print(f"SUCCESS: Tagged Grom {LINKED_GROM_ID} in photo {test_gallery_item}")
        
        # Cleanup: untag the Grom
        api_client.delete(
            f"{BASE_URL}/api/gallery/untag-grom/{test_gallery_item}/{LINKED_GROM_ID}?parent_id={parent_id}"
        )
    
    def test_tag_grom_duplicate_fails(self, api_client, grom_parent_auth, test_gallery_item):
        """Cannot tag the same Grom twice in the same photo"""
        parent_id = grom_parent_auth["user_id"]
        
        # First tag
        response1 = api_client.post(
            f"{BASE_URL}/api/gallery/tag-grom?parent_id={parent_id}",
            json={
                "gallery_item_id": test_gallery_item,
                "grom_id": LINKED_GROM_ID
            }
        )
        
        if response1.status_code != 200:
            pytest.skip(f"First tag failed: {response1.status_code}")
        
        # Second tag (should fail)
        response2 = api_client.post(
            f"{BASE_URL}/api/gallery/tag-grom?parent_id={parent_id}",
            json={
                "gallery_item_id": test_gallery_item,
                "grom_id": LINKED_GROM_ID
            }
        )
        
        assert response2.status_code == 400, f"Expected 400 for duplicate tag, got {response2.status_code}"
        assert "already tagged" in response2.text.lower(), "Error should mention already tagged"
        
        print("SUCCESS: Duplicate tag correctly rejected")
        
        # Cleanup
        api_client.delete(
            f"{BASE_URL}/api/gallery/untag-grom/{test_gallery_item}/{LINKED_GROM_ID}?parent_id={parent_id}"
        )
    
    def test_tag_unlinked_grom_fails(self, api_client, grom_parent_auth, test_gallery_item):
        """Cannot tag a Grom that is not linked to the parent"""
        parent_id = grom_parent_auth["user_id"]
        unlinked_grom_id = str(uuid.uuid4())  # Random ID
        
        response = api_client.post(
            f"{BASE_URL}/api/gallery/tag-grom?parent_id={parent_id}",
            json={
                "gallery_item_id": test_gallery_item,
                "grom_id": unlinked_grom_id
            }
        )
        
        # Should fail with 403 or 404
        assert response.status_code in [403, 404], f"Expected 403/404, got {response.status_code}"
        print(f"SUCCESS: Unlinked Grom tag blocked with {response.status_code}")
    
    def test_tag_grom_non_owner_photo_fails(self, api_client, grom_parent_auth):
        """Cannot tag Grom in a photo you don't own"""
        parent_id = grom_parent_auth["user_id"]
        fake_item_id = str(uuid.uuid4())
        
        response = api_client.post(
            f"{BASE_URL}/api/gallery/tag-grom?parent_id={parent_id}",
            json={
                "gallery_item_id": fake_item_id,
                "grom_id": LINKED_GROM_ID
            }
        )
        
        # Should fail with 403 or 404
        assert response.status_code in [403, 404], f"Expected 403/404, got {response.status_code}"
        print(f"SUCCESS: Non-owner tag blocked with {response.status_code}")


class TestUntagGromEndpoint:
    """Tests for DELETE /api/gallery/untag-grom/{gallery_item_id}/{grom_id}"""
    
    @pytest.fixture
    def tagged_gallery_item(self, api_client, grom_parent_auth):
        """Create a gallery item and tag a Grom"""
        parent_id = grom_parent_auth["user_id"]
        
        # Create gallery item
        create_response = api_client.post(
            f"{BASE_URL}/api/gallery?photographer_id={parent_id}",
            json={
                "original_url": "https://example.com/test-untag.jpg",
                "preview_url": "https://example.com/test-untag-preview.jpg",
                "media_type": "image",
                "title": f"TEST_UntagGrom_{uuid.uuid4().hex[:8]}",
                "is_for_sale": False
            }
        )
        
        if create_response.status_code not in [200, 201]:
            pytest.skip(f"Could not create gallery item: {create_response.status_code}")
        
        item_id = create_response.json().get("id")
        
        # Tag the Grom
        tag_response = api_client.post(
            f"{BASE_URL}/api/gallery/tag-grom?parent_id={parent_id}",
            json={
                "gallery_item_id": item_id,
                "grom_id": LINKED_GROM_ID
            }
        )
        
        if tag_response.status_code != 200:
            api_client.delete(f"{BASE_URL}/api/gallery/item/{item_id}?photographer_id={parent_id}")
            pytest.skip(f"Could not tag Grom: {tag_response.status_code}")
        
        yield item_id
        
        # Cleanup
        api_client.delete(f"{BASE_URL}/api/gallery/item/{item_id}?photographer_id={parent_id}")
    
    def test_untag_grom_success(self, api_client, grom_parent_auth, tagged_gallery_item):
        """Grom Parent can untag their Grom from a photo"""
        parent_id = grom_parent_auth["user_id"]
        
        response = api_client.delete(
            f"{BASE_URL}/api/gallery/untag-grom/{tagged_gallery_item}/{LINKED_GROM_ID}?parent_id={parent_id}"
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "message" in data, "Response should contain 'message'"
        
        print(f"SUCCESS: Untagged Grom {LINKED_GROM_ID} from photo {tagged_gallery_item}")
    
    def test_untag_non_owner_fails(self, api_client, tagged_gallery_item):
        """Cannot untag from a photo you don't own"""
        fake_parent_id = str(uuid.uuid4())
        
        response = api_client.delete(
            f"{BASE_URL}/api/gallery/untag-grom/{tagged_gallery_item}/{LINKED_GROM_ID}?parent_id={fake_parent_id}"
        )
        
        # Should fail with 403 or 404
        assert response.status_code in [403, 404], f"Expected 403/404, got {response.status_code}"
        print(f"SUCCESS: Non-owner untag blocked with {response.status_code}")


class TestGromProfilePhotosEndpoint:
    """Tests for GET /api/gallery/grom-profile-photos/{grom_id}"""
    
    def test_get_grom_profile_photos_as_parent(self, api_client, grom_parent_auth):
        """Parent can view their Grom's tagged photos"""
        parent_id = grom_parent_auth["user_id"]
        
        response = api_client.get(
            f"{BASE_URL}/api/gallery/grom-profile-photos/{LINKED_GROM_ID}?viewer_id={parent_id}"
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "items" in data, "Response should contain 'items' key"
        assert "grom_name" in data, "Response should contain 'grom_name' key"
        
        print(f"SUCCESS: Got {len(data['items'])} tagged photos for Grom {data['grom_name']}")
    
    def test_get_grom_profile_photos_unauthorized_fails(self, api_client):
        """Unauthorized user cannot view Grom's tagged photos"""
        unauthorized_viewer_id = str(uuid.uuid4())
        
        response = api_client.get(
            f"{BASE_URL}/api/gallery/grom-profile-photos/{LINKED_GROM_ID}?viewer_id={unauthorized_viewer_id}"
        )
        
        assert response.status_code == 403, f"Expected 403, got {response.status_code}"
        print("SUCCESS: Unauthorized viewer blocked")
    
    def test_get_grom_profile_photos_no_viewer_fails(self, api_client):
        """Request without viewer_id should fail"""
        response = api_client.get(
            f"{BASE_URL}/api/gallery/grom-profile-photos/{LINKED_GROM_ID}"
        )
        
        assert response.status_code == 403, f"Expected 403, got {response.status_code}"
        print("SUCCESS: Request without viewer_id blocked")


class TestRoleBasedAccess:
    """Tests for role-based access control"""
    
    def test_non_grom_parent_cannot_tag(self, api_client):
        """Non-Grom Parent role cannot use tag-grom endpoint"""
        # Login as non-Grom Parent (e.g., Photographer)
        login_response = api_client.post(f"{BASE_URL}/api/auth/login", json={
            "email": NON_GROM_PARENT_EMAIL,
            "password": NON_GROM_PARENT_PASSWORD
        })
        
        if login_response.status_code != 200:
            pytest.skip(f"Non-Grom Parent login failed: {login_response.status_code}")
        
        user_id = login_response.json().get("user", {}).get("id")
        
        # Try to tag a Grom
        response = api_client.post(
            f"{BASE_URL}/api/gallery/tag-grom?parent_id={user_id}",
            json={
                "gallery_item_id": str(uuid.uuid4()),
                "grom_id": LINKED_GROM_ID
            }
        )
        
        # Should fail with 403 (not a Grom Parent)
        assert response.status_code == 403, f"Expected 403, got {response.status_code}"
        assert "grom parent" in response.text.lower(), "Error should mention Grom Parent role"
        
        print("SUCCESS: Non-Grom Parent role blocked from tagging")
    
    def test_non_grom_parent_cannot_view_linked_groms(self, api_client):
        """Non-Grom Parent role cannot access linked-groms endpoint"""
        login_response = api_client.post(f"{BASE_URL}/api/auth/login", json={
            "email": NON_GROM_PARENT_EMAIL,
            "password": NON_GROM_PARENT_PASSWORD
        })
        
        if login_response.status_code != 200:
            pytest.skip(f"Non-Grom Parent login failed: {login_response.status_code}")
        
        user_id = login_response.json().get("user", {}).get("id")
        
        response = api_client.get(f"{BASE_URL}/api/gallery/linked-groms/{user_id}")
        
        assert response.status_code == 403, f"Expected 403, got {response.status_code}"
        print("SUCCESS: Non-Grom Parent blocked from linked-groms endpoint")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
