"""
Posts interactions — likes, comments, and emoji reactions.
"""
import logging
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload
from typing import List, Optional
from datetime import datetime

from database import get_db
from models import Profile, Post, PostLike, Comment, PostReaction
from core.security import get_user_id_from_jwt_or_query
from .schemas import CommentCreate, CommentUpdate, CommentResponse, ReactionCreate, ReactionData, VALID_REACTIONS
from pydantic import BaseModel, ConfigDict
from models import CommentReaction
from utils.notifications import NotificationType

router = APIRouter()
logger = logging.getLogger(__name__)

@router.post("/posts/{post_id}/like")
async def toggle_like_post(post_id: str, user_id: str = Depends(get_user_id_from_jwt_or_query), db: AsyncSession = Depends(get_db)):
    """Toggle like on a post - if already liked, unlike it; if not liked, like it"""
    # Get the post
    result = await db.execute(select(Post).where(Post.id == post_id))
    post = result.scalar_one_or_none()
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    
    # Cross-table cleanup: if user has a PostReaction, remove it first
    # to prevent double-counting across the two reaction systems
    reaction_result = await db.execute(
        select(PostReaction).where(
            PostReaction.post_id == post_id,
            PostReaction.user_id == user_id
        )
    )
    existing_reaction = reaction_result.scalar_one_or_none()
    if existing_reaction:
        await db.delete(existing_reaction)
        post.likes_count = max(0, (post.likes_count or 1) - 1)
    
    # Check if user already liked this post
    like_result = await db.execute(
        select(PostLike).where(
            PostLike.post_id == post_id,
            PostLike.user_id == user_id
        )
    )
    existing_like = like_result.scalar_one_or_none()
    
    if existing_like:
        # Unlike - remove the like
        await db.delete(existing_like)
        post.likes_count = max(0, post.likes_count - 1)  # Prevent negative
        await db.commit()
        return {"likes_count": post.likes_count, "is_liked": False, "action": "unliked"}
    else:
        # Like - add new like
        new_like = PostLike(post_id=post_id, user_id=user_id)
        db.add(new_like)
        post.likes_count += 1
        await db.commit()
        return {"likes_count": post.likes_count, "is_liked": True, "action": "liked"}


@router.delete("/posts/{post_id}/like")
async def unlike_post(post_id: str, user_id: str = Depends(get_user_id_from_jwt_or_query), db: AsyncSession = Depends(get_db)):
    """Unlike a post"""
    # Get the post
    result = await db.execute(select(Post).where(Post.id == post_id))
    post = result.scalar_one_or_none()
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    
    # Cross-table cleanup: also remove any PostReaction for this user
    # to prevent orphaned reactions when the frontend calls unlike
    reaction_result = await db.execute(
        select(PostReaction).where(
            PostReaction.post_id == post_id,
            PostReaction.user_id == user_id
        )
    )
    existing_reaction = reaction_result.scalar_one_or_none()
    if existing_reaction:
        await db.delete(existing_reaction)
        post.likes_count = max(0, (post.likes_count or 1) - 1)
    
    # Check if user has liked this post
    like_result = await db.execute(
        select(PostLike).where(
            PostLike.post_id == post_id,
            PostLike.user_id == user_id
        )
    )
    existing_like = like_result.scalar_one_or_none()
    
    if existing_like:
        await db.delete(existing_like)
        post.likes_count = max(0, post.likes_count - 1)
    
    await db.commit()
    return {"likes_count": post.likes_count, "is_liked": False, "action": "unliked"}


@router.post("/posts/{post_id}/pin")
async def pin_post_to_profile(post_id: str, user_id: str = Depends(get_user_id_from_jwt_or_query), db: AsyncSession = Depends(get_db)):
    """Pin a post to user's profile. Only one post can be pinned at a time."""
    # Get the post
    result = await db.execute(
        select(Post).where(Post.id == post_id)
    )
    post = result.scalar_one_or_none()
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    
    # Verify the user owns this post
    if post.author_id != user_id:
        raise HTTPException(status_code=403, detail="Can only pin your own posts")
    
    # Get the user's profile
    profile_result = await db.execute(
        select(Profile).where(Profile.id == user_id)
    )
    profile = profile_result.scalar_one_or_none()
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")
    
    # If already pinned, unpin it (toggle behavior)
    if profile.pinned_post_id == post_id:
        profile.pinned_post_id = None
        await db.commit()
        return {"success": True, "pinned": False, "message": "Post unpinned from profile"}
    
    # Pin the new post (replaces any existing pinned post)
    profile.pinned_post_id = post_id
    await db.commit()
    
    return {"success": True, "pinned": True, "message": "Post pinned to profile"}


@router.delete("/posts/{post_id}/pin")
async def unpin_post_from_profile(post_id: str, user_id: str = Depends(get_user_id_from_jwt_or_query), db: AsyncSession = Depends(get_db)):
    """Unpin a post from user's profile."""
    # Get the user's profile
    profile_result = await db.execute(
        select(Profile).where(Profile.id == user_id)
    )
    profile = profile_result.scalar_one_or_none()
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")
    
    # Verify this post is currently pinned
    if profile.pinned_post_id != post_id:
        raise HTTPException(status_code=400, detail="This post is not currently pinned")
    
    # Unpin
    profile.pinned_post_id = None
    await db.commit()
    
    return {"success": True, "pinned": False, "message": "Post unpinned from profile"}


# Comment endpoints
@router.post("/posts/{post_id}/comments", response_model=CommentResponse)
async def create_comment(post_id: str, data: CommentCreate, user_id: str = Depends(get_user_id_from_jwt_or_query), db: AsyncSession = Depends(get_db)):
    """Add a comment or reply to a post"""
    # Verify post exists
    post_result = await db.execute(select(Post).where(Post.id == post_id))
    post = post_result.scalar_one_or_none()
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    
    # Verify user exists
    user_result = await db.execute(select(Profile).where(Profile.id == user_id))
    user = user_result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # If this is a reply, verify parent comment exists
    if data.parent_id:
        parent_result = await db.execute(select(Comment).where(Comment.id == data.parent_id))
        parent = parent_result.scalar_one_or_none()
        if not parent:
            raise HTTPException(status_code=404, detail="Parent comment not found")
        if parent.post_id != post_id:
            raise HTTPException(status_code=400, detail="Parent comment belongs to different post")
    
    # Create comment
    comment = Comment(
        post_id=post_id,
        author_id=user_id,
        parent_id=data.parent_id,
        content=data.content.strip()
    )
    db.add(comment)
    
    # Increment comment count
    post.comments_count = (post.comments_count or 0) + 1
    
    await db.commit()
    await db.refresh(comment)
    
    # ── Notification: alert post author / parent comment author ──────────
    from utils.notifications import send_notification, NotificationType
    
    commenter_name = user.full_name or user.username or "Someone"
    preview = (data.content.strip()[:80] + "…") if len(data.content.strip()) > 80 else data.content.strip()
    
    if data.parent_id and parent:
        # Reply to a comment — notify the parent comment author
        if parent.author_id != user_id:
            await send_notification(
                db,
                user_id=parent.author_id,
                type=NotificationType.COMMENT_REPLY,
                title="New Reply",
                body=f'{commenter_name} replied to your comment: "{preview}"',
                data={"post_id": post_id, "comment_id": comment.id, "parent_comment_id": data.parent_id},
                action_url=f"/post/{post_id}",
            )
        # Also notify the post author if they're different from both commenter & parent author
        if post.author_id != user_id and post.author_id != parent.author_id:
            await send_notification(
                db,
                user_id=post.author_id,
                type=NotificationType.POST_COMMENT,
                title="New Comment",
                body=f'{commenter_name} replied to a comment on your post: "{preview}"',
                data={"post_id": post_id, "comment_id": comment.id},
                action_url=f"/post/{post_id}",
            )
    else:
        # Top-level comment — notify the post author
        if post.author_id != user_id:
            await send_notification(
                db,
                user_id=post.author_id,
                type=NotificationType.POST_COMMENT,
                title="New Comment",
                body=f'{commenter_name} commented on your post: "{preview}"',
                data={"post_id": post_id, "comment_id": comment.id},
                action_url=f"/post/{post_id}",
            )
    
    await db.commit()  # Persist notification records
    
    return CommentResponse(
        id=comment.id,
        post_id=comment.post_id,
        author_id=comment.author_id,
        author_name=user.full_name if user.full_name else 'Unknown',
        author_username=user.username,
        author_avatar=user.avatar_url,
        content=comment.content,
        created_at=comment.created_at,
        is_edited=comment.is_edited or False,
        edited_at=comment.edited_at
    )


@router.get("/posts/{post_id}/comments")
async def get_comments(
    post_id: str, 
    limit: int = 50, 
    viewer_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """Get all comments for a post with reaction counts and nested replies"""
    from models import CommentReaction
    
    # Verify post exists
    post_result = await db.execute(select(Post).where(Post.id == post_id))
    post = post_result.scalar_one_or_none()
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    
    # Get top-level comments (parent_id is null) with authors, reactions, and replies
    result = await db.execute(
        select(Comment)
        .options(
            selectinload(Comment.author), 
            selectinload(Comment.reactions),
            selectinload(Comment.replies).selectinload(Comment.author),
            selectinload(Comment.replies).selectinload(Comment.reactions)
        )
        .where(Comment.post_id == post_id, Comment.parent_id.is_(None))
        .order_by(Comment.created_at.asc())
        .limit(limit)
    )
    comments = result.scalars().all()
    
    def format_comment(c, include_replies=True):
        """Helper to format a comment with reaction data"""
        reactions = c.reactions or []
        reaction_count = len(reactions)
        viewer_reaction = None
        
        # Group reactions by emoji
        emoji_counts = {}
        for r in reactions:
            emoji_counts[r.emoji] = emoji_counts.get(r.emoji, 0) + 1
            if viewer_id and r.user_id == viewer_id:
                viewer_reaction = r.emoji
        
        comment_data = {
            "id": c.id,
            "post_id": c.post_id,
            "author_id": c.author_id,
            "author_name": c.author.full_name if c.author else 'Unknown',
            "author_username": c.author.username if c.author else None,
            "author_avatar": c.author.avatar_url if c.author else None,
            "content": c.content,
            "parent_id": c.parent_id,
            "created_at": c.created_at.isoformat() if c.created_at else None,
            "is_edited": c.is_edited or False,
            "edited_at": c.edited_at.isoformat() if c.edited_at else None,
            "reaction_count": reaction_count,
            "emoji_counts": emoji_counts,
            "viewer_reaction": viewer_reaction,
            "replies": []
        }
        
        # Include replies if requested
        if include_replies and hasattr(c, 'replies') and c.replies:
            comment_data["replies"] = [format_comment(r, include_replies=False) for r in sorted(c.replies, key=lambda x: x.created_at)]
            comment_data["reply_count"] = len(c.replies)
        else:
            comment_data["reply_count"] = 0
        
        return comment_data
    
    return [format_comment(c) for c in comments]


@router.delete("/posts/{post_id}/comments/{comment_id}")
async def delete_comment(post_id: str, comment_id: str, user_id: str = Depends(get_user_id_from_jwt_or_query), db: AsyncSession = Depends(get_db)):
    """Delete a comment (only by author)"""
    # Get comment
    result = await db.execute(
        select(Comment).where(Comment.id == comment_id, Comment.post_id == post_id)
    )
    comment = result.scalar_one_or_none()
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")
    
    # Check ownership
    if comment.author_id != user_id:
        raise HTTPException(status_code=403, detail="Not authorized to delete this comment")
    
    # Get post to decrement count
    post_result = await db.execute(select(Post).where(Post.id == post_id))
    post = post_result.scalar_one_or_none()
    if post:
        post.comments_count = max(0, (post.comments_count or 1) - 1)
    
    await db.delete(comment)
    await db.commit()
    
    return {"message": "Comment deleted", "success": True}


@router.put("/posts/{post_id}/comments/{comment_id}", response_model=CommentResponse)
async def edit_comment(
    post_id: str, 
    comment_id: str, 
    data: CommentUpdate, 
    user_id: str = Depends(get_user_id_from_jwt_or_query), 
    db: AsyncSession = Depends(get_db)
):
    """Edit a comment (only by author). Shows 'edited' label after edit."""
    from datetime import timezone
    
    # Verify the post exists
    post_result = await db.execute(select(Post).where(Post.id == post_id))
    post = post_result.scalar_one_or_none()
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    
    # Get the comment with author
    result = await db.execute(
        select(Comment)
        .options(selectinload(Comment.author))
        .where(Comment.id == comment_id, Comment.post_id == post_id)
    )
    comment = result.scalar_one_or_none()
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")
    
    # Check ownership - only author can edit
    if comment.author_id != user_id:
        raise HTTPException(status_code=403, detail="Not authorized to edit this comment")
    
    # Validate content
    if not data.content or not data.content.strip():
        raise HTTPException(status_code=400, detail="Comment content cannot be empty")
    
    if len(data.content) > 2000:
        raise HTTPException(status_code=400, detail="Comment cannot exceed 2000 characters")
    
    # Update the comment
    comment.content = data.content.strip()
    comment.is_edited = True
    comment.edited_at = datetime.now(timezone.utc)
    
    await db.commit()
    await db.refresh(comment)
    
    return CommentResponse(
        id=comment.id,
        post_id=comment.post_id,
        author_id=comment.author_id,
        author_name=comment.author.full_name if comment.author else 'Unknown',
        author_username=comment.author.username if comment.author else None,
        author_avatar=comment.author.avatar_url if comment.author else None,
        content=comment.content,
        created_at=comment.created_at,
        is_edited=comment.is_edited,
        edited_at=comment.edited_at
    )


# Comment Reaction endpoints
VALID_COMMENT_REACTIONS = ['❤️', '🤙', '🌊', '🔥']

class CommentReactionCreate(BaseModel):
    emoji: str = '❤️'

class CommentReactionResponse(BaseModel):
    id: str
    comment_id: str
    user_id: str
    user_name: Optional[str] = None
    emoji: str
    created_at: datetime
    
    model_config = ConfigDict(from_attributes=True)


@router.post("/comments/{comment_id}/reactions")
async def toggle_comment_reaction(
    comment_id: str, 
    data: CommentReactionCreate,
    user_id: str = Depends(get_user_id_from_jwt_or_query), 
    db: AsyncSession = Depends(get_db)
):
    """Toggle a reaction on a comment - like/unlike"""
    from models import CommentReaction, Comment
    
    # Validate emoji
    if data.emoji not in VALID_COMMENT_REACTIONS:
        raise HTTPException(status_code=400, detail=f"Invalid reaction. Use one of: {VALID_COMMENT_REACTIONS}")
    
    # Verify comment exists
    comment_result = await db.execute(select(Comment).where(Comment.id == comment_id))
    comment = comment_result.scalar_one_or_none()
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")
    
    # Verify user exists
    user_result = await db.execute(select(Profile).where(Profile.id == user_id))
    user = user_result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Check if user already reacted
    existing_result = await db.execute(
        select(CommentReaction).where(
            CommentReaction.comment_id == comment_id,
            CommentReaction.user_id == user_id
        )
    )
    existing = existing_result.scalar_one_or_none()
    
    if existing:
        if existing.emoji == data.emoji:
            # Same emoji - remove reaction (toggle off)
            await db.delete(existing)
            await db.commit()
            return {"action": "removed", "emoji": data.emoji, "comment_id": comment_id}
        else:
            # Different emoji - update reaction
            existing.emoji = data.emoji
            await db.commit()
            return {"action": "updated", "emoji": data.emoji, "comment_id": comment_id}
    else:
        # Add new reaction
        reaction = CommentReaction(
            comment_id=comment_id,
            user_id=user_id,
            emoji=data.emoji
        )
        db.add(reaction)
        await db.commit()
        return {"action": "added", "emoji": data.emoji, "comment_id": comment_id}


@router.get("/comments/{comment_id}/reactions")
async def get_comment_reactions(
    comment_id: str,
    viewer_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """Get all reactions on a comment"""
    from models import CommentReaction
    
    result = await db.execute(
        select(CommentReaction)
        .options(selectinload(CommentReaction.user))
        .where(CommentReaction.comment_id == comment_id)
        .order_by(CommentReaction.created_at.desc())
    )
    reactions = result.scalars().all()
    
    reaction_list = []
    viewer_reaction = None
    
    for r in reactions:
        reaction_data = {
            "id": r.id,
            "comment_id": r.comment_id,
            "user_id": r.user_id,
            "user_name": r.user.full_name if r.user else None,
            "emoji": r.emoji,
            "created_at": r.created_at.isoformat() if r.created_at else None
        }
        reaction_list.append(reaction_data)
        if viewer_id and r.user_id == viewer_id:
            viewer_reaction = r.emoji
    
    return {
        "reactions": reaction_list,
        "count": len(reaction_list),
        "viewer_reaction": viewer_reaction
    }


# Post Reaction endpoints
@router.post("/posts/{post_id}/reactions")
async def toggle_reaction(post_id: str, data: ReactionCreate, user_id: str = Depends(get_user_id_from_jwt_or_query), db: AsyncSession = Depends(get_db)):
    """Toggle a reaction on a post - one reaction per user. If same emoji, remove it. If different, replace it."""
    # Validate emoji
    if data.emoji not in VALID_REACTIONS:
        raise HTTPException(status_code=400, detail=f"Invalid reaction. Use one of: {VALID_REACTIONS}")
    
    # Verify post exists
    post_result = await db.execute(select(Post).where(Post.id == post_id))
    post = post_result.scalar_one_or_none()
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    
    # Verify user exists
    user_result = await db.execute(select(Profile).where(Profile.id == user_id))
    user = user_result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Cross-table cleanup: if user has a PostLike, remove it first
    # to prevent double-counting across the two reaction systems
    like_result = await db.execute(
        select(PostLike).where(
            PostLike.post_id == post_id,
            PostLike.user_id == user_id
        )
    )
    existing_like = like_result.scalar_one_or_none()
    had_like = existing_like is not None
    if existing_like:
        await db.delete(existing_like)
        post.likes_count = max(0, (post.likes_count or 1) - 1)
    
    # Check if user already has ANY reaction on this post
    existing_result = await db.execute(
        select(PostReaction).where(
            PostReaction.post_id == post_id,
            PostReaction.user_id == user_id
        )
    )
    existing = existing_result.scalar_one_or_none()
    
    if existing:
        if existing.emoji == data.emoji:
            # Same emoji - remove it (toggle off)
            await db.delete(existing)
            # Decrement likes_count so the reaction count stays visible
            post.likes_count = max(0, (post.likes_count or 1) - 1)
            await db.commit()
            return {"action": "removed", "emoji": data.emoji, "post_id": post_id, "likes_count": post.likes_count}
        else:
            # Different emoji - replace it (no count change)
            old_emoji = existing.emoji
            existing.emoji = data.emoji
            await db.commit()
            return {"action": "changed", "emoji": data.emoji, "old_emoji": old_emoji, "post_id": post_id, "likes_count": post.likes_count}
    else:
        # No existing reaction - add new one
        reaction = PostReaction(
            post_id=post_id,
            user_id=user_id,
            emoji=data.emoji
        )
        db.add(reaction)
        # Increment likes_count so the reaction shows in the visible count
        post.likes_count = (post.likes_count or 0) + 1
        await db.commit()
        return {"action": "added", "emoji": data.emoji, "post_id": post_id, "likes_count": post.likes_count}


@router.get("/posts/{post_id}/reactions")
async def get_post_reactions(post_id: str, db: AsyncSession = Depends(get_db)):
    """Get all reactions for a post"""
    # Verify post exists
    post_result = await db.execute(select(Post).where(Post.id == post_id))
    post = post_result.scalar_one_or_none()
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    
    # Get reactions with user info
    result = await db.execute(
        select(PostReaction)
        .options(selectinload(PostReaction.user))
        .where(PostReaction.post_id == post_id)
    )
    reactions = result.scalars().all()
    
    return [
        {
            "emoji": r.emoji,
            "user_id": r.user_id,
            "user_name": r.user.full_name if r.user else None,
            "created_at": r.created_at
        } for r in reactions
    ]

