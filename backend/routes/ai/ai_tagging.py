"""
Authenticated photo tagging and relationship-based photo lookup.
Image analysis uses OpenAI; people are tagged only through explicit user selection.
"""
import logging
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime, timezone
import json

from database import get_db
from core.security import get_current_user_id, get_user_id_from_jwt_or_query
from models import Profile, GalleryItem, Notification, RoleEnum
from models import AnalyticsEvent, Booking, BookingParticipant, LiveSession, LiveSessionParticipant, PhotoTag

# Vision helpers extracted to ai_vision.py (v94 audit)
from .ai_vision import analyze_image_with_vision, analyze_surfboard_with_vision, MAX_ENCODED_LENGTH

router = APIRouter()
logger = logging.getLogger(__name__)

class AnalyzePhotoRequest(BaseModel):
    image_url: Optional[str] = Field(default=None, max_length=8192)
    image_base64: Optional[str] = Field(default=None, max_length=MAX_ENCODED_LENGTH)


class SuggestTagRequest(BaseModel):
    image_url: str = Field(max_length=8192)
    gallery_item_id: Optional[str] = None


class ConfirmTagRequest(BaseModel):
    gallery_item_id: str
    surfer_ids: List[str]



@router.post("/ai/analyze-photo")
async def analyze_photo(
    data: AnalyzePhotoRequest,
    current_user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """
    Analyze a photo using AI to detect surfers and describe the scene.
    Accepts either image_url or image_base64.
    """
    if not data.image_url and not data.image_base64:
        raise HTTPException(status_code=400, detail="Provide either image_url or image_base64")
    
    if data.image_base64:
        result = await analyze_image_with_vision(data.image_base64, is_base64=True)
    else:
        result = await analyze_image_with_vision(data.image_url, is_base64=False)
    
    return {
        "success": True,
        "analysis": result
    }


@router.post("/ai/suggest-tags")
async def suggest_surfer_tags(
    data: SuggestTagRequest,
    current_user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """Describe an owned photo for manual tagging; never identify people from pixels."""
    image_url = data.image_url
    if data.gallery_item_id:
        item_result = await db.execute(
            select(GalleryItem).where(GalleryItem.id == data.gallery_item_id,
                                      GalleryItem.photographer_id == current_user_id)
        )
        item = item_result.scalar_one_or_none()
        if item is None:
            raise HTTPException(404, "Gallery item not found or not owned by you")
        if item.media_type == "video":
            raise HTTPException(400, "Choose a photo for image analysis")
        # The owned item's media is authoritative; never analyze a substituted request URL.
        image_url = item.preview_url or item.original_url
    analysis = await analyze_image_with_vision(image_url)
    return {
        "success": True,
        "analysis": analysis,
        "visual_tags": analysis["visual_tags"],
        "suggested_tags": [],  # Legacy person-match contract; no biometric identity inference.
        "people_detected": analysis["people_count"],
        "message": "Review the visual tags and select known session participants manually.",
    }


@router.post("/ai/confirm-tags")
async def confirm_surfer_tags(
    photographer_id: str,
    data: ConfirmTagRequest,
    current_user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """
    Confirm and save surfer tags on a gallery item.
    - Checks if surfer was a session participant
    - If session had $0 photo price and surfer was participant, auto-grants access
    - Notifies tagged surfers appropriately
    - Tracks analytics
    """
    from models import PhotoTag, AnalyticsEvent, LiveSession, LiveSessionParticipant, Gallery

    if photographer_id != current_user_id:
        raise HTTPException(status_code=403, detail="Cannot act on behalf of another user")
    
    # Verify photographer owns the gallery item
    item_result = await db.execute(
        select(GalleryItem)
        .where(GalleryItem.id == data.gallery_item_id)
        .where(GalleryItem.photographer_id == photographer_id)
        .options(selectinload(GalleryItem.gallery))
    )
    item = item_result.scalar_one_or_none()
    
    if not item:
        raise HTTPException(status_code=404, detail="Gallery item not found or not owned by you")
    
    # Get the live session info if this item belongs to a session gallery
    live_session = None
    session_photo_price = None
    if item.gallery and item.gallery.live_session_id:
        session_result = await db.execute(
            select(LiveSession).where(LiveSession.id == item.gallery.live_session_id)
        )
        live_session = session_result.scalar_one_or_none()
        if live_session:
            session_photo_price = live_session.photo_price
    
    # Process each surfer tag
    surfer_ids = []
    tagged_details = []
    
    for sid in data.surfer_ids:
        surfer_result = await db.execute(select(Profile).where(Profile.id == sid))
        surfer = surfer_result.scalar_one_or_none()
        if not surfer:
            continue
            
        surfer_ids.append(sid)
        
        # Check if surfer was a session participant
        was_participant = False
        if live_session:
            participant_result = await db.execute(
                select(LiveSessionParticipant)
                .where(LiveSessionParticipant.photographer_id == photographer_id)
                .where(LiveSessionParticipant.surfer_id == sid)
                .where(LiveSessionParticipant.status.in_(['active', 'completed']))
            )
            participant = participant_result.scalar_one_or_none()
            was_participant = participant is not None
        
        # Determine if access should be auto-granted (no extra charge for session participants)
        access_granted = False
        if was_participant and session_photo_price is not None and session_photo_price == 0:
            access_granted = True
        
        # Create PhotoTag record
        photo_tag = PhotoTag(
            gallery_item_id=data.gallery_item_id,
            surfer_id=sid,
            photographer_id=photographer_id,
            live_session_id=live_session.id if live_session else None,
            was_session_participant=was_participant,
            session_photo_price=session_photo_price,
            access_granted=access_granted,
            is_gift=False
        )
        db.add(photo_tag)
        
        # Create appropriate notification
        title, body = 'You were tagged in a photo!', 'A photographer tagged you in a surf photo'
        n_data = {"gallery_item_id": data.gallery_item_id, "photographer_id": photographer_id, "type": "photo_tagged", "access_granted": False}
        if access_granted:
            title = 'Your photo is ready!'
            body = "You've been tagged in a photo from your session - no extra charge!"
            n_data["access_granted"] = True
        elif was_participant and session_photo_price and session_photo_price > 0:
            body = f'View your photo for {int(session_photo_price)} credits'
            n_data["price"] = session_photo_price

        notification = Notification(
            user_id=sid,
            type='photo_tagged',
            title=title,
            body=body,
            data=json.dumps(n_data)
        )
        db.add(notification)
        
        tagged_details.append({
            "surfer_id": sid,
            "was_participant": was_participant,
            "access_granted": access_granted
        })
        
        # Track analytics event
        analytics = AnalyticsEvent(
            event_type='photo_tagged',
            user_id=sid,
            entity_type='gallery_item',
            entity_id=data.gallery_item_id,
            event_data=json.dumps({
                "photographer_id": photographer_id,
                "was_session_participant": was_participant,
                "access_granted": access_granted,
                "session_photo_price": session_photo_price
            })
        )
        db.add(analytics)
    
    # Update gallery item with tags (legacy field)
    item.tagged_surfer_ids = json.dumps(surfer_ids)
    
    await db.commit()
    
    return {
        "success": True,
        "tagged_count": len(surfer_ids),
        "gallery_item_id": data.gallery_item_id,
        "details": tagged_details
    }


@router.get("/ai/my-tagged-photos")
async def get_my_tagged_photos(
    user_id: str = Depends(get_user_id_from_jwt_or_query),
    limit: int = Query(default=20, le=100),
    db: AsyncSession = Depends(get_db)
):
    """
    Get all photos where a user has been tagged.
    Uses PhotoTag model for proper tracking of viewed/claimed status.
    """
    from models import PhotoTag, AnalyticsEvent
    
    # Get photo tags for this user
    result = await db.execute(
        select(PhotoTag)
        .where(PhotoTag.surfer_id == user_id)
        .options(
            selectinload(PhotoTag.gallery_item).selectinload(GalleryItem.photographer),
            selectinload(PhotoTag.photographer)
        )
        .order_by(PhotoTag.tagged_at.desc())
        .limit(limit)
    )
    tags = result.scalars().all()
    
    tagged_photos = []
    for tag in tags:
        if not tag.gallery_item:
            continue
            
        item = tag.gallery_item
        p = item.photographer
        tagged_photos.append({
            "id": item.id, "tag_id": tag.id, "preview_url": item.preview_url, "photographer_id": item.photographer_id,
            "photographer_name": p.full_name if p else None, "photographer_avatar": p.avatar_url if p else None,
            "tagged_at": tag.tagged_at.isoformat(), "viewed_at": tag.viewed_at.isoformat() if tag.viewed_at else None,
            "is_new": tag.viewed_at is None, "access_granted": tag.access_granted,
            "was_session_participant": tag.was_session_participant, "session_photo_price": tag.session_photo_price,
            "is_gift": tag.is_gift, "is_for_sale": item.is_for_sale, "price": item.price
        })
    
    # Count unviewed (new) photos
    unviewed_count = len([p for p in tagged_photos if p["is_new"]])
    
    return {
        "tagged_photos": tagged_photos,
        "total_count": len(tagged_photos),
        "new_count": unviewed_count
    }


@router.post("/ai/mark-photo-viewed")
async def mark_photo_viewed(
    tag_id: str,
    user_id: str = Depends(get_user_id_from_jwt_or_query),
    db: AsyncSession = Depends(get_db)
):
    """
    Mark a tagged photo as viewed (clears the NEW badge).
    Tracks analytics for engagement metrics.
    """
    from models import PhotoTag, AnalyticsEvent
    
    # Get the photo tag
    result = await db.execute(
        select(PhotoTag)
        .where(PhotoTag.id == tag_id)
        .where(PhotoTag.surfer_id == user_id)
    )
    tag = result.scalar_one_or_none()
    
    if not tag:
        raise HTTPException(status_code=404, detail="Photo tag not found")
    
    # Only update if not already viewed
    first_view = tag.viewed_at is None
    if first_view:
        tag.viewed_at = datetime.now(timezone.utc)
        
        # Track analytics
        analytics = AnalyticsEvent(
            event_type='photo_viewed',
            user_id=user_id,
            entity_type='gallery_item',
            entity_id=tag.gallery_item_id,
            event_data=json.dumps({
                "photographer_id": tag.photographer_id,
                "time_to_view_seconds": (tag.viewed_at - tag.tagged_at).total_seconds() if tag.tagged_at else None,
                "access_granted": tag.access_granted
            })
        )
        db.add(analytics)
        await db.commit()
    
    return {
        "success": True,
        "first_view": first_view,
        "viewed_at": tag.viewed_at.isoformat()
    }


@router.post("/ai/gift-photo")
async def gift_photo_to_surfer(
    photographer_id: str,
    gallery_item_id: str,
    surfer_id: str,
    current_user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """
    Photographer gifts a photo to a tagged surfer (no charge).
    This grants access and creates/updates the PhotoTag record.
    """
    from models import PhotoTag, AnalyticsEvent

    if photographer_id != current_user_id:
        raise HTTPException(status_code=403, detail="Cannot act on behalf of another user")

    # Verify photographer owns the photo
    item_result = await db.execute(
        select(GalleryItem)
        .where(GalleryItem.id == gallery_item_id)
        .where(GalleryItem.photographer_id == photographer_id)
    )
    item = item_result.scalar_one_or_none()
    
    if not item:
        raise HTTPException(status_code=404, detail="Photo not found or not owned by you")
    
    # Verify surfer exists
    surfer_result = await db.execute(select(Profile).where(Profile.id == surfer_id))
    surfer = surfer_result.scalar_one_or_none()
    
    if not surfer:
        raise HTTPException(status_code=404, detail="Surfer not found")
    
    # Check if PhotoTag exists
    tag_result = await db.execute(
        select(PhotoTag)
        .where(PhotoTag.gallery_item_id == gallery_item_id)
        .where(PhotoTag.surfer_id == surfer_id)
    )
    tag = tag_result.scalar_one_or_none()
    
    if tag:
        # Update existing tag
        tag.is_gift = True
        tag.access_granted = True
    else:
        # Create new PhotoTag as a gift
        tag = PhotoTag(
            gallery_item_id=gallery_item_id,
            surfer_id=surfer_id,
            photographer_id=photographer_id,
            is_gift=True,
            access_granted=True
        )
        db.add(tag)
    
    # Notify the surfer
    photographer_result = await db.execute(select(Profile).where(Profile.id == photographer_id))
    photographer = photographer_result.scalar_one_or_none()
    
    notification = Notification(
        user_id=surfer_id,
        type='photo_gifted',
        title='You received a gift! 🎁',
        body=f'{photographer.full_name if photographer else "A photographer"} gifted you a photo!',
        data=json.dumps({
            "gallery_item_id": gallery_item_id,
            "photographer_id": photographer_id,
            "type": "photo_gifted",
            "access_granted": True
        })
    )
    db.add(notification)
    
    # Track analytics
    analytics = AnalyticsEvent(
        event_type='photo_gifted',
        user_id=surfer_id,
        entity_type='gallery_item',
        entity_id=gallery_item_id,
        event_data=json.dumps({
            "photographer_id": photographer_id,
            "surfer_id": surfer_id
        })
    )
    db.add(analytics)
    
    await db.commit()
    
    return {
        "success": True,
        "message": f"Photo gifted to {surfer.full_name}!",
        "surfer_name": surfer.full_name
    }



# ===================== AI Face Match Endpoint =====================

class FaceMatchRequest(BaseModel):
    photographer_id: str
    surfer_id: str


@router.post("/ai/face-match")
async def ai_face_match(
    data: FaceMatchRequest,
    current_user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """
    Find photos in a photographer's gallery that might contain the surfer.
    Uses the surfer's profile photo or selfie to match against gallery items.
    
    For now, this returns photos that:
    1. Were taken during a session the surfer participated in
    2. Are tagged with the surfer
    3. Are in the AI claim queue for this surfer
    
    Future: Will use actual face recognition/embedding matching
    """
    from models import (
        GalleryItem, Gallery, PhotoTag, SurferGalleryClaimQueue,
        Booking, BookingParticipant, DispatchRequest, DispatchRequestParticipant,
        LiveSession, LiveSessionParticipant
    )
    
    if current_user_id not in (data.photographer_id, data.surfer_id):
        raise HTTPException(status_code=403, detail="Cannot act on behalf of another user")

    # Get the surfer profile for their selfie/profile photo
    surfer_result = await db.execute(
        select(Profile).where(Profile.id == data.surfer_id)
    )
    surfer = surfer_result.scalar_one_or_none()
    
    if not surfer:
        raise HTTPException(status_code=404, detail="Surfer not found")
    
    matches = []
    
    # 1. Get photos already tagged with this surfer
    tagged_result = await db.execute(
        select(GalleryItem)
        .join(PhotoTag, PhotoTag.gallery_item_id == GalleryItem.id)
        .where(
            GalleryItem.photographer_id == data.photographer_id,
            PhotoTag.surfer_id == data.surfer_id
        )
    )
    tagged_photos = tagged_result.scalars().all()
    
    for photo in tagged_photos:
        matches.append({
            "id": photo.id, "url": photo.preview_url or photo.original_url, "thumbnail_url": photo.thumbnail_url,
            "title": photo.title, "match_type": "tagged", "confidence": 1.0,
            "created_at": photo.created_at.isoformat() if photo.created_at else None
        })
    
    # 2. Get photos from AI claim queue
    claim_result = await db.execute(
        select(SurferGalleryClaimQueue)
        .options(selectinload(SurferGalleryClaimQueue.gallery_item))
        .where(SurferGalleryClaimQueue.surfer_id == data.surfer_id, SurferGalleryClaimQueue.status == 'pending')
    )
    claim_items = claim_result.scalars().all()
    
    for claim in claim_items:
        gi = claim.gallery_item
        if gi and gi.photographer_id == data.photographer_id and not any(m["id"] == gi.id for m in matches):
            matches.append({
                "id": gi.id, "url": gi.preview_url or gi.original_url, "thumbnail_url": gi.thumbnail_url,
                "title": gi.title, "match_type": "ai_suggested", "confidence": claim.confidence_score or 0.8,
                "created_at": gi.created_at.isoformat() if gi.created_at else None
            })
    
    # 3. Get photos from sessions the surfer participated in
    booking_result = await db.execute(
        select(Booking.id).join(BookingParticipant, BookingParticipant.booking_id == Booking.id)
        .where(Booking.photographer_id == data.photographer_id, BookingParticipant.participant_id == data.surfer_id)
    )
    booking_ids = [b[0] for b in booking_result.fetchall()]
    
    dispatch_result = await db.execute(
        select(DispatchRequest.id).join(DispatchRequestParticipant, DispatchRequestParticipant.dispatch_request_id == DispatchRequest.id)
        .where(DispatchRequest.photographer_id == data.photographer_id, DispatchRequestParticipant.participant_id == data.surfer_id)
    )
    dispatch_ids = [d[0] for d in dispatch_result.fetchall()]
    
    if booking_ids or dispatch_ids:
        session_photos_query = select(GalleryItem).where(GalleryItem.photographer_id == data.photographer_id)
        conditions = []
        if booking_ids:
            conditions.append(GalleryItem.booking_id.in_(booking_ids))
        if dispatch_ids:
            conditions.append(GalleryItem.dispatch_id.in_(dispatch_ids))
        
        if conditions:
            from sqlalchemy import or_
            session_photos_query = session_photos_query.where(or_(*conditions))
            session_result = await db.execute(session_photos_query.limit(50))
            session_photos = session_result.scalars().all()
            
            for photo in session_photos:
                if not any(m["id"] == photo.id for m in matches):
                    matches.append({
                        "id": photo.id, "url": photo.preview_url or photo.original_url, "thumbnail_url": photo.thumbnail_url,
                        "title": photo.title, "match_type": "session_participant", "confidence": 0.7,
                        "created_at": photo.created_at.isoformat() if photo.created_at else None
                    })
    
    # Sort by confidence descending
    matches.sort(key=lambda x: x.get("confidence", 0), reverse=True)
    
    return {
        "matches": matches,
        "total_count": len(matches),
        "surfer_name": surfer.full_name,
        "photographer_id": data.photographer_id
    }


# ===================== AI Surfboard Scanner =====================

class ScanSurfboardRequest(BaseModel):
    image_url: Optional[str] = Field(default=None, max_length=8192)
    image_base64: Optional[str] = Field(default=None, max_length=MAX_ENCODED_LENGTH)
    surfboard_id: Optional[str] = None  # Link analysis to a specific board


@router.post("/ai/scan-surfboard")
async def scan_surfboard_image(
    data: ScanSurfboardRequest,
    current_user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """Return observed board attributes for review, after validating optional board ownership."""
    if not data.image_url and not data.image_base64:
        raise HTTPException(status_code=400, detail="Provide either image_url or image_base64")

    if data.surfboard_id:
        from models import Surfboard
        board_result = await db.execute(select(Surfboard).where(Surfboard.id == data.surfboard_id))
        board = board_result.scalar_one_or_none()
        if board is None:
            raise HTTPException(status_code=404, detail="Surfboard not found")
        if board.user_id != current_user_id:
            raise HTTPException(status_code=403, detail="Cannot act on behalf of another user")

    analysis = await analyze_surfboard_with_vision(
        data.image_base64 or data.image_url, is_base64=bool(data.image_base64)
    )
    return {
        "success": True,
        "analysis": analysis,
        "surfboard_id": data.surfboard_id,
        "saved": False,
        "message": "Review detected attributes before saving them to your surfboard.",
    }
