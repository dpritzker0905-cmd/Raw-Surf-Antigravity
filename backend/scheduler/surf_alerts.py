"""Surf alert checking — runs every 15 minutes."""
import logging
import json

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
    """Check every 15 minutes; shared database cooldown owns each emission."""
    from database import async_session_maker
    from sqlalchemy import select
    from sqlalchemy.orm import selectinload
    from models import SurfAlert, Notification
    from routes.surf_data.alerts import surf_alert_body
    from services.surf_alert_delivery import claim_alert_delivery

    logger.info("[Scheduler] Running surf alert check...")
    try:
        async with async_session_maker() as db:
            result = await db.execute(
                select(SurfAlert).where(SurfAlert.is_active.is_(True))
                .options(selectinload(SurfAlert.spot), selectinload(SurfAlert.user))
            )
            spot_alerts = {}
            for alert in result.scalars().all():
                if alert.spot:
                    spot_alerts.setdefault(alert.spot_id, []).append(alert)
            pending_pushes = []
            triggered_count = 0
            prepared = []
            for spot_id, alerts in spot_alerts.items():
                spot = alerts[0].spot
                try:
                    conditions = await point_resolution_service.resolve_spot_conditions(
                        model="GFS", lat=spot.latitude, lng=spot.longitude, forecast_days=1,
                        spot_id=spot_id
                    )
                except Exception:
                    logger.exception("[Scheduler] Error resolving spot %s", spot_id)
                    continue
                current = (conditions or {}).get("current_conditions")
                if not isinstance(current, dict):
                    continue
                prepared.append((spot_id, spot, alerts, current))
            # Never wait for forecast I/O while holding a delivery write lock.
            for spot_id, spot, alerts, current in prepared:
                for alert in alerts:
                    if not await claim_alert_delivery(db, alert, current):
                        continue
                    height = current["wave_height_ft"]
                    period = current.get("wave_period") or 0
                    rating, level = current.get("rating"), current.get("rating_level")
                    body = surf_alert_body(height, period, rating, level)
                    title = f"🌊 {spot.name} — {height:.1f}ft"
                    db.add(Notification(
                        user_id=alert.user_id, type="surf_alert", title=title, body=body,
                        data=json.dumps({
                            "spot_id": spot_id, "spot_name": spot.name,
                            "wave_height_ft": round(height, 1), "wave_period": period,
                            "rating": rating, "rating_level": level,
                            "alert_id": alert.id, "type": "surf_alert"
                        })
                    ))
                    if alert.notify_push:
                        pending_pushes.append((alert.user_id, title, body, {
                            "type": "surf_alert", "spot_id": spot_id, "alert_id": alert.id
                        }))
                    triggered_count += 1
            # Claim + in-app record are one transaction. External transport cannot
            # escape a failed commit. Push remains best effort; no durable outbox.
            await db.commit()
            for user_id, title, body, payload in pending_pushes:
                try:
                    await send_push_notification(db, user_id, title=title, body=body, data=payload)
                except Exception:
                    logger.exception("[Scheduler] Push failed for committed surf alert")
            if pending_pushes:
                # Persist 410 subscription deactivation performed by the transport.
                await db.commit()
            logger.info("[Scheduler] Alert check complete. Triggered %s alerts", triggered_count)
    except Exception:
        logger.exception("[Scheduler] Error in surf alert task")
