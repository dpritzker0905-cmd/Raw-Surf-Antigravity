"""
Gallery Collection roster — session roster helpers and photographer gallery listing.

Extracted from collections.py (v87) to keep modules under 800 LOC.
Contains the heavy data-aggregation logic for building session rosters,
photographer pricing configs, and the batch-loaded photographer galleries list.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, case
from sqlalchemy.orm import selectinload
from typing import Optional
from datetime import datetime, timedelta
import logging

gallery_logger = logging.getLogger("routes.gallery")

from database import get_db
from models import (
    Profile, GalleryItem, Gallery, LiveSession, LiveSessionParticipant,
    SurferGalleryItem, Booking, BookingParticipant, DispatchRequest
)

router = APIRouter()


def build_session_settings(gallery):
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


def build_photographer_pricing(photographer):
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


def build_session_roster(gallery, live_map, booking_map, dispatch_map, dist_map):
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
            "session_settings": build_session_settings(g),
            "photographer_pricing": build_photographer_pricing(g.photographer) if g.photographer else None,
            # ── SESSION ROSTER: Surfer delivery progress ──
            "session_roster": build_session_roster(
                g, live_participants_map, booking_participants_map,
                dispatch_participants_map, dist_per_surfer_map
            )
        })
    
    if needs_commit:
        await db.commit()
    
    return gallery_data
