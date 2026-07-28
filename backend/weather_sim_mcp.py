import sqlite3
import math
import logging
import os
from datetime import datetime
from typing import Dict, Any, Optional, Tuple
from fastmcp import FastMCP
from utils.sqlite_helpers import get_sqlite_connection
# The PRODUCTION rating engine is authoritative (CLAUDE.md). The sim delegates to it rather than
# carrying a second formula — a divergent copy is exactly how this file came to rate a flat ocean
# "Epic". Both imports are dependency-free (no FastAPI/route side effects).
from services.weather_pipeline.surf_rating import (
    rating_score, score_to_level, offshoreness, MS_TO_KT, oversize_gate, oversize_thresholds,
)
from services.weather_pipeline.surf_transform import komar_breaker_height
from services.weather_pipeline.surf_point import resolve_surf_geometry, estimate_surf_at
from services.conditions_labels import get_conditions_label
# The app's own /api/weather/point, so every catalog spot has a real forecast instead of the three
# hand-tuned ones. Imported at module scope: it pulls urllib/ssl, and a C extension loaded lazily
# inside a tool is what deadlocked this server (see `_warm_hot_path`). Kill: SIM_LIVE_FORECAST=0.
from services.weather_pipeline import sim_forecast
# ONE identity per spot name. This module used to resolve names itself, hand-tuned table FIRST, so
# `get_weather_forecast("Mavericks")` and `("mavericks")` answered about coordinates 637 m apart —
# see `sim_spots` for the measurement and the precedence that replaced it.
from services.weather_pipeline import sim_spots

# Setup logger
logger = logging.getLogger("weather_sim_mcp")

# Initialize FastMCP Server for the Weather Simulation System
mcp = FastMCP("WeatherSimulationSystem")

# ── 2026-07-27: THE SIM NOW ANSWERS WITH THE SAME PHYSICS THE APP SERVES ──────────────────────
# `0cae5d74` fixed duplicated physics at the FUNCTION level (height -> komar_breaker_height,
# quality -> rating_score). That still left this file owning the COMPOSITION — the geometry those
# functions are fed and the order effects are applied in — and that is precisely where production
# kept moving (ETOPO shore-normal asset `5a48ad1e` 07-26, depth-limited break cap `bf5c76cd` 07-27).
#
# Measured 2026-07-27 across 8 scenarios at the three catalog spots, this file over-read the height
# the app actually serves at the identical coordinate by a MEDIAN 19.1% (max +39.2%), because it
# ran raw Komar on the offshore Hs with no cross-shelf friction, no swell-angle exposure and no
# breaking cap — against a HARDCODED shore normal 44.9 deg off the ETOPO value production uses
# (Mavericks: 270 here vs 225.1 in the asset, spread 10.5).
#
# Both are now resolved through `surf_point`, the single chain `point_resolution` also calls, so the
# sim tracks production automatically instead of re-diverging on the next physics change.
# Kill: SIM_PRODUCTION_GEOMETRY=0 restores the pre-07-27 raw-Komar behaviour.
def _sim_flag(name: str, default: str = "1") -> bool:
    return os.environ.get(name, default) != "0"


# 1. Catalog defaults for the three hand-tuned spots. These carry a BASELINE forecast (the
# `base_*` fields), which the 1800+ database spots do not — see `get_weather_forecast`.
# ⚠️ They no longer own IDENTITY: where the app's catalogue knows the name, its id/region/
# coordinates win, and only the `base_*` baseline and `reference_size_m` are grafted on. Kept
# exported under this name because the suite reads it.
MOCK_SPOTS = sim_spots.CATALOG_DEFAULTS

# Staged simulation state, keyed by spot name. Kept SEPARATE from MOCK_SPOTS (which used to be
# mutated in place) so the catalog defaults stay a clean baseline and every forecast read can say
# truthfully whether it is showing a default or somebody's staged scenario.
_SIM_OVERRIDES: Dict[str, Dict[str, float]] = {}

# Resolve the database path dynamically relative to the backend directory
BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(BACKEND_DIR)
DB_PATH = os.path.join(ROOT_DIR, "dev.db")


# 2. Database Helper Methods with Safe Fallbacks
def get_db_connection() -> Optional[sqlite3.Connection]:
    try:
        conn = get_sqlite_connection(DB_PATH)
        return conn
    except Exception as e:
        logger.error(f"Failed to connect to SQLite database at {DB_PATH}: {e}")
        return None


# The catalogue read and name resolution both live in `sim_spots` now — the identity rules got long
# enough to deserve their own tests, and this file was 52 lines under the 800 ratchet.
query_spots_from_db = sim_spots.query_spots


def resolve_spot(spot_name: str) -> Optional[Dict[str, Any]]:
    """The ONE spot a caller named, or None when the name is unknown OR ambiguous.

    Tools should prefer `sim_spots.resolve`, which distinguishes those two cases — an ambiguous
    name must not be reported as a missing one. Kept for callers that only need the happy path."""
    return sim_spots.resolve(spot_name).spot


_GEOMETRY_CACHE: Dict[Any, Any] = {}


def spot_geometry(spot: Dict[str, Any]):
    """Resolved production geometry for a spot, or None when unavailable/disabled.

    Cached per coordinate — the bathymetry lookups are pure and a what-if sweep hits one spot
    repeatedly."""
    if not _sim_flag("SIM_PRODUCTION_GEOMETRY"):
        return None
    lat, lng = spot.get("latitude"), spot.get("longitude")
    if lat is None or lng is None:
        return None
    key = (round(float(lat), 6), round(float(lng), 6))
    if key not in _GEOMETRY_CACHE:
        try:
            _GEOMETRY_CACHE[key] = resolve_surf_geometry(float(lat), float(lng))
        except Exception as e:
            logger.warning(f"geometry resolution failed for {spot.get('name')}: {e}")
            _GEOMETRY_CACHE[key] = None
    return _GEOMETRY_CACHE[key]


def shore_normal_for(spot: Dict[str, Any]) -> Optional[float]:
    """THE one seaward bearing for this spot — resolved bathymetry, else the catalog fallback.

    Every consumer in this module (wind class, swell alignment, the delegated rating, the height
    exposure factor) reads it from here. `2851a598` already fixed one two-reference-frame bug in
    this file (wind class keyed off `optimal_wind_dir` while the score keyed off `orientation`);
    `swell_alignment_pct` still had the same defect against `optimal_swell_dir` — it reported 100%
    alignment for a Mavericks swell the engine was scoring at 42% — so both are gone and there is
    one frame."""
    geo = spot_geometry(spot)
    if geo is not None and geo.shore_normal_deg is not None:
        return float(geo.shore_normal_deg)
    o = spot.get("orientation")
    return float(o) if o is not None else None


def reference_size_for(spot: Dict[str, Any]) -> Optional[float]:
    """Local size reference, gated on the SAME flag production gates it on. Off (the default) means
    the global 1.2 m curve — exactly what the app is serving today."""
    if os.environ.get("RATING_LOCAL_SIZE", "0") != "1":
        return None
    return spot.get("reference_size_m")


# 3. Core Physics and Weather Calculation Engine
def calculate_surf_rating(
    spot: Dict[str, Any],
    swell_h: float,
    swell_p: float,
    swell_dir: float,
    wind_spd: float,
    wind_dir: float
) -> Dict[str, Any]:
    """Breaking wave height and 0-100 surf quality for a spot under a given weather vector.

    Delegates BOTH the physics and its composition to production (`surf_point.estimate_surf_at` ->
    `surf_transform.estimate_surf`, and `surf_rating.rating_score`), so the number this returns is
    the number the app would show at that coordinate.
    """
    shore_normal = shore_normal_for(spot)
    geo = spot_geometry(spot)

    # 1. Nearshore breaking height — the FULL production chain, not just Komar.
    # Raw `komar_breaker_height(Hs, Tp)` skips cross-shelf bottom friction, the swell-angle
    # exposure factor, sub-grid magnets and the depth-limited breaking cap. Measured 2026-07-27
    # that omission over-read the served height by a median 19.1% (max +39.2%).
    regime = "estimate"
    breaking_height = None
    if geo is not None:
        try:
            breaking_height, regime = estimate_surf_at(
                float(spot["latitude"]), float(spot["longitude"]),
                swell_h, swell_p, swell_from_deg=swell_dir, geometry=geo)
        except Exception as e:
            logger.warning(f"estimate_surf_at failed for {spot.get('name')}: {e}")
            breaking_height = None
    if breaking_height is None:
        # No geometry (kill switch, missing coords, open-ocean/unknown regime) -> the previous
        # deep-water-only estimate. Never a crash, never a silent zero for a real swell.
        breaking_height = komar_breaker_height(swell_h, swell_p)
        if breaking_height is None:      # non-physical input (h<=0 or Tp<=0) -> flat
            breaking_height, regime = 0.0, "calm"
        elif geo is None:
            regime = "deep_water_estimate"

    # 2. Wind CLASS — derived from the SAME reference frame the delegated score uses, so the label
    # persisted to condition_reports.wind_conditions cannot contradict the score. Thresholds are the
    # exact equivalents of the old angular ones (wind_diff < 45 deg <=> offshoreness > cos45).
    _off = offshoreness(wind_dir, shore_normal)
    if wind_spd < 3.0:
        wind_label = "Glassy"
    elif _off is None:
        wind_label = "Sideshore"          # unknown geometry -> the neutral class
    elif _off > 0.7071:
        wind_label = "Offshore"
    elif _off < -0.7071:
        wind_label = "Onshore"
    else:
        wind_label = "Sideshore"

    # 3. Swell alignment — reported against the SAME shore normal (see shore_normal_for).
    if shore_normal is None:
        swell_alignment = 1.0             # unknown geometry fails OPEN, as the height factor does
    else:
        swell_diff = abs((swell_dir - shore_normal + 180) % 360 - 180)
        swell_alignment = max(0.1, math.cos(math.radians(swell_diff)))

    breaking_height_ft = round(breaking_height * 3.28084, 1)  # metres to feet

    # 4. Final Wave Quality Rating (0 to 100) — DELEGATED to the production engine, whose
    # multiplicative size_gate is 0 below the rideability floor, so flat is 0 by construction.
    # `break_depth_m` is the oversize gate's spot-capacity signal: a big-wave spot must keep its
    # ceiling (Mavericks reads 22.1 m => it can hold ~57 ft) rather than inherit the generic one.
    _break_depth = geo.break_depth_m if geo is not None else None
    quality_score = rating_score(
        breaking_height,                      # nearshore BREAKING height, metres
        swell_p,
        wind_spd / MS_TO_KT,                  # engine wants m/s; sim inputs are knots
        wind_from_deg=wind_dir,
        shore_normal_deg=shore_normal,
        swell_from_deg=swell_dir,
        reference_size_m=reference_size_for(spot),
        break_depth_m=_break_depth,
    )
    quality_label = score_to_level(quality_score)

    # 4b. SIZE VERDICT — say out loud when the surf is past rideable, instead of leaving the caller
    # to infer it from a number that merely got smaller. Before the oversize veto shipped
    # (2026-07-29) the rating SATURATED: 4 / 12 / 25 / 35 ft all scored 97.3 "epic", so a closeout
    # and a groomed head-high day were indistinguishable in this payload. The veto fixes the score;
    # this field makes the REASON legible — a low score from 40 kt of onshore slop and a low score
    # from 35 ft of unrideable closeout are different answers to "should I paddle out?".
    _ref = reference_size_for(spot)
    _og = oversize_gate(breaking_height, _ref, break_depth_m=_break_depth)
    _over_start, _over_floor = oversize_thresholds(_ref, _break_depth)
    if _og >= 1.0:
        size_verdict = "within_range"
    elif _og <= 0.35:
        size_verdict = "too_big_to_ride"
    else:
        size_verdict = "at_the_upper_limit"

    # 5. `conditions_label` is the app's SIZE ladder, not a quality verdict. Every other writer
    # emits "Waist High"/"Chest High"/…, and SpotHubConditionsTab.js keys a colour map on those
    # exact strings — an off-vocabulary value silently renders grey. The verdict travels in its own
    # `quality_label` field instead of overloading this one.
    return {
        "breaking_height_ft": breaking_height_ft,
        "surf_regime": regime,
        "quality_rating": quality_score,
        "quality_label": quality_label,
        "size_verdict": size_verdict,
        "rideable_ceiling_ft": round(_over_start * 3.28084, 1),
        "conditions_label": get_conditions_label(breaking_height_ft),
        "wind_class": wind_label,
        "swell_alignment_pct": round(swell_alignment * 100, 0),
        "shore_normal_deg": shore_normal,
        "shore_normal_source": geo.shore_normal_src if geo is not None else "catalog_fallback",
    }


def _geometry_payload(spot: Dict[str, Any]) -> Dict[str, Any]:
    """The resolved bathymetry for a spot — what makes the estimate spot-specific."""
    geo = spot_geometry(spot)
    if geo is None:
        return {"resolved": False, "shore_normal_deg": shore_normal_for(spot),
                "shore_normal_source": "catalog_fallback"}
    return {
        "resolved": True,
        "shore_normal_deg": geo.shore_normal_deg,
        "shore_normal_source": geo.shore_normal_src,
        "shelf_depth_m": geo.depth_m,
        "shelf_width_km": round(geo.shelf_width_km, 2) if geo.shelf_width_km else geo.shelf_width_km,
        "break_depth_m": geo.break_depth_m,
        "coastal": geo.coastal,
        "nearshore": geo.nearshore,
        "magnet_factor": geo.magnet_factor,
    }


def _baseline_with_source(spot: Dict[str, Any], valid_time: Optional[str] = None
                          ) -> Tuple[Optional[Dict[str, float]], str, Dict[str, Any]]:
    """The spot's baseline weather vector with its provenance.

    Precedence: a staged simulation override, then the app's LIVE forecast, then the hand-tuned
    catalog defaults. The live forecast outranks those defaults deliberately — they are invented
    constants for three spots, and a real forecast at the same coordinate is strictly better. It
    does NOT outrank an override, because an override is the caller's explicit what-if.

    ⚠️ An override is TIMELESS — it is "pretend the weather is this", with no hour attached. So it
    still wins when a `valid_time` is requested, and the caller is TOLD, because a requested hour
    that silently changed nothing would be the worse surprise."""
    override = _SIM_OVERRIDES.get(spot.get("name", ""))
    if override:
        note = ({"note": f"a staged override is masking the requested hour {valid_time}; "
                         f"clear_simulation_overrides() to see the real forecast"}
                if valid_time else {})
        return dict(override), "simulated_override", note

    lat, lng = spot.get("latitude"), spot.get("longitude")
    if lat is not None and lng is not None:
        live, provenance = sim_forecast.fetch_live_forecast(float(lat), float(lng), valid_time)
        if live is not None:
            return live, "live_forecast", provenance
    else:
        provenance = {"reason": "spot has no coordinates"}

    if "base_swell_height" not in spot:
        return None, "none", provenance
    return {
        "swell_height_m": spot["base_swell_height"],
        "swell_period_sec": spot["base_swell_period"],
        "swell_direction_deg": spot.get("base_swell_direction", 270.0),
        "wind_speed_knots": spot["base_wind_speed"],
        "wind_direction_deg": spot["base_wind_direction"],
    }, "catalog_default", provenance


def _baseline_for(spot: Dict[str, Any]) -> Optional[Dict[str, float]]:
    """The spot's current baseline weather vector, or None when nothing has established one."""
    return _baseline_with_source(spot)[0]


# 4. FastMCP Tools

@mcp.tool
def get_surf_spots(query: str = "", limit: int = 50) -> Dict[str, Any]:
    """Get surf spots from the catalog with coordinates, regions, and resolved shore orientation.

    Args:
        query: Optional case-insensitive substring to filter spot names.
        limit: Maximum spots to return (the catalog holds ~1818 active spots; the response
            reports `total_matching` so a capped answer is never mistaken for the whole set).
    """
    # ⚠️ THE CAP IS A MEASURED BUDGET, NOT A ROUND NUMBER. Serialised size 2026-07-27:
    # 50 spots = 9.4 KB (~2.4k tokens) · 200 = 37.4 KB (~9.6k) · 500 = 93.5 KB (~24k). An MCP client
    # REJECTS a result of that size rather than showing it, which reads to the caller as "the tool
    # is broken" — so a limit the client cannot receive is not a feature. 200 is the largest round
    # figure that stays comfortably inside a normal budget. Narrow with `query` to see more; the
    # response reports `total_matching` so a truncated answer never looks complete.
    hard_cap = int(os.environ.get("SIM_SPOTS_MAX", "200"))
    requested = max(1, int(limit))
    db_spots = query_spots_from_db(name_query=query or None, limit=min(requested, hard_cap))
    # Name the real source. `dev.db` has drifted into WRONG COORDINATES (Bethune Beach sits 7 km
    # from where production put it), so "which catalogue answered" is not a detail.
    source = sim_spots.catalog_source()
    if not db_spots:
        source = "catalog_defaults"
        db_spots = [
            {"id": s["id"], "name": s["name"], "region": s["region"],
             "latitude": s["latitude"], "longitude": s["longitude"]}
            for s in MOCK_SPOTS.values()
            if not query or query.lower() in s["name"].lower()
        ]
    # ⚠️ RESPONSE SIZE IS A FAILURE MODE. Measured 2026-07-27, `limit=500` serialised to 94.8 KB
    # (~24k tokens) — at or past the point where an MCP client REJECTS the result instead of showing
    # it, which reads to the caller as "the tool is broken". Most of that was noise: an unrounded
    # coast-PCA bearing serialises as `160.25316339457387`, 17 significant digits for a number that
    # is meaningful to about one tenth of a degree. Rounding costs no information and roughly a
    # third of the payload.
    def _tidy(value, places):
        return None if value is None else round(float(value), places)

    out = []
    for s in db_spots:
        # `orientation` used to be hardcoded 270 for every database row. It is now the real seaward
        # bearing from the same chain production uses, so a caller reasoning about swell windows
        # gets the spot's actual aspect.
        geo = spot_geometry(s)
        out.append({**s,
                    "latitude": _tidy(s.get("latitude"), 5),      # 5 dp ~= 1 m; more is noise
                    "longitude": _tidy(s.get("longitude"), 5),
                    "orientation": _tidy(shore_normal_for(s), 1),
                    "orientation_source": (geo.shore_normal_src if geo is not None
                                           else "catalog_fallback")})
    # Count the full match set so a capped answer can never be mistaken for the whole catalogue.
    live = sim_forecast.fetch_catalog()
    total = (sum(1 for s in live if not query or query.lower() in (s["name"] or "").lower())
             if live else None)
    payload = {"source": source, "returned": len(out), "spots": out}
    if total is not None:
        payload["total_matching"] = total
        if total > len(out):
            payload["note"] = (f"showing {len(out)} of {total} matches (cap {hard_cap}) — narrow "
                               f"with `query` to see the rest.")
    return payload


@mcp.tool
def get_weather_forecast(spot_name: str, valid_time: str = "") -> Dict[str, Any]:
    """Get the weather, swell, and wind forecast for a surf spot, now or at a future hour.

    Args:
        spot_name: The name of the spot (e.g., 'Mavericks', 'Pipeline'), or its id.
        valid_time: Optional ISO-8601 UTC hour to forecast, e.g. '2026-07-29T15:00:00Z'.
            Empty means the current hour. The app serves frames out to about 7 days ahead.
    """
    # ⚠️ Validate before dialling. The hour is interpolated into a URL, and a malformed value would
    # spend the full timeout to come back empty — indistinguishable from "no data at this spot".
    hour = (valid_time or "").strip()
    if hour:
        try:
            parsed = datetime.strptime(hour, "%Y-%m-%dT%H:%M:%SZ")
        except ValueError:
            return {"error": f"valid_time must be ISO-8601 UTC like '2026-07-29T15:00:00Z', "
                             f"got {valid_time!r}."}
        # The products are HOURLY frames; a sub-hour request silently snaps, so snap it here and
        # say what was actually asked for.
        hour = parsed.replace(minute=0, second=0).strftime("%Y-%m-%dT%H:%M:%SZ")

    found = sim_spots.resolve(spot_name)
    if found.candidates:
        return sim_spots.ambiguity_error(spot_name, found.candidates)
    spot = found.spot
    if not spot:
        return {"error": f"Spot '{spot_name}' not found in the catalog.",
                "hint": "Call get_surf_spots(query=...) to search by name."}

    baseline, source, provenance = _baseline_with_source(spot, hour or None)
    payload: Dict[str, Any] = {
        "spot": spot["name"],
        "region": spot.get("region"),
        "requested_valid_time": hour or "now",
        "coordinates": {"lat": spot["latitude"], "lng": spot["longitude"]},
        # WHICH catalogue this identity came from. `catalog_default` means the app did not know the
        # name and a hand-tuned row answered — at ITS coordinates, which is worth seeing.
        "spot_source": found.identity_source,
        "geometry": _geometry_payload(spot),
    }
    if baseline is None:
        # Honest empty rather than a fabricated forecast. simulate_weather_change still works here —
        # it takes the weather as INPUT, so every catalog spot can be simulated.
        payload["forecast"] = None
        payload["baseline_source"] = "none"
        payload["forecast_provenance"] = provenance
        payload["note"] = (
            f"No forecast could be established for this spot ({provenance.get('reason', 'unknown')})"
            ". Use simulate_weather_change() to evaluate a specific weather vector.")
        return payload

    payload["forecast"] = baseline
    payload["baseline_source"] = source
    if provenance:
        payload["forecast_provenance"] = provenance
    payload["wave_simulation"] = calculate_surf_rating(
        spot, baseline["swell_height_m"], baseline["swell_period_sec"],
        baseline["swell_direction_deg"], baseline["wind_speed_knots"],
        baseline["wind_direction_deg"])

    # PARITY: the app served its own breaking height for this coordinate. The sim computed one from
    # the offshore Hs through the production chain. Report both — a silent divergence here is the
    # exact defect `cf2efb48` was written to end, and it is only visible if somebody prints it.
    served = provenance.get("served_surf_height_m") if source == "live_forecast" else None
    if served:
        sim_m = payload["wave_simulation"]["breaking_height_ft"] / 3.28084
        payload["parity"] = {
            "served_surf_height_m": round(float(served), 4),
            "sim_breaking_height_m": round(sim_m, 4),
            "delta_pct": round((sim_m - float(served)) / float(served) * 100, 2),
        }
    return payload


@mcp.tool
def simulate_weather_change(
    spot_name: str,
    wind_speed_knots: float,
    wind_direction_deg: float,
    swell_height_m: float,
    swell_period_sec: float,
    swell_direction_deg: float,
    caller_role: str = "surfer"
) -> Dict[str, Any]:
    """Simulates how changing weather and swell vectors will alter wave quality and surf height.

    Args:
        spot_name: The name of the spot to simulate.
        wind_speed_knots: The simulated wind speed in knots (0.0 to 150.0).
        wind_direction_deg: The simulated wind direction in degrees (0.0 to 360.0).
        swell_height_m: The simulated ocean swell height in meters (0.0 to 50.0).
        swell_period_sec: The simulated swell period in seconds (0.0 to 30.0).
        swell_direction_deg: The simulated swell direction in degrees (0.0 to 360.0).
        caller_role: The role of the calling user. Any role may run the WHAT-IF; only 'admin' may
            persist it to condition_reports and stage it as the spot's baseline.
    """
    # ⚠️ `caller_role` is an ordinary caller-supplied string, NOT authentication. This is a local
    # sandbox gate; it is not the app's auth pattern (that is the JWT get_current_user_id checks).
    #
    # THE GATE GUARDS THE MUTATION, NOT THE ARITHMETIC (2026-07-29). It used to return Unauthorized
    # before computing anything, which made the tool's own advertised purpose — "simulates how
    # changing weather and swell vectors will alter wave quality and surf height" — unreachable
    # without also writing to `condition_reports` (read by 4 backend routes + 6 frontend surfaces)
    # and staging an override that OUTRANKS the live forecast on every later read of that spot.
    # There was no way to ask a what-if question. The docstring already said "must be 'admin' to
    # mutate"; the code was stricter than its own contract. Computing is pure — `calculate_surf_rating`
    # touches no DB and no module state — so a non-admin now gets the full answer with
    # `persisted: false`, and every write below stays exactly as gated as it was.
    may_mutate = caller_role == "admin"

    # Verify parameter ranges to prevent database corruption and bad calculations
    for label, value, lo, hi in (
        ("wind speed", wind_speed_knots, 0.0, 150.0),
        ("wind direction", wind_direction_deg, 0.0, 360.0),
        ("swell height", swell_height_m, 0.0, 50.0),
        ("swell period", swell_period_sec, 0.0, 30.0),
        ("swell direction", swell_direction_deg, 0.0, 360.0),
    ):
        if not (lo <= value <= hi):
            unit = {"wind speed": "knots", "wind direction": "degrees", "swell height": "meters",
                    "swell period": "seconds", "swell direction": "degrees"}[label]
            return {
                "success": False,
                "error": (f"Invalid {label}: {value} {unit}. "
                          f"Must be between {lo} and {hi} {unit}.")
            }

    found = sim_spots.resolve(spot_name)
    if found.candidates:
        return {"success": False, **sim_spots.ambiguity_error(spot_name, found.candidates)}
    spot = found.spot
    if not spot:
        return {"success": False,
                "error": f"Spot '{spot_name}' not found in the catalog.",
                "hint": "Call get_surf_spots(query=...) to search by name."}

    calc = calculate_surf_rating(
        spot,
        swell_height_m,
        swell_period_sec,
        swell_direction_deg,
        wind_speed_knots,
        wind_direction_deg
    )

    # Persist simulation changes to condition_reports in dev.db if present. NOTE this is a
    # write-only path for this server — nothing here reads those columns back; they are read by the
    # APP (condition_reports routes + 6 frontend surfaces), which is why conditions_label must stay
    # in the size vocabulary.
    conn = get_db_connection() if may_mutate else None
    db_updated = False
    if conn:
        try:
            cursor = conn.cursor()
            cursor.execute(
                """
                UPDATE condition_reports
                SET wave_height_ft = ?, conditions_label = ?, wind_conditions = ?, updated_at = datetime('now')
                WHERE spot_name = ? AND is_active = 1
                """,
                (calc["breaking_height_ft"], calc["conditions_label"], calc["wind_class"], spot["name"])
            )
            conn.commit()
            if cursor.rowcount > 0:
                db_updated = True
                logger.info(f"SQLite cache updated successfully for spot '{spot['name']}'. {cursor.rowcount} rows affected.")
            else:
                logger.warning(f"No active condition reports found in SQLite for spot '{spot['name']}' to update.")
        except Exception as e:
            logger.error(f"Failed to persist simulated conditions for spot '{spot['name']}' to SQLite: {e}")
        finally:
            conn.close()
    elif may_mutate:
        logger.warning(f"SQLite connection unavailable. Could not persist simulated conditions for spot '{spot_name}'.")

    # Stage the vector as this spot's baseline for subsequent get_weather_forecast reads. Held in a
    # SEPARATE dict rather than mutated into MOCK_SPOTS, so the catalog defaults stay clean and the
    # forecast can report `baseline_source: simulated_override` instead of silently presenting a
    # staged scenario as the spot's normal conditions.
    if may_mutate:
        _SIM_OVERRIDES[spot["name"]] = {
            "swell_height_m": swell_height_m,
            "swell_period_sec": swell_period_sec,
            "swell_direction_deg": swell_direction_deg,
            "wind_speed_knots": wind_speed_knots,
            "wind_direction_deg": wind_direction_deg,
        }

    return {
        "success": True,
        "simulation_type": "weather_vector_override" if may_mutate else "what_if",
        "spot": spot["name"],
        "spot_source": found.identity_source,
        "persisted": may_mutate,
        "database_updated": db_updated,
        **({} if may_mutate else {"note": (
            "What-if only: nothing was written to condition_reports and no override was staged. "
            "Pass caller_role='admin' to persist this vector as the spot's baseline.")}),
        "geometry": _geometry_payload(spot),
        "input_parameters": {
            "wind_speed_knots": wind_speed_knots,
            "wind_direction_deg": wind_direction_deg,
            "swell_height_m": swell_height_m,
            "swell_period_sec": swell_period_sec,
            "swell_direction_deg": swell_direction_deg
        },
        "simulated_surf_output": calc
    }


@mcp.tool
def clear_simulation_overrides(spot_name: str = "") -> Dict[str, Any]:
    """Drop staged simulation overrides so forecasts return to catalog defaults.

    Args:
        spot_name: Clear just this spot (name or id); empty clears every staged override.
    """
    if not spot_name:
        removed = len(_SIM_OVERRIDES)
        _SIM_OVERRIDES.clear()
        return {"success": True, "cleared": removed, "remaining": sorted(_SIM_OVERRIDES)}

    # ⚠️ THE KEY MUST BE RESOLVED THE SAME WAY `simulate_weather_change` STAGED IT. That stages
    # under the RESOLVED name, so a literal pop missed whenever the caller's spelling differed from
    # the catalogue's. Measured 2026-07-28: staging via `simulate_weather_change("mavericks")` then
    # `clear_simulation_overrides("mavericks")` returned `success: true, cleared: 0` and left the
    # override in place — and an override OUTRANKS the live forecast, so every later read of that
    # spot silently returned the staged scenario. A no-op reported as success is worse than a miss.
    keys = [spot_name]
    resolved = sim_spots.resolve(spot_name).spot
    if resolved and resolved["name"] not in keys:
        keys.append(resolved["name"])
    removed = sum(1 for k in keys if _SIM_OVERRIDES.pop(k, None) is not None)
    out = {"success": True, "cleared": removed, "remaining": sorted(_SIM_OVERRIDES)}
    if not removed:
        # Say so explicitly rather than letting `success: true` imply something was cleared.
        out["note"] = f"No staged override was held for '{spot_name}'."
    return out


# 5. FastMCP Resources

# The reference spots the summary works through when nothing is staged. Resolved through the LIVE
# catalogue like any other name, so they report the app's coordinates rather than the hand-tuned
# ones — this resource used to iterate MOCK_SPOTS directly and therefore described `Mavericks` at a
# point 637 m from production's, and `Pacifica State Beach`, which the catalogue does not carry.
_SUMMARY_REFERENCE = ("Mavericks", "Montara State Beach", "Pacifica State Beach")

# ⚠️ A SUMMARY LINE COSTS TWO HTTP REQUESTS. Each non-staged spot needs a marine and a wind sample
# (0.5-1.1 s warm, up to SIM_FORECAST_TIMEOUT_S each cold), so this budget is a LATENCY bound, not a
# display preference — the catalogue has 1818 spots and iterating it here would take hours. Staged
# overrides are exempt: their vector is already in memory and costs no network at all.
_SUMMARY_MAX = int(os.environ.get("SIM_SUMMARY_MAX", "3"))


def _summary_line(label: str, spot: Dict[str, Any], baseline: Dict[str, float],
                  source: str) -> str:
    calc = calculate_surf_rating(
        spot, baseline["swell_height_m"], baseline["swell_period_sec"],
        baseline["swell_direction_deg"], baseline["wind_speed_knots"],
        baseline["wind_direction_deg"])
    # `conditions_label` is the SIZE ladder — this line used to print it inside "Quality: …",
    # reporting e.g. "Quality: 56.4/100 (Triple Overhead+)" and mixing the two vocabularies the
    # rest of the module works to keep apart. Size and verdict are now named separately.
    return (f" - {label}: Breaking at {calc['breaking_height_ft']} ft "
            f"({calc['conditions_label']}) | Quality: {calc['quality_rating']}/100 "
            f"({calc['quality_label']}) | Wind: {round(baseline['wind_speed_knots'], 1)} kts "
            f"{calc['wind_class']} | [{source}]")


@mcp.resource("data://forecasts/summary")
def get_forecasts_summary() -> str:
    """A textual summary of staged simulations and a sample of live surf conditions."""
    live = sim_forecast.fetch_catalog()
    total = len(live) if live else None
    lines = ["=== DAILY OCEAN CONDITIONS AND FORECAST SUMMARY ===",
             f"Catalogue: {total if total is not None else 'unavailable'} active spots "
             f"({sim_spots.catalog_source()}). This is a SAMPLE — call "
             f"get_weather_forecast(spot_name) for any spot."]

    # 1. Everything staged. This is the sim's own state and the reason to read this resource at
    #    all; it is also free, so it is never truncated by the latency budget.
    staged = sorted(_SIM_OVERRIDES)
    lines.append("")
    lines.append(f"STAGED SIMULATION OVERRIDES ({len(staged)}):"
                 if staged else "STAGED SIMULATION OVERRIDES: none")
    for name in staged:
        spot = sim_spots.resolve(name).spot or {"name": name}
        if spot.get("latitude") is None:
            continue
        lines.append(_summary_line(name, spot, _SIM_OVERRIDES[name], "simulated_override"))

    # 2. A bounded sample of real conditions, skipping anything already listed above.
    lines.append("")
    lines.append(f"REFERENCE SPOTS (up to {_SUMMARY_MAX}):")
    shown = 0
    for name in _SUMMARY_REFERENCE:
        if shown >= _SUMMARY_MAX:
            break
        if name in _SIM_OVERRIDES:
            continue
        found = sim_spots.resolve(name)
        if not found.spot:
            continue
        baseline, source, _ = _baseline_with_source(found.spot)
        if baseline is None:
            continue
        label = found.spot["name"]
        if found.identity_source == "catalog_default":
            # Say it plainly: the app's catalogue does not carry this name, so the line describes
            # a hand-tuned coordinate rather than a production spot.
            label += " (not in the app catalogue)"
        lines.append(_summary_line(label, found.spot, baseline, source))
        shown += 1
    return "\n".join(lines)


# 6. FastMCP Prompts

@mcp.prompt("surf_forecast_advisor")
def get_surf_advisor_prompt(spot_name: str) -> str:
    """Prompt template that helps analyze surf and wind parameters to give strategic surf advice."""
    found = sim_spots.resolve(spot_name)
    if found.candidates:
        names = ", ".join(f"{c['name']} ({c['region']})" for c in found.candidates)
        return (f"The name '{spot_name}' matches several spots in the catalogue: {names}. Ask the "
                f"surfer which one they mean before advising — do not pick one.")
    if not found.spot:
        # Was `or MOCK_SPOTS["Mavericks"]`, which briefed the model about a Californian big-wave
        # break whenever the requested name was unknown, without ever saying so.
        return (f"No spot named '{spot_name}' is in the catalogue. Say so, and offer to search "
                f"with get_surf_spots(query=...) — do not advise about a different spot.")
    spot = found.spot
    normal = shore_normal_for(spot)
    # Both optimal directions are DERIVED from the one shore normal rather than stored separately.
    # The stored `optimal_wind_dir`/`optimal_swell_dir` fields disagreed with the bearing the engine
    # actually scores against (by 20 deg at Montara, 64.9 deg at Mavericks), so this prompt used to
    # brief the model on parameters the simulation was not using.
    if normal is None:
        return (f"You are a veteran surf forecaster advising a professional surfer about "
                f"'{spot['name']}'. No shore orientation could be resolved for this spot, so treat "
                f"swell-window and wind-direction reasoning as unconstrained and say so explicitly.")
    return f"""You are a veteran surf forecaster and oceanographer advising a professional surfer.

Here are the resolved parameters for the spot '{spot['name']}':
- Shore normal (seaward bearing): {round(normal, 1)}°
- Optimal swell direction: {round(normal, 1)}° (swell arriving head-on)
- Optimal wind direction: {round((normal - 180) % 360, 1)}° (offshore — blowing out to sea)

Analyze the current weather and swell forecast for this spot. Run a physical simulation calculating the wave break height and wind-swell vector alignment. Detail:
1. Expected breaking wave height (ft) and swell-to-beach vector alignment percentage.
2. The offshore/sideshore classification of the wind vector.
3. Your strategic recommendation: Should they surf this spot today, wait for tide changes, or head to another spot in the region? Explain your reasoning with physical principles of bathymetry and wave shoaling.
"""

# 7. Main-thread warm-up — WITHOUT THIS THE SERVER DEADLOCKS ON ITS FIRST TOOL CALL
#
# Measured 2026-07-27 against the real stdio server: `get_surf_spots(query="Mavericks", limit=5)`
# returned NOTHING for 480 s (the MCP client gives up at 1800 s), while the identical call
# in-process took 0.02 s. faulthandler dumps of the live server — byte-identical at 25 s, 50 s and
# 75 s — put the AnyIO worker thread inside `create_module`, loading numpy's `_multiarray_umath` C
# extension, reached from `bathymetry.shelf_depth_at` where `import numpy` is a FUNCTION-level
# import. Loading that DLL from a worker thread under the running stdio event loop never returns.
#
# What the measurements ruled OUT, so nobody re-tries them:
#   * Not slowness — 3.7 s of CPU across 43 minutes of hanging.
#   * Not fastmcp and not sync-vs-async dispatch — a minimal server with a trivial sync tool
#     answers in 0.01 s on this same interpreter.
#   * Not `get_surf_spots` — whichever tool is called FIRST is the one that hangs, and a second
#     request unblocks the first (its response then arrives late, under the earlier id).
#   * Not fixed by importing `bathymetry` — numpy is imported inside the function, not at that
#     module's scope, so importing the module warms nothing.
# Importing numpy on the MAIN thread first makes the identical call return in 0.02 s.
#
# One full rating is run rather than a bare `import numpy` so that EVERY lazy import on the tool
# hot path — the bathymetry grid load, the ETOPO shore-normal asset, the magnet overrides,
# `surf_transform.estimate_surf` — is resolved here too, on the main thread. Measured cost ~0.2 s.
# Kill: SIM_EAGER_WARMUP=0.
def _warm_hot_path() -> bool:
    """Resolve the tool hot path's lazy imports on the MAIN thread. Never raises."""
    if not _sim_flag("SIM_EAGER_WARMUP"):
        return False
    try:
        import time as _time
        _t0 = _time.time()
        calculate_surf_rating(MOCK_SPOTS["Mavericks"], 3.5, 16.0, 290.0, 12.0, 95.0)
        logger.info(f"hot path warmed on the main thread in {_time.time() - _t0:.2f}s")
        return True
    except Exception as e:
        # A failed warm-up must never stop the server booting — it only forfeits the protection.
        logger.warning(f"hot-path warm-up failed ({e}); the first tool call may block.")
        return False


_warm_hot_path()

# The live catalogue, warmed OFF the request path. The first tool call would otherwise pay the whole
# round trip, and on a cold Render instance (~50 s to wake) that is the difference between an answer
# and a client-side timeout. Non-blocking by construction: a slow or dead app delays nothing here,
# the tools simply fall back to the snapshot until it lands.
sim_forecast.prefetch_catalog_async()


if __name__ == "__main__":
    mcp.run()
