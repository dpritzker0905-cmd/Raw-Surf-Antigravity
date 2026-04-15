"""
User Block API Routes
Allows users to block other users for safety
Integrates with TOS violation/warning system
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_, desc, delete
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone
import logging
import uuid

from database import get_db
from models import Profile, UserBlock, UserReport, TosViolation, Follow

router = APIRouter()
logger = logging.getLogger(__name__)


# Pydantic models
class BlockUserRequest(BaseModel):
    blocker_id: str
    blocked_id: str
    reason: Optional[str] = None  # harassment, spam, inappropriate, scam, other
    notes: Optional[str] = None
    auto_report: bool = False  # If true, also creates a report for admin review


class UnblockUserRequest(BaseModel):
    blocker_id: str
    blocked_id: str


# ============ BLOCK ENDPOINTS ============

@router.post("/users/block")
async def block_user(
    request: BlockUserRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Block a user. When blocked:
    - Blocked user cannot message the blocker
    - Blocked user cannot see blocker's posts in feed
    - Blocked user cannot follow the blocker
    - Any existing follow relationship is removed
    """
    try:
        # Validate users exist
        blocker_result = await db.execute(select(Profile).where(Profile.id == request.blocker_id))
        blocker = blocker_result.scalar_one_or_none()
        if not blocker:
            raise HTTPException(status_code=404, detail="Blocker user not found")
        
        blocked_result = await db.execute(select(Profile).where(Profile.id == request.blocked_id))
        blocked = blocked_result.scalar_one_or_none()
        if not blocked:
            raise HTTPException(status_code=404, detail="User to block not found")
        
        # Can't block yourself
        if request.blocker_id == request.blocked_id:
            raise HTTPException(status_code=400, detail="Cannot block yourself")
        
        # Check if already blocked
        existing = await db.execute(
            select(UserBlock).where(
                UserBlock.blocker_id == request.blocker_id,
                UserBlock.blocked_id == request.blocked_id
            )
        )
        if existing.scalar_one_or_none():
            raise HTTPException(status_code=400, detail="User already blocked")
        
        # Create the block
        block = UserBlock(
            id=str(uuid.uuid4()),
            blocker_id=request.blocker_id,
            blocked_id=request.blocked_id,
            reason=request.reason,
            notes=request.notes,
            auto_reported=request.auto_report
        )
        
        # If auto_report is true or reason is severe, create a user report
        report_id = None
        if request.auto_report or request.reason in ['harassment', 'scam']:
            report = UserReport(
                id=str(uuid.uuid4()),
                reporter_id=request.blocker_id,
                report_type='user',
                reported_user_id=request.blocked_id,
                reason=request.reason or 'harassment',
                description=f"User blocked with reason: {request.reason}. Notes: {request.notes or 'None provided'}",
                status='pending',
                priority='high' if request.reason in ['harassment', 'scam'] else 'normal'
            )
            db.add(report)
            await db.flush()
            block.report_id = report.id
            report_id = report.id
        
        db.add(block)
        
        # Remove any existing follow relationships (both directions)
        await db.execute(
            delete(Follow).where(
                or_(
                    and_(Follow.follower_id == request.blocker_id, Follow.following_id == request.blocked_id),
                    and_(Follow.follower_id == request.blocked_id, Follow.following_id == request.blocker_id)
                )
            )
        )
        
        # Check if this user has been blocked by many people - flag for admin review
        block_count_result = await db.execute(
            select(func.count()).select_from(UserBlock).where(
                UserBlock.blocked_id == request.blocked_id
            )
        )
        block_count = block_count_result.scalar() or 0
        
        # If blocked by 5+ users, auto-flag for admin
        admin_flagged = False
        if block_count >= 5:
            admin_flagged = True
            # Could trigger TOS warning here
            logger.warning(f"User {request.blocked_id} has been blocked by {block_count + 1} users - flagged for admin review")
        
        await db.commit()
        
        return {
            "success": True,
            "message": "User blocked successfully",
            "block_id": block.id,
            "report_created": report_id is not None,
            "report_id": report_id,
            "admin_flagged": admin_flagged,
            "total_blocks_on_user": block_count + 1
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error blocking user: {e}")
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/users/unblock")
async def unblock_user(
    request: UnblockUserRequest,
    db: AsyncSession = Depends(get_db)
):
    """Unblock a previously blocked user"""
    try:
        result = await db.execute(
            select(UserBlock).where(
                UserBlock.blocker_id == request.blocker_id,
                UserBlock.blocked_id == request.blocked_id
            )
        )
        block = result.scalar_one_or_none()
        
        if not block:
            raise HTTPException(status_code=404, detail="Block not found")
        
        await db.delete(block)
        await db.commit()
        
        return {"success": True, "message": "User unblocked"}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error unblocking user: {e}")
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/users/{user_id}/blocked")
async def get_blocked_users(
    user_id: str,
    limit: int = Query(50, le=100),
    offset: int = 0,
    db: AsyncSession = Depends(get_db)
):
    """Get list of users that this user has blocked"""
    try:
        query = (
            select(UserBlock)
            .where(UserBlock.blocker_id == user_id)
            .options(selectinload(UserBlock.blocked))
            .order_by(desc(UserBlock.created_at))
            .offset(offset)
            .limit(limit)
        )
        
        result = await db.execute(query)
        blocks = result.scalars().all()
        
        # Get total count
        count_result = await db.execute(
            select(func.count()).select_from(UserBlock).where(UserBlock.blocker_id == user_id)
        )
        total = count_result.scalar() or 0
        
        return {
            "blocked_users": [{
                "block_id": b.id,
                "user_id": b.blocked_id,
                "username": b.blocked.username if b.blocked else None,
                "full_name": b.blocked.full_name if b.blocked else None,
                "avatar_url": b.blocked.avatar_url if b.blocked else None,
                "reason": b.reason,
                "blocked_at": b.created_at.isoformat() if b.created_at else None
            } for b in blocks],
            "total": total,
            "has_more": offset + limit < total
        }
        
    except Exception as e:
        logger.error(f"Error fetching blocked users: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/users/{user_id}/is-blocked/{other_user_id}")
async def check_block_status(
    user_id: str,
    other_user_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Check if there's a block between two users (in either direction)"""
    try:
        # Check if user_id blocked other_user_id
        result1 = await db.execute(
            select(UserBlock).where(
                UserBlock.blocker_id == user_id,
                UserBlock.blocked_id == other_user_id
            )
        )
        user_blocked_other = result1.scalar_one_or_none() is not None
        
        # Check if other_user_id blocked user_id
        result2 = await db.execute(
            select(UserBlock).where(
                UserBlock.blocker_id == other_user_id,
                UserBlock.blocked_id == user_id
            )
        )
        other_blocked_user = result2.scalar_one_or_none() is not None
        
        return {
            "user_blocked_other": user_blocked_other,
            "other_blocked_user": other_blocked_user,
            "any_block_exists": user_blocked_other or other_blocked_user,
            "mutual_block": user_blocked_other and other_blocked_user
        }
        
    except Exception as e:
        logger.error(f"Error checking block status: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/users/{user_id}/blocked-ids")
async def get_blocked_user_ids(
    user_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Get just the IDs of blocked users (for filtering content in feeds).
    Also includes users who have blocked this user (mutual exclusion).
    """
    try:
        # Users this person has blocked
        blocked_result = await db.execute(
            select(UserBlock.blocked_id).where(UserBlock.blocker_id == user_id)
        )
        blocked_ids = [r[0] for r in blocked_result.fetchall()]
        
        # Users who have blocked this person
        blocked_by_result = await db.execute(
            select(UserBlock.blocker_id).where(UserBlock.blocked_id == user_id)
        )
        blocked_by_ids = [r[0] for r in blocked_by_result.fetchall()]
        
        # Combined list (union) for content filtering
        all_excluded = list(set(blocked_ids + blocked_by_ids))
        
        return {
            "blocked_ids": blocked_ids,
            "blocked_by_ids": blocked_by_ids,
            "all_excluded_ids": all_excluded
        }
        
    except Exception as e:
        logger.error(f"Error fetching blocked IDs: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============ ADMIN ENDPOINTS ============

@router.get("/admin/blocks/flagged")
async def get_flagged_users(
    admin_id: str,
    min_blocks: int = Query(5, ge=1),
    limit: int = Query(50, le=100),
    db: AsyncSession = Depends(get_db)
):
    """
    Admin endpoint: Get users who have been blocked by many people
    These users may need TOS review
    """
    try:
        # Verify admin
        admin_result = await db.execute(select(Profile).where(Profile.id == admin_id))
        admin = admin_result.scalar_one_or_none()
        if not admin or not admin.is_admin:
            raise HTTPException(status_code=403, detail="Admin access required")
        
        # Get users with block counts
        query = (
            select(
                UserBlock.blocked_id,
                func.count(UserBlock.id).label('block_count'),
                func.max(UserBlock.created_at).label('last_blocked_at')
            )
            .group_by(UserBlock.blocked_id)
            .having(func.count(UserBlock.id) >= min_blocks)
            .order_by(desc('block_count'))
            .limit(limit)
        )
        
        result = await db.execute(query)
        rows = result.fetchall()
        
        flagged_users = []
        for row in rows:
            user_id, block_count, last_blocked = row
            
            # Get user details
            user_result = await db.execute(select(Profile).where(Profile.id == user_id))
            user = user_result.scalar_one_or_none()
            
            # Get reasons breakdown
            reasons_result = await db.execute(
                select(UserBlock.reason, func.count(UserBlock.id))
                .where(UserBlock.blocked_id == user_id)
                .group_by(UserBlock.reason)
            )
            reasons = {r[0] or 'unspecified': r[1] for r in reasons_result.fetchall()}
            
            # Check for existing TOS violations
            violations_result = await db.execute(
                select(func.count()).select_from(TosViolation).where(TosViolation.user_id == user_id)
            )
            violation_count = violations_result.scalar() or 0
            
            flagged_users.append({
                "user_id": user_id,
                "username": user.username if user else None,
                "full_name": user.full_name if user else None,
                "email": user.email if user else None,
                "block_count": block_count,
                "last_blocked_at": last_blocked.isoformat() if last_blocked else None,
                "block_reasons": reasons,
                "existing_violations": violation_count,
                "is_suspended": user.is_suspended if user else False
            })
        
        return {
            "flagged_users": flagged_users,
            "threshold": min_blocks
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching flagged users: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/admin/blocks/{user_id}/review")
async def admin_review_blocks(
    user_id: str,
    admin_id: str,
    notes: Optional[str] = None,
    create_violation: bool = False,
    violation_type: Optional[str] = None,
    violation_severity: Optional[str] = "moderate",
    db: AsyncSession = Depends(get_db)
):
    """
    Admin reviews a user who has been blocked by many people.
    Can optionally create a TOS violation.
    """
    try:
        # Verify admin
        admin_result = await db.execute(select(Profile).where(Profile.id == admin_id))
        admin = admin_result.scalar_one_or_none()
        if not admin or not admin.is_admin:
            raise HTTPException(status_code=403, detail="Admin access required")
        
        # Mark all blocks as reviewed
        await db.execute(
            select(UserBlock)
            .where(UserBlock.blocked_id == user_id, UserBlock.admin_reviewed.is_(False))
        )
        
        # Update blocks
        from sqlalchemy import update
        await db.execute(
            update(UserBlock)
            .where(UserBlock.blocked_id == user_id)
            .values(admin_reviewed=True, admin_notes=notes)
        )
        
        violation_id = None
        if create_violation and violation_type:
            # Get block count for evidence
            count_result = await db.execute(
                select(func.count()).select_from(UserBlock).where(UserBlock.blocked_id == user_id)
            )
            block_count = count_result.scalar() or 0
            
            # Determine strike points based on severity
            strike_points = {'minor': 1, 'moderate': 2, 'severe': 3, 'critical': 5}.get(violation_severity, 1)
            
            violation = TosViolation(
                id=str(uuid.uuid4()),
                user_id=user_id,
                violation_type=violation_type,
                severity=violation_severity,
                strike_points=strike_points,
                title=f"Multiple user blocks ({block_count} users)",
                description=f"User has been blocked by {block_count} users. Admin review notes: {notes or 'None'}",
                evidence={"block_count": block_count, "reviewed_by": admin_id},
                action_taken='warning',
                reviewed_by=admin_id
            )
            db.add(violation)
            await db.flush()
            violation_id = violation.id
        
        await db.commit()
        
        return {
            "success": True,
            "user_id": user_id,
            "reviewed_by": admin_id,
            "violation_created": violation_id is not None,
            "violation_id": violation_id
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error reviewing blocks: {e}")
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
