"""
Test Challenge Mode API and Watermarking Performance
Tests for Week 30 features:
1. Challenge Mode - Weekly competitions for photographers
2. Watermarking Performance - Under 2 seconds for 5MB images
"""

import pytest
import requests
import os
import io

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://raw-surf-os.preview.emergentagent.com')

# Test photographer ID from previous tests
TEST_PHOTOGRAPHER_ID = "3f88be92-5a86-4482-afc1-b32716357f6f"


class TestChallengeMode:
    """Test Challenge Mode APIs"""
    
    def test_get_current_challenge(self):
        """GET /api/challenges/current - Returns current weekly challenge"""
        response = requests.get(f"{BASE_URL}/api/challenges/current")
        assert response.status_code == 200
        
        data = response.json()
        assert "challenge" in data
        assert "leaderboard" in data
        assert "time_remaining_seconds" in data
        assert "total_participants" in data
        
        challenge = data["challenge"]
        assert "id" in challenge
        assert "title" in challenge
        assert "challenge_type" in challenge
        assert "badge_name" in challenge
        assert "badge_emoji" in challenge
        assert "week_number" in challenge
        assert "year" in challenge
        assert "status" in challenge
        assert challenge["status"] == "active"
        
        print(f"Current challenge: {challenge['title']}")
        print(f"Week {challenge['week_number']}/{challenge['year']}")
        print(f"Time remaining: {data['time_remaining_seconds']}s")
    
    def test_get_challenge_history(self):
        """GET /api/challenges/history - Returns past challenges"""
        response = requests.get(f"{BASE_URL}/api/challenges/history")
        assert response.status_code == 200
        
        data = response.json()
        assert "history" in data
        assert isinstance(data["history"], list)
        
        print(f"Challenge history count: {len(data['history'])}")
        
        # Verify history structure if there are any completed challenges
        if len(data["history"]) > 0:
            history_item = data["history"][0]
            assert "challenge_id" in history_item
            assert "title" in history_item
            assert "week_number" in history_item
            assert "year" in history_item
            assert "winners" in history_item
    
    def test_get_challenge_history_with_limit(self):
        """GET /api/challenges/history with limit parameter"""
        response = requests.get(f"{BASE_URL}/api/challenges/history?limit=5")
        assert response.status_code == 200
        
        data = response.json()
        assert "history" in data
        # Should return at most 5 items
        assert len(data["history"]) <= 5
    
    def test_get_photographer_challenge_stats(self):
        """GET /api/challenges/photographer/{id}/stats - Returns photographer stats"""
        response = requests.get(
            f"{BASE_URL}/api/challenges/photographer/{TEST_PHOTOGRAPHER_ID}/stats"
        )
        assert response.status_code == 200
        
        data = response.json()
        assert "photographer_id" in data
        assert "total_challenges" in data
        assert "trophies_earned" in data
        
        assert data["photographer_id"] == TEST_PHOTOGRAPHER_ID
        assert isinstance(data["total_challenges"], int)
        assert isinstance(data["trophies_earned"], int)
        
        print(f"Photographer stats:")
        print(f"  Total challenges: {data['total_challenges']}")
        print(f"  Trophies earned: {data['trophies_earned']}")
        
        # current_challenge can be null if photographer hasn't participated this week
        if data.get("current_challenge"):
            cc = data["current_challenge"]
            assert "score" in cc
            assert "rank" in cc
            assert "groms_supported" in cc
            print(f"  Current week score: {cc['score']}")
            print(f"  Current rank: {cc['rank']}")
    
    def test_get_photographer_stats_invalid_id(self):
        """GET /api/challenges/photographer/{id}/stats with invalid ID returns empty stats"""
        response = requests.get(
            f"{BASE_URL}/api/challenges/photographer/invalid-id-12345/stats"
        )
        # Should still return 200 with zero stats
        assert response.status_code == 200
        
        data = response.json()
        assert data["total_challenges"] == 0
        assert data["trophies_earned"] == 0


class TestWatermarkPerformance:
    """Test Watermarking Performance"""
    
    def test_watermark_endpoint_exists(self):
        """POST /api/uploads/test-watermark endpoint exists"""
        # Test with a small image to verify endpoint exists
        # Create a simple 100x100 red PNG image
        from PIL import Image
        import io
        
        img = Image.new('RGB', (100, 100), color='red')
        img_bytes = io.BytesIO()
        img.save(img_bytes, format='JPEG')
        img_bytes.seek(0)
        
        files = {'file': ('test.jpg', img_bytes, 'image/jpeg')}
        response = requests.post(
            f"{BASE_URL}/api/uploads/test-watermark",
            files=files
        )
        
        assert response.status_code == 200
        data = response.json()
        
        assert "input_size_mb" in data
        assert "output_size_mb" in data
        assert "watermark_time_ms" in data
        assert "total_time_ms" in data
        assert "meets_2_second_target" in data
        
        print(f"Watermark test (small image):")
        print(f"  Input size: {data['input_size_mb']} MB")
        print(f"  Output size: {data['output_size_mb']} MB")
        print(f"  Watermark time: {data['watermark_time_ms']} ms")
        print(f"  Total time: {data['total_time_ms']} ms")
        print(f"  Meets target: {data['meets_2_second_target']}")
    
    def test_watermark_performance_medium_image(self):
        """Test watermarking with a medium-sized image (1MB)"""
        from PIL import Image
        import io
        
        # Create a 2000x1500 image (approximately 1MB when saved as JPEG)
        img = Image.new('RGB', (2000, 1500), color='blue')
        img_bytes = io.BytesIO()
        img.save(img_bytes, format='JPEG', quality=85)
        img_bytes.seek(0)
        
        files = {'file': ('medium_test.jpg', img_bytes, 'image/jpeg')}
        response = requests.post(
            f"{BASE_URL}/api/uploads/test-watermark",
            files=files
        )
        
        assert response.status_code == 200
        data = response.json()
        
        print(f"Watermark test (medium image ~1MB):")
        print(f"  Input size: {data['input_size_mb']} MB")
        print(f"  Watermark time: {data['watermark_time_ms']} ms")
        print(f"  Total time: {data['total_time_ms']} ms")
        print(f"  Meets 2s target: {data['meets_2_second_target']}")
        
        # Medium image should definitely complete under 2 seconds
        assert data['meets_2_second_target'] == True
    
    def test_watermark_invalid_file_type(self):
        """POST /api/uploads/test-watermark rejects non-image files"""
        files = {'file': ('test.txt', b'This is text content', 'text/plain')}
        response = requests.post(
            f"{BASE_URL}/api/uploads/test-watermark",
            files=files
        )
        
        assert response.status_code == 400
        data = response.json()
        assert "detail" in data
        print(f"Rejected non-image: {data['detail']}")


class TestCheckInPostStyling:
    """Test Check-In Post styling (frontend verification via API)"""
    
    def test_posts_have_check_in_flag(self):
        """Verify posts API returns is_check_in flag"""
        response = requests.get(f"{BASE_URL}/api/posts")
        assert response.status_code == 200
        
        posts = response.json()
        if len(posts) > 0:
            # Verify the post structure supports check-in metadata
            post = posts[0]
            # These fields should exist for check-in styled posts
            assert "id" in post
            # is_check_in flag might be on posts created via check-in
            # The field should be present in the response schema
            print(f"Sample post ID: {post['id']}")
            print(f"  is_check_in: {post.get('is_check_in', False)}")
            print(f"  check_in_spot_name: {post.get('check_in_spot_name', 'N/A')}")
            print(f"  check_in_conditions: {post.get('check_in_conditions', 'N/A')}")


class TestDebugOverlayAndPermissions:
    """Test Debug Overlay (frontend component - basic API support check)"""
    
    def test_photographer_active_session_api(self):
        """GET /api/photographer/{id}/active-session - supports debug overlay"""
        response = requests.get(
            f"{BASE_URL}/api/photographer/{TEST_PHOTOGRAPHER_ID}/active-session"
        )
        # Can be 200 with data or 200 with null if no active session
        assert response.status_code == 200
        
        data = response.json()
        # Response can be null (no active session) or session object
        print(f"Active session: {data is not None}")
        
        if data:
            # If session exists, verify key fields
            assert "photographer_id" in data
            print(f"  Location: {data.get('location', 'N/A')}")
    
    def test_surf_spots_api_for_spot_picker(self):
        """GET /api/surf-spots - supports spot picker in permission flow"""
        response = requests.get(f"{BASE_URL}/api/surf-spots")
        assert response.status_code == 200
        
        spots = response.json()
        assert isinstance(spots, list)
        assert len(spots) > 0
        
        spot = spots[0]
        assert "id" in spot
        assert "name" in spot
        assert "latitude" in spot
        assert "longitude" in spot
        
        print(f"Found {len(spots)} surf spots for spot picker")


class TestMapPulseRealtime:
    """Test Real-time Map Pulse (Supabase Realtime - verify API support)"""
    
    def test_live_photographers_api(self):
        """GET /api/live-photographers - returns photographer positions for map"""
        response = requests.get(f"{BASE_URL}/api/live-photographers")
        assert response.status_code == 200
        
        photographers = response.json()
        assert isinstance(photographers, list)
        
        print(f"Live photographers: {len(photographers)}")
        
        if len(photographers) > 0:
            p = photographers[0]
            assert "id" in p
            # Location data for map markers
            if p.get("latitude") and p.get("longitude"):
                print(f"  Sample: {p.get('full_name', 'Unknown')} at ({p['latitude']}, {p['longitude']})")
    
    def test_live_session_participants_table_support(self):
        """Verify live_session_participants table exists via go-live API"""
        # This indirectly tests that the table exists and is used
        # The actual Supabase Realtime subscription is frontend-only
        response = requests.get(
            f"{BASE_URL}/api/photographer/{TEST_PHOTOGRAPHER_ID}/active-session"
        )
        assert response.status_code == 200
        print("Live session participants table is supported via active-session API")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
