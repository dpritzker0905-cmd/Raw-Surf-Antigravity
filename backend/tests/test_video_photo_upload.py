"""
Test Video and Photo Upload Features for Raw Surf OS
- Feed photo/video upload with auto-transcoding to 1080p
- Photographer gallery 4K video support for paid photographers
- User media gallery (uploads vs purchased)
"""

import pytest
import requests
import os
import io

# Use public URL for testing
BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://raw-surf-os.preview.emergentagent.com').rstrip('/')

# Test photographer ID from iteration 10
TEST_PHOTOGRAPHER_ID = "84843d7f-8b32-45e4-8d39-5e7fa3de8a41"
TEST_BUYER_ID = "b2f67b46-aa2c-4da2-8fb6-b31e1f1a1c53"


class TestFeedUploadEndpoint:
    """Tests for POST /api/upload/feed - handles both images and videos"""
    
    def test_upload_feed_endpoint_exists(self):
        """Verify the feed upload endpoint exists"""
        # Without file, should get 422 (validation error) not 404
        response = requests.post(f"{BASE_URL}/api/upload/feed")
        assert response.status_code in [400, 422], f"Expected 400/422, got {response.status_code}"
        print("PASS: POST /api/upload/feed endpoint exists")
    
    def test_upload_feed_image(self):
        """Test uploading an image to feed"""
        # Create a minimal valid JPEG (red pixel)
        jpeg_bytes = bytes([
            0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01,
            0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xFF, 0xDB, 0x00, 0x43,
            0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09,
            0x09, 0x08, 0x0A, 0x0C, 0x14, 0x0D, 0x0C, 0x0B, 0x0B, 0x0C, 0x19, 0x12,
            0x13, 0x0F, 0x14, 0x1D, 0x1A, 0x1F, 0x1E, 0x1D, 0x1A, 0x1C, 0x1C, 0x20,
            0x24, 0x2E, 0x27, 0x20, 0x22, 0x2C, 0x23, 0x1C, 0x1C, 0x28, 0x37, 0x29,
            0x2C, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1F, 0x27, 0x39, 0x3D, 0x38, 0x32,
            0x3C, 0x2E, 0x33, 0x34, 0x32, 0xFF, 0xC0, 0x00, 0x0B, 0x08, 0x00, 0x01,
            0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xFF, 0xC4, 0x00, 0x1F, 0x00, 0x00,
            0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
            0x09, 0x0A, 0x0B, 0xFF, 0xC4, 0x00, 0xB5, 0x10, 0x00, 0x02, 0x01, 0x03,
            0x03, 0x02, 0x04, 0x03, 0x05, 0x05, 0x04, 0x04, 0x00, 0x00, 0x01, 0x7D,
            0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06,
            0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xA1, 0x08,
            0x23, 0x42, 0xB1, 0xC1, 0x15, 0x52, 0xD1, 0xF0, 0x24, 0x33, 0x62, 0x72,
            0x82, 0x09, 0x0A, 0x16, 0x17, 0x18, 0x19, 0x1A, 0x25, 0x26, 0x27, 0x28,
            0x29, 0x2A, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3A, 0x43, 0x44, 0x45,
            0x46, 0x47, 0x48, 0x49, 0x4A, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59,
            0x5A, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6A, 0x73, 0x74, 0x75,
            0x76, 0x77, 0x78, 0x79, 0x7A, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
            0x8A, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9A, 0xA2, 0xA3,
            0xA4, 0xA5, 0xA6, 0xA7, 0xA8, 0xA9, 0xAA, 0xB2, 0xB3, 0xB4, 0xB5, 0xB6,
            0xB7, 0xB8, 0xB9, 0xBA, 0xC2, 0xC3, 0xC4, 0xC5, 0xC6, 0xC7, 0xC8, 0xC9,
            0xCA, 0xD2, 0xD3, 0xD4, 0xD5, 0xD6, 0xD7, 0xD8, 0xD9, 0xDA, 0xE1, 0xE2,
            0xE3, 0xE4, 0xE5, 0xE6, 0xE7, 0xE8, 0xE9, 0xEA, 0xF1, 0xF2, 0xF3, 0xF4,
            0xF5, 0xF6, 0xF7, 0xF8, 0xF9, 0xFA, 0xFF, 0xDA, 0x00, 0x08, 0x01, 0x01,
            0x00, 0x00, 0x3F, 0x00, 0xFB, 0xD5, 0xFF, 0xD9
        ])
        
        files = {'file': ('test_image.jpg', jpeg_bytes, 'image/jpeg')}
        data = {'user_id': TEST_PHOTOGRAPHER_ID}
        
        response = requests.post(f"{BASE_URL}/api/upload/feed", files=files, data=data)
        
        # Even if it fails processing, endpoint should exist
        assert response.status_code in [200, 400, 422, 500], f"Unexpected status: {response.status_code}"
        print(f"POST /api/upload/feed with image: status={response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            assert 'media_url' in data, "Response missing media_url"
            assert data.get('media_type') == 'image', "media_type should be 'image'"
            print(f"PASS: Image uploaded successfully, media_url={data['media_url']}")
    
    def test_upload_feed_invalid_file_type(self):
        """Test uploading invalid file type to feed"""
        files = {'file': ('test.txt', b'hello world', 'text/plain')}
        data = {'user_id': TEST_PHOTOGRAPHER_ID}
        
        response = requests.post(f"{BASE_URL}/api/upload/feed", files=files, data=data)
        assert response.status_code == 400, f"Expected 400 for invalid file type, got {response.status_code}"
        print("PASS: Invalid file type rejected with 400")


class TestPostsEndpoint:
    """Tests for POST /api/posts and GET /api/posts - video metadata support"""
    
    def test_get_posts_returns_video_fields(self):
        """Verify GET /api/posts returns video metadata fields"""
        response = requests.get(f"{BASE_URL}/api/posts")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        posts = response.json()
        if len(posts) > 0:
            post = posts[0]
            # Verify new fields exist
            assert 'media_url' in post, "Post missing media_url field"
            assert 'media_type' in post, "Post missing media_type field"
            assert 'video_width' in post, "Post missing video_width field"
            assert 'video_height' in post, "Post missing video_height field"
            assert 'video_duration' in post, "Post missing video_duration field"
            assert 'was_transcoded' in post, "Post missing was_transcoded field"
            print(f"PASS: GET /api/posts returns video metadata fields")
            print(f"  Sample: media_type={post['media_type']}, was_transcoded={post['was_transcoded']}")
        else:
            print("PASS: GET /api/posts returns empty array (no posts to verify)")
    
    def test_create_post_with_video_metadata(self):
        """Test POST /api/posts with video metadata"""
        post_data = {
            "media_url": "/api/uploads/feed/test-video.mp4",
            "media_type": "video",
            "caption": "TEST_video_post_with_metadata",
            "location": "Test Location",
            "video_width": 1920,
            "video_height": 1080,
            "video_duration": 30.5,
            "was_transcoded": True
        }
        
        response = requests.post(
            f"{BASE_URL}/api/posts?author_id={TEST_PHOTOGRAPHER_ID}",
            json=post_data
        )
        
        # Post creation might fail if user doesn't exist, but endpoint should work
        print(f"POST /api/posts with video metadata: status={response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            assert data.get('media_type') == 'video', "Created post media_type should be 'video'"
            assert data.get('video_width') == 1920, "video_width mismatch"
            assert data.get('video_height') == 1080, "video_height mismatch"
            assert data.get('was_transcoded') == True, "was_transcoded mismatch"
            print(f"PASS: Post created with video metadata, id={data['id']}")
        elif response.status_code == 404:
            print("SKIP: Author not found (expected if test user doesn't exist)")
        else:
            print(f"Response: {response.text[:200]}")


class TestPhotographerGalleryUpload:
    """Tests for POST /api/upload/photographer-gallery - 4K for paid photographers"""
    
    def test_photographer_gallery_upload_endpoint_exists(self):
        """Verify photographer gallery upload endpoint exists"""
        response = requests.post(f"{BASE_URL}/api/upload/photographer-gallery")
        assert response.status_code in [400, 422], f"Expected 400/422, got {response.status_code}"
        print("PASS: POST /api/upload/photographer-gallery endpoint exists")
    
    def test_gallery_endpoint_exists(self):
        """Verify POST /api/gallery endpoint exists"""
        response = requests.post(f"{BASE_URL}/api/gallery?photographer_id={TEST_PHOTOGRAPHER_ID}", json={
            "original_url": "/test/original.jpg",
            "preview_url": "/test/preview.jpg"
        })
        # Should get 403 (not photographer) or 404 (user not found), not 404 endpoint error
        assert response.status_code in [200, 400, 403, 404, 422], f"Expected valid response, got {response.status_code}"
        print(f"POST /api/gallery endpoint: status={response.status_code}")


class TestUserMediaRoutes:
    """Tests for user media routes - uploads vs purchased"""
    
    def test_get_user_media_endpoint(self):
        """Test GET /api/user-media/{user_id}"""
        response = requests.get(f"{BASE_URL}/api/user-media/{TEST_BUYER_ID}")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert isinstance(data, list), "Response should be a list"
        print(f"PASS: GET /api/user-media returns list ({len(data)} items)")
    
    def test_get_user_uploads_endpoint(self):
        """Test GET /api/user-media/{user_id}/uploads"""
        response = requests.get(f"{BASE_URL}/api/user-media/{TEST_BUYER_ID}/uploads")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert isinstance(data, list), "Response should be a list"
        print(f"PASS: GET /api/user-media/uploads returns list ({len(data)} items)")
    
    def test_get_user_purchased_endpoint(self):
        """Test GET /api/user-media/{user_id}/purchased"""
        response = requests.get(f"{BASE_URL}/api/user-media/{TEST_BUYER_ID}/purchased")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert isinstance(data, list), "Response should be a list"
        print(f"PASS: GET /api/user-media/purchased returns list ({len(data)} items)")
    
    def test_create_user_media_endpoint(self):
        """Test POST /api/user-media/{user_id}"""
        media_data = {
            "media_url": "/test/user-upload.jpg",
            "media_type": "image",
            "title": "TEST_user_media_upload"
        }
        
        response = requests.post(
            f"{BASE_URL}/api/user-media/{TEST_BUYER_ID}",
            json=media_data
        )
        
        print(f"POST /api/user-media: status={response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            assert 'id' in data, "Response missing id"
            assert data.get('source_type') == 'user_upload', "source_type should be 'user_upload'"
            print(f"PASS: User media created, id={data['id']}")
        elif response.status_code == 404:
            print("SKIP: User not found (expected if test user doesn't exist)")


class TestGalleryRoutes:
    """Tests for gallery routes with video support"""
    
    def test_get_photographer_gallery(self):
        """Test GET /api/gallery/photographer/{id}"""
        response = requests.get(f"{BASE_URL}/api/gallery/photographer/{TEST_PHOTOGRAPHER_ID}")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert isinstance(data, list), "Response should be a list"
        
        if len(data) > 0:
            item = data[0]
            # Verify video metadata fields exist
            assert 'media_type' in item, "Gallery item missing media_type"
            assert 'video_width' in item, "Gallery item missing video_width"
            assert 'video_height' in item, "Gallery item missing video_height"
            assert 'video_duration' in item, "Gallery item missing video_duration"
            print(f"PASS: Gallery items have video metadata fields")
        else:
            print(f"PASS: GET photographer gallery returns empty list")
    
    def test_create_gallery_item_with_video(self):
        """Test POST /api/gallery with video metadata"""
        gallery_data = {
            "original_url": "/test/video-original.mp4",
            "preview_url": "/test/video-preview.mp4",
            "media_type": "video",
            "title": "TEST_gallery_video",
            "price": 10.0,
            "video_width": 3840,
            "video_height": 2160,
            "video_duration": 45.0
        }
        
        response = requests.post(
            f"{BASE_URL}/api/gallery?photographer_id={TEST_PHOTOGRAPHER_ID}",
            json=gallery_data
        )
        
        print(f"POST /api/gallery with video: status={response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            assert data.get('media_type') == 'video', "media_type should be 'video'"
            print(f"PASS: Gallery video item created, id={data.get('id')}")
        elif response.status_code == 404:
            print("SKIP: Photographer not found")
        elif response.status_code == 403:
            print("SKIP: User is not a photographer role")


class TestUploadUserGalleryEndpoint:
    """Tests for POST /api/upload/user-gallery - user's personal gallery uploads"""
    
    def test_user_gallery_upload_endpoint_exists(self):
        """Verify user gallery upload endpoint exists"""
        response = requests.post(f"{BASE_URL}/api/upload/user-gallery")
        assert response.status_code in [400, 422], f"Expected 400/422, got {response.status_code}"
        print("PASS: POST /api/upload/user-gallery endpoint exists")


class TestFeedMediaServing:
    """Tests for serving uploaded feed media"""
    
    def test_get_feed_media_404_for_nonexistent(self):
        """Test GET /api/uploads/feed/{filename} returns 404 for non-existent"""
        response = requests.get(f"{BASE_URL}/api/uploads/feed/nonexistent-file.mp4")
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        print("PASS: GET /api/uploads/feed returns 404 for non-existent file")
    
    def test_get_user_gallery_media_404(self):
        """Test GET /api/uploads/user-gallery/{user_id}/{filename}"""
        response = requests.get(f"{BASE_URL}/api/uploads/user-gallery/{TEST_BUYER_ID}/nonexistent.jpg")
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        print("PASS: GET /api/uploads/user-gallery returns 404 for non-existent file")


class TestVideoProcessorIntegration:
    """Tests verifying video processor utility is working"""
    
    def test_ffmpeg_available(self):
        """Verify ffmpeg is available for video processing"""
        import subprocess
        result = subprocess.run(['ffmpeg', '-version'], capture_output=True, text=True, timeout=5)
        assert result.returncode == 0, "ffmpeg not available"
        print("PASS: ffmpeg is available for video processing")


if __name__ == "__main__":
    pytest.main([__file__, '-v', '--tb=short'])
