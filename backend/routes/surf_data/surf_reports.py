from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timezone
from collections import Counter

from database import get_db
from models import Profile, SurfSpot, SurfReport

router = APIRouter()

class SurfReportCreate(BaseModel):
    spot_id: str
    wave_height: Optional[str] = None
    conditions: Optional[str] = None
    wind_direction: Optional[str] = None
    crowd_level: Optional[str] = None
    water_temp: Optional[str] = None
    tide_height: Optional[str] = None
    tide_status: Optional[str] = None
    notes: Optional[str] = None
    rating: Optional[int] = None
    photo_url: Optional[str] = None

@router.post("/surf-reports")
async def create_surf_report(user_id: str, data: SurfReportCreate, db: AsyncSession = Depends(get_db)):
    user_result = await db.execute(select(Profile).where(Profile.id == user_id))
    user = user_result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    spot_result = await db.execute(select(SurfSpot).where(SurfSpot.id == data.spot_id))
    spot = spot_result.scalar_one_or_none()
    if not spot:
        raise HTTPException(status_code=404, detail="Spot not found")
    
    report = SurfReport(
        user_id=user_id,
        spot_id=data.spot_id,
        wave_height=data.wave_height,
        conditions=data.conditions,
        wind_direction=data.wind_direction,
        crowd_level=data.crowd_level,
        water_temp=data.water_temp,
        tide_height=data.tide_height,
        tide_status=data.tide_status,
        notes=data.notes,
        rating=data.rating,
        photo_url=data.photo_url
    )
    
    db.add(report)
    await db.commit()
    await db.refresh(report)
    
    return {
        "id": report.id,
        "spot_name": spot.name,
        "wave_height": report.wave_height,
        "conditions": report.conditions,
        "created_at": report.created_at.isoformat()
    }

@router.get("/surf-reports/spot/{spot_id}")
async def get_spot_reports(spot_id: str, limit: int = 10, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(SurfReport)
        .where(SurfReport.spot_id == spot_id)
        .options(selectinload(SurfReport.user))
        .order_by(SurfReport.created_at.desc())
        .limit(limit)
    )
    reports = result.scalars().all()
    
    return [{
        "id": r.id,
        "user_id": r.user_id,
        "user_name": r.user.full_name if r.user else None,
        "user_avatar": r.user.avatar_url if r.user else None,
        "wave_height": r.wave_height,
        "conditions": r.conditions,
        "wind_direction": r.wind_direction,
        "crowd_level": r.crowd_level,
        "water_temp": r.water_temp,
        "tide_height": r.tide_height,
        "tide_status": r.tide_status,
        "rating": r.rating,
        "notes": r.notes,
        "photo_url": r.photo_url,
        "created_at": r.created_at.isoformat()
    } for r in reports]

@router.get("/surf-reports/today/{spot_id}")
async def get_todays_reports(spot_id: str, db: AsyncSession = Depends(get_db)):
    today_start = datetime.combine(datetime.now().date(), datetime.min.time()).replace(tzinfo=timezone.utc)
    
    result = await db.execute(
        select(SurfReport)
        .where(SurfReport.spot_id == spot_id)
        .where(SurfReport.created_at >= today_start)
        .options(selectinload(SurfReport.user))
        .order_by(SurfReport.created_at.desc())
    )
    reports = result.scalars().all()
    
    conditions_list = [r.conditions for r in reports if r.conditions]
    crowd_list = [r.crowd_level for r in reports if r.crowd_level]
    ratings = [r.rating for r in reports if r.rating]
    
    consensus_conditions = Counter(conditions_list).most_common(1)[0][0] if conditions_list else None
    consensus_crowd = Counter(crowd_list).most_common(1)[0][0] if crowd_list else None
    average_rating = round(sum(ratings) / len(ratings), 1) if ratings else None
    
    return {
        "spot_id": spot_id,
        "report_count": len(reports),
        "consensus_conditions": consensus_conditions,
        "consensus_crowd": consensus_crowd,
        "average_rating": average_rating,
        "reports": [{
            "id": r.id,
            "user_name": r.user.full_name if r.user else None,
            "user_avatar": r.user.avatar_url if r.user else None,
            "wave_height": r.wave_height,
            "conditions": r.conditions,
            "crowd_level": r.crowd_level,
            "rating": r.rating,
            "notes": r.notes,
            "created_at": r.created_at.isoformat()
        } for r in reports]
    }
