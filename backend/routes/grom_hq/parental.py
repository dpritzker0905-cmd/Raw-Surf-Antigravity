"""Grom HQ parental — two-sided linking, unlinking, competition toggle, parental controls.

A guardian link exists only when the CHILD's account took part (services/guardian_links.py): a child-generated
code the adult redeems, or an adult's invite the child confirms. `link-grom` proposes; it never links. Every
guardian route below authorises with `is_confirmed_guardian` (a bare `parent_id` claim carries no authority).
"""
from fastapi import Depends, HTTPException, APIRouter, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified
from core.rate_limiter import rate_limit_check
from database import get_db
from models import Profile, RoleEnum
from core.security import get_current_user_id, get_user_id_from_jwt_or_query
from services import guardian_links
from services.guardian_levels import guardian_level, has_confirmed_link, is_confirmed_guardian
from services.guardian_policy import unlocked

from .schemas import ToggleCompetitionRequest
router = APIRouter()


async def _profile(db: AsyncSession, profile_id: str):
    return (await db.execute(select(Profile).where(Profile.id == profile_id))).scalar_one_or_none()


@router.post("/toggle-competition/{grom_id}")
async def toggle_grom_competition(
    grom_id: str,
    parent_id: str,
    data: ToggleCompetitionRequest,
    user_id: str = Depends(get_user_id_from_jwt_or_query),
    db: AsyncSession = Depends(get_db)
):
    if user_id != parent_id:
        raise HTTPException(status_code=403, detail="Not authorized to modify competition status")
    """
    Toggle competition mode for a linked Grom.
    Only the confirmed guardian can change this setting.
    When enabled, sets elite_tier to 'grom_rising' for competitive features.
    """
    parent = await _profile(db, parent_id)
    if not parent:
        raise HTTPException(status_code=404, detail="Parent not found")

    grom = await _profile(db, grom_id)
    if not grom:
        raise HTTPException(status_code=404, detail="Grom not found")

    if grom.role != RoleEnum.GROM:
        raise HTTPException(status_code=400, detail="Target user is not a Grom")

    if not is_confirmed_guardian(grom, parent_id):
        raise HTTPException(status_code=403, detail="You can only modify your linked Grom's settings")

    # Update elite_tier based on competition status
    new_elite_tier = "grom_rising" if data.competes else None

    # Use explicit update statement for reliability
    from sqlalchemy import update
    await db.execute(
        update(Profile)
        .where(Profile.id == grom_id)
        .values(elite_tier=new_elite_tier)
    )
    await db.commit()

    return {
        "success": True,
        "grom_id": grom_id,
        "competes": data.competes,
        "elite_tier": new_elite_tier,
        "message": f"Competition mode {'enabled' if data.competes else 'disabled'} for {grom.full_name}"
    }


@router.get("/linked-groms/{parent_id}")
async def get_linked_groms(
    parent_id: str,
    user_id: str = Depends(get_user_id_from_jwt_or_query),
    db: AsyncSession = Depends(get_db)
):
    if user_id != parent_id:
        raise HTTPException(status_code=403, detail="Not authorized to view linked Groms")
    """
    Get all Groms confirmed-linked to a guardian account
    Returns linked groms, open invites this guardian sent, and aggregate stats
    """
    parent = await _profile(db, parent_id)
    if not parent:
        raise HTTPException(status_code=404, detail="Parent not found")

    # Only CONFIRMED links: a bare parent_id claim is not a link.
    groms_result = await db.execute(
        select(Profile)
        .where(Profile.parent_id == parent_id)
        .where(Profile.parent_link_approved.is_(True))
        .where(Profile.role == RoleEnum.GROM)
    )
    linked_groms = groms_result.scalars().all()

    # Invites this guardian has sent and the child has not yet answered
    pending_requests = (await guardian_links.pending_for_user(db, parent))["outgoing"]

    # Calculate aggregate stats
    total_earnings = 0
    total_sessions = 0
    total_achievements = 0

    groms_data = []
    for grom in linked_groms:
        # Get badges count from profile
        badges_list = []
        if grom.badges:
            import json
            try:
                badges_list = json.loads(grom.badges) if isinstance(grom.badges, str) else grom.badges
            except (json.JSONDecodeError, TypeError):
                badges_list = []

        standing = await guardian_level(db, grom)
        grom_data = {
            "id": grom.id,
            "full_name": grom.full_name,
            "avatar_url": grom.avatar_url,
            "credits_balance": float(grom.credit_balance) if grom.credit_balance else 0,
            "achievements_count": len(badges_list) if badges_list else 0,
            "total_xp": grom.total_xp if hasattr(grom, 'total_xp') and grom.total_xp else 0,
            "linked_at": grom.created_at.isoformat() if grom.created_at else None,
            "guardian_level": standing.level,
            "age_band": standing.band,
            "unlocked": unlocked(standing),
        }
        groms_data.append(grom_data)

        total_earnings += grom_data["credits_balance"]
        total_achievements += grom_data["achievements_count"]

    return {
        "linked_groms": groms_data,
        "pending_requests": pending_requests,
        "stats": {
            "totalEarnings": total_earnings,
            "totalSessions": total_sessions,
            "totalScreenTime": 0,  # Future feature
            "achievementsUnlocked": total_achievements
        }
    }


@router.post("/link-grom")
async def link_grom(
    parent_id: str,
    grom_id: str,
    user_id: str = Depends(get_user_id_from_jwt_or_query),
    db: AsyncSession = Depends(get_db)
):
    if user_id != parent_id:
        raise HTTPException(status_code=403, detail="Not authorized to link Groms for this parent")
    """
    Propose a link to a Grom. NOTHING is linked until the Grom's own account confirms the invite
    (48 hours, single use). Before this change this route linked any unlinked Grom outright (audit F-01).
    """
    parent = await _profile(db, parent_id)
    if not parent:
        raise HTTPException(status_code=404, detail="Parent not found")

    invite = await guardian_links.create_parent_invite(db, parent, grom_id)
    return {
        "success": True,
        "status": "pending_child_confirmation",
        "invite_id": invite["invite_id"],
        "expires_at": invite["expires_at"],
        "message": "Invite sent. The link starts when the child confirms it in their account."
    }


@router.post("/unlink-grom")
async def unlink_grom(
    parent_id: str,
    grom_id: str,
    password: str,
    user_id: str = Depends(get_user_id_from_jwt_or_query),
    db: AsyncSession = Depends(get_db)
):
    if user_id != parent_id:
        raise HTTPException(status_code=403, detail="Not authorized to unlink Groms for this parent")
    """
    Unlink a Grom account from parent (requires parent password)
    This can ONLY be done from the parent's side
    """
    from passlib.context import CryptContext

    pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

    parent = await _profile(db, parent_id)
    if not parent:
        raise HTTPException(status_code=404, detail="Parent not found")

    # Verify password
    if not pwd_context.verify(password, parent.password_hash):
        raise HTTPException(status_code=401, detail="Incorrect password")

    grom = await _profile(db, grom_id)
    if not grom:
        raise HTTPException(status_code=404, detail="Grom not found")

    if not is_confirmed_guardian(grom, parent_id):
        raise HTTPException(status_code=403, detail="This Grom is not linked to your account")

    await guardian_links.unlink(db, grom)

    return {
        "success": True,
        "message": f"Successfully unlinked {grom.full_name} from your account"
    }


@router.get("/grom-status/{grom_id}")
async def get_grom_status(
    grom_id: str,
    user_id: str = Depends(get_user_id_from_jwt_or_query),
    db: AsyncSession = Depends(get_db)
):
    """
    Check if a Grom account is linked to a parent
    Used for the Safety Gate lock screen
    """
    grom = await _profile(db, grom_id)

    if not grom:
        raise HTTPException(status_code=404, detail="User not found")

    if user_id != grom_id and not is_confirmed_guardian(grom, user_id):
        raise HTTPException(status_code=403, detail="Not authorized to view this Grom's status")

    if grom.role != RoleEnum.GROM:
        return {
            "is_grom": False,
            "requires_parent_link": False,
            "is_linked": False,
            "is_approved": True,
            "parental_controls": None
        }

    standing = await guardian_level(db, grom)
    is_linked = has_confirmed_link(grom)

    # Get parent info only for a confirmed link
    parent_info = None
    if is_linked:
        parent = await _profile(db, grom.parent_id)
        if parent:
            parent_info = {
                "id": parent.id,
                "full_name": parent.full_name,
                "avatar_url": parent.avatar_url
            }

    return {
        "is_grom": True,
        "requires_parent_link": True,
        "is_linked": is_linked,
        "is_approved": is_linked,
        # The permanent per-child code is retired: a code is now generated on request (POST /guardian-code),
        # single-use and valid 48 hours. The key stays so older clients do not break.
        "guardian_code": None,
        "guardian_level": standing.level,
        "age_band": standing.band,
        "unlocked": unlocked(standing),
        "parent_info": parent_info,
        "parental_controls": grom.parental_controls or {
            "can_post": False,
            "can_stream": False,
            "can_message": False,
            "can_comment": True,
            "view_only": False
        }
    }


@router.post("/update-parental-controls/{grom_id}")
async def update_parental_controls(
    grom_id: str,
    parent_id: str,
    controls: dict,
    user_id: str = Depends(get_user_id_from_jwt_or_query),
    db: AsyncSession = Depends(get_db)
):
    if user_id != parent_id:
        raise HTTPException(status_code=403, detail="Not authorized to update parental controls")
    """
    Update parental controls for a linked Grom
    Only the confirmed guardian can update these settings
    """
    grom = await _profile(db, grom_id)

    if not grom:
        raise HTTPException(status_code=404, detail="Grom not found")

    if not is_confirmed_guardian(grom, parent_id):
        raise HTTPException(status_code=403, detail="Not authorized to update this Grom's controls")

    # Validate controls
    # `can_message_grom_channel` is the "Grom Zone Chat" switch on the guardian screen; the messaging gate
    # (`check_grom_messaging_permission`) already reads it, but this list dropped it, so the toggle reported
    # "Controls updated" and changed nothing (audit F-09).
    valid_keys = ["can_post", "can_stream", "can_message", "can_message_grom_channel", "can_comment", "view_only",
                  "can_call", "approved_callers"]
    filtered_controls = {k: v for k, v in controls.items() if k in valid_keys}
    # Keys this route does not own (spending limits and media ceilings have their own routes; the screen echoes the
    # whole object back) are not stored here. Name them in the reply instead of dropping them silently.
    ignored_keys = sorted(k for k in controls if k not in valid_keys)

    # Merge with existing controls
    existing_controls = grom.parental_controls or {}
    existing_controls.update(filtered_controls)
    grom.parental_controls = existing_controls
    flag_modified(grom, 'parental_controls')

    await db.commit()

    return {
        "success": True,
        "parental_controls": grom.parental_controls,
        "saved_keys": sorted(filtered_controls),
        "ignored_keys": ignored_keys,
    }


@router.post("/approve-grom-link/{grom_id}")
async def approve_grom_link(
    grom_id: str,
    parent_id: str,
    user_id: str = Depends(get_user_id_from_jwt_or_query),
    db: AsyncSession = Depends(get_db)
):
    if user_id != parent_id:
        raise HTTPException(status_code=403, detail="Not authorized to approve links")
    """
    A guardian can no longer approve their own link: approval is the CHILD's confirmation (invite) or the child's
    code. Kept so older clients get a clear answer; a link that is already confirmed is reported as such.
    """
    grom = await _profile(db, grom_id)
    if not grom:
        raise HTTPException(status_code=404, detail="Grom not found")

    if is_confirmed_guardian(grom, parent_id):
        return {"success": True, "message": f"Link with {grom.full_name} is already confirmed"}

    raise HTTPException(
        status_code=403,
        detail="A link is confirmed by the child's account. Ask the child for a code, or send an invite they confirm.",
    )


@router.post("/link-by-code")
async def link_grom_by_code(
    request: Request,
    parent_id: str,
    guardian_code: str,
    user_id: str = Depends(get_user_id_from_jwt_or_query),
    db: AsyncSession = Depends(get_db)
):
    if user_id != parent_id:
        raise HTTPException(status_code=403, detail="Not authorized to link by code")
    """
    Redeem a code the CHILD's account generated. Single use, bound to that child, valid 48 hours.
    """
    rate_limit_check(request, max_requests=8, window_seconds=600, key_prefix=f"guardian_redeem:{user_id}:")
    parent = await _profile(db, parent_id)
    if not parent:
        raise HTTPException(status_code=404, detail="Parent not found")

    grom = await guardian_links.redeem_child_code(db, parent, guardian_code)

    return {
        "success": True,
        "message": f"Successfully linked {grom.full_name} to your account",
        "grom": {
            "id": grom.id,
            "full_name": grom.full_name,
            "avatar_url": grom.avatar_url
        }
    }


# ============ CHILD SIDE: "Ask my parent" ============
# These routes take the actor from the token alone (no id in the path or query): the child is whoever is signed in.

@router.post("/guardian-code")
async def create_guardian_code(
    current_user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """The signed-in child asks for a one-time code to give a parent or guardian. Revokes any earlier open code."""
    child = await _profile(db, current_user_id)
    if not child:
        raise HTTPException(status_code=404, detail="Profile not found")
    return await guardian_links.create_child_code(db, child)


@router.get("/guardian-invites")
async def list_guardian_invites(
    current_user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Open invites for the signed-in account: a child sees what adults proposed; an adult sees what they sent."""
    user = await _profile(db, current_user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Profile not found")
    return await guardian_links.pending_for_user(db, user)


@router.post("/guardian-invites/{invite_id}/confirm")
async def confirm_guardian_invite(
    invite_id: str,
    current_user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """The child confirms an adult's invite. This is the second side of the link."""
    child = await _profile(db, current_user_id)
    if not child:
        raise HTTPException(status_code=404, detail="Profile not found")
    guardian = await guardian_links.confirm_parent_invite(db, child, invite_id)
    return {"success": True, "guardian": {"id": guardian.id, "full_name": guardian.full_name,
                                          "avatar_url": guardian.avatar_url}}


@router.post("/guardian-invites/{invite_id}/decline")
async def decline_guardian_invite(
    invite_id: str,
    current_user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    child = await _profile(db, current_user_id)
    if not child:
        raise HTTPException(status_code=404, detail="Profile not found")
    await guardian_links.decline_parent_invite(db, child, invite_id)
    return {"success": True}
