"""
Test Surfer Gallery API Endpoints - Iteration 246
Tests for My Gallery page features including:
- Main gallery endpoint with stats
- Claim queue endpoint
- Pending selections count
- Visibility toggle
- Favorite toggle
- Purchase history
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials
TEST_SURFER_EMAIL = "seanstanhope@gmail.com"
TEST_SURFER_PASSWORD = "Test123!"


class TestSurferGalleryEndpoints:
    """Test Surfer Gallery API endpoints"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test fixtures - login and get surfer ID"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        
        # Login as test surfer
        login_response = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": TEST_SURFER_EMAIL,
            "password": TEST_SURFER_PASSWORD
        })
        assert login_response.status_code == 200, f"Login failed: {login_response.text}"
        
        user_data = login_response.json()
        self.surfer_id = user_data.get("id")
        assert self.surfer_id, "Surfer ID not found in login response"
        
    def test_main_gallery_endpoint_returns_200(self):
        """Test GET /api/surfer-gallery returns 200 with items and stats"""
        response = self.session.get(f"{BASE_URL}/api/surfer-gallery?surfer_id={self.surfer_id}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "items" in data, "Response missing 'items' field"
        assert "stats" in data, "Response missing 'stats' field"
        
    def test_main_gallery_stats_structure(self):
        """Test that stats contain all required fields"""
        response = self.session.get(f"{BASE_URL}/api/surfer-gallery?surfer_id={self.surfer_id}")
        
        assert response.status_code == 200
        stats = response.json().get("stats", {})
        
        # Verify all stat fields exist
        assert "total" in stats, "Stats missing 'total' field"
        assert "favorites" in stats, "Stats missing 'favorites' field"
        assert "pro" in stats, "Stats missing 'pro' field"
        assert "public" in stats, "Stats missing 'public' field"
        assert "pendingPayment" in stats, "Stats missing 'pendingPayment' field"
        
        # Verify stats are integers
        assert isinstance(stats["total"], int), "total should be integer"
        assert isinstance(stats["favorites"], int), "favorites should be integer"
        assert isinstance(stats["pro"], int), "pro should be integer"
        assert isinstance(stats["public"], int), "public should be integer"
        assert isinstance(stats["pendingPayment"], int), "pendingPayment should be integer"
        
    def test_main_gallery_item_structure(self):
        """Test that gallery items have correct structure"""
        response = self.session.get(f"{BASE_URL}/api/surfer-gallery?surfer_id={self.surfer_id}")
        
        assert response.status_code == 200
        items = response.json().get("items", [])
        
        if len(items) > 0:
            item = items[0]
            # Required fields
            assert "id" in item, "Item missing 'id'"
            assert "gallery_item_id" in item, "Item missing 'gallery_item_id'"
            assert "url" in item or "thumbnail_url" in item, "Item missing image URL"
            assert "media_type" in item, "Item missing 'media_type'"
            assert "photographer_name" in item, "Item missing 'photographer_name'"
            assert "gallery_tier" in item, "Item missing 'gallery_tier'"
            assert "is_paid" in item, "Item missing 'is_paid'"
            assert "is_public" in item, "Item missing 'is_public'"
            
    def test_claim_queue_endpoint_returns_200(self):
        """Test GET /api/surfer-gallery/claim-queue returns 200"""
        response = self.session.get(f"{BASE_URL}/api/surfer-gallery/claim-queue?surfer_id={self.surfer_id}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "items" in data, "Response missing 'items' field"
        
    def test_claim_queue_item_structure(self):
        """Test claim queue items have correct structure"""
        response = self.session.get(f"{BASE_URL}/api/surfer-gallery/claim-queue?surfer_id={self.surfer_id}")
        
        assert response.status_code == 200
        items = response.json().get("items", [])
        
        if len(items) > 0:
            item = items[0]
            assert "id" in item, "Claim item missing 'id'"
            assert "gallery_item_id" in item, "Claim item missing 'gallery_item_id'"
            assert "confidence" in item, "Claim item missing 'confidence'"
            assert "photographer_name" in item, "Claim item missing 'photographer_name'"
            
    def test_pending_selections_endpoint_returns_200(self):
        """Test GET /api/surfer-gallery/pending-selections returns 200"""
        response = self.session.get(f"{BASE_URL}/api/surfer-gallery/pending-selections?surfer_id={self.surfer_id}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "count" in data, "Response missing 'count' field"
        assert isinstance(data["count"], int), "count should be integer"
        
    def test_purchase_history_endpoint_returns_200(self):
        """Test GET /api/surfer-gallery/purchase-history returns 200"""
        response = self.session.get(f"{BASE_URL}/api/surfer-gallery/purchase-history?surfer_id={self.surfer_id}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "purchases" in data, "Response missing 'purchases' field"
        
    def test_invalid_surfer_id_returns_404(self):
        """Test that invalid surfer ID returns 404"""
        response = self.session.get(f"{BASE_URL}/api/surfer-gallery?surfer_id=invalid-uuid-12345")
        
        assert response.status_code == 404, f"Expected 404 for invalid surfer, got {response.status_code}"
        
    def test_gallery_stats_match_item_counts(self):
        """Test that stats match actual item counts"""
        response = self.session.get(f"{BASE_URL}/api/surfer-gallery?surfer_id={self.surfer_id}")
        
        assert response.status_code == 200
        data = response.json()
        items = data.get("items", [])
        stats = data.get("stats", {})
        
        # Verify total matches
        assert stats["total"] == len(items), f"Stats total ({stats['total']}) doesn't match items count ({len(items)})"
        
        # Count pro tier items
        pro_count = sum(1 for i in items if i.get("gallery_tier") == "pro")
        assert stats["pro"] == pro_count, f"Stats pro ({stats['pro']}) doesn't match actual ({pro_count})"
        
        # Count public items
        public_count = sum(1 for i in items if i.get("is_public"))
        assert stats["public"] == public_count, f"Stats public ({stats['public']}) doesn't match actual ({public_count})"


class TestVisibilityToggle:
    """Test visibility toggle functionality"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test fixtures"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        
        # Login as test surfer
        login_response = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": TEST_SURFER_EMAIL,
            "password": TEST_SURFER_PASSWORD
        })
        assert login_response.status_code == 200
        
        user_data = login_response.json()
        self.surfer_id = user_data.get("id")
        
    def test_visibility_toggle_endpoint_exists(self):
        """Test PUT /api/surfer-gallery/{item_id}/visibility endpoint exists"""
        # Get a gallery item first
        gallery_response = self.session.get(f"{BASE_URL}/api/surfer-gallery?surfer_id={self.surfer_id}")
        assert gallery_response.status_code == 200
        
        items = gallery_response.json().get("items", [])
        if len(items) > 0:
            item_id = items[0]["id"]
            current_visibility = items[0].get("is_public", False)
            
            # Toggle visibility
            response = self.session.put(
                f"{BASE_URL}/api/surfer-gallery/{item_id}/visibility",
                params={"surfer_id": self.surfer_id, "is_public": not current_visibility}
            )
            
            # Should return 200 or 422 (validation) - not 404
            assert response.status_code in [200, 422], f"Unexpected status: {response.status_code}"


class TestFavoriteToggle:
    """Test favorite toggle functionality"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test fixtures"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        
        # Login as test surfer
        login_response = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": TEST_SURFER_EMAIL,
            "password": TEST_SURFER_PASSWORD
        })
        assert login_response.status_code == 200
        
        user_data = login_response.json()
        self.surfer_id = user_data.get("id")
        
    def test_favorite_toggle_endpoint_exists(self):
        """Test PUT /api/surfer-gallery/{item_id}/favorite endpoint exists"""
        # Get a gallery item first
        gallery_response = self.session.get(f"{BASE_URL}/api/surfer-gallery?surfer_id={self.surfer_id}")
        assert gallery_response.status_code == 200
        
        items = gallery_response.json().get("items", [])
        if len(items) > 0:
            item_id = items[0]["id"]
            
            # Toggle favorite
            response = self.session.put(
                f"{BASE_URL}/api/surfer-gallery/{item_id}/favorite",
                params={"surfer_id": self.surfer_id, "is_favorite": True}
            )
            
            # Should return 200 or 422 (validation) - not 404
            assert response.status_code in [200, 422], f"Unexpected status: {response.status_code}"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
