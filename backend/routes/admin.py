from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_, text
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone, timedelta
import json

from database import get_db
from models import Profile, Post, GalleryItem, Story, PaymentTransaction, AdminLog, RoleEnum

router = APIRouter()

class UserSuspendRequest(BaseModel):
    reason: str

class UserUpdateRequest(BaseModel):
    is_verified: Optional[bool] = None
    is_admin: Optional[bool] = None
    subscription_tier: Optional[str] = None
    role: Optional[str] = None

async def require_admin(admin_id: str, db: AsyncSession):
    """Check if user is an admin"""
    result = await db.execute(select(Profile).where(Profile.id == admin_id))
    admin = result.scalar_one_or_none()
    if not admin or not admin.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    return admin

async def log_admin_action(
    db: AsyncSession,
    admin_id: str,
    action: str,
    target_type: str,
    target_id: str = None,
    details: dict = None
):
    """Log an admin action"""
    log = AdminLog(
        admin_id=admin_id,
        action=action,
        target_type=target_type,
        target_id=target_id,
        details=json.dumps(details) if details else None
    )
    db.add(log)

@router.get("/admin/stats")
async def get_admin_stats(admin_id: str, db: AsyncSession = Depends(get_db)):
    """Get platform-wide statistics"""
    await require_admin(admin_id, db)
    
    # User stats
    total_users = await db.execute(select(func.count(Profile.id)))
    active_users = await db.execute(
        select(func.count(Profile.id))
        .where(Profile.is_suspended == False)
    )
    
    # Users by role
    role_counts = {}
    for role in RoleEnum:
        count_result = await db.execute(
            select(func.count(Profile.id)).where(Profile.role == role)
        )
        role_counts[role.value] = count_result.scalar() or 0
    
    # Subscription stats
    subscription_counts = {}
    for tier in ['free', 'basic', 'premium']:
        count_result = await db.execute(
            select(func.count(Profile.id)).where(Profile.subscription_tier == tier)
        )
        subscription_counts[tier] = count_result.scalar() or 0
    
    # Content stats
    total_posts = await db.execute(select(func.count(Post.id)))
    total_gallery = await db.execute(select(func.count(GalleryItem.id)))
    total_stories = await db.execute(
        select(func.count(Story.id)).where(Story.is_expired == False)
    )
    
    # Revenue stats (last 30 days)
    thirty_days_ago = datetime.now(timezone.utc) - timedelta(days=30)
    revenue_result = await db.execute(
        select(func.sum(PaymentTransaction.amount))
        .where(PaymentTransaction.payment_status == 'completed')
        .where(PaymentTransaction.created_at >= thirty_days_ago)
    )
    monthly_revenue = revenue_result.scalar() or 0
    
    # New users (last 7 days)
    seven_days_ago = datetime.now(timezone.utc) - timedelta(days=7)
    new_users_result = await db.execute(
        select(func.count(Profile.id))
        .where(Profile.created_at >= seven_days_ago)
    )
    new_users_week = new_users_result.scalar() or 0
    
    return {
        "users": {
            "total": total_users.scalar() or 0,
            "active": active_users.scalar() or 0,
            "new_this_week": new_users_week,
            "by_role": role_counts,
            "by_subscription": subscription_counts
        },
        "content": {
            "total_posts": total_posts.scalar() or 0,
            "total_gallery_items": total_gallery.scalar() or 0,
            "active_stories": total_stories.scalar() or 0
        },
        "revenue": {
            "last_30_days": round(monthly_revenue, 2)
        }
    }

@router.get("/admin/users")
async def get_all_users(
    admin_id: str,
    search: Optional[str] = None,
    role: Optional[str] = None,
    subscription: Optional[str] = None,
    is_suspended: Optional[bool] = None,
    limit: int = 50,
    offset: int = 0,
    db: AsyncSession = Depends(get_db)
):
    """Get all users with filtering"""
    await require_admin(admin_id, db)
    
    query = select(Profile).order_by(Profile.created_at.desc())
    
    if search:
        search_term = f"%{search}%"
        query = query.where(
            or_(
                Profile.email.ilike(search_term),
                Profile.full_name.ilike(search_term)
            )
        )
    
    if role:
        try:
            role_enum = RoleEnum[role.upper().replace(" ", "_")]
            query = query.where(Profile.role == role_enum)
        except KeyError:
            pass
    
    if subscription:
        query = query.where(Profile.subscription_tier == subscription)
    
    if is_suspended is not None:
        query = query.where(Profile.is_suspended == is_suspended)
    
    # Get total count
    count_query = select(func.count()).select_from(query.subquery())
    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0
    
    # Get paginated results
    result = await db.execute(query.offset(offset).limit(limit))
    users = result.scalars().all()
    
    return {
        "total": total,
        "users": [{
            "id": u.id,
            "email": u.email,
            "full_name": u.full_name,
            "avatar_url": u.avatar_url,
            "role": u.role.value,
            "subscription_tier": u.subscription_tier,
            "credit_balance": u.credit_balance or 0,
            "is_verified": u.is_verified,
            "is_admin": u.is_admin,
            "is_suspended": u.is_suspended,
            "suspended_reason": u.suspended_reason,
            "created_at": u.created_at.isoformat()
        } for u in users]
    }

@router.get("/admin/users/{user_id}")
async def get_user_detail(user_id: str, admin_id: str, db: AsyncSession = Depends(get_db)):
    """Get detailed user information"""
    await require_admin(admin_id, db)
    
    result = await db.execute(select(Profile).where(Profile.id == user_id))
    user = result.scalar_one_or_none()
    
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Get user's activity stats
    posts_count = await db.execute(
        select(func.count(Post.id)).where(Post.author_id == user_id)
    )
    gallery_count = await db.execute(
        select(func.count(GalleryItem.id)).where(GalleryItem.photographer_id == user_id)
    )
    transactions = await db.execute(
        select(func.sum(PaymentTransaction.amount))
        .where(PaymentTransaction.user_id == user_id)
        .where(PaymentTransaction.payment_status == 'completed')
    )
    
    return {
        "id": user.id,
        "email": user.email,
        "full_name": user.full_name,
        "avatar_url": user.avatar_url,
        "role": user.role.value,
        "subscription_tier": user.subscription_tier,
        "credit_balance": user.credit_balance or 0,
        "is_verified": user.is_verified,
        "is_admin": user.is_admin,
        "is_suspended": user.is_suspended,
        "suspended_at": user.suspended_at.isoformat() if user.suspended_at else None,
        "suspended_reason": user.suspended_reason,
        "bio": user.bio,
        "location": user.location,
        "created_at": user.created_at.isoformat(),
        "stats": {
            "posts": posts_count.scalar() or 0,
            "gallery_items": gallery_count.scalar() or 0,
            "total_spent": round(transactions.scalar() or 0, 2)
        }
    }

@router.patch("/admin/users/{user_id}")
async def update_user(
    user_id: str,
    admin_id: str,
    data: UserUpdateRequest,
    db: AsyncSession = Depends(get_db)
):
    """Update user properties"""
    admin = await require_admin(admin_id, db)
    
    result = await db.execute(select(Profile).where(Profile.id == user_id))
    user = result.scalar_one_or_none()
    
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    changes = {}
    
    if data.is_verified is not None:
        user.is_verified = data.is_verified
        changes["is_verified"] = data.is_verified
    
    if data.is_admin is not None:
        user.is_admin = data.is_admin
        changes["is_admin"] = data.is_admin
    
    if data.subscription_tier is not None:
        user.subscription_tier = data.subscription_tier
        changes["subscription_tier"] = data.subscription_tier
    
    if data.role is not None:
        try:
            from models import RoleEnum
            role_enum = RoleEnum[data.role.upper().replace(" ", "_")]
            user.role = role_enum
            changes["role"] = data.role
        except KeyError:
            raise HTTPException(status_code=400, detail=f"Invalid role: {data.role}")
    
    await log_admin_action(db, admin_id, "update_user", "user", user_id, changes)
    await db.commit()
    
    return {"message": "User updated", "changes": changes}

class BulkUpdateRequest(BaseModel):
    user_ids: List[str]
    role: Optional[str] = None
    subscription_tier: Optional[str] = None


@router.post("/admin/users/bulk-update")
async def bulk_update_users(
    admin_id: str,
    data: BulkUpdateRequest,
    db: AsyncSession = Depends(get_db)
):
    """Bulk update role or subscription for multiple users"""
    admin = await require_admin(admin_id, db)
    
    if not data.user_ids:
        raise HTTPException(status_code=400, detail="No users specified")
    
    if not data.role and not data.subscription_tier:
        raise HTTPException(status_code=400, detail="No updates specified")
    
    updated_count = 0
    errors = []
    
    for user_id in data.user_ids:
        try:
            result = await db.execute(select(Profile).where(Profile.id == user_id))
            user = result.scalar_one_or_none()
            
            if not user:
                errors.append(f"User {user_id} not found")
                continue
            
            changes = {}
            
            if data.role:
                try:
                    from models import RoleEnum
                    role_enum = RoleEnum[data.role.upper().replace(" ", "_")]
                    user.role = role_enum
                    changes["role"] = data.role
                except KeyError:
                    errors.append(f"Invalid role: {data.role}")
                    continue
            
            if data.subscription_tier:
                user.subscription_tier = data.subscription_tier
                changes["subscription_tier"] = data.subscription_tier
            
            await log_admin_action(db, admin_id, "bulk_update_user", "user", user_id, changes)
            updated_count += 1
            
        except Exception as e:
            errors.append(f"Error updating {user_id}: {str(e)}")
    
    await db.commit()
    
    return {
        "message": f"Updated {updated_count} users",
        "updated_count": updated_count,
        "errors": errors if errors else None
    }


@router.post("/admin/users/{user_id}/suspend")
async def suspend_user(
    user_id: str,
    admin_id: str,
    data: UserSuspendRequest,
    db: AsyncSession = Depends(get_db)
):
    """Suspend a user"""
    admin = await require_admin(admin_id, db)
    
    result = await db.execute(select(Profile).where(Profile.id == user_id))
    user = result.scalar_one_or_none()
    
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    if user.is_admin:
        raise HTTPException(status_code=400, detail="Cannot suspend an admin")
    
    user.is_suspended = True
    user.suspended_at = datetime.now(timezone.utc)
    user.suspended_reason = data.reason
    
    await log_admin_action(db, admin_id, "suspend_user", "user", user_id, {"reason": data.reason})
    await db.commit()
    
    return {"message": f"User {user.email} suspended", "reason": data.reason}

@router.post("/admin/users/{user_id}/unsuspend")
async def unsuspend_user(user_id: str, admin_id: str, db: AsyncSession = Depends(get_db)):
    """Unsuspend a user"""
    admin = await require_admin(admin_id, db)
    
    result = await db.execute(select(Profile).where(Profile.id == user_id))
    user = result.scalar_one_or_none()
    
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    user.is_suspended = False
    user.suspended_at = None
    user.suspended_reason = None
    
    await log_admin_action(db, admin_id, "unsuspend_user", "user", user_id)
    await db.commit()
    
    return {"message": f"User {user.email} unsuspended"}


class BulkDeleteRequest(BaseModel):
    user_ids: List[str]


@router.post("/admin/users/bulk-delete")
async def bulk_delete_users(
    admin_id: str,
    data: BulkDeleteRequest,
    db: AsyncSession = Depends(get_db)
):
    """Bulk delete multiple users (admin only) - excludes admins"""
    admin = await require_admin(admin_id, db)
    
    if not data.user_ids:
        raise HTTPException(status_code=400, detail="No users specified")
    
    deleted_count = 0
    errors = []
    
    for user_id in data.user_ids:
        try:
            # Check if user exists and is not admin
            result = await db.execute(select(Profile).where(Profile.id == user_id))
            user = result.scalar_one_or_none()
            
            if not user:
                continue
            
            if user.is_admin:
                errors.append(f"Cannot delete admin")
                continue
            
            user_email = user.email
            user_role = user.role.value if user.role else None
            
            # Build a single transaction with all deletes
            # Use a savepoint approach - delete related data first, then profile
            cleanup_queries = [
                ("DELETE FROM notifications WHERE user_id = :uid", {"uid": user_id}),
                ("DELETE FROM stories WHERE author_id = :uid", {"uid": user_id}), 
                ("DELETE FROM story_views WHERE viewer_id = :uid", {"uid": user_id}),
                ("DELETE FROM check_ins WHERE user_id = :uid", {"uid": user_id}),
                ("DELETE FROM surf_alerts WHERE user_id = :uid", {"uid": user_id}),
                ("DELETE FROM user_media WHERE user_id = :uid", {"uid": user_id}),
                ("DELETE FROM notification_preferences WHERE user_id = :uid", {"uid": user_id}),
                ("DELETE FROM user_favorites WHERE user_id = :uid", {"uid": user_id}),
                ("DELETE FROM post_likes WHERE user_id = :uid", {"uid": user_id}),
                ("DELETE FROM comments WHERE author_id = :uid", {"uid": user_id}),
                ("DELETE FROM comment_reactions WHERE user_id = :uid", {"uid": user_id}),
                ("DELETE FROM push_subscriptions WHERE user_id = :uid", {"uid": user_id}),
                ("DELETE FROM surfboards WHERE user_id = :uid", {"uid": user_id}),
                ("DELETE FROM posts WHERE author_id = :uid", {"uid": user_id}),
                ("DELETE FROM live_session_participants WHERE photographer_id = :uid OR surfer_id = :uid", {"uid": user_id}),
                ("DELETE FROM live_sessions WHERE photographer_id = :uid", {"uid": user_id}),
                ("DELETE FROM follows WHERE follower_id = :uid OR following_id = :uid", {"uid": user_id}),
                ("DELETE FROM messages WHERE sender_id = :uid", {"uid": user_id}),
                ("DELETE FROM conversation_participants WHERE user_id = :uid", {"uid": user_id}),
                ("DELETE FROM photographer_requests WHERE requester_id = :uid OR accepted_by_id = :uid", {"uid": user_id}),
                ("DELETE FROM dispatch_request_participants WHERE participant_id = :uid", {"uid": user_id}),
                ("DELETE FROM dispatch_requests WHERE requester_id = :uid", {"uid": user_id}),
            ]
            
            # Execute cleanup queries, rollback on any failure and try to continue
            cleanup_failed = False
            for query, params in cleanup_queries:
                try:
                    await db.execute(text(query), params)
                except Exception as cleanup_error:
                    # If any cleanup fails, rollback and mark as failed
                    await db.rollback()
                    cleanup_failed = True
                    break
            
            if cleanup_failed:
                errors.append(f"{user_id[:8]}... cleanup failed")
                continue
            
            # Now delete the profile
            try:
                delete_result = await db.execute(text("DELETE FROM profiles WHERE id = :uid"), {"uid": user_id})
                if delete_result.rowcount == 0:
                    await db.rollback()
                    errors.append(f"{user_id[:8]}... not found")
                    continue
                    
                await db.commit()
                deleted_count += 1
                
            except Exception as delete_error:
                await db.rollback()
                errors.append(f"{user_id[:8]}... delete failed")
                continue
            
        except Exception as e:
            try:
                await db.rollback()
            except Exception:
                pass
            errors.append(f"{user_id[:8]}...")
    
    return {
        "message": f"Deleted {deleted_count} users",
        "deleted_count": deleted_count,
        "errors": errors[:5] if errors else None
    }


@router.delete("/admin/posts/{post_id}")
async def delete_post(post_id: str, admin_id: str, db: AsyncSession = Depends(get_db)):
    """Delete a post (admin moderation)"""
    admin = await require_admin(admin_id, db)
    
    result = await db.execute(select(Post).where(Post.id == post_id))
    post = result.scalar_one_or_none()
    
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    
    await log_admin_action(db, admin_id, "delete_post", "post", post_id, {
        "author_id": post.author_id,
        "caption": post.caption[:100] if post.caption else None
    })
    
    await db.delete(post)
    await db.commit()
    
    return {"message": "Post deleted"}

@router.delete("/admin/gallery/{item_id}")
async def delete_gallery_item(item_id: str, admin_id: str, db: AsyncSession = Depends(get_db)):
    """Delete a gallery item (admin moderation)"""
    admin = await require_admin(admin_id, db)
    
    result = await db.execute(select(GalleryItem).where(GalleryItem.id == item_id))
    item = result.scalar_one_or_none()
    
    if not item:
        raise HTTPException(status_code=404, detail="Gallery item not found")
    
    await log_admin_action(db, admin_id, "delete_gallery_item", "gallery_item", item_id, {
        "photographer_id": item.photographer_id
    })
    
    await db.delete(item)
    await db.commit()
    
    return {"message": "Gallery item deleted"}

@router.get("/admin/logs")
async def get_admin_logs(
    admin_id: str,
    limit: int = 100,
    offset: int = 0,
    db: AsyncSession = Depends(get_db)
):
    """Get admin action logs"""
    await require_admin(admin_id, db)
    
    result = await db.execute(
        select(AdminLog)
        .options(selectinload(AdminLog.admin))
        .order_by(AdminLog.created_at.desc())
        .offset(offset)
        .limit(limit)
    )
    logs = result.scalars().all()
    
    return [{
        "id": log.id,
        "admin_id": log.admin_id,
        "admin_name": log.admin.full_name if log.admin else None,
        "action": log.action,
        "target_type": log.target_type,
        "target_id": log.target_id,
        "details": json.loads(log.details) if log.details else None,
        "created_at": log.created_at.isoformat()
    } for log in logs]

@router.post("/admin/make-admin/{user_id}")
async def make_user_admin(user_id: str, admin_id: str, db: AsyncSession = Depends(get_db)):
    """Grant admin privileges to a user"""
    admin = await require_admin(admin_id, db)
    
    result = await db.execute(select(Profile).where(Profile.id == user_id))
    user = result.scalar_one_or_none()
    
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    user.is_admin = True
    
    await log_admin_action(db, admin_id, "grant_admin", "user", user_id)
    await db.commit()
    
    return {"message": f"{user.email} is now an admin"}

@router.post("/admin/revoke-admin/{user_id}")
async def revoke_user_admin(user_id: str, admin_id: str, db: AsyncSession = Depends(get_db)):
    """Revoke admin privileges from a user"""
    admin = await require_admin(admin_id, db)
    
    if user_id == admin_id:
        raise HTTPException(status_code=400, detail="Cannot revoke your own admin status")
    
    result = await db.execute(select(Profile).where(Profile.id == user_id))
    user = result.scalar_one_or_none()
    
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    user.is_admin = False
    
    await log_admin_action(db, admin_id, "revoke_admin", "user", user_id)
    await db.commit()
    
    return {"message": f"{user.email} admin privileges revoked"}


@router.api_route("/admin/bootstrap", methods=["GET", "POST"])
async def bootstrap_first_admin(email: str, db: AsyncSession = Depends(get_db)):
    """
    Bootstrap the first admin user.
    SECURITY: Only enabled when ALLOW_ADMIN_BOOTSTRAP=true env var is set.
    Never set this in production — this endpoint is intentionally disabled by default.
    """
    import os
    if os.getenv("ALLOW_ADMIN_BOOTSTRAP", "false").lower() != "true":
        raise HTTPException(status_code=404, detail="Not found")
    # Check if any admin exists
    existing_admin = await db.execute(
        select(Profile).where(Profile.is_admin == True)
    )
    if existing_admin.scalars().first():
        raise HTTPException(status_code=400, detail="Admin already exists. Use /admin/make-admin instead.")
    
    # Find user by email
    result = await db.execute(select(Profile).where(Profile.email == email))
    user = result.scalar_one_or_none()
    
    if not user:
        raise HTTPException(status_code=404, detail="User not found. Create an account first.")
    
    # Make them admin
    user.is_admin = True
    await db.commit()
    
    return {
        "message": f"🎉 {user.full_name or user.email} is now the first admin!",
        "user_id": user.id,
        "access": "Go to /admin in the app to access God Mode"
    }



@router.post("/admin/setup/{email}")
async def setup_admin_by_email(email: str, db: AsyncSession = Depends(get_db)):
    """
    Direct admin setup by email — for initial configuration only.

    SECURITY LAYERS:
    1. ALLOW_ADMIN_BOOTSTRAP env var must be explicitly set to 'true'
       (it is NOT set on Render/Netlify by default)
    2. Endpoint restricted to POST only (no accidental GET-based discovery)
    3. If admin already exists this endpoint refuses to operate
    4. Removed from GET routes so it won't appear in OpenAPI 'Try It Out'

    To temporarily enable: set ALLOW_ADMIN_BOOTSTRAP=true in Render env vars,
    make your account admin, then immediately remove the env var.
    """
    import os
    if os.getenv("ALLOW_ADMIN_BOOTSTRAP", "false").lower() != "true":
        raise HTTPException(status_code=404, detail="Not found")

    # Safety: refuse to run if ANY admin already exists (use /admin/make-admin instead)
    existing_admin_result = await db.execute(
        select(Profile).where(Profile.is_admin == True).limit(1)
    )
    if existing_admin_result.scalars().first():
        raise HTTPException(
            status_code=400,
            detail="An admin already exists. Use /admin/make-admin/{user_id} (requires admin_id)."
        )

    result = await db.execute(select(Profile).where(Profile.email == email))
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(status_code=404, detail="User not found. Create an account first.")

    user.is_admin = True
    await db.commit()

    return {
        "message": f"✅ {user.full_name or user.email} is now an admin!",
        "next_step": "Log out and log back in, then click 'Admin' in the sidebar",
        "security_reminder": "Remove ALLOW_ADMIN_BOOTSTRAP from your environment variables now.",
    }
