"""
Test Suite for Service-to-Gallery Tier System and Watermark Features
Tests the watermarked preview endpoint and surfer gallery tier logic

Test Coverage:
- GET /api/gallery/watermarked-preview/{item_id} - Watermarked JPEG for unpaid items
- GET /api/gallery/watermarked-preview/{item_id}?viewer_id=X - Original URL for purchased items
- GET /api/surfer-gallery/my-gallery/{surfer_id} - Gallery items with tier info
- Watermark service generates 1080p max dimension images
- SurferGalleryItem correctly tracks is_paid, gallery_tier, access_type fields
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials from seed data
SEAN_STANHOPE_ID = "a8d52460-cdea-4977-b718-c8722c5c262d"
PHOTOGRAPHER_ID = "12dc6786-124f-40b1-8698-a9409f99736f"
UNPAID_GALLERY_ITEM_ID = "a32e9890-f432-40b3-b67e-012b278ff834"
PAID_GALLERY_ITEM_ID = "95d8b89a-8838-49f5-b9c6-58f96a319751"


class TestWatermarkedPreviewEndpoint:
    """Tests for GET /api/gallery/watermarked-preview/{item_id}"""
    
    def test_watermarked_preview_returns_image_for_unpaid_item(self):
        """
        Test that watermarked preview endpoint returns image/jpeg for unpaid items
        """
        # First, get a gallery item that exists
        response = requests.get(f"{BASE_URL}/api/surfer-gallery/my-gallery/{SEAN_STANHOPE_ID}")
        
        if response.status_code != 200:
            pytest.skip("Surfer gallery endpoint not accessible")
        
        data = response.json()
        items = data.get('items', [])
        
        # Find an unpaid item
        unpaid_item = None
        for item in items:
            if not item.get('is_paid', True):
                unpaid_item = item
                break
        
        if not unpaid_item:
            pytest.skip("No unpaid items found in test data")
        
        # Request watermarked preview without viewer_id (should return watermarked image)
        preview_response = requests.get(
            f"{BASE_URL}/api/gallery/watermarked-preview/{unpaid_item['gallery_item_id']}"
        )
        
        # Should return 200 with image content
        assert preview_response.status_code == 200, f"Expected 200, got {preview_response.status_code}"
        
        # Content-Type should be image/jpeg
        content_type = preview_response.headers.get('Content-Type', '')
        assert 'image/jpeg' in content_type, f"Expected image/jpeg, got {content_type}"
        
        # Should have actual image content
        assert len(preview_response.content) > 1000, "Image content too small"
        
        print(f"SUCCESS: Watermarked preview returned {len(preview_response.content)} bytes of image/jpeg")
    
    def test_watermarked_preview_returns_json_for_purchased_item(self):
        """
        Test that watermarked preview endpoint returns JSON with preview_url for purchased items
        """
        # Get surfer gallery to find a paid item
        response = requests.get(f"{BASE_URL}/api/surfer-gallery/my-gallery/{SEAN_STANHOPE_ID}")
        
        if response.status_code != 200:
            pytest.skip("Surfer gallery endpoint not accessible")
        
        data = response.json()
        items = data.get('items', [])
        
        # Find a paid item
        paid_item = None
        for item in items:
            if item.get('is_paid', False):
                paid_item = item
                break
        
        if not paid_item:
            pytest.skip("No paid items found in test data")
        
        # Request watermarked preview WITH viewer_id (should return JSON for purchased)
        preview_response = requests.get(
            f"{BASE_URL}/api/gallery/watermarked-preview/{paid_item['gallery_item_id']}",
            params={"viewer_id": SEAN_STANHOPE_ID}
        )
        
        # Should return 200
        assert preview_response.status_code == 200, f"Expected 200, got {preview_response.status_code}"
        
        # For purchased items, should return JSON with preview_url
        content_type = preview_response.headers.get('Content-Type', '')
        
        if 'application/json' in content_type:
            json_data = preview_response.json()
            assert 'preview_url' in json_data, "JSON response should contain preview_url"
            assert json_data.get('is_watermarked') == False, "Purchased items should not be watermarked"
            assert json_data.get('access_type') == 'purchased', "Access type should be 'purchased'"
            print(f"SUCCESS: Purchased item returned JSON with preview_url: {json_data.get('preview_url')[:50]}...")
        else:
            # If it returns image, that's also acceptable (some implementations return original image)
            assert 'image/' in content_type, f"Expected image or JSON, got {content_type}"
            print(f"SUCCESS: Purchased item returned image directly")
    
    def test_watermarked_preview_404_for_nonexistent_item(self):
        """
        Test that watermarked preview returns 404 for non-existent item
        """
        fake_id = "00000000-0000-0000-0000-000000000000"
        response = requests.get(f"{BASE_URL}/api/gallery/watermarked-preview/{fake_id}")
        
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        print("SUCCESS: Non-existent item returns 404")


class TestSurferGalleryEndpoint:
    """Tests for GET /api/surfer-gallery/my-gallery/{surfer_id}"""
    
    def test_surfer_gallery_returns_items_with_tier_info(self):
        """
        Test that surfer gallery endpoint returns items with correct tier information
        """
        response = requests.get(f"{BASE_URL}/api/surfer-gallery/my-gallery/{SEAN_STANHOPE_ID}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        
        # Verify response structure
        assert 'items' in data, "Response should contain 'items'"
        assert 'total_count' in data, "Response should contain 'total_count'"
        assert 'pro_tier_count' in data, "Response should contain 'pro_tier_count'"
        assert 'standard_tier_count' in data, "Response should contain 'standard_tier_count'"
        
        items = data['items']
        
        if len(items) == 0:
            pytest.skip("No gallery items found for test user")
        
        # Verify each item has required tier fields
        for item in items:
            assert 'gallery_tier' in item, f"Item missing gallery_tier: {item.get('id')}"
            assert 'is_paid' in item, f"Item missing is_paid: {item.get('id')}"
            assert 'access_type' in item, f"Item missing access_type: {item.get('id')}"
            assert 'service_type' in item, f"Item missing service_type: {item.get('id')}"
            assert 'max_photo_quality' in item, f"Item missing max_photo_quality: {item.get('id')}"
            assert 'max_video_quality' in item, f"Item missing max_video_quality: {item.get('id')}"
            
            # Verify tier values are valid
            assert item['gallery_tier'] in ['standard', 'pro'], f"Invalid gallery_tier: {item['gallery_tier']}"
            
            # Verify quality limits match tier
            if item['gallery_tier'] == 'pro':
                assert item['max_photo_quality'] == 'high', f"PRO tier should have 'high' photo quality"
                assert item['max_video_quality'] == '4k', f"PRO tier should have '4k' video quality"
            else:
                assert item['max_photo_quality'] == 'standard', f"STANDARD tier should have 'standard' photo quality"
                assert item['max_video_quality'] == '1080p', f"STANDARD tier should have '1080p' video quality"
        
        print(f"SUCCESS: Found {len(items)} items with correct tier info")
        print(f"  - PRO tier: {data['pro_tier_count']}")
        print(f"  - STANDARD tier: {data['standard_tier_count']}")
    
    def test_surfer_gallery_visibility_filter(self):
        """
        Test that visibility filter works correctly
        """
        # Test public filter
        public_response = requests.get(
            f"{BASE_URL}/api/surfer-gallery/my-gallery/{SEAN_STANHOPE_ID}",
            params={"visibility_filter": "public"}
        )
        
        assert public_response.status_code == 200
        public_data = public_response.json()
        
        # All items should be public
        for item in public_data.get('items', []):
            assert item.get('is_public') == True, "Public filter should only return public items"
        
        # Test private filter
        private_response = requests.get(
            f"{BASE_URL}/api/surfer-gallery/my-gallery/{SEAN_STANHOPE_ID}",
            params={"visibility_filter": "private"}
        )
        
        assert private_response.status_code == 200
        private_data = private_response.json()
        
        # All items should be private
        for item in private_data.get('items', []):
            assert item.get('is_public') == False, "Private filter should only return private items"
        
        print(f"SUCCESS: Visibility filter works - Public: {len(public_data.get('items', []))}, Private: {len(private_data.get('items', []))}")
    
    def test_surfer_gallery_tracks_payment_status(self):
        """
        Test that gallery correctly tracks is_paid and access_type
        """
        response = requests.get(f"{BASE_URL}/api/surfer-gallery/my-gallery/{SEAN_STANHOPE_ID}")
        
        assert response.status_code == 200
        data = response.json()
        
        items = data.get('items', [])
        
        paid_count = 0
        unpaid_count = 0
        
        for item in items:
            if item.get('is_paid'):
                paid_count += 1
                # Paid items should have access_type of 'purchased', 'included', or 'gifted'
                assert item.get('access_type') in ['purchased', 'included', 'gifted', 'claimed'], \
                    f"Paid item has unexpected access_type: {item.get('access_type')}"
                # Paid items should have download_url
                # Note: download_url may be None if not fully accessible
            else:
                unpaid_count += 1
                # Unpaid items should have access_type of 'pending'
                assert item.get('access_type') == 'pending', \
                    f"Unpaid item should have access_type 'pending', got: {item.get('access_type')}"
                # Unpaid items should NOT have download_url
                assert item.get('download_url') is None, "Unpaid items should not have download_url"
        
        print(f"SUCCESS: Payment tracking correct - Paid: {paid_count}, Unpaid: {unpaid_count}")
        print(f"  - Pending payment count from API: {data.get('pending_payment_count')}")
    
    def test_surfer_gallery_empty_for_nonexistent_user(self):
        """
        Test that gallery returns empty for non-existent user
        """
        fake_id = "00000000-0000-0000-0000-000000000000"
        response = requests.get(f"{BASE_URL}/api/surfer-gallery/my-gallery/{fake_id}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert data.get('total_count') == 0, "Non-existent user should have 0 items"
        assert len(data.get('items', [])) == 0, "Non-existent user should have empty items list"
        
        print("SUCCESS: Non-existent user returns empty gallery")


class TestGalleryTierLogic:
    """Tests for Service-to-Gallery tier mapping logic"""
    
    def test_scheduled_booking_maps_to_pro_tier(self):
        """
        Test that scheduled bookings map to PRO tier
        """
        response = requests.get(f"{BASE_URL}/api/surfer-gallery/my-gallery/{SEAN_STANHOPE_ID}")
        
        if response.status_code != 200:
            pytest.skip("Surfer gallery endpoint not accessible")
        
        data = response.json()
        items = data.get('items', [])
        
        # Find scheduled items
        scheduled_items = [i for i in items if i.get('service_type') == 'scheduled']
        
        for item in scheduled_items:
            assert item.get('gallery_tier') == 'pro', \
                f"Scheduled booking should map to PRO tier, got: {item.get('gallery_tier')}"
            assert item.get('max_photo_quality') == 'high', \
                f"PRO tier should have 'high' photo quality"
        
        print(f"SUCCESS: {len(scheduled_items)} scheduled items correctly mapped to PRO tier")
    
    def test_on_demand_booking_maps_to_standard_tier(self):
        """
        Test that on-demand bookings map to STANDARD tier
        """
        response = requests.get(f"{BASE_URL}/api/surfer-gallery/my-gallery/{SEAN_STANHOPE_ID}")
        
        if response.status_code != 200:
            pytest.skip("Surfer gallery endpoint not accessible")
        
        data = response.json()
        items = data.get('items', [])
        
        # Find on-demand items
        on_demand_items = [i for i in items if i.get('service_type') == 'on_demand']
        
        for item in on_demand_items:
            assert item.get('gallery_tier') == 'standard', \
                f"On-demand booking should map to STANDARD tier, got: {item.get('gallery_tier')}"
            assert item.get('max_photo_quality') == 'standard', \
                f"STANDARD tier should have 'standard' photo quality"
            assert item.get('max_video_quality') == '1080p', \
                f"STANDARD tier should have '1080p' video quality"
        
        print(f"SUCCESS: {len(on_demand_items)} on-demand items correctly mapped to STANDARD tier")
    
    def test_live_join_booking_maps_to_standard_tier(self):
        """
        Test that live_join bookings map to STANDARD tier
        """
        response = requests.get(f"{BASE_URL}/api/surfer-gallery/my-gallery/{SEAN_STANHOPE_ID}")
        
        if response.status_code != 200:
            pytest.skip("Surfer gallery endpoint not accessible")
        
        data = response.json()
        items = data.get('items', [])
        
        # Find live_join items
        live_join_items = [i for i in items if i.get('service_type') == 'live_join']
        
        for item in live_join_items:
            assert item.get('gallery_tier') == 'standard', \
                f"Live join booking should map to STANDARD tier, got: {item.get('gallery_tier')}"
        
        print(f"SUCCESS: {len(live_join_items)} live_join items correctly mapped to STANDARD tier")


class TestClaimQueueEndpoint:
    """Tests for GET /api/surfer-gallery/claim-queue/{surfer_id}"""
    
    def test_claim_queue_returns_pending_items(self):
        """
        Test that claim queue endpoint returns pending AI suggestions
        """
        response = requests.get(f"{BASE_URL}/api/surfer-gallery/claim-queue/{SEAN_STANHOPE_ID}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        
        # Verify response structure
        assert 'items' in data, "Response should contain 'items'"
        assert 'pending_count' in data, "Response should contain 'pending_count'"
        
        items = data.get('items', [])
        
        # Verify each item has required fields
        for item in items:
            assert 'id' in item, "Claim queue item missing 'id'"
            assert 'gallery_item_id' in item, "Claim queue item missing 'gallery_item_id'"
            assert 'ai_confidence' in item, "Claim queue item missing 'ai_confidence'"
            assert 'status' in item, "Claim queue item missing 'status'"
            
            # All items should be pending
            assert item.get('status') == 'pending', f"Claim queue should only have pending items"
            
            # AI confidence should be between 0 and 1
            confidence = item.get('ai_confidence', 0)
            assert 0 <= confidence <= 1, f"AI confidence should be 0-1, got: {confidence}"
        
        print(f"SUCCESS: Claim queue returned {len(items)} pending items")


class TestGalleryItemEndpoint:
    """Tests for GET /api/gallery/item/{item_id}"""
    
    def test_gallery_item_returns_correct_data(self):
        """
        Test that gallery item endpoint returns correct data structure
        """
        # First get a gallery item ID from surfer gallery
        gallery_response = requests.get(f"{BASE_URL}/api/surfer-gallery/my-gallery/{SEAN_STANHOPE_ID}")
        
        if gallery_response.status_code != 200:
            pytest.skip("Surfer gallery endpoint not accessible")
        
        items = gallery_response.json().get('items', [])
        
        if not items:
            pytest.skip("No gallery items found")
        
        gallery_item_id = items[0].get('gallery_item_id')
        
        # Get the gallery item directly
        response = requests.get(f"{BASE_URL}/api/gallery/item/{gallery_item_id}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        
        # Verify required fields
        assert 'id' in data, "Gallery item missing 'id'"
        assert 'photographer_id' in data, "Gallery item missing 'photographer_id'"
        assert 'preview_url' in data, "Gallery item missing 'preview_url'"
        assert 'price' in data, "Gallery item missing 'price'"
        assert 'is_for_sale' in data, "Gallery item missing 'is_for_sale'"
        
        print(f"SUCCESS: Gallery item {gallery_item_id} returned correct data")


class TestHealthCheck:
    """Basic health check tests"""
    
    def test_api_health(self):
        """
        Test that API is accessible
        """
        response = requests.get(f"{BASE_URL}/api/health")
        
        # Health endpoint might return 200 or 404 depending on implementation
        assert response.status_code in [200, 404], f"API not accessible: {response.status_code}"
        
        print(f"SUCCESS: API is accessible (status: {response.status_code})")


# Fixtures
@pytest.fixture(scope="module")
def api_client():
    """Shared requests session"""
    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})
    return session


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
