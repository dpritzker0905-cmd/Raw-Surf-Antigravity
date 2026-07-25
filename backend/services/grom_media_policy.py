"""Server-side Grom media policy primitives.

A Grom can always narrow access. A verified guardian sets the sitewide ceiling,
may add a stricter per-item ceiling, and is the only actor allowed to approve a
broader audience within those ceilings.
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
    'sitewide_media_max_visibility': 'guardian_only',
    'require_media_approval': True,
}


def normalize_controls(grom: Profile) -> dict:
    """Normalize legacy controls and expose one canonical sitewide ceiling."""
    controls = dict(DEFAULT_GROM_MEDIA_CONTROLS)
    stored = grom.parental_controls or {}
    controls.update(stored)
    ceiling = stored.get('sitewide_media_max_visibility', stored.get('media_max_visibility'))
    if ceiling not in AUDIENCE_ORDER:
        ceiling = DEFAULT_GROM_MEDIA_CONTROLS['sitewide_media_max_visibility']
    controls['sitewide_media_max_visibility'] = ceiling
    # Compatibility for older clients; server authorization uses the canonical key.
    controls['media_max_visibility'] = ceiling
    controls['can_post'] = bool(controls.get('can_post'))
    controls['require_media_approval'] = bool(controls.get('require_media_approval', True))
    return controls


def audience_is_within_cap(audience: str, cap: str) -> bool:
    return audience in AUDIENCE_ORDER and cap in AUDIENCE_ORDER and AUDIENCE_ORDER[audience] <= AUDIENCE_ORDER[cap]


def effective_visibility_cap(controls: dict, per_item_cap: str | None = None) -> str:
    """Return the stricter of the guardian's sitewide and per-item ceilings."""
    sitewide = controls['sitewide_media_max_visibility']
    if per_item_cap not in AUDIENCE_ORDER:
        return sitewide
    return per_item_cap if AUDIENCE_ORDER[per_item_cap] < AUDIENCE_ORDER[sitewide] else sitewide


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


def approval_status_for_grom_media(*, requested_visibility: str, controls: dict, per_item_cap: str | None = None) -> tuple[str, str]:
    """Return safe stored audience/status without permitting a cap bypass."""
    if requested_visibility == 'guardian_only':
        return 'guardian_only', 'self_private'
    cap = effective_visibility_cap(controls, per_item_cap)
    if not controls['can_post'] or not audience_is_within_cap(requested_visibility, cap):
        return 'guardian_only', 'blocked_by_parent_policy'
    if controls['require_media_approval']:
        return 'guardian_only', 'pending_parent_approval'
    return requested_visibility, 'approved_by_parent_policy'


# Compatibility alias for the first privacy release.
def approval_status_for_grom_post(*, requested_visibility: str, controls: dict) -> tuple[str, str]:
    return approval_status_for_grom_media(requested_visibility=requested_visibility, controls=controls)


def apply_guardian_visibility_cap(media, *, guardian_id: str, controls: dict, cap: str) -> str:
    """Persist a per-item ceiling and immediately reduce over-broad live media."""
    if not audience_is_within_cap(cap, controls['sitewide_media_max_visibility']):
        raise ValueError('Per-item cap cannot exceed the sitewide guardian ceiling')
    media.guardian_visibility_cap = cap
    media.guardian_override_by = guardian_id
    media.guardian_override_at = datetime.now(timezone.utc)
    effective_cap = effective_visibility_cap(controls, cap)
    if not audience_is_within_cap(media.visibility, effective_cap):
        media.visibility = effective_cap
        media.guardian_approval_status = 'restricted_by_guardian'
        media.visibility_changed_at = datetime.now(timezone.utc)
    return effective_cap


def enforce_sitewide_visibility_cap(media, *, controls: dict) -> bool:
    """Reduce media when a guardian tightens the global ceiling; never broaden."""
    effective_cap = effective_visibility_cap(controls, getattr(media, 'guardian_visibility_cap', None))
    if audience_is_within_cap(media.visibility, effective_cap):
        return False
    media.visibility = effective_cap
    media.guardian_approval_status = 'restricted_by_guardian'
    media.visibility_changed_at = datetime.now(timezone.utc)
    return True


def mark_guardian_approval(media, *, guardian_id: str, visibility: str) -> None:
    media.visibility = visibility
    media.guardian_approval_status = 'approved'
    media.guardian_approved_by = guardian_id
    media.guardian_approved_at = datetime.now(timezone.utc)
    media.visibility_changed_at = datetime.now(timezone.utc)
