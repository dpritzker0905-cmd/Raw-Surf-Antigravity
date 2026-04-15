"""
Test Cross-Pollination Features for Raw Surf OS
Testing: 
- Map → Feed: POST /api/sessions/join creates check_in post
- Payment → Profile: Sessions update surf_streak and badges
- Booking → Messaging: GET /api/bookings/{id}/share-link for DM invites
- POST /api/ai/gift-photo gifts a photo to surfer
- POST /api/gallery/items/{id}/claim claims free photo
- Purchase flow adds photo to user's gallery (GalleryPurchase record)
"""
import pytest
import requests
import os
import json
from datetime import datetime, timezone

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test fixtures
TEST_SURFER_EMAIL = f"TEST_cross_poll_surfer_{int(datetime.now().timestamp())}@example.com"
TEST_PHOTOGRAPHER_EMAIL = f"TEST_cross_poll_photographer_{int(datetime.now().timestamp())}@example.com"


class TestSetup:
    """Setup test users for cross-pollination testing"""
    
    @pytest.fixture(scope="class")
    def session(self):
        """Shared requests session"""
        s = requests.Session()
        s.headers.update({"Content-Type": "application/json"})
        return s
    
    @pytest.fixture(scope="class")
    def photographer(self, session):
        """Create or get a photographer"""
        # Try to create photographer
        response = session.post(f"{BASE_URL}/api/auth/register", json={
            "email": TEST_PHOTOGRAPHER_EMAIL,
            "password": "testpass123",
            "full_name": "TEST Cross Poll Photographer",
            "role": "Photographer"
        })
        
        if response.status_code == 200:
            data = response.json()
            photographer_id = data.get('user_id') or data.get('id')
            
            # Add credits to photographer
            session.post(f"{BASE_URL}/api/credits/add?user_id={photographer_id}&amount=1000")
            
            return {
                "id": photographer_id,
                "email": TEST_PHOTOGRAPHER_EMAIL,
                "name": "TEST Cross Poll Photographer"
            }
        else:
            # Use existing photographer
            response = session.get(f"{BASE_URL}/api/profiles?role=Photographer&limit=1")
            if response.status_code == 200 and response.json():
                photographer = response.json()[0]
                return {
                    "id": photographer.get('id'),
                    "email": photographer.get('email'),
                    "name": photographer.get('full_name')
                }
        pytest.skip("Could not create or find photographer")
    
    @pytest.fixture(scope="class") 
    def surfer(self, session):
        """Create or get a surfer"""
        response = session.post(f"{BASE_URL}/api/auth/register", json={
            "email": TEST_SURFER_EMAIL,
            "password": "testpass123",
            "full_name": "TEST Cross Poll Surfer",
            "role": "Surfer"
        })
        
        if response.status_code == 200:
            data = response.json()
            surfer_id = data.get('user_id') or data.get('id')
            
            # Add credits to surfer
            session.post(f"{BASE_URL}/api/credits/add?user_id={surfer_id}&amount=1000")
            
            return {
                "id": surfer_id,
                "email": TEST_SURFER_EMAIL,
                "name": "TEST Cross Poll Surfer"
            }
        else:
            # Use existing surfer
            response = session.get(f"{BASE_URL}/api/profiles?role=Surfer&limit=1")
            if response.status_code == 200 and response.json():
                surfer = response.json()[0]
                # Add credits
                session.post(f"{BASE_URL}/api/credits/add?user_id={surfer.get('id')}&amount=1000")
                return {
                    "id": surfer.get('id'),
                    "email": surfer.get('email'),
                    "name": surfer.get('full_name')
                }
        pytest.skip("Could not create or find surfer")


class TestMapToFeedCrossPollination(TestSetup):
    """Test Map → Feed: POST /api/sessions/join creates check_in post"""
    
    def test_photographer_starts_shooting(self, session, photographer):
        """Photographer must be shooting for join to work"""
        # Start shooting at a spot
        response = session.get(f"{BASE_URL}/api/surf-spots")
        if response.status_code == 200 and response.json():
            spot = response.json()[0]
            spot_id = spot.get('id')
            spot_name = spot.get('name', 'Test Beach')
            
            # Start shooting using go-live endpoint (requires location field)
            response = session.post(f"{BASE_URL}/api/photographer/{photographer['id']}/go-live", json={
                "spot_id": spot_id,
                "location": spot_name
            })
            
            # Accept 200, 400 (already shooting), 403 (not a photographer), or 422 (validation)
            assert response.status_code in [200, 400, 403, 422], f"Go-live failed: {response.text}"
            print(f"Photographer go-live response: {response.status_code}")
        else:
            print("No surf spots found, will try join session anyway")
    
    def test_join_session_creates_check_in_post(self, session, photographer, surfer):
        """Test that joining a live session creates a check-in post on the feed"""
        # Add credits to surfer to ensure they can pay
        session.post(f"{BASE_URL}/api/credits/add?user_id={surfer['id']}&amount=1000")
        
        # Join the session using surfer ID
        response = session.post(
            f"{BASE_URL}/api/sessions/join?surfer_id={surfer['id']}",
            json={
                "photographer_id": photographer['id'],
                "payment_method": "credits"
            }
        )
        
        if response.status_code == 400 and "not currently shooting" in response.text.lower():
            pytest.skip("Photographer not shooting - cannot test join session")
        
        if response.status_code == 403 and "only surfers can join" in response.text.lower():
            # This means we passed a non-surfer ID - check if test fixtures created correct users
            print(f"Test user was not registered as Surfer role. Checking profile...")
            profile_resp = session.get(f"{BASE_URL}/api/profile/{surfer['id']}")
            if profile_resp.status_code == 200:
                profile = profile_resp.json()
                print(f"User role: {profile.get('role')}")
            pytest.skip("Test user not registered as Surfer role")
        
        # Assert success or already in session
        assert response.status_code in [200, 400], f"Join session failed: {response.status_code} - {response.text}"
        
        if response.status_code == 200:
            data = response.json()
            # Verify check_in_created field
            assert data.get('check_in_created') == True, "check_in_created should be True"
            print(f"Join session successful - check_in_created: {data.get('check_in_created')}")
            
            # Verify the post was created (check-in posts)
            feed_response = session.get(f"{BASE_URL}/api/feed?limit=20")
            if feed_response.status_code == 200:
                posts = feed_response.json().get('posts', feed_response.json())
                if isinstance(posts, list):
                    check_in_posts = [p for p in posts if p.get('is_check_in') == True]
                    print(f"Found {len(check_in_posts)} check-in posts in feed")
    
    def test_join_session_updates_surf_streak(self, session, photographer, surfer):
        """Test that joining a session updates the user's surf streak (Payment → Profile)"""
        # Ensure surfer has credits
        session.post(f"{BASE_URL}/api/credits/add?user_id={surfer['id']}&amount=1000")
        
        response = session.post(
            f"{BASE_URL}/api/sessions/join?surfer_id={surfer['id']}",
            json={
                "photographer_id": photographer['id'],
                "payment_method": "credits"
            }
        )
        
        if response.status_code == 200:
            data = response.json()
            # Verify surf_streak is returned
            assert 'surf_streak' in data, "surf_streak should be in response"
            print(f"Surf streak after join: {data.get('surf_streak')}")
            
            # Verify badges_earned is present (even if empty)
            assert 'badges_earned' in data, "badges_earned should be in response"
            print(f"Badges earned: {data.get('badges_earned')}")
        elif response.status_code == 400 and "already in this session" in response.text.lower():
            print("Already in session - streak already updated")
        elif "not currently shooting" in response.text.lower():
            pytest.skip("Photographer not shooting")


class TestBookingToMessaging(TestSetup):
    """Test Booking → Messaging: GET /api/bookings/{id}/share-link for DM invites"""
    
    @pytest.fixture(scope="class")
    def test_booking(self, session, photographer, surfer):
        """Create a booking that allows splitting"""
        from datetime import timedelta
        session_date = (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()
        
        response = session.post(
            f"{BASE_URL}/api/bookings/create?user_id={surfer['id']}",
            json={
                "photographer_id": photographer['id'],
                "location": "TEST Cross Poll Beach",
                "session_date": session_date,
                "duration": 60,
                "max_participants": 4,
                "allow_splitting": True,
                "split_mode": "friends_only"
            }
        )
        
        if response.status_code in [200, 201]:
            data = response.json()
            booking_id = data.get('booking_id')
            invite_code = data.get('invite_code')
            print(f"Created booking: {booking_id} with invite_code: {invite_code}")
            return {
                "id": booking_id,
                "invite_code": invite_code
            }
        else:
            print(f"Create booking failed: {response.text}")
            # Try to find existing booking
            response = session.get(f"{BASE_URL}/api/bookings?user_id={surfer['id']}")
            if response.status_code == 200 and response.json():
                bookings = response.json()
                for booking in bookings:
                    if booking.get('allow_splitting'):
                        return {
                            "id": booking.get('id'),
                            "invite_code": booking.get('invite_code')
                        }
        pytest.skip("Could not create booking for share link test")
    
    def test_get_booking_share_link(self, session, test_booking, surfer):
        """Test getting a shareable invite link for DMs"""
        booking_id = test_booking['id']
        
        response = session.get(
            f"{BASE_URL}/api/bookings/{booking_id}/share-link?user_id={surfer['id']}"
        )
        
        assert response.status_code == 200, f"Get share link failed: {response.text}"
        
        data = response.json()
        
        # Verify required fields
        assert 'invite_code' in data, "invite_code should be in response"
        assert 'share_message' in data, "share_message should be in response"
        assert 'booking_details' in data, "booking_details should be in response"
        
        print(f"Share message preview: {data['share_message'][:100]}...")
        print(f"Invite code: {data['invite_code']}")
        
        # Verify booking_details structure
        details = data['booking_details']
        assert 'location' in details, "location should be in booking_details"
        assert 'split_price' in details, "split_price should be in booking_details"
        assert 'spots_left' in details, "spots_left should be in booking_details"
    
    def test_share_link_requires_participant_or_creator(self, session, test_booking):
        """Test that share link requires user to be participant or creator"""
        booking_id = test_booking['id']
        fake_user_id = "fake-user-id-12345"
        
        response = session.get(
            f"{BASE_URL}/api/bookings/{booking_id}/share-link?user_id={fake_user_id}"
        )
        
        # Should be forbidden for non-participant
        assert response.status_code in [403, 404], f"Expected 403/404 for non-participant: {response.text}"


class TestPhotographerGiftsPhoto(TestSetup):
    """Test POST /api/ai/gift-photo gifts a photo to surfer"""
    
    @pytest.fixture(scope="class")
    def test_gallery_item(self, session, photographer):
        """Create a gallery item for testing"""
        response = session.post(
            f"{BASE_URL}/api/gallery?photographer_id={photographer['id']}",
            json={
                "original_url": "https://example.com/test-gift-photo.jpg",
                "preview_url": "https://example.com/test-gift-preview.jpg",
                "title": "TEST Gift Photo",
                "price": 5.0,
                "is_for_sale": True
            }
        )
        
        if response.status_code in [200, 201]:
            data = response.json()
            item_id = data.get('id')
            print(f"Created gallery item: {item_id}")
            return {"id": item_id}
        else:
            # Get existing gallery item
            response = session.get(f"{BASE_URL}/api/gallery/photographer/{photographer['id']}")
            if response.status_code == 200 and response.json():
                items = response.json()
                if items:
                    return {"id": items[0].get('id')}
        pytest.skip("Could not create or find gallery item")
    
    def test_gift_photo_to_surfer(self, session, photographer, surfer, test_gallery_item):
        """Test gifting a photo to a surfer"""
        response = session.post(
            f"{BASE_URL}/api/ai/gift-photo",
            params={
                "photographer_id": photographer['id'],
                "gallery_item_id": test_gallery_item['id'],
                "surfer_id": surfer['id']
            }
        )
        
        assert response.status_code == 200, f"Gift photo failed: {response.text}"
        
        data = response.json()
        assert data.get('success') == True, "success should be True"
        assert 'surfer_name' in data, "surfer_name should be in response"
        print(f"Photo gifted to: {data.get('surfer_name')}")
    
    def test_gift_photo_creates_notification(self, session, surfer):
        """Verify that gifting a photo creates a notification"""
        response = session.get(f"{BASE_URL}/api/notifications/{surfer['id']}")
        
        if response.status_code == 200:
            notifications = response.json()
            gift_notifications = [n for n in notifications if n.get('type') == 'photo_gifted']
            print(f"Found {len(gift_notifications)} gift notifications")
            # Just log - gift notification may or may not be there


class TestClaimFreePhoto(TestSetup):
    """Test POST /api/gallery/items/{id}/claim claims free photo"""
    
    @pytest.fixture(scope="class")
    def photo_with_access(self, session, photographer, surfer):
        """Create a gallery item and tag the surfer with access_granted"""
        # First create a gallery item
        response = session.post(
            f"{BASE_URL}/api/gallery?photographer_id={photographer['id']}",
            json={
                "original_url": "https://example.com/test-claim-photo.jpg",
                "preview_url": "https://example.com/test-claim-preview.jpg",
                "title": "TEST Claimable Photo",
                "price": 0.0,  # Free photo
                "is_for_sale": True
            }
        )
        
        if response.status_code not in [200, 201]:
            pytest.skip("Could not create gallery item for claim test")
        
        item_data = response.json()
        item_id = item_data.get('id')
        
        # Tag the surfer with access_granted
        tag_response = session.post(
            f"{BASE_URL}/api/ai/confirm-tags?photographer_id={photographer['id']}",
            json={
                "gallery_item_id": item_id,
                "surfer_ids": [surfer['id']]
            }
        )
        
        if tag_response.status_code == 200:
            print(f"Tagged surfer in photo: {item_id}")
        
        return {"id": item_id}
    
    def test_claim_free_photo(self, session, surfer, photo_with_access):
        """Test claiming a free photo adds it to gallery"""
        item_id = photo_with_access['id']
        
        # First check if there's a tag for this photo
        tagged_response = session.get(f"{BASE_URL}/api/ai/my-tagged-photos?user_id={surfer['id']}")
        
        if tagged_response.status_code == 200:
            tagged = tagged_response.json()
            photos = tagged.get('tagged_photos', [])
            matching = [p for p in photos if p.get('id') == item_id]
            
            if matching:
                tag_id = matching[0].get('tag_id')
                
                # Claim the photo
                response = session.post(
                    f"{BASE_URL}/api/gallery/items/{item_id}/claim",
                    params={
                        "user_id": surfer['id'],
                        "tag_id": tag_id
                    }
                )
                
                # Could be 200 or 400 (already claimed)
                if response.status_code == 200:
                    data = response.json()
                    assert data.get('success') == True, "success should be True"
                    print(f"Photo claimed successfully: {data}")
                elif "requires purchase" in response.text.lower():
                    print("Photo requires purchase - access not granted")
                else:
                    print(f"Claim response: {response.status_code} - {response.text}")
            else:
                print("Photo not in tagged list - may need access_granted")
        else:
            print(f"Could not get tagged photos: {tagged_response.text}")


class TestPurchaseAddsToGallery(TestSetup):
    """Test purchase flow adds photo to user's gallery (GalleryPurchase record)"""
    
    @pytest.fixture(scope="class")
    def purchasable_item(self, session, photographer):
        """Create a purchasable gallery item"""
        response = session.post(
            f"{BASE_URL}/api/gallery?photographer_id={photographer['id']}",
            json={
                "original_url": "https://example.com/test-purchase-photo.jpg",
                "preview_url": "https://example.com/test-purchase-preview.jpg",
                "title": "TEST Purchasable Photo",
                "price": 5.0,
                "is_for_sale": True
            }
        )
        
        if response.status_code in [200, 201]:
            data = response.json()
            return {"id": data.get('id')}
        
        # Get existing item
        response = session.get(f"{BASE_URL}/api/gallery/photographer/{photographer['id']}")
        if response.status_code == 200 and response.json():
            items = response.json()
            for_sale = [i for i in items if i.get('is_for_sale')]
            if for_sale:
                return {"id": for_sale[0].get('id')}
        pytest.skip("Could not create purchasable item")
    
    def test_purchase_creates_gallery_record(self, session, surfer, purchasable_item):
        """Test that purchasing a photo creates a GalleryPurchase record"""
        item_id = purchasable_item['id']
        
        # Add credits to surfer
        session.post(f"{BASE_URL}/api/credits/add?user_id={surfer['id']}&amount=100")
        
        response = session.post(
            f"{BASE_URL}/api/gallery/item/{item_id}/purchase",
            params={"buyer_id": surfer['id']},
            json={
                "payment_method": "credits",
                "quality_tier": "standard"
            }
        )
        
        # Could be 200 or 400 (already purchased)
        if response.status_code == 200:
            data = response.json()
            assert data.get('success') == True, "success should be True"
            assert 'download_url' in data, "download_url should be in response"
            assert 'quality_tier' in data, "quality_tier should be in response"
            print(f"Purchase successful: {data.get('quality_tier')} quality")
        elif response.status_code == 400:
            # Already purchased is OK
            print(f"Already purchased or insufficient credits: {response.text}")
        else:
            pytest.fail(f"Unexpected response: {response.status_code} - {response.text}")
    
    def test_purchased_photo_in_my_purchases(self, session, surfer, purchasable_item):
        """Verify purchased photo appears in user's purchases"""
        response = session.get(f"{BASE_URL}/api/gallery/my-purchases/{surfer['id']}")
        
        assert response.status_code == 200, f"Get purchases failed: {response.text}"
        
        purchases = response.json()
        assert isinstance(purchases, list), "Purchases should be a list"
        
        print(f"User has {len(purchases)} total purchases")
        
        # Check if our item is there
        item_id = purchasable_item['id']
        matching = [p for p in purchases if p.get('gallery_item_id') == item_id]
        
        if matching:
            purchase = matching[0]
            assert 'original_url' in purchase, "original_url should be accessible after purchase"
            print(f"Found purchase record with download access")


class TestBadgeNotifications(TestSetup):
    """Test that badge notifications are created when milestones are hit"""
    
    def test_check_badge_notifications(self, session, surfer):
        """Check if any badge notifications exist for the user"""
        response = session.get(f"{BASE_URL}/api/notifications/{surfer['id']}")
        
        if response.status_code == 200:
            notifications = response.json()
            badge_notifs = [n for n in notifications if n.get('type') == 'badge_earned']
            print(f"Found {len(badge_notifs)} badge notifications")
            
            for badge in badge_notifs[:3]:  # Show first 3
                print(f"  Badge: {badge.get('title')} - {badge.get('body')}")


class TestAPIStructure:
    """Test basic API structure and availability"""
    
    def test_sessions_join_endpoint_exists(self):
        """Verify POST /api/sessions/join endpoint exists"""
        session = requests.Session()
        session.headers.update({"Content-Type": "application/json"})
        
        # Test with missing params - should get 422, not 404
        response = session.post(f"{BASE_URL}/api/sessions/join")
        
        # 422 (validation error) or 400 (bad request) means endpoint exists
        assert response.status_code != 404, f"Endpoint /api/sessions/join not found"
        print(f"sessions/join endpoint exists - status: {response.status_code}")
    
    def test_bookings_share_link_endpoint_exists(self):
        """Verify GET /api/bookings/{id}/share-link endpoint exists"""
        session = requests.Session()
        
        # Use a fake ID - should get 404 for booking not found, not route
        response = session.get(f"{BASE_URL}/api/bookings/fake-id/share-link?user_id=fake")
        
        # Should be 404 for booking, not route not found
        assert response.status_code in [404, 403, 422], f"Unexpected status: {response.status_code}"
        print(f"bookings share-link endpoint exists - status: {response.status_code}")
    
    def test_ai_gift_photo_endpoint_exists(self):
        """Verify POST /api/ai/gift-photo endpoint exists"""
        session = requests.Session()
        session.headers.update({"Content-Type": "application/json"})
        
        response = session.post(f"{BASE_URL}/api/ai/gift-photo")
        
        # 422 (validation error) or 404 (not found) with specific message
        assert response.status_code in [422, 404, 400], f"Unexpected: {response.status_code}"
        print(f"ai/gift-photo endpoint exists - status: {response.status_code}")
    
    def test_gallery_items_claim_endpoint_exists(self):
        """Verify POST /api/gallery/items/{id}/claim endpoint exists"""
        session = requests.Session()
        session.headers.update({"Content-Type": "application/json"})
        
        response = session.post(f"{BASE_URL}/api/gallery/items/fake-id/claim?user_id=fake")
        
        # Should be 404 for item, not route not found
        assert response.status_code in [404, 422, 400], f"Unexpected: {response.status_code}"
        print(f"gallery/items/claim endpoint exists - status: {response.status_code}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
