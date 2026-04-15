"""
LiveKit Live Streaming Integration Tests - Iteration 102
Tests for LiveKit Cloud integration for real-time video streaming
"""
import pytest
import requests
import os
import time

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://raw-surf-os.preview.emergentagent.com').rstrip('/')

# Test user credentials from review request
TEST_USER_ID = "864e2d31-55e4-4e7e-ad57-3416d230ea46"
TEST_USER_EMAIL = "testlive@surf.com"
TEST_USER_PASSWORD = "Test123!"


class TestLiveKitStatus:
    """Test LiveKit configuration status endpoint"""
    
    def test_livekit_status_returns_configured(self):
        """Verify LiveKit status endpoint returns configured: true"""
        response = requests.get(f"{BASE_URL}/api/livekit/status")
        assert response.status_code == 200
        
        data = response.json()
        assert "configured" in data
        assert data["configured"] == True
        assert "server_url" in data
        assert data["server_url"] is not None
        assert "livekit.cloud" in data["server_url"]
        print(f"✓ LiveKit status: configured={data['configured']}, server_url={data['server_url']}")


class TestLiveKitStreamLifecycle:
    """Test LiveKit stream start/end lifecycle"""
    
    @pytest.fixture(autouse=True)
    def cleanup_existing_streams(self):
        """Clean up any existing streams for test user before tests"""
        # Check for existing active streams
        response = requests.get(f"{BASE_URL}/api/livekit/active-streams")
        if response.status_code == 200:
            streams = response.json().get("streams", [])
            for stream in streams:
                if stream.get("broadcaster_id") == TEST_USER_ID:
                    # End the stream
                    requests.post(
                        f"{BASE_URL}/api/livekit/end-stream/{stream['id']}?broadcaster_id={TEST_USER_ID}"
                    )
        yield
    
    def test_start_stream_creates_stream_and_returns_token(self):
        """Test that start-stream endpoint creates stream and returns valid token"""
        response = requests.post(
            f"{BASE_URL}/api/livekit/start-stream",
            json={
                "broadcaster_id": TEST_USER_ID,
                "title": "Test LiveKit Stream"
            }
        )
        
        assert response.status_code == 200
        data = response.json()
        
        # Verify response structure
        assert "stream_id" in data
        assert "room_name" in data
        assert "token" in data
        assert "server_url" in data
        
        # Verify token is a valid JWT (has 3 parts separated by dots)
        token = data["token"]
        assert len(token.split(".")) == 3, "Token should be a valid JWT"
        
        # Verify room name format
        assert data["room_name"].startswith("live-")
        assert TEST_USER_ID in data["room_name"]
        
        # Verify server URL
        assert "livekit.cloud" in data["server_url"]
        
        print(f"✓ Stream created: stream_id={data['stream_id']}, room_name={data['room_name']}")
        
        # Store stream_id for cleanup
        self.stream_id = data["stream_id"]
        
        # Clean up - end the stream
        end_response = requests.post(
            f"{BASE_URL}/api/livekit/end-stream/{data['stream_id']}?broadcaster_id={TEST_USER_ID}"
        )
        assert end_response.status_code == 200
    
    def test_active_streams_shows_live_stream(self):
        """Test that active-streams endpoint shows the stream after starting"""
        # Start a stream
        start_response = requests.post(
            f"{BASE_URL}/api/livekit/start-stream",
            json={
                "broadcaster_id": TEST_USER_ID,
                "title": "Active Stream Test"
            }
        )
        assert start_response.status_code == 200
        stream_data = start_response.json()
        
        # Check active streams
        response = requests.get(f"{BASE_URL}/api/livekit/active-streams")
        assert response.status_code == 200
        
        data = response.json()
        assert "streams" in data
        assert "count" in data
        
        # Find our stream
        our_stream = None
        for stream in data["streams"]:
            if stream.get("id") == stream_data["stream_id"]:
                our_stream = stream
                break
        
        assert our_stream is not None, "Our stream should appear in active streams"
        assert our_stream["room_name"] == stream_data["room_name"]
        assert our_stream["broadcaster_id"] == TEST_USER_ID
        
        print(f"✓ Active streams count: {data['count']}, our stream found: {our_stream['id']}")
        
        # Clean up
        requests.post(
            f"{BASE_URL}/api/livekit/end-stream/{stream_data['stream_id']}?broadcaster_id={TEST_USER_ID}"
        )
    
    def test_end_stream_correctly_ends_stream(self):
        """Test that end-stream endpoint correctly ends the stream"""
        # Start a stream
        start_response = requests.post(
            f"{BASE_URL}/api/livekit/start-stream",
            json={
                "broadcaster_id": TEST_USER_ID,
                "title": "End Stream Test"
            }
        )
        assert start_response.status_code == 200
        stream_data = start_response.json()
        stream_id = stream_data["stream_id"]
        
        # Wait a moment
        time.sleep(1)
        
        # End the stream
        end_response = requests.post(
            f"{BASE_URL}/api/livekit/end-stream/{stream_id}?broadcaster_id={TEST_USER_ID}"
        )
        assert end_response.status_code == 200
        
        end_data = end_response.json()
        assert end_data["success"] == True
        assert end_data["stream_id"] == stream_id
        assert "duration_seconds" in end_data
        assert "peak_viewers" in end_data
        
        print(f"✓ Stream ended: duration={end_data['duration_seconds']}s, peak_viewers={end_data['peak_viewers']}")
        
        # Verify stream no longer in active streams
        active_response = requests.get(f"{BASE_URL}/api/livekit/active-streams")
        active_data = active_response.json()
        
        stream_ids = [s["id"] for s in active_data.get("streams", [])]
        assert stream_id not in stream_ids, "Ended stream should not appear in active streams"
    
    def test_cannot_start_duplicate_stream(self):
        """Test that starting a second stream while one is active returns error"""
        # Start first stream
        start_response = requests.post(
            f"{BASE_URL}/api/livekit/start-stream",
            json={
                "broadcaster_id": TEST_USER_ID,
                "title": "First Stream"
            }
        )
        assert start_response.status_code == 200
        stream_data = start_response.json()
        
        # Try to start second stream
        second_response = requests.post(
            f"{BASE_URL}/api/livekit/start-stream",
            json={
                "broadcaster_id": TEST_USER_ID,
                "title": "Second Stream"
            }
        )
        
        # Should return 400 with "Already broadcasting" error
        assert second_response.status_code == 400
        assert "Already broadcasting" in second_response.json().get("detail", "")
        
        print("✓ Duplicate stream correctly rejected with 'Already broadcasting' error")
        
        # Clean up
        requests.post(
            f"{BASE_URL}/api/livekit/end-stream/{stream_data['stream_id']}?broadcaster_id={TEST_USER_ID}"
        )
    
    def test_end_stream_unauthorized_user(self):
        """Test that ending stream with wrong broadcaster_id returns 403"""
        # Start a stream
        start_response = requests.post(
            f"{BASE_URL}/api/livekit/start-stream",
            json={
                "broadcaster_id": TEST_USER_ID,
                "title": "Auth Test Stream"
            }
        )
        assert start_response.status_code == 200
        stream_data = start_response.json()
        
        # Try to end with wrong user
        wrong_user_id = "00000000-0000-0000-0000-000000000000"
        end_response = requests.post(
            f"{BASE_URL}/api/livekit/end-stream/{stream_data['stream_id']}?broadcaster_id={wrong_user_id}"
        )
        
        assert end_response.status_code == 403
        assert "Not authorized" in end_response.json().get("detail", "")
        
        print("✓ Unauthorized end-stream correctly rejected with 403")
        
        # Clean up with correct user
        requests.post(
            f"{BASE_URL}/api/livekit/end-stream/{stream_data['stream_id']}?broadcaster_id={TEST_USER_ID}"
        )


class TestLiveKitTokenGeneration:
    """Test LiveKit token generation endpoint"""
    
    def test_generate_broadcaster_token(self):
        """Test generating a broadcaster token"""
        response = requests.post(
            f"{BASE_URL}/api/livekit/token",
            json={
                "room_name": "test-room-123",
                "participant_identity": TEST_USER_ID,
                "participant_name": "Test Broadcaster",
                "is_broadcaster": True
            }
        )
        
        assert response.status_code == 200
        data = response.json()
        
        assert "token" in data
        assert "server_url" in data
        assert "room_name" in data
        
        # Verify token is valid JWT
        assert len(data["token"].split(".")) == 3
        
        print(f"✓ Broadcaster token generated for room: {data['room_name']}")
    
    def test_generate_viewer_token(self):
        """Test generating a viewer token"""
        response = requests.post(
            f"{BASE_URL}/api/livekit/token",
            json={
                "room_name": "test-room-123",
                "participant_identity": "viewer-123",
                "participant_name": "Test Viewer",
                "is_broadcaster": False
            }
        )
        
        assert response.status_code == 200
        data = response.json()
        
        assert "token" in data
        assert len(data["token"].split(".")) == 3
        
        print(f"✓ Viewer token generated for room: {data['room_name']}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
