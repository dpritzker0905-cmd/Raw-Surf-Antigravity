"""Admin surf-forecast: the condition-report moderation routes (moved verbatim from surf_forecast.py, 2026-11-22).

Mounted on `surf_forecast.router` and re-exported there, so the URLs, auth and callers are unchanged."""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import Profile, SurfReport, SurfSpot
from routes.admin.core import log_admin_action
from deps.admin_auth import get_current_admin

router = APIRouter()


@router.get("/admin/surf-forecast/reports")
async def get_recent_surf_reports(
    hours: int = 168, limit: int = 200,
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Recent user condition reports — the human observations that confirm Good/Epic and nudge scores
    when RATING_OBS_GATE is on. Fresh (<=12 h) rows are the LIVE inputs; older rows are context."""
    cutoff = datetime.now(timezone.utc) - timedelta(hours=max(1, min(hours, 24 * 30)))
    rows = (await db.execute(
        select(SurfReport, SurfSpot.name)
        .join(SurfSpot, SurfSpot.id == SurfReport.spot_id, isouter=True)
        .where(SurfReport.created_at >= cutoff)
        .order_by(SurfReport.created_at.desc())
        .limit(max(1, min(limit, 500)))
    )).all()
    fresh_cut = datetime.now(timezone.utc) - timedelta(hours=12)
    return {"count": len(rows), "reports": [{
        "id": r.id, "spot_id": r.spot_id, "spot_name": name,
        "user_id": r.user_id, "rating": r.rating, "conditions": r.conditions,
        "wave_height": r.wave_height, "notes": r.notes,
        "created_at": r.created_at.isoformat() if r.created_at else None,
        "influences_rating_now": bool(r.created_at and r.created_at >= fresh_cut and r.rating is not None),
    } for r, name in rows]}


@router.delete("/admin/surf-forecast/reports/{report_id}")
async def delete_surf_report(
    report_id: str,
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Moderation: remove a junk/abusive condition report. Takes effect on the next rating pass —
    the confirmation/nudge reads only live rows."""
    row = (await db.execute(select(SurfReport).where(SurfReport.id == report_id))).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Report not found")
    await log_admin_action(db, admin.id, "delete_surf_report", "surf_report", report_id, {   # admin_logs: the trace
        "spot_id": row.spot_id, "user_id": row.user_id, "rating": row.rating,
        "created_at": row.created_at.isoformat() if row.created_at else None})
    await db.delete(row)
    await db.commit()
    return {"deleted": report_id}
