from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_, and_
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timedelta, timezone
import math

from database import get_db
from models import Profile, SurfSpot, Story, StoryView, RoleEnum

router = APIRouter()

# Story duration - 24 hours
STORY_DURATION_HOURS = 24

class StoryCreate(BaseModel):
    media_url: str
    media_type: str = 'image'  # 'image' or 'video'
    caption: Optional[str] = None
    spot_id: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    location_name: Optional[str] = None

class StoryResponse(BaseModel):
    id: str
    author_id: str
    author_name: Optional[str]
    author_avatar: Optional[str]
    author_role: str
    media_url: str
    media_type: str
    caption: Optional[str]
    story_type: str
    location_name: Optional[str]
    show_location: bool  # Based on viewer's subscription tier and distance
    view_count: int
    is_viewed: bool
    created_at: datetime
    expires_at: datetime

class StoryAuthorGroup(BaseModel):
    author_id: str
    author_name: Optional[str]
    author_avatar: Optional[str]
    author_role: str
    story_type: str  # 'photographer' or 'surf'
    location_name: Optional[str]
    show_location: bool
    is_live: bool
    story_count: int
    has_unviewed: bool
    latest_story_id: Optional[str]  # Can be None for live users without stories
    stories: List[StoryResponse]

def calculate_distance_miles(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate distance between two points in miles using Haversine formula"""
    R = 3959  # Earth's radius in miles
    lat1_rad, lon1_rad = math.radians(lat1), math.radians(lon1)
    lat2_rad, lon2_rad = math.radians(lat2), math.radians(lon2)
    dlat = lat2_rad - lat1_rad
    dlon = lon2_rad - lon1_rad
    a = math.sin(dlat/2)**2 + math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(dlon/2)**2
    c = 2 * math.asin(math.sqrt(a))
    return R * c

def should_show_location(viewer_tier: str, distance_miles: float) -> bool:
    """
    Determine if location should be shown based on subscription tier and distance
    - Free: within 1 mile
    - Basic: within 5 miles
    - Premium: always show
    """
    if viewer_tier == 'premium':
        return True
    elif viewer_tier == 'basic':
        return distance_miles <= 5.0
    else:  # free or None
        return distance_miles <= 1.0

@router.post("/stories")
async def create_story(
    author_id: str,
    data: StoryCreate,
    db: AsyncSession = Depends(get_db)
):
    """Create a new story"""
    # Get author profile
    author_result = await db.execute(select(Profile).where(Profile.id == author_id))
    author = author_result.scalar_one_or_none()
    if not author:
        raise HTTPException(status_code=404, detail="Author not found")
    
    # Determine story type based on author role and shooting status
    photographer_roles = [RoleEnum.GROM_PARENT, RoleEnum.HOBBYIST, RoleEnum.PHOTOGRAPHER, RoleEnum.APPROVED_PRO]
    is_photographer = author.role in photographer_roles
    is_live_report = is_photographer and author.is_shooting
    story_type = 'photographer' if is_photographer else 'surf'
    
    # Get spot info if provided
    location_name = data.location_name
    latitude = data.latitude
    longitude = data.longitude
    spot_id = data.spot_id
    
    if spot_id:
        spot_result = await db.execute(select(SurfSpot).where(SurfSpot.id == spot_id))
        spot = spot_result.scalar_one_or_none()
        if spot:
            if not location_name:
                location_name = spot.name
            if not latitude:
                latitude = spot.latitude
            if not longitude:
                longitude = spot.longitude
    
    # If photographer is shooting, use current spot
    if is_live_report and author.current_spot_id:
        spot_result = await db.execute(select(SurfSpot).where(SurfSpot.id == author.current_spot_id))
        spot = spot_result.scalar_one_or_none()
        if spot:
            spot_id = spot.id
            location_name = spot.name
            latitude = spot.latitude
            longitude = spot.longitude
    
    # Create story with 24-hour expiration
    expires_at = datetime.now(timezone.utc) + timedelta(hours=STORY_DURATION_HOURS)
    
    story = Story(
        author_id=author_id,
        spot_id=spot_id,
        media_url=data.media_url,
        media_type=data.media_type,
        caption=data.caption,
        story_type=story_type,
        latitude=latitude,
        longitude=longitude,
        location_name=location_name,
        is_live_report=is_live_report,
        expires_at=expires_at
    )
    
    db.add(story)
    await db.commit()
    await db.refresh(story)
    
    return {
        "id": story.id,
        "story_type": story.story_type,
        "is_live_report": story.is_live_report,
        "location_name": story.location_name,
        "expires_at": story.expires_at.isoformat(),
        "message": "Story created successfully!"
    }

@router.get("/stories/feed")
async def get_stories_feed(
    viewer_id: str,
    viewer_lat: Optional[float] = None,
    viewer_lon: Optional[float] = None,
    story_type_filter: Optional[str] = None,  # 'photographer', 'surf', or None for all
    db: AsyncSession = Depends(get_db)
):
    """
    Get stories feed grouped by author
    Returns stories from followed users + live users the viewer follows
    Location visibility based on viewer's subscription tier
    """
    from models import Follow
    
    # Get viewer profile for subscription tier
    viewer_result = await db.execute(select(Profile).where(Profile.id == viewer_id))
    viewer = viewer_result.scalar_one_or_none()
    viewer_tier = viewer.subscription_tier if viewer else 'free'
    
    # Get list of users the viewer follows
    following_result = await db.execute(
        select(Follow.following_id).where(Follow.follower_id == viewer_id)
    )
    following_ids = set(row[0] for row in following_result.fetchall())
    
    # Also include the viewer's own stories
    following_ids.add(viewer_id)
    
    # Get active (non-expired) stories from followed users
    now = datetime.now(timezone.utc)
    
    query = select(Story).where(
        Story.expires_at > now,
        Story.is_expired == False,
        Story.author_id.in_(following_ids)  # Only from followed users
    ).options(
        selectinload(Story.author),
        selectinload(Story.spot)
    ).order_by(Story.created_at.desc())
    
    # Filter by story type if specified
    if story_type_filter:
        query = query.where(Story.story_type == story_type_filter)
    
    result = await db.execute(query)
    stories = result.scalars().all()
    
    # Get viewer's viewed stories
    viewed_result = await db.execute(
        select(StoryView.story_id).where(StoryView.viewer_id == viewer_id)
    )
    viewed_story_ids = set(row[0] for row in viewed_result.fetchall())
    
    # Group stories by author
    author_groups = {}
    
    for story in stories:
        author = story.author
        if not author:
            continue
        
        # Calculate distance for location visibility
        show_location = False
        if story.latitude and story.longitude and viewer_lat and viewer_lon:
            distance = calculate_distance_miles(viewer_lat, viewer_lon, story.latitude, story.longitude)
            show_location = should_show_location(viewer_tier, distance)
        elif viewer_tier == 'premium':
            # Premium always sees location if available
            show_location = True
        
        is_viewed = story.id in viewed_story_ids
        
        story_response = StoryResponse(
            id=story.id,
            author_id=author.id,
            author_name=author.full_name,
            author_avatar=author.avatar_url,
            author_role=author.role.value,
            media_url=story.media_url,
            media_type=story.media_type,
            caption=story.caption,
            story_type=story.story_type,
            location_name=story.location_name if show_location else None,
            show_location=show_location,
            view_count=story.view_count,
            is_viewed=is_viewed,
            created_at=story.created_at,
            expires_at=story.expires_at
        )
        
        if author.id not in author_groups:
            author_groups[author.id] = {
                "author_id": author.id,
                "author_name": author.full_name,
                "author_avatar": author.avatar_url,
                "author_role": author.role.value,
                "story_type": story.story_type,
                "location_name": story.location_name if show_location else None,
                "show_location": show_location,
                "is_live": author.is_live,  # Social broadcasting only, NOT is_shooting
                "stories": [],
                "has_unviewed": False
            }
        
        author_groups[author.id]["stories"].append(story_response)
        if not is_viewed:
            author_groups[author.id]["has_unviewed"] = True
    
    # IMPORTANT: Also include followed users who are LIVE but have no stories
    # This ensures RED ring live broadcasts appear even without posted stories
    live_followed_result = await db.execute(
        select(Profile).where(
            Profile.id.in_(following_ids),
            Profile.is_live == True
        )
    )
    live_followed_users = live_followed_result.scalars().all()
    
    for live_user in live_followed_users:
        if live_user.id not in author_groups:
            # Add live user with no stories - they'll show with RED ring
            photographer_roles = ['GROM_PARENT', 'HOBBYIST', 'PHOTOGRAPHER', 'APPROVED_PRO']
            is_photographer = live_user.role.value in photographer_roles
            
            author_groups[live_user.id] = {
                "author_id": live_user.id,
                "author_name": live_user.full_name,
                "author_avatar": live_user.avatar_url,
                "author_role": live_user.role.value,
                "story_type": 'photographer' if is_photographer else 'surf',
                "location_name": None,
                "show_location": False,
                "is_live": True,
                "stories": [],
                "has_unviewed": True  # Live is always "new content"
            }
        else:
            # Update existing author group to show they're live
            author_groups[live_user.id]["is_live"] = True
    
    # Convert to list and add metadata
    story_feed = []
    for author_id, group in author_groups.items():
        group["story_count"] = len(group["stories"])
        group["latest_story_id"] = group["stories"][0].id if group["stories"] else None
        story_feed.append(StoryAuthorGroup(**group))
    
    # Sort: LIVE first (RED ring), then unviewed (BLUE), then by latest story time
    story_feed.sort(key=lambda x: (
        not x.is_live,  # Live broadcasts first
        not x.has_unviewed,  # Then unviewed
        -x.stories[0].created_at.timestamp() if x.stories else 0
    ))
    
    # Separate into photographer and surfer stories
    photographer_stories = [s for s in story_feed if s.story_type == 'photographer']
    surfer_stories = [s for s in story_feed if s.story_type == 'surf']
    
    return {
        "all": story_feed,
        "photographer_stories": photographer_stories,
        "surfer_stories": surfer_stories,
        "total_count": len(story_feed),
        "photographer_count": len(photographer_stories),
        "surfer_count": len(surfer_stories)
    }

@router.get("/stories/author/{author_id}")
async def get_author_stories(
    author_id: str,
    viewer_id: str,
    viewer_lat: Optional[float] = None,
    viewer_lon: Optional[float] = None,
    db: AsyncSession = Depends(get_db)
):
    """Get all active stories from a specific author"""
    # Get viewer tier
    viewer_result = await db.execute(select(Profile).where(Profile.id == viewer_id))
    viewer = viewer_result.scalar_one_or_none()
    viewer_tier = viewer.subscription_tier if viewer else 'free'
    
    now = datetime.now(timezone.utc)
    
    result = await db.execute(
        select(Story)
        .where(
            Story.author_id == author_id,
            Story.expires_at > now,
            Story.is_expired == False
        )
        .options(selectinload(Story.author), selectinload(Story.spot))
        .order_by(Story.created_at.asc())
    )
    stories = result.scalars().all()
    
    # Get viewed stories
    viewed_result = await db.execute(
        select(StoryView.story_id).where(
            StoryView.viewer_id == viewer_id,
            StoryView.story_id.in_([s.id for s in stories])
        )
    )
    viewed_ids = set(row[0] for row in viewed_result.fetchall())
    
    story_responses = []
    for story in stories:
        show_location = False
        if story.latitude and story.longitude and viewer_lat and viewer_lon:
            distance = calculate_distance_miles(viewer_lat, viewer_lon, story.latitude, story.longitude)
            show_location = should_show_location(viewer_tier, distance)
        elif viewer_tier == 'premium':
            show_location = True
        
        story_responses.append(StoryResponse(
            id=story.id,
            author_id=story.author.id,
            author_name=story.author.full_name,
            author_avatar=story.author.avatar_url,
            author_role=story.author.role.value,
            media_url=story.media_url,
            media_type=story.media_type,
            caption=story.caption,
            story_type=story.story_type,
            location_name=story.location_name if show_location else None,
            show_location=show_location,
            view_count=story.view_count,
            is_viewed=story.id in viewed_ids,
            created_at=story.created_at,
            expires_at=story.expires_at
        ))
    
    return {
        "author_id": author_id,
        "stories": story_responses,
        "count": len(story_responses)
    }

@router.post("/stories/{story_id}/view")
async def mark_story_viewed(
    story_id: str,
    viewer_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Mark a story as viewed by a user"""
    # Check story exists
    story_result = await db.execute(select(Story).where(Story.id == story_id))
    story = story_result.scalar_one_or_none()
    if not story:
        raise HTTPException(status_code=404, detail="Story not found")
    
    # Check if already viewed
    existing = await db.execute(
        select(StoryView).where(
            StoryView.story_id == story_id,
            StoryView.viewer_id == viewer_id
        )
    )
    if existing.scalar_one_or_none():
        return {"message": "Already viewed"}
    
    # Create view record
    view = StoryView(story_id=story_id, viewer_id=viewer_id)
    db.add(view)
    
    # Increment view count
    story.view_count += 1
    
    await db.commit()
    
    return {"message": "Story marked as viewed", "view_count": story.view_count}

@router.delete("/stories/{story_id}")
async def delete_story(
    story_id: str,
    author_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Delete a story (only author can delete)"""
    result = await db.execute(select(Story).where(Story.id == story_id))
    story = result.scalar_one_or_none()
    
    if not story:
        raise HTTPException(status_code=404, detail="Story not found")
    
    if story.author_id != author_id:
        raise HTTPException(status_code=403, detail="Not authorized to delete this story")
    
    await db.delete(story)
    await db.commit()
    
    return {"message": "Story deleted"}

@router.post("/stories/cleanup-expired")
async def cleanup_expired_stories(db: AsyncSession = Depends(get_db)):
    """Mark expired stories as expired (called by scheduler)"""
    now = datetime.now(timezone.utc)
    
    result = await db.execute(
        select(Story).where(
            Story.expires_at <= now,
            Story.is_expired == False
        )
    )
    expired_stories = result.scalars().all()
    
    for story in expired_stories:
        story.is_expired = True
    
    await db.commit()
    
    return {"expired_count": len(expired_stories)}
