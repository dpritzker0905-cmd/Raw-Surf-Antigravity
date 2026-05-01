"""
Posts management — settings, edit, delete, and reporting.
"""
import logging
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timedelta

from database import get_db
from models import Profile, Post

router = APIRouter()
logger = logging.getLogger(__name__)

class PostSettingsUpdate(BaseModel):
    hide_like_count: Optional[bool] = None
    comments_disabled: Optional[bool] = None

@router.patch("/posts/{post_id}/settings")
async def update_post_settings(
    post_id: str,
    user_id: str,
    settings: PostSettingsUpdate,
    db: AsyncSession = Depends(get_db)
):
    """Update post settings (hide likes, disable comments)"""
    result = await db.execute(select(Post).where(Post.id == post_id))
    post = result.scalar_one_or_none()
    
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    
    if post.author_id != user_id:
        raise HTTPException(status_code=403, detail="Not authorized to modify this post")
    
    if settings.hide_like_count is not None:
        post.hide_like_count = settings.hide_like_count
    if settings.comments_disabled is not None:
        post.comments_disabled = settings.comments_disabled
    
    await db.commit()
    return {"success": True, "message": "Settings updated"}


class PostUpdate(BaseModel):
    caption: Optional[str] = None
    location: Optional[str] = None
    session_date: Optional[str] = None
    session_start_time: Optional[str] = None
    session_end_time: Optional[str] = None
    wave_height_ft: Optional[float] = None
    wave_period_sec: Optional[float] = None
    wave_direction: Optional[str] = None
    wind_speed_mph: Optional[float] = None
    wind_direction: Optional[str] = None
    tide_status: Optional[str] = None
    tide_height_ft: Optional[float] = None

@router.patch("/posts/{post_id}")
async def update_post(
    post_id: str,
    user_id: str,
    data: PostUpdate,
    db: AsyncSession = Depends(get_db)
):
    """Update post caption, location, or session conditions"""
    from datetime import datetime as dt
    
    result = await db.execute(select(Post).where(Post.id == post_id))
    post = result.scalar_one_or_none()
    
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    
    if post.author_id != user_id:
        raise HTTPException(status_code=403, detail="Not authorized to modify this post")
    
    # Update all provided fields
    update_fields = [
        'caption', 'location', 'session_start_time', 'session_end_time',
        'wave_height_ft', 'wave_period_sec', 'wave_direction',
        'wind_speed_mph', 'wind_direction', 'tide_status', 'tide_height_ft'
    ]
    
    for field in update_fields:
        value = getattr(data, field, None)
        if value is not None:
            setattr(post, field, value)
    
    # Handle session_date separately (convert string to datetime)
    if data.session_date is not None:
        try:
            # Parse date string and convert to datetime (noon UTC to avoid timezone issues)
            parsed_date = dt.strptime(data.session_date, "%Y-%m-%d")
            parsed_date = parsed_date.replace(hour=12, minute=0, second=0)
            # Reject future-dated sessions (1-day buffer for international timezones)
            if parsed_date > datetime.utcnow() + timedelta(days=1):
                raise HTTPException(status_code=400, detail="Session date cannot be in the future")
            post.session_date = parsed_date
        except (ValueError, TypeError):
            pass  # Keep existing value if parsing fails
    
    await db.commit()
    return {"success": True, "message": "Post updated"}


@router.delete("/posts/{post_id}")
async def delete_post(
    post_id: str,
    user_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Delete a post"""
    from models import Profile
    
    # Get post
    result = await db.execute(select(Post).where(Post.id == post_id))
    post = result.scalar_one_or_none()
    
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    
    # Check authorization (author or admin)
    user_result = await db.execute(select(Profile).where(Profile.id == user_id))
    user = user_result.scalar_one_or_none()
    
    if post.author_id != user_id and not (user and user.is_admin):
        raise HTTPException(status_code=403, detail="Not authorized to delete this post")
    
    # Delete post (cascades to likes, comments, reactions, collaborations)
    await db.delete(post)
    await db.commit()
    
    return {"success": True, "message": "Post deleted"}


class PostReport(BaseModel):
    reporter_id: str
    reason: str
    description: Optional[str] = None

@router.post("/posts/{post_id}/report")
async def report_post(
    post_id: str,
    report: PostReport,
    db: AsyncSession = Depends(get_db)
):
    """Report a post for policy violation"""
    from models import Profile, PostReport as PostReportModel, ContentModerationItem, ContentModerationStatusEnum
    import uuid
    
    # Verify post exists
    post_result = await db.execute(select(Post).where(Post.id == post_id))
    post = post_result.scalar_one_or_none()
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    
    # Verify reporter exists
    reporter_result = await db.execute(select(Profile).where(Profile.id == report.reporter_id))
    reporter = reporter_result.scalar_one_or_none()
    if not reporter:
        raise HTTPException(status_code=404, detail="Reporter not found")
    
    # Save to PostReport table
    try:
        new_report = PostReportModel(
            id=str(uuid.uuid4()),
            post_id=post_id,
            reporter_id=report.reporter_id,
            reason=report.reason,
            description=report.description
        )
        db.add(new_report)
        await db.flush()
    except Exception:
        logger.error(f"Report logging: {report.reason} for post {post_id}")
        await db.rollback()
    
    # Also feed into content moderation queue so admins see it
    try:
        existing = await db.execute(
            select(ContentModerationItem).where(
                ContentModerationItem.content_type == "post",
                ContentModerationItem.content_id == post_id,
                ContentModerationItem.status == ContentModerationStatusEnum.PENDING
            )
        )
        existing_item = existing.scalar_one_or_none()
        
        if existing_item:
            # Increment flag count on existing queue item
            existing_item.flag_count = (existing_item.flag_count or 1) + 1
        else:
            # Create new moderation queue entry
            mod_item = ContentModerationItem(
                content_type="post",
                content_id=post_id,
                content_url=post.media_url,
                content_preview=post.caption[:200] if post.caption else None,
                user_id=post.author_id,
                flagged_by="user_report",
                flag_count=1
            )
            db.add(mod_item)
        
        await db.commit()
    except Exception as e:
        logger.error(f"Failed to create moderation queue entry for post {post_id}: {e}")
        await db.rollback()
    
    return {"success": True, "message": "Report submitted"}

