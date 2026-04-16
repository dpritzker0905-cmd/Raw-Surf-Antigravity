from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from pydantic import BaseModel, EmailStr
from typing import Optional
from datetime import datetime, timezone
from passlib.context import CryptContext
import uuid

from database import get_db
from models import Profile, RoleEnum

router = APIRouter()

# Password hashing
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def hash_password(password: str) -> str:
    return pwd_context.hash(password)

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)

class SignupRequest(BaseModel):
    email: EmailStr
    password: str
    full_name: str
    username: str  # Required @username handle
    role: str
    parent_email: Optional[str] = None
    parent_username: Optional[str] = None  # Alternative to email
    birthdate: Optional[str] = None  # YYYY-MM-DD format for Groms
    company_name: Optional[str] = None
    grom_competes: Optional[bool] = False  # For competitive Groms - sets elite_tier

class LoginRequest(BaseModel):
    email: EmailStr
    password: str

class SignupResponse(BaseModel):
    id: str
    email: str
    role: str
    credit_balance: float
    subscription_tier: Optional[str]
    requires_subscription: bool
    requires_onboarding: bool
    redirect_path: str

class ProfileResponse(BaseModel):
    id: str
    user_id: str
    email: str
    full_name: Optional[str]
    username: Optional[str] = None  # @username handle for mentions
    role: str
    subscription_tier: Optional[str]
    is_ad_supported: bool = True  # True = ads shown (free tier), False = ad-free
    credit_balance: float
    bio: Optional[str]
    avatar_url: Optional[str]
    is_verified: bool = False
    is_live: bool = False
    is_private: bool = False
    is_approved_pro: bool = False
    is_admin: bool = False
    location: Optional[str]
    company_name: Optional[str]
    portfolio_url: Optional[str]
    instagram_url: Optional[str]
    website_url: Optional[str]
    hourly_rate: Optional[float]
    session_price: Optional[float]
    accepts_donations: bool = False
    skill_level: Optional[str]
    stance: Optional[str]
    home_break: Optional[str]
    surf_mode: Optional[str] = 'casual'  # casual, competitive, pro
    is_grom_parent: bool = False  # Grom Parent privileges (role or opt-in flag)
    # Home/Pinned location for map centering
    home_latitude: Optional[float] = None
    home_longitude: Optional[float] = None
    home_location_name: Optional[str] = None
    created_at: datetime
    # Grom-specific fields for safety gate
    parent_id: Optional[str] = None
    parent_link_approved: Optional[bool] = None
    parental_controls: Optional[dict] = None

@router.post("/auth/signup", response_model=SignupResponse)
async def signup(data: SignupRequest, db: AsyncSession = Depends(get_db)):
    import random
    import string
    import re
    from datetime import date
    
    try:
        # Validate email uniqueness
        result = await db.execute(select(Profile).where(Profile.email == data.email))
        existing = result.scalar_one_or_none()
        if existing:
            raise HTTPException(status_code=400, detail="Email already registered")
        
        # ============ USERNAME VALIDATION ============
        # Clean username (remove @ if provided, lowercase)
        username = data.username.lower().strip().lstrip('@')
        
        # Validate username format (alphanumeric, underscores, 3-30 chars)
        if not re.match(r'^[a-z0-9_]{3,30}$', username):
            raise HTTPException(
                status_code=400, 
                detail="Username must be 3-30 characters, letters, numbers, and underscores only"
            )
        
        # Check username uniqueness
        username_check = await db.execute(select(Profile).where(func.lower(Profile.username) == username))
        if username_check.scalar_one_or_none():
            raise HTTPException(status_code=400, detail="Username already taken")
        
        role_enum = RoleEnum[data.role.upper().replace(" ", "_")]
        
        parent_id = None
        guardian_code = None
        parent_link_approved = True  # Default to approved for non-Groms
        birthdate_parsed = None
        parental_controls = None
        
        # ============ GROM SAFETY GATE LOGIC ============
        if role_enum == RoleEnum.GROM:
            # Parse birthdate
            if data.birthdate:
                try:
                    birthdate_parsed = date.fromisoformat(data.birthdate)
                except ValueError:
                    raise HTTPException(status_code=400, detail="Invalid birthdate format. Use YYYY-MM-DD")
            
            # Require parent/guardian email OR username
            if not data.parent_email and not data.parent_username:
                raise HTTPException(status_code=400, detail="Parent/Guardian email or username required for Grom accounts")
            
            # Generate guardian code (6-digit alphanumeric)
            guardian_code = ''.join(random.choices(string.ascii_uppercase + string.digits, k=6))
            
            # Try to find existing parent by email or username
            parent = None
            if data.parent_email:
                parent_result = await db.execute(select(Profile).where(Profile.email == data.parent_email))
                parent = parent_result.scalar_one_or_none()
            elif data.parent_username:
                # Search by full_name or email prefix
                parent_result = await db.execute(
                    select(Profile).where(
                        (Profile.full_name.ilike(f"%{data.parent_username}%")) |
                        (Profile.email.ilike(f"{data.parent_username}%"))
                    )
                )
                parent = parent_result.scalars().first()
            
            if parent:
                # Scenario B: Existing parent - link but require approval
                parent_id = parent.id
                parent_link_approved = False  # Requires parent approval
                
                # Send in-app notification to parent
                from models import Notification
                import json
                notification = Notification(
                    user_id=parent.id,
                    type='grom_link_request',
                    title='New Grom Account Created',
                    body=f'A new Grom account was created with your email. Use Guardian Code: {guardian_code} to link and approve.',
                    data=json.dumps({
                        'grom_email': data.email,
                        'guardian_code': guardian_code,
                        'alert_type': 'grom_link_request'
                    })
                )
                db.add(notification)
            else:
                # Scenario A: New parent - send email invitation
                parent_link_approved = False  # Requires parent to register and approve
                # Email invitation would be sent here (not implemented - requires email service)
            
            # Set default parental controls based on age
            if birthdate_parsed:
                today = date.today()
                age = today.year - birthdate_parsed.year - ((today.month, today.day) < (birthdate_parsed.month, birthdate_parsed.day))
                
                if age <= 12:
                    # Default: More restrictive for younger kids
                    parental_controls = {
                        "can_post": False,
                        "can_stream": False,
                        "can_message": False,
                        "can_comment": False,
                        "view_only": True
                    }
                else:
                    # 13-17: Less restrictive by default, parent can adjust
                    parental_controls = {
                        "can_post": False,
                        "can_stream": False,
                        "can_message": True,
                        "can_comment": True,
                        "view_only": False
                    }
            else:
                # Default restrictive if no birthdate
                parental_controls = {
                    "can_post": False,
                    "can_stream": False,
                    "can_message": False,
                    "can_comment": True,
                    "view_only": False
                }
        
        user_id = str(uuid.uuid4())
        
        # Determine subscription tier and routing based on role
        subscription_tier = None
        requires_subscription = False
        requires_onboarding = False
        redirect_path = "/feed"
        
        surfer_roles = [RoleEnum.GROM, RoleEnum.SURFER, RoleEnum.COMP_SURFER, RoleEnum.PRO]
        skip_sub_photographer = [RoleEnum.GROM_PARENT, RoleEnum.HOBBYIST]
        business_roles = [RoleEnum.SCHOOL, RoleEnum.COACH, RoleEnum.RESORT, RoleEnum.WAVE_POOL, RoleEnum.SHOP, RoleEnum.SHAPER, RoleEnum.DESTINATION]
        
        if role_enum in surfer_roles:
            requires_subscription = True
            redirect_path = "/surfer-subscription"
        elif role_enum == RoleEnum.PHOTOGRAPHER:
            requires_subscription = True
            redirect_path = "/photographer-subscription"
        elif role_enum == RoleEnum.APPROVED_PRO:
            requires_onboarding = True
            redirect_path = "/pro-onboarding"
        elif role_enum in skip_sub_photographer:
            subscription_tier = "free"
            redirect_path = "/feed"
        elif role_enum in business_roles:
            subscription_tier = "business"
            redirect_path = "/feed"
        
        # Determine elite_tier for competitive Groms
        elite_tier = None
        if role_enum == RoleEnum.GROM and data.grom_competes:
            elite_tier = "grom_rising"
        
        profile = Profile(
            user_id=user_id,
            email=data.email,
            password_hash=hash_password(data.password),
            full_name=data.full_name,
            username=username,  # Set username from validated input
            role=role_enum,
            subscription_tier=subscription_tier,
            elite_tier=elite_tier,  # Set for competitive Groms
            credit_balance=0.0,
            parent_id=parent_id,
            birthdate=birthdate_parsed,
            guardian_code=guardian_code,
            parent_link_approved=parent_link_approved,
            parental_controls=parental_controls,
            company_name=data.company_name if role_enum in business_roles else None,
            accepts_donations=role_enum == RoleEnum.HOBBYIST
        )
        
        db.add(profile)
        await db.flush()  # Get profile.id before creating verification request
        
        # ============ AUTO-CREATE VERIFICATION REQUEST FOR PRO ROLES ============
        # When someone signs up as APPROVED_PRO, auto-create a pending verification request
        if role_enum == RoleEnum.APPROVED_PRO:
            from models import VerificationRequest
            from services.admin_notifications import admin_notification_service
            
            verification_request = VerificationRequest(
                user_id=profile.id,
                verification_type='approved_pro_photographer',  # Must match admin_p1.py expectations
                status='pending',
                additional_notes=f"Auto-created during signup. Full name: {data.full_name}, Username: @{username}, Company: {data.company_name or 'N/A'}"
            )
            db.add(verification_request)
            await db.flush()  # Get verification_request.id
            
            # Send multi-channel admin notifications (in-app, email, push)
            await admin_notification_service.notify_new_pro_application(
                db=db,
                applicant_id=profile.id,
                applicant_name=data.full_name,
                applicant_username=username,
                applicant_email=data.email,
                company_name=data.company_name,
                verification_request_id=verification_request.id
            )
        
        await db.commit()
        await db.refresh(profile)
        
        return SignupResponse(
            id=profile.id,
            email=profile.email,
            role=profile.role.value,
            credit_balance=profile.credit_balance,
            subscription_tier=profile.subscription_tier,
            requires_subscription=requires_subscription,
            requires_onboarding=requires_onboarding,
            redirect_path=redirect_path
        )
    except HTTPException:
        await db.rollback()
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/auth/login")
async def login(data: LoginRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Profile).where(Profile.email == data.email))
    profile = result.scalar_one_or_none()
    
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")
    
    # Verify password (allow login if no password set for legacy accounts)
    if profile.password_hash:
        if not verify_password(data.password, profile.password_hash):
            raise HTTPException(status_code=401, detail="Invalid password")
    
    # Check if suspended
    if profile.is_suspended:
        raise HTTPException(status_code=403, detail="Account suspended")
    
    return ProfileResponse(
        id=profile.id,
        user_id=profile.user_id,
        email=profile.email,
        full_name=profile.full_name,
        username=profile.username,  # @username handle
        role=profile.role.value,
        subscription_tier=profile.subscription_tier,
        is_ad_supported=profile.is_ad_supported if profile.is_ad_supported is not None else True,
        credit_balance=profile.credit_balance or 0.0,
        bio=profile.bio,
        avatar_url=profile.avatar_url,
        is_verified=profile.is_verified or False,
        is_live=profile.is_live or False,
        is_private=profile.is_private or False,
        is_approved_pro=profile.is_approved_pro or False,
        is_admin=profile.is_admin or False,
        location=profile.location,
        company_name=profile.company_name,
        portfolio_url=profile.portfolio_url,
        instagram_url=profile.instagram_url,
        website_url=profile.website_url,
        hourly_rate=profile.hourly_rate,
        session_price=profile.session_price,
        accepts_donations=profile.accepts_donations or False,
        skill_level=profile.skill_level,
        stance=profile.stance,
        home_break=profile.home_break,
        surf_mode=profile.surf_mode or 'casual',
        is_grom_parent=profile.is_grom_parent or (profile.role == RoleEnum.GROM_PARENT),
        # Home/Pinned location for map centering
        home_latitude=profile.home_latitude,
        home_longitude=profile.home_longitude,
        home_location_name=profile.home_location_name,
        created_at=profile.created_at,
        # Grom-specific fields
        parent_id=profile.parent_id,
        parent_link_approved=profile.parent_link_approved,
        parental_controls=profile.parental_controls
    )



class HobbyistConversionRequest(BaseModel):
    tier_id: str  # tier_1 = free, tier_2 = basic
    origin_url: str

@router.post("/auth/convert-to-hobbyist")
async def convert_to_hobbyist(
    user_id: str,
    data: HobbyistConversionRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Convert a user (usually Photographer selecting $0) to Hobbyist role.
    
    Hobbyists:
    - Earn Gear Credits only (not withdrawable)
    - Have ad-supported experience (free tier) or ad-free (basic tier)
    - Can upload photos and contribute to community
    """
    result = await db.execute(select(Profile).where(Profile.id == user_id))
    profile = result.scalar_one_or_none()
    
    if not profile:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Determine tier and ad support
    if data.tier_id == "tier_1":
        # Free tier - ad supported
        profile.role = RoleEnum.HOBBYIST
        profile.subscription_tier = "free"
        profile.is_ad_supported = True
        profile.accepts_donations = True
        
        await db.commit()
        await db.refresh(profile)
        
        return {
            "success": True,
            "role": "Hobbyist",
            "subscription_tier": "free",
            "is_ad_supported": True,
            "checkout_url": None  # No payment needed
        }
    
    elif data.tier_id == "tier_2":
        # Basic tier ($5) - ad free, needs Stripe checkout
        import os
        import stripe
        
        stripe.api_key = os.environ.get('STRIPE_API_KEY')
        
        # Create Stripe checkout session for Hobbyist Basic
        session = stripe.checkout.Session.create(
            payment_method_types=['card'],
            line_items=[{
                'price_data': {
                    'currency': 'usd',
                    'product_data': {
                        'name': 'Hobbyist Basic',
                        'description': 'Ad-free Hobbyist experience - Gear Credits only'
                    },
                    'unit_amount': 500,  # $5.00 in cents
                    'recurring': {'interval': 'month'}
                },
                'quantity': 1
            }],
            mode='subscription',
            success_url=f"{data.origin_url}/subscription-success?session_id={{CHECKOUT_SESSION_ID}}&tier=hobbyist_basic&role=hobbyist",
            cancel_url=f"{data.origin_url}/photographer-subscription",
            metadata={
                'user_id': user_id,
                'tier_id': 'hobbyist_basic',
                'role_conversion': 'hobbyist',
                'is_ad_supported': 'false'
            }
        )
        
        return {
            "success": True,
            "checkout_url": session.url
        }
    
    else:
        raise HTTPException(status_code=400, detail="Invalid tier_id")
