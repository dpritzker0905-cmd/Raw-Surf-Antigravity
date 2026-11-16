"""Admin API for the surf-truth anchors and the admin action log (anchors B).

Strict JWT plus the admin role (`get_current_admin`) on every route. Admins change STATUSES (who is an anchor, and
in what state) with a required reason; every change is written to the anchor's own event log and to the admin action
log in the same transaction. No route here, or anywhere in the surf-truth area, edits a reported number: the request
bodies have no such field and refuse unknown ones.
"""
import json
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from deps.admin_auth import get_current_admin
from models import Profile, SurfObservation, SurfTruthAdminAction, SurfTruthAnchor, SurfTruthAnchorEvent
from services import surf_truth_admin, surf_truth_anchors
from services.surf_truth_anchors import AnchorError

router = APIRouter()
RECENT = timedelta(days=30)


class AnchorStatusChange(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["active", "probation", "suspended"]
    reason: str = Field(..., min_length=1, max_length=surf_truth_anchors.MAX_REASON)


@router.get("/admin/surf-truth/anchors")
async def list_anchors(db: AsyncSession = Depends(get_db), admin: Profile = Depends(get_current_admin)):
    since = datetime.now(timezone.utc) - RECENT
    counts = dict((await db.execute(
        select(SurfObservation.user_id, func.count()).where(SurfObservation.received_at >= since)
        .group_by(SurfObservation.user_id))).all())
    rows = (await db.execute(select(SurfTruthAnchor, Profile.full_name)
                             .join(Profile, Profile.id == SurfTruthAnchor.profile_id, isouter=True)
                             .order_by(SurfTruthAnchor.appointed_at))).all()
    return [{
        "profile_id": a.profile_id, "name": name, "status": a.status,
        "status_since": a.status_since.isoformat(), "appointed_at": a.appointed_at.isoformat(),
        "appointed_by": a.appointed_by, "observations_30d": counts.get(a.profile_id, 0),
    } for a, name in rows]


@router.post("/admin/surf-truth/anchors/{profile_id}/status")
async def change_anchor_status(profile_id: str, body: AnchorStatusChange, db: AsyncSession = Depends(get_db),
                               admin: Profile = Depends(get_current_admin)):
    if await db.get(Profile, profile_id) is None:
        raise HTTPException(status_code=404, detail="Profile not found")
    try:
        event_row = await surf_truth_anchors.set_status(db, profile_id, body.status, admin.id, body.reason)
    except AnchorError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    surf_truth_admin.log_action(db, admin.id, "anchor_status", "anchor", profile_id, reason=event_row.reason,
                                detail={"from": event_row.from_status, "to": event_row.to_status,
                                        "self": profile_id == admin.id})
    await db.commit()
    return {"profile_id": profile_id, "status": event_row.to_status, "from_status": event_row.from_status}


@router.get("/admin/surf-truth/anchors/{profile_id}/events")
async def anchor_events(profile_id: str, db: AsyncSession = Depends(get_db),
                        admin: Profile = Depends(get_current_admin)):
    rows = (await db.execute(select(SurfTruthAnchorEvent).where(SurfTruthAnchorEvent.profile_id == profile_id)
                             .order_by(SurfTruthAnchorEvent.at))).scalars().all()
    return [{"from_status": e.from_status, "to_status": e.to_status, "actor_id": e.actor_id, "reason": e.reason,
             "at": e.at.isoformat()} for e in rows]


@router.get("/admin/surf-truth/actions")
async def admin_actions(limit: int = 100, db: AsyncSession = Depends(get_db),
                        admin: Profile = Depends(get_current_admin)):
    rows = (await db.execute(select(SurfTruthAdminAction).order_by(SurfTruthAdminAction.at.desc())
                             .limit(max(1, min(limit, 500))))).scalars().all()
    # Names for display (admins and anchor targets are profiles); ids stay in the payload as the record.
    ids = {r.admin_id for r in rows} | {r.target_id for r in rows if r.target_type == "anchor"}
    names = dict((await db.execute(select(Profile.id, Profile.full_name).where(Profile.id.in_(ids)))).all())         if ids else {}
    return [{"id": r.id, "admin_id": r.admin_id, "admin_name": names.get(r.admin_id), "action": r.action,
             "target_type": r.target_type, "target_id": r.target_id,
             "target_name": names.get(r.target_id) if r.target_type == "anchor" else None, "reason": r.reason,
             "detail": json.loads(r.detail) if r.detail else None, "at": r.at.isoformat()} for r in rows]
