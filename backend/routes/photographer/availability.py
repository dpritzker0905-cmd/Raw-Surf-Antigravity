"""
Photographer availability — calendar, weekly windows, block/unblock, and slot generation.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, delete
from sqlalchemy.orm import selectinload
from typing import Optional
from datetime import datetime, timezone
import logging

logger = logging.getLogger(__name__)

from database import get_db
from models import (
    Profile, Booking, PhotographerAvailability, RoleEnum
)
from .schemas import (
    CreateAvailabilityRequest, AvailabilityWindowUpdate,
    BlockDateRequest, is_photographer_role,
)
from datetime import date

router = APIRouter()


# ============ AVAILABILITY CALENDAR ENDPOINTS ============

@router.get("/photographer/{photographer_id}/bookings-calendar")
async def get_photographer_bookings_calendar(
    photographer_id: str,
    start: str,
    end: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Get photographer's bookings for calendar display.
    Also returns blocked dates and availability windows.
    """
    result = await db.execute(select(Profile).where(Profile.id == photographer_id))
    photographer = result.scalar_one_or_none()
    
    if not photographer:
        raise HTTPException(status_code=404, detail="Photographer not found")
    
    # Parse date range
    try:
        start_date = datetime.fromisoformat(start.replace('Z', '+00:00'))
        end_date = datetime.fromisoformat(end.replace('Z', '+00:00'))
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format")
    
    # Get bookings in range
    bookings_result = await db.execute(
        select(Booking)
        .where(
            and_(
                Booking.photographer_id == photographer_id,
                Booking.session_date >= start_date,
                Booking.session_date <= end_date,
                Booking.status.in_(['Pending', 'Confirmed', 'Completed'])
            )
        )
        .options(
            selectinload(Booking.creator),
            selectinload(Booking.participants)
        )
    )
    bookings = bookings_result.scalars().all()
    
    # Transform bookings for calendar
    calendar_bookings = []
    for b in bookings:
        confirmed_count = 0
        if b.participants:
            # Count all participants (pending + confirmed) as spots filled
            active_count = len([p for p in b.participants if p.status in ['pending', 'confirmed']])
        calendar_bookings.append({
            "id": b.id,
            "session_date": b.session_date.isoformat() if b.session_date else None,
            "status": b.status,
            "location": b.location,
            "duration": b.duration,
            "surfer_name": b.creator.full_name if b.creator else None,
            "current_participants": active_count
        })
    
    # Get availability windows (recurring schedule)
    availability_result = await db.execute(
        select(PhotographerAvailability)
        .where(
            and_(
                PhotographerAvailability.photographer_id == photographer_id,
                PhotographerAvailability.is_recurring == True
            )
        )
    )
    availability_records = availability_result.scalars().all()
    
    # Build weekly windows from DB or use defaults
    windows = []
    for day in range(7):
        day_record = next((a for a in availability_records if day in (a.recurring_days or [])), None)
        if day_record:
            windows.append({
                "day": day,
                "enabled": True,
                "start": day_record.start_time,
                "end": day_record.end_time
            })
        else:
            # Default: Mon-Sat 6am-6pm, Sunday off
            windows.append({
                "day": day,
                "enabled": day != 0,
                "start": "06:00",
                "end": "18:00"
            })
    
    # Get blocked dates
    blocked_result = await db.execute(
        select(PhotographerAvailability)
        .where(
            and_(
                PhotographerAvailability.photographer_id == photographer_id,
                PhotographerAvailability.is_recurring == False,
                PhotographerAvailability.date != None
            )
        )
    )
    blocked_records = blocked_result.scalars().all()
    blocked_dates = [str(b.date) for b in blocked_records if b.start_time == '00:00' and b.end_time == '00:00']
    
    return {
        "bookings": calendar_bookings,
        "availability_windows": windows,
        "blocked_dates": blocked_dates
    }


@router.put("/photographer/{photographer_id}/availability-windows")
async def update_availability_windows(
    photographer_id: str,
    data: AvailabilityWindowUpdate,
    db: AsyncSession = Depends(get_db)
):
    """Update photographer's weekly availability windows"""
    result = await db.execute(select(Profile).where(Profile.id == photographer_id))
    photographer = result.scalar_one_or_none()
    
    if not photographer:
        raise HTTPException(status_code=404, detail="Photographer not found")
    
    # Delete existing recurring availability
    await db.execute(
        select(PhotographerAvailability).where(
            and_(
                PhotographerAvailability.photographer_id == photographer_id,
                PhotographerAvailability.is_recurring == True
            )
        )
    )
    # Note: Actually delete them
    await db.execute(
        delete(PhotographerAvailability).where(
            and_(
                PhotographerAvailability.photographer_id == photographer_id,
                PhotographerAvailability.is_recurring == True
            )
        )
    )
    
    # Create new recurring availability for enabled days
    for window in data.windows:
        if window.get('enabled'):
            avail = PhotographerAvailability(
                photographer_id=photographer_id,
                is_recurring=True,
                recurring_days=[window['day']],
                start_time=window.get('start', '06:00'),
                end_time=window.get('end', '18:00'),
                time_preset='custom'
            )
            db.add(avail)
    
    await db.commit()
    
    return {"message": "Availability updated successfully"}


@router.post("/photographer/{photographer_id}/block-date")
async def block_date(
    photographer_id: str,
    data: BlockDateRequest,
    db: AsyncSession = Depends(get_db)
):
    """Block a specific date - surfers cannot book this day"""
    result = await db.execute(select(Profile).where(Profile.id == photographer_id))
    photographer = result.scalar_one_or_none()
    
    if not photographer:
        raise HTTPException(status_code=404, detail="Photographer not found")
    
    # Parse date
    try:
        block_date_val = datetime.strptime(data.date, '%Y-%m-%d').date()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD")
    
    # Check if already blocked
    existing = await db.execute(
        select(PhotographerAvailability).where(
            and_(
                PhotographerAvailability.photographer_id == photographer_id,
                PhotographerAvailability.date == block_date_val,
                PhotographerAvailability.is_recurring == False
            )
        )
    )
    if existing.scalar_one_or_none():
        return {"message": "Date already blocked"}
    
    # Create block record (start/end 00:00 indicates blocked)
    block = PhotographerAvailability(
        photographer_id=photographer_id,
        date=block_date_val,
        is_recurring=False,
        start_time='00:00',
        end_time='00:00',
        time_preset='blocked'
    )
    db.add(block)
    await db.commit()
    
    return {"message": f"Date {data.date} blocked successfully"}


@router.post("/photographer/{photographer_id}/unblock-date")
async def unblock_date(
    photographer_id: str,
    data: BlockDateRequest,
    db: AsyncSession = Depends(get_db)
):
    """Unblock a specific date"""
    result = await db.execute(select(Profile).where(Profile.id == photographer_id))
    photographer = result.scalar_one_or_none()
    
    if not photographer:
        raise HTTPException(status_code=404, detail="Photographer not found")
    
    # Parse date
    try:
        unblock_date_val = datetime.strptime(data.date, '%Y-%m-%d').date()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD")
    
    # Delete block record
    await db.execute(
        delete(PhotographerAvailability).where(
            and_(
                PhotographerAvailability.photographer_id == photographer_id,
                PhotographerAvailability.date == unblock_date_val,
                PhotographerAvailability.is_recurring == False
            )
        )
    )
    await db.commit()
    
    return {"message": f"Date {data.date} unblocked successfully"}


# ============ AVAILABILITY MANAGEMENT ============

@router.get("/photographer/{photographer_id}/availability")
async def get_photographer_availability(
    photographer_id: str,
    viewer_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """
    Get photographer's availability schedule
    
    Gold-Pass Logic:
    - tier_3 (Gold-Pass) users see ALL available slots
    - Non-Gold users see slots locked for 2 hours after creation (120 min time-gate)
    """
    from datetime import timedelta
    from routes.subscriptions_billing.subscriptions import GOLD_PASS_BOOKING_WINDOW_HOURS
    
    result = await db.execute(
        select(PhotographerAvailability).where(
            PhotographerAvailability.photographer_id == photographer_id
        ).order_by(PhotographerAvailability.created_at.desc())
    )
    availability = result.scalars().all()
    
    # Check viewer's subscription tier for Gold-Pass
    has_gold_pass = False
    if viewer_id:
        viewer_result = await db.execute(select(Profile).where(Profile.id == viewer_id))
        viewer = viewer_result.scalar_one_or_none()
        if viewer:
            # tier_3 = Premium with Gold-Pass
            has_gold_pass = viewer.subscription_tier == 'premium'
    
    now = datetime.now(timezone.utc)
    gold_pass_window = timedelta(hours=GOLD_PASS_BOOKING_WINDOW_HOURS)
    
    slots = []
    for a in availability:
        slot_data = {
            "id": a.id,
            "photographer_id": a.photographer_id,
            "date": a.date.isoformat() if a.date else None,
            "is_recurring": a.is_recurring,
            "recurring_days": a.recurring_days,
            "start_time": a.start_time,
            "end_time": a.end_time,
            "time_preset": a.time_preset,
            "created_at": a.created_at.isoformat() if a.created_at else None
        }
        
        # Gold-Pass time-gate logic
        if has_gold_pass:
            # Gold-Pass users see everything unlocked
            slot_data["is_locked"] = False
            slot_data["unlock_time"] = None
            slot_data["unlock_minutes_remaining"] = 0
        else:
            # Check if slot was created within the last 2 hours
            if a.created_at:
                time_since_creation = now - a.created_at.replace(tzinfo=timezone.utc)
                if time_since_creation < gold_pass_window:
                    # Slot is locked for non-Gold users
                    slot_data["is_locked"] = True
                    unlock_time = a.created_at + gold_pass_window
                    slot_data["unlock_time"] = unlock_time.isoformat()
                    remaining = (gold_pass_window - time_since_creation).total_seconds() / 60
                    slot_data["unlock_minutes_remaining"] = max(0, int(remaining))
                else:
                    slot_data["is_locked"] = False
                    slot_data["unlock_time"] = None
                    slot_data["unlock_minutes_remaining"] = 0
            else:
                slot_data["is_locked"] = False
                slot_data["unlock_time"] = None
                slot_data["unlock_minutes_remaining"] = 0
        
        slots.append(slot_data)
    
    return {
        "slots": slots,
        "viewer_has_gold_pass": has_gold_pass,
        "gold_pass_window_hours": GOLD_PASS_BOOKING_WINDOW_HOURS
    }


@router.post("/photographer/{photographer_id}/availability")
async def create_availability(
    photographer_id: str,
    data: CreateAvailabilityRequest,
    db: AsyncSession = Depends(get_db)
):
    """Create availability slots for photographer"""
    # Verify photographer
    result = await db.execute(select(Profile).where(Profile.id == photographer_id))
    photographer = result.scalar_one_or_none()
    if not photographer:
        raise HTTPException(status_code=404, detail="Photographer not found")
    
    if not is_photographer_role(photographer.role):
        raise HTTPException(status_code=403, detail="User is not a photographer")
    
    created_slots = []
    
    if data.is_recurring:
        # Create a single recurring availability
        availability = PhotographerAvailability(
            photographer_id=photographer_id,
            is_recurring=True,
            recurring_days=data.recurring_days,
            start_time=data.start_time,
            end_time=data.end_time,
            time_preset=data.time_preset
        )
        db.add(availability)
        created_slots.append(availability)
    else:
        # Create individual date slots
        from datetime import date as date_type
        for date_str in data.dates:
            try:
                parsed_date = date_type.fromisoformat(date_str.split('T')[0])
            except ValueError:
                continue
            
            availability = PhotographerAvailability(
                photographer_id=photographer_id,
                date=parsed_date,
                is_recurring=False,
                start_time=data.start_time,
                end_time=data.end_time,
                time_preset=data.time_preset
            )
            db.add(availability)
            created_slots.append(availability)
    
    await db.commit()
    
    return {
        "message": f"Created {len(created_slots)} availability slot(s)",
        "count": len(created_slots)
    }


@router.delete("/photographer/{photographer_id}/availability/{availability_id}")
async def delete_availability(
    photographer_id: str,
    availability_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Delete a specific availability slot"""
    result = await db.execute(
        select(PhotographerAvailability).where(
            PhotographerAvailability.id == availability_id,
            PhotographerAvailability.photographer_id == photographer_id
        )
    )
    availability = result.scalar_one_or_none()
    
    if not availability:
        raise HTTPException(status_code=404, detail="Availability not found")
    
    await db.delete(availability)
    await db.commit()
    
    return {"message": "Availability deleted"}


@router.get("/photographer/{photographer_id}/available-slots")
async def get_available_slots_for_surfer(
    photographer_id: str,
    date: str,
    db: AsyncSession = Depends(get_db)
):
    """Get available time slots for a specific date (used by surfers booking)
    
    Returns slots based on:
    1. Photographer's set availability (recurring or date-specific)
    2. Minus any already booked slots
    """
    from datetime import date as date_type
    
    try:
        target_date = date_type.fromisoformat(date)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD")
    
    day_of_week = target_date.weekday()  # 0=Monday
    # Convert to our format (0=Sunday)
    day_index = (day_of_week + 1) % 7
    
    # Get photographer's availability for this date - separate queries for date-specific and recurring
    date_specific_result = await db.execute(
        select(PhotographerAvailability).where(
            PhotographerAvailability.photographer_id == photographer_id,
            PhotographerAvailability.date == target_date
        )
    )
    
    recurring_result = await db.execute(
        select(PhotographerAvailability).where(
            PhotographerAvailability.photographer_id == photographer_id,
            PhotographerAvailability.is_recurring == True
        )
    )
    
    date_availabilities = date_specific_result.scalars().all()
    recurring_availabilities = recurring_result.scalars().all()
    
    # Filter recurring by day of week
    matching_recurring = [
        a for a in recurring_availabilities 
        if a.recurring_days and day_index in a.recurring_days
    ]
    
    availabilities = list(date_availabilities) + matching_recurring
    
    if not availabilities:
        return {"available_slots": [], "message": "No availability set for this date"}
    
    # Get already booked slots for this date
    start_of_day = datetime.combine(target_date, datetime.min.time())
    end_of_day = datetime.combine(target_date, datetime.max.time())
    
    booked_result = await db.execute(
        select(Booking).where(
            Booking.photographer_id == photographer_id,
            Booking.session_date >= start_of_day,
            Booking.session_date <= end_of_day,
            Booking.status.in_(['Pending', 'Confirmed'])
        )
    )
    booked = booked_result.scalars().all()
    booked_times = [b.session_date.strftime("%H:%M") for b in booked]
    
    # Generate available slots based on photographer's availability
    available_slots = []
    for avail in availabilities:
        start_hour, start_min = map(int, avail.start_time.split(':'))
        end_hour, end_min = map(int, avail.end_time.split(':'))
        
        current_hour = start_hour
        current_min = start_min
        
        while (current_hour < end_hour) or (current_hour == end_hour and current_min < end_min):
            time_str = f"{current_hour:02d}:{current_min:02d}"
            
            if time_str not in booked_times:
                time_label = datetime.strptime(time_str, "%H:%M").strftime("%I:%M %p").lstrip('0')
                available_slots.append({
                    "time": time_str,
                    "label": time_label,
                    "available": True
                })
            
            # Increment by 30 minutes
            current_min += 30
            if current_min >= 60:
                current_min = 0
                current_hour += 1
    
    # Remove duplicates and sort
    seen = set()
    unique_slots = []
    for slot in available_slots:
        if slot["time"] not in seen:
            seen.add(slot["time"])
            unique_slots.append(slot)
    
    unique_slots.sort(key=lambda x: x["time"])
    
    return {
        "available_slots": unique_slots,
        "date": date,
        "photographer_id": photographer_id
    }
