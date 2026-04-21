"""
Gear Hub API - Affiliate Equipment Store for Hobbyists

Hobbyists can only use their Gear Credits here to purchase equipment
through affiliate partners (B&H, Adorama).
"""

from fastapi import APIRouter, HTTPException, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone
import json

from database import get_db
from deps.admin_auth import get_current_admin
from models import (
    Profile, GearCatalog, GearPurchase, GearCategory, 
    Notification, RoleEnum
)
from utils.revenue_routing import is_hobbyist_creator, is_pro_creator

router = APIRouter(tags=["Gear Hub"])


# ============ PYDANTIC MODELS ============

class GearItemCreate(BaseModel):
    name: str
    description: Optional[str] = None
    image_url: Optional[str] = None
    category: str  # 'camera', 'lens', 'housing', etc.
    brand: Optional[str] = None
    price_credits: float
    retail_price_usd: Optional[float] = None
    affiliate_partner: str  # 'bh', 'adorama', 'amazon'
    affiliate_url: str
    affiliate_commission_rate: float = 0.05


class GearItemUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    image_url: Optional[str] = None
    price_credits: Optional[float] = None
    retail_price_usd: Optional[float] = None
    affiliate_url: Optional[str] = None
    is_active: Optional[bool] = None
    is_featured: Optional[bool] = None
    stock_status: Optional[str] = None


# ============ GEAR CATALOG ENDPOINTS ============

@router.get("/gear-hub")
async def get_gear_catalog(
    category: Optional[str] = None,
    featured_only: bool = False,
    search: Optional[str] = None,
    limit: int = Query(default=50, le=100),
    offset: int = 0,
    db: AsyncSession = Depends(get_db)
):
    """Get the gear catalog - available for all users to browse"""
    query = select(GearCatalog).where(GearCatalog.is_active == True)
    
    if category:
        try:
            cat_enum = GearCategory(category)
            query = query.where(GearCatalog.category == cat_enum)
        except ValueError:
            pass
    
    if featured_only:
        query = query.where(GearCatalog.is_featured == True)
    
    if search:
        query = query.where(
            GearCatalog.name.ilike(f"%{search}%") | 
            GearCatalog.brand.ilike(f"%{search}%")
        )
    
    query = query.order_by(GearCatalog.is_featured.desc(), GearCatalog.created_at.desc())
    query = query.offset(offset).limit(limit)
    
    result = await db.execute(query)
    items = result.scalars().all()
    
    return [{
        "id": item.id,
        "name": item.name,
        "description": item.description,
        "image_url": item.image_url,
        "category": item.category.value,
        "brand": item.brand,
        "price_credits": item.price_credits,
        "retail_price_usd": item.retail_price_usd,
        "affiliate_partner": item.affiliate_partner,
        "is_featured": item.is_featured,
        "stock_status": item.stock_status,
        "purchase_count": item.purchase_count
    } for item in items]


@router.get("/gear-hub/{item_id}")
async def get_gear_item(
    item_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get details of a single gear item"""
    result = await db.execute(
        select(GearCatalog).where(GearCatalog.id == item_id)
    )
    item = result.scalar_one_or_none()
    
    if not item:
        raise HTTPException(status_code=404, detail="Gear item not found")
    
    return {
        "id": item.id,
        "name": item.name,
        "description": item.description,
        "image_url": item.image_url,
        "category": item.category.value,
        "brand": item.brand,
        "price_credits": item.price_credits,
        "retail_price_usd": item.retail_price_usd,
        "affiliate_partner": item.affiliate_partner,
        "affiliate_url": item.affiliate_url,  # Only show in detail view
        "is_featured": item.is_featured,
        "stock_status": item.stock_status,
        "purchase_count": item.purchase_count
    }


@router.get("/gear-hub/user/{user_id}/progress")
async def get_gear_progress(
    user_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Get user's Gear Credits and progress toward gear items.
    Shows how close they are to affording featured items.
    """
    user_result = await db.execute(select(Profile).where(Profile.id == user_id))
    user = user_result.scalar_one_or_none()
    
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Get available gear credits
    if is_hobbyist_creator(user.role):
        available_credits = user.gear_only_credits
        can_purchase = True
    elif is_pro_creator(user.role):
        # Pros can also use gear credits if they have any
        available_credits = user.gear_only_credits
        can_purchase = True
    else:
        available_credits = 0
        can_purchase = False
    
    # Get featured items to show progress toward
    featured_result = await db.execute(
        select(GearCatalog)
        .where(GearCatalog.is_active == True)
        .where(GearCatalog.is_featured == True)
        .limit(5)
    )
    featured_items = featured_result.scalars().all()
    
    progress_items = []
    for item in featured_items:
        progress_pct = min(100, (available_credits / item.price_credits) * 100) if item.price_credits > 0 else 0
        credits_needed = max(0, item.price_credits - available_credits)
        
        progress_items.append({
            "id": item.id,
            "name": item.name,
            "image_url": item.image_url,
            "category": item.category.value,
            "price_credits": item.price_credits,
            "progress_percentage": round(progress_pct, 1),
            "credits_needed": credits_needed,
            "can_afford": available_credits >= item.price_credits
        })
    
    return {
        "available_credits": available_credits,
        "can_purchase": can_purchase,
        "is_hobbyist": is_hobbyist_creator(user.role),
        "progress_items": progress_items
    }


@router.post("/gear-hub/{item_id}/purchase")
async def purchase_gear_with_credits(
    item_id: str,
    user_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Purchase gear using Gear Credits.
    - Deducts credits from user's gear_only_credits
    - Records the purchase
    - Returns affiliate link for user to complete purchase
    """
    # Get user
    user_result = await db.execute(select(Profile).where(Profile.id == user_id))
    user = user_result.scalar_one_or_none()
    
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Get gear item
    item_result = await db.execute(select(GearCatalog).where(GearCatalog.id == item_id))
    item = item_result.scalar_one_or_none()
    
    if not item:
        raise HTTPException(status_code=404, detail="Gear item not found")
    
    if not item.is_active:
        raise HTTPException(status_code=400, detail="This item is no longer available")
    
    # Check credits
    available_credits = user.gear_only_credits if is_hobbyist_creator(user.role) or is_pro_creator(user.role) else 0
    
    if available_credits < item.price_credits:
        raise HTTPException(
            status_code=400, 
            detail=f"Insufficient Gear Credits. You have {available_credits}, need {item.price_credits}"
        )
    
    # Deduct credits
    user.gear_only_credits -= item.price_credits
    if is_hobbyist_creator(user.role):
        user.credit_balance = user.gear_only_credits
    
    # Create purchase record
    purchase = GearPurchase(
        user_id=user_id,
        gear_item_id=item_id,
        credits_spent=item.price_credits,
        affiliate_url_used=item.affiliate_url,
        affiliate_partner=item.affiliate_partner,
        status='clicked'
    )
    db.add(purchase)
    
    # Update item stats
    item.purchase_count += 1
    
    # Send notification
    notification = Notification(
        user_id=user_id,
        type='gear_purchase',
        title='Gear Purchase Initiated! 📷',
        body=f'Complete your purchase of {item.name} at {item.affiliate_partner.upper()}',
        data=json.dumps({
            "purchase_id": purchase.id,
            "item_name": item.name,
            "affiliate_url": item.affiliate_url,
            "affiliate_partner": item.affiliate_partner
        })
    )
    db.add(notification)
    
    await db.commit()
    
    return {
        "success": True,
        "message": f"Credits redeemed! Complete your purchase at {item.affiliate_partner.upper()}",
        "purchase_id": purchase.id,
        "affiliate_url": item.affiliate_url,
        "affiliate_partner": item.affiliate_partner,
        "credits_spent": item.price_credits,
        "remaining_credits": user.gear_only_credits,
        "item_name": item.name
    }


@router.get("/gear-hub/user/{user_id}/purchases")
async def get_user_gear_purchases(
    user_id: str,
    limit: int = Query(default=20, le=50),
    db: AsyncSession = Depends(get_db)
):
    """Get user's gear purchase history"""
    result = await db.execute(
        select(GearPurchase)
        .where(GearPurchase.user_id == user_id)
        .options(selectinload(GearPurchase.gear_item))
        .order_by(GearPurchase.created_at.desc())
        .limit(limit)
    )
    purchases = result.scalars().all()
    
    return [{
        "id": p.id,
        "item_name": p.gear_item.name if p.gear_item else "Unknown Item",
        "item_image": p.gear_item.image_url if p.gear_item else None,
        "credits_spent": p.credits_spent,
        "affiliate_partner": p.affiliate_partner,
        "status": p.status,
        "created_at": p.created_at.isoformat()
    } for p in purchases]


# ============ ADMIN ENDPOINTS ============

@router.post("/gear-hub/admin/items")
async def create_gear_item(
    data: GearItemCreate,
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """Admin: Create a new gear catalog item"""
    
    try:
        category = GearCategory(data.category)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid category. Must be one of: {[c.value for c in GearCategory]}")
    
    item = GearCatalog(
        name=data.name,
        description=data.description,
        image_url=data.image_url,
        category=category,
        brand=data.brand,
        price_credits=data.price_credits,
        retail_price_usd=data.retail_price_usd,
        affiliate_partner=data.affiliate_partner,
        affiliate_url=data.affiliate_url,
        affiliate_commission_rate=data.affiliate_commission_rate
    )
    
    db.add(item)
    await db.commit()
    await db.refresh(item)
    
    return {
        "id": item.id,
        "name": item.name,
        "message": "Gear item created successfully"
    }


@router.put("/gear-hub/admin/items/{item_id}")
async def update_gear_item(
    item_id: str,
    data: GearItemUpdate,
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """Admin: Update a gear catalog item"""
    
    result = await db.execute(select(GearCatalog).where(GearCatalog.id == item_id))
    item = result.scalar_one_or_none()
    
    if not item:
        raise HTTPException(status_code=404, detail="Gear item not found")
    
    # Update fields
    for field, value in data.dict(exclude_unset=True).items():
        setattr(item, field, value)
    
    await db.commit()
    
    return {"message": "Gear item updated", "id": item_id}


# ============ SEED DATA ENDPOINT ============

@router.post("/gear-hub/seed")
async def seed_gear_catalog(db: AsyncSession = Depends(get_db)):
    """Seed the gear catalog with sample items (for demo purposes)"""
    
    sample_items = [
        # Cameras
        {
            "name": "Sony A7 IV Mirrorless Camera",
            "description": "Full-frame 33MP sensor, perfect for surf photography",
            "category": GearCategory.CAMERA,
            "brand": "Sony",
            "price_credits": 2500,
            "retail_price_usd": 2498,
            "affiliate_partner": "bh",
            "affiliate_url": "https://www.bhphotovideo.com/c/product/1664657-REG/sony_ilce7m4_b_alpha_a7_iv_mirrorless.html?ap=y",
            "is_featured": True
        },
        {
            "name": "Canon EOS R6 Mark II",
            "description": "24.2MP full-frame, excellent for action shots",
            "category": GearCategory.CAMERA,
            "brand": "Canon",
            "price_credits": 2300,
            "retail_price_usd": 2299,
            "affiliate_partner": "adorama",
            "affiliate_url": "https://www.adorama.com/car6m2.html",
            "is_featured": True
        },
        # Lenses
        {
            "name": "Sony 70-200mm f/2.8 GM II",
            "description": "The ultimate surf photography lens",
            "category": GearCategory.LENS,
            "brand": "Sony",
            "price_credits": 2800,
            "retail_price_usd": 2798,
            "affiliate_partner": "bh",
            "affiliate_url": "https://www.bhphotovideo.com/c/product/1680839-REG/sony_sel70200gm2_fe_70_200mm_f_2_8_gm.html?ap=y",
            "is_featured": True
        },
        {
            "name": "Canon RF 100-500mm f/4.5-7.1L",
            "description": "Super telephoto for distant breaks",
            "category": GearCategory.LENS,
            "brand": "Canon",
            "price_credits": 2700,
            "retail_price_usd": 2699,
            "affiliate_partner": "adorama",
            "affiliate_url": "https://www.adorama.com/carf100500.html"
        },
        # Housing
        {
            "name": "Aquatech Elite II Sport Housing",
            "description": "Water housing for Sony A7 series",
            "category": GearCategory.HOUSING,
            "brand": "Aquatech",
            "price_credits": 1800,
            "retail_price_usd": 1795,
            "affiliate_partner": "bh",
            "affiliate_url": "https://www.bhphotovideo.com/c/search?q=aquatech%20elite&ap=y"
        },
        # Drones
        {
            "name": "DJI Mini 4 Pro",
            "description": "Compact drone perfect for aerial surf shots",
            "category": GearCategory.DRONE,
            "brand": "DJI",
            "price_credits": 800,
            "retail_price_usd": 799,
            "affiliate_partner": "bh",
            "affiliate_url": "https://www.bhphotovideo.com/c/product/1786310-REG/dji_cp_ma_00000731_01_mini_4_pro_fly.html?ap=y",
            "is_featured": True
        },
        # Surfboards
        {
            "name": "Firewire Seaside",
            "description": "High-performance shortboard by Machado",
            "category": GearCategory.SURFBOARD,
            "brand": "Firewire",
            "price_credits": 700,
            "retail_price_usd": 699,
            "affiliate_partner": "bh",
            "affiliate_url": "https://www.bhphotovideo.com"  # Placeholder
        },
        # Wetsuits
        {
            "name": "O'Neill Hyperfreak 4/3mm",
            "description": "Premium wetsuit for cold water surfing",
            "category": GearCategory.WETSUIT,
            "brand": "O'Neill",
            "price_credits": 400,
            "retail_price_usd": 399,
            "affiliate_partner": "bh",
            "affiliate_url": "https://www.bhphotovideo.com"  # Placeholder
        },
        # Accessories
        {
            "name": "Peak Design Camera Clip",
            "description": "Quick-release camera clip for on-the-go",
            "category": GearCategory.ACCESSORIES,
            "brand": "Peak Design",
            "price_credits": 80,
            "retail_price_usd": 79.95,
            "affiliate_partner": "bh",
            "affiliate_url": "https://www.bhphotovideo.com/c/product/1563778-REG/peak_design_cc_bk_3_capture_v3_camera_clip.html?ap=y"
        }
    ]
    
    created = 0
    for item_data in sample_items:
        # Check if already exists
        existing = await db.execute(
            select(GearCatalog).where(GearCatalog.name == item_data["name"])
        )
        if existing.scalar_one_or_none():
            continue
        
        item = GearCatalog(**item_data)
        db.add(item)
        created += 1
    
    await db.commit()
    
    return {"message": f"Created {created} gear items", "total_created": created}
