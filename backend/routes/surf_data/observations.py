"""POST /api/surf-observations: one blind surf-height observation (T1 crowd truth, P1).

Called by the three report screens right after their own submit succeeds (check-in, photographer go-live condition
report, spot surf report). The observer gives only what they saw: a number (or a legacy range), its unit, the scale
they mean, and typical vs sets. Everything that decides whether the row can be trusted is the SERVER's:

- `source` is always 'observed' and cannot be sent (unknown fields are refused, so a client cannot even try);
- `surface` and `forecast_shown_before` come from the server's audit of the named entry screen (ENTRY_SCREENS);
- the parent row must belong to the caller (strict JWT identity), be fresh, and carry at most one observation;
- the region's default scale, the conversion to face metres, GPS distance to the spot, the photo's EXIF position and
  age (read by the upload route from the bytes, never from the client), and duplicate photos are all computed here.

Rows are stored in the private `surf_observations` table. Nothing is served to other users and no XP is paid here
(P2 adds quality-gated XP).
"""
from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone
import re
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from core.security import get_current_user_id
from database import get_db
from models import CheckIn, ConditionReport, ObservationMedia, Profile, RoleEnum, SurfObservation, SurfReport, SurfSpot
from services import observation_rewards, surf_truth_anchors, surf_truth_consent
from services.surf_observation_scale import SCALE_VERSION, ObservationError, normalise, region_default_scale

router = APIRouter()

# Entry screen -> (surface, was a forecast height shown ON THIS SCREEN before the height was entered).
# Audited 2026-11-16 against the code on dev: CheckInModal and ConditionsModal show no forecast; SpotConditions shows
# forecast rows above its "report" button, so its reports are NOT blind and are recorded as such. This says nothing
# about what the user saw elsewhere in the app earlier; `forecast_shown_before=false` means "not on the entry screen".
ENTRY_SCREENS = {
    "checkin_modal": ("checkin", False),
    "golive_conditions_modal": ("condition_report", False),
    "spot_report_modal": ("surf_report", True),
}

REF_MAX_AGE = timedelta(hours=6)          # an observation is of NOW; a stale parent is refused
DAILY_CAP = 20                            # per account per UTC day; P2 adds device and spot-day caps for XP
GPS_OK_M, GPS_NEAR_M = 500.0, 10_000.0    # 500 m matches the passport check-in radius
EXIF_OK_M = 1_000.0                       # a photo of the break is often taken from a car park or headland
EXIF_MAX_AGE = timedelta(hours=3)
EXIF_MAX_FUTURE = timedelta(minutes=10)
FLOW = "blind_v1"
_BUILD_RE = re.compile(r"[A-Za-z0-9._-]{1,40}")
# The same set POST /condition-reports admits as photographers: a grom parent shoots their grom's sessions and can
# go live, so their reports come through the photographer flow and are grouped with it.
_PHOTOGRAPHER_ROLES = {RoleEnum.GROM_PARENT, RoleEnum.HOBBYIST, RoleEnum.PHOTOGRAPHER, RoleEnum.APPROVED_PRO}


def observer_role(anchor: Optional[str], role) -> str:
    """'anchor' (active anchor: sets the scale), 'anchor_probation', else photographer / surfer from the profile role.
    Anchors live in the surf_truth_anchors table (services/surf_truth_anchors), managed by admins with a logged
    reason; this replaced the SURF_TRUTH_ANCHOR_IDS environment variable."""
    return anchor or ("photographer" if role in _PHOTOGRAPHER_ROLES else "surfer")


class ObservationIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    entry_screen: Literal["checkin_modal", "golive_conditions_modal", "spot_report_modal"]
    ref_id: Optional[str] = Field(None, max_length=36)
    spot_id: Optional[str] = Field(None, max_length=36)
    height_value: Optional[float] = None
    height_unit: Optional[Literal["ft", "m"]] = None
    height_bucket: Optional[str] = Field(None, max_length=16)
    height_scale: Literal["face", "hawaiian"]
    set_or_avg: Literal["typical", "sets"]
    latitude: Optional[float] = Field(None, ge=-90, le=90)
    longitude: Optional[float] = Field(None, ge=-180, le=180)
    observed_at_device: Optional[datetime] = None
    # Kept as a claim. A malformed stamp must never cost the observation (the client swallows errors), so it is
    # stored as null with a flag rather than refused (advisor note on #954).
    client_build: Optional[str] = Field(None, max_length=200)
    device_id: Optional[str] = Field(None, pattern=r"^[0-9a-fA-F-]{32,36}$")  # random install id (a claim)


def _distance_m(lat1, lon1, lat2, lon2) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 6_371_000.0 * 2 * math.asin(math.sqrt(a))


def _aware(ts: Optional[datetime]) -> Optional[datetime]:
    if ts is None:
        return None
    return ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc)


async def _resolve_ref(db: AsyncSession, surface: str, ref_id: Optional[str], user_id: str):
    """(spot_id, created_at, media_url) of the caller's own parent row; 404 if missing or not theirs."""
    if surface == "checkin":
        if not ref_id:
            return None
        row = (await db.execute(select(CheckIn).where(CheckIn.id == ref_id, CheckIn.user_id == user_id))
               ).scalar_one_or_none()
        media = None
    elif surface == "condition_report":
        row = (await db.execute(select(ConditionReport).where(
            ConditionReport.id == ref_id, ConditionReport.photographer_id == user_id))).scalar_one_or_none()
        media = row.media_url if row else None
    else:
        row = (await db.execute(select(SurfReport).where(SurfReport.id == ref_id, SurfReport.user_id == user_id))
               ).scalar_one_or_none()
        media = row.photo_url if row else None
    if row is None:
        raise HTTPException(status_code=404, detail="Report not found")
    return row.spot_id, _aware(row.created_at), media or None


@router.post("/surf-observations")
async def create_surf_observation(data: ObservationIn, db: AsyncSession = Depends(get_db),
                                  user_id: str = Depends(get_current_user_id)):
    now = datetime.now(timezone.utc)
    surface, shown = ENTRY_SCREENS[data.entry_screen]
    if surface != "checkin" and not data.ref_id:
        raise HTTPException(status_code=422, detail="ref_id is required for this screen")

    ref = await _resolve_ref(db, surface, data.ref_id, user_id)
    # A check-in observation may arrive without a parent row (today's check-in already existed). Then the spot is
    # the client's word, there is no freshness check and the per-report unique index cannot apply, so the row is
    # marked for the aggregator to drop or down-weight.
    no_parent = ref is None
    spot_id, ref_created, media_url = ref if ref else (data.spot_id, None, None)
    if ref and data.spot_id and data.spot_id != spot_id:
        raise HTTPException(status_code=422, detail="spot_id does not match the report")
    if ref_created is not None and now - ref_created > REF_MAX_AGE:
        raise HTTPException(status_code=409, detail="Report is too old to add an observation")
    if not spot_id:
        raise HTTPException(status_code=422, detail="A surf spot is required")
    spot = (await db.execute(select(SurfSpot).where(SurfSpot.id == spot_id))).scalar_one_or_none()
    if spot is None:
        raise HTTPException(status_code=404, detail="Surf spot not found")

    if data.ref_id:
        taken = (await db.execute(select(SurfObservation.id).where(
            SurfObservation.surface == surface, SurfObservation.ref_id == data.ref_id))).first()
        if taken:
            raise HTTPException(status_code=409, detail="This report already has an observation")
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    count_today = (await db.execute(select(func.count()).select_from(SurfObservation).where(
        SurfObservation.user_id == user_id, SurfObservation.received_at >= day_start))).scalar_one()
    if count_today >= DAILY_CAP:
        raise HTTPException(status_code=429, detail="Daily observation limit reached")

    try:
        face = normalise(scale=data.height_scale, unit=data.height_unit, value=data.height_value,
                         bucket=data.height_bucket)
    except ObservationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    flags = set()
    role = (await db.execute(select(Profile.role).where(Profile.id == user_id))).scalar_one_or_none()
    anchor = surf_truth_anchors.role_for(await surf_truth_anchors.anchor_status(db, user_id))
    device_time = _aware(data.observed_at_device)
    if device_time is not None and abs((device_time - now).total_seconds()) > 900:
        flags.add("device_clock_skew")
    scale_default = region_default_scale(spot.latitude, spot.longitude, spot.state_province, spot.country)
    overridden = data.height_scale != scale_default
    if face.input_kind == "bucket":
        flags.add("range_only")
    if no_parent:
        flags.add("no_parent")
    if not data.device_id:
        flags.add("no_device")
    client_build = data.client_build if data.client_build and _BUILD_RE.fullmatch(data.client_build) else None
    if data.client_build and client_build is None:
        flags.add("bad_client_build")

    # GPS: the device position the client reports, against the spot. Recorded and flagged, never trusted alone.
    gps_distance = None
    if data.latitude is None or data.longitude is None:
        gps_check = "missing"
        flags.add("gps_missing")
    else:
        gps_distance = round(_distance_m(data.latitude, data.longitude, spot.latitude, spot.longitude), 1)
        gps_check = "ok" if gps_distance <= GPS_OK_M else "near" if gps_distance <= GPS_NEAR_M else "far"
        if gps_check == "far":
            flags.add("gps_far")

    # Photo: the server's own record from upload time (hash + EXIF), looked up by the caller and the stored URL.
    sha = exif_distance = exif_age = duplicate_of = None
    if not media_url:
        exif_check = "none"
    else:
        rec = (await db.execute(select(ObservationMedia).where(
            ObservationMedia.user_id == user_id, ObservationMedia.media_url == media_url)
            .order_by(ObservationMedia.uploaded_at.desc()).limit(1))).scalar_one_or_none()
        if rec is None:
            exif_check = "no_record"
            flags.add("media_unverified")
        else:
            sha = rec.sha256
            taken_at = _aware(rec.exif_taken_at)
            if taken_at is not None:
                exif_age = round((now - taken_at).total_seconds(), 1)
                if now - taken_at > EXIF_MAX_AGE or taken_at - now > EXIF_MAX_FUTURE:
                    flags.add("exif_stale")
            if rec.exif_latitude is None or rec.exif_longitude is None:
                exif_check = "no_gps"
            else:
                exif_distance = round(_distance_m(rec.exif_latitude, rec.exif_longitude,
                                                  spot.latitude, spot.longitude), 1)
                exif_check = "ok" if exif_distance <= EXIF_OK_M else "far"
                if exif_check == "far":
                    flags.add("exif_far")
            dup = (await db.execute(select(SurfObservation.id).where(SurfObservation.media_sha256 == sha)
                                    .order_by(SurfObservation.received_at).limit(1))).first()
            if dup:
                duplicate_of = dup[0]
                flags.add("duplicate_media")
    if overridden and exif_check in ("none", "no_record"):
        flags.add("scale_override_no_photo")
    consent = await surf_truth_consent.current(db, user_id)   # P3: the choice in force at receipt, kept on the row

    obs = SurfObservation(
        user_id=user_id, observer_role=observer_role(anchor, role), flow=FLOW, spot_id=spot_id, surface=surface,
        entry_screen=data.entry_screen, ref_id=data.ref_id, client_build=client_build,
        height_value=data.height_value, height_unit=data.height_unit if data.height_value is not None else None,
        height_bucket=data.height_bucket, height_scale=data.height_scale, set_or_avg=data.set_or_avg,
        scale_default=scale_default, scale_overridden=overridden, normalization_version=SCALE_VERSION,
        face_m=face.face_m, face_m_low=face.face_m_low, face_m_high=face.face_m_high, input_kind=face.input_kind,
        source="observed", forecast_shown_before=shown, received_at=now, observed_at_device=device_time,
        latitude=data.latitude, longitude=data.longitude, gps_distance_m=gps_distance, gps_check=gps_check,
        media_url=media_url, media_sha256=sha, exif_distance_m=exif_distance, exif_age_s=exif_age,
        exif_check=exif_check, duplicate_of=duplicate_of, flags=",".join(sorted(flags)),
        device_hash=observation_rewards.device_hash(data.device_id), xp_status="none", corroborated=False,
        audit_selected=False, consent_training=consent["granted"], consent_version=consent["version"],
    )
    db.add(obs)
    try:
        await db.flush()
        # P2: quality-gated, capped, audited XP; bonuses only after independent corroboration. Never value-based.
        await observation_rewards.assess(db, obs)
        await db.commit()
    except IntegrityError as exc:  # a concurrent duplicate for the same report won the unique index
        await db.rollback()
        raise HTTPException(status_code=409, detail="This report already has an observation") from exc
    # The reply names the stored row and its scale only. Quality flags, the converted height and the provenance
    # verdicts stay server-side: returning them would tell anyone gaming the checks which one fired.
    return {"id": obs.id, "height_scale": obs.height_scale, "scale_default": scale_default}


class ConsentIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    granted: bool
    source: Literal["blind_height_input", "settings"] = "blind_height_input"


async def _consent_reply(db: AsyncSession, user_id: str) -> dict:
    words = await surf_truth_consent.wording(db)
    state = await surf_truth_consent.current(db, user_id, version=words["version"])
    return {**state, "current_version": words["version"], "title": words["title"], "text": words["text"],
            "final": words["final"], "privacy_url": words["privacy_url"]}


@router.get("/surf-observations/consent")
async def get_consent(db: AsyncSession = Depends(get_db), user_id: str = Depends(get_current_user_id)):
    """The caller's own forecast-improvement consent in force, with the current wording to show (opt-in: no choice
    = off; a grant under an older wording version is not in force and `needs_reconsent` is true)."""
    return await _consent_reply(db, user_id)


@router.put("/surf-observations/consent")
async def put_consent(data: ConsentIn, db: AsyncSession = Depends(get_db),
                      user_id: str = Depends(get_current_user_id)):
    """Record the caller's choice under the current wording (append-only history; the newest choice is in force).
    A grant under a wording that still has draft placeholders is refused with 409; a withdrawal always succeeds."""
    try:
        await surf_truth_consent.record(db, user_id, data.granted, data.source)
    except surf_truth_consent.WordingNotFinal as exc:
        raise HTTPException(status_code=409, detail="This option is not available yet.") from exc
    await db.commit()
    return await _consent_reply(db, user_id)


@router.get("/surf-observations/scale-default/{spot_id}")
async def get_scale_default(spot_id: str, db: AsyncSession = Depends(get_db)):
    """The server's default height scale for a spot, so a screen without the spot's coordinates preselects the same
    scale the server will compare the entry against. Public and read-only: it reveals nothing beyond the spot list."""
    spot = (await db.execute(select(SurfSpot).where(SurfSpot.id == spot_id))).scalar_one_or_none()
    if spot is None:
        raise HTTPException(status_code=404, detail="Surf spot not found")
    return {"spot_id": spot_id, "scale_default": region_default_scale(spot.latitude, spot.longitude,
                                                                      spot.state_province, spot.country),
            "scale_version": SCALE_VERSION}
