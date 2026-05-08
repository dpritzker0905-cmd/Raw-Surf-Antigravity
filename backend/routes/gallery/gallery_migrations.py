"""
gallery/gallery_migrations.py — Batch admin migration and cleanup operations.

Extracted from admin.py (v85) to maintain <800 LOC per module.
Contains: title migrations, hash-title cleanup, session date healing.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from typing import Optional
from datetime import datetime, timezone
import logging

from database import get_db
from models import (
    Profile, Gallery, GalleryItem, LiveSession,
    Booking, DispatchRequest
)
from deps.admin_auth import get_current_admin

gallery_logger = logging.getLogger("routes.gallery")

router = APIRouter()


# ═══════════════════════════════════════════════════════════════════
# ADMIN: Migrate Gallery Titles to Date · Time · Location · Type
# ═══════════════════════════════════════════════════════════════════

SESSION_TYPE_LABELS = {
    'live': 'Live Session',
    'on_demand': 'On-Demand',
    'booking': 'Booking',
    'manual': 'Gallery',
    None: 'Gallery',
}


@router.post("/gallery/migrate-titles")
async def migrate_gallery_titles(
    photographer_id: str = Query(..., description="Photographer ID for authorization"),
    dry_run: bool = Query(False, description="If true, preview changes without saving"),
    db: AsyncSession = Depends(get_db)
):
    """
    Retroactively update all gallery titles to the new format:
      Date · Time · Location · Type

    Skips galleries whose title already contains ' · ' (already migrated).
    Use dry_run=true to preview changes before committing.
    """
    import re

    profile_result = await db.execute(select(Profile).where(Profile.id == photographer_id))
    photographer = profile_result.scalar_one_or_none()
    if not photographer:
        raise HTTPException(status_code=404, detail="Photographer not found")

    result = await db.execute(
        select(Gallery)
        .where(Gallery.photographer_id == photographer_id)
        .options(selectinload(Gallery.surf_spot))
    )
    galleries = result.scalars().all()

    updated = []
    skipped = []

    for g in galleries:
        if g.title and ' · ' in g.title:
            skipped.append({"id": g.id, "title": g.title, "reason": "already_migrated"})
            continue

        ts = g.session_date or g.created_at
        if not ts:
            skipped.append({"id": g.id, "title": g.title, "reason": "no_date"})
            continue

        date_part = ts.strftime("%b %d, %Y")
        try:
            time_part = ts.strftime("%-I:%M %p")
        except ValueError:
            time_part = ts.strftime("%#I:%M %p")

        spot_name = None
        if g.surf_spot:
            spot_name = g.surf_spot.name
        elif g.title:
            match = re.search(r'(?:Session|Gallery) at (.+?)(?:\s*-\s*)', g.title)
            if match:
                spot_name = match.group(1).strip()

        type_label = SESSION_TYPE_LABELS.get(g.session_type, 'Gallery')

        if spot_name:
            new_title = f"{date_part} · {time_part} · {spot_name} · {type_label}"
        else:
            new_title = f"{date_part} · {time_part} · {type_label}"

        old_title = g.title
        updated.append({"id": g.id, "old_title": old_title, "new_title": new_title})

        if not dry_run:
            g.title = new_title

    if not dry_run and updated:
        await db.commit()

    return {
        "message": f"{'Would update' if dry_run else 'Updated'} {len(updated)} gallery titles, skipped {len(skipped)}",
        "dry_run": dry_run,
        "updated": updated,
        "skipped": skipped,
    }


# ═══════════════════════════════════════════════════════════════════
# ADMIN: Clean up GalleryItem titles (replace hash/UUID filenames)
# ═══════════════════════════════════════════════════════════════════

def _is_hash_title(title: str) -> bool:
    """Detect if a title is a non-human-readable hash, UUID, or numeric string."""
    if not title:
        return True
    import re
    cleaned = title.strip()
    if re.match(r'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}', cleaned, re.I):
        return True
    if re.match(r'^[a-f0-9]{32}', cleaned, re.I):
        return True
    base = re.sub(r'_(original|preview|thumb|thumbnail)$', '', cleaned)
    if re.match(r'^[\d_]+$', base) and len(base) >= 10:
        return True
    alpha_count = sum(1 for c in base if c.isalpha() and c not in 'abcdefABCDEF')
    if len(base) > 15 and alpha_count < len(base) * 0.3:
        return True
    return False


@router.post("/gallery/{gallery_id}/clean-item-titles")
async def clean_gallery_item_titles(
    gallery_id: str,
    photographer_id: str = Query(..., description="Photographer ID for authorization"),
    dry_run: bool = Query(False, description="If true, preview changes without saving"),
    db: AsyncSession = Depends(get_db)
):
    """Replace hash/UUID/numeric-only item titles with clean sequential names."""
    result = await db.execute(select(Gallery).where(Gallery.id == gallery_id))
    gallery = result.scalar_one_or_none()
    if not gallery:
        raise HTTPException(status_code=404, detail="Gallery not found")
    if gallery.photographer_id != photographer_id:
        raise HTTPException(status_code=403, detail="Not authorized")

    items_result = await db.execute(
        select(GalleryItem)
        .where(GalleryItem.gallery_id == gallery_id, GalleryItem.is_deleted == False)
        .order_by(GalleryItem.created_at.asc())
    )
    items = items_result.scalars().all()

    photo_counter = 0
    video_counter = 0
    updated = []
    skipped = []

    for item in items:
        is_video = item.media_type == 'video'
        if is_video:
            video_counter += 1
        else:
            photo_counter += 1

        if not _is_hash_title(item.title):
            skipped.append({"id": item.id, "title": item.title, "reason": "human_readable"})
            continue

        new_title = f"Surf Video {video_counter}" if is_video else f"Surf Photo {photo_counter}"
        updated.append({"id": item.id, "old_title": item.title, "new_title": new_title})

        if not dry_run:
            item.title = new_title

    if not dry_run and updated:
        await db.commit()

    return {
        "message": f"{'Would rename' if dry_run else 'Renamed'} {len(updated)} items, skipped {len(skipped)} (already readable)",
        "gallery_id": gallery_id,
        "dry_run": dry_run,
        "updated": updated,
        "skipped": skipped,
    }


@router.post("/gallery/clean-all-item-titles")
async def clean_all_item_titles(
    photographer_id: str = Query(..., description="Photographer ID for authorization"),
    dry_run: bool = Query(False, description="If true, preview changes without saving"),
    db: AsyncSession = Depends(get_db)
):
    """Batch: Clean up hash-style item titles across ALL galleries for a photographer."""
    profile_result = await db.execute(select(Profile).where(Profile.id == photographer_id))
    photographer = profile_result.scalar_one_or_none()
    if not photographer:
        raise HTTPException(status_code=404, detail="Photographer not found")

    result = await db.execute(
        select(Gallery).where(Gallery.photographer_id == photographer_id)
    )
    galleries = result.scalars().all()

    total_updated = 0
    total_skipped = 0
    gallery_results = []

    for g in galleries:
        items_result = await db.execute(
            select(GalleryItem)
            .where(GalleryItem.gallery_id == g.id, GalleryItem.is_deleted == False)
            .order_by(GalleryItem.created_at.asc())
        )
        items = items_result.scalars().all()

        photo_counter = 0
        video_counter = 0
        g_updated = 0

        for item in items:
            is_video = item.media_type == 'video'
            if is_video:
                video_counter += 1
            else:
                photo_counter += 1

            if not _is_hash_title(item.title):
                total_skipped += 1
                continue

            new_title = f"Surf Video {video_counter}" if is_video else f"Surf Photo {photo_counter}"
            if not dry_run:
                item.title = new_title
            g_updated += 1
            total_updated += 1

        if g_updated > 0:
            gallery_results.append({
                "gallery_id": g.id,
                "gallery_title": g.title,
                "items_renamed": g_updated,
            })

    if not dry_run and total_updated > 0:
        await db.commit()

    return {
        "message": f"{'Would rename' if dry_run else 'Renamed'} {total_updated} items across {len(gallery_results)} galleries, skipped {total_skipped}",
        "dry_run": dry_run,
        "total_updated": total_updated,
        "total_skipped": total_skipped,
        "galleries": gallery_results,
    }


# ── Admin: Heal Session Dates ─────────────────────────────────────────────────

@router.post("/gallery/admin/heal-session-dates")
async def heal_session_dates(
    dry_run: bool = Query(default=True, description="Preview changes without committing"),
    admin: dict = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    Backfill NULL session_date values on galleries using metadata from linked
    LiveSession, Booking, or DispatchRequest records.
    """
    result = await db.execute(
        select(Gallery).where(Gallery.session_date.is_(None))
    )
    galleries = result.scalars().all()

    healed = []
    skipped = []

    for gallery in galleries:
        source = None
        healed_date = None

        if gallery.live_session_id:
            ls_result = await db.execute(
                select(LiveSession).where(LiveSession.id == gallery.live_session_id)
            )
            live_session = ls_result.scalar_one_or_none()
            if live_session and live_session.started_at:
                healed_date = live_session.started_at
                source = "live_session.started_at"

        if not healed_date and gallery.booking_id:
            bk_result = await db.execute(
                select(Booking).where(Booking.id == gallery.booking_id)
            )
            booking = bk_result.scalar_one_or_none()
            if booking and booking.session_date:
                healed_date = booking.session_date
                source = "booking.session_date"

        if not healed_date and gallery.dispatch_request_id:
            dr_result = await db.execute(
                select(DispatchRequest).where(DispatchRequest.id == gallery.dispatch_request_id)
            )
            dispatch = dr_result.scalar_one_or_none()
            if dispatch and dispatch.created_at:
                healed_date = dispatch.created_at
                source = "dispatch_request.created_at"

        if not healed_date and gallery.created_at:
            healed_date = gallery.created_at
            source = "gallery.created_at (fallback)"

        if healed_date:
            if not dry_run:
                gallery.session_date = healed_date
            healed.append({
                "gallery_id": gallery.id,
                "title": gallery.title,
                "source": source,
                "healed_date": healed_date.isoformat() if healed_date else None,
            })
        else:
            skipped.append({
                "gallery_id": gallery.id,
                "title": gallery.title,
                "reason": "No linked metadata found"
            })

    if not dry_run and healed:
        await db.commit()

    return {
        "message": f"{'Would heal' if dry_run else 'Healed'} {len(healed)} galleries, skipped {len(skipped)}",
        "dry_run": dry_run,
        "total_null": len(galleries),
        "total_healed": len(healed),
        "total_skipped": len(skipped),
        "healed": healed,
        "skipped": skipped,
    }
