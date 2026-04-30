"""
Gallery Collection management — create, list, get, update, delete galleries.

Part of the gallery package — extracted from the gallery.py monolith.
"""
from fastapi import APIRouter, Depends, HTTPException, Body, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, case
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone, timedelta
import json
import uuid
import logging

gallery_logger = logging.getLogger("routes.gallery")

from database import get_db
from models import (
    Profile, SurfSpot, GalleryItem, GalleryPurchase, Notification,
    RoleEnum, Gallery, LiveSession, LiveSessionParticipant,
    XPTransaction, SurferGalleryItem, SurferSelectionQuota,
    GalleryTierEnum, Booking, BookingParticipant, DispatchRequest,
    ConditionReport
)

from routes.gamification import check_badge_milestones
from services.gallery_sync import (
    distribute_gallery_item_to_participants,
    manually_assign_item_to_surfer,
    safe_delete_gallery_item
)
from websocket_manager import broadcast_earnings_update
from services.watermark import watermark_image_from_url, generate_watermarked_preview
from utils.grom_parent import is_grom_parent_eligible

from .schemas import (
    GalleryItemCreate, GalleryItemUpdate, GalleryItemResponse,
    PurchaseRequest, GalleryCreate, GalleryUpdate,
    get_quality_price
)

router = APIRouter()

@router.post("/galleries")
async def create_gallery(
    photographer_id: str,
    data: GalleryCreate,
    db: AsyncSession = Depends(get_db)
):
    """Create a new gallery (collection)"""
    
    # Verify photographer
    result = await db.execute(select(Profile).where(Profile.id == photographer_id))
    photographer = result.scalar_one_or_none()
    if not photographer:
        raise HTTPException(status_code=404, detail="Photographer not found")
    
    photographer_roles = [RoleEnum.GROM_PARENT, RoleEnum.HOBBYIST, RoleEnum.PHOTOGRAPHER, RoleEnum.APPROVED_PRO]
    if photographer.role not in photographer_roles:
        raise HTTPException(status_code=403, detail="Only photographers can create galleries")
    
    gallery = Gallery(
        photographer_id=photographer_id,
        title=data.title,
        description=data.description,
        surf_spot_id=data.surf_spot_id,
        cover_image_url=data.cover_image_url,
        # Phase 5: Session linking at creation — prevent orphaned galleries
        session_type=data.session_type or 'manual',
        live_session_id=data.live_session_id,
        booking_id=data.booking_id,
        dispatch_id=data.dispatch_id,
        price_web=data.price_web,
        price_standard=data.price_standard,
        price_high=data.price_high,
        price_720p=data.price_720p,
        price_1080p=data.price_1080p,
        price_4k=data.price_4k
    )
    
    db.add(gallery)
    await db.commit()
    await db.refresh(gallery)
    
    return {
        "id": gallery.id,
        "title": gallery.title,
        "message": "Gallery created successfully"
    }

def _build_session_settings(gallery):
    """
    Build session-level content settings (photos/videos included)
    from the linked LiveSession, Booking, or Dispatch.
    """
    settings = {
        "session_type": gallery.session_type or "manual",
        "photos_included": 3,
        "videos_included": 0,
        "buyin_price": 0,
        "full_gallery": False
    }
    
    if gallery.live_session_id and gallery.live_session:
        ls = gallery.live_session
        settings["photos_included"] = getattr(ls, 'photos_included', 3) or 3
        raw_vid = getattr(ls, 'videos_included', None)
        settings["videos_included"] = raw_vid if raw_vid and raw_vid > 0 else 0
        settings["buyin_price"] = getattr(ls, 'buyin_price', 25.0) or 25.0
        settings["session_type"] = "live"
    elif gallery.booking_id:
        # Pull from photographer profile defaults for bookings
        if gallery.photographer:
            p = gallery.photographer
            settings["photos_included"] = getattr(p, 'booking_photos_included', 3) or 3
            settings["videos_included"] = getattr(p, 'booking_videos_included', 0) or 0
            settings["buyin_price"] = getattr(p, 'booking_hourly_rate', 50.0) or 50.0
            settings["full_gallery"] = getattr(p, 'booking_full_gallery', False) or False
        settings["session_type"] = "booking"
    elif gallery.dispatch_id:
        if gallery.photographer:
            p = gallery.photographer
            settings["photos_included"] = getattr(p, 'on_demand_photos_included', 3) or 3
            settings["videos_included"] = getattr(p, 'on_demand_videos_included', 0) or 0
            settings["full_gallery"] = getattr(p, 'on_demand_full_gallery', False) or False
        settings["session_type"] = "on_demand"
    
    return settings


def _build_photographer_pricing(photographer):
    """
    Build full photographer pricing config across all 3 service types.
    Powers the expanded gallery pricing card showing per-tier rates + included content.
    """
    if not photographer:
        return None
    
    p = photographer
    return {
        "live_session": {
            "photos_included": getattr(p, 'live_session_photos_included', 3) or 3,
            "videos_included": getattr(p, 'live_session_videos_included', 1) or 0,
            "full_gallery": getattr(p, 'live_session_full_gallery', False) or False,
            "buyin_price": getattr(p, 'live_buyin_price', 25.0) or 25.0,
            "photo": {
                "web": getattr(p, 'live_price_web', 3.0),
                "standard": getattr(p, 'live_price_standard', 6.0),
                "high": getattr(p, 'live_price_high', 12.0)
            },
            "video": {
                "720p": getattr(p, 'live_video_720p', 8.0),
                "1080p": getattr(p, 'live_video_1080p', 15.0),
                "4k": getattr(p, 'live_video_4k', 30.0)
            }
        },
        "booking": {
            "photos_included": getattr(p, 'booking_photos_included', 3) or 3,
            "videos_included": getattr(p, 'booking_videos_included', 1) or 0,
            "full_gallery": getattr(p, 'booking_full_gallery', False) or False,
            "hourly_rate": getattr(p, 'booking_hourly_rate', 50.0) or 50.0,
            "photo": {
                "web": getattr(p, 'booking_price_web', 3.0),
                "standard": getattr(p, 'booking_price_standard', 5.0),
                "high": getattr(p, 'booking_price_high', 10.0)
            },
            "video": {
                "720p": getattr(p, 'booking_video_720p', 8.0),
                "1080p": getattr(p, 'booking_video_1080p', 15.0),
                "4k": getattr(p, 'booking_video_4k', 30.0)
            }
        },
        "on_demand": {
            "photos_included": getattr(p, 'on_demand_photos_included', 3) or 3,
            "videos_included": getattr(p, 'on_demand_videos_included', 1) or 0,
            "full_gallery": getattr(p, 'on_demand_full_gallery', False) or False,
            "photo": {
                "web": getattr(p, 'on_demand_price_web', 5.0),
                "standard": getattr(p, 'on_demand_price_standard', 10.0),
                "high": getattr(p, 'on_demand_price_high', 18.0)
            },
            "video": {
                "720p": getattr(p, 'on_demand_video_720p', 12.0),
                "1080p": getattr(p, 'on_demand_video_1080p', 20.0),
                "4k": getattr(p, 'on_demand_video_4k', 40.0)
            }
        },
        "gallery": {
            "photo": {
                "web": getattr(p, 'photo_price_web', 3.0),
                "standard": getattr(p, 'photo_price_standard', 5.0),
                "high": getattr(p, 'photo_price_high', 10.0)
            },
            "video": {
                "720p": getattr(p, 'video_price_720p', 8.0),
                "1080p": getattr(p, 'video_price_1080p', 15.0),
                "4k": getattr(p, 'video_price_4k', 30.0)
            }
        }
    }


def _build_session_roster(gallery, live_map, booking_map, dispatch_map, dist_map):
    """
    Build a unified session roster for a gallery folder.
    Returns a list of surfer objects with delivery progress data.
    Differentiates between photo and video credits/delivery.
    Works across Live Sessions, Regular Bookings, and On-Demand Dispatch.
    """
    participants = []
    
    # Get the right participant list based on session type
    if gallery.live_session_id and gallery.live_session_id in live_map:
        participants = live_map[gallery.live_session_id]
        photos_included = 3
        # Default videos_included to 0 until photographer explicitly sets it
        # The old photos_included covers ALL content types pre-migration
        videos_included = 0
        if gallery.live_session:
            photos_included = getattr(gallery.live_session, 'photos_included', 3) or 3
            # Only use videos_included if column exists and was explicitly set (> 0)
            raw_vid = getattr(gallery.live_session, 'videos_included', None)
            videos_included = raw_vid if raw_vid and raw_vid > 0 else 0
        for p in participants:
            p["photos_included"] = photos_included
            p["videos_included"] = videos_included
    
    elif gallery.booking_id and gallery.booking_id in booking_map:
        participants = booking_map[gallery.booking_id]
        for p in participants:
            p["photos_included"] = p.get("photos_included", 3)
            p["videos_included"] = p.get("videos_included", 0)
    
    elif gallery.dispatch_id and gallery.dispatch_id in dispatch_map:
        participants = dispatch_map[gallery.dispatch_id]
        for p in participants:
            p["photos_included"] = 3
            p["videos_included"] = 0
    
    else:
        return []
    
    # Merge distribution progress data (now split by photo/video)
    gallery_dist = dist_map.get(gallery.id, {})
    roster = []
    for p in participants:
        surfer_id = p["surfer_id"]
        empty_dist = {
            "total": 0, "included": 0,
            "photos_total": 0, "videos_total": 0,
            "photos_included": 0, "videos_included": 0
        }
        dist_data = gallery_dist.get(surfer_id, empty_dist)
        
        ph_included = p.get("photos_included", 3)
        vid_included = p.get("videos_included", 0)
        total_included_slots = ph_included + vid_included
        
        photos_delivered = dist_data.get("photos_total", 0)
        videos_delivered = dist_data.get("videos_total", 0)
        photos_included_used = dist_data.get("photos_included", 0)
        videos_included_used = dist_data.get("videos_included", 0)
        total_delivered = dist_data.get("total", 0)
        
        # Credit calculation: When videos_included=0, photos_included covers ALL
        # content types (photos + videos from a unified pool). When videos_included > 0,
        # photos and videos have separate credit pools.
        if vid_included == 0:
            # Unified pool: photos_included covers ALL items (photos + videos)
            total_from_pool = photos_delivered + videos_delivered
            photos_credits_left = max(0, ph_included - total_from_pool)
            videos_credits_left = 0
        else:
            # Separate pools: photos and videos have independent credit allocations
            photos_credits_left = max(0, ph_included - photos_delivered)
            videos_credits_left = max(0, vid_included - videos_delivered)
        total_credits_left = photos_credits_left + videos_credits_left
        
        progress = min(100, int((total_delivered / total_included_slots * 100) if total_included_slots > 0 else 0))
        
        roster.append({
            "surfer_id": surfer_id,
            "full_name": p["full_name"],
            "username": p["username"],
            "avatar_url": p["avatar_url"],
            "selfie_url": p.get("selfie_url"),
            "amount_paid": p["amount_paid"],
            "payment_method": p.get("payment_method"),
            # Photo credits
            "photos_included": ph_included,
            "photos_delivered": photos_delivered,
            "photos_credits_remaining": photos_credits_left,
            # Video credits
            "videos_included": vid_included,
            "videos_delivered": videos_delivered,
            "videos_credits_remaining": videos_credits_left,
            # Totals (backward compat)
            "items_delivered": total_delivered,
            "credits_remaining": total_credits_left,
            "progress_pct": progress
        })
    
    return roster


@router.get("/galleries/photographer/{photographer_id}")
async def get_photographer_galleries(
    photographer_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get all galleries for a photographer"""
    
    result = await db.execute(
        select(Gallery)
        .where(Gallery.photographer_id == photographer_id)
        .options(
            selectinload(Gallery.surf_spot),
            selectinload(Gallery.live_session),
            selectinload(Gallery.items),
            selectinload(Gallery.photographer)
        )
        .order_by(func.coalesce(Gallery.session_date, Gallery.created_at).desc())
    )
    galleries = result.scalars().all()
    
    # Auto-heal: if a gallery has items but no cover_image_url, set it from the first item
    needs_commit = False
    gallery_data = []
    
    # ── Session Roster: Batch-load participants for all galleries ──
    # This powers the "surfer delivery progress" cards on each folder
    gallery_ids = [g.id for g in galleries]
    
    # Build maps of session references for batch queries
    live_session_ids = [g.live_session_id for g in galleries if g.live_session_id]
    booking_ids = [g.booking_id for g in galleries if g.booking_id]
    dispatch_ids = [g.dispatch_id for g in galleries if g.dispatch_id]
    
    # ── Live Session Participants ──
    live_participants_map = {}  # live_session_id -> [participants]
    if live_session_ids:
        try:
            # Primary query: participants linked by live_session_id
            lsp_result = await db.execute(
                select(LiveSessionParticipant, Profile)
                .join(Profile, LiveSessionParticipant.surfer_id == Profile.id)
                .where(LiveSessionParticipant.live_session_id.in_(live_session_ids))
            )
            rows = lsp_result.all()
            gallery_logger.info(f"Session Roster: Found {len(rows)} live participants by session_id for {len(live_session_ids)} sessions")
            
            for row in rows:
                lsp, profile = row[0], row[1]
                sid = lsp.live_session_id
                if sid not in live_participants_map:
                    live_participants_map[sid] = []
                live_participants_map[sid].append({
                    "surfer_id": profile.id,
                    "full_name": profile.full_name,
                    "username": profile.username,
                    "avatar_url": profile.avatar_url,
                    "selfie_url": lsp.selfie_url,
                    "amount_paid": lsp.amount_paid or 0,
                    "photos_credit_remaining": lsp.photos_credit_remaining or 0,
                    "payment_method": lsp.payment_method
                })
            
            # ── FALLBACK: Query by photographer_id for sessions with no matched participants ──
            # This handles the case where participants joined the photographer
            # but their live_session_id was NULL at join time
            missing_session_ids = [sid for sid in live_session_ids if sid not in live_participants_map]
            if missing_session_ids:
                gallery_logger.info(f"Session Roster: {len(missing_session_ids)} sessions have 0 participants, trying photographer_id fallback")
                for missing_sid in missing_session_ids:
                    # Find the gallery for this session to get the photographer_id and session date
                    matching_gallery = next((g for g in galleries if g.live_session_id == missing_sid), None)
                    if not matching_gallery:
                        continue
                    
                    # Query participants linked to the photographer around the session time
                    session_date = matching_gallery.session_date
                    fallback_query = (
                        select(LiveSessionParticipant, Profile)
                        .join(Profile, LiveSessionParticipant.surfer_id == Profile.id)
                        .where(LiveSessionParticipant.photographer_id == photographer_id)
                        .where(LiveSessionParticipant.live_session_id == None)
                    )
                    # Narrow by time window if session_date available
                    if session_date:
                        time_before = session_date - timedelta(hours=2)
                        time_after = session_date + timedelta(hours=6)
                        fallback_query = fallback_query.where(
                            LiveSessionParticipant.joined_at.between(time_before, time_after)
                        )
                    
                    fb_result = await db.execute(fallback_query)
                    fb_rows = fb_result.all()
                    
                    if fb_rows:
                        gallery_logger.info(f"Session Roster FALLBACK: Found {len(fb_rows)} orphaned participants for session {missing_sid}")
                        live_participants_map[missing_sid] = []
                        for row in fb_rows:
                            lsp, profile = row[0], row[1]
                            live_participants_map[missing_sid].append({
                                "surfer_id": profile.id,
                                "full_name": profile.full_name,
                                "username": profile.username,
                                "avatar_url": profile.avatar_url,
                                "selfie_url": lsp.selfie_url,
                                "amount_paid": lsp.amount_paid or 0,
                                "photos_credit_remaining": lsp.photos_credit_remaining or 0,
                                "payment_method": lsp.payment_method
                            })
                            
                            # AUTO-HEAL: Update the participant's live_session_id for future queries
                            lsp.live_session_id = missing_sid
                        
                        needs_commit = True
        except Exception as e:
            gallery_logger.error(f"Session Roster live query error: {e}")
    
    # ── Booking Participants ──
    booking_participants_map = {}  # booking_id -> [participants]
    booking_settings_map = {}  # booking_id -> {photos_included}
    if booking_ids:
        # Load booking settings for photos_included
        bk_result = await db.execute(
            select(Booking).where(Booking.id.in_(booking_ids))
        )
        for bk in bk_result.scalars().all():
            booking_settings_map[bk.id] = {
                "photos_included": bk.booking_photos_included or 3
            }
        
        try:
            bp_result = await db.execute(
                select(BookingParticipant, Profile)
                .join(Profile, BookingParticipant.participant_id == Profile.id)
                .where(BookingParticipant.booking_id.in_(booking_ids))
            )
            for row in bp_result.all():
                bp, profile = row[0], row[1]
                bid = bp.booking_id
                if bid not in booking_participants_map:
                    booking_participants_map[bid] = []
                bk_settings = booking_settings_map.get(bid, {})
                booking_participants_map[bid].append({
                    "surfer_id": profile.id,
                    "full_name": profile.full_name,
                    "username": profile.username,
                    "avatar_url": profile.avatar_url,
                    "selfie_url": bp.selfie_url,
                    "amount_paid": bp.paid_amount or 0,
                    "photos_credit_remaining": 0,
                    "payment_method": bp.payment_method,
                    "photos_included": bk_settings.get("photos_included", 3)
                })
        except Exception as e:
            gallery_logger.error(f"Session Roster booking query error: {e}")
    
    # ── On-Demand (Dispatch) Participants ──
    from models import DispatchRequestParticipant
    dispatch_participants_map = {}  # dispatch_id -> [participants]
    if dispatch_ids:
        # Get dispatch requests to find requesters
        try:
            dr_result = await db.execute(
                select(DispatchRequest, Profile)
                .join(Profile, DispatchRequest.requester_id == Profile.id)
                .where(DispatchRequest.id.in_(dispatch_ids))
            )
            for row in dr_result.all():
                dr, profile = row[0], row[1]
                did = dr.id
                if did not in dispatch_participants_map:
                    dispatch_participants_map[did] = []
                dispatch_participants_map[did].append({
                    "surfer_id": profile.id,
                    "full_name": profile.full_name,
                    "username": profile.username,
                    "avatar_url": profile.avatar_url,
                    "selfie_url": dr.selfie_url,
                    "amount_paid": dr.deposit_amount or 0,
                    "photos_credit_remaining": 0,
                    "payment_method": "card"
                })
        except Exception as e:
            gallery_logger.error(f"Session Roster dispatch query error: {e}")
        # Also get additional crew participants
        try:
            drp_result = await db.execute(
                select(DispatchRequestParticipant, Profile)
                .join(Profile, DispatchRequestParticipant.participant_id == Profile.id)
                .where(DispatchRequestParticipant.dispatch_request_id.in_(dispatch_ids))
                .where(DispatchRequestParticipant.paid == True)
            )
            for row in drp_result.all():
                drp, profile = row[0], row[1]
                did = drp.dispatch_request_id
                if did not in dispatch_participants_map:
                    dispatch_participants_map[did] = []
                # Avoid duplicates
                existing_ids = [p["surfer_id"] for p in dispatch_participants_map[did]]
                if profile.id not in existing_ids:
                    dispatch_participants_map[did].append({
                        "surfer_id": profile.id,
                        "full_name": profile.full_name,
                        "username": profile.username,
                        "avatar_url": profile.avatar_url,
                        "selfie_url": drp.selfie_url,
                        "amount_paid": drp.share_amount or 0,
                        "photos_credit_remaining": 0,
                        "payment_method": "card"
                    })
        except Exception:
            pass  # DispatchRequestParticipant may not exist yet
    
    # ── Distribution counts per surfer per gallery (for progress bars) ──
    dist_per_surfer_map = {}  # gallery_id -> {surfer_id -> {photos_total, videos_total, ...}}
    if gallery_ids:
        # Get all item IDs for these galleries + media type lookup
        all_item_ids = []
        gallery_item_map = {}  # gallery_id -> [item_ids]
        item_media_type = {}   # item_id -> 'image' | 'video'
        for g in galleries:
            g_item_ids = [item.id for item in (g.items or [])]
            all_item_ids.extend(g_item_ids)
            gallery_item_map[g.id] = g_item_ids
            for item in (g.items or []):
                item_media_type[item.id] = item.media_type or 'image'
        
        if all_item_ids:
            dist_result = await db.execute(
                select(
                    SurferGalleryItem.gallery_item_id,
                    SurferGalleryItem.surfer_id,
                    SurferGalleryItem.access_type
                ).where(SurferGalleryItem.gallery_item_id.in_(all_item_ids))
            )
            # Build reverse lookup: item_id -> gallery_id
            item_to_gallery = {}
            for gid, item_ids in gallery_item_map.items():
                for iid in item_ids:
                    item_to_gallery[iid] = gid
            
            for row in dist_result.all():
                gid = item_to_gallery.get(row[0])
                if gid:
                    if gid not in dist_per_surfer_map:
                        dist_per_surfer_map[gid] = {}
                    sid = row[1]
                    if sid not in dist_per_surfer_map[gid]:
                        dist_per_surfer_map[gid][sid] = {
                            "total": 0, "included": 0,
                            "photos_total": 0, "videos_total": 0,
                            "photos_included": 0, "videos_included": 0
                        }
                    dist_per_surfer_map[gid][sid]["total"] += 1
                    is_video = item_media_type.get(row[0], 'image') == 'video'
                    if is_video:
                        dist_per_surfer_map[gid][sid]["videos_total"] += 1
                    else:
                        dist_per_surfer_map[gid][sid]["photos_total"] += 1
                    if row[2] == 'included':
                        dist_per_surfer_map[gid][sid]["included"] += 1
                        if is_video:
                            dist_per_surfer_map[gid][sid]["videos_included"] += 1
                        else:
                            dist_per_surfer_map[gid][sid]["photos_included"] += 1
    for g in galleries:
        cover_url = g.cover_image_url
        
        # If no cover but has items, use the first item's preview/thumbnail
        if not cover_url and g.items:
            for item in sorted(g.items, key=lambda i: i.created_at or datetime.min):
                candidate = item.preview_url or item.thumbnail_url
                if candidate:
                    cover_url = candidate
                    # Persist so this only needs to compute once
                    g.cover_image_url = cover_url
                    needs_commit = True
                    break
        
        # Also fix accurate item_count while we're here
        actual_count = len(g.items) if g.items else 0
        if g.item_count != actual_count:
            g.item_count = actual_count
            needs_commit = True
        
        # Compute a fallback preview from items for frontend
        first_item_preview = None
        if g.items:
            for item in sorted(g.items, key=lambda i: i.created_at or datetime.min):
                candidate = item.preview_url or item.thumbnail_url
                if candidate:
                    first_item_preview = candidate
                    break
        
        gallery_data.append({
            "id": g.id,
            "title": g.title,
            "description": g.description,
            "cover_image_url": cover_url,
            "first_item_preview": first_item_preview,
            "surf_spot_id": g.surf_spot_id,
            "surf_spot_name": g.surf_spot.name if g.surf_spot else None,
            "live_session_id": g.live_session_id,
            "booking_id": g.booking_id,
            "dispatch_id": g.dispatch_id,
            "session_type": g.session_type or ("live" if g.live_session_id else "manual"),
            "item_count": actual_count,
            "view_count": g.view_count,
            "purchase_count": g.purchase_count,
            "is_public": g.is_public,
            "is_featured": g.is_featured,
            "session_date": g.session_date.isoformat() if g.session_date else None,
            "created_at": g.created_at.isoformat(),
            "pricing": {
                "photo": {
                    "web": g.price_web,
                    "standard": g.price_standard,
                    "high": g.price_high
                },
                "video": {
                    "720p": g.price_720p,
                    "1080p": g.price_1080p,
                    "4k": g.price_4k
                }
            },
            "session_settings": _build_session_settings(g),
            "photographer_pricing": _build_photographer_pricing(g.photographer) if g.photographer else None,
            # ── SESSION ROSTER: Surfer delivery progress ──
            "session_roster": _build_session_roster(
                g, live_participants_map, booking_participants_map,
                dispatch_participants_map, dist_per_surfer_map
            )
        })
    
    if needs_commit:
        await db.commit()
    
    return gallery_data


@router.get("/galleries/{gallery_id}")
async def get_gallery(
    gallery_id: str,
    viewer_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """Get a single gallery with items"""
    
    result = await db.execute(
        select(Gallery)
        .where(Gallery.id == gallery_id)
        .options(
            selectinload(Gallery.photographer),
            selectinload(Gallery.surf_spot),
            selectinload(Gallery.items),
            selectinload(Gallery.live_session)
        )
    )
    gallery = result.scalar_one_or_none()
    
    if not gallery:
        raise HTTPException(status_code=404, detail="Gallery not found")
    
    # Increment view count
    gallery.view_count += 1
    await db.commit()
    
    # Get purchased item IDs for viewer
    purchased_ids = set()
    if viewer_id:
        purchase_result = await db.execute(
            select(GalleryPurchase.gallery_item_id)
            .where(GalleryPurchase.buyer_id == viewer_id)
        )
        purchased_ids = set(row[0] for row in purchase_result.fetchall())
    
    
    # Phase 4: Pre-fetch per-item distribution counts for status badges
    is_owner = viewer_id and viewer_id == gallery.photographer_id
    item_ids = [item.id for item in gallery.items]
    distribution_map = {}  # item_id -> {count, has_ai_suggestion}
    if item_ids and is_owner:
        dist_result = await db.execute(
            select(
                SurferGalleryItem.gallery_item_id,
                func.count(SurferGalleryItem.id).label('count'),
                func.sum(case((SurferGalleryItem.ai_suggested == True, 1), else_=0)).label('ai_count'),
                func.sum(case((SurferGalleryItem.surfer_confirmed == True, 1), else_=0)).label('confirmed_count')
            )
            .where(SurferGalleryItem.gallery_item_id.in_(item_ids))
            .group_by(SurferGalleryItem.gallery_item_id)
        )
        for row in dist_result.fetchall():
            distribution_map[row[0]] = {
                "distributed_count": row[1],
                "ai_suggested_count": row[2],
                "confirmed_count": row[3]
            }
    
    # Batch-load tagged surfer profiles for avatar chips on grid
    tagged_surfers_map = {}
    if is_owner and item_ids:
        tagged_result = await db.execute(
            select(SurferGalleryItem.gallery_item_id, SurferGalleryItem.surfer_id, 
                   SurferGalleryItem.access_type, Profile.full_name, Profile.avatar_url)
            .join(Profile, SurferGalleryItem.surfer_id == Profile.id)
            .where(SurferGalleryItem.gallery_item_id.in_(item_ids))
        )
        for row in tagged_result.fetchall():
            item_id = row[0]
            if item_id not in tagged_surfers_map:
                tagged_surfers_map[item_id] = []
            tagged_surfers_map[item_id].append({
                "surfer_id": row[1],
                "access_type": row[2],
                "full_name": row[3],
                "avatar_url": row[4]
            })
    
    items = []
    for item in gallery.items:
        # Gallery owner can always see all items (including private/draft ones)
        # Public viewers only see items marked is_public
        if is_owner or item.is_public:
            item_dist = distribution_map.get(item.id, {})
            item_tagged = tagged_surfers_map.get(item.id, [])
            items.append({
                "id": item.id,
                "preview_url": item.preview_url,
                "thumbnail_url": item.thumbnail_url,
                "media_type": item.media_type or "image",
                "title": item.title,
                "description": item.description,
                "tags": item.tags,
                "price": item.price,
                "custom_price": item.custom_price,
                "is_for_sale": item.is_for_sale,
                "is_public": item.is_public,
                "is_featured": item.is_featured,
                "view_count": item.view_count,
                "purchase_count": item.purchase_count,
                "tagged_surfer_ids": item.tagged_surfer_ids,
                "tagged_surfers": item_tagged,  # Full surfer profiles for avatar chips
                "is_purchased": item.id in purchased_ids,
                "created_at": item.created_at.isoformat(),
                # Phase 4: Distribution status per item
                "distributed_count": item_dist.get('distributed_count', 0),
                "ai_suggested_count": item_dist.get('ai_suggested_count', 0),
                "confirmed_count": item_dist.get('confirmed_count', 0)
            })
    
    return {
        "id": gallery.id,
        "photographer_id": gallery.photographer_id,
        "photographer_name": gallery.photographer.full_name if gallery.photographer else None,
        "photographer_avatar": gallery.photographer.avatar_url if gallery.photographer else None,
        "title": gallery.title,
        "description": gallery.description,
        "cover_image_url": gallery.cover_image_url,
        "surf_spot_name": gallery.surf_spot.name if gallery.surf_spot else None,
        "item_count": len(items),
        "view_count": gallery.view_count,
        "purchase_count": gallery.purchase_count,
        "is_public": gallery.is_public,
        "session_date": gallery.session_date.isoformat() if gallery.session_date else None,
        "session_type": gallery.session_type,
        "live_session_id": gallery.live_session_id,
        "booking_id": gallery.booking_id,
        "dispatch_id": gallery.dispatch_id,
        "created_at": gallery.created_at.isoformat(),
        "pricing": {
            "photo": {
                "web": gallery.price_web,
                "standard": gallery.price_standard,
                "high": gallery.price_high
            },
            "video": {
                "720p": gallery.price_720p,
                "1080p": gallery.price_1080p,
                "4k": gallery.price_4k
            }
        },
        "session_settings": _build_session_settings(gallery),
        "photographer_pricing": _build_photographer_pricing(gallery.photographer) if gallery.photographer else None,
        "items": items
    }


@router.put("/galleries/{gallery_id}")
async def update_gallery(
    gallery_id: str,
    photographer_id: str,
    data: GalleryUpdate,
    db: AsyncSession = Depends(get_db)
):
    """Update gallery details and pricing"""
    
    result = await db.execute(select(Gallery).where(Gallery.id == gallery_id))
    gallery = result.scalar_one_or_none()
    
    if not gallery:
        raise HTTPException(status_code=404, detail="Gallery not found")
    
    if gallery.photographer_id != photographer_id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    # Update fields
    if data.title is not None:
        gallery.title = data.title
    if data.description is not None:
        gallery.description = data.description
    if data.cover_image_url is not None:
        gallery.cover_image_url = data.cover_image_url
    if data.is_public is not None:
        gallery.is_public = data.is_public
    if data.is_featured is not None:
        gallery.is_featured = data.is_featured
    
    # Update pricing
    if data.price_web is not None:
        gallery.price_web = data.price_web
    if data.price_standard is not None:
        gallery.price_standard = data.price_standard
    if data.price_high is not None:
        gallery.price_high = data.price_high
    if data.price_720p is not None:
        gallery.price_720p = data.price_720p
    if data.price_1080p is not None:
        gallery.price_1080p = data.price_1080p
    if data.price_4k is not None:
        gallery.price_4k = data.price_4k
    
    await db.commit()
    
    return {
        "message": "Gallery updated",
        "pricing": {
            "photo": {
                "web": gallery.price_web,
                "standard": gallery.price_standard,
                "high": gallery.price_high
            },
            "video": {
                "720p": gallery.price_720p,
                "1080p": gallery.price_1080p,
                "4k": gallery.price_4k
            }
        }
    }


@router.patch("/galleries/{gallery_id}/session-settings")
async def update_session_settings(
    gallery_id: str,
    photographer_id: str,
    body: dict = Body(...),
    db: AsyncSession = Depends(get_db)
):
    """
    Update session-level content settings (photos/videos included).
    For live sessions → updates the LiveSession record directly.
    For bookings/on-demand → updates the photographer profile defaults.
    """
    result = await db.execute(
        select(Gallery)
        .where(Gallery.id == gallery_id)
        .options(selectinload(Gallery.live_session), selectinload(Gallery.photographer))
    )
    gallery = result.scalar_one_or_none()
    
    if not gallery:
        raise HTTPException(status_code=404, detail="Gallery not found")
    if gallery.photographer_id != photographer_id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    photos_included = body.get("photos_included")
    videos_included = body.get("videos_included")
    
    updated_target = "unknown"
    
    if gallery.live_session_id and gallery.live_session:
        # Update the actual LiveSession record
        ls = gallery.live_session
        if photos_included is not None:
            ls.photos_included = int(photos_included)
        if videos_included is not None:
            ls.videos_included = int(videos_included)
        updated_target = "live_session"
    elif gallery.booking_id and gallery.photographer:
        p = gallery.photographer
        if photos_included is not None:
            p.booking_photos_included = int(photos_included)
        if videos_included is not None:
            p.booking_videos_included = int(videos_included)
        updated_target = "booking_profile"
    elif gallery.dispatch_id and gallery.photographer:
        p = gallery.photographer
        if photos_included is not None:
            p.on_demand_photos_included = int(photos_included)
        if videos_included is not None:
            p.on_demand_videos_included = int(videos_included)
        updated_target = "on_demand_profile"
    else:
        raise HTTPException(status_code=400, detail="No linked session to update")
    
    await db.commit()
    
    return {
        "message": "Session settings updated",
        "updated_target": updated_target,
        "photos_included": photos_included,
        "videos_included": videos_included
    }


@router.delete("/galleries/{gallery_id}")
async def delete_gallery(
    gallery_id: str,
    photographer_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Delete a gallery and its items, plus any linked condition reports"""
    
    result = await db.execute(select(Gallery).where(Gallery.id == gallery_id))
    gallery = result.scalar_one_or_none()
    
    if not gallery:
        raise HTTPException(status_code=404, detail="Gallery not found")
    
    if gallery.photographer_id != photographer_id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    # Cascade: delete linked condition reports
    deleted_reports = 0
    if gallery.live_session_id:
        # Delete all condition reports linked to this live session
        cr_result = await db.execute(
            select(ConditionReport).where(ConditionReport.live_session_id == gallery.live_session_id)
        )
        for cr in cr_result.scalars().all():
            await db.delete(cr)
            deleted_reports += 1
    
    # Also clean up any condition reports from this photographer at this spot
    # that were created around the same time as the gallery (within 24 hours)
    if gallery.surf_spot_id:
        from datetime import timedelta
        window_start = gallery.created_at - timedelta(hours=1) if gallery.created_at else None
        window_end = gallery.created_at + timedelta(hours=24) if gallery.created_at else None
        if window_start and window_end:
            cr_spot_result = await db.execute(
                select(ConditionReport).where(
                    ConditionReport.photographer_id == photographer_id,
                    ConditionReport.spot_id == gallery.surf_spot_id,
                    ConditionReport.created_at >= window_start,
                    ConditionReport.created_at <= window_end
                )
            )
            for cr in cr_spot_result.scalars().all():
                await db.delete(cr)
                deleted_reports += 1
    
    await db.delete(gallery)
    await db.commit()
    
    return {"message": "Gallery deleted", "condition_reports_deleted": deleted_reports}


@router.get("/galleries/{gallery_id}/items")
async def get_gallery_items(
    gallery_id: str,
    viewer_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """Get all items in a gallery"""
    # Verify gallery exists
    result = await db.execute(select(Gallery).where(Gallery.id == gallery_id))
    gallery = result.scalar_one_or_none()
    
    if not gallery:
        raise HTTPException(status_code=404, detail="Gallery not found")
    
    # Get items in this gallery
    result = await db.execute(
        select(GalleryItem)
        .where(GalleryItem.gallery_id == gallery_id)
        .where(GalleryItem.is_public == True)
        .where(GalleryItem.is_deleted == False)
        .options(selectinload(GalleryItem.photographer), selectinload(GalleryItem.spot))
        .order_by(GalleryItem.created_at.desc())
    )
    items = result.scalars().all()
    
    # Check which items the viewer has purchased
    purchased_ids = set()
    if viewer_id:
        purchase_result = await db.execute(
            select(GalleryPurchase.gallery_item_id)
            .where(GalleryPurchase.buyer_id == viewer_id)
        )
        purchased_ids = set(row[0] for row in purchase_result.fetchall())
    
    return [{
        "id": item.id,
        "photographer_id": item.photographer_id,
        "photographer_name": item.photographer.full_name if item.photographer else None,
        "spot_id": item.spot_id,
        "spot_name": item.spot.name if item.spot else None,
        "original_url": item.original_url if item.id in purchased_ids else None,
        "preview_url": item.preview_url,
        "thumbnail_url": item.thumbnail_url,
        "media_type": item.media_type or 'image',
        "title": item.title,
        "description": item.description,
        "tags": json.loads(item.tags) if item.tags else None,
        "price": item.price,
        "custom_price": item.custom_price,
        "is_for_sale": item.is_for_sale,
        "is_public": item.is_public,
        "is_featured": item.is_featured,
        "view_count": item.view_count,
        "purchase_count": item.purchase_count,
        "is_purchased": item.id in purchased_ids,
        "video_width": item.video_width,
        "video_height": item.video_height,
        "video_duration": item.video_duration,
        "created_at": item.created_at.isoformat(),
        "shot_at": item.shot_at.isoformat() if item.shot_at else None
    } for item in items]


@router.post("/galleries/{gallery_id}/items")
async def add_item_to_gallery(
    gallery_id: str,
    photographer_id: str,
    data: GalleryItemCreate,
    db: AsyncSession = Depends(get_db)
):
    """Add an item to a specific gallery"""
    
    # Verify gallery ownership
    result = await db.execute(select(Gallery).where(Gallery.id == gallery_id))
    gallery = result.scalar_one_or_none()
    
    if not gallery:
        raise HTTPException(status_code=404, detail="Gallery not found")
    
    if gallery.photographer_id != photographer_id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    # Get photographer profile to check role
    profile_result = await db.execute(select(Profile).where(Profile.id == photographer_id))
    photographer = profile_result.scalar_one_or_none()
    
    # GROM PARENT ISOLATION: Force for_sale=false for personal capture only
    is_grom_parent = bool(photographer) and is_grom_parent_eligible(photographer)
    effective_for_sale = False if is_grom_parent else data.is_for_sale
    effective_price = 0 if is_grom_parent else data.price
    
    # Create item linked to gallery
    item = GalleryItem(
        photographer_id=photographer_id,
        gallery_id=gallery_id,
        spot_id=gallery.surf_spot_id or data.spot_id,
        original_url=data.original_url,
        preview_url=data.preview_url,
        thumbnail_url=data.thumbnail_url,
        media_type=data.media_type,
        title=data.title,
        description=data.description,
        tags=json.dumps(data.tags) if data.tags else None,
        price=effective_price,
        is_for_sale=effective_for_sale,
        tagged_surfer_ids=json.dumps(data.tagged_surfer_ids) if data.tagged_surfer_ids else None,
        shot_at=data.shot_at,
        video_width=data.video_width,
        video_height=data.video_height,
        video_duration=data.video_duration
    )
    
    db.add(item)
    
    # Update gallery stats
    gallery.item_count += 1
    
    # Auto-thumbnail sync logic:
    # 1. If gallery has no cover yet, set from this item
    # 2. If gallery is linked to an active live session, always update cover
    #    to the latest item (keeps conditions report / latest media as thumbnail)
    item_thumbnail = data.preview_url or data.thumbnail_url
    if item_thumbnail:
        if not gallery.cover_image_url:
            gallery.cover_image_url = item_thumbnail
        elif gallery.live_session_id:
            # Live session galleries: always update cover to latest upload
            # This ensures conditions report photos sync as the folder thumbnail
            try:
                ls_result = await db.execute(
                    select(LiveSession).where(LiveSession.id == gallery.live_session_id)
                )
                live_session = ls_result.scalar_one_or_none()
                if live_session and live_session.status in ('active', 'shooting', 'live'):
                    gallery.cover_image_url = item_thumbnail
                    gallery_logger.info(
                        f"Live session auto-thumbnail sync: gallery {gallery_id} cover updated to latest upload"
                    )
            except Exception as e:
                gallery_logger.warning(f"Live session thumbnail sync check failed: {e}")
    
    await db.commit()
    await db.refresh(item)
    
    # Notify tagged surfers
    if data.tagged_surfer_ids:
        for surfer_id in data.tagged_surfer_ids:
            notification = Notification(
                user_id=surfer_id,
                type='photo_tagged',
                title='You were tagged in a photo!',
                body=f'Check out the photo in {gallery.title}',
                data=json.dumps({
                    "gallery_item_id": item.id,
                    "gallery_id": gallery_id,
                    "photographer_id": photographer_id
                })
            )
            db.add(notification)
        await db.commit()
    
    return {
        "id": item.id,
        "gallery_id": gallery_id,
        "preview_url": item.preview_url,
        "message": "Item added to gallery"
    }



@router.delete("/galleries/{gallery_id}/items/{item_id}")
async def remove_item_from_gallery(
    gallery_id: str,
    item_id: str,
    photographer_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Delete an item from a gallery (photographer only)"""
    # Verify gallery ownership
    result = await db.execute(select(Gallery).where(Gallery.id == gallery_id))
    gallery = result.scalar_one_or_none()
    
    if not gallery:
        raise HTTPException(status_code=404, detail="Gallery not found")
    
    if gallery.photographer_id != photographer_id:
        raise HTTPException(status_code=403, detail="Not authorized to modify this gallery")
    
    # Verify item exists in this gallery
    item_check = await db.execute(
        select(GalleryItem).where(
            GalleryItem.id == item_id,
            GalleryItem.gallery_id == gallery_id
        )
    )
    item = item_check.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found in this gallery")
    
    # Safe delete (protects paid surfer locker items)
    result = await safe_delete_gallery_item(db, item_id, photographer_id)
    
    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])
    
    # Update gallery stats
    gallery.item_count = max(0, gallery.item_count - 1)
    
    await db.commit()
    
    return {**result, "gallery_id": gallery_id, "item_id": item_id}


# ============ CROSS-PROFILE TAGGING (Parent → Grom) ============

class GromTagRequest(BaseModel):
    gallery_item_id: str
