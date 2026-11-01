"""Read-only count of how exposed existing child accounts are (guardian program, PR 1).

Counts Grom accounts by age band and by guardian state. It returns NUMBERS ONLY: no ids, names, emails or
birthdates leave this module, and any cell under ``SMALL_CELL`` is reported as ``"<5"`` so a count of one or two
cannot single a child out. The owner uses it to see the real exposure before deciding what to do with legacy links.

Guardian states (per child):
  no_guardian       parent_id is empty
  pending_claim     parent_id names someone but nothing confirmed it. Carries NO authority since this change.
  confirmed_legacy  confirmed (approved) but there is no row in grom_guardians: the link predates two-sided proof, so
                    nothing shows the child took part. These are the links an attacker could have created.
  confirmed_l1      confirmed, with a verified grom_guardians row, guardian not ID-verified
  confirmed_l2      confirmed with a verified row and the guardian is age-verified (L2)
"""
from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Dict, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models import GromGuardian, Profile, RoleEnum
from services.guardian_levels import AGE_BANDS, age_band

SMALL_CELL = 5
STATES = ("no_guardian", "pending_claim", "confirmed_legacy", "confirmed_l1", "confirmed_l2")


def _mask(n: int):
    return "<5" if 0 < n < SMALL_CELL else n


async def compute_exposure(db: AsyncSession, today: Optional[date] = None) -> dict:
    groms = (await db.execute(
        select(Profile.id, Profile.birthdate, Profile.parent_id, Profile.parent_link_approved)
        .where(Profile.role == RoleEnum.GROM))).all()
    guardian_ids = {g.parent_id for g in groms if g.parent_id}
    guardians: Dict[str, tuple] = {}
    if guardian_ids:
        for row in (await db.execute(select(Profile.id, Profile.role, Profile.parent_age_verified, Profile.is_grom_parent)
                                     .where(Profile.id.in_(guardian_ids)))).all():
            guardians[row.id] = (row.role, bool(row.parent_age_verified), bool(row.is_grom_parent))
    proven = {(r.grom_id, r.guardian_id) for r in (await db.execute(
        select(GromGuardian.grom_id, GromGuardian.guardian_id).where(
            GromGuardian.verified_at.is_not(None), GromGuardian.revoked_at.is_(None)))).all()}

    table = {band: {state: 0 for state in STATES} for band in AGE_BANDS}
    confirmed_guardian_not_parent_role = 0
    for g in groms:
        band = age_band(g.birthdate, today)
        if not g.parent_id or g.parent_id not in guardians:
            state = "no_guardian" if not g.parent_id else "pending_claim"
        elif g.parent_link_approved is not True:
            state = "pending_claim"
        else:
            role, verified, _flag = guardians[g.parent_id]
            if (g.id, g.parent_id) not in proven:
                state = "confirmed_legacy"
            else:
                state = "confirmed_l2" if verified else "confirmed_l1"
            if role != RoleEnum.GROM_PARENT:
                confirmed_guardian_not_parent_role += 1
        table[band][state] += 1

    # Adults carrying the old self-set flag with no confirmed child behind it
    linked_guardians = {g.parent_id for g in groms if g.parent_id and g.parent_link_approved is True}
    flagged = (await db.execute(select(Profile.id).where(
        Profile.is_grom_parent.is_(True), Profile.role != RoleEnum.GROM_PARENT, Profile.role != RoleEnum.GROM))).all()
    flag_without_link = sum(1 for row in flagged if row.id not in linked_guardians)

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "small_cell_rule": f"counts of 1-{SMALL_CELL - 1} are shown as '<{SMALL_CELL}'",
        "total_groms": _mask(len(groms)),
        "by_age_band": {band: {s: _mask(n) for s, n in cells.items()} for band, cells in table.items()},
        "signals": {
            "confirmed_links_whose_guardian_is_not_a_grom_parent_role": _mask(confirmed_guardian_not_parent_role),
            "adults_with_self_set_parent_flag_and_no_confirmed_child": _mask(flag_without_link),
        },
        "legend": {
            "pending_claim": "a parent_id with no confirmation; carries no authority",
            "confirmed_legacy": "approved before two-sided proof existed; the child's part cannot be shown",
        },
    }
