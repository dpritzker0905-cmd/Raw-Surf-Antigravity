"""
career_hub/impact_stoked.py — Stoked Tab + Instant Shaka video endpoints for surfers.
Extracted from impact.py (v92 audit) for LOC compliance.
"""

from fastapi import APIRouter, HTTPException, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timezone
import json

from database import get_db
from models import (
    Profile, RoleEnum, SponsorshipTransaction,
    InstantShakaVideo, Notification
)
from utils.revenue_routing import is_pro_creator, is_hobbyist_creator, is_grom

router = APIRouter(tags=["Impact Dashboard"])


# ============ INSTANT SHAKA VIDEO ============

@router.post("/impact/instant-shaka/{sponsorship_id}")
async def send_instant_shaka_video(
    sponsorship_id: str,
    sender_id: str,
    video_url: str,
    message: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """Send a 5-second thank you video in response to a sponsorship"""
    # Get the sponsorship
    sponsor_result = await db.execute(
        select(SponsorshipTransaction)
        .where(SponsorshipTransaction.id == sponsorship_id)
        .options(selectinload(SponsorshipTransaction.donor))
    )
    sponsorship = sponsor_result.scalar_one_or_none()
    
    if not sponsorship:
        raise HTTPException(status_code=404, detail="Sponsorship not found")
    
    if sponsorship.recipient_id != sender_id:
        raise HTTPException(status_code=403, detail="Only the recipient can send an Instant Shaka")
    
    # Create instant shaka video
    instant_shaka = InstantShakaVideo(
        sender_id=sender_id,
        recipient_id=sponsorship.donor_id,
        sponsorship_id=sponsorship_id,
        video_url=video_url,
        duration_seconds=5.0
    )
    db.add(instant_shaka)
    
    # Mark sponsorship shaka as sent
    sponsorship.shaka_sent = True
    
    # Get sender info
    sender_result = await db.execute(select(Profile).where(Profile.id == sender_id))
    sender = sender_result.scalar_one_or_none()
    
    # Notify the donor
    notification = Notification(
        user_id=sponsorship.donor_id,
        type='instant_shaka',
        title='🤙 Instant Shaka Video!',
        body=f'{sender.full_name if sender else "Someone"} sent you a thank you video!',
        data=json.dumps({
            "instant_shaka_id": instant_shaka.id,
            "sender_id": sender_id,
            "sender_name": sender.full_name if sender else "Unknown",
            "sender_avatar": sender.avatar_url if sender else None,
            "video_url": video_url,
            "sponsorship_amount": sponsorship.net_amount,
            "message": message
        })
    )
    db.add(notification)
    
    await db.commit()
    
    return {
        "success": True,
        "instant_shaka_id": instant_shaka.id,
        "message": "Instant Shaka sent! 🤙"
    }


@router.get("/impact/instant-shakas/{user_id}")
async def get_instant_shakas(
    user_id: str,
    direction: str = Query(default='received', pattern='^(received|sent)$'),
    limit: int = Query(default=20, le=50),
    db: AsyncSession = Depends(get_db)
):
    """Get instant shaka videos sent or received"""
    if direction == 'received':
        query = select(InstantShakaVideo).where(InstantShakaVideo.recipient_id == user_id)
    else:
        query = select(InstantShakaVideo).where(InstantShakaVideo.sender_id == user_id)
    
    query = query.options(
        selectinload(InstantShakaVideo.sender),
        selectinload(InstantShakaVideo.recipient),
        selectinload(InstantShakaVideo.sponsorship)
    ).order_by(InstantShakaVideo.created_at.desc()).limit(limit)
    
    result = await db.execute(query)
    shakas = result.scalars().all()
    
    return [{
        "id": s.id,
        "sender_id": s.sender_id,
        "sender_name": s.sender.full_name if s.sender else "Unknown",
        "sender_avatar": s.sender.avatar_url if s.sender else None,
        "recipient_id": s.recipient_id,
        "recipient_name": s.recipient.full_name if s.recipient else "Unknown",
        "video_url": s.video_url,
        "thumbnail_url": s.thumbnail_url,
        "is_viewed": s.is_viewed,
        "sponsorship_amount": s.sponsorship.net_amount if s.sponsorship else None,
        "created_at": s.created_at.isoformat()
    } for s in shakas]


@router.post("/impact/instant-shakas/{shaka_id}/view")
async def mark_instant_shaka_viewed(
    shaka_id: str,
    user_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Mark an instant shaka video as viewed"""
    result = await db.execute(
        select(InstantShakaVideo).where(InstantShakaVideo.id == shaka_id)
    )
    shaka = result.scalar_one_or_none()
    
    if not shaka:
        raise HTTPException(status_code=404, detail="Instant Shaka not found")
    
    if shaka.recipient_id != user_id:
        raise HTTPException(status_code=403, detail="Only the recipient can mark as viewed")
    
    shaka.is_viewed = True
    shaka.viewed_at = datetime.now(timezone.utc)
    
    await db.commit()
    
    return {"message": "Marked as viewed"}



# ============ STOKED TAB FOR SURFERS ============

@router.get("/stoked/{user_id}")
async def get_surfer_stoked_data(
    user_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Get Stoked tab data for surfers (Groms, Competitive, Pro)
    Shows credits received, supporters, gear/session purchases, and what they can use credits for
    """
    from models import GearPurchase, Booking, BookingParticipant
    
    # Get user profile
    user_result = await db.execute(
        select(Profile).where(Profile.id == user_id)
    )
    user = user_result.scalar_one_or_none()
    
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Check if user is a surfer type that can receive support
    # Eligible: Grom, Comp Surfer, Pro (NOT regular Surfer - they don't receive donations)
    user_is_grom = user.role == RoleEnum.GROM
    user_is_competitive = user.role == RoleEnum.COMP_SURFER
    user_is_pro = user.role == RoleEnum.PRO
    is_eligible = user_is_grom or user_is_competitive or user_is_pro
    
    if not is_eligible:
        return {
            "is_eligible": False,
            "message": "Stoked tab is for Groms, Competitive Surfers, and Pro Surfers who receive support from photographers"
        }
    
    # Get total credits received
    received_result = await db.execute(
        select(
            func.count(SponsorshipTransaction.id).label('count'),
            func.sum(SponsorshipTransaction.net_amount).label('total')
        ).where(SponsorshipTransaction.recipient_id == user_id)
    )
    received_stats = received_result.first()
    
    # Get list of supporters (photographers who have given to this surfer)
    supporters_result = await db.execute(
        select(
            SponsorshipTransaction.donor_id,
            func.sum(SponsorshipTransaction.net_amount).label('total_given'),
            func.count(SponsorshipTransaction.id).label('times_supported'),
            func.max(SponsorshipTransaction.created_at).label('last_support')
        )
        .where(SponsorshipTransaction.recipient_id == user_id)
        .group_by(SponsorshipTransaction.donor_id)
        .order_by(func.sum(SponsorshipTransaction.net_amount).desc())
        .limit(20)
    )
    supporter_rows = supporters_result.all()
    
    # Fetch supporter profiles
    supporters = []
    for row in supporter_rows:
        if row.donor_id:
            donor_result = await db.execute(
                select(Profile).where(Profile.id == row.donor_id)
            )
            donor = donor_result.scalar_one_or_none()
            if donor:
                supporters.append({
                    "id": donor.id,
                    "full_name": donor.full_name,
                    "avatar_url": donor.avatar_url,
                    "role": donor.role.value if donor.role else None,
                    "total_given": float(row.total_given) if row.total_given else 0,
                    "times_supported": row.times_supported,
                    "last_support": row.last_support.isoformat() if row.last_support else None
                })
    
    # Get recent support transactions (last 10)
    recent_result = await db.execute(
        select(SponsorshipTransaction)
        .where(SponsorshipTransaction.recipient_id == user_id)
        .options(selectinload(SponsorshipTransaction.donor))
        .order_by(SponsorshipTransaction.created_at.desc())
        .limit(10)
    )
    recent_transactions = recent_result.scalars().all()
    
    recent_support = [{
        "id": t.id,
        "amount": float(t.net_amount) if t.net_amount else 0,
        "donor_name": t.donor.full_name if t.donor else "Anonymous",
        "donor_avatar": t.donor.avatar_url if t.donor else None,
        "donor_id": t.donor_id,
        "message": t.message,
        "created_at": t.created_at.isoformat() if t.created_at else None,
        "shaka_sent": t.shaka_sent
    } for t in recent_transactions]
    
    # ============ GEAR PURCHASES ============
    gear_purchases_result = await db.execute(
        select(GearPurchase)
        .where(GearPurchase.user_id == user_id)
        .options(selectinload(GearPurchase.gear_item))
        .order_by(GearPurchase.created_at.desc())
        .limit(10)
    )
    gear_purchases = gear_purchases_result.scalars().all()
    
    gear_purchases_list = [{
        "id": p.id,
        "item_name": p.gear_item.name if p.gear_item else "Unknown Item",
        "item_image": p.gear_item.image_url if p.gear_item else None,
        "item_category": p.gear_item.category.value if p.gear_item and p.gear_item.category else None,
        "credits_spent": float(p.credits_spent) if p.credits_spent else 0,
        "affiliate_partner": p.affiliate_partner,
        "status": p.status,
        "created_at": p.created_at.isoformat() if p.created_at else None
    } for p in gear_purchases]
    
    # ============ SESSION PURCHASES ============
    # Get bookings this user participated in (sessions they bought into)
    session_purchases_result = await db.execute(
        select(BookingParticipant)
        .where(BookingParticipant.participant_id == user_id)
        .where(BookingParticipant.payment_status == 'completed')
        .options(
            selectinload(BookingParticipant.booking).selectinload(Booking.photographer)
        )
        .order_by(BookingParticipant.joined_at.desc())
        .limit(10)
    )
    session_purchases = session_purchases_result.scalars().all()
    
    session_purchases_list = [{
        "id": sp.id,
        "booking_id": sp.booking_id,
        "photographer_name": sp.booking.photographer.full_name if sp.booking and sp.booking.photographer else "Unknown",
        "photographer_avatar": sp.booking.photographer.avatar_url if sp.booking and sp.booking.photographer else None,
        "location": sp.booking.location if sp.booking else None,
        "session_date": sp.booking.session_date.isoformat() if sp.booking and sp.booking.session_date else None,
        "amount_paid": float(sp.amount_paid) if sp.amount_paid else 0,
        "photos_received": sp.photos_purchased or 0,
        "created_at": sp.joined_at.isoformat() if sp.joined_at else None
    } for sp in session_purchases]
    
    # Calculate total spent on gear and sessions
    total_gear_spent = sum(p.credits_spent for p in gear_purchases if p.credits_spent)
    total_sessions_spent = sum(sp.amount_paid for sp in session_purchases if sp.amount_paid)
    
    # Determine stoke level based on total received
    total_received = float(received_stats.total) if received_stats.total else 0
    stoke_levels = [
        {"min": 0, "name": "Rising Tide", "emoji": "🌊", "color": "blue"},
        {"min": 100, "name": "Wave Rider", "emoji": "🏄", "color": "cyan"},
        {"min": 500, "name": "Barrel Hunter", "emoji": "🤙", "color": "green"},
        {"min": 1000, "name": "Soul Surfer", "emoji": "✨", "color": "yellow"},
        {"min": 5000, "name": "Legend", "emoji": "🏆", "color": "amber"},
        {"min": 10000, "name": "Icon", "emoji": "👑", "color": "orange"},
    ]
    
    current_level = stoke_levels[0]
    next_level = stoke_levels[1] if len(stoke_levels) > 1 else None
    
    for i, level in enumerate(stoke_levels):
        if total_received >= level["min"]:
            current_level = level
            next_level = stoke_levels[i + 1] if i + 1 < len(stoke_levels) else None
    
    # Calculate progress to next level
    progress_to_next = 100
    credits_to_next = 0
    if next_level:
        range_size = next_level["min"] - current_level["min"]
        progress_in_range = total_received - current_level["min"]
        progress_to_next = min(100, (progress_in_range / range_size) * 100) if range_size > 0 else 100
        credits_to_next = next_level["min"] - total_received
    
    # What credits can be used for (based on role)
    credit_uses = []
    if user_is_grom:
        credit_uses = [
            {"icon": "🏄", "title": "Gear & Equipment", "description": "Boards, wetsuits, and accessories"},
            {"icon": "🎓", "title": "Surf Lessons", "description": "Training with local coaches"},
            {"icon": "🏆", "title": "Competition Entry", "description": "Local and regional contests"},
        ]
    elif user_is_competitive:
        credit_uses = [
            {"icon": "✈️", "title": "Travel & Contests", "description": "Competition travel expenses"},
            {"icon": "🏄", "title": "Pro Equipment", "description": "High-performance gear"},
            {"icon": "📹", "title": "Media & Footage", "description": "Professional video/photo sessions"},
        ]
    elif user_is_pro:
        credit_uses = [
            {"icon": "💰", "title": "Cash Out", "description": "Withdraw to your bank account"},
            {"icon": "🎁", "title": "Pay It Forward", "description": "Support other surfers"},
            {"icon": "🏄", "title": "Premium Gear", "description": "Top-tier equipment"},
        ]
    else:
        credit_uses = [
            {"icon": "🏄", "title": "Gear & Equipment", "description": "Boards, wetsuits, and accessories"},
            {"icon": "📸", "title": "Photo Sessions", "description": "Book pro photographers"},
            {"icon": "🎓", "title": "Coaching", "description": "Level up your skills"},
        ]
    
    return {
        "is_eligible": True,
        "user_id": user_id,
        "role": user.role.value if user.role else None,
        "is_grom": user_is_grom,
        "is_competitive": user_is_competitive,
        "is_pro": user_is_pro,
        
        # Credits info
        "credits": {
            "total_received": total_received,
            "available_balance": float(user.credit_balance) if user.credit_balance else 0,
            "times_supported": received_stats.count or 0
        },
        
        # Stoke level
        "stoke_level": {
            "current": current_level,
            "next": next_level,
            "progress_percent": progress_to_next,
            "credits_to_next": credits_to_next
        },
        
        # Supporters
        "supporters": {
            "total_count": len(supporters),
            "list": supporters
        },
        
        # Recent support
        "recent_support": recent_support,
        
        # Gear purchases
        "gear_purchases": {
            "total_spent": float(total_gear_spent),
            "count": len(gear_purchases),
            "list": gear_purchases_list
        },
        
        # Session purchases
        "session_purchases": {
            "total_spent": float(total_sessions_spent),
            "count": len(session_purchases),
            "list": session_purchases_list
        },
        
        # What credits can be used for
        "credit_uses": credit_uses
    }
