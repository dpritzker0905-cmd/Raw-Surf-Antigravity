"""
Profile Content Routes - for Instagram-style profile tabs
- User's posts
- Session shots (photographer transfers)
- Videos
- Saved posts
- Tagged media
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime

from database import get_db
from models import (
    Profile, Post, SavedPost, TaggedMedia, UserMedia, 
    GalleryItem, PostLike, Gallery, LiveSession, ConditionReport,
    RoleEnum
)
import json
from models import PostReaction

router = APIRouter()


# ============ USER'S POSTS ============

@router.get("/profile/{user_id}/posts")
async def get_user_posts(
    user_id: str,
    viewer_id: Optional[str] = None,
    limit: int = 30,
    offset: int = 0,
    db: AsyncSession = Depends(get_db)
):
    """Get user's own posts for their profile grid"""
    from models import PostReaction, PostLike
    result = await db.execute(
        select(Post)
        .options(
            selectinload(Post.reactions).selectinload(PostReaction.user),
            selectinload(Post.likes).selectinload(PostLike.user),
            selectinload(Post.comments)
        )
        .where(Post.author_id == user_id)
        .order_by(Post.created_at.desc())
        .offset(offset)
        .limit(limit)
    )
    posts = result.scalars().all()
    
    liked_post_ids = set()
    if viewer_id:
        liked_result = await db.execute(
            select(PostLike.post_id)
            .where(PostLike.user_id == viewer_id)
            .where(PostLike.post_id.in_([p.id for p in posts]))
        )
        liked_post_ids = set(liked_result.scalars().all())
    
    return [{
        "id": p.id,
        "media_url": p.media_url,
        # Infer media_type from URL if not explicitly set (Waves posts sometimes have NULL media_type)
        "media_type": p.media_type or (
            'video' if p.media_url and any(
                p.media_url.lower().endswith(ext)
                for ext in ('.mp4', '.mov', '.webm', '.avi', '.mkv')
            ) else 'image'
        ),
        "thumbnail_url": p.thumbnail_url,
        "caption": p.caption,
        "likes_count": p.likes_count or 0,
        "comments_count": getattr(p, 'comments_count', 0) or len(p.comments) or 0,
        "video_duration": p.video_duration,
        "video_width": p.video_width,
        "video_height": p.video_height,
        "created_at": p.created_at.isoformat(),
        "liked": p.id in liked_post_ids,
        "is_liked_by_user": p.id in liked_post_ids,
        "reactions": [
            {
                "emoji": r.emoji,
                "user_id": r.user_id,
                "user_name": r.user.full_name if getattr(r, 'user', None) else None,
                "avatar_url": r.user.avatar_url if getattr(r, 'user', None) else None,
                "user_role": r.user.role if getattr(r, 'user', None) else None
            } for r in p.reactions
        ] + [
            {
                "emoji": "\U0001f919",
                "user_id": l.user_id,
                "user_name": l.user.full_name if getattr(l, 'user', None) else None,
                "avatar_url": l.user.avatar_url if getattr(l, 'user', None) else None,
                "user_role": l.user.role if getattr(l, 'user', None) else None
            } for l in getattr(p, 'likes', [])
        ]
    } for p in posts]


@router.get("/profile/{user_id}/posts/count")
async def get_user_posts_count(user_id: str, db: AsyncSession = Depends(get_db)):
    """Get count of user's posts"""
    result = await db.execute(
        select(func.count(Post.id)).where(Post.author_id == user_id)
    )
    count = result.scalar() or 0
    return {"count": count}


# ============ SESSION SHOTS (Photographer Transfers) ============

@router.get("/profile/{user_id}/session-shots")
async def get_session_shots(
    user_id: str,
    limit: int = 30,
    offset: int = 0,
    db: AsyncSession = Depends(get_db)
):
    """
    Get session content for a user's Sessions tab.
    
    For SURFERS: Photos/videos transferred from photographers (purchased pro content)
    For PHOTOGRAPHERS: Their shot sessions (galleries they created from live sessions)
    """
    # First check if user is a photographer
    user_result = await db.execute(
        select(Profile).where(Profile.id == user_id)
    )
    user = user_result.scalar_one_or_none()
    
    if not user:
        return []
    
    items = []
    
    # Check if user is a photographer
    is_photographer = user.role in [RoleEnum.PHOTOGRAPHER, RoleEnum.PRO]
    
    # For photographers: Get their shot sessions (live sessions they conducted)
    if is_photographer:
        # Get galleries from live sessions with condition report media as thumbnail
        gallery_result = await db.execute(
            select(Gallery, LiveSession, ConditionReport)
            .join(LiveSession, Gallery.live_session_id == LiveSession.id)
            .outerjoin(ConditionReport, ConditionReport.live_session_id == LiveSession.id)
            .where(Gallery.photographer_id == user_id)
            .where(Gallery.session_type == 'live')
            .order_by(Gallery.created_at.desc())
            .offset(offset)
            .limit(limit)
        )
        galleries = gallery_result.all()
        
        for gallery, live_session, condition_report in galleries:
            # Use condition report media as thumbnail, fallback to gallery cover
            thumbnail = None
            media_type = 'image'
            
            if condition_report and condition_report.media_url:
                thumbnail = condition_report.media_url
                media_type = condition_report.media_type or 'image'
            elif gallery.cover_image_url:
                thumbnail = gallery.cover_image_url
            
            # Count gallery items
            item_count_result = await db.execute(
                select(func.count(GalleryItem.id))
                .where(GalleryItem.gallery_id == gallery.id)
            )
            item_count = item_count_result.scalar() or 0
            
            items.append({
                "id": gallery.id,
                "media_url": thumbnail,
                "media_type": media_type,
                "thumbnail_url": thumbnail,
                "title": gallery.title,
                "caption": f"Session at {live_session.location_name}" if live_session and live_session.location_name else gallery.title,
                "location": live_session.location_name if live_session else None,
                "gallery_id": gallery.id,
                "live_session_id": live_session.id if live_session else None,
                "is_photographer_session": True,  # Flag to indicate this links to their gallery
                "item_count": item_count,
                "created_at": gallery.created_at.isoformat() if gallery.created_at else None
            })
    
    # For all users (including photographers): Get photos received from photographers
    result = await db.execute(
        select(UserMedia)
        .where(UserMedia.user_id == user_id)
        .where(UserMedia.source_type == 'photographer_transfer')
        .options(selectinload(UserMedia.source_photographer))
        .order_by(UserMedia.created_at.desc())
        .offset(offset)
        .limit(limit)
    )
    media_items = result.scalars().all()
    
    for m in media_items:
        items.append({
            "id": m.id,
            "media_url": m.media_url,
            "media_type": m.media_type or 'image',
            "thumbnail_url": m.thumbnail_url,
            "title": m.title,
            "photographer_name": m.source_photographer.full_name if m.source_photographer else None,
            "photographer_id": m.source_photographer_id,
            "original_width": m.original_width,
            "original_height": m.original_height,
            "video_duration": m.video_duration,
            "is_photographer_session": False,  # This is received content
            "created_at": m.created_at.isoformat()
        })
    
    # Sort all items by created_at descending
    items.sort(key=lambda x: x.get('created_at') or '', reverse=True)
    
    return items


# ============ VIDEOS ============

@router.get("/profile/{user_id}/videos")
async def get_user_videos(
    user_id: str,
    viewer_id: Optional[str] = None,
    limit: int = 30,
    offset: int = 0,
    db: AsyncSession = Depends(get_db)
):
    """Get user's video posts only (media_type='video' OR URL ends in a video extension)"""
    from models import PostReaction, PostLike
    result = await db.execute(
        select(Post)
        .options(
            selectinload(Post.reactions).selectinload(PostReaction.user),
            selectinload(Post.likes).selectinload(PostLike.user),
            selectinload(Post.comments)
        )
        .where(Post.author_id == user_id)
        .where(
            # Catch videos stored with explicit type OR with video URL extension (Waves / old posts)
            or_(
                Post.media_type == 'video',
                and_(
                    Post.media_type.is_(None),
                    or_(
                        Post.media_url.ilike('%.mp4'),
                        Post.media_url.ilike('%.mov'),
                        Post.media_url.ilike('%.webm'),
                        Post.media_url.ilike('%.avi'),
                    )
                )
            )
        )
        .order_by(Post.created_at.desc())
        .offset(offset)
        .limit(limit)
    )
    posts = result.scalars().all()
    
    liked_post_ids = set()
    if viewer_id:
        liked_result = await db.execute(
            select(PostLike.post_id)
            .where(PostLike.user_id == viewer_id)
            .where(PostLike.post_id.in_([p.id for p in posts]))
        )
        liked_post_ids = set(liked_result.scalars().all())
    
    return [{
        "id": p.id,
        "media_url": p.media_url,
        "media_type": p.media_type or "video",  # Always 'video' for this endpoint — required by Profile grid renderer
        "thumbnail_url": p.thumbnail_url,
        "caption": p.caption,
        "likes_count": p.likes_count or 0,
        "comments_count": getattr(p, 'comments_count', 0) or len(p.comments) or 0,
        "video_duration": p.video_duration,
        "video_width": p.video_width,
        "video_height": p.video_height,
        "created_at": p.created_at.isoformat(),
        "liked": p.id in liked_post_ids,
        "is_liked_by_user": p.id in liked_post_ids,
        "reactions": [
            {
                "emoji": r.emoji,
                "user_id": r.user_id,
                "user_name": r.user.full_name if getattr(r, 'user', None) else None,
                "avatar_url": r.user.avatar_url if getattr(r, 'user', None) else None,
                "user_role": r.user.role if getattr(r, 'user', None) else None
            } for r in p.reactions
        ] + [
            {
                "emoji": "🤙",
                "user_id": l.user_id,
                "user_name": l.user.full_name if getattr(l, 'user', None) else None,
                "avatar_url": l.user.avatar_url if getattr(l, 'user', None) else None,
                "user_role": l.user.role if getattr(l, 'user', None) else None
            } for l in getattr(p, 'likes', [])
        ]
    } for p in posts]


# ============ PHOTOS ============

@router.get("/profile/{user_id}/photos")
async def get_user_photos(
    user_id: str,
    viewer_id: Optional[str] = None,
    limit: int = 30,
    offset: int = 0,
    db: AsyncSession = Depends(get_db)
):
    """Get user's photo posts only (excludes videos)"""
    from models import PostReaction, PostLike
    result = await db.execute(
        select(Post)
        .options(
            selectinload(Post.reactions).selectinload(PostReaction.user),
            selectinload(Post.likes).selectinload(PostLike.user),
            selectinload(Post.comments)
        )
        .where(Post.author_id == user_id)
        .where(Post.media_type == 'image')
        .order_by(Post.created_at.desc())
        .offset(offset)
        .limit(limit)
    )
    posts = result.scalars().all()
    
    liked_post_ids = set()
    if viewer_id:
        liked_result = await db.execute(
            select(PostLike.post_id)
            .where(PostLike.user_id == viewer_id)
            .where(PostLike.post_id.in_([p.id for p in posts]))
        )
        liked_post_ids = set(liked_result.scalars().all())
    
    return [{
        "id": p.id,
        "media_url": p.media_url,
        "thumbnail_url": p.thumbnail_url,
        "caption": p.caption,
        "likes_count": p.likes_count or 0,
        "comments_count": getattr(p, 'comments_count', 0) or len(p.comments) or 0,
        "created_at": p.created_at.isoformat(),
        "liked": p.id in liked_post_ids,
        "is_liked_by_user": p.id in liked_post_ids,
        "reactions": [
            {
                "emoji": r.emoji,
                "user_id": r.user_id,
                "user_name": r.user.full_name if getattr(r, 'user', None) else None,
                "avatar_url": r.user.avatar_url if getattr(r, 'user', None) else None,
                "user_role": r.user.role if getattr(r, 'user', None) else None
            } for r in p.reactions
        ] + [
            {
                "emoji": "🤙",
                "user_id": l.user_id,
                "user_name": l.user.full_name if getattr(l, 'user', None) else None,
                "avatar_url": l.user.avatar_url if getattr(l, 'user', None) else None,
                "user_role": l.user.role if getattr(l, 'user', None) else None
            } for l in getattr(p, 'likes', [])
        ]
    } for p in posts]


# ============ SAVED POSTS ============

@router.get("/profile/{user_id}/saved")
async def get_saved_posts(
    user_id: str,
    viewer_id: Optional[str] = None,
    limit: int = 30,
    offset: int = 0,
    db: AsyncSession = Depends(get_db)
):
    """Get user's saved/bookmarked posts"""
    from models import PostReaction, PostLike
    result = await db.execute(
        select(SavedPost)
        .where(SavedPost.user_id == user_id)
        .options(
            selectinload(SavedPost.post).selectinload(Post.author),
            selectinload(SavedPost.post).selectinload(Post.reactions).selectinload(PostReaction.user),
            selectinload(SavedPost.post).selectinload(Post.likes).selectinload(PostLike.user),
            selectinload(SavedPost.post).selectinload(Post.comments)
        )
        .order_by(SavedPost.created_at.desc())
        .offset(offset)
        .limit(limit)
    )
    saved = result.scalars().all()
    
    # We use user_id or viewer_id for liked posts query
    eval_id = viewer_id or user_id
    liked_post_ids = set()
    if eval_id:
        post_ids = [s.post.id for s in saved if s.post]
        if post_ids:
            liked_result = await db.execute(
                select(PostLike.post_id)
                .where(PostLike.user_id == eval_id)
                .where(PostLike.post_id.in_(post_ids))
            )
            liked_post_ids = set(liked_result.scalars().all())
    
    return [{
        "id": s.id,
        "saved_at": s.created_at.isoformat(),
        "post": {
            "id": s.post.id,
            "media_url": s.post.media_url,
            "media_type": s.post.media_type or 'image',
            "thumbnail_url": s.post.thumbnail_url,
            "caption": s.post.caption,
            "likes_count": s.post.likes_count or 0,
            "comments_count": getattr(s.post, 'comments_count', 0) or len(s.post.comments) or 0,
            "author_name": s.post.author.full_name if getattr(s.post, 'author', None) else None,
            "author_avatar": s.post.author.avatar_url if getattr(s.post, 'author', None) else None,
            "video_duration": s.post.video_duration,
            "created_at": s.post.created_at.isoformat(),
            "liked": s.post.id in liked_post_ids,
            "is_liked_by_user": s.post.id in liked_post_ids,
            "reactions": [
                {
                    "emoji": r.emoji,
                    "user_id": r.user_id,
                    "user_name": r.user.full_name if getattr(r, 'user', None) else None,
                    "avatar_url": r.user.avatar_url if getattr(r, 'user', None) else None,
                    "user_role": r.user.role if getattr(r, 'user', None) else None
                } for r in s.post.reactions
            ] + [
                {
                    "emoji": "🤙",
                    "user_id": l.user_id,
                    "user_name": l.user.full_name if getattr(l, 'user', None) else None,
                    "avatar_url": l.user.avatar_url if getattr(l, 'user', None) else None,
                    "user_role": l.user.role if getattr(l, 'user', None) else None
                } for l in getattr(s.post, 'likes', [])
            ]
        }
    } for s in saved if s.post]


@router.post("/posts/{post_id}/save")
async def save_post(post_id: str, user_id: str, db: AsyncSession = Depends(get_db)):
    """Save/bookmark a post"""
    # Check if already saved
    existing = await db.execute(
        select(SavedPost)
        .where(SavedPost.user_id == user_id)
        .where(SavedPost.post_id == post_id)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Post already saved")
    
    # Verify post exists
    post_check = await db.execute(select(Post).where(Post.id == post_id))
    if not post_check.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Post not found")
    
    saved = SavedPost(user_id=user_id, post_id=post_id)
    db.add(saved)
    await db.commit()
    
    return {"message": "Post saved", "saved_id": saved.id}


@router.delete("/posts/{post_id}/save")
async def unsave_post(post_id: str, user_id: str, db: AsyncSession = Depends(get_db)):
    """Remove a saved post"""
    result = await db.execute(
        select(SavedPost)
        .where(SavedPost.user_id == user_id)
        .where(SavedPost.post_id == post_id)
    )
    saved = result.scalar_one_or_none()
    
    if not saved:
        raise HTTPException(status_code=404, detail="Saved post not found")
    
    await db.delete(saved)
    await db.commit()
    
    return {"message": "Post unsaved"}


@router.get("/posts/{post_id}/is-saved")
async def check_if_saved(post_id: str, user_id: str, db: AsyncSession = Depends(get_db)):
    """Check if a post is saved by user"""
    result = await db.execute(
        select(SavedPost)
        .where(SavedPost.user_id == user_id)
        .where(SavedPost.post_id == post_id)
    )
    saved = result.scalar_one_or_none()
    return {"is_saved": saved is not None}


# ============ PROFILE STATS ============

@router.get("/profile/{user_id}/stats")
async def get_profile_stats(user_id: str, db: AsyncSession = Depends(get_db)):
    """Get all profile stats in one call"""
    # Posts count (all posts)
    posts_result = await db.execute(
        select(func.count(Post.id)).where(Post.author_id == user_id)
    )
    posts_count = posts_result.scalar() or 0
    
    # Photos count (images only)
    photos_result = await db.execute(
        select(func.count(Post.id))
        .where(Post.author_id == user_id)
        .where(Post.media_type == 'image')
    )
    photos_count = photos_result.scalar() or 0
    
    # Videos count
    videos_result = await db.execute(
        select(func.count(Post.id))
        .where(Post.author_id == user_id)
        .where(Post.media_type == 'video')
    )
    videos_count = videos_result.scalar() or 0
    
    # Session shots count - includes photographer's galleries for photographers
    # First check if user is photographer
    user_result = await db.execute(
        select(Profile).where(Profile.id == user_id)
    )
    user = user_result.scalar_one_or_none()
    
    session_shots_count = 0
    
    # For photographers: count their live session galleries
    is_photographer = user and user.role in [RoleEnum.PHOTOGRAPHER, RoleEnum.PRO]
    if is_photographer:
        photographer_sessions_result = await db.execute(
            select(func.count(Gallery.id))
            .where(Gallery.photographer_id == user_id)
            .where(Gallery.session_type == 'live')
        )
        session_shots_count += photographer_sessions_result.scalar() or 0
    
    # For all users: count photos received from photographers
    received_result = await db.execute(
        select(func.count(UserMedia.id))
        .where(UserMedia.user_id == user_id)
        .where(UserMedia.source_type == 'photographer_transfer')
    )
    session_shots_count += received_result.scalar() or 0
    
    # Saved count
    saved_result = await db.execute(
        select(func.count(SavedPost.id)).where(SavedPost.user_id == user_id)
    )
    saved_count = saved_result.scalar() or 0
    
    # Tagged count
    tagged_result = await db.execute(
        select(func.count(TaggedMedia.id)).where(TaggedMedia.tagged_user_id == user_id)
    )
    tagged_count = tagged_result.scalar() or 0
    
    return {
        "posts": posts_count,
        "photos": photos_count,
        "videos": videos_count,
        "session_shots": session_shots_count,
        "saved": saved_count,
        "tagged": tagged_count
    }
