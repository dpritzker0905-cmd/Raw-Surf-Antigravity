"""
Social Live Comments & Interactions
Handles real-time commenting and likes on social live broadcasts.
Extracted from social_live.py (v95 audit) for pre-emptive LOC governance.

v97: Upgraded to Redis-backed persistence with in-memory fallback.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timezone
import json
import logging
import os

from database import get_db
from models import SocialLiveStream
from core.security import get_user_id_from_jwt_or_query, get_current_user_id

router = APIRouter()
logger = logging.getLogger(__name__)


# ============================================================
# REDIS CONNECTION (with in-memory fallback)
# ============================================================

_redis_client = None
_redis_available = False


def _get_redis():
    """Lazy-init Redis connection. Returns None if unavailable."""
    global _redis_client, _redis_available
    if _redis_client is not None:
        return _redis_client if _redis_available else None

    redis_url = os.environ.get("REDIS_URL")
    if not redis_url:
        logger.info("[LiveComments] No REDIS_URL set, using in-memory fallback")
        _redis_available = False
        _redis_client = False  # sentinel: attempted but unavailable
        return None

    try:
        import redis
        _redis_client = redis.from_url(redis_url, decode_responses=True, socket_timeout=2)
        _redis_client.ping()
        _redis_available = True
        logger.info("[LiveComments] Redis connected for comment persistence")
        return _redis_client
    except Exception as e:
        logger.warning(f"[LiveComments] Redis unavailable ({e}), using in-memory fallback")
        _redis_available = False
        _redis_client = False
        return None


# In-memory fallback stores (used when Redis is unavailable)
_mem_comments = {}   # {stream_id: [comment_dict, ...]}
_mem_likes = {}      # {comment_id: set(user_ids)}

COMMENTS_KEY = "live_comments:{stream_id}"
LIKES_KEY = "comment_likes:{comment_id}"
MAX_COMMENTS_PER_STREAM = 200
COMMENT_TTL_SECONDS = 86400  # 24 hours


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
    r = _get_redis()
    if r:
        key = COMMENTS_KEY.format(stream_id=stream_id)
        raw = r.lrange(key, -limit, -1)
        comments = [json.loads(c) for c in raw]
        total = r.llen(key)
    else:
        all_comments = _mem_comments.get(stream_id, [])
        comments = all_comments[-limit:] if len(all_comments) > limit else all_comments
        total = len(all_comments)

    return {"comments": comments, "total_count": total}


@router.post("/social-live/{stream_id}/comments")
async def post_live_comment(
    stream_id: str,
    data: LiveCommentRequest,
    db: AsyncSession = Depends(get_db),
    current_user_id: str = Depends(get_current_user_id)
):
    """Post a comment to a live stream"""
    if data.user_id != current_user_id:
        raise HTTPException(status_code=403, detail="Forbidden: user_id does not match the authenticated user.")
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

    comment = {
        "id": str(uuid.uuid4()),
        "user_id": data.user_id,
        "user_name": data.user_name,
        "avatar_url": data.avatar_url,
        "text": data.text[:500],
        "created_at": datetime.now(timezone.utc).isoformat()
    }

    r = _get_redis()
    if r:
        key = COMMENTS_KEY.format(stream_id=stream_id)
        r.rpush(key, json.dumps(comment))
        r.ltrim(key, -MAX_COMMENTS_PER_STREAM, -1)
        r.expire(key, COMMENT_TTL_SECONDS)
    else:
        if stream_id not in _mem_comments:
            _mem_comments[stream_id] = []
        _mem_comments[stream_id].append(comment)
        if len(_mem_comments[stream_id]) > MAX_COMMENTS_PER_STREAM:
            _mem_comments[stream_id] = _mem_comments[stream_id][-MAX_COMMENTS_PER_STREAM:]

    return {"success": True, "comment": comment}


@router.post("/social-live/{stream_id}/like")
async def toggle_live_like(
    stream_id: str,
    user_id: str = Depends(get_user_id_from_jwt_or_query),
    action: str = Query(default="like"),
    db: AsyncSession = Depends(get_db)
):
    """Toggle like on a live stream"""
    result = await db.execute(
        select(SocialLiveStream).where(SocialLiveStream.id == stream_id)
    )
    stream = result.scalar_one_or_none()
    if not stream:
        raise HTTPException(status_code=404, detail="Stream not found")
    return {"success": True, "action": action}


@router.post("/social-live/{stream_id}/comments/{comment_id}/like")
async def toggle_comment_like(
    stream_id: str,
    comment_id: str,
    data: dict,
    current_user_id: str = Depends(get_current_user_id)
):
    """Toggle like on a live stream comment"""
    user_id = data.get("user_id")
    liked = data.get("liked", True)

    if not user_id:
        raise HTTPException(status_code=400, detail="user_id required")
        
    if user_id != current_user_id:
        raise HTTPException(status_code=403, detail="Forbidden: user_id does not match the authenticated user.")

    r = _get_redis()
    if r:
        key = LIKES_KEY.format(comment_id=comment_id)
        if liked:
            r.sadd(key, user_id)
        else:
            r.srem(key, user_id)
        r.expire(key, COMMENT_TTL_SECONDS)
        like_count = r.scard(key)
        liked_by = list(r.smembers(key))
    else:
        if comment_id not in _mem_likes:
            _mem_likes[comment_id] = set()
        if liked:
            _mem_likes[comment_id].add(user_id)
        else:
            _mem_likes[comment_id].discard(user_id)
        like_count = len(_mem_likes[comment_id])
        liked_by = list(_mem_likes[comment_id])

    # Update the comment in-memory store (for non-Redis path)
    if not r and stream_id in _mem_comments:
        for comment in _mem_comments[stream_id]:
            if comment.get("id") == comment_id:
                comment["likes"] = like_count
                comment["liked_by"] = liked_by
                break

    return {"success": True, "liked": liked, "likes": like_count}
