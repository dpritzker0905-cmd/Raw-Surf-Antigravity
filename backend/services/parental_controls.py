"""Server-side enforcement of a Grom's parental controls (audit 2026-10-18 F-09).

A guardian toggles `can_comment`, `can_stream` and `view_only` in the Grom's `parental_controls` JSON, and the UI
says they are saved - but until this module no route read them (messaging and media posting were the only
controls with a server check). Every Grom write that one of these switches is meant to stop calls
`refusal_for` / `assert_grom_may` here.

Rules, decided once:
  * Only accounts with role GROM are ever restricted. Every other role gets exactly the behaviour it had.
  * Guardian level L0 (no confirmed guardian) is browse-only: every write below is refused before the guardian's
    own switches are read (services/guardian_policy.py holds the level table).
  * `view_only` is a master switch: when it is true the Grom may not WRITE anything (comment, react, post, go
    live, message).
  * Each action also has its own switch. A missing switch falls back to the same default the guardian screen
    shows (`can_comment` on; `can_stream` off), so what the parent sees is what the server enforces.
  * `can_post` keeps its existing job (the guardian-approval pipeline in `grom_media_policy`); here it is not
    consulted - `view_only` alone stops post creation.

Cost: callers that already loaded the Profile pass it in (zero extra queries); the rest do one primary-key select.
"""
from __future__ import annotations

from typing import Optional

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models import Profile, RoleEnum
from services.guardian_levels import ADULT, age_band, has_confirmed_link
from services.guardian_policy import NEEDS_L1_DETAIL

# action -> (control key that must not be False, default when the key was never stored)
ACTION_CONTROLS = {
    "comment": ("can_comment", True),
    "stream": ("can_stream", False),
    "post": (None, True),
    "react": (None, True),
    "message": (None, True),
}

VIEW_ONLY_DETAIL = "This account is in view-only mode set by a parent or guardian."
ACTION_DETAIL = {
    "comment": "Commenting is turned off for this account by a parent or guardian.",
    "stream": "Going live is turned off for this account by a parent or guardian.",
}


def refusal_for(profile: Optional[Profile], action: str) -> Optional[str]:
    """Return the 403 detail when ``profile`` (a Grom) may not perform ``action``; ``None`` when it may."""
    if profile is None or profile.role != RoleEnum.GROM:
        return None
    # Level L0 (guardian program): a child with no confirmed guardian can browse and nothing else, whatever their
    # age band says. A Grom who is 18 or older has no guardian gate.
    if age_band(profile.birthdate) != ADULT and not has_confirmed_link(profile):
        return NEEDS_L1_DETAIL
    controls = profile.parental_controls or {}
    if controls.get("view_only"):
        return VIEW_ONLY_DETAIL
    key, default = ACTION_CONTROLS[action]
    if key is not None and not controls.get(key, default):
        return ACTION_DETAIL[action]
    return None


def assert_profile_may(profile: Optional[Profile], action: str) -> None:
    """Raise 403 when an already-loaded ``profile`` may not perform ``action`` (no query)."""
    detail = refusal_for(profile, action)
    if detail:
        raise HTTPException(status_code=403, detail=detail)


async def assert_grom_may(db: AsyncSession, user_id: Optional[str], action: str) -> None:
    """Raise 403 when ``user_id`` is a Grom whose controls forbid ``action`` (one primary-key select)."""
    if not user_id:
        return
    profile = (await db.execute(select(Profile).where(Profile.id == user_id))).scalar_one_or_none()
    assert_profile_may(profile, action)
