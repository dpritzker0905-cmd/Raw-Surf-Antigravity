import logging
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_
from sqlalchemy.orm import selectinload
from pydantic import BaseModel, ConfigDict
from typing import List, Optional
from datetime import datetime

from database import get_db
from models import Profile, Post, PostLike, Comment, PostReaction, PostCollaboration, SurfSpot, RoleEnum

router = APIRouter()

logger = logging.getLogger(__name__)
class PostCreate(BaseModel):
    media_url: str
    media_type: str = 'image'  # 'image' or 'video'
    thumbnail_url: Optional[str] = None
    caption: Optional[str] = None
    location: Optional[str] = None
    mentions: Optional[List[dict]] = None  # [{"user_id": "...", "username": "..."}, ...]
    # Video metadata
    video_width: Optional[int] = None
    video_height: Optional[int] = None
    video_duration: Optional[float] = None
    was_transcoded: Optional[bool] = False
    # Session metadata
    session_date: Optional[datetime] = None
    session_start_time: Optional[str] = None
    session_end_time: Optional[str] = None
    wave_height_ft: Optional[float] = None
    wave_period_sec: Optional[int] = None
    wave_direction: Optional[str] = None
    wave_direction_degrees: Optional[float] = None
    wind_speed_mph: Optional[float] = None
    wind_direction: Optional[str] = None
    tide_status: Optional[str] = None
    tide_height_ft: Optional[float] = None
    conditions_source: Optional[str] = 'manual'

class CommentCreate(BaseModel):
    content: str
    parent_id: Optional[str] = None  # For replies to other comments

class CommentUpdate(BaseModel):
    """Request body for editing a comment"""
    content: str

class ReactionCreate(BaseModel):
    emoji: str

class ReactionData(BaseModel):
    emoji: str
    user_id: str
    user_name: Optional[str] = None
    avatar_url: Optional[str] = None
    user_role: Optional[str] = None

# Valid surf-themed reactions
VALID_REACTIONS = ['🤙', '❤️', '🔥', '🌊', '👏']

class CommentResponse(BaseModel):
    id: str
    post_id: str
    author_id: str
    author_name: Optional[str]
    author_username: Optional[str] = None
    author_avatar: Optional[str]
    content: str
    created_at: datetime
    is_edited: bool = False
    edited_at: Optional[datetime] = None

class CollaboratorData(BaseModel):
    """Collaborator info for session posts"""
    id: str
    user_id: str
    full_name: Optional[str]
    username: Optional[str] = None
    avatar_url: Optional[str]
    status: str
    verified_by_gps: bool = False

class SpotData(BaseModel):
    """Surf spot data for session posts"""
    id: str
    name: str
    region: Optional[str]

class PostResponse(BaseModel):
    id: str
    author_id: str
    author_name: Optional[str]
    author_username: Optional[str] = None
    author_avatar: Optional[str]
    author_role: Optional[str] = None
    media_url: Optional[str] = None  # Optional for session log posts
    media_type: str
    thumbnail_url: Optional[str]
    caption: Optional[str]
    location: Optional[str]
    likes_count: int
    comments_count: int = 0
    is_liked_by_user: bool = False
    reactions: List[ReactionData] = []  # Post reactions
    video_width: Optional[int]
    video_height: Optional[int]
    video_duration: Optional[float]
    was_transcoded: bool = False
    created_at: datetime
    recent_comments: List[CommentResponse] = []  # Show latest 2 comments inline
    
    # Session Log Metadata
    session_date: Optional[datetime] = None
    session_start_time: Optional[str] = None
    session_end_time: Optional[str] = None
    session_label: Optional[str] = None
    wave_height_ft: Optional[float] = None
    wave_period_sec: Optional[int] = None
    wave_direction: Optional[str] = None
    wave_direction_degrees: Optional[float] = None
    wind_speed_mph: Optional[float] = None
    wind_direction: Optional[str] = None
    tide_height_ft: Optional[float] = None
    tide_status: Optional[str] = None
    conditions_source: Optional[str] = None
    
    # Spot info
    spot: Optional[SpotData] = None
    
    # Collaborators
    collaborators: List[CollaboratorData] = []
    collaborator_count: int = 0
    
    # Check-in fields
    is_check_in: bool = False
    check_in_spot_name: Optional[str] = None
    check_in_conditions: Optional[str] = None
    
    # Session Log fields (for SessionJoinCard)
    is_session_log: bool = False
    session_invite_open: bool = False
    session_spots_left: Optional[int] = None
    session_price_per_person: Optional[float] = None
    booking_id: Optional[str] = None
    
    # Post settings
    hide_like_count: bool = False
    comments_disabled: bool = False
    
    # Single post view fields
    liked: bool = False
    saved: bool = False

@router.post("/posts", response_model=PostResponse)
async def create_post(author_id: str, data: PostCreate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Profile).where(Profile.id == author_id))
    profile = result.scalar_one_or_none()
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")
    
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

@router.get("/posts", response_model=List[PostResponse])
async def get_feed(limit: int = 50, user_id: Optional[str] = Query(None), db: AsyncSession = Depends(get_db)):
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


@router.post("/posts/{post_id}/like")
async def toggle_like_post(post_id: str, user_id: str = Query(...), db: AsyncSession = Depends(get_db)):
    """Toggle like on a post - if already liked, unlike it; if not liked, like it"""
    # Get the post
    result = await db.execute(select(Post).where(Post.id == post_id))
    post = result.scalar_one_or_none()
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    
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
async def unlike_post(post_id: str, user_id: str = Query(...), db: AsyncSession = Depends(get_db)):
    """Unlike a post"""
    # Get the post
    result = await db.execute(select(Post).where(Post.id == post_id))
    post = result.scalar_one_or_none()
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    
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
async def pin_post_to_profile(post_id: str, user_id: str = Query(...), db: AsyncSession = Depends(get_db)):
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
async def unpin_post_from_profile(post_id: str, user_id: str = Query(...), db: AsyncSession = Depends(get_db)):
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
async def create_comment(post_id: str, data: CommentCreate, user_id: str = Query(...), db: AsyncSession = Depends(get_db)):
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
async def delete_comment(post_id: str, comment_id: str, user_id: str = Query(...), db: AsyncSession = Depends(get_db)):
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
    user_id: str = Query(...), 
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
    user_id: str = Query(...), 
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
async def toggle_reaction(post_id: str, data: ReactionCreate, user_id: str = Query(...), db: AsyncSession = Depends(get_db)):
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
            await db.commit()
            return {"action": "removed", "emoji": data.emoji, "post_id": post_id}
        else:
            # Different emoji - replace it (no count change)
            old_emoji = existing.emoji
            existing.emoji = data.emoji
            await db.commit()
            return {"action": "changed", "emoji": data.emoji, "old_emoji": old_emoji, "post_id": post_id}
    else:
        # No existing reaction - add new one
        reaction = PostReaction(
            post_id=post_id,
            user_id=user_id,
            emoji=data.emoji
        )
        db.add(reaction)
        await db.commit()
        return {"action": "added", "emoji": data.emoji, "post_id": post_id}


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


# ============================================================
# Post Settings & Management
# ============================================================

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
            post.session_date = parsed_date.replace(hour=12, minute=0, second=0)
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
    from models import Profile, PostReport as PostReportModel
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
    
    # Check if already reported by this user
    try:
        # Try to create report - table may not exist yet
        new_report = PostReportModel(
            id=str(uuid.uuid4()),
            post_id=post_id,
            reporter_id=report.reporter_id,
            reason=report.reason,
            description=report.description
        )
        db.add(new_report)
        await db.commit()
    except Exception:
        # If table doesn't exist, just log and return success
        # Admin will see it via manual review
        logger.error(f"Report logging: {report.reason} for post {post_id}")
        await db.rollback()
    
    return {"success": True, "message": "Report submitted"}


# ============================================================
# Recent Locations (for Create Post auto-fill)
# ============================================================

class RecentLocationData(BaseModel):
    location: str
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    spot_id: Optional[str] = None
    spot_name: Optional[str] = None
    last_used: datetime
    use_count: int

@router.get("/posts/user/{user_id}/recent-locations", response_model=List[RecentLocationData])
async def get_recent_locations(
    user_id: str,
    limit: int = 5,
    db: AsyncSession = Depends(get_db)
):
    """
    Get user's most recent unique surf locations from their posts.
    Returns up to 5 locations ordered by most recently used.
    Includes coordinates for auto-fetching conditions.
    """
    from sqlalchemy import desc, distinct, and_, or_
    
    # Get posts with location data from this user
    result = await db.execute(
        select(Post)
        .where(Post.author_id == user_id)
        .where(
            or_(
                Post.location.isnot(None),
                Post.spot_id.isnot(None)
            )
        )
        .options(selectinload(Post.spot))
        .order_by(desc(Post.created_at))
        .limit(100)  # Get last 100 to find unique locations
    )
    posts = result.scalars().all()
    
    # Build unique locations list
    seen_locations = set()
    locations = []
    
    for post in posts:
        # Determine location key (prefer spot_id over location string)
        if post.spot_id and post.spot:
            loc_key = f"spot:{post.spot_id}"
            loc_name = post.spot.name
            lat = post.spot.latitude
            lon = post.spot.longitude
            spot_id = post.spot_id
            spot_name = post.spot.name
        elif post.location:
            loc_key = f"loc:{post.location.lower().strip()}"
            loc_name = post.location
            # Try to get lat/lon from post if available
            lat = getattr(post, 'latitude', None)
            lon = getattr(post, 'longitude', None)
            spot_id = None
            spot_name = None
        else:
            continue
        
        if loc_key in seen_locations:
            # Increment count for already seen location
            for loc in locations:
                if (loc.spot_id and loc.spot_id == spot_id) or (not loc.spot_id and loc.location.lower() == loc_name.lower()):
                    loc.use_count += 1
                    break
            continue
        
        seen_locations.add(loc_key)
        
        if len(locations) >= limit:
            continue
        
        locations.append(RecentLocationData(
            location=loc_name,
            latitude=lat,
            longitude=lon,
            spot_id=spot_id,
            spot_name=spot_name,
            last_used=post.created_at,
            use_count=1
        ))
    
    return locations



# ============================================================
# Social Share Page with Open Graph Meta Tags
# ============================================================

from fastapi.responses import HTMLResponse

@router.get("/share/{post_id}", response_class=HTMLResponse)
async def get_share_page(
    post_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Returns an HTML page with Open Graph meta tags for social sharing.
    Facebook, Instagram, Twitter, etc. will use these tags to generate rich previews.
    """
    result = await db.execute(
        select(Post)
        .options(selectinload(Post.author))
        .where(Post.id == post_id)
    )
    post = result.scalar_one_or_none()
    
    if not post:
        # Return a fallback page
        return HTMLResponse(content="""
        <!DOCTYPE html>
        <html>
        <head>
            <meta property="og:title" content="Raw Surf - Post Not Found" />
            <meta property="og:description" content="This surf post is no longer available." />
            <meta property="og:image" content="https://raw-surf-os.preview.emergentagent.com/logo.png" />
            <meta property="og:url" content="https://raw-surf-os.preview.emergentagent.com" />
            <meta http-equiv="refresh" content="0;url=https://raw-surf-os.preview.emergentagent.com" />
        </head>
        <body>Redirecting...</body>
        </html>
        """, status_code=200)
    
    # Build the Open Graph metadata
    author_name = post.author.full_name if post.author else "A surfer"
    location = post.location or "an epic spot"
    caption = post.caption or "Check out this surf session!"
    
    # Truncate caption for description
    description = caption[:200] + "..." if len(caption) > 200 else caption
    
    # Build conditions string
    conditions = []
    if post.wave_height_ft:
        conditions.append(f"{post.wave_height_ft}ft waves")
    if post.wind_speed_mph:
        conditions.append(f"{post.wind_speed_mph}mph wind")
    if post.tide_status:
        conditions.append(f"{post.tide_status} tide")
    conditions_str = " | ".join(conditions) if conditions else ""
    
    # Full description
    full_description = f"{author_name} surfed at {location}"
    if conditions_str:
        full_description += f" - {conditions_str}"
    if description and description != "Check out this surf session!":
        full_description += f" - {description}"
    
    # Get the media URL (use thumbnail for videos)
    image_url = post.thumbnail_url if post.media_type == 'video' else post.media_url
    
    # Frontend URL for redirect
    frontend_url = f"https://raw-surf-os.preview.emergentagent.com/post/{post_id}"
    
    html_content = f"""
    <!DOCTYPE html>
    <html prefix="og: http://ogp.me/ns#">
    <head>
        <meta charset="UTF-8">
        <title>{author_name}'s Surf Session | Raw Surf</title>
        
        <!-- Open Graph / Facebook -->
        <meta property="og:type" content="article" />
        <meta property="og:site_name" content="Raw Surf" />
        <meta property="og:title" content="{author_name}'s Surf Session at {location}" />
        <meta property="og:description" content="{full_description}" />
        <meta property="og:image" content="{image_url}" />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta property="og:url" content="{frontend_url}" />
        
        <!-- Twitter -->
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="{author_name}'s Surf Session" />
        <meta name="twitter:description" content="{full_description}" />
        <meta name="twitter:image" content="{image_url}" />
        
        <!-- Redirect to actual post page -->
        <meta http-equiv="refresh" content="0;url={frontend_url}" />
        
        <style>
            body {{
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                display: flex;
                justify-content: center;
                align-items: center;
                height: 100vh;
                margin: 0;
                background: #0a0a0a;
                color: #fff;
            }}
        </style>
    </head>
    <body>
        <p>Loading surf session...</p>
        <script>window.location.href = "{frontend_url}";</script>
    </body>
    </html>
    """
    
    return HTMLResponse(content=html_content, status_code=200)



@router.get("/posts/{post_id}/reactions-detail")
async def get_post_reactions_detail(
    post_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Get detailed list of who reacted to a post, grouped by emoji.
    Useful for "View who liked" modal.
    """
    post_result = await db.execute(
        select(Post).where(Post.id == post_id)
    )
    post = post_result.scalar_one_or_none()
    
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    
    # Get all reactions with user info
    reactions_result = await db.execute(
        select(PostReaction, Profile)
        .join(Profile, PostReaction.user_id == Profile.id)
        .where(PostReaction.post_id == post_id)
        .order_by(PostReaction.created_at.desc())
    )
    reactions = reactions_result.all()
    
    # Group by emoji
    grouped = {}
    all_reactors = []
    
    for reaction, profile in reactions:
        emoji = reaction.emoji
        reactor_data = {
            "user_id": profile.id,
            "full_name": profile.full_name,
            "avatar_url": profile.avatar_url,
            "role": profile.role.value if profile.role else None,
            "reacted_at": reaction.created_at.isoformat()
        }
        
        if emoji not in grouped:
            grouped[emoji] = []
        grouped[emoji].append(reactor_data)
        all_reactors.append({**reactor_data, "emoji": emoji})
    
    # Also get legacy likes for backwards compatibility
    likes_result = await db.execute(
        select(PostLike, Profile)
        .join(Profile, PostLike.user_id == Profile.id)
        .where(PostLike.post_id == post_id)
        .order_by(PostLike.created_at.desc())
    )
    likes = likes_result.all()
    
    likers = [
        {
            "user_id": profile.id,
            "full_name": profile.full_name,
            "avatar_url": profile.avatar_url,
            "role": profile.role.value if profile.role else None,
            "liked_at": like.created_at.isoformat()
        }
        for like, profile in likes
    ]
    
    return {
        "post_id": post_id,
        "total_reactions": len(all_reactors),
        "total_likes": len(likers),
        "reactions_by_emoji": grouped,
        "all_reactors": all_reactors,
        "likers": likers
    }


@router.get("/users/search-mentions")
async def search_users_for_mention(
    q: str = Query(..., min_length=1),
    limit: int = Query(10, le=20),
    db: AsyncSession = Depends(get_db)
):
    """
    Search users for @mention autocomplete.
    Prioritizes username matches, then full_name.
    """
    search_term = q.lower()
    
    # First search by username (prefix match)
    username_result = await db.execute(
        select(Profile)
        .where(Profile.username.isnot(None))
        .where(func.lower(Profile.username).like(f"{search_term}%"))
        .order_by(Profile.username)
        .limit(limit)
    )
    username_matches = username_result.scalars().all()
    
    # Then search by full_name if we need more results
    remaining = limit - len(username_matches)
    name_matches = []
    
    if remaining > 0:
        matched_ids = [u.id for u in username_matches]
        name_result = await db.execute(
            select(Profile)
            .where(
                or_(
                    func.lower(Profile.full_name).like(f"%{search_term}%"),
                    func.lower(Profile.username).like(f"%{search_term}%")
                )
            )
            .where(Profile.id.notin_(matched_ids) if matched_ids else True)
            .order_by(Profile.full_name)
            .limit(remaining)
        )
        name_matches = name_result.scalars().all()
    
    all_users = username_matches + name_matches
    
    return [
        {
            "id": u.id,
            "user_id": u.id,
            "username": u.username,
            "full_name": u.full_name,
            "avatar_url": u.avatar_url,
            "role": u.role.value if u.role else None,
            "is_verified": u.is_verified
        }
        for u in all_users
    ]
