"""Surf alert checking — runs every 15 minutes."""
import logging
import json
from datetime import datetime, timezone
import httpx

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
    
    logger.info("[Scheduler] Running surf alert check...")
    
    OPEN_METEO_MARINE_URL = "https://marine-api.open-meteo.com/v1/marine"
    
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
            
            async with httpx.AsyncClient(timeout=10.0) as client:
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
                        # Fetch current conditions
                        response = await client.get(OPEN_METEO_MARINE_URL, params={
                            "latitude": spot.latitude,
                            "longitude": spot.longitude,
                            "current": "wave_height",
                            "timezone": "America/New_York"
                        })
                        
                        if response.status_code != 200:
                            continue
                        
                        wave_data = response.json()
                        wave_height_m = wave_data.get("current", {}).get("wave_height", 0)
                        wave_height_ft = wave_height_m * 3.28084 if wave_height_m else 0
                        
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
                                notification = Notification(
                                    user_id=alert.user_id,
                                    type="surf_alert",
                                    title=f"ðŸŒŠ {spot.name} is firing!",
                                    body=f"Waves are {wave_height_ft:.1f}ft - perfect conditions!",
                                    data=json.dumps({
                                        "spot_id": spot.id,
                                        "spot_name": spot.name,
                                        "wave_height_ft": round(wave_height_ft, 1),
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
                                        title=f"ðŸŒŠ {spot.name} is firing!",
                                        body=f"Waves are {wave_height_ft:.1f}ft - Go get some!",
                                        data={
                                            "type": "surf_alert",
                                            "spot_id": spot.id
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
