"""
Surf Log — Backpack Personal Session Journal
=============================================
CRUD endpoints for the user's personal surf log.
Sessions can be added manually or auto-created from completed bookings/dispatches.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, desc
from pydantic import BaseModel
from typing import Optional, List
from datetime import date, datetime, timezone

from database import get_db
from models import SurfLogEntry, SurfSpot, Profile

router = APIRouter()


# ──────────────────────────────────────
# Request / Response Schemas
# ──────────────────────────────────────

class SurfLogCreate(BaseModel):
    session_date: date
    session_time: Optional[str] = None
    duration_minutes: Optional[int] = None
    spot_id: Optional[str] = None
    spot_name: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None

    # Conditions
    wave_height: Optional[str] = None
    wind_direction: Optional[str] = None
    tide_status: Optional[str] = None
    water_temp: Optional[str] = None
    crowd_level: Optional[str] = None
    conditions_rating: Optional[int] = None

    # Gear
    board_model: Optional[str] = None
    wetsuit: Optional[str] = None
    fin_setup: Optional[str] = None

    # Personal
    notes: Optional[str] = None
    mood: Optional[str] = None
    personal_rating: Optional[int] = None
    photo_urls: Optional[List[str]] = None

    # Platform linkage
    booking_id: Optional[str] = None
    dispatch_id: Optional[str] = None
    live_session_id: Optional[str] = None
    gallery_id: Optional[str] = None
    source: Optional[str] = "manual"


class SurfLogUpdate(BaseModel):
    session_date: Optional[date] = None
    session_time: Optional[str] = None
    duration_minutes: Optional[int] = None
    spot_id: Optional[str] = None
    spot_name: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    wave_height: Optional[str] = None
    wind_direction: Optional[str] = None
    tide_status: Optional[str] = None
    water_temp: Optional[str] = None
    crowd_level: Optional[str] = None
    conditions_rating: Optional[int] = None
    board_model: Optional[str] = None
    wetsuit: Optional[str] = None
    fin_setup: Optional[str] = None
    notes: Optional[str] = None
    mood: Optional[str] = None
    personal_rating: Optional[int] = None
    photo_urls: Optional[List[str]] = None


def _entry_to_dict(entry: SurfLogEntry) -> dict:
    return {
        "id": entry.id,
        "user_id": entry.user_id,
        "session_date": entry.session_date.isoformat() if entry.session_date else None,
        "session_time": entry.session_time,
        "duration_minutes": entry.duration_minutes,
        "spot_id": entry.spot_id,
        "spot_name": entry.spot_name,
        "latitude": entry.latitude,
        "longitude": entry.longitude,
        "wave_height": entry.wave_height,
        "wind_direction": entry.wind_direction,
        "tide_status": entry.tide_status,
        "water_temp": entry.water_temp,
        "crowd_level": entry.crowd_level,
        "conditions_rating": entry.conditions_rating,
        "board_model": entry.board_model,
        "wetsuit": entry.wetsuit,
        "fin_setup": entry.fin_setup,
        "notes": entry.notes,
        "mood": entry.mood,
        "personal_rating": entry.personal_rating,
        "photo_urls": entry.photo_urls or [],
        "booking_id": entry.booking_id,
        "dispatch_id": entry.dispatch_id,
        "live_session_id": entry.live_session_id,
        "gallery_id": entry.gallery_id,
        "source": entry.source,
        "created_at": entry.created_at.isoformat() if entry.created_at else None,
        "updated_at": entry.updated_at.isoformat() if entry.updated_at else None,
    }


# ──────────────────────────────────────
# CREATE
# ──────────────────────────────────────

@router.post("/surf-log/{user_id}")
async def create_surf_log_entry(
    user_id: str,
    data: SurfLogCreate,
    db: AsyncSession = Depends(get_db)
):
    """Create a new surf log entry."""
    # Verify user
    user_result = await db.execute(select(Profile).where(Profile.id == user_id))
    if not user_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="User not found")

    # Auto-resolve spot name if spot_id provided
    spot_name = data.spot_name
    lat, lon = data.latitude, data.longitude
    if data.spot_id and not spot_name:
        spot_result = await db.execute(select(SurfSpot).where(SurfSpot.id == data.spot_id))
        spot = spot_result.scalar_one_or_none()
        if spot:
            spot_name = spot.name
            lat = lat or spot.latitude
            lon = lon or spot.longitude

    entry = SurfLogEntry(
        user_id=user_id,
        session_date=data.session_date,
        session_time=data.session_time,
        duration_minutes=data.duration_minutes,
        spot_id=data.spot_id,
        spot_name=spot_name,
        latitude=lat,
        longitude=lon,
        wave_height=data.wave_height,
        wind_direction=data.wind_direction,
        tide_status=data.tide_status,
        water_temp=data.water_temp,
        crowd_level=data.crowd_level,
        conditions_rating=data.conditions_rating,
        board_model=data.board_model,
        wetsuit=data.wetsuit,
        fin_setup=data.fin_setup,
        notes=data.notes,
        mood=data.mood,
        personal_rating=data.personal_rating,
        photo_urls=data.photo_urls,
        booking_id=data.booking_id,
        dispatch_id=data.dispatch_id,
        live_session_id=data.live_session_id,
        gallery_id=data.gallery_id,
        source=data.source or "manual",
    )
    db.add(entry)
    await db.commit()
    await db.refresh(entry)

    return {"success": True, "entry": _entry_to_dict(entry)}


# ──────────────────────────────────────
# READ — List / Single
# ──────────────────────────────────────

@router.get("/surf-log/{user_id}")
async def get_surf_log(
    user_id: str,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    year: Optional[int] = None,
    month: Optional[int] = None,
    spot_id: Optional[str] = None,
    mood: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """
    Get user's surf log entries with optional filters.
    Sorted newest → oldest.
    """
    query = (
        select(SurfLogEntry)
        .where(SurfLogEntry.user_id == user_id)
        .order_by(desc(SurfLogEntry.session_date))
    )

    if year:
        query = query.where(func.extract('year', SurfLogEntry.session_date) == year)
    if month:
        query = query.where(func.extract('month', SurfLogEntry.session_date) == month)
    if spot_id:
        query = query.where(SurfLogEntry.spot_id == spot_id)
    if mood:
        query = query.where(SurfLogEntry.mood == mood)

    query = query.offset(offset).limit(limit)
    result = await db.execute(query)
    entries = result.scalars().all()

    # Also get total count (for pagination)
    count_query = select(func.count(SurfLogEntry.id)).where(SurfLogEntry.user_id == user_id)
    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    return {
        "entries": [_entry_to_dict(e) for e in entries],
        "total": total,
        "offset": offset,
        "limit": limit,
    }


@router.get("/surf-log/{user_id}/{entry_id}")
async def get_surf_log_entry(
    user_id: str,
    entry_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get a single surf log entry."""
    result = await db.execute(
        select(SurfLogEntry).where(
            SurfLogEntry.id == entry_id,
            SurfLogEntry.user_id == user_id
        )
    )
    entry = result.scalar_one_or_none()
    if not entry:
        raise HTTPException(status_code=404, detail="Surf log entry not found")

    return {"entry": _entry_to_dict(entry)}


# ──────────────────────────────────────
# UPDATE
# ──────────────────────────────────────

@router.patch("/surf-log/{user_id}/{entry_id}")
async def update_surf_log_entry(
    user_id: str,
    entry_id: str,
    data: SurfLogUpdate,
    db: AsyncSession = Depends(get_db)
):
    """Update an existing surf log entry. Only provided fields are changed."""
    result = await db.execute(
        select(SurfLogEntry).where(
            SurfLogEntry.id == entry_id,
            SurfLogEntry.user_id == user_id
        )
    )
    entry = result.scalar_one_or_none()
    if not entry:
        raise HTTPException(status_code=404, detail="Surf log entry not found")

    update_fields = data.model_dump(exclude_unset=True)
    for field, value in update_fields.items():
        setattr(entry, field, value)

    await db.commit()
    await db.refresh(entry)

    return {"success": True, "entry": _entry_to_dict(entry)}


# ──────────────────────────────────────
# DELETE
# ──────────────────────────────────────

@router.delete("/surf-log/{user_id}/{entry_id}")
async def delete_surf_log_entry(
    user_id: str,
    entry_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Delete a surf log entry."""
    result = await db.execute(
        select(SurfLogEntry).where(
            SurfLogEntry.id == entry_id,
            SurfLogEntry.user_id == user_id
        )
    )
    entry = result.scalar_one_or_none()
    if not entry:
        raise HTTPException(status_code=404, detail="Surf log entry not found")

    await db.delete(entry)
    await db.commit()

    return {"success": True, "message": "Entry deleted"}


# ──────────────────────────────────────
# STATS — Surf Log Summary
# ──────────────────────────────────────

@router.get("/surf-log/{user_id}/stats")
async def get_surf_log_stats(
    user_id: str,
    year: Optional[int] = None,
    db: AsyncSession = Depends(get_db)
):
    """
    Get aggregated surf log stats for a user.
    Returns total sessions, hours in water, favourite spot, mood distribution, etc.
    """
    base = select(SurfLogEntry).where(SurfLogEntry.user_id == user_id)
    if year:
        base = base.where(func.extract('year', SurfLogEntry.session_date) == year)

    result = await db.execute(base)
    entries = result.scalars().all()

    if not entries:
        return {
            "total_sessions": 0,
            "total_hours": 0,
            "favourite_spot": None,
            "mood_breakdown": {},
            "avg_conditions_rating": None,
            "avg_personal_rating": None,
            "busiest_month": None,
        }

    total_minutes = sum(e.duration_minutes or 0 for e in entries)

    # Favourite spot (most visited)
    spot_counts = {}
    for e in entries:
        if e.spot_name:
            spot_counts[e.spot_name] = spot_counts.get(e.spot_name, 0) + 1
    favourite_spot = max(spot_counts, key=spot_counts.get) if spot_counts else None

    # Mood distribution
    mood_counts = {}
    for e in entries:
        if e.mood:
            mood_counts[e.mood] = mood_counts.get(e.mood, 0) + 1

    # Averages
    cond_ratings = [e.conditions_rating for e in entries if e.conditions_rating]
    perf_ratings = [e.personal_rating for e in entries if e.personal_rating]

    # Busiest month
    month_counts = {}
    for e in entries:
        if e.session_date:
            m = e.session_date.month
            month_counts[m] = month_counts.get(m, 0) + 1
    busiest_month = max(month_counts, key=month_counts.get) if month_counts else None

    return {
        "total_sessions": len(entries),
        "total_hours": round(total_minutes / 60, 1),
        "favourite_spot": favourite_spot,
        "favourite_spot_count": spot_counts.get(favourite_spot, 0) if favourite_spot else 0,
        "mood_breakdown": mood_counts,
        "avg_conditions_rating": round(sum(cond_ratings) / len(cond_ratings), 1) if cond_ratings else None,
        "avg_personal_rating": round(sum(perf_ratings) / len(perf_ratings), 1) if perf_ratings else None,
        "busiest_month": busiest_month,
        "gear_diversity": len(set(e.board_model for e in entries if e.board_model)),
    }
