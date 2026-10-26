"""Guardian level and age band of a child account: the single source every minor-safety gate reads.

Policy (owner-approved 2026-10-24, docs/runbooks/GUARDIAN-LEVELS.md):
  L0  no confirmed guardian
  L1  linked: a guardian account AND a two-sided confirmation (child code, or invite the child confirmed)
  L2  verified: an L1 guardian who is also a proven adult (``parent_age_verified``: ID check or card transaction)

A link is CONFIRMED when ``profiles.parent_id`` names the guardian AND ``parent_link_approved`` is true. A
``parent_id`` on its own (a claim: a name typed at signup, or the old one-sided ``link-grom``) carries NO authority.

Age bands: ``under_13`` | ``13_15`` | ``16_17`` | ``adult`` | ``unknown`` (no birthdate on file). A gate that must
decide treats ``unknown`` as ``under_13`` (``effective_band``): a child with no stated birthdate gets the most
restrictive treatment, never the least.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models import Profile, RoleEnum

L0, L1, L2 = "L0", "L1", "L2"
LEVELS = (L0, L1, L2)
_RANK = {L0: 0, L1: 1, L2: 2}

UNDER_13, TEEN_13_15, TEEN_16_17, ADULT, UNKNOWN = "under_13", "13_15", "16_17", "adult", "unknown"
AGE_BANDS = (UNDER_13, TEEN_13_15, TEEN_16_17, ADULT, UNKNOWN)


def age_on(birthdate, today: Optional[date] = None) -> Optional[int]:
    """Whole years on ``today`` (None when there is no usable birthdate)."""
    if birthdate is None:
        return None
    if isinstance(birthdate, datetime):
        birthdate = birthdate.date()
    if not isinstance(birthdate, date):
        return None
    today = today or date.today()
    return today.year - birthdate.year - ((today.month, today.day) < (birthdate.month, birthdate.day))


def age_band(birthdate, today: Optional[date] = None) -> str:
    age = age_on(birthdate, today)
    if age is None or age < 0:
        return UNKNOWN
    if age <= 12:
        return UNDER_13
    if age <= 15:
        return TEEN_13_15
    if age <= 17:
        return TEEN_16_17
    return ADULT


def effective_band(band: str) -> str:
    """The band a gate must use: no birthdate on file means the most restrictive minor band."""
    return UNDER_13 if band == UNKNOWN else band


def has_confirmed_link(child: Profile) -> bool:
    """True when the child's guardian link is two-sided confirmed (a bare ``parent_id`` claim is not)."""
    return bool(child.parent_id) and child.parent_link_approved is True


def is_confirmed_guardian(child: Optional[Profile], user_id: Optional[str]) -> bool:
    """True when ``user_id`` is the child's CONFIRMED guardian. The one test every guardian route uses."""
    return bool(child is not None and user_id and child.role == RoleEnum.GROM
                and child.parent_id == user_id and child.parent_link_approved is True)


@dataclass(frozen=True)
class GuardianStanding:
    level: Optional[str]          # 'L0' | 'L1' | 'L2' for a Grom; None for any other role
    band: str                     # one of AGE_BANDS
    age: Optional[int]
    guardian_id: Optional[str]    # the confirmed guardian, else None

    @property
    def gate_band(self) -> str:
        return effective_band(self.band)

    def at_least(self, level: str) -> bool:
        """True when the child's level is ``level`` or higher. Never true for a non-Grom (no level)."""
        return self.level is not None and _RANK[self.level] >= _RANK[level]


async def guardian_level(db: AsyncSession, child: Profile, today: Optional[date] = None) -> GuardianStanding:
    """Level and age band of ``child`` (at most one extra primary-key select, only when a link is confirmed)."""
    age = age_on(child.birthdate, today)
    band = age_band(child.birthdate, today)
    if child.role != RoleEnum.GROM:
        return GuardianStanding(level=None, band=band, age=age, guardian_id=None)
    if not has_confirmed_link(child):
        return GuardianStanding(level=L0, band=band, age=age, guardian_id=None)
    guardian = (await db.execute(select(Profile).where(Profile.id == child.parent_id))).scalar_one_or_none()
    if guardian is None or guardian.role == RoleEnum.GROM:
        # a dangling or minor "guardian" is not a guardian
        return GuardianStanding(level=L0, band=band, age=age, guardian_id=None)
    level = L2 if guardian.parent_age_verified else L1
    return GuardianStanding(level=level, band=band, age=age, guardian_id=guardian.id)
