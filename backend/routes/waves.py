"""
Waves API Routes - Short-form vertical video content
Similar to TikTok/Reels but surf-focused
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc, func, and_, or_
from sqlalchemy.orm import selectinload
from typing import Optional, List
from datetime import datetime, timezone, timedelta
import logging
import re

from database import get_db
from models import Post, Profile, PostLike, PostReaction, Follow, Hashtag, PostHashtag

router = APIRouter()
logger = logging.getLogger(__name__)

# Hashtag regex pattern (same as search.py)
HASHTAG_PATTERN = re.compile(r'#(\w+)', re.UNICODE)

def extract_hashtags(text: str) -> List[str]:
    """Extract hashtags from text, return lowercase unique tags"""
    if not text:
        return []
    matches = HASHTAG_PATTERN.findall(text)
    return list(set(tag.lower() for tag in matches if len(tag) >= 2 and len(tag) <= 50))


@router.get("/waves")
async def get_waves_feed(
    user_id: Optional[str] = None,
    feed_type: str = Query("for_you", enum=["for_you", "following", "trending"]),
    hashtag: Optional[str] = None,
    limit: int = Query(10, le=50),
    offset: int = 0,
    db: AsyncSession = Depends(get_db)
):
    """
    Get Waves feed (short-form vertical videos)
    
    feed_type:
    - for_you: Algorithm-based mix (default)
    - following: Only from users you follow
    - trending: Top waves by engagement
    
    hashtag: Optional hashtag filter (without the # symbol)
    """
    try:
        base_query = select(Post).where(
            Post.content_type == 'wave',
            Post.media_type == 'video'
        )
        
        # Filter by hashtag if provided
        if hashtag:
            clean_tag = hashtag.lower().lstrip('#')
            base_query = (
                base_query
                .join(PostHashtag, Post.id == PostHashtag.post_id)
                .join(Hashtag, PostHashtag.hashtag_id == Hashtag.id)
                .where(Hashtag.tag == clean_tag)
            )
        
        if feed_type == "following" and user_id:
            # Get IDs of users this user follows
            following_query = select(Follow.following_id).where(
                Follow.follower_id == user_id
            )
            following_result = await db.execute(following_query)
            following_ids = [r[0] for r in following_result.fetchall()]
            
            if following_ids:
                base_query = base_query.where(Post.author_id.in_(following_ids))
            else:
                # No following, return empty
                return {"waves": [], "total": 0, "has_more": False}
        
        elif feed_type == "trending":
            # Trending: Sort by engagement score (likes + comments + views)
            # Weighted: views/10 + likes + comments*2
            base_query = base_query.order_by(
                desc(Post.view_count / 10 + Post.likes_count + Post.comments_count * 2),
                desc(Post.created_at)
            )
        else:
            # For You: Mix of recent + engagement
            # Prioritize recent content with good engagement
            base_query = base_query.order_by(
                desc(Post.created_at)
            )
        
        # Add eager loading for author
        base_query = base_query.options(selectinload(Post.author))
        
        # Get total count
        count_query = select(func.count()).select_from(Post).where(
            Post.content_type == 'wave',
            Post.media_type == 'video'
        )
        count_result = await db.execute(count_query)
        total = count_result.scalar() or 0
        
        # Apply pagination
        base_query = base_query.offset(offset).limit(limit)
        
        result = await db.execute(base_query)
        waves = result.scalars().all()
        
        # Get user's likes if authenticated
        user_likes = set()
        user_reactions = {}
        if user_id:
            likes_query = select(PostLike.post_id).where(
                PostLike.user_id == user_id,
                PostLike.post_id.in_([w.id for w in waves])
            )
            likes_result = await db.execute(likes_query)
            user_likes = {r[0] for r in likes_result.fetchall()}
            
            # Get reactions
            reactions_query = select(PostReaction.post_id, PostReaction.emoji).where(
                PostReaction.user_id == user_id,
                PostReaction.post_id.in_([w.id for w in waves])
            )
            reactions_result = await db.execute(reactions_query)
            user_reactions = {r[0]: r[1] for r in reactions_result.fetchall()}
        
        waves_data = []
        for wave in waves:
            author = wave.author
            waves_data.append({
                "id": wave.id,
                "author_id": wave.author_id,
                "author_name": author.full_name if author else "Unknown",
                "author_username": author.username if author else None,
                "author_avatar": author.avatar_url if author else None,
                "author_role": author.role.value if author and author.role else "Surfer",
                "author_verified": author.is_verified if author else False,
                "media_url": wave.media_url,
                "thumbnail_url": wave.thumbnail_url,
                "caption": wave.caption,
                "location": wave.location,
                "spot_id": wave.spot_id,
                "aspect_ratio": wave.aspect_ratio or "9:16",
                "video_width": wave.video_width,
                "video_height": wave.video_height,
                "video_duration": wave.video_duration,
                "likes_count": wave.likes_count,
                "comments_count": wave.comments_count,
                "view_count": wave.view_count,
                "is_liked": wave.id in user_likes,
                "user_reaction": user_reactions.get(wave.id),
                "created_at": wave.created_at.isoformat() if wave.created_at else None
            })
        
        return {
            "waves": waves_data,
            "total": total,
            "has_more": offset + limit < total
        }
        
    except Exception as e:
        logger.error(f"Error fetching waves: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/waves")
async def create_wave(
    author_id: str,
    media_url: str,
    thumbnail_url: Optional[str] = None,
    caption: Optional[str] = None,
    location: Optional[str] = None,
    spot_id: Optional[str] = None,
    aspect_ratio: str = "9:16",
    video_width: Optional[int] = None,
    video_height: Optional[int] = None,
    video_duration: Optional[float] = None,
    db: AsyncSession = Depends(get_db)
):
    """Create a new Wave (short-form video post) with hashtag extraction"""
    try:
        # Validate duration (60 sec max)
        if video_duration and video_duration > 60:
            raise HTTPException(
                status_code=400,
                detail="Waves must be 60 seconds or less"
            )
        
        # Create Wave post
        wave = Post(
            author_id=author_id,
            media_url=media_url,
            thumbnail_url=thumbnail_url,
            caption=caption,
            location=location,
            spot_id=spot_id,
            media_type="video",
            content_type="wave",
            aspect_ratio=aspect_ratio,
            video_width=video_width,
            video_height=video_height,
            video_duration=video_duration,
            view_count=0
        )
        
        db.add(wave)
        await db.flush()  # Get the wave.id before commit
        
        # Extract and process hashtags from caption
        hashtags_found = []
        if caption:
            tags = extract_hashtags(caption)
            for tag in tags:
                # Find or create hashtag
                existing = await db.execute(
                    select(Hashtag).where(Hashtag.tag == tag)
                )
                hashtag = existing.scalar_one_or_none()
                
                if hashtag:
                    # Update existing hashtag
                    hashtag.post_count = (hashtag.post_count or 0) + 1
                    hashtag.last_used = datetime.now(timezone.utc)
                else:
                    # Create new hashtag
                    hashtag = Hashtag(
                        tag=tag,
                        post_count=1,
                        last_used=datetime.now(timezone.utc)
                    )
                    db.add(hashtag)
                    await db.flush()
                
                # Create PostHashtag junction
                post_hashtag = PostHashtag(
                    post_id=wave.id,
                    hashtag_id=hashtag.id
                )
                db.add(post_hashtag)
                hashtags_found.append(tag)
        
        await db.commit()
        await db.refresh(wave)
        
        return {
            "id": wave.id,
            "content_type": "wave",
            "media_url": wave.media_url,
            "thumbnail_url": wave.thumbnail_url,
            "caption": wave.caption,
            "aspect_ratio": wave.aspect_ratio,
            "hashtags": hashtags_found,
            "created_at": wave.created_at.isoformat() if wave.created_at else None
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating wave: {e}")
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/waves/{wave_id}/view")
async def record_wave_view(
    wave_id: str,
    user_id: Optional[str] = None,
    watch_duration: Optional[float] = None,
    db: AsyncSession = Depends(get_db)
):
    """Record a view on a Wave"""
    try:
        result = await db.execute(
            select(Post).where(Post.id == wave_id, Post.content_type == 'wave')
        )
        wave = result.scalar_one_or_none()
        
        if not wave:
            raise HTTPException(status_code=404, detail="Wave not found")
        
        # Increment view count
        wave.view_count = (wave.view_count or 0) + 1
        await db.commit()
        
        return {"view_count": wave.view_count}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error recording view: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/waves/{wave_id}")
async def get_wave(
    wave_id: str,
    user_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """Get a single Wave by ID"""
    try:
        result = await db.execute(
            select(Post)
            .where(Post.id == wave_id, Post.content_type == 'wave')
            .options(selectinload(Post.author))
        )
        wave = result.scalar_one_or_none()
        
        if not wave:
            raise HTTPException(status_code=404, detail="Wave not found")
        
        # Check if user liked
        is_liked = False
        user_reaction = None
        if user_id:
            like_result = await db.execute(
                select(PostLike).where(
                    PostLike.post_id == wave_id,
                    PostLike.user_id == user_id
                )
            )
            is_liked = like_result.scalar_one_or_none() is not None
            
            reaction_result = await db.execute(
                select(PostReaction.emoji).where(
                    PostReaction.post_id == wave_id,
                    PostReaction.user_id == user_id
                )
            )
            reaction = reaction_result.scalar_one_or_none()
            if reaction:
                user_reaction = reaction
        
        author = wave.author
        return {
            "id": wave.id,
            "author_id": wave.author_id,
            "author_name": author.full_name if author else "Unknown",
            "author_username": author.username if author else None,
            "author_avatar": author.avatar_url if author else None,
            "author_role": author.role.value if author and author.role else "Surfer",
            "media_url": wave.media_url,
            "thumbnail_url": wave.thumbnail_url,
            "caption": wave.caption,
            "location": wave.location,
            "spot_id": wave.spot_id,
            "aspect_ratio": wave.aspect_ratio or "9:16",
            "video_width": wave.video_width,
            "video_height": wave.video_height,
            "video_duration": wave.video_duration,
            "likes_count": wave.likes_count,
            "comments_count": wave.comments_count,
            "view_count": wave.view_count,
            "is_liked": is_liked,
            "user_reaction": user_reaction,
            "created_at": wave.created_at.isoformat() if wave.created_at else None
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching wave: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/users/{user_id}/waves")
async def get_user_waves(
    user_id: str,
    limit: int = Query(20, le=50),
    offset: int = 0,
    db: AsyncSession = Depends(get_db)
):
    """Get all Waves by a specific user"""
    try:
        query = select(Post).where(
            Post.author_id == user_id,
            Post.content_type == 'wave'
        ).order_by(desc(Post.created_at)).offset(offset).limit(limit)
        
        result = await db.execute(query)
        waves = result.scalars().all()
        
        # Count total
        count_result = await db.execute(
            select(func.count()).select_from(Post).where(
                Post.author_id == user_id,
                Post.content_type == 'wave'
            )
        )
        total = count_result.scalar() or 0
        
        waves_data = [{
            "id": w.id,
            "media_url": w.media_url,
            "thumbnail_url": w.thumbnail_url,
            "caption": w.caption,
            "aspect_ratio": w.aspect_ratio,
            "video_duration": w.video_duration,
            "likes_count": w.likes_count,
            "view_count": w.view_count,
            "created_at": w.created_at.isoformat() if w.created_at else None
        } for w in waves]
        
        return {
            "waves": waves_data,
            "total": total,
            "has_more": offset + limit < total
        }
        
    except Exception as e:
        logger.error(f"Error fetching user waves: {e}")
        raise HTTPException(status_code=500, detail=str(e))



@router.get("/waves/trending")
async def get_trending_waves(
    limit: int = Query(10, le=20),
    days: int = Query(7, le=30),
    db: AsyncSession = Depends(get_db)
):
    """
    Get trending Waves for Explore page
    Based on engagement (views, likes, comments) in the last N days
    """
    try:
        cutoff_date = datetime.now(timezone.utc) - timedelta(days=days)
        
        query = (
            select(Post)
            .where(
                Post.content_type == 'wave',
                Post.media_type == 'video',
                Post.created_at > cutoff_date
            )
            .order_by(
                desc(Post.view_count / 10 + Post.likes_count + Post.comments_count * 2),
                desc(Post.created_at)
            )
            .options(selectinload(Post.author))
            .limit(limit)
        )
        
        result = await db.execute(query)
        waves = result.scalars().all()
        
        return {
            "trending_waves": [{
                "id": w.id,
                "author_id": w.author_id,
                "author_name": w.author.full_name if w.author else "Unknown",
                "author_username": w.author.username if w.author else None,
                "author_avatar": w.author.avatar_url if w.author else None,
                "media_url": w.media_url,
                "thumbnail_url": w.thumbnail_url,
                "caption": w.caption,
                "aspect_ratio": w.aspect_ratio,
                "video_duration": w.video_duration,
                "likes_count": w.likes_count,
                "view_count": w.view_count,
                "comments_count": w.comments_count,
                "engagement_score": (w.view_count or 0) / 10 + (w.likes_count or 0) + (w.comments_count or 0) * 2,
                "created_at": w.created_at.isoformat() if w.created_at else None
            } for w in waves],
            "period_days": days
        }
        
    except Exception as e:
        logger.error(f"Error fetching trending waves: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/waves/hashtag/{tag}")
async def get_waves_by_hashtag(
    tag: str,
    limit: int = Query(20, le=50),
    offset: int = 0,
    db: AsyncSession = Depends(get_db)
):
    """Get all Waves with a specific hashtag"""
    try:
        clean_tag = tag.lower().lstrip('#')
        
        query = (
            select(Post)
            .join(PostHashtag, Post.id == PostHashtag.post_id)
            .join(Hashtag, PostHashtag.hashtag_id == Hashtag.id)
            .where(
                Hashtag.tag == clean_tag,
                Post.content_type == 'wave'
            )
            .order_by(desc(Post.created_at))
            .options(selectinload(Post.author))
            .offset(offset)
            .limit(limit)
        )
        
        result = await db.execute(query)
        waves = result.scalars().all()
        
        # Get total count
        count_query = (
            select(func.count())
            .select_from(Post)
            .join(PostHashtag, Post.id == PostHashtag.post_id)
            .join(Hashtag, PostHashtag.hashtag_id == Hashtag.id)
            .where(
                Hashtag.tag == clean_tag,
                Post.content_type == 'wave'
            )
        )
        count_result = await db.execute(count_query)
        total = count_result.scalar() or 0
        
        return {
            "hashtag": clean_tag,
            "waves": [{
                "id": w.id,
                "author_id": w.author_id,
                "author_name": w.author.full_name if w.author else "Unknown",
                "author_username": w.author.username if w.author else None,
                "author_avatar": w.author.avatar_url if w.author else None,
                "media_url": w.media_url,
                "thumbnail_url": w.thumbnail_url,
                "caption": w.caption,
                "aspect_ratio": w.aspect_ratio,
                "video_duration": w.video_duration,
                "likes_count": w.likes_count,
                "view_count": w.view_count,
                "created_at": w.created_at.isoformat() if w.created_at else None
            } for w in waves],
            "total": total,
            "has_more": offset + limit < total
        }
        
    except Exception as e:
        logger.error(f"Error fetching waves by hashtag: {e}")
        raise HTTPException(status_code=500, detail=str(e))
