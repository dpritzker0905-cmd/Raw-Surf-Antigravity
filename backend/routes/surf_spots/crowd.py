"""
SpotHub Intelligence — crowd prediction heatmap and optimal surf time analysis.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from typing import Optional
from datetime import datetime, timezone
import logging

from database import get_db
from models import SurfSpot

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/surf-spots/{spot_id}/crowd-prediction")
async def get_crowd_prediction(
    spot_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Predict crowd levels for a spot based on historical check-in
    and surf-log data.  Returns a 7-day × 24-hour heatmap plus a
    human-readable summary for the current day.

    Algorithm:
      1. Aggregate CheckIn records and SurfLogEntry records at this spot
         by (day_of_week, hour_of_day).
      2. Normalise counts into LOW / MODERATE / HIGH / PACKED buckets.
      3. Return the full heatmap and a "right now" prediction.
    """
    from models import CheckIn, SurfLogEntry

    # Verify spot
    spot_result = await db.execute(select(SurfSpot).where(SurfSpot.id == spot_id))
    spot = spot_result.scalar_one_or_none()
    if not spot:
        raise HTTPException(status_code=404, detail="Spot not found")

    # ── Gather historical data ──────────────────────────
    # CheckIns at this spot (use spot_id FK)
    checkin_result = await db.execute(
        select(
            func.extract('dow', CheckIn.checked_in_at).label('dow'),
            func.extract('hour', CheckIn.checked_in_at).label('hr'),
            func.count(CheckIn.id).label('cnt')
        )
        .where(CheckIn.spot_id == spot_id)
        .group_by('dow', 'hr')
    )
    checkin_rows = checkin_result.all()

    # SurfLog entries linked to this spot
    log_result = await db.execute(
        select(
            func.extract('dow', SurfLogEntry.session_date).label('dow'),
            func.count(SurfLogEntry.id).label('cnt')
        )
        .where(SurfLogEntry.spot_id == spot_id)
        .group_by('dow')
    )
    log_rows = log_result.all()

    # Build heatmap: { day_of_week: { hour: count } }
    heatmap: dict[int, dict[int, int]] = {}
    for dow in range(7):
        heatmap[dow] = {h: 0 for h in range(24)}

    for row in checkin_rows:
        d, h, c = int(row.dow), int(row.hr), int(row.cnt)
        heatmap[d][h] = heatmap[d].get(h, 0) + c

    # Spread surf-log counts across typical session hours (6-10, 15-18)
    session_hours = [6, 7, 8, 9, 10, 15, 16, 17, 18]
    for row in log_rows:
        d, c = int(row.dow), int(row.cnt)
        per_hour = max(1, c // len(session_hours))
        for h in session_hours:
            heatmap[d][h] = heatmap[d].get(h, 0) + per_hour

    # Determine global max for normalisation
    max_count = max(
        (heatmap[d][h] for d in heatmap for h in heatmap[d]),
        default=1
    ) or 1

    def _bucket(count: int) -> str:
        ratio = count / max_count
        if ratio >= 0.75:
            return "packed"
        if ratio >= 0.45:
            return "high"
        if ratio >= 0.2:
            return "moderate"
        return "low"

    DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

    heatmap_response = {}
    for d in range(7):
        heatmap_response[DAY_NAMES[d]] = {
            str(h): {"count": heatmap[d][h], "level": _bucket(heatmap[d][h])}
            for h in range(24)
        }

    # Current prediction
    now = datetime.now(timezone.utc)
    current_dow = (now.weekday() + 1) % 7  # Python weekday → Postgres dow
    current_hour = now.hour
    current_count = heatmap.get(current_dow, {}).get(current_hour, 0)
    current_level = _bucket(current_count)

    # Peak / quiet hours for today
    today_data = heatmap.get(current_dow, {})
    if today_data:
        peak_hour = max(today_data, key=today_data.get)
        quiet_hour = min(today_data, key=today_data.get)
    else:
        peak_hour = quiet_hour = None

    return {
        "spot_id": spot_id,
        "spot_name": spot.name,
        "current_prediction": {
            "level": current_level,
            "count_basis": current_count,
            "day": DAY_NAMES[current_dow],
            "hour": current_hour,
        },
        "today_summary": {
            "peak_hour": peak_hour,
            "peak_level": _bucket(today_data.get(peak_hour, 0)) if peak_hour is not None else None,
            "quiet_hour": quiet_hour,
            "quiet_level": _bucket(today_data.get(quiet_hour, 0)) if quiet_hour is not None else None,
        },
        "heatmap": heatmap_response,
        "data_points": sum(heatmap[d][h] for d in heatmap for h in heatmap[d]),
    }


@router.get("/surf-spots/{spot_id}/optimal-time")
async def get_optimal_surf_time(
    spot_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Analyse surf-log entries for a spot to determine the optimal
    surf window.  Factors:
      - User-submitted personal ratings (best sessions)
      - Conditions ratings
      - Crowd levels (prefer low/moderate)
      - Tide status distribution
      - Wind direction patterns

    Returns the best day-of-week and time window along with a
    confidence score based on data volume.
    """
    from models import SurfLogEntry

    # Verify spot
    spot_result = await db.execute(select(SurfSpot).where(SurfSpot.id == spot_id))
    spot = spot_result.scalar_one_or_none()
    if not spot:
        raise HTTPException(status_code=404, detail="Spot not found")

    # Fetch all log entries for this spot
    log_result = await db.execute(
        select(SurfLogEntry).where(SurfLogEntry.spot_id == spot_id)
    )
    entries = log_result.scalars().all()

    if not entries:
        return {
            "spot_id": spot_id,
            "spot_name": spot.name,
            "has_data": False,
            "message": "Not enough data yet. Log sessions at this spot to unlock insights.",
        }

    # ── Score each entry ────────────────────────────────
    # Higher score = better session
    CROWD_SCORE = {"empty": 5, "low": 4, "moderate": 3, "high": 1, "packed": 0}

    scored_entries = []
    for e in entries:
        score = 0
        factors = 0
        if e.personal_rating:
            score += e.personal_rating * 2  # max 10
            factors += 1
        if e.conditions_rating:
            score += e.conditions_rating * 2  # max 10
            factors += 1
        if e.crowd_level:
            score += CROWD_SCORE.get(e.crowd_level.lower(), 2)
            factors += 1
        if factors == 0:
            continue
        scored_entries.append({
            "entry": e,
            "score": score / factors,
            "dow": (e.session_date.weekday() + 1) % 7 if e.session_date else None,
            "time": e.session_time,
        })

    if not scored_entries:
        return {
            "spot_id": spot_id,
            "spot_name": spot.name,
            "has_data": False,
            "message": "Logged sessions lack ratings data. Add personal or conditions ratings to unlock insights.",
        }

    # ── Best day of week ────────────────────────────────
    DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    day_scores: dict[int, list] = {d: [] for d in range(7)}
    for se in scored_entries:
        if se["dow"] is not None:
            day_scores[se["dow"]].append(se["score"])

    day_avg = {}
    for d, scores in day_scores.items():
        if scores:
            day_avg[d] = sum(scores) / len(scores)

    best_day = max(day_avg, key=day_avg.get) if day_avg else None

    # ── Best time window ────────────────────────────────
    TIME_WINDOWS = {
        "dawn_patrol": ["5am", "6am", "dawn", "sunrise"],
        "morning":     ["7am", "8am", "9am", "10am", "morning"],
        "midday":      ["11am", "12pm", "noon", "midday"],
        "afternoon":   ["1pm", "2pm", "3pm", "4pm", "afternoon"],
        "sunset":      ["5pm", "6pm", "sunset", "evening"],
    }
    window_scores: dict[str, list] = {w: [] for w in TIME_WINDOWS}

    for se in scored_entries:
        t = (se["time"] or "").lower()
        for window, keywords in TIME_WINDOWS.items():
            if any(kw in t for kw in keywords):
                window_scores[window].append(se["score"])
                break

    window_avg = {}
    for w, scores in window_scores.items():
        if scores:
            window_avg[w] = sum(scores) / len(scores)

    best_window = max(window_avg, key=window_avg.get) if window_avg else None

    # ── Dominant conditions ─────────────────────────────
    tide_counts: dict[str, int] = {}
    wind_counts: dict[str, int] = {}
    for se in scored_entries:
        e = se["entry"]
        if e.tide_status:
            tide_counts[e.tide_status] = tide_counts.get(e.tide_status, 0) + 1
        if e.wind_direction:
            wind_counts[e.wind_direction] = wind_counts.get(e.wind_direction, 0) + 1

    best_tide = max(tide_counts, key=tide_counts.get) if tide_counts else None
    best_wind = max(wind_counts, key=wind_counts.get) if wind_counts else None

    # ── Confidence ──────────────────────────────────────
    n = len(scored_entries)
    if n >= 30:
        confidence = "high"
    elif n >= 10:
        confidence = "moderate"
    else:
        confidence = "low"

    return {
        "spot_id": spot_id,
        "spot_name": spot.name,
        "has_data": True,
        "data_points": n,
        "confidence": confidence,
        "optimal": {
            "best_day": DAY_NAMES[best_day] if best_day is not None else None,
            "best_day_avg_score": round(day_avg.get(best_day, 0), 1) if best_day is not None else None,
            "best_time_window": best_window,
            "best_window_avg_score": round(window_avg.get(best_window, 0), 1) if best_window else None,
            "preferred_tide": best_tide,
            "preferred_wind": best_wind,
        },
        "day_breakdown": {
            DAY_NAMES[d]: {"avg_score": round(avg, 1), "sessions": len(day_scores[d])}
            for d, avg in day_avg.items()
        },
        "window_breakdown": {
            w: {"avg_score": round(avg, 1), "sessions": len(window_scores[w])}
            for w, avg in window_avg.items()
        },
    }

