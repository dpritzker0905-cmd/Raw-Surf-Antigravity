"""
Test Social Live Delta Changes - Iteration 105
Tests:
1. WebSocket /api/ws/status endpoint returns connection counts
2. WebSocket /ws/conditions endpoint accepts connections
3. condition_reports.py imports and calls broadcast_new_condition_report
4. livekit.py imports and calls broadcast_live_status_change
"""
import pytest
import requests
import os
import asyncio
import websockets
import json

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://raw-surf-os.preview.emergentagent.com')

# Test credentials from iteration_104
TEST_USER = {
    "email": "testlive@surf.com",
    "password": "Test123!",
    "user_id": "864e2d31-55e4-4e7e-ad57-3416d230ea46"
}

PHOTOGRAPHER_USER = {
    "email": "photog@surf.com",
    "password": "Test123!",
    "user_id": "f0512ab9-1000-4d15-9d8a-befa9023f5ba"
}


class TestWebSocketStatus:
    """Test WebSocket status endpoint"""
    
    def test_ws_status_endpoint_returns_connection_counts(self):
        """Test /api/ws/status returns conditions_connections and live_connections"""
        response = requests.get(f"{BASE_URL}/api/ws/status")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert "conditions_connections" in data, "Missing conditions_connections field"
        assert "live_connections" in data, "Missing live_connections field"
        assert isinstance(data["conditions_connections"], int), "conditions_connections should be int"
        assert isinstance(data["live_connections"], int), "live_connections should be int"
        
        print(f"✓ WebSocket status: conditions={data['conditions_connections']}, live={data['live_connections']}")


class TestWebSocketConditionsEndpoint:
    """Test WebSocket /ws/conditions endpoint"""
    
    def test_ws_conditions_endpoint_exists_in_code(self):
        """Verify /ws/conditions WebSocket endpoint is defined in code"""
        with open('/app/backend/routes/websocket.py', 'r') as f:
            content = f.read()
        
        assert '@router.websocket("/ws/conditions")' in content, \
            "WebSocket /ws/conditions endpoint should be defined"
        
        assert 'await ws_manager.connect(websocket, room="conditions")' in content, \
            "Should connect to 'conditions' room"
        
        print("✓ WebSocket /ws/conditions endpoint defined in code")


class TestWebSocketLiveEndpoint:
    """Test WebSocket /ws/live endpoint"""
    
    def test_ws_live_endpoint_exists_in_code(self):
        """Verify /ws/live WebSocket endpoint is defined in code"""
        with open('/app/backend/routes/websocket.py', 'r') as f:
            content = f.read()
        
        assert '@router.websocket("/ws/live")' in content, \
            "WebSocket /ws/live endpoint should be defined"
        
        assert 'await ws_manager.connect(websocket, room="live")' in content, \
            "Should connect to 'live' room"
        
        print("✓ WebSocket /ws/live endpoint defined in code")


class TestConditionReportsBroadcast:
    """Test condition_reports.py imports and calls broadcast_new_condition_report"""
    
    def test_condition_reports_imports_broadcast_function(self):
        """Verify condition_reports.py imports broadcast_new_condition_report"""
        import sys
        sys.path.insert(0, '/app/backend')
        
        # Check the import exists in the file
        with open('/app/backend/routes/condition_reports.py', 'r') as f:
            content = f.read()
        
        assert 'from websocket_manager import broadcast_new_condition_report' in content, \
            "condition_reports.py should import broadcast_new_condition_report"
        
        assert 'await broadcast_new_condition_report(' in content, \
            "condition_reports.py should call broadcast_new_condition_report"
        
        print("✓ condition_reports.py imports and calls broadcast_new_condition_report")
    
    def test_condition_reports_broadcast_call_has_correct_data(self):
        """Verify broadcast_new_condition_report is called with correct data structure"""
        with open('/app/backend/routes/condition_reports.py', 'r') as f:
            content = f.read()
        
        # Check the broadcast call includes expected fields
        expected_fields = [
            '"id":', '"photographer_id":', '"photographer_name":', 
            '"spot_name":', '"media_url":', '"created_at":'
        ]
        
        for field in expected_fields:
            assert field in content, f"Broadcast call should include {field}"
        
        print("✓ broadcast_new_condition_report called with correct data structure")


class TestLiveKitBroadcast:
    """Test livekit.py imports and calls broadcast_live_status_change"""
    
    def test_livekit_imports_broadcast_function(self):
        """Verify livekit.py imports broadcast_live_status_change"""
        with open('/app/backend/routes/livekit.py', 'r') as f:
            content = f.read()
        
        assert 'from websocket_manager import broadcast_live_status_change' in content, \
            "livekit.py should import broadcast_live_status_change"
        
        print("✓ livekit.py imports broadcast_live_status_change")
    
    def test_livekit_broadcasts_on_stream_start(self):
        """Verify broadcast_live_status_change is called when stream starts"""
        with open('/app/backend/routes/livekit.py', 'r') as f:
            content = f.read()
        
        # Check for broadcast call with is_live=True
        assert 'await broadcast_live_status_change(' in content, \
            "livekit.py should call broadcast_live_status_change"
        
        assert 'is_live=True' in content, \
            "livekit.py should broadcast is_live=True on stream start"
        
        print("✓ livekit.py broadcasts on stream start (is_live=True)")
    
    def test_livekit_broadcasts_on_stream_end(self):
        """Verify broadcast_live_status_change is called when stream ends"""
        with open('/app/backend/routes/livekit.py', 'r') as f:
            content = f.read()
        
        assert 'is_live=False' in content, \
            "livekit.py should broadcast is_live=False on stream end"
        
        print("✓ livekit.py broadcasts on stream end (is_live=False)")


class TestWebSocketManager:
    """Test websocket_manager.py has correct broadcast functions"""
    
    def test_websocket_manager_has_broadcast_functions(self):
        """Verify websocket_manager.py exports broadcast functions"""
        with open('/app/backend/websocket_manager.py', 'r') as f:
            content = f.read()
        
        assert 'async def broadcast_new_condition_report(' in content, \
            "websocket_manager.py should have broadcast_new_condition_report function"
        
        assert 'async def broadcast_live_status_change(' in content, \
            "websocket_manager.py should have broadcast_live_status_change function"
        
        print("✓ websocket_manager.py has both broadcast functions")
    
    def test_broadcast_new_condition_report_structure(self):
        """Verify broadcast_new_condition_report sends correct message type"""
        with open('/app/backend/websocket_manager.py', 'r') as f:
            content = f.read()
        
        assert '"type": "new_condition_report"' in content, \
            "broadcast_new_condition_report should send type 'new_condition_report'"
        
        assert 'room="conditions"' in content, \
            "broadcast_new_condition_report should broadcast to 'conditions' room"
        
        print("✓ broadcast_new_condition_report sends correct message structure")
    
    def test_broadcast_live_status_change_structure(self):
        """Verify broadcast_live_status_change sends correct message type"""
        with open('/app/backend/websocket_manager.py', 'r') as f:
            content = f.read()
        
        assert '"type": "live_status_change"' in content, \
            "broadcast_live_status_change should send type 'live_status_change'"
        
        assert 'room="live"' in content, \
            "broadcast_live_status_change should broadcast to 'live' room"
        
        print("✓ broadcast_live_status_change sends correct message structure")


class TestLiveKitActiveStreams:
    """Test LiveKit active streams endpoint"""
    
    def test_active_streams_endpoint(self):
        """Test /api/livekit/active-streams returns stream list"""
        response = requests.get(f"{BASE_URL}/api/livekit/active-streams")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert "streams" in data, "Response should have 'streams' field"
        assert "count" in data, "Response should have 'count' field"
        assert isinstance(data["streams"], list), "streams should be a list"
        
        print(f"✓ Active streams endpoint working: {data['count']} streams")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
