"""Forecast-window surf alerts: the ALERTS_FORECAST_WINDOWS='1' branch of check_surf_alerts_task.

The decision is `services.surf_alert_windows.decide` (pure); the forecast is the precomputed horizon object
(`services.weather_pipeline.alert_horizon`, rated on the GitHub runner). This loop does no forecast compute:
one cached Storage read, one alert query, one notification query, and arithmetic. With the flag off it is
never imported (scheduler/surf_alerts.py), so today's loop runs unchanged.

De-duplication is two-layered. Across runs: a window that OVERLAPS any window already notified for the same
alert (read back from that user's recent `surf_alert` notifications) is not sent again, so a forecast that
nudges 07-10 to 06-10 does not re-alert. Across overlapping processes: the claim below is the same atomic
UPDATE ... RETURNING the legacy path uses (row lock + cooldown), committed in the same transaction as the
in-app record, so two workers cannot both claim one alert in one cooldown.
"""
import asyncio
import json
import logging
from collections import Counter
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, or_, update

logger = logging.getLogger(__name__)
NOTIFICATION_TYPE = "surf_alert"


def notified_windows(rows, alert_ids):
    """{alert_id: [(start, end), ...]} from notification `data` JSON strings. Unparseable rows are skipped."""
    from services.surf_alert_windows import parse_time
    out = {}
    for data in rows:
        try:
            d = json.loads(data) if isinstance(data, str) else (data or {})
            w = d.get("alert_window") or {}
            a, b = parse_time(w.get("start")), parse_time(w.get("end"))
        except Exception:
            continue
        if a and b and d.get("alert_id") in alert_ids:
            out.setdefault(d["alert_id"], []).append((a, b))
    return out


async def claim_window_delivery(db, alert, now):
    """Reserve one emission (cooldown + unchanged size bounds), in the caller's transaction."""
    from models import SurfAlert
    from services.surf_alert_delivery import cooldown_seconds
    cutoff = now - timedelta(seconds=cooldown_seconds())
    result = await db.execute(
        update(SurfAlert)
        .where(
            SurfAlert.id == alert.id,
            SurfAlert.user_id == alert.user_id,
            SurfAlert.spot_id == alert.spot_id,
            SurfAlert.is_active.is_(True),
            SurfAlert.min_wave_height == alert.min_wave_height,
            SurfAlert.max_wave_height == alert.max_wave_height,
            or_(SurfAlert.last_triggered.is_(None), SurfAlert.last_triggered <= cutoff),
        )
        .values(last_triggered=now, trigger_count=func.coalesce(SurfAlert.trigger_count, 0) + 1)
        .returning(SurfAlert.id)
        .execution_options(synchronize_session=False)
    )
    return result.scalar_one_or_none() is not None


def notification_payload(alert, spot, decision):
    w = decision["window"]
    return {
        "spot_id": alert.spot_id, "spot_name": spot.name, "alert_id": alert.id, "type": NOTIFICATION_TYPE,
        # The legacy keys, so every existing reader of a surf_alert row keeps working (peak hour of the window).
        "wave_height_ft": w["height_ft_max"], "wave_period": w.get("period_s"),
        "rating": w.get("rating"), "rating_level": w.get("rating_level"),
        "alert_window": {**w, "model": decision["model"], "model_source": decision["model_source"],
                         "horizon_h": decision["horizon_h"], "local_time_basis": "nautical_zone",
                         "unevaluated_conditions": decision.get("unevaluated_conditions", [])},
    }


async def check_surf_alert_windows_task(now=None, load_horizon=None, capabilities=None):
    from database import async_session_maker
    from sqlalchemy import select
    from sqlalchemy.orm import selectinload
    from models import SurfAlert, Notification
    from services.surf_alert_windows import decide, window_message
    from .base import send_push_notification

    now = now or datetime.now(timezone.utc)
    if load_horizon is None:
        from services.weather_pipeline.alert_horizon import load_alert_horizon_cached as load_horizon
    horizon = await asyncio.to_thread(load_horizon)
    if capabilities is None:
        try:
            from services.weather_pipeline.capabilities import get_weather_capabilities
            capabilities = get_weather_capabilities()
        except Exception:
            capabilities = []
    reasons = Counter()
    try:
        async with async_session_maker() as db:
            result = await db.execute(
                select(SurfAlert).where(SurfAlert.is_active.is_(True))
                .options(selectinload(SurfAlert.spot), selectinload(SurfAlert.user)))
            alerts = [a for a in result.scalars().all() if a.spot]
            if not alerts:
                return
            if horizon is None:
                logger.warning("[Scheduler] Alert windows: horizon object unavailable; %d alerts NOT evaluated "
                               "(fail safe, nothing sent).", len(alerts))
                return
            ids = {a.id for a in alerts}
            since = now - timedelta(days=10)
            rows = await db.execute(
                select(Notification.data).where(
                    Notification.type == NOTIFICATION_TYPE,
                    Notification.user_id.in_({a.user_id for a in alerts}),
                    Notification.created_at >= since,
                    Notification.data.like('%"alert_window"%')))
            notified = notified_windows(rows.scalars().all(), ids)
            pending = []
            for alert in alerts:
                d = decide(alert, alert.spot, horizon, now, notified=notified.get(alert.id, ()),
                           subscription_tier=getattr(alert.user, "subscription_tier", None),
                           lane=getattr(alert, "model", None), capabilities=capabilities)
                reasons[d["reason"]] += 1
                if not d["fire"]:
                    logger.debug("[Scheduler] Alert %s: no window (%s)", alert.id, d["reason"])
                    continue
                if not await claim_window_delivery(db, alert, now):
                    reasons["cooldown_or_changed"] += 1
                    continue
                body = window_message(alert.spot.name, d["window"])
                title = f"🌊 Good window at {alert.spot.name}"
                payload = notification_payload(alert, alert.spot, d)
                db.add(Notification(user_id=alert.user_id, type=NOTIFICATION_TYPE, title=title, body=body,
                                    data=json.dumps(payload)))
                if alert.notify_push:
                    pending.append((alert.user_id, title, body, {
                        "type": NOTIFICATION_TYPE, "spot_id": alert.spot_id, "alert_id": alert.id}))
            await db.commit()
            for user_id, title, body, push in pending:
                try:
                    await send_push_notification(db, user_id, title=title, body=body, data=push)
                except Exception:
                    logger.exception("[Scheduler] Push failed for committed window alert")
            if pending:
                await db.commit()
    except Exception:
        logger.exception("[Scheduler] Error in surf alert window task")
    finally:
        if reasons:
            missing = sum(reasons.get(k, 0) for k in ("no_forecast_for_spot", "no_forecast_in_horizon",
                                                       "horizon_stale", "horizon_unavailable"))
            # Missing forecast is a lane failure (producer truncated or stale), not "no surf": say so loudly.
            (logger.warning if missing else logger.info)(
                "[Scheduler] Alert windows: %s%s", dict(sorted(reasons.items())),
                f" ({missing} alerts had NO forecast: check the alert-horizon producer)" if missing else "")
