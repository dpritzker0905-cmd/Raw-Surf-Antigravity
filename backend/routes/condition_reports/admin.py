"""Condition reports admin — orphan cleanup, admin delete, admin list, session cleanup."""
import logging
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional

from database import get_db
from deps.admin_auth import get_current_admin
from models import ConditionReport, Gallery, Profile

router = APIRouter()
cr_logger = logging.getLogger(__name__)


@router.delete("/condition-reports/cleanup/orphaned")
async def cleanup_orphaned_condition_reports(
    photographer_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Clean up orphaned condition reports for a photographer.
    Deletes reports whose linked gallery (via live_session_id) no longer exists.
    """
    # Verify photographer exists
    prof = await db.execute(select(Profile).where(Profile.id == photographer_id))
    photographer = prof.scalar_one_or_none()
    if not photographer:
        raise HTTPException(status_code=404, detail="Photographer not found")
    
    # Get all condition reports for this photographer
    reports_result = await db.execute(
        select(ConditionReport).where(
            ConditionReport.photographer_id == photographer_id
        )
    )
    reports = reports_result.scalars().all()
    
    deleted = 0
    for report in reports:
        is_orphaned = False
        
        # Check if the linked live session's gallery still exists
        if report.live_session_id:
            gallery_check = await db.execute(
                select(Gallery.id).where(Gallery.live_session_id == report.live_session_id)
            )
            if not gallery_check.scalar_one_or_none():
                is_orphaned = True
        
        if is_orphaned:
            await db.delete(report)
            deleted += 1
    
    if deleted > 0:
        await db.commit()
    
    cr_logger.info(f"Cleaned up {deleted} orphaned condition reports for photographer {photographer_id}")
    
    return {
        "message": f"Cleaned up {deleted} orphaned condition reports",
        "deleted_count": deleted
    }


# ── Admin Moderation ─────────────────────────────────────────────────
# Allows admins to remove any condition report (questionable content,
# stale orphans, etc.) bypassing photographer ownership checks.
# Secured via JWT admin auth — same pattern as admin_content_mod.py.

@router.delete("/admin/condition-reports/{report_id}")
async def admin_remove_condition_report(
    report_id: str,
    reason: Optional[str] = Query(None, description="Reason for removal"),
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    Admin-only: Remove any condition report.
    Use this to take down questionable, inappropriate, or stale content.
    """
    result = await db.execute(
        select(ConditionReport).where(ConditionReport.id == report_id)
    )
    report = result.scalar_one_or_none()

    if not report:
        raise HTTPException(status_code=404, detail="Condition report not found")

    photographer_id = report.photographer_id
    spot_id = report.spot_id

    await db.delete(report)
    await db.commit()

    cr_logger.info(
        f"ADMIN ACTION: Condition report {report_id} deleted by admin {admin.id} "
        f"(photographer={photographer_id}, spot={spot_id}, reason={reason or 'none'})"
    )

    return {
        "success": True,
        "message": "Condition report removed by admin",
        "report_id": report_id,
        "admin_id": admin.id,
        "reason": reason
    }


@router.get("/admin/condition-reports")
async def admin_list_condition_reports(
    admin: Profile = Depends(get_current_admin),
    spot_id: Optional[str] = None,
    photographer_id: Optional[str] = None,
    active_only: bool = True,
    limit: int = 50,
    offset: int = 0,
    db: AsyncSession = Depends(get_db)
):
    """
    Admin-only: List all condition reports with optional filters.
    Useful for reviewing content across the platform.
    """
    query = select(ConditionReport).order_by(desc(ConditionReport.created_at))

    if spot_id:
        query = query.where(ConditionReport.spot_id == spot_id)
    if photographer_id:
        query = query.where(ConditionReport.photographer_id == photographer_id)
    if active_only:
        query = query.where(ConditionReport.is_active == True)

    result = await db.execute(query.limit(limit).offset(offset))
    reports = result.scalars().all()

    return {
        "reports": [{
            "id": r.id,
            "photographer_id": r.photographer_id,
            "spot_id": r.spot_id,
            "media_url": r.media_url,
            "media_type": r.media_type,
            "caption": r.caption,
            "wave_height_ft": r.wave_height_ft,
            "conditions_label": r.conditions_label,
            "is_active": r.is_active,
            "created_at": r.created_at.isoformat() if r.created_at else None,
            "expires_at": r.expires_at.isoformat() if r.expires_at else None,
        } for r in reports],
        "total": len(reports)
    }


@router.delete("/admin/condition-reports/cleanup-orphaned-sessions")
async def admin_cleanup_orphaned_condition_reports(
    spot_id: Optional[str] = None,
    dry_run: bool = Query(True, description="Preview deletions without committing"),
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    Admin-only: Bulk-delete orphaned condition reports.
    
    Orphaned = condition reports that have NO live_session_id attached.
    
    Every valid condition report is created during a go-live event and is
    tethered to a LiveSession. Reports without this link were either:
    - Created by a bug in an older push-conditions flow
    - Left behind when a gallery/session was deleted
    - Manually created without a proper session context
    
    These orphans show up as stale entries on dates with no actual session
    record, polluting the Reports tab.
    
    Use dry_run=true first to preview what would be deleted.
    """
    query = select(ConditionReport).where(
        ConditionReport.live_session_id.is_(None)
    )

    if spot_id:
        query = query.where(ConditionReport.spot_id == spot_id)

    result = await db.execute(query)
    orphaned_reports = result.scalars().all()

    preview = [{
        "id": r.id,
        "spot_id": r.spot_id,
        "spot_name": r.spot_name,
        "caption": r.caption,
        "media_url": r.media_url[:80] if r.media_url else None,
        "created_at": r.created_at.isoformat() if r.created_at else None,
        "live_session_id": r.live_session_id,
    } for r in orphaned_reports]

    if dry_run:
        return {
            "dry_run": True,
            "would_delete": len(orphaned_reports),
            "preview": preview[:50],
            "message": f"Found {len(orphaned_reports)} orphaned condition reports (no live_session_id). Set dry_run=false to delete."
        }

    for report in orphaned_reports:
        await db.delete(report)
    
    await db.commit()

    cr_logger.info(
        f"ADMIN ACTION: Bulk-deleted {len(orphaned_reports)} orphaned condition reports "
        f"(no live_session_id) by admin {admin.id} (spot_id={spot_id or 'all'})"
    )

    return {
        "dry_run": False,
        "deleted": len(orphaned_reports),
        "message": f"Deleted {len(orphaned_reports)} orphaned condition reports",
        "admin_id": admin.id
    }
