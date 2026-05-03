"""
Gallery sales dashboards, bulk purchase, quality previews.

Part of the gallery package — extracted from the gallery.py monolith.
"""
from fastapi import APIRouter, Depends, HTTPException, Body, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, case
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone, timedelta
import json
import uuid
import logging

gallery_logger = logging.getLogger("routes.gallery")

from database import get_db
from models import (
    Profile, SurfSpot, GalleryItem, GalleryPurchase, Notification,
    RoleEnum, Gallery, LiveSession, LiveSessionParticipant,
    XPTransaction, SurferGalleryItem, SurferSelectionQuota,
    GalleryTierEnum, Booking, BookingParticipant, DispatchRequest,
    ConditionReport
)

from routes.career_hub.gamification import check_badge_milestones
from services.gallery_sync import (
    distribute_gallery_item_to_participants,
    manually_assign_item_to_surfer,
    safe_delete_gallery_item
)
from websocket_manager import broadcast_earnings_update
from services.watermark import watermark_image_from_url, generate_watermarked_preview
from utils.grom_parent import is_grom_parent_eligible

from .schemas import (
    GalleryItemCreate, GalleryItemUpdate, GalleryItemResponse,
    PurchaseRequest, GalleryCreate, GalleryUpdate,
    get_quality_price
)
from models import CreditTransaction

router = APIRouter()

@router.get("/galleries/{gallery_id}/sales-dashboard")
async def get_gallery_sales_dashboard(
    gallery_id: str,
    photographer_id: str,
    limit: int = 50,
    offset: int = 0,
    db: AsyncSession = Depends(get_db)
):
    """
    Get detailed sales data for a gallery.
    Returns: purchases with buyer info, quality tier, date, amount
    """
    # Verify ownership
    gallery = await db.execute(
        select(Gallery).where(Gallery.id == gallery_id).where(Gallery.photographer_id == photographer_id)
    )
    gallery = gallery.scalar_one_or_none()
    if not gallery:
        raise HTTPException(status_code=404, detail="Gallery not found")
    
    # Get all purchases for items in this gallery
    purchases_result = await db.execute(
        select(GalleryPurchase, GalleryItem, Profile)
        .join(GalleryItem, GalleryPurchase.gallery_item_id == GalleryItem.id)
        .join(Profile, GalleryPurchase.buyer_id == Profile.id)
        .where(GalleryItem.gallery_id == gallery_id)
        .order_by(GalleryPurchase.purchased_at.desc())
        .offset(offset)
        .limit(limit)
    )
    purchases = purchases_result.fetchall()
    
    # Get total revenue
    revenue_result = await db.execute(
        select(func.sum(GalleryPurchase.amount_paid))
        .join(GalleryItem, GalleryPurchase.gallery_item_id == GalleryItem.id)
        .where(GalleryItem.gallery_id == gallery_id)
    )
    total_revenue = revenue_result.scalar() or 0
    
    # Get total purchase count
    count_result = await db.execute(
        select(func.count())
        .select_from(GalleryPurchase)
        .join(GalleryItem, GalleryPurchase.gallery_item_id == GalleryItem.id)
        .where(GalleryItem.gallery_id == gallery_id)
    )
    total_purchases = count_result.scalar() or 0
    
    # Format response
    sales = []
    for purchase, item, buyer in purchases:
        sales.append({
            "id": str(purchase.id),
            "item_id": str(item.id),
            "item_thumbnail": item.thumbnail_url,
            "item_title": item.title,
            "buyer_id": str(buyer.id),
            "buyer_name": buyer.full_name,
            "buyer_avatar": buyer.avatar_url,
            "quality_tier": purchase.quality_tier,
            "amount": float(purchase.amount_paid),
            "purchased_at": purchase.purchased_at.isoformat() if purchase.purchased_at else None
        })
    
    return {
        "sales": sales,
        "stats": {
            "total_revenue": float(total_revenue),
            "total_purchases": total_purchases,
            "avg_sale": float(total_revenue / total_purchases) if total_purchases > 0 else 0
        },
        "pagination": {
            "offset": offset,
            "limit": limit,
            "has_more": len(sales) == limit
        }
    }


@router.get("/galleries/{gallery_id}/client-activity")
async def get_gallery_client_activity(
    gallery_id: str,
    photographer_id: str,
    limit: int = 50,
    db: AsyncSession = Depends(get_db)
):
    """
    Get client activity data for a gallery.
    Returns: unique viewers, who favorited items, recent activity
    """
    # Verify ownership
    gallery = await db.execute(
        select(Gallery).where(Gallery.id == gallery_id).where(Gallery.photographer_id == photographer_id)
    )
    gallery = gallery.scalar_one_or_none()
    if not gallery:
        raise HTTPException(status_code=404, detail="Gallery not found")
    
    # Get all gallery item IDs
    items_result = await db.execute(
        select(GalleryItem.id).where(GalleryItem.gallery_id == gallery_id)
    )
    item_ids = [row[0] for row in items_result.fetchall()]
    
    if not item_ids:
        return {
            "clients": [],
            "stats": {"unique_viewers": 0, "total_favorites": 0, "total_purchases": 0}
        }
    
    # Get surfer gallery items that reference these gallery items (viewers/buyers)
    surfer_items_result = await db.execute(
        select(SurferGalleryItem, Profile)
        .join(Profile, SurferGalleryItem.surfer_id == Profile.id)
        .where(SurferGalleryItem.gallery_item_id.in_(item_ids))
        .limit(limit)
    )
    surfer_items = surfer_items_result.fetchall()
    
    # Aggregate by client
    client_map = {}
    for sgi, profile in surfer_items:
        client_id = str(profile.id)
        if client_id not in client_map:
            client_map[client_id] = {
                "id": client_id,
                "name": profile.full_name,
                "avatar": profile.avatar_url,
                "items_count": 0,
                "favorites_count": 0,
                "purchased_count": 0,
                "last_activity": None
            }
        
        client_map[client_id]["items_count"] += 1
        if sgi.is_favorite:
            client_map[client_id]["favorites_count"] += 1
        if sgi.is_paid:
            client_map[client_id]["purchased_count"] += 1
        
        # Use paid_at as last activity indicator
        if sgi.paid_at:
            paid_at_str = sgi.paid_at.isoformat()
            if not client_map[client_id]["last_activity"] or paid_at_str > client_map[client_id]["last_activity"]:
                client_map[client_id]["last_activity"] = paid_at_str
    
    # Sort by activity
    clients = sorted(client_map.values(), key=lambda x: x["last_activity"] or "", reverse=True)
    
    # Calculate stats
    total_favorites = sum(c["favorites_count"] for c in clients)
    total_purchases = sum(c["purchased_count"] for c in clients)
    
    return {
        "clients": clients,
        "stats": {
            "unique_viewers": len(clients),
            "total_favorites": total_favorites,
            "total_purchases": total_purchases
        }
    }


@router.get("/photographer/{photographer_id}/sales-summary")
async def get_photographer_sales_summary(
    photographer_id: str,
    days: int = 30,
    db: AsyncSession = Depends(get_db)
):
    """
    Get overall sales summary for a photographer across all galleries.
    """
    # Verify photographer exists
    photographer = await db.execute(
        select(Profile).where(Profile.id == photographer_id)
    )
    photographer = photographer.scalar_one_or_none()
    if not photographer:
        raise HTTPException(status_code=404, detail="Photographer not found")
    
    # Get sales from the last N days
    since_date = datetime.now(timezone.utc) - timedelta(days=days)
    
    # Total revenue
    revenue_result = await db.execute(
        select(func.sum(GalleryPurchase.amount_paid))
        .join(GalleryItem, GalleryPurchase.gallery_item_id == GalleryItem.id)
        .where(GalleryItem.photographer_id == photographer_id)
        .where(GalleryPurchase.purchased_at >= since_date)
    )
    period_revenue = revenue_result.scalar() or 0
    
    # All-time revenue
    all_time_result = await db.execute(
        select(func.sum(GalleryPurchase.amount_paid))
        .join(GalleryItem, GalleryPurchase.gallery_item_id == GalleryItem.id)
        .where(GalleryItem.photographer_id == photographer_id)
    )
    all_time_revenue = all_time_result.scalar() or 0
    
    # Purchase count for period
    count_result = await db.execute(
        select(func.count())
        .select_from(GalleryPurchase)
        .join(GalleryItem, GalleryPurchase.gallery_item_id == GalleryItem.id)
        .where(GalleryItem.photographer_id == photographer_id)
        .where(GalleryPurchase.purchased_at >= since_date)
    )
    period_purchases = count_result.scalar() or 0
    
    # Top selling items
    top_items_result = await db.execute(
        select(GalleryItem, func.count(GalleryPurchase.id).label('sales'))
        .join(GalleryPurchase, GalleryItem.id == GalleryPurchase.gallery_item_id)
        .where(GalleryItem.photographer_id == photographer_id)
        .group_by(GalleryItem.id)
        .order_by(func.count(GalleryPurchase.id).desc())
        .limit(5)
    )
    top_items = [
        {
            "id": str(item.id),
            "title": item.title,
            "thumbnail": item.thumbnail_url,
            "sales_count": sales
        }
        for item, sales in top_items_result.fetchall()
    ]
    
    return {
        "period_days": days,
        "period_revenue": float(period_revenue),
        "period_purchases": period_purchases,
        "all_time_revenue": float(all_time_revenue),
        "avg_sale_value": float(period_revenue / period_purchases) if period_purchases > 0 else 0,
        "top_items": top_items
    }



# ===================== TICKET-005: Bulk Purchase Endpoint =====================

class BulkPurchaseRequest(BaseModel):
    item_ids: List[str]
    quality_tiers: dict  # {item_id: tier_name}
    buyer_id: str


# Default discount tiers (can be overridden by photographer settings)
DEFAULT_DISCOUNT_TIERS = [
    {"min_items": 3, "discount": 0.10},
    {"min_items": 5, "discount": 0.15},
    {"min_items": 10, "discount": 0.20}
]


def calculate_bulk_discount(item_count: int, tiers: list = None) -> float:
    """Calculate discount percentage based on item count"""
    if tiers is None:
        tiers = DEFAULT_DISCOUNT_TIERS
    
    # Sort by min_items descending
    sorted_tiers = sorted(tiers, key=lambda x: x.get("min_items", 0), reverse=True)
    
    for tier in sorted_tiers:
        if item_count >= tier.get("min_items", 0):
            return tier.get("discount", 0)
    
    return 0


@router.post("/gallery/bulk-purchase")
async def bulk_purchase_items(
    data: BulkPurchaseRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Purchase multiple gallery items at once with volume discount.
    
    Discount tiers:
    - 3+ items: 10% off
    - 5+ items: 15% off
    - 10+ items: 20% off
    
    Atomic transaction: all items succeed or none.
    """
    from models import CreditTransaction
    
    if not data.item_ids:
        raise HTTPException(status_code=400, detail="No items selected")
    
    # Get buyer
    buyer_result = await db.execute(
        select(Profile).where(Profile.id == data.buyer_id)
    )
    buyer = buyer_result.scalar_one_or_none()
    
    if not buyer:
        raise HTTPException(status_code=404, detail="Buyer not found")
    
    # Get all items
    items_result = await db.execute(
        select(GalleryItem)
        .where(GalleryItem.id.in_(data.item_ids))
        .options(selectinload(GalleryItem.photographer))
    )
    items = items_result.scalars().all()
    
    if len(items) != len(data.item_ids):
        found_ids = {item.id for item in items}
        missing = [id for id in data.item_ids if id not in found_ids]
        raise HTTPException(status_code=404, detail=f"Items not found: {missing}")
    
    # Check if any already purchased
    for item in items:
        existing = await db.execute(
            select(GalleryPurchase)
            .where(
                GalleryPurchase.item_id == item.id,
                GalleryPurchase.buyer_id == data.buyer_id
            )
        )
        if existing.scalar_one_or_none():
            raise HTTPException(
                status_code=400, 
                detail=f"Item already purchased: {item.title or item.id[:8]}"
            )
    
    # Calculate base total
    base_total = 0
    item_prices = {}
    
    for item in items:
        # Get tier price
        tier = data.quality_tiers.get(item.id, 'standard')
        
        if item.media_type == 'video':
            tier_prices = {
                '720p': item.price_720p or 8,
                '1080p': item.price_1080p or 15,
                '4k': item.price_4k or 30
            }
        else:
            tier_prices = {
                'web': item.price_web or 3,
                'standard': item.price_standard or item.price or 5,
                'high': item.price_high or 10
            }
        
        price = tier_prices.get(tier, item.price or 5)
        
        # Apply custom price if set
        if item.custom_price is not None:
            price = item.custom_price
        
        item_prices[item.id] = {
            "price": price,
            "tier": tier,
            "photographer_id": item.photographer_id
        }
        base_total += price
    
    # Calculate discount
    discount_rate = calculate_bulk_discount(len(items))
    discount_amount = base_total * discount_rate
    final_total = base_total - discount_amount
    
    # Check buyer credits
    if (buyer.credit_balance or 0) < final_total:
        raise HTTPException(
            status_code=400,
            detail=f"Insufficient credits. Need ${final_total:.2f}, have ${buyer.credit_balance or 0:.2f}"
        )
    
    # Atomic transaction
    try:
        # Deduct buyer credits
        buyer.credit_balance = (buyer.credit_balance or 0) - final_total
        
        # Create purchases and credit photographers
        purchases = []
        photographer_earnings = {}  # {photographer_id: total_earnings}
        
        for item in items:
            item_info = item_prices[item.id]
            price = item_info["price"]
            tier = item_info["tier"]
            photographer_id = item_info["photographer_id"]
            
            # Calculate photographer share (80%)
            photographer_share = price * 0.8
            
            # Create purchase record
            purchase = GalleryPurchase(
                id=str(uuid.uuid4()),
                item_id=item.id,
                buyer_id=data.buyer_id,
                photographer_id=photographer_id,
                price_paid=price,
                quality_tier=tier,
                platform_fee=price * 0.2,
                photographer_earnings=photographer_share,
                purchased_at=datetime.now(timezone.utc)
            )
            db.add(purchase)
            purchases.append(purchase)
            
            # Track photographer earnings
            if photographer_id not in photographer_earnings:
                photographer_earnings[photographer_id] = 0
            photographer_earnings[photographer_id] += photographer_share
            
            # Update item stats
            item.purchase_count = (item.purchase_count or 0) + 1
        
        # Credit photographers
        for photographer_id, earnings in photographer_earnings.items():
            photographer = await db.execute(
                select(Profile).where(Profile.id == photographer_id)
            )
            photographer = photographer.scalar_one_or_none()
            
            if photographer:
                photographer.credit_balance = (photographer.credit_balance or 0) + earnings
                
                # Create credit transaction
                credit_tx = CreditTransaction(
                    user_id=photographer_id,
                    amount=earnings,
                    transaction_type='bulk_gallery_sale',
                    description=f"Bulk sale: {len([p for p in purchases if p.photographer_id == photographer_id])} items",
                    reference_type='bulk_purchase',
                    reference_id=purchases[0].id,  # Reference first purchase
                    balance_after=photographer.credit_balance
                )
                db.add(credit_tx)
                
                # Broadcast earnings update
                await broadcast_earnings_update(
                    photographer_id,
                    {
                        "type": "bulk_sale",
                        "amount": earnings,
                        "item_count": len([p for p in purchases if p.photographer_id == photographer_id]),
                        "buyer_name": buyer.full_name or buyer.username
                    }
                )
        
        # Create buyer credit transaction
        buyer_tx = CreditTransaction(
            user_id=data.buyer_id,
            amount=-final_total,
            transaction_type='bulk_purchase',
            description=f"Bulk purchase: {len(items)} items ({discount_rate * 100:.0f}% discount)",
            reference_type='bulk_purchase',
            reference_id=purchases[0].id,
            balance_after=buyer.credit_balance
        )
        db.add(buyer_tx)
        
        await db.commit()
        
        return {
            "success": True,
            "purchase_count": len(purchases),
            "base_total": base_total,
            "discount_rate": discount_rate,
            "discount_amount": discount_amount,
            "final_total": final_total,
            "new_balance": buyer.credit_balance,
            "purchases": [
                {
                    "item_id": p.item_id,
                    "tier": p.quality_tier,
                    "price": p.price_paid
                }
                for p in purchases
            ]
        }
        
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Bulk purchase failed: {str(e)}")


@router.get("/gallery/item/{item_id}/quality-previews")
async def get_quality_previews(
    item_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Get preview URLs at different quality tiers for comparison.
    Used by QualityComparisonModal (TICKET-004).
    """
    result = await db.execute(
        select(GalleryItem).where(GalleryItem.id == item_id)
    )
    item = result.scalar_one_or_none()
    
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    
    # Build preview URLs for each tier
    # Note: In production, these would be pre-generated scaled versions
    previews = {}
    
    if item.media_type == 'video':
        previews = {
            '720p': {
                'url': item.preview_url or item.original_url,
                'resolution': '1280x720',
                'file_size': '~50MB/min'
            },
            '1080p': {
                'url': item.original_url,
                'resolution': '1920x1080', 
                'file_size': '~150MB/min'
            },
            '4k': {
                'url': item.url_4k or item.original_url,
                'resolution': '3840x2160',
                'file_size': '~400MB/min'
            }
        }
    else:
        previews = {
            'web': {
                'url': item.url_web or item.thumbnail_url or item.preview_url,
                'dimensions': '800px max',
                'file_size': '~200KB'
            },
            'standard': {
                'url': item.url_standard or item.preview_url or item.original_url,
                'dimensions': '1920px max',
                'file_size': '~800KB'
            },
            'high': {
                'url': item.url_high or item.original_url,
                'dimensions': 'Full resolution',
                'file_size': '~2-5MB'
            }
        }
    
    return {
        "item_id": item_id,
        "media_type": item.media_type,
        "previews": previews
    }


# ============ OPERATIONAL ENDPOINTS ============
