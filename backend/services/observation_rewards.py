"""XP for blind surf observations (T1 crowd truth, P2): reward QUALITY, never agreement.

Rules, all decided here on the server:
- Base XP only for an observation that passes the quality gate (`quality_ok`): it has a parent report, its photo is
  not a duplicate, the device and photo checks did not fire, there is some location evidence, and it carries a
  device id. Nothing in the gate, the caps, the audit or the bonuses reads the HEIGHT, its scale or the forecast,
  so a surfer cannot earn more by reporting bigger, smaller, or closer to our number (`test_xp_is_value_blind`).
- Caps on XP-earning observations: per account per UTC day, per account per spot-day, per device per day (across
  accounts) and per spot-day (across everyone). A capped observation is still stored as truth; it just pays nothing.
- Random audit: a sample of gated observations is held (`xp_status='held_audit'`) until an admin passes or fails
  it (routes/admin/surf_observation_audits.py). Held observations neither pay nor corroborate until passed.
- Bonuses pay only after INDEPENDENT corroboration: another account, on another device, filed a gated observation
  at the same spot within CORROBORATION_WINDOW. Corroboration is existence, not agreement: the two heights are never
  compared. Then each side gets the corroboration bonus once, plus first-of-day / quiet-spot bonuses it was eligible
  for when it arrived.

Amounts live in services/xp.py XP_RULES (the one place XP is granted), each once per observation id.
"""
from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import func, select

from models import SurfObservation
from services.xp import grant_xp

REFERENCE_TYPE = "surf_observation"
BLOCKING_FLAGS = frozenset({"no_parent", "duplicate_media", "gps_far", "exif_far", "exif_stale",
                            "device_clock_skew", "media_unverified", "no_device"})
ACCOUNT_DAY_CAP = 3
ACCOUNT_SPOT_DAY_CAP = 1
DEVICE_DAY_CAP = 3
SPOT_DAY_CAP = 30
AUDIT_ONE_IN = 10
CORROBORATION_WINDOW = timedelta(minutes=90)
QUIET_SPOT_WINDOW = timedelta(days=7)
PAYING = ("granted",)             # counts toward caps and corroborates
COUNTED = ("granted", "held_audit")  # counts toward caps


def device_hash(device_id: Optional[str]) -> Optional[str]:
    """The client's random install id, stored only as a hash (it is a claim; it raises the cost of farming)."""
    return hashlib.sha256(device_id.encode()).hexdigest() if device_id else None


def audit_draw() -> bool:
    """True for about 1 in AUDIT_ONE_IN. A module function so tests can pin it."""
    return secrets.randbelow(AUDIT_ONE_IN) == 0


def _day(ts: datetime) -> datetime:
    return ts.astimezone(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)


def passes_gate(obs: SurfObservation) -> bool:
    flags = set(filter(None, (obs.flags or "").split(",")))
    has_location = obs.gps_check in ("ok", "near") or obs.exif_check == "ok"
    return not (flags & BLOCKING_FLAGS) and has_location and bool(obs.device_hash)


async def _count(db, *conditions) -> int:
    return (await db.execute(select(func.count()).select_from(SurfObservation).where(
        SurfObservation.xp_status.in_(COUNTED), *conditions))).scalar_one()


async def _capped(db, obs: SurfObservation) -> bool:
    day = _day(obs.received_at)
    same_day = (SurfObservation.received_at >= day, SurfObservation.received_at < day + timedelta(days=1),
                SurfObservation.id != obs.id)
    return (await _count(db, SurfObservation.user_id == obs.user_id, *same_day) >= ACCOUNT_DAY_CAP
            or await _count(db, SurfObservation.user_id == obs.user_id, SurfObservation.spot_id == obs.spot_id,
                            *same_day) >= ACCOUNT_SPOT_DAY_CAP
            or await _count(db, SurfObservation.device_hash == obs.device_hash, *same_day) >= DEVICE_DAY_CAP
            or await _count(db, SurfObservation.spot_id == obs.spot_id, *same_day) >= SPOT_DAY_CAP)


async def _bonus_eligibility(db, obs: SurfObservation) -> str:
    """Decided when the observation arrives (from gated rows already there), paid only on corroboration."""
    eligible = []
    earlier_today = (await db.execute(select(SurfObservation.id).where(
        SurfObservation.spot_id == obs.spot_id, SurfObservation.quality_ok.is_(True), SurfObservation.id != obs.id,
        SurfObservation.received_at >= _day(obs.received_at), SurfObservation.received_at < obs.received_at)
        .limit(1))).first()
    if earlier_today is None:
        eligible.append("first_of_day")
    recent = (await db.execute(select(SurfObservation.id).where(
        SurfObservation.spot_id == obs.spot_id, SurfObservation.quality_ok.is_(True), SurfObservation.id != obs.id,
        SurfObservation.received_at >= obs.received_at - QUIET_SPOT_WINDOW,
        SurfObservation.received_at < obs.received_at).limit(1))).first()
    if recent is None:
        eligible.append("quiet_spot")
    return ",".join(eligible)


async def _pay_bonuses(db, obs: SurfObservation) -> None:
    await grant_xp(db, obs.user_id, "surf_observation_corroborated", reference_type=REFERENCE_TYPE,
                   reference_id=obs.id)
    for bonus in filter(None, (obs.bonus_eligible or "").split(",")):
        await grant_xp(db, obs.user_id, f"surf_observation_{bonus}", reference_type=REFERENCE_TYPE,
                       reference_id=obs.id)


async def corroborate(db, obs: SurfObservation) -> None:
    """Pay corroboration (and pending bonuses) to `obs` and to every independent paying observation near it."""
    others = (await db.execute(select(SurfObservation).where(
        SurfObservation.spot_id == obs.spot_id, SurfObservation.id != obs.id,
        SurfObservation.user_id != obs.user_id, SurfObservation.device_hash != obs.device_hash,
        SurfObservation.xp_status.in_(PAYING),
        SurfObservation.received_at >= obs.received_at - CORROBORATION_WINDOW,
        SurfObservation.received_at <= obs.received_at + CORROBORATION_WINDOW))).scalars().all()
    if not others:
        return
    obs.corroborated = True
    await _pay_bonuses(db, obs)
    for other in others:
        if not other.corroborated:
            other.corroborated = True
            await _pay_bonuses(db, other)


async def pay(db, obs: SurfObservation) -> None:
    """Base XP plus any corroboration, for an observation whose xp_status is (now) 'granted'."""
    await grant_xp(db, obs.user_id, "surf_observation", reference_type=REFERENCE_TYPE, reference_id=obs.id)
    await corroborate(db, obs)


async def assess(db, obs: SurfObservation) -> None:
    """Set quality_ok / xp_status / audit / bonus eligibility on a freshly added observation, and pay if due.
    The caller commits. Must be called after the row is flushed (it needs obs.id)."""
    obs.quality_ok = passes_gate(obs)
    if not obs.quality_ok:
        obs.xp_status = "not_eligible"
        return
    if await _capped(db, obs):
        obs.xp_status = "capped"
        return
    obs.bonus_eligible = await _bonus_eligibility(db, obs)
    if audit_draw():
        obs.audit_selected = True
        obs.xp_status = "held_audit"
        return
    obs.xp_status = "granted"
    await pay(db, obs)


async def resolve_audit(db, obs: SurfObservation, verdict: str, admin_id: str) -> None:
    obs.audit_verdict = verdict
    obs.audited_by = admin_id
    obs.audited_at = datetime.now(timezone.utc)
    if verdict == "pass":
        obs.xp_status = "granted"
        await pay(db, obs)
    else:
        obs.xp_status = "audit_failed"
