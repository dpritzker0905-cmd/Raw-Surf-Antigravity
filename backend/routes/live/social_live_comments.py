"""
Social Live Comments & Interactions
Handles real-time commenting and likes on social live broadcasts.
Extracted from social_live.py (v95 audit) for pre-emptive LOC governance.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timezone

from database import get_db
from models import SocialLiveStream
from core.security import get_user_id_from_jwt_or_query

router = APIRouter()

# In-memory store for live comments (could be Redis in production)
# Format: {stream_id: [comment_dict, ...]}
live_comments_store = {}


class LiveCommentRequest(BaseModel):
    user_id: str
    user_name: str
    avatar_url: Optional[str] = None
    text: str


class LiveCommentResponse(BaseModel):
    id: str
    user_id: str
    user_name: str
    avatar_url: Optional[str]
    text: str
    created_at: datetime


@router.get("/social-live/{stream_id}/comments")
async def get_live_comments(
    stream_id: str,
    limit: int = Query(default=50, le=100)
):
    """Get live comments for a stream"""
    comments = live_comments_store.get(stream_id, [])
    # Return the most recent comments
    return {
        "comments": comments[-limit:] if len(comments) > limit else comments,
        "total_count": len(comments)
    }


@router.post("/social-live/{stream_id}/comments")
async def post_live_comment(
    stream_id: str,
    data: LiveCommentRequest,
    db: AsyncSession = Depends(get_db)
):
    """Post a comment to a live stream"""
    import uuid
    
    # Verify stream exists and is live
    result = await db.execute(
        select(SocialLiveStream).where(SocialLiveStream.id == stream_id)
    )
    stream = result.scalar_one_or_none()
    
    if not stream:
        raise HTTPException(status_code=404, detail="Stream not found")
    
    if stream.status != 'live':
        raise HTTPException(status_code=400, detail="Stream is not live")
    
    # Create comment
    comment = {
        "id": str(uuid.uuid4()),
        "user_id": data.user_id,
        "user_name": data.user_name,
        "avatar_url": data.avatar_url,
        "text": data.text[:500],  # Limit comment length
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    
    # Add to in-memory store
    if stream_id not in live_comments_store:
        live_comments_store[stream_id] = []
    
    live_comments_store[stream_id].append(comment)
    
    # Keep only last 200 comments per stream
    if len(live_comments_store[stream_id]) > 200:
        live_comments_store[stream_id] = live_comments_store[stream_id][-200:]
    
    return {"success": True, "comment": comment}


@router.post("/social-live/{stream_id}/like")
async def toggle_live_like(
    stream_id: str,
    user_id: str = Depends(get_user_id_from_jwt_or_query),
    action: str = Query(default="like"),  # "like" or "unlike"
    db: AsyncSession = Depends(get_db)
):
    """Toggle like on a live stream"""
    result = await db.execute(
        select(SocialLiveStream).where(SocialLiveStream.id == stream_id)
    )
    stream = result.scalar_one_or_none()
    
    if not stream:
        raise HTTPException(status_code=404, detail="Stream not found")
    
    # For simplicity, we're not persisting individual likes
    # In production, you'd want a separate likes table
    return {"success": True, "action": action}


# In-memory store for comment likes (per comment_id -> set of user_ids)
comment_likes_store = {}

@router.post("/social-live/{stream_id}/comments/{comment_id}/like")
async def toggle_comment_like(
    stream_id: str,
    comment_id: str,
    data: dict,
    db: AsyncSession = Depends(get_db)
):
    """Toggle like on a live stream comment"""
    user_id = data.get("user_id")
    liked = data.get("liked", True)
    
    if not user_id:
        raise HTTPException(status_code=400, detail="user_id required")
    
    # Initialize likes store for this comment
    if comment_id not in comment_likes_store:
        comment_likes_store[comment_id] = set()
    
    # Toggle like
    if liked:
        comment_likes_store[comment_id].add(user_id)
    else:
        comment_likes_store[comment_id].discard(user_id)
    
    # Update the comment in the store with new like count
    if stream_id in live_comments_store:
        for comment in live_comments_store[stream_id]:
            if comment.get("id") == comment_id:
                comment["likes"] = len(comment_likes_store[comment_id])
                comment["liked_by"] = list(comment_likes_store[comment_id])
                break
    
    return {
        "success": True, 
        "liked": liked,
        "likes": len(comment_likes_store[comment_id])
    }
