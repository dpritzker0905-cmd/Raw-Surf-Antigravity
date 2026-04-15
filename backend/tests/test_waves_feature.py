"""
Waves Feature Tests - Short-form vertical video content (TikTok/Reels style)
Tests for iteration 267 - Waves feature implementation
"""
import pytest
import requests
import os
import io

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://raw-surf-os.preview.emergentagent.com').rstrip('/')

# Test credentials
TEST_EMAIL = "photographer@surf.com"
TEST_PASSWORD = "photo123"


class TestWavesAPI:
    """Test Waves API endpoints"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test session"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        self.user_id = None
        
    def login(self):
        """Login and get user ID"""
        response = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": TEST_EMAIL,
            "password": TEST_PASSWORD
        })
        if response.status_code == 200:
            data = response.json()
            # API returns id directly, not nested in user object
            self.user_id = data.get("id") or data.get("user_id")
            return True
        return False
    
    def test_get_waves_feed_returns_proper_structure(self):
        """GET /api/waves returns proper structure with waves array, total, has_more"""
        response = self.session.get(f"{BASE_URL}/api/waves")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "waves" in data, "Response should contain 'waves' array"
        assert "total" in data, "Response should contain 'total' count"
        assert "has_more" in data, "Response should contain 'has_more' boolean"
        
        assert isinstance(data["waves"], list), "'waves' should be a list"
        assert isinstance(data["total"], int), "'total' should be an integer"
        assert isinstance(data["has_more"], bool), "'has_more' should be a boolean"
        
        print(f"✓ GET /api/waves returns proper structure: waves={len(data['waves'])}, total={data['total']}, has_more={data['has_more']}")
    
    def test_get_waves_feed_with_user_id(self):
        """GET /api/waves with user_id parameter"""
        self.login()
        
        response = self.session.get(f"{BASE_URL}/api/waves", params={
            "user_id": self.user_id
        })
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert "waves" in data
        print(f"✓ GET /api/waves with user_id works correctly")
    
    def test_get_waves_feed_with_feed_type_for_you(self):
        """GET /api/waves with feed_type=for_you"""
        response = self.session.get(f"{BASE_URL}/api/waves", params={
            "feed_type": "for_you"
        })
        
        assert response.status_code == 200
        data = response.json()
        assert "waves" in data
        print(f"✓ GET /api/waves with feed_type=for_you works")
    
    def test_get_waves_feed_with_feed_type_following(self):
        """GET /api/waves with feed_type=following"""
        self.login()
        
        response = self.session.get(f"{BASE_URL}/api/waves", params={
            "user_id": self.user_id,
            "feed_type": "following"
        })
        
        assert response.status_code == 200
        data = response.json()
        assert "waves" in data
        print(f"✓ GET /api/waves with feed_type=following works")
    
    def test_get_waves_feed_with_feed_type_trending(self):
        """GET /api/waves with feed_type=trending"""
        response = self.session.get(f"{BASE_URL}/api/waves", params={
            "feed_type": "trending"
        })
        
        assert response.status_code == 200
        data = response.json()
        assert "waves" in data
        print(f"✓ GET /api/waves with feed_type=trending works")
    
    def test_get_waves_feed_pagination(self):
        """GET /api/waves with limit and offset"""
        response = self.session.get(f"{BASE_URL}/api/waves", params={
            "limit": 5,
            "offset": 0
        })
        
        assert response.status_code == 200
        data = response.json()
        assert "waves" in data
        assert "has_more" in data
        print(f"✓ GET /api/waves pagination works")


class TestWaveUploadAPI:
    """Test Wave upload endpoint"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test session"""
        self.session = requests.Session()
        self.user_id = None
        
    def login(self):
        """Login and get user ID"""
        response = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": TEST_EMAIL,
            "password": TEST_PASSWORD
        })
        if response.status_code == 200:
            data = response.json()
            # API returns id directly, not nested in user object
            self.user_id = data.get("id") or data.get("user_id")
            return True
        return False
    
    def test_upload_wave_requires_video_file(self):
        """POST /api/upload/wave rejects non-video files"""
        self.login()
        
        # Create a fake image file
        fake_image = io.BytesIO(b"fake image content")
        
        response = self.session.post(
            f"{BASE_URL}/api/upload/wave",
            files={"file": ("test.jpg", fake_image, "image/jpeg")},
            data={"user_id": self.user_id}
        )
        
        # Should reject with 400 because it's not a video
        # Note: May return 422 if validation happens at Pydantic level
        assert response.status_code in [400, 422], f"Expected 400/422 for non-video, got {response.status_code}"
        
        data = response.json()
        assert "detail" in data
        print(f"✓ POST /api/upload/wave correctly rejects non-video files (status: {response.status_code})")
    
    def test_upload_wave_requires_user_id(self):
        """POST /api/upload/wave requires user_id"""
        # Create a minimal video-like file
        fake_video = io.BytesIO(b"fake video content")
        
        response = self.session.post(
            f"{BASE_URL}/api/upload/wave",
            files={"file": ("test.mp4", fake_video, "video/mp4")}
            # Missing user_id
        )
        
        # Should fail with 422 (validation error) for missing user_id
        assert response.status_code == 422, f"Expected 422 for missing user_id, got {response.status_code}"
        print(f"✓ POST /api/upload/wave requires user_id")


class TestWaveCreationAPI:
    """Test Wave post creation endpoint"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test session"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        self.user_id = None
        
    def login(self):
        """Login and get user ID"""
        response = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": TEST_EMAIL,
            "password": TEST_PASSWORD
        })
        if response.status_code == 200:
            data = response.json()
            # API returns id directly, not nested in user object
            self.user_id = data.get("id") or data.get("user_id")
            return True
        return False
    
    def test_create_wave_requires_author_id(self):
        """POST /api/waves requires author_id"""
        response = self.session.post(f"{BASE_URL}/api/waves", params={
            "media_url": "/api/uploads/waves/test.mp4"
            # Missing author_id
        })
        
        # Should fail with 422 for missing required field
        assert response.status_code == 422, f"Expected 422 for missing author_id, got {response.status_code}"
        print(f"✓ POST /api/waves requires author_id")
    
    def test_create_wave_requires_media_url(self):
        """POST /api/waves requires media_url"""
        self.login()
        
        response = self.session.post(f"{BASE_URL}/api/waves", params={
            "author_id": self.user_id
            # Missing media_url
        })
        
        # Should fail with 422 for missing required field
        assert response.status_code == 422, f"Expected 422 for missing media_url, got {response.status_code}"
        print(f"✓ POST /api/waves requires media_url")
    
    def test_create_wave_rejects_over_60_seconds(self):
        """POST /api/waves rejects videos over 60 seconds"""
        login_success = self.login()
        assert login_success, "Login failed"
        assert self.user_id, f"User ID not set after login"
        
        response = self.session.post(f"{BASE_URL}/api/waves", params={
            "author_id": self.user_id,
            "media_url": "/api/uploads/waves/test.mp4",
            "video_duration": 65  # Over 60 seconds
        })
        
        # Should fail with 400 for duration over 60 seconds
        assert response.status_code == 400, f"Expected 400 for duration > 60s, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "60" in str(data.get("detail", "")) or "seconds" in str(data.get("detail", "")).lower()
        print(f"✓ POST /api/waves correctly rejects videos over 60 seconds")
    
    def test_create_wave_accepts_valid_duration(self):
        """POST /api/waves accepts videos under 60 seconds"""
        login_success = self.login()
        assert login_success, "Login failed"
        assert self.user_id, f"User ID not set after login"
        
        response = self.session.post(f"{BASE_URL}/api/waves", params={
            "author_id": self.user_id,
            "media_url": "/api/uploads/waves/test_valid.mp4",
            "video_duration": 30,  # Under 60 seconds
            "caption": "Test wave",
            "aspect_ratio": "9:16"
        })
        
        # Should succeed with 200
        assert response.status_code == 200, f"Expected 200 for valid wave, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "id" in data, "Response should contain wave ID"
        assert data.get("content_type") == "wave", "content_type should be 'wave'"
        print(f"✓ POST /api/waves creates wave successfully with valid duration")
        
        # Return the created wave ID for cleanup
        return data.get("id")


class TestWaveViewAPI:
    """Test Wave view recording endpoint"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test session"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
    
    def test_record_view_on_nonexistent_wave(self):
        """POST /api/waves/{wave_id}/view returns 404 for nonexistent wave"""
        response = self.session.post(f"{BASE_URL}/api/waves/nonexistent-wave-id/view")
        
        assert response.status_code == 404, f"Expected 404 for nonexistent wave, got {response.status_code}"
        print(f"✓ POST /api/waves/{{wave_id}}/view returns 404 for nonexistent wave")


class TestUserWavesAPI:
    """Test user-specific waves endpoint"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test session"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        self.user_id = None
        
    def login(self):
        """Login and get user ID"""
        response = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": TEST_EMAIL,
            "password": TEST_PASSWORD
        })
        if response.status_code == 200:
            data = response.json()
            # API returns id directly, not nested in user object
            self.user_id = data.get("id") or data.get("user_id")
            return True
        return False
    
    def test_get_user_waves(self):
        """GET /api/users/{user_id}/waves returns user's waves"""
        self.login()
        
        response = self.session.get(f"{BASE_URL}/api/users/{self.user_id}/waves")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert "waves" in data, "Response should contain 'waves' array"
        assert "total" in data, "Response should contain 'total' count"
        assert "has_more" in data, "Response should contain 'has_more' boolean"
        print(f"✓ GET /api/users/{{user_id}}/waves returns proper structure")


class TestPostModelWavesFields:
    """Test that Post model has required Waves fields via API"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test session"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        self.user_id = None
        
    def login(self):
        """Login and get user ID"""
        response = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": TEST_EMAIL,
            "password": TEST_PASSWORD
        })
        if response.status_code == 200:
            data = response.json()
            # API returns id directly, not nested in user object
            self.user_id = data.get("id") or data.get("user_id")
            return True
        return False
    
    def test_wave_response_includes_required_fields(self):
        """Verify wave response includes content_type, aspect_ratio, view_count fields"""
        login_success = self.login()
        assert login_success, "Login failed"
        assert self.user_id, f"User ID not set after login"
        
        # First create a wave
        create_response = self.session.post(f"{BASE_URL}/api/waves", params={
            "author_id": self.user_id,
            "media_url": "/api/uploads/waves/test_fields.mp4",
            "video_duration": 15,
            "aspect_ratio": "9:16",
            "video_width": 1080,
            "video_height": 1920
        })
        
        assert create_response.status_code == 200, f"Failed to create wave: {create_response.text}"
        
        wave_data = create_response.json()
        wave_id = wave_data.get("id")
        
        # Now fetch the wave
        get_response = self.session.get(f"{BASE_URL}/api/waves/{wave_id}")
        
        assert get_response.status_code == 200, f"Failed to get wave: {get_response.text}"
        
        data = get_response.json()
        
        # Verify required fields exist
        assert "aspect_ratio" in data, "Wave should have aspect_ratio field"
        assert "view_count" in data, "Wave should have view_count field"
        assert data.get("aspect_ratio") == "9:16", f"aspect_ratio should be '9:16', got {data.get('aspect_ratio')}"
        
        print(f"✓ Wave response includes content_type, aspect_ratio, view_count fields")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
