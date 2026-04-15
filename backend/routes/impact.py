"""
Impact Dashboard API - Unified impact tracking for photographers

Features:
- Impact Score tracking (total_credits_given)
- Sponsorship search for Groms/Causes
- Verified causes management
- Instant Shaka video support
"""

from fastapi import APIRouter, HTTPException, Depends, Query, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, func, or_
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone
import json
import os

from database import get_db
from models import (
    Profile, RoleEnum, SponsorshipTransaction, SponsorshipType,
    VerifiedCause, InstantShakaVideo, Notification
)
from utils.revenue_routing import is_pro_creator, is_hobbyist_creator, is_grom

router = APIRouter(tags=["Impact Dashboard"])


# ============ PYDANTIC MODELS ============

class ImpactSettingsUpdate(BaseModel):
    donation_destination_type: Optional[str] = None  # 'grom', 'cause', 'gear'
    donation_destination_id: Optional[str] = None
    donation_cause_name: Optional[str] = None
    donation_split_percentage: Optional[int] = None  # For Pros: % to cause/grom


class InstantShakaUpload(BaseModel):
    sponsorship_id: str
    message: Optional[str] = None


# ============ VERIFIED CAUSES ============

PREDEFINED_CAUSES = [
    {
        "name": "Surfrider Foundation",
        "description": "Dedicated to the protection and enjoyment of the world's ocean, waves and beaches",
        "logo_url": "https://www.surfrider.org/assets/images/surfrider-logo.svg",
        "website_url": "https://www.surfrider.org",
        "category": "ocean_conservation",
        "is_featured": True
    },
    {
        "name": "Sustainable Surf",
        "description": "Making surfing more sustainable through education and innovation",
        "logo_url": None,
        "website_url": "https://sustainablesurf.org",
        "category": "environmental",
        "is_featured": True
    },
    {
        "name": "Waves for Water",
        "description": "Providing clean water to communities in need around the world",
        "logo_url": None,
        "website_url": "https://wavesforwater.org",
        "category": "community",
        "is_featured": True
    },
    {
        "name": "Stoked Mentoring",
        "description": "Using action sports to empower underserved youth",
        "logo_url": None,
        "website_url": "https://stoked.org",
        "category": "youth_surfing",
        "is_featured": True
    },
    {
        "name": "Jimmy Miller Memorial Foundation",
        "description": "Ocean therapy programs for people facing mental and physical challenges",
        "logo_url": None,
        "website_url": "https://jimmymillerfoundation.org",
        "category": "community",
        "is_featured": False
    },
    {
        "name": "Life Rolls On",
        "description": "Getting people with spinal cord injuries back in the ocean",
        "logo_url": None,
        "website_url": "https://liferollson.org",
        "category": "community",
        "is_featured": False
    },
    {
        "name": "Surf Bus Foundation",
        "description": "Free surf lessons for kids who otherwise couldn't access the ocean",
        "logo_url": None,
        "website_url": "https://surfbusfoundation.org",
        "category": "youth_surfing",
        "is_featured": False
    },
    {
        "name": "Oceana",
        "description": "Protecting and restoring the world's oceans",
        "logo_url": None,
        "website_url": "https://oceana.org",
        "category": "ocean_conservation",
        "is_featured": False
    }
]


@router.post("/impact/seed-causes")
async def seed_verified_causes(db: AsyncSession = Depends(get_db)):
    """Seed the database with predefined verified causes"""
    created = 0
    for cause_data in PREDEFINED_CAUSES:
        # Check if already exists
        existing = await db.execute(
            select(VerifiedCause).where(VerifiedCause.name == cause_data["name"])
        )
        if existing.scalar_one_or_none():
            continue
        
        cause = VerifiedCause(**cause_data)
        db.add(cause)
        created += 1
    
    await db.commit()
    return {"message": f"Created {created} verified causes", "total_created": created}


@router.get("/impact/causes")
async def get_verified_causes(
    category: Optional[str] = None,
    featured_only: bool = False,
    search: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """Get list of verified causes for donations"""
    query = select(VerifiedCause).where(VerifiedCause.is_active.is_(True))
    
    if category:
        query = query.where(VerifiedCause.category == category)
    
    if featured_only:
        query = query.where(VerifiedCause.is_featured.is_(True))
    
    if search:
        query = query.where(
            or_(
                VerifiedCause.name.ilike(f"%{search}%"),
                VerifiedCause.description.ilike(f"%{search}%")
            )
        )
    
    query = query.order_by(VerifiedCause.is_featured.desc(), VerifiedCause.total_donations.desc())
    
    result = await db.execute(query)
    causes = result.scalars().all()
    
    return [{
        "id": c.id,
        "name": c.name,
        "description": c.description,
        "logo_url": c.logo_url,
        "website_url": c.website_url,
        "category": c.category,
        "is_featured": c.is_featured,
        "total_donations": c.total_donations,
        "donor_count": c.donor_count
    } for c in causes]


# ============ GROM SEARCH ============

@router.get("/impact/search-groms")
async def search_groms(
    search: Optional[str] = None,
    limit: int = Query(default=20, le=50),
    db: AsyncSession = Depends(get_db)
):
    """Search for Groms to support"""
    query = select(Profile).where(Profile.role == RoleEnum.GROM)
    
    if search:
        query = query.where(
            or_(
                Profile.full_name.ilike(f"%{search}%"),
                Profile.location.ilike(f"%{search}%"),
                Profile.home_break.ilike(f"%{search}%")
            )
        )
    
    query = query.order_by(Profile.full_name).limit(limit)
    
    result = await db.execute(query)
    groms = result.scalars().all()
    
    return [{
        "id": g.id,
        "full_name": g.full_name,
        "avatar_url": g.avatar_url,
        "location": g.location,
        "skill_level": g.skill_level,
        "home_break": g.home_break,
        "bio": g.bio[:100] if g.bio else None
    } for g in groms]


@router.get("/impact/search-surfers")
async def search_competitive_surfers(
    search: Optional[str] = None,
    limit: int = Query(default=20, le=50),
    db: AsyncSession = Depends(get_db)
):
    """Search for competitive surfers to support"""
    query = select(Profile).where(
        or_(
            Profile.role == RoleEnum.COMP_SURFER,
            Profile.role == RoleEnum.PRO
        )
    )
    
    if search:
        query = query.where(
            or_(
                Profile.full_name.ilike(f"%{search}%"),
                Profile.location.ilike(f"%{search}%")
            )
        )
    
    query = query.order_by(Profile.full_name).limit(limit)
    
    result = await db.execute(query)
    surfers = result.scalars().all()
    
    return [{
        "id": s.id,
        "full_name": s.full_name,
        "avatar_url": s.avatar_url,
        "role": s.role.value,
        "location": s.location,
        "skill_level": s.skill_level,
        "bio": s.bio[:100] if s.bio else None
    } for s in surfers]


# ============ IMPACT DASHBOARD ============

@router.get("/impact/dashboard/{user_id}")
async def get_impact_dashboard(
    user_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get user's impact dashboard data"""
    user_result = await db.execute(
        select(Profile).where(Profile.id == user_id)
        .options(selectinload(Profile.target_gear_item))
    )
    user = user_result.scalar_one_or_none()
    
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Get role-based credit info
    is_pro = is_pro_creator(user.role)
    is_hobbyist = is_hobbyist_creator(user.role)
    
    # Get sponsorship stats
    given_result = await db.execute(
        select(
            func.count(SponsorshipTransaction.id).label('count'),
            func.sum(SponsorshipTransaction.net_amount).label('total')
        ).where(SponsorshipTransaction.donor_id == user_id)
    )
    given_stats = given_result.first()
    
    received_result = await db.execute(
        select(
            func.count(SponsorshipTransaction.id).label('count'),
            func.sum(SponsorshipTransaction.net_amount).label('total')
        ).where(SponsorshipTransaction.recipient_id == user_id)
    )
    received_stats = received_result.first()
    
    # Get recent sponsorships given
    recent_given_result = await db.execute(
        select(SponsorshipTransaction)
        .where(SponsorshipTransaction.donor_id == user_id)
        .options(selectinload(SponsorshipTransaction.recipient))
        .order_by(SponsorshipTransaction.created_at.desc())
        .limit(5)
    )
    recent_given = recent_given_result.scalars().all()
    
    # Get current sponsorship destination info
    destination_info = None
    if user.donation_destination_type:
        if user.donation_destination_type in ['grom', 'surfer'] and user.donation_destination_id:
            dest_result = await db.execute(
                select(Profile).where(Profile.id == user.donation_destination_id)
            )
            dest_profile = dest_result.scalar_one_or_none()
            if dest_profile:
                destination_info = {
                    "type": user.donation_destination_type,
                    "id": dest_profile.id,
                    "name": dest_profile.full_name,
                    "avatar_url": dest_profile.avatar_url
                }
        elif user.donation_destination_type == 'cause' and user.donation_cause_name:
            # Try to find verified cause
            cause_result = await db.execute(
                select(VerifiedCause).where(VerifiedCause.name == user.donation_cause_name)
            )
            cause = cause_result.scalar_one_or_none()
            destination_info = {
                "type": "cause",
                "name": user.donation_cause_name,
                "logo_url": cause.logo_url if cause else None,
                "is_verified": cause is not None
            }
        elif user.donation_destination_type == 'gear' and user.target_gear_item:
            destination_info = {
                "type": "gear",
                "item_id": user.target_gear_item.id,
                "item_name": user.target_gear_item.name,
                "item_image": user.target_gear_item.image_url,
                "price_credits": user.target_gear_item.price_credits,
                "progress": (user.gear_only_credits / user.target_gear_item.price_credits * 100) if user.target_gear_item.price_credits > 0 else 0
            }
    
    return {
        "user_id": user_id,
        "role": user.role.value,
        "is_pro": is_pro,
        "is_hobbyist": is_hobbyist,
        
        # Credit balances
        "credits": {
            "withdrawable": user.withdrawable_credits if is_pro else 0,
            "gear_only": user.gear_only_credits if is_hobbyist else 0,
            "total": user.credit_balance or 0
        },
        
        # Impact Score
        "impact_score": {
            "total_credits_given": user.total_credits_given,
            "total_groms_supported": user.total_groms_supported,
            "total_causes_supported": user.total_causes_supported,
            "sponsorships_given": given_stats.count or 0,
            "sponsorships_received": received_stats.count or 0,
            "total_given": given_stats.total or 0,
            "total_received": received_stats.total or 0
        },
        
        # Current sponsorship destination
        "donation_settings": {
            "destination_type": user.donation_destination_type,
            "destination_id": user.donation_destination_id,
            "cause_name": user.donation_cause_name,
            "split_percentage": user.donation_split_percentage,
            "destination_info": destination_info
        },
        
        # Recent activity
        "recent_sponsorships": [{
            "id": s.id,
            "recipient_name": s.recipient.full_name if s.recipient else s.cause_name,
            "recipient_avatar": s.recipient.avatar_url if s.recipient else None,
            "recipient_type": s.recipient_type,
            "amount": s.net_amount,
            "type": s.sponsorship_type.value,
            "shaka_sent": s.shaka_sent,
            "created_at": s.created_at.isoformat()
        } for s in recent_given]
    }


@router.put("/impact/settings/{user_id}")
async def update_impact_settings(
    user_id: str,
    data: ImpactSettingsUpdate,
    db: AsyncSession = Depends(get_db)
):
    """Update user's impact/donation settings"""
    user_result = await db.execute(select(Profile).where(Profile.id == user_id))
    user = user_result.scalar_one_or_none()
    
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Validate destination based on type
    if data.donation_destination_type == 'grom' and data.donation_destination_id:
        # Verify it's a grom
        dest_result = await db.execute(
            select(Profile).where(Profile.id == data.donation_destination_id)
        )
        dest = dest_result.scalar_one_or_none()
        if not dest or dest.role != RoleEnum.GROM:
            raise HTTPException(status_code=400, detail="Invalid Grom ID")
    
    elif data.donation_destination_type == 'cause' and data.donation_cause_name:
        # Verify cause exists
        cause_result = await db.execute(
            select(VerifiedCause).where(VerifiedCause.name == data.donation_cause_name)
        )
        cause = cause_result.scalar_one_or_none()
        if not cause:
            raise HTTPException(status_code=400, detail="Invalid cause - must be a verified cause")
        data.donation_destination_id = cause.id
    
    # Update fields
    if data.donation_destination_type is not None:
        user.donation_destination_type = data.donation_destination_type
    if data.donation_destination_id is not None:
        user.donation_destination_id = data.donation_destination_id
    if data.donation_cause_name is not None:
        user.donation_cause_name = data.donation_cause_name
    if data.donation_split_percentage is not None:
        user.donation_split_percentage = max(0, min(100, data.donation_split_percentage))
    
    await db.commit()
    
    return {"message": "Impact settings updated", "user_id": user_id}


# ============ PUBLIC IMPACT SCORE ============

@router.get("/impact/public/{user_id}")
async def get_public_impact_score(
    user_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get user's public impact score (displayed on profile)"""
    user_result = await db.execute(select(Profile).where(Profile.id == user_id))
    user = user_result.scalar_one_or_none()
    
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Only show for photographer roles
    photographer_roles = [RoleEnum.PHOTOGRAPHER, RoleEnum.APPROVED_PRO, RoleEnum.HOBBYIST, RoleEnum.GROM_PARENT]
    if user.role not in photographer_roles:
        return {
            "user_id": user_id,
            "is_photographer": False,
            "impact_score": None
        }
    
    return {
        "user_id": user_id,
        "is_photographer": True,
        "impact_score": {
            "total_credits_given": user.total_credits_given,
            "total_groms_supported": user.total_groms_supported,
            "total_causes_supported": user.total_causes_supported,
            "level": get_impact_level(user.total_credits_given)
        }
    }


def get_impact_level(total_credits: float) -> dict:
    """Calculate impact level based on total credits given"""
    if total_credits >= 10000:
        return {"name": "Legend", "emoji": "🏆", "min_credits": 10000}
    elif total_credits >= 5000:
        return {"name": "Champion", "emoji": "🥇", "min_credits": 5000}
    elif total_credits >= 2500:
        return {"name": "Hero", "emoji": "🦸", "min_credits": 2500}
    elif total_credits >= 1000:
        return {"name": "Patron", "emoji": "🌟", "min_credits": 1000}
    elif total_credits >= 500:
        return {"name": "Supporter", "emoji": "💪", "min_credits": 500}
    elif total_credits >= 100:
        return {"name": "Contributor", "emoji": "🤝", "min_credits": 100}
    else:
        return {"name": "Starter", "emoji": "🌱", "min_credits": 0}


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
    direction: str = Query(default='received', regex='^(received|sent)$'),
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
