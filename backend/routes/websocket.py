"""
WebSocket Routes for Real-time Updates
"""
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
import logging

from websocket_manager import ws_manager

logger = logging.getLogger(__name__)
router = APIRouter(tags=["websocket"])


@router.websocket("/ws/conditions")
async def websocket_conditions(websocket: WebSocket):
    """
    WebSocket endpoint for real-time Conditions Explorer updates
    Clients receive new condition reports as they're posted
    """
    await ws_manager.connect(websocket, room="conditions")
    
    try:
        # Send initial connection confirmation
        await ws_manager.send_personal(websocket, {
            "type": "connected",
            "room": "conditions",
            "message": "Connected to conditions feed"
        })
        
        # Keep connection alive and listen for client messages
        while True:
            try:
                # Wait for any client message (ping/pong, etc)
                data = await websocket.receive_text()
                
                # Handle ping
                if data == "ping":
                    await ws_manager.send_personal(websocket, {"type": "pong"})
                    
            except WebSocketDisconnect:
                break
                
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
    finally:
        ws_manager.disconnect(websocket, room="conditions")


@router.websocket("/ws/live")
async def websocket_live(websocket: WebSocket):
    """
    WebSocket endpoint for real-time live stream status updates
    Clients receive notifications when users go live or end streams
    """
    await ws_manager.connect(websocket, room="live")
    
    try:
        # Send initial connection confirmation
        await ws_manager.send_personal(websocket, {
            "type": "connected",
            "room": "live",
            "message": "Connected to live status feed"
        })
        
        # Keep connection alive
        while True:
            try:
                data = await websocket.receive_text()
                
                if data == "ping":
                    await ws_manager.send_personal(websocket, {"type": "pong"})
                    
            except WebSocketDisconnect:
                break
                
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
    finally:
        ws_manager.disconnect(websocket, room="live")


@router.websocket("/ws/earnings/{user_id}")
async def websocket_earnings(websocket: WebSocket, user_id: str):
    """
    WebSocket endpoint for real-time earnings updates
    User receives notifications when they earn credits from sales/donations
    """
    room = f"earnings_{user_id}"
    await ws_manager.connect(websocket, room=room)
    
    try:
        await ws_manager.send_personal(websocket, {
            "type": "connected",
            "room": "earnings",
            "user_id": user_id,
            "message": "Connected to earnings feed"
        })
        
        while True:
            try:
                data = await websocket.receive_text()
                if data == "ping":
                    await ws_manager.send_personal(websocket, {"type": "pong"})
            except WebSocketDisconnect:
                break
                
    except Exception as e:
        logger.error(f"Earnings WebSocket error for {user_id}: {e}")
    finally:
        ws_manager.disconnect(websocket, room=room)


@router.get("/ws/status")
async def websocket_status():
    """Get current WebSocket connection counts"""
    return {
        "conditions_connections": ws_manager.get_connection_count("conditions"),
        "live_connections": ws_manager.get_connection_count("live")
    }


@router.websocket("/ws/lineup/{lineup_id}")
async def websocket_lineup(websocket: WebSocket, lineup_id: str):
    """
    WebSocket endpoint for real-time lineup updates
    Crew members receive notifications when:
    - New crew joins
    - Crew member leaves/drops out
    - Lineup is locked or cancelled
    - Payment is received
    """
    room = f"lineup_{lineup_id}"
    await ws_manager.connect(websocket, room=room)
    
    try:
        await ws_manager.send_personal(websocket, {
            "type": "connected",
            "room": "lineup",
            "lineup_id": lineup_id,
            "message": "Connected to lineup updates"
        })
        
        while True:
            try:
                data = await websocket.receive_text()
                if data == "ping":
                    await ws_manager.send_personal(websocket, {"type": "pong"})
            except WebSocketDisconnect:
                break
                
    except Exception as e:
        logger.error(f"Lineup WebSocket error for {lineup_id}: {e}")
    finally:
        ws_manager.disconnect(websocket, room=room)


@router.websocket("/ws/user/{user_id}")
async def websocket_user(websocket: WebSocket, user_id: str):
    """
    WebSocket endpoint for user-specific notifications
    Used for personal notifications like "Your crew member left"
    """
    room = f"user_{user_id}"
    await ws_manager.connect(websocket, room=room)
    
    try:
        await ws_manager.send_personal(websocket, {
            "type": "connected",
            "room": "user",
            "user_id": user_id,
            "message": "Connected to personal notifications"
        })
        
        while True:
            try:
                data = await websocket.receive_text()
                if data == "ping":
                    await ws_manager.send_personal(websocket, {"type": "pong"})
            except WebSocketDisconnect:
                break
                
    except Exception as e:
        logger.error(f"User WebSocket error for {user_id}: {e}")
    finally:
        ws_manager.disconnect(websocket, room=room)


@router.websocket("/ws/photographer/{photographer_id}/activity")
async def websocket_photographer_activity(websocket: WebSocket, photographer_id: str):
    """
    WebSocket endpoint for real-time photographer activity notifications
    Photographer receives live updates when surfers:
    - View their gallery items
    - Favorite their photos
    - Purchase their photos
    - Request edits
    """
    room = f"photographer_activity_{photographer_id}"
    await ws_manager.connect(websocket, room=room)
    
    try:
        await ws_manager.send_personal(websocket, {
            "type": "connected",
            "room": "photographer_activity",
            "photographer_id": photographer_id,
            "message": "Connected to activity feed"
        })
        
        while True:
            try:
                data = await websocket.receive_text()
                if data == "ping":
                    await ws_manager.send_personal(websocket, {"type": "pong"})
            except WebSocketDisconnect:
                break
                
    except Exception as e:
        logger.error(f"Photographer activity WebSocket error for {photographer_id}: {e}")
    finally:
        ws_manager.disconnect(websocket, room=room)


@router.websocket("/ws/call/{user_id}")
async def websocket_call(websocket: WebSocket, user_id: str):
    """
    WebSocket endpoint for WebRTC call signaling.
    
    Handles:
    - call_offer: Caller sends SDP offer to target
    - call_answer: Callee sends SDP answer back  
    - ice_candidate: Exchange ICE candidates for NAT traversal
    - call_decline: Callee rejects the call
    - call_end: Either party ends the call
    - call_busy: Target is already in a call
    
    Each user connects to their own room: call_{user_id}
    Messages are forwarded to the target user's room.
    """
    room = f"call_{user_id}"
    await ws_manager.connect(websocket, room=room)
    
    try:
        await ws_manager.send_personal(websocket, {
            "type": "connected",
            "room": "call",
            "user_id": user_id,
            "message": "Connected to call signaling"
        })
        
        while True:
            try:
                import json
                data = await websocket.receive_text()
                
                if data == "ping":
                    await ws_manager.send_personal(websocket, {"type": "pong"})
                    continue
                
                message = json.loads(data)
                msg_type = message.get("type")
                target_user_id = message.get("target_user_id")
                
                if not target_user_id:
                    await ws_manager.send_personal(websocket, {
                        "type": "error",
                        "message": "target_user_id required"
                    })
                    continue
                
                # Forward signaling messages to target user's call room
                target_room = f"call_{target_user_id}"
                
                if msg_type in ("call_offer", "call_answer", "ice_candidate", 
                                "call_decline", "call_end", "call_busy"):
                    # Forward the message to the target user
                    await ws_manager.broadcast(message, room=target_room)
                    logger.info(f"Call signal '{msg_type}' from {user_id} -> {target_user_id}")
                else:
                    await ws_manager.send_personal(websocket, {
                        "type": "error",
                        "message": f"Unknown message type: {msg_type}"
                    })
                    
            except WebSocketDisconnect:
                break
            except json.JSONDecodeError:
                await ws_manager.send_personal(websocket, {
                    "type": "error", 
                    "message": "Invalid JSON"
                })
                
    except Exception as e:
        logger.error(f"Call WebSocket error for {user_id}: {e}")
    finally:
        ws_manager.disconnect(websocket, room=room)
