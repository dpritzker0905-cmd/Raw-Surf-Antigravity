"""What each guardian level unlocks, by age band: the ONE table every minor-safety gate reads (guardian program, PR 2).

Policy (owner-approved 2026-10-24, docs/runbooks/GUARDIAN-LEVELS.md):

  feature          under 13        13-15           16-17
  browse           L0              L0              L0
  comment          L1              L1              L1
  message          L1              L1              L1
  public_profile   L2              L2              L1  (guardian notified)
  photo            L2              L2              L1  (guardian notified)
  money            L2              L2              L1  (always also via the purchase-request approval)

"photo" is any upload, post or story that shows the child; a photo of a child is personal information under COPPA.
"money" never replaces the purchase-request approval: the level is a floor, the guardian's approval still decides.
A child with no birthdate on file is treated as under 13 (`effective_band`). A Grom who is 18 or older has no gates.

The write gates (comment / message / post / stream / react) at L0 live in `services/parental_controls.refusal_for`,
beside the guardian's own switches, so one helper answers "may this child do this?" for every route. This module adds
the gates that need the guardian's verification (L2) and the guardian notice for 16-17.
"""
from __future__ import annotations

import json
import os
from typing import Dict, Optional

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from models import Notification, Profile, RoleEnum
from services.guardian_levels import (
    ADULT, L0, L1, L2, TEEN_13_15, TEEN_16_17, UNDER_13, GuardianStanding, guardian_level,
)

BROWSE, COMMENT, MESSAGE, PUBLIC_PROFILE, PHOTO, MONEY = (
    "browse", "comment", "message", "public_profile", "photo", "money")
FEATURES = (BROWSE, COMMENT, MESSAGE, PUBLIC_PROFILE, PHOTO, MONEY)

_STRICT = {BROWSE: L0, COMMENT: L1, MESSAGE: L1, PUBLIC_PROFILE: L2, PHOTO: L2, MONEY: L2}
_OLDER_TEEN = {BROWSE: L0, COMMENT: L1, MESSAGE: L1, PUBLIC_PROFILE: L1, PHOTO: L1, MONEY: L1}
MIN_LEVEL: Dict[str, Dict[str, str]] = {
    UNDER_13: _STRICT,
    TEEN_13_15: _STRICT,
    TEEN_16_17: _OLDER_TEEN,
}
_RANK = {L0: 0, L1: 1, L2: 2}

# Feature flag for the parent-first creation of under-13 profiles (program P3). Off until that flow ships: the
# signup path refuses under-13s either way; when P3 turns this on it points the child at the parent flow.
PARENT_FIRST_FLAG = "PARENT_FIRST_CHILD_CREATION"
UNDER_13_SIGNUP_DETAIL = (
    "Kids under 13 can't sign up on their own. Ask a parent or guardian to create your profile for you."
)
BIRTHDATE_REQUIRED_DETAIL = "A birthdate is required to create a Grom account."

NEEDS_L1_DETAIL = ("This is locked until a parent or guardian links your account. "
                   "Open Ask my parent to get a code for them.")
NEEDS_L2_DETAIL = "This needs a verified parent or guardian. Ask your parent to verify their age in Grom HQ."


def parent_first_creation_enabled() -> bool:
    """P3's switch. Nothing reads it yet; the creation routes arrive with P3 and read it here."""
    return os.getenv(PARENT_FIRST_FLAG, "").strip().lower() in {"1", "true", "yes", "on"}


def required_level(band: str, feature: str) -> Optional[str]:
    """Minimum level for ``feature`` in ``band`` (None for an adult: no gate). ``unknown`` gates as under 13."""
    if band == ADULT:
        return None
    return MIN_LEVEL.get(band, MIN_LEVEL[UNDER_13])[feature]


def is_allowed(standing: GuardianStanding, feature: str) -> bool:
    if standing.level is None:           # not a Grom
        return True
    need = required_level(standing.gate_band, feature)
    return need is None or _RANK[standing.level] >= _RANK[need]


def unlocked(standing: GuardianStanding) -> Dict[str, dict]:
    """Per-feature answer for a screen: allowed now, and the level that unlocks it."""
    return {feature: {"allowed": is_allowed(standing, feature), "needs": required_level(standing.gate_band, feature)}
            for feature in FEATURES}


def refusal_detail(standing: GuardianStanding, feature: str) -> Optional[str]:
    if is_allowed(standing, feature):
        return None
    if required_level(standing.gate_band, feature) == L2 and standing.level == L1:
        return NEEDS_L2_DETAIL
    return NEEDS_L1_DETAIL


async def assert_level_allows(db: AsyncSession, profile: Optional[Profile], feature: str) -> Optional[GuardianStanding]:
    """403 when ``profile`` is a Grom whose level is below the floor for ``feature``. Any other account passes.
    Returns the child's standing (None for a non-Grom) so a caller can add a guardian notice without a second read."""
    if profile is None or profile.role != RoleEnum.GROM:
        return None
    standing = await guardian_level(db, profile)
    detail = refusal_detail(standing, feature)
    if detail:
        raise HTTPException(status_code=403, detail=detail)
    return standing


async def notify_guardian_of_teen_activity(db: AsyncSession, profile: Profile, standing: Optional[GuardianStanding],
                                           title: str, body: str) -> bool:
    """16-17 at L1+ get most features and the guardian is TOLD rather than asked. In-app notice now; an email channel
    can register on the same seam as invites later. True when a notice was queued (committed with the caller)."""
    if standing is None or standing.band != TEEN_16_17 or not standing.guardian_id:
        return False
    db.add(Notification(user_id=standing.guardian_id, type="grom_activity_notice", title=title, body=body,
                        data=json.dumps({"grom_id": profile.id, "alert_type": "grom_activity_notice"})))
    return True


def under_13_signup_refusal(age: Optional[int]) -> Optional[str]:
    """The signup answer for a child under 13, or None. The caller raises before any query or write, so nothing about
    the child is stored."""
    if age is not None and age < 13:
        return UNDER_13_SIGNUP_DETAIL
    return None
