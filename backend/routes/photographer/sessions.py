"""
Photographer sessions — active session, go-live, end-session, session history.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, func
from sqlalchemy.orm import selectinload
from typing import List
from datetime import datetime, timezone, timedelta
import json
import logging

logger = logging.getLogger(__name__)

from database import get_db
from models import (
    Profile, LiveSession, LiveSessionParticipant, Notification,
    SurfSpot, ConditionReport, Story, Gallery, GalleryItem,
    RoleEnum
)
from utils.grom_parent import is_grom_parent_eligible
from .schemas import (
    GoLiveRequest, LiveSessionResponse,
    SessionHistoryItem, SessionHistoryParticipant,
    is_photographer_role,
)

router = APIRouter()


@router.get("/photographer/{photographer_id}/active-session")
async def get_active_session(
    photographer_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get photographer's current active live session"""
    photographer_result = await db.execute(
        select(Profile).where(Profile.id == photographer_id)
        .options(selectinload(Profile.current_spot))
    )
    photographer = photographer_result.scalar_one_or_none()
    if not photographer:
        raise HTTPException(status_code=404, detail="Photographer not found")
    if not photographer.is_shooting:
        return None

    participants_result = await db.execute(
        select(LiveSessionParticipant)
        .where(LiveSessionParticipant.photographer_id == photographer_id)
        .where(LiveSessionParticipant.status == 'active')
        .options(selectinload(LiveSessionParticipant.surfer))
    )
    participants = participants_result.scalars().all()
    total_earnings = sum(p.amount_paid for p in participants)

    participants_data = []
    for p in participants:
        participants_data.append({
            "id": p.id, "surfer_id": p.surfer_id,
            "name": p.surfer.full_name if p.surfer else None,
            "avatar_url": p.surfer.avatar_url if p.surfer else None,
            "selfie_url": p.selfie_url,
            "amount_paid": p.amount_paid,
            "joined_at": p.joined_at.isoformat()
        })

    return LiveSessionResponse(
        photographer_id=photographer.id,
        location=photographer.location or "Unknown",
        spot_id=photographer.current_spot_id,
        spot_name=photographer.current_spot.name if photographer.current_spot else None,
        price_per_join=photographer.session_price or 25.0,
        active_surfers=len(participants),
        views=0,
        earnings=total_earnings,
        started_at=photographer.shooting_started_at,
        participants=participants_data
    )


@router.post("/photographer/{photographer_id}/go-live")
async def go_live(
    photographer_id: str,
    data: GoLiveRequest,
    db: AsyncSession = Depends(get_db)
):
    """Start a live shooting session"""
    photographer_result = await db.execute(
        select(Profile).where(Profile.id == photographer_id)
    )
    photographer = photographer_result.scalar_one_or_none()
    if not photographer:
        raise HTTPException(status_code=404, detail="Photographer not found")
    if not is_photographer_role(photographer.role):
        raise HTTPException(status_code=403, detail="User is not a photographer")

    # Grom Parent: NO Live Sessions
    if is_grom_parent_eligible(photographer):
        raise HTTPException(status_code=403, detail="Grom Parents cannot start Live Sessions. Gallery and Bookings access only.")

    # Hobbyist proximity check
    if photographer.role == RoleEnum.HOBBYIST:
        if data.latitude and data.longitude:
            import math
            mile_threshold = 0.1
            lat_range = mile_threshold / 69.0
            lon_range = mile_threshold / (69.0 * math.cos(math.radians(data.latitude)))
            nearby_query = await db.execute(
                select(Profile).where(
                    and_(
                        Profile.is_shooting.is_(True),
                        Profile.role.in_([RoleEnum.PHOTOGRAPHER, RoleEnum.APPROVED_PRO]),
                        Profile.id != photographer_id,
                        Profile.on_demand_latitude.isnot(None),
                        Profile.on_demand_longitude.isnot(None)
                    )
                )
            )
            for nearby_pro in nearby_query.scalars().all():
                if nearby_pro.on_demand_latitude and nearby_pro.on_demand_longitude:
                    lat_diff = abs(data.latitude - nearby_pro.on_demand_latitude)
                    lon_diff = abs(data.longitude - nearby_pro.on_demand_longitude)
                    if lat_diff <= lat_range and lon_diff <= lon_range:
                        raise HTTPException(status_code=403, detail="A Pro photographer is active within 0.1 miles of your location. Hobbyists can only go live when no Pro photographers are nearby.")

    # Stale session recovery
    if photographer.is_shooting:
        stale_threshold_hours = 4
        if photographer.shooting_started_at:
            started = photographer.shooting_started_at
            if started.tzinfo is None:
                started = started.replace(tzinfo=timezone.utc)
            hours_elapsed = (datetime.now(timezone.utc) - started).total_seconds() / 3600
            if hours_elapsed > stale_threshold_hours:
                logger.warning(f"[go-live] Auto-resetting stale session for {photographer_id} (started {hours_elapsed:.1f}h ago)")
                photographer.is_shooting = False
                photographer.current_spot_id = None
                photographer.shooting_started_at = None
                stale_sessions = await db.execute(
                    select(LiveSession).where(LiveSession.photographer_id == photographer_id, LiveSession.status == 'active')
                )
                for stale_session in stale_sessions.scalars().all():
                    stale_session.status = 'ended'
                    stale_session.ended_at = datetime.now(timezone.utc)
                await db.flush()
            else:
                raise HTTPException(status_code=400, detail="Already in a live session")
        else:
            logger.warning(f"[go-live] Resetting is_shooting with no timestamp for {photographer_id}")
            photographer.is_shooting = False
            photographer.current_spot_id = None
            await db.flush()

    # Mutual exclusivity with On-Demand
    if photographer.on_demand_available:
        logger.warning(f"[go-live] Auto-disabling stale on_demand_available for {photographer_id}")
        photographer.on_demand_available = False
        photographer.on_demand_latitude = None
        photographer.on_demand_longitude = None
        await db.flush()

    # Find or verify spot
    spot_id = data.spot_id
    spot_name = data.location or data.spot_name or "Unknown Location"
    spot = None
    if spot_id:
        spot_result = await db.execute(select(SurfSpot).where(SurfSpot.id == spot_id))
        spot = spot_result.scalar_one_or_none()
        if spot:
            spot_name = spot.name
        else:
            spot_id = None

    # Resolution pricing
    session_photo_price_web = data.photo_price_web or photographer.photo_price_web or 3.0
    session_photo_price_standard = data.photo_price_standard or photographer.photo_price_standard or 5.0
    session_photo_price_high = data.photo_price_high or photographer.photo_price_high or 10.0

    # Create LiveSession record
    try:
        live_session = LiveSession(
            photographer_id=photographer_id, surf_spot_id=spot_id, location_name=spot_name,
            buyin_price=data.price_per_join, photo_price=photographer.live_photo_price or 5.0,
            session_photo_price=data.live_photo_price or photographer.live_photo_price or 5.0,
            photos_included=data.photos_included or 3,
            general_photo_price=data.general_photo_price or photographer.photo_price_standard or 10.0,
            session_price_web=session_photo_price_web, session_price_standard=session_photo_price_standard,
            session_price_high=session_photo_price_high, max_surfers=data.max_surfers or 10,
            estimated_duration_hours=data.estimated_duration or 2,
            participant_count=0, total_earnings=0.0, started_at=datetime.now(timezone.utc), status='active',
            earnings_destination_type=data.earnings_destination_type,
            earnings_destination_id=data.earnings_destination_id,
            earnings_cause_name=data.earnings_cause_name
        )
    except Exception as ls_err:
        logger.warning(f"LiveSession resolution pricing columns missing, using fallback: {ls_err}")
        live_session = LiveSession(
            photographer_id=photographer_id, surf_spot_id=spot_id, location_name=spot_name,
            buyin_price=data.price_per_join, photo_price=photographer.live_photo_price or 5.0,
            session_photo_price=data.live_photo_price or photographer.live_photo_price or 5.0,
            photos_included=data.photos_included or 3,
            general_photo_price=data.general_photo_price or photographer.photo_price_standard or 10.0,
            max_surfers=data.max_surfers or 10, estimated_duration_hours=data.estimated_duration or 2,
            participant_count=0, total_earnings=0.0, started_at=datetime.now(timezone.utc), status='active',
            earnings_destination_type=data.earnings_destination_type,
            earnings_destination_id=data.earnings_destination_id,
            earnings_cause_name=data.earnings_cause_name
        )
    db.add(live_session)
    await db.flush()

    # Multi-post pipeline: Story + Condition Report
    expires_at = datetime.now(timezone.utc) + timedelta(hours=24)
    default_live_media = photographer.avatar_url or "https://raw-surf-os.preview.emergentagent.com/api/static/live-status-default.png"

    story = Story(
        author_id=photographer_id, spot_id=spot_id, media_url=default_live_media,
        media_type='image', caption=f"Now shooting at {spot_name}",
        story_type='photographer', is_live_report=True,
        latitude=data.latitude, longitude=data.longitude,
        location_name=spot_name, expires_at=expires_at
    )
    db.add(story)
    await db.flush()

    # Process condition media
    condition_media_url = ""
    condition_media_type = "status"
    if data.condition_media_url:
        condition_media_url = data.condition_media_url
        condition_media_type = data.condition_media_type or "image"
        story.media_url = condition_media_url
        story.media_type = condition_media_type
    elif data.condition_media:
        try:
            import base64, uuid
            from services.media_upload import upload_to_supabase_storage
            media_bytes = base64.b64decode(data.condition_media)
            file_ext = "mp4" if data.condition_media_type == "video" else "jpg"
            filename = f"conditions/{photographer_id}/{uuid.uuid4()}.{file_ext}"
            condition_media_url = await upload_to_supabase_storage(
                media_bytes, filename,
                content_type=f"{'video' if data.condition_media_type == 'video' else 'image'}/{file_ext}"
            )
            condition_media_type = data.condition_media_type or "image"
            story.media_url = condition_media_url
            story.media_type = condition_media_type
        except Exception as e:
            logger.warning(f"Failed to upload condition media (base64 path): {e}")

    condition_caption = data.spot_notes.strip() if data.spot_notes else f"Live at {spot_name}"
    if data.spot_notes:
        story.caption = f"Now shooting at {spot_name}: {data.spot_notes.strip()}"

    condition_report = ConditionReport(
        photographer_id=photographer_id, spot_id=spot_id, media_url=condition_media_url,
        media_type=condition_media_type, caption=condition_caption, spot_name=spot_name,
        region=spot.region if spot_id and spot else None,
        latitude=data.latitude, longitude=data.longitude,
        story_id=story.id, post_id=None, live_session_id=live_session.id,
        expires_at=expires_at, is_active=True
    )
    db.add(condition_report)

    # Update photographer status
    photographer.is_shooting = True
    photographer.shooting_started_at = datetime.now(timezone.utc)
    photographer.current_spot_id = spot_id
    photographer.location = spot_name
    photographer.session_price = data.price_per_join

    await db.commit()
    await db.refresh(photographer)

    return {
        "message": "You are now live!",
        "photographer_id": photographer.id,
        "live_session_id": live_session.id,
        "location": photographer.location,
        "session_price": photographer.session_price,
        "started_at": photographer.shooting_started_at.isoformat(),
        "live_session_rates": {
            "buyin_price": live_session.buyin_price,
            "live_photo_price": live_session.session_photo_price,
            "photos_included": live_session.photos_included,
            "general_photo_price": live_session.general_photo_price,
            "savings_per_photo": (live_session.general_photo_price or 10.0) - (live_session.session_photo_price or 5.0),
            "max_surfers": live_session.max_surfers,
            "resolution_pricing": {
                "web": session_photo_price_web,
                "standard": session_photo_price_standard,
                "high": session_photo_price_high
            }
        },
        "earnings_destination": {
            "type": data.earnings_destination_type,
            "id": data.earnings_destination_id,
            "cause_name": data.earnings_cause_name
        } if data.earnings_destination_type else None
    }


@router.post("/photographer/{photographer_id}/end-session")
async def end_live_session(
    photographer_id: str,
    db: AsyncSession = Depends(get_db)
):
    """End the current live session, auto-create Gallery via sync service, and route earnings"""
    from utils.revenue_routing import process_creator_earnings
    from services.gallery_sync import create_session_gallery, check_gallery_exists_for_session

    photographer_result = await db.execute(
        select(Profile).where(Profile.id == photographer_id)
        .options(selectinload(Profile.current_spot))
    )
    photographer = photographer_result.scalar_one_or_none()
    if not photographer:
        raise HTTPException(status_code=404, detail="Photographer not found")
    if not photographer.is_shooting:
        raise HTTPException(status_code=400, detail="No active session to end")

    # Find active LiveSession
    active_session_result = await db.execute(
        select(LiveSession)
        .where(LiveSession.photographer_id == photographer_id)
        .where(LiveSession.status == 'active')
        .order_by(LiveSession.started_at.desc())
    )
    live_session = active_session_result.scalars().first()

    # Mark participants completed
    participants_result = await db.execute(
        select(LiveSessionParticipant)
        .where(LiveSessionParticipant.photographer_id == photographer_id)
        .where(LiveSessionParticipant.status == 'active')
    )
    participants = participants_result.scalars().all()
    total_earnings = 0
    participant_ids = []
    for p in participants:
        p.status = 'completed'
        p.completed_at = datetime.now(timezone.utc)
        total_earnings += p.amount_paid
        participant_ids.append(p.surfer_id)

    # Calculate duration
    duration_mins = 0
    started_at = photographer.shooting_started_at
    if started_at:
        if started_at.tzinfo is None:
            started_at = started_at.replace(tzinfo=timezone.utc)
        duration = datetime.now(timezone.utc) - started_at
        duration_mins = int(duration.total_seconds() / 60)

    spot_id = photographer.current_spot_id
    spot_name = photographer.current_spot.name if photographer.current_spot else photographer.location
    session_date = photographer.shooting_started_at or datetime.now(timezone.utc)

    # Legacy support: create LiveSession if none found
    if not live_session:
        live_session = LiveSession(
            photographer_id=photographer_id, surf_spot_id=spot_id,
            location_name=spot_name or "Live Session",
            buyin_price=photographer.live_buyin_price or 25.0,
            photo_price=photographer.live_photo_price or 5.0,
            participant_count=len(participants), total_earnings=total_earnings,
            started_at=session_date, ended_at=datetime.now(timezone.utc),
            duration_mins=duration_mins, status='ended'
        )
        db.add(live_session)
    else:
        live_session.status = 'ended'
        live_session.ended_at = datetime.now(timezone.utc)
        live_session.duration_mins = duration_mins
        live_session.participant_count = len(participants)
        live_session.total_earnings = total_earnings

    await db.flush()

    # Auto-create Gallery
    gallery_exists = await check_gallery_exists_for_session(db, live_session_id=live_session.id)
    gallery_result = None
    if not gallery_exists:
        gallery_result = await create_session_gallery(
            db=db, photographer_id=photographer_id, session_type='live',
            spot_id=spot_id, spot_name=spot_name,
            live_session_id=live_session.id, session_start=session_date,
            participant_ids=participant_ids
        )
        if gallery_result and gallery_result.get("gallery_id"):
            gallery_id = gallery_result.get("gallery_id")
            for surfer_id in participant_ids:
                notification = Notification(
                    user_id=surfer_id, type='gallery_ready',
                    title='Your Photos Are Ready!',
                    body=f'{photographer.full_name} has finished shooting. Check out your photos!',
                    data=json.dumps({
                        'gallery_id': gallery_id, 'live_session_id': live_session.id,
                        'photographer_id': photographer_id,
                        'photographer_name': photographer.full_name,
                        'session_type': 'live', 'action_url': f'/gallery/{gallery_id}'
                    })
                )
                db.add(notification)
            # Auto-set gallery cover from conditions report
            try:
                cr_result = await db.execute(
                    select(ConditionReport).where(
                        and_(ConditionReport.live_session_id == live_session.id,
                             ConditionReport.media_url.isnot(None),
                             ConditionReport.media_url != "")
                    ).order_by(ConditionReport.created_at.desc())
                )
                conditions_report = cr_result.scalars().first()
                if conditions_report and conditions_report.media_url:
                    gallery_obj_result = await db.execute(select(Gallery).where(Gallery.id == gallery_id))
                    gallery_obj = gallery_obj_result.scalar_one_or_none()
                    if gallery_obj and not gallery_obj.cover_image_url:
                        gallery_obj.cover_image_url = conditions_report.media_url
                        logger.info(f"[Gallery] Auto-set cover image from conditions report for gallery {gallery_id}")
            except Exception as e:
                logger.warning(f"[Gallery] Failed to set conditions thumbnail: {e}")

    # Reset photographer status
    photographer.is_shooting = False
    photographer.current_spot_id = None
    photographer.shooting_started_at = None
    await db.commit()

    # Session recap emails (async, non-blocking)
    try:
        from services.email_service import send_session_recap_email
        recap_photo_count = 0
        if gallery_result and gallery_result.get("gallery_id"):
            try:
                photo_count_result = await db.execute(
                    select(func.count(GalleryItem.id)).where(GalleryItem.gallery_id == gallery_result["gallery_id"])
                )
                recap_photo_count = photo_count_result.scalar() or 0
            except Exception:
                pass
        for surfer_id in participant_ids:
            try:
                surfer_result = await db.execute(select(Profile).where(Profile.id == surfer_id))
                surfer = surfer_result.scalar_one_or_none()
                if surfer and surfer.email:
                    await send_session_recap_email(
                        to_email=surfer.email,
                        photographer_name=photographer.full_name or "Photographer",
                        spot_name=spot_name or "Session",
                        duration_mins=duration_mins,
                        photo_count=recap_photo_count,
                        gallery_id=gallery_result.get("gallery_id") if gallery_result else None,
                        live_session_id=live_session.id
                    )
            except Exception as email_err:
                logger.warning(f"[SessionRecap] Failed to email {surfer_id}: {email_err}")
    except Exception as recap_err:
        logger.warning(f"[SessionRecap] Email service error: {recap_err}")

    return {
        "message": "Session ended - Gallery created for your photos!",
        "total_surfers": len(participants),
        "total_earnings": total_earnings,
        "duration_mins": duration_mins,
        "gallery_id": gallery_result.get("gallery_id") if gallery_result else None,
        "gallery_title": gallery_result.get("title") if gallery_result else "Gallery already exists",
        "live_session_id": live_session.id,
        "selection_quotas_created": gallery_result.get("participants_added", 0) if gallery_result else 0
    }


@router.get("/photographer/{photographer_id}/session-history", response_model=List[SessionHistoryItem])
async def get_session_history(
    photographer_id: str,
    limit: int = Query(default=20, le=100),
    db: AsyncSession = Depends(get_db)
):
    """Get photographer's past session history with enriched detail data"""
    from models import Review

    sessions_result = await db.execute(
        select(LiveSession)
        .where(and_(LiveSession.photographer_id == photographer_id, LiveSession.status == 'ended'))
        .options(selectinload(LiveSession.surf_spot))
        .order_by(LiveSession.ended_at.desc())
        .limit(limit)
    )
    sessions = sessions_result.scalars().all()

    if not sessions:
        # Legacy fallback
        result = await db.execute(
            select(LiveSessionParticipant)
            .where(LiveSessionParticipant.photographer_id == photographer_id)
            .where(LiveSessionParticipant.status == 'completed')
            .options(selectinload(LiveSessionParticipant.spot))
            .order_by(LiveSessionParticipant.completed_at.desc())
            .limit(limit * 10)
        )
        participants = result.scalars().all()
        if not participants:
            return []
        sessions_map = {}
        for p in participants:
            if p.completed_at:
                date_key = p.completed_at.date().isoformat()
                location = p.spot.name if p.spot else "Unknown location"
                key = f"{date_key}_{location}"
                if key not in sessions_map:
                    sessions_map[key] = {"id": p.id, "location": location, "started_at": p.joined_at, "completed_at": p.completed_at, "surfers": [], "earnings": 0}
                sessions_map[key]["surfers"].append(p.surfer_id)
                sessions_map[key]["earnings"] += p.amount_paid
        history = []
        for sd in list(sessions_map.values())[:limit]:
            duration_mins = 60
            if sd["completed_at"] and sd["started_at"]:
                duration = sd["completed_at"] - sd["started_at"]
                duration_mins = max(int(duration.total_seconds() / 60), 1)
            history.append(SessionHistoryItem(id=sd["id"], location=sd["location"], started_at=sd["started_at"], duration_mins=duration_mins, total_surfers=len(sd["surfers"]), total_earnings=sd["earnings"]))
        return history

    session_ids = [s.id for s in sessions]

    # Batch-load participants
    participants_result = await db.execute(
        select(LiveSessionParticipant)
        .options(selectinload(LiveSessionParticipant.surfer))
        .where(and_(LiveSessionParticipant.session_id.in_(session_ids), LiveSessionParticipant.status == 'completed'))
    )
    participants_by_session = {}
    for p in participants_result.scalars().all():
        participants_by_session.setdefault(p.session_id, []).append(p)

    # Batch-load galleries
    galleries_result = await db.execute(select(Gallery).where(Gallery.live_session_id.in_(session_ids)))
    galleries_by_session = {g.live_session_id: g for g in galleries_result.scalars().all()}

    # Batch-load photo counts
    gallery_ids = [g.id for g in galleries_by_session.values()]
    photo_counts = {}
    if gallery_ids:
        counts_result = await db.execute(
            select(GalleryItem.gallery_id, func.count(GalleryItem.id))
            .where(GalleryItem.gallery_id.in_(gallery_ids))
            .where(GalleryItem.is_deleted.is_(False))
            .group_by(GalleryItem.gallery_id)
        )
        for gid, cnt in counts_result.all():
            photo_counts[gid] = cnt

    # Batch-load review counts
    reviews_result = await db.execute(
        select(Review.live_session_id, func.count(Review.id))
        .where(and_(Review.reviewer_id == photographer_id, Review.live_session_id.in_(session_ids)))
        .group_by(Review.live_session_id)
    )
    reviews_given_by_session = dict(reviews_result.all())

    history = []
    for session in sessions:
        duration_mins = session.duration_mins or 60
        if not session.duration_mins and session.ended_at and session.started_at:
            duration = session.ended_at - session.started_at
            duration_mins = max(int(duration.total_seconds() / 60), 1)
        location = session.location_name or (session.surf_spot.name if session.surf_spot else "Unknown location")
        session_participants = participants_by_session.get(session.id, [])
        participant_roster = []
        total_earnings = session.total_earnings or 0
        for p in session_participants:
            surfer = p.surfer
            participant_roster.append(SessionHistoryParticipant(
                id=p.surfer_id, full_name=surfer.full_name if surfer else "Surfer",
                avatar_url=surfer.avatar_url if surfer else None, amount_paid=p.amount_paid or 0.0
            ))
        gallery = galleries_by_session.get(session.id)
        gallery_id = gallery.id if gallery else None
        gallery_count = photo_counts.get(gallery_id, 0) if gallery_id else 0
        reviews_given = reviews_given_by_session.get(session.id, 0)
        has_pending = len(session_participants) > reviews_given

        history.append(SessionHistoryItem(
            id=session.id, location=location, started_at=session.started_at,
            duration_mins=duration_mins, total_surfers=len(session_participants),
            total_earnings=total_earnings, session_type=session.session_mode or 'live_join',
            live_session_id=session.id, gallery_id=gallery_id,
            gallery_photo_count=gallery_count, buyin_price=session.buyin_price,
            photo_price_web=session.session_price_web, photo_price_standard=session.session_price_standard,
            photo_price_high=session.session_price_high, participants=participant_roster,
            has_pending_reviews=has_pending, reviews_given=reviews_given
        ))

    return history
