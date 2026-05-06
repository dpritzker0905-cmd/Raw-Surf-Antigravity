"""Platform metrics aggregation — runs every 6 hours."""
import logging

logger = logging.getLogger(__name__)
async def aggregate_platform_metrics_task():
    """
    Aggregate platform metrics every 6 hours for fast Admin Dashboard loading.
    This prevents recalculating millions of rows on every page refresh.
    """
    logger.info("[Scheduler] Starting platform metrics aggregation...")
    
    try:
        from database import async_session_maker
        async with async_session_maker() as db:
            from sqlalchemy import func, select
            from models import Profile, Booking, PaymentTransaction, CreditTransaction, PlatformMetrics, RoleEnum
            from datetime import datetime, timezone, timedelta
            import json
            
            # 1. FINANCIAL METRICS
            # Total credit liability
            liability = await db.execute(select(func.sum(Profile.credit_balance)))
            total_liability = liability.scalar() or 0
            
            # Revenue last 30 days
            thirty_days_ago = datetime.now(timezone.utc) - timedelta(days=30)
            revenue = await db.execute(
                select(func.sum(PaymentTransaction.amount))
                .where(PaymentTransaction.payment_status == 'completed')
                .where(PaymentTransaction.created_at >= thirty_days_ago)
            )
            total_revenue = revenue.scalar() or 0
            
            # 2. ECOSYSTEM METRICS
            # Role distribution
            role_counts = {}
            for role in RoleEnum:
                count = await db.execute(
                    select(func.count(Profile.id)).where(Profile.role == role)
                )
                role_counts[role.value] = count.scalar() or 0
            
            # Booking efficiency
            ondemand = await db.execute(
                select(func.count(Booking.id)).where(Booking.booking_type == 'request_pro')
            )
            scheduled = await db.execute(
                select(func.count(Booking.id)).where(Booking.booking_type != 'request_pro')
            )
            
            metrics_data = {
                "financial": {
                    "total_credit_liability": round(total_liability, 2),
                    "revenue_30d": round(total_revenue, 2)
                },
                "ecosystem": {
                    "role_distribution": role_counts,
                    "booking_efficiency": {
                        "on_demand": ondemand.scalar() or 0,
                        "scheduled": scheduled.scalar() or 0
                    }
                },
                "computed_at": datetime.now(timezone.utc).isoformat()
            }
            
            # Store in cache table
            try:
                cache_entry = PlatformMetrics(
                    metric_type="platform_overview",
                    data=json.dumps(metrics_data),
                    computed_at=datetime.now(timezone.utc)
                )
                db.add(cache_entry)
                await db.commit()
                logger.info(f"[Scheduler] Platform metrics aggregated: liability=${total_liability:.2f}, revenue=${total_revenue:.2f}")
            except Exception as e:
                logger.warning(f"[Scheduler] Could not cache metrics (table may not exist): {e}")
                # Still log success for the computation
                logger.info(f"[Scheduler] Platform metrics computed (not cached): liability=${total_liability:.2f}")
    
    except Exception as e:
        logger.error(f"[Scheduler] Error aggregating platform metrics: {str(e)}")
