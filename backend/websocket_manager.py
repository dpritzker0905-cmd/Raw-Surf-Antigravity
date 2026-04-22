"""
WebSocket Manager for Real-time Updates
Handles connections for Conditions Explorer feed
"""
from fastapi import WebSocket, WebSocketDisconnect
from typing import Dict, Set, List
import json
import logging

logger = logging.getLogger(__name__)


class ConnectionManager:
    """
    Manages WebSocket connections for real-time updates
    Supports multiple "rooms" for different data streams
    """
    
    def __init__(self):
        # room_name -> set of websockets
        self.active_connections: Dict[str, Set[WebSocket]] = {}
        # ── Presence tracking ─────────────────────────────────────
        # user_id -> last heartbeat timestamp (seconds since epoch)
        self.online_users: Dict[str, float] = {}
        # user_id -> set of websockets subscribed to presence updates
        self.presence_subscribers: Dict[str, WebSocket] = {}
    
    async def connect(self, websocket: WebSocket, room: str = "conditions"):
        """Accept and track a new WebSocket connection"""
        await websocket.accept()
        
        if room not in self.active_connections:
            self.active_connections[room] = set()
        
        self.active_connections[room].add(websocket)
        logger.info(f"WebSocket connected to room '{room}'. Total in room: {len(self.active_connections[room])}")
    
    def disconnect(self, websocket: WebSocket, room: str = "conditions"):
        """Remove a WebSocket connection"""
        if room in self.active_connections:
            self.active_connections[room].discard(websocket)
            logger.info(f"WebSocket disconnected from room '{room}'. Total in room: {len(self.active_connections[room])}")
    
    async def broadcast(self, message: dict, room: str = "conditions"):
        """Broadcast a message to all connections in a room"""
        if room not in self.active_connections:
            return
        
        disconnected = []
        for connection in self.active_connections[room]:
            try:
                await connection.send_json(message)
            except Exception as e:
                logger.warning(f"Failed to send to websocket: {e}")
                disconnected.append(connection)
        
        # Clean up disconnected sockets
        for conn in disconnected:
            self.active_connections[room].discard(conn)
    
    async def send_personal(self, websocket: WebSocket, message: dict):
        """Send a message to a specific connection"""
        try:
            await websocket.send_json(message)
        except Exception as e:
            logger.warning(f"Failed to send personal message: {e}")
    
    def get_connection_count(self, room: str = "conditions") -> int:
        """Get the number of active connections in a room"""
        return len(self.active_connections.get(room, set()))

    # ── Presence methods ───────────────────────────────────────────
    def mark_online(self, user_id: str):
        """Mark a user as online (called on heartbeat)"""
        import time
        self.online_users[user_id] = time.time()

    def mark_offline(self, user_id: str):
        """Remove a user from online tracking"""
        self.online_users.pop(user_id, None)

    def get_online_user_ids(self, timeout_seconds: int = 90) -> List[str]:
        """Get list of user IDs that sent a heartbeat within timeout"""
        import time
        now = time.time()
        # Clean up stale entries
        stale = [uid for uid, ts in self.online_users.items() if now - ts > timeout_seconds]
        for uid in stale:
            del self.online_users[uid]
        return list(self.online_users.keys())

    def is_user_online(self, user_id: str, timeout_seconds: int = 90) -> bool:
        """Check if a specific user is currently online"""
        import time
        ts = self.online_users.get(user_id)
        if ts is None:
            return False
        return (time.time() - ts) < timeout_seconds


# Global connection manager instance
ws_manager = ConnectionManager()


async def broadcast_new_condition_report(report_data: dict):
    """
    Broadcast a new condition report to all connected clients
    Called from condition_reports.py when a new report is created
    """
    message = {
        "type": "new_condition_report",
        "data": report_data
    }
    await ws_manager.broadcast(message, room="conditions")
    logger.info(f"Broadcasted new condition report to {ws_manager.get_connection_count('conditions')} clients")


async def broadcast_live_status_change(user_id: str, is_live: bool, stream_data: dict = None):
    """
    Broadcast when a user goes live or ends their stream
    Called from livekit.py
    """
    message = {
        "type": "live_status_change",
        "data": {
            "user_id": user_id,
            "is_live": is_live,
            "stream": stream_data
        }
    }
    await ws_manager.broadcast(message, room="live")
    logger.info(f"Broadcasted live status change for {user_id}: is_live={is_live}")


async def broadcast_earnings_update(user_id: str, update_type: str, amount: float, details: dict = None):
    """
    Broadcast earnings update to a specific user's earnings channel
    Called from gallery.py, dispatch.py, bookings.py when a sale/payment occurs
    
    update_type: 'new_sale', 'payout_complete', 'tip_received', 'booking_paid'
    """
    room = f"earnings_{user_id}"
    message = {
        "type": "earnings_update",
        "data": {
            "type": update_type,
            "amount": amount,
            "details": details or {}
        }
    }
    await ws_manager.broadcast(message, room=room)
    logger.info(f"Broadcasted earnings update for {user_id}: {update_type} ${amount}")


async def broadcast_lineup_update(lineup_id: str, update_type: str, data: dict = None):
    """
    Broadcast lineup updates to all participants in a lineup
    Called from bookings.py when lineup state changes
    
    update_type: 
    - 'crew_joined' - New crew member joined
    - 'crew_left' - Crew member left/dropped out
    - 'lineup_locked' - Captain locked the lineup
    - 'lineup_cancelled' - Lineup was cancelled
    - 'payment_received' - Crew member paid their share
    - 'replacement_needed' - Crew dropped, looking for replacement
    """
    room = f"lineup_{lineup_id}"
    message = {
        "type": "lineup_update",
        "data": {
            "update_type": update_type,
            "lineup_id": lineup_id,
            **(data or {})
        }
    }
    await ws_manager.broadcast(message, room=room)
    logger.info(f"Broadcasted lineup update for {lineup_id}: {update_type}")


async def notify_lineup_participants(participant_ids: list, notification_type: str, data: dict = None):
    """
    Send notifications to specific lineup participants
    Used for personal notifications like "Your crew member left"
    """
    for user_id in participant_ids:
        room = f"user_{user_id}"
        message = {
            "type": "lineup_notification",
            "data": {
                "notification_type": notification_type,
                **(data or {})
            }
        }
        await ws_manager.broadcast(message, room=room)
    logger.info(f"Sent lineup notification to {len(participant_ids)} users: {notification_type}")


async def broadcast_to_user(user_id: str, notification_type: str, data: dict = None):
    """
    Broadcast a notification to a specific user's personal channel
    Used for individual notifications like session status changes
    
    notification_type: 'lineup_notification', 'booking_update', etc.
    """
    room = f"user_{user_id}"
    message = {
        "type": notification_type,
        "data": data or {}
    }
    await ws_manager.broadcast(message, room=room)
    logger.info(f"Broadcasted {notification_type} to user {user_id}")
