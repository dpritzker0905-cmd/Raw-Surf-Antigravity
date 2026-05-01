"""
Photographer booking management — CRUD for scheduled bookings.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, func
from sqlalchemy.orm import selectinload
from typing import List, Optional
from datetime import datetime, timezone
import json
import logging

logger = logging.getLogger(__name__)

from database import get_db
from models import (
    Profile, Booking, BookingParticipant, Notification, RoleEnum
)
from .schemas import (
    CreateBookingRequest, UpdateBookingStatusRequest,
    UpdateBookingDetailsRequest, BookingResponse,
    generate_invite_code, is_photographer_role,
)

router = APIRouter()


# ============ BOOKING MANAGEMENT ============

@router.get("/photographer/{photographer_id}/bookings", response_model=List[BookingResponse])
async def get_photographer_bookings(
    photographer_id: str,
    status: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """Get all bookings for a photographer"""
    # Verify photographer exists and has photographer role
    photographer_result = await db.execute(
        select(Profile).where(Profile.id == photographer_id)
    )
    photographer = photographer_result.scalar_one_or_none()
    if not photographer:
        raise HTTPException(status_code=404, detail="Photographer not found")
    
    if not is_photographer_role(photographer.role):
        raise HTTPException(status_code=403, detail="User is not a photographer")
    
    # Build query
    query = select(Booking).where(Booking.photographer_id == photographer_id)
    
    if status:
        query = query.where(Booking.status == status)
    
    query = query.options(
        selectinload(Booking.participants).selectinload(BookingParticipant.participant),
        selectinload(Booking.creator)
    ).order_by(Booking.session_date.desc())
    
    result = await db.execute(query)
    bookings = result.scalars().all()
    
    response = []
    for booking in bookings:
        participants_data = []
        for p in booking.participants:
            participants_data.append({
                "id": p.id,
                "participant_id": p.participant_id,
                "name": p.participant.full_name if p.participant else None,
                "avatar_url": p.participant.avatar_url if p.participant else None,
                "status": p.status,
                "payment_status": p.payment_status,
                "paid_amount": p.paid_amount
            })
        
        response.append(BookingResponse(
            id=booking.id,
            photographer_id=booking.photographer_id,
            photographer_name=photographer.full_name,
            creator_id=booking.creator_id,
            creator_name=booking.creator.full_name if booking.creator else None,
            location=booking.location,
            session_date=booking.session_date,
            duration=booking.duration,
            max_participants=booking.max_participants,
            total_price=booking.total_price,
            price_per_person=booking.price_per_person,
            allow_splitting=booking.allow_splitting,
            split_mode=booking.split_mode,
            invite_code=booking.invite_code,
            status=booking.status,
            # Count all participants (pending + confirmed) as spots filled - captain counts even if not paid
            current_participants=len([p for p in booking.participants if p.status in ['pending', 'confirmed']]),
            participants=participants_data,
            description=booking.description,
            created_at=booking.created_at,
            # Lineup Manager fields
            lineup_status=booking.lineup_status or 'open',
            lineup_auto_confirm=booking.lineup_auto_confirm or False,
            proximity_radius=booking.proximity_radius or 5.0,
            lineup_closes_at=booking.lineup_closes_at,
            lineup_min_crew=booking.lineup_min_crew,
            lineup_max_crew=booking.lineup_max_crew or booking.max_participants,
            booking_type=booking.booking_type or 'scheduled'
        ))
    
    return response


@router.get("/photographer/{photographer_id}/booked-slots")
async def get_booked_slots(
    photographer_id: str,
    date: str,
    db: AsyncSession = Depends(get_db)
):
    """Get booked time slots for a specific date - used for calendar gray-out logic"""
    # Parse the date
    try:
        target_date = datetime.fromisoformat(date).date()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD")
    
    # Get all bookings for this photographer on this date
    start_of_day = datetime.combine(target_date, datetime.min.time())
    end_of_day = datetime.combine(target_date, datetime.max.time())
    
    result = await db.execute(
        select(Booking).where(
            Booking.photographer_id == photographer_id,
            Booking.session_date >= start_of_day,
            Booking.session_date <= end_of_day,
            Booking.status.in_(['Pending', 'Confirmed'])
        )
    )
    bookings = result.scalars().all()
    
    # Extract booked time slots
    booked_slots = []
    for booking in bookings:
        time_str = booking.session_date.strftime("%H:%M")
        booked_slots.append({
            "date": date,
            "time": time_str,
            "booking_id": booking.id,
            "duration": booking.duration
        })
    
    return booked_slots


@router.post("/photographer/{photographer_id}/bookings", response_model=BookingResponse)
async def create_booking(
    photographer_id: str,
    data: CreateBookingRequest,
    db: AsyncSession = Depends(get_db)
):
    """Create a new booking/session (photographer creating their own availability)"""
    # Verify photographer
    photographer_result = await db.execute(
        select(Profile).where(Profile.id == photographer_id)
    )
    photographer = photographer_result.scalar_one_or_none()
    if not photographer:
        raise HTTPException(status_code=404, detail="Photographer not found")
    
    if not is_photographer_role(photographer.role):
        raise HTTPException(status_code=403, detail="User is not a photographer")
    
    # Parse session date
    try:
        session_date = datetime.fromisoformat(data.session_date.replace('Z', '+00:00'))
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format")
    
    # Calculate total price
    total_price = data.price_per_person * data.max_participants
    
    # Generate invite code if splitting is allowed
    invite_code = None
    if data.allow_splitting:
        invite_code = generate_invite_code()
        # Ensure uniqueness
        while True:
            existing = await db.execute(
                select(Booking).where(Booking.invite_code == invite_code)
            )
            if not existing.scalar_one_or_none():
                break
            invite_code = generate_invite_code()
    
    booking = Booking(
        photographer_id=photographer_id,
        creator_id=photographer_id,  # Photographer is the creator
        surf_spot_id=data.surf_spot_id,
        location=data.location,
        latitude=data.latitude,
        longitude=data.longitude,
        session_date=session_date,
        duration=data.duration,
        max_participants=data.max_participants,
        total_price=total_price,
        price_per_person=data.price_per_person,
        allow_splitting=data.allow_splitting,
        split_mode=data.split_mode,
        invite_code=invite_code,
        proximity_radius=data.proximity_radius,
        skill_level_filter=data.skill_level_filter,
        description=data.description,
        status='Confirmed'  # Photographer-created sessions are auto-confirmed
    )
    
    db.add(booking)
    await db.commit()
    await db.refresh(booking)
    
    return BookingResponse(
        id=booking.id,
        photographer_id=booking.photographer_id,
        photographer_name=photographer.full_name,
        creator_id=booking.creator_id,
        creator_name=photographer.full_name,
        location=booking.location,
        session_date=booking.session_date,
        duration=booking.duration,
        max_participants=booking.max_participants,
        total_price=booking.total_price,
        price_per_person=booking.price_per_person,
        allow_splitting=booking.allow_splitting,
        split_mode=booking.split_mode,
        skill_level_filter=booking.skill_level_filter,
        invite_code=booking.invite_code,
        status=booking.status,
        current_participants=0,
        participants=[],
        description=booking.description,
        created_at=booking.created_at
    )


@router.patch("/bookings/{booking_id}/status")
async def update_booking_status(
    booking_id: str,
    data: UpdateBookingStatusRequest,
    db: AsyncSession = Depends(get_db)
):
    """Update booking status (confirm, cancel)"""
    result = await db.execute(
        select(Booking).where(Booking.id == booking_id)
        .options(selectinload(Booking.participants))
    )
    booking = result.scalar_one_or_none()
    
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    
    valid_statuses = ['Pending', 'Confirmed', 'Completed', 'Cancelled']
    if data.status not in valid_statuses:
        raise HTTPException(status_code=400, detail=f"Invalid status. Must be one of: {valid_statuses}")
    
    booking.status = data.status
    booking.updated_at = datetime.now(timezone.utc)
    
    # If cancelling, notify participants
    if data.status == 'Cancelled':
        for participant in booking.participants:
            notification = Notification(
                user_id=participant.participant_id,
                type='booking_cancelled',
                title='Booking Cancelled',
                body=f'The session at {booking.location} has been cancelled.',
                data=json.dumps({"booking_id": booking_id})
            )
            db.add(notification)
    
    await db.commit()
    
    return {"message": f"Booking {data.status.lower()}", "status": data.status}


@router.patch("/bookings/{booking_id}")
async def update_booking_details(
    booking_id: str,
    data: UpdateBookingDetailsRequest,
    db: AsyncSession = Depends(get_db)
):
    """Update booking details (location, date, duration, etc.)"""
    from routes.push import notify_booking
    
    result = await db.execute(
        select(Booking).where(Booking.id == booking_id)
        .options(
            selectinload(Booking.participants),
            selectinload(Booking.photographer),
            selectinload(Booking.creator)
        )
    )
    booking = result.scalar_one_or_none()
    
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    
    # Track what changed for notifications
    changes = []
    
    # Update fields if provided
    if data.location is not None and data.location != booking.location:
        changes.append(f"Location: {data.location}")
        booking.location = data.location
    
    if data.session_date is not None:
        try:
            new_date = datetime.fromisoformat(data.session_date.replace('Z', '+00:00'))
            if new_date != booking.session_date:
                changes.append(f"Date/Time: {new_date.strftime('%b %d at %I:%M %p')}")
                booking.session_date = new_date
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date format")
    
    if data.duration is not None and data.duration != booking.duration:
        changes.append(f"Duration: {data.duration} minutes")
        booking.duration = data.duration
    
    if data.max_participants is not None and data.max_participants != booking.max_participants:
        changes.append(f"Max participants: {data.max_participants}")
        booking.max_participants = data.max_participants
    
    if data.description is not None:
        booking.description = data.description
    
    booking.updated_at = datetime.now(timezone.utc)
    
    # Notify participants if there were changes
    if changes and booking.status == 'Confirmed':
        change_summary = ", ".join(changes)
        for participant in booking.participants:
            if participant.participant_id != booking.photographer_id:  # Don't notify the one who made changes
                notification = Notification(
                    user_id=participant.participant_id,
                    type='booking_updated',
                    title='Booking Updated',
                    body=f'Your session at {booking.location} has been updated: {change_summary}',
                    data=json.dumps({"booking_id": booking_id, "changes": changes})
                )
                db.add(notification)
                
                try:
                    await notify_booking(
                        user_id=participant.participant_id,
                        title='Booking Updated',
                        message=f'Session updated: {change_summary}',
                        db=db
                    )
                except Exception:
                    pass  # Push notifications are best-effort
        
        # Also notify the creator if not the photographer
        if booking.creator_id and booking.creator_id != booking.photographer_id:
            notification = Notification(
                user_id=booking.creator_id,
                type='booking_updated',
                title='Booking Updated',
                body=f'Your session at {booking.location} has been updated: {change_summary}',
                data=json.dumps({"booking_id": booking_id, "changes": changes})
            )
            db.add(notification)
    
    await db.commit()
    
    return {
        "message": "Booking updated successfully",
        "booking_id": booking_id,
        "changes": changes
    }


@router.get("/bookings/{booking_id}")
async def get_booking_details(
    booking_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get detailed booking information"""
    result = await db.execute(
        select(Booking).where(Booking.id == booking_id)
        .options(
            selectinload(Booking.photographer),
            selectinload(Booking.creator),
            selectinload(Booking.participants).selectinload(BookingParticipant.participant)
        )
    )
    booking = result.scalar_one_or_none()
    
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    
    participants_data = []
    for p in booking.participants:
        participants_data.append({
            "id": p.id,
            "participant_id": p.participant_id,
            "name": p.participant.full_name if p.participant else None,
            "avatar_url": p.participant.avatar_url if p.participant else None,
            "status": p.status,
            "payment_status": p.payment_status,
            "paid_amount": p.paid_amount,
            "invite_type": p.invite_type
        })
    
    return {
        "id": booking.id,
        "photographer_id": booking.photographer_id,
        "photographer_name": booking.photographer.full_name if booking.photographer else None,
        "photographer_avatar": booking.photographer.avatar_url if booking.photographer else None,
        "creator_id": booking.creator_id,
        "creator_name": booking.creator.full_name if booking.creator else None,
        "location": booking.location,
        "latitude": booking.latitude,
        "longitude": booking.longitude,
        "session_date": booking.session_date.isoformat(),
        "duration": booking.duration,
        "max_participants": booking.max_participants,
        "total_price": booking.total_price,
        "price_per_person": booking.price_per_person,
        "allow_splitting": booking.allow_splitting,
        "split_mode": booking.split_mode,
        "invite_code": booking.invite_code,
        "proximity_radius": booking.proximity_radius,
        "status": booking.status,
        "description": booking.description,
        # Count all participants (pending + confirmed) as spots filled - captain counts even if not paid
        "current_participants": len([p for p in booking.participants if p.status in ['pending', 'confirmed']]),
        "participants": participants_data,
        "created_at": booking.created_at.isoformat()
    }
