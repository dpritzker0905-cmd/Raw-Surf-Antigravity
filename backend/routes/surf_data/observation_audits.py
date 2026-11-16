"""Admin audit queue for blind surf observations (T1 crowd truth, P2).

A random sample of quality-gated observations is held (`xp_status='held_audit'`) until an admin looks at it: the
photo, the place and the entry. A pass pays the held XP (and any corroboration it now completes); a fail pays
nothing. The audit judges whether the report is GENUINE (a real, current look at that spot), never whether its
height agrees with anyone, our forecast included: the queue does not show a forecast.
"""
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from deps.admin_auth import get_current_admin
from models import Profile, SurfObservation
from services import observation_rewards

router = APIRouter()


class AuditVerdict(BaseModel):
    model_config = ConfigDict(extra="forbid")
    verdict: Literal["pass", "fail"]


@router.get("/admin/surf-observations/audits")
async def list_pending_audits(limit: int = 50, db: AsyncSession = Depends(get_db),
                              admin: Profile = Depends(get_current_admin)):
    rows = (await db.execute(select(SurfObservation).where(SurfObservation.xp_status == "held_audit")
                             .order_by(SurfObservation.received_at).limit(max(1, min(limit, 200))))).scalars().all()
    # NO height, unit, range, scale or typical/sets (advisor condition on #980): an auditor who saw "12 ft" at a small
    # beach would fail it, which is value-based selection through the back door and removes exactly the surprising
    # reports the truth stream exists to keep. The photo, place, time and flags are what judging "genuine" needs.
    return [{
        "id": r.id, "spot_id": r.spot_id, "surface": r.surface, "received_at": r.received_at.isoformat(),
        "media_url": r.media_url,
        "gps_distance_m": r.gps_distance_m, "exif_distance_m": r.exif_distance_m, "exif_age_s": r.exif_age_s,
        "flags": [f for f in (r.flags or "").split(",") if f],
    } for r in rows]


@router.post("/admin/surf-observations/{observation_id}/audit")
async def resolve_audit(observation_id: str, body: AuditVerdict, db: AsyncSession = Depends(get_db),
                        admin: Profile = Depends(get_current_admin)):
    obs = (await db.execute(select(SurfObservation).where(SurfObservation.id == observation_id)
                            .with_for_update())).scalar_one_or_none()
    if obs is None:
        raise HTTPException(status_code=404, detail="Observation not found")
    if obs.xp_status != "held_audit":
        raise HTTPException(status_code=409, detail="Observation is not awaiting audit")
    if obs.user_id == admin.id:
        raise HTTPException(status_code=403, detail="Cannot audit your own observation")
    await observation_rewards.resolve_audit(db, obs, body.verdict, admin.id)
    await db.commit()
    return {"id": obs.id, "xp_status": obs.xp_status}
