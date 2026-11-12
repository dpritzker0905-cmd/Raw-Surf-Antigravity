"""surf_alert_windows.py: forecast-window surf alerts (DARK: ALERTS_FORECAST_WINDOWS, default '0').

WHAT WAS WRONG (verified on dev dfed518e8, 2026-11-03). The 15-minute alert loop resolved CURRENT conditions
only, on a hardcoded model="GFS" (`scheduler/surf_alerts.py`), and fired on min/max height alone
(`services/surf_alert_delivery.claim_alert_delivery`). The `time_windows`, `tide_states` and
`preferred_conditions` a user saves on an alert (`models/surf_alerts.SurfAlert`) were stored and never read: a
"dawn, offshore, low tide" alert fired at 3 a.m. in an onshore gale on a high tide.

WHAT THIS DOES (pure: no I/O, no network, no DB). Given the SERVED rating frames for one spot over the next
hours (the precomputed `spot_ratings.rate_one_spot` output, see `weather_pipeline/alert_horizon.py`), it finds
daylight windows that satisfy EVERY saved preference, and picks the earliest one not already notified.

    window = maximal run of consecutive local hours h, length >= ALERTS_WINDOW_MIN_HOURS, where every h is
      daylit (sun above the horizon at mid-hour: sim_daylight's solar position, sunrise..sunset),
      inside one of the alert's time_windows (none saved = any daylit hour),
      breaking height in [min, max] ft (the served `surf_height_m`, never the offshore Hs),
      level >= ALERTS_WINDOW_MIN_LEVEL (default 'fair'; a "good window" alert must not announce a poor hour),
      tide in one of the saved tide_states (level bands from surf_rating.parse_best_tide, trend from tide.py),
      wind meeting every saved condition axis (OR inside an axis, AND across axes; see CONDITION_AXES).

★ ONE FORECAST COMPOSITION. Nothing here computes a height or a rating: both are read from frames that
`rate_one_spot` produced (with the observation gate applied, as the glyphs are). The wind classes reuse the
engine's own definitions (`surf_rating.offshoreness`, the 0.34 split of `spot_ratings.rating_why`).

⚠️ LOCAL TIME IS APPROXIMATE. Spots carry no timezone (models/spots.py) and the backend has no tz database for
coordinates, so the alert's clock windows use the nautical zone round(lng / 15) h, which equals the standard
civil zone along most surf coasts (US East -5, US West -8, Bali +8, Gold Coast +10) but can be 1-2 h off under
DST or a political zone (Portugal, Spain, Hawaii -11 vs -10). Daylight itself uses the true sun, so a window is
never in the dark. A stored spot timezone is the follow-up that removes this caveat.
"""
from services import runtime_flags as _rf  # D-065: guarded flags read env > manifest > code default
import logging
import math
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

from services import forecast_tier_window as FTW
from services.weather_pipeline import sim_daylight
from services.weather_pipeline import surf_rating as SR

logger = logging.getLogger(__name__)

FLAG = "ALERTS_FORECAST_WINDOWS"
M_TO_FT = 3.28084


def enabled() -> bool:
    """Read at call time (a Render env flip needs no redeploy of this module)."""
    return _rf.flag(FLAG) == "1"


def _env_int(name: str, default: int, lo: int, hi: int) -> int:
    try:
        value = int(os.environ.get(name, str(default)))
    except (TypeError, ValueError):
        return default
    return default if not lo <= value <= hi else value


def configured_horizon_h() -> int:
    """How far ahead alerts look. 72 h by default; an operator may set 6..168 (the tier still caps it)."""
    return _env_int("ALERTS_FORECAST_HORIZON_H", 72, 6, 168)


def min_window_hours() -> int:
    return _env_int("ALERTS_WINDOW_MIN_HOURS", 2, 1, 6)


def max_horizon_age_h() -> int:
    """A horizon object older than this is not a forecast any more: fail safe, fire nothing."""
    return _env_int("ALERTS_HORIZON_MAX_AGE_H", 12, 1, 48)


def notify_lead_h() -> int:
    """Send a window only once it starts within this many hours (0 = as soon as it enters the horizon). 24 by
    default, MEASURED in the offline replay (scripts/alert_window_replay.py, calibrated error, hourly frames):
    precision 0.25/0.57/0.65 -> 0.44/0.67/0.73 across the three alert types, recall 0.98 -> 0.93-0.96, half the
    sends. The window still arrives the day before; it is sent on a forecast a day younger."""
    return _env_int("ALERTS_NOTIFY_LEAD_H", 24, 0, 168)


def suppression_enabled() -> bool:
    """ALERTS_WINDOW_SUPPRESSION: '0' is the kill switch back to #704's de-dup (per alert, overlap only, no
    collapse, no cap). Anything else (default) applies collapse + same-window suppression + the daily cap."""
    return os.environ.get("ALERTS_WINDOW_SUPPRESSION", "1") != "0"


def merge_gap_h() -> int:
    """Windows of one spot whose gap is <= this many hours are ONE window (forecast noise splits a session).
    1 by default, chosen from the replay (scripts/alert_window_replay.py): the smallest gap that brings the
    perfect-forecast control to <= 2 sends per user-day without the cap; precision is flat in the gap (0.74-0.76
    for size-only at calibrated error, gaps 0-4) while recall falls as it grows (0.929 / 0.920 / 0.905 / 0.895)."""
    return _env_int("ALERTS_WINDOW_MERGE_GAP_H", 1, 0, 6)


def max_per_user_day() -> int:
    """Window alerts per user per local day (the nautical zone of the spot being sent). 0 = no cap."""
    return _env_int("ALERTS_MAX_PER_USER_DAY", 2, 0, 24)


def min_level() -> str:
    value = os.environ.get("ALERTS_WINDOW_MIN_LEVEL", "fair")
    return value if value in SR.LEVELS else "fair"


# ── MIRRORS of the alert UI, each pinned to its source by tests/test_surf_alert_windows_contract.py ──────
# frontend/src/components/alerts/surfAlertConstants.js TIME_WINDOWS (the labels the user picked from).
TIME_WINDOW_HOURS = {"dawn": (5, 8), "morning": (8, 12), "afternoon": (12, 17), "evening": (17, 20)}
TIDE_LEVEL_STATES = ("low", "mid", "high")
TIDE_TREND_STATES = ("rising", "falling")

# ⛔ TIER POLICY lives in LayerAccessResolver.js (CLAUDE.md). The backend has ONE echo of it,
# services/forecast_tier_window.py (days + models, pinned to the JS by tests/test_forecast_tier_window.py);
# alerts read that echo and keep no ladder of their own.
canonical_tier = FTW.canonical_tier


def horizon_h(subscription_tier: Optional[str], model: str, capabilities=None) -> int:
    """min(configured, the resolver's window for this tier and model: tier days x 24, clamped by capabilities)."""
    return min(configured_horizon_h(), FTW.tier_horizon_hours(subscription_tier, model, capabilities))


def resolve_model_lane(lane: Optional[str], subscription_tier: Optional[str],
                       available: Sequence[str], default_model: Optional[str]) -> Tuple[Optional[str], str]:
    """(model, source). The user's own lane first, when one is stored AND their tier permits it AND the
    horizon has frames for it; otherwise the served default the producer stamped. ⚠️ No lane is persisted
    server-side today (the client keeps it in localStorage `rawsurf-active-model`), so every alert currently
    resolves to the served default. Nothing here names a model: the default comes from the producer's config.
    """
    permitted = set(FTW.allowed_models(subscription_tier))
    have = [str(m).upper() for m in available or ()]
    want = (lane or "").strip().upper()
    if want and want in have and want in permitted:
        return want, "user_lane"
    default = (default_model or "").strip().upper()
    if default and default in have and default in permitted:
        return default, "served_default"
    for m in have:
        if m in permitted:
            return m, "first_permitted"
    return None, "no_permitted_lane"


# ── PREFERENCES ──────────────────────────────────────────────────────────────────────────────────────────
GLASSY_KT = 3.0        # surf_rating.wind_quality: "spd_kt < 3.0 -> glassy: clean regardless of direction"
LIGHT_WIND_KT = 10.0   # the alert UI's own definition of "Light Wind": "Under 10 knots"
CLEAN_CALM_KT = 5.0    # clean = < 5 kt, or offshore <= 20 kt (the 2026-11-03 diurnal-wind study's definition)
CLEAN_OFFSHORE_MAX_KT = 20.0
DIRECTION_SPLIT = 0.34  # offshoreness split used by spot_ratings.rating_why (offshore / cross-shore / onshore)

CONDITION_AXES = {
    "surface": ("glassy", "clean", "choppy"),
    "wind_direction": ("offshore", "onshore", "cross-shore"),
    "wind_speed": ("light-wind", "no-wind"),
}
# Saved conditions the served frames cannot see (wave shape, crowd). They never gate and are reported.
UNEVALUATED_CONDITIONS = ("messy", "hollow", "steep", "mellow", "powerful", "peaky", "walled", "uncrowded")


def _as_list(value) -> List[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [value] if value.strip() else []
    return [str(v) for v in value if v is not None and str(v).strip()]


def _finite(x) -> bool:
    return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x)


def wind_classes(entry: Dict[str, Any]) -> Optional[set]:
    """The condition ids this hour's served wind satisfies, or None when the frame has no wind."""
    inputs = entry.get("inputs") or {}
    ms, frm, normal = inputs.get("wind_ms"), inputs.get("wind_from_deg"), inputs.get("shore_normal_deg")
    if not _finite(ms):
        return None
    kt = ms * SR.MS_TO_KT
    out = set()
    if kt < GLASSY_KT:
        out |= {"glassy", "no-wind"}
    if kt < LIGHT_WIND_KT:
        out.add("light-wind")
    off = SR.offshoreness(frm, normal) if _finite(frm) and _finite(normal) else None
    if off is not None:
        out.add("offshore" if off > DIRECTION_SPLIT else ("onshore" if off < -DIRECTION_SPLIT else "cross-shore"))
    clean = kt < CLEAN_CALM_KT or (off is not None and off > DIRECTION_SPLIT and kt <= CLEAN_OFFSHORE_MAX_KT)
    out.add("clean" if clean else "choppy")
    return out


def conditions_ok(entry: Dict[str, Any], wanted: Iterable[str]) -> bool:
    wanted = set(wanted)
    axes = [set(ids) & wanted for ids in CONDITION_AXES.values()]
    axes = [a for a in axes if a]
    if not axes:
        return True
    have = wind_classes(entry)
    if have is None:
        return False   # unknown wind never satisfies a wind preference (fail safe)
    if any(not (a & have) for a in axes):
        return False
    # A direction class needs a known coast orientation; it was absent -> the axis was not satisfied above.
    return True


def tide_ok(entry: Dict[str, Any], states: Iterable[str]) -> bool:
    states = set(states)
    levels, trends = states & set(TIDE_LEVEL_STATES), states & set(TIDE_TREND_STATES)
    if not levels and not trends:
        return True
    tide = entry.get("tide") if isinstance(entry.get("tide"), dict) else None
    if tide is None:
        return False   # no tide in the frame (RATING_TIDE off, or beyond the tide series) -> not satisfied
    if levels:
        norm = tide.get("norm")
        if not _finite(norm):
            return False
        bands = [SR.parse_best_tide(name) for name in levels]
        if not any(b and b[0] <= norm <= b[1] for b in bands):
            return False
    if trends and tide.get("trend") not in trends:
        return False
    return True


def size_ok(entry: Dict[str, Any], low, high) -> bool:
    h = entry.get("surf_height_m")
    if not _finite(h) or h < 0:
        return False
    ft = h * M_TO_FT
    return not ((low is not None and ft < low) or (high is not None and ft > high))


def level_ok(entry: Dict[str, Any], floor: str) -> bool:
    level = entry.get("level")
    return level in SR.LEVELS and SR.LEVELS.index(level) >= SR.LEVELS.index(floor)


def config_error(alert) -> Optional[str]:
    low, high = getattr(alert, "min_wave_height", None), getattr(alert, "max_wave_height", None)
    for v in (low, high):
        if v is not None and (not _finite(v) or v < 0):
            return "invalid_size_bounds"
    if low is not None and high is not None and low > high:
        return "invalid_size_bounds"
    unknown = [w for w in _as_list(getattr(alert, "time_windows", None)) if w not in TIME_WINDOW_HOURS]
    if unknown and len(unknown) == len(_as_list(getattr(alert, "time_windows", None))):
        return "unknown_time_windows"
    return None


# ── TIME ─────────────────────────────────────────────────────────────────────────────────────────────────
def local_offset_h(lng: float) -> int:
    """Nautical zone, see the module header's caveat."""
    return int(max(-12, min(14, round(float(lng) / 15.0))))


def parse_time(value) -> Optional[datetime]:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    return sim_daylight.parse_hour(value) if value else None


def daylit(lat: float, lng: float, slot_start: datetime) -> bool:
    """Sun above the horizon (sunrise..sunset convention, -0.833 deg) at the middle of the hour."""
    state, _el = sim_daylight.light_state(float(lat), float(lng), slot_start + timedelta(minutes=30))
    return state == sim_daylight.DAY


def in_time_windows(local_hour: int, windows: Sequence[str]) -> bool:
    known = [TIME_WINDOW_HOURS[w] for w in windows if w in TIME_WINDOW_HOURS]
    if not known:
        return True
    return any(a <= local_hour < b for a, b in known)


def _series_index(horizon: Dict[str, Any]) -> Dict[Tuple[str, str], list]:
    """{(model, spot_id): [(valid_time, entry)]}, built ONCE per horizon object and memoised on it (the loader
    caches the object across runs), so a run costs one pass over the frames, not one per alert."""
    idx = horizon.get("_series_index")
    if idx is None:
        idx = {}
        for fr in horizon.get("frames") or []:
            vt = parse_time(fr.get("valid_time"))
            if vt is None:
                continue
            model = str(fr.get("model", "")).upper()
            for s in fr.get("spots") or []:
                idx.setdefault((model, str(s.get("spot_id"))), []).append((vt, s))
        for series in idx.values():
            series.sort(key=lambda p: p[0])
        horizon["_series_index"] = idx
    return idx


def spot_series(horizon: Dict[str, Any], model: str, spot_id: str) -> List[Tuple[datetime, Dict[str, Any]]]:
    """[(valid_time, spot entry)] for one spot in one model lane, time-sorted."""
    if not isinstance(horizon, dict):
        return []
    return list(_series_index(horizon).get((str(model).upper(), str(spot_id)), ()))


def nearest(series, when: datetime, hold_s: float) -> Optional[Dict[str, Any]]:
    """The served frame nearest `when` within `hold_s` (the glyph lane's own nearest-frame hold), or None."""
    best, gap = None, None
    for vt, entry in series:
        d = abs((vt - when).total_seconds())
        if d <= hold_s and (gap is None or d < gap):
            best, gap = entry, d
    return best


# ── WINDOWS ──────────────────────────────────────────────────────────────────────────────────────────────
def find_windows(alert, spot, series, now: datetime, horizon_hours: int, step_h: float = 1.0) -> Dict[str, Any]:
    """Every qualifying window in (now, now + horizon]. Returns {"windows": [...], "reason": str, ...}."""
    lat, lng = getattr(spot, "latitude", None), getattr(spot, "longitude", None)
    if not (_finite(lat) and _finite(lng)):
        return {"windows": [], "reason": "spot_has_no_coordinates"}
    err = config_error(alert)
    if err:
        return {"windows": [], "reason": err}
    if not series:
        return {"windows": [], "reason": "no_forecast_for_spot"}
    off_h = local_offset_h(lng)
    civil = _civil_zone(lat, lng)   # PRESENTATION ONLY (location_time phase 1): labels, never eligibility or splitting
    hold_s = max(1800.0, float(step_h) * 1800.0)
    tw = _as_list(getattr(alert, "time_windows", None))
    tides = _as_list(getattr(alert, "tide_states", None))
    conds = _as_list(getattr(alert, "preferred_conditions", None))
    low, high = getattr(alert, "min_wave_height", None), getattr(alert, "max_wave_height", None)
    floor = min_level()
    start = now.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)
    end = now + timedelta(hours=horizon_hours)
    windows, run, known = [], [], 0
    slot = start
    while slot < end:
        entry = nearest(series, slot + timedelta(minutes=30), hold_s)
        if entry is not None:
            known += 1
        local = slot + timedelta(hours=off_h)
        ok = (entry is not None and slot + timedelta(hours=1) > now
              and daylit(lat, lng, slot)
              and in_time_windows(local.hour, tw)
              and size_ok(entry, low, high)
              and level_ok(entry, floor)
              and tide_ok(entry, tides)
              and conditions_ok(entry, conds))
        if ok and (not run or local.date() == (run[-1][0] + timedelta(hours=off_h)).date()):
            run.append((slot, entry))
        else:
            if len(run) >= min_window_hours():
                windows.append(_summarize(run, off_h, civil))
            run = [(slot, entry)] if ok else []
        slot += timedelta(hours=1)
    if len(run) >= min_window_hours():
        windows.append(_summarize(run, off_h, civil))
    if not known:
        return {"windows": [], "reason": "no_forecast_in_horizon"}
    unevaluated = sorted(set(conds) & set(UNEVALUATED_CONDITIONS))
    return {"windows": windows, "reason": "window_found" if windows else "no_qualifying_window",
            "unevaluated_conditions": unevaluated}


def _civil_zone(lat, lng) -> Optional[str]:
    """The spot's civil IANA zone for LABELS (location_time phase 1), or None (flag off / no grid). The solar
    `local_offset_h` keeps deciding time-window membership, the local-midnight split and the daily cap."""
    try:
        from services.weather_pipeline import location_time
        lt = location_time.describe(lat, lng)
        return (lt or {}).get("iana")
    except Exception as e:                               # noqa: BLE001 - a label must never cost an alert
        logger.warning("[surf-alerts] location_time failed at (%s, %s); solar labels: %s", lat, lng, e)
        return None


def _civil_labels(start: datetime, end: datetime, iana: str) -> Dict[str, Any]:
    from services.weather_pipeline.location_time import offset_minutes
    from zoneinfo import ZoneInfo
    z = ZoneInfo(iana)
    ls, le = start.astimezone(z), end.astimezone(z)
    return {"civil_iana": iana, "civil_day": ls.strftime("%a"), "civil_start": ls.strftime("%H:%M"),
            "civil_end": le.strftime("%H:%M"), "civil_utc_offset_min": offset_minutes(iana, start)}


def _summarize(run, off_h: int, civil: Optional[str] = None) -> Dict[str, Any]:
    heights = [e["surf_height_m"] * M_TO_FT for _s, e in run]
    peak = max(run, key=lambda p: (p[1].get("score") if _finite(p[1].get("score")) else -1))[1]
    start, end = run[0][0], run[-1][0] + timedelta(hours=1)
    ls, le = start + timedelta(hours=off_h), end + timedelta(hours=off_h)
    out = {"start": start.strftime("%Y-%m-%dT%H:%M:%SZ"), "end": end.strftime("%Y-%m-%dT%H:%M:%SZ"),
           "local_day": ls.strftime("%a"), "local_start": ls.strftime("%H:%M"), "local_end": le.strftime("%H:%M"),
           "local_offset_h": off_h, "height_ft_min": round(min(heights), 1), "height_ft_max": round(max(heights), 1),
           "rating": peak.get("score"), "rating_level": peak.get("level"), "period_s": peak.get("period_s"),
           "hours": len(run)}
    if civil:
        out.update(_civil_labels(start, end, civil))
    return out


def overlaps(window: Dict[str, Any], notified: Iterable[Tuple[datetime, datetime]]) -> bool:
    a, b = parse_time(window["start"]), parse_time(window["end"])
    return any(a < nb and na < b for na, nb in notified)


def same_window(window: Dict[str, Any], notified: Iterable[Tuple[datetime, datetime]], gap_h: int) -> bool:
    """Already sent: overlaps a sent window, or sits within `gap_h` hours of one (a fragment of it).

    No rounded-start key on top: with windows >= 2 h and gap 1 h, two windows that neither overlap nor sit within
    the gap start >= 4 h apart, so a start rounded to 3 h can never match them (measured: identical replay)."""
    a, b = parse_time(window["start"]), parse_time(window["end"])
    g = timedelta(hours=gap_h)
    return any(a - nb <= g and na - b <= g for na, nb in notified)


def _rating(w: Dict[str, Any]) -> float:
    r = w.get("rating")
    return float(r) if _finite(r) else -1.0


def collapse_windows(windows: Sequence[Dict[str, Any]], gap_h: int) -> List[Dict[str, Any]]:
    """Merge one spot's windows whose gap is <= gap_h hours into one: span start..end, the best-rated part's
    rating, level and period, heights over both, `hours` = qualifying hours (the gap is not counted)."""
    out: List[Dict[str, Any]] = []
    for w in sorted(windows, key=lambda w: w["start"]):
        if out and parse_time(w["start"]) - parse_time(out[-1]["end"]) <= timedelta(hours=gap_h):
            m = dict(out[-1])
            if parse_time(w["end"]) > parse_time(m["end"]):
                m["end"] = w["end"]
                m["local_end"] = (parse_time(w["end"]) + timedelta(hours=m["local_offset_h"])).strftime("%H:%M")
                if m.get("civil_iana"):
                    m["civil_end"] = _civil_labels(parse_time(m["start"]), parse_time(m["end"]), m["civil_iana"])["civil_end"]
            m["height_ft_min"] = min(m["height_ft_min"], w["height_ft_min"])
            m["height_ft_max"] = max(m["height_ft_max"], w["height_ft_max"])
            if _rating(w) > _rating(m):
                m.update(rating=w.get("rating"), rating_level=w.get("rating_level"), period_s=w.get("period_s"))
            m["hours"] = m.get("hours", 0) + w.get("hours", 0)
            out[-1] = m
        else:
            out.append(dict(w))
    return out


def sends_today(sent_times: Iterable[datetime], now: datetime, offset_h: int) -> int:
    """How many of a user's sends fall on today's local day (in the zone `offset_h` of the spot being sent)."""
    day = (now + timedelta(hours=offset_h)).date()
    return sum(1 for t in sent_times if t is not None and (parse_time(t) + timedelta(hours=offset_h)).date() == day)


def admit(window: Dict[str, Any], same_spot_sent: Iterable[Tuple[datetime, datetime]],
          user_sent_times: Iterable[datetime], now: datetime) -> Tuple[bool, str]:
    """The per-user gate the scheduler applies AFTER decide, in best-rated order and again after every send of
    the run (so two alerts of one user on one spot cannot both announce one window): (ok, reason)."""
    if not suppression_enabled():
        return True, "ok"
    if same_window(window, same_spot_sent, merge_gap_h()):
        return False, "already_notified_same_spot"
    cap = max_per_user_day()
    if cap and sends_today(user_sent_times, now, int(window.get("local_offset_h") or 0)) >= cap:
        return False, "daily_cap"
    return True, "ok"


def rank_best_first(items, window_of=lambda x: x):
    """Best rating first, then the earliest start (deterministic): the order the daily cap is spent in."""
    return sorted(items, key=lambda x: (-_rating(window_of(x)), window_of(x)["start"]))


def format_height(lo: float, hi: float) -> str:
    lo_r, hi_r = round(lo), round(hi)
    if lo_r == hi_r:
        return f"{lo:.1f} ft" if hi < 2 else f"{hi_r} ft"
    return f"{lo_r}-{hi_r} ft"


def window_message(spot_name: str, window: Dict[str, Any]) -> str:
    """The brief's format: "Good window at {spot}: {day} {start}-{end}, {height}, {rating level}"."""
    level = (window.get("rating_level") or "").replace("_", " ").strip() or "quality unavailable"
    height = format_height(window["height_ft_min"], window["height_ft_max"])
    if window.get("civil_iana"):   # location_time phase 1: the spot's real local time
        when = f"{window['civil_day']} {window['civil_start']}-{window['civil_end']}"
    else:
        when = f"{window['local_day']} {window['local_start']}-{window['local_end']}"
    return f"Good window at {spot_name}: {when}, {height}, {level}"


def decide(alert, spot, horizon: Optional[Dict[str, Any]], now: datetime, *, notified=(),
           subscription_tier=None, lane=None, capabilities=None) -> Dict[str, Any]:
    """The whole decision for one alert. Fails SAFE: every path without a trustworthy forecast returns
    fire=False with a reason the scheduler logs. Never raises on bad data.

    `notified` = [(start, end)] already sent: with suppression on, every window this user was sent for this SPOT
    (any of their alerts); with the kill switch, this alert's own. Suppression on: collapse fragments within
    merge_gap_h, drop windows that are the same as a sent one, best-rated first. The daily cap is `admit`."""
    if not horizon or not isinstance(horizon.get("frames"), list):
        return {"fire": False, "reason": "horizon_unavailable"}
    generated = parse_time(horizon.get("generated_at"))
    if generated is None or (now - generated) > timedelta(hours=max_horizon_age_h()):
        return {"fire": False, "reason": "horizon_stale"}
    available = horizon.get("models") or sorted({str(f.get("model", "")).upper() for f in horizon["frames"]})
    model, source = resolve_model_lane(lane, subscription_tier, available, horizon.get("default_model"))
    if model is None:
        return {"fire": False, "reason": source}
    hours = horizon_h(subscription_tier, model, capabilities)
    series = spot_series(horizon, model, getattr(alert, "spot_id", None))
    found = find_windows(alert, spot, series, now, hours, float(horizon.get("step_h") or 1.0))
    base = {"model": model, "model_source": source, "horizon_h": hours,
            "windows_found": len(found["windows"]), "unevaluated_conditions": found.get("unevaluated_conditions", [])}
    if not found["windows"]:
        return {"fire": False, "reason": found["reason"], **base}
    suppress = suppression_enabled()
    windows = collapse_windows(found["windows"], merge_gap_h()) if suppress else found["windows"]
    lead = notify_lead_h()
    due = [w for w in windows if not lead or parse_time(w["start"]) <= now + timedelta(hours=lead)]
    if not due:
        return {"fire": False, "reason": "not_yet_within_notify_lead", **base}
    if suppress:
        fresh = rank_best_first([w for w in due if not same_window(w, notified, merge_gap_h())])
    else:
        fresh = [w for w in due if not overlaps(w, notified)]
    if not fresh:
        return {"fire": False, "reason": "already_notified", **base}
    return {"fire": True, "reason": "window_found", "window": fresh[0], **base}
