"""forecast_tier_window.py: how many hours of daily hub rows a tier is sent (spot-hub phase 1, 2026-11-03).

WHY. The hub endpoints (`/explore/spot-details`, `/explore/surf-spots`) computed a tier ladder of their own
(free 3 / paid 7 / premium 10 "days after today") and then sent ALL ten daily rows to every tier anyway, "so we
can show locked previews": a free client received premium's days and was trusted to hide them. The app's
authority for a forecast window is the frontend resolver, `LayerAccessResolver.resolveForecastWindow`
(TIER_ACCESS.forecastDays, clamped by /capabilities), which is what the map's picker and scrubber obey.

This module is that resolver's server-side ECHO, not a second ladder: the numbers are pinned to the JS file by
`tests/test_forecast_tier_window.py`, and capabilities.py stays the only horizon source. It exists so a
server stops SENDING rows the client would lock; it does not decide what a tier may see.

⚠️ THE WINDOW IS ROLLING, as the scrubber's is: free = the next 72 h. A daily row stands for its 12:00 UTC
sample (spot_conditions.py builds them that way), and is sent when that sample is at most `days * 24` hours
from now. "Calendar today + 2" would be a different rule, and is an owner decision still open.
⚠️ THE TIER IS CLIENT-ASSERTED (`?subscription_tier=`). This trims what an honest client is sent; it is not
entitlement enforcement. That needs server-side identity and is out of scope here.

Kill switch: SPOT_FORECAST_TIER_HORIZON=0 sends every row again (the previous payload), read at call time.

CIVIL ROWS (location_time phase 1, 2026-11-10). A hub row grouped by CIVIL date carries `day_end_utc`,
`last_frame_utc` (its latest planned frame) and `solar_utc_offset_hours`. Its civil date can sit a day away from the
solar date the rule above was written for (Apia +13 civil vs -11 solar), so judging it by its own date's 12:00 UTC
under-sent a dateline spot's window by a row and, where civil runs behind solar, could expose frames solar never
sent. Such a row is judged by the SOLAR row that holds its last frame: it is sent iff that solar row would be. A civil
day that straddles two solar days also carries `tier_head` (the same day built from only its earlier solar day's
frames, `truncated_for_tier`): when only that earlier solar day is inside the window, the head is sent in the row's
place. So the frames a tier receives with civil rows are always a subset of the frames it received with solar rows -
no added exposure - and a straddle never costs a tier a whole day (Kathmandu, +05:45 vs solar +6). By construction (pinned in tests/test_location_time_invariance.py over 24 hours x tiers x dateline and
both offset directions). A civil row whose fields do not parse is withheld, never sent.
"""
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional, Tuple

# MIRROR of frontend/src/components/map/LayerAccessResolver.js TIER_ACCESS[*].forecastDays.
TIER_FORECAST_DAYS = {"guest": 3, "free": 3, "basic": 7, "premium": 14}
# MIRROR of TIER_ACCESS[*].models: getAllowedModels() before its capabilities filter (forecast-window alerts pick
# a model lane with it, 2026-11-03). Pinned to the JS by tests/test_forecast_tier_window.py, like the days.
TIER_MODELS = {"guest": ("GFS",), "free": ("GFS",), "basic": ("GFS", "EURO", "ICON"),
               "premium": ("GFS", "EURO", "ICON")}
# The hub's rows are wave rows: clamp by the model's `waves` capability row, as the client does.
CAPABILITY_LAYER = "waves"


def tier_horizon_enabled() -> bool:
    return os.environ.get("SPOT_FORECAST_TIER_HORIZON", "1") != "0"


def canonical_tier(tier: Any) -> str:
    """LayerAccessResolver.getUserTier for a tier string (the same substring rules, the same 'guest' default)."""
    s = str(tier or "guest").lower()
    if "free" in s or s == "tier_1":
        return "free"
    if "basic" in s or "paid" in s or s == "tier_2":
        return "basic"
    if "premium" in s or "pro" in s or "parent" in s or "admin" in s or s in ("tier_3", "tier_4"):
        return "premium"
    return "guest"


def allowed_models(tier: Any) -> Tuple[str, ...]:
    """getAllowedModels(tier) without the capabilities cross-check (callers check what they actually have)."""
    return TIER_MODELS.get(canonical_tier(tier), TIER_MODELS["free"])


def tier_horizon_hours(tier: Any, model: str = "GFS", capabilities: Optional[List[Dict[str, Any]]] = None) -> int:
    """resolveForecastWindow(tier, model, 'waves') * 24: the tier's days, clamped by the model's capability rows."""
    if capabilities is None:
        from services.weather_pipeline.capabilities import WEATHER_CAPABILITIES as capabilities
    days = TIER_FORECAST_DAYS.get(canonical_tier(tier), TIER_FORECAST_DAYS["free"])
    caps = [c for c in capabilities if str(c.get("model", "")).upper() == str(model or "GFS").upper()]
    layer_caps = ([c for c in caps if str(c.get("layer", "")).lower() == CAPABILITY_LAYER]
                  or [c for c in caps if str(c.get("domain", "")).lower() == CAPABILITY_LAYER])
    if layer_caps:
        caps = layer_caps
    if caps:
        max_hours = max(int(c.get("max_forecast_hours") or 0) for c in caps)
        if max_hours > 0:
            days = min(days, max_hours // 24)
    return days * 24


def days_allowed(tier: Any, model: str = "GFS") -> int:
    """The payload's initial `forecast_days_allowed`: the resolver's day count, or, with the kill switch off, the
    exact figure the endpoints used to send (the retired 3 / 7 / 10 ladder, kept ONLY as that rollback)."""
    if tier_horizon_enabled():
        return tier_horizon_hours(tier, model) // 24
    if tier in ("paid", "basic"):
        return 7
    if tier in ("premium", "pro", "gold"):
        return 10
    return 3


def _row_instant(date_id: Any) -> Optional[datetime]:
    try:
        d = datetime.strptime(str(date_id), "%Y-%m-%d")
    except (TypeError, ValueError):
        return None
    return d.replace(hour=12, tzinfo=timezone.utc)


def _civil_row_instant(row: Dict[str, Any]) -> Optional[datetime]:
    """The 12:00 UTC sample of the solar date that holds this civil row's last planned frame (see the header)."""
    try:
        off = int(row["solar_utc_offset_hours"])
        ref = row.get("last_frame_utc")
        if ref:
            last = datetime.fromisoformat(str(ref).replace("Z", "+00:00"))
        else:                                   # no planned frame: the last instant of the civil day stands in
            last = datetime.fromisoformat(str(row["day_end_utc"]).replace("Z", "+00:00")) - timedelta(seconds=1)
        solar_day = (last.astimezone(timezone.utc) + timedelta(hours=off)).date()
    except (KeyError, TypeError, ValueError):
        return None
    return datetime(solar_day.year, solar_day.month, solar_day.day, 12, tzinfo=timezone.utc)


def split_forecast_rows(rows: Iterable[Dict[str, Any]], horizon_hours: int,
                        now: Optional[datetime] = None) -> Tuple[List[Dict[str, Any]], List[str]]:
    """(rows to send, dates withheld). A withheld row is named by its date only, so the client can still draw the
    locked preview without being sent the forecast. A row with no parseable date is DROPPED (Reflection review,
    2026-11-03): it cannot be placed inside or outside any window, so sending it would bypass the window, and the
    client's splitForecastWindow skips such a row anyway. spot_conditions.py always writes YYYY-MM-DD."""
    now = now or datetime.now(timezone.utc)
    limit = now + timedelta(hours=horizon_hours)
    sent, withheld = [], []
    for row in rows or []:
        at = _row_instant(row.get("date") if isinstance(row, dict) else None)
        if at is None:
            continue
        if "day_end_utc" in row:                                # a civil row: judged by its last frame's solar day
            civil_at = _civil_row_instant(row)
            at = civil_at if civil_at is not None else limit + timedelta(days=1)   # unparseable: withheld
            head = row.get("tier_head")
            row = {k: v for k, v in row.items() if k != "tier_head"}            # never sent on; the head stands alone
            if at > limit and isinstance(head, dict):
                head_at = _civil_row_instant(head)
                if head_at is not None and head_at <= limit:
                    sent.append(head)
                    continue
        if at > limit:
            withheld.append(row["date"])
        else:
            sent.append(row)
    return sent, withheld


def apply_tier_window(payload: Dict[str, Any], tier: Any, model: str, now: Optional[datetime] = None) -> None:
    """Trim `payload["forecast"]` to the tier's window in place, naming what was withheld. Additive keys:
    `forecast_horizon_hours`, `forecast_locked_dates`; `forecast_days_allowed` becomes the count of rows sent."""
    if not tier_horizon_enabled():
        return
    hours = tier_horizon_hours(tier, model)
    sent, withheld = split_forecast_rows(payload.get("forecast") or [], hours, now)
    payload["forecast"] = sent
    payload["forecast_locked_dates"] = withheld
    payload["forecast_horizon_hours"] = hours
    # What an older client slices by: the rows it was actually sent, so its "N Days" badge counts what exists
    # (premium's 14-day window meets at most 10 daily rows today). With no rows it is the window's day count.
    payload["forecast_days_allowed"] = len(sent) if sent else hours // 24
