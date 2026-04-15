"""
Test Suite for New Features - Iteration 241
Tests for:
1. Watermark Settings CRUD (GET/PUT /api/photographer/{id}/watermark-settings)
2. Watermark Preview Generation (POST /api/gallery/generate-watermark-preview)
3. Selection Queue Endpoints (GET/POST /api/surfer-gallery/selection-queue/*)
4. AI Match Trigger (POST /api/gallery/trigger-ai-match)
"""
import pytest
import requests
import os
import json

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://raw-surf-os.preview.emergentagent.com')

# Test credentials from iteration_240.json
TEST_PHOTOGRAPHER_ID = "12dc6786-124f-40b1-8698-a9409f99736f"  # dpritzker0905@gmail.com
TEST_SURFER_ID = "a8d52460-cdea-4977-b718-c8722c5c262d"  # seanstanhope@gmail.com


class TestWatermarkSettings:
    """Test watermark settings CRUD endpoints"""
    
    def test_get_watermark_settings(self):
        """GET /api/photographer/{id}/watermark-settings - Returns watermark settings"""
        response = requests.get(f"{BASE_URL}/api/photographer/{TEST_PHOTOGRAPHER_ID}/watermark-settings")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        # Verify response structure
        assert "watermark_style" in data
        assert "watermark_text" in data
        assert "watermark_opacity" in data
        assert "watermark_position" in data
        
        # Verify default values are reasonable
        # Note: watermark_style may be 'center' for legacy data or 'text'/'logo'/'both' for new data
        assert data["watermark_style"] in ['text', 'logo', 'both', 'center', 'pattern']
        assert 0.1 <= data["watermark_opacity"] <= 1.0
        assert data["watermark_position"] in ['center', 'bottom-right', 'bottom-left', 'top-right', 'top-left', 'tiled']
        
        print(f"✓ GET watermark settings returned: {data}")
    
    def test_get_watermark_settings_not_found(self):
        """GET /api/photographer/{id}/watermark-settings - Returns 404 for non-existent photographer"""
        response = requests.get(f"{BASE_URL}/api/photographer/non-existent-id/watermark-settings")
        
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        print("✓ GET watermark settings returns 404 for non-existent photographer")
    
    def test_update_watermark_settings(self):
        """PUT /api/photographer/{id}/watermark-settings - Updates watermark settings"""
        # First get current settings
        get_response = requests.get(f"{BASE_URL}/api/photographer/{TEST_PHOTOGRAPHER_ID}/watermark-settings")
        original_settings = get_response.json()
        
        # Update settings
        new_settings = {
            "watermark_style": "text",
            "watermark_text": "TEST_WATERMARK_241",
            "watermark_logo_url": None,
            "watermark_opacity": 0.6,
            "watermark_position": "center"
        }
        
        response = requests.put(
            f"{BASE_URL}/api/photographer/{TEST_PHOTOGRAPHER_ID}/watermark-settings",
            json=new_settings
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data.get("success") == True
        assert "settings" in data
        assert data["settings"]["watermark_text"] == "TEST_WATERMARK_241"
        assert data["settings"]["watermark_opacity"] == 0.6
        assert data["settings"]["watermark_position"] == "center"
        
        print(f"✓ PUT watermark settings updated successfully: {data['settings']}")
        
        # Verify with GET
        verify_response = requests.get(f"{BASE_URL}/api/photographer/{TEST_PHOTOGRAPHER_ID}/watermark-settings")
        verify_data = verify_response.json()
        assert verify_data["watermark_text"] == "TEST_WATERMARK_241"
        
        print("✓ GET verified watermark settings were persisted")
        
        # Restore original settings
        restore_settings = {
            "watermark_style": original_settings.get("watermark_style", "text"),
            "watermark_text": original_settings.get("watermark_text"),
            "watermark_logo_url": original_settings.get("watermark_logo_url"),
            "watermark_opacity": original_settings.get("watermark_opacity", 0.5),
            "watermark_position": original_settings.get("watermark_position", "bottom-right")
        }
        requests.put(f"{BASE_URL}/api/photographer/{TEST_PHOTOGRAPHER_ID}/watermark-settings", json=restore_settings)
    
    def test_update_watermark_settings_invalid_style(self):
        """PUT /api/photographer/{id}/watermark-settings - Rejects invalid style"""
        invalid_settings = {
            "watermark_style": "invalid_style",
            "watermark_opacity": 0.5,
            "watermark_position": "center"
        }
        
        response = requests.put(
            f"{BASE_URL}/api/photographer/{TEST_PHOTOGRAPHER_ID}/watermark-settings",
            json=invalid_settings
        )
        
        assert response.status_code == 400, f"Expected 400, got {response.status_code}"
        print("✓ PUT watermark settings rejects invalid style")
    
    def test_update_watermark_settings_invalid_position(self):
        """PUT /api/photographer/{id}/watermark-settings - Rejects invalid position"""
        invalid_settings = {
            "watermark_style": "text",
            "watermark_opacity": 0.5,
            "watermark_position": "invalid_position"
        }
        
        response = requests.put(
            f"{BASE_URL}/api/photographer/{TEST_PHOTOGRAPHER_ID}/watermark-settings",
            json=invalid_settings
        )
        
        assert response.status_code == 400, f"Expected 400, got {response.status_code}"
        print("✓ PUT watermark settings rejects invalid position")
    
    def test_update_watermark_settings_invalid_opacity(self):
        """PUT /api/photographer/{id}/watermark-settings - Rejects invalid opacity"""
        invalid_settings = {
            "watermark_style": "text",
            "watermark_opacity": 1.5,  # > 1.0
            "watermark_position": "center"
        }
        
        response = requests.put(
            f"{BASE_URL}/api/photographer/{TEST_PHOTOGRAPHER_ID}/watermark-settings",
            json=invalid_settings
        )
        
        assert response.status_code == 400, f"Expected 400, got {response.status_code}"
        print("✓ PUT watermark settings rejects invalid opacity")


class TestWatermarkPreview:
    """Test watermark preview generation endpoint"""
    
    def test_generate_watermark_preview(self):
        """POST /api/gallery/generate-watermark-preview - Generates preview"""
        sample_image = "https://images.unsplash.com/photo-1502680390469-be75c86b636f?w=800"
        
        request_data = {
            "photographer_id": TEST_PHOTOGRAPHER_ID,
            "sample_image_url": sample_image,
            "watermark_style": "text",
            "watermark_text": "Test Watermark",
            "watermark_logo_url": None,
            "watermark_opacity": 0.5,
            "watermark_position": "bottom-right"
        }
        
        response = requests.post(
            f"{BASE_URL}/api/gallery/generate-watermark-preview",
            json=request_data
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data.get("success") == True
        assert "preview_url" in data
        # Preview URL should be a base64 data URL
        assert data["preview_url"].startswith("data:image/jpeg;base64,")
        
        print(f"✓ POST generate-watermark-preview returned base64 image (length: {len(data['preview_url'])})")
    
    def test_generate_watermark_preview_with_logo_style(self):
        """POST /api/gallery/generate-watermark-preview - Works with logo style"""
        sample_image = "https://images.unsplash.com/photo-1502680390469-be75c86b636f?w=800"
        
        request_data = {
            "photographer_id": TEST_PHOTOGRAPHER_ID,
            "sample_image_url": sample_image,
            "watermark_style": "logo",
            "watermark_text": "Test",
            "watermark_logo_url": None,  # No logo, should fall back to text
            "watermark_opacity": 0.7,
            "watermark_position": "center"
        }
        
        response = requests.post(
            f"{BASE_URL}/api/gallery/generate-watermark-preview",
            json=request_data
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data.get("success") == True
        print("✓ POST generate-watermark-preview works with logo style")


class TestSelectionQueue:
    """Test selection queue endpoints for included photos"""
    
    def test_get_selection_queue(self):
        """GET /api/surfer-gallery/selection-queue/{surfer_id} - Returns pending quotas"""
        response = requests.get(f"{BASE_URL}/api/surfer-gallery/selection-queue/{TEST_SURFER_ID}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "quotas" in data
        assert "pending_count" in data
        assert isinstance(data["quotas"], list)
        assert isinstance(data["pending_count"], int)
        
        print(f"✓ GET selection-queue returned {data['pending_count']} pending quotas")
        
        # If there are quotas, verify structure
        if data["quotas"]:
            quota = data["quotas"][0]
            assert "id" in quota
            assert "session_type" in quota
            assert "photos_allowed" in quota
            assert "photos_selected" in quota
            assert "status" in quota
            print(f"  - First quota: {quota['photos_allowed']} photos allowed, {quota['photos_selected']} selected")
    
    def test_get_selection_queue_empty_for_nonexistent_user(self):
        """GET /api/surfer-gallery/selection-queue/{surfer_id} - Returns empty for non-existent user"""
        response = requests.get(f"{BASE_URL}/api/surfer-gallery/selection-queue/non-existent-user-id")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert data["pending_count"] == 0
        assert data["quotas"] == []
        
        print("✓ GET selection-queue returns empty for non-existent user")
    
    def test_get_selection_quota_items_not_found(self):
        """GET /api/surfer-gallery/selection-queue/{quota_id}/items - Returns 404 for non-existent quota"""
        response = requests.get(f"{BASE_URL}/api/surfer-gallery/selection-queue/non-existent-quota-id/items")
        
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        print("✓ GET selection-queue items returns 404 for non-existent quota")
    
    def test_select_photos_not_found(self):
        """POST /api/surfer-gallery/selection-queue/{quota_id}/select - Returns 404 for non-existent quota"""
        response = requests.post(
            f"{BASE_URL}/api/surfer-gallery/selection-queue/non-existent-quota-id/select",
            json={"item_ids": ["item1", "item2"]}
        )
        
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        print("✓ POST selection-queue select returns 404 for non-existent quota")


class TestAIMatchTrigger:
    """Test AI lineup match trigger endpoint"""
    
    def test_trigger_ai_match_no_session(self):
        """POST /api/gallery/trigger-ai-match - Returns 400 when no session provided"""
        response = requests.post(
            f"{BASE_URL}/api/gallery/trigger-ai-match",
            params={"photographer_id": TEST_PHOTOGRAPHER_ID},
            json={}
        )
        
        assert response.status_code == 400, f"Expected 400, got {response.status_code}: {response.text}"
        print("✓ POST trigger-ai-match returns 400 when no session provided")
    
    def test_trigger_ai_match_unauthorized_gallery(self):
        """POST /api/gallery/trigger-ai-match - Returns 403 for unauthorized gallery"""
        response = requests.post(
            f"{BASE_URL}/api/gallery/trigger-ai-match",
            params={"photographer_id": TEST_PHOTOGRAPHER_ID},
            json={"gallery_id": "non-existent-gallery-id"}
        )
        
        assert response.status_code == 403, f"Expected 403, got {response.status_code}: {response.text}"
        print("✓ POST trigger-ai-match returns 403 for unauthorized gallery")
    
    def test_trigger_ai_match_unauthorized_booking(self):
        """POST /api/gallery/trigger-ai-match - Returns 403 for unauthorized booking"""
        response = requests.post(
            f"{BASE_URL}/api/gallery/trigger-ai-match",
            params={"photographer_id": TEST_PHOTOGRAPHER_ID},
            json={"booking_id": "non-existent-booking-id"}
        )
        
        assert response.status_code == 403, f"Expected 403, got {response.status_code}: {response.text}"
        print("✓ POST trigger-ai-match returns 403 for unauthorized booking")


class TestSurferGalleryEndpoints:
    """Test surfer gallery endpoints from previous iteration (regression)"""
    
    def test_get_surfer_gallery(self):
        """GET /api/surfer-gallery/my-gallery/{surfer_id} - Returns gallery items"""
        response = requests.get(f"{BASE_URL}/api/surfer-gallery/my-gallery/{TEST_SURFER_ID}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "items" in data
        assert "total_count" in data
        assert "pro_tier_count" in data
        assert "standard_tier_count" in data
        
        print(f"✓ GET surfer gallery returned {data['total_count']} items ({data['pro_tier_count']} PRO, {data['standard_tier_count']} STANDARD)")
    
    def test_get_claim_queue(self):
        """GET /api/surfer-gallery/claim-queue/{surfer_id} - Returns claim queue"""
        response = requests.get(f"{BASE_URL}/api/surfer-gallery/claim-queue/{TEST_SURFER_ID}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "items" in data
        assert "pending_count" in data
        
        print(f"✓ GET claim queue returned {data['pending_count']} pending items")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
