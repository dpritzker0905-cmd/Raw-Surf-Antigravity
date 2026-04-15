"""
Test file for Gallery DELETE endpoints and Map FAB button features
Tests:
1. DELETE /api/galleries/{gallery_id} - Delete entire gallery
2. DELETE /api/galleries/{gallery_id}/items/{item_id} - Delete item from gallery
3. GET /api/live-photographers - Returns photographers for map
4. Filter endpoints verification
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestGalleryDeletionAPIs:
    """Test gallery deletion endpoints for photographer gallery management"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test data - find or create a photographer"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        
        # Get existing photographer from profiles
        response = self.session.get(f"{BASE_URL}/api/photographers/featured?limit=1")
        if response.status_code == 200 and response.json():
            self.photographer_id = response.json()[0].get('id')
        else:
            # Fallback: use test photographer ID
            self.photographer_id = "3f88be92-5a86-4482-afc1-b32716357f6f"
    
    def test_get_photographer_galleries(self):
        """Test getting photographer's galleries list"""
        response = self.session.get(f"{BASE_URL}/api/galleries/photographer/{self.photographer_id}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert isinstance(data, list), "Expected list of galleries"
        print(f"Found {len(data)} galleries for photographer")
        
        # Store gallery ID if any exist
        if data:
            self.gallery_id = data[0].get('id')
            print(f"First gallery ID: {self.gallery_id}")
    
    def test_delete_gallery_unauthorized(self):
        """Test that gallery deletion requires correct photographer_id"""
        # Try to delete with wrong photographer ID
        response = self.session.delete(
            f"{BASE_URL}/api/galleries/nonexistent-gallery-id?photographer_id=wrong-id"
        )
        
        # Should return 404 or 403
        assert response.status_code in [404, 403], f"Expected 404 or 403, got {response.status_code}"
        print(f"Delete gallery unauthorized test: {response.status_code}")
    
    def test_delete_gallery_item_unauthorized(self):
        """Test that gallery item deletion requires correct photographer_id"""
        response = self.session.delete(
            f"{BASE_URL}/api/galleries/fake-gallery-id/items/fake-item-id?photographer_id=wrong-id"
        )
        
        # Should return 404 or 403
        assert response.status_code in [404, 403], f"Expected 404 or 403, got {response.status_code}"
        print(f"Delete gallery item unauthorized test: {response.status_code}")
    
    def test_gallery_delete_endpoint_exists(self):
        """Verify DELETE /api/galleries/{gallery_id} endpoint exists"""
        # Use a non-existent gallery ID to test the endpoint exists but returns 404
        response = self.session.delete(
            f"{BASE_URL}/api/galleries/00000000-0000-0000-0000-000000000000?photographer_id={self.photographer_id}"
        )
        
        # Should return 404 for not found, not 405 (method not allowed)
        assert response.status_code != 405, "DELETE endpoint not implemented"
        assert response.status_code == 404, f"Expected 404 for non-existent gallery, got {response.status_code}"
        print("Gallery delete endpoint exists and returns 404 for non-existent gallery")
    
    def test_gallery_item_delete_endpoint_exists(self):
        """Verify DELETE /api/galleries/{gallery_id}/items/{item_id} endpoint exists"""
        response = self.session.delete(
            f"{BASE_URL}/api/galleries/00000000-0000-0000-0000-000000000000/items/00000000-0000-0000-0000-000000000001?photographer_id={self.photographer_id}"
        )
        
        # Should return 404, not 405 (method not allowed)
        assert response.status_code != 405, "DELETE endpoint for items not implemented"
        assert response.status_code == 404, f"Expected 404 for non-existent item, got {response.status_code}"
        print("Gallery item delete endpoint exists and returns 404 for non-existent item")


class TestLivePhotographersAPI:
    """Test live photographers API for map page"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
    
    def test_get_live_photographers(self):
        """Test GET /api/live-photographers returns list"""
        response = self.session.get(f"{BASE_URL}/api/live-photographers")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert isinstance(data, list), "Expected list of photographers"
        print(f"Found {len(data)} live photographers")
        
        # If there are photographers, check structure
        if data:
            photographer = data[0]
            # Check expected fields (some may be null)
            expected_fields = ['id', 'full_name']
            for field in expected_fields:
                assert field in photographer, f"Missing field: {field}"
            print(f"First photographer: {photographer.get('full_name')}")


class TestSurfSpotAPIs:
    """Test surf spot endpoints for map filters"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
    
    def test_get_surf_spots(self):
        """Test GET /api/surf-spots returns spots list"""
        response = self.session.get(f"{BASE_URL}/api/surf-spots")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert isinstance(data, list), "Expected list of surf spots"
        assert len(data) > 0, "Expected at least one surf spot"
        print(f"Found {len(data)} surf spots")
        
        # Check spot structure
        spot = data[0]
        required_fields = ['id', 'name', 'latitude', 'longitude']
        for field in required_fields:
            assert field in spot, f"Missing field: {field}"
        
        # Check active_photographers_count field exists
        assert 'active_photographers_count' in spot, "Missing active_photographers_count field"
        print(f"First spot: {spot.get('name')} with {spot.get('active_photographers_count')} active photographers")


class TestFeaturedPhotographersAPI:
    """Test featured photographers API"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
    
    def test_get_featured_photographers(self):
        """Test GET /api/photographers/featured"""
        response = self.session.get(f"{BASE_URL}/api/photographers/featured?limit=10")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert isinstance(data, list), "Expected list of photographers"
        print(f"Found {len(data)} featured photographers")


class TestSettingsPageAPIs:
    """Test APIs used by Settings page for photographer tools"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        # Use known test photographer
        self.photographer_id = "3f88be92-5a86-4482-afc1-b32716357f6f"
    
    def test_get_photographer_profile(self):
        """Test profile endpoint returns role information"""
        response = self.session.get(f"{BASE_URL}/api/profile/{self.photographer_id}")
        
        # Profile endpoint should return 200 or 404
        if response.status_code == 200:
            data = response.json()
            assert 'role' in data, "Profile should include role"
            print(f"User role: {data.get('role')}")
        else:
            print(f"Profile not found: {response.status_code}")
            # Not a failure - just means test user doesn't exist


class TestGalleryItemsAPI:
    """Test gallery items API for GalleryPage"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        self.photographer_id = "3f88be92-5a86-4482-afc1-b32716357f6f"
    
    def test_get_gallery_items_endpoint(self):
        """Test GET /api/galleries/{gallery_id}/items endpoint"""
        # First get galleries
        response = self.session.get(f"{BASE_URL}/api/galleries/photographer/{self.photographer_id}")
        
        if response.status_code == 200 and response.json():
            gallery_id = response.json()[0].get('id')
            # Get items for this gallery
            items_response = self.session.get(f"{BASE_URL}/api/galleries/{gallery_id}/items?viewer_id={self.photographer_id}")
            
            assert items_response.status_code == 200, f"Expected 200, got {items_response.status_code}"
            items = items_response.json()
            assert isinstance(items, list), "Expected list of items"
            print(f"Gallery {gallery_id} has {len(items)} items")
        else:
            print("No galleries found for test photographer")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
