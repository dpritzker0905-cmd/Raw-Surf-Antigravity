"""
LiveKit Live Streaming API
Real-time video broadcasting using LiveKit Cloud
"""
from fastapi import APIRouter, HTTPException, Depends, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timezone, timedelta
import os
import logging

from database import get_db, async_session_maker
from models import Profile, SocialLiveStream, Follow
from websocket_manager import broadcast_live_status_change
from core.security import get_current_user_id

# LiveKit imports
try:
    from livekit import api
except ImportError:
    api = None

logger = logging.getLogger(__name__)

router = APIRouter()

def _get_credentials():
    """Get stripped LiveKit credentials from environment variables."""
    url = os.environ.get('LIVEKIT_URL', '')
    key = os.environ.get('LIVEKIT_API_KEY', '')
    secret = os.environ.get('LIVEKIT_API_SECRET', '')
    return url.strip(), key.strip(), secret.strip()

def _is_configured() -> bool:
    """Verify actual credentials exist, strip spaces, and livekit SDK is successfully imported."""
    if api is None:
        return False
    url, key, secret = _get_credentials()
    return bool(url and key and secret)

def _get_livekit_rest_url(url: str) -> str:
    """Convert websocket URL (ws/wss) to REST API URL (http/https) for LiveKit API."""
    if not url:
        return ""
    url = url.strip().rstrip('/')
    if url.startswith("wss://"):
        return url.replace("wss://", "https://", 1)
    elif url.startswith("ws://"):
        return url.replace("ws://", "http://", 1)
    return url

def _normalize_to_utc(dt: Optional[datetime]) -> Optional[datetime]:
    """Normalize a datetime object to timezone-naive UTC for SQLite compatibility."""
    if dt is None:
        return None
    if dt.tzinfo is not None:
        return dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt

def _calculate_duration_seconds(started_at: datetime, ended_at: Optional[datetime] = None) -> int:
    """Calculate duration between started_at and ended_at (or now) in UTC, avoiding timezone mismatches."""
    if not started_at:
        return 0
    t_end = ended_at or datetime.now(timezone.utc)
    naive_start = _normalize_to_utc(started_at)
    naive_end = _normalize_to_utc(t_end)
    return int((naive_end - naive_start).total_seconds())

def _format_datetime(dt: Optional[datetime]) -> Optional[str]:
    """Format a datetime to ISO 8601 string in UTC with timezone offset."""
    if not dt:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc).isoformat()
    return dt.astimezone(timezone.utc).isoformat()

# Module-level legacy variables for backward compatibility
LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET = _get_credentials()
LIVEKIT_CONFIGURED = _is_configured()

if LIVEKIT_CONFIGURED:
    logger.info(f"LiveKit configured with URL: {LIVEKIT_URL}")
else:
    logger.warning("LiveKit not configured - missing credentials or package import failed")


class LiveKitTokenRequest(BaseModel):
    room_name: str
    participant_identity: str
    participant_name: Optional[str] = None
    is_broadcaster: bool = False


class LiveKitTokenResponse(BaseModel):
    token: str
    server_url: str
    room_name: str


class StartLiveKitStreamRequest(BaseModel):
    broadcaster_id: str
    title: Optional[str] = None


class StartLiveKitStreamResponse(BaseModel):
    stream_id: str
    room_name: str
    token: str
    server_url: str


@router.get("/livekit/status")
async def livekit_status():
    """Check if LiveKit is configured"""
    configured = _is_configured()
    url, _, _ = _get_credentials()
    return {
        "configured": configured,
        "server_url": url if configured else None
    }


async def send_go_live_notifications(
    broadcaster_id: str,
    broadcaster_name: str,
):
    """
    Send push notifications to followers when a user goes live via LiveKit.
    """
    try:
        from routes.notifications.push import send_push_notification
        
        async with async_session_maker() as db:
            # Get all followers of the broadcaster
            followers_query = await db.execute(
                select(Follow)
                .where(Follow.following_id == broadcaster_id)
                .options(selectinload(Follow.follower))
            )
            followers = followers_query.scalars().all()
            
            if not followers:
                logger.info(f"No followers to notify for LiveKit stream by {broadcaster_id}")
                return
            
            logger.info(f"Sending go-live notifications to {len(followers)} followers")
            
            for follow in followers:
                follower = follow.follower
                if not follower:
                    continue
                
                title = f"🔴 {broadcaster_name} is LIVE!"
                message = f"Tune in now - {broadcaster_name} is streaming live!"
                
                try:
                    await send_push_notification(
                        user_id=follower.id,
                        title=title,
                        message=message,
                        data={
                            "type": "go_live",
                            "broadcaster_id": broadcaster_id
                        },
                        action_url=f"/profile/{broadcaster_id}"
                    )
                except Exception as notify_err:
                    logger.error(f"Failed to notify follower {follower.id}: {notify_err}")
            
    except Exception as e:
        logger.error(f"Error sending go-live notifications: {e}")


@router.post("/livekit/token", response_model=LiveKitTokenResponse)
async def get_livekit_token(
    request: LiveKitTokenRequest,
    current_user_id: str = Depends(get_current_user_id)
):
    """
    Generate a LiveKit access token for joining a room.
    Broadcasters get publish permissions, viewers get subscribe only.
    """
    if not _is_configured():
        raise HTTPException(status_code=503, detail="LiveKit not configured")
    
    if request.participant_identity != current_user_id:
        raise HTTPException(status_code=403, detail="Forbidden: participant_identity does not match the authenticated user.")
    
    try:
        url, api_key, api_secret = _get_credentials()
        # Create access token
        token = api.AccessToken(api_key, api_secret)
        token.identity = request.participant_identity
        token.name = request.participant_name or request.participant_identity
        
        # Set permissions based on role
        if request.is_broadcaster:
            # Broadcaster can publish video/audio and subscribe
            grants = api.VideoGrants(
                room_join=True,
                room=request.room_name,
                can_publish=True,
                can_subscribe=True,
                can_publish_data=True,
            )
        else:
            # Viewer can only subscribe (watch)
            grants = api.VideoGrants(
                room_join=True,
                room=request.room_name,
                can_publish=False,
                can_subscribe=True,
                can_publish_data=False,
            )
        
        token.with_grants(grants)
        
        # Set token TTL (10 minutes, will auto-refresh)
        token.with_ttl(timedelta(minutes=10))
        
        jwt_token = token.to_jwt()
        
        return LiveKitTokenResponse(
            token=jwt_token,
            server_url=url,
            room_name=request.room_name
        )
        
    except Exception as e:
        logger.error(f"Failed to generate LiveKit token: {e}")
        raise HTTPException(status_code=500, detail="Failed to generate token")


@router.post("/livekit/start-stream", response_model=StartLiveKitStreamResponse)
async def start_livekit_stream(
    request: StartLiveKitStreamRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user_id: str = Depends(get_current_user_id)
):
    """
    Start a new live stream with LiveKit.
    Creates a room and returns broadcaster token.
    """
    if not _is_configured():
        raise HTTPException(status_code=503, detail="LiveKit not configured")
    
    if request.broadcaster_id != current_user_id:
        raise HTTPException(status_code=403, detail="Forbidden: broadcaster_id does not match the authenticated user.")
    
    # Verify broadcaster exists
    result = await db.execute(
        select(Profile).where(Profile.id == request.broadcaster_id)
    )
    broadcaster = result.scalar_one_or_none()
    if not broadcaster:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Check for existing active stream
    existing = await db.execute(
        select(SocialLiveStream).where(
            SocialLiveStream.broadcaster_id == request.broadcaster_id,
            SocialLiveStream.status == 'live'
        )
    )
    existing_stream = existing.scalar_one_or_none()
    if existing_stream:
        age_seconds = _calculate_duration_seconds(existing_stream.started_at)
        if age_seconds < 900:  # 15 minutes
            raise HTTPException(
                status_code=400,
                detail="Already broadcasting. End current stream first."
            )
        # Aggressively terminate any stale existing stream blocks natively to prevent mobile unmount lockouts
        logger.warning(
            f"[livekit] Auto-ending previous stream {existing_stream.id} "
            f"for broadcaster {request.broadcaster_id} (age: {age_seconds}s) to provision new request."
        )
        existing_stream.status = 'ended'
        existing_stream.ended_at = _normalize_to_utc(datetime.now(timezone.utc))
        existing_stream.duration_seconds = age_seconds
        await db.flush()
    
    try:
        # Generate unique room name
        room_name = f"live-{request.broadcaster_id}-{int(datetime.now(timezone.utc).timestamp())}"
        
        url, api_key, api_secret = _get_credentials()
        # Create LiveKit room
        lk_api = api.LiveKitAPI(
            url=_get_livekit_rest_url(url),
            api_key=api_key,
            api_secret=api_secret
        )
        try:
            await lk_api.room.create_room(
                api.CreateRoomRequest(
                    name=room_name,
                    max_participants=100,
                    empty_timeout=300,  # 5 minutes
                )
            )
        finally:
            await lk_api.aclose()
        
        # Generate broadcaster token
        token = api.AccessToken(api_key, api_secret)
        token.identity = request.broadcaster_id
        token.name = broadcaster.full_name or "Broadcaster"
        token.with_grants(api.VideoGrants(
            room_join=True,
            room=room_name,
            can_publish=True,
            can_subscribe=True,
            can_publish_data=True,
        ))
        token.with_ttl(timedelta(hours=1))  # 1 hour
        
        jwt_token = token.to_jwt()
        
        # Create stream record
        stream = SocialLiveStream(
            broadcaster_id=request.broadcaster_id,
            title=request.title or f"{broadcaster.full_name} is live!",
            stream_url=room_name,  # Store room name as stream URL
            status='live',
            viewer_count=0,
            peak_viewers=0,
            started_at=_normalize_to_utc(datetime.now(timezone.utc))
        )
        db.add(stream)
        
        # Update profile is_live
        await db.execute(
            update(Profile)
            .where(Profile.id == request.broadcaster_id)
            .values(is_live=True)
        )
        
        await db.commit()
        await db.refresh(stream)
        
        logger.info(f"Started LiveKit stream {room_name} for {broadcaster.id}")
        
        # Send push notifications to followers in background
        background_tasks.add_task(
            send_go_live_notifications,
            broadcaster_id=request.broadcaster_id,
            broadcaster_name=broadcaster.full_name or "Someone you follow"
        )
        
        # Broadcast live status change via WebSocket
        await broadcast_live_status_change(
            user_id=request.broadcaster_id,
            is_live=True,
            stream_data={
                "stream_id": stream.id,
                "room_name": room_name,
                "broadcaster_name": broadcaster.full_name,
                "broadcaster_username": broadcaster.username,
                "broadcaster_avatar": broadcaster.avatar_url,
                "title": request.title
            }
        )
        
        return StartLiveKitStreamResponse(
            stream_id=stream.id,
            room_name=room_name,
            token=jwt_token,
            server_url=url
        )
        
    except Exception as e:
        logger.error(f"Failed to start LiveKit stream: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to start stream: {str(e)}")


class StartSocialLiveRequest(BaseModel):
    """Request model for social live streaming (from GoLiveModal)"""
    broadcaster_id: str
    broadcaster_name: Optional[str] = None


class StartSocialLiveResponse(BaseModel):
    """Response model for social live streaming"""
    stream_id: str
    room_name: str
    token: str
    server_url: str


@router.post("/livekit/start-social-live", response_model=StartSocialLiveResponse)
async def start_social_live(
    request: StartSocialLiveRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user_id: str = Depends(get_current_user_id)
):
    """
    Start a social live stream (called from GoLiveModal).
    This is an alias for start-stream with a different request format.
    """
    if not _is_configured():
        raise HTTPException(status_code=503, detail="LiveKit not configured")
    
    if request.broadcaster_id != current_user_id:
        raise HTTPException(status_code=403, detail="Forbidden: broadcaster_id does not match the authenticated user.")
    
    # Verify broadcaster exists
    result = await db.execute(
        select(Profile).where(Profile.id == request.broadcaster_id)
    )
    broadcaster = result.scalar_one_or_none()
    if not broadcaster:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Check for existing active stream — auto-clear stale/orphaned ones
    existing_result = await db.execute(
        select(SocialLiveStream).where(
            SocialLiveStream.broadcaster_id == request.broadcaster_id,
            SocialLiveStream.status == 'live'
        )
    )
    existing_stream = existing_result.scalar_one_or_none()
    if existing_stream:
        age_seconds = _calculate_duration_seconds(existing_stream.started_at)
        if age_seconds < 900:  # 15 minutes
            raise HTTPException(
                status_code=400,
                detail="Already broadcasting. End current stream first."
            )
        # Any existing stream is automatically ended to prevent lockouts on mobile client unmounts
        logger.warning(
            f"[livekit] Auto-ending previous stream {existing_stream.id} "
            f"for broadcaster {request.broadcaster_id} (age: {age_seconds}s) to provision new request."
        )
        existing_stream.status = 'ended'
        existing_stream.ended_at = _normalize_to_utc(datetime.now(timezone.utc))
        existing_stream.duration_seconds = age_seconds
        await db.flush()

    
    try:
        # Generate unique room name
        room_name = f"social-live-{request.broadcaster_id}-{int(datetime.now(timezone.utc).timestamp())}"
        
        url, api_key, api_secret = _get_credentials()
        # Create LiveKit room
        lk_api = api.LiveKitAPI(
            url=_get_livekit_rest_url(url),
            api_key=api_key,
            api_secret=api_secret
        )
        try:
            await lk_api.room.create_room(
                api.CreateRoomRequest(
                    name=room_name,
                    max_participants=100,
                    empty_timeout=300,  # 5 minutes
                )
            )
        finally:
            await lk_api.aclose()
        
        # Generate broadcaster token
        token = api.AccessToken(api_key, api_secret)
        token.identity = request.broadcaster_id
        token.name = request.broadcaster_name or broadcaster.full_name or "Broadcaster"
        token.with_grants(api.VideoGrants(
            room_join=True,
            room=room_name,
            can_publish=True,
            can_subscribe=True,
            can_publish_data=True,
        ))
        token.with_ttl(timedelta(hours=1))  # 1 hour
        
        jwt_token = token.to_jwt()
        
        # Create stream record
        stream = SocialLiveStream(
            broadcaster_id=request.broadcaster_id,
            title=f"{request.broadcaster_name or broadcaster.full_name} is live!",
            stream_url=room_name,  # Store room name as stream URL
            status='live',
            viewer_count=0,
            peak_viewers=0,
            started_at=_normalize_to_utc(datetime.now(timezone.utc))
        )
        db.add(stream)
        
        # Update profile is_live
        await db.execute(
            update(Profile)
            .where(Profile.id == request.broadcaster_id)
            .values(is_live=True)
        )
        
        await db.commit()
        await db.refresh(stream)
        
        logger.info(f"Started social live stream {room_name} for {broadcaster.id}")
        
        # Send push notifications to followers in background
        background_tasks.add_task(
            send_go_live_notifications,
            broadcaster_id=request.broadcaster_id,
            broadcaster_name=request.broadcaster_name or broadcaster.full_name or "Someone you follow"
        )
        
        # Broadcast live status change via WebSocket
        await broadcast_live_status_change(
            user_id=request.broadcaster_id,
            is_live=True,
            stream_data={
                "stream_id": stream.id,
                "room_name": room_name,
                "broadcaster_name": request.broadcaster_name or broadcaster.full_name,
                "broadcaster_username": broadcaster.username,
                "broadcaster_avatar": broadcaster.avatar_url,
            }
        )
        
        return StartSocialLiveResponse(
            stream_id=stream.id,
            room_name=room_name,
            token=jwt_token,
            server_url=url
        )
        
    except Exception as e:
        logger.error(f"Failed to start social live stream: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to start stream: {str(e)}")


@router.post("/livekit/end-stream/{stream_id}")
async def end_livekit_stream(
    stream_id: str,
    broadcaster_id: str,
    db: AsyncSession = Depends(get_db),
    current_user_id: str = Depends(get_current_user_id)
):
    """End a LiveKit live stream"""
    if broadcaster_id != current_user_id:
        raise HTTPException(status_code=403, detail="Forbidden: broadcaster_id does not match the authenticated user.")
    result = await db.execute(
        select(SocialLiveStream).where(SocialLiveStream.id == stream_id)
    )
    stream = result.scalar_one_or_none()
    
    if not stream:
        raise HTTPException(status_code=404, detail="Stream not found")
    
    if stream.broadcaster_id != broadcaster_id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    try:
        # Delete LiveKit room
        if _is_configured() and stream.stream_url:
            try:
                url, api_key, api_secret = _get_credentials()
                lk_api = api.LiveKitAPI(
                    url=_get_livekit_rest_url(url),
                    api_key=api_key,
                    api_secret=api_secret
                )
                try:
                    await lk_api.room.delete_room(
                        api.DeleteRoomRequest(room=stream.stream_url)
                    )
                finally:
                    await lk_api.aclose()
            except Exception as e:
                logger.warning(f"Failed to delete LiveKit room: {e}")
        
        # Calculate duration
        duration = _calculate_duration_seconds(stream.started_at)
        
        # Update stream record
        stream.status = 'ended'
        stream.ended_at = _normalize_to_utc(datetime.now(timezone.utc))
        stream.duration_seconds = duration
        
        # Update profile
        await db.execute(
            update(Profile)
            .where(Profile.id == broadcaster_id)
            .values(is_live=False)
        )
        
        await db.commit()
        
        # Broadcast live status change via WebSocket
        await broadcast_live_status_change(
            user_id=broadcaster_id,
            is_live=False,
            stream_data={
                "stream_id": stream_id,
                "duration_seconds": duration
            }
        )
        
        return {
            "success": True,
            "stream_id": stream_id,
            "duration_seconds": duration,
            "peak_viewers": stream.peak_viewers
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to end stream: {e}")
        raise HTTPException(status_code=500, detail="Failed to end stream")


@router.get("/livekit/viewer-token/{room_name}")
async def get_viewer_token(
    room_name: str,
    viewer_id: str,
    viewer_name: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user_id: str = Depends(get_current_user_id)
):
    """
    Get a viewer token to watch a live stream.
    """
    if not _is_configured():
        raise HTTPException(status_code=503, detail="LiveKit not configured")
    
    if viewer_id != current_user_id:
        raise HTTPException(status_code=403, detail="Forbidden: viewer_id does not match the authenticated user.")
    
    # Find the stream
    result = await db.execute(
        select(SocialLiveStream).where(
            SocialLiveStream.stream_url == room_name,
            SocialLiveStream.status == 'live'
        )
    )
    stream = result.scalar_one_or_none()
    
    if not stream:
        raise HTTPException(status_code=404, detail="Stream not found or ended")
    
    try:
        url, api_key, api_secret = _get_credentials()
        # Generate viewer token
        token = api.AccessToken(api_key, api_secret)
        token.identity = viewer_id
        token.name = viewer_name or f"Viewer-{viewer_id[:8]}"
        token.with_grants(api.VideoGrants(
            room_join=True,
            room=room_name,
            can_publish=False,
            can_subscribe=True,
        ))
        token.with_ttl(timedelta(hours=1))  # 1 hour
        
        jwt_token = token.to_jwt()
        
        # Increment viewer count
        stream.viewer_count += 1
        if stream.viewer_count > stream.peak_viewers:
            stream.peak_viewers = stream.viewer_count
        await db.commit()
        
        return {
            "token": jwt_token,
            "server_url": url,
            "room_name": room_name,
            "broadcaster_name": stream.title
        }
        
    except Exception as e:
        logger.error(f"Failed to generate viewer token: {e}")
        raise HTTPException(status_code=500, detail="Failed to generate token")


@router.get("/livekit/active-streams")
async def get_active_livekit_streams(db: AsyncSession = Depends(get_db)):
    """Get all active LiveKit streams"""
    from sqlalchemy.orm import selectinload
    
    result = await db.execute(
        select(SocialLiveStream)
        .where(SocialLiveStream.status == 'live')
        .options(selectinload(SocialLiveStream.broadcaster))
        .order_by(SocialLiveStream.started_at.desc())
    )
    streams = result.scalars().all()
    
    return {
        "streams": [
            {
                "id": s.id,
                "room_name": s.stream_url,
                "title": s.title,
                "broadcaster_id": s.broadcaster_id,
                "broadcaster_name": s.broadcaster.full_name if s.broadcaster else None,
                "broadcaster_username": s.broadcaster.username if s.broadcaster else None,
                "broadcaster_avatar": s.broadcaster.avatar_url if s.broadcaster else None,
                "viewer_count": s.viewer_count,
                "started_at": _format_datetime(s.started_at)
            }
            for s in streams
        ],
        "count": len(streams)
    }
