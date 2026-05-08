"""
gallery/gallery_find_me.py — AI "Find Me" surfer identification in galleries.

Extracted from admin.py (v85) to maintain <800 LOC per module.
Provides tier-based rate-limited AI photo scanning for surfer self-identification.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timezone
import logging

from database import get_db
from models import (
    Profile, GalleryItem, Gallery,
    XPTransaction, SurferSelectionQuota
)

gallery_logger = logging.getLogger("routes.gallery")

router = APIRouter()


# ============ AI "FIND ME" IN GALLERY ============


class FindMeRequest(BaseModel):
    selfie_url: str
    board_description: Optional[str] = None
    wetsuit_description: Optional[str] = None
    rash_guard_description: Optional[str] = None
    stance: Optional[str] = None  # 'regular' or 'goofy'


@router.post("/gallery/{gallery_id}/find-me")
async def find_me_in_gallery(
    gallery_id: str,
    user_id: str,
    data: FindMeRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    AI-powered surfer identification in a gallery.
    Scans gallery photos and returns matches ranked by confidence.

    Rate limits:
      - Free/Basic: 5 scans/day, max 150 photos/scan
      - Premium: 10 scans/day, unlimited photos/scan
    """
    # Verify user exists
    user_result = await db.execute(select(Profile).where(Profile.id == user_id))
    user = user_result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Determine tier limits
    subscription_tier = getattr(user, 'subscription_tier', 'free') or 'free'
    is_premium = subscription_tier in ('premium', 'pro', 'gold')
    max_scans_per_day = 10 if is_premium else 5
    max_photos_per_scan = None if is_premium else 150  # None = unlimited

    # Check daily scan count (use XPTransaction as a scan log)
    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    scan_count_result = await db.execute(
        select(func.count(XPTransaction.id)).where(
            XPTransaction.user_id == user_id,
            XPTransaction.transaction_type == 'find_me_scan',
            XPTransaction.created_at >= today_start
        )
    )
    scans_today = scan_count_result.scalar() or 0

    if scans_today >= max_scans_per_day:
        tier_label = "Premium" if is_premium else "Free/Basic"
        raise HTTPException(
            status_code=429,
            detail=f"Daily scan limit reached ({max_scans_per_day}/day for {tier_label} users). "
                   f"{'Try again tomorrow.' if is_premium else 'Upgrade to Premium for 10 scans/day.'}"
        )

    # Get gallery (public OR private — access check below)
    gallery_result = await db.execute(
        select(Gallery).where(Gallery.id == gallery_id)
    )
    gallery = gallery_result.scalar_one_or_none()
    if not gallery:
        raise HTTPException(status_code=404, detail="Gallery not found")

    # Access control: public = anyone, private = owner or session participants only
    if not gallery.is_public:
        if gallery.photographer_id == user_id:
            pass  # Owner always has access
        else:
            # Check if user has a selection quota (= was assigned to this session)
            quota_result = await db.execute(
                select(SurferSelectionQuota).where(
                    SurferSelectionQuota.surfer_id == user_id,
                    SurferSelectionQuota.gallery_id == gallery_id
                )
            )
            if not quota_result.scalar_one_or_none():
                # Also check by live_session_id as a fallback
                has_session_access = False
                if gallery.live_session_id:
                    session_quota = await db.execute(
                        select(SurferSelectionQuota).where(
                            SurferSelectionQuota.surfer_id == user_id,
                            SurferSelectionQuota.live_session_id == gallery.live_session_id
                        )
                    )
                    has_session_access = session_quota.scalar_one_or_none() is not None
                if not has_session_access:
                    raise HTTPException(
                        status_code=403,
                        detail="This gallery is private. Only session participants can scan it."
                    )

    # Fetch gallery items (watermarked previews for AI analysis)
    items_query = select(GalleryItem).where(
        GalleryItem.gallery_id == gallery_id,
        GalleryItem.is_public.is_(True),
        GalleryItem.is_deleted.is_(False)
    ).order_by(GalleryItem.created_at.desc())

    if max_photos_per_scan:
        items_query = items_query.limit(max_photos_per_scan)

    items_result = await db.execute(items_query)
    items = items_result.scalars().all()

    if not items:
        return {
            "matches": [],
            "total_photos_scanned": 0,
            "matches_found": 0,
            "gallery_id": gallery_id,
            "message": "No photos in this gallery to scan"
        }

    # Build surfer profile for AI matching
    from services.ai_identity_matching import SurferProfile, batch_analyze_session_photos

    surfer_profile = SurferProfile(
        profile_photo_url=user.avatar_url,
        session_selfie_url=data.selfie_url,
        board_description=data.board_description,
        wetsuit_description=data.wetsuit_description,
        rash_guard_description=data.rash_guard_description,
        stance=data.stance
    )

    # Get photo URLs for analysis (use preview_url for watermarked previews)
    photo_urls = []
    url_to_item = {}
    for item in items:
        url = item.preview_url or item.original_url
        if url:
            photo_urls.append(url)
            url_to_item[url] = item

    # Build session context
    spot_name = gallery.title or "Unknown Spot"
    session_context = f"Session at {spot_name}"
    if gallery.session_date:
        session_context += f" on {gallery.session_date.strftime('%B %d, %Y')}"

    # Run AI batch analysis
    gallery_logger.info(
        f"Find Me scan: user={user_id}, gallery={gallery_id}, "
        f"photos={len(photo_urls)}, tier={subscription_tier}"
    )

    ai_results = await batch_analyze_session_photos(
        photo_urls=photo_urls,
        surfer_profile=surfer_profile,
        session_context=session_context
    )

    # Process results and build response
    matches = []
    for result in ai_results:
        if result.get("is_match") and result.get("confidence", 0) >= 0.3:
            item = url_to_item.get(result["photo_url"])
            if item:
                matches.append({
                    "gallery_item_id": item.id,
                    "preview_url": item.preview_url,
                    "thumbnail_url": item.thumbnail_url,
                    "media_type": item.media_type or 'image',
                    "confidence": round(result["confidence"], 2),
                    "match_methods": result.get("match_methods", []),
                    "reasoning": result.get("details", {}).get("reasoning", ""),
                    "is_for_sale": item.is_for_sale,
                    "price": item.price
                })

    # Sort by confidence (highest first)
    matches.sort(key=lambda x: x["confidence"], reverse=True)

    # Log the scan (for rate limiting)
    scan_log = XPTransaction(
        user_id=user_id,
        transaction_type='find_me_scan',
        xp_amount=0,
        description=f"AI Find Me scan in gallery {gallery_id} ({len(matches)} matches from {len(photo_urls)} photos)"
    )
    db.add(scan_log)
    await db.commit()

    # Fire push notification if matches were found (best-effort, never blocks response)
    if matches:
        try:
            from routes.notifications.push import notify_photos_found_ai
            spot_name = gallery.title or "Unknown Spot"
            await notify_photos_found_ai(
                surfer_id=user_id,
                gallery_id=gallery_id,
                match_count=len(matches),
                spot_name=spot_name
            )
        except Exception as push_err:
            gallery_logger.warning(f"Find-Me push notification failed: {push_err}")

    return {
        "matches": matches,
        "total_photos_scanned": len(photo_urls),
        "matches_found": len(matches),
        "gallery_id": gallery_id,
        "scans_remaining_today": max_scans_per_day - scans_today - 1,
        "max_photos_per_scan": max_photos_per_scan or "unlimited",
        "subscription_tier": subscription_tier
    }
