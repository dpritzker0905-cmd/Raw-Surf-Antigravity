"""
Admin Analytics API - Platform Mission Control
Hard-locked to Admin UID only
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_, case, text
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from datetime import datetime, timezone, timedelta
from database import get_db
from models import (
    Profile, Booking, PaymentTransaction, CreditTransaction,
    SurfSpot, GalleryItem, Post, AdminLog, RoleEnum
)
import json

router = APIRouter()


async def require_admin(admin_id: str, db: AsyncSession) -> Profile:
    """Verify the requester is an admin"""
    result = await db.execute(
        select(Profile).where(Profile.id == admin_id)
    )
    admin = result.scalar_one_or_none()
    if not admin or not admin.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    return admin


# ============ FINANCIAL OVERSIGHT ============

@router.get("/admin/analytics/financial")
async def get_financial_analytics(
    admin_id: str,
    days: int = 30,
    db: AsyncSession = Depends(get_db)
):
    """
    Financial Oversight Dashboard - Sitewide metrics
    - Total Stoked Credits Liability
    - Revenue by subscription tier
    - Ad revenue tracking
    """
    await require_admin(admin_id, db)
    
    # 1. TOTAL STOKED CREDITS LIABILITY
    # Sum of all credits currently in user wallets
    liability_result = await db.execute(
        select(func.sum(Profile.credit_balance))
    )
    total_liability = liability_result.scalar() or 0
    
    # Credit distribution breakdown - simplified query
    credit_ranges = {
        "0": 0,
        "1-50": 0,
        "51-100": 0,
        "101-500": 0,
        "500+": 0
    }
    
    # Get all users with their credit balances
    all_balances = await db.execute(
        select(Profile.credit_balance)
    )
    
    for (balance,) in all_balances.fetchall():
        bal = balance or 0
        if bal == 0:
            credit_ranges["0"] += 1
        elif bal <= 50:
            credit_ranges["1-50"] += 1
        elif bal <= 100:
            credit_ranges["51-100"] += 1
        elif bal <= 500:
            credit_ranges["101-500"] += 1
        else:
            credit_ranges["500+"] += 1
    
    # 2. REVENUE VELOCITY - Time series by subscription tier
    start_date = datetime.now(timezone.utc) - timedelta(days=days)
    
    # Get subscription payments grouped by day and tier
    subscription_revenue = await db.execute(
        select(
            func.date(PaymentTransaction.created_at).label('date'),
            PaymentTransaction.transaction_metadata,
            func.sum(PaymentTransaction.amount).label('total')
        )
        .where(PaymentTransaction.payment_status == 'completed')
        .where(PaymentTransaction.created_at >= start_date)
        .group_by(func.date(PaymentTransaction.created_at), PaymentTransaction.transaction_metadata)
    )
    
    # Process into time series format
    revenue_by_tier = {
        "tier_1": [],  # $3 Free (no payments)
        "tier_2": [],  # $5 Basic
        "tier_3": [],  # $8-10 Premium
        "photographer_basic": [],  # $18
        "photographer_premium": [],  # $30
    }
    
    revenue_dates = {}
    for row in subscription_revenue.fetchall():
        date_str = row.date.isoformat() if row.date else None
        if not date_str:
            continue
        if date_str not in revenue_dates:
            revenue_dates[date_str] = {"tier_2": 0, "tier_3": 0, "photographer_basic": 0, "photographer_premium": 0}
        
        # Extract tier from metadata if available
        try:
            meta = json.loads(row.transaction_metadata) if row.transaction_metadata else {}
            tier = meta.get("tier_id", "unknown")
            if tier in revenue_dates[date_str]:
                revenue_dates[date_str][tier] += float(row.total or 0)
        except (json.JSONDecodeError, TypeError):
            pass
    
    # Format for charts
    for date_str in sorted(revenue_dates.keys()):
        for tier in revenue_by_tier:
            if tier != "tier_1":
                revenue_by_tier[tier].append({
                    "date": date_str,
                    "amount": revenue_dates.get(date_str, {}).get(tier, 0)
                })
    
    # 3. TOTAL REVENUE BREAKDOWN
    total_revenue_result = await db.execute(
        select(func.sum(PaymentTransaction.amount))
        .where(PaymentTransaction.payment_status == 'completed')
        .where(PaymentTransaction.created_at >= start_date)
    )
    total_revenue = total_revenue_result.scalar() or 0
    
    # Revenue breakdown (simplified - just total since model doesn't have payment_type)
    type_breakdown = {
        "all_payments": round(total_revenue, 2)
    }
    
    # 4. AD REVENUE (Credits spent on ads)
    ad_spend_result = await db.execute(
        select(func.sum(CreditTransaction.amount))
        .where(CreditTransaction.transaction_type == 'ad_purchase')
        .where(CreditTransaction.created_at >= start_date)
    )
    ad_revenue = abs(ad_spend_result.scalar() or 0)
    
    return {
        "total_credit_liability": round(total_liability, 2),
        "credit_distribution": credit_ranges,
        "revenue_velocity": revenue_by_tier,
        "total_revenue_period": round(total_revenue, 2),
        "revenue_by_type": type_breakdown,
        "ad_revenue": round(ad_revenue, 2),
        "period_days": days
    }


@router.get("/admin/analytics/ecosystem")
async def get_ecosystem_analytics(
    admin_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Ecosystem Health Dashboard
    - Role distribution ratios
    - Booking efficiency (On-Demand vs Scheduled)
    - Spot activity heatmap
    """
    await require_admin(admin_id, db)
    
    # 1. ROLE DISTRIBUTION with categorization
    role_counts = {}
    total_users = 0
    
    for role in RoleEnum:
        count_result = await db.execute(
            select(func.count(Profile.id)).where(Profile.role == role)
        )
        count = count_result.scalar() or 0
        role_counts[role.value] = count
        total_users += count
    
    # Categorize into Surfers, Working Pros, Hobbyists
    role_categories = {
        "surfers": role_counts.get("Surfer", 0) + role_counts.get("Comp Surfer", 0) + role_counts.get("Pro", 0) + role_counts.get("Grom", 0),
        "working_pros": role_counts.get("Photographer", 0) + role_counts.get("Approved Pro", 0) + role_counts.get("Coach", 0),
        "hobbyists": role_counts.get("Hobbyist", 0) + role_counts.get("Grom Parent", 0),
        "businesses": role_counts.get("Shop", 0) + role_counts.get("School", 0) + role_counts.get("Shaper", 0) + role_counts.get("Resort", 0) + role_counts.get("Wave Pool", 0) + role_counts.get("Destination", 0)
    }
    
    # Calculate ratios
    role_ratios = {}
    for category, count in role_categories.items():
        role_ratios[category] = {
            "count": count,
            "percentage": round((count / total_users * 100) if total_users > 0 else 0, 1)
        }
    
    # 2. BOOKING EFFICIENCY
    # On-Demand = request_pro bookings, Scheduled = regular bookings
    ondemand_count = await db.execute(
        select(func.count(Booking.id))
        .where(Booking.booking_type == 'request_pro')
    )
    scheduled_count = await db.execute(
        select(func.count(Booking.id))
        .where(or_(
            Booking.booking_type == 'scheduled',
            Booking.booking_type.is_(None)
        ))
    )
    
    ondemand = ondemand_count.scalar() or 0
    scheduled = scheduled_count.scalar() or 0
    total_bookings = ondemand + scheduled
    
    booking_efficiency = {
        "on_demand": {
            "count": ondemand,
            "percentage": round((ondemand / total_bookings * 100) if total_bookings > 0 else 0, 1)
        },
        "scheduled": {
            "count": scheduled,
            "percentage": round((scheduled / total_bookings * 100) if total_bookings > 0 else 0, 1)
        },
        "total": total_bookings
    }
    
    # 3. SPOT ACTIVITY HEATMAP
    # Get bookings by location with counts
    spot_activity = await db.execute(
        select(
            Booking.location,
            Booking.latitude,
            Booking.longitude,
            func.count(Booking.id).label('booking_count'),
            func.sum(Booking.total_price).label('total_revenue')
        )
        .where(Booking.location.isnot(None))
        .group_by(Booking.location, Booking.latitude, Booking.longitude)
        .order_by(func.count(Booking.id).desc())
        .limit(20)
    )
    
    heatmap_data = []
    for row in spot_activity.fetchall():
        heatmap_data.append({
            "location": row.location,
            "lat": float(row.latitude) if row.latitude else None,
            "lng": float(row.longitude) if row.longitude else None,
            "bookings": row.booking_count,
            "revenue": float(row.total_revenue or 0)
        })
    
    # Also get surf spot data for map pins
    surf_spots = await db.execute(
        select(SurfSpot.id, SurfSpot.name, SurfSpot.latitude, SurfSpot.longitude, SurfSpot.region)
        .limit(50)
    )
    
    spots = []
    for spot in surf_spots.fetchall():
        # Find matching bookings
        matching = next((h for h in heatmap_data if h.get("location") == spot.name), None)
        spots.append({
            "id": spot.id,
            "name": spot.name,
            "lat": float(spot.latitude) if spot.latitude else None,
            "lng": float(spot.longitude) if spot.longitude else None,
            "region": spot.region,
            "bookings": matching["bookings"] if matching else 0,
            "revenue": matching["revenue"] if matching else 0
        })
    
    return {
        "role_distribution": role_counts,
        "role_categories": role_ratios,
        "booking_efficiency": booking_efficiency,
        "spot_heatmap": heatmap_data,
        "surf_spots": spots
    }


@router.get("/admin/analytics/price-impact")
async def get_price_impact_data(
    admin_id: str,
    days: int = 90,
    db: AsyncSession = Depends(get_db)
):
    """
    Price Impact Tracking - Correlate pricing changes with signup/churn
    Returns pricing change markers with signup/churn data for visual overlay
    """
    await require_admin(admin_id, db)
    
    start_date = datetime.now(timezone.utc) - timedelta(days=days)
    
    # 1. Get pricing change events from admin logs
    pricing_changes = await db.execute(
        select(AdminLog)
        .where(AdminLog.action.ilike('%pricing%'))
        .where(AdminLog.created_at >= start_date)
        .order_by(AdminLog.created_at)
    )
    
    price_markers = []
    for log in pricing_changes.scalars().all():
        details = {}
        if log.details:
            try:
                details = json.loads(log.details) if isinstance(log.details, str) else log.details
            except (json.JSONDecodeError, TypeError):
                pass
        
        price_markers.append({
            "date": log.created_at.isoformat() if log.created_at else None,
            "action": log.action,
            "admin_id": log.admin_id,
            "details": details
        })
    
    # 2. Get daily signups for trend analysis
    daily_signups = await db.execute(
        select(
            func.date(Profile.created_at).label('date'),
            func.count(Profile.id).label('signups')
        )
        .where(Profile.created_at >= start_date)
        .group_by(func.date(Profile.created_at))
        .order_by(func.date(Profile.created_at))
    )
    
    signup_trend = []
    for row in daily_signups.fetchall():
        signup_trend.append({
            "date": row.date.isoformat() if row.date else None,
            "signups": row.signups
        })
    
    # 3. Get subscription changes (upgrades/downgrades/cancels) as proxy for churn
    subscription_changes = await db.execute(
        select(
            func.date(CreditTransaction.created_at).label('date'),
            func.count(CreditTransaction.id).label('changes')
        )
        .where(CreditTransaction.transaction_type.in_(['subscription_payment', 'subscription_cancel']))
        .where(CreditTransaction.created_at >= start_date)
        .group_by(func.date(CreditTransaction.created_at))
        .order_by(func.date(CreditTransaction.created_at))
    )
    
    churn_trend = []
    for row in subscription_changes.fetchall():
        churn_trend.append({
            "date": row.date.isoformat() if row.date else None,
            "changes": row.changes
        })
    
    return {
        "price_change_markers": price_markers,
        "signup_trend": signup_trend,
        "subscription_changes": churn_trend,
        "period_days": days
    }


# ============ AD APPROVAL QUEUE ============

class AdApprovalAction(BaseModel):
    action: str  # 'approve', 'reject', 'edit'
    reason: Optional[str] = None
    edited_content: Optional[Dict[str, Any]] = None


@router.get("/admin/ads/queue")
async def get_ad_approval_queue(
    admin_id: str,
    status: str = "pending",
    db: AsyncSession = Depends(get_db)
):
    """
    Get ads pending approval from the Self-Serve Ad Engine
    """
    await require_admin(admin_id, db)
    
    # For now, use the ad_config system - in production this would be a separate table
    from routes.ad_controls import get_ad_config
    
    config = await get_ad_config(db)
    
    # Filter variants by approval status
    all_variants = config.get("variants", [])
    
    if status == "pending":
        filtered = [v for v in all_variants if v.get("approval_status") == "pending"]
    elif status == "approved":
        filtered = [v for v in all_variants if v.get("approval_status") == "approved" or v.get("is_active")]
    elif status == "rejected":
        filtered = [v for v in all_variants if v.get("approval_status") == "rejected"]
    else:
        filtered = all_variants
    
    return {
        "queue": filtered,
        "counts": {
            "pending": len([v for v in all_variants if v.get("approval_status") == "pending"]),
            "approved": len([v for v in all_variants if v.get("approval_status") == "approved" or v.get("is_active")]),
            "rejected": len([v for v in all_variants if v.get("approval_status") == "rejected"])
        }
    }


@router.post("/admin/ads/queue/{variant_id}/action")
async def process_ad_approval(
    variant_id: str,
    admin_id: str,
    data: AdApprovalAction,
    db: AsyncSession = Depends(get_db)
):
    """
    Approve, Reject, or Edit a user-submitted ad creative
    """
    await require_admin(admin_id, db)
    
    from routes.ad_controls import get_ad_config, save_ad_config
    
    config = await get_ad_config(db)
    variants = config.get("variants", [])
    
    # Find the variant
    variant_index = None
    for i, v in enumerate(variants):
        if v.get("id") == variant_id:
            variant_index = i
            break
    
    if variant_index is None:
        raise HTTPException(status_code=404, detail="Ad variant not found")
    
    variant = variants[variant_index]
    
    if data.action == "approve":
        variant["approval_status"] = "approved"
        variant["is_active"] = True
        variant["approved_by"] = admin_id
        variant["approved_at"] = datetime.now(timezone.utc).isoformat()
        message = "Ad approved and activated"
        
    elif data.action == "reject":
        variant["approval_status"] = "rejected"
        variant["is_active"] = False
        variant["rejected_by"] = admin_id
        variant["rejected_at"] = datetime.now(timezone.utc).isoformat()
        variant["rejection_reason"] = data.reason
        message = "Ad rejected"
        
    elif data.action == "edit":
        if data.edited_content:
            for key, value in data.edited_content.items():
                if key in ["headline", "body", "cta", "image_url", "type"]:
                    variant[key] = value
        variant["edited_by"] = admin_id
        variant["edited_at"] = datetime.now(timezone.utc).isoformat()
        message = "Ad content updated"
        
    else:
        raise HTTPException(status_code=400, detail="Invalid action")
    
    variants[variant_index] = variant
    config["variants"] = variants
    
    await save_ad_config(config, admin_id, db)
    
    # Log the action
    log = AdminLog(
        admin_id=admin_id,
        action=f"ad_{data.action}",
        target_type="ad_variant",
        target_id=variant_id,
        details=json.dumps({
            "variant_headline": variant.get("headline"),
            "reason": data.reason
        })
    )
    db.add(log)
    await db.commit()
    
    return {
        "success": True,
        "message": message,
        "variant": variant
    }


# ============ PLATFORM METRICS AGGREGATION ============

@router.get("/admin/analytics/cached-metrics")
async def get_cached_platform_metrics(
    admin_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Get pre-aggregated platform metrics from the platform_metrics cache table.
    Falls back to live calculation if cache is stale (>6 hours).
    """
    await require_admin(admin_id, db)
    
    # Check if platform_metrics table exists and has recent data
    try:
        from models import PlatformMetrics
        
        latest = await db.execute(
            select(PlatformMetrics)
            .order_by(PlatformMetrics.computed_at.desc())
            .limit(1)
        )
        metrics = latest.scalar_one_or_none()
        
        if metrics and metrics.computed_at:
            age_hours = (datetime.now(timezone.utc) - metrics.computed_at).total_seconds() / 3600
            
            if age_hours < 6:
                # Return cached data
                return {
                    "source": "cache",
                    "computed_at": metrics.computed_at.isoformat(),
                    "age_hours": round(age_hours, 2),
                    "metrics": json.loads(metrics.data) if isinstance(metrics.data, str) else metrics.data
                }
    except Exception:
        # Table doesn't exist or other error - fall back to live
        pass
    
    # Fall back to live calculation
    financial = await get_financial_analytics(admin_id, 30, db)
    ecosystem = await get_ecosystem_analytics(admin_id, db)
    
    return {
        "source": "live",
        "computed_at": datetime.now(timezone.utc).isoformat(),
        "metrics": {
            "financial": financial,
            "ecosystem": ecosystem
        }
    }


@router.post("/admin/analytics/refresh-cache")
async def refresh_platform_metrics_cache(
    admin_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Manually trigger a refresh of the platform metrics cache.
    Normally runs every 6 hours via scheduler.
    """
    await require_admin(admin_id, db)
    
    # Compute fresh metrics
    financial = await get_financial_analytics(admin_id, 30, db)
    ecosystem = await get_ecosystem_analytics(admin_id, db)
    
    try:
        from models import PlatformMetrics
        
        # Create new cache entry
        metrics = PlatformMetrics(
            metric_type="platform_overview",
            data=json.dumps({
                "financial": financial,
                "ecosystem": ecosystem
            }),
            computed_at=datetime.now(timezone.utc)
        )
        db.add(metrics)
        await db.commit()
        
        return {
            "success": True,
            "message": "Platform metrics cache refreshed",
            "computed_at": metrics.computed_at.isoformat()
        }
    except Exception:
        # If table doesn't exist, just return the live data
        return {
            "success": True,
            "message": "Metrics computed (cache table not available)",
            "computed_at": datetime.now(timezone.utc).isoformat(),
            "metrics": {
                "financial": financial,
                "ecosystem": ecosystem
            }
        }



# ===================== PLATFORM SETTINGS =====================

@router.get("/site-access")
async def check_site_access(db: AsyncSession = Depends(get_db)):
    """Public endpoint to check if access code is required (no auth needed)"""
    from models import PlatformSettings
    
    try:
        result = await db.execute(select(PlatformSettings).limit(1))
        settings = result.scalar_one_or_none()
        
        if not settings:
            return {"access_code_enabled": False}
        
        return {
            "access_code_enabled": settings.access_code_enabled if hasattr(settings, 'access_code_enabled') else False
        }
    except Exception:
        return {"access_code_enabled": False}


class VerifyAccessCode(BaseModel):
    code: str

@router.post("/site-access/verify")
async def verify_access_code(data: VerifyAccessCode, db: AsyncSession = Depends(get_db)):
    """Public endpoint to verify an access code (no auth needed)"""
    from models import PlatformSettings
    
    try:
        result = await db.execute(select(PlatformSettings).limit(1))
        settings = result.scalar_one_or_none()
        
        if not settings or not settings.access_code_enabled:
            return {"valid": True, "message": "Access code not required"}
        
        stored_code = settings.access_code if hasattr(settings, 'access_code') else 'SURF2024'
        
        if data.code.upper().strip() == stored_code.upper().strip():
            return {"valid": True, "message": "Access granted"}
        else:
            return {"valid": False, "message": "Invalid access code"}
    except Exception:
        return {"valid": False, "message": "Error verifying code"}


@router.get("/admin/platform-settings")
async def get_platform_settings(
    db: AsyncSession = Depends(get_db)
):
    """Get current platform settings and feature flags"""
    from models import PlatformSettings
    
    try:
        result = await db.execute(select(PlatformSettings).limit(1))
        settings = result.scalar_one_or_none()
        
        if not settings:
            # Return defaults
            return {
                "show_lineup_cards_in_feed": True,
                "show_session_logs_in_feed": True,
                "allow_nearby_crew_invites": True,
                "feed_lineup_card_frequency": 5,
                "max_lineup_cards_per_feed": 3,
                "lineup_default_visibility": "friends",
                "lineup_lock_hours_before": 96,
                "lineup_min_crew_default": 2,
                "live_nearby_radius_miles": 10.0
            }
        
        return {
            "access_code_enabled": settings.access_code_enabled if hasattr(settings, 'access_code_enabled') else False,
            "access_code": settings.access_code if hasattr(settings, 'access_code') else 'SURF2024',
            "show_lineup_cards_in_feed": settings.show_lineup_cards_in_feed,
            "show_session_logs_in_feed": settings.show_session_logs_in_feed,
            "allow_nearby_crew_invites": settings.allow_nearby_crew_invites,
            "feed_lineup_card_frequency": settings.feed_lineup_card_frequency,
            "max_lineup_cards_per_feed": settings.max_lineup_cards_per_feed,
            "lineup_default_visibility": settings.lineup_default_visibility,
            "lineup_lock_hours_before": settings.lineup_lock_hours_before,
            "lineup_min_crew_default": settings.lineup_min_crew_default,
            "live_nearby_radius_miles": settings.live_nearby_radius_miles
        }
    except Exception:
        # Table doesn't exist, return defaults
        return {
            "show_lineup_cards_in_feed": True,
            "show_session_logs_in_feed": True,
            "allow_nearby_crew_invites": True,
            "feed_lineup_card_frequency": 5,
            "max_lineup_cards_per_feed": 3,
            "lineup_default_visibility": "friends",
            "lineup_lock_hours_before": 96,
            "lineup_min_crew_default": 2,
            "live_nearby_radius_miles": 10.0
        }


class UpdatePlatformSettingsRequest(BaseModel):
    access_code_enabled: Optional[bool] = None
    access_code: Optional[str] = None
    show_lineup_cards_in_feed: Optional[bool] = None
    show_session_logs_in_feed: Optional[bool] = None
    allow_nearby_crew_invites: Optional[bool] = None
    feed_lineup_card_frequency: Optional[int] = None
    max_lineup_cards_per_feed: Optional[int] = None
    lineup_default_visibility: Optional[str] = None
    lineup_lock_hours_before: Optional[int] = None
    lineup_min_crew_default: Optional[int] = None
    live_nearby_radius_miles: Optional[float] = None


@router.put("/admin/platform-settings")
async def update_platform_settings(
    data: UpdatePlatformSettingsRequest,
    admin_id: str = Query(...),
    db: AsyncSession = Depends(get_db)
):
    """Update platform settings (admin only)"""
    from models import PlatformSettings
    
    # Verify admin using is_admin boolean
    admin = await db.execute(select(Profile).where(Profile.id == admin_id))
    admin = admin.scalar_one_or_none()
    if not admin or not admin.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    try:
        result = await db.execute(select(PlatformSettings).limit(1))
        settings = result.scalar_one_or_none()
        
        if not settings:
            settings = PlatformSettings()
            db.add(settings)
        
        # Update only provided fields
        if data.access_code_enabled is not None:
            settings.access_code_enabled = data.access_code_enabled
        if data.access_code is not None:
            settings.access_code = data.access_code
        if data.show_lineup_cards_in_feed is not None:
            settings.show_lineup_cards_in_feed = data.show_lineup_cards_in_feed
        if data.show_session_logs_in_feed is not None:
            settings.show_session_logs_in_feed = data.show_session_logs_in_feed
        if data.allow_nearby_crew_invites is not None:
            settings.allow_nearby_crew_invites = data.allow_nearby_crew_invites
        if data.feed_lineup_card_frequency is not None:
            settings.feed_lineup_card_frequency = data.feed_lineup_card_frequency
        if data.max_lineup_cards_per_feed is not None:
            settings.max_lineup_cards_per_feed = data.max_lineup_cards_per_feed
        if data.lineup_default_visibility is not None:
            settings.lineup_default_visibility = data.lineup_default_visibility
        if data.lineup_lock_hours_before is not None:
            settings.lineup_lock_hours_before = data.lineup_lock_hours_before
        if data.lineup_min_crew_default is not None:
            settings.lineup_min_crew_default = data.lineup_min_crew_default
        if data.live_nearby_radius_miles is not None:
            settings.live_nearby_radius_miles = data.live_nearby_radius_miles
        
        settings.updated_by = admin_id
        settings.updated_at = datetime.now(timezone.utc)
        
        await db.commit()
        
        return {"message": "Platform settings updated", "success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update settings: {str(e)}")


@router.get("/feed/lineups")
async def get_feed_lineups(
    user_id: str = Query(...),
    limit: int = Query(3, ge=1, le=10),
    db: AsyncSession = Depends(get_db)
):
    """
    Get open lineups to display in the feed.
    Returns lineups from friends or nearby based on visibility settings.
    """
    from models import PlatformSettings, Friend, FriendshipStatusEnum
    import math
    
    # Check if feature is enabled
    try:
        settings_result = await db.execute(select(PlatformSettings).limit(1))
        settings = settings_result.scalar_one_or_none()
        if settings and not settings.show_lineup_cards_in_feed:
            return []
    except Exception:
        pass  # Feature enabled by default
    
    # Get user profile for location
    user_result = await db.execute(select(Profile).where(Profile.id == user_id))
    user = user_result.scalar_one_or_none()
    
    if not user:
        return []
    
    # Get friends
    friends_result = await db.execute(
        select(Friend).where(
            and_(
                or_(Friend.requester_id == user_id, Friend.addressee_id == user_id),
                Friend.status == FriendshipStatusEnum.ACCEPTED
            )
        )
    )
    friend_ids = set()
    for f in friends_result.scalars().all():
        if f.requester_id == user_id:
            friend_ids.add(f.addressee_id)
        else:
            friend_ids.add(f.requester_id)
    
    # Query open lineups
    lineups_result = await db.execute(
        select(Booking).where(
            and_(
                Booking.lineup_status.in_(['open', 'filling']),
                Booking.creator_id != user_id  # Exclude own lineups
            )
        ).options(
            selectinload(Booking.creator),
            selectinload(Booking.photographer),
            selectinload(Booking.participants)
        ).order_by(Booking.session_date.asc()).limit(limit * 3)  # Fetch more for filtering
    )
    all_lineups = lineups_result.scalars().all()
    
    # Filter lineups based on visibility
    visible_lineups = []
    for lineup in all_lineups:
        # Skip if user is already in the lineup
        if any(p.participant_id == user_id for p in lineup.participants):
            continue
        
        # Check visibility
        is_visible = False
        if lineup.lineup_visibility in ['friends', 'both']:
            if lineup.creator_id in friend_ids:
                is_visible = True
        
        if lineup.lineup_visibility in ['area', 'both'] and not is_visible:
            # Check proximity
            if user.latitude and user.longitude and lineup.latitude and lineup.longitude:
                lat_diff = abs(user.latitude - lineup.latitude)
                lon_diff = abs(user.longitude - lineup.longitude)
                distance_miles = math.sqrt((lat_diff * 69)**2 + (lon_diff * 69 * math.cos(math.radians(user.latitude)))**2)
                if distance_miles <= (lineup.proximity_radius or 10):
                    is_visible = True
        
        if is_visible:
            visible_lineups.append(lineup)
            if len(visible_lineups) >= limit:
                break
    
    # Serialize
    return [
        {
            "id": str(lineup.id),
            "creator_id": lineup.creator_id,
            "creator_name": lineup.creator.full_name if lineup.creator else None,
            "creator_avatar_url": lineup.creator.avatar_url if lineup.creator else None,
            "photographer_id": lineup.photographer_id,
            "photographer_name": lineup.photographer.full_name if lineup.photographer else None,
            "location": lineup.location,
            "latitude": lineup.latitude,
            "longitude": lineup.longitude,
            "session_date": lineup.session_date.isoformat() if lineup.session_date else None,
            "total_price": lineup.total_price,
            "max_participants": lineup.max_participants,
            "lineup_status": lineup.lineup_status,
            "lineup_closes_at": lineup.lineup_closes_at.isoformat() if lineup.lineup_closes_at else None,
            "lineup_visibility": lineup.lineup_visibility,
            "lineup_min_crew": lineup.lineup_min_crew,
            "lineup_max_crew": lineup.lineup_max_crew,
            "lineup_message": lineup.lineup_message,
            "participants": [
                {
                    "participant_id": p.participant_id,
                    "status": p.status
                }
                for p in lineup.participants
            ]
        }
        for lineup in visible_lineups
    ]
