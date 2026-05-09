"""
profiles/user_favorites.py — User favorites (bookmarked posts).
Extracted from profiles.py (v94 audit) for LOC compliance.
"""
import uuid
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from pydantic import BaseModel

from database import get_db
from models import Profile

router = APIRouter()


class FavoriteRequest(BaseModel):
    post_id: str


@router.post("/users/{user_id}/favorites")
async def add_to_favorites(
    user_id: str,
    request: FavoriteRequest,
    db: AsyncSession = Depends(get_db)
):
    """Add a post to user's favorites"""
    from models import UserFavorite, Post

    # Verify user exists
    user_result = await db.execute(select(Profile).where(Profile.id == user_id))
    if not user_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="User not found")

    # Verify post exists
    post_result = await db.execute(select(Post).where(Post.id == request.post_id))
    if not post_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Post not found")

    # Check if already favorited
    existing = await db.execute(
        select(UserFavorite)
        .where(UserFavorite.user_id == user_id)
        .where(UserFavorite.post_id == request.post_id)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Already in favorites")

    # Add to favorites
    favorite = UserFavorite(
        id=str(uuid.uuid4()),
        user_id=user_id,
        post_id=request.post_id
    )
    db.add(favorite)
    await db.commit()

    return {"success": True, "message": "Added to favorites"}


@router.delete("/users/{user_id}/favorites/{post_id}")
async def remove_from_favorites(
    user_id: str,
    post_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Remove a post from user's favorites"""
    from models import UserFavorite

    result = await db.execute(
        select(UserFavorite)
        .where(UserFavorite.user_id == user_id)
        .where(UserFavorite.post_id == post_id)
    )
    favorite = result.scalar_one_or_none()

    if not favorite:
        raise HTTPException(status_code=404, detail="Not in favorites")

    await db.delete(favorite)
    await db.commit()

    return {"success": True, "message": "Removed from favorites"}


@router.get("/users/{user_id}/favorites")
async def get_user_favorites(
    user_id: str,
    limit: int = 50,
    db: AsyncSession = Depends(get_db)
):
    """Get user's favorited posts"""
    from models import UserFavorite, Post

    result = await db.execute(
        select(UserFavorite)
        .options(selectinload(UserFavorite.post).selectinload(Post.author))
        .where(UserFavorite.user_id == user_id)
        .order_by(UserFavorite.created_at.desc())
        .limit(limit)
    )
    favorites = result.scalars().all()

    return [
        {
            "id": f.id,
            "post_id": f.post_id,
            "post": {
                "id": f.post.id,
                "media_url": f.post.media_url,
                "media_type": f.post.media_type,
                "thumbnail_url": f.post.thumbnail_url,
                "caption": f.post.caption,
                "author_name": f.post.author.full_name if f.post.author else None,
                "created_at": f.post.created_at
            } if f.post else None,
            "created_at": f.created_at
        } for f in favorites
    ]
