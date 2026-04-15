"""
Saved Crew Presets API
Quick-start feature for Pro/Comp surfers to save and auto-load default crews
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone
import logging

from database import get_db
from models import Profile, SavedCrew

router = APIRouter()
logger = logging.getLogger(__name__)


class CrewMember(BaseModel):
    user_id: Optional[str] = None
    name: str
    email: Optional[str] = None
    username: Optional[str] = None
    avatar_url: Optional[str] = None


class CreateSavedCrewRequest(BaseModel):
    name: str
    members: List[CrewMember]
    is_default: bool = False


class UpdateSavedCrewRequest(BaseModel):
    name: Optional[str] = None
    members: Optional[List[CrewMember]] = None
    is_default: Optional[bool] = None


@router.get("/crews/saved")
async def get_saved_crews(
    user_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get all saved crew presets for a user"""
    result = await db.execute(
        select(SavedCrew)
        .where(SavedCrew.owner_id == user_id)
        .order_by(SavedCrew.is_default.desc(), SavedCrew.times_used.desc())
    )
    crews = result.scalars().all()
    
    return {
        "crews": [
            {
                "id": c.id,
                "name": c.name,
                "is_default": c.is_default,
                "members": c.members or [],
                "member_count": len(c.members) if c.members else 0,
                "times_used": c.times_used,
                "last_used_at": c.last_used_at.isoformat() if c.last_used_at else None,
                "created_at": c.created_at.isoformat() if c.created_at else None
            }
            for c in crews
        ],
        "total": len(crews)
    }


@router.get("/crews/saved/default")
async def get_default_crew(
    user_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get the user's default crew preset (for quick On-Demand sessions)"""
    result = await db.execute(
        select(SavedCrew)
        .where(SavedCrew.owner_id == user_id, SavedCrew.is_default == True)
        .limit(1)
    )
    crew = result.scalar_one_or_none()
    
    if not crew:
        return {"default_crew": None}
    
    return {
        "default_crew": {
            "id": crew.id,
            "name": crew.name,
            "members": crew.members or [],
            "member_count": len(crew.members) if crew.members else 0
        }
    }


@router.post("/crews/saved")
async def create_saved_crew(
    user_id: str,
    data: CreateSavedCrewRequest,
    db: AsyncSession = Depends(get_db)
):
    """Create a new saved crew preset"""
    # Verify user exists
    user_result = await db.execute(select(Profile).where(Profile.id == user_id))
    user = user_result.scalar_one_or_none()
    
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # If setting as default, unset other defaults
    if data.is_default:
        await db.execute(
            update(SavedCrew)
            .where(SavedCrew.owner_id == user_id)
            .values(is_default=False)
        )
    
    # Create new saved crew
    members_data = [m.dict() for m in data.members]
    
    new_crew = SavedCrew(
        owner_id=user_id,
        name=data.name,
        members=members_data,
        is_default=data.is_default,
        times_used=0,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc)
    )
    
    db.add(new_crew)
    await db.commit()
    await db.refresh(new_crew)
    
    logger.info(f"Created saved crew '{data.name}' for user {user_id}")
    
    return {
        "success": True,
        "crew": {
            "id": new_crew.id,
            "name": new_crew.name,
            "is_default": new_crew.is_default,
            "members": new_crew.members,
            "member_count": len(new_crew.members)
        }
    }


@router.put("/crews/saved/{crew_id}")
async def update_saved_crew(
    crew_id: str,
    user_id: str,
    data: UpdateSavedCrewRequest,
    db: AsyncSession = Depends(get_db)
):
    """Update a saved crew preset"""
    result = await db.execute(
        select(SavedCrew).where(SavedCrew.id == crew_id, SavedCrew.owner_id == user_id)
    )
    crew = result.scalar_one_or_none()
    
    if not crew:
        raise HTTPException(status_code=404, detail="Saved crew not found")
    
    # If setting as default, unset other defaults
    if data.is_default:
        await db.execute(
            update(SavedCrew)
            .where(SavedCrew.owner_id == user_id, SavedCrew.id != crew_id)
            .values(is_default=False)
        )
    
    # Update fields
    if data.name is not None:
        crew.name = data.name
    if data.members is not None:
        crew.members = [m.dict() for m in data.members]
    if data.is_default is not None:
        crew.is_default = data.is_default
    
    crew.updated_at = datetime.now(timezone.utc)
    
    await db.commit()
    
    return {
        "success": True,
        "crew": {
            "id": crew.id,
            "name": crew.name,
            "is_default": crew.is_default,
            "members": crew.members,
            "member_count": len(crew.members) if crew.members else 0
        }
    }


@router.delete("/crews/saved/{crew_id}")
async def delete_saved_crew(
    crew_id: str,
    user_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Delete a saved crew preset"""
    result = await db.execute(
        select(SavedCrew).where(SavedCrew.id == crew_id, SavedCrew.owner_id == user_id)
    )
    crew = result.scalar_one_or_none()
    
    if not crew:
        raise HTTPException(status_code=404, detail="Saved crew not found")
    
    await db.delete(crew)
    await db.commit()
    
    return {"success": True, "message": "Saved crew deleted"}


@router.post("/crews/saved/{crew_id}/use")
async def mark_crew_used(
    crew_id: str,
    user_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Mark a saved crew as used (updates usage stats)"""
    result = await db.execute(
        select(SavedCrew).where(SavedCrew.id == crew_id, SavedCrew.owner_id == user_id)
    )
    crew = result.scalar_one_or_none()
    
    if not crew:
        raise HTTPException(status_code=404, detail="Saved crew not found")
    
    crew.times_used = (crew.times_used or 0) + 1
    crew.last_used_at = datetime.now(timezone.utc)
    
    await db.commit()
    
    return {
        "success": True,
        "times_used": crew.times_used
    }


@router.post("/crews/saved/{crew_id}/set-default")
async def set_default_crew(
    crew_id: str,
    user_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Set a saved crew as the default for On-Demand sessions"""
    result = await db.execute(
        select(SavedCrew).where(SavedCrew.id == crew_id, SavedCrew.owner_id == user_id)
    )
    crew = result.scalar_one_or_none()
    
    if not crew:
        raise HTTPException(status_code=404, detail="Saved crew not found")
    
    # Unset other defaults
    await db.execute(
        update(SavedCrew)
        .where(SavedCrew.owner_id == user_id)
        .values(is_default=False)
    )
    
    # Set this one as default
    crew.is_default = True
    
    await db.commit()
    
    return {
        "success": True,
        "message": f"'{crew.name}' is now your default crew",
        "default_crew_id": crew.id
    }
