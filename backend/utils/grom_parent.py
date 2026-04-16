"""
Shared helper for Grom Parent privilege checks.

A user has Grom Parent privileges if:
  - Their Auth Role is RoleEnum.GROM_PARENT (dedicated account, original behavior), OR
  - Their is_grom_parent flag is True (surfer who opted in via Settings)

Usage:
    from utils.grom_parent import is_grom_parent_eligible

    if not is_grom_parent_eligible(parent):
        raise HTTPException(403, "Only Grom Parents can do this")
"""

from models import RoleEnum


def is_grom_parent_eligible(user) -> bool:
    """Returns True if user has Grom Parent privileges by role or flag."""
    return user.role == RoleEnum.GROM_PARENT or bool(user.is_grom_parent)
