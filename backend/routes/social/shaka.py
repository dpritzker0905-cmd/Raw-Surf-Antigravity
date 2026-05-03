"""
Shaka Feedback System API

Automated gratitude system for sponsorships:
- Recipients get prompted to send a "Shaka" back
- Shakas can be video recordings or pre-made animations
- Public shakas get posted to feed
"""

from fastapi import APIRouter, HTTPException, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone
import json

from database import get_db
from models import (
    Profile, SponsorshipTransaction, ShakaMessage, Post, 
    Notification, SponsorshipType
)

router = APIRouter(tags=["Shaka"])


# Pre-made Shaka animations/GIFs
SHAKA_ANIMATIONS = [
    {"id": "shaka_wave", "name": "Classic Shaka Wave", "preview_url": "/animations/shaka_wave.gif"},
    {"id": "surfer_thanks", "name": "Surfer Thanks", "preview_url": "/animations/surfer_thanks.gif"},
    {"id": "stoked", "name": "Stoked!", "preview_url": "/animations/stoked.gif"},
    {"id": "mahalo", "name": "Mahalo", "preview_url": "/animations/mahalo.gif"},
    {"id": "hang_loose", "name": "Hang Loose", "preview_url": "/animations/hang_loose.gif"},
    {"id": "barrel_thanks", "name": "Barrel Thanks", "preview_url": "/animations/barrel_thanks.gif"},
]


class SendShakaRequest(BaseModel):
    sponsorship_id: str
    message_type: str = 'animation'  # 'animation', 'video', 'text'
    message_text: Optional[str] = None
    video_url: Optional[str] = None
    animation_id: Optional[str] = None
    is_public: bool = True


# ============ SHAKA ENDPOINTS ============

@router.get("/shaka/animations")
async def get_shaka_animations():
    """Get list of pre-made Shaka animations"""
    return SHAKA_ANIMATIONS


@router.get("/shaka/pending/{user_id}")
async def get_pending_shaka_prompts(
    user_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Get sponsorships that haven't received a Shaka response yet.
    These are displayed as prompts to the recipient.
    """
    result = await db.execute(
        select(SponsorshipTransaction)
        .where(SponsorshipTransaction.recipient_id == user_id)
        .where(SponsorshipTransaction.shaka_sent == False)
        .options(selectinload(SponsorshipTransaction.donor))
        .order_by(SponsorshipTransaction.created_at.desc())
    )
    sponsorships = result.scalars().all()
    
    return [{
        "sponsorship_id": s.id,
        "donor_id": s.donor_id,
        "donor_name": s.donor.full_name if s.donor else "Anonymous",
        "donor_avatar": s.donor.avatar_url if s.donor else None,
        "amount": s.net_amount,
        "sponsorship_type": s.sponsorship_type.value,
        "recipient_type": s.recipient_type,
        "created_at": s.created_at.isoformat(),
        "prompt_message": f"{s.donor.full_name if s.donor else 'Someone'} just sponsored your next session! Send a Shaka back?"
    } for s in sponsorships]


@router.post("/shaka/send")
async def send_shaka(
    sender_id: str,
    data: SendShakaRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Send a Shaka thank you message in response to a sponsorship.
    Can be a video, animation, or text message.
    If public, creates a post on the feed.
    """
    # Get the sponsorship
    sponsor_result = await db.execute(
        select(SponsorshipTransaction)
        .where(SponsorshipTransaction.id == data.sponsorship_id)
        .options(selectinload(SponsorshipTransaction.donor))
    )
    sponsorship = sponsor_result.scalar_one_or_none()
    
    if not sponsorship:
        raise HTTPException(status_code=404, detail="Sponsorship not found")
    
    if sponsorship.recipient_id != sender_id:
        raise HTTPException(status_code=403, detail="You can only respond to sponsorships you received")
    
    if sponsorship.shaka_sent:
        raise HTTPException(status_code=400, detail="Shaka already sent for this sponsorship")
    
    # Get sender profile
    sender_result = await db.execute(select(Profile).where(Profile.id == sender_id))
    sender = sender_result.scalar_one_or_none()
    
    if not sender:
        raise HTTPException(status_code=404, detail="Sender not found")
    
    # Validate animation ID if using animation
    if data.message_type == 'animation':
        valid_ids = [a["id"] for a in SHAKA_ANIMATIONS]
        if data.animation_id not in valid_ids:
            raise HTTPException(status_code=400, detail="Invalid animation ID")
    
    # Create the Shaka message
    shaka = ShakaMessage(
        sender_id=sender_id,
        recipient_id=sponsorship.donor_id,
        sponsorship_id=data.sponsorship_id,
        message_type=data.message_type,
        message_text=data.message_text,
        video_url=data.video_url,
        animation_id=data.animation_id,
        is_public=data.is_public
    )
    db.add(shaka)
    await db.flush()
    
    # If public, create a post on the feed
    post_id = None
    if data.is_public:
        # Determine caption based on message type
        if data.message_type == 'video':
            caption = f"🤙 {sender.full_name} sends a Shaka to {sponsorship.donor.full_name if sponsorship.donor else 'their sponsor'}!"
            if data.message_text:
                caption += f"\n\n\"{data.message_text}\""
            media_url = data.video_url
            media_type = 'video'
        elif data.message_type == 'animation':
            anim = next((a for a in SHAKA_ANIMATIONS if a["id"] == data.animation_id), None)
            caption = f"🤙 {sender.full_name} sends a Shaka to {sponsorship.donor.full_name if sponsorship.donor else 'their sponsor'}!"
            if data.message_text:
                caption += f"\n\n\"{data.message_text}\""
            media_url = anim["preview_url"] if anim else None
            media_type = 'image'
        else:
            caption = f"🤙 {sender.full_name} says: \"{data.message_text}\" to {sponsorship.donor.full_name if sponsorship.donor else 'their sponsor'}!"
            media_url = None
            media_type = 'text'
        
        # Sponsorship context
        if sponsorship.sponsorship_type == SponsorshipType.PRO_SPONSORSHIP:
            caption += f"\n\n💰 Thanks for the ${sponsorship.net_amount:.2f} Pro Sponsorship!"
        else:
            caption += f"\n\n🌊 Thanks for the ${sponsorship.net_amount:.2f} Impact Donation!"
        
        post = Post(
            author_id=sender_id,
            caption=caption,
            media_url=media_url,
            media_type=media_type,
            is_check_in=False
        )
        db.add(post)
        await db.flush()
        
        shaka.post_id = post.id
        post_id = post.id
    
    # Mark sponsorship as having received shaka
    sponsorship.shaka_sent = True
    
    # Notify the donor
    notification = Notification(
        user_id=sponsorship.donor_id,
        type='shaka_received',
        title='🤙 You received a Shaka!',
        body=f'{sender.full_name} thanked you for sponsoring them!',
        data=json.dumps({
            "shaka_id": shaka.id,
            "sender_id": sender_id,
            "sender_name": sender.full_name,
            "sender_avatar": sender.avatar_url,
            "message_type": data.message_type,
            "post_id": post_id,
            "is_public": data.is_public
        })
    )
    db.add(notification)
    
    await db.commit()
    
    return {
        "success": True,
        "shaka_id": shaka.id,
        "post_id": post_id,
        "message": "Shaka sent! 🤙" + (" Your thank you is now on the feed!" if data.is_public else "")
    }


@router.get("/shaka/received/{user_id}")
async def get_received_shakas(
    user_id: str,
    limit: int = Query(default=20, le=50),
    db: AsyncSession = Depends(get_db)
):
    """Get Shakas received by a user (displayed on their profile)"""
    result = await db.execute(
        select(ShakaMessage)
        .where(ShakaMessage.recipient_id == user_id)
        .options(
            selectinload(ShakaMessage.sender),
            selectinload(ShakaMessage.sponsorship)
        )
        .order_by(ShakaMessage.created_at.desc())
        .limit(limit)
    )
    shakas = result.scalars().all()
    
    return [{
        "id": s.id,
        "sender_id": s.sender_id,
        "sender_name": s.sender.full_name if s.sender else "Unknown",
        "sender_avatar": s.sender.avatar_url if s.sender else None,
        "message_type": s.message_type,
        "message_text": s.message_text,
        "video_url": s.video_url,
        "animation_id": s.animation_id,
        "is_public": s.is_public,
        "post_id": s.post_id,
        "sponsorship_amount": s.sponsorship.net_amount if s.sponsorship else None,
        "created_at": s.created_at.isoformat()
    } for s in shakas]


@router.get("/shaka/sent/{user_id}")
async def get_sent_shakas(
    user_id: str,
    limit: int = Query(default=20, le=50),
    db: AsyncSession = Depends(get_db)
):
    """Get Shakas sent by a user"""
    result = await db.execute(
        select(ShakaMessage)
        .where(ShakaMessage.sender_id == user_id)
        .options(
            selectinload(ShakaMessage.recipient),
            selectinload(ShakaMessage.sponsorship)
        )
        .order_by(ShakaMessage.created_at.desc())
        .limit(limit)
    )
    shakas = result.scalars().all()
    
    return [{
        "id": s.id,
        "recipient_id": s.recipient_id,
        "recipient_name": s.recipient.full_name if s.recipient else "Unknown",
        "recipient_avatar": s.recipient.avatar_url if s.recipient else None,
        "message_type": s.message_type,
        "message_text": s.message_text,
        "video_url": s.video_url,
        "animation_id": s.animation_id,
        "is_public": s.is_public,
        "post_id": s.post_id,
        "sponsorship_amount": s.sponsorship.net_amount if s.sponsorship else None,
        "created_at": s.created_at.isoformat()
    } for s in shakas]


@router.get("/sponsorships/{user_id}")
async def get_user_sponsorships(
    user_id: str,
    direction: str = Query(default='received', regex='^(received|given)$'),
    limit: int = Query(default=20, le=50),
    db: AsyncSession = Depends(get_db)
):
    """
    Get sponsorship history for a user.
    Shows whether funds came from Pro (Sponsorship) or Hobbyist (Impact Donation).
    """
    if direction == 'received':
        query = select(SponsorshipTransaction).where(
            SponsorshipTransaction.recipient_id == user_id
        ).options(selectinload(SponsorshipTransaction.donor))
    else:
        query = select(SponsorshipTransaction).where(
            SponsorshipTransaction.donor_id == user_id
        ).options(selectinload(SponsorshipTransaction.recipient))
    
    result = await db.execute(
        query.order_by(SponsorshipTransaction.created_at.desc()).limit(limit)
    )
    sponsorships = result.scalars().all()
    
    return [{
        "id": s.id,
        "amount": s.net_amount,
        "sponsorship_type": s.sponsorship_type.value,
        "type_label": "Pro Sponsorship" if s.sponsorship_type == SponsorshipType.PRO_SPONSORSHIP else "Impact Donation",
        "recipient_type": s.recipient_type,
        "donor_name": s.donor.full_name if s.donor else "Anonymous",
        "donor_avatar": s.donor.avatar_url if s.donor else None,
        "recipient_name": s.recipient.full_name if s.recipient else "Unknown",
        "recipient_avatar": s.recipient.avatar_url if s.recipient else None,
        "shaka_sent": s.shaka_sent,
        "created_at": s.created_at.isoformat()
    } for s in sponsorships]
