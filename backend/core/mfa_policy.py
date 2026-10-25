"""
backend/core/mfa_policy.py -- which accounts MUST have a second factor (enforcement), read from the environment.

MFA_REQUIRED_ROLES is a comma-separated list. EMPTY OR UNSET MEANS NOBODY IS REQUIRED: a deploy of this code changes
no login. It is read at call time (like the other backend flags), so an owner can turn enforcement on or off with an
environment change and a restart, no code change.

Accepted names (case-insensitive; spaces, underscores and hyphens are equivalent):
    all                     every account
    admin                   accounts flagged is_admin, or whose role is Admin
    <any RoleEnum value>    photographer, approved pro, hobbyist, surfer, grom parent, ...
Admins and photographers are the intended first roles to require.
"""
import os
from typing import Set

ENV_NAME = "MFA_REQUIRED_ROLES"


def _norm(value: str) -> str:
    return " ".join(value.lower().replace("_", " ").replace("-", " ").split())


def required_names() -> Set[str]:
    return {_norm(part) for part in os.environ.get(ENV_NAME, "").split(",") if part.strip()}


def profile_requires_mfa(profile) -> bool:
    names = required_names()
    if not names:
        return False
    if "all" in names:
        return True
    if "admin" in names and (getattr(profile, "is_admin", False) or _role_name(profile) == "admin"):
        return True
    return _role_name(profile) in names


def _role_name(profile) -> str:
    role = getattr(profile, "role", None)
    value = getattr(role, "value", role)
    return _norm(str(value)) if value else ""
