"""
Test file for iteration 25 - Tagged Photo Complete Workflow
Tests:
- POST /api/notifications/send - Thank you flow notification
- GET /api/profile/{id}/tagged - Tagged tab with NEW badges
- GET /api/ai/my-tagged-photos - Tagged photos with access info
- POST /api/ai/mark-photo-viewed - Clear NEW badge
- GET /api/gallery/{item_id}/pricing - Gallery tier pricing
- POST /api/gallery/item/{item_id}/purchase - Purchase flow
"""
import pytest
import requests
import os
import json
from datetime import datetime

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test users from previous iterations
PHOTOGRAPHER_ID = "04503c29-dc37-4f8c-a462-4177c4a54096"  # Sarah Waters (Photographer)
SURFER_ID = "ff99d26b-f1cb-4970-9275-7f6ff5e91efc"  # Test surfer


class TestNotificationsSend:
    """Test POST /api/notifications/send - Thank you flow"""
    
    def test_send_notification_creates_record(self):
        """POST /api/notifications/send creates notification for thank you flow"""
        notification_data = {
            "recipient_id": PHOTOGRAPHER_ID,
            "sender_id": SURFER_ID,
            "type": "thank_you",
            "title": "Thanks for the photo!",
            "body": "Test surfer thanked you for tagging them in a photo"
        }
        
        response = requests.post(
            f"{BASE_URL}/api/notifications/send",
            json=notification_data
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data["success"] == True, "Should return success=True"
        assert "message" in data, "Should return message field"
        
        print(f"✓ POST /api/notifications/send creates notification")
        print(f"  - recipient: {PHOTOGRAPHER_ID[:8]}...")
        print(f"  - type: thank_you")
    
    def test_notification_appears_in_recipient_list(self):
        """Sent notification appears in recipient's notification list"""
        # Send a unique notification
        unique_body = f"Test_notification_{datetime.now().strftime('%H%M%S')}"
        notification_data = {
            "recipient_id": PHOTOGRAPHER_ID,
            "sender_id": SURFER_ID,
            "type": "thank_you",
            "title": "Test Thanks!",
            "body": unique_body
        }
        
        send_response = requests.post(
            f"{BASE_URL}/api/notifications/send",
            json=notification_data
        )
        
        assert send_response.status_code == 200
        
        # Verify it appears in recipient's list
        get_response = requests.get(f"{BASE_URL}/api/notifications/{PHOTOGRAPHER_ID}")
        
        assert get_response.status_code == 200, f"Expected 200, got {get_response.status_code}"
        
        notifications = get_response.json()
        
        # Find our notification
        found = any(n.get("body") == unique_body for n in notifications)
        assert found, "Sent notification should appear in recipient's list"
        
        print(f"✓ Notification appears in recipient's list")
    
    def test_send_notification_without_body(self):
        """POST /api/notifications/send works without body field"""
        notification_data = {
            "recipient_id": PHOTOGRAPHER_ID,
            "sender_id": SURFER_ID,
            "type": "thank_you",
            "title": "Thanks!"
        }
        
        response = requests.post(
            f"{BASE_URL}/api/notifications/send",
            json=notification_data
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        print(f"✓ Notification works without body field")


class TestProfileTaggedEndpoint:
    """Test GET /api/profile/{id}/tagged with is_new field"""
    
    def test_tagged_endpoint_returns_items(self):
        """GET /api/profile/{id}/tagged returns items with is_new field"""
        response = requests.get(f"{BASE_URL}/api/profile/{SURFER_ID}/tagged")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "items" in data, "Response should have items"
        assert "new_count" in data, "Response should have new_count"
        
        print(f"✓ GET /api/profile/{SURFER_ID[:8]}.../tagged returns data")
        print(f"  - items count: {len(data['items'])}")
        print(f"  - new_count: {data['new_count']}")
        
        return data
    
    def test_ai_tagged_items_have_required_fields(self):
        """AI-tagged items have tag_id, access_granted, was_session_participant"""
        response = requests.get(f"{BASE_URL}/api/profile/{SURFER_ID}/tagged")
        
        assert response.status_code == 200
        
        data = response.json()
        ai_tagged = [i for i in data["items"] if i.get("type") == "ai_tagged"]
        
        for item in ai_tagged:
            assert "id" in item, "Should have id"
            assert "tag_id" in item, "Should have tag_id for modal"
            assert "is_new" in item, "Should have is_new for NEW badge"
            assert "access_granted" in item, "Should have access_granted"
            assert "was_session_participant" in item, "Should have was_session_participant"
            assert "media_url" in item or "thumbnail_url" in item, "Should have media"
            assert "tagged_by" in item, "Should have tagged_by"
        
        print(f"✓ AI-tagged items have all required fields ({len(ai_tagged)} items)")
    
    def test_new_count_matches_is_new_items(self):
        """new_count matches count of is_new=true items"""
        response = requests.get(f"{BASE_URL}/api/profile/{SURFER_ID}/tagged")
        
        assert response.status_code == 200
        
        data = response.json()
        items = data["items"]
        
        actual_new = len([i for i in items if i.get("is_new", False)])
        reported_new = data["new_count"]
        
        assert actual_new == reported_new, f"new_count mismatch: {reported_new} != {actual_new}"
        print(f"✓ new_count ({reported_new}) matches actual is_new=true count")


class TestMyTaggedPhotos:
    """Test GET /api/ai/my-tagged-photos endpoint"""
    
    def test_my_tagged_photos_returns_data(self):
        """GET /api/ai/my-tagged-photos returns tagged photos with full details"""
        response = requests.get(
            f"{BASE_URL}/api/ai/my-tagged-photos",
            params={"user_id": SURFER_ID, "limit": 50}
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "tagged_photos" in data
        assert "new_count" in data
        assert "total_count" in data
        
        print(f"✓ GET /api/ai/my-tagged-photos returns data")
        print(f"  - total_count: {data['total_count']}")
        print(f"  - new_count: {data['new_count']}")
        
        return data
    
    def test_tagged_photos_have_session_pricing_fields(self):
        """Tagged photos include session_photo_price and access_granted"""
        response = requests.get(
            f"{BASE_URL}/api/ai/my-tagged-photos",
            params={"user_id": SURFER_ID, "limit": 50}
        )
        
        assert response.status_code == 200
        
        data = response.json()
        photos = data["tagged_photos"]
        
        for photo in photos:
            assert "id" in photo
            assert "tag_id" in photo, "Should have tag_id for mark-viewed"
            assert "is_new" in photo, "Should have is_new field"
            assert "access_granted" in photo
            assert "was_session_participant" in photo
            assert "session_photo_price" in photo
            assert "photographer_id" in photo
            assert "preview_url" in photo
        
        print(f"✓ Tagged photos have all session pricing fields ({len(photos)} photos)")


class TestMarkPhotoViewed:
    """Test POST /api/ai/mark-photo-viewed clears NEW badge"""
    
    def test_mark_photo_viewed_success(self):
        """POST /api/ai/mark-photo-viewed clears NEW badge"""
        # Get tagged photos to find a tag_id
        response = requests.get(
            f"{BASE_URL}/api/ai/my-tagged-photos",
            params={"user_id": SURFER_ID, "limit": 50}
        )
        
        assert response.status_code == 200
        
        data = response.json()
        photos = data["tagged_photos"]
        
        if len(photos) == 0:
            pytest.skip("No tagged photos to test mark-viewed")
        
        tag_id = photos[0].get("tag_id")
        assert tag_id, "Photo should have tag_id"
        
        # Mark as viewed
        mark_response = requests.post(
            f"{BASE_URL}/api/ai/mark-photo-viewed",
            params={"user_id": SURFER_ID, "tag_id": tag_id}
        )
        
        assert mark_response.status_code == 200, f"Expected 200, got {mark_response.status_code}: {mark_response.text}"
        
        mark_data = mark_response.json()
        assert mark_data["success"] == True
        assert "viewed_at" in mark_data
        
        print(f"✓ mark-photo-viewed success for tag {tag_id[:8]}...")
    
    def test_mark_viewed_is_idempotent(self):
        """Marking same photo viewed twice works without error"""
        response = requests.get(
            f"{BASE_URL}/api/ai/my-tagged-photos",
            params={"user_id": SURFER_ID, "limit": 50}
        )
        
        if response.status_code != 200:
            pytest.skip("Could not fetch tagged photos")
        
        photos = response.json()["tagged_photos"]
        
        if len(photos) == 0:
            pytest.skip("No tagged photos")
        
        tag_id = photos[0]["tag_id"]
        
        # Call twice
        r1 = requests.post(
            f"{BASE_URL}/api/ai/mark-photo-viewed",
            params={"user_id": SURFER_ID, "tag_id": tag_id}
        )
        r2 = requests.post(
            f"{BASE_URL}/api/ai/mark-photo-viewed",
            params={"user_id": SURFER_ID, "tag_id": tag_id}
        )
        
        assert r1.status_code == 200
        assert r2.status_code == 200
        
        # Second should have first_view=False
        if r1.json().get("first_view"):
            assert r2.json().get("first_view") == False
        
        print(f"✓ mark-photo-viewed is idempotent")
    
    def test_mark_viewed_invalid_tag_returns_404(self):
        """Invalid tag_id returns 404"""
        response = requests.post(
            f"{BASE_URL}/api/ai/mark-photo-viewed",
            params={"user_id": SURFER_ID, "tag_id": "invalid-tag-12345"}
        )
        
        assert response.status_code == 404
        print(f"✓ Invalid tag_id returns 404")


class TestGalleryPricing:
    """Test GET /api/gallery/item/{id}/pricing endpoint"""
    
    def test_gallery_pricing_returns_tiers(self):
        """GET /api/gallery/item/{id}/pricing returns quality tiers"""
        # First get a gallery item
        # Create one if needed
        item_data = {
            "original_url": "https://example.com/pricing-test.jpg",
            "preview_url": "https://example.com/pricing-preview.jpg",
            "media_type": "image",
            "title": f"TEST_Pricing_{datetime.now().strftime('%H%M%S')}",
            "price": 5.0,
            "is_for_sale": True
        }
        
        create_response = requests.post(
            f"{BASE_URL}/api/gallery",
            params={"photographer_id": PHOTOGRAPHER_ID},
            json=item_data
        )
        
        assert create_response.status_code == 200, f"Failed to create: {create_response.text}"
        item_id = create_response.json().get("id")
        
        # Get pricing
        pricing_response = requests.get(
            f"{BASE_URL}/api/gallery/item/{item_id}/pricing"
        )
        
        assert pricing_response.status_code == 200, f"Expected 200, got {pricing_response.status_code}: {pricing_response.text}"
        
        data = pricing_response.json()
        assert "item_id" in data
        assert "media_type" in data
        assert "pricing" in data
        
        pricing = data["pricing"]
        assert "type" in pricing
        assert "tiers" in pricing
        
        # For images, should have web, standard, high tiers
        if pricing["type"] == "photo":
            tier_ids = [t["tier"] for t in pricing["tiers"]]
            assert "web" in tier_ids, "Should have web tier"
            assert "standard" in tier_ids, "Should have standard tier"
            assert "high" in tier_ids, "Should have high tier"
            
            for tier in pricing["tiers"]:
                assert "tier" in tier
                assert "label" in tier
                assert "price" in tier
                assert "is_purchased" in tier
        
        print(f"✓ Gallery pricing returns tiers for item {item_id[:8]}...")
        print(f"  - type: {pricing['type']}")
        print(f"  - tiers: {[t['tier'] for t in pricing['tiers']]}")
        
        return item_id


class TestGalleryPurchase:
    """Test POST /api/gallery/item/{id}/purchase endpoint"""
    
    def test_purchase_without_credits_fails(self):
        """Purchase fails if buyer has insufficient credits"""
        # Create gallery item
        item_data = {
            "original_url": "https://example.com/purchase-test.jpg",
            "preview_url": "https://example.com/purchase-preview.jpg",
            "media_type": "image",
            "title": f"TEST_Purchase_{datetime.now().strftime('%H%M%S')}",
            "price": 5.0,
            "is_for_sale": True
        }
        
        create_response = requests.post(
            f"{BASE_URL}/api/gallery",
            params={"photographer_id": PHOTOGRAPHER_ID},
            json=item_data
        )
        
        assert create_response.status_code == 200
        item_id = create_response.json().get("id")
        
        # Try to purchase (surfer may not have credits)
        purchase_data = {
            "payment_method": "credits",
            "quality_tier": "standard"
        }
        
        response = requests.post(
            f"{BASE_URL}/api/gallery/item/{item_id}/purchase",
            params={"buyer_id": SURFER_ID},
            json=purchase_data
        )
        
        # Should be 400 (insufficient credits) or 200 (if has credits)
        assert response.status_code in [200, 400], f"Expected 200 or 400, got {response.status_code}: {response.text}"
        
        if response.status_code == 400:
            print(f"✓ Purchase fails with insufficient credits")
            print(f"  - detail: {response.json().get('detail')}")
        else:
            print(f"✓ Purchase succeeded (buyer had credits)")
            data = response.json()
            assert "download_url" in data or "download_link" in data
    
    def test_purchase_validates_quality_tier(self):
        """Purchase validates quality_tier is valid"""
        # Create gallery item
        item_data = {
            "original_url": "https://example.com/tier-test.jpg",
            "preview_url": "https://example.com/tier-preview.jpg",
            "media_type": "image",
            "title": f"TEST_TierValidation_{datetime.now().strftime('%H%M%S')}",
            "price": 5.0,
            "is_for_sale": True
        }
        
        create_response = requests.post(
            f"{BASE_URL}/api/gallery",
            params={"photographer_id": PHOTOGRAPHER_ID},
            json=item_data
        )
        
        assert create_response.status_code == 200
        item_id = create_response.json().get("id")
        
        # Try invalid tier
        purchase_data = {
            "payment_method": "credits",
            "quality_tier": "invalid_tier_xyz"
        }
        
        response = requests.post(
            f"{BASE_URL}/api/gallery/item/{item_id}/purchase",
            params={"buyer_id": SURFER_ID},
            json=purchase_data
        )
        
        # Should be 400 for invalid tier
        assert response.status_code == 400, f"Expected 400 for invalid tier, got {response.status_code}"
        print(f"✓ Invalid quality tier returns 400")


class TestEndToEndTaggedPhotoFlow:
    """Test full tagged photo workflow"""
    
    def test_create_tag_then_view_clears_badge(self):
        """Create tag -> fetch tagged -> mark viewed -> verify is_new=False"""
        # 1. Create gallery item
        item_data = {
            "original_url": "https://example.com/e2e-test.jpg",
            "preview_url": "https://example.com/e2e-preview.jpg",
            "media_type": "image",
            "title": f"TEST_E2E_{datetime.now().strftime('%H%M%S')}",
            "price": 5.0,
            "is_for_sale": True
        }
        
        create_response = requests.post(
            f"{BASE_URL}/api/gallery",
            params={"photographer_id": PHOTOGRAPHER_ID},
            json=item_data
        )
        
        assert create_response.status_code == 200
        item_id = create_response.json().get("id")
        
        # 2. Confirm tag
        confirm_data = {
            "gallery_item_id": item_id,
            "surfer_ids": [SURFER_ID]
        }
        
        confirm_response = requests.post(
            f"{BASE_URL}/api/ai/confirm-tags",
            params={"photographer_id": PHOTOGRAPHER_ID},
            json=confirm_data
        )
        
        assert confirm_response.status_code == 200
        
        # 3. Fetch tagged photos - should be is_new=True
        photos_response = requests.get(
            f"{BASE_URL}/api/ai/my-tagged-photos",
            params={"user_id": SURFER_ID, "limit": 50}
        )
        
        assert photos_response.status_code == 200
        
        photos = photos_response.json()["tagged_photos"]
        new_photo = next((p for p in photos if p.get("is_new", False)), None)
        
        if not new_photo:
            print("⚠ No new photos found (may have been marked viewed already)")
            return
        
        tag_id = new_photo.get("tag_id")
        
        # 4. Mark as viewed
        mark_response = requests.post(
            f"{BASE_URL}/api/ai/mark-photo-viewed",
            params={"user_id": SURFER_ID, "tag_id": tag_id}
        )
        
        assert mark_response.status_code == 200
        
        # 5. Verify is_new=False now
        verify_response = requests.get(
            f"{BASE_URL}/api/ai/my-tagged-photos",
            params={"user_id": SURFER_ID, "limit": 50}
        )
        
        verify_photos = verify_response.json()["tagged_photos"]
        viewed_photo = next((p for p in verify_photos if p.get("tag_id") == tag_id), None)
        
        if viewed_photo:
            assert viewed_photo["is_new"] == False, "is_new should be False after viewing"
        
        print(f"✓ E2E flow: create tag -> mark viewed -> is_new cleared")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
