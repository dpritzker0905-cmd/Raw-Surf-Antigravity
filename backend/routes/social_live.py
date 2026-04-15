"""
Social Live Streaming API
Handles social "Go Live" broadcasts separate from Active Duty (commerce)

Integrates with Mux for real-time video streaming.
"""
from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, desc, update
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone
import os
import logging

from database import get_db
from models import Profile, SurfSpot, SocialLiveStream, Story, Follow

logger = logging.getLogger(__name__)

router = APIRouter()

# Import Mux service
MUX_AVAILABLE = False
mux_service = None

try:
    from services.mux_live import MuxLiveService
    mux_service = MuxLiveService()
    MUX_AVAILABLE = mux_service.configured
    logger.info(f"Mux service loaded, configured: {MUX_AVAILABLE}")
except ImportError as e:
    logger.warning(f"Mux service import failed: {e}")
except Exception as e:
    logger.warning(f"Mux service initialization failed: {e}")


class GoLiveRequest(BaseModel):
    broadcaster_id: str
    title: Optional[str] = None
    spot_id: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    location_name: Optional[str] = None


class GoLiveResponse(BaseModel):
    stream_id: str
    mux_stream_id: Optional[str] = None
    status: str
    playback_url: Optional[str] = None
    rtmp_url: Optional[str] = None
    stream_key: Optional[str] = None
    message: str


class LiveStreamInfo(BaseModel):
    id: str
    broadcaster_id: str
    broadcaster_name: Optional[str]
    broadcaster_avatar: Optional[str]
    title: Optional[str]
    status: str
    viewer_count: int
    location_name: Optional[str]
    started_at: datetime
    playback_url: Optional[str]
    is_live: bool


async def send_go_live_notifications(
    broadcaster_id: str,
    broadcaster_name: str,
    location_name: str,
    spot_id: Optional[str]
):
    """
    Send push notifications AND in-app notifications to followers when a user goes live.
    Priority: followers who have this spot as their home spot.
    Creates its own database session to avoid connection issues.
    """
    try:
        from routes.push import send_push_notification
        from database import async_session_maker
        from models import Notification
        import json
        
        async with async_session_maker() as db:
            # Get all followers of the broadcaster
            followers_query = await db.execute(
                select(Follow)
                .where(Follow.following_id == broadcaster_id)
                .options(selectinload(Follow.follower))
            )
            followers = followers_query.scalars().all()
            
            if not followers:
                logger.info(f"No followers to notify for {broadcaster_id}")
                return
            
            logger.info(f"Sending go-live notifications to {len(followers)} followers")
            
            for follow in followers:
                follower = follow.follower
                if not follower:
                    continue
                
                # Check if this is the follower's home spot
                is_home_spot = (
                    spot_id and 
                    hasattr(follower, 'home_spot_id') and 
                    follower.home_spot_id == spot_id
                )
                
                # Personalize message based on home spot
                if is_home_spot:
                    title = f"🏄 {broadcaster_name} is LIVE at your home spot!"
                    message = f"{broadcaster_name} is now live at {location_name}! Don't miss out."
                else:
                    title = f"🔴 {broadcaster_name} is LIVE!"
                    message = f"Tune in now - {broadcaster_name} is streaming from {location_name or 'their location'}"
                
                notification_data = {
                    "type": "go_live",
                    "broadcaster_id": broadcaster_id,
                    "is_home_spot": is_home_spot
                }
                
                # Create in-app notification
                try:
                    in_app_notification = Notification(
                        user_id=follower.id,
                        type="go_live",
                        title=title,
                        body=message,
                        data=json.dumps(notification_data)
                    )
                    db.add(in_app_notification)
                except Exception as notif_err:
                    logger.error(f"Failed to create in-app notification for {follower.id}: {notif_err}")
                
                # Send push notification
                try:
                    await send_push_notification(
                        user_id=follower.id,
                        title=title,
                        message=message,
                        data=notification_data,
                        action_url=f"/profile/{broadcaster_id}"
                    )
                except Exception as notify_err:
                    logger.error(f"Failed to send push to follower {follower.id}: {notify_err}")
            
            # Commit all in-app notifications
            await db.commit()
            logger.info(f"Created in-app notifications for {len(followers)} followers")
            
    except Exception as e:
        logger.error(f"Error sending go-live notifications: {e}")


@router.get("/social-live/active")
async def get_active_live_streams(
    limit: int = Query(default=20, le=50),
    db: AsyncSession = Depends(get_db)
):
    """
    Get all currently active social live broadcasts.
    These appear with RED rings at the front of the story row.
    """
    query = select(SocialLiveStream).where(
        SocialLiveStream.status == 'live'
    ).options(
        selectinload(SocialLiveStream.broadcaster),
        selectinload(SocialLiveStream.spot)
    ).order_by(desc(SocialLiveStream.started_at)).limit(limit)
    
    result = await db.execute(query)
    streams = result.scalars().all()
    
    response_streams = []
    for stream in streams:
        broadcaster = stream.broadcaster
        response_streams.append(LiveStreamInfo(
            id=stream.id,
            broadcaster_id=stream.broadcaster_id,
            broadcaster_name=broadcaster.full_name if broadcaster else None,
            broadcaster_avatar=broadcaster.avatar_url if broadcaster else None,
            title=stream.title,
            status=stream.status,
            viewer_count=stream.viewer_count,
            location_name=stream.location_name or (stream.spot.name if stream.spot else None),
            started_at=stream.started_at,
            playback_url=stream.stream_url,
            is_live=True
        ))
    
    return {"streams": response_streams, "count": len(response_streams)}


@router.get("/social-live/mux-status")
async def check_mux_status():
    """Check if Mux is configured and operational"""
    return {
        "configured": MUX_AVAILABLE,
        "service_available": mux_service is not None and mux_service.configured if mux_service else False
    }


@router.get("/social-live/pro-zone-check")
async def check_pro_zone(
    user_id: str,
    latitude: float,
    longitude: float,
    db: AsyncSession = Depends(get_db)
):
    """
    Check if a Hobbyist/Grom Parent can go live at the given location.
    Returns blocked=true if within 0.5 miles of an active Pro Photographer.
    """
    import math
    
    # Get user profile
    result = await db.execute(
        select(Profile).where(Profile.id == user_id)
    )
    user = result.scalar_one_or_none()
    
    if not user:
        return {"blocked": False, "reason": "user_not_found"}
    
    # Only check for Hobbyist and Grom Parent
    if user.role not in ['HOBBYIST', 'GROM_PARENT']:
        return {"blocked": False, "can_go_live": True}
    
    # Find active Pro photographers
    active_pros_result = await db.execute(
        select(Profile).where(
            Profile.role.in_(['PHOTOGRAPHER', 'APPROVED_PRO']),
            Profile.is_on_duty == True
        )
    )
    active_pros = active_pros_result.scalars().all()
    
    PRO_ZONE_RADIUS_MILES = 0.5
    
    def haversine_distance(lat1, lon1, lat2, lon2):
        R = 3959
        phi1 = math.radians(lat1)
        phi2 = math.radians(lat2)
        delta_phi = math.radians(lat2 - lat1)
        delta_lambda = math.radians(lon2 - lon1)
        a = math.sin(delta_phi/2)**2 + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda/2)**2
        c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
        return R * c
    
    for pro in active_pros:
        if pro.current_latitude and pro.current_longitude:
            distance = haversine_distance(
                latitude, longitude,
                pro.current_latitude, pro.current_longitude
            )
            if distance <= PRO_ZONE_RADIUS_MILES:
                return {
                    "blocked": True,
                    "can_go_live": False,
                    "reason": "pro_zone",
                    "message": f"A Pro Photographer ({pro.full_name}) is active within {PRO_ZONE_RADIUS_MILES} miles",
                    "pro_name": pro.full_name,
                    "distance_miles": round(distance, 2)
                }
    
    return {
        "blocked": False,
        "can_go_live": True,
        "message": "No active Pro Photographers nearby"
    }


@router.post("/social-live/start")
async def start_social_live(
    data: GoLiveRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db)
):
    """
    Start a social Go Live broadcast with Mux real-time streaming.
    This triggers native device camera/audio for social broadcasting.
    
    Different from Active Duty which is commerce/map-based status.
    
    PROTECTION: Hobbyist and Grom Parent users are blocked from going live
    within 0.5 miles of an active Pro Photographer to protect professional zones.
    """
    import math
    
    # Verify broadcaster exists
    result = await db.execute(
        select(Profile).where(Profile.id == data.broadcaster_id)
    )
    broadcaster = result.scalar_one_or_none()
    if not broadcaster:
        raise HTTPException(status_code=404, detail="User not found")
    
    # PRO-ZONE CHECK: Hobbyist and Grom Parent cannot go live within 0.5 miles of active Pro
    user_role = broadcaster.role
    if user_role in ['HOBBYIST', 'GROM_PARENT']:
        # Get user's current location
        user_lat = data.latitude
        user_lng = data.longitude
        
        if user_lat and user_lng:
            # Find active Pro photographers (on duty or live)
            active_pros_result = await db.execute(
                select(Profile).where(
                    Profile.role.in_(['PHOTOGRAPHER', 'APPROVED_PRO']),
                    Profile.is_on_duty == True
                )
            )
            active_pros = active_pros_result.scalars().all()
            
            # Calculate distance to each active Pro
            PRO_ZONE_RADIUS_MILES = 0.5
            
            def haversine_distance(lat1, lon1, lat2, lon2):
                """Calculate distance between two points in miles"""
                R = 3959  # Earth's radius in miles
                phi1 = math.radians(lat1)
                phi2 = math.radians(lat2)
                delta_phi = math.radians(lat2 - lat1)
                delta_lambda = math.radians(lon2 - lon1)
                
                a = math.sin(delta_phi/2)**2 + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda/2)**2
                c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
                
                return R * c
            
            for pro in active_pros:
                if pro.current_latitude and pro.current_longitude:
                    distance = haversine_distance(
                        user_lat, user_lng,
                        pro.current_latitude, pro.current_longitude
                    )
                    if distance <= PRO_ZONE_RADIUS_MILES:
                        raise HTTPException(
                            status_code=403,
                            detail={
                                "error": "pro_zone_blocked",
                                "message": f"Cannot go live within {PRO_ZONE_RADIUS_MILES} miles of an active Pro Photographer. A professional is currently shooting nearby.",
                                "pro_name": pro.full_name,
                                "distance_miles": round(distance, 2)
                            }
                        )
    
    # Check if user is already live
    existing_stream = await db.execute(
        select(SocialLiveStream).where(
            and_(
                SocialLiveStream.broadcaster_id == data.broadcaster_id,
                SocialLiveStream.status == 'live'
            )
        )
    )
    if existing_stream.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Already broadcasting. End current stream first.")
    
    # Get spot info if provided
    location_name = data.location_name
    latitude = data.latitude
    longitude = data.longitude
    spot = None
    
    if data.spot_id:
        spot_result = await db.execute(
            select(SurfSpot).where(SurfSpot.id == data.spot_id)
        )
        spot = spot_result.scalar_one_or_none()
        if spot:
            location_name = location_name or spot.name
            latitude = latitude or spot.latitude
            longitude = longitude or spot.longitude
    
    # Create Mux live stream
    mux_data = None
    stream_url = None
    rtmp_url = None
    stream_key = None
    mux_stream_id = None
    mux_playback_id = None
    mux_error = None
    
    if MUX_AVAILABLE and mux_service:
        mux_data = mux_service.create_live_stream(
            broadcaster_name=broadcaster.full_name or "Live Stream",
            latency_mode="standard"  # Use standard for mobile reliability
        )
        
        if mux_data.get("success"):
            stream_url = mux_data.get("playback_url")
            rtmp_url = mux_data.get("rtmp_url")
            stream_key = mux_data.get("stream_key")
            mux_stream_id = mux_data.get("live_stream_id")
            mux_playback_id = mux_data.get("playback_id")
            logger.info(f"Created Mux stream {mux_stream_id} for {broadcaster.id}")
        else:
            mux_error = mux_data.get("error", "Unknown error")
            logger.error(f"Mux stream creation failed: {mux_error}")
    
    # Create the live stream record
    live_stream = SocialLiveStream(
        broadcaster_id=data.broadcaster_id,
        title=data.title or f"{broadcaster.full_name} is live!",
        spot_id=data.spot_id,
        latitude=latitude,
        longitude=longitude,
        location_name=location_name,
        status='live',
        stream_url=stream_url,
        viewer_count=0,
        peak_viewers=0
    )
    
    # Store Mux stream/playback IDs
    live_stream.mux_stream_id = mux_stream_id
    live_stream.mux_playback_id = mux_playback_id
    
    db.add(live_stream)
    
    # Update user profile to indicate they're live broadcasting
    await db.execute(
        update(Profile)
        .where(Profile.id == data.broadcaster_id)
        .values(is_live=True)
    )
    
    await db.flush()
    await db.commit()
    await db.refresh(live_stream)
    
    # Send push notifications to followers in background
    background_tasks.add_task(
        send_go_live_notifications,
        broadcaster_id=data.broadcaster_id,
        broadcaster_name=broadcaster.full_name or "Someone you follow",
        location_name=location_name or "their location",
        spot_id=data.spot_id
    )
    
    return GoLiveResponse(
        stream_id=live_stream.id,
        mux_stream_id=mux_stream_id,
        status='live',
        playback_url=stream_url,
        rtmp_url=rtmp_url,
        stream_key=stream_key,
        message="You're now LIVE! Your RED ring is visible to followers." + (
            " Configure your streaming app with the RTMP URL and stream key." if stream_key else ""
        )
    )


@router.post("/social-live/{stream_id}/end")
async def end_social_live(
    stream_id: str,
    broadcaster_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    End a social live broadcast.
    Archives the stream for later viewing.
    """
    result = await db.execute(
        select(SocialLiveStream).where(SocialLiveStream.id == stream_id)
    )
    stream = result.scalar_one_or_none()
    
    if not stream:
        raise HTTPException(status_code=404, detail="Stream not found")
    
    if stream.broadcaster_id != broadcaster_id:
        raise HTTPException(status_code=403, detail="Not authorized to end this stream")
    
    # Calculate duration
    duration = int((datetime.now(timezone.utc) - stream.started_at).total_seconds())
    
    # Disable Mux stream if available
    if MUX_AVAILABLE and mux_service and hasattr(stream, 'mux_stream_id') and stream.mux_stream_id:
        mux_service.disable_live_stream(stream.mux_stream_id)
    
    # Update stream status
    stream.status = 'ended'
    stream.ended_at = datetime.now(timezone.utc)
    stream.duration_seconds = duration
    
    # Update user profile
    await db.execute(
        update(Profile)
        .where(Profile.id == broadcaster_id)
        .values(is_live=False)
    )
    
    await db.commit()
    
    return {
        "success": True,
        "stream_id": stream_id,
        "duration_seconds": duration,
        "peak_viewers": stream.peak_viewers,
        "message": "Stream ended. Your broadcast has been archived."
    }


@router.get("/social-live/{stream_id}")
async def get_live_stream_info(
    stream_id: str,
    viewer_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """Get information about a specific live stream"""
    result = await db.execute(
        select(SocialLiveStream)
        .where(SocialLiveStream.id == stream_id)
        .options(
            selectinload(SocialLiveStream.broadcaster),
            selectinload(SocialLiveStream.spot)
        )
    )
    stream = result.scalar_one_or_none()
    
    if not stream:
        raise HTTPException(status_code=404, detail="Stream not found")
    
    # Increment viewer count if this is a new viewer
    if viewer_id and viewer_id != stream.broadcaster_id and stream.status == 'live':
        stream.viewer_count += 1
        if stream.viewer_count > stream.peak_viewers:
            stream.peak_viewers = stream.viewer_count
        await db.commit()
    
    broadcaster = stream.broadcaster
    
    return LiveStreamInfo(
        id=stream.id,
        broadcaster_id=stream.broadcaster_id,
        broadcaster_name=broadcaster.full_name if broadcaster else None,
        broadcaster_avatar=broadcaster.avatar_url if broadcaster else None,
        title=stream.title,
        status=stream.status,
        viewer_count=stream.viewer_count,
        location_name=stream.location_name or (stream.spot.name if stream.spot else None),
        started_at=stream.started_at,
        playback_url=stream.stream_url or stream.archive_url,
        is_live=stream.status == 'live'
    )


@router.get("/social-live/user/{user_id}/history")
async def get_user_stream_history(
    user_id: str,
    limit: int = Query(default=10, le=50),
    db: AsyncSession = Depends(get_db)
):
    """Get a user's past live broadcasts"""
    query = select(SocialLiveStream).where(
        SocialLiveStream.broadcaster_id == user_id
    ).order_by(desc(SocialLiveStream.started_at)).limit(limit)
    
    result = await db.execute(query)
    streams = result.scalars().all()
    
    return {
        "streams": [
            {
                "id": s.id,
                "title": s.title,
                "status": s.status,
                "viewer_count": s.peak_viewers,
                "duration_seconds": s.duration_seconds,
                "location_name": s.location_name,
                "started_at": s.started_at,
                "ended_at": s.ended_at,
                "archive_url": s.archive_url,
                "playback_url": s.stream_url
            }
            for s in streams
        ],
        "count": len(streams)
    }


@router.post("/social-live/{stream_id}/leave")
async def leave_live_stream(
    stream_id: str,
    viewer_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Record when a viewer leaves a live stream"""
    result = await db.execute(
        select(SocialLiveStream).where(SocialLiveStream.id == stream_id)
    )
    stream = result.scalar_one_or_none()
    
    if stream and stream.status == 'live' and stream.viewer_count > 0:
        stream.viewer_count -= 1
        await db.commit()
    
    return {"success": True}


# In-memory store for live comments (could be Redis in production)
# Format: {stream_id: [comment_dict, ...]}
live_comments_store = {}


class LiveCommentRequest(BaseModel):
    user_id: str
    user_name: str
    avatar_url: Optional[str] = None
    text: str


class LiveCommentResponse(BaseModel):
    id: str
    user_id: str
    user_name: str
    avatar_url: Optional[str]
    text: str
    created_at: datetime


@router.get("/social-live/{stream_id}/comments")
async def get_live_comments(
    stream_id: str,
    limit: int = Query(default=50, le=100)
):
    """Get live comments for a stream"""
    comments = live_comments_store.get(stream_id, [])
    # Return the most recent comments
    return {
        "comments": comments[-limit:] if len(comments) > limit else comments,
        "total_count": len(comments)
    }


@router.post("/social-live/{stream_id}/comments")
async def post_live_comment(
    stream_id: str,
    data: LiveCommentRequest,
    db: AsyncSession = Depends(get_db)
):
    """Post a comment to a live stream"""
    import uuid
    
    # Verify stream exists and is live
    result = await db.execute(
        select(SocialLiveStream).where(SocialLiveStream.id == stream_id)
    )
    stream = result.scalar_one_or_none()
    
    if not stream:
        raise HTTPException(status_code=404, detail="Stream not found")
    
    if stream.status != 'live':
        raise HTTPException(status_code=400, detail="Stream is not live")
    
    # Create comment
    comment = {
        "id": str(uuid.uuid4()),
        "user_id": data.user_id,
        "user_name": data.user_name,
        "avatar_url": data.avatar_url,
        "text": data.text[:500],  # Limit comment length
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    
    # Add to in-memory store
    if stream_id not in live_comments_store:
        live_comments_store[stream_id] = []
    
    live_comments_store[stream_id].append(comment)
    
    # Keep only last 200 comments per stream
    if len(live_comments_store[stream_id]) > 200:
        live_comments_store[stream_id] = live_comments_store[stream_id][-200:]
    
    return {"success": True, "comment": comment}


@router.post("/social-live/{stream_id}/like")
async def toggle_live_like(
    stream_id: str,
    user_id: str = Query(...),
    action: str = Query(default="like"),  # "like" or "unlike"
    db: AsyncSession = Depends(get_db)
):
    """Toggle like on a live stream"""
    result = await db.execute(
        select(SocialLiveStream).where(SocialLiveStream.id == stream_id)
    )
    stream = result.scalar_one_or_none()
    
    if not stream:
        raise HTTPException(status_code=404, detail="Stream not found")
    
    # For simplicity, we're not persisting individual likes
    # In production, you'd want a separate likes table
    return {"success": True, "action": action}


# In-memory store for comment likes (per comment_id -> set of user_ids)
comment_likes_store = {}

@router.post("/social-live/{stream_id}/comments/{comment_id}/like")
async def toggle_comment_like(
    stream_id: str,
    comment_id: str,
    data: dict,
    db: AsyncSession = Depends(get_db)
):
    """Toggle like on a live stream comment"""
    user_id = data.get("user_id")
    liked = data.get("liked", True)
    
    if not user_id:
        raise HTTPException(status_code=400, detail="user_id required")
    
    # Initialize likes store for this comment
    if comment_id not in comment_likes_store:
        comment_likes_store[comment_id] = set()
    
    # Toggle like
    if liked:
        comment_likes_store[comment_id].add(user_id)
    else:
        comment_likes_store[comment_id].discard(user_id)
    
    # Update the comment in the store with new like count
    if stream_id in live_comments_store:
        for comment in live_comments_store[stream_id]:
            if comment.get("id") == comment_id:
                comment["likes"] = len(comment_likes_store[comment_id])
                comment["liked_by"] = list(comment_likes_store[comment_id])
                break
    
    return {
        "success": True, 
        "liked": liked,
        "likes": len(comment_likes_store[comment_id])
    }
