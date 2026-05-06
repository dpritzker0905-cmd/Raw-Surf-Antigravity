from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, date, timedelta, timezone
import math

from database import get_db
from models import Profile, SurfSpot, CheckIn, UserStreak

router = APIRouter()

class CheckInRequest(BaseModel):
    spot_id: Optional[str] = None
    spot_name: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    notes: Optional[str] = None
    conditions: Optional[str] = None
    wave_height: Optional[str] = None
    use_gps: bool = False

class CheckInResponse(BaseModel):
    id: str
    spot_name: Optional[str]
    conditions: Optional[str]
    wave_height: Optional[str]
    created_at: datetime
    current_streak: int
    longest_streak: int
    total_check_ins: int

class StreakResponse(BaseModel):
    current_streak: int
    longest_streak: int
    total_check_ins: int
    last_check_in_date: Optional[str]
    checked_in_today: bool

@router.post("/check-in", response_model=CheckInResponse)
async def create_check_in(user_id: str, data: CheckInRequest, db: AsyncSession = Depends(get_db)):
    user_result = await db.execute(select(Profile).where(Profile.id == user_id))
    user = user_result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    today = date.today()
    
    today_start = datetime.combine(today, datetime.min.time()).replace(tzinfo=timezone.utc)
    today_end = datetime.combine(today, datetime.max.time()).replace(tzinfo=timezone.utc)
    
    existing_result = await db.execute(
        select(CheckIn).where(
            CheckIn.user_id == user_id,
            CheckIn.created_at >= today_start,
            CheckIn.created_at <= today_end
        )
    )
    if existing_result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Already checked in today")
    
    spot_name = data.spot_name
    spot_id = data.spot_id
    
    if data.use_gps and data.latitude and data.longitude:
        spots_result = await db.execute(select(SurfSpot))
        spots = spots_result.scalars().all()
        
        nearest_spot = None
        min_distance = float('inf')
        
        for spot in spots:
            lat1, lon1 = math.radians(data.latitude), math.radians(data.longitude)
            lat2, lon2 = math.radians(spot.latitude), math.radians(spot.longitude)
            dlat, dlon = lat2 - lat1, lon2 - lon1
            a = math.sin(dlat/2)**2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon/2)**2
            c = 2 * math.asin(math.sqrt(a))
            distance = 6371 * c
            
            if distance < min_distance:
                min_distance = distance
                nearest_spot = spot
        
        if nearest_spot and min_distance < 10:
            spot_id = nearest_spot.id
            spot_name = nearest_spot.name
    
    if spot_id and not spot_name:
        spot_result = await db.execute(select(SurfSpot).where(SurfSpot.id == spot_id))
        spot = spot_result.scalar_one_or_none()
        if spot:
            spot_name = spot.name
    
    check_in = CheckIn(
        user_id=user_id,
        spot_id=spot_id,
        spot_name=spot_name or "Custom Location",
        latitude=data.latitude,
        longitude=data.longitude,
        notes=data.notes,
        conditions=data.conditions,
        wave_height=data.wave_height
    )
    db.add(check_in)
    
    streak_result = await db.execute(select(UserStreak).where(UserStreak.user_id == user_id))
    streak = streak_result.scalar_one_or_none()
    
    if not streak:
        streak = UserStreak(user_id=user_id, current_streak=0, longest_streak=0, total_check_ins=0)
        db.add(streak)
    
    yesterday = today - timedelta(days=1)
    
    if streak.last_check_in_date:
        last_date = streak.last_check_in_date.date() if isinstance(streak.last_check_in_date, datetime) else streak.last_check_in_date
        if last_date == yesterday:
            streak.current_streak += 1
        elif last_date < yesterday:
            streak.current_streak = 1
    else:
        streak.current_streak = 1
    
    streak.total_check_ins += 1
    streak.last_check_in_date = datetime.combine(today, datetime.min.time()).replace(tzinfo=timezone.utc)
    
    if streak.current_streak > streak.longest_streak:
        streak.longest_streak = streak.current_streak
    
    await db.commit()
    await db.refresh(check_in)
    
    return CheckInResponse(
        id=check_in.id,
        spot_name=check_in.spot_name,
        conditions=check_in.conditions,
        wave_height=check_in.wave_height,
        created_at=check_in.created_at,
        current_streak=streak.current_streak,
        longest_streak=streak.longest_streak,
        total_check_ins=streak.total_check_ins
    )

@router.get("/streak/{user_id}", response_model=StreakResponse)
async def get_user_streak(user_id: str, db: AsyncSession = Depends(get_db)):
    streak_result = await db.execute(select(UserStreak).where(UserStreak.user_id == user_id))
    streak = streak_result.scalar_one_or_none()
    
    if not streak:
        return StreakResponse(
            current_streak=0,
            longest_streak=0,
            total_check_ins=0,
            last_check_in_date=None,
            checked_in_today=False
        )
    
    today = date.today()
    checked_in_today = False
    
    if streak.last_check_in_date:
        last_date = streak.last_check_in_date.date() if isinstance(streak.last_check_in_date, datetime) else streak.last_check_in_date
        checked_in_today = last_date == today
    
    return StreakResponse(
        current_streak=streak.current_streak,
        longest_streak=streak.longest_streak,
        total_check_ins=streak.total_check_ins,
        last_check_in_date=streak.last_check_in_date.isoformat() if streak.last_check_in_date else None,
        checked_in_today=checked_in_today
    )

@router.get("/check-ins/{user_id}")
async def get_user_check_ins(user_id: str, limit: int = 20, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(CheckIn)
        .where(CheckIn.user_id == user_id)
        .order_by(CheckIn.created_at.desc())
        .limit(limit)
    )
    check_ins = result.scalars().all()
    
    return [{
        "id": c.id,
        "spot_id": c.spot_id,
        "spot_name": c.spot_name,
        "conditions": c.conditions,
        "wave_height": c.wave_height,
        "notes": c.notes,
        "created_at": c.created_at.isoformat()
    } for c in check_ins]
