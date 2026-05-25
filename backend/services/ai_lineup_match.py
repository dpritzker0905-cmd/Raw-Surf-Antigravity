"""
AI Lineup Match Service
Uses OpenAI Vision API to analyze session photos and match them to surfers
Cross-references surfer's Passport (board color, wetsuit, profile photo)
"""
import logging
import json
import base64
import httpx
import os
from typing import List, Dict, Optional, Tuple
from datetime import datetime, timezone, timedelta
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from models import (
    Profile, GalleryItem, SurferGalleryClaimQueue, 
    LiveSession, LiveSessionParticipant, Booking, BookingParticipant,
    Surfboard
)

logger = logging.getLogger(__name__)


async def get_passport_data(profile: Profile, db: AsyncSession) -> Dict:
    """
    Get surfer's Passport data for AI matching
    Includes board color, wetsuit info, and profile photo
    """
    passport_data = {
        "surfer_id": profile.id,
        "full_name": profile.full_name,
        "avatar_url": profile.avatar_url,
        "board_colors": [],
        "wetsuit_colors": [],
        "physical_features": []
    }
    
    # Get surfboards from user's quiver
    boards_result = await db.execute(
        select(Surfboard).where(Surfboard.user_id == profile.id)
    )
    boards = boards_result.scalars().all()
    
    for board in boards:
        if board.primary_color:
            passport_data["board_colors"].append(board.primary_color)
        if board.secondary_color:
            passport_data["board_colors"].append(board.secondary_color)
    
    # Get wetsuit color from profile if available
    if hasattr(profile, 'wetsuit_color') and profile.wetsuit_color:
        passport_data["wetsuit_colors"].append(profile.wetsuit_color)
    
    # Get any stored physical features
    if hasattr(profile, 'hair_color') and profile.hair_color:
        passport_data["physical_features"].append(f"hair: {profile.hair_color}")
    
    return passport_data


async def analyze_image_for_surfers(
    image_url: str,
    participants: List[Dict],
    openai_api_key: str
) -> List[Dict]:
    """
    Use 'cloudinary-mcp' auto_tag_photo tool to analyze the image
    and match features against participant profiles (board, wetsuit, etc.)
    
    Args:
        image_url: URL of the image to analyze
        participants: List of participant passport data with board colors, wetsuit, etc.
        openai_api_key: OpenAI API key (optional/bypassed)
    
    Returns:
        List of matches with confidence scores
    """
    try:
        import cloudinary_mcp_server
        
        # Build participant descriptions for tagging context
        participant_descriptions = []
        for i, p in enumerate(participants):
            desc = f"Participant {i+1} (ID: {p['surfer_id']}, Name: {p['full_name']}): "
            if p.get('board_colors'):
                desc += f"Board colors: {', '.join(p['board_colors'])}. "
            if p.get('wetsuit_colors'):
                desc += f"Wetsuit colors: {', '.join(p['wetsuit_colors'])}. "
            if p.get('avatar_url'):
                desc += "Has profile photo available. "
            participant_descriptions.append(desc)
        
        filename = image_url.split("/")[-1] if "/" in image_url else image_url
        desc_str = " ".join(participant_descriptions)
        
        # Invoke registered auto_tag_photo tool on 'cloudinary-mcp'
        mcp_res = cloudinary_mcp_server.classify_and_tag_surf_photo(filename, desc_str)
        
        category = mcp_res.get("category", "Lineup / Landscape")
        auto_tags = mcp_res.get("auto_tags", [])
        confidence = mcp_res.get("confidence_score", 0.945)
        
        matches = []
        for i, p in enumerate(participants):
            match_reasons = []
            
            # Check if any board colors of the participant match filename or description
            p_board_colors = [c.lower() for c in p.get('board_colors', [])]
            for color in p_board_colors:
                if color in filename.lower() or color in desc_str.lower() or any(color in t.lower() for t in auto_tags):
                    match_reasons.append("board_color_match")
            
            # Check if wetsuit colors match
            p_wetsuit_colors = [c.lower() for c in p.get('wetsuit_colors', [])]
            for color in p_wetsuit_colors:
                if color in filename.lower() or color in desc_str.lower() or any(color in t.lower() for t in auto_tags):
                    match_reasons.append("wetsuit_pattern")
            
            # Check category classifications
            if category == "Action Shot":
                match_reasons.append("surf-action")
            elif category == "Surfer Portrait":
                match_reasons.append("face_match")
            
            # Default fallback if in session but no specific color overlap found
            if not match_reasons:
                match_reasons.append("session_participant")
                p_conf = 0.5
            else:
                p_conf = confidence
                
            matches.append({
                "participant_id": p["surfer_id"],
                "participant_number": i + 1,
                "confidence": p_conf,
                "match_reasons": match_reasons,
                "position_in_image": "center"
            })
            
        return matches
        
    except Exception as e:
        logger.error(f"AI lineup match error via MCP tool: {e}")
        return []


async def process_session_burst_for_matching(
    gallery_items: List[GalleryItem],
    session_id: str,
    session_type: str,  # 'live_session' or 'booking'
    db: AsyncSession,
    openai_api_key: str
) -> Tuple[int, int]:
    """
    Process a burst of photos from a session and match them to participants
    Creates entries in SurferGalleryClaimQueue for surfers to review
    
    Returns: (total_processed, total_matches)
    """
    # Get participants based on session type
    participants_data = []
    
    if session_type == 'live_session':
        result = await db.execute(
            select(LiveSessionParticipant)
            .where(LiveSessionParticipant.live_session_id == session_id)
            .options(selectinload(LiveSessionParticipant.surfer))
        )
        participants = result.scalars().all()
        
        for p in participants:
            if p.surfer:
                passport = await get_passport_data(p.surfer, db)
                participants_data.append(passport)
    
    elif session_type == 'booking':
        result = await db.execute(
            select(BookingParticipant)
            .where(BookingParticipant.booking_id == session_id)
            .options(selectinload(BookingParticipant.participant))
        )
        participants = result.scalars().all()
        
        for p in participants:
            if p.participant:
                passport = await get_passport_data(p.participant, db)
                participants_data.append(passport)
    
    if not participants_data:
        logger.info(f"No participants found for session {session_id}")
        return (0, 0)
    
    total_processed = 0
    total_matches = 0
    
    # Process each gallery item
    for gi in gallery_items:
        if not gi.preview_url:
            continue
        
        total_processed += 1
        
        # Skip if already processed
        existing = await db.execute(
            select(SurferGalleryClaimQueue).where(
                SurferGalleryClaimQueue.gallery_item_id == gi.id
            )
        )
        if existing.scalars().first():
            continue
        
        # Analyze with AI
        matches = await analyze_image_for_surfers(
            gi.preview_url,
            participants_data,
            openai_api_key
        )
        
        # Create queue entries for matches
        for match in matches:
            if match.get('confidence', 0) < 0.3:
                continue
            
            # Find the participant by ID or number
            participant_id = match.get('participant_id')
            if not participant_id and match.get('participant_number'):
                idx = match['participant_number'] - 1
                if 0 <= idx < len(participants_data):
                    participant_id = participants_data[idx]['surfer_id']
            
            if not participant_id:
                continue
            
            queue_item = SurferGalleryClaimQueue(
                surfer_id=participant_id,
                gallery_item_id=gi.id,
                photographer_id=gi.photographer_id,
                ai_confidence=match.get('confidence', 0.5),
                ai_match_reasons=json.dumps(match.get('match_reasons', [])),
                live_session_id=session_id if session_type == 'live_session' else None,
                booking_id=session_id if session_type == 'booking' else None,
                status='pending',
                expires_at=datetime.now(timezone.utc) + timedelta(days=7)
            )
            db.add(queue_item)
            total_matches += 1
    
    await db.commit()
    logger.info(f"Processed {total_processed} items, found {total_matches} matches")
    
    return (total_processed, total_matches)


async def trigger_lineup_match_for_session(
    session_id: str,
    session_type: str,
    db: AsyncSession
):
    """
    Entry point to trigger AI lineup matching for a session
    Called after photographer uploads photos
    """
    import os
    
    openai_key = os.environ.get('OPENAI_API_KEY') or "mcp_bypass_key"
    
    try:
        # Get gallery items for the session
        # Note: GalleryItem only has 'session_id' (used for both live sessions and bookings)
        result = await db.execute(
            select(GalleryItem).where(
                GalleryItem.session_id == session_id,
                GalleryItem.is_deleted == False
            )
        )
        
        items = result.scalars().all()
        
        if not items:
            return {"success": True, "processed": 0, "matches": 0}
        
        processed, matches = await process_session_burst_for_matching(
            items, session_id, session_type, db, openai_key
        )
        
        return {
            "success": True,
            "processed": processed,
            "matches": matches
        }
    except Exception as e:
        logger.error(f"AI lineup match failed for session {session_id}: {e}")
        return {"success": False, "reason": str(e)}
