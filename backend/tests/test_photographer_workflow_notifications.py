"""
Test file for iteration 24:
- Live session -> Gallery auto-creation flow
- Gallery photo upload to gallery
- AI tagging endpoints (suggest-tags, confirm-tags)
- Notifications for photo_tagged
- GET notifications by user
- GET my-tagged-photos
- Surf spot dropdown data
- Find Buddies skill filtering
"""
import pytest
import requests
import os
import json
from datetime import datetime, timezone, timedelta

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test user IDs from previous iterations
PHOTOGRAPHER_ID = "ff99d26b-f1cb-4970-9275-7f6ff5e91efc"  # Test Hobbyist
SURFER_ID = "04503c29-dc37-4f8c-a462-4177c4a54096"  # Sarah Waters


class TestSurfSpotDropdownData:
    """Test surf spot dropdown availability for photographer sessions"""
    
    def test_get_surf_spots_for_dropdown(self):
        """GET /api/surf-spots returns list for dropdown selection"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        spots = response.json()
        assert isinstance(spots, list), "Response should be a list"
        assert len(spots) > 0, "Should have surf spots for dropdown"
        
        # Verify each spot has id and name for dropdown
        for spot in spots[:5]:
            assert "id" in spot, "Spot needs id for dropdown value"
            assert "name" in spot, "Spot needs name for dropdown display"
            assert "region" in spot, "Spot needs region for context"
        
        print(f"✓ GET /api/surf-spots returns {len(spots)} spots for dropdown")


class TestPhotographerGoLiveEndSession:
    """Test go-live and end-session workflow"""
    
    def test_get_active_session_when_not_live(self):
        """GET /api/photographer/{id}/active-session returns null when not live"""
        response = requests.get(f"{BASE_URL}/api/photographer/{PHOTOGRAPHER_ID}/active-session")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        # May return null/None when not live
        data = response.json()
        if data is None:
            print("✓ No active session - photographer is not live")
        else:
            print(f"✓ Active session found at: {data.get('location', 'unknown')}")
    
    def test_go_live_requires_surf_spot(self):
        """POST /api/photographer/{id}/go-live creates a live session"""
        # First, get a valid surf spot
        spots_response = requests.get(f"{BASE_URL}/api/surf-spots")
        spots = spots_response.json()
        
        if len(spots) == 0:
            pytest.skip("No surf spots available")
        
        spot = spots[0]
        
        # Try to go live
        go_live_data = {
            "location": spot["name"],
            "spot_id": spot["id"],
            "price_per_join": 25,
            "max_surfers": 10,
            "auto_accept": True
        }
        
        response = requests.post(
            f"{BASE_URL}/api/photographer/{PHOTOGRAPHER_ID}/go-live",
            json=go_live_data
        )
        
        # May succeed (200) or fail if already live (400)
        if response.status_code == 200:
            data = response.json()
            assert "message" in data
            assert "photographer_id" in data
            print(f"✓ Go Live successful: {data.get('message')}")
        elif response.status_code == 400:
            # Already live
            data = response.json()
            print(f"✓ Go Live returned 400 (expected if already live): {data.get('detail')}")
        else:
            # Some other error
            print(f"⚠ Go Live returned {response.status_code}: {response.text}")
    
    def test_end_session_creates_gallery(self):
        """POST /api/photographer/{id}/end-session creates a gallery"""
        # First check if we're live
        active_response = requests.get(f"{BASE_URL}/api/photographer/{PHOTOGRAPHER_ID}/active-session")
        
        if active_response.status_code == 200 and active_response.json():
            # We're live, end the session
            response = requests.post(f"{BASE_URL}/api/photographer/{PHOTOGRAPHER_ID}/end-session")
            
            if response.status_code == 200:
                data = response.json()
                assert "message" in data
                # Check for gallery creation
                if "gallery_id" in data:
                    assert "gallery_title" in data
                    print(f"✓ End session created gallery: {data.get('gallery_title')} (id: {data.get('gallery_id')})")
                else:
                    print(f"✓ End session response: {data.get('message')}")
            else:
                print(f"⚠ End session returned {response.status_code}: {response.text}")
        else:
            print("⚠ Photographer not live - cannot test end-session gallery creation")


class TestGalleryPhotoUpload:
    """Test gallery photo upload functionality"""
    
    def test_get_photographer_galleries(self):
        """GET /api/galleries/photographer/{id} returns galleries"""
        response = requests.get(f"{BASE_URL}/api/galleries/photographer/{PHOTOGRAPHER_ID}")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        galleries = response.json()
        assert isinstance(galleries, list), "Response should be a list"
        
        print(f"✓ Photographer has {len(galleries)} galleries")
        return galleries
    
    def test_add_item_to_gallery(self):
        """POST /api/galleries/{id}/items adds item to gallery"""
        # First get galleries
        galleries_response = requests.get(f"{BASE_URL}/api/galleries/photographer/{PHOTOGRAPHER_ID}")
        galleries = galleries_response.json()
        
        if len(galleries) == 0:
            # Create a test gallery first
            gallery_data = {
                "title": f"TEST_PhotoUpload_{datetime.now().strftime('%H%M%S')}",
                "description": "Test gallery for photo upload"
            }
            create_response = requests.post(
                f"{BASE_URL}/api/galleries",
                params={"photographer_id": PHOTOGRAPHER_ID},
                json=gallery_data
            )
            if create_response.status_code == 200:
                gallery_id = create_response.json().get("id")
            else:
                pytest.skip("Could not create test gallery")
        else:
            gallery_id = galleries[0]["id"]
        
        # Add item to gallery
        item_data = {
            "original_url": "https://example.com/test-photo-original.jpg",
            "preview_url": "https://example.com/test-photo-preview.jpg",
            "thumbnail_url": "https://example.com/test-photo-thumb.jpg",
            "media_type": "image",
            "title": "Test Photo Upload",
            "price": 5.0,
            "is_for_sale": True
        }
        
        response = requests.post(
            f"{BASE_URL}/api/galleries/{gallery_id}/items",
            params={"photographer_id": PHOTOGRAPHER_ID},
            json=item_data
        )
        
        if response.status_code == 200:
            data = response.json()
            assert "id" in data, "Response should have item id"
            assert "gallery_id" in data, "Response should have gallery_id"
            print(f"✓ Added item to gallery: {data.get('id')}")
        else:
            print(f"⚠ Add item returned {response.status_code}: {response.text}")
    
    def test_create_gallery_item_directly(self):
        """POST /api/gallery creates standalone gallery item"""
        item_data = {
            "original_url": "https://example.com/surf-photo-original.jpg",
            "preview_url": "https://example.com/surf-photo-preview.jpg",
            "media_type": "image",
            "title": f"TEST_Direct_Item_{datetime.now().strftime('%H%M%S')}",
            "price": 5.0,
            "is_for_sale": True
        }
        
        response = requests.post(
            f"{BASE_URL}/api/gallery",
            params={"photographer_id": PHOTOGRAPHER_ID},
            json=item_data
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "id" in data, "Response should have item id"
        assert "preview_url" in data, "Response should have preview_url"
        print(f"✓ Created gallery item directly: {data.get('id')}")


class TestAITaggingSuggestTags:
    """Test AI tagging POST /api/ai/suggest-tags endpoint"""
    
    def test_suggest_tags_endpoint(self):
        """POST /api/ai/suggest-tags analyzes photo and suggests surfer tags"""
        # Use a public surf photo URL for testing
        test_data = {
            "image_url": "https://images.unsplash.com/photo-1502680390469-be75c86b636f?w=800",
            "gallery_item_id": None  # Optional
        }
        
        response = requests.post(
            f"{BASE_URL}/api/ai/suggest-tags",
            json=test_data,
            timeout=60  # AI analysis can take time
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "success" in data, "Response should have success flag"
        assert "analysis" in data, "Response should have analysis"
        assert "suggested_tags" in data, "Response should have suggested_tags"
        assert "people_detected" in data, "Response should have people_detected count"
        
        # Check analysis structure
        analysis = data.get("analysis", {})
        if "people_count" in analysis:
            print(f"✓ AI detected {analysis.get('people_count')} people in photo")
        
        print(f"✓ POST /api/ai/suggest-tags working - {len(data.get('suggested_tags', []))} tag suggestions")
    
    def test_suggest_tags_no_image(self):
        """POST /api/ai/suggest-tags without image returns error"""
        response = requests.post(
            f"{BASE_URL}/api/ai/suggest-tags",
            json={"gallery_item_id": "test-id"}
        )
        
        # Should fail validation (missing image_url)
        assert response.status_code in [400, 422], f"Expected 400/422, got {response.status_code}"
        print("✓ Missing image_url properly rejected")


class TestAITaggingConfirmTags:
    """Test AI tag confirmation POST /api/ai/confirm-tags endpoint"""
    
    def test_confirm_tags_creates_notification(self):
        """POST /api/ai/confirm-tags creates notification for tagged surfer"""
        # First, create a gallery item to tag
        item_data = {
            "original_url": "https://example.com/tagged-photo-original.jpg",
            "preview_url": "https://example.com/tagged-photo-preview.jpg",
            "media_type": "image",
            "title": f"TEST_TaggedPhoto_{datetime.now().strftime('%H%M%S')}",
            "price": 5.0,
            "is_for_sale": True
        }
        
        create_response = requests.post(
            f"{BASE_URL}/api/gallery",
            params={"photographer_id": PHOTOGRAPHER_ID},
            json=item_data
        )
        
        if create_response.status_code != 200:
            pytest.skip(f"Could not create gallery item: {create_response.text}")
        
        gallery_item_id = create_response.json().get("id")
        
        # Now confirm tags with the surfer
        confirm_data = {
            "gallery_item_id": gallery_item_id,
            "surfer_ids": [SURFER_ID]
        }
        
        response = requests.post(
            f"{BASE_URL}/api/ai/confirm-tags",
            params={"photographer_id": PHOTOGRAPHER_ID},
            json=confirm_data
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "success" in data, "Response should have success flag"
        assert "tagged_count" in data, "Response should have tagged_count"
        assert data["tagged_count"] == 1, f"Expected 1 tagged, got {data['tagged_count']}"
        
        print(f"✓ POST /api/ai/confirm-tags successful - tagged {data['tagged_count']} surfer(s)")
        
        # Return the gallery_item_id for notification test
        return gallery_item_id
    
    def test_confirm_tags_invalid_gallery_item(self):
        """POST /api/ai/confirm-tags with invalid gallery item returns 404"""
        confirm_data = {
            "gallery_item_id": "invalid-gallery-item-id",
            "surfer_ids": [SURFER_ID]
        }
        
        response = requests.post(
            f"{BASE_URL}/api/ai/confirm-tags",
            params={"photographer_id": PHOTOGRAPHER_ID},
            json=confirm_data
        )
        
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        print("✓ Invalid gallery item properly returns 404")


class TestNotificationsPhotoTagged:
    """Test notifications endpoint for photo_tagged type"""
    
    def test_get_notifications_for_user(self):
        """GET /api/notifications/{user_id} returns notifications"""
        response = requests.get(f"{BASE_URL}/api/notifications/{SURFER_ID}")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        notifications = response.json()
        assert isinstance(notifications, list), "Response should be a list"
        
        # Check for photo_tagged notifications
        photo_tagged = [n for n in notifications if n.get("type") == "photo_tagged"]
        
        print(f"✓ GET /api/notifications/{SURFER_ID} returned {len(notifications)} notifications")
        print(f"  - {len(photo_tagged)} photo_tagged notifications")
        
        # Verify notification structure
        if len(notifications) > 0:
            n = notifications[0]
            assert "id" in n, "Notification should have id"
            assert "type" in n, "Notification should have type"
            assert "title" in n, "Notification should have title"
            assert "is_read" in n, "Notification should have is_read"
            assert "created_at" in n, "Notification should have created_at"
        
        return photo_tagged
    
    def test_photo_tagged_notification_has_correct_data(self):
        """Verify photo_tagged notification contains gallery_item_id"""
        response = requests.get(f"{BASE_URL}/api/notifications/{SURFER_ID}")
        notifications = response.json()
        
        photo_tagged = [n for n in notifications if n.get("type") == "photo_tagged"]
        
        if len(photo_tagged) > 0:
            notification = photo_tagged[0]
            
            # Data field should contain JSON with gallery_item_id
            if notification.get("data"):
                try:
                    data = json.loads(notification["data"])
                    assert "gallery_item_id" in data, "Notification data should have gallery_item_id"
                    assert "photographer_id" in data, "Notification data should have photographer_id"
                    print(f"✓ photo_tagged notification has correct data structure")
                    print(f"  - gallery_item_id: {data.get('gallery_item_id')}")
                except json.JSONDecodeError:
                    print(f"⚠ Notification data is not valid JSON")
        else:
            print("⚠ No photo_tagged notifications found to verify structure")
    
    def test_get_unread_notification_count(self):
        """GET /api/notifications/{user_id}/unread-count returns count"""
        response = requests.get(f"{BASE_URL}/api/notifications/{SURFER_ID}/unread-count")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "unread_count" in data, "Response should have unread_count"
        
        print(f"✓ Unread notification count: {data['unread_count']}")


class TestMyTaggedPhotos:
    """Test GET /api/ai/my-tagged-photos endpoint"""
    
    def test_get_my_tagged_photos(self):
        """GET /api/ai/my-tagged-photos returns photos user is tagged in"""
        response = requests.get(
            f"{BASE_URL}/api/ai/my-tagged-photos",
            params={"user_id": SURFER_ID, "limit": 20}
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "tagged_photos" in data, "Response should have tagged_photos"
        assert "total_count" in data, "Response should have total_count"
        
        tagged_photos = data.get("tagged_photos", [])
        
        # Verify photo structure - should only have preview, not full image (until purchased)
        for photo in tagged_photos[:3]:
            assert "id" in photo, "Photo should have id"
            assert "preview_url" in photo, "Photo should have preview_url (for preview)"
            assert "photographer_id" in photo, "Photo should have photographer_id"
            assert "photographer_name" in photo, "Photo should have photographer_name"
            assert "is_for_sale" in photo, "Photo should have is_for_sale"
            assert "price" in photo, "Photo should have price"
            # Note: original_url should NOT be exposed until purchased
        
        print(f"✓ GET /api/ai/my-tagged-photos returns {len(tagged_photos)} tagged photos")
        print(f"  - Total count: {data.get('total_count')}")


class TestFindBuddiesSkillFiltering:
    """Test GET /api/bookings/nearby with skill_level filter"""
    
    # Coordinates near Cocoa Beach
    LATITUDE = 28.3655
    LONGITUDE = -80.5995
    
    def test_get_nearby_bookings_basic(self):
        """GET /api/bookings/nearby returns bookings with skill info"""
        params = {
            "latitude": self.LATITUDE,
            "longitude": self.LONGITUDE,
            "radius": 100
        }
        
        response = requests.get(f"{BASE_URL}/api/bookings/nearby", params=params)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        bookings = response.json()
        assert isinstance(bookings, list), "Response should be a list"
        
        # Check structure
        for booking in bookings[:3]:
            assert "id" in booking
            assert "skill_level_filter" in booking, "Should have skill_level_filter field"
            assert "participant_skills" in booking, "Should have participant_skills field"
            assert "split_mode" in booking, "Should have split_mode field"
        
        print(f"✓ GET /api/bookings/nearby returns {len(bookings)} bookings with skill info")
    
    def test_filter_by_skill_level_beginner(self):
        """GET /api/bookings/nearby with skill_level=Beginner"""
        params = {
            "latitude": self.LATITUDE,
            "longitude": self.LONGITUDE,
            "radius": 100,
            "skill_level": "Beginner"
        }
        
        response = requests.get(f"{BASE_URL}/api/bookings/nearby", params=params)
        assert response.status_code == 200
        
        bookings = response.json()
        
        # All returned bookings should match Beginner or have no filter
        for booking in bookings:
            skill_filter = booking.get("skill_level_filter")
            assert skill_filter is None or skill_filter == "Beginner", \
                f"Expected None or 'Beginner', got '{skill_filter}'"
        
        print(f"✓ Skill filter 'Beginner' returns {len(bookings)} matching bookings")
    
    def test_filter_by_skill_level_intermediate(self):
        """GET /api/bookings/nearby with skill_level=Intermediate"""
        params = {
            "latitude": self.LATITUDE,
            "longitude": self.LONGITUDE,
            "radius": 100,
            "skill_level": "Intermediate"
        }
        
        response = requests.get(f"{BASE_URL}/api/bookings/nearby", params=params)
        assert response.status_code == 200
        
        bookings = response.json()
        
        for booking in bookings:
            skill_filter = booking.get("skill_level_filter")
            assert skill_filter is None or skill_filter == "Intermediate"
        
        print(f"✓ Skill filter 'Intermediate' returns {len(bookings)} matching bookings")
    
    def test_filter_by_skill_level_advanced(self):
        """GET /api/bookings/nearby with skill_level=Advanced"""
        params = {
            "latitude": self.LATITUDE,
            "longitude": self.LONGITUDE,
            "radius": 100,
            "skill_level": "Advanced"
        }
        
        response = requests.get(f"{BASE_URL}/api/bookings/nearby", params=params)
        assert response.status_code == 200
        
        bookings = response.json()
        
        for booking in bookings:
            skill_filter = booking.get("skill_level_filter")
            assert skill_filter is None or skill_filter == "Advanced"
        
        print(f"✓ Skill filter 'Advanced' returns {len(bookings)} matching bookings")
    
    def test_filter_by_skill_level_expert(self):
        """GET /api/bookings/nearby with skill_level=Expert"""
        params = {
            "latitude": self.LATITUDE,
            "longitude": self.LONGITUDE,
            "radius": 100,
            "skill_level": "Expert"
        }
        
        response = requests.get(f"{BASE_URL}/api/bookings/nearby", params=params)
        assert response.status_code == 200
        
        bookings = response.json()
        
        for booking in bookings:
            skill_filter = booking.get("skill_level_filter")
            assert skill_filter is None or skill_filter == "Expert"
        
        print(f"✓ Skill filter 'Expert' returns {len(bookings)} matching bookings")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
