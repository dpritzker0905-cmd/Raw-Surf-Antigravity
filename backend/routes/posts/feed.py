"""
Posts feed — create, list, single post detail, spot-tagged posts, grom preview.
"""
import logging
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_
from sqlalchemy.orm import selectinload
from typing import List, Optional
from datetime import datetime, timedelta

from database import get_db
from models import Profile, Post, PostLike, Comment, PostReaction, PostCollaboration, SurfSpot, RoleEnum
from core.security import get_user_id_from_jwt_or_query, get_optional_user_id_from_jwt_or_query
from .schemas import (
    PostCreate, PostResponse, CommentResponse, ReactionData, CollaboratorData, SpotData
)
from models import Notification

router = APIRouter()
logger = logging.getLogger(__name__)

@router.post("/posts", response_model=PostResponse)
async def create_post(author_id: str, data: PostCreate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Profile).where(Profile.id == author_id))
    profile = result.scalar_one_or_none()
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")
    
    # Reject future-dated sessions (allow 1-day buffer for international timezones up to UTC+14)
    if data.session_date and data.session_date > datetime.utcnow() + timedelta(days=1):
        raise HTTPException(status_code=400, detail="Session date cannot be in the future")
    
    post = Post(
        author_id=author_id,
        media_url=data.media_url,
        media_type=data.media_type,
        thumbnail_url=data.thumbnail_url,
        caption=data.caption,
        location=data.location,
        video_width=data.video_width,
        video_height=data.video_height,
        video_duration=data.video_duration,
        was_transcoded=data.was_transcoded or False,
        # Session metadata
        session_date=data.session_date,
        session_start_time=data.session_start_time,
        session_end_time=data.session_end_time,
        wave_height_ft=data.wave_height_ft,
        wave_period_sec=data.wave_period_sec,
        wave_direction=data.wave_direction,
        wave_direction_degrees=data.wave_direction_degrees,
        wind_speed_mph=data.wind_speed_mph,
        wind_direction=data.wind_direction,
        tide_status=data.tide_status,
        tide_height_ft=data.tide_height_ft,
        conditions_source=data.conditions_source or 'manual'
    )
    
    db.add(post)
    await db.flush()
    
    # Send mention notifications
    if data.mentions:
        from models import Notification
        import json
        for mention in data.mentions:
            if mention.get('user_id') and mention.get('user_id') != author_id:
                notification = Notification(
                    user_id=mention['user_id'],
                    type='mention',
                    title='You were mentioned',
                    body=f"{profile.full_name or 'Someone'} mentioned you in a post",
                    data=json.dumps({
                        "post_id": post.id,
                        "author_id": author_id,
                        "author_name": profile.full_name
                    })
                )
                db.add(notification)
    
    await db.commit()
    await db.refresh(post)
    
    return PostResponse(
        id=post.id,
        author_id=post.author_id,
        author_name=profile.full_name,
        author_username=profile.username,
        author_avatar=profile.avatar_url,
        author_role=profile.role.value if profile.role else None,
        media_url=post.media_url,
        media_type=post.media_type,
        thumbnail_url=post.thumbnail_url,
        caption=post.caption,
        location=post.location,
        likes_count=post.likes_count,
        comments_count=0,
        video_width=post.video_width,
        video_height=post.video_height,
        video_duration=post.video_duration,
        was_transcoded=post.was_transcoded or False,
        created_at=post.created_at,
        recent_comments=[],
        # Session metadata
        session_date=post.session_date,
        session_start_time=post.session_start_time,
        session_end_time=post.session_end_time,
        wave_height_ft=post.wave_height_ft,
        wave_period_sec=post.wave_period_sec,
        wave_direction=post.wave_direction,
        wave_direction_degrees=post.wave_direction_degrees,
        wind_speed_mph=post.wind_speed_mph,
        wind_direction=post.wind_direction,
        tide_status=post.tide_status,
        tide_height_ft=post.tide_height_ft,
        conditions_source=post.conditions_source
    )

@router.get("/posts")
async def get_feed(limit: int = 50, user_id: Optional[str] = Depends(get_optional_user_id_from_jwt_or_query), db: AsyncSession = Depends(get_db)):
    """
    Get feed posts with privacy enforcement.
    
    Privacy Rules:
    - Public accounts (is_private=False): Posts visible to everyone
    - Private accounts (is_private=True): Posts only visible to:
      - The author themselves
      - Accepted followers (mutual friends)
    """
    # First, get the viewer's accepted friends (if viewing user is provided)
    viewer_friend_ids = set()
    if user_id:
        from models import Friend, FriendshipStatusEnum
        friends_result = await db.execute(
            select(Friend.requester_id, Friend.addressee_id).where(
                and_(
                    or_(Friend.requester_id == user_id, Friend.addressee_id == user_id),
                    Friend.status == FriendshipStatusEnum.ACCEPTED
                )
            )
        )
        for row in friends_result:
            if row.requester_id == user_id:
                viewer_friend_ids.add(row.addressee_id)
            else:
                viewer_friend_ids.add(row.requester_id)
    
    result = await db.execute(
        select(Post)
        .where(Post.media_url.isnot(None))  # Only fetch posts with media
        .options(
            selectinload(Post.author), 
            selectinload(Post.comments).selectinload(Comment.author),
            selectinload(Post.reactions).selectinload(PostReaction.user),
            selectinload(Post.likes).selectinload(PostLike.user),
            selectinload(Post.collaborators).selectinload(PostCollaboration.user),
            selectinload(Post.spot)
        )
        .order_by(Post.created_at.desc())
        .limit(limit * 2)  # Fetch extra to account for filtered private posts
    )
    posts = result.scalars().all()
    
    # Get liked post IDs for the current user
    liked_post_ids = set()
    saved_post_ids = set()
    if user_id:
        likes_result = await db.execute(
            select(PostLike.post_id).where(PostLike.user_id == user_id)
        )
        liked_post_ids = {row[0] for row in likes_result.fetchall()}
        
        # Get saved post IDs for the current user
        from models import SavedPost
        saved_result = await db.execute(
            select(SavedPost.post_id).where(SavedPost.user_id == user_id)
        )
        saved_post_ids = {row[0] for row in saved_result.fetchall()}
    
    response = []
    for p in posts:
        # Skip posts without media_url (invalid posts)
        if not p.media_url:
            continue
        
        # PRIVACY ENFORCEMENT: Check if post author has private account
        if p.author and getattr(p.author, 'is_private', False):
            # Private account - only show to:
            # 1. The author themselves
            # 2. Accepted followers (friends)
            if user_id:
                is_own_post = str(p.author_id) == str(user_id)
                is_friend = str(p.author_id) in viewer_friend_ids
                if not is_own_post and not is_friend:
                    continue  # Skip this post - viewer can't see it
            else:
                # No viewer - skip all private posts
                continue
        
        # Stop if we have enough posts
        if len(response) >= limit:
            break
            
        # Get last 2 comments for inline display
        recent_comments = sorted(p.comments, key=lambda c: c.created_at, reverse=True)[:2]
        recent_comments.reverse()  # Show oldest first of the 2
        
        # Get reactions
        reactions_data = [
            ReactionData(
                emoji=r.emoji,
                user_id=r.user_id,
                user_name=r.user.full_name if r.user else None,
                avatar_url=r.user.avatar_url if r.user else None,
                user_role=r.user.role.value if (r.user and r.user.role) else None
            ) for r in p.reactions
        ]
        
        for like in getattr(p, 'likes', []):
            reactions_data.append(ReactionData(
                emoji="🤙",
                user_id=like.user_id,
                user_name=like.user.full_name if getattr(like, 'user', None) else None,
                avatar_url=like.user.avatar_url if getattr(like, 'user', None) else None,
                user_role=like.user.role.value if (getattr(like, "user", None) and like.user.role) else None
            ))
        
        # Get accepted collaborators
        accepted_collaborators = [
            c for c in (p.collaborators or []) if c.status == 'accepted'
        ]
        collaborators_data = [
            CollaboratorData(
                id=c.id,
                user_id=c.user_id,
                full_name=c.user.full_name if c.user else None,
                username=c.user.username if c.user else None,
                avatar_url=c.user.avatar_url if c.user else None,
                status=c.status,
                verified_by_gps=c.verified_by_gps or False
            ) for c in accepted_collaborators
        ]
        
        # Get spot data if available
        spot_data = None
        if p.spot:
            spot_data = SpotData(
                id=p.spot.id,
                name=p.spot.name,
                region=p.spot.region
            )
        
        response.append(PostResponse(
            id=p.id,
            author_id=p.author_id,
            author_name=p.author.full_name,
            author_username=p.author.username if p.author else None,
            author_avatar=p.author.avatar_url,
            author_role=p.author.role.value if p.author.role else None,
            media_url=p.media_url,
            media_type=p.media_type or 'image',
            thumbnail_url=p.thumbnail_url,
            caption=p.caption,
            location=p.location,
            likes_count=p.likes_count or 0,
            comments_count=p.comments_count or len(p.comments) or 0,
            is_liked_by_user=p.id in liked_post_ids,
            saved=p.id in saved_post_ids,
            reactions=reactions_data,
            video_width=p.video_width,
            video_height=p.video_height,
            video_duration=p.video_duration,
            was_transcoded=p.was_transcoded or False,
            created_at=p.created_at,
            recent_comments=[
                CommentResponse(
                    id=c.id,
                    post_id=c.post_id,
                    author_id=c.author_id,
                    author_name=c.author.full_name if c.author else 'Unknown',
                    author_username=c.author.username if c.author else None,
                    author_avatar=c.author.avatar_url if c.author else None,
                    content=c.content,
                    created_at=c.created_at,
                    is_edited=c.is_edited or False,
                    edited_at=c.edited_at
                ) for c in recent_comments
            ],
            # Session Log Metadata
            session_date=p.session_date,
            session_start_time=p.session_start_time,
            session_end_time=p.session_end_time,
            session_label=p.session_label,
            wave_height_ft=p.wave_height_ft,
            wave_period_sec=p.wave_period_sec,
            wave_direction=p.wave_direction,
            wave_direction_degrees=p.wave_direction_degrees,
            wind_speed_mph=p.wind_speed_mph,
            wind_direction=p.wind_direction,
            tide_height_ft=p.tide_height_ft,
            tide_status=p.tide_status,
            conditions_source=p.conditions_source,
            # Spot
            spot=spot_data,
            # Collaborators
            collaborators=collaborators_data,
            collaborator_count=len(accepted_collaborators),
            # Check-in fields
            is_check_in=p.is_check_in or False,
            check_in_spot_name=getattr(p, 'check_in_spot_name', None),
            check_in_conditions=getattr(p, 'check_in_conditions', None),
            # Session Log fields
            is_session_log=p.is_session_log or False,
            session_invite_open=p.session_invite_open or False,
            session_spots_left=p.session_spots_left,
            session_price_per_person=p.session_price_per_person,
            booking_id=p.booking_id,
            # Post settings
            hide_like_count=p.hide_like_count or False,
            comments_disabled=p.comments_disabled or False
        ))
    
    return response


@router.get("/posts/spot/{spot_id}")
async def get_posts_by_spot(
    spot_id: str,
    limit: int = Query(default=50, le=100),
    viewer_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db)
):
    """
    Get posts TAGGED to a specific surf spot.
    Only returns posts where spot_id matches the requested spot.
    Separates posts by author role (photographer vs regular user).
    """
    # Fetch posts tagged to this specific spot
    result = await db.execute(
        select(Post)
        .where(Post.spot_id == spot_id)  # Only posts tagged to this spot
        .where(Post.media_url.isnot(None))
        .options(
            selectinload(Post.author),
            selectinload(Post.spot)
        )
        .order_by(Post.created_at.desc())
        .limit(limit)
    )
    posts = result.scalars().all()
    
    # Get liked post IDs for the current user
    liked_post_ids = set()
    if viewer_id:
        likes_result = await db.execute(
            select(PostLike.post_id).where(PostLike.user_id == viewer_id)
        )
        liked_post_ids = {row[0] for row in likes_result.fetchall()}
    
    photographer_posts = []
    user_posts = []
    
    # Define photographer roles for filtering
    photographer_roles = [RoleEnum.PHOTOGRAPHER, RoleEnum.APPROVED_PRO, RoleEnum.HOBBYIST]
    
    for p in posts:
        if not p.author:
            continue
            
        # Check if author is a photographer type
        is_photographer = p.author.role in photographer_roles
        
        post_data = {
            "id": p.id,
            "media_url": p.media_url,
            "thumbnail_url": p.thumbnail_url,
            "media_type": p.media_type or "image",
            "caption": p.caption,
            "likes_count": p.likes_count or 0,
            "comments_count": p.comments_count or 0,
            "author_id": p.author_id,
            "author_name": p.author.full_name if p.author else None,
            "author_username": p.author.username if p.author else None,
            "author_avatar": p.author.avatar_url if p.author else None,
            "author_role": p.author.role.value if p.author and p.author.role else None,
            "is_pro": is_photographer,
            "is_liked": p.id in liked_post_ids,
            "created_at": p.created_at.isoformat() if p.created_at else None,
            "spot_name": p.spot.name if p.spot else None
        }
        
        # Separate by author role
        if is_photographer:
            photographer_posts.append(post_data)
        else:
            user_posts.append(post_data)
    
    return {
        "photographer_posts": photographer_posts,
        "user_posts": user_posts,
        "total": len(posts),
        "spot_id": spot_id
    }


@router.get("/posts/{post_id}", response_model=PostResponse)
async def get_single_post(
    post_id: str, 
    viewer_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db)
):
    """Get a single post by ID with full details"""
    result = await db.execute(
        select(Post)
        .options(
            selectinload(Post.author), 
            selectinload(Post.comments).selectinload(Comment.author),
            selectinload(Post.reactions).selectinload(PostReaction.user),
            selectinload(Post.likes).selectinload(PostLike.user),
            selectinload(Post.collaborators).selectinload(PostCollaboration.user),
            selectinload(Post.spot)
        )
        .where(Post.id == post_id)
    )
    post = result.scalar_one_or_none()
    
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    
    # Check if viewer has liked this post
    is_liked = False
    is_saved = False
    if viewer_id:
        like_result = await db.execute(
            select(PostLike).where(
                PostLike.post_id == post_id,
                PostLike.user_id == viewer_id
            )
        )
        is_liked = like_result.scalar_one_or_none() is not None
        
        # Check if saved
        from models import SavedPost
        saved_result = await db.execute(
            select(SavedPost).where(
                SavedPost.post_id == post_id,
                SavedPost.user_id == viewer_id
            )
        )
        is_saved = saved_result.scalar_one_or_none() is not None
    
    # Get last 2 comments for inline display
    recent_comments = sorted(post.comments, key=lambda c: c.created_at, reverse=True)[:2]
    recent_comments.reverse()
    
    # Get reactions
    reactions_data = [
        ReactionData(
            emoji=r.emoji,
            user_id=r.user_id,
            user_name=r.user.full_name if r.user else None,
            avatar_url=r.user.avatar_url if r.user else None,
            user_role=r.user.role.value if (r.user and r.user.role) else None
        ) for r in post.reactions
    ]
    
    for like in getattr(post, 'likes', []):
        reactions_data.append(ReactionData(
            emoji="🤙",
            user_id=like.user_id,
            user_name=like.user.full_name if getattr(like, 'user', None) else None,
            avatar_url=like.user.avatar_url if getattr(like, 'user', None) else None,
            user_role=like.user.role.value if (getattr(like, "user", None) and like.user.role) else None
        ))
    
    # Get accepted collaborators
    accepted_collaborators = [
        c for c in (post.collaborators or []) if c.status == 'accepted'
    ]
    collaborators_data = [
        CollaboratorData(
            id=c.id,
            user_id=c.user_id,
            full_name=c.user.full_name if c.user else None,
            avatar_url=c.user.avatar_url if c.user else None,
            status=c.status,
            verified_by_gps=c.verified_by_gps or False
        ) for c in accepted_collaborators
    ]
    
    # Get spot data if available
    spot_data = None
    if post.spot:
        spot_data = SpotData(
            id=post.spot.id,
            name=post.spot.name,
            region=post.spot.region
        )
    
    # Build response with additional fields for single post view
    response = PostResponse(
        id=post.id,
        author_id=post.author_id,
        author_name=post.author.full_name,
        author_username=post.author.username if post.author else None,
        author_avatar=post.author.avatar_url,
        author_role=post.author.role.value if post.author.role else None,
        media_url=post.media_url,
        media_type=post.media_type or 'image',
        thumbnail_url=post.thumbnail_url,
        caption=post.caption,
        location=post.location,
        likes_count=post.likes_count,
        comments_count=post.comments_count or len(post.comments),
        is_liked_by_user=is_liked,
        reactions=reactions_data,
        video_width=post.video_width,
        video_height=post.video_height,
        video_duration=post.video_duration,
        was_transcoded=post.was_transcoded or False,
        created_at=post.created_at,
        recent_comments=[
            CommentResponse(
                id=c.id,
                post_id=c.post_id,
                author_id=c.author_id,
                author_name=c.author.full_name if c.author else 'Unknown',
                author_avatar=c.author.avatar_url if c.author else None,
                content=c.content,
                created_at=c.created_at
            ) for c in recent_comments
        ],
        # Session Log Metadata
        session_date=post.session_date,
        session_start_time=post.session_start_time,
        session_end_time=post.session_end_time,
        session_label=post.session_label,
        wave_height_ft=post.wave_height_ft,
        wave_period_sec=post.wave_period_sec,
        wave_direction=post.wave_direction,
        wave_direction_degrees=post.wave_direction_degrees,
        wind_speed_mph=post.wind_speed_mph,
        wind_direction=post.wind_direction,
        tide_height_ft=post.tide_height_ft,
        tide_status=post.tide_status,
        conditions_source=post.conditions_source,
        # Spot
        spot=spot_data,
        # Collaborators
        collaborators=collaborators_data,
        collaborator_count=len(accepted_collaborators),
        # Check-in fields
        is_check_in=post.is_check_in or False,
        check_in_spot_name=getattr(post, 'check_in_spot_name', None),
        check_in_conditions=getattr(post, 'check_in_conditions', None),
        # Session Log fields
        is_session_log=post.is_session_log or False,
        session_invite_open=post.session_invite_open or False,
        session_spots_left=post.session_spots_left,
        session_price_per_person=post.session_price_per_person,
        booking_id=post.booking_id,
        # Post settings
        hide_like_count=post.hide_like_count or False,
        comments_disabled=post.comments_disabled or False,
        # Single post view fields
        liked=is_liked,
        saved=is_saved
    )
    
    return response


@router.get("/posts/grom-preview")
async def get_grom_preview_feed(limit: int = 3, db: AsyncSession = Depends(get_db)):
    """
    Get a limited preview feed showing only posts from Grom users.
    Used for unlinked Groms to see community content without full access.
    Limited to 3 posts by default.
    """
    # First get all Grom user IDs
    grom_users_result = await db.execute(
        select(Profile.id).where(Profile.role == 'GROM')
    )
    grom_user_ids = [row[0] for row in grom_users_result.all()]
    
    if not grom_user_ids:
        return []
    
    # Get posts from Groms only
    result = await db.execute(
        select(Post)
        .options(selectinload(Post.author))
        .where(Post.author_id.in_(grom_user_ids))
        .order_by(Post.created_at.desc())
        .limit(limit)
    )
    posts = result.scalars().all()
    
    response = []
    for post in posts:
        response.append({
            "id": post.id,
            "author_id": post.author_id,
            "author_name": post.author.full_name if post.author else "Grom",
            "author_username": post.author.username if post.author else None,
            "author_avatar": post.author.avatar_url if post.author else None,
            "media_url": post.media_url,
            "media_type": post.media_type,
            "thumbnail_url": post.thumbnail_url,
            "caption": post.caption,
            "spot_name": post.location,
            "likes_count": post.likes_count,
            "comments_count": 0,  # Don't show comment count for preview
            "created_at": post.created_at.isoformat() if post.created_at else None
        })
    
    return response

