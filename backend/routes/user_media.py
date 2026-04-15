"""
User Media Routes - for user's personal gallery
Separate from photographer galleries (professional content)
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime

from database import get_db
from models import Profile, UserMedia, GalleryItem, GalleryPurchase

router = APIRouter()


class UserMediaCreate(BaseModel):
    media_url: str
    media_type: str = 'image'
    thumbnail_url: Optional[str] = None
    title: Optional[str] = None
    description: Optional[str] = None
    # Video metadata
    video_width: Optional[int] = None
    video_height: Optional[int] = None
    video_duration: Optional[float] = None
    was_transcoded: Optional[bool] = False


class UserMediaResponse(BaseModel):
    id: str
    user_id: str
    media_url: str
    media_type: str
    thumbnail_url: Optional[str]
    source_type: str  # 'user_upload' or 'photographer_transfer'
    source_photographer_name: Optional[str]
    title: Optional[str]
    description: Optional[str]
    video_width: Optional[int]
    video_height: Optional[int]
    video_duration: Optional[float]
    was_transcoded: bool
    original_width: Optional[int]  # For transferred content
    original_height: Optional[int]
    created_at: datetime


@router.post("/user-media/{user_id}")
async def create_user_media(
    user_id: str,
    data: UserMediaCreate,
    db: AsyncSession = Depends(get_db)
):
    """Add media to user's personal gallery (user uploads, capped at 1080p)"""
    # Verify user exists
    result = await db.execute(select(Profile).where(Profile.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    media = UserMedia(
        user_id=user_id,
        media_url=data.media_url,
        media_type=data.media_type,
        thumbnail_url=data.thumbnail_url,
        source_type='user_upload',
        title=data.title,
        description=data.description,
        video_width=data.video_width,
        video_height=data.video_height,
        video_duration=data.video_duration,
        was_transcoded=data.was_transcoded or False
    )
    
    db.add(media)
    await db.commit()
    await db.refresh(media)
    
    return {
        "id": media.id,
        "media_url": media.media_url,
        "media_type": media.media_type,
        "source_type": media.source_type,
        "message": "Media added to your gallery"
    }


@router.get("/user-media/{user_id}", response_model=List[UserMediaResponse])
async def get_user_media(
    user_id: str,
    source_type: Optional[str] = None,  # Filter by 'user_upload' or 'photographer_transfer'
    limit: int = 50,
    offset: int = 0,
    db: AsyncSession = Depends(get_db)
):
    """Get user's personal media gallery"""
    query = select(UserMedia).where(UserMedia.user_id == user_id)
    
    if source_type:
        query = query.where(UserMedia.source_type == source_type)
    
    query = (
        query
        .options(selectinload(UserMedia.source_photographer))
        .order_by(UserMedia.created_at.desc())
        .offset(offset)
        .limit(limit)
    )
    
    result = await db.execute(query)
    media_items = result.scalars().all()
    
    return [UserMediaResponse(
        id=m.id,
        user_id=m.user_id,
        media_url=m.media_url,
        media_type=m.media_type,
        thumbnail_url=m.thumbnail_url,
        source_type=m.source_type,
        source_photographer_name=m.source_photographer.full_name if m.source_photographer else None,
        title=m.title,
        description=m.description,
        video_width=m.video_width,
        video_height=m.video_height,
        video_duration=m.video_duration,
        was_transcoded=m.was_transcoded or False,
        original_width=m.original_width,
        original_height=m.original_height,
        created_at=m.created_at
    ) for m in media_items]


@router.get("/user-media/{user_id}/uploads")
async def get_user_uploads(
    user_id: str,
    limit: int = 50,
    db: AsyncSession = Depends(get_db)
):
    """Get only user's own uploads (not transferred content)"""
    result = await db.execute(
        select(UserMedia)
        .where(UserMedia.user_id == user_id)
        .where(UserMedia.source_type == 'user_upload')
        .order_by(UserMedia.created_at.desc())
        .limit(limit)
    )
    media_items = result.scalars().all()
    
    return [{
        "id": m.id,
        "media_url": m.media_url,
        "media_type": m.media_type,
        "title": m.title,
        "video_width": m.video_width,
        "video_height": m.video_height,
        "created_at": m.created_at.isoformat()
    } for m in media_items]


@router.get("/user-media/{user_id}/purchased")
async def get_user_purchased_media(
    user_id: str,
    limit: int = 50,
    db: AsyncSession = Depends(get_db)
):
    """Get media transferred from photographers (purchased content - preserves 4K)"""
    result = await db.execute(
        select(UserMedia)
        .where(UserMedia.user_id == user_id)
        .where(UserMedia.source_type == 'photographer_transfer')
        .options(selectinload(UserMedia.source_photographer))
        .order_by(UserMedia.created_at.desc())
        .limit(limit)
    )
    media_items = result.scalars().all()
    
    return [{
        "id": m.id,
        "media_url": m.media_url,
        "media_type": m.media_type,
        "title": m.title,
        "photographer_name": m.source_photographer.full_name if m.source_photographer else None,
        "original_width": m.original_width,  # Preserves 4K resolution
        "original_height": m.original_height,
        "created_at": m.created_at.isoformat()
    } for m in media_items]


@router.delete("/user-media/{user_id}/{media_id}")
async def delete_user_media(
    user_id: str,
    media_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Delete media from user's gallery"""
    result = await db.execute(
        select(UserMedia)
        .where(UserMedia.id == media_id)
        .where(UserMedia.user_id == user_id)
    )
    media = result.scalar_one_or_none()
    
    if not media:
        raise HTTPException(status_code=404, detail="Media not found")
    
    await db.delete(media)
    await db.commit()
    
    return {"message": "Media deleted"}


# When a user purchases from photographer gallery, transfer to their collection
@router.post("/user-media/{user_id}/transfer-from-purchase")
async def transfer_purchased_media(
    user_id: str,
    gallery_item_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Transfer purchased gallery item to user's personal collection
    Preserves original 4K resolution from photographer
    """
    # Verify purchase exists
    purchase_result = await db.execute(
        select(GalleryPurchase)
        .where(GalleryPurchase.buyer_id == user_id)
        .where(GalleryPurchase.gallery_item_id == gallery_item_id)
    )
    purchase = purchase_result.scalar_one_or_none()
    
    if not purchase:
        raise HTTPException(status_code=403, detail="Item not purchased")
    
    # Check if already transferred
    existing = await db.execute(
        select(UserMedia)
        .where(UserMedia.user_id == user_id)
        .where(UserMedia.source_gallery_item_id == gallery_item_id)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Already in your gallery")
    
    # Get gallery item
    item_result = await db.execute(
        select(GalleryItem)
        .where(GalleryItem.id == gallery_item_id)
    )
    item = item_result.scalar_one_or_none()
    
    if not item:
        raise HTTPException(status_code=404, detail="Gallery item not found")
    
    # Create user media entry (preserves original 4K resolution)
    user_media = UserMedia(
        user_id=user_id,
        media_url=item.original_url,  # Full resolution
        media_type=item.media_type or 'image',
        source_type='photographer_transfer',
        source_photographer_id=item.photographer_id,
        source_gallery_item_id=item.id,
        title=item.title,
        description=item.description,
        # Preserve original resolution (4K from photographer)
        original_width=item.video_width,
        original_height=item.video_height,
        video_width=item.video_width,
        video_height=item.video_height,
        video_duration=item.video_duration,
        was_transcoded=False  # Not transcoded - keeps original quality
    )
    
    db.add(user_media)
    await db.commit()
    await db.refresh(user_media)
    
    return {
        "id": user_media.id,
        "media_url": user_media.media_url,
        "message": "Added to your gallery in original quality"
    }
