"""
Post Collaboration API Routes - "I Was There" System
Handles session-based collaboration, tagging, and verification
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone
import json

from database import get_db
from models import (
    Profile, Post, PostCollaboration, Notification, SurfSpot
)

router = APIRouter()


# ============================================================
# PYDANTIC MODELS
# ============================================================

class SessionMetadata(BaseModel):
    session_date: Optional[str] = None  # ISO format
    session_start_time: Optional[str] = None  # "06:45"
    session_end_time: Optional[str] = None    # "08:45"
    session_label: Optional[str] = None       # "Dawn Patrol"
    wave_height_ft: Optional[float] = None
    wave_period_sec: Optional[int] = None
    wind_speed_mph: Optional[float] = None
    wind_direction: Optional[str] = None
    tide_height_ft: Optional[float] = None
    tide_status: Optional[str] = None
    conditions_source: Optional[str] = "manual"


class InviteCollaboratorRequest(BaseModel):
    user_id: str
    message: Optional[str] = None


class RequestCollaborationRequest(BaseModel):
    linked_media_url: Optional[str] = None
    linked_media_type: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None


class RespondToCollaborationRequest(BaseModel):
    accept: bool


class FlagCollaborationRequest(BaseModel):
    reason: str  # "wasn't there", "fake", "inappropriate", etc.


class CollaboratorResponse(BaseModel):
    id: str
    user_id: str
    full_name: Optional[str]
    username: Optional[str]
    avatar_url: Optional[str]
    status: str
    initiated_by: str
    verified_by_gps: bool
    linked_media_url: Optional[str]
    created_at: datetime


# ============================================================
# SESSION METADATA HELPERS
# ============================================================

def get_session_label(start_time: str) -> str:
    """Generate session label based on time"""
    if not start_time:
        return None
    
    try:
        hour = int(start_time.split(':')[0])
        if hour < 7:
            return "Dawn Patrol"
        elif hour < 10:
            return "Morning Glass"
        elif hour < 14:
            return "Midday Session"
        elif hour < 17:
            return "Afternoon Shred"
        else:
            return "Sunset Session"
    except:
        return None


async def auto_fill_conditions(spot_id: str, session_date: datetime, db: AsyncSession) -> dict:
    """
    Auto-fill wave conditions based on spot and date.
    In production, this would pull from NOAA/Surfline API.
    For now, returns placeholder that can be overridden.
    """
    # TODO: Integrate with actual forecast API
    # For now, return empty dict - user fills manually or we integrate later
    return {
        "wave_height_ft": None,
        "wave_period_sec": None,
        "wind_speed_mph": None,
        "wind_direction": None,
        "tide_height_ft": None,
        "tide_status": None,
        "conditions_source": "manual"
    }


# ============================================================
# API ENDPOINTS
# ============================================================

@router.put("/posts/{post_id}/session-metadata")
async def update_post_session_metadata(
    post_id: str,
    user_id: str,
    data: SessionMetadata,
    db: AsyncSession = Depends(get_db)
):
    """
    Update session metadata on a post (location, time, conditions).
    Only the post author can update.
    """
    result = await db.execute(
        select(Post).where(Post.id == post_id)
    )
    post = result.scalar_one_or_none()
    
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    
    if post.author_id != user_id:
        raise HTTPException(status_code=403, detail="Only the post author can update session metadata")
    
    # Update session metadata
    if data.session_date:
        post.session_date = datetime.fromisoformat(data.session_date.replace('Z', '+00:00'))
    if data.session_start_time:
        post.session_start_time = data.session_start_time
        # Auto-generate label if not provided
        if not data.session_label:
            post.session_label = get_session_label(data.session_start_time)
    if data.session_end_time:
        post.session_end_time = data.session_end_time
    if data.session_label:
        post.session_label = data.session_label
    
    # Update conditions
    if data.wave_height_ft is not None:
        post.wave_height_ft = data.wave_height_ft
    if data.wave_period_sec is not None:
        post.wave_period_sec = data.wave_period_sec
    if data.wind_speed_mph is not None:
        post.wind_speed_mph = data.wind_speed_mph
    if data.wind_direction:
        post.wind_direction = data.wind_direction
    if data.tide_height_ft is not None:
        post.tide_height_ft = data.tide_height_ft
    if data.tide_status:
        post.tide_status = data.tide_status
    if data.conditions_source:
        post.conditions_source = data.conditions_source
    
    await db.commit()
    
    return {
        "success": True,
        "message": "Session metadata updated",
        "session_label": post.session_label
    }


@router.get("/posts/{post_id}/collaborators")
async def get_post_collaborators(
    post_id: str,
    status: Optional[str] = None,  # Filter by status: 'pending', 'accepted', etc.
    db: AsyncSession = Depends(get_db)
):
    """
    Get all collaborators (I Was There) for a post
    """
    query = select(PostCollaboration).where(PostCollaboration.post_id == post_id)
    
    if status:
        query = query.where(PostCollaboration.status == status)
    
    query = query.options(selectinload(PostCollaboration.user))
    
    result = await db.execute(query)
    collaborations = result.scalars().all()
    
    collaborators = []
    for collab in collaborations:
        user = collab.user
        collaborators.append({
            "id": collab.id,
            "user_id": collab.user_id,
            "full_name": user.full_name if user else None,
            "username": getattr(user, 'username', None) if user else None,
            "avatar_url": user.avatar_url if user else None,
            "status": collab.status,
            "initiated_by": collab.initiated_by,
            "verified_by_gps": collab.verified_by_gps,
            "linked_media_url": collab.linked_media_url,
            "is_flagged": collab.is_flagged,
            "created_at": collab.created_at
        })
    
    return {"collaborators": collaborators, "total": len(collaborators)}


@router.post("/posts/{post_id}/invite-collaborator")
async def invite_collaborator(
    post_id: str,
    user_id: str,  # Post author
    data: InviteCollaboratorRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Post author invites another user to collaborate ("I Was There" invite).
    """
    # Verify post exists and user is author
    post_result = await db.execute(
        select(Post).where(Post.id == post_id).options(selectinload(Post.author))
    )
    post = post_result.scalar_one_or_none()
    
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    
    if post.author_id != user_id:
        raise HTTPException(status_code=403, detail="Only the post author can invite collaborators")
    
    # Check if collaboration already exists
    existing = await db.execute(
        select(PostCollaboration).where(
            PostCollaboration.post_id == post_id,
            PostCollaboration.user_id == data.user_id
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="User already has a collaboration request for this post")
    
    # Get invitee profile
    invitee_result = await db.execute(select(Profile).where(Profile.id == data.user_id))
    invitee = invitee_result.scalar_one_or_none()
    
    if not invitee:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Create collaboration
    collaboration = PostCollaboration(
        post_id=post_id,
        user_id=data.user_id,
        initiated_by='author',
        status='pending'
    )
    db.add(collaboration)
    
    # Send notification to invitee
    notification = Notification(
        user_id=data.user_id,
        type='collaboration_invite',
        title='Session Collaboration Invite',
        body=f'{post.author.full_name if post.author else "Someone"} invited you to collaborate on a session post',
        data=json.dumps({
            "post_id": post_id,
            "inviter_id": user_id,
            "inviter_name": post.author.full_name if post.author else None,
            "message": data.message
        })
    )
    db.add(notification)
    
    await db.commit()
    
    return {
        "success": True,
        "message": f"Collaboration invite sent to {invitee.full_name}",
        "collaboration_id": collaboration.id
    }


@router.post("/posts/{post_id}/request-collaboration")
async def request_collaboration(
    post_id: str,
    user_id: str,  # User requesting to join
    data: RequestCollaborationRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    User requests to be added as collaborator ("I Was There" request).
    """
    # Verify post exists
    post_result = await db.execute(
        select(Post).where(Post.id == post_id).options(selectinload(Post.author))
    )
    post = post_result.scalar_one_or_none()
    
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    
    # Can't request on own post
    if post.author_id == user_id:
        raise HTTPException(status_code=400, detail="Cannot request collaboration on your own post")
    
    # Check if collaboration already exists
    existing = await db.execute(
        select(PostCollaboration).where(
            PostCollaboration.post_id == post_id,
            PostCollaboration.user_id == user_id
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="You already have a collaboration request for this post")
    
    # Get requester profile
    requester_result = await db.execute(select(Profile).where(Profile.id == user_id))
    requester = requester_result.scalar_one_or_none()
    
    if not requester:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Verify GPS if provided
    verified_by_gps = False
    if data.latitude and data.longitude and post.latitude and post.longitude:
        # Check if within ~0.5 miles (roughly 0.008 degrees)
        lat_diff = abs(data.latitude - post.latitude)
        lon_diff = abs(data.longitude - post.longitude)
        if lat_diff < 0.008 and lon_diff < 0.008:
            verified_by_gps = True
    
    # Create collaboration request
    collaboration = PostCollaboration(
        post_id=post_id,
        user_id=user_id,
        initiated_by='user',
        status='pending',
        linked_media_url=data.linked_media_url,
        linked_media_type=data.linked_media_type,
        verified_by_gps=verified_by_gps,
        verification_latitude=data.latitude,
        verification_longitude=data.longitude
    )
    db.add(collaboration)
    
    # Send notification to post author
    notification = Notification(
        user_id=post.author_id,
        type='collaboration_request',
        title='Session Collaboration Request',
        body=f'{requester.full_name if requester else "Someone"} wants to be tagged in your session post',
        data=json.dumps({
            "post_id": post_id,
            "requester_id": user_id,
            "requester_name": requester.full_name if requester else None,
            "verified_by_gps": verified_by_gps
        })
    )
    db.add(notification)
    
    await db.commit()
    
    return {
        "success": True,
        "message": "Collaboration request sent",
        "collaboration_id": collaboration.id,
        "verified_by_gps": verified_by_gps
    }


@router.put("/posts/{post_id}/collaborations/{collaboration_id}/respond")
async def respond_to_collaboration(
    post_id: str,
    collaboration_id: str,
    user_id: str,  # User responding (either author or collaborator depending on who initiated)
    data: RespondToCollaborationRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Accept or deny a collaboration request.
    - If author initiated: collaborator accepts/denies
    - If user initiated: author accepts/denies
    """
    # Get collaboration
    collab_result = await db.execute(
        select(PostCollaboration)
        .where(PostCollaboration.id == collaboration_id, PostCollaboration.post_id == post_id)
        .options(selectinload(PostCollaboration.post), selectinload(PostCollaboration.user))
    )
    collaboration = collab_result.scalar_one_or_none()
    
    if not collaboration:
        raise HTTPException(status_code=404, detail="Collaboration not found")
    
    if collaboration.status != 'pending':
        raise HTTPException(status_code=400, detail="Collaboration has already been responded to")
    
    post = collaboration.post
    
    # Determine who can respond
    if collaboration.initiated_by == 'author':
        # Author invited, collaborator responds
        if user_id != collaboration.user_id:
            raise HTTPException(status_code=403, detail="Only the invited user can respond")
        notify_user_id = post.author_id
    else:
        # User requested, author responds
        if user_id != post.author_id:
            raise HTTPException(status_code=403, detail="Only the post author can respond")
        notify_user_id = collaboration.user_id
    
    # Update status
    collaboration.status = 'accepted' if data.accept else 'denied'
    collaboration.responded_at = datetime.now(timezone.utc)
    
    # Send notification
    responder_result = await db.execute(select(Profile).where(Profile.id == user_id))
    responder = responder_result.scalar_one_or_none()
    
    notification = Notification(
        user_id=notify_user_id,
        type='collaboration_response',
        title='Collaboration ' + ('Accepted' if data.accept else 'Denied'),
        body=f'{responder.full_name if responder else "Someone"} {"accepted" if data.accept else "denied"} the collaboration',
        data=json.dumps({
            "post_id": post_id,
            "collaboration_id": collaboration_id,
            "accepted": data.accept
        })
    )
    db.add(notification)
    
    await db.commit()
    
    return {
        "success": True,
        "message": f"Collaboration {'accepted' if data.accept else 'denied'}",
        "status": collaboration.status
    }


@router.delete("/posts/{post_id}/collaborations/{collaboration_id}")
async def untag_collaboration(
    post_id: str,
    collaboration_id: str,
    user_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Untag/remove a collaboration.
    - Post author can remove anyone
    - Collaborator can remove themselves
    """
    collab_result = await db.execute(
        select(PostCollaboration)
        .where(PostCollaboration.id == collaboration_id, PostCollaboration.post_id == post_id)
        .options(selectinload(PostCollaboration.post))
    )
    collaboration = collab_result.scalar_one_or_none()
    
    if not collaboration:
        raise HTTPException(status_code=404, detail="Collaboration not found")
    
    post = collaboration.post
    
    # Check permissions
    if user_id != post.author_id and user_id != collaboration.user_id:
        raise HTTPException(status_code=403, detail="Cannot untag this collaboration")
    
    # Mark as untagged (soft delete)
    collaboration.status = 'untagged'
    collaboration.responded_at = datetime.now(timezone.utc)
    
    await db.commit()
    
    return {"success": True, "message": "Collaboration removed"}


@router.post("/posts/{post_id}/collaborations/{collaboration_id}/flag")
async def flag_collaboration(
    post_id: str,
    collaboration_id: str,
    user_id: str,
    data: FlagCollaborationRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Flag a collaboration as potentially fake ("wasn't there").
    Community-driven verification.
    """
    collab_result = await db.execute(
        select(PostCollaboration).where(
            PostCollaboration.id == collaboration_id,
            PostCollaboration.post_id == post_id
        )
    )
    collaboration = collab_result.scalar_one_or_none()
    
    if not collaboration:
        raise HTTPException(status_code=404, detail="Collaboration not found")
    
    # Can't flag yourself
    if collaboration.user_id == user_id:
        raise HTTPException(status_code=400, detail="Cannot flag your own collaboration")
    
    # Add flag
    flags = collaboration.flag_reasons or []
    flags.append({
        "user_id": user_id,
        "reason": data.reason,
        "timestamp": datetime.now(timezone.utc).isoformat()
    })
    
    collaboration.flag_reasons = flags
    collaboration.flag_count = len(flags)
    
    # Auto-flag if 3+ reports
    if collaboration.flag_count >= 3:
        collaboration.is_flagged = True
    
    await db.commit()
    
    return {
        "success": True,
        "message": "Collaboration flagged for review",
        "flag_count": collaboration.flag_count
    }


@router.get("/users/{user_id}/collaboration-requests")
async def get_user_collaboration_requests(
    user_id: str,
    type: str = Query("all", enum=["all", "incoming", "outgoing"]),
    status: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """
    Get collaboration requests for a user.
    - incoming: Requests from others to join user's posts
    - outgoing: User's requests to join others' posts
    """
    if type == "incoming":
        # Posts where user is author and others are requesting
        query = (
            select(PostCollaboration)
            .join(Post, PostCollaboration.post_id == Post.id)
            .where(Post.author_id == user_id)
            .where(PostCollaboration.initiated_by == 'user')
        )
    elif type == "outgoing":
        # Requests user has made to others' posts
        query = (
            select(PostCollaboration)
            .where(PostCollaboration.user_id == user_id)
            .where(PostCollaboration.initiated_by == 'user')
        )
    else:
        # All requests involving user
        query = (
            select(PostCollaboration)
            .join(Post, PostCollaboration.post_id == Post.id)
            .where(
                or_(
                    Post.author_id == user_id,
                    PostCollaboration.user_id == user_id
                )
            )
        )
    
    if status:
        query = query.where(PostCollaboration.status == status)
    
    query = query.options(
        selectinload(PostCollaboration.user),
        selectinload(PostCollaboration.post).selectinload(Post.author)
    ).order_by(PostCollaboration.created_at.desc())
    
    result = await db.execute(query)
    collaborations = result.scalars().all()
    
    requests = []
    for collab in collaborations:
        post = collab.post
        user = collab.user
        requests.append({
            "id": collab.id,
            "post_id": post.id,
            "post_thumbnail": post.thumbnail_url or post.media_url,
            "post_author_id": post.author_id,
            "post_author_name": post.author.full_name if post.author else None,
            "collaborator_id": collab.user_id,
            "collaborator_name": user.full_name if user else None,
            "collaborator_avatar": user.avatar_url if user else None,
            "status": collab.status,
            "initiated_by": collab.initiated_by,
            "verified_by_gps": collab.verified_by_gps,
            "created_at": collab.created_at
        })
    
    return {"requests": requests, "total": len(requests)}
