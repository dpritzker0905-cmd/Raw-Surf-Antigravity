"""sim_compare.py — "which SPOT should I surf?", scanned across a coastline.

`sim_window` answers WHICH HOUR at one spot. This answers the other half of the same question —
WHICH SPOT at one hour — and it is the question a surfer with six local breaks actually asks. Both
rank through `sim_rating.calculate_surf_rating`, so a compared spot's score is the number the map
glyph and the spot hub show for that spot and hour, never a second opinion (CLAUDE.md: ONE FORECAST
COMPOSITION).

★★★ WHY THIS TOOL IS WHERE THE PER-SPOT GEOMETRY FINALLY SHOWS UP. Neighbouring breaks see the SAME
offshore sea; what separates them is their own shore normal and break depth. A single-spot answer
can never make that visible — the caller has nothing to compare the number against. Ranking is
where 1,360 measured shore normals stop being an implementation detail and become the answer.

⛔⛔ AND IT IS ALSO WHERE THE HOUSE "FAIL OPEN" RULE INVERTS — MEASURED, DO NOT UNDO
`surf_rating.swell_exposure` returns a neutral 1.0 when `shore_normal_deg is None`, so a spot with
no resolved bearing scores every swell as arriving head-on. That is the RIGHT call for a single
spot (a `None` normal has a mean LEVEL error of 4.12 against 1.04 for the coarse bearing — a wrong
bearing is bad, no bearing is far worse), and it is the WRONG call for a ranking, because the
failure is SIGNED: it can only push a score up.

Counterfactual measured 2026-07-31 over 48 catalogue spots on four coasts — same coordinate, same
sea, bearing removed:

    blindness RAISES the score at 39 of 48, lowers it at 9
    median  +8.45    mean  +29.81    max  +88.6
    RATING LEVEL CHANGES at 32 of 48 (66.7%)
    Steamer Lane   9.8 very_poor -> 98.4 epic
    Pipeline       6.8 very_poor -> 62.1 fair_good

A naive ranking would therefore have recommended the one spot it knows least about, on a summer day
when every resolved spot on that coast correctly read `very_poor`. So a geometry-BLIND spot never
outranks a spot that has a bearing — it stays in `series`, labelled, below the spots that can
actually be judged. Same shape as `sim_window`'s daylight rule: rank on the disqualifier first,
keep everything, and name it.

⚠️ THE CANDIDATE COUNT IS A LATENCY BUDGET, NOT A DISPLAY PREFERENCE — every uncached spot is TWO
HTTP requests (marine + wind), and an MCP client reports a TIMEOUT rather than an answer well before
an unbounded radius would finish. `MAX_SPOTS` bounds it and the answer says when it truncated.
"""
import math
import os
from typing import Any, Callable, Dict, List, Optional, Tuple

from services.weather_pipeline import sim_daylight
from services.weather_pipeline.sim_rating import calculate_surf_rating, spot_geometry
from services.weather_pipeline.spot_geometry_readiness import assess_geometry

# 12 spots x 2 requests = 24 worst-case round trips, the same shape of budget `sim_window.MAX_FRAMES`
# bounds for hours. Warm-cache re-scans are free (`sim_forecast` holds a FIFO+TTL cache).
MAX_SPOTS = int(os.environ.get("SIM_COMPARE_MAX_SPOTS", "12"))
MAX_RADIUS_KM = float(os.environ.get("SIM_COMPARE_MAX_RADIUS_KM", "300"))

# ★ THE RESOLVING POWER OF THE RANKING, in rating points. A coarse 0.25° bearing is a median 22.3°
# off the measured one, and the Jacobian of the rating puts 22.3° of shore-normal error at ~6.0
# points. So when the winner's margin over the runner-up is smaller than that and either spot is on
# a coarse bearing, the two are NOT distinguishable by this instrument — and saying "spot A is best"
# on a 1.2-point margin would be false precision dressed as a recommendation.
RESOLVING_POWER_PTS = 6.0

EARTH_R_KM = 6371.0088


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Great-circle distance. Not the equirectangular approximation: the catalogue spans both poles'
    latitudes and a cos(lat) shortcut mis-sorts candidates badly above ~60°."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_R_KM * math.asin(min(1.0, math.sqrt(a)))


def parse_centre(near: str) -> Optional[Tuple[float, float]]:
    """`"36.9,-122.0"` -> a coordinate, anything else -> None (the caller then resolves it as a name).

    Deliberately strict: a bare number, or a name that happens to contain a comma, must fall through
    to name resolution rather than be read as half a coordinate."""
    parts = [p.strip() for p in (near or "").split(",")]
    if len(parts) != 2:
        return None
    try:
        lat, lng = float(parts[0]), float(parts[1])
    except ValueError:
        return None
    if not (-90.0 <= lat <= 90.0 and -180.0 <= lng <= 180.0):
        return None
    return lat, lng


def nearby(rows: List[Dict[str, Any]], lat: float, lng: float, radius_km: float,
           cap: Optional[int] = None) -> Tuple[List[Dict[str, Any]], int]:
    """The catalogue rows inside `radius_km`, nearest first, with `distance_km` attached.

    Returns `(capped_rows, total_in_radius)` so the caller can say how many were left out — a
    truncated candidate set presented as "the best spot near you" is the spatial twin of the
    silently-widened step `sim_window.plan_hours` refuses to do."""
    found: List[Dict[str, Any]] = []
    for row in rows or []:
        rlat, rlng = row.get("latitude"), row.get("longitude")
        if rlat is None or rlng is None:
            continue
        d = haversine_km(lat, lng, float(rlat), float(rlng))
        if d <= radius_km:
            out = dict(row)
            out["distance_km"] = round(d, 2)
            found.append(out)
    found.sort(key=lambda r: r["distance_km"])
    total = len(found)
    return (found[:cap] if cap else found), total


def _readiness(spot: Dict[str, Any]) -> Tuple[str, Optional[float], Optional[str]]:
    """(verdict, shore_normal_deg, source) for one spot — a pure read of resolved geometry."""
    geo = spot_geometry(spot)
    if geo is None:
        return "blind", None, "catalog_fallback"
    try:
        verdict = assess_geometry(geo).get("verdict") or "blind"
    except Exception:
        verdict = "blind" if geo.shore_normal_deg is None else "degraded"
    return verdict, geo.shore_normal_deg, geo.shore_normal_src


def scan(spots: List[Dict[str, Any]], baseline_at: Callable[[Dict[str, Any], str], Any],
         valid_time: str, top: int = 5, light_hour: Optional[str] = None) -> Dict[str, Any]:
    """Rate every candidate spot at one hour and rank them.

    `baseline_at(spot, hour)` is injected (as in `sim_window.scan`) so this module has no MCP
    dependency and the ranking is testable against a stub — no clock, no network.

    ⚠️ `light_hour` is separate from `valid_time` on purpose. `valid_time=""` means "the hour the app
    is serving now" and is passed to the baseline producer VERBATIM — naming an explicit hour there
    would change which frame is requested, and an hour the ingest has not yet published resolves to
    nothing where "" would have answered. Daylight still needs a concrete instant, so the caller
    supplies one; an unreadable stamp simply drops the annotation (`sim_daylight.annotate`)."""
    series: List[Dict[str, Any]] = []
    unresolved: List[str] = []
    sources = set()
    readiness_census = {"full": 0, "degraded": 0, "blind": 0}

    for spot in spots:
        baseline, source, _prov = baseline_at(spot, valid_time)
        if baseline is None:
            unresolved.append(spot.get("name") or str(spot.get("id")))
            continue
        sources.add(source)
        calc = calculate_surf_rating(
            spot, baseline["swell_height_m"], baseline["swell_period_sec"],
            baseline["swell_direction_deg"], baseline["wind_speed_knots"],
            baseline["wind_direction_deg"], partitions=baseline.get("partitions"),
            valid_time=valid_time, allow_reference_lookup=True)
        verdict, normal, normal_src = _readiness(spot)
        readiness_census[verdict] = readiness_census.get(verdict, 0) + 1
        row = {
            "spot": spot.get("name"),
            "spot_id": spot.get("id"),
            "region": spot.get("region"),
            "distance_km": spot.get("distance_km"),
            "breaking_height_ft": calc["breaking_height_ft"],
            "quality_rating": calc["quality_rating"],
            # ⚠️ RANKING READS THE RAW SCORE, DISPLAY READS THE GATED ONE — and the two must not be
            # swapped. The observation gate caps at 69.9 without confirmation, and confirmation is
            # absent for 97.9% of served spots (measured live 2026-07-31, 999 spot-hours), so
            # ranking on the GATED score would collapse every good spot into one 69.9 tie and then
            # order them by which happens to carry an observation — not by which has the best surf.
            # Same shape as the geometry-blind ranking inversion: a CAP that is safe for DISPLAY
            # inverts meaning when it becomes a SORT KEY.
            "quality_raw": calc.get("quality_raw"),
            "quality_confirmed": calc.get("quality_confirmed"),
            "quality_label": calc["quality_label"],
            "conditions_label": calc["conditions_label"],
            "wind_class": calc["wind_class"],
            "wind_speed_knots": round(float(baseline["wind_speed_knots"]), 1),
            "swell_period_sec": round(float(baseline["swell_period_sec"]), 1),
            "size_verdict": calc["size_verdict"],
            "swell_alignment_pct": calc["swell_alignment_pct"],
            "shore_normal_deg": normal,
            "shore_normal_source": normal_src,
            "geometry_readiness": verdict,
        }
        # WHY this spot scored what it did, in one field. A ranking without it says which break to
        # drive to but not what would have to change for the others — and the limiting factor is
        # already computed by `sim_explain` on the way past.
        why = calc.get("why") or {}
        lim = why.get("limiting_factor") or None
        if lim:
            row["limiting_factor"] = {"factor": lim.get("factor"), "value": lim.get("value"),
                                      "means": lim.get("means")}
        # Read the engine's OWN exposure multiplier back rather than re-deriving it: `swell_exposure`
        # floors at 0.10 the moment the swell is 90°+ off the shore normal, and that floor is where
        # our missing refraction term hides (see the note assembled below).
        for m in (why.get("multipliers") or []):
            if m.get("factor") == "swell_exposure" and m.get("value") is not None:
                row["swell_exposure"] = m["value"]
                if float(m["value"]) <= 0.1005:
                    row["exposure_floored"] = True
                break
        row.update(sim_daylight.annotate(spot.get("latitude"), spot.get("longitude"),
                                         light_hour if light_hour is not None else valid_time))
        series.append(row)

    # ⛔ THE GEOMETRY GATE IS THE FIRST SORT KEY. See the module docstring: `swell_exposure` fails
    # OPEN with no bearing, which in a ranking is a one-way ticket to the top (measured: the level
    # changes at 66.7% of spots and blindness raises the score at 39 of 48). Second key is daylight,
    # exactly as `sim_window` ranks it; then quality; then size as the tie-break.
    def _rank_key(r):
        return (r.get("geometry_readiness") == "blind",
                not r.get("surfable_light", True),
                -(r.get("quality_raw") if r.get("quality_raw") is not None
                  else r["quality_rating"]),      # rank UNGATED — see quality_raw above
                -r["breaking_height_ft"])

    ranked = sorted(series, key=_rank_key)
    best = ranked[:max(1, top)]

    out: Dict[str, Any] = {
        "scanned": {
            "valid_time": light_hour if light_hour is not None else (valid_time or "now"),
            "spots_requested": len(spots),
            "spots_resolved": len(series),
            "baseline_sources": sorted(sources),
            "geometry": {k: v for k, v in readiness_census.items() if v},
        },
        "best_spots": best,
        "series": ranked,
    }
    notes: List[str] = []

    blind = [r for r in ranked if r.get("geometry_readiness") == "blind"]
    if blind:
        notes.append(
            f"{len(blind)} of {len(series)} spots have no resolved shore normal and are ranked "
            f"LAST regardless of score: with no bearing the rating scores every swell as head-on, "
            f"which measured +8.5 points median (mean +29.8, max +88.6) and changed the level at "
            f"66.7% of spots — the error can only push a score UP, so those spots cannot be "
            f"compared against the rest. Named in `series` with geometry_readiness 'blind'.")

    if len(ranked) >= 2 and ranked[0].get("geometry_readiness") != "blind":
        margin = ranked[0]["quality_rating"] - ranked[1]["quality_rating"]
        coarse = [r for r in ranked[:2] if r.get("geometry_readiness") == "degraded"]
        if margin < RESOLVING_POWER_PTS and coarse:
            # False precision is the failure mode a ranking invites. Say when the top two are inside
            # the instrument's own resolving power rather than letting a 1-point gap read as a verdict.
            out["scanned"]["within_resolving_power"] = True
            notes.append(
                f"The top two are {margin:.1f} points apart and "
                f"{'both sit' if len(coarse) == 2 else 'one sits'} on a coarse 0.25° bearing "
                f"(median 22.3° off, worth ~{RESOLVING_POWER_PTS:.0f} rating points). They are not "
                f"distinguishable by this forecast — treat them as equal and pick on tide, crowd or "
                f"access.")

    floored = [r for r in ranked if r.get("exposure_floored")]
    if floored:
        # ⛔ KNOWN-MISSING PHYSICS, DISCLOSED — not a bug to be "fixed" by softening the floor.
        # `swell_exposure` bottoms out at 0.10 once the swell is 90°+ off the shore normal, and the
        # chain carries NO refraction term (Kr measured median 0.797, range 0.612–1.031 over 385k
        # CDIP swell hours; the dominant part is a per-site offset unknown at 1,763 of 1,773 spots).
        # A point break that surfs on swell wrapping around a headland is exactly the case that
        # reads worst here — and burying a famous point break under a beach break is the single
        # most misleading thing a RANKING can do that a single-spot answer never could.
        notes.append(
            f"{len(floored)} of {len(series)} spots sit at the swell-exposure floor — the swell is "
            f"more than 90° off their shore normal. The forecast has no refraction term, so a point "
            f"or cove that works on swell WRAPPING in will read worse here than it surfs. Named in "
            f"`series` with exposure_floored.")

    if series and any("light" in r for r in series):
        lit = [r for r in series if r.get("surfable_light", True)]
        out["scanned"]["surfable_light_spots"] = len(lit)
        if not lit:
            out["scanned"]["all_spots_dark"] = True
            notes.append("Every spot in range is in darkness at this hour, so the ranking is by "
                         "quality alone — none of these is surfable in daylight.")

    if unresolved:
        # Name them. A scan that silently skipped half the coast would rank the survivors against
        # each other and present that as "the best spot near you".
        out["scanned"]["unresolved_spots"] = unresolved
        notes.append(f"{len(unresolved)} of {len(spots)} spots had no forecast and were EXCLUDED "
                     f"from the ranking, not scored as flat.")
    if not series:
        notes = ["No spot in this radius resolved a forecast, so there is nothing to rank. "
                 "Check get_weather_forecast(spot_name) for the reason."]
    if notes:
        out["note"] = " ".join(notes)
    return out


def summarize(best: List[Dict[str, Any]], centre_label: str = "") -> Optional[str]:
    """One line naming the winning SPOT, so a caller that reads only the summary is not misled about
    which break it describes — and never one the geometry cannot judge."""
    if not best:
        return None
    b = best[0]
    light = sim_daylight.describe(b.get("light"))
    where = f" near {centre_label}" if centre_label else ""
    caveat = ""
    if b.get("geometry_readiness") == "blind":
        # Only reachable when EVERY candidate is blind. Say it in the sentence, not just in a field.
        caveat = " — but no spot in range has a resolved shore normal, so this ranking cannot " \
                 "tell which way any of them faces"
    elif b.get("geometry_readiness") == "degraded":
        caveat = " (coarse bearing — median 22.3° off)"
    dist = f", {b['distance_km']} km away" if b.get("distance_km") is not None else ""
    return (f"Best{where}: {b['spot']}{dist} — {b['breaking_height_ft']} ft "
            f"({b['conditions_label']}), quality {b['quality_rating']}/100 ({b['quality_label']}), "
            f"{b['wind_speed_knots']} kt {b['wind_class']}"
            f"{', ' + light if light else ''}{caveat}.")
