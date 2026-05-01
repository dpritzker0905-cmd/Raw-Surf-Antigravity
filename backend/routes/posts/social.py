"""
Posts social features — recent locations, Open Graph share page, reactions detail, mention search.
"""
import logging
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import HTMLResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_
from sqlalchemy.orm import selectinload
from typing import List, Optional
from datetime import datetime

from database import get_db
from models import Profile, Post, PostLike, PostReaction
from .schemas import RecentLocationData

router = APIRouter()
logger = logging.getLogger(__name__)

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
from core.security import get_user_id_from_jwt_or_query, get_optional_user_id_from_jwt_or_query
from pydantic import BaseModel

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
