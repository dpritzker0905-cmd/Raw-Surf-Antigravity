"""
Enhanced Admin Analytics: LTV/CAC, Marketplace Health, Liquidity, Supply/Demand
Delta sync with existing analytics - no redundancy with admin_p2.py
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_, desc, case, extract, distinct
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone, timedelta
from dateutil.relativedelta import relativedelta

from database import get_db
from deps.admin_auth import get_current_admin
from models import (
    Profile, Booking, CreditTransaction, PaymentTransaction, 
    SurfSpot, RoleEnum, GalleryItem, Review
)



router = APIRouter()


# ============ LTV/CAC METRICS ============

@router.get("/admin/analytics/ltv-cac")
async def get_ltv_cac_metrics(
    admin: Profile = Depends(get_current_admin),
    days: int = 90,
    db: AsyncSession = Depends(get_db)
):
    """
    Calculate LTV/CAC ratio and related unit economics
    - LTV = Average Revenue Per User * Gross Margin / Churn Rate
    - CAC = Marketing Spend / New Customers (estimated from credit transactions)
    """
    
    start_date = datetime.now(timezone.utc) - timedelta(days=days)
    prev_start = start_date - timedelta(days=days)
    
    # Total users and new users
    total_users = await db.execute(select(func.count(Profile.id)))
    total_user_count = total_users.scalar() or 1
    
    new_users_current = await db.execute(
        select(func.count(Profile.id))
        .where(Profile.created_at >= start_date)
    )
    new_user_count = new_users_current.scalar() or 0
    
    new_users_prev = await db.execute(
        select(func.count(Profile.id))
        .where(and_(
            Profile.created_at >= prev_start,
            Profile.created_at < start_date
        ))
    )
    prev_new_users = new_users_prev.scalar() or 0
    
    # Total revenue in period
    revenue_result = await db.execute(
        select(func.sum(func.abs(CreditTransaction.amount)))
        .where(and_(
            CreditTransaction.amount < 0,
            CreditTransaction.created_at >= start_date
        ))
    )
    total_revenue = revenue_result.scalar() or 0
    
    # Active users (users who made a transaction)
    active_users_result = await db.execute(
        select(func.count(distinct(CreditTransaction.user_id)))
        .where(CreditTransaction.created_at >= start_date)
    )
    active_users = active_users_result.scalar() or 1
    
    # ARPU (Average Revenue Per User)
    arpu = total_revenue / active_users if active_users > 0 else 0
    
    # Estimate churn (users who were active in prev period but not current)
    prev_active = await db.execute(
        select(func.count(distinct(CreditTransaction.user_id)))
        .where(and_(
            CreditTransaction.created_at >= prev_start,
            CreditTransaction.created_at < start_date
        ))
    )
    prev_active_count = prev_active.scalar() or 1
    
    # Simple churn estimation
    retained = await db.execute(
        select(func.count(distinct(CreditTransaction.user_id)))
        .where(and_(
            CreditTransaction.created_at >= start_date,
            CreditTransaction.user_id.in_(
                select(distinct(CreditTransaction.user_id))
                .where(and_(
                    CreditTransaction.created_at >= prev_start,
                    CreditTransaction.created_at < start_date
                ))
            )
        ))
    )
    retained_count = retained.scalar() or 0
    
    churn_rate = 1 - (retained_count / prev_active_count) if prev_active_count > 0 else 0.1
    churn_rate = max(churn_rate, 0.01)  # Minimum 1% to avoid division by zero
    
    # LTV calculation (simplified: ARPU / monthly churn * gross margin)
    gross_margin = 0.85  # 85% gross margin assumption
    monthly_churn = churn_rate * (30 / days)  # Normalize to monthly
    ltv = (arpu * gross_margin) / monthly_churn if monthly_churn > 0 else arpu * 12
    
    # CAC estimation (promo code redemptions + ad purchases as proxy)
    marketing_spend = await db.execute(
        select(func.sum(func.abs(CreditTransaction.amount)))
        .where(and_(
            CreditTransaction.transaction_type.in_(['ad_purchase', 'promo_credit']),
            CreditTransaction.created_at >= start_date
        ))
    )
    total_marketing = marketing_spend.scalar() or 0
    
    # Add estimated acquisition cost ($5-10 per user industry avg if no data)
    estimated_cac = (total_marketing / new_user_count) if new_user_count > 0 else 25
    if estimated_cac < 5:
        estimated_cac = 25  # Industry baseline
    
    # LTV/CAC Ratio
    ltv_cac_ratio = ltv / estimated_cac if estimated_cac > 0 else 0
    
    # CAC Payback Period (months)
    monthly_arpu = arpu * (30 / days)
    cac_payback_months = estimated_cac / (monthly_arpu * gross_margin) if monthly_arpu > 0 else 12
    
    return {
        "period_days": days,
        "ltv": round(ltv, 2),
        "cac": round(estimated_cac, 2),
        "ltv_cac_ratio": round(ltv_cac_ratio, 2),
        "cac_payback_months": round(cac_payback_months, 1),
        "arpu": round(arpu, 2),
        "churn_rate": round(churn_rate * 100, 1),
        "gross_margin": gross_margin * 100,
        "total_users": total_user_count,
        "new_users": new_user_count,
        "new_users_change": round(((new_user_count - prev_new_users) / max(prev_new_users, 1)) * 100, 1),
        "active_users": active_users,
        "health_status": "healthy" if ltv_cac_ratio >= 3 else "warning" if ltv_cac_ratio >= 1 else "critical"
    }


# ============ MARKETPLACE LIQUIDITY ============

@router.get("/admin/analytics/liquidity")
async def get_marketplace_liquidity(
    admin: Profile = Depends(get_current_admin),
    days: int = 30,
    db: AsyncSession = Depends(get_db)
):
    """
    Marketplace liquidity metrics - supply/demand matching efficiency
    - Buyer Liquidity: Search-to-booking conversion
    - Seller Liquidity: Photographer utilization rate
    """
    
    start_date = datetime.now(timezone.utc) - timedelta(days=days)
    
    # Supply side: Active photographers
    total_photographers = await db.execute(
        select(func.count(Profile.id))
        .where(Profile.role.in_([RoleEnum.PHOTOGRAPHER, RoleEnum.APPROVED_PRO]))
    )
    photographer_count = total_photographers.scalar() or 0
    
    # Active photographers (had a booking in period)
    active_photographers = await db.execute(
        select(func.count(distinct(Booking.photographer_id)))
        .where(Booking.created_at >= start_date)
    )
    active_photographer_count = active_photographers.scalar() or 0
    
    # Photographer utilization rate
    utilization_rate = (active_photographer_count / photographer_count * 100) if photographer_count > 0 else 0
    
    # Demand side: Total booking requests
    total_bookings = await db.execute(
        select(func.count(Booking.id))
        .where(Booking.created_at >= start_date)
    )
    booking_count = total_bookings.scalar() or 0
    
    # Completed bookings
    completed_bookings = await db.execute(
        select(func.count(Booking.id))
        .where(and_(
            Booking.created_at >= start_date,
            Booking.status.in_(['Completed', 'completed'])
        ))
    )
    completed_count = completed_bookings.scalar() or 0
    
    # Confirmed bookings (successful matches)
    confirmed_bookings = await db.execute(
        select(func.count(Booking.id))
        .where(and_(
            Booking.created_at >= start_date,
            Booking.status.in_(['Confirmed', 'confirmed', 'Completed', 'completed'])
        ))
    )
    confirmed_count = confirmed_bookings.scalar() or 0
    
    # Match rate (booking requests that got confirmed)
    match_rate = (confirmed_count / booking_count * 100) if booking_count > 0 else 0
    
    # Average time to confirmation (for confirmed bookings)
    # Using created_at to session_date as proxy
    avg_lead_time = await db.execute(
        select(func.avg(
            func.extract('epoch', Booking.session_date) - func.extract('epoch', Booking.created_at)
        ) / 86400)  # Convert to days
        .where(and_(
            Booking.created_at >= start_date,
            Booking.status.in_(['Confirmed', 'confirmed', 'Completed', 'completed'])
        ))
    )
    avg_lead_days = avg_lead_time.scalar() or 0
    
    # Gallery items per photographer (content supply)
    gallery_per_photographer = await db.execute(
        select(func.count(GalleryItem.id))
        .where(GalleryItem.created_at >= start_date)
    )
    new_gallery_items = gallery_per_photographer.scalar() or 0
    
    # Calculate liquidity score (0-100)
    # Weighted: 40% utilization, 30% match rate, 30% completion rate
    completion_rate = (completed_count / confirmed_count * 100) if confirmed_count > 0 else 0
    liquidity_score = (
        utilization_rate * 0.4 +
        match_rate * 0.3 +
        completion_rate * 0.3
    )
    
    return {
        "period_days": days,
        "liquidity_score": round(liquidity_score, 1),
        "supply": {
            "total_photographers": photographer_count,
            "active_photographers": active_photographer_count,
            "utilization_rate": round(utilization_rate, 1),
            "new_gallery_items": new_gallery_items
        },
        "demand": {
            "total_bookings": booking_count,
            "confirmed_bookings": confirmed_count,
            "completed_bookings": completed_count,
            "match_rate": round(match_rate, 1),
            "completion_rate": round(completion_rate, 1)
        },
        "efficiency": {
            "avg_lead_time_days": round(avg_lead_days, 1) if avg_lead_days else 0
        },
        "health_status": "healthy" if liquidity_score >= 60 else "warning" if liquidity_score >= 30 else "needs_attention"
    }


# ============ SUPPLY/DEMAND BY LOCATION ============

@router.get("/admin/analytics/supply-demand")
async def get_supply_demand_balance(
    admin: Profile = Depends(get_current_admin),
    days: int = 30,
    limit: int = 10,
    db: AsyncSession = Depends(get_db)
):
    """
    Supply/Demand balance by surf spot location
    Identifies underserved and oversupplied markets
    """
    
    start_date = datetime.now(timezone.utc) - timedelta(days=days)
    
    # Get bookings by surf spot (using region instead of city)
    spot_demand = await db.execute(
        select(
            SurfSpot.id,
            SurfSpot.name,
            SurfSpot.region,
            SurfSpot.country,
            func.count(Booking.id).label('booking_count'),
            func.count(distinct(Booking.creator_id)).label('unique_customers')
        )
        .join(Booking, Booking.surf_spot_id == SurfSpot.id, isouter=True)
        .where(or_(Booking.created_at >= start_date, Booking.id.is_(None)))
        .group_by(SurfSpot.id, SurfSpot.name, SurfSpot.region, SurfSpot.country)
        .order_by(desc('booking_count'))
        .limit(limit)
    )
    
    spots_data = []
    for row in spot_demand.fetchall():
        # Count photographers near this spot (using region match or current_spot)
        photographer_count = await db.execute(
            select(func.count(Profile.id))
            .where(and_(
                Profile.role.in_([RoleEnum.PHOTOGRAPHER, RoleEnum.APPROVED_PRO]),
                or_(
                    Profile.location.ilike(f"%{row.region}%") if row.region else False,
                    Profile.current_spot_id == row.id
                )
            ))
        )
        photographers = photographer_count.scalar() or 0
        
        # Calculate supply/demand ratio
        demand = row.booking_count or 0
        supply = photographers
        
        if demand > 0 and supply > 0:
            ratio = supply / (demand / 10)  # Normalize demand
            status = "balanced" if 0.5 <= ratio <= 2 else "oversupplied" if ratio > 2 else "underserved"
        elif demand > 0 and supply == 0:
            status = "underserved"
            ratio = 0
        elif supply > 0 and demand == 0:
            status = "oversupplied"
            ratio = 10
        else:
            status = "inactive"
            ratio = 1
        
        spots_data.append({
            "spot_id": row.id,
            "name": row.name,
            "region": row.region,
            "country": row.country,
            "demand": demand,
            "unique_customers": row.unique_customers or 0,
            "supply": supply,
            "ratio": round(ratio, 2),
            "status": status
        })
    
    # Summary stats
    total_demand = sum(s['demand'] for s in spots_data)
    total_supply = sum(s['supply'] for s in spots_data)
    underserved_count = len([s for s in spots_data if s['status'] == 'underserved'])
    
    return {
        "period_days": days,
        "summary": {
            "total_demand": total_demand,
            "total_supply": total_supply,
            "overall_ratio": round(total_supply / max(total_demand / 10, 1), 2),
            "underserved_spots": underserved_count,
            "balanced_spots": len([s for s in spots_data if s['status'] == 'balanced']),
            "oversupplied_spots": len([s for s in spots_data if s['status'] == 'oversupplied'])
        },
        "spots": spots_data
    }


# ============ TOP PERFORMERS ============

@router.get("/admin/analytics/top-performers")
async def get_top_performers(
    admin: Profile = Depends(get_current_admin),
    days: int = 30,
    limit: int = 10,
    db: AsyncSession = Depends(get_db)
):
    """
    Top performing photographers and spots by revenue/bookings
    """
    
    start_date = datetime.now(timezone.utc) - timedelta(days=days)
    
    # Top photographers by revenue
    top_photographers = await db.execute(
        select(
            Profile.id,
            Profile.full_name,
            Profile.avatar_url,
            Profile.role,
            func.count(Booking.id).label('booking_count'),
            func.sum(Booking.total_price).label('total_revenue'),
            func.avg(Booking.total_price).label('avg_booking_value')
        )
        .join(Booking, Booking.photographer_id == Profile.id)
        .where(and_(
            Booking.created_at >= start_date,
            Booking.status.in_(['Confirmed', 'confirmed', 'Completed', 'completed'])
        ))
        .group_by(Profile.id, Profile.full_name, Profile.avatar_url, Profile.role)
        .order_by(desc('total_revenue'))
        .limit(limit)
    )
    
    photographers = []
    for row in top_photographers.fetchall():
        # Get average rating
        avg_rating = await db.execute(
            select(func.avg(Review.rating))
            .where(Review.reviewee_id == row.id)
        )
        rating = avg_rating.scalar() or 0
        
        photographers.append({
            "id": row.id,
            "name": row.full_name,
            "avatar_url": row.avatar_url,
            "role": row.role.value if row.role else "Photographer",
            "bookings": row.booking_count,
            "revenue": round(row.total_revenue or 0, 2),
            "avg_booking": round(row.avg_booking_value or 0, 2),
            "rating": round(rating, 1)
        })
    
    # Top spots by bookings
    top_spots = await db.execute(
        select(
            SurfSpot.id,
            SurfSpot.name,
            SurfSpot.region,
            SurfSpot.country,
            func.count(Booking.id).label('booking_count'),
            func.sum(Booking.total_price).label('total_revenue')
        )
        .join(Booking, Booking.surf_spot_id == SurfSpot.id)
        .where(Booking.created_at >= start_date)
        .group_by(SurfSpot.id, SurfSpot.name, SurfSpot.region, SurfSpot.country)
        .order_by(desc('booking_count'))
        .limit(limit)
    )
    
    spots = [{
        "id": row.id,
        "name": row.name,
        "location": f"{row.region}, {row.country}" if row.region and row.country else row.region or row.country or "Unknown",
        "bookings": row.booking_count,
        "revenue": round(float(row.total_revenue or 0), 2)
    } for row in top_spots.fetchall()]
    
    return {
        "period_days": days,
        "top_photographers": photographers,
        "top_spots": spots
    }


# ============ RETENTION CURVE DATA ============

@router.get("/admin/analytics/retention-curve")
async def get_retention_curve(
    admin: Profile = Depends(get_current_admin),
    cohort_months: int = 6,
    db: AsyncSession = Depends(get_db)
):
    """
    Generates retention curve data for visualization
    Returns weekly retention percentages for line chart
    """
    
    now = datetime.now(timezone.utc)
    curves = []
    
    for month_offset in range(cohort_months):
        cohort_start = (now - relativedelta(months=month_offset)).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        cohort_end = cohort_start + relativedelta(months=1)
        cohort_label = cohort_start.strftime("%b %Y")
        
        # Get cohort users
        cohort_users = await db.execute(
            select(Profile.id)
            .where(and_(
                Profile.created_at >= cohort_start,
                Profile.created_at < cohort_end
            ))
        )
        user_ids = [row[0] for row in cohort_users.fetchall()]
        cohort_size = len(user_ids)
        
        if cohort_size == 0:
            continue
        
        # Calculate retention for each week (up to 12 weeks)
        retention_points = [{"week": 0, "retention": 100, "users": cohort_size}]
        
        for week in range(1, min(month_offset * 4 + 4, 12)):
            week_start = cohort_start + timedelta(weeks=week)
            week_end = week_start + timedelta(weeks=1)
            
            if week_end > now:
                break
            
            if user_ids:
                active_in_week = await db.execute(
                    select(func.count(distinct(CreditTransaction.user_id)))
                    .where(and_(
                        CreditTransaction.user_id.in_(user_ids),
                        CreditTransaction.created_at >= week_start,
                        CreditTransaction.created_at < week_end
                    ))
                )
                active_count = active_in_week.scalar() or 0
                retention = round((active_count / cohort_size) * 100, 1)
                retention_points.append({
                    "week": week,
                    "retention": retention,
                    "users": active_count
                })
        
        curves.append({
            "cohort": cohort_label,
            "cohort_size": cohort_size,
            "data": retention_points
        })
    
    return {
        "cohort_months": cohort_months,
        "curves": curves
    }


# ============ HEALTH SCORE SUMMARY ============

@router.get("/admin/analytics/health-score")
async def get_platform_health_score(
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    Overall platform health score combining multiple metrics
    """
    
    # Get component scores
    ltv_cac = await get_ltv_cac_metrics(admin, 90, db)
    liquidity = await get_marketplace_liquidity(admin, 30, db)
    
    # Calculate health components (0-100 each)
    ltv_cac_score = min(ltv_cac['ltv_cac_ratio'] / 3 * 100, 100)  # 3:1 = 100%
    liquidity_score = liquidity['liquidity_score']
    
    # Get NPS proxy from reviews
    avg_rating = await db.execute(
        select(func.avg(Review.rating))
        .where(Review.created_at >= datetime.now(timezone.utc) - timedelta(days=30))
    )
    rating = float(avg_rating.scalar() or 4.0)
    nps_proxy = (rating - 1) / 4 * 100  # Convert 1-5 to 0-100
    
    # Get repeat booking rate
    repeat_customers = await db.execute(
        select(func.count(distinct(Booking.creator_id)))
        .where(and_(
            Booking.created_at >= datetime.now(timezone.utc) - timedelta(days=90),
            Booking.creator_id.in_(
                select(Booking.creator_id)
                .group_by(Booking.creator_id)
                .having(func.count(Booking.id) > 1)
            )
        ))
    )
    repeat_count = repeat_customers.scalar() or 0
    
    total_customers = await db.execute(
        select(func.count(distinct(Booking.creator_id)))
        .where(Booking.created_at >= datetime.now(timezone.utc) - timedelta(days=90))
    )
    total_count = total_customers.scalar() or 1
    
    repeat_rate = float((repeat_count / total_count) * 100) if total_count > 0 else 0
    
    # Overall health score (weighted average)
    overall_score = (
        float(ltv_cac_score) * 0.30 +
        float(liquidity_score) * 0.30 +
        float(nps_proxy) * 0.20 +
        float(repeat_rate) * 0.20
    )
    
    return {
        "overall_score": round(overall_score, 1),
        "status": "excellent" if overall_score >= 80 else "good" if overall_score >= 60 else "needs_attention" if overall_score >= 40 else "critical",
        "components": {
            "unit_economics": {
                "score": round(ltv_cac_score, 1),
                "ltv_cac_ratio": ltv_cac['ltv_cac_ratio'],
                "status": ltv_cac['health_status']
            },
            "liquidity": {
                "score": round(liquidity_score, 1),
                "match_rate": liquidity['demand']['match_rate'],
                "status": liquidity['health_status']
            },
            "satisfaction": {
                "score": round(nps_proxy, 1),
                "avg_rating": round(rating, 1),
                "status": "healthy" if rating >= 4 else "warning" if rating >= 3 else "critical"
            },
            "retention": {
                "score": round(repeat_rate, 1),
                "repeat_booking_rate": round(repeat_rate, 1),
                "status": "healthy" if repeat_rate >= 30 else "warning" if repeat_rate >= 15 else "needs_attention"
            }
        }
    }
