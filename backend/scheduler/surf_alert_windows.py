"""Forecast-window surf alerts: the ALERTS_FORECAST_WINDOWS='1' branch of check_surf_alerts_task.

The decision is `services.surf_alert_windows.decide` (pure); the forecast is the precomputed horizon object
(`services.weather_pipeline.alert_horizon`, rated on the GitHub runner). This loop does no forecast compute:
one cached Storage read, one alert query, one notification query, and arithmetic. With the flag off it is
never imported (scheduler/surf_alerts.py), so today's loop runs unchanged.

The sent-alert store is the `notifications` table itself (no new table, no migration): every window sent is a
`surf_alert` row whose JSON `data` carries `alert_window` {start, end, local_offset_h}; `created_at` is the send
time. Each run reads the last 10 days of those rows back, and:

- Same-window suppression (default; `ALERTS_WINDOW_SUPPRESSION=0` is the kill switch back to #704): a window that
  overlaps, or sits within `ALERTS_WINDOW_MERGE_GAP_H` of, a window already sent to this USER for this SPOT (by any
  of their alerts) is not sent again, so a forecast cycle that splits or shifts a session does not re-alert.
- Daily cap: at most `ALERTS_MAX_PER_USER_DAY` (2) window alerts per user per local day, spent best-rated first
  across all of the user's alerts; the in-memory record is updated after every send of the run.
- Across overlapping runs: the scheduler job has max_instances=1 (scheduler/__init__.py), and the claim below is
  the same atomic UPDATE ... RETURNING the legacy path uses (row lock + cooldown), committed with the in-app row.
  Two PROCESSES running the job at once could each spend one cap slot (cap + 1); one alert is still never
  claimed twice in one cooldown. A committed row counts as sent even if its push then failed (in-app it is there).
"""
import asyncio
import json
import logging
from collections import Counter
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, or_, update

logger = logging.getLogger(__name__)
NOTIFICATION_TYPE = "surf_alert"


def sent_records(rows):
    """[{user_id, alert_id, spot_id, start, end, sent_at}] from (user_id, data, created_at) notification rows.
    Unparseable rows and rows without a window are skipped (a legacy height alert is not a window)."""
    from services.surf_alert_windows import parse_time
    out = []
    for user_id, data, created_at in rows:
        try:
            d = json.loads(data) if isinstance(data, str) else (data or {})
            w = d.get("alert_window") or {}
            a, b = parse_time(w.get("start")), parse_time(w.get("end"))
            sent_at = parse_time(created_at) if created_at else None
        except Exception:
            continue
        if a and b:
            out.append({"user_id": user_id, "alert_id": d.get("alert_id"), "spot_id": d.get("spot_id"),
                        "start": a, "end": b, "sent_at": sent_at})
    return out


def sent_for(records, alert, suppress):
    """The windows that count as already sent for this alert: this user's at this spot (suppression on), or
    this alert's own (the kill switch, #704's rule)."""
    if suppress:
        return [(r["start"], r["end"]) for r in records
                if r["user_id"] == alert.user_id and r["spot_id"] == alert.spot_id]
    return [(r["start"], r["end"]) for r in records if r["alert_id"] == alert.id]


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
    from services.surf_alert_windows import (admit, decide, parse_time, rank_best_first, suppression_enabled,
                                             window_message)
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
            suppress = suppression_enabled()
            since = now - timedelta(days=10)
            rows = await db.execute(
                select(Notification.user_id, Notification.data, Notification.created_at).where(
                    Notification.type == NOTIFICATION_TYPE,
                    Notification.user_id.in_({a.user_id for a in alerts}),
                    Notification.created_at >= since,
                    Notification.data.like('%"alert_window"%')))
            records = sent_records(rows.all())
            pending, fired = [], []
            for alert in alerts:
                d = decide(alert, alert.spot, horizon, now, notified=sent_for(records, alert, suppress),
                           subscription_tier=getattr(alert.user, "subscription_tier", None),
                           lane=getattr(alert, "model", None), capabilities=capabilities)
                reasons[d["reason"]] += 1
                if not d["fire"]:
                    logger.debug("[Scheduler] Alert %s: no window (%s)", alert.id, d["reason"])
                    continue
                fired.append((alert, d))
            # Best-rated first across ALL of a user's alerts, so the daily cap is spent on the best windows; the
            # gate is re-read after every send of this run (records grows as it sends).
            for alert, d in rank_best_first(fired, window_of=lambda ad: ad[1]["window"]):
                user_sent = [r["sent_at"] for r in records if r["user_id"] == alert.user_id]
                ok, why = admit(d["window"], sent_for(records, alert, suppress), user_sent, now)
                if not ok:
                    reasons[why] += 1
                    continue
                if not await claim_window_delivery(db, alert, now):
                    reasons["cooldown_or_changed"] += 1
                    continue
                w = d["window"]
                records.append({"user_id": alert.user_id, "alert_id": alert.id, "spot_id": alert.spot_id,
                                "start": parse_time(w["start"]), "end": parse_time(w["end"]), "sent_at": now})
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
