"""
AI-powered photo tagging routes for detecting and identifying surfers in photos
Uses GPT-4o Vision API for analysis
"""
import logging
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime, timezone
import os
import json
import base64
import httpx
from dotenv import load_dotenv

from database import get_db
from models import Profile, GalleryItem, Notification, RoleEnum

load_dotenv()

router = APIRouter()

logger = logging.getLogger(__name__)
OPENAI_API_KEY = os.environ.get('OPENAI_API_KEY')


class AnalyzePhotoRequest(BaseModel):
    image_url: Optional[str] = None
    image_base64: Optional[str] = None


class SuggestTagRequest(BaseModel):
    image_url: str
    gallery_item_id: Optional[str] = None


class ConfirmTagRequest(BaseModel):
    gallery_item_id: str
    surfer_ids: List[str]


async def analyze_image_with_vision(image_data: str, is_base64: bool = False) -> dict:
    """
    Analyze an image using GPT-4o Vision API to detect surfers.
    Returns description and detected people count.
    """
    from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent
    
    if not OPENAI_API_KEY:
        raise HTTPException(status_code=500, detail="AI service not configured — OPENAI_API_KEY missing")
    
    chat = LlmChat(
        api_key=OPENAI_API_KEY,
        session_id=f"photo-analysis-{datetime.now().timestamp()}",
        system_message="""You are a surf photo analysis AI. Your job is to analyze surf photos and:
1. Count how many surfers/people are visible in the image
2. Describe what each person is doing (surfing, paddling, watching, etc.)
3. Note distinctive features that could help identify them (wetsuit color, board color, position)
4. Identify the surf conditions and location characteristics

Return your analysis as JSON with this structure:
{
    "people_count": number,
    "people": [
        {
            "position": "description of where in image",
            "action": "what they're doing",
            "distinctive_features": ["list of identifying features"],
            "confidence": "high/medium/low"
        }
    ],
    "conditions": {
        "wave_size": "description",
        "weather": "description",
        "location_hints": ["any identifying features of the location"]
    },
    "overall_description": "brief description of the scene"
}"""
    ).with_model("openai", "gpt-4o")
    
    try:
        if is_base64:
            image_content = ImageContent(image_base64=image_data)
            user_message = UserMessage(
                text="Analyze this surf photo and identify all people visible. Return JSON only.",
                file_contents=[image_content]
            )
        else:
            # For URL, we need to download and convert to base64
            async with httpx.AsyncClient() as client:
                response = await client.get(image_data, timeout=30)
                if response.status_code == 200:
                    image_base64 = base64.b64encode(response.content).decode('utf-8')
                    image_content = ImageContent(image_base64=image_base64)
                    user_message = UserMessage(
                        text="Analyze this surf photo and identify all people visible. Return JSON only.",
                        file_contents=[image_content]
                    )
                else:
                    raise HTTPException(status_code=400, detail="Could not fetch image from URL")
        
        response = await chat.send_message(user_message)
        
        # Parse JSON from response
        try:
            # Try to extract JSON from the response
            if "```json" in response:
                json_str = response.split("```json")[1].split("```")[0].strip()
            elif "```" in response:
                json_str = response.split("```")[1].split("```")[0].strip()
            else:
                json_str = response.strip()
            
            return json.loads(json_str)
        except json.JSONDecodeError:
            # Return a structured response even if JSON parsing fails
            return {
                "people_count": 0,
                "people": [],
                "conditions": {},
                "overall_description": response,
                "raw_response": True
            }
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI analysis failed: {str(e)}")


async def compare_faces(photo_data: str, profile_photos: List[dict]) -> List[dict]:
    """
    Compare faces in a photo with profile photos to suggest matches.
    Returns list of potential matches with confidence scores.
    """
    from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent
    
    if not OPENAI_API_KEY:
        return []
    
    chat = LlmChat(
        api_key=OPENAI_API_KEY,
        session_id=f"face-compare-{datetime.now().timestamp()}",
        system_message="""You are helping identify surfers in photos by comparing with their profile photos.
Given a surf action photo and profile photos, identify which profile photos might match people in the action shot.
Consider: body type, stance, wetsuit/gear if visible, hair color/style, and any other identifying features.
Note: This is for tagging assistance only. Be conservative with matches - only suggest high-confidence matches.

Return JSON:
{
    "matches": [
        {
            "profile_id": "id from the profile list",
            "confidence": "high/medium/low",
            "reasoning": "why you think this is a match"
        }
    ]
}"""
    ).with_model("openai", "gpt-4o")
    
    try:
        # Download main photo
        async with httpx.AsyncClient() as client:
            response = await client.get(photo_data, timeout=30)
            if response.status_code != 200:
                return []
            main_photo_base64 = base64.b64encode(response.content).decode('utf-8')
        
        # Build prompt with profile info
        profiles_text = "\n".join([
            f"Profile ID: {p['id']}, Name: {p['name']}"
            for p in profile_photos
        ])
        
        # For now, just analyze the main photo and return the analysis
        # Full face matching would require sending multiple images
        image_content = ImageContent(image_base64=main_photo_base64)
        user_message = UserMessage(
            text=f"""Analyze this surf photo. These are the potential surfers to match:
{profiles_text}

Based on any visible features, suggest which profiles might be in this photo.
Return JSON with matches array.""",
            file_contents=[image_content]
        )
        
        response = await chat.send_message(user_message)
        
        try:
            if "```json" in response:
                json_str = response.split("```json")[1].split("```")[0].strip()
            elif "```" in response:
                json_str = response.split("```")[1].split("```")[0].strip()
            else:
                json_str = response.strip()
            
            result = json.loads(json_str)
            return result.get("matches", [])
        except json.JSONDecodeError:
            return []
            
    except Exception as e:
        logger.error(f"Face comparison error: {e}")
        return []


@router.post("/ai/analyze-photo")
async def analyze_photo(
    data: AnalyzePhotoRequest,
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
    db: AsyncSession = Depends(get_db)
):
    """
    Analyze a photo and suggest which registered surfers might be in it.
    Uses AI vision to compare with profile photos.
    """
    # Analyze the main photo first
    analysis = await analyze_image_with_vision(data.image_url, is_base64=False)
    
    if analysis.get("people_count", 0) == 0:
        return {
            "success": True,
            "analysis": analysis,
            "suggested_tags": [],
            "message": "No people detected in the photo"
        }
    
    # Get all surfers with profile photos
    surfer_roles = [RoleEnum.GROM, RoleEnum.SURFER, RoleEnum.COMP_SURFER, RoleEnum.PRO]
    result = await db.execute(
        select(Profile)
        .where(Profile.role.in_(surfer_roles))
        .where(Profile.avatar_url.isnot(None))
        .limit(50)  # Limit to prevent too many comparisons
    )
    surfers = result.scalars().all()
    
    profile_photos = [
        {"id": s.id, "name": s.full_name, "avatar_url": s.avatar_url}
        for s in surfers if s.avatar_url
    ]
    
    # Compare faces
    matches = await compare_faces(data.image_url, profile_photos)
    
    # Enrich matches with profile data
    suggested_tags = []
    for match in matches:
        profile = next((p for p in profile_photos if p["id"] == match.get("profile_id")), None)
        if profile:
            suggested_tags.append({
                "profile_id": profile["id"],
                "name": profile["name"],
                "avatar_url": profile["avatar_url"],
                "confidence": match.get("confidence", "low"),
                "reasoning": match.get("reasoning", "")
            })
    
    return {
        "success": True,
        "analysis": analysis,
        "suggested_tags": suggested_tags,
        "people_detected": analysis.get("people_count", 0)
    }


@router.post("/ai/confirm-tags")
async def confirm_surfer_tags(
    photographer_id: str,
    data: ConfirmTagRequest,
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
        if access_granted:
            # No extra charge - photo ready to view
            notification = Notification(
                user_id=sid,
                type='photo_tagged',
                title='Your photo is ready!',
                body='You\'ve been tagged in a photo from your session - no extra charge!',
                data=json.dumps({
                    "gallery_item_id": data.gallery_item_id,
                    "photographer_id": photographer_id,
                    "type": "photo_tagged",
                    "access_granted": True
                })
            )
        elif was_participant and session_photo_price and session_photo_price > 0:
            # Session participant but needs to pay per-photo price
            notification = Notification(
                user_id=sid,
                type='photo_tagged',
                title='You were tagged in a photo!',
                body=f'View your photo for {int(session_photo_price)} credits',
                data=json.dumps({
                    "gallery_item_id": data.gallery_item_id,
                    "photographer_id": photographer_id,
                    "type": "photo_tagged",
                    "access_granted": False,
                    "price": session_photo_price
                })
            )
        else:
            # Non-participant - gallery pricing applies
            notification = Notification(
                user_id=sid,
                type='photo_tagged',
                title='You were tagged in a photo!',
                body='A photographer tagged you in a surf photo',
                data=json.dumps({
                    "gallery_item_id": data.gallery_item_id,
                    "photographer_id": photographer_id,
                    "type": "photo_tagged",
                    "access_granted": False
                })
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
    user_id: str,
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
        tagged_photos.append({
            "id": item.id,
            "tag_id": tag.id,
            "preview_url": item.preview_url,
            "photographer_id": item.photographer_id,
            "photographer_name": item.photographer.full_name if item.photographer else None,
            "photographer_avatar": item.photographer.avatar_url if item.photographer else None,
            "tagged_at": tag.tagged_at.isoformat(),
            "viewed_at": tag.viewed_at.isoformat() if tag.viewed_at else None,
            "is_new": tag.viewed_at is None,  # NEW badge
            "access_granted": tag.access_granted,
            "was_session_participant": tag.was_session_participant,
            "session_photo_price": tag.session_photo_price,
            "is_gift": tag.is_gift,
            "is_for_sale": item.is_for_sale,
            "price": item.price
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
    user_id: str,
    tag_id: str,
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
    db: AsyncSession = Depends(get_db)
):
    """
    Photographer gifts a photo to a tagged surfer (no charge).
    This grants access and creates/updates the PhotoTag record.
    """
    from models import PhotoTag, AnalyticsEvent
    
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
            "id": photo.id,
            "url": photo.preview_url or photo.original_url,
            "thumbnail_url": photo.thumbnail_url,
            "title": photo.title,
            "match_type": "tagged",
            "confidence": 1.0,
            "created_at": photo.created_at.isoformat() if photo.created_at else None
        })
    
    # 2. Get photos from AI claim queue
    claim_result = await db.execute(
        select(SurferGalleryClaimQueue)
        .options(selectinload(SurferGalleryClaimQueue.gallery_item))
        .where(
            SurferGalleryClaimQueue.surfer_id == data.surfer_id,
            SurferGalleryClaimQueue.status == 'pending'
        )
    )
    claim_items = claim_result.scalars().all()
    
    for claim in claim_items:
        if claim.gallery_item and claim.gallery_item.photographer_id == data.photographer_id:
            # Avoid duplicates
            if not any(m["id"] == claim.gallery_item.id for m in matches):
                matches.append({
                    "id": claim.gallery_item.id,
                    "url": claim.gallery_item.preview_url or claim.gallery_item.original_url,
                    "thumbnail_url": claim.gallery_item.thumbnail_url,
                    "title": claim.gallery_item.title,
                    "match_type": "ai_suggested",
                    "confidence": claim.confidence_score or 0.8,
                    "created_at": claim.gallery_item.created_at.isoformat() if claim.gallery_item.created_at else None
                })
    
    # 3. Get photos from sessions the surfer participated in
    # Check booking participants
    booking_result = await db.execute(
        select(Booking.id)
        .join(BookingParticipant, BookingParticipant.booking_id == Booking.id)
        .where(
            Booking.photographer_id == data.photographer_id,
            BookingParticipant.participant_id == data.surfer_id
        )
    )
    booking_ids = [b[0] for b in booking_result.fetchall()]
    
    # Check dispatch participants
    dispatch_result = await db.execute(
        select(DispatchRequest.id)
        .join(DispatchRequestParticipant, DispatchRequestParticipant.dispatch_request_id == DispatchRequest.id)
        .where(
            DispatchRequest.photographer_id == data.photographer_id,
            DispatchRequestParticipant.participant_id == data.surfer_id
        )
    )
    dispatch_ids = [d[0] for d in dispatch_result.fetchall()]
    
    # Get gallery items from these sessions
    if booking_ids or dispatch_ids:
        session_photos_query = select(GalleryItem).where(
            GalleryItem.photographer_id == data.photographer_id
        )
        
        # Filter by session references if available
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
                # Avoid duplicates
                if not any(m["id"] == photo.id for m in matches):
                    matches.append({
                        "id": photo.id,
                        "url": photo.preview_url or photo.original_url,
                        "thumbnail_url": photo.thumbnail_url,
                        "title": photo.title,
                        "match_type": "session_participant",
                        "confidence": 0.7,
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
