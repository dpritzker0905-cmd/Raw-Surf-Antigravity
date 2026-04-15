"""
Surfboard Collection Routes
- CRUD operations for user's surfboard quiver
- Photo management
- Future: Marketplace integration
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload
from typing import List, Optional
from pydantic import BaseModel, Field
from datetime import datetime, timezone

from database import get_db
from models import Surfboard, Profile

router = APIRouter(prefix="/surfboards", tags=["surfboards"])


# ============ PYDANTIC MODELS ============

class SurfboardCreate(BaseModel):
    name: Optional[str] = None
    brand: Optional[str] = None
    model: Optional[str] = None
    length_feet: Optional[int] = None
    length_inches: Optional[int] = None
    width_inches: Optional[float] = None
    thickness_inches: Optional[float] = None
    volume_liters: Optional[float] = None
    board_type: Optional[str] = None
    fin_setup: Optional[str] = None
    tail_shape: Optional[str] = None
    construction: Optional[str] = None
    description: Optional[str] = None
    condition: Optional[str] = None
    year_acquired: Optional[int] = None
    purchase_price: Optional[float] = None
    photo_urls: Optional[List[str]] = []
    primary_photo_index: Optional[int] = 0


class SurfboardUpdate(BaseModel):
    name: Optional[str] = None
    brand: Optional[str] = None
    model: Optional[str] = None
    length_feet: Optional[int] = None
    length_inches: Optional[int] = None
    width_inches: Optional[float] = None
    thickness_inches: Optional[float] = None
    volume_liters: Optional[float] = None
    board_type: Optional[str] = None
    fin_setup: Optional[str] = None
    tail_shape: Optional[str] = None
    construction: Optional[str] = None
    description: Optional[str] = None
    condition: Optional[str] = None
    year_acquired: Optional[int] = None
    purchase_price: Optional[float] = None
    photo_urls: Optional[List[str]] = None
    primary_photo_index: Optional[int] = None


class SurfboardResponse(BaseModel):
    id: str
    user_id: str
    name: Optional[str]
    brand: Optional[str]
    model: Optional[str]
    length_feet: Optional[int]
    length_inches: Optional[int]
    width_inches: Optional[float]
    thickness_inches: Optional[float]
    volume_liters: Optional[float]
    board_type: Optional[str]
    fin_setup: Optional[str]
    tail_shape: Optional[str]
    construction: Optional[str]
    description: Optional[str]
    condition: Optional[str]
    year_acquired: Optional[int]
    photo_urls: List[str]
    primary_photo_index: int
    is_for_sale: bool
    sale_price: Optional[float]
    sale_status: str
    created_at: datetime
    updated_at: datetime
    
    # Computed display string
    dimensions_display: Optional[str] = None
    
    class Config:
        from_attributes = True


def format_dimensions(board: Surfboard) -> Optional[str]:
    """Format board dimensions as display string"""
    if not board.length_feet:
        return None
    
    parts = []
    # Length
    if board.length_feet:
        length_str = f"{board.length_feet}'"
        if board.length_inches:
            length_str += f'{board.length_inches}"'
        parts.append(length_str)
    
    # Width
    if board.width_inches:
        parts.append(f'{board.width_inches}"')
    
    # Thickness
    if board.thickness_inches:
        parts.append(f'{board.thickness_inches}"')
    
    # Volume
    if board.volume_liters:
        parts.append(f'{board.volume_liters}L')
    
    return ' x '.join(parts) if parts else None


def surfboard_to_response(board: Surfboard) -> dict:
    """Convert Surfboard model to response dict"""
    return {
        "id": board.id,
        "user_id": board.user_id,
        "name": board.name,
        "brand": board.brand,
        "model": board.model,
        "length_feet": board.length_feet,
        "length_inches": board.length_inches,
        "width_inches": board.width_inches,
        "thickness_inches": board.thickness_inches,
        "volume_liters": board.volume_liters,
        "board_type": board.board_type,
        "fin_setup": board.fin_setup,
        "tail_shape": board.tail_shape,
        "construction": board.construction,
        "description": board.description,
        "condition": board.condition,
        "year_acquired": board.year_acquired,
        "photo_urls": board.photo_urls or [],
        "primary_photo_index": board.primary_photo_index or 0,
        "is_for_sale": board.is_for_sale or False,
        "sale_price": board.sale_price,
        "sale_status": board.sale_status or "not_listed",
        "created_at": board.created_at,
        "updated_at": board.updated_at,
        "dimensions_display": format_dimensions(board)
    }


# ============ ROUTES ============

@router.get("/user/{user_id}")
async def get_user_surfboards(
    user_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get all surfboards for a user (their quiver)"""
    result = await db.execute(
        select(Surfboard)
        .where(Surfboard.user_id == user_id)
        .order_by(Surfboard.created_at.desc())
    )
    boards = result.scalars().all()
    
    return {
        "boards": [surfboard_to_response(b) for b in boards],
        "count": len(boards)
    }


@router.get("/{board_id}")
async def get_surfboard(
    board_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get a specific surfboard by ID"""
    result = await db.execute(
        select(Surfboard).where(Surfboard.id == board_id)
    )
    board = result.scalar_one_or_none()
    
    if not board:
        raise HTTPException(status_code=404, detail="Surfboard not found")
    
    return surfboard_to_response(board)


@router.post("/")
async def create_surfboard(
    user_id: str = Query(..., description="User ID who owns the board"),
    data: SurfboardCreate = None,
    db: AsyncSession = Depends(get_db)
):
    """Add a new surfboard to user's quiver"""
    # Verify user exists
    user_result = await db.execute(
        select(Profile).where(Profile.id == user_id)
    )
    if not user_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="User not found")
    
    # Create surfboard
    board = Surfboard(
        user_id=user_id,
        name=data.name if data else None,
        brand=data.brand if data else None,
        model=data.model if data else None,
        length_feet=data.length_feet if data else None,
        length_inches=data.length_inches if data else None,
        width_inches=data.width_inches if data else None,
        thickness_inches=data.thickness_inches if data else None,
        volume_liters=data.volume_liters if data else None,
        board_type=data.board_type if data else None,
        fin_setup=data.fin_setup if data else None,
        tail_shape=data.tail_shape if data else None,
        construction=data.construction if data else None,
        description=data.description if data else None,
        condition=data.condition if data else None,
        year_acquired=data.year_acquired if data else None,
        purchase_price=data.purchase_price if data else None,
        photo_urls=data.photo_urls if data else [],
        primary_photo_index=data.primary_photo_index if data else 0
    )
    
    db.add(board)
    await db.commit()
    await db.refresh(board)
    
    return surfboard_to_response(board)


@router.patch("/{board_id}")
async def update_surfboard(
    board_id: str,
    data: SurfboardUpdate,
    user_id: str = Query(..., description="User ID for ownership verification"),
    db: AsyncSession = Depends(get_db)
):
    """Update a surfboard"""
    result = await db.execute(
        select(Surfboard).where(Surfboard.id == board_id)
    )
    board = result.scalar_one_or_none()
    
    if not board:
        raise HTTPException(status_code=404, detail="Surfboard not found")
    
    if board.user_id != user_id:
        raise HTTPException(status_code=403, detail="Not authorized to edit this surfboard")
    
    # Update fields
    update_data = data.dict(exclude_unset=True)
    for key, value in update_data.items():
        if value is not None:
            setattr(board, key, value)
    
    board.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(board)
    
    return surfboard_to_response(board)


@router.delete("/{board_id}")
async def delete_surfboard(
    board_id: str,
    user_id: str = Query(..., description="User ID for ownership verification"),
    db: AsyncSession = Depends(get_db)
):
    """Delete a surfboard from quiver"""
    result = await db.execute(
        select(Surfboard).where(Surfboard.id == board_id)
    )
    board = result.scalar_one_or_none()
    
    if not board:
        raise HTTPException(status_code=404, detail="Surfboard not found")
    
    if board.user_id != user_id:
        raise HTTPException(status_code=403, detail="Not authorized to delete this surfboard")
    
    await db.delete(board)
    await db.commit()
    
    return {"success": True, "message": "Surfboard deleted"}


@router.post("/{board_id}/photos")
async def add_surfboard_photo(
    board_id: str,
    photo_url: str = Query(..., description="URL of the uploaded photo"),
    user_id: str = Query(..., description="User ID for ownership verification"),
    db: AsyncSession = Depends(get_db)
):
    """Add a photo to a surfboard (max 5)"""
    result = await db.execute(
        select(Surfboard).where(Surfboard.id == board_id)
    )
    board = result.scalar_one_or_none()
    
    if not board:
        raise HTTPException(status_code=404, detail="Surfboard not found")
    
    if board.user_id != user_id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    photos = board.photo_urls or []
    if len(photos) >= 5:
        raise HTTPException(status_code=400, detail="Maximum 5 photos allowed per surfboard")
    
    photos.append(photo_url)
    board.photo_urls = photos
    board.updated_at = datetime.now(timezone.utc)
    
    await db.commit()
    await db.refresh(board)
    
    return surfboard_to_response(board)


@router.delete("/{board_id}/photos/{photo_index}")
async def remove_surfboard_photo(
    board_id: str,
    photo_index: int,
    user_id: str = Query(..., description="User ID for ownership verification"),
    db: AsyncSession = Depends(get_db)
):
    """Remove a photo from a surfboard"""
    result = await db.execute(
        select(Surfboard).where(Surfboard.id == board_id)
    )
    board = result.scalar_one_or_none()
    
    if not board:
        raise HTTPException(status_code=404, detail="Surfboard not found")
    
    if board.user_id != user_id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    photos = board.photo_urls or []
    if photo_index < 0 or photo_index >= len(photos):
        raise HTTPException(status_code=400, detail="Invalid photo index")
    
    photos.pop(photo_index)
    board.photo_urls = photos
    
    # Adjust primary photo index if needed
    if board.primary_photo_index >= len(photos):
        board.primary_photo_index = max(0, len(photos) - 1)
    
    board.updated_at = datetime.now(timezone.utc)
    
    await db.commit()
    await db.refresh(board)
    
    return surfboard_to_response(board)


@router.get("/stats/{user_id}")
async def get_surfboard_stats(
    user_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get surfboard collection statistics for a user"""
    result = await db.execute(
        select(Surfboard)
        .where(Surfboard.user_id == user_id)
    )
    boards = result.scalars().all()
    
    # Calculate stats
    total_boards = len(boards)
    board_types = {}
    brands = {}
    
    for board in boards:
        if board.board_type:
            board_types[board.board_type] = board_types.get(board.board_type, 0) + 1
        if board.brand:
            brands[board.brand] = brands.get(board.brand, 0) + 1
    
    return {
        "total_boards": total_boards,
        "board_types": board_types,
        "brands": brands,
        "for_sale_count": sum(1 for b in boards if b.is_for_sale)
    }
