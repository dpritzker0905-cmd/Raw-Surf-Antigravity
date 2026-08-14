"""Surf alert checking — runs every 15 minutes."""
import logging
import json
from datetime import datetime, timezone

# Weather pipeline point resolution
from services.weather_pipeline.point_resolution import PointResolutionService
from services.weather_pipeline.sampler import PointSampler
from services.weather_pipeline.providers.open_meteo_provider import OpenMeteoProvider

point_sampler = PointSampler()
open_meteo_provider = OpenMeteoProvider()
point_resolution_service = PointResolutionService(
    sampler=point_sampler,
    provider=open_meteo_provider
)

logger = logging.getLogger(__name__)
from .base import send_push_notification

async def check_surf_alerts_task():
    """
    Check all active surf alerts against current conditions
    Triggered every 15 minutes
    """
    from database import async_session_maker
    from sqlalchemy import select
    from sqlalchemy.orm import selectinload
    from models import SurfAlert, Notification, PushSubscription
    # ONE authority for the alert sentence, shared with the manual POST /alerts/check path.
    # Function-level to avoid a scheduler->routes import at module load; the same pattern
    # scheduler/bookings.py:25,115,196 and scheduler/gamification.py:11 already use.
    from routes.surf_data.alerts import surf_alert_body
    
    logger.info("[Scheduler] Running surf alert check...")
    
    try:
        async with async_session_maker() as db:
            # Get all active alerts with spot data
            result = await db.execute(
                select(SurfAlert)
                .where(SurfAlert.is_active == True)
                .options(selectinload(SurfAlert.spot), selectinload(SurfAlert.user))
            )
            alerts = result.scalars().all()
            
            logger.info(f"[Scheduler] Checking {len(alerts)} active alerts")
            
            triggered_count = 0
            
            # Group alerts by spot to reduce API calls
            spot_alerts = {}
            for alert in alerts:
                if alert.spot:
                    if alert.spot.id not in spot_alerts:
                        spot_alerts[alert.spot.id] = {
                            "spot": alert.spot,
                            "alerts": []
                        }
                    spot_alerts[alert.spot.id]["alerts"].append(alert)
            
            for spot_id, data in spot_alerts.items():
                spot = data["spot"]
                spot_alerts_list = data["alerts"]
                
                try:
                    # Fetch current conditions using PointResolutionService
                    conditions_data = await point_resolution_service.resolve_spot_conditions(
                        model="GFS", lat=spot.latitude, lng=spot.longitude, forecast_days=1,
                        spot_id=spot_id
                    )
                    
                    if not conditions_data or "current_conditions" not in conditions_data:
                        continue
                    
                    current_cond = conditions_data["current_conditions"]
                    wave_height_ft = current_cond.get("wave_height_ft", 0.0)
                    wave_period = current_cond.get("wave_period") or 0

                    # ⛔⛔ THIS JOB SENT "perfect conditions!" ON HEIGHT ALONE FOR ~8 DAYS.
                    # `resolve_spot_conditions` runs the mandated chain and writes `rating` /
                    # `rating_level` into `current_conditions` (spot_conditions.py:438-439) — the
                    # very dict fetched three lines above. This loop read `wave_height_ft` and
                    # nothing else, then asserted the day was perfect.
                    # ⇒ CLAUDE.md, verbatim: "A size without a quality is also incomplete: a
                    #   blown-out 6 ft and a groomed 6 ft must not render identically." They rendered
                    #   IDENTICALLY here, and the mandate names alerts explicitly.
                    #
                    # ⚠️ WHY THIS FILE AND NOT `routes/surf_data/alerts.py`, WHICH WAS ALREADY FIXED:
                    #   that one is a MANUAL `POST /alerts/check` that nothing schedules. THIS file
                    #   is what `scheduler/__init__.py:43-45` registers on IntervalTrigger(minutes=15)
                    #   and what `/api/health` reports live as
                    #   {"id": "check_surf_alerts", "trigger": "interval[0:15:00]"}.
                    #   The repaired path was the one nobody called. The guard was green because its
                    #   census named one hard-coded file — see the census section of
                    #   tests/test_surf_alert_states_the_quality.py.
                    #
                    # ★ The composer is SHARED, not reimplemented. Two jobs, one authority for the
                    #   sentence. (Consolidating the two JOBS was considered and rejected inside this
                    #   mission's scope: this one groups alerts by spot to cut provider calls and the
                    #   route does not, so merging them is a refactor with its own risk.)
                    # ⚠️ WHEN THE ALERT FIRES IS DELIBERATELY UNCHANGED — still the user's height
                    #   bounds. Adding a quality floor would silently drop alerts they asked for;
                    #   that is a product decision needing a column on the alert. Only the CLAIM
                    #   is fixed.
                    rating = current_cond.get("rating")
                    rating_level = current_cond.get("rating_level")
                    body = surf_alert_body(wave_height_ft, wave_period, rating, rating_level)

                    # Check each alert for this spot
                    for alert in spot_alerts_list:
                        matches = True
                        
                        if alert.min_wave_height and wave_height_ft < alert.min_wave_height:
                            matches = False
                        if alert.max_wave_height and wave_height_ft > alert.max_wave_height:
                            matches = False
                        
                        if matches:
                            # Update alert tracking
                            alert.trigger_count += 1
                            alert.last_triggered = datetime.now(timezone.utc)
                            
                            # Create in-app notification
                            # ⚠️ THE TITLE IS PART OF THE SAME CLAIM. "is firing!" asserts quality
                            # from size exactly as the body did, and a push reading
                            # "🌊 Cocoa Beach is firing!" over "conditions very poor (8/100)" is
                            # worse than either alone. Aligned with the route's neutral form.
                            title = f"🌊 {spot.name} — {wave_height_ft:.1f}ft"
                            notification = Notification(
                                user_id=alert.user_id,
                                type="surf_alert",
                                title=title,
                                body=body,
                                data=json.dumps({
                                    "spot_id": spot.id,
                                    "spot_name": spot.name,
                                    "wave_height_ft": round(wave_height_ft, 1),
                                    "wave_period": wave_period,
                                    # Carried so a client can colour or filter on quality without a
                                    # second request — same reason the glyph payload carries `level`.
                                    "rating": rating,
                                    "rating_level": rating_level,
                                    "alert_id": alert.id,
                                    "type": "surf_alert"
                                })
                            )
                            db.add(notification)

                            # Send push notification if enabled
                            if alert.notify_push:
                                await send_push_notification(
                                    db,
                                    alert.user_id,
                                    title=title,
                                    body=body,
                                    data={
                                        "type": "surf_alert",
                                        "spot_id": spot.id,
                                        "alert_id": alert.id
                                    }
                                )
                            
                            triggered_count += 1
                            logger.info(f"[Scheduler] Alert triggered for user {alert.user_id} at {spot.name}")
                
                except Exception as e:
                    logger.error(f"[Scheduler] Error checking spot {spot.name}: {str(e)}")
            
            await db.commit()
            logger.info(f"[Scheduler] Alert check complete. Triggered {triggered_count} alerts")
    
    except Exception as e:
        logger.error(f"[Scheduler] Error in surf alert task: {str(e)}")
