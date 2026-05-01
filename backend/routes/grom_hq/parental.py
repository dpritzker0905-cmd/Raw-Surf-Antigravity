"""Grom HQ parental — linking, unlinking, competition toggle, parental controls."""
from fastapi import Depends, HTTPException, APIRouter
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from database import get_db
from models import Profile, RoleEnum
from utils.grom_parent import is_grom_parent_eligible

router = APIRouter()

@router.post("/toggle-competition/{grom_id}")
async def toggle_grom_competition(
    grom_id: str,
    parent_id: str,
    data: ToggleCompetitionRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Toggle competition mode for a linked Grom.
    Only the linked parent can change this setting.
    When enabled, sets elite_tier to 'grom_rising' for competitive features.
    """
    # Verify parent exists and is a Grom Parent
    parent_result = await db.execute(
        select(Profile).where(Profile.id == parent_id)
    )
    parent = parent_result.scalar_one_or_none()
    
    if not parent:
        raise HTTPException(status_code=404, detail="Parent not found")
    
    if not is_grom_parent_eligible(parent):
        raise HTTPException(status_code=403, detail="Only Grom Parents can modify competition status")
    
    # Verify Grom exists and is linked to this parent
    grom_result = await db.execute(
        select(Profile).where(Profile.id == grom_id)
    )
    grom = grom_result.scalar_one_or_none()
    
    if not grom:
        raise HTTPException(status_code=404, detail="Grom not found")
    
    if grom.role != RoleEnum.GROM:
        raise HTTPException(status_code=400, detail="Target user is not a Grom")
    
    if grom.parent_id != parent_id:
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
    db: AsyncSession = Depends(get_db)
):
    """
    Get all Groms linked to a parent account
    Returns linked groms, pending requests, and aggregate stats
    """
    # Verify parent exists and is a Grom Parent
    parent_result = await db.execute(
        select(Profile).where(Profile.id == parent_id)
    )
    parent = parent_result.scalar_one_or_none()
    
    if not parent:
        raise HTTPException(status_code=404, detail="Parent not found")
    
    # Get all Groms linked to this parent
    groms_result = await db.execute(
        select(Profile)
        .where(Profile.parent_id == parent_id)
        .where(Profile.role == RoleEnum.GROM)
    )
    linked_groms = groms_result.scalars().all()
    
    # Get pending link requests (Groms who requested to link but not yet approved)
    # For now, we'll return empty - this would need a separate LinkRequest model
    pending_requests = []
    
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
        
        grom_data = {
            "id": grom.id,
            "full_name": grom.full_name,
            "avatar_url": grom.avatar_url,
            "credits_balance": float(grom.credit_balance) if grom.credit_balance else 0,
            "achievements_count": len(badges_list) if badges_list else 0,
            "total_xp": grom.total_xp if hasattr(grom, 'total_xp') and grom.total_xp else 0,
            "linked_at": grom.created_at.isoformat() if grom.created_at else None
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
    db: AsyncSession = Depends(get_db)
):
    """
    Link a Grom account to a verified parent
    """
    # Verify parent exists and is a Grom Parent
    parent_result = await db.execute(
        select(Profile).where(Profile.id == parent_id)
    )
    parent = parent_result.scalar_one_or_none()
    
    if not parent:
        raise HTTPException(status_code=404, detail="Parent not found")
    
    if not is_grom_parent_eligible(parent):
        raise HTTPException(status_code=403, detail="Only Grom Parents can link Groms")
    
    # Verify grom exists and is a Grom
    grom_result = await db.execute(
        select(Profile).where(Profile.id == grom_id)
    )
    grom = grom_result.scalar_one_or_none()
    
    if not grom:
        raise HTTPException(status_code=404, detail="Grom not found")
    
    if grom.role != RoleEnum.GROM:
        raise HTTPException(status_code=400, detail="User is not a Grom")
    
    if grom.parent_id:
        raise HTTPException(status_code=400, detail="Grom is already linked to a parent")
    
    # Link the grom
    grom.parent_id = parent_id
    await db.commit()
    
    return {
        "success": True,
        "message": f"Successfully linked {grom.full_name} to your account"
    }


@router.post("/unlink-grom")
async def unlink_grom(
    parent_id: str,
    grom_id: str,
    password: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Unlink a Grom account from parent (requires parent password)
    This can ONLY be done from the parent's side
    """
    from passlib.context import CryptContext


    pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
    
    # Verify parent exists
    parent_result = await db.execute(
        select(Profile).where(Profile.id == parent_id)
    )
    parent = parent_result.scalar_one_or_none()
    
    if not parent:
        raise HTTPException(status_code=404, detail="Parent not found")
    
    # Verify password
    if not pwd_context.verify(password, parent.password):
        raise HTTPException(status_code=401, detail="Incorrect password")
    
    # Verify grom is linked to this parent
    grom_result = await db.execute(
        select(Profile).where(Profile.id == grom_id)
    )
    grom = grom_result.scalar_one_or_none()
    
    if not grom:
        raise HTTPException(status_code=404, detail="Grom not found")
    
    if grom.parent_id != parent_id:
        raise HTTPException(status_code=403, detail="This Grom is not linked to your account")
    
    # Unlink the grom
    grom.parent_id = None
    await db.commit()
    
    return {
        "success": True,
        "message": f"Successfully unlinked {grom.full_name} from your account"
    }


@router.get("/grom-status/{grom_id}")
async def get_grom_status(
    grom_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Check if a Grom account is linked to a parent
    Used for the Safety Gate lock screen
    """
    grom_result = await db.execute(
        select(Profile).where(Profile.id == grom_id)
    )
    grom = grom_result.scalar_one_or_none()
    
    if not grom:
        raise HTTPException(status_code=404, detail="User not found")
    
    if grom.role != RoleEnum.GROM:
        return {
            "is_grom": False,
            "requires_parent_link": False,
            "is_linked": False,
            "is_approved": True,
            "parental_controls": None
        }
    
    is_linked = grom.parent_id is not None
    is_approved = grom.parent_link_approved or False
    
    # Get parent info if linked
    parent_info = None
    if is_linked:
        parent_result = await db.execute(
            select(Profile).where(Profile.id == grom.parent_id)
        )
        parent = parent_result.scalar_one_or_none()
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
        "is_approved": is_approved,
        "guardian_code": grom.guardian_code,
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
    db: AsyncSession = Depends(get_db)
):
    """
    Update parental controls for a linked Grom
    Only the linked parent can update these settings
    """
    # Verify grom exists and is linked to this parent
    grom_result = await db.execute(
        select(Profile).where(Profile.id == grom_id)
    )
    grom = grom_result.scalar_one_or_none()
    
    if not grom:
        raise HTTPException(status_code=404, detail="Grom not found")
    
    if grom.parent_id != parent_id:
        raise HTTPException(status_code=403, detail="Not authorized to update this Grom's controls")
    
    # Validate controls
    valid_keys = ["can_post", "can_stream", "can_message", "can_comment", "view_only", "can_call", "approved_callers"]
    filtered_controls = {k: v for k, v in controls.items() if k in valid_keys}
    
    # Merge with existing controls
    existing_controls = grom.parental_controls or {}
    existing_controls.update(filtered_controls)
    grom.parental_controls = existing_controls
    flag_modified(grom, 'parental_controls')
    
    await db.commit()
    
    return {
        "success": True,
        "parental_controls": grom.parental_controls
    }


@router.post("/approve-grom-link/{grom_id}")
async def approve_grom_link(
    grom_id: str,
    parent_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Parent approves a Grom link request
    """
    # Verify parent
    parent_result = await db.execute(
        select(Profile).where(Profile.id == parent_id)
    )
    parent = parent_result.scalar_one_or_none()
    
    if not parent or not is_grom_parent_eligible(parent):
        raise HTTPException(status_code=403, detail="Only Grom Parents can approve links")
    
    # Find and update grom
    grom_result = await db.execute(
        select(Profile).where(Profile.id == grom_id)
    )
    grom = grom_result.scalar_one_or_none()
    
    if not grom:
        raise HTTPException(status_code=404, detail="Grom not found")
    
    if grom.parent_id != parent_id:
        raise HTTPException(status_code=403, detail="This Grom is not linked to your account")
    
    grom.parent_link_approved = True
    await db.commit()
    
    return {
        "success": True,
        "message": f"Successfully approved link with {grom.full_name}"
    }


@router.post("/link-by-code")
async def link_grom_by_code(
    parent_id: str,
    guardian_code: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Link a Grom to parent using guardian code
    """
    # Verify parent
    parent_result = await db.execute(
        select(Profile).where(Profile.id == parent_id)
    )
    parent = parent_result.scalar_one_or_none()
    
    if not parent or not is_grom_parent_eligible(parent):
        raise HTTPException(status_code=403, detail="Only Grom Parents can link Groms")
    
    # Find grom by guardian code
    grom_result = await db.execute(
        select(Profile).where(Profile.guardian_code == guardian_code.upper())
    )
    grom = grom_result.scalar_one_or_none()
    
    if not grom:
        raise HTTPException(status_code=404, detail="Invalid guardian code")
    
    if grom.role != RoleEnum.GROM:
        raise HTTPException(status_code=400, detail="Invalid guardian code")
    
    if grom.parent_id and grom.parent_link_approved:
        raise HTTPException(status_code=400, detail="This Grom is already linked to a parent")
    
    # Link and approve
    grom.parent_id = parent_id
    grom.parent_link_approved = True
    
    await db.commit()
    
    return {
        "success": True,
        "message": f"Successfully linked {grom.full_name} to your account",
        "grom": {
            "id": grom.id,
            "full_name": grom.full_name,
            "avatar_url": grom.avatar_url
        }
    }



