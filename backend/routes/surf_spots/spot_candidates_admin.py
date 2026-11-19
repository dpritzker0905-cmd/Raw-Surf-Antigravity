"""Admin read of the surf-spot HOLDING TABLE (`surf_spot_candidates`), one page at a time.

Read only. Nothing here adds, moves or promotes a spot; the candidates stay in the holding table. Admin only.
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from deps.admin_auth import get_current_admin
from models import Profile, SurfSpotCandidate
from models.spot_candidates import STATUSES, TIERS

router = APIRouter(prefix="/admin/spots", tags=["Admin Spots"])


def _row(c: SurfSpotCandidate) -> dict:
    return {
        "id": c.id, "source": c.source, "source_record_id": c.source_record_id, "batch_id": c.batch_id,
        "name": c.name, "latitude": c.latitude, "longitude": c.longitude, "country": c.country,
        "tier": c.tier, "status": c.status,
        "nearest_spot_id": c.nearest_spot_id, "nearest_spot_name": c.nearest_spot_name,
        "nearest_spot_km": c.nearest_spot_km,
        "name_match_spot_id": c.name_match_spot_id, "name_match_spot_name": c.name_match_spot_name,
        "name_match_km": c.name_match_km, "shoreline_km": c.shoreline_km,
        "proposed_latitude": c.proposed_latitude, "proposed_longitude": c.proposed_longitude,
        "review_note": c.review_note, "reviewed_at": c.reviewed_at.isoformat() if c.reviewed_at else None,
        "duplicate_of_spot_id": c.duplicate_of_spot_id, "promoted_spot_id": c.promoted_spot_id,
    }


@router.get("/candidates")
async def admin_list_spot_candidates(
    admin: Profile = Depends(get_current_admin),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    status: Optional[str] = None,
    tier: Optional[str] = None,
    country: Optional[str] = None,
    search: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    """Candidates waiting in the holding table. `total` counts every candidate matching the filters; `counts` is the
    whole table by status and by tier, whatever the filters."""
    if status and status not in STATUSES:
        raise HTTPException(status_code=422, detail=f"status must be one of: {', '.join(STATUSES)}")
    if tier and tier not in TIERS:
        raise HTTPException(status_code=422, detail=f"tier must be one of: {', '.join(TIERS)}")

    query = select(SurfSpotCandidate)
    if status:
        query = query.where(SurfSpotCandidate.status == status)
    if tier:
        query = query.where(SurfSpotCandidate.tier == tier)
    if country:
        query = query.where(SurfSpotCandidate.country == country)
    if search and search.strip():
        like = f"%{search.strip()}%"
        query = query.where(or_(SurfSpotCandidate.name.ilike(like), SurfSpotCandidate.nearest_spot_name.ilike(like)))

    total = (await db.execute(select(func.count()).select_from(query.subquery()))).scalar()
    rows = (await db.execute(
        query.order_by(SurfSpotCandidate.tier, SurfSpotCandidate.country, SurfSpotCandidate.name, SurfSpotCandidate.id)
        .offset((page - 1) * limit).limit(limit))).scalars().all()

    by_status = dict((await db.execute(
        select(SurfSpotCandidate.status, func.count()).group_by(SurfSpotCandidate.status))).all())
    by_tier = dict((await db.execute(
        select(SurfSpotCandidate.tier, func.count()).group_by(SurfSpotCandidate.tier))).all())

    return {
        "candidates": [_row(c) for c in rows],
        "total": total, "page": page, "limit": limit,
        "counts": {"all": sum(by_status.values()),
                   "by_status": {s: by_status.get(s, 0) for s in STATUSES},
                   "by_tier": {t: by_tier.get(t, 0) for t in TIERS}},
    }
