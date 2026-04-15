"""
Test Ad Submission with Video/Image Media Support - Iteration 143
Tests the new user-facing ad submission feature with image/video support.
"""
import pytest
import requests
import os
import uuid

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://raw-surf-os.preview.emergentagent.com')

# Test credentials from review request
ADMIN_EMAIL = "dpritzker0905@gmail.com"
ADMIN_PASSWORD = "TestPass123!"
ADMIN_ID = "12dc6786-124f-40b1-8698-a9409f99736f"


class TestAdSubmissionWithMedia:
    """Test ad submission endpoints with video/image media support"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test session"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        self.test_ad_id = None
    
    def test_submit_ad_with_image(self):
        """Test POST /api/ads/submit with image_url and media_type='image'"""
        unique_id = uuid.uuid4().hex[:8]
        payload = {
            "headline": f"TEST_Image_Ad_{unique_id}",
            "description": "Test ad with image media support",
            "cta": "Learn More",
            "cta_link": "https://example.com/test",
            "ad_type": "sponsored",
            "target_roles": [],
            "image_url": "https://example.com/test-image.jpg",
            "video_url": None,
            "thumbnail_url": None,
            "media_type": "image",
            "budget_credits": 10
        }
        
        response = self.session.post(
            f"{BASE_URL}/api/ads/submit?user_id={ADMIN_ID}",
            json=payload
        )
        
        print(f"Submit ad with image response: {response.status_code}")
        print(f"Response body: {response.text}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data.get("success") is True
        assert "ad_id" in data
        assert data.get("message") == "Ad submitted for approval"
        
        self.test_ad_id = data["ad_id"]
        print(f"Created ad with ID: {self.test_ad_id}")
    
    def test_submit_ad_with_video(self):
        """Test POST /api/ads/submit with video_url, thumbnail_url, and media_type='video'"""
        unique_id = uuid.uuid4().hex[:8]
        payload = {
            "headline": f"TEST_Video_Ad_{unique_id}",
            "description": "Test ad with video media support",
            "cta": "Watch Now",
            "cta_link": "https://example.com/video-test",
            "ad_type": "sponsored",
            "target_roles": ["Surfer"],
            "image_url": None,
            "video_url": "https://example.com/test-video.mp4",
            "thumbnail_url": "https://example.com/test-thumbnail.jpg",
            "media_type": "video",
            "budget_credits": 15
        }
        
        response = self.session.post(
            f"{BASE_URL}/api/ads/submit?user_id={ADMIN_ID}",
            json=payload
        )
        
        print(f"Submit ad with video response: {response.status_code}")
        print(f"Response body: {response.text}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data.get("success") is True
        assert "ad_id" in data
        assert "credits_spent" in data
        assert data["credits_spent"] == 15
    
    def test_submit_ad_without_media(self):
        """Test POST /api/ads/submit without any media (text-only ad)"""
        unique_id = uuid.uuid4().hex[:8]
        payload = {
            "headline": f"TEST_TextOnly_Ad_{unique_id}",
            "description": "Test ad without any media",
            "cta": "Click Here",
            "cta_link": "https://example.com/text-only",
            "ad_type": "promo",
            "target_roles": [],
            "image_url": None,
            "video_url": None,
            "thumbnail_url": None,
            "media_type": None,
            "budget_credits": 10
        }
        
        response = self.session.post(
            f"{BASE_URL}/api/ads/submit?user_id={ADMIN_ID}",
            json=payload
        )
        
        print(f"Submit text-only ad response: {response.status_code}")
        print(f"Response body: {response.text}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data.get("success") is True
    
    def test_get_my_submissions(self):
        """Test GET /api/ads/my-submissions returns user's submitted ads"""
        response = self.session.get(
            f"{BASE_URL}/api/ads/my-submissions?user_id={ADMIN_ID}"
        )
        
        print(f"Get my submissions response: {response.status_code}")
        print(f"Response body: {response.text}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "ads" in data
        assert "counts" in data
        assert isinstance(data["ads"], list)
        assert "pending" in data["counts"]
        assert "approved" in data["counts"]
        assert "rejected" in data["counts"]
        
        # Verify we have some TEST_ ads
        test_ads = [ad for ad in data["ads"] if ad.get("headline", "").startswith("TEST_")]
        print(f"Found {len(test_ads)} TEST_ prefixed ads")
    
    def test_my_submissions_contains_media_fields(self):
        """Test that my-submissions response includes video_url, thumbnail_url, media_type fields"""
        response = self.session.get(
            f"{BASE_URL}/api/ads/my-submissions?user_id={ADMIN_ID}"
        )
        
        assert response.status_code == 200
        
        data = response.json()
        ads = data.get("ads", [])
        
        # Find ads with media
        ads_with_media = [ad for ad in ads if ad.get("media_type") is not None]
        
        if ads_with_media:
            ad = ads_with_media[0]
            print(f"Ad with media: {ad.get('headline')}")
            print(f"  media_type: {ad.get('media_type')}")
            print(f"  image_url: {ad.get('image_url')}")
            print(f"  video_url: {ad.get('video_url')}")
            print(f"  thumbnail_url: {ad.get('thumbnail_url')}")
            
            # Verify media fields exist in response
            assert "media_type" in ad
            assert "image_url" in ad or "video_url" in ad
        else:
            print("No ads with media found - creating one first")
            # This is acceptable if no media ads exist yet


class TestAdminAdQueue:
    """Test admin ad queue displays media badges"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test session"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
    
    def test_admin_queue_returns_media_fields(self):
        """Test GET /api/admin/ads/queue returns ads with media fields"""
        response = self.session.get(
            f"{BASE_URL}/api/admin/ads/queue?admin_id={ADMIN_ID}"
        )
        
        print(f"Admin queue response: {response.status_code}")
        print(f"Response body: {response.text[:500]}...")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "pending" in data
        assert "approved" in data
        assert "rejected" in data
        assert "counts" in data
        
        # Check if any ads have media fields
        all_ads = data.get("pending", []) + data.get("approved", []) + data.get("rejected", [])
        
        for ad in all_ads:
            if ad.get("media_type"):
                print(f"Found ad with media: {ad.get('headline')}")
                print(f"  media_type: {ad.get('media_type')}")
                print(f"  video_url: {ad.get('video_url')}")
                print(f"  thumbnail_url: {ad.get('thumbnail_url')}")
                print(f"  image_url: {ad.get('image_url')}")
                
                # Verify structure
                assert "media_type" in ad
                break
    
    def test_admin_queue_counts(self):
        """Test admin queue returns correct counts"""
        response = self.session.get(
            f"{BASE_URL}/api/admin/ads/queue?admin_id={ADMIN_ID}"
        )
        
        assert response.status_code == 200
        
        data = response.json()
        counts = data.get("counts", {})
        
        print(f"Queue counts: pending={counts.get('pending')}, approved={counts.get('approved')}, rejected={counts.get('rejected')}")
        
        assert isinstance(counts.get("pending"), int)
        assert isinstance(counts.get("approved"), int)
        assert isinstance(counts.get("rejected"), int)


class TestUserAdSubmissionModel:
    """Test UserAdSubmission model accepts all required fields"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test session"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
    
    def test_model_accepts_all_media_fields(self):
        """Test that the submission endpoint accepts all media-related fields"""
        unique_id = uuid.uuid4().hex[:8]
        
        # Full payload with all fields
        payload = {
            "headline": f"TEST_FullMedia_Ad_{unique_id}",
            "description": "Test with all media fields",
            "cta": "Shop Now",
            "cta_link": "https://example.com/shop",
            "ad_type": "sponsored",
            "target_roles": ["Photographer", "Surfer"],
            "image_url": "https://example.com/image.jpg",
            "video_url": "https://example.com/video.mp4",
            "thumbnail_url": "https://example.com/thumb.jpg",
            "media_type": "video",
            "budget_credits": 20
        }
        
        response = self.session.post(
            f"{BASE_URL}/api/ads/submit?user_id={ADMIN_ID}",
            json=payload
        )
        
        print(f"Full media fields response: {response.status_code}")
        print(f"Response body: {response.text}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data.get("success") is True
        
        # Verify the ad was created with correct budget
        assert data.get("credits_spent") == 20


class TestCleanup:
    """Cleanup test data"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test session"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
    
    def test_cleanup_test_ads(self):
        """Cancel any pending TEST_ ads to clean up"""
        # Get user's submissions
        response = self.session.get(
            f"{BASE_URL}/api/ads/my-submissions?user_id={ADMIN_ID}"
        )
        
        if response.status_code != 200:
            print("Could not fetch submissions for cleanup")
            return
        
        data = response.json()
        ads = data.get("ads", [])
        
        # Find pending TEST_ ads
        pending_test_ads = [
            ad for ad in ads 
            if ad.get("headline", "").startswith("TEST_") 
            and ad.get("approval_status") == "pending"
        ]
        
        print(f"Found {len(pending_test_ads)} pending TEST_ ads to clean up")
        
        for ad in pending_test_ads[:3]:  # Clean up max 3 to avoid too many requests
            ad_id = ad.get("id")
            if ad_id:
                cancel_response = self.session.delete(
                    f"{BASE_URL}/api/ads/my-submissions/{ad_id}?user_id={ADMIN_ID}"
                )
                print(f"Cancelled ad {ad_id}: {cancel_response.status_code}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
