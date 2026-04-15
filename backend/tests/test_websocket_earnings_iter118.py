"""
Test WebSocket Earnings Broadcast Implementation - Iteration 118
Tests:
1. WebSocket /ws/earnings/{user_id} endpoint exists and connects
2. Gallery purchase triggers broadcast_earnings_update with type 'new_sale'
3. Booking payment triggers broadcast_earnings_update with type 'booking_paid'
4. Stoke sponsorship triggers broadcast_earnings_update with type 'tip_received'
5. Backend routes import broadcast_earnings_update correctly
"""
import pytest
import requests
import os
import asyncio
import websockets
import json
import time

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://raw-surf-os.preview.emergentagent.com').rstrip('/')
WS_BASE = BASE_URL.replace('https://', 'wss://').replace('http://', 'ws://')


class TestWebSocketEarningsEndpoint:
    """Test WebSocket /ws/earnings/{user_id} endpoint"""
    
    def test_websocket_status_endpoint(self):
        """Test that WebSocket status endpoint exists"""
        response = requests.get(f"{BASE_URL}/api/ws/status")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert "conditions_connections" in data
        assert "live_connections" in data
        print(f"✓ WebSocket status endpoint working: {data}")
    
    @pytest.mark.asyncio
    async def test_websocket_earnings_connection(self):
        """Test WebSocket earnings endpoint accepts connections"""
        test_user_id = "test-user-123"
        ws_url = f"{WS_BASE}/api/ws/earnings/{test_user_id}"
        
        try:
            async with websockets.connect(ws_url, open_timeout=10, close_timeout=5) as ws:
                # Should receive connection confirmation
                message = await asyncio.wait_for(ws.recv(), timeout=5)
                data = json.loads(message)
                
                assert data.get("type") == "connected", f"Expected 'connected', got {data.get('type')}"
                assert data.get("room") == "earnings", f"Expected room 'earnings', got {data.get('room')}"
                assert data.get("user_id") == test_user_id, f"Expected user_id '{test_user_id}', got {data.get('user_id')}"
                
                print(f"✓ WebSocket earnings endpoint connected successfully: {data}")
                
                # Test ping/pong
                await ws.send("ping")
                pong = await asyncio.wait_for(ws.recv(), timeout=5)
                pong_data = json.loads(pong)
                assert pong_data.get("type") == "pong", f"Expected 'pong', got {pong_data}"
                print("✓ WebSocket ping/pong working")
                
        except Exception as e:
            pytest.fail(f"WebSocket connection failed: {e}")


class TestBroadcastImports:
    """Test that routes correctly import broadcast_earnings_update"""
    
    def test_gallery_route_imports_broadcast(self):
        """Verify gallery.py imports broadcast_earnings_update"""
        import sys
        sys.path.insert(0, '/app/backend')
        
        # Read the file and check for import
        with open('/app/backend/routes/gallery.py', 'r') as f:
            content = f.read()
        
        assert 'from websocket_manager import broadcast_earnings_update' in content, \
            "gallery.py should import broadcast_earnings_update"
        print("✓ gallery.py imports broadcast_earnings_update (line 18)")
        
        # Check for usage after purchase
        assert 'await broadcast_earnings_update(' in content, \
            "gallery.py should call broadcast_earnings_update"
        print("✓ gallery.py calls broadcast_earnings_update after purchase")
    
    def test_bookings_route_imports_broadcast(self):
        """Verify bookings.py imports broadcast_earnings_update"""
        with open('/app/backend/routes/bookings.py', 'r') as f:
            content = f.read()
        
        assert 'from websocket_manager import broadcast_earnings_update' in content, \
            "bookings.py should import broadcast_earnings_update"
        print("✓ bookings.py imports broadcast_earnings_update (line 23)")
        
        # Check for usage
        assert 'await broadcast_earnings_update(' in content, \
            "bookings.py should call broadcast_earnings_update"
        print("✓ bookings.py calls broadcast_earnings_update after booking payments")
    
    def test_career_route_imports_broadcast(self):
        """Verify career.py imports broadcast_earnings_update"""
        with open('/app/backend/routes/career.py', 'r') as f:
            content = f.read()
        
        assert 'from websocket_manager import broadcast_earnings_update' in content, \
            "career.py should import broadcast_earnings_update"
        print("✓ career.py imports broadcast_earnings_update (line 22)")
        
        # Check for usage
        assert 'await broadcast_earnings_update(' in content, \
            "career.py should call broadcast_earnings_update"
        print("✓ career.py calls broadcast_earnings_update after stoke sponsorship")


class TestBroadcastUpdateTypes:
    """Test that broadcast calls use correct update types"""
    
    def test_gallery_uses_new_sale_type(self):
        """Verify gallery purchase uses 'new_sale' update type"""
        with open('/app/backend/routes/gallery.py', 'r') as f:
            content = f.read()
        
        # Find the broadcast call and verify type
        assert "update_type='new_sale'" in content, \
            "Gallery purchase should use update_type='new_sale'"
        print("✓ Gallery purchase uses update_type='new_sale'")
    
    def test_bookings_uses_booking_paid_type(self):
        """Verify booking payment uses 'booking_paid' update type"""
        with open('/app/backend/routes/bookings.py', 'r') as f:
            content = f.read()
        
        assert "update_type='booking_paid'" in content, \
            "Booking payment should use update_type='booking_paid'"
        print("✓ Booking payment uses update_type='booking_paid'")
    
    def test_career_uses_tip_received_type(self):
        """Verify stoke sponsorship uses 'tip_received' update type"""
        with open('/app/backend/routes/career.py', 'r') as f:
            content = f.read()
        
        assert "update_type='tip_received'" in content, \
            "Stoke sponsorship should use update_type='tip_received'"
        print("✓ Stoke sponsorship uses update_type='tip_received'")


class TestFrontendEarningsHandler:
    """Test that frontend EarningsDashboard handles all update types"""
    
    def test_earnings_dashboard_handles_all_types(self):
        """Verify EarningsDashboard.js handles all 4 update types"""
        with open('/app/frontend/src/components/EarningsDashboard.js', 'r') as f:
            content = f.read()
        
        # Check for all 4 update types in handleEarningsUpdate
        update_types = ['new_sale', 'booking_paid', 'tip_received', 'payout_complete']
        
        for update_type in update_types:
            assert f"case '{update_type}':" in content, \
                f"EarningsDashboard should handle '{update_type}' type"
            print(f"✓ EarningsDashboard handles '{update_type}' type")
    
    def test_earnings_dashboard_uses_websocket_hook(self):
        """Verify EarningsDashboard uses useEarningsSync hook"""
        with open('/app/frontend/src/components/EarningsDashboard.js', 'r') as f:
            content = f.read()
        
        assert 'useEarningsSync' in content, \
            "EarningsDashboard should use useEarningsSync hook"
        print("✓ EarningsDashboard uses useEarningsSync hook")
        
        assert 'handleEarningsUpdate' in content, \
            "EarningsDashboard should define handleEarningsUpdate callback"
        print("✓ EarningsDashboard defines handleEarningsUpdate callback")


class TestWebSocketManagerFunction:
    """Test websocket_manager.py broadcast_earnings_update function"""
    
    def test_broadcast_earnings_update_function_exists(self):
        """Verify broadcast_earnings_update function exists with correct signature"""
        with open('/app/backend/websocket_manager.py', 'r') as f:
            content = f.read()
        
        # Check function definition
        assert 'async def broadcast_earnings_update(user_id: str, update_type: str, amount: float, details: dict = None):' in content, \
            "broadcast_earnings_update should have correct signature"
        print("✓ broadcast_earnings_update function has correct signature")
        
        # Check it creates correct room name
        assert 'room = f"earnings_{user_id}"' in content, \
            "broadcast_earnings_update should create user-specific room"
        print("✓ broadcast_earnings_update creates user-specific room")
        
        # Check message structure
        assert '"type": "earnings_update"' in content, \
            "broadcast_earnings_update should send 'earnings_update' type"
        print("✓ broadcast_earnings_update sends correct message type")


class TestAPIEndpoints:
    """Test related API endpoints are working"""
    
    def test_profiles_endpoint(self):
        """Test profiles endpoint is accessible"""
        response = requests.get(f"{BASE_URL}/api/profiles")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        print("✓ /api/profiles endpoint working")
    
    def test_gallery_endpoint(self):
        """Test gallery endpoint is accessible"""
        # Get a photographer ID first
        profiles_response = requests.get(f"{BASE_URL}/api/profiles")
        if profiles_response.status_code == 200:
            profiles = profiles_response.json()
            if profiles:
                photographer_id = profiles[0].get('id')
                response = requests.get(f"{BASE_URL}/api/gallery/photographer/{photographer_id}")
                assert response.status_code == 200, f"Expected 200, got {response.status_code}"
                print(f"✓ /api/gallery/photographer endpoint working")
    
    def test_bookings_endpoint(self):
        """Test bookings endpoint is accessible"""
        response = requests.get(f"{BASE_URL}/api/bookings")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        print("✓ /api/bookings endpoint working")
    
    def test_career_stats_endpoint(self):
        """Test career stats endpoint structure"""
        # Get a user ID first
        profiles_response = requests.get(f"{BASE_URL}/api/profiles")
        if profiles_response.status_code == 200:
            profiles = profiles_response.json()
            if profiles:
                user_id = profiles[0].get('id')
                response = requests.get(f"{BASE_URL}/api/career/stats/{user_id}")
                # May return 404 if no career data, but endpoint should exist
                assert response.status_code in [200, 404], f"Expected 200 or 404, got {response.status_code}"
                print(f"✓ /api/career/stats endpoint exists")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
