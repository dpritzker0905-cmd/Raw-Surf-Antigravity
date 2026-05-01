"""Grom HQ age verification — Stripe Identity, demo verify, password-protected unlink."""
from fastapi import Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from database import get_db
from models import Profile
from utils.grom_parent import is_grom_parent_eligible

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



