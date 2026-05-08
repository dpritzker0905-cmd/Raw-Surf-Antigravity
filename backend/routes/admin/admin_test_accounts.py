"""
Admin Test Account Seeding — create, list, and cleanup QA test accounts.

Extracted from p1.py (v87) to keep modules under 800 LOC.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, desc
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone, timedelta

from database import get_db
from deps.admin_auth import get_current_admin
from models import Profile, UserActivityLog, RoleEnum
from .moderation import log_audit

router = APIRouter()


# ============ HELPER: Log User Activity ============

async def log_user_activity(
    db: AsyncSession,
    user_id: str,
    activity_type: str,
    category: str,
    description: str,
    related_type: str = None,
    related_id: str = None,
    ip_address: str = None,
    extra_data: dict = None
):
    """Helper function to log user activity for journey tracking"""
    activity = UserActivityLog(
        user_id=user_id,
        activity_type=activity_type,
        activity_category=category,
        description=description,
        related_type=related_type,
        related_id=related_id,
        ip_address=ip_address,
        extra_data=extra_data or {}
    )
    db.add(activity)
    return activity


# ============ TEST ACCOUNT SEEDING ============

class TestAccountConfig(BaseModel):
    """Configuration for creating a test account"""
    role: str = "Surfer"  # Surfer, Photographer, Grom, Business, GromParent
    username_prefix: str = "test"
    with_content: bool = False  # Create with sample posts/gallery items
    subscription_tier: Optional[str] = None
    elite_tier: Optional[str] = None
    is_verified: bool = False
    is_approved_pro: bool = False
    custom_password: Optional[str] = None

class SeedTestAccountsRequest(BaseModel):
    """Request to seed multiple test accounts"""
    accounts: List[TestAccountConfig] = []
    seed_all_roles: bool = False  # Create one of each role type
    password: str = "Test123!"  # Default password for all accounts

@router.post("/admin/seed-test-accounts")
async def seed_test_accounts(
    request: SeedTestAccountsRequest,
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    Create test accounts for QA/testing purposes.
    
    - seed_all_roles=True: Creates one account for each role type
    - accounts: Specific account configurations
    
    All accounts use the same password (default: Test123!)
    """
    # Verify admin
    
    import hashlib
    import uuid
    
    def generate_uuid():
        return str(uuid.uuid4())
    
    def hash_password(password: str) -> str:
        return hashlib.sha256(password.encode()).hexdigest()
    
    created_accounts = []
    password = request.password
    password_hash = hash_password(password)
    
    # Define role configurations
    role_configs = {
        "Surfer": {
            "role": RoleEnum.SURFER,
            "full_name": "Test Surfer",
            "bio": "Test surfer account for QA",
            "skill_level": "intermediate",
            "stance": "regular"
        },
        "Photographer": {
            "role": RoleEnum.PHOTOGRAPHER,
            "full_name": "Test Photographer", 
            "bio": "Test photographer account for QA",
            "is_approved_pro": False,
            "hourly_rate": 75.0
        },
        "Approved Pro": {
            "role": RoleEnum.PHOTOGRAPHER,
            "full_name": "Test Pro Photographer",
            "bio": "Test approved pro photographer for QA",
            "is_approved_pro": True,
            "is_verified": True,
            "hourly_rate": 150.0
        },
        "Grom": {
            "role": RoleEnum.GROM,
            "full_name": "Test Grom",
            "bio": "Test grom account for QA",
            "skill_level": "beginner"
        },
        "GromParent": {
            "role": RoleEnum.GROM_PARENT,
            "full_name": "Test Grom Parent",
            "bio": "Test grom parent account for QA"
        },
        "Competitive Surfer": {
            "role": RoleEnum.COMP_SURFER,
            "full_name": "Test Comp Surfer",
            "bio": "Test competitive surfer for QA",
            "skill_level": "advanced",
            "elite_tier": "competitive",
            "is_verified": True
        }
    }
    
    accounts_to_create = []
    
    if request.seed_all_roles:
        # Create one of each role type
        for role_name in role_configs.keys():
            accounts_to_create.append(TestAccountConfig(
                role=role_name,
                username_prefix="test"
            ))
    else:
        accounts_to_create = request.accounts
    
    # Generate unique timestamp suffix
    timestamp_suffix = datetime.now().strftime("%H%M%S")
    
    for idx, config in enumerate(accounts_to_create):
        role_name = config.role
        if role_name not in role_configs:
            # Default to Surfer if unknown role
            role_name = "Surfer"
        
        role_config = role_configs[role_name]
        
        # Generate unique identifiers
        username = f"{config.username_prefix}_{role_name.lower().replace(' ', '_')}_{timestamp_suffix}"
        email = f"{username}@test.rawsurf.io"
        user_id = generate_uuid()
        profile_id = generate_uuid()
        
        # Check if email already exists
        existing = await db.execute(
            select(Profile).where(Profile.email == email)
        )
        if existing.scalar_one_or_none():
            # Skip if already exists
            continue
        
        # Create profile
        profile = Profile(
            id=profile_id,
            user_id=user_id,
            email=email,
            password_hash=password_hash,
            full_name=role_config.get("full_name", f"Test {role_name}"),
            username=username[:30],  # Truncate to fit column limit
            role=role_config["role"],
            bio=role_config.get("bio", f"Test {role_name} account"),
            skill_level=role_config.get("skill_level"),
            stance=role_config.get("stance"),
            company_name=role_config.get("company_name"),
            hourly_rate=role_config.get("hourly_rate"),
            is_verified=config.is_verified or role_config.get("is_verified", False),
            is_approved_pro=config.is_approved_pro or role_config.get("is_approved_pro", False),
            subscription_tier=config.subscription_tier,
            elite_tier=config.elite_tier or role_config.get("elite_tier"),
            credit_balance=100.0,  # Give some test credits
            created_at=datetime.now(timezone.utc)
        )
        
        db.add(profile)
        
        created_accounts.append({
            "id": profile_id,
            "email": email,
            "username": username,
            "password": config.custom_password or password,
            "role": role_name,
            "full_name": profile.full_name,
            "is_verified": profile.is_verified,
            "is_approved_pro": profile.is_approved_pro
        })
    
    await db.commit()
    
    # Log the action
    await log_audit(
        db, admin.id, "system", "seed_test_accounts",
        f"Created {len(created_accounts)} test accounts",
        "test_accounts", "system", None,
        new_value={"accounts_created": len(created_accounts), "roles": [a["role"] for a in created_accounts]}
    )
    
    return {
        "success": True,
        "message": f"Created {len(created_accounts)} test accounts",
        "accounts": created_accounts,
        "default_password": password
    }


@router.get("/admin/test-accounts")
async def list_test_accounts(
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """List all test accounts (accounts with @test.rawsurf.io email)"""
    
    result = await db.execute(
        select(Profile)
        .where(Profile.email.like('%@test.rawsurf.io'))
        .order_by(desc(Profile.created_at))
        .limit(100)
    )
    accounts = result.scalars().all()
    
    return {
        "total": len(accounts),
        "accounts": [
            {
                "id": a.id,
                "email": a.email,
                "username": a.username,
                "full_name": a.full_name,
                "role": a.role.value if a.role else None,
                "is_verified": a.is_verified,
                "is_approved_pro": a.is_approved_pro,
                "created_at": a.created_at.isoformat() if a.created_at else None
            }
            for a in accounts
        ]
    }


@router.delete("/admin/test-accounts/cleanup")
async def cleanup_test_accounts(
    admin: Profile = Depends(get_current_admin),
    older_than_days: int = 7,
    db: AsyncSession = Depends(get_db)
):
    """Delete test accounts older than specified days"""
    
    cutoff_date = datetime.now(timezone.utc) - timedelta(days=older_than_days)
    
    result = await db.execute(
        select(Profile)
        .where(
            and_(
                Profile.email.like('%@test.rawsurf.io'),
                Profile.created_at < cutoff_date
            )
        )
    )
    accounts_to_delete = result.scalars().all()
    
    deleted_count = 0
    for account in accounts_to_delete:
        await db.delete(account)
        deleted_count += 1
    
    await db.commit()
    
    await log_audit(
        db, admin.id, "system", "cleanup_test_accounts",
        f"Deleted {deleted_count} test accounts older than {older_than_days} days",
        "test_accounts", "system", None
    )
    
    return {
        "success": True,
        "message": f"Deleted {deleted_count} test accounts older than {older_than_days} days"
    }

