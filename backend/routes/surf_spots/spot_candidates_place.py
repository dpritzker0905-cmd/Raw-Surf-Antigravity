"""The placement helper's one write: a PERSON records where a candidate's pin should go.

Owner, 2026-11-18: "we should create a helper tool that helps us place them at least in the nearest known location
first, before we confirm them."

The helper suggests the nearest ocean shoreline point (worked out offline at load time). An admin either takes that
suggestion or drags the pin to the break, and this route stores the result on the CANDIDATE, in the holding table.
It does not create a spot, move a spot, or change what any map or forecast shows. The source's own coordinate is
never overwritten. Admin only.
"""
import math
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from deps.admin_auth import get_current_admin
from models import Profile, SurfSpotCandidate
from routes.surf_spots.spot_candidates_admin import candidate_row
from services.spot_duplicates import haversine_km

router = APIRouter(prefix="/admin/spots", tags=["Admin Spots"])

# A person may place a candidate that is still open. A decided one (rejected, duplicate, promoted) is left alone.
PLACEABLE = ("pending", "held")
# A typo in a hand-entered coordinate should not silently send a pin to another country.
MAX_MOVE_KM = 50.0


class CandidatePosition(BaseModel):
    latitude: float
    longitude: float
    method: Literal["shoreline_suggestion", "manual"]


@router.put("/candidates/{candidate_id}/position")
async def admin_place_spot_candidate(
    candidate_id: str,
    body: CandidatePosition,
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Store a person's position for one candidate. Returns the candidate."""
    if not (math.isfinite(body.latitude) and math.isfinite(body.longitude)
            and -90 <= body.latitude <= 90 and -180 <= body.longitude <= 180):
        raise HTTPException(status_code=422, detail="latitude must be -90..90 and longitude -180..180")

    candidate = (await db.execute(
        select(SurfSpotCandidate).where(SurfSpotCandidate.id == candidate_id))).scalar_one_or_none()
    if candidate is None:
        raise HTTPException(status_code=404, detail="No such candidate")
    if candidate.status not in PLACEABLE:
        raise HTTPException(status_code=409, detail=f"This candidate is already {candidate.status}; its position is closed")

    if body.method == "shoreline_suggestion":
        if candidate.suggested_latitude is None:
            raise HTTPException(status_code=409, detail="This candidate has no shoreline suggestion to take")
        # Taking the suggestion stores the suggestion itself, whatever numbers the browser sent.
        latitude, longitude = candidate.suggested_latitude, candidate.suggested_longitude
    else:
        latitude, longitude = body.latitude, body.longitude
        moved = haversine_km(candidate.latitude, candidate.longitude, latitude, longitude)
        if moved > MAX_MOVE_KM:
            raise HTTPException(status_code=422, detail=(
                f"That is {moved:.0f} km from the source's position (limit {MAX_MOVE_KM:g} km). "
                "If the source is that wrong, reject the candidate instead."))

    candidate.proposed_latitude = latitude
    candidate.proposed_longitude = longitude
    candidate.proposed_method = body.method
    candidate.proposed_by = getattr(admin, "id", None)
    candidate.proposed_at = datetime.now(timezone.utc)
    await db.commit()
    return candidate_row(candidate)
