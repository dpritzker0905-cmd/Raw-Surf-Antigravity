"""sim_window.py — "when should I surf?", scanned across the forecast horizon.

The sim could answer "how is it at this hour" one hour at a time. The question a surfer actually
asks is WHICH hour, and answering it by hand meant one tool call per frame with the caller doing
the ranking. This walks the horizon through the SAME chain a single-hour answer uses
(`sim_rating.calculate_surf_rating` -> `surf_point.estimate_surf_at` + `surf_rating.rating_score`),
so a window's score is the number the app would show at that spot and hour — not a second opinion.

★ Only affordable because the forecast cache stopped holding a single hour (see `sim_forecast.
_remember`). Measured at Mavericks before that change, 16 frames cost 19.8 s cold and 6.2 s warm;
after, 6.7 s cold and 0.000 s warm.

⚠️ THE FRAME COUNT IS A LATENCY BUDGET, NOT A DISPLAY PREFERENCE. Every uncached frame is TWO HTTP
requests (marine + wind). An MCP client reports a TIMEOUT rather than an answer well before the
scan would finish if this were unbounded, and a timeout is indistinguishable from "the sim is
broken" — that is the `576dcbdd` regression. `MAX_FRAMES` bounds the worst case; the circuit
breaker in `sim_forecast` bounds the case where the app is down.
"""
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Dict, List, Optional

from services.weather_pipeline.sim_rating import calculate_surf_rating

# 24 frames x 2 requests = 48 worst-case round trips. At the measured 0.42 s per frame warm-server
# cold-cache, that is ~10 s — inside a client budget, and the far tail is bounded by the breaker.
MAX_FRAMES = int(os.environ.get("SIM_WINDOW_MAX_FRAMES", "24"))
MAX_HOURS_AHEAD = int(os.environ.get("SIM_WINDOW_MAX_HOURS", "168"))   # the app serves ~7 days


def plan_hours(hours_ahead: int, step_hours: int, now: Optional[datetime] = None) -> List[str]:
    """The top-of-hour UTC stamps to scan, bounded by MAX_FRAMES.

    Pure, so the bounding rule is testable without a clock or a network. The horizon is TRUNCATED
    rather than the step being silently widened: a caller who asked for 3-hourly resolution and
    quietly got 9-hourly would have no way to tell, whereas a short answer that reports its own
    range is self-describing."""
    step = max(1, int(step_hours))
    ahead = max(step, min(int(hours_ahead), MAX_HOURS_AHEAD))
    base = (now or datetime.now(timezone.utc)).replace(minute=0, second=0, microsecond=0)
    n = min(MAX_FRAMES, ahead // step + 1)
    return [(base + timedelta(hours=step * i)).strftime("%Y-%m-%dT%H:%M:%SZ") for i in range(n)]


def scan(spot: Dict[str, Any], baseline_at: Callable[[Dict[str, Any], str], Any],
         hours: List[str], top: int = 5) -> Dict[str, Any]:
    """Rate `spot` at each hour and rank the results.

    `baseline_at(spot, hour)` returns `(baseline | None, source, provenance)` — injected rather than
    imported so this module has no MCP dependency and the scan is testable against a stub.

    Geometry resolves ONCE per coordinate and is reused across every frame (CLAUDE.md: the
    correction is arithmetic, not I/O) — `sim_rating.spot_geometry` caches on the coordinate, so
    scanning 24 hours costs one bathymetry resolution, not 24."""
    series: List[Dict[str, Any]] = []
    unresolved: List[str] = []
    sources = set()
    for hour in hours:
        baseline, source, provenance = baseline_at(spot, hour)
        if baseline is None:
            unresolved.append(hour)
            continue
        sources.add(source)
        calc = calculate_surf_rating(
            spot, baseline["swell_height_m"], baseline["swell_period_sec"],
            baseline["swell_direction_deg"], baseline["wind_speed_knots"],
            baseline["wind_direction_deg"])
        series.append({
            "valid_time": hour,
            "breaking_height_ft": calc["breaking_height_ft"],
            "quality_rating": calc["quality_rating"],
            "quality_label": calc["quality_label"],
            "conditions_label": calc["conditions_label"],
            "wind_class": calc["wind_class"],
            "wind_speed_knots": round(float(baseline["wind_speed_knots"]), 1),
            "swell_period_sec": round(float(baseline["swell_period_sec"]), 1),
            "size_verdict": calc["size_verdict"],
        })

    # Rank by quality, then by SIZE as the tie-break — at a spot where several hours score the same
    # (common: wind and period barely move over three hours) the bigger one is the better session.
    best = sorted(series, key=lambda r: (-r["quality_rating"], -r["breaking_height_ft"]))[:max(1, top)]

    out: Dict[str, Any] = {
        "scanned": {
            "from": hours[0] if hours else None,
            "to": hours[-1] if hours else None,
            "frames_requested": len(hours),
            "frames_resolved": len(series),
            "baseline_sources": sorted(sources),
        },
        "best_windows": best,
        "series": series,
    }
    if unresolved:
        # Name them. A scan that silently skipped half the horizon would rank the surviving hours
        # against each other and present that as "the best window in the next 48 h".
        out["scanned"]["unresolved_hours"] = unresolved
        out["note"] = (f"{len(unresolved)} of {len(hours)} frames had no forecast and were "
                       f"EXCLUDED from the ranking, not scored as flat.")
    if not series:
        out["note"] = ("No frame in this range resolved a forecast, so there is nothing to rank. "
                       "Check get_weather_forecast(spot_name) for the reason.")
    return out


def summarize(best: List[Dict[str, Any]]) -> Optional[str]:
    """One line naming the winning window, so a caller that reads only the summary is not misled
    about which hour it describes."""
    if not best:
        return None
    b = best[0]
    return (f"Best in range: {b['valid_time']} — {b['breaking_height_ft']} ft "
            f"({b['conditions_label']}), quality {b['quality_rating']}/100 "
            f"({b['quality_label']}), {b['wind_speed_knots']} kt {b['wind_class']}.")
