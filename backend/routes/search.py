"""
Hashtag and Global Search API Routes
Provides:
- Global unified search across users, spots, posts, hashtags
- Hashtag extraction, storage, and trending
- Hashtag-based post filtering
"""
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_, desc, and_
from sqlalchemy.orm import selectinload
from typing import Optional, List
from datetime import datetime, timezone, timedelta
import re
import logging

from database import get_db
from models import Profile, SurfSpot, Post, Hashtag, PostHashtag

router = APIRouter()
logger = logging.getLogger(__name__)

# Hashtag regex pattern
HASHTAG_PATTERN = re.compile(r'#(\w+)', re.UNICODE)


def extract_hashtags(text: str) -> List[str]:
    """Extract hashtags from text, return lowercase unique tags"""
    if not text:
        return []
    matches = HASHTAG_PATTERN.findall(text)
    # Return unique, lowercase tags
    return list(set(tag.lower() for tag in matches if len(tag) >= 2 and len(tag) <= 50))


@router.get("/search/global")
async def global_search(
    q: str = Query(..., min_length=2),
    limit: int = Query(default=5, le=20),
    db: AsyncSession = Depends(get_db)
):
    """
    Global unified search across users, spots, posts, and hashtags.
    Returns categorized results for quick search dropdown.
    """
    search_term = f"%{q}%"
    results = {
        "users": [],
        "spots": [],
        "posts": [],
        "hashtags": []
    }
    
    # Search users
    user_result = await db.execute(
        select(Profile)
        .where(
            or_(
                Profile.full_name.ilike(search_term),
                Profile.username.ilike(search_term),
                Profile.location.ilike(search_term)
            )
        )
        .order_by(Profile.full_name)
        .limit(limit)
    )
    users = user_result.scalars().all()
    results["users"] = [{
        "id": u.id,
        "full_name": u.full_name,
        "username": u.username,
        "avatar_url": u.avatar_url,
        "role": u.role.value if u.role else 'Surfer',
        "is_verified": u.is_verified
    } for u in users]
    
    # Search spots
    spot_result = await db.execute(
        select(SurfSpot)
        .where(
            or_(
                SurfSpot.name.ilike(search_term),
                SurfSpot.region.ilike(search_term),
                SurfSpot.country.ilike(search_term) if hasattr(SurfSpot, 'country') else False
            )
        )
        .order_by(SurfSpot.name)
        .limit(limit)
    )
    spots = spot_result.scalars().all()
    results["spots"] = [{
        "id": s.id,
        "name": s.name,
        "region": s.region,
        "image_url": s.image_url,
        "difficulty": s.difficulty
    } for s in spots]
    
    # Search hashtags (if table exists)
    try:
        hashtag_result = await db.execute(
            select(Hashtag)
            .where(Hashtag.tag.ilike(search_term.replace('%', '')))
            .order_by(desc(Hashtag.post_count))
            .limit(limit)
        )
        hashtags = hashtag_result.scalars().all()
        results["hashtags"] = [{
            "tag": h.tag,
            "post_count": h.post_count
        } for h in hashtags]
    except Exception as e:
        logger.debug(f"Hashtag search skipped: {e}")
        results["hashtags"] = []
    
    # Search posts by caption
    post_result = await db.execute(
        select(Post)
        .options(selectinload(Post.author))
        .where(
            or_(
                Post.caption.ilike(search_term),
                Post.location.ilike(search_term)
            )
        )
        .order_by(desc(Post.created_at))
        .limit(limit)
    )
    posts = post_result.scalars().all()
    results["posts"] = [{
        "id": p.id,
        "image_url": p.media_url,
        "caption": p.caption[:100] if p.caption else None,
        "author_name": p.author.full_name if p.author else None,
        "author_avatar": p.author.avatar_url if p.author else None,
        "likes_count": p.likes_count
    } for p in posts]
    
    return results


@router.get("/hashtags/trending")
async def get_trending_hashtags(
    limit: int = Query(default=10, le=30),
    days: int = Query(default=7, le=30),
    db: AsyncSession = Depends(get_db)
):
    """
    Get trending hashtags based on recent post activity.
    Returns hashtags sorted by post count in the time window.
    """
    try:
        cutoff_date = datetime.now(timezone.utc) - timedelta(days=days)
        
        # Get hashtags with recent posts
        result = await db.execute(
            select(Hashtag)
            .where(Hashtag.last_used > cutoff_date)
            .order_by(desc(Hashtag.post_count))
            .limit(limit)
        )
        hashtags = result.scalars().all()
        
        return {
            "hashtags": [{
                "tag": h.tag,
                "post_count": h.post_count,
                "last_used": h.last_used.isoformat() if h.last_used else None
            } for h in hashtags],
            "period_days": days
        }
    except Exception as e:
        logger.error(f"Error fetching trending hashtags: {e}")
        # Return empty on error (table might not exist yet)
        return {"hashtags": [], "period_days": days}


@router.get("/hashtags/suggest")
async def suggest_hashtags(
    q: str = Query(..., min_length=1, max_length=50),
    limit: int = Query(default=8, le=20),
    db: AsyncSession = Depends(get_db)
):
    """
    Suggest hashtags based on partial input.
    Returns hashtags that start with the query, sorted by popularity.
    Used for autocomplete when user types # in post caption.
    """
    try:
        # Search for hashtags starting with the query (case-insensitive)
        search_term = q.lower()
        
        result = await db.execute(
            select(Hashtag)
            .where(Hashtag.tag.ilike(f"{search_term}%"))
            .order_by(desc(Hashtag.post_count))
            .limit(limit)
        )
        hashtags = result.scalars().all()
        
        return {
            "suggestions": [{
                "tag": h.tag,
                "post_count": h.post_count or 0
            } for h in hashtags],
            "query": q
        }
    except Exception as e:
        logger.error(f"Error suggesting hashtags: {e}")
        return {"suggestions": [], "query": q}


@router.get("/hashtags/{tag}/posts")
async def get_posts_by_hashtag(
    tag: str,
    limit: int = Query(default=20, le=50),
    offset: int = 0,
    user_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """
    Get posts that contain a specific hashtag.
    """
    # Normalize tag (remove # if present, lowercase)
    clean_tag = tag.lstrip('#').lower()
    
    try:
        # Get posts via PostHashtag junction table
        result = await db.execute(
            select(Post)
            .options(selectinload(Post.author))
            .join(PostHashtag, Post.id == PostHashtag.post_id)
            .join(Hashtag, PostHashtag.hashtag_id == Hashtag.id)
            .where(Hashtag.tag == clean_tag)
            .order_by(desc(Post.created_at))
            .offset(offset)
            .limit(limit)
        )
        posts = result.scalars().all()
        
        # Get total count
        count_result = await db.execute(
            select(func.count())
            .select_from(PostHashtag)
            .join(Hashtag, PostHashtag.hashtag_id == Hashtag.id)
            .where(Hashtag.tag == clean_tag)
        )
        total = count_result.scalar() or 0
        
        return {
            "tag": clean_tag,
            "total_posts": total,
            "posts": [{
                "id": p.id,
                "media_url": p.media_url,
                "media_type": p.media_type,
                "thumbnail_url": p.thumbnail_url,
                "caption": p.caption,
                "location": p.location,
                "likes_count": p.likes_count,
                "comments_count": p.comments_count,
                "author_id": p.author_id,
                "author_name": p.author.full_name if p.author else None,
                "author_avatar": p.author.avatar_url if p.author else None,
                "author_role": p.author.role.value if p.author and p.author.role else None,
                "created_at": p.created_at.isoformat() if p.created_at else None
            } for p in posts]
        }
    except Exception as e:
        logger.error(f"Error fetching posts for hashtag {clean_tag}: {e}")
        return {"tag": clean_tag, "total_posts": 0, "posts": []}


async def process_post_hashtags(db: AsyncSession, post_id: str, caption: str):
    """
    Process hashtags in a post caption.
    - Extracts hashtags from caption
    - Creates new Hashtag records if needed
    - Links post to hashtags via PostHashtag
    """
    if not caption:
        return []
    
    tags = extract_hashtags(caption)
    if not tags:
        return []
    
    created_tags = []
    
    for tag in tags:
        try:
            # Get or create hashtag
            result = await db.execute(
                select(Hashtag).where(Hashtag.tag == tag)
            )
            hashtag = result.scalar_one_or_none()
            
            if not hashtag:
                # Create new hashtag
                hashtag = Hashtag(
                    tag=tag,
                    post_count=1,
                    last_used=datetime.now(timezone.utc)
                )
                db.add(hashtag)
                await db.flush()
            else:
                # Update existing hashtag
                hashtag.post_count = (hashtag.post_count or 0) + 1
                hashtag.last_used = datetime.now(timezone.utc)
            
            # Check if link already exists
            existing_link = await db.execute(
                select(PostHashtag).where(
                    and_(
                        PostHashtag.post_id == post_id,
                        PostHashtag.hashtag_id == hashtag.id
                    )
                )
            )
            if not existing_link.scalar_one_or_none():
                # Create post-hashtag link
                link = PostHashtag(
                    post_id=post_id,
                    hashtag_id=hashtag.id
                )
                db.add(link)
            
            created_tags.append(tag)
            
        except Exception as e:
            logger.error(f"Error processing hashtag {tag}: {e}")
            continue
    
    try:
        await db.commit()
    except Exception as e:
        logger.error(f"Error committing hashtags: {e}")
        await db.rollback()
    
    return created_tags


@router.post("/hashtags/reindex")
async def reindex_hashtags(
    db: AsyncSession = Depends(get_db)
):
    """
    Admin endpoint to reindex all hashtags from existing posts.
    Should be run once after adding hashtag feature to existing database.
    """
    try:
        # Get all posts with captions
        result = await db.execute(
            select(Post).where(Post.caption.isnot(None))
        )
        posts = result.scalars().all()
        
        processed = 0
        for post in posts:
            tags = await process_post_hashtags(db, post.id, post.caption)
            if tags:
                processed += 1
        
        return {
            "success": True,
            "posts_processed": len(posts),
            "posts_with_hashtags": processed
        }
    except Exception as e:
        logger.error(f"Error reindexing hashtags: {e}")
        raise HTTPException(status_code=500, detail=str(e))
