"""
WebSocket Routes for Real-time Updates
"""
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Header, HTTPException, status
import logging
import json
import asyncio
import os

from websocket_manager import ws_manager
from core.security import verify_token, dev_identity_allowed

logger = logging.getLogger(__name__)
router = APIRouter(tags=["websocket"])

INTERNAL_TOKEN = os.getenv("INTERNAL_BROADCAST_TOKEN", "super_secret_internal_token_123")


async def reject_websocket(websocket: WebSocket, reason: str) -> None:
    """
    Answer an unauthorised handshake with a close frame.

    The socket is NEVER accepted first: an unauthenticated connection must not reach an accepted
    state even briefly. Closing while the connection is still CONNECTING is the ASGI way to refuse
    a handshake, and the server turns it into an HTTP 403 on the upgrade request.
    """
    try:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason=reason)
    except Exception as e:
        # The peer can vanish between the failed auth and the close. Nothing to do, but never let
        # this become the exception that leaves the handshake unanswered all over again.
        logger.debug(f"WebSocket reject close failed (peer likely gone): {e}")


async def verify_websocket_auth(websocket: WebSocket, expected_user_id: str) -> bool:
    """
    Authenticate a WebSocket handshake via the `token` query parameter.

    Uses core/security 'verify_token' and compares the decoded 'sub' with expected_user_id.

    Returns True when the caller may proceed. Returns False *having already closed the socket*
    when it may not — callers MUST `return` immediately on False and must not accept.

    ⛔ THIS FUNCTION MUST NOT RAISE HTTPException, AND NEITHER MUST ANY WEBSOCKET ROUTE.
    Measured on a Linux runner 2026-08-06 (CI runs 31070627589 / 31071044451) under the versions
    requirements.txt actually resolves — starlette 0.37.2, fastapi 0.110.1 — an HTTPException
    raised from a websocket route is swallowed by starlette's websocket exception plumbing and
    the app returns having sent NO ASGI message at all: no accept, no close, no denial response.
    The handshake is simply never answered.
      · Controls in that same run: a public route accepted, an unknown route closed with 1000, an
        authorised connect accepted. ONLY the rejection path went silent, so this is the auth
        path and not the environment.
      · A real uvicorn server does catch it — "ASGI callable returned without sending handshake"
        — and answers HTTP 500. So production refuses the connection, but by accident, via the
        server's safety net, reporting a SERVER error for what is a CLIENT auth failure.
      · An ASGI consumer without that net hangs forever: starlette's own TestClient sat in
        WebSocketTestSession.__enter__ until the 120 s pytest-timeout, 5 params at a time.
    ★ Closing explicitly is version-independent and does not depend on any exception handler
      being registered for the websocket scope. Do not "simplify" this back into a raise.
    """
    token = websocket.query_params.get("token")
    if not token:
        # ⛔ THIS LIST IS MATCHED AGAINST THE URL PATH PARAMETER, NOT AN AUTHENTICATED IDENTITY, so
        # ungated it lets anyone open a private room by simply naming one of these ids in the URL.
        # Measured against the live backend 2026-08-06, BEFORE this gate: all 12 combinations of
        # {dev-mock-user-id, test-surfer-id, admin-user-id} x {earnings, user, presence, call}
        # OPENED with no token, while the control id `not-a-bypass-id-999` was refused 403 on all
        # four. `presence` additionally marks that user ONLINE and broadcasts it to everyone else.
        # ⇒ `dev_identity_allowed()` fails CLOSED; see its docstring for why the old
        #   "is it production?" phrasing was the wrong question.
        if (expected_user_id in ("dev-mock-user-id", "test-surfer-id", "admin-user-id")
                and dev_identity_allowed()) or os.getenv("BYPASS_WS_AUTH") == "true":
            logger.info(f"WebSocket auth bypassed for development/testing user: {expected_user_id}")
            return True
        logger.warning(f"WebSocket auth failed: missing token query param for user_id {expected_user_id}")
        await reject_websocket(websocket, "Authentication token required")
        return False

    try:
        payload = verify_token(token)
        sub = payload.get("sub")
    except HTTPException as e:
        logger.warning(f"WebSocket auth failed: token rejected for {expected_user_id}: {e.detail}")
        await reject_websocket(websocket, "Authentication failed")
        return False
    except Exception as e:
        logger.error(f"WebSocket auth unexpected error: {e}")
        await reject_websocket(websocket, "Authentication failed")
        return False

    if not sub or sub != expected_user_id:
        logger.warning(f"WebSocket auth failed: token subject {sub} does not match expected {expected_user_id}")
        await reject_websocket(websocket, "Access forbidden")
        return False

    return True


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


@router.websocket("/ws/admin/events")
async def websocket_admin_events(websocket: WebSocket):
    """
    WebSocket endpoint for real-time admin event updates
    """
    await ws_manager.connect(websocket, room="admin_events")
    try:
        await ws_manager.send_personal(websocket, {
            "type": "connected",
            "room": "admin_events",
            "message": "Connected to admin events feed"
        })
        while True:
            try:
                data = await websocket.receive_text()
                if data == "ping":
                    await ws_manager.send_personal(websocket, {"type": "pong"})
            except WebSocketDisconnect:
                break
    except Exception as e:
        logger.error(f"Admin events WebSocket error: {e}")
    finally:
        ws_manager.disconnect(websocket, room="admin_events")


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
    if not await verify_websocket_auth(websocket, user_id):
        return
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
    if not await verify_websocket_auth(websocket, user_id):
        return
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
    if not await verify_websocket_auth(websocket, photographer_id):
        return
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
    if not await verify_websocket_auth(websocket, user_id):
        return
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
                                "call_decline", "call_end", "call_busy",
                                "call_accepted_elsewhere"):
                    # Forward the message to the target user
                    target_conn_count = ws_manager.get_connection_count(target_room)
                    logger.info(f"Call signal '{msg_type}' from {user_id} -> {target_user_id} (target room '{target_room}' has {target_conn_count} connections)")
                    if target_conn_count == 0:
                        logger.warning(f"⚠️ Target user {target_user_id} has NO active call WebSocket connection! Call will not be delivered.")
                        # Notify caller so they can retry
                        if msg_type == "call_offer":
                            await ws_manager.send_personal(websocket, {
                                "type": "call_target_offline",
                                "target_user_id": target_user_id,
                                "message": "Target user not connected"
                            })
                    await ws_manager.broadcast(message, room=target_room)
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


@router.websocket("/ws/presence/{user_id}")
async def websocket_presence(websocket: WebSocket, user_id: str):
    """
    WebSocket endpoint for real-time presence (online/offline) tracking.
    
    Client sends heartbeats every 30s to stay "online".
    Client can request online user list at any time.
    On disconnect, user is marked offline.
    """
    if not await verify_websocket_auth(websocket, user_id):
        return
    room = f"presence_{user_id}"
    await ws_manager.connect(websocket, room=room)
    ws_manager.mark_online(user_id)
    
    # Update last active timestamp in database
    try:
        from database import async_session_maker
        from models import Profile
        from sqlalchemy import update
        from datetime import datetime, timezone
        
        async with async_session_maker() as db:
            await db.execute(
                update(Profile)
                .where(Profile.id == user_id)
                .values(updated_at=datetime.now(timezone.utc))
            )
            await db.commit()
    except Exception as e:
        logger.error(f"Error updating presence timestamp for {user_id}: {e}")
    
    try:
        # Send initial confirmation + current online users
        online_ids = ws_manager.get_online_user_ids()
        await ws_manager.send_personal(websocket, {
            "type": "presence_connected",
            "user_id": user_id,
            "online_users": online_ids
        })
        
        # Broadcast to all presence rooms that this user came online
        for uid in online_ids:
            if uid != user_id:
                target_room = f"presence_{uid}"
                await ws_manager.broadcast({
                    "type": "user_online",
                    "user_id": user_id
                }, room=target_room)
        
        while True:
            try:
                data = await websocket.receive_text()
                
                if data == "ping":
                    ws_manager.mark_online(user_id)
                    await ws_manager.send_personal(websocket, {"type": "pong"})
                    continue
                    
                msg = json.loads(data)
                msg_type = msg.get("type")
                
                if msg_type == "heartbeat":
                    ws_manager.mark_online(user_id)
                    await ws_manager.send_personal(websocket, {"type": "heartbeat_ack"})
                    
                elif msg_type == "get_online":
                    online_ids = ws_manager.get_online_user_ids()
                    await ws_manager.send_personal(websocket, {
                        "type": "online_users",
                        "users": online_ids
                    })
                    
            except WebSocketDisconnect:
                break
            except json.JSONDecodeError:
                continue
                
    except Exception as e:
        logger.error(f"Presence WebSocket error for {user_id}: {e}")
    finally:
        ws_manager.mark_offline(user_id)
        ws_manager.disconnect(websocket, room=room)
        
        # Broadcast offline status to all connected presence rooms
        try:
            online_ids = ws_manager.get_online_user_ids()
            for uid in online_ids:
                target_room = f"presence_{uid}"
                await ws_manager.broadcast({
                    "type": "user_offline",
                    "user_id": user_id
                }, room=target_room)
        except Exception:
            pass


@router.get("/presence/online")
async def get_online_users():
    """REST fallback: Get list of currently online user IDs"""
    online = ws_manager.get_online_user_ids()
    return {
        "online_users": online,
        "count": len(online)
    }


@router.post("/internal/events/broadcast")
async def internal_broadcast(payload: dict, x_internal_token: str = Header(None)):
    """
    Internal loopback proxy webhook to bridge process boundaries.
    Enables standalone MCP processes to securely forward broadcast events
    to FastAPI's active, in-memory WebSocket connections.
    """
    if x_internal_token != INTERNAL_TOKEN:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing X-Internal-Token header"
        )
    
    room = payload.get("room", "conditions")
    message = payload.get("message")
    
    if not message:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Payload must contain a 'message' dictionary"
        )
        
    await ws_manager.broadcast(message, room=room)
    return {"status": "broadcast_sent", "room": room}


