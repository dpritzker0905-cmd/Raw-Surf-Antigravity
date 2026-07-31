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

from services.weather_pipeline import sim_daylight
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
        # The scan rates the BASELINE sea itself (no what-if), so the trains it carried — the ones
        # the server's own height ran on — always still describe it. Absent key -> None -> the
        # total-field path, byte-identical to before.
        calc = calculate_surf_rating(
            spot, baseline["swell_height_m"], baseline["swell_period_sec"],
            baseline["swell_direction_deg"], baseline["wind_speed_knots"],
            baseline["wind_direction_deg"], partitions=baseline.get("partitions"))
        row = {
            "valid_time": hour,
            "breaking_height_ft": calc["breaking_height_ft"],
            "quality_rating": calc["quality_rating"],
            "quality_label": calc["quality_label"],
            "conditions_label": calc["conditions_label"],
            "wind_class": calc["wind_class"],
            "wind_speed_knots": round(float(baseline["wind_speed_knots"]), 1),
            "swell_period_sec": round(float(baseline["swell_period_sec"]), 1),
            "size_verdict": calc["size_verdict"],
        }
        # ⚠️ ANNOTATION ONLY — `quality_rating` above is untouched by daylight. See sim_daylight's
        # docstring: darkness is a property of the observer, not of the swell, and the sim's score
        # must stay byte-identical to the one the map and the hub show for the same spot-hour.
        row.update(sim_daylight.annotate(spot.get("latitude"), spot.get("longitude"), hour))
        series.append(row)

    # Rank SURFABLE light first, then quality, then SIZE as the tie-break — at a spot where several
    # hours score the same (common: wind and period barely move over three hours) the bigger one is
    # the better session.
    #
    # ★ Ranking, not filtering. Every scanned hour stays in `series` with its own `light`, because a
    # dark hour is a real forecast a caller may legitimately want (a dawn session starts before
    # first light; a night swell tells you what the morning inherits). What must not happen is a
    # dark hour being PRESENTED as "the best time to surf" — measured 2026-07-29 at 9 of 17 spots.
    # A frame whose light could not be determined sorts as surfable, i.e. exactly as it did before.
    def _rank_key(r):
        return (not r.get("surfable_light", True), -r["quality_rating"], -r["breaking_height_ft"])

    best = sorted(series, key=_rank_key)[:max(1, top)]

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
    notes: List[str] = []
    if series and any("light" in r for r in series):
        lit = [r for r in series if r.get("surfable_light", True)]
        out["scanned"]["surfable_light_frames"] = len(lit)
        if not lit:
            # Polar night, or a horizon short enough to sit entirely inside one night. Ranking still
            # happened on quality alone — say so rather than returning an empty or silently
            # night-time list. Fails OPEN: an answer, labelled, beats no answer.
            out["scanned"]["all_frames_dark"] = True
            notes.append("Every hour in this range is in darkness, so the ranking is by quality "
                         "alone — none of these windows is surfable in daylight.")
    if unresolved:
        # Name them. A scan that silently skipped half the horizon would rank the surviving hours
        # against each other and present that as "the best window in the next 48 h".
        out["scanned"]["unresolved_hours"] = unresolved
        notes.append(f"{len(unresolved)} of {len(hours)} frames had no forecast and were "
                     f"EXCLUDED from the ranking, not scored as flat.")
    if not series:
        # Overwrites rather than appends: with nothing ranked, the other notes describe an answer
        # that does not exist.
        notes = ["No frame in this range resolved a forecast, so there is nothing to rank. "
                 "Check get_weather_forecast(spot_name) for the reason."]
    if notes:
        out["note"] = " ".join(notes)
    return out


def summarize(best: List[Dict[str, Any]]) -> Optional[str]:
    """One line naming the winning window, so a caller that reads only the summary is not misled
    about which hour it describes."""
    if not best:
        return None
    b = best[0]
    # Name the light. When every hour in range is dark the ranking falls back to quality alone, and
    # a summary that read like an ordinary recommendation would be the original defect all over
    # again — one sentence deep instead of one field deep.
    light = sim_daylight.describe(b.get("light"))
    return (f"Best in range: {b['valid_time']} — {b['breaking_height_ft']} ft "
            f"({b['conditions_label']}), quality {b['quality_rating']}/100 "
            f"({b['quality_label']}), {b['wind_speed_knots']} kt {b['wind_class']}"
            f"{', ' + light if light else ''}.")
