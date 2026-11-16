"""Read-only monitoring for the admin "Surf truth" area (anchors C): who is observing, and where.

Counts only. Neither route returns a reported height, scale or typical/sets: the admin area is for watching the
truth stream's health (volume, quality gate, corroboration, coverage), not for judging anyone's numbers, which would
invite value-based moderation. Strict JWT + admin role on both.
"""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from deps.admin_auth import get_current_admin
from models import Profile, SurfObservation, SurfSpot, SurfTruthAnchor

router = APIRouter()


def _n(condition):
    return func.coalesce(func.sum(case((condition, 1), else_=0)), 0)


def _iso(ts):
    if ts is None:
        return None
    return ts.isoformat() if hasattr(ts, "isoformat") else str(ts)


@router.get("/admin/surf-truth/observers")
async def observers(days: int = Query(30, ge=1, le=365), limit: int = Query(200, ge=1, le=500),
                    db: AsyncSession = Depends(get_db), admin: Profile = Depends(get_current_admin)):
    since = datetime.now(timezone.utc) - timedelta(days=days)
    o = SurfObservation
    rows = (await db.execute(
        select(o.user_id, Profile.full_name, SurfTruthAnchor.status, func.count(o.id), _n(o.quality_ok.is_(True)),
               _n(o.flags != ""), _n(o.corroborated.is_(True)), _n(o.xp_status == "granted"),
               _n(o.forecast_shown_before.is_(False)), func.count(func.distinct(o.spot_id)), func.max(o.received_at))
        .join(Profile, Profile.id == o.user_id, isouter=True)
        .join(SurfTruthAnchor, SurfTruthAnchor.profile_id == o.user_id, isouter=True)
        .where(o.received_at >= since)
        .group_by(o.user_id, Profile.full_name, SurfTruthAnchor.status)
        .order_by(func.count(o.id).desc()).limit(limit))).all()
    return [{"profile_id": uid, "name": name, "anchor_status": anchor, "observations": n, "quality_ok": ok,
             "flagged": flagged, "corroborated": corr, "xp_paid": paid, "blind": blind, "spots": spots,
             "last_at": _iso(last)}
            for uid, name, anchor, n, ok, flagged, corr, paid, blind, spots, last in rows]


@router.get("/admin/surf-truth/coverage")
async def coverage(days: int = Query(30, ge=1, le=365), limit: int = Query(300, ge=1, le=1000),
                   db: AsyncSession = Depends(get_db), admin: Profile = Depends(get_current_admin)):
    since = datetime.now(timezone.utc) - timedelta(days=days)
    o = SurfObservation
    rows = (await db.execute(
        select(o.spot_id, SurfSpot.name, SurfSpot.country, SurfSpot.state_province, func.count(o.id),
               func.count(func.distinct(o.user_id)), _n(o.quality_ok.is_(True)),
               _n(o.observer_role == "anchor"), _n(o.forecast_shown_before.is_(False)), func.max(o.received_at))
        .join(SurfSpot, SurfSpot.id == o.spot_id, isouter=True)
        .where(o.received_at >= since)
        .group_by(o.spot_id, SurfSpot.name, SurfSpot.country, SurfSpot.state_province)
        .order_by(func.count(o.id).desc()).limit(limit))).all()
    spots = [{"spot_id": sid, "name": name, "country": country, "region": region, "observations": n,
              "observers": people, "quality_ok": ok, "anchor_observations": anchor, "blind": blind,
              "last_at": _iso(last)}
             for sid, name, country, region, n, people, ok, anchor, blind, last in rows]
    # Totals over the WHOLE window in SQL (advisor, #988): the list above is capped at `limit` spots.
    total_n, total_ok = (await db.execute(select(func.count(o.id), _n(o.quality_ok.is_(True)))
                                          .where(o.received_at >= since))).one()
    per_spot = (select(o.spot_id.label("spot_id"), func.count(func.distinct(o.user_id)).label("people"))
                .where(o.received_at >= since).group_by(o.spot_id).subquery())
    n_spots, multi = (await db.execute(select(func.count(), _n(per_spot.c.people >= 2)).select_from(per_spot))).one()
    return {"days": days, "spots": spots, "listed": len(spots),
            "totals": {"spots": n_spots, "observations": total_n, "quality_ok": total_ok,
                       "multi_observer_spots": multi}}
