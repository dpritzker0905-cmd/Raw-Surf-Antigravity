"""Grom HQ family — family activity feed and call permission checks."""
from pydantic import BaseModel
from fastapi import Depends, HTTPException, APIRouter
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from database import get_db
from datetime import datetime, timezone
from typing import Optional
import json
from models import GalleryItem, PhotoTag, Post, Profile, RoleEnum
from utils.grom_parent import is_grom_parent_eligible
from core.security import get_user_id_from_jwt_or_query

router = APIRouter()


@router.get("/family-activity/{parent_id}")
async def get_family_activity_feed(
    parent_id: str,
    grom_id: Optional[str] = None,
    limit: int = 20,
    offset: int = 0,
    user_id: str = Depends(get_user_id_from_jwt_or_query),
    db: AsyncSession = Depends(get_db)
):
    """
    Get a consolidated activity feed for all linked Groms (or a specific Grom).
    Shows: Latest Posts, Earned Achievements/Badges, Tagged Photos.
    """
    if user_id != parent_id:
        raise HTTPException(status_code=403, detail="Not authorized to view family activity for this parent")
    from models import Post, PhotoTag, GalleryItem


    
    # Verify parent is a Grom Parent
    parent_result = await db.execute(select(Profile).where(Profile.id == parent_id))
    parent = parent_result.scalar_one_or_none()
    
    if not parent:
        raise HTTPException(status_code=404, detail="Parent not found")
    
    if not is_grom_parent_eligible(parent):
        raise HTTPException(status_code=403, detail="Only Grom Parents can view family activity")
    
    # Get linked Groms
    if grom_id:
        grom_result = await db.execute(
            select(Profile)
            .where(Profile.id == grom_id, Profile.parent_id == parent_id)
        )
        groms = [grom_result.scalar_one_or_none()]
        if not groms[0]:
            raise HTTPException(status_code=403, detail="Grom is not linked to this parent")
    else:
        groms_result = await db.execute(
            select(Profile)
            .where(Profile.parent_id == parent_id, Profile.role == RoleEnum.GROM)
        )
        groms = groms_result.scalars().all()
    
    if not groms:
        return {"activities": [], "total": 0, "groms": []}
    
    grom_ids = [g.id for g in groms if g]
    
    activities = []
    
    # 1. Get Latest Posts from Groms
    try:
        posts_result = await db.execute(
            select(Post)
            .where(Post.author_id.in_(grom_ids))
            .order_by(Post.created_at.desc())
            .limit(10)
        )
        posts = posts_result.scalars().all()
        
        for post in posts:
            grom = next((g for g in groms if g and g.id == post.author_id), None)
            activities.append({
                "type": "post",
                "id": post.id,
                "grom_id": post.author_id,
                "grom_name": grom.full_name if grom else "Unknown",
                "grom_avatar": grom.avatar_url if grom else None,
                "title": "Shared a post",
                "content": post.content[:100] if post.content else None,
                "media_url": post.media_url,
                "media_type": post.media_type,
                "created_at": post.created_at.isoformat() if post.created_at else None,
                "icon": "📝"
            })
    except Exception:
        pass  # Posts table might not have all fields
    
    # 2. Get Profile Stats as "Session" updates (XP gains, level ups, etc.)
    for grom in groms:
        if not grom:
            continue
        # Add an activity for grom's current stats
        xp_total = getattr(grom, 'xp_total', 0) or 0
        total_sessions = getattr(grom, 'total_sessions', 0) or 0
        career_tier = getattr(grom, 'career_tier', 'Wave Rider') or 'Wave Rider'
        
        if xp_total > 0 or total_sessions > 0:
            activities.append({
                "type": "stats",
                "id": f"stats_{grom.id}",
                "grom_id": grom.id,
                "grom_name": grom.full_name,
                "grom_avatar": grom.avatar_url,
                "title": f"Current Level: {career_tier}",
                "content": f"{xp_total} XP earned • {total_sessions} sessions",
                "created_at": datetime.now(timezone.utc).isoformat(),
                "icon": "🏄"
            })
    
    # 3. Get Earned Badges/Achievements
    for grom in groms:
        if not grom:
            continue
        # Check badges earned (stored in profile JSON)
        badges_data = grom.badges or []
        if isinstance(badges_data, str):
            try:
                badges_data = json.loads(badges_data)
            except Exception:
                badges_data = []
        
        for badge in badges_data[-5:]:  # Last 5 badges
            if isinstance(badge, dict):
                activities.append({
                    "type": "badge",
                    "id": f"badge_{grom.id}_{badge.get('name', 'unknown')}",
                    "grom_id": grom.id,
                    "grom_name": grom.full_name,
                    "grom_avatar": grom.avatar_url,
                    "title": f"Earned a badge: {badge.get('name', 'Achievement')}",
                    "content": badge.get('description', ''),
                    "badge_icon": badge.get('icon', '🏅'),
                    "created_at": badge.get('earned_at', datetime.now(timezone.utc).isoformat()),
                    "icon": "🏅"
                })
    
    # 4. Get Tagged Photos (Grom Highlights)
    try:
        tagged_result = await db.execute(
            select(PhotoTag, GalleryItem)
            .join(GalleryItem, GalleryItem.id == PhotoTag.gallery_item_id)
            .where(PhotoTag.surfer_id.in_(grom_ids))
            .order_by(PhotoTag.tagged_at.desc())
            .limit(10)
        )
        tagged = tagged_result.all()
        
        for tag, item in tagged:
            grom = next((g for g in groms if g and g.id == tag.surfer_id), None)
            activities.append({
                "type": "highlight",
                "id": item.id,
                "grom_id": tag.surfer_id,
                "grom_name": grom.full_name if grom else "Unknown",
                "grom_avatar": grom.avatar_url if grom else None,
                "title": "Added to Grom Highlights",
                "content": "A new photo was tagged",
                "media_url": item.thumbnail_url or item.preview_url,
                "media_type": item.media_type,
                "created_at": tag.tagged_at.isoformat() if tag.tagged_at else None,
                "icon": "📸"
            })
    except Exception:
        pass
    
    # Sort all activities by date
    activities.sort(key=lambda x: x.get("created_at") or "", reverse=True)
    
    # Apply pagination
    total = len(activities)
    activities = activities[offset:offset + limit]
    
    # Get grom info
    groms_info = [
        {
            "id": g.id,
            "name": g.full_name,
            "avatar": g.avatar_url,
            "xp": getattr(g, 'xp_total', 0) or 0,
            "level": getattr(g, 'career_tier', 'Wave Rider') or "Wave Rider"
        }
        for g in groms if g
    ]
    
    return {
        "activities": activities,
        "total": total,
        "groms": groms_info
    }


# ============ CALL PERMISSION CHECK ============

@router.get("/call-permission/{caller_id}/{target_id}")
async def check_call_permission(
    caller_id: str,
    target_id: str,
    user_id: str = Depends(get_user_id_from_jwt_or_query),
    db: AsyncSession = Depends(get_db)
):
    if user_id != caller_id and user_id != target_id:
        raise HTTPException(status_code=403, detail="Not authorized to check call permissions for other users")
    """
    Check if a call is allowed between two users.
    
    Grom restrictions:
    - Groms can CALL: other Groms, their linked parent
    - Groms can RECEIVE calls from: other Groms, their linked parent, 
      or users in parent's approved_callers whitelist
    - All other roles: unrestricted
    """
    # Fetch both profiles
    caller_result = await db.execute(select(Profile).where(Profile.id == caller_id))
    caller = caller_result.scalar_one_or_none()
    
    target_result = await db.execute(select(Profile).where(Profile.id == target_id))
    target = target_result.scalar_one_or_none()
    
    if not caller or not target:
        return {"allowed": False, "reason": "User not found"}
    
    # Check if caller is a Grom
    if caller.role == RoleEnum.GROM:
        controls = caller.parental_controls or {}
        
        # Check if calling is disabled by parental controls
        if controls.get("can_call") is False:
            return {"allowed": False, "reason": "Calling is disabled by your parent"}
        
        # Groms can call their linked parent
        if target_id == caller.parent_id:
            return {"allowed": True, "reason": "Calling linked parent"}
        
        # Groms can call other Groms
        if target.role == RoleEnum.GROM:
            return {"allowed": True, "reason": "Grom-to-Grom call"}
        
        # Not allowed otherwise
        return {"allowed": False, "reason": "Groms can only call other Groms or their parent"}
    
    # Check if target is a Grom (incoming call to a Grom)
    if target.role == RoleEnum.GROM:
        controls = target.parental_controls or {}
        
        # Check if calling is disabled by parental controls
        if controls.get("can_call") is False:
            return {"allowed": False, "reason": "This user has calling disabled"}
        
        # Their linked parent can always call
        if caller_id == target.parent_id:
            return {"allowed": True, "reason": "Parent calling linked Grom"}
        
        # Other Groms can call
        if caller.role == RoleEnum.GROM:
            return {"allowed": True, "reason": "Grom-to-Grom call"}
        
        # Check approved_callers whitelist set by parent
        approved_callers = controls.get("approved_callers", [])
        if isinstance(approved_callers, list) and caller_id in approved_callers:
            return {"allowed": True, "reason": "Caller is on parent-approved list"}
        
        # Not on approved list
        return {"allowed": False, "reason": "Caller not authorized for this Grom account"}
    
    # Non-Grom to Non-Grom: always allowed
    return {"allowed": True, "reason": "Standard call"}


# ============ GROM PURCHASE REQUEST QUEUE ============

class PurchaseRequestBody(BaseModel):
    item_type: str  # 'gallery_photo', 'credit_pack', 'gear_item'
    item_id: Optional[str] = None
    item_name: str
    amount: float
    quality_tier: Optional[str] = None
    metadata: Optional[dict] = None

