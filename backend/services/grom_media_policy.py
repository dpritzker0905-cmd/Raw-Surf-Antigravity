"""Server-side Grom media policy primitives.

Children may always reduce visibility. A verified guardian is the only actor
that may allow or approve a broader audience.
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models import GromGuardian, Profile
from utils.grom_parent import is_grom_parent_eligible


AUDIENCE_ORDER = {'guardian_only': 0, 'followers': 1, 'public': 2}
DEFAULT_GROM_MEDIA_CONTROLS = {
    'can_post': False,
    'media_max_visibility': 'guardian_only',
    'require_media_approval': True,
}


def normalize_controls(grom: Profile) -> dict:
    controls = dict(DEFAULT_GROM_MEDIA_CONTROLS)
    controls.update(grom.parental_controls or {})
    if controls.get('media_max_visibility') not in AUDIENCE_ORDER:
        controls['media_max_visibility'] = 'guardian_only'
    controls['can_post'] = bool(controls.get('can_post'))
    controls['require_media_approval'] = bool(controls.get('require_media_approval', True))
    return controls


def audience_is_within_cap(audience: str, cap: str) -> bool:
    return audience in AUDIENCE_ORDER and AUDIENCE_ORDER[audience] <= AUDIENCE_ORDER[cap]


async def is_verified_guardian(db: AsyncSession, grom: Profile, actor_id: str) -> bool:
    """Accept a non-revoked verified relationship or a verified legacy parent."""
    relation = await db.execute(
        select(GromGuardian).where(
            GromGuardian.grom_id == grom.id,
            GromGuardian.guardian_id == actor_id,
            GromGuardian.verified_at.is_not(None),
            GromGuardian.revoked_at.is_(None),
        )
    )
    if relation.scalar_one_or_none():
        return True

    if grom.parent_id != actor_id or not grom.parent_link_approved:
        return False
    guardian_result = await db.execute(select(Profile).where(Profile.id == actor_id))
    guardian = guardian_result.scalar_one_or_none()
    return bool(guardian and guardian.parent_age_verified and is_grom_parent_eligible(guardian))


def approval_status_for_grom_post(*, requested_visibility: str, controls: dict) -> tuple[str, str]:
    """Return stored audience/status for a new Grom post without broadening access."""
    if requested_visibility == 'guardian_only':
        return 'guardian_only', 'self_private'
    if not controls['can_post'] or not audience_is_within_cap(
        requested_visibility, controls['media_max_visibility']
    ):
        return 'guardian_only', 'blocked_by_parent_policy'
    if controls['require_media_approval']:
        return 'guardian_only', 'pending_parent_approval'
    return requested_visibility, 'approved_by_parent_policy'


def mark_guardian_approval(post, *, guardian_id: str, visibility: str) -> None:
    post.visibility = visibility
    post.guardian_approval_status = 'approved'
    post.guardian_approved_by = guardian_id
    post.guardian_approved_at = datetime.now(timezone.utc)
    post.visibility_changed_at = datetime.now(timezone.utc)
