"""
Shared helper for Grom Parent privilege checks.

A user has Grom Parent privileges if:
  - Their Auth Role is RoleEnum.GROM_PARENT (dedicated account, original behavior), OR
  - Their is_grom_parent flag is True. The flag is SERVER-OWNED (audit F-01): it is a cache of "has at least one
    CONFIRMED guardian link", written only by services/guardian_links.py. No profile route can set it.

This is a feature-surface check ("show parent tools"). It is never authority over a child: access to a child's
data requires services.guardian_levels.is_confirmed_guardian(child, user_id).

Usage:
    from utils.grom_parent import is_grom_parent_eligible

    if not is_grom_parent_eligible(parent):
        raise HTTPException(403, "Only Grom Parents can do this")
"""

from models import RoleEnum


def is_grom_parent_eligible(user) -> bool:
    """Returns True if user has Grom Parent privileges by role or flag."""
    return user.role == RoleEnum.GROM_PARENT or bool(user.is_grom_parent)
