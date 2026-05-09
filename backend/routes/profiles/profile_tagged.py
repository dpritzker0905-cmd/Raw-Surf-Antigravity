"""
Profile Tagged Media — tag/untag users in posts and AI-tagged photo retrieval.

Extracted from profile_content.py (v101) to keep each module under 800 LOC.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from typing import Optional
from database import get_db
from models import (
    Profile, Post, TaggedMedia, Notification,
    GalleryItem, PhotoTag
)
import json

router = APIRouter()


# ============ TAGGED MEDIA ============

@router.get("/profile/{user_id}/tagged")
async def get_tagged_media(
    user_id: str,
    limit: int = 30,
    offset: int = 0,
    db: AsyncSession = Depends(get_db)
):
    """Get media where user is tagged, including AI-tagged photos with NEW badge support"""

    items = []

    # Get traditional tagged media
    result = await db.execute(
        select(TaggedMedia)
        .where(TaggedMedia.tagged_user_id == user_id)
        .options(
            selectinload(TaggedMedia.post).selectinload(Post.author),
            selectinload(TaggedMedia.gallery_item),
            selectinload(TaggedMedia.tagged_by)
        )
        .order_by(TaggedMedia.created_at.desc())
        .offset(offset)
        .limit(limit)
    )
    tagged = result.scalars().all()

    for t in tagged:
        if t.post:
            items.append({
                "id": t.id,
                "type": "post",
                "media_url": t.post.media_url,
                "media_type": t.post.media_type or 'image',
                "thumbnail_url": t.post.thumbnail_url,
                "caption": t.post.caption,
                "author_name": t.post.author.full_name if t.post.author else None,
                "tagged_by": t.tagged_by.full_name if t.tagged_by else None,
                "video_duration": t.post.video_duration,
                "created_at": t.created_at.isoformat(),
                "is_new": False  # Traditional tags don't have NEW badge
            })
        elif t.gallery_item:
            items.append({
                "id": t.id,
                "type": "gallery",
                "media_url": t.gallery_item.preview_url,
                "media_type": t.gallery_item.media_type or 'image',
                "thumbnail_url": t.gallery_item.thumbnail_url,
                "title": t.gallery_item.title,
                "tagged_by": t.tagged_by.full_name if t.tagged_by else None,
                "video_duration": t.gallery_item.video_duration,
                "created_at": t.created_at.isoformat(),
                "is_new": False
            })

    # Also get AI-tagged photos from PhotoTag model
    photo_tag_result = await db.execute(
        select(PhotoTag)
        .where(PhotoTag.surfer_id == user_id)
        .options(
            selectinload(PhotoTag.gallery_item).selectinload(GalleryItem.photographer),
            selectinload(PhotoTag.photographer)
        )
        .order_by(PhotoTag.tagged_at.desc())
        .limit(limit)
    )
    photo_tags = photo_tag_result.scalars().all()

    for pt in photo_tags:
        if pt.gallery_item:
            items.append({
                "id": pt.id,
                "tag_id": pt.id,
                "type": "ai_tagged",
                "media_url": pt.gallery_item.preview_url,
                "media_type": pt.gallery_item.media_type or 'image',
                "thumbnail_url": pt.gallery_item.thumbnail_url,
                "title": pt.gallery_item.title,
                "tagged_by": pt.photographer.full_name if pt.photographer else None,
                "photographer_id": pt.photographer_id,
                "photographer_avatar": pt.photographer.avatar_url if pt.photographer else None,
                "video_duration": pt.gallery_item.video_duration,
                "created_at": pt.tagged_at.isoformat(),
                "is_new": pt.viewed_at is None,
                "access_granted": pt.access_granted,
                "was_session_participant": pt.was_session_participant,
                "session_photo_price": pt.session_photo_price
            })

    # Sort by created_at descending and apply limit
    items.sort(key=lambda x: x["created_at"], reverse=True)

    # Count NEW items
    new_count = len([i for i in items if i.get("is_new", False)])

    return {
        "items": items[:limit],
        "new_count": new_count,
        "total": len(items)
    }


@router.post("/posts/{post_id}/tag")
async def tag_user_in_post(
    post_id: str,
    tagged_user_id: str,
    tagged_by_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Tag a user in a post"""
    # Check if already tagged
    existing = await db.execute(
        select(TaggedMedia)
        .where(TaggedMedia.tagged_user_id == tagged_user_id)
        .where(TaggedMedia.post_id == post_id)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="User already tagged in this post")

    # Verify post exists
    post_result = await db.execute(select(Post).where(Post.id == post_id))
    post = post_result.scalar_one_or_none()
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")

    # Create tag
    tag = TaggedMedia(
        tagged_user_id=tagged_user_id,
        post_id=post_id,
        tagged_by_id=tagged_by_id
    )
    db.add(tag)

    # Notify tagged user
    if tagged_user_id != tagged_by_id:
        tagger_result = await db.execute(select(Profile).where(Profile.id == tagged_by_id))
        tagger = tagger_result.scalar_one_or_none()

        notification = Notification(
            user_id=tagged_user_id,
            type='tagged',
            title=f"{tagger.full_name if tagger else 'Someone'} tagged you in a post",
            body="Tap to see the post",
            data=json.dumps({"post_id": post_id, "type": "tagged"})
        )
        db.add(notification)

    await db.commit()

    return {"message": "User tagged", "tag_id": tag.id}
