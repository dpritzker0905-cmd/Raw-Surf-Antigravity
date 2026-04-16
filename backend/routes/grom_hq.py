"""
Grom HQ API Routes
Parental management for Grom accounts
"""

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload
from sqlalchemy.orm.attributes import flag_modified
from database import get_db
from models import Profile, RoleEnum
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timezone
import stripe
import os
import json
from utils.grom_parent import is_grom_parent_eligible

router = APIRouter(prefix="/grom-hq", tags=["grom-hq"])

# Configure Stripe
stripe.api_key = os.environ.get("STRIPE_API_KEY")


# ============ PYDANTIC MODELS ============

class ParentalControlsUpdate(BaseModel):
    can_post: Optional[bool] = None
    can_stream: Optional[bool] = None
    can_message: Optional[bool] = None
    can_comment: Optional[bool] = None
    view_only: Optional[bool] = None


class UnlinkRequest(BaseModel):
    password: str


class LinkByCodeRequest(BaseModel):
    guardian_code: str


class AgeVerificationRequest(BaseModel):
    return_url: Optional[str] = None


class ToggleCompetitionRequest(BaseModel):
    competes: bool


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
    valid_keys = ["can_post", "can_stream", "can_message", "can_comment", "view_only"]
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



# ============ STRIPE IDENTITY AGE VERIFICATION ============

@router.post("/create-age-verification/{parent_id}")
async def create_age_verification(
    parent_id: str,
    request: AgeVerificationRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Create a Stripe Identity verification session for parent age verification.
    Parent must verify they are 18+ before they can link Grom accounts.
    """
    # Verify parent exists
    parent_result = await db.execute(
        select(Profile).where(Profile.id == parent_id)
    )
    parent = parent_result.scalar_one_or_none()
    
    if not parent:
        raise HTTPException(status_code=404, detail="Parent not found")
    
    if not is_grom_parent_eligible(parent):
        raise HTTPException(status_code=400, detail="Only Grom Parents need age verification")
    
    # Check if already verified
    if parent.parent_age_verified:
        return {
            "already_verified": True,
            "message": "You are already age verified"
        }
    
    try:
        # Create Stripe Identity verification session
        verification_session = stripe.identity.VerificationSession.create(
            type="document",
            options={
                "document": {
                    "allowed_types": ["driving_license", "passport", "id_card"]
                }
            },
            provided_details={
                "email": parent.email,
            },
            metadata={
                "parent_id": parent_id,
                "purpose": "grom_parent_age_verification"
            },
            return_url=request.return_url or "https://raw-surf-os.preview.emergentagent.com/grom-hq"
        )
        
        return {
            "client_secret": verification_session.client_secret,
            "verification_session_id": verification_session.id,
            "status": "pending"
        }
        
    except stripe.error.StripeError as e:
        raise HTTPException(status_code=500, detail=f"Failed to create verification session: {str(e)}")


@router.post("/verify-age-complete/{parent_id}")
async def verify_age_complete(
    parent_id: str,
    verification_session_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Complete age verification after Stripe Identity flow.
    Checks the verification session status and extracts DOB to verify 18+.
    """
    # Verify parent exists
    parent_result = await db.execute(
        select(Profile).where(Profile.id == parent_id)
    )
    parent = parent_result.scalar_one_or_none()
    
    if not parent:
        raise HTTPException(status_code=404, detail="Parent not found")
    
    try:
        # Retrieve the verification session
        verification_session = stripe.identity.VerificationSession.retrieve(
            verification_session_id,
            expand=['verified_outputs']
        )
        
        # Check status
        if verification_session.status != 'verified':
            return {
                "success": False,
                "status": verification_session.status,
                "message": "Verification not yet complete"
            }
        
        # Extract DOB and verify age
        if verification_session.verified_outputs and verification_session.verified_outputs.dob:
            from datetime import datetime, date
            dob_data = verification_session.verified_outputs.dob
            dob = date(dob_data.year, dob_data.month, dob_data.day)
            today = date.today()
            age = today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))
            
            if age >= 18:
                # Update parent as age verified
                parent.parent_age_verified = True
                await db.commit()
                
                return {
                    "success": True,
                    "age_verified": True,
                    "message": "Age verification successful. You are verified as 18+."
                }
            else:
                return {
                    "success": False,
                    "age_verified": False,
                    "message": "You must be 18 or older to be a Grom Parent."
                }
        
        return {
            "success": False,
            "message": "Could not extract date of birth from verification"
        }
        
    except stripe.error.StripeError as e:
        raise HTTPException(status_code=500, detail=f"Verification check failed: {str(e)}")


@router.get("/age-verification-status/{parent_id}")
async def get_age_verification_status(
    parent_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Check if a parent has completed age verification.
    """
    parent_result = await db.execute(
        select(Profile).where(Profile.id == parent_id)
    )
    parent = parent_result.scalar_one_or_none()
    
    if not parent:
        raise HTTPException(status_code=404, detail="Parent not found")
    
    return {
        "parent_id": parent_id,
        "age_verified": parent.parent_age_verified or False,
        "can_link_groms": parent.parent_age_verified or False
    }


@router.post("/demo-verify-age/{parent_id}")
async def demo_verify_age(
    parent_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Demo/test endpoint to bypass Stripe Identity for age verification.
    In production, this should be disabled or require admin access.
    """
    parent_result = await db.execute(
        select(Profile).where(Profile.id == parent_id)
    )
    parent = parent_result.scalar_one_or_none()
    
    if not parent:
        raise HTTPException(status_code=404, detail="Parent not found")
    
    if not is_grom_parent_eligible(parent):
        raise HTTPException(status_code=400, detail="Only Grom Parents need age verification")
    
    # Set age verified to true (demo mode)
    parent.parent_age_verified = True
    await db.commit()
    
    return {
        "success": True,
        "message": "Age verified (demo mode)",
        "parent_id": parent_id
    }


# ============ PASSWORD-PROTECTED UNLINK ============

@router.post("/unlink-grom/{grom_id}")
async def unlink_grom_secure(
    grom_id: str,
    parent_id: str,
    request: UnlinkRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Unlink a Grom account from parent (requires parent password).
    This can ONLY be done from the parent's side with password verification.
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
    if not pwd_context.verify(request.password, parent.password_hash):
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
    
    # Unlink the grom - this will lock them out until re-linked
    grom.parent_id = None
    grom.parent_link_approved = False
    
    await db.commit()
    
    return {
        "success": True,
        "message": f"Successfully unlinked {grom.full_name}. They will need to be linked to a parent again to access the app."
    }


@router.get("/can-grom-unlink/{grom_id}")
async def can_grom_unlink(
    grom_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Check if the Grom can see the unlink option.
    Groms should NOT be able to unlink themselves - returns false always.
    This endpoint is called by the frontend to hide the unlink button.
    """
    return {
        "can_unlink": False,
        "reason": "Unlinking can only be done by your parent/guardian"
    }



# ============ ACTIVITY MONITORING ============

@router.get("/activity/{grom_id}")
async def get_grom_activity(
    grom_id: str,
    parent_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Get activity data for a linked Grom.
    Only the linked parent can view this data.
    """
    from models import Post, CreditTransaction
    from datetime import datetime, timedelta
    
    # Verify grom is linked to this parent
    grom_result = await db.execute(
        select(Profile).where(Profile.id == grom_id)
    )
    grom = grom_result.scalar_one_or_none()
    
    if not grom:
        raise HTTPException(status_code=404, detail="Grom not found")
    
    if grom.parent_id != parent_id:
        raise HTTPException(status_code=403, detail="Not authorized to view this Grom's activity")
    
    # Get posts count
    posts_result = await db.execute(
        select(func.count(Post.id)).where(Post.author_id == grom_id)
    )
    total_posts = posts_result.scalar() or 0
    
    # Get recent posts (last 7 days)
    week_ago = datetime.utcnow() - timedelta(days=7)
    recent_posts_result = await db.execute(
        select(func.count(Post.id))
        .where(Post.author_id == grom_id)
        .where(Post.created_at >= week_ago)
    )
    recent_posts = recent_posts_result.scalar() or 0
    
    # Get transactions (credits spent)
    transactions_result = await db.execute(
        select(CreditTransaction)
        .where(CreditTransaction.user_id == grom_id)
        .order_by(CreditTransaction.created_at.desc())
        .limit(10)
    )
    transactions = transactions_result.scalars().all()
    
    transaction_list = [{
        "id": t.id,
        "type": t.transaction_type,
        "amount": float(t.amount) if t.amount else 0,
        "description": t.description,
        "created_at": t.created_at.isoformat() if t.created_at else None
    } for t in transactions]
    
    # Calculate total spent
    total_spent_result = await db.execute(
        select(func.sum(CreditTransaction.amount))
        .where(CreditTransaction.user_id == grom_id)
        .where(CreditTransaction.amount < 0)  # Negative = spending
    )
    total_spent = abs(total_spent_result.scalar() or 0)
    
    # Sessions joined (from profile stats)
    sessions_joined = grom.total_sessions or 0
    
    # Build activity summary
    return {
        "grom_id": grom_id,
        "grom_name": grom.full_name,
        "activity": {
            "total_posts": total_posts,
            "posts_this_week": recent_posts,
            "sessions_joined": sessions_joined,
            "total_spent": total_spent,
            "credits_balance": float(grom.credit_balance) if grom.credit_balance else 0
        },
        "recent_transactions": transaction_list,
        "parental_controls": grom.parental_controls or {}
    }


@router.get("/spending-summary/{grom_id}")
async def get_spending_summary(
    grom_id: str,
    parent_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Get detailed spending summary for a Grom.
    Shows spending by category and recent purchases.
    """
    from models import CreditTransaction, GearPurchase
    from datetime import datetime, timedelta
    
    # Verify authorization
    grom_result = await db.execute(
        select(Profile).where(Profile.id == grom_id)
    )
    grom = grom_result.scalar_one_or_none()
    
    if not grom or grom.parent_id != parent_id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    # Get spending by type
    spending_result = await db.execute(
        select(
            CreditTransaction.transaction_type,
            func.sum(func.abs(CreditTransaction.amount)).label('total')
        )
        .where(CreditTransaction.user_id == grom_id)
        .where(CreditTransaction.amount < 0)
        .group_by(CreditTransaction.transaction_type)
    )
    spending_by_type = {row.transaction_type: float(row.total) for row in spending_result.all()}
    
    # Get gear purchases
    gear_result = await db.execute(
        select(GearPurchase)
        .where(GearPurchase.user_id == grom_id)
        .order_by(GearPurchase.created_at.desc())
        .limit(5)
    )
    gear_purchases = gear_result.scalars().all()
    
    gear_list = [{
        "id": g.id,
        "credits_spent": float(g.credits_spent) if g.credits_spent else 0,
        "affiliate_partner": g.affiliate_partner,
        "status": g.status,
        "created_at": g.created_at.isoformat() if g.created_at else None
    } for g in gear_purchases]
    
    # Calculate monthly spending
    month_ago = datetime.utcnow() - timedelta(days=30)
    monthly_result = await db.execute(
        select(func.sum(func.abs(CreditTransaction.amount)))
        .where(CreditTransaction.user_id == grom_id)
        .where(CreditTransaction.amount < 0)
        .where(CreditTransaction.created_at >= month_ago)
    )
    monthly_spending = float(monthly_result.scalar() or 0)
    
    return {
        "grom_id": grom_id,
        "grom_name": grom.full_name,
        "credits_balance": float(grom.credit_balance) if grom.credit_balance else 0,
        "spending_by_category": spending_by_type,
        "monthly_spending": monthly_spending,
        "recent_gear_purchases": gear_list,
        "spending_limit": grom.parental_controls.get('spending_limit') if grom.parental_controls else None
    }


class SpendingLimitUpdate(BaseModel):
    monthly_limit: Optional[float] = None
    require_approval_above: Optional[float] = None
    allowed_categories: Optional[list] = None


@router.post("/spending-controls/{grom_id}")
async def update_spending_controls(
    grom_id: str,
    parent_id: str,
    controls: SpendingLimitUpdate,
    db: AsyncSession = Depends(get_db)
):
    """
    Update spending controls for a Grom.
    Parent can set monthly limits and require approval for purchases.
    """
    # Verify authorization
    grom_result = await db.execute(
        select(Profile).where(Profile.id == grom_id)
    )
    grom = grom_result.scalar_one_or_none()
    
    if not grom or grom.parent_id != parent_id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    # Update parental controls
    current_controls = grom.parental_controls or {}
    
    if controls.monthly_limit is not None:
        current_controls['spending_limit'] = controls.monthly_limit
    if controls.require_approval_above is not None:
        current_controls['require_approval_above'] = controls.require_approval_above
    if controls.allowed_categories is not None:
        current_controls['allowed_spending_categories'] = controls.allowed_categories
    
    grom.parental_controls = current_controls
    flag_modified(grom, 'parental_controls')
    await db.commit()
    
    return {
        "success": True,
        "parental_controls": grom.parental_controls
    }



# ============ PARENTAL SPENDING ALERTS ============

class SpendingAlertRequest(BaseModel):
    grom_id: str
    amount: float
    description: str
    transaction_type: str  # 'purchase', 'live_session_buyin', 'booking_payment', etc.


async def send_parental_spending_alert(
    db: AsyncSession,
    grom_id: str,
    amount: float,
    description: str,
    transaction_type: str
) -> bool:
    """
    Send a notification to the parent when their Grom makes a purchase
    above the approval threshold.
    Returns True if notification was sent, False if not needed.
    """
    from models import Notification
    import json
    
    # Get the Grom and their parental controls
    grom_result = await db.execute(
        select(Profile).where(Profile.id == grom_id)
    )
    grom = grom_result.scalar_one_or_none()
    
    if not grom or not grom.parent_id:
        return False
    
    # Check if there's an approval threshold set
    parental_controls = grom.parental_controls or {}
    approval_threshold = parental_controls.get('require_approval_above')
    
    # Only send notification if purchase exceeds threshold
    if approval_threshold is None or amount <= approval_threshold:
        return False
    
    # Get parent info
    parent_result = await db.execute(
        select(Profile).where(Profile.id == grom.parent_id)
    )
    parent = parent_result.scalar_one_or_none()
    
    if not parent:
        return False
    
    # Create notification for parent
    notification = Notification(
        user_id=parent.id,
        type='grom_spending_alert',
        title=f'🛒 {grom.full_name} made a purchase',
        body=f'${amount:.2f} - {description}. This exceeds your ${approval_threshold:.2f} approval threshold.',
        data=json.dumps({
            'grom_id': grom_id,
            'grom_name': grom.full_name,
            'amount': amount,
            'description': description,
            'transaction_type': transaction_type,
            'approval_threshold': approval_threshold,
            'alert_type': 'spending_alert'
        })
    )
    db.add(notification)
    await db.commit()
    
    return True


@router.post("/spending-alert")
async def trigger_spending_alert(
    request: SpendingAlertRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Endpoint to trigger a parental spending alert.
    Called when a Grom makes a purchase that exceeds the approval threshold.
    """
    sent = await send_parental_spending_alert(
        db=db,
        grom_id=request.grom_id,
        amount=request.amount,
        description=request.description,
        transaction_type=request.transaction_type
    )
    
    return {
        "success": True,
        "notification_sent": sent,
        "message": "Alert sent to parent" if sent else "No alert needed (below threshold or no parent linked)"
    }


@router.get("/spending-alerts/{parent_id}")
async def get_spending_alerts(
    parent_id: str,
    limit: int = 20,
    db: AsyncSession = Depends(get_db)
):
    """
    Get recent spending alerts for a parent.
    """
    from models import Notification
    
    result = await db.execute(
        select(Notification)
        .where(Notification.user_id == parent_id)
        .where(Notification.type == 'grom_spending_alert')
        .order_by(Notification.created_at.desc())
        .limit(limit)
    )
    alerts = result.scalars().all()
    
    import json
    return {
        "alerts": [{
            "id": a.id,
            "title": a.title,
            "body": a.body,
            "data": json.loads(a.data) if a.data else None,
            "is_read": a.is_read,
            "created_at": a.created_at.isoformat() if a.created_at else None
        } for a in alerts],
        "count": len(alerts)
    }


# ============ FAMILY ACTIVITY FEED ============

@router.get("/family-activity/{parent_id}")
async def get_family_activity_feed(
    parent_id: str,
    grom_id: Optional[str] = None,
    limit: int = 20,
    offset: int = 0,
    db: AsyncSession = Depends(get_db)
):
    """
    Get a consolidated activity feed for all linked Groms (or a specific Grom).
    Shows: Latest Posts, Earned Achievements/Badges, Tagged Photos.
    """
    from models import Post, PhotoTag, GalleryItem
    
    # Verify parent is a Grom Parent
    parent_result = await db.execute(select(Profile).where(Profile.id == parent_id))
    parent = parent_result.scalar_one_or_none()
    
    if not parent:
        raise HTTPException(status_code=404, detail="Parent not found")
    
    if not is_grom_parent_eligible(parent):
        raise HTTPException(status_code=403, detail="Only Grom Parents can view family activity")
    
    # Get linked Groms
    if grom_id:
        grom_result = await db.execute(
            select(Profile)
            .where(Profile.id == grom_id, Profile.parent_id == parent_id)
        )
        groms = [grom_result.scalar_one_or_none()]
        if not groms[0]:
            raise HTTPException(status_code=403, detail="Grom is not linked to this parent")
    else:
        groms_result = await db.execute(
            select(Profile)
            .where(Profile.parent_id == parent_id, Profile.role == RoleEnum.GROM)
        )
        groms = groms_result.scalars().all()
    
    if not groms:
        return {"activities": [], "total": 0, "groms": []}
    
    grom_ids = [g.id for g in groms if g]
    
    activities = []
    
    # 1. Get Latest Posts from Groms
    try:
        posts_result = await db.execute(
            select(Post)
            .where(Post.author_id.in_(grom_ids))
            .order_by(Post.created_at.desc())
            .limit(10)
        )
        posts = posts_result.scalars().all()
        
        for post in posts:
            grom = next((g for g in groms if g and g.id == post.author_id), None)
            activities.append({
                "type": "post",
                "id": post.id,
                "grom_id": post.author_id,
                "grom_name": grom.full_name if grom else "Unknown",
                "grom_avatar": grom.avatar_url if grom else None,
                "title": "Shared a post",
                "content": post.content[:100] if post.content else None,
                "media_url": post.media_url,
                "media_type": post.media_type,
                "created_at": post.created_at.isoformat() if post.created_at else None,
                "icon": "📝"
            })
    except Exception:
        pass  # Posts table might not have all fields
    
    # 2. Get Profile Stats as "Session" updates (XP gains, level ups, etc.)
    for grom in groms:
        if not grom:
            continue
        # Add an activity for grom's current stats
        xp_total = getattr(grom, 'xp_total', 0) or 0
        total_sessions = getattr(grom, 'total_sessions', 0) or 0
        career_tier = getattr(grom, 'career_tier', 'Wave Rider') or 'Wave Rider'
        
        if xp_total > 0 or total_sessions > 0:
            activities.append({
                "type": "stats",
                "id": f"stats_{grom.id}",
                "grom_id": grom.id,
                "grom_name": grom.full_name,
                "grom_avatar": grom.avatar_url,
                "title": f"Current Level: {career_tier}",
                "content": f"{xp_total} XP earned • {total_sessions} sessions",
                "created_at": datetime.now(timezone.utc).isoformat(),
                "icon": "🏄"
            })
    
    # 3. Get Earned Badges/Achievements
    for grom in groms:
        if not grom:
            continue
        # Check badges earned (stored in profile JSON)
        badges_data = grom.badges or []
        if isinstance(badges_data, str):
            try:
                badges_data = json.loads(badges_data)
            except Exception:
                badges_data = []
        
        for badge in badges_data[-5:]:  # Last 5 badges
            if isinstance(badge, dict):
                activities.append({
                    "type": "badge",
                    "id": f"badge_{grom.id}_{badge.get('name', 'unknown')}",
                    "grom_id": grom.id,
                    "grom_name": grom.full_name,
                    "grom_avatar": grom.avatar_url,
                    "title": f"Earned a badge: {badge.get('name', 'Achievement')}",
                    "content": badge.get('description', ''),
                    "badge_icon": badge.get('icon', '🏅'),
                    "created_at": badge.get('earned_at', datetime.now(timezone.utc).isoformat()),
                    "icon": "🏅"
                })
    
    # 4. Get Tagged Photos (Grom Highlights)
    try:
        tagged_result = await db.execute(
            select(PhotoTag, GalleryItem)
            .join(GalleryItem, GalleryItem.id == PhotoTag.gallery_item_id)
            .where(PhotoTag.surfer_id.in_(grom_ids))
            .order_by(PhotoTag.tagged_at.desc())
            .limit(10)
        )
        tagged = tagged_result.all()
        
        for tag, item in tagged:
            grom = next((g for g in groms if g and g.id == tag.surfer_id), None)
            activities.append({
                "type": "highlight",
                "id": item.id,
                "grom_id": tag.surfer_id,
                "grom_name": grom.full_name if grom else "Unknown",
                "grom_avatar": grom.avatar_url if grom else None,
                "title": "Added to Grom Highlights",
                "content": "A new photo was tagged",
                "media_url": item.thumbnail_url or item.preview_url,
                "media_type": item.media_type,
                "created_at": tag.tagged_at.isoformat() if tag.tagged_at else None,
                "icon": "📸"
            })
    except Exception:
        pass
    
    # Sort all activities by date
    activities.sort(key=lambda x: x.get("created_at") or "", reverse=True)
    
    # Apply pagination
    total = len(activities)
    activities = activities[offset:offset + limit]
    
    # Get grom info
    groms_info = [
        {
            "id": g.id,
            "name": g.full_name,
            "avatar": g.avatar_url,
            "xp": getattr(g, 'xp_total', 0) or 0,
            "level": getattr(g, 'career_tier', 'Wave Rider') or "Wave Rider"
        }
        for g in groms if g
    ]
    
    return {
        "activities": activities,
        "total": total,
        "groms": groms_info
    }

